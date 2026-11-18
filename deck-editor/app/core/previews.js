/* ============================================================
   previews.js - what a deck is called, and a picture of its
   first slide, for the Decks drawer, the welcome screen and the
   title bar; and of a template's slides, for the New deck gallery.

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

const cache = new Map();          // `${url}@${mtime}#${slide}` -> { html, ext } (ext: stylesheets from other origins, added after the first paint)
const MAX_CACHED = 80;
/* A template's text, kept while its slides are looked at in the New deck gallery (several
   previews of one file would otherwise fetch it once each). Decks are not kept: they change. */
const texts = new Map();
async function fetchText(url, keep) {
    if (keep && texts.has(url)) return texts.get(url);
    const p = fetch(url, { cache: keep ? 'default' : 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    if (keep) {
        if (texts.size >= 6) texts.delete(texts.keys().next().value);
        texts.set(url, p);
        p.catch(() => texts.delete(url));
    }
    return p;
}

/* The srcdoc of one slide of a deck, the first unless `index` says ({ html: '' } when the file is
   not a deck, has no such slide or could not be read; a failed read is not cached, so the next look
   tries again). `url` is a deck under /deck/ or a template under /templates/. */
async function previewHtml(url, mtime, index = 0) {
    const key = url + '@' + mtime + '#' + index;
    if (cache.has(key)) return cache.get(key);
    let failed = false;
    const text = await fetchText(url, url.startsWith('/templates/')).catch(() => { failed = true; return ''; });
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const slides = Array.from(doc.querySelectorAll('.deck-stage .slide'));
    let html = '', ext = [];
    if (slides[index]) {
        doc.querySelectorAll('script, title, aside.notes, .notes, .deck-controls, .deck-keys, .deck-keyhint').forEach(n => n.remove());
        slides.forEach((s, i) => { if (i !== index) s.remove(); else s.classList.add('active', 'visible'); });
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

const deckUrl = (path) => '/deck/' + path.split('/').map(encodeURIComponent).join('/');

/* Fill every `.deck-thumb[data-path]` (a deck in the folder) or `.deck-thumb[data-url]` (a
   template, `data-slide` its slide, from 0) inside `root` once it scrolls into view. */
export class DeckPreviews {
    constructor(scrollRoot) {
        this.observer = new IntersectionObserver((entries) => {
            for (const e of entries) {
                if (!e.isIntersecting) continue;
                this.observer.unobserve(e.target);
                this.fill(e.target);
            }
        }, { root: scrollRoot, rootMargin: '120px' });
        // A box that changes width (the welcome screen's cards follow the window) keeps its picture fitted.
        this.resizer = new ResizeObserver((entries) => {
            for (const e of entries) {
                if (!e.target.isConnected) { this.resizer.unobserve(e.target); continue; }      // its list was redrawn
                const frame = e.target.querySelector('iframe');
                if (frame && e.target.clientWidth) frame.style.transform = `scale(${e.target.clientWidth / 1920})`;
            }
        });
    }
    watch(root) {
        root.querySelectorAll('.deck-thumb[data-path], .deck-thumb[data-url]').forEach(t => this.observer.observe(t));
    }
    async fill(box) {
        const url = box.dataset.url || deckUrl(box.dataset.path);
        const { html, ext, failed } = await previewHtml(url, box.dataset.mtime || '', +box.dataset.slide || 0);
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
        this.resizer.observe(box);
    }
}
