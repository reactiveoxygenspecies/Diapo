/* ============================================================
   find.js - find and replace across the whole deck (Ctrl+F, Ctrl+H).

   The browser's own find does not see into the deck iframe in a useful way (and not at all
   into speaker notes), so the editor searches the deck itself: every slide, skipped ones
   too, plus the master layer (the footer). Text elements, lists, tables, shapes with text
   (SVG labels) and, optionally, speaker notes are searched; charts, equations (those inside
   a sentence too: a match never runs across one), structures and code blocks are not
   (their text is data or markup, not prose).

   Matching works on a text block at a time (a paragraph, a list item, a table cell), with
   the text of its formatting runs joined, so "Hello world" is found when "world" is bold.

   Replacing edits text nodes only, so bold spans, links and sub/sup stay. A match that
   runs across two formatting runs ("Hel" + bold "lo") is SKIPPED, not replaced: joining two
   runs would silently drop one of the two formattings. Replace all counts them and says
   so, and the match stays in the list to be fixed by hand. Every replacement goes into
   the undo history as the owning element's innerHTML before / after, like a text edit, and
   Replace all is one step.

   The highlight never touches the deck's markup: the CSS Custom Highlight API where the
   browser has it (ranges, styled by ::highlight in the editor's host style, which is
   removed on save), else boxes drawn over the stage in the editor's own layer.
   ============================================================ */
import { DRAWN } from './dom.js';

