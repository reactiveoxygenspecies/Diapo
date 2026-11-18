/* ============================================================
   a11y.js - gives every control in the side panel an accessible name.

   The panels are built from HTML strings where a visible label sits
   next to its field, not around it. Rather than thread an id through
   every row, this finds the label that belongs to a nameless field
   (the row's label, the field's own label, the colour's name, the
   hint text) and names the field after it. A name set in the markup
   is never replaced.
   ============================================================ */
const FIELDS = 'input:not([type=hidden]):not([type=file]), select, textarea, button, [role=button], [role=option]';

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

function hasName(el) {
    if (clean(el.getAttribute('aria-label')) || el.getAttribute('aria-labelledby')) return true;
    if (el.labels && el.labels.length && clean([...el.labels].map(l => l.textContent).join(' '))) return true;
    if (/^(BUTTON)$/.test(el.tagName) && clean(el.textContent)) return true;
    return false;
}

function guess(el) {
    // The label right before it in the same group (the "W" before the width field).
    for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
        if (p.tagName === 'LABEL' && clean(p.textContent)) return clean(p.textContent);
    }
    // The label of the row or slider group it sits in.
    const group = el.closest('.insp-field, .theme-slider, .insp-row, .theme-field, .theme-row, .theme-var');
    for (let g = group; g; g = g.parentElement && g.parentElement.closest('.insp-row, .theme-field, .theme-var, .theme-slider')) {
        const l = g.querySelector(':scope > label, :scope > .theme-field-label, :scope > .theme-var-name, :scope > .tv-name');
        if (l && clean(l.textContent)) return clean(l.textContent);
    }
    // A colour pair: "Accent" for both its picker and its hex field.
    const row = el.closest('.theme-var');
    if (row) { const n = row.querySelector('.theme-var-label, .tv-label, b, label, span'); if (n && clean(n.textContent)) return clean(n.textContent); }
    const title = clean(el.getAttribute('title')); if (title) return title;
    const ph = clean(el.getAttribute('placeholder')); if (ph) return ph;
    // The nearest heading of its section.
    const sec = el.closest('section, .insp-section');
    const h = sec && sec.querySelector('h4'); if (h) return clean(h.firstChild ? h.firstChild.textContent : h.textContent);
    return '';
}

export function nameControls(root) {
    for (const el of root.querySelectorAll(FIELDS)) {
        if (hasName(el)) continue;
        if (clean(el.getAttribute('title')) && /^(BUTTON|I)$/.test(el.tagName)) { el.setAttribute('aria-label', clean(el.getAttribute('title'))); continue; }
        const g = guess(el);
        if (g) el.setAttribute('aria-label', g + (el.type === 'color' ? ' (colour picker)' : el.type === 'text' && el.closest('.theme-colour, .insp-colour') ? ' (colour code)' : ''));
    }
}

/* Keep a panel named as it is rebuilt. */
export function keepNamed(root) {
    if (!root) return;
    let queued = false;
    const run = () => { queued = false; nameControls(root); };
    new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(run); } }).observe(root, { childList: true, subtree: true });
    nameControls(root);
}
