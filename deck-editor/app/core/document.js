/* ============================================================
   document.js - the deck loaded in the iframe.

   The iframe's DOM is the single source of truth. This module
   loads a deck into it, tells the editor what the deck contains
   (stage, slides, current slide) and navigates between slides
   without owning a copy of the deck's state.

   Deck contract (see REFERENCE.md): a .deck-stage stage of a fixed size
   (1920x1080 unless the deck says otherwise) with .slide sections;
   .active marks the shown slide. Everything else (deck:slide events,
   hash navigation) is optional and detected.
   ============================================================ */

import { FONTS_ID, emptyFonts, cloneFonts, fontsToCss, cssToFonts, deckFontLinks, applyHostedLinks } from './fonts.js';
import { MASTER_SELECTOR, readableText } from './dom.js';

/* The default stage. A deck can be another size: the Theme panel writes
   `.deck-stage, .deck-stage .slide { width; height }` into the override
   block, and deck.stageW / stageH are read from the live stage, so every
   module works in that deck's own pixels. */
export const STAGE_W = 1920;
export const STAGE_H = 1080;
export const STAGE_SIZES = [
    { name: '16:9 widescreen', w: 1920, h: 1080 },
    { name: '16:10', w: 1920, h: 1200 },
    { name: '4:3 standard', w: 1440, h: 1080 },
    { name: 'A4 landscape', w: 1587, h: 1123 },
    { name: 'A4 portrait', w: 1123, h: 1587 },
    { name: 'Square', w: 1080, h: 1080 },
    { name: '9:16 vertical', w: 1080, h: 1920 },
];
const SIZE_MARKER = '/* stage size */';
export const OVERRIDES_ID = 'deck-editor-overrides';
export const BASE_SELECTOR_PREFIX = '.deck-stage .slide ';
const OVERRIDES_HEADER = '/* Theme overrides made in the deck editor. Safe to delete: the deck then uses its own styles. */';
const CUSTOM_MARKER = '/* custom css */';
export const ANIM_MARK_START = '/* animations (managed by the deck editor) */';
export const ANIM_MARK_END = '/* end animations */';
/* Written when a slide carries data-no-master: the master layer (stage-level elements)
   stays out of that slide, in the editor, when presenting and in thumbnails. */
const MASTER_MARK_START = '/* master (managed by the deck editor) */';
const MASTER_MARK_END = '/* end master */';
const MASTER_CSS = MASTER_MARK_START + '\n.deck-stage:has(> .slide.active[data-no-master]) > :not(.slide) { visibility: hidden !important; }\n' + MASTER_MARK_END;
/* Superscript and subscript for decks whose own CSS leaves them at the browser's default
   (about 83% of the text): the size word processors use, without changing the line height. */
const SCRIPTS_MARK_START = '/* superscript and subscript (managed by the deck editor) */';
const SCRIPTS_MARK_END = '/* end superscript and subscript */';
const SCRIPTS_CSS = SCRIPTS_MARK_START + '\n.deck-stage .slide sup, .deck-stage .slide sub { font-size: 65%; line-height: 0; }\n' + SCRIPTS_MARK_END;
/* CSS written for one element in the panel's Code section lives on the element as data-css
   (so it goes with it when copied, and is undone with it) and is regenerated into this section
   on every save: the declarations on `[data-id="..."]`, @-rules (keyframes, media) hoisted out.
   Unless data-css-live is set, the rule only applies when the deck is not being edited. */
const ELEMENT_MARK_START = '/* element styles (managed by the deck editor) */';
const ELEMENT_MARK_END = '/* end element styles */';
export function elementCssOf(el) {
    const id = el.getAttribute('data-id'), text = (el.getAttribute('data-css') || '').trim();
    if (!id || !text) return '';
    const sel = '[data-id="' + id.replace(/["\\]/g, '\\$&') + '"]';
    const scope = el.hasAttribute('data-css-live') ? sel : 'html:not(.deck-editing) ' + sel;
    // Top-level @-rules stand on their own; everything else is a declaration on the element
    // (nested `&` rules inside stay with it, as CSS nesting takes them).
    const own = [], hoisted = [];
    let i = 0, depth = 0, start = 0;
    while (i < text.length) {
        const c = text[i];
        if (depth === 0 && c === '@') {
            own.push(text.slice(start, i));
            let j = i, d = 0;
            while (j < text.length) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (d === 0) { j++; break; } } j++; }
            hoisted.push(text.slice(i, j).trim());
            i = j; start = i; continue;
        }
        if (c === '{') depth++; else if (c === '}') depth = Math.max(0, depth - 1);
        i++;
    }
    own.push(text.slice(start));
    const decl = own.join('').trim();
    return [decl ? scope + ' {\n' + decl.split('\n').map(l => '    ' + l.trim()).join('\n') + '\n}' : '', ...hoisted].filter(Boolean).join('\n');
}
function elementCss(doc) {
    const parts = Array.from(doc.querySelectorAll('.deck-stage [data-id][data-css]')).map(elementCssOf).filter(Boolean);
    return parts.length ? ELEMENT_MARK_START + '\n' + parts.join('\n') + '\n' + ELEMENT_MARK_END : '';
}

/* Styles injected into the deck while it is being edited. Removed on save.
   Only presentation chrome that lives outside the slide is hidden; the
   editor never changes how the slides themselves look. */
