// Cloudflare Worker: autokgc-trigger
// Deploy at: https://autokgc-trigger.twikilab.workers.dev
//
// SINGLE-FILE bundle — paste this whole file into the Cloudflare dashboard editor.
// Web Push helpers (RFC 8291 aes128gcm + RFC 8292 VAPID, zero dependencies) are
// inlined from worker/webpush.js. See worker/README-DEPLOY.md for setup steps.
//
// Required configuration (dashboard):
//   Secrets:      GITHUB_PAT (already set), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, ADMIN_KEY
//   KV binding:   PUSH_SUBS -> any KV namespace
//   Optional var: VAPID_SUBJECT (default: mailto:admin@twikilab.dev)
//   Cron Trigger: */5 * * * *
//
// Endpoints:
//   POST /             -> trigger auto scrape + redeem   (unchanged legacy behavior)
//   POST { code }      -> trigger manual code redemption (unchanged legacy behavior)
//   POST /subscribe    -> save Web Push subscription   (public)
//   POST /unsubscribe  -> remove Web Push subscription (public)
//   POST /push-test    -> test push to all subscribers (X-Admin-Key header required)
//   GET  /health       -> { ok, subscribers, pushConfigured }
//   Cron (*/5)         -> fetch log, push when the last summary's CODE changes

/* ============================================================
   webpush.js — Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID)
   Pure WebCrypto — works in Cloudflare Workers & Node 18+.
   No external dependencies.
   ============================================================ */

const b64urlDecode = (str) => {
    const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
};

const b64urlEncode = (bytes) => {
    let bin = '';
    for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const concat = (...arrays) => {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
};

// HKDF(salt, ikm, info, L) via WebCrypto
async function hkdf(salt, ikm, info, length) {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info }, key, length));
}

/* ── VAPID (RFC 8292): ES256 JWT signed with the VAPID private key ── */
async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }) {
    const aud = new URL(endpoint).origin;
    const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

    const enc = (obj) => b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
    const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp, sub: subject })}`;

    const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'EC', crv: 'P-256', x: '', y: '', d: '', ...jwkFromRawKeys(publicKey, privateKey) },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );
    const sig = new Uint8Array(await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned)));

    return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${publicKey}`;
}

// Rebuild a JWK from the base64url raw public (0x04||x||y) and private (d) keys.
function jwkFromRawKeys(publicKeyB64, privateKeyB64) {
    const raw = b64urlDecode(publicKeyB64);
    if (raw.length !== 65 || raw[0] !== 4) {
        throw new Error('VAPID public key must be 65-byte uncompressed P-256 point');
    }
    const d = b64urlDecode(privateKeyB64);
    if (d.length !== 32) throw new Error('VAPID private key must be 32 bytes');
    return {
        kty: 'EC', crv: 'P-256',
        x: b64urlEncode(raw.slice(1, 33)),
        y: b64urlEncode(raw.slice(33, 65)),
        d: b64urlEncode(d),
    };
}

/* ── Payload encryption (RFC 8291 "aes128gcm") ──
   subscriptionKeys: { p256dh: <base64url>, auth: <base64url> }
   Returns the binary request body (Uint8Array). */
async function encryptPayload(payloadString, subscriptionKeys) {
    const userPub = b64urlDecode(subscriptionKeys.p256dh);
    const userAuth = b64urlDecode(subscriptionKeys.auth);
    if (userPub.length !== 65 || userPub[0] !== 4) {
        throw new Error('Bad user p256dh key (expected 65-byte uncompressed point)');
    }
    if (userAuth.length < 16) throw new Error('Bad user auth secret');

    const RS = 4096;                 // record size
    const HEADER_LEN = 16 + 4 + 1;   // salt(16) + rs(4) + idlen(1); keyid follows (+65)
    // plaintext space available inside the record
    const maxPayload = RS - HEADER_LEN - 65 - 16 - 1; // minus keyid, minus GCM tag, minus padding delim
    if (payloadString.length > maxPayload) {
        throw new Error(`Payload too large: ${payloadString.length} > ${maxPayload}`);
    }

    // 1. Ephemeral server ECDH key pair
    const eph = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));

    // 2. ECDH shared secret with the user's public key
    const userPubKey = await crypto.subtle.importKey(
        'raw', userPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'ECDH', public: userPubKey }, eph.privateKey, 256));

    // 3. IKM — per RFC 8291 §4: salt = user auth secret,
    //    info = "WebPush: info" || 0x00 || user_pub || ephemeral_pub
    const ikmInfo = concat(
        new TextEncoder().encode('WebPush: info'), new Uint8Array([0]), userPub, ephPubRaw);
    const ikm = await hkdf(userAuth, ecdhSecret, ikmInfo, 256);

    // 4. Salt + CEK (128 bits) + NONCE (96 bits)
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 128);
    const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 96);

    // 5. Pad plaintext: payload || 0x02 || 0x00...
    const payloadBytes = new TextEncoder().encode(payloadString);
    const record = new Uint8Array(payloadBytes.length + 1);
    record.set(payloadBytes, 0);
    record[payloadBytes.length] = 2;

    // 6. AES-128-GCM encrypt (single record → sequence 0 → nonce as-is, no AAD)
    const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, record));

    // 7. aes128gcm header: salt || rs(BE32) || idlen(1) || keyid(ephemeral pubkey)
    const header = new Uint8Array(HEADER_LEN + ephPubRaw.length);
    header.set(salt, 0);
    new DataView(header.buffer).setUint32(16, RS, false);
    header[20] = ephPubRaw.length;
    header.set(ephPubRaw, 21);

    return concat(header, ciphertext);
}

