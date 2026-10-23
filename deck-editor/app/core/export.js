/* ============================================================
   export.js - getting a deck out of the editor.

   Two exports, both made from the live deck (unsaved edits
   included), never from the file on disk:

   - Single HTML file: the deck as it would be saved, sent to
     serve.py, which inlines every file the deck loads from its own
     folder (scripts, stylesheets, images, fonts, data-svg sources)
     and the Google Fonts it links, so the copy opens anywhere from
     one file.

   - PDF: a printable copy of the deck (every slide shown, fragments
     and reveal animations in their final state, one page per slide
     at the stage's size, skipped slides left out) printed by the Chrome or
     Edge on this machine through serve.py. Without one, the same
     copy is loaded off screen and the browser's own print dialog
     opens (choose "Save as PDF" there).
   ============================================================ */
import { deckRevealClasses } from './animate.js';
import { Inspector } from './inspector.js';
import { PptxCollector } from './pptx.js';

const PRINT_ID = 'deck-editor-print';

export class Exporter {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.busy = false;
        // The two scripts of the printable copy live in app/print/, where serve.py hashes them
        // as Diapo's own, so they run in a copy whose policy pauses the deck's other scripts.
        this.helpers = { prep: '', keeper: '' };
        this.helpersReady = Promise.all(['prep', 'keeper'].map(n => fetch(`print/${n}.js`, { cache: 'no-store' })
            .then(r => r.text()).then(t => { this.helpers[n] = t.replace(/\r\n?/g, '\n').trim(); })));
    }

    /* A deck whose own scripts are paused in the editor keeps them paused in the printable
       copy too: a policy in its head that lets only Diapo's scripts run (the PDF is printed
       from a file on disk, where a deck script could otherwise read other files). */
    policyMeta(doc) {
        const t = this.deck.trust;
        if (!t || t.trusted) return null;
        const meta = doc.createElement('meta');
        meta.setAttribute('http-equiv', 'Content-Security-Policy');
        meta.setAttribute('content', `script-src ${(t.known || []).map(h => `'sha256-${h}'`).join(' ')}; form-action 'none'`);
        return meta;
    }

    /* ------------------------------------------------------------
       The printable copy
       ------------------------------------------------------------ */
    /* CSS that shows every slide as a page, whatever the deck's own CSS does. Only
       print media: on screen the copy still lays out like the deck. Reveal elements
       are only made opaque; their final transform comes from the deck's own
       .slide.visible rules (the keeper below makes every slide visible), because a
       deck may centre such an element with an authored transform. Stage-level
       chrome (the master layer: a footer, a page counter) is copied into each page
       by the keeper below, as it looks on that slide, so the originals are hidden. */
    /* The handout: every page the slide at 60%, centred at the top, with its speaker notes in
       the band under it (the slide's number and the deck's own type). The page keeps the slide's
       size, so the PDF is the same shape as the plain one. */
    handoutCss() {
        const W = this.deck.stageW, H = this.deck.stageH, z = 0.6, top = Math.round(H * 0.04), notesTop = Math.round(H * z + H * 0.08);
        return `@media print {
.deck-stage > .slide { zoom: ${z}; margin: ${Math.round(top / z)}px auto 0 !important; break-after: auto !important; page-break-after: auto !important; box-shadow: 0 0 0 ${Math.round(2 / z)}px rgba(0,0,0,0.12); }
.deck-stage > .print-notes { display: block !important; box-sizing: border-box; width: ${W}px; height: ${H - notesTop - 12}px; padding: 0 ${Math.round(W * 0.06)}px; margin: ${notesTop - Math.round(H * z + top)}px 0 0; overflow: hidden; break-after: page; page-break-after: always; font: ${Math.round(H * 0.026)}px/1.45 var(--font, system-ui, sans-serif); color: #222; }
.deck-stage > .print-notes[data-print-last] { break-after: auto; page-break-after: auto; }
.deck-stage > .print-notes .print-notes-h { font-size: ${Math.round(H * 0.02)}px; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin: 0 0 ${Math.round(H * 0.012)}px; }
.deck-stage > .print-notes p { margin: 0 0 0.6em; white-space: pre-wrap; }
.deck-stage > .print-notes .print-notes-none { color: #aaa; font-style: italic; }
}`;
    }

    printCss() {
        const reveal = ['reveal', 'reveal-img', 'reveal-right', ...deckRevealClasses(this.deck.doc)];
        const revealSel = Array.from(new Set(reveal)).map(c => `.deck-stage .slide .${c}`).join(', ');
        const W = this.deck.stageW, H = this.deck.stageH;
        return `@media print {
@page { size: ${W}px ${H}px; margin: 0; }
html, body { width: ${W}px !important; height: auto !important; min-height: 0 !important; margin: 0 !important; overflow: visible !important; background: #fff !important; }
.deck-viewport { position: static !important; inset: auto !important; width: ${W}px !important; height: auto !important; overflow: visible !important; }
.deck-stage { position: relative !important; transform: none !important; width: ${W}px !important; height: auto !important; overflow: visible !important; }
.deck-stage > :not(.slide) { display: none !important; }
.deck-stage > .slide { position: relative !important; inset: auto !important; left: auto !important; top: auto !important; display: block !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; width: ${W}px !important; height: ${H}px !important; overflow: hidden !important; margin: 0 !important; break-after: page; page-break-after: always; break-inside: avoid; page-break-inside: avoid; }
.deck-stage > .slide[data-print-last] { break-after: auto; page-break-after: auto; }
.deck-stage .slide, .deck-stage .slide * { transition: none !important; animation: none !important; }
.deck-stage [data-fragment] { opacity: 1 !important; visibility: visible !important; }
${revealSel} { opacity: 1 !important; visibility: visible !important; filter: none !important; }
.deck-controls, .deck-overview, .deck-laser, .deck-draw, .deck-stage [data-hidden] { display: none !important; }
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}`;
    }

    /* Runs first in the printable copy: work a deck defers to idle time (charts on
       other slides, typically) must happen now, and headless printing does not run
       idle callbacks, so they become short timers. The text is app/print/prep.js. */
    prepJs() {
        return this.helpers.prep;
    }

    /* Runs last in the printable copy. Keeps every slide .active.visible so the deck's
       own final-state rules apply (its navigation script shows one slide at load; this
       puts the others back, and keeps them back), and first walks through the slides
       by hash so that whatever the deck renders when a slide is shown (charts in
       [data-fig] hosts) is rendered for every slide, as it would be when presenting.
       The text is app/print/keeper.js. */
    keeperJs() {
        return this.helpers.keeper;
    }

    /* The deck as saved, turned into pages: skipped slides removed, the deck runtime
       (presenter, fragments, auto-animate) left out, print CSS and the keeper added.
       `base` (an absolute URL of the deck folder) is added for a copy loaded from
       srcdoc; a copy written next to the deck needs none. */
    printableHtml({ base = null, handout = false } = {}) {
        const html = this.app.serialize();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('.deck-stage > .slide[data-skip]').forEach(s => s.remove());
        doc.querySelectorAll('#deck-runtime, #deck-presenter').forEach(s => s.remove());
        const slides = doc.querySelectorAll('.deck-stage > .slide');
        slides.forEach(s => s.classList.add('active', 'visible'));
        if (handout) {
            // The notes under each slide, on the same page (the print CSS scales the slide down).
            slides.forEach((s, i) => {
                const notes = Inspector.notesOf(s);
                const box = doc.createElement('div'); box.className = 'print-notes';
                box.innerHTML = `<div class="print-notes-h">Slide ${i + 1} of ${slides.length}</div>` + (notes ? notes.split(/\n{2,}/).map(p => `<p>${escapeHtml(p)}</p>`).join('') : '<p class="print-notes-none">No notes.</p>');
                s.after(box);
            });
            const last = doc.querySelector('.deck-stage > .print-notes:last-of-type');
            if (last) last.setAttribute('data-print-last', '');
        }
        // Links on elements become real anchors, so the PDF carries them (display: contents keeps the layout).
        doc.querySelectorAll('.deck-stage [data-href]').forEach(el => {
            const a = doc.createElement('a'); a.href = el.getAttribute('data-href'); a.target = '_blank'; a.style.display = 'contents';
            el.replaceWith(a); a.appendChild(el);
        });
        if (slides.length) slides[slides.length - 1].setAttribute('data-print-last', '');   // no page break after it (stage chrome may follow)
        const prep = doc.createElement('script'); prep.id = PRINT_ID + '-prep'; prep.textContent = '\n' + this.prepJs() + '\n';
        doc.head.insertBefore(prep, doc.head.firstChild);
        if (base) {
            const b = doc.createElement('base'); b.href = base;
            doc.head.insertBefore(b, doc.head.firstChild);
        }
        const policy = this.policyMeta(doc);
        if (policy) doc.head.insertBefore(policy, doc.head.firstChild);     // first, so it covers every script
        const style = doc.createElement('style'); style.id = PRINT_ID; style.textContent = '\n' + this.printCss() + (handout ? '\n' + this.handoutCss() : '') + '\n';
        doc.head.appendChild(style);
        const script = doc.createElement('script'); script.id = PRINT_ID + '-keeper'; script.textContent = '\n' + this.keeperJs() + '\n';
        doc.body.appendChild(script);
        return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML + '\n';
    }

    pageCount() {
        return this.deck.slides.filter(s => !s.hasAttribute('data-skip')).length;
    }

    /* ------------------------------------------------------------
       PDF
       ------------------------------------------------------------ */
    /* { to } names the file (tests); without it the server asks with a save dialog.
       Returns the server's reply, or { printed: true } after the browser fallback. */
    async pdf({ to = null, dialog = true, handout = false } = {}) {
        if (!this.deck.isOpen || this.busy) return null;
        this.busy = true;
        window.dispatchEvent(new CustomEvent('editor:before-save'));      // commit an open text edit
        const n = this.pageCount();
        this.app.status(`Printing ${n} slide${n === 1 ? '' : 's'} to PDF...`, { busy: true });
        try {
            await this.helpersReady;
            const html = this.printableHtml({ handout });
            let r;
            try {
                r = await this.app.api.pdf(this.deck.file, html, { to, dialog, w: this.deck.stageW, h: this.deck.stageH });
            } catch (err) {
                if (!(err.data && err.data.reason === 'no-chrome')) throw err;
                this.app.status('');
                this.app.toast('No Chrome or Edge found: the print dialog opens instead. Choose "Save as PDF" there.', { ms: 6000 });
                await this.printDialog();
                return { printed: true };
            }
            this.app.status('');
            if (r.cancelled) return r;
            this.app.toast(`PDF written: ${r.path} (${n} page${n === 1 ? '' : 's'}, ${sizeLabel(r.bytes)}, printed with ${r.browser})`, { ms: 6000 });
            return r;
        } catch (err) {
            this.app.status('');
            this.app.toast('Could not make the PDF: ' + err.message, { error: true, ms: 7000 });
            return null;
        } finally { this.busy = false; }
    }

    /* Fallback without Chrome on the server: the printable copy in an off-screen
       iframe (full size, so scripts that measure their host lay out correctly),
       then the browser's print dialog for it. */
    printDialog() {
        return new Promise((resolve) => {
            const dir = this.deck.file.includes('/') ? this.deck.file.slice(0, this.deck.file.lastIndexOf('/') + 1) : '';
            const base = location.origin + '/deck/' + dir.split('/').map(encodeURIComponent).join('/');
            const frame = document.createElement('iframe');
            frame.className = 'print-frame';
            frame.setAttribute('aria-hidden', 'true');
            frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${this.deck.stageW}px;height:${this.deck.stageH}px;border:0;`;
            document.body.appendChild(frame);
            const done = () => { setTimeout(() => frame.remove(), 1000); resolve(); };
            frame.addEventListener('load', async () => {
                const w = frame.contentWindow;
                try { await w.document.fonts.ready; } catch (e) { /* no font API */ }
                // The keeper marks the copy ready once it has walked every slide (charts rendered).
                for (let i = 0; i < 100 && !w.document.documentElement.hasAttribute('data-print-ready'); i++) await new Promise(r => setTimeout(r, 100));
                await new Promise(r => setTimeout(r, 400));
                try {
                    w.addEventListener('afterprint', done, { once: true });
                    w.focus();
                    w.print();
                    setTimeout(done, 60000);                // afterprint is not reliable everywhere
                } catch (e) { done(); }
            }, { once: true });
            frame.srcdoc = this.printableHtml({ base });
        });
    }

    /* ------------------------------------------------------------
       Single HTML file
       ------------------------------------------------------------ */
    async standalone({ to = null, dialog = true, fonts = true } = {}) {
        if (!this.deck.isOpen || this.busy) return null;
        this.busy = true;
        window.dispatchEvent(new CustomEvent('editor:before-save'));
        this.app.status('Exporting a single file...', { busy: true });
        try {
            const r = await this.app.api.exportStandalone(this.deck.file, this.app.serialize(), { to, dialog, fonts });
            this.app.status('');
            if (r.cancelled) return r;
            const notes = r.notes && r.notes.length ? ' | ' + r.notes.join(' | ') : '';
            this.app.toast(`Exported ${r.path} (${sizeLabel(r.bytes)}, ${r.files} file${r.files === 1 ? '' : 's'} embedded)${notes}`, { ms: notes ? 9000 : 6000 });
            return r;
        } catch (err) {
            this.app.status('');
            this.app.toast('Could not export: ' + err.message, { error: true, ms: 7000 });
            return null;
        } finally { this.busy = false; }
    }

    /* Export > PowerPoint: the deck measured slide by slide (pptx.js), written by the server
       (pptx_export.py). What could not be carried is said in the toast. */
    async pptx({ to = null, dialog = true } = {}) {
        if (!this.deck.isOpen || this.busy) return null;
        this.busy = true;
        window.dispatchEvent(new CustomEvent('editor:before-save'));
        const sel = this.app.selection.items.slice();
        this.app.selection.clear();
        try {
            const collector = new PptxCollector(this.app);
            const spec = await collector.collect((i, n) => this.app.status(`Measuring slide ${i + 1} of ${n} for PowerPoint...`, { busy: true }));
            if (sel.length) this.app.selection.set(sel.filter(el => this.deck.doc.contains(el)));
            sel.length = 0;
            this.app.status('Writing the PowerPoint file...', { busy: true });
            const r = await this.app.api.pptx(this.deck.file, spec, { to, dialog });
            this.app.status('');
            if (r.cancelled) return r;
            const notes = [...collector.notes, ...(r.notes || [])];
            r.notes = notes;
            this.app.toast(`Exported ${r.path} (${sizeLabel(r.bytes)}, ${spec.slides.length} slide${spec.slides.length === 1 ? '' : 's'})` + (notes.length ? ' | Not carried over: ' + notes.join(' | ') : ''), { ms: notes.length ? 12000 : 6000 });
            return r;
        } catch (err) {
            this.app.status('');
            this.app.toast('Could not export to PowerPoint: ' + err.message, { error: true, ms: 7000 });
            return null;
        } finally {
            this.busy = false;
            if (sel.length) this.app.selection.set(sel.filter(el => this.deck.doc.contains(el)));
        }
    }
}

function sizeLabel(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
}
function escapeHtml(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
