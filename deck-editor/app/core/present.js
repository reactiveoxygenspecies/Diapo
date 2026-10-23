/* ============================================================
   present.js - the presenter view (a second window).

   The editor is the source of truth. It broadcasts {index, total,
   notes, names} over a BroadcastChannel whenever the slide, the
   notes or the slide list change; the presenter window shows the
   current and next slide (the deck loaded in two small iframes,
   from the draft when there is one), the notes, a timer and a
   clock, and sends navigation requests back.
   ============================================================ */
import { Inspector } from './inspector.js';

export class Presenter {
    constructor(app) {
        this.app = app;
        this.deck = app.deck;
        this.win = null;
        this.channel = null;
        this._bind();
    }

    get channelName() { return 'deck-editor-presenter'; }

    _bind() {
        this.channel = new BroadcastChannel(this.channelName);
        this.channel.onmessage = (e) => this._onMessage(e.data || {});
        this.deck.addEventListener('slide', () => this.send());
        this.deck.addEventListener('ready', () => this.send());
        window.addEventListener('editor:notes', () => this.send());
        window.addEventListener('editor:saved', () => this.send({ reload: true }));
        if (this.app.strip) this.app.strip.addEventListener('structure', () => this.send());
        window.addEventListener('beforeunload', () => this.channel.postMessage({ type: 'bye' }));
    }

    /* Open (or focus) the presenter window. */
    open() {
        if (!this.deck.isOpen) { this.app.toast('Open a deck first'); return; }
        if (this.win && !this.win.closed) { this.win.focus(); this.send(); return; }
        this.win = window.open('presenter.html', 'deck-editor-presenter', 'width=1280,height=760');
        if (!this.win) { this.app.toast('The browser blocked the presenter window. Allow pop-ups for this site.', { error: true, ms: 5000 }); return; }
        this.app.toast('Presenter view opened in a new window. Drag it to the other screen.', { ms: 3500 });
    }

    state(extra = {}) {
        const d = this.deck;
        if (!d.isOpen) return { type: 'state', file: null, ...extra };
        const slides = d.slides;
        return {
            type: 'state',
            file: d.file,
            url: this.app.api.deckUrl(d.file, { draft: true }),
            index: d.current,
            total: slides.length,
            names: slides.map(s => d.slideLabel(s)),
            notes: d.currentSlide ? Inspector.notesOf(d.currentSlide) : '',
            nextNotes: slides[d.current + 1] ? Inspector.notesOf(slides[d.current + 1]) : '',
            skipped: slides.map(s => s.hasAttribute('data-skip')),
            ...extra,
        };
    }

    send(extra) {
        if (!this.channel) return;
        this.channel.postMessage(this.state(extra));
    }

    _onMessage(m) {
        if (m.type === 'hello') { this.send(); return; }
        if (m.type === 'nav' && this.deck.isOpen) {
            const rt = this.deck.win.deckRuntime;                 // fragments-aware when the deck has the runtime
            if (typeof m.to === 'number') this.deck.goTo(m.to);
            else if (typeof m.delta === 'number') {
                if (rt && this.app.preview) (m.delta > 0 ? rt.next() : rt.prev());
                else this.deck.goTo(this.deck.current + m.delta);
            }
        }
    }
}
