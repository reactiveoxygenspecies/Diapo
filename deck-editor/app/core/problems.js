/* ============================================================
   problems.js - what is wrong with the open deck, in one place.

   Collected while the deck is open:
   - pictures, videos, scripts and stylesheets that did not load
     (a missing file, a wrong path), found by scanning after load
     and by listening for later load errors;
   - errors thrown by the deck's own scripts, and rejected promises,
     after the deck has loaded (a chart that fails to render, say);
   - equations and structures whose LaTeX or SMILES does not draw
     (editor.js adds them once the deck opens).

   The status bar shows a count; clicking it lists the problems, and
   a missing picture can be selected on its slide from the list, or
   removed (one undo step). The list follows the document: deleting
   an element clears its entry, and undoing the delete restores it.
   Nothing changes the deck except that Remove button.
   ============================================================ */

import { isMaster } from './dom.js';

export class Problems extends EventTarget {
    constructor(app, { badge }) {
        super();
        this.app = app;
        this.deck = app.deck;
        this.badge = badge;
        this.items = [];
        this.panel = null;
        this._bind();
    }

    _bind() {
        this.deck.addEventListener('ready', () => this._onReady());
        // The list follows the document: a deleted element stops being a problem, and an undo
        // that brings a broken picture back makes it one again. A step is cheap to check but
        // typing or dragging fires many, so wait for a pause.
        this.app.history.addEventListener('change', () => {
            clearTimeout(this._syncTimer);
            this._syncTimer = setTimeout(() => this.sync(), 150);
        });
        this.badge.addEventListener('click', () => this.toggle());
        document.addEventListener('pointerdown', (e) => { if (this.panel && !e.target.closest('.problems, #problemsBadge')) this.close(); }, true);
    }

    _onReady() {
        this.items = [];
        this.close();
        const doc = this.deck.doc, win = this.deck.win;
        // Resources that failed before we could listen: images know; stylesheets have no sheet.
        this._scanImages(true);
        for (const link of doc.querySelectorAll('link[rel=stylesheet][href]')) {
            if (!link.sheet && !/fonts\.googleapis/.test(link.href)) this.add({ kind: 'missing', what: 'stylesheet', url: link.getAttribute('href') });
        }
        // Later failures (a script inserting an image, a video), and the deck's own errors.
        doc.addEventListener('error', (e) => {
            const t = e.target;
            if (!t || !t.tagName) return;
            const tag = t.tagName.toLowerCase();
            if (!['img', 'script', 'link', 'video', 'audio', 'source', 'iframe'].includes(tag)) return;
            const url = t.getAttribute('src') || t.getAttribute('href') || '';
            if (url.startsWith('data:')) return;
            this.add({ kind: 'missing', what: tag === 'img' ? 'picture' : tag === 'link' ? 'stylesheet' : tag, url, el: tag === 'img' || tag === 'video' ? t : null });
        }, true);
        win.addEventListener('error', (e) => {
            if (e.target && e.target !== win && e.target.tagName) return;      // a resource error, handled above
            this.add({ kind: 'script', message: e.message || 'error', where: e.filename ? e.filename.split('/').pop() + (e.lineno ? ':' + e.lineno : '') : '' });
        });
        win.addEventListener('unhandledrejection', (e) => {
            const r = e.reason;
            this.add({ kind: 'script', message: (r && r.message) || String(r) || 'rejected promise', where: '' });
        });
        this.render();
    }

    _scanImages(quiet) {
        if (!this.deck.isOpen) return;
        for (const img of this.deck.doc.querySelectorAll('img[src]')) {
            if (img.complete && img.naturalWidth === 0 && !img.src.startsWith('data:')) this.add({ kind: 'missing', what: 'picture', url: img.getAttribute('src'), el: img }, quiet);
        }
    }

    /* Bring the list back in line with the document: drop what points at an element that is no
       longer in it (deleted, or on a removed slide), then pick up broken pictures that came
       back (an undo restores the same node, which fires no new error). */
    sync() {
        clearTimeout(this._syncTimer);
        if (!this.deck.isOpen) return;
        const doc = this.deck.doc;
        const before = this.items.length;
        this.items = this.items.filter(it => !it.el || doc.contains(it.el));
        this._scanImages(true);
        if (this.items.length !== before || this.panel) this.render();
        if (this.panel && !this.items.length) this.close();
    }