const SKIP_TAGS = /^(script|style|template|noscript|title|desc|metadata)$/i;
const BLOCK = /^(address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul|text)$/i;
const CHROME = '.notes, .deck-controls, .deck-overview, .deck-laser, .deck-draw, [data-ed-gen]';
const NOTES_SEL = ':scope > aside.notes, :scope > .notes';

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export class FindBar {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.history = app.history;
        this.el = null;
        this.opts = { matchCase: false, wholeWord: false, notes: false };
        this.matches = [];
        this.cur = -1;                 // index into matches of the one shown
        this.pos = null;               // its key, so the position survives a rebuild
        this.saved = null;             // the selection when the bar opened
        this.useApi = true;            // tests switch it off to try the fallback
        this._tok = 0;
        this._boxes = null;
        addEventListener('resize', () => { if (this.el) this._paint(); });
        this.deck.addEventListener('ready', () => { if (this.el) this.refresh(); });
    }

    get open() { return !!this.el; }

    /* ------------------------------------------------------------
       The bar
       ------------------------------------------------------------ */
    show({ replace = false } = {}) {
        if (!this.deck.isOpen) return;
        if (this.app.textEdit && this.app.textEdit.active) this.app.textEdit.commit();
        if (!this.el) {
            this.saved = { items: this.app.selection.items.slice(), slide: this.deck.current };
            this._build();
            let seed = '';
            try { seed = this.deck.win.getSelection().toString(); } catch (e) { /* ignore */ }
            if (seed && seed.length < 80 && !/\n/.test(seed)) this.input.value = seed.trim();
        }
        this.el.classList.toggle('with-replace', replace);
        this.replaceRow.hidden = !replace;
        this.refresh({ jump: false });
        const f = this.input;
        f.focus(); f.select();
        if (replace && this.input.value) this.replaceInput.focus();
    }

    _build() {
        const el = document.createElement('div');
        el.id = 'findBar';
        el.className = 'findbar';
        el.setAttribute('role', 'search'); el.setAttribute('aria-label', 'Find and replace');
        el.innerHTML = `
            <div class="find-row">
                <input type="text" class="find-in" placeholder="Find in the deck" aria-label="Find" spellcheck="false" autocomplete="off">
                <span class="find-count" aria-live="polite"></span>
                <button class="tb-btn icon" data-a="prev" title="Previous match (Shift+Enter)" aria-label="Previous match">&#9650;</button>
                <button class="tb-btn icon" data-a="next" title="Next match (Enter)" aria-label="Next match">&#9660;</button>
                <button class="tb-btn icon" data-a="close" title="Close (Esc)" aria-label="Close">&times;</button>
            </div>
            <div class="find-row find-opts">
                <label title="Only text with the same capitals"><input type="checkbox" data-o="matchCase"> Match case</label>
                <label title="Not inside a longer word"><input type="checkbox" data-o="wholeWord"> Whole word</label>
                <label title="Also search the notes of every slide"><input type="checkbox" data-o="notes"> Include speaker notes</label>
            </div>
            <div class="find-row find-replace" hidden>
                <input type="text" class="replace-in" placeholder="Replace with" aria-label="Replace with" spellcheck="false" autocomplete="off">
                <button class="mini-btn" data-a="replace" title="Replace this match and go to the next">Replace</button>
                <button class="mini-btn" data-a="replaceAll" title="Replace every match in the deck (one undo step)">Replace all</button>
            </div>
            <div class="find-note" hidden></div>`;
        const canvas = document.getElementById('canvas');
        const r = canvas ? canvas.getBoundingClientRect() : { top: 48, right: innerWidth };
        el.style.top = Math.round(r.top + 10) + 'px';
        el.style.right = Math.round(Math.max(10, innerWidth - r.right + 14)) + 'px';
        document.body.appendChild(el);
        this.el = el;
        this.input = el.querySelector('.find-in');
        this.replaceInput = el.querySelector('.replace-in');
        this.replaceRow = el.querySelector('.find-replace');
        this.countEl = el.querySelector('.find-count');
        this.noteEl = el.querySelector('.find-note');
        for (const cb of el.querySelectorAll('[data-o]')) {
            cb.checked = !!this.opts[cb.dataset.o];
            cb.addEventListener('change', () => { this.opts[cb.dataset.o] = cb.checked; this.refresh(); });
        }
        this.input.addEventListener('input', () => this.refresh());
        const keys = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                if (e.currentTarget === this.replaceInput) this.replaceOne();
                else this.step(e.shiftKey ? -1 : 1);
            }
        };
        this.input.addEventListener('keydown', keys);
        this.replaceInput.addEventListener('keydown', keys);
        el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });   // keep the field focused
        el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-a]'); if (!b) return;
            const a = b.dataset.a;
            if (a === 'close') this.close();
            else if (a === 'next') this.step(1);
            else if (a === 'prev') this.step(-1);
            else if (a === 'replace') this.replaceOne();
            else if (a === 'replaceAll') this.replaceAll();
        });
    }

    /* Esc: the bar goes, the highlight with it, and the selection the user had comes back
       (the matches selected on the way were only a way of showing them). */
    close({ restore = true } = {}) {
        if (!this.el) return;
        this._tok++;
        this.el.remove();
        this.el = null;
        this._clearHighlight();
        const s = this.saved; this.saved = null;
        this.matches = []; this.cur = -1; this.pos = null;
        if (!restore || !s || !this.deck.isOpen) return;
        const sel = this.app.selection;
        const items = s.items.filter(n => n.isConnected);
        if (items.length) {
            const slide = items[0].closest && items[0].closest('.slide');
            const i = slide ? this.deck.slides.indexOf(slide) : -1;
            if (i >= 0 && i !== this.deck.current) this.deck.goTo(i);
            sel.set(items);
        } else sel.clear();
    }

    /* ------------------------------------------------------------
       Finding
       ------------------------------------------------------------ */
    regex() {
        const q = this.input ? this.input.value : '';
        if (!q) return null;
        const w = '[\\p{L}\\p{N}_]';
        const body = escapeRe(q);
        return new RegExp(this.opts.wholeWord ? `(?<!${w})${body}(?!${w})` : body, 'gu' + (this.opts.matchCase ? '' : 'i'));
    }

    /* Every match in the deck, in reading order: the slides one after the other (each slide's
       notes after its text), then the master layer. */
    collect() {
        const re = this.regex();
        const out = [];
        if (!re || !this.deck.isOpen) return out;
        const slides = this.deck.slides;
        const doc = this.deck.doc;
        slides.forEach((s, i) => {
            this._scan(doc, s, i, false, re, out);
            if (this.opts.notes) for (const n of s.querySelectorAll(NOTES_SEL)) this._scan(doc, n, i, true, re, out);
        });
        this.deck.masterElements.forEach(m => this._scan(doc, m, slides.length, false, re, out));
        return out;
    }

    _scan(doc, root, slide, notes, re, out) {
        const groups = textGroups(doc, root, notes);
        groups.forEach((g, gi) => {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(g.text))) {
                if (!m[0].length) { re.lastIndex++; continue; }
                const a = locate(g, m.index), b = locate(g, m.index + m[0].length - 1);
                if (!a || !b) continue;
                out.push({
                    slide, notes, owner: g.owner, text: m[0],
                    startNode: a.node, startOff: a.off, endNode: b.node, endOff: b.off + 1,
                    single: a.node === b.node,
                    hidden: !notes && !!g.owner.closest('[data-hidden], [hidden]'),
                    key: [slide, notes ? 1 : 0, gi, m.index],
                    order: out.length,
                });
            }
        });
    }

    /* Rebuild the list (the text may have changed) and keep the shown match when it is still
       there; `jump` goes to the first match from the current slide when there was none. */
    refresh({ jump = true } = {}) {
        this.matches = this.collect();
        const n = this.matches.length;
        if (this.cur >= 0 && this.pos) {
            const i = this.matches.findIndex(m => cmpKey(m.key, this.pos) === 0);
            this.cur = i;
        }
        if (this.cur < 0 && n && jump) {
            const here = this.deck.current;
            let i = this.matches.findIndex(m => m.slide >= here);
            if (i < 0) i = 0;
            this._go(i);
            return;
        }
        if (!n) { this.cur = -1; this.pos = null; }
        this._paint();
    }

    step(dir) {
        if (!this.el) return;
        this.matches = this.collect();
        const n = this.matches.length;
        if (!n) { this.cur = -1; this.pos = null; this._paint(); return; }
        let i;
        if (!this.pos) i = dir > 0 ? 0 : n - 1;
        else if (dir > 0) { i = this.matches.findIndex(m => cmpKey(m.key, this.pos) > 0); if (i < 0) i = 0; }
        else { i = -1; for (let k = n - 1; k >= 0; k--) if (cmpKey(this.matches[k].key, this.pos) < 0) { i = k; break; } if (i < 0) i = n - 1; }
        return this._go(i);
    }

    /* Show match i: its slide, its element selected, the match marked. */
    async _go(i) {
        const m = this.matches[i];
        if (!m) return;
        const tok = ++this._tok;
        this.cur = i; this.pos = m.key;
        let field = this.el && this.el.contains(document.activeElement) ? document.activeElement : null;
        const d = this.deck, sel = this.app.selection;
        if (m.slide < d.slides.length && d.current !== m.slide) {
            d.goTo(m.slide);
            for (let k = 0; k < 40 && d.current !== m.slide; k++) await sleep(30);
            await sleep(30);
            if (tok !== this._tok || !this.el) return;
        }
        // The field to give the focus back to is the one in use now, not when the search began: while
        // the view was moving to the match (a slide change takes a moment), the user may have gone on
        // to the Replace field, and what they type there must stay there.
        const now = this.el && this.el.contains(document.activeElement) ? document.activeElement : null;
        if (now) field = now;
        const node = m.startNode;
        if (m.notes || m.hidden) sel.clear();
        else {
            const t = node.parentElement || m.owner;
            let target = null;
            try { target = sel.pick(t); } catch (e) { /* ignore */ }
            sel.select(target || m.owner);
        }
        if (m.notes) this._showInNotes(i);
        this._paint();
        if (field && document.activeElement !== field) field.focus();
    }

    /* A speaker note is not on the stage: show the match in the panel's notes box. */
    _showInNotes(i) {
        const ta = document.getElementById('inspNotes');
        if (!ta) return;
        const m = this.matches[i];
        let k = 0;
        for (let j = 0; j < i; j++) if (this.matches[j].notes && this.matches[j].slide === m.slide) k++;
        const re = this.regex(); if (!re) return;
        let hit, n = 0;
        while ((hit = re.exec(ta.value))) { if (!hit[0].length) { re.lastIndex++; continue; } if (n++ === k) break; }
        if (hit) { try { ta.setSelectionRange(hit.index, hit.index + hit[0].length); } catch (e) { /* ignore */ } }
    }

    _paint() {
        if (!this.el) return;
        const n = this.matches.length, has = !!(this.input && this.input.value);
        let text = '';
        const m = this.matches[this.cur];
        if (has) text = n ? (this.cur >= 0 ? `${this.cur + 1} of ${n}` : `${n} found`) : 'No matches';
        this.countEl.textContent = text;
        let note = '';
        if (m && m.hidden) note = 'This one is in a hidden element.';
        else if (m && m.notes) note = 'This one is in the speaker notes.';
        else if (m && !m.single) note = 'This one runs across a format change: replace it by hand.';
        else if (m && m.slide >= this.deck.slides.length) note = 'This one is in the footer (every slide).';
        this.noteEl.textContent = note;
        this.noteEl.hidden = !note;
        this.el.querySelector('[data-a="replace"]').disabled = !n;
        this.el.querySelector('[data-a="replaceAll"]').disabled = !n;
        this._highlight();
    }

    /* ------------------------------------------------------------
       The highlight
       ------------------------------------------------------------ */
    _ranges() {
        const doc = this.deck.doc;
        const here = this.deck.current, nSlides = this.deck.slides.length;
        const all = [], now = [];
        this.matches.forEach((m, i) => {
            if (m.notes || (m.slide !== here && m.slide !== nSlides)) return;
            const r = doc.createRange();
            try { r.setStart(m.startNode, m.startOff); r.setEnd(m.endNode, m.endOff); } catch (e) { return; }
            (i === this.cur ? now : all).push(r);
        });
        return { all, now };
    }
    _clearHighlight() {
        try { const h = this.deck.win && this.deck.win.CSS && this.deck.win.CSS.highlights; if (h) { h.delete('diapo-find'); h.delete('diapo-find-current'); } } catch (e) { /* ignore */ }
        if (this._boxes) { this._boxes.remove(); this._boxes = null; }
    }
    _highlight() {
        this._clearHighlight();
        if (!this.deck.isOpen || !this.matches.length) return;
        const w = this.deck.win, { all, now } = this._ranges();
        if (this.useApi && w.CSS && w.CSS.highlights && w.Highlight) {
            if (all.length) w.CSS.highlights.set('diapo-find', new w.Highlight(...all));
            if (now.length) w.CSS.highlights.set('diapo-find-current', new w.Highlight(...now));
            return;
        }
        // No Highlight API: boxes over the stage, in the editor's layer (the deck is not touched).
        const wrap = document.getElementById('stageWrap');
        if (!wrap) return;
        const layer = document.createElement('div');
        layer.className = 'find-boxes';
        for (const [ranges, cls] of [[all, 'find-box'], [now, 'find-box current']]) {
            for (const r of ranges) for (const q of r.getClientRects()) {
                if (q.width < 1) continue;
                const b = document.createElement('div');
                b.className = cls;
                b.style.cssText = `left:${q.left}px;top:${q.top}px;width:${q.width}px;height:${q.height}px`;
                layer.appendChild(b);
            }
        }
        wrap.appendChild(layer);
        this._boxes = layer;
    }

    /* ------------------------------------------------------------
       Replacing
       ------------------------------------------------------------ */
    get replacement() { return this.replaceInput ? this.replaceInput.value : ''; }

    async replaceOne() {
        if (!this.el) return;
        if (this.app.textEdit.active) this.app.textEdit.commit();
        this.matches = this.collect();
        const i = this.pos ? this.matches.findIndex(m => cmpKey(m.key, this.pos) === 0) : -1;
        if (i < 0) { this.pos = null; return this.step(1); }       // nothing shown yet: the first Replace goes to a match
        const m = this.matches[i];
        if (!m.single) {
            this.app.toast('That match runs across a format change (bold, a link...): change it by hand.', { ms: 3500 });
            return this.step(1);
        }
        const n = this.apply([m], this.replacement, 'Replace');
        // Carry on after the replaced text, so a replacement that holds the search text is not found again.
        this.pos = [m.key[0], m.key[1], m.key[2], m.key[3] + this.replacement.length - 1];
        this.cur = -1;
        this.matches = this.collect();
        if (!this.matches.length) { this._paint(); return n; }
        return this.step(1);
    }

    replaceAll() {
        if (!this.el) return;
        if (this.app.textEdit.active) this.app.textEdit.commit();
        const all = this.collect();
        const todo = all.filter(m => m.single), skipped = all.length - todo.length;
        if (!all.length) { this.app.toast('Nothing to replace'); return 0; }
        const done = this.apply(todo, this.replacement, 'Replace all');
        this.matches = this.collect(); this.cur = -1; this.pos = null;
        this._paint();
        const hidden = todo.filter(m => m.hidden).length;
        this.app.toast(`Replaced ${done} match${done === 1 ? '' : 'es'}` + (hidden ? ` (${hidden} in hidden elements)` : '') + (skipped ? `; skipped ${skipped} that run${skipped === 1 ? 's' : ''} across a format change` : '') + '. Ctrl+Z undoes them all.', { ms: 5000 });
        return done;
    }

    /* Put `rep` in the place of every match in the list (all single-node). Each owner's
       innerHTML is recorded before and after, so undo is the one the text editor has. */
    apply(list, rep, label) {
        if (!list.length) return 0;
        const byOwner = new Map();
        for (const m of list) { if (!byOwner.has(m.owner)) byOwner.set(m.owner, []); byOwner.get(m.owner).push(m); }
        const edits = [];
        for (const [owner, ms] of byOwner) {
            this.history.remember(owner);
            const before = owner.innerHTML;
            for (let i = ms.length - 1; i >= 0; i--) {         // from the end, so the offsets still before it hold
                const m = ms[i], v = m.startNode.nodeValue;
                m.startNode.nodeValue = v.slice(0, m.startOff) + rep + v.slice(m.endOff);
            }
            edits.push({ owner, before, after: owner.innerHTML });
        }
        this.history.begin(label);
        for (const e of edits) this.history.html(e.owner, e.before, e.after, label);
        this.history.end();
        if (list.some(m => m.notes)) window.dispatchEvent(new CustomEvent('editor:notes'));
        return list.length;
    }
}

