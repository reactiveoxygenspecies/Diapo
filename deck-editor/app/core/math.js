/* ============================================================
   math.js - equations the editor draws from LaTeX.

   An equation is a <figure data-math="LaTeX"> holding its drawing:
   one plain inline <svg> made by MathJax (vendor/mathjax-tex-svg.js,
   loaded into the editor on first use), every glyph a path, sized in
   em so it follows the figure's font-size, filled with currentColor
   so it follows the figure's colour. The saved deck needs no script,
   font or library to show it, in the PDF and the thumbnails too.
   The <svg>'s data-key is a hash of the LaTeX it was drawn from: a
   figure written with the LaTeX alone (by hand, by a deck generator)
   or changed outside the editor is drawn when the deck opens.

   Chemistry: mhchem's \ce{} is on, so a reaction is typed as
   \ce{2H2 + O2 -> 2H2O}. Structures are chem.js.
   ============================================================ */
import { loadVendor } from './vendor.js';

const FONT_KEY = 'diapo-math-font';  // the look new equations take
export const lastMathFont = () => { try { return localStorage.getItem(FONT_KEY) === 'stix2' ? 'stix2' : 'classic'; } catch (e) { return 'classic'; } };
const EM = 16, EX = 8;                  // MathJax measures in ex with these; out in em: ex * EX / EM

export function isMath(el) {
    return !!el && typeof el.matches === 'function' && el.matches('[data-math]');
}
export function mathOf(el) {
    const m = el && el.closest ? el.closest('[data-math]') : null;
    return m && isMath(m) ? m : null;
}
export const texOf = (el) => el.getAttribute('data-math') || '';
/* The look: 'classic' (MathJax's TeX font, the LaTeX look; no attribute) or 'stix2' (STIX Two, the journals' look). */
export const MATH_FONTS = [['classic', 'Classic', 'The LaTeX look (Computer Modern)'], ['stix2', 'STIX Two', 'The look of journals (ACS, AIP, Elsevier); Times-like']];
export const fontOf = (el) => el.getAttribute('data-math-font') === 'stix2' ? 'stix2' : 'classic';

function loadMathJax() {
    if (!window.MathJax || !window.MathJax.version) {
        window.MathJax = {
            tex: { packages: { '[+]': ['mhchem'] }, formatError: (jax, err) => { throw err; } },
            svg: { fontCache: 'none' },          // every glyph in the drawing itself: nothing shared between figures
            options: { enableMenu: false, enableAssistiveMml: false },
            startup: { typeset: false },
        };
    }
    return loadVendor('mathjax-tex-svg.js', () => window.MathJax.startup.promise).then(() => window.MathJax);
}

/* STIX Two is MathJax 4, which cannot share this page with MathJax 3: it runs in a hidden frame
   of its own (core/math-frame.html), loaded on first use, and hands back the drawing's markup. */
let stixFrame = null;
function loadStix() {
    if (!stixFrame) {
        stixFrame = new Promise((resolve, reject) => {
            const f = document.createElement('iframe');
            f.src = 'core/math-frame.html';
            f.setAttribute('aria-hidden', 'true');
            f.tabIndex = -1;
            f.style.cssText = 'position:fixed; left:-10000px; top:0; width:600px; height:300px; border:0; visibility:hidden;';
            f.onload = () => f.contentWindow && f.contentWindow.renderTex ? resolve(f.contentWindow) : reject(new Error('could not start the STIX Two drawing'));
            f.onerror = () => reject(new Error('could not start the STIX Two drawing'));
            document.body.appendChild(f);
        });
        stixFrame.catch(() => { stixFrame = null; });
    }
    return stixFrame;
}

function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
export const mathKey = (tex, font = 'classic') => 'm' + hash(font === 'stix2' ? 'stix2|' + tex : tex);

/* The drawing of `tex` in the given look as SVG markup, or an Error with MathJax's message
   (unknown command, missing brace). */
