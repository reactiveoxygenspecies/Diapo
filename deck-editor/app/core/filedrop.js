/* ============================================================
   filedrop.js - files dragged in from the computer.

   - Pictures, video and sound dropped on the canvas are uploaded
     into the deck's assets/ (Inserter.upload, the server's upload
     rules) and put where they were dropped: the point is turned
     from screen pixels into stage pixels through the canvas zoom,
     the first file is centred on it and the next ones step down
     and right from it. One undo step.
   - A PowerPoint (.pptx) or Markdown (.md) file dropped anywhere in
     the window is offered as a new deck (the host does the asking
     and the import, as the Decks drawer's Import does).
   - Anything else gets a toast saying what can be dropped; with no
     deck open, pictures only get a hint to open one.
   The canvas is an iframe, so the editor's document and the deck's
   both listen. While files are dragged over, an overlay says what a
   drop will do. A file dropped where nothing takes it is never left
   to the browser, which would open it in place of the editor.
   Nothing is sent anywhere but to Diapo's own server, on the drop.
   ============================================================ */

/* What the server's /api/upload takes (UPLOAD_EXT in serve.py; tests/test_upload_ext.py keeps the
   two in step), and what /api/import turns into a deck. */
export const MEDIA_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'mp4', 'webm', 'mov', 'mp3', 'm4a', 'wav', 'ogg'];
export const DECK_EXT = ['pptx', 'md', 'markdown'];
const DECK_TYPES = /presentationml|markdown/i;

const extOf = (name) => { const m = /\.([^.\\/]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; };

/* Dropped files sorted by what can be done with them. */
export function sortFiles(files) {
    const out = { media: [], decks: [], refused: [] };
    for (const f of files) {
        const ext = extOf(f.name);
        if (MEDIA_EXT.includes(ext)) out.media.push(f);
        else if (DECK_EXT.includes(ext)) out.decks.push(f);
        else out.refused.push(f);
    }
    return out;
}

const hasFiles = (e) => !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));

export class FileDrop {
    /* host: { canvas (the canvas element), importDecks(files) (asks, then imports), toast(msg, opts) } */
    constructor(app, host) {
        this.app = app;
        this.deck = app.deck;
        this.host = host;
        this.overlay = document.createElement('div');
        this.overlay.className = 'drop-overlay';
        this.overlay.hidden = true;
        this.overlay.setAttribute('aria-hidden', 'true');
        this.label = document.createElement('span');
        this.overlay.appendChild(this.label);
        document.body.appendChild(this.overlay);
        this._hideTimer = null;
        this._listen(document, false);
        // The deck's document is a new one with every deck opened.
        this.deck.onNewDocument((doc) => this._listen(doc, true));
    }

    _listen(doc, inDeck) {
        doc.addEventListener('dragover', (e) => this._over(e, inDeck));
        doc.addEventListener('drop', (e) => this._drop(e, inDeck));
        doc.addEventListener('dragleave', (e) => {
            // Leaving the window (not just one element for another): the overlay goes at once.
            if (!inDeck && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight)) this._show(null);
        });
    }

    /* Where an event is: on the canvas or not, and the point in stage pixels. */
    _where(e, inDeck) {
        if (!this.deck.isOpen) {
            const c = this.host.canvas.getBoundingClientRect();
            return { onCanvas: !inDeck && e.clientX >= c.left && e.clientX <= c.right && e.clientY >= c.top && e.clientY <= c.bottom, point: null };
        }
        if (inDeck) {
            // Client pixels of the deck's own window: the stage's box there, divided by its scale (the zoom).
            const s = this.deck.stage.getBoundingClientRect(), k = this.deck.scale;
            return { onCanvas: true, point: { x: (e.clientX - s.left) / k, y: (e.clientY - s.top) / k } };
        }
        const c = this.host.canvas.getBoundingClientRect();
        const onCanvas = e.clientX >= c.left && e.clientX <= c.right && e.clientY >= c.top && e.clientY <= c.bottom;
        return { onCanvas, point: onCanvas ? this.app.selection.toStage(e.clientX, e.clientY) : null };
    }

    /* What is being dragged, as far as the browser tells before the drop (types, not names). */
    _kinds(dt) {
        const items = Array.from((dt && dt.items) || []).filter(i => i.kind === 'file');
        const deck = items.some(i => DECK_TYPES.test(i.type));
        const media = items.length > 0 && items.every(i => /^(image|video|audio)\//.test(i.type));
        return { deck, media };
    }

    _over(e, inDeck) {
        if (!hasFiles(e)) return;
        e.preventDefault();                  // the browser must never open the file in place of the editor
        const { onCanvas } = this._where(e, inDeck);
        const kinds = this._kinds(e.dataTransfer);
        let msg = null;
        if (kinds.deck) msg = 'Drop to import as a new deck';
        else if (onCanvas) {
            if (!this.deck.isOpen) msg = 'Open a deck first to add pictures, video or sound';
            else if (!this.app.preview) msg = 'Drop to add to this slide';
        }
        e.dataTransfer.dropEffect = msg ? 'copy' : 'none';
        this._show(msg, kinds.deck);
        // dragover repeats while the files are held over the window; when it stops, the drag has left or ended.
        clearTimeout(this._hideTimer);
        this._hideTimer = setTimeout(() => this._show(null), 600);
    }

    _show(msg, whole = false) {
        if (!msg) { this.overlay.hidden = true; clearTimeout(this._hideTimer); return; }
        // Over the canvas, or the whole window for an import (the drawer's job, not the slide's).
        const r = whole ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : this.host.canvas.getBoundingClientRect();
        Object.assign(this.overlay.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        if (this.label.textContent !== msg) this.label.textContent = msg;
        this.overlay.hidden = false;
    }

    async _drop(e, inDeck) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        this._show(null);
        const { media, decks, refused } = sortFiles(Array.from(e.dataTransfer.files || []));
        const where = this._where(e, inDeck);
        const toast = this.host.toast;
        const refusedNote = refused.length ? `Not added: ${refused.map(f => f.name).join(', ')} (a slide takes pictures, video and sound; a PowerPoint or Markdown file becomes a new deck)` : '';
        if (media.length) {
            if (!this.deck.isOpen) toast('Open a deck first, then drop pictures, video or sound on a slide.', { ms: 4000 });
            else if (this.app.preview) toast('Leave the preview (Esc) to add files to a slide.', { ms: 4000 });
            else if (!where.onCanvas) toast('Drop pictures, video and sound on the slide to add them.', { ms: 4000 });
            else await this.addToSlide(media, where.point, refusedNote);
        } else if (refusedNote) toast(refusedNote, { error: true, ms: 6000 });
        if (decks.length) await this.host.importDecks(decks);
    }

    /* Upload and place: one undo step, the new elements selected. */
    async addToSlide(files, point, note = '') {
        const toast = this.host.toast;
        if (this.app.textEdit && this.app.textEdit.active) this.app.textEdit.commit();
        try {
            const r = await this.app.insert.upload(files, { at: point });
            const n = r.files.length;
            const refused = (r.refused || []).length ? ` | not added: ${r.refused.join(', ')}` : '';
            toast((n === 1 ? '1 file added' : `${n} files added`) + ' to the slide (copied into assets/)' + refused + (note ? ' | ' + note : ''), { ms: refused || note ? 6000 : 2600 });
        } catch (err) {
            toast('Could not add the files: ' + err.message + (note ? ' | ' + note : ''), { error: true, ms: 6000 });
        }
    }
}
