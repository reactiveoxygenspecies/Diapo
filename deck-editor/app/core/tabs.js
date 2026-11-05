/* ============================================================
   tabs.js - several decks open at once, one tab each.

   Only the active tab's deck is live in the editor's single iframe; the others are
   remembered as a record (file, workspace, slide, zoom, whether they have unsaved
   edits). Leaving a dirty tab writes its draft (the same file the autosave keeps) and
   returning to it opens that draft again, with the disk version it was first opened at,
   so a tab switch never makes a false "changed on disk" conflict and never hides a real
   one. The undo history belongs to the live document and does not survive a switch.

   The editor (editor.js) owns loading, saving and the draft; it hands this class the few
   things it needs as `host` functions.
   ============================================================ */

const KEY = 'diapo-tabs';
const TOUR = '@diapo/';

export class DeckTabs {
    constructor({ app, api, el, host }) {
        this.app = app; this.api = api; this.el = el; this.host = host;
        this.tabs = [];
        this.busy = false;
        this._sig = '';
        el.addEventListener('click', (e) => this._click(e));
        el.addEventListener('auxclick', (e) => {
            const t = e.target.closest('.deck-tab');
            if (t && e.button === 1) { e.preventDefault(); this.close(this.find(t.dataset.file, t.dataset.ws)); }
        });
        el.addEventListener('mousedown', (e) => { if (e.button === 1 && e.target.closest('.deck-tab')) e.preventDefault(); });   // no autoscroll
        this._dragging();
        const key = (e) => this._key(e);
        window.addEventListener('keydown', key, true);
        app.deck.addEventListener('ready', () => { if (app.deck.doc) app.deck.doc.addEventListener('keydown', key, true); });
    }

    get active() { return this.tabs.find(t => t.active) || null; }
    find(file, ws) { return this.tabs.find(t => t.file === file && (ws === undefined || t.ws === ws)) || null; }
    _wsOf(file) { return file.startsWith(TOUR) ? '' : (this.app.workspace || ''); }

    /* ------------------------------------------------------------
       Opening
       ------------------------------------------------------------ */
    /* The editor's openDeck: a deck that has a tab is brought to the front, any other gets a new
       tab. Reloading the live deck itself (restoring its draft, trusting its scripts, opening the
       file on disk) is not a new tab: the host loads it in place. */
    async open(file, opts = {}) {
        if (opts.draft || opts.discard || opts.sameSession || opts.viaTab) return this.host.load(file, opts);
        const ws = this._wsOf(file);
        let tab = this.find(file, ws);
        // Opening the deck that is already in front reads it again, as before tabs (a file
        // changed on disk, its scripts trusted or not); a confirm guards unsaved edits.
        if (tab && tab.active && this.app.deck.isOpen && this.app.file === file) return this.host.load(file, opts);
        if (!tab) { tab = this._record(file, ws); this.tabs.push(tab); tab.fresh = true; }
        const ok = await this.activate(tab);
        if (!ok && tab.fresh && !tab.loaded) this._drop(tab);
        return ok;
    }

    _record(file, ws) {
        return { file, ws, dirty: false, slide: 0, zoomMode: null, scroll: null, version: '', name: this.host.nameOf(file, ''), loaded: false, active: false, snap: null };
    }

    /* The host calls this after every successful load, whoever asked for it. */
    loaded(file) {
        const ws = this._wsOf(file);
        let tab = this.find(file, ws);
        if (!tab) { tab = this._record(file, ws); this.tabs.push(tab); }
        for (const t of this.tabs) t.active = t === tab;
        tab.loaded = true; tab.fresh = false; tab.snap = null;
        this.refresh(true);
    }

    async activate(tab) {
        if (this.busy) return false;
        this.busy = true;
        try {
            const cur = this.active, app = this.app;
            if (cur === tab && app.deck.isOpen && app.file === tab.file) return true;
            if (cur && cur !== tab && app.deck.isOpen && !(await this._leave(cur))) return false;
            return await this._enter(tab, cur);
        } finally { this.busy = false; }
    }

    /* Remember where the live deck was, and keep its unsaved edits in its draft. */
    async _leave(cur) {
        const app = this.app;
        if (cur.snap) return true;              // taken before the workspace changed (see beforeWorkspaceChange)
        const snap = this._snapshot(cur);
        if (app.dirty) {
            try { await this.host.flush(); } catch (err) { this.host.toast('Could not keep your unsaved edits, so the tab stays: ' + err.message, { error: true, ms: 5000 }); return false; }
        }
        Object.assign(cur, snap);
        return true;
    }
    _snapshot(cur) {
        const app = this.app;
        window.dispatchEvent(new CustomEvent('editor:before-save'));      // a text edit in progress is committed
        return {
            slide: app.deck.current, name: app.deckName || cur.name, dirty: !!app.dirty,
            version: app.dirty ? app.deck.diskVersion : '', ...this.host.getView(),
        };
    }
    /* The workspace is about to change under the live deck: its draft can only be written now. */
    async beforeWorkspaceChange() {
        const cur = this.active;
        if (!cur || !this.app.deck.isOpen || cur.ws !== this.app.workspace && cur.ws) return;
        if (!(await this._leave(cur))) return;
        cur.snap = true;
    }

