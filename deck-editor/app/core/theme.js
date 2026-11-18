/* ============================================================
   theme.js - the Theme panel: the deck's base styling in one place.

   Everything here writes into the deck's override block (see
   document.js): the :root variables the deck defines, base text
   styles for h1/h2/h3/p/li/body, and free custom CSS. Fields show
   the deck's own value as the default and are highlighted when an
   override is set; the "x" clears one override. Every change is one
   undo step. Named themes (the whole override set) are saved on the
   server and can be applied to any deck that uses the same names;
   the bundled designs' looks (looks.js) restyle any deck by role.

   The panel speaks in plain words: variables show what they do
   ("Text 2", "Side margin"), with the CSS name in the tooltip only.
   ============================================================ */
import { css, plainName } from './dom.js';
import { toHex } from './inspector.js';
import { replay } from './animate.js';
import { loader } from './loader.js';
import { STAGE_W, STAGE_H, STAGE_SIZES } from './document.js';
import { firstFamily, availableWeights, ensureGoogle, commitFonts, cloneFonts, faceFamilies, parseGoogleUrl, googleUrl, withoutFamilyFaces, deckFontLinks, usedWeights, knownGoogle, rememberGoogle } from './fonts.js';
import { loadLooks, lookVars, lookStrip, lookFont } from './looks.js';

const BASE_TARGETS = [
    ['h1', 'Title'], ['h2', 'Heading'], ['h3', 'Subheading'],
    ['p', 'Paragraph'], ['li', 'List item'], ['', 'Slide text'],
];
const BASE_PROPS = [
    ['font-family', 'Font', 'font'], ['font-size', 'Size', 'px'], ['font-weight', 'Weight', 'weight'],
    ['color', 'Colour', 'colour'], ['line-height', 'Line height', 'num'], ['letter-spacing', 'Spacing', 'px'],
];
const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/* Motion: the deck's reveal variables (from the blank template) and the slide
   transition. Decks made before --stagger / --reveal-y existed get the
   compatibility rules below, which make the template's reveal read them. */
const MOTION_VARS = ['dur', 'ease-out', 'stagger', 'reveal-y'];
const MOTION_DEFAULTS = { dur: '0.7s', 'ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)', stagger: '0.12s', 'reveal-y': '28px' };
const MOTION_EASES = [
    ['cubic-bezier(0.16, 1, 0.3, 1)', 'Smooth'], ['cubic-bezier(0.22, 1, 0.36, 1)', 'Soft'], ['cubic-bezier(0.2, 0.8, 0.2, 1)', 'Snappy'],
    ['ease-in-out', 'Gentle'], ['cubic-bezier(0.34, 1.56, 0.64, 1)', 'Overshoot'], ['linear', 'Linear'],
];
const TRANSITIONS = [['', 'None'], ['fade', 'Fade (cross-fade)'], ['slide', 'Slide (push)'], ['up', 'Up (push)'], ['zoom', 'Zoom']];
const COMPAT_RULES = {
    '.reveal, .reveal-img, .reveal-right, [class^="reveal-"]': { 'transition-delay': 'calc(var(--i, 0) * var(--stagger, 0.12s))' },
    '&:not(.visible) .reveal': { transform: 'translateY(var(--reveal-y, 28px))' },
    '&:not(.visible) .reveal-img': { transform: 'translateY(calc(var(--reveal-y, 28px) * 0.65)) scale(0.985)' },
    '&:not(.visible) .reveal-right': { transform: 'translateX(calc(var(--reveal-y, 28px) * 1.4))' },
};

