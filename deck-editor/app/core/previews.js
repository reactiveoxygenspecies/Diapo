/* ============================================================
   previews.js - what a deck is called, and a picture of its
   first slide, for the Decks drawer and the title bar.

   A deck is named by its <title>, unless that is a placeholder
   ("New deck", "Untitled"); then by its folder (decks are
   <name>/index.html) or its file name.

   The preview is built like a slide-strip thumbnail: the deck's
   own head (its CSS and fonts, scripts taken out) and its first
   slide shown as it looks once revealed, in a sandboxed frame
   that runs no script. Previews load only when their row scrolls
   into view, and are kept per file and modification time.
   ============================================================ */
import { THUMB_CSS, absoluteUrls, takeExternalCss, addExternalCss } from './slides.js';

const GENERIC_TITLE = /^(new deck|untitled( deck)?|deck|presentation|slides|index|document)$/i;

export function deckName(file, title = '') {
    const t = String(title || '').trim();
    if (t && !GENERIC_TITLE.test(t)) return t;
    if (file.startsWith('@diapo/')) return 'Diapo tour';
    const parts = file.split('/');
    const base = parts.pop().replace(/\.html?$/i, '');
    return base.toLowerCase() === 'index' && parts.length ? parts.pop() : base;
}

const cache = new Map();          // `${path}@${mtime}` -> { html, ext } (ext: stylesheets from other origins, added after the first paint)
const MAX_CACHED = 80;

/* The srcdoc of a deck's first slide ({ html: '' } when the file is not a deck or could not be read;
   a failed read is not cached, so the next look tries again). */
async function previewHtml(path, mtime) {
    const key = path + '@' + mtime;
    if (cache.has(key)) return cache.get(key);
    const url = '/deck/' + path.split('/').map(encodeURIComponent).join('/');
    let failed = false;
    const text = await fetch(url, { cache: 'no-store' }).then(r => { if (!r.ok) failed = true; return r.ok ? r.text() : ''; }).catch(() => { failed = true; return ''; });
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const slides = Array.from(doc.querySelectorAll('.deck-stage .slide'));
    let html = '', ext = [];
    if (slides.length) {
        doc.querySelectorAll('script, title, aside.notes, .notes, .deck-controls').forEach(n => n.remove());
        slides.slice(1).forEach(s => s.remove());
        slides[0].classList.add('active', 'visible');
        const dir = url.slice(0, url.lastIndexOf('/') + 1);
        const base = doc.createElement('base'); base.href = new URL(dir, location.href).href;   // absolute: see slides.js
        doc.head.prepend(base);
        absoluteUrls(doc, base.href);
        ext = takeExternalCss(doc);          // they would hold the first paint up: see takeExternalCss
        const style = doc.createElement('style'); style.textContent = THUMB_CSS;
        doc.head.append(style);
        html = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    }
    const entry = { html, ext };
    if (failed) return { ...entry, failed };
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
    cache.set(key, entry);
    return entry;
}

/* Fill every `.deck-thumb[data-path]` inside `root` once it scrolls into view. */
export class DeckPreviews {
    constructor(scrollRoot) {
        this.observer = new IntersectionObserver((entries) => {
            for (const e of entries) {
                if (!e.isIntersecting) continue;
                this.observer.unobserve(e.target);
                this.fill(e.target);
            }
        }, { root: scrollRoot, rootMargin: '120px' });
    }
    watch(root) {
        root.querySelectorAll('.deck-thumb[data-path]').forEach(t => this.observer.observe(t));
    }
    async fill(box) {
        const { html, ext, failed } = await previewHtml(box.dataset.path, box.dataset.mtime || '');
        if (!box.isConnected) return;
        if (!html) { if (failed) setTimeout(() => { if (box.isConnected && !box.classList.contains('filled')) this.observer.observe(box); }, 3000); return; }     // unreadable just now: look again
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-same-origin');      // the deck's CSS and fonts, never its scripts
        frame.setAttribute('tabindex', '-1');
        frame.setAttribute('aria-hidden', 'true');
        frame.style.transform = `scale(${(box.clientWidth || 96) / 1920})`;      // a box with no width yet (drawer still opening) must not scale the frame to nothing
        frame.addEventListener('load', () => { try { addExternalCss(frame.contentDocument, ext); } catch (e) { /* ignore */ } });
        frame.srcdoc = html;
        box.appendChild(frame);
        box.classList.add('filled');
    }
}
