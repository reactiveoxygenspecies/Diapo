/* ============================================================
   palette.js - the command palette (Ctrl+K): one search over the
   editor's actions, the slides by name, the built-in icons, and the
   way into the icon and font pickers with the words typed.

   Entries are gathered when the palette opens, so what is offered
   fits the moment (a selection or none, a text or a picture). Each
   entry is { label, hint, run, group }; the search keeps the entries
   every word of the query is found in, ranked by where the first
   word lands, up to twelve.
   ============================================================ */
import { ICONS } from './insert.js';

const MAX = 12;

export class Palette {
    constructor(app, { entries }) {
        this.app = app;
        this.entries = entries;          // () => [{ label, hint, run, group }]
        this.el = null;
        this.items = [];
        this.index = 0;
    }
    get open() { return !!this.el; }

    toggle() { if (this.el) this.close(); else this.show(); }

    show() {
        if (this.el) return;
        const el = document.createElement('div');
        el.className = 'palette';
        el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Command palette');
        el.innerHTML = `<div class="palette-card">
            <input type="text" class="palette-input" placeholder="Type what to do, a slide's name, an icon, a font…" spellcheck="false" autocomplete="off">
            <div class="palette-list" role="listbox"></div>
            <div class="palette-foot"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close</div>
        </div>`;
        el.addEventListener('pointerdown', (e) => { if (e.target === el) this.close(); });
        document.body.appendChild(el);
        this.el = el;
        this.input = el.querySelector('.palette-input');
        this.list = el.querySelector('.palette-list');
        this.all = this.entries();
        this.input.addEventListener('input', () => this.render());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); this.run(this.items[this.index]); }
            else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
            e.stopPropagation();
        });
        this.list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) this.run(this.items[+b.dataset.i]); });
        this.list.addEventListener('pointermove', (e) => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== this.index) { this.index = +b.dataset.i; this.mark(); } });
        this.render();
        this.input.focus();
    }
    close() {
        if (!this.el) return;
        this.el.remove();
        this.el = null;
    }

    /* The entries the query keeps, in order: every word of the query in the label (or its
       group), the ones matching earliest first; with nothing typed, the first of each group. */
    filter(q) {
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return this.all.filter(e => !e.quiet).slice(0, MAX);
        const scored = [];
        for (const e of this.all) {
            const hay = (e.label + ' ' + (e.group || '') + ' ' + (e.keywords || '')).toLowerCase();
            let score = 0, ok = true;
            for (const w of words) { const i = hay.indexOf(w); if (i < 0) { ok = false; break; } score += i + (e.label.toLowerCase().startsWith(w) ? -20 : 0); }
            // The long lists (icons, layouts, templates) give way to the actions and slides they share words with.
            if (ok) scored.push({ e, score: score + (e.group === 'Slides' ? 5 : 0) + (e.quiet ? 15 : 0) });
        }
        scored.sort((a, b) => a.score - b.score);
        return scored.slice(0, MAX).map(s => s.e);
    }
    render() {
        const q = this.input.value.trim();
        this.items = this.filter(q);
        this.index = 0;
        this.list.innerHTML = this.items.length
            ? this.items.map((e, i) => `<div class="palette-item" data-i="${i}" role="option"><span class="palette-group">${escapeHtml(e.group || '')}</span><span class="palette-label">${escapeHtml(e.label)}</span>${e.hint ? `<span class="palette-hint">${escapeHtml(e.hint)}</span>` : ''}</div>`).join('')
            : `<div class="palette-empty">Nothing for "${escapeHtml(q)}"</div>`;
        this.mark();
    }
    mark() {
        this.list.querySelectorAll('.palette-item').forEach((n, i) => n.classList.toggle('on', i === this.index));
        const on = this.list.querySelector('.palette-item.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    move(d) {
        if (!this.items.length) return;
        this.index = (this.index + d + this.items.length) % this.items.length;
        this.mark();
    }
    run(entry) {
        if (!entry) return;
        const q = this.input.value.trim();
        this.close();
        try { entry.run(q); } catch (err) { this.app.toast('Could not do that: ' + err.message, { error: true }); }
    }
}

/* The built-in icons as entries. */
export function iconEntries(app) {
    return Object.keys(ICONS).map(name => ({ group: 'Icon', label: name.replace(/-/g, ' '), keywords: name, run: () => app.insert.icon(name), quiet: true }));
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
