/* ============================================================
   printguide.js - PDF without Chrome or Edge on the computer.

   Diapo makes the PDF itself with a headless Chrome or Edge. Without one it opens the
   browser's own print dialog on the printable copy, and the dialog's defaults would spoil the
   pages (margins, no backgrounds). This says, before the dialog opens, exactly which options
   to pick in the browser being used. Each browser names them differently.
   ============================================================ */

/* The browser behind a user-agent string: edge, chrome, firefox, safari or other. */
export function browserOf(ua = navigator.userAgent) {
    if (/\bEdg(e|A|iOS)?\//.test(ua)) return 'edge';
    if (/\b(Firefox|FxiOS)\//.test(ua)) return 'firefox';
    if (/\bOPR\/|\bOpera\b/.test(ua)) return 'other';
    if (/(Chrome|Chromium|CriOS)\//.test(ua)) return 'chrome';             // also HeadlessChrome
    if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return 'safari';
    return 'other';
}

/* { browser, name, steps }: the options to choose in that browser's print dialog. */
export function printGuide(ua = navigator.userAgent) {
    const browser = browserOf(ua);
    switch (browser) {
        case 'firefox':
            return { browser, name: 'Firefox', steps: ['Destination: "Save to PDF"', 'Margins: "None"', 'Print backgrounds: on (under More settings)'] };
        case 'chrome':
            return { browser, name: 'Chrome', steps: ['Destination: "Save as PDF"', 'Margins: "None" (under More settings)', 'Background graphics: on (under More settings)'] };
        case 'edge':
            return { browser, name: 'Edge', steps: ['Printer: "Save as PDF"', 'Margins: "None" (under More settings)', 'Background graphics: on (under More settings)'] };
        case 'safari':
            return { browser, name: 'Safari', steps: ['Click "Show Details" and tick "Print backgrounds"', 'Open the PDF menu at the bottom left and choose "Save as PDF"'] };
        default:
            return { browser, name: 'your browser', steps: ['Destination: save as PDF', 'Margins: none', 'Backgrounds (background graphics): on'] };
    }
}

const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Shows the options before the dialog; resolves true to go on, false when cancelled. */
export function askPrint(guide = printGuide()) {
    return new Promise((resolve) => {
        const h = document.createElement('div');
        h.className = 'print-guide';      // not .help: the editor's Esc would close that one without answering
        h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', 'Save as PDF');
        h.dataset.browser = guide.browser;
        h.innerHTML = `<div class="help-card"><h2>Save as PDF in ${esc(guide.name)}</h2>
            <p>Diapo did not find Chrome or Edge to make the PDF itself, so it opens the print dialog of ${esc(guide.name)}. In it, choose:</p>
            <ul class="print-steps">${guide.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
            <div class="row"><span class="spacer"></span><button class="tb-btn" data-a="no">Cancel</button><button class="tb-btn primary" data-a="go">Open the print dialog</button></div></div>`;
        const done = (v) => { document.removeEventListener('keydown', onKey, true); h.remove(); resolve(v); };
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(false); } };
        h.addEventListener('click', (e) => {
            const a = e.target.closest('[data-a]');
            if (a) done(a.dataset.a === 'go'); else if (e.target === h) done(false);
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(h);
        h.querySelector('[data-a="go"]').focus();
    });
}
