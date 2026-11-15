/* ============================================
   REDEEM — Gift Code Trigger via Cloudflare Worker
   Tap   → auto scrape + redeem
   Hold  → manual code entry modal (600ms, with progress ring + haptics)
   Uses Pointer Events (pointerdown/up/cancel) so touch and mouse behave
   identically on phones — the old touchstart/mouseup pair was broken by
   the browser's long-press context menu (passive touchstart can't prevent it).
   ============================================ */
(() => {
    const WORKER_URL = 'https://autokgc-trigger.twikilab.workers.dev';
    const LONG_PRESS_MS = 600;
    const DRAG_CANCEL_PX = 12;      // moving the finger this far cancels the hold

    const fab = document.getElementById('redeemFab');
    const fabIcon = fab ? fab.querySelector('.fab-icon') : null;
    const toast = document.getElementById('redeemToast');
    const modal = document.getElementById('code-modal');
    const form = document.getElementById('code-form');
    const input = document.getElementById('manual-code-input');
    let toastTimer;
    let pressTimer = null;
    let longPressFired = false;
    let activePointerId = null;
    let cancelled = false;
    let startX = 0, startY = 0;

    function showToast(message, type) {
        if (!toast) return;
        toast.textContent = message;
        toast.className = `redeem-toast show ${type}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
    }

    function vibrate(ms) {
        try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
    }

    function setBusy(busy) {
        if (!fab) return;
        fab.disabled = busy;
        fab.classList.toggle('busy', busy);
        if (fabIcon) fabIcon.textContent = busy ? '⏳' : '🎁';
    }

    /* ── Hold progress ring (SVG injected inside the FAB) ── */
    const SVG_NS = 'http://www.w3.org/2000/svg';
    let ring = null;
    function buildRing() {
        if (!fab || ring) return;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'fab-hold-ring');
        svg.setAttribute('viewBox', '0 0 64 64');
        svg.setAttribute('aria-hidden', 'true');
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', '32');
        circle.setAttribute('cy', '32');
        circle.setAttribute('r', '30');
        const circumference = 2 * Math.PI * 30;
        circle.style.strokeDasharray = String(circumference);
        circle.style.strokeDashoffset = String(circumference);
        svg.appendChild(circle);
        ring = { svg, circle, circumference };
        fab.appendChild(svg);
    }
    function ringStart() {
        buildRing();
        if (!ring) return;
        // force a reflow so the transition replays every hold
        ring.circle.style.transition = 'none';
        ring.circle.style.strokeDashoffset = String(ring.circumference);
        void ring.svg.getBoundingClientRect();
        ring.circle.style.transition = `stroke-dashoffset ${LONG_PRESS_MS}ms linear`;
        ring.circle.style.strokeDashoffset = '0';
        fab.classList.add('holding');
    }
    function ringReset() {
        if (!ring) return;
        ring.circle.style.transition = 'none';
        ring.circle.style.strokeDashoffset = String(ring.circumference);
        void ring.svg.getBoundingClientRect();
        fab.classList.remove('holding');
    }

    /* ── Auto trigger (tap) ── */
    async function triggerAuto() {
        setBusy(true);
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
        setBusy(false);
    }

    /* ── Manual code (hold) ── */
    async function triggerManual(code) {
        setBusy(true);
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
        setBusy(false);
    }

    function openCodeModal(skipFocus) {
        if (!modal) return;
        modal.classList.add('open');
        if (input) {
            input.value = '';
            // Autofocusing a text field inside a touch gesture pops the keyboard
            // mid-gesture and glitches iOS — let the user tap the field instead.
            if (!skipFocus) input.focus();
        }
    }

    /* ── Pointer-based hold detection (works for touch, mouse & pen) ── */
    function onPointerDown(e) {
        if (fab.disabled) return;
        if (activePointerId !== null) return;                       // already pressing
        if (e.pointerType === 'mouse' && e.button !== 0) return;    // primary button only
        activePointerId = e.pointerId;
        longPressFired = false;
        cancelled = false;
        startX = e.clientX;
        startY = e.clientY;
        try { fab.setPointerCapture(e.pointerId); } catch (err) { /* keep going without capture */ }
        ringStart();
        vibrate(10);
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            pressTimer = null;
            longPressFired = true;
            ringReset();
            vibrate(40);
            openCodeModal(e.pointerType === 'touch');
        }, LONG_PRESS_MS);
    }

    function onPointerMove(e) {
        if (activePointerId === null || e.pointerId !== activePointerId) return;
        if (cancelled || pressTimer === null) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (dx * dx + dy * dy > DRAG_CANCEL_PX * DRAG_CANCEL_PX) {
            // finger is dragging away → cancel the hold (no modal, no auto trigger)
            cancelled = true;
            clearTimeout(pressTimer);
            pressTimer = null;
            ringReset();
        }
    }

    function onPointerUp(e) {
        if (activePointerId === null || e.pointerId !== activePointerId) return;
        const wasLong = longPressFired;
        clearTimeout(pressTimer);
        pressTimer = null;
        activePointerId = null;
        ringReset();
        if (!wasLong && !cancelled && !fab.disabled) triggerAuto();
    }

    function onPointerCancel(e) {
        if (activePointerId !== null && e.pointerId !== activePointerId) return;
        clearTimeout(pressTimer);
        pressTimer = null;
        activePointerId = null;
        ringReset();
    }

    fab?.addEventListener('pointerdown', onPointerDown);
    fab?.addEventListener('pointermove', onPointerMove);
    fab?.addEventListener('pointerup', onPointerUp);
    fab?.addEventListener('pointercancel', onPointerCancel);
    fab?.addEventListener('lostpointercapture', onPointerCancel);
    fab?.addEventListener('contextmenu', (e) => e.preventDefault());
    // keyboard activation (Enter/Space on a focused button) — clicks have detail 0
    fab?.addEventListener('click', (e) => {
        if (e.detail === 0 && !fab.disabled && !modal?.classList.contains('open')) triggerAuto();
    });

    /* ── Manual code submit (real <form> → mobile keyboards' "Go" works) ── */
    function submitManual() {
        const code = input?.value.trim();
        if (!code) return;
        if (!/^[A-Za-z0-9_]{3,30}$/.test(code)) {
            showToast('❌ Invalid code format', 'error');
            return;
        }
        modal?.classList.remove('open');
        if (input) input.value = '';
        triggerManual(code);
    }

    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); submitManual(); });
    // legacy hooks kept for compatibility
    window.submitManualCode = submitManual;
    window.closeCodeModal = function () {
        modal?.classList.remove('open');
    };

    /* ── First-visit hint (touch devices only, once) ── */
    try {
        const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
        if (isCoarsePointer && !localStorage.getItem('k1266-fab-hint-v1')) {
            localStorage.setItem('k1266-fab-hint-v1', '1');
            setTimeout(() => showToast('🎁 Tap to auto redeem · Hold to enter a code', 'info'), 1500);
        }
    } catch (e) {}
})();
