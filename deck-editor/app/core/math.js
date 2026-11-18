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

   Maths inside a sentence is a <span data-math="LaTeX"> in the
   text (inlinemath.js puts it there): the same kind of drawing, in
   MathJax's inline style, its size and its drop below the baseline
   in em, so it follows the text's size and sits on its baseline.
   The figure is a block of its own; the span is a word of the text.
   ============================================================ */
import { loadVendor } from './vendor.js';

const FONT_KEY = 'diapo-math-font';  // the look new equations take
export const lastMathFont = () => { try { return localStorage.getItem(FONT_KEY) === 'stix2' ? 'stix2' : 'classic'; } catch (e) { return 'classic'; } };
const EM = 16, EX = 8;                  // MathJax measures in ex with these; out in em: ex * EX / EM

/* An equation inside text. Everything that treats [data-math] as a figure of its own (picked,
   moved, sized, exported as a picture) leaves these out: they are part of their text. */
export const INLINE_MATH = 'span[data-math]';
export const isInlineMath = (el) => !!el && typeof el.matches === 'function' && el.matches(INLINE_MATH);

export function isMath(el) {
    return !!el && typeof el.matches === 'function' && el.matches('[data-math]') && !el.matches(INLINE_MATH);
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
/* Arrows. In plain LaTeX, -> is a minus and a greater-than sign; only mhchem inside \ce{...}
   reads it as a reaction arrow. So an arrow typed outside \ce{} and \text{} is drawn as the
   real arrow. The source stays as typed: the conversion happens only when the TeX is drawn,
   and the drawing's key is made from the converted TeX, so a deck drawn before this change
   (with -> in a formula) is drawn again when it opens. -->, which is not an arrow in plain
   TeX either, is left alone. */
const ARROW_TEX = { '<->': '\\leftrightarrow', '<=>': '\\rightleftharpoons', '-->': '-->', '->': '\\to', '<-': '\\leftarrow', '=>': '\\Rightarrow' };
const ARROW_RE = /<->|<=>|-->|->|<-|=>/y;
const OPAQUE_RE = /\\(ce|text)\s*\{/y;

/* Walks `tex` up to `end`, keeping a stack with what each open brace belongs to: 'ce' or
   'text' for the braces of \ce{} and \text{}, '' for any other. With `arrows`, the output has
   the plain arrows converted (none inside an open 'ce' or 'text'); without, only the stack
   is of interest. */
function scanTex(tex, end, arrows) {
    let out = '';
    const stack = [];
    for (let i = 0; i < end;) {
        const c = tex[i];
        if (c === '\\') {
            OPAQUE_RE.lastIndex = i;
            const m = OPAQUE_RE.exec(tex);
            if (m && i + m[0].length <= end) { stack.push(m[1]); out += m[0]; i += m[0].length; continue; }
            out += tex.slice(i, i + 2); i += 2;          // \{ \} \\ and the other commands: copied as they are
            continue;
        }
        if (c === '{') { stack.push(''); out += c; i++; continue; }
        if (c === '}') { stack.pop(); out += c; i++; continue; }
        if (arrows && !stack.some(Boolean)) {
            ARROW_RE.lastIndex = i;
            const m = ARROW_RE.exec(tex);
            if (m && i + m[0].length <= end) {
                // A control word needs a space after it only before a letter: a -> b and a \to b then match.
                const after = tex[i + m[0].length] || '';
                out += ARROW_TEX[m[0]] + (/[A-Za-z]/.test(after) ? ' ' : '');
                i += m[0].length;
                continue;
            }
        }
        out += c; i++;
    }
    return { out, stack };
}

/* The TeX as it is drawn: plain arrows made into TeX arrows. Unchanged when there are none. */
export const drawnTex = (tex) => scanTex(tex, tex.length, true).out;

/* Whether a caret at the end of `text` is inside a \ce{...} (one not yet closed). */
export const inCe = (text) => scanTex(text, text.length, false).stack.includes('ce');

/* The drawing's key: the TeX as drawn, the look, and (for an equation in text) the inline style,
   so a figure's drawing is never taken for a span's or the other way round. */
export const mathKey = (tex, font = 'classic', inline = false) => { const t = drawnTex(tex); return 'm' + hash((inline ? 'inline|' : '') + (font === 'stix2' ? 'stix2|' + t : t)); };

/* The drawing of `tex` in the given look as SVG markup, or an Error with MathJax's message
   (unknown command, missing brace). `inline`: MathJax's style for maths in a sentence (smaller
   fractions and limits beside the sum), with the drop below the baseline kept. */
export async function texToSvg(tex, font = 'classic', { inline = false } = {}) {
    let svg;
    const src = drawnTex(tex);                       // the arrows as drawn (the source keeps what was typed)
    if (font === 'stix2') {
        const frame = await loadStix();
        let timer;
        const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the STIX Two drawing did not answer')), 20000); });
        const markup = await Promise.race([frame.renderTex(src, { em: EM, ex: EX, display: !inline }), late])
            .catch((err) => { throw new Error(err && err.message ? err.message : String(err)); })
            .finally(() => clearTimeout(timer));
        const t = document.createElement('template');
        t.innerHTML = markup;
        svg = t.content.querySelector('svg');
        if (!svg) throw new Error('nothing to draw');
    } else {
        const MJ = await loadMathJax();
        let node;
        try { node = MJ.tex2svg(src, { display: !inline, em: EM, ex: EX, containerWidth: 1920 }); }
        catch (err) { throw new Error(err && err.message ? err.message : String(err)); }
        svg = node.querySelector('svg');
        if (!svg) throw new Error('nothing to draw');
        if (svg.querySelector('[data-mml-node="merror"]')) throw new Error((svg.textContent || 'error').trim());
    }
    const em = (v) => v && /ex$/.test(v) ? (Math.round(parseFloat(v) * EX / EM * 1000) / 1000) + 'em' : v;
    const w = em(svg.getAttribute('width')), h = em(svg.getAttribute('height'));
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    // MathJax's vertical-align is how far the maths drops below the baseline (the depth of a
    // subscript, a fraction's denominator), in ex.
    const drop = em((/vertical-align:\s*(-?[\d.]+ex)/.exec(svg.getAttribute('style') || '') || [])[1] || '0ex');
    svg.removeAttribute('style');
    svg.removeAttribute('focusable');
    svg.removeAttribute('aria-hidden');
    // A figure's drawing is a block of its own. In text, the drawing sits on the baseline, and
    // its size is in the style too: a deck's own rule for svg (width: 100%, display: block, a
    // fixed height) would otherwise win over the attributes and break the line.
    svg.setAttribute('style', inline
        ? `display:inline; vertical-align:${drop}; width:${w}; height:${h}; max-width:none; margin:0; overflow:visible;`
        : 'display:block; overflow:visible;');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', tex);
    svg.setAttribute('data-key', mathKey(tex, font, inline));
    svg.querySelectorAll('[data-mml-node], [data-c], [data-mjx-texclass], [data-latex], [data-semantic-type]').forEach(n => {
        for (const a of Array.from(n.attributes)) if (/^data-(mml-node|c|mjx-|latex|semantic)/.test(a.name)) n.removeAttribute(a.name);
    });
    svg.querySelectorAll('title').forEach(t => t.remove());
    return svg.outerHTML;
}

/* Draw the equation into its figure. Not an undo step by itself (see MathSection.commit). */
export async function writeMath(el, tex = texOf(el)) {
    const svg = await texToSvg(tex, fontOf(el), { inline: isInlineMath(el) });
    el.innerHTML = svg;
    return el;
}

/* Whether the element's drawing is the one its LaTeX and look make. */
export function drawnRight(el) {
    const svg = el.querySelector(':scope > svg');
    return !!svg && svg.getAttribute('data-key') === mathKey(texOf(el), fontOf(el), isInlineMath(el));
}

/* Every equation in `root` whose drawing is missing or was made from other LaTeX, drawn.
   Returns the ones that do not parse, with MathJax's message. An equation in text that does
   not parse and has no drawing shows its LaTeX as text meanwhile, so it is not lost from sight. */
export async function refreshMath(root) {
    const bad = [];
    if (!root) return bad;
    const list = root.matches && root.matches('[data-math]') ? [root] : Array.from(root.querySelectorAll('[data-math]'));
    for (const el of list) {
        if (drawnRight(el)) continue;
        const tex = texOf(el);
        try { await writeMath(el, tex); } catch (err) {
            bad.push({ el, message: err.message });
            if (isInlineMath(el) && !el.querySelector(':scope > svg')) el.textContent = tex;
        }
    }
    return bad;
}

/* ============================================================
   The LaTeX as readable text, for where a drawing cannot go: a
   line of PowerPoint text holds no picture. Greek letters and
   operators become their characters, \frac{a}{b} a/b, \sqrt{x}
   √x, \ce{H2O} H₂O; powers and indices are kept apart so they
   can be raised or lowered. Not a TeX engine: what it does not
   know comes out as the command's name.
   ============================================================ */
const TEX_CHARS = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
    iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς',
    tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•', neq: '≠', ne: '≠', leq: '≤', le: '≤',
    geq: '≥', ge: '≥', ll: '≪', gg: '≫', approx: '≈', sim: '∼', simeq: '≃', cong: '≅', equiv: '≡', propto: '∝', infty: '∞',
    partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫', iint: '∬', oint: '∮', to: '→', rightarrow: '→', leftarrow: '←', gets: '←',
    leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔', rightleftharpoons: '⇌',
    longrightarrow: '⟶', mapsto: '↦', uparrow: '↑', downarrow: '↓', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆',
    supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
    wedge: '∧', vee: '∨', oplus: '⊕', otimes: '⊗', perp: '⊥', parallel: '∥', angle: '∠', ell: 'ℓ', hbar: 'ℏ', hslash: 'ℏ', Re: 'ℜ',
    Im: 'ℑ', aleph: 'ℵ', prime: '′', degree: '°', AA: 'Å', angstrom: 'Å', ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮',
    langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', vert: '|', Vert: '‖', mid: '|', backslash: '\\',
    quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '>': ' ', ' ': ' ', '!': '', '{': '{', '}': '}', '%': '%', '_': '_', '&': '&', '#': '#', '$': '$', '|': '‖',
    lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']', dag: '†', dagger: '†', ddagger: '‡', checkmark: '✓', square: '□', triangle: '△',
};
const TEX_WORDS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp',
    'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'Pr', 'mod', 'bmod']);
const TEX_ACCENTS = { hat: '̂', widehat: '̂', bar: '̄', overline: '̅', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃', widetilde: '̃', check: '̌', breve: '̆', acute: '́', grave: '̀' };
const TEX_LETTERS = { mathbb: { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', E: '𝔼' } };
const TEX_TEXT = /^(text|textrm|textit|textbf|textsf|texttt|mathrm|mathit|mathbf|mathsf|mathtt|mathcal|mathscr|mathfrak|boldsymbol|bm|operatorname|mbox|hbox|textnormal|displaystyle|textstyle|scriptstyle|mathbb)$/;

/* mhchem's formula notation as plain LaTeX: H2O as H_{2}O, SO4^2- as SO_{4}^{2-}, -> as \to. */
function ceToTex(s) {
    return s.replace(/<=>|<->|->|<-/g, (a) => ({ '<=>': ' \\rightleftharpoons ', '<->': ' \\leftrightarrow ', '->': ' \\to ', '<-': ' \\leftarrow ' }[a]))
        .replace(/([A-Za-z)\]])(\d+)/g, '$1_{$2}')
        .replace(/\^([0-9]*[+-])/g, '^{$1}')
        .replace(/([A-Za-z)\]])([+-])(?=\s|$|\})/g, '$1^{$2}');
}

