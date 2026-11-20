/* ============================================================
   citepanel.js - the panel's parts for citations and credits:
   - Picture > Credit: who made the picture, where it is from, its
     licence and a link, and whether it shows on the slide;
   - a slide's References: the references at the foot of the
     slides, and how the citations show in the text;
   - the Sources slide's settings (what it lists, the style);
   - Theme > Image credits: how credits look on the slides.
   Every change is one undo step; sources.js writes what follows.
   ============================================================ */
import { CITE, styleList, styleIdOf, customStyle, escapeHtml } from './cite.js';
import { CREDIT_STYLES, CREDIT_FORMATS, LICENCES, creditOf, hasCredit, creditable } from './sources.js';
import { buildSlide, layoutById } from './layouts.js';
import { siteName } from './credits.js';

const esc = escapeHtml;
const check = (id, label, title = '') => `<label class="align-toslide"${title ? ` title="${esc(title)}"` : ''}><input type="checkbox" id="${id}"> <span>${label}</span></label>`;

export class CitePanel {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.img = null;
    }
    _done(label) { this.app.sources.schedule(0); if (this.app.inspector) this.app.inspector.sync(); }
    get stage() { return this.deck.stage; }
    _deckAttr(name, value, label) { this.history.attr(this.stage, name, value, label); this._done(); }

    /* ------------------------------------------------------------
       Picture > Credit
       ------------------------------------------------------------ */
    syncPicture(img) {
        const box = document.getElementById('inspCredit');
        if (!box) return;
        if (img && !creditable(img)) img = null;
        this.img = img;
        box.hidden = !img;
        if (!img) return;
        if (!box.firstChild) this._buildCredit(box);
        const c = creditOf(img), $ = (id) => box.querySelector('#' + id);
        for (const [id, v] of [['crBy', c.by], ['crFrom', c.from], ['crLicense', c.license], ['crUrl', c.url]]) {
            if (document.activeElement !== $(id)) $(id).value = v;
            $(id).closest('.insp-field').classList.toggle('set', !!v);
        }
        const none = img.hasAttribute('data-credit-none');
        $('crShow').checked = img.getAttribute('data-credit-show') !== 'off' && !none;
        $('crShow').disabled = none;
        const style = this.stage.getAttribute('data-credits') || '';
        const sources = this.stage.querySelector(':scope > .slide[data-sources]');
        const words = style ? (CREDIT_STYLES.find(s => s[0] === style) || ['', ''])[1].toLowerCase() : 'not shown on the slides (Theme > Image credits)';
        $('crHint').textContent = `Credits are ${words}${sources ? ', and listed on the Sources slide' : ''}.`;
        $('crWarn').hidden = hasCredit(c) || none;
        $('crNone').textContent = none ? 'It needs a credit after all' : 'It needs no credit';
        $('crOpen').disabled = !/^https?:\/\//i.test(c.url);
    }
    _buildCredit(box) {
        box.innerHTML = `<h4>Credit</h4>
            <div class="insp-row"><label>By</label><div class="insp-field"><input type="text" id="crBy" placeholder="Author, agency, or your name" spellcheck="false" title="Who made the picture. Saved as data-credit-by."></div></div>
            <div class="insp-row"><label>From</label><div class="insp-field"><input type="text" id="crFrom" placeholder="Wikimedia Commons, a paper, a site" spellcheck="false" title="Where it was published. Saved as data-credit-from."></div></div>
            <div class="insp-row"><label>Licence</label><div class="insp-field"><input type="text" id="crLicense" list="crLicenses" placeholder="CC BY 4.0, Public domain..." spellcheck="false" title="Its licence, or how you may use it. Saved as data-credit-license."></div></div>
            <datalist id="crLicenses">${LICENCES.map(l => `<option value="${esc(l)}">`).join('')}</datalist>
            <div class="insp-row"><label>Link</label><div class="insp-field"><input type="text" id="crUrl" placeholder="https://" spellcheck="false" title="Where it can be found: listed on the Sources slide. Saved as data-credit-url."><button type="button" class="insp-open" id="crOpen" title="Open the link in your browser">&#8599;</button></div></div>
            <div class="insp-warn" id="crWarn">No credit yet: the Sources slide lists it as "source not given". <button type="button" class="mini-btn" id="crNone">It needs no credit</button></div>
            ${check('crShow', 'Show the credit on this picture', 'Off: listed on the Sources slide only. Saved as data-credit-show="off".')}
            <div class="insp-hint insp-state" id="crHint"></div>
            <div class="insp-btns" style="margin-top:6px"><button type="button" class="mini-btn" id="crLook" title="How credits look on the slides: Theme > Image credits">How credits look...</button></div>`;
        const $ = (id) => box.querySelector('#' + id);
        const field = (id, attr) => {
            $(id).addEventListener('change', () => {
                const img = this.img; if (!img) return;
                let v = $(id).value.trim();
                if (attr === 'data-credit-url' && v && !/^[a-z]+:/i.test(v)) v = 'https://' + v;
                this.history.begin('Picture credit');
                this.history.attr(img, attr, v || null, 'Picture credit');
                // A link typed first names its site.
                if (attr === 'data-credit-url' && v && !img.getAttribute('data-credit-from')) this.history.attr(img, 'data-credit-from', siteName(v) || null, 'Picture credit');
                if (v) this.history.attr(img, 'data-credit-none', null, 'Picture credit');
                this.history.end();
                this._done();
            });
            $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
        };
        field('crBy', 'data-credit-by'); field('crFrom', 'data-credit-from'); field('crLicense', 'data-credit-license'); field('crUrl', 'data-credit-url');
        $('crShow').addEventListener('change', () => { if (this.img) { this.history.attr(this.img, 'data-credit-show', $('crShow').checked ? null : 'off', 'Show credit'); this._done(); } });
        $('crNone').addEventListener('click', () => { if (this.img) { this.history.attr(this.img, 'data-credit-none', this.img.hasAttribute('data-credit-none') ? null : '', 'Picture credit'); this._done(); } });
        $('crOpen').addEventListener('click', () => { const u = this.img && this.img.getAttribute('data-credit-url'); if (u && /^https?:\/\//i.test(u)) window.open(u, '_blank', 'noopener'); });
        $('crLook').addEventListener('click', () => document.getElementById('btnTheme').click());
    }

    /* ------------------------------------------------------------
       The slide's References, and the Sources slide
       ------------------------------------------------------------ */
    syncSlide(slide) {
        const refs = document.getElementById('inspSlideRefs'), src = document.getElementById('inspSources');
        if (!refs || !src) return;
        const stage = this.stage;
        const isSources = slide.hasAttribute('data-sources'), isMore = slide.hasAttribute('data-sources-more');
        const anyCite = !!stage.querySelector(CITE);
        refs.hidden = isSources || isMore || !(anyCite || stage.hasAttribute('data-cite-foot'));
        if (!refs.hidden) this._syncRefs(refs, slide);
        src.hidden = !(isSources || isMore);
        if (!src.hidden) this._syncSources(src, slide, isMore);
    }
    _syncRefs(box, slide) {
        if (!box.firstChild) {
            box.innerHTML = `<h4>References</h4>
                ${check('rfFoot', 'At the foot of each slide that cites', 'Each slide lists what it cites, at its foot: what talks usually do. Saved as data-cite-foot on the stage.')}
                ${check('rfHere', 'Not on this slide', 'This slide has no references at its foot. Saved as data-cite-foot="off".')}
                <div class="insp-row"><label>They read</label><div class="insp-field"><select id="rfForm" aria-label="How the references at the foot read"><option value="short">Short: Szostak et al., Nature 409, 387 (2001)</option><option value="full">As on the Sources slide</option><option value="author-year">Author and year</option></select></div></div>
                ${check('rfHide', 'No citation marks in the text', 'The text shows no (Author, year) or number: the references at the foot say it all. Saved as data-cite-intext="hide".')}
                <div class="insp-hint insp-state" id="rfState"></div>
                <div class="insp-btns" style="margin-top:6px"><button type="button" class="mini-btn" id="rfLib">Library and style...</button><button type="button" class="mini-btn" id="rfSources" title="A slide at the end listing every reference and picture credit">Sources slide</button></div>`;
            const $ = (id) => box.querySelector('#' + id);
            $('rfFoot').addEventListener('change', () => this._deckAttr('data-cite-foot', $('rfFoot').checked ? '' : null, 'References at the foot'));
            $('rfHere').addEventListener('change', () => { const s = this.deck.currentSlide; if (s) { this.history.attr(s, 'data-cite-foot', $('rfHere').checked ? 'off' : null, 'References at the foot'); this._done(); } });
            $('rfForm').addEventListener('change', () => this._deckAttr('data-cite-foot-form', $('rfForm').value === 'short' ? null : $('rfForm').value, 'References at the foot'));
            $('rfHide').addEventListener('change', () => this._deckAttr('data-cite-intext', $('rfHide').checked ? 'hide' : null, 'Citations in the text'));
            $('rfLib').addEventListener('click', () => this.app.openCiteLibrary());
            $('rfSources').addEventListener('click', () => addSourcesSlide(this.app));
        }
        const $ = (id) => box.querySelector('#' + id), stage = this.stage;
        const on = stage.hasAttribute('data-cite-foot');
        $('rfFoot').checked = on;
        $('rfHere').checked = slide.getAttribute('data-cite-foot') === 'off';
        $('rfHere').closest('label').hidden = !on;
        $('rfForm').value = stage.getAttribute('data-cite-foot-form') || 'short';
        $('rfForm').closest('.insp-row').hidden = !on;
        $('rfHide').checked = stage.getAttribute('data-cite-intext') === 'hide';
        const n = slide.querySelectorAll(CITE).length;
        const missing = this.app.sources.missing && this.app.sources.missing.size ? ` Not in the library: ${[...this.app.sources.missing].join(', ')}.` : '';
        $('rfState').textContent = (n ? `${n} citation${n > 1 ? 's' : ''} on this slide.` : 'No citations on this slide.') + missing;
        $('rfSources').hidden = !!stage.querySelector(':scope > .slide[data-sources]');
    }
    async _syncSources(box, slide, isMore) {
        const stage = this.stage, main = stage.querySelector(':scope > .slide[data-sources]');
        if (isMore) {
            box.innerHTML = `<h4>Sources, continued</h4><div class="insp-hint" style="margin:0">Diapo makes and removes this slide as the list on the Sources slide needs it; its settings are there.</div>
                <div class="insp-btns" style="margin-top:6px"><button type="button" class="mini-btn" id="srGo">Go to the Sources slide</button></div>`;
            box.querySelector('#srGo').addEventListener('click', () => { if (main) this.deck.goTo(this.deck.slides.indexOf(main)); });
            return;
        }
        if (!box.querySelector('#srStyle')) {
            box.innerHTML = `<h4>Sources slide</h4>
                <div class="insp-row"><label>Style</label><div class="insp-field"><select id="srStyle" aria-label="Citation style"></select></div></div>
                ${check('srRefs', 'References', 'The references the deck cites, in its style')}
                <div class="insp-row" id="srListRow"><label>Lists</label><div class="insp-field"><select id="srList"><option value="">The cited ones</option><option value="all">Everything in the library</option></select></div></div>
                ${check('srLinks', 'DOIs and addresses as links')}
                ${check('srPics', 'Picture credits', 'Each picture with its credit, by slide')}
                ${check('srNone', 'Pictures without a credit too ("source not given")', 'Off: only the pictures that have a credit. Pictures with no alt text and no credit are left out either way.')}
                <div class="insp-hint insp-state" id="srState"></div>
                <div class="insp-btns" style="margin-top:6px"><button type="button" class="mini-btn" id="srLib">Library...</button><button type="button" class="mini-btn" id="srStop" title="Keep the slide as it is now: an ordinary slide that Diapo no longer rewrites">Stop updating it</button></div>`;
            const $ = (id) => box.querySelector('#' + id);
            const parts = (s) => (s.getAttribute('data-sources') || 'references credits').split(/\s+/).filter(Boolean);
            const setPart = (name, on) => {
                const s = this.deck.currentSlide; if (!s) return;
                const p = new Set(parts(s)); if (on) p.add(name); else p.delete(name);
                if (!p.size) { this.app.toast('The Sources slide lists the references, the picture credits, or both.'); this.app.inspector.sync(); return; }
                this.history.attr(s, 'data-sources', ['references', 'credits'].filter(x => p.has(x)).join(' '), 'Sources slide');
                this._done();
            };
            $('srRefs').addEventListener('change', () => setPart('references', $('srRefs').checked));
            $('srPics').addEventListener('change', () => setPart('credits', $('srPics').checked));
            const slideAttr = (id, attr, on, off = null) => $(id).addEventListener('change', () => { const s = this.deck.currentSlide; if (s) { this.history.attr(s, attr, $(id).type === 'checkbox' ? ($(id).checked ? on : off) : ($(id).value || null), 'Sources slide'); this._done(); } });
            slideAttr('srList', 'data-sources-list');
            slideAttr('srLinks', 'data-sources-links', '');
            slideAttr('srNone', 'data-sources-pictures', null, 'credited');
            $('srStyle').addEventListener('change', () => this._deckAttr('data-csl-style', $('srStyle').value === 'apa' ? null : $('srStyle').value, 'Citation style'));
            $('srLib').addEventListener('click', () => this.app.openCiteLibrary());
            $('srStop').addEventListener('click', () => stopSources(this.app));
        }
        const $ = (id) => box.querySelector('#' + id);
        const p = (slide.getAttribute('data-sources') || 'references credits').split(/\s+/);
        $('srRefs').checked = p.includes('references');
        $('srPics').checked = p.includes('credits');
        $('srList').value = slide.getAttribute('data-sources-list') || '';
        $('srListRow').hidden = $('srLinks').closest('label').hidden = !p.includes('references');
        $('srLinks').checked = slide.hasAttribute('data-sources-links');
        $('srNone').checked = slide.getAttribute('data-sources-pictures') !== 'credited';
        $('srNone').closest('label').hidden = !p.includes('credits');
        const pages = this.app.sources.sourcesPages || 1;
        $('srState').textContent = (pages > 1 ? `Continues on ${pages - 1} more slide${pages > 2 ? 's' : ''}.` : 'Fits on this slide.') + ' The title and the slide\'s look are yours to change; the list is written by Diapo.';
        if (!this._styles) this._styles = styleList();
        const list = await this._styles, own = customStyle(this.deck), cur = styleIdOf(this.deck);
        const sel = $('srStyle');
        const sig = cur + '|' + (own ? own.id : '');
        if (sel.dataset.sig !== sig) {
            sel.innerHTML = (own ? `<option value="${esc(own.id)}">${esc(own.title)} (.csl)</option>` : '') + list.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
            sel.value = cur;
            sel.dataset.sig = sig;
        }
    }

    /* ------------------------------------------------------------
       Theme > Image credits
       ------------------------------------------------------------ */
    syncTheme(box) {
        if (!box || !this.deck.isOpen) return;
        if (!box.firstChild) {
            box.innerHTML = `<h4>Image credits</h4>
                <div class="insp-hint" style="margin:0 0 6px">Who made each picture, from its Credit in the panel (select a picture).</div>
                <div class="theme-row"><select id="tcStyle" aria-label="How credits show on the slides">${CREDIT_STYLES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
                <div class="theme-row" id="tcCornerRow"><span class="theme-lab">Corner</span><div class="insp-field insp-seg" id="tcCorner" style="flex:1"><button data-c="tl" title="Top left">&#8598;</button><button data-c="tr" title="Top right">&#8599;</button><button data-c="bl" title="Bottom left">&#8601;</button><button data-c="br" title="Bottom right">&#8600;</button></div></div>
                <div class="theme-row" id="tcSizeRow"><span class="theme-lab">Size</span><input type="range" id="tcSize" min="10" max="36" step="1" style="flex:1"><output id="tcSizeV" class="mono"></output></div>
                <div class="theme-row" id="tcFormatRow"><span class="theme-lab">Reads</span><select id="tcFormat">${CREDIT_FORMATS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
                <div class="insp-hint insp-state" id="tcState"></div>
                <div class="theme-row"><button class="mini-btn" id="tcSources" title="A slide at the end listing every reference and picture credit">Sources slide</button></div>`;
            const $ = (id) => box.querySelector('#' + id);
            const set = (name, value) => { this._deckAttr(name, value, 'Image credits'); this.syncTheme(box); };
            $('tcStyle').addEventListener('change', () => set('data-credits', $('tcStyle').value || null));
            $('tcCorner').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) set('data-credit-corner', b.dataset.c === 'br' ? null : b.dataset.c); });
            $('tcSize').addEventListener('input', () => { $('tcSizeV').textContent = $('tcSize').value + ' px'; });
            $('tcSize').addEventListener('change', () => set('data-credit-size', $('tcSize').value === '18' ? null : $('tcSize').value));
            $('tcFormat').addEventListener('change', () => set('data-credit-format', $('tcFormat').value || null));
            $('tcSources').addEventListener('click', () => { addSourcesSlide(this.app); this.syncTheme(box); });
        }
        const $ = (id) => box.querySelector('#' + id), stage = this.stage;
        const style = stage.getAttribute('data-credits') || '';
        $('tcStyle').value = style;
        const corner = stage.getAttribute('data-credit-corner') || 'br';
        $('tcCorner').querySelectorAll('[data-c]').forEach(b => b.classList.toggle('on', b.dataset.c === corner));
        $('tcCornerRow').hidden = !(style === 'corner' || style === 'info');
        $('tcSize').value = stage.getAttribute('data-credit-size') || '18';
        $('tcSizeV').textContent = $('tcSize').value + ' px';
        $('tcSizeRow').hidden = $('tcFormatRow').hidden = !style;
        $('tcFormat').value = stage.getAttribute('data-credit-format') || '';
        const pics = Array.from(stage.querySelectorAll('img')).filter(creditable);
        const without = pics.filter(i => !hasCredit(creditOf(i)) && !i.hasAttribute('data-credit-none')).length;
        $('tcState').textContent = pics.length ? `${pics.length - without} of ${pics.length} picture${pics.length > 1 ? 's' : ''} have a credit.` : 'No pictures in this deck yet.';
        $('tcSources').hidden = !!stage.querySelector(':scope > .slide[data-sources]');
    }
}

