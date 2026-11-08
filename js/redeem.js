/* ============================================
   REDEEM — Gift Code Trigger via Cloudflare Worker
   Short press  → auto scrape + redeem
   Long press   → manual code entry modal
   ============================================ */
(() => {
    const WORKER_URL = 'https://autokgc-trigger.twikilab.workers.dev';
    const LONG_PRESS_MS = 600;

    const fab = document.getElementById('redeemFab');
    const toast = document.getElementById('redeemToast');
    let toastTimer, pressTimer, isLongPress;

    function showToast(message, type) {
        if (!toast) return;
        toast.textContent = message;
        toast.className = `redeem-toast show ${type}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
    }

    // --- Auto trigger (short press) ---
    async function triggerAuto() {
        fab.disabled = true;
        const original = fab.innerHTML;
        fab.innerHTML = '⏳';
        fab.style.animation = 'none';

        try {
            const resp = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await resp.json().catch(() => null);
            if (resp.ok && data?.success) {
                showToast('✅ ' + (data.message || 'Redemption triggered!'), 'success');
                try { localStorage.setItem('lastRedeem', Date.now()); } catch (e) {}
            } else {
                showToast(`❌ Failed: ${data?.error || resp.statusText}`, 'error');
            }
        } catch {
            showToast('❌ Network error. Is the worker running?', 'error');
        }

        fab.disabled = false;
        fab.innerHTML = original;
        fab.style.animation = 'fabPulse 3s ease-in-out infinite';
    }

    // --- Manual code (long press) ---
    async function triggerManual(code) {
        fab.disabled = true;
        const original = fab.innerHTML;
        fab.innerHTML = '⏳';
        fab.style.animation = 'none';

        try {
            const resp = await fetch(WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await resp.json().catch(() => null);
            if (resp.ok && data?.success) {
                showToast('✅ ' + (data.message || `Code "${code}" sent!`), 'success');
                try { localStorage.setItem('lastRedeem', Date.now()); } catch (e) {}
            } else {
                showToast(`❌ Failed: ${data?.error || resp.statusText}`, 'error');
            }
        } catch {
            showToast('❌ Network error.', 'error');
        }

        fab.disabled = false;
        fab.innerHTML = original;
        fab.style.animation = 'fabPulse 3s ease-in-out infinite';
    }

    function openCodeModal() {
        const modal = document.getElementById('code-modal');
        if (modal) {
            modal.classList.add('open');
            const input = document.getElementById('manual-code-input');
            if (input) { input.value = ''; input.focus(); }
        }
    }

    // --- Long press detection (touch + mouse) ---
    function onPressStart(e) {
        if (fab.disabled) return;
        isLongPress = false;
        pressTimer = setTimeout(() => {
            isLongPress = true;
            if (navigator.vibrate) navigator.vibrate(50);
            openCodeModal();
        }, LONG_PRESS_MS);
    }

    function onPressEnd(e) {
        clearTimeout(pressTimer);
        if (!isLongPress && !fab.disabled) {
            triggerAuto();
        }
    }

    function onPressCancel() {
        clearTimeout(pressTimer);
    }

    fab?.addEventListener('mousedown', onPressStart);
    fab?.addEventListener('mouseup', onPressEnd);
    fab?.addEventListener('mouseleave', onPressCancel);
    fab?.addEventListener('touchstart', onPressStart, { passive: true });
    fab?.addEventListener('touchend', (e) => { e.preventDefault(); onPressEnd(e); });
    fab?.addEventListener('touchcancel', onPressCancel);
    fab?.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- Manual code submit handler ---
    window.submitManualCode = function() {
        const input = document.getElementById('manual-code-input');
        const code = input?.value.trim();
        if (!code) return;
        if (!/^[A-Za-z0-9_]{3,30}$/.test(code)) {
            showToast('❌ Invalid code format', 'error');
            return;
        }
        document.getElementById('code-modal')?.classList.remove('open');
        input.value = '';
        triggerManual(code);
    };

    window.closeCodeModal = function() {
        document.getElementById('code-modal')?.classList.remove('open');
    };
})();
