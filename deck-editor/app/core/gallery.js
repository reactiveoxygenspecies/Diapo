/* ============================================================
   gallery.js - New deck: the designs in a large dialog.

   Every template of app/templates/templates.json as a big card
   (its cover, previews/<slug>.jpg), filtered by background (Light,
   Dark) and by style (the "style" of each entry). The chosen one
   is shown larger beside the grid with a few of its other slides,
   drawn from the template itself like the drawer's previews
   (core/previews.js), so nothing has to be kept in step with the
   templates. Blank is always first and never filtered away: it is
   where a deck starts when no design fits.

   Keys: arrows move through the cards (up and down by a row),
   Home and End to the ends, Enter goes to the name (or creates the
   deck when it has one); Enter in the name creates; Esc closes
   (editor.js's Escape chain calls close()).
   ============================================================ */
import { DeckPreviews } from './previews.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MORE_SLIDES = 4;            // the chosen design's slides after the cover, in the side panel

export class TemplateGallery {
    /* host: { templates() -> Promise<list>, folder() -> the folder's name and path, create(name, slug) -> Promise<bool> } */
    constructor(root, host) {
        this.root = root;
        this.host = host;
        this.list = [];
        this.slug = 'blank';
        this.tone = '';
        this.style = '';
        this.grid = root.querySelector('#galleryGrid');
        this.detail = root.querySelector('#galleryDetail');
        this.name = root.querySelector('#galleryName');
        this.previews = new DeckPreviews(this.detail);
        root.querySelector('#btnGalleryClose').addEventListener('click', () => this.close());
        root.querySelector('#btnGalleryCancel').addEventListener('click', () => this.close());
        root.querySelector('#btnGalleryCreate').addEventListener('click', () => this.create());
        root.querySelector('.gallery-backdrop').addEventListener('click', () => this.close());
        root.querySelector('.gallery-filters').addEventListener('click', (e) => {
            const b = e.target.closest('button[data-tone], button[data-style]'); if (!b) return;
            const attr = b.dataset.tone !== undefined ? 'tone' : 'style';
            this[attr] = b.dataset[attr];
            this.render();
            // The buttons were drawn again: the focus stays on the one pressed.
            this.root.querySelector(`.gallery-filters [data-${attr}="${CSS.escape(this[attr])}"]`)?.focus();
        });
        this.grid.addEventListener('click', (e) => {
            const card = e.target.closest('.gallery-item'); if (!card) return;
            this.select(card.dataset.slug, { focus: true });
        });
        this.grid.addEventListener('dblclick', (e) => { if (e.target.closest('.gallery-item')) this.name.focus(); });
        this.grid.addEventListener('keydown', (e) => this._gridKey(e));
        this.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.create(); } });
    }

    get isOpen() { return !this.root.hidden; }

    /* Open with `slug` chosen (else the last choice, Blank at first); the focus goes to the
       chosen card, or to the name when a design was asked for (the palette's "New deck from"). */
    async open(slug = '') {
        this.back = document.activeElement;
        try { this.list = await this.host.templates(); } catch (e) { this.list = []; }
        if (!this.list.length) this.list = [{ slug: 'blank', name: 'Blank', tagline: 'A title slide and a few layouts, ready to fill.', slides: 4 }];
        if (slug) { this.tone = ''; this.style = ''; }       // a design asked for by name is never filtered away
        if (slug && this.list.some(t => t.slug === slug)) this.slug = slug;
        else if (!this.list.some(t => t.slug === this.slug)) this.slug = this.list[0].slug;
        this.name.value = '';
        const where = this.host.folder();
        const w = this.root.querySelector('#galleryWhere');
        w.textContent = `Saved in ${where.name}, as a folder of its own`;
        w.title = where.path;
        this.root.hidden = false;
        this.render();
        this.select(this.slug, { focus: !slug });
        if (slug) this.name.focus();
    }

    close() {
        if (this.root.hidden) return;
        this.root.hidden = true;
        if (this.back && this.back.isConnected && typeof this.back.focus === 'function') this.back.focus();
        this.back = null;
    }

    _styles() { return [...new Set(this.list.map(t => t.style).filter(Boolean))]; }
    _shown() {
        return this.list.filter(t => t.slug === 'blank' || ((!this.tone || t.tone === this.tone) && (!this.style || t.style === this.style)));
    }
    _card(slug) { return this.grid.querySelector(`.gallery-item[data-slug="${CSS.escape(slug)}"]`); }

    render() {
        // The filters: background, then style; the chosen one of each is pressed.
        const seg = (attr, items, on) => items.map(([v, label]) => `<button type="button" data-${attr}="${esc(v)}" aria-pressed="${v === on}">${esc(label)}</button>`).join('');
        this.root.querySelector('#galleryTones').innerHTML = seg('tone', [['', 'All'], ['light', 'Light'], ['dark', 'Dark']], this.tone);
        this.root.querySelector('#galleryStyles').innerHTML = seg('style', [['', 'Any style'], ...this._styles().map(s => [s, s])], this.style);
        const shown = this._shown();
        if (!shown.some(t => t.slug === this.slug)) this.slug = (shown[1] || shown[0]).slug;     // the first design the filter keeps, else Blank
        this.grid.innerHTML = shown.map(t => `<button type="button" class="gallery-item" role="option" data-slug="${esc(t.slug)}"
                aria-selected="${t.slug === this.slug}" tabindex="${t.slug === this.slug ? 0 : -1}" title="${esc(t.tagline)}">
                <img src="/templates/previews/${esc(t.slug)}.jpg" alt="" loading="lazy">
                <span class="name">${esc(t.name)}</span>
                <span class="meta">${t.slides} slides${t.tone ? ' · ' + (t.tone === 'dark' ? 'Dark' : 'Light') : ''}${t.style ? ' · ' + esc(t.style) : ''}</span>
            </button>`).join('')
            + (shown.length === 1 ? '<p class="gallery-none">No design matches both filters. Blank stays, or choose other filters.</p>' : '');
        this.root.querySelector('#galleryCount').textContent = `${shown.length - 1} of ${this.list.length - 1} designs`;
        this._detail();
    }

    select(slug, { focus = false } = {}) {
        if (!this.list.some(t => t.slug === slug)) return;
        this.slug = slug;
        for (const c of this.grid.querySelectorAll('.gallery-item')) {
            const on = c.dataset.slug === slug;
            c.setAttribute('aria-selected', on);
            c.tabIndex = on ? 0 : -1;
        }
        const card = this._card(slug);
        if (card) { card.scrollIntoView({ block: 'nearest' }); if (focus) card.focus(); }
        this._detail();
    }

    /* The chosen design, larger: its cover, what it is, how many slides, and the next few. */
    _detail() {
        const t = this.list.find(x => x.slug === this.slug); if (!t) return;
        const more = Array.from({ length: Math.min(MORE_SLIDES, t.slides - 1) }, (_, i) =>
            `<span class="deck-thumb" data-url="/templates/${esc(t.slug)}.html" data-slide="${i + 1}" title="Slide ${i + 2}"></span>`).join('');
        this.detail.innerHTML = `<img class="gallery-cover" src="/templates/previews/${esc(t.slug)}.jpg" alt="${esc(t.name)}: the title slide">
            <h3>${esc(t.name)}</h3>
            <p class="gallery-meta">${t.slides} slides${t.tone ? ' · ' + (t.tone === 'dark' ? 'Dark' : 'Light') + ' background' : ''}${t.style ? ' · ' + esc(t.style) : ''}</p>
            <p class="gallery-tagline">${esc(t.tagline)}</p>
            ${more ? `<div class="gallery-more">${more}</div>` : ''}`;
        this.previews.watch(this.detail);
    }

    _gridKey(e) {
        const cards = [...this.grid.querySelectorAll('.gallery-item')];
        const i = cards.findIndex(c => c.dataset.slug === this.slug);
        if (i < 0 || e.ctrlKey || e.metaKey || e.altKey) return;
        // Cards per row: those on the first card's line.
        const cols = Math.max(1, cards.filter(c => c.offsetTop === cards[0].offsetTop).length);
        let to = null;
        if (e.key === 'ArrowRight') to = i + 1;
        else if (e.key === 'ArrowLeft') to = i - 1;
        else if (e.key === 'ArrowDown') to = i + cols;
        else if (e.key === 'ArrowUp') to = i - cols;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = cards.length - 1;
        else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (e.key === 'Enter' && this.name.value.trim()) this.create(); else this.name.focus();
            return;
        }
        if (to === null) return;
        e.preventDefault();
        to = Math.max(0, Math.min(cards.length - 1, to));
        this.select(cards[to].dataset.slug, { focus: true });
    }

    async create() {
        const name = this.name.value.trim().replace(/\.html$/i, '');
        if (!name) { this.name.focus(); this.name.classList.add('wants'); setTimeout(() => this.name.classList.remove('wants'), 900); return; }
        if (await this.host.create(name, this.slug)) this.close();
    }
}
