/* pwa-install.js — Chrome native install prompt helper */
/* Additive only: does not touch existing app logic (members/guides/redeem/status) */
/* Shows CHROME's native install dialog via beforeinstallprompt.prompt() */
/* Chrome no longer auto-shows banner; you must call prompt() after user gesture */

(() => {
  let deferredPrompt = null;
  let promptedThisSession = false;

  const STORAGE_DISMISSED = 'k1266-pwa-dismissed-at';
  const STORAGE_INSTALLED = 'k1266-pwa-installed';
  const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  function isInstalled() {
    try {
      return localStorage.getItem(STORAGE_INSTALLED) === '1' ||
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
    } catch { return false; }
  }

  function wasRecentlyDismissed() {
    try {
      const v = localStorage.getItem(STORAGE_DISMISSED);
      if (!v) return false;
      return Date.now() - parseInt(v, 10) < DISMISS_COOLDOWN_MS;
    } catch { return false; }
  }

  async function triggerChromePrompt() {
    if (!deferredPrompt || promptedThisSession || isInstalled() || wasRecentlyDismissed()) return;
    promptedThisSession = true;
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'dismissed') {
        try { localStorage.setItem(STORAGE_DISMISSED, Date.now().toString()); } catch {}
      }
      deferredPrompt = null;
    } catch (e) {
      // prompt() can fail if not called with user activation; we will retry on next gesture
      promptedThisSession = false;
    }
    cleanupGestureListeners();
  }

  function onFirstGesture() {
    // slight delay lets Chrome validate gesture, still counts as transient activation
    setTimeout(triggerChromePrompt, 150);
  }

  function setupGestureListeners() {
    const opts = { once: true, passive: true };
    window.addEventListener('click', onFirstGesture, opts);
    window.addEventListener('touchstart', onFirstGesture, opts);
    window.addEventListener('keydown', onFirstGesture, opts);
    // scroll is noisy, but useful for engagement heuristic
    window.addEventListener('scroll', onFirstGesture, opts);
  }

  function cleanupGestureListeners() {
    window.removeEventListener('click', onFirstGesture);
    window.removeEventListener('touchstart', onFirstGesture);
    window.removeEventListener('keydown', onFirstGesture);
    window.removeEventListener('scroll', onFirstGesture);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome's mini-infobar from showing automatically (deprecated anyway)
    // we take control and trigger Chrome's native dialog ourselves
    e.preventDefault();
    deferredPrompt = e;
    promptedThisSession = false;

    if (isInstalled() || wasRecentlyDismissed()) return;

    // Expose for manual testing / custom button: window.K1266PromptInstall()
    window.K1266PromptInstall = triggerChromePrompt;

    // Notify that PWA is installable (for custom UI if you ever add it)
    window.dispatchEvent(new CustomEvent('k1266-pwa-installable'));

    // Auto-trigger on first user gesture (required by Chrome for prompt())
    // This still shows *Chrome's* dialog, not a website toast
    setupGestureListeners();

    // Fallback: if user already interacted (e.g., navigated via click), try immediately
    // Will fail silently if no activation, then gesture listeners handle next interaction
    if (navigator.userActivation && navigator.userActivation.isActive) {
      onFirstGesture();
    }
  });

  window.addEventListener('appinstalled', () => {
    try {
      localStorage.setItem(STORAGE_INSTALLED, '1');
      localStorage.removeItem(STORAGE_DISMISSED);
    } catch {}
    deferredPrompt = null;
    cleanupGestureListeners();
    window.dispatchEvent(new CustomEvent('k1266-pwa-installed'));
  });

  // For debugging: window._k1266DeferredPrompt
  Object.defineProperty(window, '_k1266DeferredPrompt', {
    get: () => deferredPrompt
  });
})();