    async _enter(tab, cur) {
        const app = this.app;
        let draft = false;
        if (tab.dirty) { try { draft = (await this.api.draftStatus(tab.file)).exists; } catch (e) { /* open it clean */ } }
        if (tab.ws && tab.ws !== app.workspace) {
            if (!(await this.host.setWorkspace(tab.ws))) { if (cur) cur.snap = null; return false; }
        }
        const ok = await this.host.load(tab.file, { draft, sameSession: true, viaTab: true, version: draft ? tab.version : '', noOffer: tab.loaded });
        if (!ok) {
            // The file is gone or cannot be opened: its tab goes, and the neighbour opens in its place.
            const i = this.tabs.indexOf(tab);
            this._drop(tab);
            if (cur) cur.snap = null;
            const next = this.tabs[i] || this.tabs[i - 1] || null;
            if (next) { await this._enter(next, null); return false; }
            this.host.unload();
            return false;
        }
        // loaded() has made the tab the active one
        if (tab.zoomMode) this.host.setView(tab);
        if (tab.slide) app.deck.goTo(tab.slide);
        return true;
    }

    /* ------------------------------------------------------------
       Closing
       ------------------------------------------------------------ */
    async close(tab) {
        if (!tab || this.busy) return false;
        const app = this.app, isActive = tab.active && app.deck.isOpen;
        const dirty = isActive ? app.dirty : tab.dirty;
        let discarded = false;
        if (dirty) {
            const choice = await this._ask(tab);
            if (choice === 'cancel') return false;
            if (choice === 'save') {
                if (!isActive && !(await this.activate(tab))) return false;
                await this.host.save();
                if (app.dirty) return false;                 // a conflict or an error: the tab stays, its edits intact
            } else {
                await this.host.discardDraft(tab.file);
                discarded = true;
            }
        }
        const i = this.tabs.indexOf(tab);
        const wasActive = tab.active;
        this.tabs.splice(i, 1);
        if (!wasActive) { this.refresh(true); return true; }
        const next = this.tabs[i] || this.tabs[i - 1] || null;
        if (!next) { this.host.unload(); this.refresh(true); return true; }
        this.busy = true;
        try { await this._enter(next, null); } finally { this.busy = false; }
        void discarded;
        return true;
    }

    _drop(tab) {
        const i = this.tabs.indexOf(tab);
        if (i >= 0) this.tabs.splice(i, 1);
        this.refresh(true);
    }