const HOST_CSS = `
html, body { overflow: hidden !important; }
.deck-stage { transform: translate(0px, 0px) scale(var(--ed-zoom, 1)) !important; }
html.deck-editing .deck-controls { display: none !important; }
html.deck-editing .deck-stage > :not(.slide):not(script):not(style):not(.deck-overview):not(.deck-laser):not(.deck-draw):not([data-ed-ground]) { pointer-events: auto !important; }
html.deck-editing .deck-stage [data-ed-ground] > * { pointer-events: auto !important; }
html.deck-editing .deck-stage [data-ed-ground] { pointer-events: none !important; }
html.deck-no-transitions .deck-stage, html.deck-no-transitions .deck-stage * { transition: none !important; }
html.deck-editing .slide > aside.notes, html.deck-editing .slide > .notes { display: none !important; }
html.deck-editing .deck-stage [data-fragment] { opacity: 1 !important; pointer-events: auto !important; }
html.deck-editing .deck-stage [data-placeholder] { display: flex !important; }
`;

export class Deck extends EventTarget {
    constructor(iframe) {
        super();
        this.iframe = iframe;
        this.file = null;          // workspace-relative path of the open file
        this.win = null;
        this.doc = null;
        this.stage = null;
        this.observer = null;
        this.source = '';          // the file exactly as it was read from disk
        this.sourceStage = null;   // stage as parsed from the source (no scripts run), for load-time values
        this._navToken = 0;
        this._size = null;         // { w, h } of the stage, read from the live document
    }

    /* ------------------------------------------------------------
       Stage size
       ------------------------------------------------------------ */
    /* The stage's laid-out size (transforms do not affect offsetWidth), so a deck whose
       CSS makes the stage some other size is edited in its own pixels. */
    get stageW() { return (this._size || this._measure()).w; }
    get stageH() { return (this._size || this._measure()).h; }
    _measure() {
        let w = 0, h = 0;
        if (this.stage) { w = this.stage.offsetWidth; h = this.stage.offsetHeight; }
        this._size = { w: w > 100 ? w : STAGE_W, h: h > 100 ? h : STAGE_H };
        return this._size;
    }
    /* The zoom the editor shows the deck at; the host CSS applies it to the stage. */
    setZoom(z) {
        if (this.doc) this.doc.documentElement.style.setProperty('--ed-zoom', String(z));
    }
    /* Change the stage size: the override block gets a size rule (none when back to the
       default) and, in decks made from the editor's template, the deck's own presentation
       controller is taught to read the stage's size instead of assuming 1920x1080. */
    setStageSize(w, h) {
        const o = this.overrides;
        const next = { vars: { ...o.vars }, rules: cloneRules(o.rules), css: o.css, size: (w === STAGE_W && h === STAGE_H) ? null : { w, h } };
        this.setOverrides(next);
        if (next.size) this.adaptScaleScript();
    }
    adaptScaleScript() {
        if (!this.doc) return false;
        // The template's controller, in every version it has had: the factor line, then
        // the centring offsets written with the same two numbers.
        const FACTOR = /const factor = Math\.min\(vw \/ 1920, vh \/ 1080\);/;
        let changed = false;
        for (const sc of Array.from(this.doc.querySelectorAll('body script:not([src])'))) {
            const text = sc.textContent;
            if (!FACTOR.test(text)) continue;
            sc.textContent = text
                .replace(FACTOR, 'const sw = this.stage.offsetWidth || 1920, sh = this.stage.offsetHeight || 1080;\n            const factor = Math.min(vw / sw, vh / sh);')
                .replace(/1920 \* factor/g, 'sw * factor').replace(/1080 \* factor/g, 'sh * factor');
            changed = true;
        }
        return changed;
    }
    /* True when the deck's own scripts scale the stage but do not read its size. */
    scaleScriptAssumesDefault() {
        if (!this.doc) return false;
        return Array.from(this.doc.querySelectorAll('body script:not([src])')).some(sc => /Math\.min\(vw \/ 1920, vh \/ 1080\)/.test(sc.textContent));
    }

