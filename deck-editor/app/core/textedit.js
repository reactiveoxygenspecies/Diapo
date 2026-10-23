/* ============================================================
   textedit.js - editing text in place.

   The target element becomes contenteditable inside the deck
   iframe while the overlay lets pointer events through. The edit
   is committed (one history step: old innerHTML -> new) on Esc,
   on a click anywhere else, on slide change, before undo/redo and
   before save. focusout is deliberately not relied on: it does not
   fire when the window is not focused.

   A small formatting bar floats above the element in the editor
   document; its buttons run execCommand in the deck document
   without taking focus away from the text.
   ============================================================ */
import { isEditableText, textBlocks, isShape } from './dom.js';
import { highlightCode, setListKind } from './insert.js';
import { chartOf } from './chart.js';
import { canCrop } from './crop.js';

const BAR_ITEMS = [
    ['bold', 'B', 'Bold (Ctrl+B)'], ['italic', 'I', 'Italic (Ctrl+I)'], ['underline', 'U', 'Underline (Ctrl+U)'],
    ['strike', 'S', 'Strikethrough (Ctrl+Shift+X)'], ['sup', 'x<sup>2</sup>', 'Superscript (Ctrl+Shift+=)'], ['sub', 'x<sub>2</sub>', 'Subscript (Ctrl+=)'],
    ['code', '&lt;/&gt;', 'Code (monospace)'], ['clear', 'T<sub>x</sub>', 'Clear formatting'],
    ['link', '&#128279;', 'Link'], ['list', '&#8226;&#8801;', 'Bullet list'], ['olist', '1&#8801;', 'Numbered list'],
    ['left', '&#8676;', 'Align left'], ['center', '&#8596;', 'Align centre'], ['right', '&#8677;', 'Align right'],
    ['done', '&#10003;', 'Done (Esc)'],
];

/* Parts of the editor that work on the selected part of the text (the panel's Colour and Text
   sections, the font picker they open): a press there does not end the edit, and the press on
   anything but a field is swallowed so the text keeps its selection. */
const KEEPS_SELECTION = '#inspColour, #inspType, .fontpick';

export class TextEditor extends EventTarget {
    constructor(app, { overlay, wrap, canvas }) {
        super();
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.selection = app.selection;
        this.overlay = overlay;
        this.wrap = wrap;
        this.canvas = canvas;
        this.el = null;          // the contenteditable element
        this._lastRange = null;  // the selected part of the text, kept while the panel has the focus
        this._selSrc = null;     // what carried its formatting when the panel was last told
        this.before = null;      // its innerHTML when editing began
        this._buildBar();
        this._bind();
    }

    get active() { return !!this.el || !!this.svg; }

    /* The element that actually holds the text for a selected element:
       itself, or its [data-edit] / first text block (a composite label).
       Lists are edited as a whole (Enter makes a new item); a code block's
       <code> is the target; with a point (a double-click) the text block
       under it wins, so a table cell or a caption is edited directly. */
    static target(el, at = null) {
        if (!el) return null;
        if (isShape(el)) return null;                       // SVG text is not editable in place (v1)
        if (el.hasAttribute('data-placeholder')) return null;   // filled with a picture instead (editor.js)
        if (el.matches('ul, ol')) return el;
        if (el.matches('li') && el.closest('ul, ol')) return el.closest('ul, ol');   // a list is edited as a whole
        if (el.matches('pre') && el.querySelector('code')) return el.querySelector('code');
        if (isEditableText(el)) return el;
        const under = at ? TextEditor.blockAt(el, at) : null;
        if (under) return under;
        const marked = el.querySelector('[data-edit]');
        if (marked) { const list = marked.closest('ul, ol'); return list && el.contains(list) ? list : marked; }
        const blocks = textBlocks(el);
        return blocks.length ? blocks[0] : null;
    }

    /* The editable text block inside `el` under a point in the editor's client space. */
    static blockAt(el, at) {
        const doc = el.ownerDocument, win = doc.defaultView;
        const frame = win.frameElement;
        const r = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
        let n = doc.elementFromPoint(at.clientX - r.left, at.clientY - r.top);
        while (n && n !== el && el.contains(n)) {
            if (n.matches('ul, ol')) return n;
            if (n.matches('li') && n.closest('ul, ol') && el.contains(n.closest('ul, ol'))) return n.closest('ul, ol');
            if (!isShape(n) && isEditableText(n)) return n;
            n = n.parentElement;
        }
        return null;
    }