/* The Sources slide: added at the end (one undo step), or shown when the deck has one. */
export function addSourcesSlide(app) {
    const deck = app.deck;
    if (!deck.isOpen) return null;
    const have = deck.stage.querySelector(':scope > .slide[data-sources]');
    if (have) { deck.goTo(deck.slides.indexOf(have)); return have; }
    const layout = layoutById('title-text') || layoutById('blank');
    const slide = buildSlide(deck.doc, layout, app.insert.defaults(), { w: deck.stageW, h: deck.stageH });
    // The layout's title stays (it is the user's to change); its body text gives way to the list.
    const title = slide.querySelector('h1, h2');
    Array.from(slide.children).forEach(c => { if (c !== title) c.remove(); });
    if (title) title.textContent = 'References';
    const anyCite = !!deck.stage.querySelector(CITE), anyPic = !!deck.stage.querySelector('.slide img');
    slide.setAttribute('data-sources', anyCite || !anyPic ? 'references credits' : 'credits');
    if (title && !anyCite && anyPic) title.textContent = 'Picture credits';
    slide.setAttribute('data-name', 'Sources');
    const last = deck.slides[deck.slides.length - 1];
    app.history.begin('Add Sources slide');
    app.history.insert(slide, deck.stage, last ? last.nextSibling : null, 'Add Sources slide');
    app.history.end();
    deck.goTo(deck.slides.indexOf(slide));
    app.sources.run().then(() => { if (app.inspector) app.inspector.sync(); });
    app.toast('Sources slide added: Diapo keeps its list current. Its title and look are yours.');
    return slide;
}

/* The Sources slide becomes an ordinary slide: its list stays as it is now (one undo step). */
export function stopSources(app) {
    const deck = app.deck, slide = deck.stage.querySelector(':scope > .slide[data-sources]');
    if (!slide) return;
    const h = app.history;
    h.begin('Stop updating the Sources slide');
    for (const s of [slide, ...deck.stage.querySelectorAll(':scope > .slide[data-sources-more]')]) {
        for (const a of ['data-sources', 'data-sources-more', 'data-sources-list', 'data-sources-links', 'data-sources-pictures']) h.attr(s, a, null, 'Stop updating the Sources slide');
        const body = s.querySelector('[data-sources-body]');
        if (body) { h.attr(body, 'data-sources-body', null, 'Stop updating the Sources slide'); h.attr(body, 'data-locked', null, 'Stop updating the Sources slide'); }
    }
    h.end();
    app.sources.schedule(0);
    if (app.inspector) app.inspector.sync();
    app.toast('The Sources slide is an ordinary slide now: Diapo no longer changes it.');
}