    /* ------------------------------------------------------------
       Loading
       ------------------------------------------------------------ */
    async load(file, url) {
        this.dispose();
        this.file = file;
        const iframe = this.iframe;
        // The original text is kept so the saved file can reuse the head verbatim. Its version
        // (serve.py, X-Diapo-Version) goes back with every save: a file changed since is not overwritten unasked.
        this.diskVersion = '';
        const sourcePromise = fetch(url, { cache: 'no-store' })
            .then(r => { if (!r.ok) return ''; this.diskVersion = r.headers.get('X-Diapo-Version') || ''; return r.text(); })
            .catch(() => '');
        await new Promise((resolve, reject) => {
            const onLoad = () => { iframe.removeEventListener('load', onLoad); resolve(); };
            iframe.addEventListener('load', onLoad);
            iframe.src = url;
            setTimeout(() => reject(new Error('the deck took too long to load')), 30000);
        });
        this.win = iframe.contentWindow;
        this.doc = iframe.contentDocument;
        this.stage = this.doc.querySelector('.deck-stage');
        if (!this.stage) throw new Error('this file has no .deck-stage, so it is not a deck the editor can open');
        const raw = await sourcePromise;
        this.setSource(raw);
        if (this.source !== raw) {
            // The file carried a duplicated script tail (see repairStrayScriptTails); the browser shows it
            // as text at the end of the body. Drop it from the live document too, so the next save is clean.
            for (const n of Array.from(this.doc.body.childNodes)) if (n.nodeType === 3 && n.textContent.trim().length > 80) n.remove();
            this.repaired = true;
        } else this.repaired = false;

        const style = this.doc.createElement('style');
        style.id = 'deck-editor-host';
        style.textContent = HOST_CSS;
        this.doc.head.appendChild(style);
        this.setEditing(true);
        this._loadOverrides();
        this._loadFonts();
        this._size = null;

        // Slide changes made by the deck itself (or by us) are all noticed here.
        // 'slide' fires only when the active index really changed (the deck also
        // toggles .visible a frame later, which is not a navigation).
        this._lastIndex = this.current;
        this.observer = new this.win.MutationObserver((records) => {
            if (records.some(r => r.type === 'attributes' && r.target.classList && r.target.classList.contains('slide'))) {
                const idx = this.current;
                if (idx !== this._lastIndex) { this._lastIndex = idx; this.dispatchEvent(new CustomEvent('slide', { detail: idx })); }
            }
            this.dispatchEvent(new CustomEvent('mutate', { detail: records }));
        });
        this.observer.observe(this.stage, { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true, characterData: true });

        // A deck whose own controller does not run (its scripts are paused until the user trusts
        // the deck, see serve.py) never marks the first slide .visible, so its reveal elements
        // would stay hidden. Do it by hand after a moment, as goTo() does for later slides.
        const doc = this.doc;
        setTimeout(() => {
            const s = this.doc === doc ? this.currentSlide : null;
            if (s && s.classList.contains('active') && !s.classList.contains('visible')) s.classList.add('visible');
        }, 400);

        this.dispatchEvent(new CustomEvent('ready'));
        return this;
    }

    dispose() {
        if (this.observer) this.observer.disconnect();
        this.observer = null;
        this.win = this.doc = this.stage = null;
        this.file = null;
        this._size = null;
    }

    get isOpen() { return !!this.stage; }

    /* The file text as it is on disk (updated after every save) is what the head is
       spliced from. The parsed stage and body, used to look up what generated hosts
       and body-level children looked like before any script ran, stay as loaded:
       a saved file may carry an edited (inlined) SVG that a later undo should not
       resurrect. */
    setSource(text, { reparse = true } = {}) {
        this.source = repairStrayScriptTails(text || '');
        if (!reparse) return;
        const parsed = new DOMParser().parseFromString(this.source, 'text/html');
        this.sourceStage = parsed.querySelector('.deck-stage');
        this.sourceBody = parsed.body;
    }

    /* Editing hides the deck's own chrome; preview shows the deck exactly as it is. */
    setEditing(on) {
        if (this.doc) this.doc.documentElement.classList.toggle('deck-editing', on);
    }

    /* Switch the deck's CSS transitions off (during drags, undo/redo) so elements
       land where they are put instead of easing there over the reveal duration. */
    setTransitions(on) {
        if (!this.doc) return;
        const root = this.doc.documentElement;
        if (on) void root.offsetWidth;     // flush pending changes while transitions are still off
        root.classList.toggle('deck-no-transitions', !on);
    }
    withoutTransitions(fn) {
        this.setTransitions(false);
        try { fn(); } finally { this.setTransitions(true); }
    }

    /* ------------------------------------------------------------
       Slide model - always read live from the DOM
       ------------------------------------------------------------ */
    get slides() { return this.stage ? Array.from(this.stage.querySelectorAll('.slide')) : []; }

    get current() {
        const slides = this.slides;
        const i = slides.findIndex(s => s.classList.contains('active'));
        return i < 0 ? 0 : i;
    }

    get currentSlide() { return this.slides[this.current] || null; }
    /* The master layer: stage-level elements every slide shows (see dom.js). */
    get masterElements() { return this.stage ? Array.from(this.stage.querySelectorAll(MASTER_SELECTOR)) : []; }
    /* The page counter in the master layer, in the deck's own markup (#pageNow) or the editor's
       (data-page-now), set to a slide number; the deck's script and the runtime do the same. */
    static stampCounter(root, n, total) {
        root.querySelectorAll('#pageNow, [data-page-now]').forEach(e => { e.textContent = String(n); });
        root.querySelectorAll('#pageTotal, [data-page-total]').forEach(e => { e.textContent = String(total); });
    }

    /* Human label for a slide: data-name, first heading, or first text. */
    slideLabel(slide) {
        if (slide.dataset.name) return slide.dataset.name;
        const h = slide.querySelector('h1, h2, h3, [data-edit]');
        let text = h ? readableText(h) : null;
        if (text == null) {
            // The words on the slide, not a chart's labels and table or the speaker notes.
            const c = slide.cloneNode(true);
            c.querySelectorAll('svg, script, style, [data-chart], [data-fig], [data-math], [data-chem], aside.notes').forEach(n => n.remove());
            text = readableText(c);
        }
        const t = text.trim().replace(/\s+/g, ' ');
        return t.slice(0, 40) || 'untitled';
    }

    /* ------------------------------------------------------------
       Navigation. Prefer the deck's own navigation (via the URL hash,
       which decks built on the template honour) so its internal state
       stays in sync; fall back to switching classes ourselves.
       ------------------------------------------------------------ */
    goTo(index) {
        const slides = this.slides;
        if (!slides.length) return;
        index = Math.max(0, Math.min(index, slides.length - 1));
        if (index === this.current) return;
        const token = ++this._navToken;
        const before = this.current;
        try { this.win.location.hash = '#' + (index + 1); } catch (e) { /* ignore */ }
        // Give the deck a moment to react to the hash; if it did not, do it by hand.
        setTimeout(() => {
            if (token !== this._navToken) return;
            if (this.current === index) return;
            this._forceSlide(index, before);
        }, 30);
    }

