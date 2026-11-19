/* ============================================================
   wakelock.js - keep the screen on while Diapo is in front.

   The browser's Screen Wake Lock: while it is held, the computer
   does not dim or turn off the screen or go to sleep, so a slide
   left up during a lesson stays up. The browser lets go of it by
   itself whenever the page is hidden (another tab, a minimised
   window), so it is asked for again each time the page comes
   back. Browsers without it (or a battery saver that refuses it)
   simply leave the power settings in charge.

   On by default; the choice is kept in localStorage under KEY,
   which the presenter window (presenter.js) reads too.
   ============================================================ */
export const KEY = 'deck-editor-wake';

export class WakeLock {
    constructor() {
        this.on = false;
        this.sentinel = null;
        this.supported = !!(navigator.wakeLock && navigator.wakeLock.request);
        document.addEventListener('visibilitychange', () => this._sync());
    }

    static saved() {
        try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; }
    }

    set(on) {
        this.on = !!on;
        try { localStorage.setItem(KEY, this.on ? '1' : '0'); } catch (e) { /* only a preference */ }
        this._sync();
    }

    get held() { return !!(this.sentinel && !this.sentinel.released); }

    async _sync() {
        if (!this.supported) return;
        const want = this.on && document.visibilityState === 'visible';
        if (want && !this.held) {
            if (this._asking) return;                              // one request at a time; it rechecks when it lands
            this._asking = true;
            try {
                const s = await navigator.wakeLock.request('screen');
                this.sentinel = s;
                s.addEventListener('release', () => { if (this.sentinel === s) this.sentinel = null; });
            } catch (e) { /* refused: battery saver, policy; the power settings stay in charge */ }
            this._asking = false;
            if (this.held && !(this.on && document.visibilityState === 'visible')) this._sync();   // switched off or hidden meanwhile
        } else if (!want && this.held) {
            const s = this.sentinel; this.sentinel = null;
            try { await s.release(); } catch (e) { /* already gone */ }
        }
    }
}