/* `tex` as [{ t, script }] pieces, script '' (on the line), 'sup' or 'sub'. */
export function texToRuns(tex) {
    const out = [];
    const emit = (t, script) => {
        if (!t) return;
        const last = out[out.length - 1];
        if (last && last.script === script) last.t += t; else out.push({ t, script });
    };
    const src = drawnTex(String(tex || ''));
    // A group: what one argument is ({...} or the next token), as its source.
    const arg = (s, i) => {
        while (s[i] === ' ') i++;
        if (s[i] === '{') {
            let depth = 0, j = i;
            for (; j < s.length; j++) { if (s[j] === '\\') { j++; continue; } if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) break; }
            return { body: s.slice(i + 1, j), end: j + 1 };
        }
        if (s[i] === '\\') { const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i)); return { body: m ? m[0] : '\\', end: i + (m ? m[0].length : 1) }; }
        return { body: s[i] || '', end: i + 1 };
    };
    const optArg = (s, i) => {
        if (s[i] !== '[') return null;
        const j = s.indexOf(']', i);
        return j < 0 ? null : { body: s.slice(i + 1, j), end: j + 1 };
    };
    // The plain text of a piece, all on one level (for what goes inside a fraction or a root).
    const flat = (s) => texToRuns(s).map(r => r.t).join('');
    const wrapped = (s) => { const t = flat(s); return t.length > 1 && !/^[\p{L}\p{N}.]+$/u.test(t) ? '(' + t + ')' : t; };
    function walk(s, script) {
        for (let i = 0; i < s.length;) {
            const c = s[i];
            if (c === '\\') {
                const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
                const name = m ? m[1] : '';
                i += m ? m[0].length : 1;
                if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
                    const a = arg(s, i), b = arg(s, a.end); i = b.end;
                    emit(wrapped(a.body) + '/' + wrapped(b.body), script);
                } else if (name === 'sqrt') {
                    const n = optArg(s, i); if (n) i = n.end;
                    const a = arg(s, i); i = a.end;
                    if (n) emit(flat(n.body), script || 'sup');
                    emit('√' + wrapped(a.body), script);
                } else if (name === 'ce') {
                    const a = arg(s, i); i = a.end;
                    walk(ceToTex(a.body), script);
                } else if (TEX_TEXT.test(name)) {
                    if (name === 'displaystyle' || name === 'textstyle' || name === 'scriptstyle') continue;
                    const a = arg(s, i); i = a.end;
                    const map = TEX_LETTERS[name];
                    if (map) emit(a.body.replace(/[A-Z]/g, ch => map[ch] || ch), script);
                    else if (/^(text|textrm|textit|textbf|textsf|texttt|mbox|hbox|textnormal)$/.test(name)) emit(a.body.replace(/\\(.)/g, '$1'), script);
                    else walk(a.body, script);
                } else if (TEX_ACCENTS[name]) {
                    const a = arg(s, i); i = a.end;
                    emit(flat(a.body) + TEX_ACCENTS[name], script);
                } else if (/^(left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|middle)$/.test(name)) {
                    if (s[i] === '.') i++;                         // \left. is no bracket at all
                } else if (name === '\\') emit(' ', script);
                else if (name === 'begin' || name === 'end') { const a = arg(s, i); i = a.end; }
                else if (TEX_WORDS.has(name)) emit(name, script);
                else if (name in TEX_CHARS) emit(TEX_CHARS[name], script);
                else emit(name, script);
                continue;
            }
            if (c === '^' || c === '_') {
                const a = arg(s, i + 1); i = a.end;
                const inner = flat(a.body);
                if (c === '^' && (inner === '∘' || inner === '°')) { emit('°', script); continue; }
                if (c === '^' && /^′+$/.test(inner)) { emit(inner, script); continue; }
                const level = script || (c === '^' ? 'sup' : 'sub');
                walk(a.body, level);
                continue;
            }
            if (c === '{' || c === '}') { i++; continue; }
            if (c === '~') { emit(' ', script); i++; continue; }
            if (c === '&') { emit(' ', script); i++; continue; }
            if (c === "'") { emit('′', script); i++; continue; }
            if (/\s/.test(c)) {
                const last = out[out.length - 1];
                if (last && !/ $/.test(last.t)) emit(' ', script);
                while (i < s.length && /\s/.test(s[i])) i++;
                continue;
            }
            emit(c, script); i++;
        }
    }
    walk(src, '');
    if (out.length) { out[0].t = out[0].t.replace(/^ +/, ''); out[out.length - 1].t = out[out.length - 1].t.replace(/ +$/, ''); }
    return out.filter(r => r.t);
}
/* The same as one line of text, the powers and indices in Unicode where it has them. */
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎' };
export function texToText(tex) {
    return texToRuns(tex).map(r => {
        if (!r.script) return r.t;
        const map = r.script === 'sup' ? SUP : SUB, chars = Array.from(r.t);
        return chars.every(ch => map[ch]) ? chars.map(ch => map[ch]).join('') : (r.script === 'sup' ? '^' : '_') + (chars.length > 1 ? '(' + r.t + ')' : r.t);
    }).join('');
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
    ['Chemistry', [['ce', '\\ce{#}|', 'A reaction or formula: \\ce{2H2 + O2 -> 2H2O}'], ['Δ', '\\Delta ', 'Heat (Delta)'], ['[ ]', '\\left[ # \\right]|', 'Concentration']]],
    ['Arrows', [['→', '\\to ', 'Arrow', ' -> '], ['←', '\\leftarrow ', 'Arrow left', ' <- '], ['↔', '\\leftrightarrow ', 'Arrow both ways', ' <-> '],
        ['⇌', '\\rightleftharpoons ', 'Equilibrium', ' <=> '], ['↑', '\\uparrow ', 'Gas given off', ' ^ '], ['↓', '\\downarrow ', 'Precipitate', ' v ']]],
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
            + keys.map(([label, tex, name, ce]) => `<button type="button" data-tex="${escAttr(tex)}"${ce ? ` data-ce="${escAttr(ce)}"` : ''} title="${escAttr((name ? name + ': ' : '') + tex.replace(/[#|]/g, '').trim())}">${label}</button>`).join('') + '</div>').join('')}</div>
          <div class="insp-hint">LaTeX, as in a paper: <code>x^2</code>, <code>\\frac{a}{b}</code>, <code>\\sqrt{x}</code>, <code>\\alpha</code>. A reaction: <code>\\ce{2H2 + O2 -> 2H2O}</code>. The buttons put the LaTeX in at the cursor; with words selected, they wrap them. Size and colour: the Text fields below.</div>`;
        this.box = root.querySelector('#mathTex');
        this.err = root.querySelector('#mathError');
        root.querySelector('#mathFont').addEventListener('click', (e) => { const b = e.target.closest('[data-font]'); if (b) this.setFont(b.dataset.font); });
        const keys = root.querySelector('#mathKeys');
        keys.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });   // the box keeps its focus and selection
        keys.addEventListener('click', (e) => { const b = e.target.closest('button[data-tex]'); if (b) this.insert(b.dataset.tex, b.dataset.ce); });
        this.box.addEventListener('input', () => this._typed());
        this.box.addEventListener('change', () => this.commit());
        this.box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commit(); this.box.blur(); }
            else if (e.key === 'Escape') { e.preventDefault(); this.box.blur(); }
        });
    }

    /* A button's LaTeX into the box at the cursor: a selection goes where # is, the cursor where
       | is (or, with nothing selected, where # is, so the next keys fill the first slot). */
    /* `ce` is the arrow's mhchem form, used when the caret is inside \ce{...}: there -> is the
       reaction arrow, and \to would not be. */
    insert(tex, ce) {
        const box = this.box, s = box.selectionStart ?? box.value.length, e = box.selectionEnd ?? s;
        if (ce && inCe(box.value.slice(0, s))) tex = ce;
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