    /* ------------------------------------------------------------
       Start / commit
       ------------------------------------------------------------ */
    start(el, at = null) {
        if (el && el.hasAttribute && el.hasAttribute('data-placeholder')) return false;
        if (chartOf(el)) return false;              // a chart's words are its table, in the panel
        if (el && el.closest && el.closest('[data-math], [data-chem]')) return false;   // their source is in the panel too
        if (canCrop(el)) return false;              // a double-click on a picture crops it (crop.js)
        // Labels inside inline SVG: the <text> that was hit (or selected exactly) is edited in a box over it.
        const svgText = TextEditor.svgTextAt(el, at);
        if (svgText) return this.startSvg(svgText);
        const t = TextEditor.target(el, at);
        if (!t) { this.app.toast('This element has no editable text'); return false; }
        if (this.el === t) return true;
        if (this.el) this.commit();
        this.el = t;
        this.before = t.innerHTML;
        this.history.remember(t);
        t.setAttribute('contenteditable', 'true');
        t.setAttribute('spellcheck', 'false');
        this.selection.setPassthrough(true);
        this.overlay.classList.add('editing');
        if (!this.selection.has(el)) this.selection.select(el);
        t.focus({ preventScroll: true });
        this._placeCaret(at);
        this._showBar();
        this.dispatchEvent(new CustomEvent('start', { detail: t }));
        return true;
    }

    commit() {
        if (this.svg) return this.commitSvg();
        const t = this.el;
        if (!t) return;
        this.el = null;
        this._lastRange = null;
        this._selSrc = null;
        t.removeAttribute('contenteditable');
        t.removeAttribute('spellcheck');
        tidy(t);
        if (t.matches('code[data-code]')) highlightCode(t);      // colours follow the new text
        const after = t.innerHTML;
        if (after !== this.before) this.history.html(t, this.before, after, 'Edit text');
        this.before = null;
        this.selection.setPassthrough(false);
        this.overlay.classList.remove('editing');
        this._hideBar();
        try { this.deck.win.getSelection().removeAllRanges(); } catch (e) { /* no selection */ }
        this.selection.refresh();
        this.dispatchEvent(new CustomEvent('commit', { detail: t }));
    }

    /* ------------------------------------------------------------
       Text inside inline SVG. contenteditable does not work there, so
       a textarea in the editor's own document sits over the <text>
       with its font, size and colour at the current zoom; the SVG is
       updated while typing and the whole edit is one undo step. Lines
       map to the <text>'s direct <tspan> children when it has them.
       ------------------------------------------------------------ */
    static svgTextAt(el, at) {
        if (!el || !isShape(el) && !el.matches('svg, [data-svg]')) return null;
        if (isShape(el) && el.matches('text, tspan')) return el.closest('text');
        if (!at) return null;
        const doc = el.ownerDocument, frame = doc.defaultView.frameElement;
        const r = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
        const x = at.clientX - r.left, y = at.clientY - r.top;
        const hit = doc.elementFromPoint(x, y);
        const text = hit && hit.closest ? hit.closest('text') : null;
        if (text && el.contains(text)) return text;
        // Between two lines of a label nothing is hit; the label's box still counts.
        return Array.from(el.querySelectorAll('text')).find(t => { const b = t.getBoundingClientRect(); return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom; }) || null;
    }

    static svgLines(text) {
        const spans = Array.from(text.children).filter(c => c.tagName.toLowerCase() === 'tspan');
        return spans.length ? spans : [text];
    }

