/* ============================================
   APP.JS — Navigation Controller
   ============================================ */

// ---- Navigation ----
const navTabs = document.querySelectorAll('.nav-tab');
const tabPages = document.querySelectorAll('.tab-page');

function switchTab(tabId) {
    navTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    tabPages.forEach(page => {
        page.classList.toggle('active', page.id === tabId + '-page');
    });
    history.replaceState(null, '', '#' + tabId);
    window.dispatchEvent(new CustomEvent('tabchange', { detail: { tab: tabId } }));
}

navTabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

function initNav() {
    const hash = location.hash.replace('#', '');
    const validTabs = Array.from(navTabs).map(t => t.dataset.tab);
    const startTab = validTabs.includes(hash) ? hash : 'members';
    switchTab(startTab);
}

window.addEventListener('hashchange', () => {
    const hash = location.hash.replace('#', '');
    const validTabs = Array.from(navTabs).map(t => t.dataset.tab);
    if (validTabs.includes(hash)) switchTab(hash);
});

document.addEventListener('DOMContentLoaded', initNav);

// ---- Debounce ----
function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ---- Modal ----
function openAddModal() {
    document.getElementById('add-modal').classList.add('open');
    document.getElementById('new-player-id').value = '';
    document.getElementById('new-player-id').focus();
    const alert = document.getElementById('add-alert');
    alert.classList.remove('show');
}

function closeAddModal() {
    document.getElementById('add-modal').classList.remove('open');
}

document.getElementById('add-modal').addEventListener('click', function (e) {
    if (e.target === this) closeAddModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAddModal();
        if (typeof closeCodeModal === 'function') closeCodeModal();
    }
});

// Click-to-close for code modal backdrop
document.getElementById('code-modal')?.addEventListener('click', function (e) {
    if (e.target === this && typeof closeCodeModal === 'function') closeCodeModal();
});