export class ThemePanel {
    constructor(app, root) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.root = root;
        this.themes = {};
        this.pending = null;          // override state before a live preview began
        this._build();
        this._bind();
    }

    /* ------------------------------------------------------------
       Markup
       ------------------------------------------------------------ */
    _build() {
        this.root.innerHTML = `
        <section class="insp-section">
          <h4>Themes</h4>
          <div class="insp-hint" style="margin:0 0 6px">Restyle the whole deck in one go. Undo puts it back.</div>
          <div id="thSaved" hidden>
            <div class="theme-sub">Your themes</div>
            <div class="theme-looks" id="thSavedList"></div>
          </div>
          <details class="theme-looks-fold" id="thLooksFold" open>
            <summary class="theme-sub">Looks from the designs</summary>
            <div class="insp-hint" style="margin:0 0 6px">The colours, fonts and margins of each design that comes with Diapo.</div>
            <div class="theme-looks" id="thLooks"></div>
          </details>
          <div class="insp-hint insp-state" id="thLookHint"></div>
          <div class="theme-row">
            <input id="thName" type="text" placeholder="Name for the current styling" spellcheck="false" aria-label="Name for a new theme">
            <button class="mini-btn" data-act="save" title="Save the colours, fonts, sizes and text styles set in this panel as a theme of your own">Save</button>
          </div>
          <div class="theme-row">
            <button class="mini-btn" data-act="reset" title="Clear everything set in this panel; the deck uses its own styles again">Reset to deck defaults</button>
          </div>
          <div class="insp-hint">A theme of your own keeps the colours, fonts, sizes and text styles set below.</div>
        </section>
        <section class="insp-section">
          <h4>Fonts in this deck</h4>
          <div id="thFonts"></div>
          <div class="theme-row" id="thFontActs">
            <button class="mini-btn" data-act="host" title="Download the font files into a fonts/ folder next to the deck, so it works without a network connection">Download into fonts/</button>
            <button class="mini-btn" data-act="embed" title="Write the font files into the HTML itself (Latin and Greek subsets), for a single-file deck">Embed in the file</button>
            <button class="mini-btn" data-act="unhost" title="Drop the downloaded faces and load the fonts from Google again">Use Google Fonts again</button>
          </div>
          <div class="theme-row">
            <button class="mini-btn" data-act="addfiles" title="Add .woff2, .woff, .ttf or .otf files of your own; they are copied into fonts/ next to the deck">Add font files...</button>
          </div>
          <div class="insp-hint insp-state" id="thFontHint"></div>
        </section>
        <section class="insp-section" id="thVars"></section>
        <section class="insp-section" id="thMotion">
          <h4>Motion</h4>
          <div class="theme-sub">Slide transition</div>
          <div class="theme-row">
            <select id="thTrans" title="How one slide gives way to the next when presenting (the deck default; a slide can have its own in the properties panel)">${TRANSITIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
            <button class="mini-btn" data-act="playTrans" title="Play the transition into this slide">Play</button>
          </div>
          <div class="theme-slider" data-motion="transDur"><label>Duration</label><input type="range" id="thTransDur" min="0.15" max="1.5" step="0.05"><output id="thTransDurV"></output></div>
          <div class="theme-sub">Element reveal</div>
          <div class="insp-hint" style="margin:0 0 6px">What eases in when a slide appears.</div>
          <div class="theme-slider" data-motion="dur"><label>Duration</label><input type="range" id="thDur" min="0.1" max="2" step="0.05"><output></output><i class="insp-clear" role="button" tabindex="0" title="Back to the deck's value">&times;</i></div>
          <div class="theme-slider" data-motion="ease-out"><label>Easing</label><select id="thEase">${MOTION_EASES.map(([v, l]) => `<option value="${esc(v)}">${l}</option>`).join('')}<option value="custom">Custom...</option></select><i class="insp-clear" role="button" tabindex="0" title="Back to the deck's value">&times;</i></div>
          <div class="theme-row" id="thEaseCustomRow" hidden><input id="thEaseCustom" type="text" class="theme-text" spellcheck="false" placeholder="cubic-bezier(0.16, 1, 0.3, 1)"></div>
          <div class="theme-slider" data-motion="stagger"><label>Stagger</label><input type="range" id="thStagger" min="0" max="0.4" step="0.01"><output></output><i class="insp-clear" role="button" tabindex="0" title="Back to the deck's value">&times;</i></div>
          <div class="theme-slider" data-motion="reveal-y"><label>Distance</label><input type="range" id="thDist" min="0" max="120" step="1"><output></output><i class="insp-clear" role="button" tabindex="0" title="Back to the deck's value">&times;</i></div>
          <div class="theme-row">
            <button class="mini-btn" data-act="replayReveal" title="Play this slide's reveal again">Replay the reveal</button>
          </div>
          <div class="insp-hint insp-state" id="thMotionHint"></div>
        </section>
        <section class="insp-section">
          <h4>Slide size</h4>
          <div class="theme-row">
            <select id="thSize" title="The size every slide is laid out at; when you present, the slides fit themselves to the screen">
              ${STAGE_SIZES.map(z => `<option value="${z.w}x${z.h}">${z.name} · ${z.w} × ${z.h}</option>`).join('')}
              <option value="custom">Custom...</option>
            </select>
          </div>
          <div class="theme-row theme-size" id="thSizeCustom" hidden>
            <input id="thSizeW" type="number" min="100" max="20000" step="1" aria-label="Width in px"> <span>×</span>
            <input id="thSizeH" type="number" min="100" max="20000" step="1" aria-label="Height in px"> <span class="unit">px</span>
            <button class="mini-btn" data-act="sizeApply">Apply</button>
          </div>
          <div class="insp-hint insp-state" id="thSizeHint"></div>
        </section>
        <section class="insp-section">
          <h4>Base text styles</h4>
          <div class="insp-hint" style="margin:0 0 8px">How each kind of text looks on every slide. Leave a field empty to keep the deck's own style; text you styled one by one keeps its own.</div>
          <div id="thBase"></div>
        </section>
        <section class="insp-section">
          <h4>Custom CSS</h4>
          <textarea id="thCss" class="insp-notes theme-css" rows="8" spellcheck="false" aria-label="Custom CSS" placeholder=".slide h2 { text-transform: uppercase; }"></textarea>
          <div class="insp-hint">For CSS of your own. Applied after a short pause and saved with the deck.</div>
        </section>
        <details class="insp-section insp-code" id="thCode">
          <summary><h4>Deck CSS</h4></summary>
          <div class="insp-hint">The deck's own stylesheet, as written in its file: colours, sizes and fonts that the fields above do not show. What you set above is applied on top of it.</div>
          <div id="thCodeBody"></div>
          <div class="theme-row">
            <button class="mini-btn" data-act="codeApply" title="Apply the changes (also on leaving the box, or Ctrl+Enter)">Apply</button>
            <span class="insp-hint" id="thCodeState" style="margin:0"></span>
          </div>
        </details>`;
        this.$ = (id) => this.root.querySelector('#' + id);
    }

    /* ------------------------------------------------------------
       Rendering the variable and base-style fields for the open deck
       ------------------------------------------------------------ */
    render() {
        if (!this.deck.isOpen) return;
        this._renderVars();
        this._renderMotion();
        this._renderSize();
        this._renderBase();
        this._renderFonts();
        this._syncCss();
        this._renderCode();
        this._renderPresets();
    }

    /* ---- Deck CSS ---------------------------------------------- */
    /* One box per <style> block of the deck's own file (the editor's blocks are not among them),
       then the local stylesheets the deck links, read-only: the editor saves the deck file only.
       The boxes are not rebuilt while one has the focus, so typing is never interrupted. */
    _renderCode() {
        const det = this.$('thCode'), body = this.$('thCodeBody');
        if (!det.open) return;
        const blocks = this.deck.deckStyles();
        const boxes = Array.from(body.querySelectorAll('.th-deckcss'));
        const same = boxes.length === blocks.length && boxes.every((ta, i) => +ta.dataset.i === blocks[i].index);
        if (!same) {
            body.innerHTML = blocks.map((b, n) => `
                <div class="insp-code-label"><span>${blocks.length > 1 ? `Style block ${n + 1} of ${blocks.length}` : 'Style block'}</span><span class="th-deckcss-n" data-i="${b.index}"></span></div>
                <textarea class="insp-notes theme-css th-deckcss" data-i="${b.index}" wrap="off" spellcheck="false" aria-label="The deck's CSS, block ${n + 1}"></textarea>`).join('') + '<div id="thCodeLinks"></div>';
            if (!blocks.length) body.insertAdjacentHTML('afterbegin', '<div class="insp-hint">This deck has no style block of its own in its head.</div>');
        }
        blocks.forEach((b, n) => {
            const ta = body.querySelectorAll('.th-deckcss')[n];
            // Not while the box holds text that has not been applied yet; a box left as it was applied follows undo and redo even when focused.
            if (ta.value !== b.css && (document.activeElement !== ta || ta.value === ta.dataset.applied)) ta.value = b.css;
            ta.dataset.applied = b.css;
            if (!same) ta.rows = Math.max(8, Math.min(26, b.css.split('\n').length + 1));
            const note = body.querySelector(`.th-deckcss-n[data-i="${b.index}"]`);
            const h = cssHealth(b.css, b.el.sheet);
            note.textContent = h.text;
            note.classList.toggle('warn', h.warn);
        });
        this._renderLinks();
    }
    async _renderLinks() {
        const box = this.$('thCodeLinks');
        if (!box) return;
        const hrefs = Array.from(this.deck.doc.head.querySelectorAll('link[rel~=stylesheet]')).map(l => l.getAttribute('href') || '')
            .filter(h => h && !/^(https?:)?\/\/|^data:/i.test(h));
        if (!hrefs.length) { box.innerHTML = ''; return; }
        const token = this._linksToken = (this._linksToken || 0) + 1;
        const parts = [];
        for (const h of hrefs) {
            let text = '';
            try { const r = await fetch(new URL(h, this.deck.doc.baseURI).href, { cache: 'no-store' }); text = r.ok ? await r.text() : '(could not be read)'; } catch (e) { text = '(could not be read)'; }
            parts.push(`<div class="insp-code-label"><span>${esc(h)}</span><span>read-only</span></div><pre class="insp-code-pre">${esc(text)}</pre>`);
        }
        if (token !== this._linksToken || !this.$('thCodeLinks')) return;
        box.innerHTML = parts.join('') + '<div class="insp-hint">Linked stylesheets are separate files; the editor saves the deck file only, so edit these in a text editor. To change them here, copy the rules into the deck CSS above.</div>';
    }
    /* Apply every box that differs from the deck as one undo step. */
    _applyCode() {
        const now = new Map(this.deck.deckStyles().map(b => [b.index, b.css]));
        const changes = [];
        for (const ta of this.root.querySelectorAll('.th-deckcss')) {
            const i = +ta.dataset.i;
            if (now.has(i) && now.get(i) !== ta.value) changes.push({ i, before: now.get(i), after: ta.value });
        }
        if (!changes.length) return false;
        const deck = this.deck;
        const run = (key) => deck.withoutTransitions(() => { for (const c of changes) deck.setDeckStyle(c.i, c[key]); });
        run('after');
        this.history.push({ label: 'Deck CSS', undo() { run('before'); }, redo() { run('after'); } });
        this.$('thCodeState').textContent = 'Applied.';
        this.render();
        return true;
    }

    /* ---- Motion ------------------------------------------------ */
    /* The value in force for a motion variable: the override, else the deck's own, else the template default. */
    _motionValue(name) {
        const o = this.deck.overrides;
        if (o.vars[name] != null && String(o.vars[name]).trim() !== '') return String(o.vars[name]).trim();
        const own = this.deck.rootProperties({ effective: false }).find(p => p.name === name);
        return own ? own.value : MOTION_DEFAULTS[name];
    }
    /* Decks made from the current template read --stagger and --reveal-y themselves. */
    _deckReadsMotionVars() {
        const own = (this.deck.source || '').replace(/<style id="deck-editor-overrides">[\s\S]*?<\/style>/i, '');   // not our own rules
        return /var\(--stagger\b/.test(own);
    }
    _renderMotion() {
        const $ = this.$, o = this.deck.overrides, stage = this.deck.stage;
        const active = document.activeElement;
        $('thTrans').value = stage.getAttribute('data-transition') || '';
        const tdur = parseFloat(stage.getAttribute('data-transition-duration')) || 0.5;
        if (active !== $('thTransDur')) $('thTransDur').value = tdur;
        $('thTransDurV').textContent = tdur.toFixed(2) + ' s';
        const rt = this.deck.win.deckRuntime;
        this.root.querySelector('[data-act=playTrans]').disabled = !$('thTrans').value;
        const num = (v) => parseFloat(v) || 0;
        const rows = { dur: ['thDur', (v) => num(v).toFixed(2) + ' s'], stagger: ['thStagger', (v) => num(v).toFixed(2) + ' s'], 'reveal-y': ['thDist', (v) => Math.round(num(v)) + ' px'] };
        for (const [name, [id, fmt]] of Object.entries(rows)) {
            const v = this._motionValue(name);
            if (active !== $(id)) $(id).value = num(v);
            $(id).nextElementSibling.textContent = fmt(v);
            $(id).closest('.theme-slider').classList.toggle('set', o.vars[name] != null);
        }
        const ease = this._motionValue('ease-out');
        const known = MOTION_EASES.some(([v]) => v === ease);
        $('thEase').value = known ? ease : 'custom';
        $('thEaseCustomRow').hidden = known;
        if (active !== $('thEaseCustom')) $('thEaseCustom').value = known ? '' : ease;
        $('thEase').closest('.theme-slider').classList.toggle('set', o.vars['ease-out'] != null);
        const hasReveal = !!this.deck.stage.querySelector('.reveal, .reveal-img, .reveal-right, [class^="reveal-"]');
        const notes = [];
        if (!(rt && rt.playTransition)) notes.push('Transitions need the presentation features script (Presenter menu).');
        if (!hasReveal) notes.push('No element in this deck uses the reveal classes, so the reveal settings change nothing here.');
        else if (!this._deckReadsMotionVars() && (o.vars.stagger != null || o.vars['reveal-y'] != null)) notes.push('This deck is older than the stagger and distance settings, so the editor adds a small rule that makes its reveal follow them.');
        $('thMotionHint').textContent = notes.join(' ');
    }
    /* Motion variables go into :root like any other; the compatibility rules come and go with them. */
    _setMotion(name, value, commit) {
        const mutate = (o) => {
            if (value == null) delete o.vars[name]; else o.vars[name] = value;
            const need = !this._deckReadsMotionVars() && (o.vars.stagger != null || o.vars['reveal-y'] != null);
            for (const [k, decl] of Object.entries(COMPAT_RULES)) { if (need) o.rules[k] = { ...decl }; else delete o.rules[k]; }
        };
        if (commit) this._change('Motion: ' + name, mutate); else this._preview(mutate);
        if (!commit) this._renderMotion();
    }
    _setTransition(attr, value, label) {
        this.history.attr(this.deck.stage, attr, value, label);
        this._renderMotion();
        this.app.inspector.sync();
    }
    _playTransition() {
        const rt = this.deck.win.deckRuntime;
        if (!rt || !rt.playTransition) { this.app.toast('Transitions need the presentation features script: Presenter menu, "Add presentation features to this deck".', { ms: 4000 }); return; }
        const slides = this.deck.slides, i = this.deck.current;
        const from = slides[i - 1] || slides[i + 1] || null;
        rt.playTransition(slides[i], !!slides[i - 1], from);
    }
    _replayReveal() {
        const s = this.deck.currentSlide; if (!s) return;
        s.classList.remove('visible');
        void s.offsetWidth;
        requestAnimationFrame(() => { s.classList.add('visible'); replay(this.deck, null); });
    }

    /* Slide size: the presets, or the custom fields when the deck is another size. */
    _renderSize() {
        const w = this.deck.stageW, h = this.deck.stageH, key = `${w}x${h}`;
        const sel = this.$('thSize');
        const preset = STAGE_SIZES.some(z => `${z.w}x${z.h}` === key);
        sel.value = preset ? key : 'custom';
        this.$('thSizeCustom').hidden = preset;
        if (!preset || document.activeElement !== this.$('thSizeW') && document.activeElement !== this.$('thSizeH')) { this.$('thSizeW').value = w; this.$('thSizeH').value = h; }
        const notes = [];
        if (w !== STAGE_W || h !== STAGE_H) notes.push(`Elements keep their positions in px, so anything past the new edge is clipped: move it back in. Thumbnails, guides, new layouts and the PDF follow the size.`);
        else notes.push(`Every slide is laid out at this size and saved with the deck; when you present, the slides fit themselves to the screen.`);
        if ((w !== STAGE_W || h !== STAGE_H) && this.deck.scaleScriptAssumesDefault()) notes.push(`This deck's own script assumes 1920 × 1080 when presenting outside the editor.`);
        this.$('thSizeHint').textContent = notes.join(' ');
    }
    _setSize(w, h) {
        w = Math.round(+w); h = Math.round(+h);
        if (!(w >= 100 && w <= 20000 && h >= 100 && h <= 20000)) { this.app.toast('Width and height must be between 100 and 20000 px', { error: true }); return; }
        if (w === this.deck.stageW && h === this.deck.stageH) return;
        this._change(`Slide size ${w} × ${h}`, (o) => { o.size = (w === STAGE_W && h === STAGE_H) ? null : { w, h }; });
        // Only a deck that leaves the default needs its controller to read the stage's size.
        if (w !== STAGE_W || h !== STAGE_H) this.deck.adaptScaleScript();
        this._renderSize();
    }

    /* Web fonts: what the deck loads and from where, plus self-hosting. */
    _renderFonts() {
        const deck = this.deck, fonts = deck.fonts;
        const faces = faceFamilies(fonts.faces);
        const links = deckFontLinks(deck.source);
        const rows = new Map();     // family -> {weights, italics, source, removable}
        const put = (fam, g, source, removable) => {
            const r = rows.get(fam) || { weights: new Set(), italics: new Set(), source, removable: false };
            (g.weights || []).forEach(w => r.weights.add(w)); (g.italics || []).forEach(w => r.italics.add(w));
            r.removable = r.removable || removable;
            rows.set(fam, r);
        };
        for (const url of [...links.active, ...links.hosted]) for (const [fam, g] of Object.entries(parseGoogleUrl(url))) put(fam, g, 'google', false);
        const own = new Set(rows.keys());      // families the file loads itself cannot be removed here
        for (const [fam, g] of Object.entries(fonts.google)) put(fam, g, 'google', !own.has(fam));
        for (const [fam, f] of faces) { put(fam, { weights: [...f.weights], italics: [...f.italics] }, f.embedded ? 'embedded' : 'files', false); rows.get(fam).source = f.embedded ? 'embedded' : 'files'; }
        for (const [fam, f] of faceFamilies(fonts.own)) { put(fam, { weights: [...f.weights], italics: [...f.italics] }, f.embedded ? 'own-embedded' : 'own', true); rows.get(fam).source = f.embedded ? 'own-embedded' : 'own'; }
        const label = { google: 'Google Fonts, loaded online', files: 'in fonts/ next to the deck', embedded: 'embedded in the file', own: 'your file, in fonts/', 'own-embedded': 'your file, embedded' };
        this.$('thFonts').innerHTML = rows.size ? Array.from(rows, ([fam, r]) => `<div class="theme-fontrow">
            <b style="font-family:${esc(stackOf(fam))}">${esc(fam)}</b>
            <span>${[...r.weights].sort((a, b) => a - b).join(' ')}${r.italics.size ? ' + italic' : ''} <i>${label[r.source]}</i></span>
            ${r.removable ? `<button class="insp-clear" data-remove="${esc(fam)}" title="Remove this font from the deck">&times;</button>` : ''}
          </div>`).join('') : '<div class="insp-hint insp-state">This deck uses only system fonts. Pick a Google font in the properties panel or under Fonts below to add one.</div>';
        const online = [...rows.values()].filter(r => r.source === 'google').length;
        const ownFiles = /url\(fonts\//.test(fonts.own);
        const acts = this.$('thFontActs');
        acts.hidden = !rows.size;
        acts.querySelector('[data-act=host]').hidden = !online && !fonts.faces;
        acts.querySelector('[data-act=embed]').hidden = !online && !fonts.faces && !ownFiles;
        acts.querySelector('[data-act=unhost]').hidden = !fonts.faces;
        acts.querySelector('[data-act=host]').textContent = fonts.faces && online ? 'Download again' : 'Download into fonts/';
        acts.querySelector('[data-act=embed]').textContent = fonts.faces && online ? 'Embed again' : 'Embed in the file';
        let hint = '';
        if (!rows.size) hint = '';
        else if (!fonts.faces && !online) hint = ownFiles ? 'Your font files are in fonts/ next to the deck: keep the folder together when you copy it, or embed them.' : 'Your font files are inside the HTML: the deck needs nothing else.';
        else if (!fonts.faces) hint = 'These fonts load from Google when the deck opens, so presenting without a connection falls back to system fonts. Download or embed them to make the deck self-contained.';
        else if (online) hint = `${online} ${online === 1 ? 'family still loads' : 'families still load'} from Google. Download or embed again to include ${online === 1 ? 'it' : 'them'}.`;
        else hint = faces.size && [...faces.values()].some(f => f.embedded) ? 'The font files are inside the HTML: the deck needs nothing else.' : 'The font files are in fonts/ next to the deck: keep the folder together when you copy it.';
        this.$('thFontHint').textContent = hint;
    }
    async _hostFonts(embed) {
        const deck = this.deck;
        const urls = [...deck.deckFontUrls(), googleUrl(deck.fonts.google)].filter(Boolean);
        const ownFiles = embed && /url\(fonts\//.test(deck.fonts.own);
        if (!urls.length && !ownFiles) { this.app.toast('No fonts to ' + (embed ? 'embed' : 'download')); return; }
        const b = this.$('thFontActs').querySelector(embed ? '[data-act=embed]' : '[data-act=host]');
        b.disabled = true; b.innerHTML = loader() + (embed ? 'Embedding...' : 'Downloading...');     // render() puts the label back
        try {
            const next = cloneFonts(deck.fonts);
            let msg = '';
            if (urls.length) {
                const res = await this.app.api.hostFonts(deck.file, urls, embed);
                next.faces = res.css; next.hosted = true;
                msg = `${res.files} font ${res.files === 1 ? 'file' : 'files'} (${Math.round(res.bytes / 1024)} KB) ${embed ? 'embedded in the deck' : 'saved in fonts/'}`;
            }
            if (ownFiles) {
                next.own = (await this.app.api.embedOwnFonts(deck.file, deck.fonts.own)).css;
                msg += (msg ? '; ' : '') + 'your own font files embedded';
            }
            commitFonts(deck, this.history, next, embed ? 'Embed fonts' : 'Download fonts');
            this.app.toast(msg, { ms: 4000 });
        } catch (err) { this.app.toast(err.message, { error: true }); }
        finally { b.disabled = false; this.render(); }
    }

    _renderVars() {
        const props = this.deck.rootProperties({ effective: false }).filter(p => !MOTION_VARS.includes(p.name));   // those have the Motion section
        const o = this.deck.overrides;
        const groups = { colour: [], font: [], length: [], other: [] };
        const lookup = (n) => { const p = props.find(x => x.name === n); return p ? p.value : null; };
        for (const p of props) groups[kindOf(p.name, p.value, lookup)].push(p);
        const titles = { colour: 'Colours', font: 'Fonts', length: 'Sizes and spacing', other: 'Other settings' };
        let html = '';
        for (const [kind, list] of Object.entries(groups)) {
            if (!list.length && kind !== 'colour') continue;
            html += `<h4>${titles[kind]}</h4>`;
            for (const p of list) {
                const set = o.vars[p.name] != null;
                const value = set ? o.vars[p.name] : p.value;
                html += `<div class="theme-var${set ? ' set' : ''}${p.added ? ' added' : ''}" data-var="${esc(p.name)}" data-kind="${kind}">
                    <label title="--${esc(p.name)}${p.added ? ' (added in the editor)' : ': ' + esc(p.default)}">${esc(plainName(p.name))}</label>
                    ${this._fieldFor(kind, value, p.added ? '' : p.default)}
                    <i class="insp-clear" role="button" tabindex="0" title="${p.added ? 'Remove this colour' : 'Back to the deck\'s value'}">&times;</i>
                </div>`;
            }
            if (kind === 'colour') {
                // New colours: a --name variable in the override block, in every swatch row from then on.
                html += `<div class="theme-row theme-add">
                    <input type="text" id="thNewName" placeholder="Name, e.g. Brand blue" spellcheck="false" autocomplete="off" aria-label="Name of the new colour">
                    <input type="color" id="thNewColour" value="#2f6fed" aria-label="The new colour">
                    <button class="mini-btn" data-act="addcolour" title="Add a colour of your own to this deck; it appears in the colour swatches everywhere">Add</button>
                </div>`;
            }
        }
        this.$('thVars').innerHTML = html;
    }

    /* Add a colour variable. The name becomes --name (letters, digits and dashes; a
       generated one when left empty); the value is the picker's. */
    _addColour() {
        const nameField = this.$('thNewName'), colour = this.$('thNewColour').value;
        let name = nameField.value.trim().toLowerCase().replace(/^--/, '').replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
        const taken = new Set(this.deck.rootProperties().map(p => p.name));
        if (!name) { let n = 1; while (taken.has('colour-' + n)) n++; name = 'colour-' + n; }
        if (taken.has(name)) { this.app.toast(`There is already a colour called "${plainName(name)}"; pick another name or change its value in the list.`, { error: true }); nameField.focus(); nameField.select(); return; }
        this._change('Add colour ' + name, (o) => { o.vars[name] = colour; });
        nameField.value = '';
        this.app.toast(`"${plainName(name)}" added; it is in the colour swatches now.`);
    }

    _fieldFor(kind, value, def) {
        if (kind === 'colour') {
            const hex = toHex(resolveColour(this.deck, value)) || '#000000';
            // A colour that points at another one reads "Same as Background", not var(--paper); valueFromRow reads it back.
            return `<span class="theme-colour"><input type="color" value="${hex}"><input type="text" class="theme-text" value="${esc(colourText(value))}" spellcheck="false" placeholder="${esc(colourText(def))}" title="A colour (#2f6fed) or &quot;Same as&quot; and another colour's name"></span>`;
        }
        if (kind === 'font') return `<button type="button" class="theme-font" data-value="${esc(value)}" style="font-family:${esc(value)}">${esc(firstFamily(value))}</button>`;
        if (kind === 'length') {
            const m = /^(-?[\d.]+)\s*([a-z%]*)$/i.exec(String(value).trim());
            return `<span class="theme-length"><input type="number" step="1" value="${m ? m[1] : ''}" data-unit="${m ? m[2] : 'px'}"><span class="unit">${m ? m[2] || '' : ''}</span></span>`;
        }
        return `<input type="text" class="theme-text" value="${esc(value)}" spellcheck="false" placeholder="${esc(def)}">`;
    }

    /* One block per kind of text, its six fields on two lines, so the section fits the panel at
       its narrowest instead of scrolling sideways like a table would. */
    _renderBase() {
        const o = this.deck.overrides;
        let html = '<div class="theme-base">';
        for (const [sel, label] of BASE_TARGETS) {
            const sample = this.deck.doc.querySelector('.deck-stage .slide ' + (sel || ''));
            const cs = sample ? css(sample) : null;
            const decl = o.rules[sel] || {};
            const any = BASE_PROPS.some(([prop]) => decl[prop] != null);
            html += `<div class="theme-style${any ? ' set' : ''}" data-sel="${esc(sel)}"><div class="theme-style-name">${label}</div><div class="theme-style-fields">`;
            for (const [prop, plabel, kind] of BASE_PROPS) {
                const set = decl[prop] != null;
                const computed = cs ? cs.getPropertyValue(prop) : '';
                const value = set ? decl[prop] : '';
                let field;
                if (kind === 'font') field = `<button type="button" class="theme-font${value ? '' : ' is-default'}" data-value="${esc(value)}" style="font-family:${esc(value || computed)}">${value ? esc(firstFamily(value)) : 'deck'}</button>`;
                else if (kind === 'weight') {
                    const avail = availableWeights(this.deck, firstFamily(decl['font-family'] || (cs ? cs.fontFamily : '')));
                    const ws = new Set(avail ? [...avail.weights, ...avail.italics] : ALL_WEIGHTS); if (value) ws.add(+value);
                    field = `<select><option value="">deck (${cs ? cs.fontWeight : '-'})</option>${[...ws].sort((a, b) => a - b).map(w => `<option${String(value) === String(w) ? ' selected' : ''}>${w}</option>`).join('')}</select>`;
                }
                else if (kind === 'colour') field = `<span class="theme-colour"><input type="color" value="${toHex(computed) || '#000000'}"><input type="text" class="theme-text" value="${esc(value)}" placeholder="${esc(toHex(computed) || 'deck')}" spellcheck="false"></span>`;
                else if (kind === 'num') field = `<input type="number" step="0.05" value="${value ? parseFloat(value) : ''}" placeholder="${cs && cs.lineHeight !== 'normal' ? (parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)).toFixed(2) : ''}">`;
                else field = `<input type="number" step="1" value="${value ? parseFloat(value) : ''}" placeholder="${computed ? Math.round(parseFloat(computed)) || 0 : ''}" data-unit="px">`;
                html += `<div class="theme-field${set ? ' set' : ''}" data-prop="${prop}" data-kind="${kind}"><span class="theme-field-label">${plabel}</span>${field}</div>`;
            }
            html += '</div></div>';
        }
        this.$('thBase').innerHTML = html + '</div>';
        // Each field is named for screen readers by its kind of text and what it sets ("Title: Size").
        for (const f of this.$('thBase').querySelectorAll('.theme-field')) {
            const name = f.closest('.theme-style').querySelector('.theme-style-name').textContent + ': ' + f.querySelector('.theme-field-label').textContent;
            f.querySelectorAll('input, select, button').forEach(c => c.setAttribute('aria-label', name + (c.type === 'color' ? ' (picker)' : '')));
        }
    }

    _syncCss() { if (document.activeElement !== this.$('thCss')) this.$('thCss').value = this.deck.overrides.css || ''; }

    /* The user's own themes (cards with a delete button), then the designs' looks. Nothing here
       loads a font: a card shows its heading font in that font only when the editor has it already. */
    async _renderPresets() {
        try { this.themes = (await this.app.api.themes()).themes || {}; } catch (e) { this.themes = {}; }
        const names = Object.keys(this.themes).sort((a, b) => a.localeCompare(b));
        this.$('thSaved').hidden = !names.length;
        this.$('thSavedList').innerHTML = names.map(n => lookCard({ key: n, name: n, vars: this.themes[n].vars || {}, saved: true })).join('');
        const looks = await loadLooks();
        const box = this.$('thLooks');
        const html = looks.length ? looks.map(l => lookCard({ key: l.slug, name: l.name, vars: l.vars })).join('') : '<div class="insp-hint insp-state">The designs\' looks could not be read.</div>';
        if (box.innerHTML !== html) box.innerHTML = html;
    }

    /* A design's look onto this deck: its colours, fonts and margins, matched to the deck's own
       variables by role (looks.js), the Google families it needs, all as one undo step. */
    async _applyLook(slug) {
        const look = (await loadLooks()).find(l => l.slug === slug);
        if (!look || !this.deck.isOpen) return;
        const res = lookVars(this.deck, look);
        const changed = Object.keys(res.vars).length, left = res.considered - res.matched;
        const leftText = left ? (left === 1 ? '; 1 setting of this deck had no match and was left as it was' : `; ${left} settings of this deck had no match and were left as they were`) : '';
        if (!changed) {
            const msg = res.considered ? `This deck already looks like ${look.name}${leftText}.` : `This deck has no colours, fonts or margins of its own that the ${look.name} look could change.`;
            this.$('thLookHint').textContent = msg;
            this.app.toast(msg, { ms: 4000 });
            return;
        }
        const label = `${look.name} look`;
        this.history.begin(label);
        const used = usedWeights(this.deck);
        for (const fam of res.families) {
            const g = (look.google || {})[fam];
            if (!g) continue;                       // a system font, or one the deck has already
            if (!knownGoogle(fam)) rememberGoogle(fam, g);
            ensureGoogle(this.deck, this.history, fam, [...new Set([400, 700, ...used.weights, ...g.weights])], [...new Set([...used.italics, ...g.italics])]);
        }
        this._change(label, (o) => { Object.assign(o.vars, res.vars); });
        this.history.end();
        const msg = `${look.name} look applied: ${changed} ${changed === 1 ? 'setting' : 'colours, fonts and margins'} changed${leftText}.`;
        this.$('thLookHint').textContent = msg;
        this.app.toast(msg, { ms: 4000 });
    }

    _applySaved(name) {
        const t = this.themes[name];
        if (!t) return;
        this.history.begin('Apply theme ' + name);
        // A theme can name Google families this deck does not load yet.
        const used = usedWeights(this.deck);
        const fams = [...Object.entries(t.vars || {}).filter(([k, v]) => kindOf(k, String(v)) === 'font').map(([, v]) => v), ...Object.values(t.rules || {}).map(r => r['font-family']).filter(Boolean)];
        for (const v of fams) ensureGoogle(this.deck, this.history, firstFamily(v), [...new Set([400, 700, ...used.weights])], used.italics);
        this._change('Apply theme ' + name, (o) => { o.vars = { ...t.vars }; o.rules = JSON.parse(JSON.stringify(t.rules || {})); o.css = t.css || ''; });
        this.history.end();
        this.$('thLookHint').textContent = `Theme "${name}" applied.`;
    }

    /* ------------------------------------------------------------
       Changes: preview live, commit as one undo step
       ------------------------------------------------------------ */
    _snapshot() { const o = this.deck.overrides; return { vars: { ...o.vars }, rules: JSON.parse(JSON.stringify(o.rules)), css: o.css, size: o.size ? { ...o.size } : null }; }
    _preview(mutate) {
        if (!this.pending) this.pending = this._snapshot();
        const next = this._snapshot();
        mutate(next);
        this.deck.withoutTransitions(() => this.deck.setOverrides(next));
    }
    _commit(label) {
        const before = this.pending; this.pending = null;
        if (!before) return;
        const after = this._snapshot();
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        const deck = this.deck;
        this.history.push({ label, undo() { deck.setOverrides(before); }, redo() { deck.setOverrides(after); } });
        this.render();
    }
    _change(label, mutate) { this._preview(mutate); this._commit(label); }

    _bind() {
        const r = this.root;
        this.deck.addEventListener('ready', () => { this.pending = null; if (!r.hidden) this.render(); });
        this.history.addEventListener('step', () => { if (!r.hidden) this.render(); });
        this.deck.addEventListener('fonts', () => { if (!r.hidden) this._renderFonts(); });

        // Variables
        r.addEventListener('input', (e) => {
            const slider = e.target.closest('.theme-slider');
            if (slider && e.target.type === 'range') {
                if (slider.dataset.motion === 'transDur') { this.$('thTransDurV').textContent = (+e.target.value).toFixed(2) + ' s'; return; }
                this._setMotion(slider.dataset.motion, e.target.value + (slider.dataset.motion === 'reveal-y' ? 'px' : 's'), false);
                return;
            }
            const row = e.target.closest('.theme-var');
            if (row) { this._preview((o) => { o.vars[row.dataset.var] = valueFromRow(row, e.target); }); return; }
            const cell = e.target.closest('.theme-base .theme-field');
            if (cell && e.target.type !== 'text') this._previewBase(cell, e.target);
        });
        r.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'thNewName') { e.preventDefault(); this._addColour(); } });
        r.addEventListener('change', (e) => {
            const slider = e.target.closest('.theme-slider');
            if (slider && e.target.type === 'range') {
                if (slider.dataset.motion === 'transDur') { const v = +e.target.value; this._setTransition('data-transition-duration', Math.abs(v - 0.5) < 0.001 ? null : String(v), 'Transition duration'); return; }
                this._setMotion(slider.dataset.motion, e.target.value + (slider.dataset.motion === 'reveal-y' ? 'px' : 's'), true);
                return;
            }
            if (e.target.id === 'thTrans') { this._setTransition('data-transition', e.target.value || null, 'Deck transition'); return; }
            if (e.target.id === 'thEase') {
                if (e.target.value === 'custom') { this.$('thEaseCustomRow').hidden = false; this.$('thEaseCustom').focus(); return; }
                this._setMotion('ease-out', e.target.value, true); return;
            }
            if (e.target.id === 'thEaseCustom') { const v = e.target.value.trim(); if (v) this._setMotion('ease-out', v, true); return; }
            if (e.target.id === 'thSize') {
                const v = e.target.value;
                if (v === 'custom') { this.$('thSizeCustom').hidden = false; this.$('thSizeW').focus(); this.$('thSizeW').select(); return; }
                const [w, h] = v.split('x').map(Number);
                this._setSize(w, h);
                return;
            }
            const row = e.target.closest('.theme-var');
            if (row) { this._preview((o) => { o.vars[row.dataset.var] = valueFromRow(row, e.target); }); this._commit('Theme: ' + row.dataset.var); return; }
            const cell = e.target.closest('.theme-base .theme-field');
            if (cell) {
                this.history.begin('Base style');
                if (cell.dataset.kind === 'weight' && e.target.value) {
                    const sel = cell.closest('.theme-style').dataset.sel, decl = this.deck.overrides.rules[sel] || {};
                    const sample = this.deck.doc.querySelector('.deck-stage .slide ' + sel);
                    ensureGoogle(this.deck, this.history, firstFamily(decl['font-family'] || (sample ? css(sample).fontFamily : '')), [+e.target.value], []);
                }
                this._previewBase(cell, e.target); this._commit('Base style');
                this.history.end();
                return;
            }
            if (e.target === this.$('thCss')) { this._change('Custom CSS', (o) => { o.css = this.$('thCss').value; }); }
        });
        let cssTimer = 0;
        this.$('thCss').addEventListener('input', () => { clearTimeout(cssTimer); cssTimer = setTimeout(() => this._preview((o) => { o.css = this.$('thCss').value; }), 400); });
        this.$('thCss').addEventListener('keydown', (e) => e.stopPropagation());

        // The designs' looks: open until folded, and remembered either way.
        const looksFold = this.$('thLooksFold');
        try { if (localStorage.getItem(LOOKS_OPEN_KEY) === '0') looksFold.open = false; } catch (err) { /* private window */ }
        looksFold.addEventListener('toggle', () => { try { localStorage.setItem(LOOKS_OPEN_KEY, looksFold.open ? '1' : '0'); } catch (err) { /* private window */ } });

        // Deck CSS: folded until asked for (remembered), applied on leaving a box, Ctrl+Enter or the button.
        const code = this.$('thCode');
        try { code.open = localStorage.getItem(CODE_OPEN_KEY) === '1'; } catch (err) { /* private window */ }
        code.addEventListener('toggle', () => {
            try { localStorage.setItem(CODE_OPEN_KEY, code.open ? '1' : '0'); } catch (err) { /* private window */ }
            if (code.open) this._renderCode();
        });
        const codeBox = (e) => e.target.classList && e.target.classList.contains('th-deckcss');
        r.addEventListener('change', (e) => { if (codeBox(e)) this._applyCode(); });
        r.addEventListener('input', (e) => { if (codeBox(e)) this.$('thCodeState').textContent = ''; });
        r.addEventListener('keydown', (e) => {
            if (!codeBox(e)) return;
            const ta = e.target;
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); this._applyCode(); return; }
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                indentSelection(ta, e.shiftKey);
                return;
            }
            if (!((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S'))) e.stopPropagation();   // typing and the box's own undo stay here; Save still works
        });
        window.addEventListener('editor:before-save', () => { if (this.deck.isOpen) this._applyCode(); });
        this.deck.addEventListener('deckcss', () => { if (!r.hidden) this._renderCode(); });

        r.addEventListener('click', async (e) => {
            const clear = e.target.closest('.theme-var .insp-clear');
            if (clear) { const row = clear.closest('.theme-var'); this._change('Clear ' + row.dataset.var, (o) => { delete o.vars[row.dataset.var]; }); return; }
            const mclear = e.target.closest('.theme-slider .insp-clear');
            if (mclear) { this._setMotion(mclear.closest('.theme-slider').dataset.motion, null, true); return; }
            const fontBtn = e.target.closest('.theme-font');
            if (fontBtn) { this._pickFont(fontBtn); return; }
            const rm = e.target.closest('[data-remove]');
            if (rm) {
                const fam = rm.dataset.remove, next = cloneFonts(this.deck.fonts);
                delete next.google[fam]; next.faces = withoutFamilyFaces(next.faces, fam); next.own = withoutFamilyFaces(next.own, fam);
                commitFonts(this.deck, this.history, next, 'Remove font ' + fam);
                return;
            }
            const card = e.target.closest('.theme-look');
            if (card) {
                const key = card.dataset.key;
                if (e.target.closest('[data-del]')) {
                    if (confirm('Delete the theme "' + key + '"?')) { try { await this.app.api.deleteTheme(key); await this._renderPresets(); } catch (err) { this.app.toast(err.message, { error: true }); } }
                } else if (e.target.closest('.theme-look-apply')) {
                    if (card.dataset.saved) this._applySaved(key); else this._applyLook(key);
                }
                return;
            }
            const b = e.target.closest('[data-act]'); if (!b) return;
            switch (b.dataset.act) {
                case 'host': this._hostFonts(false); break;
                case 'addfiles': this.app.fontPicker.open(b, { current: '', onPick: null }); this.app.fontPicker.fileInput.click(); break;
                case 'embed': this._hostFonts(true); break;
                case 'unhost': { const next = cloneFonts(this.deck.fonts); next.faces = ''; next.hosted = false; commitFonts(this.deck, this.history, next, 'Use Google Fonts again'); break; }
                case 'reset': this._change('Reset theme', (o) => { o.vars = {}; o.rules = {}; o.css = ''; o.size = null; }); break;
                case 'addcolour': this._addColour(); break;
                case 'sizeApply': this._setSize(this.$('thSizeW').value, this.$('thSizeH').value); break;
                case 'playTrans': this._playTransition(); break;
                case 'replayReveal': this._replayReveal(); break;
                case 'save': {
                    const n = this.$('thName').value.trim();
                    if (!n) { this.app.toast('Give the theme a name'); this.$('thName').focus(); return; }
                    try { await this.app.api.saveTheme(n, this._snapshot()); this.$('thName').value = ''; await this._renderPresets(); this.app.toast('Theme "' + n + '" saved'); }
                    catch (err) { this.app.toast(err.message, { error: true }); }
                    break;
                }
            }
        });
    }

    /* The font picker for a variable row or a base-style cell. */
    _pickFont(btn) {
        const row = btn.closest('.theme-var'), cell = btn.closest('.theme-base .theme-field');
        const current = btn.dataset.value || btn.style.fontFamily;
        this.app.fontPicker.open(btn, {
            current,
            onPick: (stack, name) => {
                if (row) {
                    const v = row.dataset.var;
                    this.history.begin('Theme: ' + v);
                    const used = usedWeights(this.deck);
                    ensureGoogle(this.deck, this.history, name, [...new Set([400, 700, ...used.weights])], used.italics);
                    this._change('Theme: ' + v, (o) => { o.vars[v] = stack; });
                    this.history.end();
                } else if (cell) {
                    const sel = cell.closest('.theme-style').dataset.sel;
                    const sample = this.deck.doc.querySelector('.deck-stage .slide ' + sel);
                    const decl = this.deck.overrides.rules[sel] || {};
                    const used = usedWeights(this.deck, sel ? '.slide ' + sel : '.slide');
                    if (decl['font-weight']) used.weights.push(+decl['font-weight']);
                    this.history.begin('Base style');
                    ensureGoogle(this.deck, this.history, name, [...new Set([400, 700, ...used.weights])], used.italics);
                    this._change('Base style', (o) => { o.rules[sel] = o.rules[sel] || {}; o.rules[sel]['font-family'] = stack; });
                    this.history.end();
                }
            },
        });
    }

    _previewBase(cell, input) {
        const sel = cell.closest('.theme-style').dataset.sel, prop = cell.dataset.prop, kind = cell.dataset.kind;
        let v = input.value;
        if (input.type === 'color') { v = input.value; cell.querySelector('.theme-text').value = v; }
        else if (kind === 'px' && v !== '') v = v + 'px';
        this._preview((o) => {
            o.rules[sel] = o.rules[sel] || {};
            if (v === '' || v == null) delete o.rules[sel][prop]; else o.rules[sel][prop] = v;
        });
    }
}