    startSvg(text) {
        if (this.svg && this.svg.text === text) return true;
        if (this.el || this.svg) this.commit();
        const win = this.deck.win, cs = win.getComputedStyle(text), k = this.deck.scale;
        const lines = TextEditor.svgLines(text);
        const before = text.innerHTML;
        this.history.remember(text);
        this.history.remember(text.closest('[data-svg]') || text.closest('svg'));
        const ta = document.createElement('textarea');
        ta.className = 'svgtext-edit';
        ta.rows = lines.length;
        ta.value = lines.map(l => l.textContent).join(String.fromCharCode(10));
        ta.spellcheck = false;
        const px = parseFloat(cs.fontSize) * k;
        ta.style.font = `${cs.fontStyle} ${cs.fontWeight} ${px}px/${1.2} ${cs.fontFamily}`;
        ta.style.color = cs.fill && cs.fill !== 'none' ? cs.fill : cs.color;
        ta.style.textAlign = cs.textAnchor === 'middle' ? 'center' : cs.textAnchor === 'end' ? 'right' : 'left';
        this.wrap.appendChild(ta);
        // Extra lines are cloned from the original second line (a continuation), or get a plain 1.2em step.
        const template = lines.length > 1 ? lines[1].cloneNode(false) : null;
        this.svg = { text, lines, before, ta, template };
        this._placeSvgBox();
        this.selection.setPassthrough(true);
        this.overlay.classList.add('editing');
        ta.focus();
        ta.setSelectionRange(0, ta.value.length);
        // Live: the label follows the typing.
        ta.addEventListener('input', () => { this._applySvgValue(); this._placeSvgBox(); });
        ta.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); this.commit(); }
            else if (e.key === 'Tab') e.preventDefault();
            else if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) { e.preventDefault(); this.commit(); window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, ctrlKey: true, shiftKey: e.shiftKey, bubbles: true })); }
        });
        this.dispatchEvent(new CustomEvent('start', { detail: text }));
        return true;
    }

    _placeSvgBox() {
        if (!this.svg) return;
        const { text, ta } = this.svg;
        const r = text.getBoundingClientRect(), w = this.wrap.getBoundingClientRect();
        const frame = this.deck.iframe.getBoundingClientRect();
        const left = frame.left - w.left + r.left, top = frame.top - w.top + r.top;
        const pad = 6;
        ta.style.left = (left - pad) + 'px';
        ta.style.top = (top - pad) + 'px';
        ta.style.width = Math.max(80, r.width + pad * 2 + 20) + 'px';
        ta.style.height = Math.max(r.height + pad * 2, parseFloat(ta.style.fontSize || '16') * 1.4) + 'px';
    }

    /* Write the textarea's lines into the <text>: one per <tspan> (new ones cloned from the
       last, surplus removed), or all into the element when it has none. */
    _applySvgValue() {
        const { text, ta, template } = this.svg;
        const values = ta.value.split(String.fromCharCode(10));
        let lines = TextEditor.svgLines(text);
        if (lines[0] === text) {
            text.textContent = values.join(' ');
            return;
        }
        while (lines.length < values.length) {
            const last = lines[lines.length - 1];
            const extra = template ? template.cloneNode(false) : last.cloneNode(false);
            extra.removeAttribute('dx');
            if (!template) { extra.setAttribute('dy', '1.2em'); if (lines[0].getAttribute('x') != null) extra.setAttribute('x', lines[0].getAttribute('x')); }
            last.after(extra);
            lines = TextEditor.svgLines(text);
        }
        while (lines.length > values.length && lines.length > 1) { lines.pop().remove(); }
        lines.forEach((l, i) => { l.textContent = values[i]; });
    }

    commitSvg() {
        const { text, before, ta } = this.svg;
        this.svg = null;
        ta.remove();
        const after = text.innerHTML;
        if (after !== before) this.history.html(text, before, after, 'Edit label');
        this.selection.setPassthrough(false);
        this.overlay.classList.remove('editing');
        this.selection.refresh();
        this.dispatchEvent(new CustomEvent('commit', { detail: text }));
    }

    /* Enter in a list: everything from the caret to the end of the item moves into a new item
       after it, which keeps the item's own attributes (its marker, its indent, data-edit), and
       the caret goes to its start. False when the caret is not in an item, so the browser can
       have its way. */
    splitListItem() {
        const doc = this.deck.doc, sel = this.deck.win.getSelection();
        if (!sel || !sel.rangeCount) return false;
        const li = this._inlineAncestor('li');
        if (!li) return false;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const tail = doc.createRange();
        tail.selectNodeContents(li);
        tail.setStart(range.startContainer, range.startOffset);
        const next = doc.createElement('li');
        for (const a of li.attributes) if (a.name !== 'data-id') next.setAttribute(a.name, a.value);
        next.appendChild(tail.extractContents());
        li.parentNode.insertBefore(next, li.nextSibling);
        // The space the split falls on would collapse to nothing when drawn, and the browser
        // drops it as soon as anything is typed: the items are trimmed where they meet.
        const head = lastTextNode(li), tail2 = firstTextNode(next);
        if (head) head.data = head.data.replace(/\s+$/, '');
        if (tail2) tail2.data = tail2.data.replace(/^\s+/, '');
        dropEmptyInline(li); dropEmptyInline(next);
        const r = doc.createRange();
        r.setStart(next, 0); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
        return true;
    }
    /* Backspace at the start of an item: it joins the one before, caret where they meet.
       False anywhere else, so ordinary deleting is the browser's. */
    joinListItem() {
        const doc = this.deck.doc, sel = this.deck.win.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
        const li = this._inlineAncestor('li');
        if (!li || !li.previousElementSibling || !li.previousElementSibling.matches('li')) return false;
        const before = doc.createRange();
        before.selectNodeContents(li);
        before.setEnd(sel.anchorNode, sel.anchorOffset);
        if (before.toString() !== '') return false;                 // not at the start of the item
        const prev = li.previousElementSibling;
        const r = doc.createRange();
        if (prev.lastChild) r.setStartAfter(prev.lastChild); else r.setStart(prev, 0);
        r.collapse(true);
        while (li.firstChild) prev.appendChild(li.firstChild);
        li.remove();
        dropEmptyInline(prev);
        sel.removeAllRanges(); sel.addRange(r);
        return true;
    }

    /* Tab in a table cell: the next (or previous) cell; past the last cell, a new row. */
    nextCell(dir) {
        const cell = this.el, table = cell.closest('table'); if (!table) return;
        const cells = Array.from(table.querySelectorAll('td, th'));
        const i = cells.indexOf(cell) + dir;
        this.commit();
        if (i >= cells.length) {
            const tr = this.app.insert.tableAddRow(table);
            const first = tr && tr.querySelector('td, th');
            if (first) { this.start(first); this._selectContents(first); }
            return;
        }
        if (i < 0) return;
        this.start(cells[i]);
        this._selectContents(cells[i]);
    }
    _selectContents(el) {
        const r = this.deck.doc.createRange(); r.selectNodeContents(el);
        const s = this.deck.win.getSelection(); s.removeAllRanges(); s.addRange(r);
    }

    _placeCaret(at) {
        const w = this.deck.win, doc = this.deck.doc;
        const sel = w.getSelection();
        let range = null;
        if (at) {
            const r = this.wrap.getBoundingClientRect();
            const x = at.clientX - r.left, y = at.clientY - r.top;
            range = doc.caretRangeFromPoint ? doc.caretRangeFromPoint(x, y) : null;
            if (range && !this.el.contains(range.startContainer)) range = null;
        }
        if (!range) { range = doc.createRange(); range.selectNodeContents(this.el); range.collapse(false); }
        sel.removeAllRanges(); sel.addRange(range);
    }

    /* ------------------------------------------------------------
       Formatting bar
       ------------------------------------------------------------ */
    _buildBar() {
        const bar = document.createElement('div');
        bar.className = 'textbar';
        bar.hidden = true;
        bar.innerHTML = BAR_ITEMS.map(([cmd, label, title]) => `<button data-cmd="${cmd}" title="${title}">${label}</button>`).join('');
        document.body.appendChild(bar);
        this.bar = bar;
        // Never let the bar take focus away from the text being edited.
        bar.addEventListener('pointerdown', (e) => e.preventDefault());
        bar.addEventListener('mousedown', (e) => e.preventDefault());
        bar.addEventListener('click', (e) => {
            const b = e.target.closest('[data-cmd]'); if (!b) return;
            e.preventDefault();
            this.exec(b.dataset.cmd);
        });
    }
    exec(cmd) {
        if (!this.el) return;
        const doc = this.deck.doc;
        this.el.focus({ preventScroll: true });
        switch (cmd) {
            case 'bold': doc.execCommand('bold'); break;
            case 'italic': doc.execCommand('italic'); break;
            case 'underline': doc.execCommand('underline'); break;
            case 'strike': doc.execCommand('strikeThrough'); break;
            case 'sup': doc.execCommand('superscript'); this.deck.refreshAnimations(); break;      // refreshes the managed blocks: the sup/sub rule appears with the first script
            case 'sub': doc.execCommand('subscript'); this.deck.refreshAnimations(); break;
            case 'code': this._toggleInline('code'); break;
            case 'clear': doc.execCommand('removeFormat'); doc.execCommand('unlink'); this._unwrapInline(['code', 'sup', 'sub']); break;
            // A whole list is the element being edited, and execCommand cannot replace the
            // element it edits inside: the list is rebuilt as the other kind and editing goes on.
            case 'list': case 'olist': {
                const ordered = cmd === 'olist';
                const host = this.el;
                if (host && host.matches('ul, ol')) {
                    if ((host.tagName === 'OL') === ordered) return;      // already that kind
                    this.commit();
                    this.start(setListKind(this.history, host, ordered));
                    return;
                }
                doc.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList');
                break;
            }
            case 'left': doc.execCommand('justifyLeft'); break;
            case 'center': doc.execCommand('justifyCenter'); break;
            case 'right': doc.execCommand('justifyRight'); break;
            case 'link': {
                const sel = this.deck.win.getSelection();
                const existing = sel.anchorNode && sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('a');
                const url = prompt('Link address (empty removes the link):', existing ? existing.getAttribute('href') : 'https://');
                if (url === null) break;
                if (url.trim() === '' || url === 'https://') doc.execCommand('unlink'); else doc.execCommand('createLink', false, url.trim());
                break;
            }
            case 'done': this.commit(); return;
        }
        this._syncBar();
    }
    /* The inline element the caret sits in (a <code>, say), inside the edited text only. */
    _inlineAncestor(tag) {
        const sel = this.deck.win.getSelection();
        if (!sel || !sel.anchorNode) return null;
        const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
        const hit = el && el.closest(tag);
        return hit && hit !== this.el && this.el.contains(hit) ? hit : null;
    }
    /* The selection inside the edited text, when there is one and it is not just a caret. */
    _selectedRange() {
        if (!this.el) return null;
        const sel = this.deck.win.getSelection();
        if (!sel || !sel.rangeCount) return null;
        const r = sel.getRangeAt(0);
        if (r.collapsed || !this.el.contains(r.commonAncestorContainer)) return null;
        return r;
    }
    /* A press in the panel can take the focus out of the deck (a number field, the font
       search), and the browser drops the iframe's selection with it. The last real selection
       is kept here, so the fields still know which words they are changing; it is dropped
       when the caret moves in the text itself, and when the edit ends. */
    _rememberRange() {
        const r = this._selectedRange();
        if (r) this._lastRange = r.cloneRange();
        else if (this.deck.doc.hasFocus()) this._lastRange = null;
    }
    /* The selected part of the text: what is selected now, or what was before the panel took
       the focus (while it is still inside the edited element). */
    _styleRange() {
        const live = this._selectedRange();
        if (live) return live;
        const last = this._lastRange;
        if (!last || !this.el || last.collapsed || !this.el.contains(last.commonAncestorContainer)) return null;
        return last;
    }
    hasStyleRange() { return !!this._styleRange(); }
    /* The element whose formatting the selected part of the text has, for the panel to show
       and change: the span (or b, i, sub ...) the selection starts in, or the edited element
       itself. Null when nothing is selected, so the panel falls back to the selected elements. */
    selectionElement() {
        const range = this._styleRange();
        if (!range) return null;
        const n = range.startContainer;
        return (n.nodeType === 1 ? n : n.parentElement) || this.el;
    }
    /* Colour the selected part of the text: a <span style="color"> round it (an existing one that
       holds exactly the selection is reused, so a colour picker's live values do not nest spans);
       '' takes the colour off. False when there is no selection to colour. */
    colourSelection(value) { return this.styleSelection({ color: value || '' }); }
    /* The same for any inline properties (the panel's font, size, weight, style and spacing):
       `props` is a map of style property to value, '' taking that one off again. */
    styleSelection(props) {
        const range = this._styleRange();
        if (!range) return false;
        const win = this.deck.win, doc = this.deck.doc, sel = win.getSelection();
        // The selection may have been dropped when the panel took the focus: put it back, so
        // the span is made around the right words and _inlineAncestor sees them.
        if (!this._selectedRange()) { sel.removeAllRanges(); sel.addRange(range); }
        let span = this._inlineAncestor('span');
        const covers = span && range.toString() === span.textContent;
        if (!covers) {
            if (Object.values(props).every(v => !v)) return true;   // nothing to set, and no span of ours to clear it from
            span = doc.createElement('span');
            try { range.surroundContents(span); }
            catch (e) { span.appendChild(range.extractContents()); range.insertNode(span); }   // a selection crossing other inline tags
        }
        for (const [prop, v] of Object.entries(props)) span.style[prop] = v || '';
        const r = doc.createRange();
        if (!span.getAttribute('style')) {
            // Nothing left on the span: its text goes back in place, still selected.
            const first = span.firstChild, last = span.lastChild, parent = span.parentNode;
            while (span.firstChild) parent.insertBefore(span.firstChild, span);
            parent.removeChild(span);
            if (first) { r.setStartBefore(first); r.setEndAfter(last); }
        } else r.selectNodeContents(span);
        sel.removeAllRanges(); sel.addRange(r);
        this._lastRange = r.cloneRange();
        this._syncBar();
        return true;
    }
    /* Wrap the selection in <tag>, or unwrap it when the caret is already inside one. */
    _toggleInline(tag) {
        const win = this.deck.win, doc = this.deck.doc, sel = win.getSelection();
        if (!sel || !sel.rangeCount) return;
        const inside = this._inlineAncestor(tag);
        if (inside) { this._unwrap(inside); return; }
        const range = sel.getRangeAt(0);
        if (range.collapsed) return;
        const wrap = doc.createElement(tag);
        try { range.surroundContents(wrap); }
        catch (e) { wrap.appendChild(range.extractContents()); range.insertNode(wrap); }   // a selection crossing other inline tags
        sel.removeAllRanges();
        const r = doc.createRange(); r.selectNodeContents(wrap); sel.addRange(r);
    }
    _unwrapInline(tags) {
        for (const t of tags) { let el; let guard = 0; while ((el = this._inlineAncestor(t)) && guard++ < 10) this._unwrap(el); }
    }
    _unwrap(el) {
        const parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
    }
    _showBar() {
        this.bar.hidden = false;
        this._positionBar();
        this._syncBar();
    }
    _hideBar() { this.bar.hidden = true; }
    _positionBar() {
        if (!this.el || this.bar.hidden) return;
        const r = this.el.getBoundingClientRect(), w = this.wrap.getBoundingClientRect();
        const c = this.canvas.getBoundingClientRect();
        const left = Math.max(c.left + 4, Math.min(c.right - this.bar.offsetWidth - 4, w.left + r.left + r.width / 2 - this.bar.offsetWidth / 2));
        let top = w.top + r.top - this.bar.offsetHeight - 10;
        if (top < c.top + 4) top = w.top + r.bottom + 10;
        this.bar.style.left = left + 'px';
        this.bar.style.top = top + 'px';
    }
    _syncBar() {
        if (!this.el) return;
        const doc = this.deck.doc;
        for (const [cmd] of BAR_ITEMS) {
            const b = this.bar.querySelector(`[data-cmd="${cmd}"]`);
            let on = false;
            try {
                if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') on = doc.queryCommandState(cmd);
                else if (cmd === 'strike') on = doc.queryCommandState('strikeThrough');
                else if (cmd === 'sup' || cmd === 'sub') on = doc.queryCommandState(cmd === 'sup' ? 'superscript' : 'subscript');
                else if (cmd === 'code') on = !!this._inlineAncestor('code');
                else if (cmd === 'list') on = doc.queryCommandState('insertUnorderedList');
                else if (cmd === 'olist') on = doc.queryCommandState('insertOrderedList');
                else if (cmd === 'left' || cmd === 'center' || cmd === 'right') on = doc.queryCommandState('justify' + cmd[0].toUpperCase() + cmd.slice(1));
            } catch (e) { /* not queryable */ }
            b.classList.toggle('on', !!on);
        }
    }

    /* ------------------------------------------------------------
       Events that end or affect an edit
       ------------------------------------------------------------ */
    _bind() {
        this.selection.addEventListener('edit-text', (e) => this.start(e.detail.el, e.detail.at || null));
        this.deck.addEventListener('slide', () => this.commit());
        window.addEventListener('editor:before-step', () => this.commit());
        window.addEventListener('editor:before-save', () => this.commit());
        window.addEventListener('editor:preview', () => this.commit());
        window.addEventListener('editor:zoom', () => this._positionBar());
        this.selection.addEventListener('refresh', () => this._positionBar());
        this.canvas.addEventListener('scroll', () => this._positionBar());

        // A press anywhere in the editor UI (outside the bar) ends the edit. The panel's Colour
        // section is the exception while part of the text is selected: the colour goes on that
        // part (see colourSelection), so the edit and its selection are kept; the press does not
        // take the focus, the selection stays as it is.
        document.addEventListener('pointerdown', (e) => {
            if (!this.active) return;
            if (e.target.closest('.textbar, .svgtext-edit')) return;
            if (this.el && e.target.closest(KEEPS_SELECTION) && this.hasStyleRange()) { if (!e.target.closest('input')) e.preventDefault(); return; }
            this.commit();
        }, true);
        window.addEventListener('editor:zoom', () => this._placeSvgBox());
        this.canvas.addEventListener('scroll', () => this._placeSvgBox());

        this.deck.addEventListener('ready', () => {
            const doc = this.deck.doc, win = this.deck.win;
            // A press in the deck outside the edited element ends the edit and selects what was pressed.
            doc.addEventListener('pointerdown', (e) => {
                if (!this.el) return;
                if (this.el.contains(e.target)) return;
                const target = e.target;
                this.commit();
                e.preventDefault();
                const picked = this.selection.pick(target, e.ctrlKey || e.metaKey);
                if (e.shiftKey) this.selection.toggle(picked); else this.selection.select(picked);
            }, true);
            doc.addEventListener('selectionchange', () => {
                if (!this.el) return;
                this._rememberRange();
                this._syncBar();
                // The panel follows the selected part, but only when it moves to different
                // formatting: a caret walking along one run changes nothing it shows.
                const src = this.selectionElement();
                if (src === this._selSrc) return;
                this._selSrc = src;
                this.dispatchEvent(new CustomEvent('selection', { detail: src }));
            });
            doc.addEventListener('input', () => { if (this.el) this._positionBar(); });
            // Plain-text paste: no foreign markup enters the deck. In code, newlines stay text.
            doc.addEventListener('paste', (e) => {
                if (!this.el) return;
                e.preventDefault();
                const text = (e.clipboardData || win.clipboardData).getData('text/plain');
                if (this.el.matches('code')) insertTextNode(win, text, this.el); else doc.execCommand('insertText', false, text);
            });
            // Keys inside the text: Enter = line break (a new item in a list, a newline in code),
            // Tab = next table cell, Esc = done; nothing reaches the deck's own key handling.
            doc.addEventListener('keydown', (e) => {
                if (!this.el) return;
                e.stopPropagation();       // capture phase: the deck's own key handling never sees typing
                if (e.key === 'Escape') { e.preventDefault(); this.commit(); return; }
                if (e.key === 'Tab' && this.el.matches('td, th')) { e.preventDefault(); this.nextCell(e.shiftKey ? -1 : 1); return; }
                // Tab in a list item makes it a sub-item (a nested list of the same kind), Shift+Tab
                // brings it back out; anywhere else Tab does nothing rather than leaving the text.
                if (e.key === 'Tab' && this._inlineAncestor('li')) { e.preventDefault(); doc.execCommand(e.shiftKey ? 'outdent' : 'indent'); return; }
                if (e.key === 'Tab') { e.preventDefault(); return; }
                if (e.key === 'Enter' && !e.shiftKey && this.el.matches('code')) { e.preventDefault(); insertTextNode(win, String.fromCharCode(10), this.el); return; }
                // In a list item Enter makes the next one and Backspace at the start joins the
                // one before. Done here wherever the item is: when the list is the element being
                // edited the browser will not split it (it cannot restructure its own editing
                // host), and when the list sits in a text box its default would drop the item's
                // classes and style.
                if (e.key === 'Enter' && !e.shiftKey && this._inlineAncestor('li')) { if (this.splitListItem()) { e.preventDefault(); return; } }
                if (e.key === 'Backspace' && this._inlineAncestor('li')) { if (this.joinListItem()) { e.preventDefault(); return; } }
                if (e.key === 'Enter' && !e.shiftKey && !this.el.matches('li, ul, ol')) { e.preventDefault(); insertLineBreak(this.deck.win, this.el); return; }
                const ctrl = e.ctrlKey || e.metaKey;
                if (ctrl && e.key.toLowerCase() === 'b') { e.preventDefault(); this.exec('bold'); }
                else if (ctrl && e.key.toLowerCase() === 'i') { e.preventDefault(); this.exec('italic'); }
                else if (ctrl && e.key.toLowerCase() === 'u') { e.preventDefault(); this.exec('underline'); }
                else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); this.exec('strike'); }
                else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.exec(e.shiftKey ? 'sup' : 'sub'); }
            }, true);
            // The deck must not navigate on wheel while text is being edited; scroll the canvas instead.
            win.addEventListener('wheel', (e) => {
                if (!this.el) return;
                e.stopImmediatePropagation();
                this.canvas.scrollTop += e.deltaY; this.canvas.scrollLeft += e.deltaX;
            }, { capture: true, passive: true });
        });
    }
}

