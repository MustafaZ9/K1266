# Deploying the Web Push notifier (Cloudflare Worker)

The same worker that triggers the scraper (`autokgc-trigger`) now also sends
Web Push notifications when the **last redemption summary shows a new gift code**.

```
K1266 PWA (js/push.js)                    Cloudflare Worker                        autokgc
┌──────────────────────────┐   POST /subscribe   ┌──────────────────┐    cron */5   ┌────────────────┐
│ 🔔 Notify me → subscribe │ ──────────────────▶ │ PUSH_SUBS (KV)   │ ────────────▶ │ redeemed_codes │
│                          │                     │ + VAPID secrets  │ ◀──────────── │ .txt           │
│ 🎁 new code? ◀───────────┐│◀──── Web Push ─────│ worker/worker.js │  fetch + diff │                │
└──────────────────────────┘│                     └──────────────────┘               └────────────────┘
```

- Pushes fire **only when the code changes** (not on stat changes) — no spam.
- First cron run after setup **seeds silently** (no push storm on deploy).
- Dead subscriptions (404/410 from the push service) are auto-deleted.
- Notification format mirrors the site: `🎁 New code: KS1104` / `10/300 redeemed · 9 failed · 00:07:59 · 2026-11-15 15:32 UTC`.

## One-time setup (Cloudflare dashboard, ~5 minutes)

**1. Update the worker code**
- <https://dash.cloudflare.com> → **Workers & Pages** → **autokgc-trigger** → **Edit code**
- Replace the whole code with the contents of [`worker/worker.js`](./worker.js) (single self-contained file — the Web Push crypto is inlined).
- **Save and deploy.**

**2. Create + bind the KV namespace** (stores subscriptions + last seen code)
- Workers & Pages → autokgc-trigger → **Settings** → **Variables** (Bindings)
- **KV Namespace Bindings → Add**: create a namespace (e.g. `k1266-push`) and bind it to variable name **`PUSH_SUBS`**

**3. Add the secrets** (Settings → Variables → **Secrets → Add**)

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | `BHlnR6xkhYfV1v_XLW9wKzZpinl1oNlhHTqbmMvIHeml1D6dcT2dw9reoBWTQ6xHgTZ0y1DYOId_D0kEhZxDPAc` |
| `VAPID_PRIVATE_KEY` | *the private key from the setup chat — not committed anywhere* |
| `ADMIN_KEY` | *any long random string (provided in the setup chat) — used only by `/push-test`* |
| `GITHUB_PAT` | already configured — verify it's still there |

Optional: `VAPID_SUBJECT` (defaults to `mailto:admin@twikilab.dev`).

**4. Add the Cron Trigger**
- Settings → **Triggers** → **Cron Triggers** → Add Cron Trigger →
  `*/5 * * * *` (every 5 minutes)

## Verify

1. Open `https://autokgc-trigger.twikilab.workers.dev/health` — expect
   `{"ok":true,"subscribers":0,"pushConfigured":true}`.
2. On the K1266 site press **🔔 Notify me** (phone: install the PWA first — iOS requires it) and allow notifications.
3. `GET /health` again → `"subscribers":1`.
4. Send yourself a test push:
   ```bash
   curl -X POST https://autokgc-trigger.twikilab.workers.dev/push-test \
        -H "X-Admin-Key: <ADMIN_KEY>" -H "Content-Type: application/json" -d '{}'
   ```
   → `{"success":true,"total":1,"sent":1,...}` and the notification appears.
5. Real-world check: trigger a redeem for a **new** code; within 5 minutes of its
   summary landing in `redeemed_codes.txt` every subscriber gets a push.

## Files

- [`worker/worker.js`](./worker.js) — paste-ready single-file worker (the Web Push helpers are inlined between the two `====` section banners; it is plain readable code)
- [`worker/webpush.js`](./webpush.js) — the same Web Push module as a standalone ES module (kept as the readable/tested reference; validated against the `web-push` npm reference implementation)
- Frontend: `js/push.js`, `sw.js` (push + notificationclick handlers), `index.html` (🔔 button)