    /* Save / Discard / Cancel for a tab with unsaved edits. */
    _ask(tab) {
        return new Promise((resolve) => {
            const name = tab.active ? (this.app.deckName || tab.name) : tab.name;
            const h = document.createElement('div');
            h.className = 'help tab-close-dialog';
            h.setAttribute('role', 'alertdialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', 'Unsaved changes');
            h.innerHTML = `<div class="help-card" style="width:440px"><h2>Close this deck?</h2>
                <p></p>
                <div class="row"><span class="spacer"></span>
                    <button class="tb-btn" data-c="cancel">Cancel</button>
                    <button class="tb-btn" data-c="discard">Discard changes</button>
                    <button class="tb-btn primary" data-c="save">Save</button></div></div>`;
            h.querySelector('p').textContent = `"${name}" has unsaved changes.`;
            const done = (c) => { h.remove(); document.removeEventListener('keydown', onKey, true); resolve(c); };
            const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); } };
            h.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) done(b.dataset.c); else if (e.target === h) done('cancel'); });
            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(h);
            h.querySelector('[data-c="save"]').focus();
        });
    }

    /* A deck was renamed or moved: its tab follows (and the live deck, if it is that one). */
    renamed(from, to) {
        for (const t of this.tabs) if (t.file === from && (t.ws === this._wsOf(from) || t.ws === this.app.workspace)) { t.file = to; t.name = this.host.nameOf(to, ''); }
        this.refresh(true);
    }

    /* ------------------------------------------------------------
       Switching by keyboard
       ------------------------------------------------------------ */
    cycle(dir) {
        if (this.tabs.length < 2) return;
        const i = this.tabs.findIndex(t => t.active);
        this.activate(this.tabs[(i + dir + this.tabs.length) % this.tabs.length]);
    }
    _key(e) {
        if (!e.ctrlKey || e.altKey || e.metaKey) return;
        let dir = 0;
        if (e.key === 'PageDown' || (e.key === 'Tab' && !e.shiftKey)) dir = 1;
        else if (e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey)) dir = -1;
        if (!dir || this.tabs.length < 2) return;
        e.preventDefault(); e.stopPropagation();
        this.cycle(dir);
    }

    /* ------------------------------------------------------------
       The strip
       ------------------------------------------------------------ */
    /* Redraw when something it shows changed: the live deck's name and dirty state are read from the editor. */
    refresh(force = false) {
        const app = this.app, cur = this.active;
        if (cur && app.deck.isOpen && app.file === cur.file) {
            cur.dirty = !!app.dirty;
            if (app.deckName) cur.name = app.deckName;
        }
        document.body.classList.toggle('has-tabs', this.tabs.length > 0);
        this.el.hidden = this.tabs.length === 0;
        const sig = this.tabs.map(t => [t.file, t.ws, t.name, t.dirty ? 1 : 0, t.active ? 1 : 0].join('\u0001')).join('\u0002');
        if (sig === this._sig && !force) return;
        this._sig = sig;
        const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        // Two decks of the same title (a copy of a deck, say) are told apart by their folder.
        const count = new Map();
        for (const t of this.tabs) count.set(t.name, (count.get(t.name) || 0) + 1);
        const folder = (t) => { const p = t.file.split('/'); p.pop(); return p.pop() || ''; };
        const label = (t) => count.get(t.name) > 1 && folder(t) ? `${t.name} · ${folder(t)}` : t.name;
        this.el.innerHTML = this.tabs.map(t => `<div class="deck-tab${t.active ? ' active' : ''}${t.dirty ? ' dirty' : ''}" role="tab" tabindex="${t.active ? 0 : -1}" aria-selected="${t.active}" draggable="true" data-file="${esc(t.file)}" data-ws="${esc(t.ws)}" title="${esc(this.host.pathOf(t))}${t.dirty ? ' (unsaved changes)' : ''}">`
            + (t.dirty ? '<span class="tab-dot" title="Unsaved changes"></span>' : '')
            + `<span class="tab-name">${esc(label(t))}</span><button type="button" class="tab-close" tabindex="-1" aria-label="Close ${esc(t.name)}" title="Close (middle-click)">&times;</button></div>`).join('')
            + '<button type="button" class="tab-new" title="Open another deck in a new tab" aria-label="Open another deck in a new tab">+</button>';
        const a = this.el.querySelector('.deck-tab.active');
        if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        this.persist();
    }

    _click(e) {
        if (e.target.closest('.tab-new')) { this.host.showDrawer(); return; }
        const t = e.target.closest('.deck-tab'); if (!t) return;
        const tab = this.find(t.dataset.file, t.dataset.ws);
        if (e.target.closest('.tab-close')) this.close(tab); else if (tab) this.activate(tab);
    }

    /* Drag a tab to a new place in the row. */
    _dragging() {
        let from = null;
        const clear = () => this.el.querySelectorAll('.drop-before, .drop-after, .dragging').forEach(n => n.classList.remove('drop-before', 'drop-after', 'dragging'));
        this.el.addEventListener('dragstart', (e) => {
            const t = e.target.closest && e.target.closest('.deck-tab'); if (!t) return;
            from = this.find(t.dataset.file, t.dataset.ws);
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', t.dataset.file); } catch (err) { /* ignore */ }
            t.classList.add('dragging');
        });
        this.el.addEventListener('dragover', (e) => {
            if (!from) return;
            const t = e.target.closest('.deck-tab'); if (!t) return;
            e.preventDefault();
            const r = t.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
            this.el.querySelectorAll('.drop-before, .drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
            t.classList.add(before ? 'drop-before' : 'drop-after');
        });
        this.el.addEventListener('drop', (e) => {
            const t = e.target.closest('.deck-tab');
            if (!from || !t) return;
            e.preventDefault();
            const to = this.find(t.dataset.file, t.dataset.ws);
            if (to && to !== from) {
                const r = t.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
                this.tabs.splice(this.tabs.indexOf(from), 1);
                this.tabs.splice(this.tabs.indexOf(to) + (before ? 0 : 1), 0, from);
            }
            from = null; clear(); this.refresh(true);
        });
        this.el.addEventListener('dragend', () => { from = null; clear(); });
    }

    /* ------------------------------------------------------------
       Remembered across a reload (this browser)
       ------------------------------------------------------------ */
    persist() {
        try {
            if (!this.tabs.length) { localStorage.removeItem(KEY); return; }
            localStorage.setItem(KEY, JSON.stringify({
                tabs: this.tabs.map(t => ({ file: t.file, ws: t.ws, dirty: t.dirty, slide: t.slide, name: t.name })),
                active: (this.active || {}).file || '',
            }));
        } catch (e) { /* storage may be blocked */ }
    }

    /* The tabs of the last session come back (the ones whose files still exist, in this
       workspace) before the deck of the address opens. */
    async restore(openFile = '') {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
        if (!saved || !Array.isArray(saved.tabs)) return;
        const out = [];
        for (const s of saved.tabs) {
            if (!s || typeof s.file !== 'string' || out.some(t => t.file === s.file && t.ws === (s.ws || ''))) continue;
            const ws = s.ws || '';
            if (ws === this.app.workspace) {
                try { await this.api.versions(s.file); } catch (err) { if (err.status === 404) continue; }
            }
            const t = this._record(s.file, ws);
            // The deck of the address opens as it always did: its draft is offered, not applied unasked.
            Object.assign(t, { dirty: !!s.dirty && s.file !== openFile, slide: +s.slide || 0, name: s.name || t.name });
            out.push(t);
        }
        this.tabs = out;
    }
}
