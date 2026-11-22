/* ============================================
   GUIDES.JS — Loads real data from guides.json
   Simple accordion card style
   ============================================ */

let guidesData = [];

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function linkify(text) {
    return text.replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );
}

function formatContent(text) {
    return linkify(escapeHtml(text)).replace(/\n/g, '<br>');
}

async function loadGuides() {
    try {
        const resp = await fetch('data/guides.json?v=20261122-1');
        guidesData = await resp.json();
    } catch (e) {
        console.error('Failed to load guides:', e);
        guidesData = [];
    }
    renderGuides();
}

function renderGuides() {
    const grid = document.getElementById('guides-grid');
    if (!grid || guidesData.length === 0) return;

    grid.innerHTML = guidesData.map((g, i) => {
        const summary = g.content.length > 100
            ? escapeHtml(g.content.substring(0, 100)) + '...'
            : escapeHtml(g.content);

        return '<div class="guide-card" onclick="toggleGuide(' + i + ')" id="guide-' + i + '">' +
            '<h3>' + escapeHtml(g.title) + '</h3>' +
            '<p>' + summary + '</p>' +
            '<span class="guide-tag ' + g.category + '">' + g.category + '</span>' +
            '<div class="guide-content" id="guide-content-' + i + '" style="display:none;">' +
            formatContent(g.content) +
            '</div></div>';
    }).join('');
}

function toggleGuide(index) {
    const content = document.getElementById('guide-content-' + index);
    const isOpen = content.style.display !== 'none';
    document.querySelectorAll('.guide-content').forEach(el => el.style.display = 'none');
    if (!isOpen) {
        content.style.display = 'block';
        content.style.animation = 'fadeInSection 0.3s ease-out';
    }
}

let guidesLoaded = false;

window.addEventListener('tabchange', (e) => {
    if (e.detail.tab === 'guides' && !guidesLoaded) {
        guidesLoaded = true;
        loadGuides();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    if (location.hash === '#guides') {
        guidesLoaded = true;
        loadGuides();
    }
});
