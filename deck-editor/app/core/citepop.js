/* ============================================================
   citepop.js - putting a citation in a text (cite.js has the data).

   Two ways, as for equations in text (inlinemath.js):
   - the popover: Alt+[, the ❝ button of the text bar, Insert >
     Citation, or a press on a citation in the text. Search the
     deck's references, tick one or more, choose the form (in
     brackets, in the sentence, the year only), add a page in the
     citation's text field (Pandoc's syntax, [@key, p. 4]); Enter
     puts it in, Esc leaves the text as it was. A DOI pasted in the
     search adds that reference to the deck first.
   - typing: "[@" or "@" after a space opens a list of the deck's
     references under the caret, narrowed as you type (key, author,
     title words, year); Enter or Tab takes one. A typed citation
     becomes one when its "]" is typed; "@key" taken from the list
     in a sentence becomes one at once. Ctrl+Z gives the typed text
     back.
   Each insert, change and removal is an undo step of its own.
   ============================================================ */
import { CITE, parseCite, formatCite, isKey, authorsShort, yearOf, escapeHtml } from './cite.js';

const KEYCH = String.raw`[\p{L}\p{N}_:.#$%&+?<>~/-]`;
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;

/* The references that match a search: every word in the key, the authors, the title, the journal or the year. */
export function searchRefs(items, query, limit = 50) {
    const words = String(query || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
    const hay = (it) => [it.id, ...(it.author || []).map(a => a.family || a.literal || ''), it.title, it['container-title'], it['container-title-short'], yearOf(it)].join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const scored = [];
    for (const it of items) {
        const h = hay(it);
        if (!words.every(w => h.includes(w))) continue;
        const k = it.id.toLowerCase();
        scored.push({ it, s: words.length && k.startsWith(words[0]) ? 0 : 1 });
    }
    scored.sort((a, b) => a.s - b.s);
    return scored.slice(0, limit).map(x => x.it);
}
const venueOf = (it) => [it['container-title-short'] || it['container-title'] || it.publisher || '', yearOf(it)].filter(Boolean).join(', ');

export class CitePop {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.pop = null;
        this.ac = null;
        this.target = null;
        this.seq = 0;
        this.deck.onNewDocument((doc) => {
            doc.addEventListener('pointerdown', (e) => {
                if (this.pop && !(e.target.closest && e.target.closest(CITE))) this.close({ refocus: false });
                this.closeAc();
            }, true);
        });
    }
    get te() { return this.app.textEdit; }
    get library() { return this.app.sources.library; }
    get isOpen() { return !!this.pop; }

    /* ------------------------------------------------------------
       The popover
       ------------------------------------------------------------ */
    fromCaret() {
        const te = this.te;
        if (!te.el) {
            const el = this.app.selection.single;
            if (!el || !te.start(el)) { this.app.toast('Select a text, or double-click into one, to put a citation in it.'); return false; }
        }
        const doc = this.deck.doc, s = this.deck.win.getSelection();
        let range = null;
        if (s && s.rangeCount && te.el.contains(s.getRangeAt(0).commonAncestorContainer)) range = s.getRangeAt(0).cloneRange();
        else if (te.caret && te.el.contains(te.caret.commonAncestorContainer)) range = te.caret.cloneRange();
        if (!range) { range = doc.createRange(); range.selectNodeContents(te.el); range.collapse(false); }
        // Selected text that is a citation in Pandoc's syntax opens as one.
        const picked = range.collapsed ? '' : range.toString().trim();
        if (picked && parseCite(picked)) return this.open({ range, text: picked });
        if (!range.collapsed) range.collapse(false);
        return this.open({ range });
    }

    open({ span = null, range = null, text = '' } = {}) {
        if (!this.te.el) return false;
        this.close({ refocus: false });
        this.closeAc();
        this.target = span ? { span } : { range };
        const c = parseCite(span ? span.getAttribute('data-cite') : text) || { mode: 'paren', items: [] };
        this.cite = c;
        const pop = document.createElement('div');
        pop.className = 'citepop';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Citation');
        pop.innerHTML = `
            <input type="text" class="citepop-q" spellcheck="false" autocomplete="off" aria-label="Search the references, or paste a DOI" placeholder="Search author, title, year, key, or paste a DOI">
            <div class="citepop-list" role="listbox" aria-label="References in this deck"></div>
            <div class="citepop-form insp-seg" role="group" aria-label="Form">
                <button type="button" data-m="paren" title="(Szostak et al., 2001), [1] or ¹, as the style writes it">In brackets</button>
                <button type="button" data-m="narrative" title="Szostak et al. (2001): the authors are part of the sentence">In the sentence</button>
                <button type="button" data-m="year" title="(2001): the authors are named in the sentence already">Year only</button>
            </div>
            <input type="text" class="citepop-code" spellcheck="false" autocomplete="off" aria-label="The citation in Pandoc's syntax" title="The citation as Pandoc writes it: [@key], @key, [-@key], [@key, p. 4], [see @a; @b]. Edit it to add a page or a prefix.">
            <div class="citepop-preview" aria-live="polite"></div>
            <div class="citepop-hint">Tick several for one citation; add a page here: <code>[@key, p. 4]</code>. <kbd>Enter</kbd> puts it in, <kbd>Esc</kbd> cancels${span ? ', none ticked removes it' : ''}.</div>
            <div class="citepop-acts"><button type="button" class="mini-btn" data-act="library" title="All the references of this deck: import a .bib, add by DOI, choose the style">Library...</button><span class="spacer"></span><button type="button" class="mini-btn" data-act="cancel">Cancel</button><button type="button" class="mini-btn primary" data-act="ok">${span ? 'Change' : 'Put in'}</button></div>`;
        document.body.appendChild(pop);
        this.pop = pop;
        this.q = pop.querySelector('.citepop-q');
        this.list = pop.querySelector('.citepop-list');
        this.code = pop.querySelector('.citepop-code');
        this.preview = pop.querySelector('.citepop-preview');
        this.active = 0;
        this.q.addEventListener('input', () => { this.active = 0; this._list(); });
        this.q.addEventListener('keydown', (e) => this._keys(e));
        this.code.addEventListener('keydown', (e) => this._keys(e));
        this.code.addEventListener('input', () => {
            const p = parseCite(this.code.value);
            this.code.classList.toggle('bad', !p);
            if (p) { this.cite = p; this._list(false); this._form(); this._preview(); }
        });
        pop.querySelector('.citepop-form').addEventListener('click', (e) => {
            const b = e.target.closest('[data-m]'); if (!b || b.disabled) return;
            this._setForm(b.dataset.m);
        });
        pop.addEventListener('click', (e) => {
            const a = e.target.closest('[data-act]'); if (!a) return;
            if (a.dataset.act === 'ok') this.apply();
            else if (a.dataset.act === 'cancel') this.close();
            else if (a.dataset.act === 'library') { this.close({ refocus: false }); this.app.openCiteLibrary(); }
        });
        this._list();
        this._sync();
        this._place();
        this.q.focus();
        return true;
    }

    _keys(e) {
        e.stopPropagation();
        const rows = this.list.querySelectorAll('.citepop-item');
        if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (e.target === this.code) return;
            e.preventDefault();
            this.active = Math.max(0, Math.min(rows.length - 1, this.active + (e.key === 'ArrowDown' ? 1 : -1)));
            rows.forEach((r, i) => r.classList.toggle('active', i === this.active));
            if (rows[this.active]) rows[this.active].scrollIntoView({ block: 'nearest' });
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const doi = DOI_RE.exec(this.q.value);
            if (e.target === this.q && doi && !this.library.items.some(it => (it.DOI || '').toLowerCase() === doi[1].toLowerCase())) { this.addDoi(doi[1]); return; }
            // Enter with nothing ticked takes the highlighted reference.
            if (!this.cite.items.length && rows[this.active] && rows[this.active].dataset.id) this._toggle(rows[this.active].dataset.id);
            this.apply();
        }
    }

    /* The list: the references matching the search, the ticked ones first. */
    _list(refocus = true) {
        const items = this.library.items;
        const ticked = new Set(this.cite.items.map(i => i.id));
        const q = this.q.value.trim();
        const doi = DOI_RE.exec(q);
        let html = '';
        if (doi && !items.some(it => (it.DOI || '').toLowerCase() === doi[1].toLowerCase())) {
            html += `<button type="button" class="citepop-item citepop-doi" data-doi="${escapeHtml(doi[1])}"><b>Add ${escapeHtml(doi[1])}</b><span>Looks the reference up at doi.org and adds it to this deck (Enter)</span></button>`;
        }
        const found = doi ? items.filter(it => (it.DOI || '').toLowerCase() === doi[1].toLowerCase()) : searchRefs(items, q);
        const list = [...found.filter(it => ticked.has(it.id)), ...found.filter(it => !ticked.has(it.id))];
        html += list.map((it, i) => `<label class="citepop-item${i === this.active && !html ? ' active' : ''}" data-id="${escapeHtml(it.id)}" role="option" aria-selected="${ticked.has(it.id)}">
            <input type="checkbox" ${ticked.has(it.id) ? 'checked' : ''} tabindex="-1"><span class="k">${escapeHtml(it.id)}</span><span class="v">${escapeHtml(venueOf(it))}</span>
            <span class="t">${escapeHtml(authorsShort(it))}: ${escapeHtml(it.title || '')}</span></label>`).join('');
        if (!items.length && !doi) html = `<div class="citepop-empty">No references in this deck yet. Paste a DOI above, or open the <b>Library</b> to import a .bib, RIS or CSL-JSON file.</div>`;
        else if (!list.length && !doi) html += `<div class="citepop-empty">Nothing matches. A DOI pasted here adds a reference.</div>`;
        this.list.innerHTML = html;
        this.list.querySelectorAll('.citepop-item[data-id]').forEach(row => {
            row.addEventListener('click', (e) => { e.preventDefault(); this._toggle(row.dataset.id); if (refocus) this.q.focus(); });
        });
        const d = this.list.querySelector('.citepop-doi');
        if (d) d.addEventListener('click', () => this.addDoi(d.dataset.doi));
    }
    _toggle(id) {
        const at = this.cite.items.findIndex(i => i.id === id);
        if (at >= 0) this.cite.items.splice(at, 1);
        else this.cite.items.push({ id, ...(this.cite.items.some(i => i.suppress) ? { suppress: true } : {}) });
        if (this.cite.items.length > 1 && this.cite.mode === 'narrative') this.cite.mode = 'paren';
        this._list(); this._sync();
    }
    _setForm(m) {
        const c = this.cite;
        if (m === 'narrative') { c.mode = 'narrative'; c.items.forEach(i => delete i.suppress); }
        else { c.mode = 'paren'; c.items.forEach(i => { if (m === 'year') i.suppress = true; else delete i.suppress; }); }
        this._sync();
    }
    _form() {
        const c = this.cite;
        const m = c.mode === 'narrative' ? 'narrative' : c.items.length && c.items.every(i => i.suppress) ? 'year' : 'paren';
        this.pop.querySelectorAll('.citepop-form [data-m]').forEach(b => {
            b.classList.toggle('on', b.dataset.m === m);
            b.disabled = b.dataset.m === 'narrative' && c.items.length > 1;
        });
    }
    _sync() {
        this.code.value = formatCite(this.cite);
        this.code.classList.remove('bad');
        this._form();
        this._preview();
        this._place();
    }
    async _preview() {
        const n = ++this.seq, text = formatCite(this.cite);
        if (!text) { this.preview.innerHTML = '<span class="none">Tick a reference.</span>'; return; }
        try {
            const html = await this.app.sources.preview(text, this._index());
            if (n !== this.seq || !this.pop) return;
            this.preview.innerHTML = html || '<span class="none">' + escapeHtml(text) + '</span>';
        } catch (err) { if (n === this.seq && this.pop) this.preview.textContent = 'Not written: ' + err.message; }
    }
    /* Where the citation goes among the deck's citations (numbered styles number in that order). */
    _index() {
        const t = this.target, spans = Array.from(this.deck.stage.querySelectorAll(CITE));
        if (t.span) return spans.indexOf(t.span);
        const node = t.range.startContainer;
        return spans.filter(s => node.compareDocumentPosition ? (s.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) : false).length;
    }
    _place() {
        if (!this.pop) return;
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

    async addDoi(doi) {
        if (!this.pop) return;
        this.preview.textContent = 'Looking up ' + doi + '...';
        try {
            const r = await this.app.api.citeDoi(doi);
            const { ids } = this.library.merge(this.app.history, [r.item], 'Add reference');
            if (!this.pop) return;
            this.q.value = '';
            if (ids[0] && !this.cite.items.some(i => i.id === ids[0])) this.cite.items.push({ id: ids[0] });
            this._list(); this._sync();
            this.app.toast('Added ' + ids[0] + ' to the references of this deck.');
        } catch (err) { if (this.pop) this.preview.textContent = 'Could not add ' + doi + ': ' + err.message; }
    }

    /* Enter: the citation in, or changed, or removed when nothing is ticked. */
    async apply() {
        const te = this.te, t = this.target;
        if (!this.pop || !t || !te.el) return;
        const typed = parseCite(this.code.value);
        const text = typed ? formatCite(typed) === this.code.value.trim() ? this.code.value.trim() : formatCite(typed) : formatCite(this.cite);
        if (t.span && !text) { const span = t.span; this.close({ refocus: true, before: span }); te.removeMath(span); this.app.sources.schedule(0); return; }
        if (!text) { this.close(); return; }
        let html = '';
        try { html = await this.app.sources.preview(text, this._index()); } catch (e) { /* written by the next pass */ }
        if (this.target !== t || !te.el) return;
        let span = t.span;
        if (span) {
            if (!te.el.contains(span)) { this.close(); return; }
            te.checkpoint('Edit text');
            span.setAttribute('data-cite', text);
            span.innerHTML = html || escapeHtml(text);
            te.checkpoint('Edit citation');
        } else {
            const range = t.range;
            if (!te.el.contains(range.commonAncestorContainer)) { this.close(); return; }
            te.checkpoint('Edit text');
            span = this.deck.doc.createElement('span');
            span.setAttribute('data-cite', text);
            span.innerHTML = html || escapeHtml(text);
            range.deleteContents();
            // A citation in brackets follows its word with a space, as one types it.
            const lead = this.deck.doc.createRange();
            lead.setStart(te.el, 0); lead.setEnd(range.startContainer, range.startOffset);
            const before = lead.toString().replace(/​/g, '');
            const sup = /^<sup>/.test(html);
            if (before && !/\s$/.test(before) && !sup && parseCite(text).mode === 'paren') range.insertNode(this.deck.doc.createTextNode(' ')), range.collapse(false);
            range.insertNode(span);
            te.lockMath();
            te.checkpoint('Insert citation');
        }
        this.close({ after: span });
        te._positionBar();
        this.app.sources.schedule(0);
    }

    close({ refocus = true, after = null, before = null } = {}) {
        if (!this.pop) return;
        this.seq++;
        const t = this.target;
        this.pop.remove();
        this.pop = null; this.target = null;
        const te = this.te;
        if (!refocus || !te.el) return;
        const doc = this.deck.doc, sel = this.deck.win.getSelection(), r = doc.createRange();
        te.el.focus({ preventScroll: true });
        const span = after || (t && t.span);
        if (before && te.el.contains(before)) r.setStartBefore(before);
        else if (span && te.el.contains(span)) {
            let next = span.nextSibling;
            if (!next || next.nodeType !== 3) { next = doc.createTextNode('​'); span.after(next); r.setStart(next, 1); }
            else r.setStart(next, 0);
        } else if (t && t.range && te.el.contains(t.range.commonAncestorContainer)) r.setStart(t.range.endContainer, t.range.endOffset);
        else { r.selectNodeContents(te.el); r.collapse(false); }
        r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
    }

    /* ------------------------------------------------------------
       Typing: [@ and @ open the list under the caret
       ------------------------------------------------------------ */
    /* After each input in the edited text. */
    typed() {
        const te = this.te;
        if (!te.el || this.pop) return;
        const s = this.deck.win.getSelection();
        if (!s || !s.rangeCount || !s.isCollapsed) { this.closeAc(); return; }
        const node = s.anchorNode, off = s.anchorOffset;
        if (!node || node.nodeType !== 3 || !te.el.contains(node)) { this.closeAc(); return; }
        const before = node.data.slice(0, off);
        // A citation typed out to its closing bracket becomes one.
        const done = /\[([^[\]]*@[^[\]]*)\]$/.exec(before);
        if (done && parseCite('[' + done[1] + ']') && parseCite('[' + done[1] + ']').items.some(i => this.library.has(i.id))) {
            this.closeAc();
            this._convert(node, off - done[0].length, off, '[' + done[1] + ']');
            return;
        }
        if (!this.library.items.length) { this.closeAc(); return; }
        const inBr = new RegExp('\\[[^[\\]]*?-?@(' + KEYCH + '*)$', 'u').exec(before);
        const bare = !inBr && new RegExp('(?:^|[\\s(])@(' + KEYCH + '*)$', 'u').exec(before);
        const m = inBr || bare;
        if (!m) { this.closeAc(); return; }
        this.acState = { node, end: off, start: off - m[1].length, partial: m[1], narrative: !inBr };
        this._showAc();
    }
    _showAc() {
        const st = this.acState, items = searchRefs(this.library.items, st.partial, 8);
        if (!items.length) { this.closeAc(); return; }
        if (!this.ac) {
            this.ac = document.createElement('div');
            this.ac.className = 'citeac';
            this.ac.setAttribute('role', 'listbox');
            this.ac.setAttribute('aria-label', 'References');
            this.ac.addEventListener('pointerdown', (e) => e.preventDefault());
            this.ac.addEventListener('click', (e) => { const row = e.target.closest('[data-id]'); if (row) { this.acActive = +row.dataset.i; this._acTake(); } });
            document.body.appendChild(this.ac);
        }
        this.acItems = items;
        this.acActive = Math.min(this.acActive || 0, items.length - 1);
        this.ac.innerHTML = items.map((it, i) => `<div class="citeac-item${i === this.acActive ? ' active' : ''}" role="option" data-i="${i}" data-id="${escapeHtml(it.id)}"><span class="k">@${escapeHtml(it.id)}</span><span class="v">${escapeHtml(venueOf(it))}</span><span class="t">${escapeHtml(authorsShort(it))}: ${escapeHtml(it.title || '')}</span></div>`).join('')
            + `<div class="citeac-foot"><kbd>&uarr;&darr;</kbd> choose · <kbd>Enter</kbd> take it · <kbd>;</kbd> another · <kbd>]</kbd> done · <kbd>Esc</kbd> close</div>`;
        const r = this.deck.doc.createRange();
        r.setStart(st.node, st.end); r.collapse(true);
        const rect = r.getBoundingClientRect(), frame = this.deck.iframe.getBoundingClientRect();
        const w = this.ac.offsetWidth, h = this.ac.offsetHeight;
        let left = frame.left + rect.left - 20, top = frame.top + rect.bottom + 6;
        if (top + h > innerHeight - 8) top = Math.max(8, frame.top + rect.top - h - 6);
        this.ac.style.left = Math.max(8, Math.min(innerWidth - w - 8, left)) + 'px';
        this.ac.style.top = top + 'px';
    }
    closeAc() { if (this.ac) { this.ac.remove(); this.ac = null; } this.acState = null; this.acActive = 0; }
    /* Keys while the list is open: returns true when the key was the list's. */
    acKey(e) {
        if (!this.ac || !this.acState) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            this.acActive = Math.max(0, Math.min(this.acItems.length - 1, this.acActive + (e.key === 'ArrowDown' ? 1 : -1)));
            this._showAc();
            return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') { this._acTake(); return true; }
        if (e.key === 'Escape') { this.closeAc(); return true; }
        return false;
    }
    _acTake() {
        const st = this.acState, it = this.acItems && this.acItems[this.acActive];
        if (!st || !it || !st.node.isConnected) { this.closeAc(); return; }
        const node = st.node;
        node.data = node.data.slice(0, st.start) + it.id + node.data.slice(st.end);
        const end = st.start + it.id.length;
        this.closeAc();
        if (st.narrative) { this._convert(node, st.start - 1, end, '@' + it.id); return; }
        const s = this.deck.win.getSelection(), r = this.deck.doc.createRange();
        r.setStart(node, end); r.collapse(true);
        s.removeAllRanges(); s.addRange(r);
    }
    /* Typed text from `a` to `b` in a text node becomes the citation `text`: the typing one undo step, the citation the next. */
    _convert(node, a, b, text) {
        const te = this.te;
        if (!isKey(parseCite(text).items[0].id)) return;
        te.checkpoint('Edit text');
        const doc = this.deck.doc, r = doc.createRange();
        r.setStart(node, a); r.setEnd(node, b);
        const span = doc.createElement('span');
        span.setAttribute('data-cite', text);
        span.textContent = text;
        r.deleteContents();
        r.insertNode(span);
        te.lockMath();
        let next = span.nextSibling;
        if (!next || next.nodeType !== 3) { next = doc.createTextNode('​'); span.after(next); }
        const s = this.deck.win.getSelection(), c = doc.createRange();
        c.setStart(next, next.data.startsWith('​') ? 1 : 0); c.collapse(true);
        s.removeAllRanges(); s.addRange(c);
        te.checkpoint('Insert citation');
        this.app.sources.run();
    }
}