export async function texToSvg(tex, font = 'classic') {
    let svg;
    if (font === 'stix2') {
        const frame = await loadStix();
        let timer;
        const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the STIX Two drawing did not answer')), 20000); });
        const markup = await Promise.race([frame.renderTex(tex, { em: EM, ex: EX }), late])
            .catch((err) => { throw new Error(err && err.message ? err.message : String(err)); })
            .finally(() => clearTimeout(timer));
        const t = document.createElement('template');
        t.innerHTML = markup;
        svg = t.content.querySelector('svg');
        if (!svg) throw new Error('nothing to draw');
    } else {
        const MJ = await loadMathJax();
        let node;
        try { node = MJ.tex2svg(tex, { display: true, em: EM, ex: EX, containerWidth: 1920 }); }
        catch (err) { throw new Error(err && err.message ? err.message : String(err)); }
        svg = node.querySelector('svg');
        if (!svg) throw new Error('nothing to draw');
        if (svg.querySelector('[data-mml-node="merror"]')) throw new Error((svg.textContent || 'error').trim());
    }
    const em = (v) => v && /ex$/.test(v) ? (Math.round(parseFloat(v) * EX / EM * 1000) / 1000) + 'em' : v;
    svg.setAttribute('width', em(svg.getAttribute('width')));
    svg.setAttribute('height', em(svg.getAttribute('height')));
    svg.removeAttribute('style');                    // vertical-align: the figure is a block of its own
    svg.removeAttribute('focusable');
    svg.removeAttribute('aria-hidden');
    svg.setAttribute('style', 'display:block; overflow:visible;');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', tex);
    svg.setAttribute('data-key', mathKey(tex, font));
    svg.querySelectorAll('[data-mml-node], [data-c], [data-mjx-texclass], [data-latex], [data-semantic-type]').forEach(n => {
        for (const a of Array.from(n.attributes)) if (/^data-(mml-node|c|mjx-|latex|semantic)/.test(a.name)) n.removeAttribute(a.name);
    });
    svg.querySelectorAll('title').forEach(t => t.remove());
    return svg.outerHTML;
}

/* Draw the equation into its figure. Not an undo step by itself (see MathSection.commit). */
export async function writeMath(el, tex = texOf(el)) {
    const svg = await texToSvg(tex, fontOf(el));
    el.innerHTML = svg;
    return el;
}

/* Every equation in `root` whose drawing is missing or was made from other LaTeX, drawn.
   Returns the ones that do not parse, with MathJax's message. */
export async function refreshMath(root) {
    const bad = [];
    if (!root) return bad;
    const list = root.matches && root.matches('[data-math]') ? [root] : Array.from(root.querySelectorAll('[data-math]'));
    for (const el of list) {
        const tex = texOf(el), svg = el.querySelector(':scope > svg');
        if (svg && svg.getAttribute('data-key') === mathKey(tex, fontOf(el))) continue;
        try { await writeMath(el, tex); } catch (err) { bad.push({ el, message: err.message }); }
    }
    return bad;
}

/* ============================================================
   MathSection - the Equation part of the properties panel: the
   LaTeX, drawn on the slide as it is typed. Leaving the box (or
   Ctrl+Enter) is the undo step; a mistake shows MathJax's message
   and the slide keeps the last drawing that worked.
   ============================================================ */
/* The buttons under the LaTeX box: [label, LaTeX, name]. In the LaTeX, # is where a selection
   goes (or the cursor, with nothing selected) and | is where the cursor goes after it. */