    _forceSlide(index) {
        const slides = this.slides;
        slides.forEach((s, i) => {
            s.classList.toggle('active', i === index);
            if (i !== index) s.classList.remove('visible');
        });
        // .visible is added a frame later so reveal transitions still run.
        this.win.requestAnimationFrame(() => this.win.requestAnimationFrame(() => {
            if (slides[index] && slides[index].classList.contains('active')) slides[index].classList.add('visible');
        }));
        this.win.document.dispatchEvent(new CustomEvent('deck:slide', { detail: index }));
    }

    next() { this.goTo(this.current + 1); }
    prev() { this.goTo(this.current - 1); }

    /* ------------------------------------------------------------
       Geometry: the stage's scale as the deck applied it. Hit testing
       and dragging always convert through this, never through offsetX.
       ------------------------------------------------------------ */
    get scale() {
        const m = new this.win.DOMMatrix(this.win.getComputedStyle(this.stage).transform);
        return m.a || 1;
    }

    /* Rectangle of an element in stage pixels (the deck's own stage space). */
    stageRect(el) {
        const r = el.getBoundingClientRect(), s = this.stage.getBoundingClientRect(), k = this.scale;
        return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
    }

    /* Ask the deck to re-run its own scale-to-window code. */
    rescale() {
        if (!this.win) return;
        this.win.dispatchEvent(new Event('resize'));
        this.doc.dispatchEvent(new Event('deck:rescale'));
    }

    /* ------------------------------------------------------------
       Serialisation: the file that gets written on save.
       Produced from the live iframe DOM, cleaned so that nothing the
       editor or the deck's runtime added is written back:
         1. editor artefacts (host style, editing class, contenteditable)
         2. runtime content: [data-fig] emptied and its class restored,
            [data-svg] back to <img>, generated SVG emptied, unless the
            user edited something inside (isEdited decides)
         3. stage transform and classes back to load time, first slide
            active, page counter reset
         4. doctype, <html> and <head> spliced in from the original text
       `isEdited(el)` is supplied by the editor (history knows).
       ------------------------------------------------------------ */
    serialize({ isEdited = () => false } = {}) {
        const live = this.doc;
        // Decide on the live DOM which generated hosts carry user edits (the clone has no history).
        const keep = [];
        for (const host of this.generatedHosts()) {
            if (isEdited(host)) { host.setAttribute('data-ed-keep', '1'); keep.push(host); }
            else host.setAttribute('data-ed-gen', '1');
        }
        const root = live.documentElement.cloneNode(true);
        keep.forEach(h => h.removeAttribute('data-ed-keep'));
        live.querySelectorAll('[data-ed-gen]').forEach(h => h.removeAttribute('data-ed-gen'));

        // 0. Things scripts appended at body level (Plotly's tester SVG, tooltips) are not part of the deck.
        this.dropBodyAdditions(root.querySelector('body'));

        // 1. Editor artefacts
        root.classList.remove('deck-editing', 'deck-controls-idle', 'deck-controls-off');
        if (!root.getAttribute('class')) root.removeAttribute('class');
        root.querySelectorAll('#deck-editor-host').forEach(n => n.remove());
        root.querySelectorAll('link[data-ed-restored]').forEach(n => n.remove());
        root.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
        root.querySelectorAll('[spellcheck]').forEach(n => { if (n.closest('.deck-stage')) n.removeAttribute('spellcheck'); });
        root.querySelectorAll('[data-ed-ground]').forEach(n => n.removeAttribute('data-ed-ground'));

        // 2. Runtime content
        root.querySelectorAll('[data-fig]').forEach(h => {
            h.innerHTML = '';
            const src = this.sourceCounterpart(h);
            if (src) {
                // Attributes exactly as the file had them; only the inline style may have been edited.
                for (const a of Array.from(h.attributes)) if (a.name !== 'style' && !src.hasAttribute(a.name)) h.removeAttribute(a.name);
                for (const a of Array.from(src.attributes)) if (a.name !== 'style') h.setAttribute(a.name, a.value);
            } else {
                if (h.dataset.edClass != null) { h.className = h.dataset.edClass; delete h.dataset.edClass; }
                else { h.classList.remove('js-plotly-plot', 'plotly-graph-div'); }
                if (!h.getAttribute('class')) h.removeAttribute('class');
            }
        });
        root.querySelectorAll('[data-ed-keep]').forEach(h => { h.removeAttribute('data-ed-keep'); delete h.dataset.alt; });
        root.querySelectorAll('[data-ed-gen]').forEach(h => {
            h.removeAttribute('data-ed-gen');
            const src = this.sourceCounterpart(h);
            if (src) {
                h.innerHTML = src.innerHTML;          // exactly what the file had (an <img>, or nothing)
            } else if (h.hasAttribute('data-svg')) {
                // Back to the lightweight <img>; the deck inlines the SVG again at load.
                const img = root.ownerDocument.createElement('img');
                img.src = h.dataset.svg;
                img.alt = h.dataset.alt || '';
                h.replaceChildren(img);
            } else {
                h.innerHTML = '';
            }
            delete h.dataset.alt;
        });

        // 3. Stage and slides back to their load-time state
        const stage = root.querySelector('.deck-stage');
        stage.style.removeProperty('transform');
        if (!stage.getAttribute('style')) stage.removeAttribute('style');
        if (this.sourceStage) {
            const cls = this.sourceStage.getAttribute('class');
            if (cls) stage.setAttribute('class', cls); else stage.removeAttribute('class');
        }
        const slides = Array.from(stage.querySelectorAll('.slide'));
        slides.forEach((sl, i) => {
            sl.classList.remove('visible');
            sl.classList.toggle('active', i === 0);
        });
        Deck.stampCounter(root, 1, slides.length);
        root.querySelectorAll('[data-print-master]').forEach(n => n.remove());

        // 4. Splice the regenerated body into the original text
        const body = root.querySelector('body');
        // The override block is the one thing the editor may add to the head.
        root.querySelectorAll('#' + OVERRIDES_ID + ', #' + FONTS_ID).forEach(n => n.remove());
        const overridesCss = this.overridesText();
        const fontsCss = this.fontsText();
        const head = root.querySelector('head');
        if (fontsCss) { const st = root.ownerDocument.createElement('style'); st.id = FONTS_ID; st.textContent = fontsCss; head.appendChild(st); }
        if (overridesCss) { const st = root.ownerDocument.createElement('style'); st.id = OVERRIDES_ID; st.textContent = overridesCss; head.appendChild(st); }
        const spliced = spliceBody(this.source, body.outerHTML);
        if (!spliced) return '<!DOCTYPE html>\n' + root.outerHTML + '\n';
        let text = spliceHeadStyle(spliced, OVERRIDES_ID, overridesCss);
        text = spliceHeadStyle(text, FONTS_ID, fontsCss, new RegExp(`[ \\t]*<style id="${OVERRIDES_ID}">|<\\/head\\s*>`, 'i'));
        return applyHostedLinks(text, this.fonts.hosted);
    }

