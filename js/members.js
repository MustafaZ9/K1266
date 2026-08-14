/* ============================================
   MEMBERS.JS — Privacy-first member lookup
   No full list shown. Search your ID to check.
   ============================================ */

const SHEET_WEBHOOK = 'https://script.google.com/macros/s/AKfycbz2jtFeH-tPZgKKMkBh_yTOVIatsdcYETwcznsJdT7aJi3FQaBpThlGb5Qq2eODz0sy4Q/exec';
const SHEET_GID = '295962408';

let allMembers = [];
let membersLoaded = false;

async function loadMembers() {
    try {
        const url = `${SHEET_WEBHOOK}?gid=${SHEET_GID}&action=read`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'success' && Array.isArray(data.data)) {
            allMembers = data.data.map(row => ({
                id: String(row[0] || '').trim(),
                kingdom: String(row[1] || '1266').trim()
            })).filter(m => m.id && /^\d+$/.test(m.id));
        } else {
            allMembers = parseFallback(data);
        }

        if (allMembers.length === 0) await loadFromCSV();
        membersLoaded = true;
        updateStats();
    } catch (err) {
        console.error('Sheet load failed, using CSV fallback:', err);
        await loadFromCSV();
        membersLoaded = true;
        updateStats();
    }
}

function parseFallback(data) {
    if (Array.isArray(data)) {
        return data.map(item => {
            if (Array.isArray(item)) return { id: String(item[0]).trim(), kingdom: String(item[1] || '1266').trim() };
            if (typeof item === 'object') return { id: String(item.id || item.fid || '').trim(), kingdom: String(item.kingdom || item.kid || '1266').trim() };
            return { id: String(item).trim(), kingdom: '1266' };
        }).filter(m => m.id && /^\d+$/.test(m.id));
    }
    return [];
}

async function loadFromCSV() {
    try {
        const resp = await fetch('https://raw.githubusercontent.com/MustafaZ9/autokgc/main/lod.csv');
        const text = await resp.text();
        allMembers = text.split('\n')
            .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
            .map(l => { const p = l.split(','); return { id: p[0].trim(), kingdom: (p[1] || '1266').trim() }; })
            .filter(m => /^\d+$/.test(m.id));
    } catch (e) {
        allMembers = [];
    }
}

function updateStats() {
    // Deduplicate
    const unique = new Set(allMembers.map(m => m.id));
    document.getElementById('stat-total').textContent = unique.size;
}

// ---- Search (privacy: only shows if YOUR id is found) ----
document.getElementById('member-search').addEventListener('input', debounce(function () {
    const q = this.value.trim();
    const result = document.getElementById('search-result');

    if (!q) {
        result.innerHTML = '';
        return;
    }

    if (!membersLoaded) {
        result.innerHTML = '<div class="search-result"><div class="result-status" style="color:var(--text-muted)">Loading data...</div></div>';
        return;
    }

    const found = allMembers.find(m => m.id === q);

    if (found) {
        result.innerHTML = `
            <div class="search-result">
                <div class="result-id">${found.id}</div>
                <div class="result-status found">✓ Registered — K${found.kingdom}</div>
                <p style="font-size:var(--text-xs); color:var(--text-muted); margin-top:12px;">
                    Your ID is included in automatic gift code redemptions.
                </p>
            </div>
        `;
    } else {
        result.innerHTML = `
            <div class="search-result">
                <div class="result-id" style="color:var(--danger)">${q}</div>
                <div class="result-status not-found">✗ Not Found</div>
                <p style="font-size:var(--text-xs); color:var(--text-muted); margin-top:12px;">
                    Click "Add Player" below to register.
                </p>
            </div>
        `;
    }
}, 300));

// ---- Add member ----
async function submitNewMember() {
    const idInput = document.getElementById('new-player-id');
    const kidInput = document.getElementById('new-player-kid');
    const btn = document.getElementById('btn-submit');
    const alert = document.getElementById('add-alert');

    const playerId = idInput.value.trim();
    const kingdom = kidInput.value.trim() || '1266';

    if (!playerId || !/^\d{6,12}$/.test(playerId)) {
        alert.className = 'alert alert--error show';
        alert.textContent = 'Enter a valid Player ID (6-12 digits)';
        return;
    }

    if (allMembers.some(m => m.id === playerId)) {
        alert.className = 'alert alert--error show';
        alert.textContent = 'Player ID already registered';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
        await fetch(`${SHEET_WEBHOOK}?gid=${SHEET_GID}`, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ [playerId]: kingdom })
        });

        allMembers.push({ id: playerId, kingdom });
        updateStats();
        alert.className = 'alert alert--success show';
        alert.textContent = `Added ${playerId} to K${kingdom}`;
        idInput.value = '';

        setTimeout(() => closeAddModal(), 1500);
    } catch (err) {
        alert.className = 'alert alert--error show';
        alert.textContent = 'Failed to add. Try again.';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add';
    }
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', loadMembers);
