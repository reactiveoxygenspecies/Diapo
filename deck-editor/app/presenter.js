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
/* Find a slide (Ctrl+Shift+F, Ctrl+K, / or the Find button): the list is the deck runtime's
   (deck-runtime.js openFinder, 15 and later), borrowed from the deck in the "current" frame so the
   matching is the same as in a presented deck; it searches the notes too, since only the presenter
   sees this window. A pick asks the editor to go there (present.js), which in Preview also shows
   the steps up to what matched and outlines it. */
function find() {
    let rt = null;
    try { rt = $('cur').contentWindow.deckRuntime; } catch (e) { /* not loaded */ }
    if (!state || !state.file) return;
    if (!rt || !rt.openFinder) { say('Finding a slide needs the deck\'s presentation features: add them from the Presenter menu in the editor, or save the deck to bring them up to date.'); return; }
    keysList(false);
    rt.openFinder(document, { notes: true, pick: (index, query) => channel.postMessage({ type: 'find', index, query }) });
}
$('btnFind').addEventListener('click', find);
let sayTimer = 0;
function say(text) {
    const el = $('say');
    el.textContent = text; el.hidden = false;
    clearTimeout(sayTimer); sayTimer = setTimeout(() => { el.hidden = true; }, 6000);
}
/* A slide's number and Enter goes there, as in the deck. */
let typed = '', typedTimer = 0;
function typeNumber(e) {
    const pill = $('typed');
    const show = () => { pill.hidden = !typed; pill.textContent = 'Go to slide ' + typed + '  ↵'; };
    if (/^[0-9]$/.test(e.key)) {
        if (typed.length < 4) typed += e.key;
        clearTimeout(typedTimer); typedTimer = setTimeout(() => { typed = ''; show(); }, 3000);
        show(); return true;
    }
    if (!typed) return false;
    if (e.key === 'Enter') { const n = parseInt(typed, 10); typed = ''; show(); if (n >= 1 && state) channel.postMessage({ type: 'nav', to: Math.min(n, state.total) - 1 }); return true; }
    if (e.key === 'Backspace') { typed = typed.slice(0, -1); show(); return true; }
    if (e.key === 'Escape') { typed = ''; show(); return true; }
    return false;
}
const isFindKey = (e) => (e.ctrlKey || e.metaKey) && !e.altKey && ((e.shiftKey && (e.key.toLowerCase() === 'f' || e.code === 'KeyF')) || (!e.shiftKey && e.key.toLowerCase() === 'k'));
const isHelpKey = (e) => e.key === '?' || (e.key === '/' && e.shiftKey && e.code === 'Slash');   // "/" typed with Shift (an Italian keyboard) finds

/* "?" lists the keys, as in a presented deck (deck-runtime.js); only the ones this window has. */
const KEYS = [['Right  Down  Space  PgDn', 'Next step, then next slide'], ['Left  Up  PgUp', 'Back one step or slide'], ['Home  End', 'First or last slide'], ['12  Enter', 'Go to slide 12: type its number'], ['Ctrl+Shift+F  /', 'Find a slide by its title, words or notes']];
function keysList(on) {
    let box = document.querySelector('.deck-keys');
    if (!on) { if (box) box.remove(); return; }
    if (box) return;
    box = document.createElement('div');
    box.className = 'deck-keys';
    const panel = document.createElement('div');
    panel.className = 'dk-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Keys');
    panel.tabIndex = -1;
    const title = document.createElement('p'); title.className = 'dk-title'; title.textContent = 'Keys';
    const h = document.createElement('h3'); h.textContent = 'Move';
    const dl = document.createElement('dl');
    for (const [keys, what] of KEYS) {
        const dt = document.createElement('dt');
        for (const k of keys.split('  ')) { const kb = document.createElement('kbd'); kb.textContent = k; dt.append(kb, ' '); }
        const dd = document.createElement('dd'); dd.textContent = what;
        dl.append(dt, dd);
    }
    const foot = document.createElement('p'); foot.className = 'dk-foot'; foot.textContent = 'Esc, ? or a click closes this list.';
    panel.append(title, h, dl, foot);
    panel.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('click', () => keysList(false));
    box.appendChild(panel);
    document.body.appendChild(box);
    panel.focus();
}
window.addEventListener('keydown', (e) => {
    if (isFindKey(e)) { e.preventDefault(); find(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isHelpKey(e)) { e.preventDefault(); keysList(!document.querySelector('.deck-keys')); return; }
    if (e.key === 'Escape' && document.querySelector('.deck-keys')) { e.preventDefault(); keysList(false); return; }
    if (e.key === '/') { e.preventDefault(); find(); return; }
    if (typeNumber(e)) { e.preventDefault(); return; }
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

/* Keep the screen on while this window is in front, as the editor does (core/wakelock.js, the
   same setting: Look > Keep the screen on, followed here as it changes). The browser lets go
   whenever the window is hidden, so it is asked for again when it comes back. */
let wakeLock = null, wakeAsking = false;
const wakeWanted = () => { let on = true; try { on = localStorage.getItem('deck-editor-wake') !== '0'; } catch (e) { /* default on */ } return on && document.visibilityState === 'visible'; };
async function syncWake() {
    if (!(navigator.wakeLock && navigator.wakeLock.request)) return;
    const held = !!(wakeLock && !wakeLock.released);
    if (wakeWanted() && !held) {
        if (wakeAsking) return;
        wakeAsking = true;
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* refused: the power settings stay in charge */ }
        wakeAsking = false;
        if (!wakeWanted() && wakeLock && !wakeLock.released) syncWake();   // switched off or hidden meanwhile
    } else if (!wakeWanted() && held) {
        const s = wakeLock; wakeLock = null;
        try { await s.release(); } catch (e) { /* already gone */ }
    }
}
document.addEventListener('visibilitychange', syncWake);
window.addEventListener('storage', (e) => { if (e.key === 'deck-editor-wake') syncWake(); });
syncWake();
})();