    /* Elements whose content is produced by the deck's scripts at load time:
       the documented hooks ([data-svg], svg.dots, [data-generated]) plus any
       element with an id that was empty in the source file but has content now. */
    generatedHosts() {
        const out = new Set(this.doc.querySelectorAll('[data-svg], svg.dots, [data-generated]'));
        if (this.sourceStage) {
            for (const src of this.sourceStage.querySelectorAll('[id]')) {
                if (src.childElementCount || src.textContent.trim()) continue;
                const el = this.doc.getElementById(src.id);
                if (el && el.childNodes.length && !el.hasAttribute('data-fig')) out.add(el);
            }
        }
        return Array.from(out);
    }

    /* The element in the parsed source that corresponds to a live (or cloned) generated host:
       by id, or by its data-svg / data-generated value when that is unique. */
    sourceCounterpart(el) {
        if (!this.sourceStage) return null;
        if (el.id) return this.sourceStage.querySelector('#' + CSS.escape(el.id));
        for (const attr of ['data-fig', 'data-svg', 'data-generated', 'data-seed']) {
            const v = el.getAttribute(attr);
            if (v == null) continue;
            const hits = this.sourceStage.querySelectorAll(`[${attr}="${CSS.escape(v)}"]`);
            if (hits.length === 1) return hits[0];
        }
        return null;
    }

    /* Remove body-level elements that have no counterpart in the source file, in order.
       Editing never adds or removes body-level elements, so anything extra came from a script. */
    dropBodyAdditions(body) {
        if (!this.sourceBody) return;
        const sig = (e) => e.tagName + '#' + (e.id || '') + '.' + (e.getAttribute('class') || '');
        const expected = Array.from(this.sourceBody.children).map(sig);
        let j = 0;
        for (const el of Array.from(body.children)) {
            if (j < expected.length && sig(el) === expected[j]) { j++; continue; }
            if (el.id === 'deck-presenter' || el.id === 'deck-runtime') continue;   // added on request through the editor; part of the deck now
            el.remove();
        }
        // Trailing whitespace is re-added by spliceBody from the source text (the parser
        // folds the newlines after </body> and </html> into the body, so the DOM is no guide).
        while (body.lastChild && body.lastChild.nodeType === 3 && !body.lastChild.textContent.trim()) body.lastChild.remove();
    }

    /* Custom properties the deck defines on :root (the theme), for the inspector.
       With effective = true the editor's own overrides replace the deck's values. */
    rootProperties({ effective = true } = {}) {
        const seen = new Map();
        for (const sheet of Array.from(this.doc.styleSheets)) {
            if (sheet.ownerNode && sheet.ownerNode.id === OVERRIDES_ID) continue;
            let rules;
            try { rules = sheet.cssRules; } catch (e) { continue; }   // cross-origin font sheets
            for (const rule of Array.from(rules)) {
                if (rule.selectorText !== ':root' && rule.selectorText !== 'html') continue;
                for (const prop of Array.from(rule.style)) {
                    if (prop.startsWith('--')) seen.set(prop.slice(2), rule.style.getPropertyValue(prop).trim());
                }
            }
        }
        const out = Array.from(seen, ([name, value]) => ({ name, value, default: value, added: false }));
        if (effective) for (const p of out) if (this.overrides.vars[p.name] != null) p.value = this.overrides.vars[p.name];
        // Variables the editor added (Theme > Add colour) exist only in the override block: no deck default.
        for (const [name, value] of Object.entries(this.overrides.vars)) if (!seen.has(name) && value != null) out.push({ name, value, default: null, added: true });
        return out;
    }