/* --- helpers ------------------------------------------------------ */
const CODE_OPEN_KEY = 'diapo-theme-code-open';
const LOOKS_OPEN_KEY = 'diapo-theme-looks-open';

/* A theme card: a strip of its colours, its name, and its heading font's name, set in that
   font only when the editor has the font loaded already (asking for it would fetch it from
   Google just for opening the panel). Saved themes get a delete button. */
function lookCard({ key, name, vars, saved }) {
    const strip = lookStrip(vars), stack = lookFont(vars), fam = firstFamily(stack);
    const font = fam ? `<span class="theme-look-font"${editorHasFont(fam) ? ` style="font-family:${esc(stack)}"` : ''}>${esc(fam)}</span>` : '';
    const what = saved ? `Apply your theme "${name}" to this deck` : `Give this deck the colours, fonts and margins of the ${name} design`;
    return `<div class="theme-look" data-key="${esc(key)}"${saved ? ' data-saved="1"' : ''}>
        <button type="button" class="theme-look-apply" title="${esc(what)}${fam ? esc(' (headings in ' + fam + ')') : ''}" aria-label="${esc(what)}">
          <span class="theme-look-strip">${strip.map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span>
          <span class="theme-look-name">${esc(name)}</span>${font}
        </button>${saved ? `<button type="button" class="insp-clear" data-del title="Delete this theme" aria-label="Delete the theme ${esc(name)}">&times;</button>` : ''}
      </div>`;
}
function editorHasFont(family) {
    const want = family.toLowerCase();
    for (const f of document.fonts) if (f.status === 'loaded' && f.family.replace(/^["']|["']$/g, '').toLowerCase() === want) return true;
    return false;
}

/* Tab indents by four spaces (every selected line when the selection spans lines), Shift+Tab takes
   one level off. Done with execCommand so the box's own undo keeps working. */
function indentSelection(ta, back) {
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    const put = (from, to, text, selFrom, selTo) => {
        ta.setSelectionRange(from, to);
        if (!document.execCommand('insertText', false, text)) { ta.setRangeText(text, from, to, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
        ta.setSelectionRange(selFrom, selTo);
    };
    if (a === b && !back) { put(a, b, '    ', a + 4, a + 4); return; }
    const start = v.lastIndexOf('\n', a - 1) + 1;
    const lines = v.slice(start, b).split('\n');
    let removedFirst = 0, removedAll = 0;
    const out = lines.map((ln, i) => {
        if (!back) return '    ' + ln;
        const m = /^( {1,4}|\t)/.exec(ln), n = m ? m[0].length : 0;
        if (i === 0) removedFirst = n;
        removedAll += n;
        return ln.slice(n);
    });
    const text = out.join('\n');
    put(start, b, text, back ? Math.max(start, a - removedFirst) : a + 4, start + text.length);
}

/* How much of a block the browser understood: its top-level rules counted in the text (comments and
   strings left out) against those in the parsed sheet, and whether the braces pair up. Bad CSS is
   kept as typed; the browser skips what it cannot read. */
function cssHealth(text, sheet) {
    let depth = 0, rules = 0, i = 0, bad = false;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
        if (c === '"' || c === "'") { i++; while (i < n && text[i] !== c && text[i] !== '\n') { if (text[i] === '\\') i++; i++; } i++; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth < 0) { bad = true; depth = 0; } else if (depth === 0) rules++; }
        else if (c === ';' && depth === 0) rules++;
        i++;
    }
    if (depth !== 0) bad = true;
    let parsed = 0;
    try { parsed = sheet ? sheet.cssRules.length : 0; } catch (e) { parsed = rules; }
    if (bad) return { warn: true, text: 'braces do not pair up' };
    if (parsed < rules) return { warn: true, text: `${parsed} of ${rules} rules read; check the rest` };
    return { warn: false, text: `${parsed} ${parsed === 1 ? 'rule' : 'rules'}` };
}
function kindOf(name, value, lookup) {
    // var(--other): the kind of what it points at (slide-bg: var(--paper) is a colour)
    for (let n = 0; n < 5 && lookup; n++) { const m = /^var\(--([\w-]+)\)$/.exec(String(value).trim()); if (!m) break; const v = lookup(m[1]); if (v == null) break; value = v; }
    if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(value) || /^(transparent|white|black)$/i.test(value)) return 'colour';
    if (/font/i.test(name) && /[a-z]/i.test(value) && !/^\d/.test(value)) return 'font';
    if (/^-?[\d.]+(px|em|rem|%|vw|vh)$/i.test(value.trim())) return 'length';
    return 'other';
}
function valueFromRow(row, input) {
    const kind = row.dataset.kind;
    if (kind === 'colour') {
        const text = row.querySelector('.theme-text'), pick = row.querySelector('input[type=color]');
        if (input === pick) { text.value = pick.value; return pick.value; }
        const hex = toHex(text.value.trim()); if (hex) pick.value = hex;
        // "Same as Background" (or just "Background"): the variable that row stands for.
        const said = text.value.trim().replace(/^same as\s+/i, '').toLowerCase();
        const other = Array.from(row.parentElement.querySelectorAll('.theme-var[data-kind="colour"]')).find(r => r !== row && r.querySelector('label').textContent.trim().toLowerCase() === said);
        if (other) return `var(--${other.dataset.var})`;
        return text.value.trim();
    }
    if (kind === 'length') { const n = row.querySelector('input[type=number]'); return n.value === '' ? '' : n.value + (n.dataset.unit || 'px'); }
    return input.value;
}
/* How a colour value reads in its field: var(--paper) is "Same as Background". */
function colourText(value) {
    const m = /^var\(--([\w-]+)\)$/.exec(String(value == null ? '' : value).trim());
    return m ? 'Same as ' + plainName(m[1]) : String(value == null ? '' : value);
}
/* A theme value such as var(--x) or an rgb() string, resolved by the deck itself. */
function resolveColour(deck, value) {
    const probe = deck.doc.createElement('i');
    probe.style.color = value;
    deck.doc.body.appendChild(probe);
    const c = css(probe).color;
    probe.remove();
    return c;
}
function stackOf(name) { return /[^\w-]/.test(name) ? `"${name}"` : name; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
