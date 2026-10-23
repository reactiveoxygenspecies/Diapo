/* ===========================================
   SLIDE PRESENTATION CONTROLLER
   Scales the stage (1920x1080 unless the deck's CSS says otherwise)
   into the window, navigates with the
   keyboard, touch and wheel, and exposes the hooks the editor uses:
   - reads --ed-panel on <html> (space reserved for a side panel)
   - listens for deck:rescale
   - dispatches deck:slide (detail = slide index)
   - honours #n in the URL to show slide n
   Part of the Diapo Format. Copyright (c) 2026 Daniele Rossetto. MIT licence (SPDX-License-Identifier: MIT);
   free to keep in any deck.
   =========================================== */
class SlidePresentation {
    constructor() {
        this.stage = document.getElementById('deckStage');
        this.current = 0;
        this.setupStageScale();
        this.setupKeyboardNav();
        this.setupTouchNav();
        this.setupWheelNav();
        this.setupControls();
        const fromHash = () => parseInt(location.hash.replace('#', ''), 10);
        this.showSlide(Number.isFinite(fromHash()) ? fromHash() - 1 : 0, true);
        window.addEventListener('hashchange', () => {
            const n = fromHash();
            if (Number.isFinite(n) && n - 1 !== this.current) this.showSlide(n - 1);
        });
    }

    /* Slides are read live so the editor can add and remove them. */
    get slides() { return Array.from(this.stage.querySelectorAll('.slide')); }

    setupStageScale() {
        const scale = () => {
            const pad = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ed-panel')) || 0;
            const vw = window.innerWidth - pad, vh = window.innerHeight;
            const sw = this.stage.offsetWidth || 1920, sh = this.stage.offsetHeight || 1080;
            const factor = Math.min(vw / sw, vh / sh);
            const x = (vw - sw * factor) / 2, y = (vh - sh * factor) / 2;
            this.stage.style.transform = `translate(${x}px, ${y}px) scale(${factor})`;
        };
        scale();
        window.addEventListener('resize', scale);
        document.addEventListener('deck:rescale', scale);
    }

    setupKeyboardNav() {
        document.addEventListener('keydown', (e) => {
            if (e.target.getAttribute && e.target.getAttribute('contenteditable') === 'true') return;
            switch (e.key) {
                case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown': e.preventDefault(); this.next(); break;
                case 'ArrowLeft': case 'ArrowUp': case 'PageUp': e.preventDefault(); this.prev(); break;
                case 'Home': e.preventDefault(); this.showSlide(0); break;
                case 'End': e.preventDefault(); this.showSlide(this.slides.length - 1); break;
                case 'h': case 'H': if (!e.ctrlKey && !e.metaKey && !e.altKey) document.documentElement.classList.toggle('deck-controls-off'); break;
            }
        });
    }

    /* The on-screen controls: click to move, faded out after 2 s without mouse
       movement (not while the mouse is over them) and back on the first move or
       touch. H hides them altogether, for when the mouse is needed where they sit. */
    setupControls() {
        document.getElementById('btnPrev').addEventListener('click', () => this.prev());
        document.getElementById('btnNext').addEventListener('click', () => this.next());
        const root = document.documentElement, box = document.querySelector('.deck-controls');
        let timer = null, over = false;
        const idle = () => { if (!over) root.classList.add('deck-controls-idle'); };
        const wake = () => { root.classList.remove('deck-controls-idle'); clearTimeout(timer); timer = setTimeout(idle, 2000); };
        box.addEventListener('mouseenter', () => { over = true; });
        box.addEventListener('mouseleave', () => { over = false; wake(); });
        document.addEventListener('mousemove', wake, { passive: true });
        document.addEventListener('touchstart', wake, { passive: true });
        timer = setTimeout(idle, 2000);
    }

    setupTouchNav() {
        let x0 = null, y0 = null;
        document.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
        document.addEventListener('touchend', (e) => {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? this.next() : this.prev());
            x0 = y0 = null;
        }, { passive: true });
    }

    setupWheelNav() {
        let lock = false;
        document.addEventListener('wheel', (e) => {
            if (lock || Math.abs(e.deltaY) < 30) return;
            lock = true; setTimeout(() => lock = false, 700);
            e.deltaY > 0 ? this.next() : this.prev();
        }, { passive: true });
    }

    next() { this.showSlide(this.current + 1); }
    prev() { this.showSlide(this.current - 1); }

    showSlide(index, initial = false) {
        const slides = this.slides;
        this.current = Math.max(0, Math.min(index, slides.length - 1));
        slides.forEach((s, i) => {
            const on = i === this.current;
            s.classList.toggle('active', on);
            if (on) requestAnimationFrame(() => requestAnimationFrame(() => s.classList.add('visible')));
            else s.classList.remove('visible');
        });
        document.querySelectorAll('#pageNow, [data-page-now]').forEach(e => { e.textContent = this.current + 1; });
        document.querySelectorAll('#pageTotal, [data-page-total]').forEach(e => { e.textContent = slides.length; });
        document.dispatchEvent(new CustomEvent('deck:slide', { detail: this.current }));
        // A sandboxed preview (Teams, SharePoint, a srcdoc frame) cannot change its URL: keep the page going.
        if (!initial || location.hash) { try { history.replaceState(null, '', '#' + (this.current + 1)); } catch (e) { /* URL stays as it is */ } }
    }
}

new SlidePresentation();