/* ------------------------------------------------------------
   Text of an element, a block at a time
   ------------------------------------------------------------ */
function cmpKey(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; }

/* The blocks of text inside root: { owner, text, segs: [{ node, len }] }, with a line break
   as its own one-character segment (no node), so a match never spans one. */
function textGroups(doc, root, notes) {
    const groups = [];
    let cur = null;
    const blockOf = (n) => {
        let a = n.parentElement;
        while (a && a !== root && !BLOCK.test(a.localName)) a = a.parentElement;
        return a || root;
    };
    const walker = doc.createTreeWalker(root, 1 | 4, {
        acceptNode(n) {
            if (n.nodeType === 1) {
                if (n === root) return 3;
                if (SKIP_TAGS.test(n.localName)) return 2;
                if (!notes && n.matches(CHROME)) return 2;
                if (n.matches(DRAWN) || n.matches('code[data-code], pre')) return 2;
                // An equation inside text is shown (as a stop, like a <br>), what is inside it never is.
                if (n.parentElement && n.parentElement.matches('span[data-math]')) return 2;
                if (n.matches('span[data-math]')) return 1;
                return n.localName === 'br' ? 1 : 3;                         // only <br> is shown; the others are passed through
            }
            return n.parentElement && n.parentElement.matches('span[data-math]') ? 2 : 1;   // the LaTeX an undrawn equation shows
        },
    });
    // NodeFilter results: ACCEPT 1, REJECT 2 (the subtree too), SKIP 3 (the children still count).
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 1) {                                              // a <br> or an equation (the filter let nothing else through)
            // A stop no match runs across: an equation is not words, and "rate k rises" is not "rate  rises".
            if (cur) { cur.text += n.localName === 'br' ? '\n' : '￼'; cur.segs.push({ node: null, len: 1 }); }
            continue;
        }
        const v = n.nodeValue;
        if (!v || (!v.trim() && /\n/.test(v))) { continue; }                 // indentation between tags
        const block = blockOf(n);
        if (!cur || cur.owner !== block) { cur = { owner: block, text: '', segs: [] }; groups.push(cur); }
        cur.text += v;
        cur.segs.push({ node: n, len: v.length });
    }
    return groups;
}

/* The text node and offset of character i of a group. */
function locate(g, i) {
    let at = 0;
    for (const s of g.segs) {
        if (i < at + s.len) return s.node ? { node: s.node, off: i - at } : null;
        at += s.len;
    }
    return null;
}