/* Enter inserts a <br> at the caret (execCommand('insertLineBreak') is unreliable).
   A <br> at the very end needs a second one for the caret to get its own line;
   tidy() removes the surplus when the edit is committed. */
function insertLineBreak(win, root) {
    const sel = win.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const doc = root.ownerDocument;
    const br = doc.createElement('br');
    range.insertNode(br);
    let after = br.nextSibling;
    while (after && after.nodeType === 3 && !after.textContent) after = after.nextSibling;
    if (!after) br.after(doc.createElement('br'));
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
}

/* Insert plain text (with its newlines) at the caret as a text node, for code blocks
   where a <br> would be lost when the text is read back for highlighting. */
function insertTextNode(win, text, root) {
    const sel = win.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = win.document.createTextNode(text);
    range.insertNode(node);
    // A caret cannot sit after a newline that ends the block (pre-wrap gives it no line),
    // so a newline at the very end gets a second one; tidy() drops the surplus on commit.
    let pad = false;
    if (text.endsWith(String.fromCharCode(10)) && root) {
        const after = win.document.createRange(); after.setStartAfter(node); after.setEnd(root, root.childNodes.length);
        if (!after.toString()) { node.textContent += String.fromCharCode(10); pad = true; }
    }
    if (pad) { range.setStart(node, node.textContent.length - 1); }
    else range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
}