    /* ------------------------------------------------------------
       Theme overrides: the one style block the editor may add to a
       deck (<style id="deck-editor-overrides"> at the end of <head>).
       State: { vars: {name: value}, rules: {selector: {prop: value}},
       css: 'free text' }. Base rules are written with a selector that
       outranks the deck's usual ones (.deck-stage .slide h1).
       ------------------------------------------------------------ */
    get overrides() {
        if (!this._overrides) this._overrides = { vars: {}, rules: {}, css: '', size: null };
        return this._overrides;
    }
    setOverrides(state) {
        this._overrides = { vars: { ...(state.vars || {}) }, rules: cloneRules(state.rules || {}), css: state.css || '', size: cloneSize(state.size) };
        this._applyOverrides();
        this._size = null;             // the size rule may have changed the stage
        this.dispatchEvent(new CustomEvent('overrides'));
    }
    /* Presets used on the slides; their CSS is regenerated from this on every save. */
    usedAnimations() {
        return this.doc ? Array.from(this.doc.querySelectorAll('.deck-stage [data-anim]')).map(e => e.getAttribute('data-anim')) : [];
    }
    overridesText() {
        const anim = this.animationCssProvider ? this.animationCssProvider(this.usedAnimations()) : '';
        // A deck whose own CSS already handles data-no-master (the templates, decks from the diapo-deck skill) keeps its rule.
        const master = this.doc && this.doc.querySelector('.deck-stage > .slide[data-no-master]') && !this.hasOwnMasterRule() ? MASTER_CSS : '';
        const scripts = this.doc && this.doc.querySelector('.deck-stage sup, .deck-stage sub') && !this.hasOwnRule(/(^|[\s,}])su[pb]\s*[,{]/) ? SCRIPTS_CSS : '';
        const elements = this.doc ? elementCss(this.doc) : '';
        return overridesToCss(this.overrides, [anim, master, scripts, elements].filter(Boolean).join('\n'));
    }
    hasOwnMasterRule() { return this.hasOwnRule('[data-no-master]'); }
    /* Does the deck's own CSS (not the editor's blocks) contain this text or match this pattern? */
    hasOwnRule(what) {
        return Array.from(this.doc.querySelectorAll('style')).some(st => !(st.id || '').startsWith('deck-editor') && (what instanceof RegExp ? what.test(st.textContent) : st.textContent.includes(what)));
    }
    refreshAnimations() { this._applyOverrides(); this.dispatchEvent(new CustomEvent('overrides')); }
    hasOverrides() { return !!this.overridesText(); }
    _applyOverrides() {
        if (!this.doc) return;
        let st = this.doc.getElementById(OVERRIDES_ID);
        const css = this.overridesText();
        if (!css) { if (st) st.remove(); return; }
        if (!st) { st = this.doc.createElement('style'); st.id = OVERRIDES_ID; this.doc.head.appendChild(st); }
        if (st.textContent !== css) st.textContent = css;
    }
    /* Read a block written by an earlier session back into state. */
    _loadOverrides() {
        const st = this.doc.getElementById(OVERRIDES_ID);
        this._overrides = st ? cssToOverrides(st.textContent) : { vars: {}, rules: {}, css: '', size: null };
        this._applyOverrides();
    }
    themeColours() {
        return this.rootProperties().filter(p => /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(p.value));
    }
    themeFonts() {
        return this.rootProperties().filter(p => /font/i.test(p.name) && /[a-z]/i.test(p.value) && !/^\d/.test(p.value) && !/^var\(/.test(p.value));
    }

    /* ------------------------------------------------------------
       Web fonts: the <style id="deck-editor-fonts"> block (see fonts.js)
       ------------------------------------------------------------ */
    get fonts() {
        if (!this._fonts) this._fonts = emptyFonts();
        return this._fonts;
    }
    setFonts(state) {
        this._fonts = cloneFonts(state);
        this._applyFonts();
        this.dispatchEvent(new CustomEvent('fonts'));
    }
    fontsText() { return fontsToCss(this.fonts); }
    /* Google Fonts stylesheet URLs the file itself loads (active, or commented out while hosted). */
    deckFontUrls() { const l = deckFontLinks(this.source); return [...l.active, ...l.hosted]; }
    _loadFonts() {
        const st = this.doc.getElementById(FONTS_ID);
        this._fonts = cssToFonts(st ? st.textContent : '', this.source);
        this._applyFonts();
    }
    _applyFonts() {
        if (!this.doc) return;
        const head = this.doc.head;
        let st = this.doc.getElementById(FONTS_ID);
        const css = this.fontsText();
        if (!css) { if (st) st.remove(); }
        else {
            if (!st) { st = this.doc.createElement('style'); st.id = FONTS_ID; head.insertBefore(st, this.doc.getElementById(OVERRIDES_ID)); }
            if (st.textContent !== css) st.textContent = css;
        }
        // While the file's own Google links are commented out (hosted), the live document
        // has none of them; "Use Google Fonts again" needs them back until the next reload.
        const restored = Array.from(head.querySelectorAll('link[data-ed-restored]'));
        if (this.fonts.hosted) restored.forEach(l => l.remove());
        else for (const href of deckFontLinks(this.source).hosted) {
            if (restored.some(l => l.href === href) || Array.from(head.querySelectorAll('link[rel=stylesheet]')).some(l => l.getAttribute('href') === href)) continue;
            const link = this.doc.createElement('link');
            link.rel = 'stylesheet'; link.href = href; link.setAttribute('data-ed-restored', '');
            head.insertBefore(link, st || this.doc.getElementById(OVERRIDES_ID));
        }
    }
}

/* Files saved by versions up to 0.1.2 could carry the tail of a script twice: the save
   spliced the body at the first "</body>" in the text, which the deck runtime's header
   comment contained, so the rest of that script (up to a stray </script>) was appended
   as visible text. A closing script tag with no script open before it marks such a tail;
   the text from the previous tag to that stray tag is dropped. */
function repairStrayScriptTails(text) {
    if (!/<\/script>/i.test(text)) return text;
    let out = '', depth = 0, last = 0, lastTagEnd = 0;
    for (const m of text.matchAll(/<script\b[^>]*>|<\/script\s*>/gi)) {
        if (m[0][1] !== '/') { depth = 1; lastTagEnd = m.index + m[0].length; continue; }
        if (depth === 1) { depth = 0; lastTagEnd = m.index + m[0].length; continue; }
        // A stray close: drop everything since the previous tag up to and including it.
        out += text.slice(last, lastTagEnd);
        last = m.index + m[0].length;
        lastTagEnd = last;
    }
    return out + text.slice(last);
}

/* Replace the <body>...</body> part of the original file text with the new body markup.
   Returns null when the original cannot be split cleanly (then the caller falls back
   to serialising the whole document). */
function spliceBody(source, bodyHtml) {
    if (!source) return null;
    const open = /<body(?=[\s>])[^>]*>/i.exec(source);
    // The real closing tag is the last one: a script in the body may mention "</body>" in a string or comment.
    let close = null;
    for (const m of source.slice(open ? open.index : 0).matchAll(/<\/body\s*>/gi)) close = m;
    if (!open || !close) return null;
    const closeIndex = open.index + close.index + close[0].length;
    // Whitespace that preceded </body> in the source, e.g. "\n"
    const tail = (/\s*$/.exec(source.slice(open.index + open[0].length, open.index + close.index)) || [''])[0];
    bodyHtml = bodyHtml.replace(/\s*<\/body>\s*$/i, tail.replace(/\r/g, '') + '</body>');
    bodyHtml = restoreBareAttributes(source, bodyHtml);
    if (/\/>/.test(source)) bodyHtml = selfCloseSvg(bodyHtml);
    // Keep the file's line endings, judged by its first line break: a pasted script
    // (the runtime) may carry the other kind, and must not flip the whole body.
    const eol = (/\r?\n/.exec(source) || ['\n'])[0];
    bodyHtml = bodyHtml.replace(/\r?\n/g, eol);
    return source.slice(0, open.index) + bodyHtml + source.slice(closeIndex);
}

/* The DOM serialiser writes bare attributes as name="" (data-edit -> data-edit="").
   Attributes that appear bare anywhere in the original source are written bare
   again, so an untouched deck diffs cleanly against its previous version. Only
   attribute positions inside start tags are touched, never text or scripts. */
const TAG_RE = /<[a-zA-Z][^<>]*>/g;

/* The DOM serialiser writes <path ...></path>; authors write <path .../>. Inside inline
   SVG both mean the same, so empty elements are written self-closed again (not the
   <svg> root itself, which authors leave as an open/close pair). */
function selfCloseSvg(html) {
    return html.replace(/<svg\b[\s\S]*?<\/svg>/gi, block =>
        block.replace(/<(?!svg\b)([a-zA-Z][\w:-]*)([^<>]*?)\s*><\/\1>/g, '<$1$2/>'));
}
const BOOLEAN_ATTRS = ['hidden', 'disabled', 'checked', 'readonly', 'required', 'selected', 'multiple', 'autoplay', 'controls', 'loop', 'muted', 'async', 'defer', 'open', 'novalidate', 'autofocus', 'playsinline', 'allowfullscreen',
    'data-edit', 'data-fragment', 'data-auto-animate', 'data-group', 'data-generated', 'data-code'];   // the deck contract's own flags
function restoreBareAttributes(source, html) {
    const bare = new Set(BOOLEAN_ATTRS);
    for (const tag of source.match(TAG_RE) || []) {
        for (const m of tag.matchAll(/\s([a-zA-Z_:][-\w:.]*)(?=[\s/>])/g)) bare.add(m[1].toLowerCase());
    }
    return html.replace(TAG_RE, (tag) => tag.replace(/\s([a-zA-Z_:][-\w:.]*)=""(?=[\s/>])/g, (m, name) => bare.has(name.toLowerCase()) ? ' ' + name : m));
}

/* ------------------------------------------------------------
   Theme overrides <-> CSS text
   ------------------------------------------------------------ */
function cloneRules(rules) {
    const out = {};
    for (const [sel, decl] of Object.entries(rules)) if (Object.keys(decl).length) out[sel] = { ...decl };
    return out;
}
function cloneSize(size) {
    if (!size || !(size.w > 0) || !(size.h > 0)) return null;
    return { w: Math.round(size.w), h: Math.round(size.h) };
}

/* State -> the text of the override block ('' when there is nothing to write). */
export function overridesToCss(o, animCss = '') {
    const lines = [];
    const vars = Object.entries(o.vars || {}).filter(([, v]) => v != null && String(v).trim() !== '');
    if (vars.length) lines.push(':root {\n' + vars.map(([k, v]) => `    --${k}: ${v};`).join('\n') + '\n}');
    for (const [sel, decl] of Object.entries(o.rules || {})) {
        const props = Object.entries(decl).filter(([, v]) => v != null && String(v).trim() !== '');
        if (props.length) lines.push(`${expandRuleKey(sel)} {\n` + props.map(([p, v]) => `    ${p}: ${v};`).join('\n') + '\n}');
    }
    if (o.size) lines.push(`${SIZE_MARKER}\n.deck-stage, .deck-stage .slide { width: ${o.size.w}px; height: ${o.size.h}px; }\n@media print { .deck-stage { height: auto; } }`);
    if (animCss) lines.push(animCss);
    const custom = (o.css || '').trim();
    if (custom) lines.push(CUSTOM_MARKER + '\n' + custom);
    if (!lines.length) return '';
    return OVERRIDES_HEADER + '\n' + lines.join('\n') + '\n';
}

/* Base-rule keys are selectors relative to a slide: "h1" means ".deck-stage .slide h1".
   A part starting with "&" attaches to the slide itself ("&:not(.visible) .reveal");
   comma-separated parts are each expanded. ruleKeyFor is the inverse, null when a
   selector is not one of ours. */
function expandRuleKey(key) {
    return key.split(',').map(p => { p = p.trim(); return p.startsWith('&') ? BASE_SELECTOR_PREFIX.trim() + p.slice(1) : (BASE_SELECTOR_PREFIX + p).trim(); }).join(', ');
}
function ruleKeyFor(selectorText) {
    const base = BASE_SELECTOR_PREFIX.trim();
    const parts = selectorText.split(',').map(p => p.trim());
    const keys = parts.map(p => p === base ? '' : p.startsWith(BASE_SELECTOR_PREFIX) ? p.slice(BASE_SELECTOR_PREFIX.length).trim() : p.startsWith(base) ? '&' + p.slice(base.length) : null);
    if (keys.some(k => k == null)) return null;
    return keys.join(', ');
}

/* Text of an override block -> state. The generated part is parsed with the CSSOM
   (in the editor's own document); the free text after the marker is kept as is. */
export function cssToOverrides(text) {
    const state = { vars: {}, rules: {}, css: '', size: null };
    if (!text) return state;
    // The animation section is regenerated from the slides, so it is not parsed back.
    const a0 = text.indexOf(ANIM_MARK_START), a1 = text.indexOf(ANIM_MARK_END);
    if (a0 >= 0 && a1 > a0) text = text.slice(0, a0) + text.slice(a1 + ANIM_MARK_END.length);
    const m0 = text.indexOf(MASTER_MARK_START), m1 = text.indexOf(MASTER_MARK_END);
    if (m0 >= 0 && m1 > m0) text = text.slice(0, m0) + text.slice(m1 + MASTER_MARK_END.length);
    const s0 = text.indexOf(SCRIPTS_MARK_START), s1 = text.indexOf(SCRIPTS_MARK_END);
    if (s0 >= 0 && s1 > s0) text = text.slice(0, s0) + text.slice(s1 + SCRIPTS_MARK_END.length);
    const e0 = text.indexOf(ELEMENT_MARK_START), e1 = text.indexOf(ELEMENT_MARK_END);
    if (e0 >= 0 && e1 > e0) text = text.slice(0, e0) + text.slice(e1 + ELEMENT_MARK_END.length);
    const i = text.indexOf(CUSTOM_MARKER);
    const generated = i >= 0 ? text.slice(0, i) : text;
    state.css = i >= 0 ? text.slice(i + CUSTOM_MARKER.length).trim() : '';
    const st = document.createElement('style');
    st.textContent = generated;
    document.head.appendChild(st);
    try {
        for (const rule of Array.from(st.sheet.cssRules)) {
            if (!rule.selectorText) continue;
            if (rule.selectorText === ':root') {
                for (const p of Array.from(rule.style)) if (p.startsWith('--')) state.vars[p.slice(2)] = rule.style.getPropertyValue(p).trim();
            } else if (rule.selectorText === '.deck-stage, .deck-stage .slide') {
                state.size = cloneSize({ w: parseFloat(rule.style.getPropertyValue('width')), h: parseFloat(rule.style.getPropertyValue('height')) });
            } else if (ruleKeyFor(rule.selectorText) != null) {
                const sel = ruleKeyFor(rule.selectorText);
                state.rules[sel] = {};
                for (const p of Array.from(rule.style)) state.rules[sel][p] = rule.style.getPropertyValue(p).trim();
            } else {
                state.css = (rule.cssText + '\n' + state.css).trim();      // not ours: keep it as custom text
            }
        }
    } finally { st.remove(); }
    return state;
}

/* Put an editor-owned <style id> block into the head of the file text: replace an
   existing one, insert before `before` (default: </head>), or remove it when there
   is nothing left to write. */
function spliceHeadStyle(text, id, css, before = /<\/head\s*>/i) {
    const re = new RegExp(`\\r?\\n?[ \\t]*<style id="${id}">[\\s\\S]*?</style>[ \\t]*`, 'i');
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const block = css ? `${nl}<style id="${id}">${nl}${css.replace(/\r?\n/g, nl)}</style>` : '';
    if (re.test(text)) return text.replace(re, block);
    if (!css) return text;
    const i = text.search(before);
    return i < 0 ? text : text.slice(0, i) + block.replace(/^\r?\n/, '') + nl + text.slice(i);
}