const MATH_KEYS = [
    ['Operators', [['×', '\\times ', 'Times'], ['÷', '\\div ', 'Divided by'], ['·', '\\cdot ', 'Dot product'], ['±', '\\pm ', 'Plus or minus'],
        ['≠', '\\neq ', 'Not equal'], ['≤', '\\leq ', 'Less or equal'], ['≥', '\\geq ', 'Greater or equal'], ['≈', '\\approx ', 'Approximately'],
        ['∝', '\\propto ', 'Proportional to'], ['∞', '\\infty ', 'Infinity'], ['∂', '\\partial ', 'Partial'], ['°', '^\\circ ', 'Degree']]],
    ['Structures', [['a⁄b', '\\frac{#}{|}', 'Fraction'], ['x²', '^{#}|', 'Power (superscript)'], ['x₂', '_{#}|', 'Index (subscript)'],
        ['√x', '\\sqrt{#}|', 'Square root'], ['ⁿ√x', '\\sqrt[|]{#}', 'Root of degree n'], ['eˣ', 'e^{#}|', 'Exponential'],
        ['ln', '\\ln{#}|', 'Natural logarithm'], ['log', '\\log_{|}{#}', 'Logarithm'], ['( )', '\\left( # \\right)|', 'Brackets that grow'],
        ['∑', '\\sum_{#}^{|}', 'Sum'], ['∫', '\\int_{#}^{|}', 'Integral'], ['lim', '\\lim_{# \\to |}', 'Limit'],
        ['x̅', '\\bar{#}|', 'Bar (mean)'], ['x⃗', '\\vec{#}|', 'Vector'], ['Δx', '\\Delta #', 'Change (Delta)'], ['sin', '\\sin{#}|', 'Sine']]],
    ['Greek', [['α', '\\alpha '], ['β', '\\beta '], ['γ', '\\gamma '], ['δ', '\\delta '], ['ε', '\\varepsilon '], ['θ', '\\theta '],
        ['λ', '\\lambda '], ['μ', '\\mu '], ['ν', '\\nu '], ['π', '\\pi '], ['ρ', '\\rho '], ['σ', '\\sigma '],
        ['τ', '\\tau '], ['φ', '\\varphi '], ['ψ', '\\psi '], ['ω', '\\omega '], ['Δ', '\\Delta '], ['Ω', '\\Omega ']]],
    ['Chemistry', [['ce', '\\ce{#}|', 'A reaction or formula: \\ce{2H2 + O2 -> 2H2O}'], ['→', ' -> ', 'Reaction arrow (inside \\ce)'],
        ['⇌', ' <=> ', 'Equilibrium (inside \\ce)'], ['Δ', '\\Delta ', 'Heat (Delta)'], ['[ ]', '\\left[ # \\right]|', 'Concentration'],
        ['↑', ' ^ ', 'Gas given off (inside \\ce)'], ['↓', ' v ', 'Precipitate (inside \\ce)']]],
];