/* Remove the leftovers contenteditable tends to produce: trailing <br>s carry no
   visible line, so they are dropped; an element left with only a <br> becomes empty. */
function firstTextNode(root) { return root.ownerDocument.createTreeWalker(root, 4 /* text */).nextNode(); }
function lastTextNode(root) {
    const w = root.ownerDocument.createTreeWalker(root, 4 /* text */);
    let last = null, n;
    while ((n = w.nextNode())) last = n;
    return last;
}
/* Inline wrappers a split left with nothing in them (an empty <span> where the text moved on). */
function dropEmptyInline(el) {
    for (const n of Array.from(el.querySelectorAll('*')).reverse()) {
        if (n.matches(KEEP_EMPTY) || n.querySelector(KEEP_EMPTY)) continue;
        if (!n.textContent) n.remove();
    }
}
const KEEP_EMPTY = 'br, img, video, svg, canvas, iframe, picture, object, input';

function tidy(el) {
    while (el.lastChild && (el.lastChild.nodeName === 'BR' || (el.lastChild.nodeType === 3 && !el.lastChild.textContent.trim() && el.lastChild.previousSibling && el.lastChild.previousSibling.nodeName === 'BR'))) {
        el.lastChild.remove();
    }
    if (el.innerHTML === '<br>') el.innerHTML = '';
    // An empty item at the end of a list is how Enter finishes one: it is not kept. The list
    // may be the element being edited or sit inside it (a list made in a text box).
    for (const list of [...(el.matches('ul, ol') ? [el] : []), ...el.querySelectorAll('ul, ol')]) {
        while (list.lastElementChild && list.lastElementChild.matches('li')
            && !list.lastElementChild.textContent.trim() && !list.lastElementChild.querySelector(KEEP_EMPTY)) list.lastElementChild.remove();
    }
    // Code keeps newlines as text; one trailing newline is the padding Enter adds at the end.
    if (el.matches('code')) {
        const texts = [];
        const walk = el.ownerDocument.createTreeWalker(el, 4 /* text */);
        while (walk.nextNode()) texts.push(walk.currentNode);
        while (texts.length && !texts[texts.length - 1].textContent) texts.pop().remove();   // empty nodes typing leaves behind
        const last = texts[texts.length - 1];                            // the last text in document order (may sit inside a span)
        if (last && last.textContent.endsWith(String.fromCharCode(10))) last.textContent = last.textContent.slice(0, -1);
        if (last && !last.textContent) last.remove();
    }
}
