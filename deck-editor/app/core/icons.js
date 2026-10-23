/* ============================================================
   icons.js - the Font Awesome icon picker.

   The catalog (app/icons/fontawesome.json, built by tools/build-fa.js
   from the Font Awesome Free package) is fetched the first time the
   picker opens: about 2000 icons in the free solid, regular and brands
   styles, each as a viewBox width and a path. An icon goes into the deck
   as an inline <svg> with a currentColor path, so it needs no font, no
   network and no script, prints, scales like a shape, and recolours
   through the Text colour of the properties panel (the svg's color).
   ============================================================ */
import { loader } from './loader.js';

const STYLES = [['s', 'Solid'], ['r', 'Regular'], ['b', 'Brands']];
const LIMIT = 240;

export class IconPicker {
    constructor(app) {
        this.app = app;
        this.catalog = null;
        this.style = 's';
        this.el = document.createElement('div');
        this.el.className = 'iconpick';
        this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-modal', 'true'); this.el.setAttribute('aria-label', 'Font Awesome icons');
        this.el.hidden = true;
        this.el.innerHTML = `
          <div class="iconpick-head">
            <input class="iconpick-search" type="text" placeholder="Search icons (name or keyword)" spellcheck="false">
            <div class="iconpick-tabs">${STYLES.map(([v, l]) => `<button type="button" data-style="${v}"${v === 's' ? ' class="on"' : ''}>${l}</button>`).join('')}</div>
          </div>
          <div class="iconpick-grid"></div>
          <div class="iconpick-foot"></div>`;
        document.body.appendChild(this.el);
        this.search = this.el.querySelector('.iconpick-search');
        this.grid = this.el.querySelector('.iconpick-grid');
        this.foot = this.el.querySelector('.iconpick-foot');
        this.search.addEventListener('input', () => this._render());
        this.search.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); this.close(); }
            if (e.key === 'Enter') { e.preventDefault(); const b = this.grid.querySelector('button'); if (b) b.click(); }
        });
        this.el.querySelector('.iconpick-tabs').addEventListener('click', (e) => {
            const b = e.target.closest('[data-style]'); if (!b) return;
            this.style = b.dataset.style;
            this.el.querySelectorAll('[data-style]').forEach(x => x.classList.toggle('on', x === b));
            this._render();
        });
        this.grid.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-i]'); if (!b) return;
            const icon = this.catalog.icons[+b.dataset.i];
            const style = b.dataset.s;
            this.close();
            this.app.insert.faIcon({ name: icon.n, style, width: icon.s[style][0], path: icon.s[style][1], attribution: this.catalog.attribution });
        });
        this.grid.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); this.close(); } });
        document.addEventListener('pointerdown', (e) => { if (!this.el.hidden && !this.el.contains(e.target) && e.target !== this.anchor) this.close(); }, true);
        window.addEventListener('resize', () => this.close());
    }
    get isOpen() { return !this.el.hidden; }

    async open(anchor) {
        this.anchor = anchor;
        this.el.hidden = false;
        const r = anchor.getBoundingClientRect();
        const w = 420, h = Math.min(520, window.innerHeight - 24);
        const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
        Object.assign(this.el.style, { left: left + 'px', top: Math.min(r.bottom + 6, window.innerHeight - h - 8) + 'px', width: w + 'px', maxHeight: h + 'px' });
        this.search.value = '';
        this.search.focus();
        if (!this.catalog) {
            this.grid.innerHTML = `<div class="iconpick-empty">${loader()}Loading the icons...</div>`;
            try { this.catalog = await fetch('/icons/fontawesome.json', { cache: 'force-cache' }).then(r => { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.json(); }); }
            catch (err) { this.grid.innerHTML = `<div class="iconpick-empty">The icon catalog did not load (${err.message}). Run <code>node tools/build-fa.js</code> in deck-editor.</div>`; return; }
        }
        this._render();
    }
    close() { if (this.el.hidden) return; this.el.hidden = true; this.anchor = null; }

    _render() {
        if (!this.catalog) return;
        const q = this.search.value.trim().toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        const style = this.style;
        // Matches ranked: the name itself, then a name that starts with the query, then label, then keywords.
        const hits = [];
        this.catalog.icons.forEach((icon, i) => {
            const s = icon.s[style]; if (!s) return;
            let rank = 0;
            if (words.length) {
                const label = icon.l.toLowerCase();
                if (!words.every(w => icon.n.includes(w) || label.includes(w) || icon.t.includes(w))) return;
                rank = icon.n === q ? 0 : icon.n.startsWith(q) ? 1 : icon.n.includes(q) ? 2 : label.includes(q) ? 3 : 4;
            }
            hits.push({ i, s, rank, icon });
        });
        hits.sort((x, y) => x.rank - y.rank || x.icon.n.localeCompare(y.icon.n));
        const total = hits.length, shown = Math.min(total, LIMIT);
        const parts = hits.slice(0, shown).map(({ i, s, icon }) => `<button type="button" data-i="${i}" data-s="${style}" title="${esc(icon.l)} (${esc(icon.n)})"><svg viewBox="0 0 ${s[0]} 512"><path fill="currentColor" d="${s[1]}"/></svg></button>`);
        this.grid.innerHTML = parts.join('') || '<div class="iconpick-empty">No icon matches</div>';
        this.foot.textContent = (total > shown ? `${shown} of ${total} shown, type more to narrow down. ` : `${total} ${total === 1 ? 'icon' : 'icons'}. `) + this.catalog.source + ', icons CC BY 4.0.';
    }
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
