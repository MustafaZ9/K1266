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

export { sendWebPush, encryptPayload, vapidAuthorization, b64urlEncode, b64urlDecode };
