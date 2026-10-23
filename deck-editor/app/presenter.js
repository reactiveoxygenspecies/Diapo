/* presenter.js - the presenter window (presenter.html): the current and next slide of the
   deck open in the editor, notes, timers; steered over BroadcastChannel. A file of its own
   because the editor's pages allow no inline scripts (serve.py, editor_csp). */
(function () {
'use strict';
const $ = (id) => document.getElementById(id);
const channel = new BroadcastChannel('deck-editor-presenter');
let state = null;            // last state from the editor
let loadedUrl = null;        // deck url currently loaded in the frames
let frameReady = { cur: false, next: false };
let lastHeard = 0;           // when the editor last spoke; used to notice a lost editor

/* ------------------------------------------------------------
   Frames: load the deck once, then move by hash (with the same
   class-toggle fallback the editor uses).
   ------------------------------------------------------------ */
function loadFrames(url) {
    loadedUrl = url;
    frameReady = { cur: false, next: false };
    for (const id of ['cur', 'next']) {
        const f = $(id);
        f.onload = () => { frameReady[id] = true; quiet(f); show(id); };
        f.src = url;
    }
}
/* Presentation chrome is hidden in the frames; navigation happens from here. */
function quiet(frame) {
    try {
        const doc = frame.contentDocument;
        const st = doc.createElement('style');
        st.textContent = '.deck-controls { display: none !important; } html, body { overflow: hidden !important; } .slide > aside.notes, .slide > .notes { display: none !important; }';
        doc.head.appendChild(st);
    } catch (e) { /* not loaded yet */ }
}
function show(id) {
    if (!state || !frameReady[id]) return;
    const index = id === 'cur' ? state.index : state.index + 1;
    const frame = $(id);
    if (id === 'next') $('nextEmpty').hidden = index < state.total;
    if (index >= state.total) return;
    try {
        const win = frame.contentWindow, doc = frame.contentDocument;
        const slides = Array.from(doc.querySelectorAll('.deck-stage .slide'));
        win.location.hash = '#' + (index + 1);
        setTimeout(() => {
            if (slides.findIndex(s => s.classList.contains('active')) === index) return;
            slides.forEach((s, i) => { s.classList.toggle('active', i === index); s.classList.toggle('visible', i === index); });
        }, 40);
    } catch (e) { /* frame not ready */ }
}

/* ------------------------------------------------------------
   State from the editor
   ------------------------------------------------------------ */
function apply(s) {
    state = s;
    lastHeard = Date.now();
    $('link').hidden = true;
    const has = !!s.file;
    $('curEmpty').hidden = has;
    if (!has) { $('now').textContent = '-'; $('total').textContent = '-'; $('notes').textContent = ''; return; }
    if (s.url !== loadedUrl || s.reload) loadFrames(s.url);
    else { show('cur'); show('next'); }
    $('now').textContent = s.index + 1;
    $('total').textContent = s.total;
    $('name').textContent = s.names && s.names[s.index] ? ' ' + s.names[s.index] : '';
    $('notes').textContent = s.notes || '';
    document.title = `Presenter ${s.index + 1}/${s.total}`;
}
channel.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'state') apply(m);
    // An editor page going away (closed, or just reloading): keep showing what we have,
    // say so quietly, and keep asking until an editor answers again.
    if (m.type === 'bye') { lastHeard = 0; $('link').hidden = false; }
};
channel.postMessage({ type: 'hello' });
setInterval(() => { if (!lastHeard) channel.postMessage({ type: 'hello' }); }, 2000);
window.addEventListener('focus', () => channel.postMessage({ type: 'hello' }));

/* ------------------------------------------------------------
   Navigation requests
   ------------------------------------------------------------ */
const nav = (delta) => channel.postMessage({ type: 'nav', delta });
$('btnPrev').addEventListener('click', () => nav(-1));
$('btnNext').addEventListener('click', () => nav(1));
window.addEventListener('keydown', (e) => {
    switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case ' ': case 'PageDown': e.preventDefault(); nav(1); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp': e.preventDefault(); nav(-1); break;
        case 'Home': e.preventDefault(); channel.postMessage({ type: 'nav', to: 0 }); break;
        case 'End': e.preventDefault(); if (state) channel.postMessage({ type: 'nav', to: state.total - 1 }); break;
    }
});

/* ------------------------------------------------------------
   Timer, clock, notes size
   ------------------------------------------------------------ */
let started = Date.now();
const pad = (n) => String(n).padStart(2, '0');
function tick() {
    const s = Math.floor((Date.now() - started) / 1000);
    $('time').textContent = (s >= 3600 ? pad(Math.floor(s / 3600)) + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
    const d = new Date();
    $('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
}
setInterval(tick, 500); tick();
$('btnReset').addEventListener('click', () => { started = Date.now(); tick(); });
$('time').addEventListener('click', () => { started = Date.now(); tick(); });
let notesSize = +localStorage.getItem('deck-editor-notes-size') || 20;
const applySize = () => { $('notes').style.fontSize = notesSize + 'px'; try { localStorage.setItem('deck-editor-notes-size', notesSize); } catch (e) { /* ignore */ } };
document.querySelector('.notes-size').addEventListener('click', (e) => { const b = e.target.closest('[data-size]'); if (!b) return; notesSize = Math.max(12, Math.min(48, notesSize + 2 * +b.dataset.size)); applySize(); });
applySize();
})();
