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
   a missing picture can be selected on its slide from the list.
   Nothing here changes the deck.
   ============================================================ */

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
        this.badge.addEventListener('click', () => this.toggle());
        document.addEventListener('pointerdown', (e) => { if (this.panel && !e.target.closest('.problems, #problemsBadge')) this.close(); }, true);
    }

    _onReady() {
        this.items = [];
        this.close();
        const doc = this.deck.doc, win = this.deck.win;
        // Resources that failed before we could listen: images know; stylesheets have no sheet.
        for (const img of doc.querySelectorAll('img[src]')) {
            if (img.complete && img.naturalWidth === 0 && !img.src.startsWith('data:')) this.add({ kind: 'missing', what: 'picture', url: img.getAttribute('src'), el: img });
        }
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

    add(item) {
        const key = item.kind + '|' + (item.url || item.message) + '|' + (item.where || '');
        if (this.items.some(i => i.key === key)) return;
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
        if (!this.items.length) return;
        const p = document.createElement('div');
        p.className = 'problems';
        p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'false'); p.setAttribute('aria-label', 'Problems in this deck');
        document.body.appendChild(p);
        this.panel = p;
        this._fill();
        p.addEventListener('click', (e) => {
            const b = e.target.closest('[data-select]'); if (!b) return;
            const item = this.items[+b.dataset.select];
            if (item && item.el && this.deck.doc.contains(item.el)) this._reveal(item.el);
        });
    }
    _fill() {
        const rows = this.items.map((it, i) => {
            if (it.kind === 'missing') {
                const slide = it.el ? it.el.closest('.slide') : null;
                const where = slide ? ` on slide ${this.deck.slides.indexOf(slide) + 1}` : '';
                return `<div class="problem"><b>Missing ${esc(it.what)}</b>${where}: <code>${esc(it.url)}</code>${it.el ? ` <button class="mini-btn" data-select="${i}">Show</button>` : ''}</div>`;
            }
            if (it.kind === 'drawn') {
                const slide = it.el ? it.el.closest('.slide') : null;
                const where = slide ? ` on slide ${this.deck.slides.indexOf(slide) + 1}` : '';
                return `<div class="problem"><b>${it.what === 'equation' ? 'Equation' : 'Structure'} not drawn</b>${where}: ${esc(it.message)} <code>${esc(it.url)}</code>${it.el ? ` <button class="mini-btn" data-select="${i}">Show</button>` : ''}</div>`;
            }
            return `<div class="problem"><b>Deck script error</b>${it.where ? ` (${esc(it.where)})` : ''}: ${esc(it.message)}</div>`;
        });
        this.panel.innerHTML = `<div class="problems-head"><b>Problems in this deck</b><span class="insp-hint">Files are looked up next to the deck. Nothing is changed by this list.</span></div>` + rows.join('');
    }
    _reveal(el) {
        const slide = el.closest('.slide');
        const i = this.deck.slides.indexOf(slide);
        if (i >= 0 && i !== this.deck.current) this.deck.goTo(i);
        setTimeout(() => { const pick = this.app.selection.pick(el) || el; this.app.selection.select(pick); }, i !== this.deck.current ? 400 : 0);
        this.close();
    }
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
