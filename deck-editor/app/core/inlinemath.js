/* ============================================================
   inlinemath.js - maths inside a sentence ("the rate constant
   k_obs rises with...").

   An equation in text is a <span data-math="LaTeX"> holding its
   drawing: an inline <svg> made by MathJax (math.js), sized in em
   so it follows the text's size, dropped below the baseline by
   MathJax's own depth, filled with currentColor so it takes the
   text's colour. The saved deck needs no script to show it.

   While a text is edited (textedit.js) the span is an atom
   (contenteditable=false): the caret steps over it, Backspace takes
   it whole. It is put in, and changed, from a small popover with a
   LaTeX field and a live preview: Alt+= (Word's key), the ∑ button
   of the text bar, or Ctrl+K > Equation in the text. Enter puts it
   in at the caret, Esc leaves the text as it was. A press on an
   equation in the text opens it again; emptied, it goes.
   With TeX selected in the text, or typed as \( ... \) or $ ... $
   just before the caret, the same key makes it an equation: the
   selection opens in the popover, a typed one is converted at once.
   Each insert, change and removal is an undo step of its own.
   ============================================================ */
import { texToSvg, fontOf, drawnRight, lastMathFont, INLINE_MATH } from './math.js';

/* \( x \), \[ x \] or $ x $ round a piece of TeX: the TeX inside. */
export function stripDelims(s) {
    const t = String(s || '').trim();
    const m = /^\\\(([\s\S]*)\\\)$/.exec(t) || /^\\\[([\s\S]*)\\\]$/.exec(t) || /^\$\$?([\s\S]*?)\$?\$$/.exec(t);
    return (m ? m[1] : t).trim();
}