export class MathSection {
    constructor(app, root) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.root = root;
        this.el = null;
        this.pending = null;          // { el, html, tex } before the typing started
        this.timer = 0;
        this.seq = 0;
        root.innerHTML = `
          <h4>Equation</h4>
          <div class="insp-row"><label>Look</label><div class="insp-field insp-seg" id="mathFont">${MATH_FONTS.map(([v, l, t]) => `<button type="button" data-font="${v}" title="${t}">${l}</button>`).join('')}</div></div>
          <textarea id="mathTex" class="insp-notes theme-css" rows="3" spellcheck="false" placeholder="E = mc^2" title="The equation in LaTeX; Ctrl+Enter or leaving the box keeps it"></textarea>
          <div class="insp-hint insp-state insp-warn" id="mathError" role="status" hidden></div>
          <div class="math-keys" id="mathKeys">${MATH_KEYS.map(([group, keys]) => `<div class="math-keys-label">${group}</div><div class="math-keys-row">`
            + keys.map(([label, tex, name]) => `<button type="button" data-tex="${escAttr(tex)}" title="${escAttr((name ? name + ': ' : '') + tex.replace(/[#|]/g, '').trim())}">${label}</button>`).join('') + '</div>').join('')}</div>
          <div class="insp-hint">LaTeX, as in a paper: <code>x^2</code>, <code>\\frac{a}{b}</code>, <code>\\sqrt{x}</code>, <code>\\alpha</code>. A reaction: <code>\\ce{2H2 + O2 -> 2H2O}</code>. The buttons put the LaTeX in at the cursor; with words selected, they wrap them. Size and colour: the Text fields below.</div>`;
        this.box = root.querySelector('#mathTex');
        this.err = root.querySelector('#mathError');
        root.querySelector('#mathFont').addEventListener('click', (e) => { const b = e.target.closest('[data-font]'); if (b) this.setFont(b.dataset.font); });
        const keys = root.querySelector('#mathKeys');
        keys.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });   // the box keeps its focus and selection
        keys.addEventListener('click', (e) => { const b = e.target.closest('button[data-tex]'); if (b) this.insert(b.dataset.tex); });
        this.box.addEventListener('input', () => this._typed());
        this.box.addEventListener('change', () => this.commit());
        this.box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(); this.box.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); this.box.blur(); }
        });
    }

    /* A button's LaTeX into the box at the cursor: a selection goes where # is, the cursor where
       | is (or, with nothing selected, where # is, so the next keys fill the first slot). */
    insert(tex) {
        const box = this.box, s = box.selectionStart ?? box.value.length, e = box.selectionEnd ?? s;
        const sel = box.value.slice(s, e);
        const hash = tex.indexOf('#');
        let text = tex.replace('#', sel);
        let caret = sel || hash < 0 ? text.indexOf('|') : hash;
        if (caret < 0) caret = text.length;
        text = text.replace('|', '');
        if (caret > text.length) caret = text.length;
        box.focus();
        box.setRangeText(text, s, e, 'start');
        box.setSelectionRange(s + caret, s + caret);
        box.dispatchEvent(new Event('input', { bubbles: true }));
    }

    _typed() {
        const el = this.el; if (!el || !this.deck.doc.contains(el)) return;
        if (!this.pending || this.pending.el !== el) this.pending = { el, html: el.innerHTML, tex: texOf(el) };
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._draw(el, this.box.value), 120);
    }

    async _draw(el, tex) {
        const n = ++this.seq;
        try {
            const svg = await texToSvg(tex, fontOf(el));
            if (n !== this.seq || !this.deck.doc.contains(el)) return;
            this.deck.withoutTransitions(() => { el.innerHTML = svg; });
            this._error('');
            this.app.selection.refresh();
        } catch (err) {
            if (n === this.seq) this._error(err.message);
        }
    }

    _error(msg) {
        this.err.hidden = !msg;
        this.err.textContent = msg ? 'Not drawn: ' + msg + '. The slide shows the last one that worked.' : '';
    }

    /* The LaTeX typed so far becomes one undo step: the attribute and the drawing. */
    /* Every commit is chained, so whatever runs next (another commit, a change of look) sees the drawing it made. */
    commit() {
        this.committing = (this.committing || Promise.resolve()).catch(() => {}).then(() => this._commit());
        return this.committing;
    }
    async _commit() {
        const p = this.pending, el = this.el;
        this.pending = null;          // claimed now: leaving the box while this one draws must not record it twice
        if (!p || p.el !== el || !el || !this.deck.doc.contains(el)) return;
        clearTimeout(this.timer);
        const tex = this.box.value;
        const drawn = el.querySelector(':scope > svg');
        if (tex !== p.tex || !drawn || drawn.getAttribute('data-key') !== mathKey(tex, fontOf(el))) {   // the drawing shows what the box says, even if the typing came back to where it started
            try { const svg = await texToSvg(tex, fontOf(el)); el.innerHTML = svg; this._error(''); } catch (err) { this._error(err.message); }
        }
        if (tex === p.tex && el.innerHTML === p.html) return;
        this.history.begin('Edit equation');
        if (tex !== p.tex) this.history.attr(el, 'data-math', tex, 'Edit equation');
        if (el.innerHTML !== p.html) this.history.html(el, p.html, el.innerHTML, 'Edit equation');
        this.history.end();
        this.app.selection.refresh();
    }

    /* Focus the LaTeX, for a double-click on the equation. */
    /* The equation's look (Classic or STIX Two): the attribute and the drawing, one undo step.
       New equations take the look chosen last. */
    async setFont(font) {
        const el = this.el; if (!el || fontOf(el) === font) return;
        await this.commit();                    // the LaTeX typed so far, and any commit still drawing
        try { localStorage.setItem(FONT_KEY, font); } catch (e) { /* only a preference */ }
        let svg;
        const slow = setTimeout(() => this.app.status('Loading the STIX Two equations...', { busy: true }), 300);
        try { svg = await texToSvg(texOf(el), font); } catch (err) { this._error(err.message); return; }
        finally { clearTimeout(slow); this.app.status(''); }
        if (!this.deck.doc.contains(el)) return;
        const before = el.innerHTML;
        this.history.begin('Equation look');
        this.history.attr(el, 'data-math-font', font === 'stix2' ? 'stix2' : null, 'Equation look');
        this.deck.withoutTransitions(() => { el.innerHTML = svg; });
        this.history.html(el, before, el.innerHTML, 'Equation look');
        this.history.end();
        this.sync(el);
        this.app.selection.refresh();
    }

    focus() { this.box.focus(); this.box.select(); }

    sync(el) {
        const m = el && isMath(el) ? el : null;
        if (this.el && this.el !== m && this.pending) this.commit();
        this.el = m;
        this.root.hidden = !m;
        if (!m) return;
        if (document.activeElement !== this.box) { this.box.value = texOf(m); this._error(''); }
        this.root.querySelectorAll('#mathFont [data-font]').forEach(b => b.classList.toggle('on', b.dataset.font === fontOf(m)));
    }
}

function escAttr(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c])); }