    add(item, quiet = false) {
        const key = item.kind + '|' + (item.url || item.message) + '|' + (item.where || '');
        const old = this.items.find(i => i.key === key);
        if (old) {
            // The same file now fails somewhere else: follow the element that is still here.
            if (item.el && (!old.el || !this.deck.doc.contains(old.el))) { old.el = item.el; if (!quiet) this.render(); }
            return;
        }
        item.key = key;
        this.items.push(item);
        this.render();
    }

    render() {
        const n = this.items.length;
        this.badge.hidden = n === 0;
        this.badge.textContent = n === 1 ? '1 problem' : `${n} problems`;
        if (this.panel) this._fill();
    }

    toggle() { if (this.panel) this.close(); else this.open(); }
    close() { if (this.panel) { this.panel.remove(); this.panel = null; } }
    open() {
        this.sync();
        if (!this.items.length) return;
        const p = document.createElement('div');
        p.className = 'problems';
        p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'false'); p.setAttribute('aria-label', 'Problems in this deck');
        document.body.appendChild(p);
        this.panel = p;
        this._fill();
        p.addEventListener('click', (e) => {
            const b = e.target.closest('[data-select],[data-remove]'); if (!b) return;
            if (b.dataset.remove != null) { this._remove(this.items[+b.dataset.remove]); return; }
            const item = this.items[+b.dataset.select];
            if (item && this._showable(item.el)) this._reveal(item.el);
        });
    }

    /* Where an element lives: its slide, the master layer, or nowhere we can select it. */
    _place(el) {
        if (!el || !this.deck.doc.contains(el)) return null;
        const slide = el.closest('.slide');
        if (slide) { const n = this.deck.slides.indexOf(slide); return n >= 0 ? { slide: n } : null; }
        return isMaster(el) ? { master: true } : null;
    }
    _showable(el) { return !!this._place(el); }
    _whereText(el) {
        const p = this._place(el);
        return p ? (p.master ? ' on every slide' : ` on slide ${p.slide + 1}`) : '';
    }

    _fill() {
        const rows = this.items.map((it, i) => {
            const show = this._showable(it.el) ? ` <button class="mini-btn" data-select="${i}">Show</button>` : '';
            if (it.kind === 'missing') {
                const remove = it.what === 'picture' && this._showable(it.el) ? ` <button class="mini-btn" data-remove="${i}" title="Delete this picture from the slide (Undo brings it back)">Remove</button>` : '';
                return `<div class="problem"><b>Missing ${esc(it.what)}</b>${this._whereText(it.el)}: <code>${esc(it.url)}</code>${show}${remove}</div>`;
            }
            if (it.kind === 'drawn') {
                return `<div class="problem"><b>${it.what === 'equation' ? 'Equation' : 'Structure'} not drawn</b>${this._whereText(it.el)}: ${esc(it.message)} <code>${esc(it.url)}</code>${show}</div>`;
            }
            return `<div class="problem"><b>Deck script error</b>${it.where ? ` (${esc(it.where)})` : ''}: ${esc(it.message)}</div>`;
        });
        this.panel.innerHTML = `<div class="problems-head"><b>Problems in this deck</b><span class="insp-hint">Files are looked up next to the deck. Nothing is changed unless you press Remove (one undo step).</span></div>` + rows.join('');
    }
    _reveal(el) {
        const place = this._place(el);
        if (!place) return;
        const i = place.master ? this.deck.current : place.slide;
        const move = i !== this.deck.current;
        if (move) this.deck.goTo(i);
        // The slide has to be the active one before the element can be picked on it.
        setTimeout(() => {
            if (!this.deck.doc.contains(el)) return;
            const pick = this.app.selection.pick(el) || this.app.selection.pick(el.parentElement) || el;
            this.app.selection.select(pick);
        }, move ? 400 : 0);
        this.close();
    }

    /* Remove a broken picture (the box too, when it sits in a crop frame): one undo step. */
    _remove(item) {
        if (!item || !this._showable(item.el)) return;
        const el = item.el;
        const node = el.parentElement && el.parentElement.hasAttribute('data-crop') ? el.parentElement : el;
        this.app.selection.set([]);
        this.app.history.remove(node, 'Remove missing picture');
        this.sync();
    }
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