export class InlineMath {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.pop = null;          // the popover
        this.target = null;       // { span } to change, or { range } to put a new one in
        this.seq = 0;
        this.timer = 0;
        this.deck.addEventListener('ready', () => {
            // A press elsewhere in the text closes the popover (the press on an equation opens it: textedit.js).
            this.deck.doc.addEventListener('pointerdown', (e) => {
                if (this.pop && !(e.target.closest && e.target.closest(INLINE_MATH))) this.close({ refocus: false });
            }, true);
        });
    }

    get isOpen() { return !!this.pop; }
    get te() { return this.app.textEdit; }

    /* Alt+=, the bar's button, the palette: an equation at the caret of the text being edited
       (the selected text, when it is selected; one typed as \( ... \) right before the caret is
       converted straight away). A selected text that is not being edited is edited first. */
    fromCaret() {
        const te = this.te;
        if (!te.el) {
            const el = this.app.selection.single;
            if (!el || !te.start(el)) return false;
        }
        const doc = this.deck.doc, s = this.deck.win.getSelection();
        let range = null;
        if (s && s.rangeCount && te.el.contains(s.getRangeAt(0).commonAncestorContainer)) range = s.getRangeAt(0).cloneRange();
        else if (te.caret && te.el.contains(te.caret.commonAncestorContainer)) range = te.caret.cloneRange();
        if (!range) { range = doc.createRange(); range.selectNodeContents(te.el); range.collapse(false); }
        if (!range.collapsed) return this.open({ range, tex: stripDelims(range.toString()) });
        const typed = typedBefore(range);
        if (typed) return this.open({ range: typed.range, tex: typed.tex, now: true });
        return this.open({ range, tex: '' });
    }

    /* The popover, for the equation `span` or for a new one at `range`. `now`: put the TeX in
       at once when it draws (the popover stays open with the message when it does not). */
    open({ span = null, range = null, tex = null, now = false } = {}) {
        if (!this.te.el) return false;
        this.close({ refocus: false });
        this.target = span ? { span } : { range };
        const pop = document.createElement('div');
        pop.className = 'mathpop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Equation in the text');
        pop.innerHTML = `
            <input type="text" class="mathpop-in" spellcheck="false" autocomplete="off" aria-label="The equation in LaTeX" placeholder="k_{obs}">
            <div class="mathpop-preview" aria-hidden="true"></div>
            <div class="mathpop-err" role="status" hidden></div>
            <div class="mathpop-hint">LaTeX, as between $ signs in a paper: <code>x^2</code>, <code>k_{obs}</code>, <code>\\alpha</code>, <code>\\ce{H2O}</code>. <kbd>Enter</kbd> puts it in, <kbd>Esc</kbd> cancels${span ? ', empty removes it' : ''}.</div>`;
        document.body.appendChild(pop);
        this.pop = pop;
        this.input = pop.querySelector('.mathpop-in');
        this.preview = pop.querySelector('.mathpop-preview');
        this.err = pop.querySelector('.mathpop-err');
        this.input.value = span ? span.getAttribute('data-math') || '' : (tex || '');
        this.input.addEventListener('input', () => { clearTimeout(this.timer); this.timer = setTimeout(() => this._preview(), 120); });
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.apply(); }
            else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
            e.stopPropagation();
        });
        this._place();
        this.input.focus();
        this.input.select();
        if (now) this.apply(); else this._preview();
        return true;
    }

    /* Below the equation, or the caret (above it when there is no room). */
    _place() {
        const t = this.target, frame = this.deck.iframe.getBoundingClientRect();
        let r = t.span ? t.span.getBoundingClientRect() : t.range.getBoundingClientRect();
        if (!r || (!r.width && !r.height && !r.left && !r.top)) r = this.te.el.getBoundingClientRect();
        const w = this.pop.offsetWidth, h = this.pop.offsetHeight;
        let left = frame.left + r.left, top = frame.top + r.bottom + 8;
        if (top + h > innerHeight - 8) top = Math.max(8, frame.top + r.top - h - 8);
        left = Math.max(8, Math.min(innerWidth - w - 8, left));
        this.pop.style.left = left + 'px';
        this.pop.style.top = top + 'px';
    }

    _font() { return this.target && this.target.span ? fontOf(this.target.span) : lastMathFont(); }

    async _preview() {
        if (!this.pop) return;
        const n = ++this.seq, tex = this.input.value.trim();
        if (!tex) { this.preview.innerHTML = ''; this._error(''); return; }
        try {
            const svg = await texToSvg(tex, this._font(), { inline: true });
            if (n !== this.seq || !this.pop) return;
            this.preview.innerHTML = svg;
            this._error('');
        } catch (err) { if (n === this.seq && this.pop) this._error(err.message); }
    }
    _error(msg) {
        if (!this.err) return;
        this.err.hidden = !msg;
        this.err.textContent = msg ? 'Not drawn: ' + msg : '';
    }

    /* Enter: the equation in (or changed, or removed when emptied); a TeX that does not draw
       keeps the popover open with MathJax's message. */
    async apply() {
        const te = this.te, t = this.target;
        if (!this.pop || !t || !te.el) return;
        const tex = this.input.value.trim();
        if (t.span && !tex) { const span = t.span; this.close({ refocus: true, after: null, before: span }); te.removeMath(span); return; }
        if (!tex) { this.close(); return; }
        const font = this._font();
        let svg;
        try { svg = await texToSvg(tex, font, { inline: true }); }
        catch (err) { this._error(err.message); return; }
        if (this.target !== t || !te.el) return;                       // closed or moved on while drawing
        let span = t.span;
        if (span) {
            if (!te.el.contains(span)) { this.close(); return; }
            te.checkpoint('Edit text');
            span.setAttribute('data-math', tex);
            span.innerHTML = svg;
            te.checkpoint('Edit equation');
        } else {
            const range = t.range;
            if (!te.el.contains(range.commonAncestorContainer)) { this.close(); return; }
            te.checkpoint('Edit text');
            const doc = this.deck.doc;
            span = doc.createElement('span');
            span.setAttribute('data-math', tex);
            if (font === 'stix2') span.setAttribute('data-math-font', 'stix2');
            span.innerHTML = svg;
            range.deleteContents();
            range.insertNode(span);
            te.lockMath();
            te.checkpoint('Insert equation');
        }
        this.close({ after: span });
        te._positionBar();
        this.app.selection.refresh();
    }

    /* Close the popover. `refocus`: back to the text, the caret after the equation (`after`),
       before it (`before`), or where it was. */
    close({ refocus = true, after = null, before = null } = {}) {
        if (!this.pop) return;
        clearTimeout(this.timer);
        this.seq++;
        const t = this.target;
        this.pop.remove();
        this.pop = null; this.target = null; this.input = this.preview = this.err = null;
        const te = this.te;
        if (!refocus || !te.el) return;
        const doc = this.deck.doc, sel = this.deck.win.getSelection(), r = doc.createRange();
        te.el.focus({ preventScroll: true });
        const span = after || (t && t.span);
        if (before && te.el.contains(before)) { r.setStartBefore(before); }
        else if (span && te.el.contains(span)) {
            // The caret after an equation needs text to sit in: a zero-width space when nothing
            // follows (tidy() takes it out when the edit ends).
            let next = span.nextSibling;
            if (!next || next.nodeType !== 3) { next = doc.createTextNode('​'); span.after(next); r.setStart(next, 1); }
            else r.setStart(next, 0);
        } else if (t && t.range && te.el.contains(t.range.commonAncestorContainer)) r.setStart(t.range.endContainer, t.range.endOffset);
        else { r.selectNodeContents(te.el); r.collapse(false); }
        r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
    }

    /* Draw the equations in `root` that have no drawing yet (a paste brings their LaTeX alone).
       Not an undo step: the text edit they are part of records them. */
    async drawIn(root) {
        for (const span of Array.from(root.querySelectorAll(INLINE_MATH))) {
            if (drawnRight(span)) continue;
            try { span.innerHTML = await texToSvg(span.getAttribute('data-math') || '', fontOf(span), { inline: true }); }
            catch (err) { /* it keeps its LaTeX as text, and the Problems list has it once the deck opens again */ }
        }
        if (this.te.el) this.te._positionBar();
    }
}

/* A \( ... \) or $ ... $ typed just before a caret, in the same piece of text: its range and TeX. */
function typedBefore(range) {
    const node = range.startContainer;
    if (node.nodeType !== 3) return null;
    const text = node.data.slice(0, range.startOffset).replace(/​/g, '');
    const m = /\\\(((?:(?!\\\().)+?)\\\)\s*$/.exec(text) || /(?:^|[^\\$])\$([^$]+)\$\s*$/.exec(text);
    if (!m || !m[1].trim()) return null;
    const raw = node.data.slice(0, range.startOffset);
    if (raw.length !== text.length) return null;             // zero-width spaces in the way: leave it to the popover
    const start = m[0].startsWith('\\(') || m[0].startsWith('$') ? m.index : m.index + 1;
    const r = range.cloneRange();
    r.setStart(node, start);
    r.setEnd(node, range.startOffset);
    return { range: r, tex: m[1].trim() };
}