/* ── Send one Web Push message ──
   vapid: { publicKey, privateKey, subject }
   Returns the HTTP status of the push request. */
async function sendWebPush(subscription, payloadString, vapid) {
    const auth = await vapidAuthorization(subscription.endpoint, vapid);
    const body = await encryptPayload(payloadString, subscription.keys);

    const resp = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
            Authorization: auth,
            TTL: String(2 * 60 * 60),        // 2 hours
            Urgency: 'normal',
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aes128gcm',
        },
        body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    });
    return resp.status;
}

/* ============================================================
   WORKER LOGIC — trigger + push subscriptions + cron notifier
   (Web Push helpers above are inlined from worker/webpush.js)
   ============================================================ */

const LOG_URL = 'https://raw.githubusercontent.com/MustafaZ9/autokgc/main/redeemed_codes.txt';
const SITE_URL = 'https://mustafaz9.github.io/K1266/';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Access-Control-Max-Age': '86400',
};

const json = (obj, status = 200) => new Response(
    JSON.stringify(obj),
    { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function vapidConfig(env) {
    return {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT || 'mailto:admin@twikilab.dev',
    };
}

function pushConfigured(env) {
    return !!(env.PUSH_SUBS && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

async function listSubscriptions(env) {
    const subs = [];
    let cursor;
    for (;;) {
        const opts = { prefix: 'sub:' };
        if (cursor) opts.cursor = cursor;
        const page = await env.PUSH_SUBS.list(opts);
        for (const k of page.keys) {
            const raw = await env.PUSH_SUBS.get(k.name);
            if (!raw) continue;
            try { subs.push(JSON.parse(raw)); } catch (e) { /* skip corrupt entry */ }
        }
        if (page.list_complete || !page.cursor) break;
        cursor = page.cursor;
    }
    return subs;
}

/* Push a JSON payload to every subscriber; drop dead subscriptions (404/410). */
async function pushToAll(env, payload) {
    const vapid = vapidConfig(env);
    const subs = await listSubscriptions(env);
    let sent = 0, failed = 0, removed = 0;
    const body = JSON.stringify(payload);
    for (const sub of subs) {
        try {
            const status = await sendWebPush(sub, body, vapid);
            if (status === 404 || status === 410) {
                await env.PUSH_SUBS.delete('sub:' + await sha256Hex(sub.endpoint));
                removed++;
            } else if (status >= 200 && status < 300) {
                sent++;
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
        }
    }
    return { total: subs.length, sent, failed, removed };
}

/* Parse the last "Redemption Summary" block — mirrors js/status.js exactly. */
function parseLastSummary(text) {
    const lines = text.split('\n');
    let lastSummaryStart = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('Redemption Summary')) {
            lastSummaryStart = i;
            break;
        }
    }
    if (lastSummaryStart === -1) return null;

    const extract = (key) => {
        for (let i = lastSummaryStart; i < Math.min(lastSummaryStart + 15, lines.length); i++) {
            if (lines[i].includes(key)) {
                const match = lines[i].split(key)[1];
                return match ? match.trim() : null;
            }
        }
        return null;
    };

    const code = extract('Code Redeemed:');
    const success = extract('Successfully redeemed:');
    const total = extract('Total Player IDs Processed:');
    const errors = extract('Other Errors/Failures:');
    const time = extract('Total execution time:');

    let date = null;
    const dateMatch = lines[lastSummaryStart + 1]?.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
    if (dateMatch) date = dateMatch[1];

    if (!code) return null;
    return { code, success, total, errors, time, date };
}

/* Cron (every 5 min): fetch log → detect new code → push to all subscribers. */
async function checkAndNotify(env) {
    if (!pushConfigured(env)) return { skipped: 'push not configured' };

    const resp = await fetch(LOG_URL, { cache: 'no-store' });
    if (!resp.ok) return { skipped: 'log fetch failed', status: resp.status };
    const summary = parseLastSummary(await resp.text());
    if (!summary || !summary.code) return { skipped: 'no summary in log' };

    const previous = await env.PUSH_SUBS.get('lastCode');
    if (previous === summary.code) return { skipped: 'code unchanged' };

    await env.PUSH_SUBS.put('lastCode', summary.code);

    // First ever run: seed KV silently so a fresh deploy doesn't push-storm.
    if (previous === null) return { seeded: summary.code };

    const parts = [];
    if (summary.success && summary.total) parts.push(`${summary.success}/${summary.total} redeemed`);
    if (summary.errors && summary.errors !== '0') parts.push(`${summary.errors} failed`);
    if (summary.time) parts.push(summary.time);
    if (summary.date) parts.push(`${summary.date} UTC`);

    const result = await pushToAll(env, {
        title: `🎁 New code: ${summary.code}`,
        body: parts.join(' · ') || 'New gift code available!',
        url: SITE_URL,
    });
    return { pushed: summary.code, ...result };
}

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';

        try {
            /* ── GET /health — quick status check ── */
            if (path === '/health' && request.method === 'GET') {
                const subscribers = env.PUSH_SUBS ? (await listSubscriptions(env)).length : 0;
                return json({ ok: true, subscribers, pushConfigured: pushConfigured(env) });
            }

            /* ── POST /subscribe — save a Web Push subscription ── */
            if (path === '/subscribe' && request.method === 'POST') {
                if (!env.PUSH_SUBS) return json({ success: false, error: 'Push storage not configured (KV binding PUSH_SUBS missing)' }, 503);
                const sub = await request.json().catch(() => null);
                const valid = sub
                    && typeof sub.endpoint === 'string' && sub.endpoint.startsWith('https://')
                    && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
                if (!valid) return json({ success: false, error: 'Invalid subscription' }, 400);
                await env.PUSH_SUBS.put('sub:' + await sha256Hex(sub.endpoint), JSON.stringify({
                    endpoint: sub.endpoint,
                    keys: sub.keys,
                    added: new Date().toISOString(),
                }));
                return json({ success: true });
            }

            /* ── POST /unsubscribe — remove a Web Push subscription ── */
            if (path === '/unsubscribe' && request.method === 'POST') {
                if (!env.PUSH_SUBS) return json({ success: false, error: 'Push storage not configured' }, 503);
                const body = await request.json().catch(() => null);
                if (!body || typeof body.endpoint !== 'string') return json({ success: false, error: 'Invalid endpoint' }, 400);
                await env.PUSH_SUBS.delete('sub:' + await sha256Hex(body.endpoint));
                return json({ success: true });
            }

            /* ── POST /push-test — send a test push (requires X-Admin-Key header) ── */
            if (path === '/push-test' && request.method === 'POST') {
                if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) {
                    return json({ success: false, error: 'Unauthorized (X-Admin-Key header required)' }, 403);
                }
                if (!pushConfigured(env)) return json({ success: false, error: 'Push not configured (KV binding or VAPID keys missing)' }, 503);
                const body = await request.json().catch(() => ({}));
                const result = await pushToAll(env, {
                    title: '🔔 K1266 test push',
                    body: (body && body.message) || 'Web Push is working! You will be notified when a new gift code appears.',
                    url: SITE_URL,
                });
                return json({ success: true, ...result });
            }

            /* ── Legacy trigger behavior (unchanged) ──
               POST (no body)       → trigger auto scrape + redeem
               POST { code: "..." } → trigger manual code redemption */
            if (request.method !== 'POST') {
                return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
            }

            const githubUrl = 'https://api.github.com/repos/MustafaZ9/autokgc/dispatches';
            const pat = env.GITHUB_PAT;
            if (!pat) {
                return json({ success: false, error: 'GitHub PAT not configured in worker environment variables' }, 500);
            }

            let manualCode = null;
            try {
                const body = await request.json();
                if (body && body.code && typeof body.code === 'string') {
                    manualCode = body.code.trim();
                    if (!/^[A-Za-z0-9_]{3,30}$/.test(manualCode)) {
                        return json({ success: false, error: 'Invalid code format. Use 3-30 alphanumeric characters.' }, 400);
                    }
                }
            } catch (e) {
                // No body or invalid JSON — fine, proceed with normal trigger
            }

            const payload = {
                event_type: 'trigger-scraper',
                ...(manualCode && { client_payload: { code: manualCode } }),
            };

            const response = await fetch(githubUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `Bearer ${pat}`,
                    'User-Agent': 'Cloudflare-Worker-Proxy',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (response.status === 204) {
                const msg = manualCode ? `Code "${manualCode}" sent for redemption!` : 'Scraper triggered!';
                return json({ success: true, message: msg });
            }
            const errorText = await response.text();
            return json({ success: false, error: errorText, status: response.status }, response.status);
        } catch (error) {
            return json({ success: false, error: error.message }, 500);
        }
    },

    /* ── Cron Trigger (every 5 min): notify on new gift code ── */
    async scheduled(controller, env, ctx) {
        ctx.waitUntil(checkAndNotify(env));
    },
};
