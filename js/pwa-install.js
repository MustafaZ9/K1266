/* pwa-install.js — Simple cross-browser install prompt */
/* Additive only: shows *real* install UI for all browsers */
/* - Chrome/Android/Desktop: banner with "Install" → triggers Chrome native prompt via beforeinstallprompt.prompt() */
/* - iPhone/iPad Safari: banner with step-by-step Share → Add to Home Screen (no beforeinstallprompt on iOS) */
/* Does not touch app logic (members/guides/redeem/status) */

(() => {
  let deferredPrompt = null;
  let bannerShown = false;

  const STORAGE_DISMISSED = 'k1266-pwa-dismissed-at';
  const STORAGE_INSTALLED = 'k1266-pwa-installed';
  const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

  const isIOS = () => {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };
  const isStandalone = () => {
    try {
      return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    } catch { return false; }
  };
  const isInstalled = () => {
    try { return localStorage.getItem(STORAGE_INSTALLED) === '1' || isStandalone(); }
    catch { return isStandalone(); }
  };
  const wasRecentlyDismissed = () => {
    try {
      const v = localStorage.getItem(STORAGE_DISMISSED);
      return v && Date.now() - parseInt(v, 10) < DISMISS_COOLDOWN_MS;
    } catch { return false; }
  };
  const markDismissed = () => { try { localStorage.setItem(STORAGE_DISMISSED, Date.now().toString()); } catch {} };

  function injectStyles() {
    if (document.getElementById('pwa-install-styles')) return;
    const s = document.createElement('style');
    s.id = 'pwa-install-styles';
    s.textContent = `
#pwa-install-banner{position:fixed;left:50%;bottom:20px;transform:translateX(-50%) translateY(20px);width:min(520px,92vw);background:#12121a;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:14px;box-shadow:0 8px 30px rgba(0,0,0,0.6),0 0 20px rgba(16,185,129,0.12);z-index:850;opacity:0;pointer-events:none;transition:opacity 250ms ease,transform 250ms ease;backdrop-filter:blur(12px)}
#pwa-install-banner.show{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}
#pwa-install-banner img{width:44px;height:44px;border-radius:10px;flex-shrink:0;border:1px solid rgba(16,185,129,0.2)}
.pwa-install-text{flex:1;min-width:0}
.pwa-install-title{font-family:'Orbitron',monospace;font-size:0.95rem;font-weight:700;color:#e8e8ef;letter-spacing:0.5px;line-height:1.2}
.pwa-install-subtitle{font-family:'Roboto Mono',monospace;font-size:0.72rem;color:#94a3b8;margin-top:3px;line-height:1.4}
.pwa-install-subtitle b{color:#10b981;font-weight:600}
.pwa-install-steps{font-family:'Roboto Mono',monospace;font-size:0.7rem;color:#94a3b8;margin-top:6px;line-height:1.5}
.pwa-install-steps span{display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);padding:2px 7px;border-radius:9999px;margin:2px 4px 2px 0;font-size:0.68rem}
.pwa-install-actions{display:flex;flex-direction:column;gap:6px;flex-shrink:0}
#pwa-install-btn{padding:9px 16px;font-size:0.8rem;white-space:nowrap}
#pwa-dismiss-btn{padding:7px 12px;font-size:0.72rem;background:transparent;border:none;color:#5a6170;cursor:pointer;font-family:'Roboto Mono',monospace}
#pwa-dismiss-btn:hover{color:#94a3b8}
.pwa-install-close{position:absolute;top:6px;right:6px;width:26px;height:26px;border:none;background:rgba(255,255,255,0.06);color:#94a3b8;border-radius:6px;font-size:0.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1}
.pwa-install-close:hover{background:rgba(239,68,68,0.12);color:#ef4444}
@media(max-width:768px){#pwa-install-banner{bottom:88px;padding:12px 12px 12px 12px;gap:10px} #pwa-install-banner img{width:40px;height:40px} .pwa-install-title{font-size:0.85rem} .pwa-install-subtitle{font-size:0.68rem} #pwa-install-btn{padding:8px 14px;font-size:0.75rem} .pwa-install-close{width:24px;height:24px}}
@media(max-width:480px){#pwa-install-banner{flex-wrap:wrap} .pwa-install-actions{flex-direction:row;width:100%;justify-content:stretch} .pwa-install-actions button{flex:1}}
`;
    document.head.appendChild(s);
  }

  function createBanner(mode) {
    // mode: 'android' | 'ios'
    if (document.getElementById('pwa-install-banner')) return document.getElementById('pwa-install-banner');
    injectStyles();
    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Install K1266');

    const isAndroid = mode === 'android';
    banner.innerHTML = `
      <img src="icons/icon-192.png" alt="K1266 icon">
      <div class="pwa-install-text">
        <div class="pwa-install-title">${isAndroid ? 'Install K1266' : 'Install K1266 on iPhone'}</div>
        <div class="pwa-install-subtitle">${isAndroid ? 'One-tap access & <b>offline</b> — no more typing the link' : 'Add to Home Screen for full-screen & offline'}</div>
        ${isAndroid ? '' : '<div class="pwa-install-steps"><span>⎙ Share</span> → <span>Add to Home Screen</span> → <span>Add</span></div>'}
      </div>
      <div class="pwa-install-actions">
        <button id="pwa-install-btn" class="btn btn-primary">${isAndroid ? 'Install' : 'Got it'}</button>
        <button id="pwa-dismiss-btn">Not now</button>
      </div>
      <button class="pwa-install-close" aria-label="Close">✕</button>
    `;
    document.body.appendChild(banner);

    banner.querySelector('.pwa-install-close').addEventListener('click', hideBannerAndDismiss);
    banner.querySelector('#pwa-dismiss-btn').addEventListener('click', hideBannerAndDismiss);
    const installBtn = banner.querySelector('#pwa-install-btn');
    if (isAndroid) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) { hideBanner(); return; }
        try {
          deferredPrompt.prompt();
          const choice = await deferredPrompt.userChoice;
          if (choice.outcome === 'dismissed') markDismissed();
          else { try { localStorage.setItem(STORAGE_INSTALLED, '1'); } catch {} }
        } catch {}
        deferredPrompt = null;
        hideBanner();
      });
    } else {
      installBtn.addEventListener('click', hideBanner);
    }
    return banner;
  }

  function showBanner(mode) {
    if (bannerShown || isInstalled() || wasRecentlyDismissed()) return;
    const b = createBanner(mode);
    // delay to avoid layout shift on load
    requestAnimationFrame(() => setTimeout(() => b.classList.add('show'), 80));
    bannerShown = true;
  }
  function hideBanner() {
    const b = document.getElementById('pwa-install-banner');
    if (b) b.classList.remove('show');
    setTimeout(() => { if (b) b.remove(); bannerShown = false; }, 300);
  }
  function hideBannerAndDismiss() {
    markDismissed();
    hideBanner();
  }

  // Expose for manual trigger: window.K1266PromptInstall()
  window.K1266PromptInstall = async () => {
    if (deferredPrompt) {
      try { deferredPrompt.prompt(); await deferredPrompt.userChoice; } catch {}
      hideBanner();
    } else if (isIOS()) {
      showBanner('ios');
    }
  };

  // Chrome/Android/Desktop: capture native prompt, show our simple banner
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (isInstalled() || wasRecentlyDismissed()) return;
    // show banner shortly after capture (user has engaged enough for prompt to be capturable)
    setTimeout(() => showBanner('android'), 1200);
    window.dispatchEvent(new CustomEvent('k1266-pwa-installable'));
  });

  window.addEventListener('appinstalled', () => {
    try { localStorage.setItem(STORAGE_INSTALLED, '1'); localStorage.removeItem(STORAGE_DISMISSED); } catch {}
    deferredPrompt = null;
    hideBanner();
    window.dispatchEvent(new CustomEvent('k1266-pwa-installed'));
  });

  // iOS Safari: no beforeinstallprompt — show instructions if not standalone
  document.addEventListener('DOMContentLoaded', () => {
    // give SW time to register, then decide
    setTimeout(() => {
      if (isIOS() && !isInstalled() && !wasRecentlyDismissed() && !deferredPrompt) {
        // only show on iOS Safari, not Chrome on iOS (CriOS doesn't support standalone either)
        showBanner('ios');
      }
    }, 1800);
  });

  Object.defineProperty(window, '_k1266DeferredPrompt', { get: () => deferredPrompt });
})();
