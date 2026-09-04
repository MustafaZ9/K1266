/* ============================================
   STATUS.JS — Fetch last redemption summary
   from autokgc redeemed_codes.txt
   ============================================ */
(() => {
    const LOG_URL = 'https://raw.githubusercontent.com/MustafaZ9/autokgc/main/redeemed_codes.txt';

    async function loadLastRedeem() {
        try {
            const resp = await fetch(LOG_URL);
            const text = await resp.text();
            const summary = parseLastSummary(text);
            if (summary) render(summary);
        } catch (e) {
            // silently fail — this is optional info
        }
    }

    function parseLastSummary(text) {
        const lines = text.split('\n');
        // Find the last "Redemption Summary" block
        let lastSummaryStart = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].includes('Redemption Summary')) {
                lastSummaryStart = i;
                break;
            }
        }
        if (lastSummaryStart === -1) return null;

        const extract = (key) => {
            for (let i = lastSummaryStart; i < Math.min(lastSummaryStart + 15, lines.length); i++) {
                if (lines[i].includes(key)) {
                    const match = lines[i].split(key)[1];
                    return match ? match.trim() : null;
                }
            }
            return null;
        };

        const code = extract('Code Redeemed:');
        const success = extract('Successfully redeemed:');
        const total = extract('Total Player IDs Processed:');
        const errors = extract('Other Errors/Failures:');
        const time = extract('Total execution time:');

        // Get the date from the timestamp at the start of the summary line
        let date = null;
        const dateMatch = lines[lastSummaryStart + 1]?.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
        if (dateMatch) date = dateMatch[1];

        if (!code) return null;
        return { code, success, total, errors, time, date };
    }

    function render(s) {
        const el = document.getElementById('last-redeem');
        if (!el) return;

        const parts = [];
        if (s.success && s.total) parts.push(s.success + '/' + s.total + ' redeemed');
        if (s.errors && s.errors !== '0') parts.push(s.errors + ' failed');
        if (s.time) parts.push(s.time);
        if (s.date) parts.push(s.date + ' UTC');

        el.innerHTML =
            '<div class="redeem-code">' + s.code + '</div>' +
            '<div class="redeem-stats">' +
            parts.join('<span class="sep">·</span>') +
            '</div>';
    }

    document.addEventListener('DOMContentLoaded', loadLastRedeem);
})();
