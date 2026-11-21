/* ============================================
   PUSH — Web Push notifications for new gift codes
   🔔 button toggles the subscription on the Cloudflare worker.
   iOS requires the app to be installed (standalone) to receive pushes.
   ============================================ */
(() => {
    const WORKER_URL = 'https://autokgc-trigger.twikilab.workers.dev';
    // VAPID public key — public by design (the private key lives only in the worker)
    const VAPID_PUBLIC_KEY = 'BHlnR6xkhYfV1v_XLW9wKzZpinl1oNlhHTqbmMvIHeml1D6dcT2dw9reoBWTQ6xHgTZ0y1DYOId_D0kEhZxDPAc';

    const btn = document.getElementById('pushBtn');
    const toast = document.getElementById('redeemToast');
    let toastTimer;

    function showToast(message, type) {
        if (!toast) return;
        toast.textContent = message;
        toast.className = `redeem-toast show ${type || ''}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
    }

    const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = () => {
        try {
            return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        } catch (e) { return false; }
    };
    const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    function urlB64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    function setState(on) {
        if (!btn) return;
        btn.classList.toggle('on', on);
        btn.textContent = on ? '🔔 Subscribed' : '🔔 Notify me';
        btn.title = on ? 'Tap to turn off gift code notifications' : 'Get a notification when a new gift code drops';
    }

    async function getRegistration() {
        if (!pushSupported()) return null;
        return (await navigator.serviceWorker.getRegistration('./'))
            || (await navigator.serviceWorker.ready.catch(() => null));
    }

    async function serverUnsubscribe(endpoint) {
        try {
            await fetch(WORKER_URL + '/unsubscribe', {
                method: 'POST',
                mode: 'cors',
                // text/plain → CORS simple request, no OPTIONS preflight
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ endpoint }),
            });
        } catch (e) { /* best effort */ }
    }

    async function onToggle() {
        if (!pushSupported()) { showToast('❌ Push is not supported in this browser', 'error'); return; }

        // iOS: Web Push only works in the installed PWA (16.4+)
        if (isIOS() && !isStandalone()) {
            showToast('📲 Install K1266 to your home screen first (Share → Add to Home Screen)', 'info');
            return;
        }

        const reg = await getRegistration();
        if (!reg) { showToast('❌ App is still loading — try again in a moment', 'error'); return; }
        const existing = await reg.pushManager.getSubscription();

        if (existing) {
            // ── turn OFF ──
            const endpoint = existing.endpoint;
            try { await existing.unsubscribe(); } catch (e) { /* ignore */ }
            await serverUnsubscribe(endpoint);
            setState(false);
            showToast('🔕 Notifications turned off', 'info');
            return;
        }

        // ── turn ON — permission must be requested inside this user gesture ──
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            showToast('🔕 Notifications are blocked — enable them in your browser settings', 'error');
            return;
        }

        try {
            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
            });
            const resp = await fetch(WORKER_URL + '/subscribe', {
                method: 'POST',
                mode: 'cors',
                // text/plain → CORS simple request, no OPTIONS preflight
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(sub.toJSON()),
            });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data?.success) {
                await sub.unsubscribe().catch(() => {});
                showToast(`❌ Push server error: ${data?.error || resp.statusText || resp.status}`, 'error');
                return;
            }
            setState(true);
            showToast('🔔 Done! You will be notified when a new gift code drops', 'success');
        } catch (e) {
            showToast('❌ Could not subscribe: ' + (e && e.message ? e.message : e), 'error');
        }
    }

    async function init() {
        if (!btn) return;
        if (!pushSupported()) { btn.style.display = 'none'; return; }
        btn.addEventListener('click', onToggle);
        try {
            const reg = await getRegistration();
            const sub = reg ? await reg.pushManager.getSubscription() : null;
            setState(!!sub);
        } catch (e) { setState(false); }
    }

    init();
})();
