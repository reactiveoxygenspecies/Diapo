/* ============================================================
   editor.js - boot, layout, File menu, welcome screen, file drawer,
   keyboard map.

   The modules under core/ each own one concern and get the shared
   `app` object; this file wires them to the DOM of index.html.
   ============================================================ */
import { api } from './core/api.js';
import { fitText } from './core/transform.js';
import { refreshCharts } from './core/chart.js';
import { refreshMath } from './core/math.js';
import { refreshChem, uprightLabels } from './core/chem.js';
import { PLOT, refreshPlots, openPlotDialog, ensureDeckPlots } from './core/plot.js';
import { LAYOUTS } from './core/layouts.js';
import { Cropper, canCrop, cropBoxOf } from './core/crop.js';
import { Palette, iconEntries } from './core/palette.js';
import { FindBar } from './core/find.js';
import { Rulers } from './core/guides.js';
import { Deck } from './core/document.js';
import { History } from './core/history.js';
import { Selection } from './core/selection.js';
import { Inspector } from './core/inspector.js';
import { TextEditor } from './core/textedit.js';
import { InlineMath } from './core/inlinemath.js';
import { SlideStrip, slidesWord } from './core/slides.js';
import { Inserter, ICONS } from './core/insert.js';
import { Presenter } from './core/present.js';
import { ThemePanel } from './core/theme.js';
import { FontPicker } from './core/fonts.js';
import { IconPicker } from './core/icons.js';
import { Exporter } from './core/export.js';
import { showPublish } from './core/publish.js';
import { EditOps } from './core/editops.js';
import { Layers } from './core/layers.js';
import { Problems } from './core/problems.js';
import { readableText } from './core/dom.js';
import { deckName, DeckPreviews } from './core/previews.js';
import { TemplateGallery } from './core/gallery.js';
import { loader } from './core/loader.js';
import { DeckTabs } from './core/tabs.js';
import { FileDrop } from './core/filedrop.js';
import { keepNamed } from './core/a11y.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------
   Shared application state
   ------------------------------------------------------------ */
export const app = {
    deck: new Deck($('deckFrame')),
    history: new History(),
    selection: null,        // created below, after the DOM exists
    inspector: null,
    textEdit: null,
    strip: null,
    insert: null,
    presenter: null,
    exporter: null,
    editops: null,
    problems: null,
    theme: null,
    find: null,
    spellcheck: true,       // Look > Check spelling while typing: the browser's spellcheck on the text being edited
    themeMode: false,
    api,
    toast: null,            // set once toast() exists
    file: null,
    dirty: false,
    zoom: 1,
    zoomMode: 'fit',        // 'fit' follows the window, a number is a fixed zoom
    workspace: '',
    preview: false,
};

/* ------------------------------------------------------------
   Toast and status line
   ------------------------------------------------------------ */
const toastEl = document.createElement('div');
toastEl.className = 'toast';
document.body.appendChild(toastEl);
let toastTimer = null;
export function toast(msg, { error = false, ms = 2600 } = {}) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', error);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}
/* { busy } puts the loader beside the message (it shows after 300 ms, see .loader); the next
   message clears it. */
export function status(msg, { busy = false } = {}) {
    $('statusMsg').textContent = msg || '';
    $('statusBusy').hidden = !(busy && msg);
}
app.status = status;
$('statusBusy').innerHTML = loader();
$('canvasLoading').innerHTML = loader({ word: true });

/* ------------------------------------------------------------
   Deck tabs (core/tabs.js): what the tab strip needs from the editor.
   ------------------------------------------------------------ */
const tabs = new DeckTabs({
    app, api, el: $('deckTabs'),
    host: {
        load: (file, opts) => loadDeck(file, opts),
        toast: (m, o) => toast(m, o),
        nameOf: (file, title) => deckName(file, title),
        pathOf: (t) => t.file.startsWith('@diapo/') ? 'The Diapo tour: a copy of its own, outside your folders' : fullPathOf(t.ws || app.workspace, t.file),
        showDrawer: () => showDrawer(true),
        setWorkspace: (ws) => switchWorkspace(ws),
        // The live deck's unsaved edits go to its draft before another deck takes the iframe.
        flush: async () => {
            clearTimeout(draftTimer); draftTimer = null;
            await api.draftWrite(app.file, serialize());
            draftWritten = true;
        },
        save: () => saveDeck(),
        discardDraft: async (file) => {
            if (file === app.file) { clearTimeout(draftTimer); draftTimer = null; draftWritten = false; }
            await api.draftDelete(file).catch(() => {});
        },
        getView: () => ({ zoomMode: app.zoomMode, scroll: [$('canvas').scrollLeft, $('canvas').scrollTop] }),
        setView: (t) => { setZoom(t.zoomMode); if (t.zoomMode !== 'fit' && t.scroll) { $('canvas').scrollLeft = t.scroll[0]; $('canvas').scrollTop = t.scroll[1]; } },
        unload: () => unloadDeck(),
        // A deck going to a background tab keeps its document and history (tabs.js, Deck.park).
        park: () => {
            if (app.selection) app.selection.clear();
            const parked = { deck: app.deck.park(), history: app.history.park(), draftWritten };
            clearTimeout(draftTimer); draftTimer = null; draftWritten = false;
            return parked;
        },
        resume: (file, parked) => resumeDeck(file, parked),
        discard: (parked) => Deck.discardParked(parked.deck),
        versionOf: (parked) => parked.deck.state.diskVersion || '',
    },
});
app.tabs = tabs;

/* ------------------------------------------------------------
   Dirty state: the top-bar dot, Save button and the unload guard
   ------------------------------------------------------------ */
function refreshDirty() {
    const v = app.history.isDirty && !!app.file;
    app.dirty = v;
    tabs.refresh();
    $('dirtyDot').hidden = !v;
    $('btnSave').disabled = !v;
    $('btnUndo').disabled = !app.history.canUndo;
    $('btnRedo').disabled = !app.history.canRedo;
    $('btnUndo').title = 'Undo' + (app.history.top ? ' ' + app.history.top.label.toLowerCase() : '') + ' (Ctrl+Z)';
    document.title = (v ? '* ' : '') + (app.file ? app.deckName + ' - ' : '') + 'Diapo';
}
app.history.addEventListener('change', () => { refreshDirty(); scheduleDraft(); });
// Undo and redo snap into place: the deck's reveal transitions would otherwise ease every step over 0.7s.
app.history.addEventListener('before-step', () => app.deck.setTransitions(false));
app.history.addEventListener('step', () => app.deck.setTransitions(true));
// The editor's charts are drawn for their box and text: after an undone resize or a new text size, again.
app.history.addEventListener('change', () => { if (app.deck.isOpen) { refreshCharts(app.deck.stage); uprightLabels(app.deck.stage); } });
// A chart the file carries as its table alone (written by hand or by a deck generator) is drawn
// once the deck shows, its fonts loaded; saving then keeps the drawing.
window.addEventListener('editor:open', async () => {
    const doc = app.deck.doc;
    try { await doc.fonts.ready; } catch (e) { /* draw with what there is */ }
    if (app.deck.isOpen && app.deck.doc === doc) refreshCharts(app.deck.stage);
    // Equations and structures written as their source alone are drawn the same way; the
    // libraries load only when a deck has such a figure without its drawing.
    if (!app.deck.isOpen || app.deck.doc !== doc || !doc.querySelector('[data-math], [data-chem]')) return;
    const bad = [...await refreshMath(app.deck.stage).catch(() => []), ...await refreshChem(app.deck.stage).catch(() => [])];
    if (app.deck.doc !== doc) return;
    for (const b of bad) {
        const math = b.el.hasAttribute('data-math');
        app.problems.add({ kind: 'drawn', what: math ? 'equation' : 'structure', message: b.message, url: b.el.getAttribute(math ? 'data-math' : 'data-chem'), el: b.el });
    }
    uprightLabels(app.deck.currentSlide);
    app.selection.refresh();
});
/* Interactive charts (core/plot.js). While editing, a chart is its picture, made by the editor:
   it is drawn again when the figure, the box or the look it takes from the deck changes
   (a resize, a theme change, an undo), a moment after the change, and when a deck opens with
   a chart written as its figure alone. Preview shows the charts live, as the saved deck does. */
let plotTimer = 0;
function plotsStale() {
    clearTimeout(plotTimer);
    plotTimer = setTimeout(async () => {
        const doc = app.deck.doc;
        if (!app.deck.isOpen || !doc.querySelector(PLOT)) return;
        const bad = await refreshPlots(app.deck.stage).catch(() => []);
        if (app.deck.doc !== doc) return;
        for (const b of bad) if (!app.problems.items.some(p => p.kind === 'drawn' && p.el === b.el)) app.problems.add({ kind: 'drawn', what: 'interactive chart', message: b.message, url: '', el: b.el });
        if (app.selection.single && app.selection.single.matches(PLOT)) app.selection.refresh();
    }, 300);
}
window.addEventListener('editor:plot-stale', plotsStale);
window.addEventListener('editor:open', plotsStale);
app.history.addEventListener('change', plotsStale);
app.deck.addEventListener('overrides', plotsStale);
window.addEventListener('editor:preview', (e) => {
    if (e.detail && app.deck.isOpen) ensureDeckPlots(app.deck).catch((err) => toast('The charts stay pictures in this preview: ' + err.message, { error: true, ms: 5000 }));
});
// A structure rotated outside the editor (by hand, by the skill) gets its labels upright when its slide shows.
app.deck.addEventListener('slide', () => setTimeout(() => uprightLabels(app.deck.currentSlide), 50));
window.addEventListener('beforeunload', (e) => {
    if (app.dirty) { e.preventDefault(); e.returnValue = ''; }
});

export function undo() { window.dispatchEvent(new CustomEvent('editor:before-step')); app.history.undo(); }
export function redo() { window.dispatchEvent(new CustomEvent('editor:before-step')); app.history.redo(); }
$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);

/* ------------------------------------------------------------
   Drafts: unsaved edits are autosaved as <file>.~draft next to the
   deck (debounced), offered back on the next open, and removed on
   save. The timer is cancelled on save so a late write cannot
   outlive the save.
   ------------------------------------------------------------ */
let draftTimer = null;
let draftWritten = false;      // a draft of this session exists on disk
function scheduleDraft() {
    clearTimeout(draftTimer);
    if (!app.file) return;
    if (!app.dirty) {
        // Undo took the deck back to what is saved: the draft would only offer stale edits next time.
        if (draftWritten) { draftWritten = false; api.draftDelete(app.file).catch(() => {}); status(''); }
        return;
    }
    draftTimer = setTimeout(async () => {
        draftTimer = null;
        if (!app.file || !app.dirty) return;
        try { await api.draftWrite(app.file, serialize()); draftWritten = true; status('Draft saved ' + new Date().toLocaleTimeString()); }
        catch (err) { status('Draft not saved: ' + err.message); }
    }, 800);
}
/* The notice bars under the top bar (unsaved draft, paused scripts, an older runtime) stack
   in one column instead of lying on top of each other. */
function barStack() {
    let el = document.getElementById('barStack');
    if (!el) { el = document.createElement('div'); el.id = 'barStack'; document.body.appendChild(el); }
    return el;
}
async function offerDraft(file) {
    let st = null;
    try { st = await api.draftStatus(file); } catch (e) { return; }
    if (!st.exists) return;
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = `Unsaved edits from ${new Date(st.mtime * 1000).toLocaleString()} <button data-a="keep">Restore</button><button data-a="drop">Discard</button>`;
    barStack().appendChild(bar);
    bar.addEventListener('click', async (e) => {
        const a = e.target.dataset.a; if (!a) return;
        bar.remove();
        if (a === 'drop') { try { await api.draftDelete(file); } catch (err) { /* ignore */ } return; }
        await openDeck(file, { draft: true });
    });
}

/* A deck with scripts of its own (a chart library, a generator, anything Diapo did not
   write) is served with them paused: a script in a deck runs with the editor's rights and
   could read or change any file on this computer (serve.py, "Scripts in decks"). The bar
   says so and lets the user trust the deck; the choice is kept per deck and lapses when
   its scripts change. The deck is then opened again so the scripts run from the start
   (unsaved edits go through the draft, so nothing is lost). */
const keptPaused = new Set();      // "Keep paused" holds for the session: a tab switch does not ask again
function offerTrust(file) {
    document.querySelectorAll('.bar.trust-bar').forEach(b => b.remove());
    const t = app.deck.trust;
    if (!t || t.trusted || !t.scripts || keptPaused.has(file)) return;
    const bar = document.createElement('div');
    bar.className = 'bar trust-bar';
    bar.innerHTML = `This deck has ${t.scripts === 1 ? 'a script' : t.scripts + ' scripts'} of its own, paused: a deck's script could read and change files on this computer. `
        + 'Run them only if you made the deck or know where it comes from. '
        + (t.remote ? (t.remote === t.scripts ? (t.scripts === 1 ? 'It comes' : 'They come') : t.remote === 1 ? 'One of them comes' : t.remote + ' of them come')
            + ' from the internet and can change without Diapo noticing. ' : '')
        + '<button data-a="trust">Trust this deck</button><button data-a="later">Keep paused</button>';
    barStack().appendChild(bar);
    bar.addEventListener('click', async (e) => {
        const a = e.target.dataset.a; if (!a) return;
        bar.remove();
        if (a === 'later') keptPaused.add(file);
        if (a === 'trust') await setDeckTrust(file, true);
    });
}
export async function setDeckTrust(file, on) {
    try {
        if (app.dirty) await api.draftWrite(file, serialize());
        await api.setTrust(file, on, app.dirty);
        await openDeck(file, { draft: app.dirty, sameSession: true });
        toast(on ? "The deck's own scripts run now." : "The deck's own scripts are paused again.", { ms: 3500 });
    } catch (err) { toast('Could not change that: ' + err.message, { error: true }); }
}

/* A deck whose presentation features script is older than the editor's (or missing on a deck
   that once had one) gets a bar with a button: one press writes the current script in, so an
   older deck gains what the editor has learnt since. Saving does it too; this is the button
   for decks that are only being looked at, and it can be dismissed for the session. */
let runtimeNoticeOff = false;
function offerRuntimeUpdate() {
    document.querySelectorAll('.bar.runtime-bar').forEach(b => b.remove());
    if (runtimeNoticeOff || !app.deck.isOpen || runtimeState() !== 'old') return;
    const bar = document.createElement('div');
    bar.className = 'bar runtime-bar';
    bar.innerHTML = 'This deck carries an older edition of the presentation features. '
        + '<button data-a="update">Update them</button><button data-a="later">Not now</button>';
    barStack().appendChild(bar);
    bar.addEventListener('click', async (e) => {
        const a = e.target.dataset.a; if (!a) return;
        bar.remove();
        if (a === 'later') { runtimeNoticeOff = true; return; }
        if (await addRuntimeScript({ quiet: true })) toast('Presentation features brought up to date. Save to keep them; they work in the deck once it is opened again.', { ms: 6000 });
    });
}
app.deck.addEventListener('ready', () => { runtimeNoticeOff = false; setTimeout(offerRuntimeUpdate, 400); });
window.addEventListener('editor:saved', () => offerRuntimeUpdate());

export function serialize() {
    return app.deck.serialize({ isEdited: (el) => app.history.hasChangesWithin(el) });
}
app.serialize = serialize;

/* ------------------------------------------------------------
   Zoom and layout.
   The iframe is sized to exactly stage*zoom (1920x1080 unless the
   deck says otherwise); the host CSS scales the stage by --ed-zoom
   and the editor's canvas provides the letterbox and the scrolling.
   ------------------------------------------------------------ */
const ZOOM_MIN = 0.25, ZOOM_MAX = 2, PAD = 28;

function fitZoom() {
    const c = $('canvas');
    const pad = app.preview ? 0 : PAD;
    const w = c.clientWidth - pad * 2, h = c.clientHeight - pad * 2;
    return Math.max(0.05, Math.min(w / app.deck.stageW, h / app.deck.stageH));
}

export function applyZoom() {
    const z = app.zoomMode === 'fit' ? fitZoom() : app.zoomMode;
    app.zoom = z;
    const wrap = $('stageWrap');
    wrap.style.width = Math.round(app.deck.stageW * z) + 'px';
    wrap.style.height = Math.round(app.deck.stageH * z) + 'px';
    document.documentElement.style.setProperty('--stage-ar', `${app.deck.stageW} / ${app.deck.stageH}`);
    $('zoomLabel').textContent = Math.round(z * 100) + '%';
    app.deck.setZoom(z);
    app.deck.rescale();
    window.dispatchEvent(new CustomEvent('editor:zoom', { detail: z }));
}

/* anchor = {x, y} in client coordinates keeps the stage point under the pointer where
   it is (Ctrl+wheel); without one the canvas is centred. */
export function setZoom(mode, anchor = null) {
    if (mode !== 'fit') mode = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, mode));
    app.zoomMode = mode;
    const wrap = $('stageWrap'), c = $('canvas');
    const before = anchor && wrap.getBoundingClientRect();
    const z0 = app.zoom;
    applyZoom();
    if (mode === 'fit') return;
    if (!before) { centreCanvas(); return; }
    const px = (anchor.x - before.left) / z0, py = (anchor.y - before.top) / z0;    // stage point under the pointer
    const after = wrap.getBoundingClientRect();
    c.scrollLeft += (after.left + px * app.zoom) - anchor.x;
    c.scrollTop += (after.top + py * app.zoom) - anchor.y;
}

function centreCanvas() {
    const c = $('canvas');
    c.scrollLeft = (c.scrollWidth - c.clientWidth) / 2;
    c.scrollTop = (c.scrollHeight - c.clientHeight) / 2;
}

function zoomStep(dir) {
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
    const cur = app.zoom;
    const next = dir > 0 ? steps.find(s => s > cur + 0.001) : [...steps].reverse().find(s => s < cur - 0.001);
    if (next) setZoom(next);
}

new ResizeObserver(() => { if (app.zoomMode === 'fit' || app.preview) applyZoom(); }).observe($('canvas'));

/* ------------------------------------------------------------
   Side panels: each can be hidden and resized (drag the edge,
   double-click to reset). Remembered per browser. A narrow window
   starts with the panels hidden unless the user chose otherwise.
   ------------------------------------------------------------ */
const PANEL_KEY = 'deck-editor-panels';
const PANEL_DEFAULTS = { strip: true, inspector: true, stripW: 220, inspectorW: 300, layers: false, layersH: 200 };
const PANEL_LIMITS = { strip: [150, 520], inspector: [240, 680] };
const panels = { ...PANEL_DEFAULTS };
try { Object.assign(panels, JSON.parse(localStorage.getItem(PANEL_KEY) || '{}')); } catch (e) { /* ignore */ }
if (!localStorage.getItem(PANEL_KEY) && innerWidth < 1000) { panels.inspector = false; if (innerWidth < 800) panels.strip = false; }

function applyPanels() {
    document.body.classList.toggle('strip-collapsed', !panels.strip);
    document.body.classList.toggle('panel-collapsed', !panels.inspector);
    document.documentElement.style.setProperty('--strip-w', panels.stripW + 'px');
    document.documentElement.style.setProperty('--inspector-w', panels.inspectorW + 'px');
    $('btnToggleStrip').classList.toggle('off', !panels.strip);
    $('btnTogglePanel').classList.toggle('off', !panels.inspector);
    $('btnToggleStrip').innerHTML = panels.strip ? '&#9664; Slides' : '&#9654; Slides';
    $('btnTogglePanel').innerHTML = panels.inspector ? 'Panel &#9654;' : 'Panel &#9664;';
    document.documentElement.style.setProperty('--layers-h', panels.layersH + 'px');
    if (app.layers) app.layers.setOpen(panels.layers);
}
/* The Layers list (core/layers.js) sits above the properties; opening it shows the panel. */
export function setLayers(on = !panels.layers, { focus = false } = {}) {
    if (!app.deck.isOpen) return;
    if (on) { if (app.themeMode) setThemeMode(false); panels.inspector = true; }
    panels.layers = on;
    applyPanels(); rememberPanels();
    if (on && focus) app.layers.focus();
}
function setLayersHeight(h, final) {
    panels.layersH = h == null ? PANEL_DEFAULTS.layersH : Math.round(Math.max(60, Math.min(520, h)));
    applyPanels();
    if (final) rememberPanels();
}
/* Only what the user did is remembered; the narrow-window default is not. */
function rememberPanels() { try { localStorage.setItem(PANEL_KEY, JSON.stringify(panels)); } catch (e) { /* ignore */ } }
export function togglePanel(name, on = !panels[name]) { panels[name] = on; applyPanels(); rememberPanels(); }
$('btnToggleStrip').addEventListener('click', () => togglePanel('strip'));
$('btnTogglePanel').addEventListener('click', () => togglePanel('inspector'));
document.querySelectorAll('.splitter').forEach(sp => {
    const side = sp.dataset.side, key = side + 'W';
    sp.addEventListener('dblclick', () => { panels[key] = PANEL_DEFAULTS[key]; applyPanels(); rememberPanels(); });
    sp.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        sp.setPointerCapture(e.pointerId);
        sp.classList.add('dragging');
        document.body.classList.add('resizing-panels');
        const x0 = e.clientX, w0 = panels[key], [min, max] = PANEL_LIMITS[side];
        const move = (ev) => { const d = side === 'strip' ? ev.clientX - x0 : x0 - ev.clientX; panels[key] = Math.round(Math.max(min, Math.min(max, w0 + d))); applyPanels(); };
        const up = () => { rememberPanels(); sp.classList.remove('dragging'); document.body.classList.remove('resizing-panels'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up); };
        sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up); sp.addEventListener('pointercancel', up);
    });
});
applyPanels();

/* The editor's own look (Ink by default, Clean, Slate): the chrome's colours,
   never the deck's. Remembered per browser; index.html applies it before the first paint. */
const LOOK_KEY = 'deck-editor-look';
const LOOKS = ['ink', 'dark', 'clean', 'slate'];
function applyLook(look) {
    if (!LOOKS.includes(look)) look = 'ink';
    if (look === 'clean') delete document.documentElement.dataset.look; else document.documentElement.dataset.look = look;
    $('lookMenu').querySelectorAll('[data-look]').forEach(b => b.classList.toggle('on', b.dataset.look === look));
    return look;
}
export function setLook(look) { look = applyLook(look); try { localStorage.setItem(LOOK_KEY, look); } catch (e) { /* ignore */ } }

/* Hints: the one-line notes under the fields of the panels. Off by default (what a field does
   is on its tooltip); the ones that report state, not meaning, are shown either way. */
const HINTS_KEY = 'deck-editor-hints';
export function setHints(on) {
    document.documentElement.dataset.hints = on ? 'on' : 'off';
    $('btnHints').classList.toggle('on', on);
    $('btnHintsState').textContent = on ? 'shown' : 'hidden';
    try { localStorage.setItem(HINTS_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
}
/* Spelling: the browser's own checker on the text being edited (and the notes box), only while it
   is edited: textedit.js sets spellcheck on the element then and takes it off again, so the file
   never carries it. On by default, remembered here like the other Look options. */
const SPELL_KEY = 'deck-editor-spell';
export function setSpell(on) {
    app.spellcheck = on;
    $('btnSpell').classList.toggle('on', on);
    $('btnSpellState').textContent = on ? 'on' : 'off';
    const notes = $('inspNotes'); if (notes) notes.spellcheck = on;
    if (app.textEdit) app.textEdit.applySpellcheck();
    try { localStorage.setItem(SPELL_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
}
let savedSpell = null;
try { savedSpell = localStorage.getItem(SPELL_KEY); } catch (e) { /* ignore */ }
let savedHints = null;
try { savedHints = localStorage.getItem(HINTS_KEY); } catch (e) { /* ignore */ }

/* Rulers and the deck's guides. Off by default; the setting is the editor's, the guides are
   the deck's (data-guides on the stage, saved with the file). */
const RULERS_KEY = 'deck-editor-rulers';
export function setRulers(on) {
    app.rulers.setOn(on);
    $('btnRulers').classList.toggle('on', on);
    $('btnRulersState').textContent = on ? 'shown' : 'hidden';
    try { localStorage.setItem(RULERS_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
}
let savedRulers = null;
try { savedRulers = localStorage.getItem(RULERS_KEY); } catch (e) { /* ignore */ }

/* Entrances while editing: off by default, so changing slides shows the slide as it ends up at
   once instead of blinking its content out and fading it back in (see Deck.settleSlide).
   Preview, presenting and the Play buttons animate either way. */
const ENTRANCES_KEY = 'deck-editor-entrances';
export function setEntrances(on) {
    app.deck.playEntrances = on;
    $('btnEntrances').classList.toggle('on', on);
    $('btnEntrancesState').textContent = on ? 'on' : 'off';
    try { localStorage.setItem(ENTRANCES_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
}
let savedEntrances = null;
try { savedEntrances = localStorage.getItem(ENTRANCES_KEY); } catch (e) { /* ignore */ }
let savedLook = null;
try { savedLook = localStorage.getItem(LOOK_KEY); } catch (e) { /* ignore */ }
applyLook(savedLook);
const lookDropdown = $('lookMenu').querySelector('.tb-dropdown');
$('btnLook').addEventListener('click', () => { lookDropdown.hidden = !lookDropdown.hidden; });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#lookMenu')) lookDropdown.hidden = true; }, true);
lookDropdown.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-look]');        // <html> carries data-look too: only the buttons here
    if (b) { setLook(b.dataset.look); lookDropdown.hidden = true; return; }
    if (e.target.closest('[data-opt="hints"]')) setHints(document.documentElement.dataset.hints !== 'on');
    if (e.target.closest('[data-opt="rulers"]')) setRulers(document.documentElement.dataset.rulers !== 'on');
    if (e.target.closest('[data-opt="spell"]')) setSpell(!app.spellcheck);
    if (e.target.closest('[data-opt="entrances"]')) setEntrances(!app.deck.playEntrances);
});
setHints(savedHints === '1');
setSpell(savedSpell !== '0');
setEntrances(savedEntrances === '1');

/* ------------------------------------------------------------
   Opening a deck
   ------------------------------------------------------------ */
/* openDeck brings a deck to the front: its tab if it has one, else a new tab (the deck being
   edited stays open in its own tab, unsaved edits and all). Reloading the live deck itself
   ({draft}, {discard}, {sameSession}) replaces it in place. loadDeck does the loading.
   viaTab: the load is a tab switch, so no "draft restored" toast; version: the disk version
   the deck was opened at, which its draft must keep (so the save conflict check is unchanged);
   noOffer: the deck was open earlier in this session, so no offer of its draft. */
export function openDeck(file, opts = {}) { return tabs.open(file, opts); }

/* The editor shows no deck (the last tab was closed). */
function unloadDeck() {
    clearTimeout(draftTimer); draftTimer = null; draftWritten = false;
    if (app.selection) app.selection.clear();
    document.querySelectorAll('.bar').forEach(b => b.remove());
    app.deck.dispose();
    $('deckFrame').src = 'about:blank';
    app.file = null; app.deckName = '';
    app.history.clear();
    document.body.classList.add('no-deck');
    document.querySelectorAll('[data-needs-deck]').forEach(b => { b.disabled = true; });
    $('fileName').textContent = 'No deck open'; $('fileName').title = '';
    showStatusFolder();
    refreshDirty();
    refreshFiles();                    // the welcome screen's recent decks include the one just closed
    const url = new URL(location.href);
    url.searchParams.delete('file');
    history.replaceState(null, '', url);
    status('');
}

async function loadDeck(file, { draft = false, discard = false, sameSession = false, viaTab = false, version = '', noOffer = false } = {}) {
    if (app.dirty && !draft && !discard && !viaTab && !confirm('Discard unsaved changes and open another deck?')) return false;
    document.querySelectorAll('.bar').forEach(b => b.remove());
    clearTimeout(draftTimer);
    status('Loading ' + file);
    document.body.classList.add('opening');          // the canvas loader, if this takes over 800 ms
    // Reopening the deck in this session (to run its scripts once trusted) keeps the version it
    // was first opened at: its edits are on top of that text, not on top of the file as it is now.
    // (A draft restored from an earlier session gets its version from the server, serve.py served_version.)
    const keepVersion = sameSession && draft && file === app.file && app.deck.isOpen ? app.deck.diskVersion : '';
    try {
        await app.deck.load(file, api.deckUrl(file, { draft }));
    } catch (err) {
        document.body.classList.remove('opening');
        toast(err.message, { error: true, ms: 5000 });
        status('');
        return false;
    }
    if (keepVersion) app.deck.diskVersion = keepVersion;
    else if (version && draft) app.deck.diskVersion = version;
    app.file = file;
    app.history.clear();
    // Before anything can print or export: whether the deck's own scripts run (see offerTrust).
    try { app.deck.trust = await api.trust(file, draft); } catch (err) { app.deck.trust = { trusted: false, scripts: 0, known: [] }; }
    document.body.classList.remove('opening');
    draftWritten = draft;          // a restored draft is on disk until it is saved or discarded
    if (draft) { app.history.forceDirty(); if (!viaTab) toast('Draft restored. Save to write it into the file.', { ms: 3500 }); }
    // After no-deck goes: the strip changes the canvas's height, and the resize it causes must not measure a hidden stage.
    document.body.classList.remove('no-deck');
    deckShown(file, { offer: !draft && !noOffer });
    return true;
}

/* A deck parked in a background tab comes back (tabs.js): the same document, so its history
   comes back too, with its own saved point: undoing to it makes the deck clean again and
   removes the draft written when the tab was left, as for a deck that was never left. */
function resumeDeck(file, parked) {
    document.querySelectorAll('.bar').forEach(b => b.remove());
    clearTimeout(draftTimer); draftTimer = null;
    app.deck.resume(parked.deck);
    app.deck.file = app.file = file;            // the file may have been renamed meanwhile
    draftWritten = parked.draftWritten;
    app.history.resume(parked.history);
    document.body.classList.remove('no-deck');
    // The panels read the deck again; listeners bound to the document are still there.
    app.deck.dispatchEvent(new CustomEvent('ready', { detail: { resumed: true } }));
    deckShown(file);
}

/* What every deck shown in the canvas gets, loaded or back from a background tab. */
function deckShown(file, { offer = false } = {}) {
    tabs.loaded(file);
    document.querySelectorAll('[data-needs-deck]').forEach(b => { b.disabled = false; });
    showDeckName();
    refreshDirty();
    api.recent(file).catch(() => {});
    offerTrust(file);
    if (offer) offerDraft(file);
    const url = new URL(location.href);
    url.searchParams.set('file', file);
    history.replaceState(null, '', url);
    applyZoom();
    status('');
    window.dispatchEvent(new CustomEvent('editor:open', { detail: file }));
}

/* The title bar names the deck (its title, else its folder); the whole path is on hover. */
function showDeckName() {
    app.deckName = deckName(app.file, app.deck.doc ? app.deck.doc.title : '');
    $('fileName').textContent = app.deckName;
    $('fileName').title = app.file.startsWith('@diapo/') ? 'The Diapo tour: a copy of its own, outside your folders'
        : fullPathOf(app.workspace, app.file);
    showStatusFolder();
    refreshDirty();
}
/* The status bar's folder: the folder of decks by its name (the whole path on hover), or, while
   the tour is open, where the tour is (a folder of its own; Save as puts a copy anywhere). The
   drawer and the welcome screen name it the same way. */
function showStatusFolder() {
    const tour = !!app.file && app.file.startsWith('@diapo/');
    $('statusFolder').textContent = tour ? 'Diapo tour, in a folder of its own' : folderName(app.workspace);
    $('statusFolder').title = tour ? 'The tour is a copy of its own, outside your folders. Save as puts a copy anywhere.' : 'Your decks are in ' + app.workspace;
    for (const id of ['drawerFolder', 'homeFolder']) {
        $(id).textContent = folderName(app.workspace);
        $(id).title = app.workspace;
    }
}
/* "C:\Users\me\Talks" -> "Talks"; a drive or the root keeps its whole name. */
export function folderName(p) {
    const parts = String(p || '').split(/[\\/]/).filter(Boolean);
    if (!parts.length) return p || '';
    return parts.length === 1 ? String(p) : parts[parts.length - 1];
}
function fullPathOf(workspace, file) {
    const sep = (workspace || '').includes('\\') ? '\\' : '/';          // the machine's own separator
    return (workspace || '').replace(/[\\/]$/, '') + sep + file.split('/').join(sep);
}

function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ------------------------------------------------------------
   File drawer
   ------------------------------------------------------------ */
let fileList = [];
let recentList = [];

async function refreshFiles() {
    try {
        const s = await api.status();
        app.workspace = s.workspace;
        recentList = s.recent || [];
        showStatusFolder();
        const r = await api.list('');
        fileList = r.files;
    } catch (err) {
        fileList = [];
        toast('Could not list the folder: ' + err.message, { error: true });
    }
    renderRecent();
    renderFiles();
    renderHome();
}

function renderRecent() {
    const box = $('drawerRecent');
    if (!recentList.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="drawer-folder">Recent</div>' + recentList.map(r => {
        const sample = r.file.startsWith('@diapo/');
        const full = sample ? 'The Diapo tour, in a folder of its own' : fullPathOf(r.workspace, r.file);
        const when = r.when ? new Date(r.when * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '';
        const here = sample || r.workspace === app.workspace;
        return `<div class="drawer-file recent${r.file === app.file && here ? ' open' : ''}" data-ws="${escapeHtml(r.workspace)}" data-path="${escapeHtml(r.file)}" title="${escapeHtml(full)}">
            <button type="button" class="drawer-deck">${recentThumb(r)}
            <span class="drawer-text"><span class="name">${escapeHtml(deckName(r.file, r.title))}</span><span class="meta">${escapeHtml(sample ? full : shortPath(full))}${when ? ' | ' + when : ''}</span></span></button>
        </div>`;
    }).join('');
    previews.watch(box);
}
/* The slot a deck's preview fills when its row scrolls into view (none for a deck in another folder). */
function deckThumb(path, mtime) {
    return path ? `<span class="deck-thumb" data-path="${escapeHtml(path)}" data-mtime="${mtime || ''}"></span>` : '<span class="deck-thumb"></span>';
}
/* A recent deck's slot: from the open folder like any deck there; from another folder through
   /recent/<key>/, which serves that deck's own folder read-only (see serve.py). */
function recentThumb(r) {
    const sample = r.file.startsWith('@diapo/');
    if (!sample && r.size > PREVIEW_MAX_BYTES) return deckThumb('', 0);
    if (sample || r.workspace === app.workspace) return deckThumb(r.file, r.mtime || r.when);
    if (!r.key) return deckThumb('', 0);
    const url = '/recent/' + r.key + '/' + r.file.split('/').map(encodeURIComponent).join('/');
    return `<span class="deck-thumb" data-url="${escapeHtml(url)}" data-mtime="${r.mtime || r.when || ''}"></span>`;
}
const previews = new DeckPreviews($('drawer').querySelector('.drawer-body'));
// A single-file export (fonts and pictures inside) is too heavy to fetch for a preview.
const PREVIEW_MAX_BYTES = 3 * 1024 * 1024;

/* "C:\Users\...\talks\index.html" or "/Users/.../talks/index.html": the root and the last folders. */
function shortPath(p) {
    const sep = p.includes('\\') ? '\\' : '/';
    const parts = p.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 4) return p;
    return (sep === '/' ? '/' : parts[0] + sep) + '...' + sep + parts.slice(-3, -1).join(sep);
}

/* When no native dialog can be shown (no tkinter, no zenity), the drawer's folder field and a
   typed path do the job. */
const NO_DIALOG = /no file dialog is available/i;
async function withDialogFallback(run, ask) {
    try { return await run(); }
    catch (err) {
        if (!NO_DIALOG.test(err.message)) throw err;
        const typed = prompt(ask + '\n(No file dialog is available on this computer, so type the full path.)', '');
        return typed && typed.trim() ? { typed: typed.trim() } : { cancelled: true };
    }
}

/* Switch the served folder, then list it. */
async function switchWorkspace(path) {
    try {
        await tabs.beforeWorkspaceChange();         // the live deck's draft can only be written in its own workspace
        const r = await api.setWorkspace(path);
        app.workspace = r.workspace;
        await refreshFiles();
        return true;
    } catch (err) { toast(err.message, { error: true }); return false; }
}

/* The folder list is grouped by where the decks live: the folder's own first, then each
   subfolder, the one with the newest deck first; newest first within a group. A deck kept as
   <name>/index.html is that folder, so it lives in the folder above (with the copies Previous
   versions puts beside it). Subfolders fold away, remembered per folder and browser. HTML files
   that are not decks are left out unless asked for. */
const DRAWER_KEY = 'deck-editor-drawer';
const drawerPrefs = { other: false, folded: {} };
try { Object.assign(drawerPrefs, JSON.parse(localStorage.getItem(DRAWER_KEY) || '{}')); } catch (e) { /* ignore */ }
function rememberDrawer() { try { localStorage.setItem(DRAWER_KEY, JSON.stringify(drawerPrefs)); } catch (e) { /* ignore */ } }
function foldedHere() { return new Set(drawerPrefs.folded[app.workspace] || []); }
function toggleFold(dir) {
    const folded = foldedHere();
    if (folded.has(dir)) folded.delete(dir); else folded.add(dir);
    if (folded.size) drawerPrefs.folded[app.workspace] = [...folded]; else delete drawerPrefs.folded[app.workspace];
    rememberDrawer();
    renderFiles();
}

function dirOf(p) { return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; }
function groupFiles(files) {
    const deckDirs = new Set(files.filter(f => f.name.toLowerCase() === 'index.html').map(f => dirOf(f.path)).filter(Boolean));
    const groups = new Map();
    for (const f of [...files].sort((a, b) => b.mtime - a.mtime)) {
        const dir = dirOf(f.path);
        const home = deckDirs.has(dir) ? dirOf(dir) : dir;
        if (!groups.has(home)) groups.set(home, []);
        groups.get(home).push(f);
    }
    return [...groups].sort(([a, fa], [b, fb]) => (a === '' ? -1 : b === '' ? 1 : fb[0].mtime - fa[0].mtime));
}

function fileRow(f, home) {
    const when = new Date(f.mtime * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    const where = home ? f.path.slice(home.length + 1) : f.path;
    const other = f.deck === false;
    return `<div class="drawer-file${other ? ' other' : ''}${f.path === app.file ? ' open' : ''}" data-path="${escapeHtml(f.path)}" title="${escapeHtml(f.path)}${other ? ' (not a deck: no .deck-stage)' : ''}">
        <button type="button" class="drawer-deck">${deckThumb(!other && f.size <= PREVIEW_MAX_BYTES ? f.path : '', f.mtime)}
        <span class="drawer-text"><span class="name">${escapeHtml(deckName(f.path, f.title))}</span><span class="meta">${other ? 'Not a deck | ' : ''}${escapeHtml(where)} | ${when} | ${(f.size / 1024).toFixed(0)} KB</span></span></button>
        <div class="acts"><button type="button" data-act="rename">Rename</button><button type="button" data-act="dup">Duplicate</button></div>
    </div>`;
}

function renderFiles() {
    const filter = $('drawerFilter').value.trim().toLowerCase();
    const others = fileList.filter(f => f.deck === false).length;
    const shown = drawerPrefs.other ? fileList : fileList.filter(f => f.deck !== false);
    const items = shown.filter(f => !filter || (f.path + ' ' + (f.title || '')).toLowerCase().includes(filter));
    const list = $('drawerList');
    const otherToggle = others ? `<button type="button" class="drawer-other" data-other>${drawerPrefs.other ? 'Hide' : 'Show'} ${others} other HTML file${others === 1 ? '' : 's'}</button>` : '';
    if (!items.length) {
        const empty = shown.length ? 'No deck matches the filter.' : 'No decks in this folder yet. New makes one here; Change folder looks elsewhere.';
        list.innerHTML = `<div class="drawer-empty">${empty}</div>${otherToggle}`;
        return;
    }
    const folded = filter ? new Set() : foldedHere();            // a filter shows every match
    let html = '';
    for (const [home, files] of groupFiles(items)) {
        if (!home) html += '<div class="drawer-folder">In this folder</div>';
        else if (filter) html += `<div class="drawer-folder drawer-subfolder" title="${escapeHtml(home)}"><span class="fold-name">${escapeHtml(home.split('/').join(' / '))}</span><span class="fold-count">${files.length}</span></div>`;
        else {
            const open = !folded.has(home);
            html += `<button type="button" class="drawer-folder drawer-subfolder" data-fold="${escapeHtml(home)}" aria-expanded="${open}" title="${escapeHtml(home)}">
                <span class="fold-mark" aria-hidden="true">${open ? '&#9662;' : '&#9656;'}</span><span class="fold-name">${escapeHtml(home.split('/').join(' / '))}</span><span class="fold-count">${files.length}</span></button>`;
            if (!open) continue;
        }
        html += files.map(f => fileRow(f, home)).join('');
    }
    list.innerHTML = html + otherToggle;
    previews.watch(list);
}

/* The drawer is the deck list while a deck is open (Ctrl+O, File > Open...). With no deck open
   the welcome screen is the home and the drawer stays closed until asked for. */
function showDrawer(on) {
    if (on) { showFileMenu(false); if (app.gallery) app.gallery.close(); }
    $('drawer').hidden = !on;
    if (on) { refreshFiles(); $('drawerFilter').focus(); }
}

/* A recent deck: its folder becomes the current one first (the tour opens from any folder). */
async function openRecent(ws, path) {
    const sample = path.startsWith('@diapo/');
    if (!sample && ws !== app.workspace && !(await switchWorkspace(ws))) return;
    if (await openDeck(path)) showDrawer(false);
}
$('drawerRecent').addEventListener('click', async (e) => {
    const row = e.target.closest('.drawer-file'); if (!row) return;
    await openRecent(row.dataset.ws, row.dataset.path);
});

/* Open a deck file anywhere on this computer (the system's dialog); its folder becomes the current one. */
async function pickDeckFile() {
    try {
        let r = await withDialogFallback(() => api.pickFile(), 'Full path of the deck (.html) to open:');
        if (r.cancelled) return;
        if (r.typed) {
            const p = r.typed.replace(/[\\/][^\\/]+$/, ''), name = r.typed.slice(p.length + 1);
            if (!(await switchWorkspace(p))) return;
            r = { workspace: app.workspace, file: name };
        }
        app.workspace = r.workspace;
        await refreshFiles();
        if (await openDeck(r.file)) showDrawer(false);
    } catch (err) { toast(err.message, { error: true, ms: 5000 }); }
}
/* Change folder: the system's folder dialog, or a typed path where there is none. */
async function changeFolder() {
    try {
        const r = await withDialogFallback(() => api.pickWorkspace(), 'Full path of the folder that holds your decks:');
        if (r.cancelled) return;
        if (r.typed) { await switchWorkspace(r.typed); return; }
        app.workspace = r.workspace;
        await refreshFiles();
    } catch (err) { toast(err.message, { error: true, ms: 5000 }); }
}
$('btnPickFile').addEventListener('click', pickDeckFile);
$('btnPickFolder').addEventListener('click', changeFolder);

/* Rename and Duplicate: from a deck's row in the drawer, or from the File menu for the open deck. */
async function renameDeck(path) {
    const name = prompt('New file name:', path.split('/').pop());
    if (!name || name === path.split('/').pop()) return;
    try {
        const r = await api.rename(path, name);
        tabs.renamed(path, r.file);
        if (app.file === path) { app.file = r.file; app.deck.file = r.file; showDeckName(); const u = new URL(location.href); u.searchParams.set('file', r.file); history.replaceState(null, '', u); }
        toast('Renamed to ' + r.file);
        refreshFiles();
    } catch (err) { toast(err.message, { error: true }); }
}
async function duplicateDeck(path) {
    const base = path.split('/').pop().replace(/\.html$/i, '');
    const name = prompt('Name for the copy:', base + ' copy.html');
    if (!name) return;
    try { const r = await api.duplicate(path, name); toast('Created ' + r.file); refreshFiles(); }
    catch (err) { toast(err.message, { error: true }); }
}

$('drawerList').addEventListener('click', async (e) => {
    const fold = e.target.closest('[data-fold]');
    if (fold) { toggleFold(fold.dataset.fold); $('drawerList').querySelector(`[data-fold="${CSS.escape(fold.dataset.fold)}"]`)?.focus(); return; }
    if (e.target.closest('[data-other]')) { drawerPrefs.other = !drawerPrefs.other; rememberDrawer(); renderFiles(); $('drawerList').querySelector('[data-other]')?.focus(); return; }
    const row = e.target.closest('.drawer-file'); if (!row) return;
    const path = row.dataset.path;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'rename') return renameDeck(path);
    if (act === 'dup') return duplicateDeck(path);
    if (row.classList.contains('other')) { toast(path.split('/').pop() + ' is a web page, not a deck: Diapo opens decks built on its slide stage.', { ms: 5000 }); return; }
    if (await openDeck(path)) showDrawer(false);
});

/* ------------------------------------------------------------
   Welcome screen: the home while no deck is open. The actions,
   the folder by name, the recent decks and the newest decks of
   the folder, each with the picture of its first slide.
   ------------------------------------------------------------ */
const HOME_DECKS = 8;
const homePreviews = new DeckPreviews($('canvasEmpty'));
function homeCard({ ws = '', path, title, when, here, full, thumb }) {
    const date = when ? new Date(when * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
    const where = path.startsWith('@diapo/') ? 'Diapo tour' : here || ws === app.workspace ? '' : folderName(ws);
    return `<button type="button" class="home-deck" data-ws="${escapeHtml(ws)}" data-path="${escapeHtml(path)}" title="${escapeHtml(full)}">
        ${thumb || deckThumb(here ? path : '', when)}
        <span class="name">${escapeHtml(deckName(path, title))}</span>
        <span class="meta">${escapeHtml([where, date].filter(Boolean).join(' | '))}</span></button>`;
}
function renderHome() {
    const recent = recentList.slice(0, HOME_DECKS).map(r => {
        const sample = r.file.startsWith('@diapo/');
        const here = sample || r.workspace === app.workspace;
        return homeCard({ ws: r.workspace, path: r.file, title: r.title, when: r.when, here, thumb: recentThumb(r), full: sample ? 'The Diapo tour, in a folder of its own' : fullPathOf(r.workspace, r.file) });
    });
    $('homeRecent').innerHTML = recent.length ? `<h2>Recent</h2><div class="home-grid">${recent.join('')}</div>` : '';
    // The folder's own decks, newest first, without the ones Recent already shows.
    const seen = new Set(recentList.filter(r => r.workspace === app.workspace).map(r => r.file));
    const decks = fileList.filter(f => f.deck !== false && !seen.has(f.path)).sort((a, b) => b.mtime - a.mtime);
    const all = fileList.filter(f => f.deck !== false).length;
    const cards = decks.slice(0, HOME_DECKS).map(f => homeCard({ ws: app.workspace, path: f.path, title: f.title, when: f.mtime, here: f.size <= PREVIEW_MAX_BYTES, full: fullPathOf(app.workspace, f.path) }));
    const more = all > cards.length + seen.size || all > HOME_DECKS ? `<button type="button" class="link-btn" id="btnHomeAll">All ${all} decks in this folder...</button>` : '';
    $('homeDecks').innerHTML = `<h2>In ${escapeHtml(folderName(app.workspace))}</h2>`
        + (cards.length ? `<div class="home-grid">${cards.join('')}</div>${more}`
            : all ? more || '<p class="home-empty">Every deck in this folder is under Recent.</p>'
                : '<p class="home-empty">No decks in this folder yet. New deck makes one here; Import turns a PowerPoint or Markdown file into one.</p>');
    homePreviews.watch($('canvasEmpty'));
}
$('canvasEmpty').addEventListener('click', async (e) => {
    if (e.target.closest('#btnHomeAll')) { showDrawer(true); return; }
    const card = e.target.closest('.home-deck'); if (!card) return;
    await openRecent(card.dataset.ws || app.workspace, card.dataset.path);
});

/* New deck: the gallery of designs (core/gallery.js). The deck is created as
   <folder>/<name>/index.html inside the current folder; to create it somewhere
   else, change the folder first. */
let templateList = [];
async function fetchTemplates() {
    if (!templateList.length) templateList = (await fetch('/templates/templates.json', { cache: 'no-store' }).then(r => r.json())).templates || [];
    return templateList;
}
fetchTemplates().catch(() => {});          // the palette lists them without waiting
app.gallery = new TemplateGallery($('gallery'), {
    templates: fetchTemplates,
    folder: () => ({ name: folderName(app.workspace), path: app.workspace }),
    create: async (name, slug) => {
        if (/[\\/:*?"<>|]/.test(name)) { toast('Type a name, not a path. Change folder (File menu) chooses where decks live.', { error: true, ms: 4500 }); return false; }
        try {
            const r = await api.newDeck(name + '/index.html', slug === 'blank' ? '' : slug);
            toast('Created ' + deckName(r.file, '') + ' in ' + folderName(app.workspace));
            if (await openDeck(r.file)) showDrawer(false);
            return true;
        } catch (err) { toast(err.message, { error: true }); return false; }
    },
});
/* The gallery, opened with one design chosen (from the palette) or with the last choice. */
export function newDeck(slug = '') {
    showFileMenu(false);
    $('drawer').hidden = true;
    app.gallery.open(slug);
}
$('btnNewDeck').addEventListener('click', () => newDeck());

/* Import: a native dialog on this machine picks a .md or .pptx; the server converts it into
   <name>/index.html in the current folder and the deck opens. Picking and converting are two
   calls, so the loader shows for the conversion only, not while the dialog is open. */
async function importDeck() {
    try {
        const pick = await withDialogFallback(() => api.importPick(), 'Full path of the Markdown (.md) or PowerPoint (.pptx) file to import:');
        if (pick.cancelled) return;
        const src = pick.typed || pick.path;
        status('Importing ' + src.split(/[\\/]/).pop() + '...', { busy: true });
        const r = await api.importPath(src);
        status('');
        await afterImport(r);
    } catch (err) { status(''); toast('Import failed: ' + err.message, { error: true, ms: 7000 }); }
}
$('btnImport').addEventListener('click', importDeck);
/* An imported deck: say what the import noted, list it, open it in a tab of its own. */
async function afterImport(r) {
    const notes = r.notes && r.notes.length ? ' | ' + r.notes.slice(0, 3).join(' | ') + (r.notes.length > 3 ? ` | +${r.notes.length - 3} more` : '') : '';
    toast(`Imported ${r.source} as ${r.file}${notes}`, { ms: notes ? 9000 : 4000 });
    await refreshFiles();
    if (await openDeck(r.file)) showDrawer(false);
}
/* A PowerPoint or Markdown file dragged into the window (core/filedrop.js): asked first, then
   sent to the server as the drawer's Import does (the file itself, uploaded: a dropped file has
   no path the page may know). The deck being edited stays open in its own tab. */
async function importDroppedDecks(files) {
    const names = files.map(f => f.name);
    const ask = files.length === 1 ? `Import "${names[0]}" as a new deck?` : `Import ${files.length} files as new decks?\n\n${names.join('\n')}`;
    if (!confirm(ask)) return;
    for (const f of files) {
        try {
            status('Importing ' + f.name + '...', { busy: true });
            const r = await api.importFile(f);
            status('');
            await afterImport(r);
        } catch (err) { status(''); toast(`Could not import ${f.name}: ${err.message}`, { error: true, ms: 7000 }); }
    }
}

/* The File menu: making, opening and keeping decks, and the folder they live in. What needs an
   open deck is off without one; the tour has no file of yours to rename or duplicate. */
function showFileMenu(on) {
    const dd = $('fileMenu').querySelector('.tb-dropdown');
    dd.hidden = !on;
    $('btnFile').setAttribute('aria-expanded', String(on));
    if (!on) return;
    const open = app.deck.isOpen && !!app.file, tour = open && app.file.startsWith('@diapo/');
    for (const b of dd.querySelectorAll('[data-f]')) {
        const needs = ['save', 'saveas', 'versions'].includes(b.dataset.f) ? open : ['rename', 'duplicate'].includes(b.dataset.f) ? open && !tour : true;
        b.disabled = !needs;
    }
    $('fileFolder').textContent = 'Folder: ' + folderName(app.workspace);
    $('fileFolder').title = app.workspace;
}
$('btnFile').addEventListener('click', () => showFileMenu($('fileMenu').querySelector('.tb-dropdown').hidden));
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#fileMenu')) showFileMenu(false); }, true);
$('fileMenu').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]'); if (!b || b.disabled) return;
    showFileMenu(false);
    switch (b.dataset.f) {
        case 'new': newDeck(); break;
        case 'open': showDrawer(true); break;
        case 'openfile': await pickDeckFile(); break;
        case 'import': await importDeck(); break;
        case 'save': await saveDeck(); break;
        case 'saveas': await saveDeckAs(); break;
        case 'versions': await showVersions(); break;
        case 'rename': await renameDeck(app.file); break;
        case 'duplicate': await duplicateDeck(app.file); break;
        case 'folder': await changeFolder(); break;
    }
});
$('btnEmptyNew').addEventListener('click', () => newDeck());
$('btnEmptyOpen').addEventListener('click', pickDeckFile);
$('btnEmptyImport').addEventListener('click', importDeck);
$('btnHomeFolder').addEventListener('click', changeFolder);
/* The sample deck: the tour of the editor (app/templates/welcome.html) copied to welcome/index.html
   in the current folder (reused when it is already there). */
export async function openSampleDeck() {
    const file = '@diapo/welcome/index.html';   // the samples folder beside the settings file, not the user's workspace
    try {
        // New writes the tour, or replaces an older edition of it (the server answers 409 when the
        // file is already the current tour, edited or not, and that one is opened as it is).
        let made = null;
        try { made = await api.newDeck(file, 'welcome'); await refreshFiles(); } catch (err) { if (err.status !== 409) throw err; }
        if (await openDeck(file)) {
            showDrawer(false);
            if (made && made.refreshed) toast('The tour is brought up to date with this Diapo; your earlier copy is under File > Previous versions.', { ms: 6000 });
            else if (made) toast('The sample deck has a folder of its own, outside your decks. Edit it freely; Save as puts a copy anywhere.', { ms: 6000 });
        }
    } catch (err) { toast('Could not create the sample deck: ' + err.message, { error: true, ms: 6000 }); }
}
$('btnEmptySample').addEventListener('click', openSampleDeck);
$('btnCloseDrawer').addEventListener('click', () => showDrawer(false));
$('btnRefresh').addEventListener('click', refreshFiles);
$('drawerFilter').addEventListener('input', renderFiles);
$('drawer').querySelector('.drawer-backdrop').addEventListener('click', (e) => {
    showDrawer(false);
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = under && under.closest('button, a[href], [role="button"]');
    if (target && !target.disabled) target.click();
});

/* ------------------------------------------------------------
   Preview mode: the deck fills the window and runs as itself.
   ------------------------------------------------------------ */
export function setPreview(on) {
    if (!app.deck.isOpen) return;
    app.preview = on;
    document.body.classList.toggle('preview', on);
    let hint = document.querySelector('.preview-hint');
    if (on) {
        if (!hint) { hint = document.createElement('div'); hint.className = 'preview-hint'; hint.textContent = 'Preview | Esc to return to the editor' + (app.deck.win.deckRuntime ? ' | ? for keys' : ''); document.body.appendChild(hint); }   // the "?" list is the deck runtime's: no script, no list
        hint.classList.remove('fade');
        setTimeout(() => hint.classList.add('fade'), 2500);
        app.zoomMode = 'fit';
    } else {
        if (hint) hint.remove();
        try { app.deck.win.deckRuntime.closeKeys(); } catch (e) { /* no runtime, or an older one */ }   // the list is not part of the deck being edited
    }
    app.deck.setEditing(!on);
    applyZoom();
    if (on) app.deck.iframe.focus();
    window.dispatchEvent(new CustomEvent('editor:preview', { detail: on }));
}
$('btnPreview').addEventListener('click', () => setPreview(true));

/* ------------------------------------------------------------
   Help overlay
   ------------------------------------------------------------ */
const KEYS = [
    ['Files', [['Ctrl+O', 'Open the deck list (File menu: New deck, Import, Change folder)'], ['Ctrl+S', 'Save'], ['Ctrl+Shift+S', 'Save as: a new name or folder, with the deck\'s files copied along'], ['Ctrl+P', 'Export as PDF (Export menu: single HTML file, PowerPoint)'], ['Ctrl+T', 'Theme panel (colours, fonts, base styles)'], ['F5', 'Preview'], ['P / Shift+F5', 'Presenter view (second window)'], ['Esc', 'Leave preview, close dialogs, deselect']]],
    ['Slides', [['PgUp / PgDn', 'Previous / next slide'], ['Home / End', 'First / last slide'], ['Ctrl+M', 'New slide (layout picker; Ctrl+Shift+M: blank)'], ['Ctrl+D', 'Duplicate (slide or selection)'], ['Ctrl+Up / Down', 'Move the slide, or the picked slides, up / down'], ['Ctrl+click / Shift+click a thumbnail', 'Pick several slides; drag one of them to move them all'], ['Shift+Up / Down (strip)', 'Pick one more or one fewer slide (Esc: none)']]],
    ['Canvas', [['Click', 'Select'], ['Shift+click', 'Add to the selection'], ['Ctrl+click', 'Select the exact element under the cursor (a plain drag then moves just that)'], ['Alt+drag', 'Duplicate what you drag'], ['Ctrl while dragging', 'Disable snapping'], ['Shift / Alt while resizing', 'Keep the aspect ratio (corners) / resize about the centre; both together, both'], ['Right-click', 'Element menu'], ['Drag on empty space', 'Marquee select'], ['Double-click / Enter', 'Edit text (Esc when done; Ctrl+B / I / U, Ctrl+Shift+X strike, Ctrl+Shift+= superscript, Ctrl+= subscript, Alt+= an equation in the text while editing)'], ['Arrows', 'Nudge 1px (Shift: 10px)'], ['Delete', 'Delete the selection (Hide is in the panel and the menu)'], ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste, also across slides; images and text from elsewhere paste too'], ['Ctrl+Alt+C / Ctrl+Alt+V', 'Copy the look of an element (colours, border, type, padding) / put it on the selection'], ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'], ['Ctrl+] / Ctrl+[', 'Bring forward / send backward (Shift: to front / to back)'], ['Tab', 'Next sibling'], ['Ctrl+Shift+L', 'Layers: the slide\'s elements front to back above the panel (click, Ctrl+click, Shift+click select; drag a row to restack; eye hides, lock locks; double-click or F2 renames; arrows, Enter and Delete work in it)'], ['Ctrl+F / Ctrl+H', 'Find / find and replace across the deck (Enter / Shift+Enter: next / previous match; Esc closes)'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl++ / Ctrl+- / Ctrl+0', 'Zoom in / out / fit'], ['Space+drag, middle button, wheel', 'Pan when zoomed in (the middle button grabs the view)'], ['Ctrl+\\', 'Hide / show both side panels (drag their edges to resize)']]],
];
/* The "?" dialog: the keyboard map, and a tab "About Diapo" (version, checking for a new
   release, links). tab: 'keys' or 'about'. The shortcuts stay one keypress away: the dialog
   opens on the keyboard tab, and the tab strip is two plain buttons. */
let helpTab = 'keys';
function showHelp(on, tab) {
    let h = document.querySelector('.help:not(.versions)');
    if (!on) { if (h) h.remove(); return; }
    if (h && !tab) return;
    if (h) h.remove();
    helpTab = tab || 'keys';
    h = document.createElement('div');
    h.className = 'help';
    h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', helpTab === 'about' ? 'About Diapo' : 'Keyboard shortcuts');
    const keys = KEYS.map(([title, rows]) => `<h3>${title}</h3><table>${rows.map(([k, d]) => `<tr><td>${k.split(' / ').map(x => x.split(/\+(?=.)/).map(y => `<kbd>${y}</kbd>`).join('+')).join(' / ')}</td><td>${d}</td></tr>`).join('')}</table>`).join('');
    h.innerHTML = `<div class="help-card">
        <div class="help-tabs" role="tablist"><button role="tab" data-tab="keys" class="${helpTab === 'keys' ? 'on' : ''}" aria-selected="${helpTab === 'keys'}">Keyboard</button><button role="tab" data-tab="about" class="${helpTab === 'about' ? 'on' : ''}" aria-selected="${helpTab === 'about'}">About Diapo</button></div>
        <div id="helpKeys" ${helpTab === 'keys' ? '' : 'hidden'}><h2>Keyboard</h2>${keys}</div>
        <div id="helpAbout" ${helpTab === 'about' ? '' : 'hidden'}>${aboutHtml()}</div></div>`;
    h.addEventListener('click', (e) => {
        if (e.target === h) { showHelp(false); return; }
        const t = e.target.closest('[data-tab]');
        if (t) { showHelp(true, t.dataset.tab); return; }
        const l = e.target.closest('[data-link]');
        if (l) { openLink(l.dataset.link); return; }
        if (e.target.closest('#aboutCheck')) checkForUpdates();
        const g = e.target.closest('#aboutGet');
        if (g) openLink('release', g.dataset.tag);
    });
    h.addEventListener('change', async (e) => {
        if (e.target.id !== 'aboutAuto') return;
        try { app.updateAuto = (await api.updateAuto(e.target.checked)).update_auto; }
        catch (err) { e.target.checked = !e.target.checked; toast('Could not save that setting: ' + err.message, { error: true }); }
    });
    document.body.appendChild(h);
    if (helpTab === 'about') showUpdateResult();
}

/* ------------------------------------------------------------
   About Diapo and updates. The only time Diapo goes online on its own account is a click on
   "Check for updates" (the server asks GitHub for the latest release), or, when the user
   switched it on, once a day at start.
   ------------------------------------------------------------ */
app.version = ''; app.released = ''; app.updateAuto = false;
app.updateResult = null;                     // the last answer: {current, latest, newer, url, published, notes}, {busy} or {error}
const niceDate = (iso) => { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); };
const openLink = (page, tag = '') => api.openLink(page, tag).catch(err => toast('Could not open the browser: ' + err.message, { error: true }));

function aboutHtml() {
    return `<h2>Diapo ${escapeHtml(app.version || '')}</h2>
        <p class="muted">${app.released ? 'Released ' + escapeHtml(niceDate(app.released)) + '. ' : ''}Slides that are plain HTML files, edited on your own computer.</p>
        <div class="row about-row"><button class="tb-btn" id="aboutCheck">Check for updates</button><span class="spacer"></span>
            <button class="mini-btn" data-link="guide">Guide</button><button class="mini-btn" data-link="changelog">Changelog</button></div>
        <div id="aboutResult" class="about-result" role="status" aria-live="polite"></div>
        <label class="about-auto"><input type="checkbox" id="aboutAuto" ${app.updateAuto ? 'checked' : ''}> Check for updates when Diapo starts</label>
        <p class="muted about-note">Off by default. Diapo asks GitHub for the latest release and sends nothing about you or your decks. A click on the button does the same, once.</p>`;
}

/* Fills the result area of the About tab from app.updateResult. */
function showUpdateResult() {
    const box = document.getElementById('aboutResult');
    const r = app.updateResult;
    if (!box || !r) return;
    if (r.busy) { box.innerHTML = '<p>Checking...</p>'; return; }
    if (r.error) { box.innerHTML = `<p class="about-bad">${escapeHtml(r.error)}</p>`; return; }
    if (!r.latest) { box.innerHTML = `<p>No release has been published yet, so there is nothing newer than ${escapeHtml(r.current)}.</p>`; return; }
    if (!r.newer) { box.innerHTML = `<p class="about-good">You have the latest version (${escapeHtml(r.current)}).</p>`; return; }
    const notes = r.notes ? `<pre class="about-notes">${escapeHtml(r.notes.length > 500 ? r.notes.slice(0, 500).replace(/\s+\S*$/, '') + '...' : r.notes)}</pre>` : '';
    box.innerHTML = `<p class="about-good"><b>Diapo ${escapeHtml(r.latest)} is available</b>${r.published ? ' (released ' + escapeHtml(niceDate(r.published)) + ')' : ''}. You have ${escapeHtml(r.current)}.</p>${notes}
        <div class="row"><button class="tb-btn primary" id="aboutGet" data-tag="${escapeHtml(r.latest)}">Open the release page</button></div>
        <p class="muted about-note">To update: with the Windows program, download the new <code>diapo.exe</code> from that page and use it in place of the old one. With a copy of the repository, run <code>git pull</code>, or download the ZIP again. Your decks are not touched either way.</p>`;
}

async function checkForUpdates() {
    app.updateResult = { busy: true };
    showUpdateResult();
    try { app.updateResult = await api.updateCheck(); }
    catch (err) { app.updateResult = { error: err.message }; }
    showUpdateResult();
    if (app.updateResult.newer) document.querySelector('.update-notice')?.remove();
}

/* A small notice that blocks nothing; it leads to the About tab. */
function showUpdateNotice(latest) {
    if (document.querySelector('.update-notice')) return;
    const n = document.createElement('div');
    n.className = 'update-notice'; n.setAttribute('role', 'status');
    n.innerHTML = `<span>Diapo ${escapeHtml(latest)} is available.</span><button class="mini-btn" data-a="see">See what's new</button><button class="mini-btn" data-a="x" aria-label="Dismiss" title="Dismiss">&times;</button>`;
    n.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]'); if (!a) return;
        n.remove();
        if (a.dataset.a === 'see') showHelp(true, 'about');
    });
    document.body.appendChild(n);
}

/* The start-up check, when the user turned it on; the server decides whether a day has passed. */
async function autoUpdateCheck() {
    if (!app.updateAuto) return;
    try {
        const r = await api.updateCheck({ auto: true });
        if (r.skipped) return;
        app.updateResult = r;
        if (r.newer) showUpdateNotice(r.latest);
    } catch (err) { /* quiet: the user did not ask for this one */ }
}
$('btnHelp').addEventListener('click', () => showHelp(true, 'keys'));

/* Previous versions of the open deck (the backups the save keeps): each with its time, title
   and slide count; "Open a copy" puts the version beside the deck as its own file and opens
   it, "Restore" makes it the deck again (the current file becomes the newest backup). */
async function showVersions() {
    if (!app.deck.isOpen || !app.file) return;
    document.querySelectorAll('.help.versions').forEach(h => h.remove());
    let list;
    try { list = (await api.versions(app.file)).versions; } catch (err) { toast('Could not list the versions: ' + err.message, { error: true }); return; }
    const h = document.createElement('div');
    h.className = 'help versions';
    h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', 'Previous versions');
    const when = (t) => { const d = new Date(t * 1000), now = new Date(); const sameDay = d.toDateString() === now.toDateString(); return (sameDay ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
    const kb = (n) => n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
    h.innerHTML = `<div class="help-card versions-card">
        <h2>Previous versions</h2>
        <p>What the deck was before each of the last ${list.length} saves (each save keeps the version it replaces, in a hidden folder beside the deck). Restoring keeps the current version as the newest of these.</p>
        ${list.length ? `<table>${list.map((v, i) => `<tr data-v="${escapeHtml(v.version)}">
            <td><b>${when(v.mtime)}</b>${i === 0 ? ' <span class="muted">(before the last save)</span>' : ''}</td>
            <td>${escapeHtml(v.title || '(untitled)')} · ${v.slides} slide${v.slides === 1 ? '' : 's'} · ${kb(v.bytes)}</td>
            <td class="acts"><button class="mini-btn" data-a="copy" title="Put this version beside the deck as its own file, and open it">Open a copy</button><button class="mini-btn" data-a="restore" title="Make this version the deck again">Restore</button></td>
        </tr>`).join('')}</table>` : '<p class="muted">No previous version yet: they appear from the first save that replaces an earlier file.</p>'}
        <div class="row"><span class="spacer"></span><button class="tb-btn" id="verClose">Close</button></div>
    </div>`;
    h.addEventListener('click', async (e) => {
        if (e.target === h || e.target.id === 'verClose') { h.remove(); return; }
        const b = e.target.closest('[data-a]'); if (!b) return;
        const version = b.closest('tr').dataset.v;
        try {
            if (b.dataset.a === 'copy') {
                const r = await api.copyVersion(app.file, version);
                h.remove();
                await refreshFiles();
                if (await openDeck(r.file)) toast('Opened a copy of that version: ' + r.file, { ms: 4000 });
            } else {
                if (app.dirty && !confirm('The deck has unsaved changes; restoring replaces them with that version. Restore?')) return;
                const r = await api.restoreVersion(app.file, version);
                h.remove();
                await api.draftDelete(app.file).catch(() => {});
                if (await openDeck(r.file, { discard: true })) toast('Restored that version; the one before is now the newest previous version.', { ms: 4000 });
            }
        } catch (err) { toast('Could not do that: ' + err.message, { error: true, ms: 5000 }); }
    });
    document.body.appendChild(h);
}

/* ------------------------------------------------------------
   Keyboard map. Listens in the editor document and in the deck's
   document (the iframe has focus while editing text or previewing).
   ------------------------------------------------------------ */
const CONTROL_KEYS = new Set(['Enter', ' ', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown']);
function onKey(e) {
    if (editorAuto && e.key !== 'a' && e.key !== 'A') { clearTimeout(editorAuto); editorAuto = null; status(''); }
    // Duck-typed: elements inside the iframe are not instances of this window's Element.
    const t = e.target && typeof e.target.matches === 'function' ? e.target : null;
    const typing = !!t && (t.matches('input, select, textarea, .insp-code-pre') || t.isContentEditable);   // the Code section's read-only cells take Ctrl+A and copy themselves
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    // Crop mode has the keys: Enter and Esc end it, arrows move the picture.
    if (app.cropper && app.cropper.active && !typing && app.cropper.handleKey(e)) return stop(e);

    if (k === 'Escape') {
        if (app.layers && app.layers.endRename(false)) return stop(e);   // a name being typed in the Layers list
        if (app.layers && app.layers.cancelDrag()) return stop(e);
        if (app.palette && app.palette.open) { app.palette.close(); return stop(e); }
        if (app.inlineMath && app.inlineMath.isOpen) { app.inlineMath.close(); return stop(e); }   // the text edit goes on, as it was
        if (app.find && app.find.open) { app.find.close(); return stop(e); }
        if (app.fontPicker && app.fontPicker.isOpen) { app.fontPicker.close(); return stop(e); }
        if (app.iconPicker && app.iconPicker.isOpen) { app.iconPicker.close(); return stop(e); }
        if (app.preview) { setPreview(false); return stop(e); }
        if (app.textEdit.active) { app.textEdit.commit(); return stop(e); }
        if (document.querySelector('.help')) { document.querySelector('.help').remove(); return stop(e); }
        if (app.gallery.isOpen) { app.gallery.close(); return stop(e); }
        if (!$('fileMenu').querySelector('.tb-dropdown').hidden) { showFileMenu(false); $('btnFile').focus(); return stop(e); }
        if (!$('drawer').hidden) { showDrawer(false); return stop(e); }
        if (app.strip.picker) { app.strip.closeLayoutPicker(); return stop(e); }
        if (app.strip.closeMenu()) return stop(e);                     // a thumbnail's menu, or Move to...
        if (app.themeMode) { if (typing && t.closest('#themeBody')) t.blur(); else setThemeMode(false); return stop(e); }
        if (document.querySelector('.el-menu')) { closeElementMenu(); return stop(e); }
        if (typing && t.closest('#inspMath, #inspChem, #inspPlot')) { t.blur(); return stop(e); }   // out of the LaTeX / SMILES, the figure still selected
        if (app.selection.handleKey(e)) return stop(e);
        if (!typing && app.strip.isContext() && app.strip.clearPick()) return stop(e);   // the strip: back to the current slide alone
        return;
    }
    // A while previewing: the deck's own script does it when the deck carries a current one (its
    // own listener runs). A deck with an older script, or none, gets a slide-by-slide run from
    // the editor instead, and is told how to have the real thing.
    if (app.preview && (k === 'a' || k === 'A') && !ctrl && !e.altKey) {
        const rt = app.deck.win && app.deck.win.deckRuntime;
        if (rt && rt.setAuto) return;
        stop(e);
        toggleEditorAuto(runtimeState());
        return;
    }
    if (app.preview) return;                                       // the deck owns the keys in preview
    if (app.fontPicker && app.fontPicker.isOpen && !ctrl) return;  // the font picker owns arrows and Enter
    if (app.iconPicker && app.iconPicker.isOpen && !ctrl) return;  // so does the icon picker
    if (app.gallery.isOpen && !ctrl) return;                       // and the New deck gallery (its cards, its name field)
    if (ctrl && k.toLowerCase() === 'k') { stop(e); if (app.gallery.isOpen) app.gallery.close(); app.palette.toggle(); return; }
    if (ctrl && e.shiftKey && !e.altKey && k.toLowerCase() === 'l') { stop(e); setLayers(!panels.layers, { focus: true }); return; }
    if (ctrl && k.toLowerCase() === 's') { stop(e); if (e.shiftKey) saveDeckAs(); else saveDeck(); return; }
    if (ctrl && k.toLowerCase() === 'o') { stop(e); showDrawer(true); return; }
    if (k === 'F5' && e.shiftKey) { stop(e); app.presenter.open(); return; }
    if (ctrl && k.toLowerCase() === 'p') { stop(e); if (app.deck.isOpen) app.exporter.pdf(); return; }
    if ((k === 'p' || k === 'P') && !ctrl && !typing && app.deck.isOpen) { stop(e); app.presenter.open(); return; }
    if (k === 'F5') { stop(e); setPreview(true); return; }
    // Ctrl+F / Ctrl+H: find and replace across the deck (the browser's find does not see into it).
    // In a panel field they stay the browser's; in the find bar itself Ctrl+Z is the field's own undo.
    if (typing && t.closest('#findBar, .mathpop') && ctrl && (k.toLowerCase() === 'z' || k.toLowerCase() === 'y')) return;
    if (ctrl && !e.altKey && (k.toLowerCase() === 'f' || k.toLowerCase() === 'h')) {
        if (typing && !t.closest('#findBar') && !t.isContentEditable) return;
        stop(e);
        if (app.deck.isOpen) app.find.show({ replace: k.toLowerCase() === 'h' });
        return;
    }
    if (ctrl && k.toLowerCase() === 'z') { stop(e); e.shiftKey ? redo() : undo(); return; }
    if (ctrl && k.toLowerCase() === 'y') { stop(e); redo(); return; }
    // The Layers list has the focus: its arrows, Enter, Delete and F2 are its own.
    if (!typing && app.layers && app.layers.isOpen && t && t.closest && t.closest('#layersList') && app.layers.handleKey(e)) return stop(e);
    if (typing) return;
    // A control reached with the keyboard keeps its keys: Enter and Space press it (a mark that
    // is not a <button> is pressed here), Tab moves on, arrows and Delete are not the canvas's.
    // One clicked with the mouse is not :focus-visible, so the canvas keys go on working after
    // a click in the panel.
    const control = t && t.ownerDocument === document ? t.closest('button, a[href], summary, [role="button"], [role="option"], [role="tab"]') : null;
    if (control && control.matches(':focus-visible') && CONTROL_KEYS.has(k)) {
        if ((k === 'Enter' || k === ' ') && !control.matches('button, a[href], summary')) { stop(e); control.click(); }
        return;
    }
    if (k === '?') { showHelp(!document.querySelector('.help:not(.versions)'), 'keys'); return stop(e); }
    if (ctrl && (k === '=' || k === '+')) { stop(e); zoomStep(1); return; }
    if (ctrl && k === '-') { stop(e); zoomStep(-1); return; }
    if (ctrl && k === '0') { stop(e); setZoom('fit'); return; }
    if (ctrl && e.code === 'Backslash') { stop(e); const on = !(panels.strip || panels.inspector); togglePanel('strip', on); togglePanel('inspector', on); return; }
    if (!app.deck.isOpen) return;
    // The slide strip was the last thing clicked and nothing is picked on the canvas: whole slides.
    if (app.strip.isContext()) {
        const kl = k.toLowerCase();
        if (ctrl && !e.altKey && kl === 'c') { stop(e); app.strip.clip.copy(); return; }
        if (ctrl && !e.altKey && kl === 'x') { stop(e); app.strip.clip.cut(); return; }
        if (!ctrl && !e.altKey && !e.shiftKey && (k === 'Delete' || k === 'Backspace')) { stop(e); app.strip.deleteSelected(); return; }
        // Shift+Up / Down grow or shrink the pick (plain arrows change slide, Ctrl+arrows move the slides).
        if (!ctrl && !e.altKey && e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) { stop(e); app.strip.extendPick(k === 'ArrowUp' ? -1 : 1); return; }
    }
    if (k === 'Enter' && app.selection.primary) { stop(e); if (canCrop(app.selection.primary)) app.cropper.start(app.selection.primary); else app.textEdit.start(app.selection.primary); return; }
    if (ctrl && k.toLowerCase() === 'm') { stop(e); if (e.shiftKey) app.strip.addSlide(); else app.strip.showLayoutPicker(); return; }
    if (ctrl && k.toLowerCase() === 't') { stop(e); setThemeMode(!app.themeMode); return; }
    if (ctrl && k.toLowerCase() === 'd') { stop(e); if (app.selection.items.length) app.insert.duplicateSelection(); else app.strip.duplicateSlide(); return; }
    if (ctrl && e.altKey && k.toLowerCase() === 'c' && app.selection.items.length) { stop(e); if (app.editops.copyStyle()) toast('Style copied: Ctrl+Alt+V puts it on the selection', { ms: 2500 }); return; }
    if (ctrl && e.altKey && k.toLowerCase() === 'v' && app.selection.items.length) { stop(e); if (!app.editops.pasteStyle()) toast('Copy a style first (Ctrl+Alt+C)'); return; }
    if (ctrl && k.toLowerCase() === 'c' && app.selection.items.length) { stop(e); app.editops.copy(); return; }
    if (ctrl && k.toLowerCase() === 'x' && app.selection.items.length) { stop(e); app.editops.cut(); return; }
    // Ctrl+V is left to the browser: its paste event carries the clipboard (editops.js).
    if (ctrl && k.toLowerCase() === 'g') { stop(e); if (e.shiftKey) app.editops.ungroup(); else app.editops.group(); return; }
    if (ctrl && e.code === 'BracketRight') { stop(e); app.editops.layer(e.shiftKey ? 'front' : 'forward'); return; }
    if (ctrl && e.code === 'BracketLeft') { stop(e); app.editops.layer(e.shiftKey ? 'back' : 'backward'); return; }
    if (ctrl && k === 'ArrowUp') { stop(e); app.strip.moveSelected('up'); return; }        // the picked slides, or the current one
    if (ctrl && k === 'ArrowDown') { stop(e); app.strip.moveSelected('down'); return; }
    if (app.selection.handleKey(e)) return stop(e);
    if (k === 'ArrowDown' || k === 'ArrowRight') { stop(e); app.deck.next(); return; }
    if (k === 'ArrowUp' || k === 'ArrowLeft') { stop(e); app.deck.prev(); return; }
    if (k === 'PageDown') { stop(e); app.deck.next(); return; }
    if (k === 'PageUp') { stop(e); app.deck.prev(); return; }
    if (k === 'Home' && !ctrl) { stop(e); app.deck.goTo(0); return; }
    if (k === 'End' && !ctrl) { stop(e); app.deck.goTo(app.deck.slides.length - 1); return; }
}
function stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }
window.addEventListener('keydown', onKey, true);
window.addEventListener('keyup', (e) => app.selection.handleKeyUp(e), true);
app.deck.onNewDocument((doc, win) => {
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('keyup', (e) => app.selection.handleKeyUp(e), true);
    doc.addEventListener('contextmenu', noBrowserMenu);
});
/* The browser's own context menu (Back, Reload, View page source, Inspect) is not part of the
   editor: where the editor has no menu of its own, a right-click does nothing. Fields keep it,
   for cut, copy and paste. Ctrl+U and F12 are the browser's and stay. */
function noBrowserMenu(e) {
    const t = e.target && typeof e.target.closest === 'function' ? e.target : null;
    if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return;
    e.preventDefault();
}
document.addEventListener('contextmenu', noBrowserMenu);
/* Running the deck in Preview when it carries no presentation features script: the editor
   steps the slides itself, each waiting its data-auto-advance seconds (the slide's, else the
   stage's, else five). Fragments need the script, so this only changes slides. */
let editorAuto = null;
function toggleEditorAuto(state = 'none') {
    if (editorAuto) { clearTimeout(editorAuto); editorAuto = null; status(''); toast('Stopped.', { ms: 1500 }); return; }
    const step = () => {
        if (!app.preview) { editorAuto = null; status(''); return; }
        const i = app.deck.current, all = app.deck.slides;
        if (i + 1 < all.length) app.deck.goTo(i + 1);
        else if (app.deck.stage.hasAttribute('data-loop')) app.deck.goTo(0);
        else { editorAuto = null; status(''); toast('End of the deck.', { ms: 2000 }); return; }
        editorAuto = setTimeout(step, wait() * 1000);
    };
    const wait = () => {
        const s = app.deck.currentSlide;
        const v = parseFloat((s && s.getAttribute('data-auto-advance')) || app.deck.stage.getAttribute('data-auto-advance'));
        return isFinite(v) && v > 0 ? v : 5;
    };
    editorAuto = setTimeout(step, wait() * 1000);
    status('Running by itself | any key stops it');
    toast('Running the slides by itself. ' + (state === 'old'
        ? 'This deck carries an older presentation features script: Presenter > Update presentation features (a save does it too) gives it fragments, the overview and the morph as well.'
        : 'Presenter > Add presentation features gives the deck fragments, the overview and a run of its own in the saved file.'), { ms: 7000 });
}
window.addEventListener('editor:preview', (e) => { if (!e.detail && editorAuto) { clearTimeout(editorAuto); editorAuto = null; status(''); } });

/* Rehearse: the deck runs in Preview while the time on each slide is taken; stopping writes
   the times into the slides as data-auto-advance (one undo step), so the deck can run by
   itself afterwards. Esc (leaving Preview) stops it too. */
let rehearsal = null;
export function startRehearsal() {
    if (!app.deck.isOpen || rehearsal) return;
    const r = rehearsal = { times: new Map(), at: app.deck.current, since: Date.now() };
    const mark = () => {                                  // on `r`, so the last mark works after the stop
        const s = app.deck.slides[r.at];
        if (s) r.times.set(s, Math.max(1, Math.round((Date.now() - r.since) / 1000)) + (r.times.get(s) || 0));
        r.at = app.deck.current; r.since = Date.now();
    };
    r.onSlide = mark;
    app.deck.addEventListener('slide', mark);
    setPreview(true);
    toast('Rehearsing: go through the deck; Esc stops and keeps the times.', { ms: 5000 });
    status('Rehearsing...');
}
export function stopRehearsal({ keep = true } = {}) {
    if (!rehearsal) return;
    const r = rehearsal; rehearsal = null;
    app.deck.removeEventListener('slide', r.onSlide);
    r.onSlide();                                   // the slide it ended on counts too
    status('');
    const times = Array.from(r.times).filter(([s]) => s.isConnected);
    if (!keep || !times.length) { toast('Rehearsal dropped.'); return; }
    app.history.begin('Rehearsed timings');
    for (const [s, secs] of times) app.history.attr(s, 'data-auto-advance', String(secs), 'Rehearsed timings');
    app.history.end();
    app.inspector.sync();
    const total = times.reduce((a, [, s]) => a + s, 0);
    const runs = runtimeState() === 'current';           // A is the runtime's; an older script has no A
    toast(`Rehearsal kept: ${times.length} slide(s) timed, ${total} s in all. Undo drops the times. `
        + (runs ? 'A runs the deck by itself, here in Preview and in the saved file.'
            : 'For the deck to run by itself, add the presentation features (Presenter menu) and save.'), { ms: 7000 });
}
window.addEventListener('editor:preview', (e) => { if (!e.detail) stopRehearsal(); });

/* Shrink-to-fit texts follow their contents and boxes: refitted after a text edit, a resize
   from the canvas and a change from the panel (each as its own undo step, if the size moved). */
let refitting = false, stepping = false;
function refitSlide() {
    if (!app.deck.isOpen || refitting) return;
    refitting = true;
    try {
        const changed = [];
        for (const el of app.deck.currentSlide ? app.deck.currentSlide.querySelectorAll('[data-fit="shrink"]') : []) {
            const before = el.style.fontSize;
            if (fitText(el)) { el.style.fontSize = before; changed.push(el); }
        }
        if (!changed.length) return;
        app.history.begin('Fit text');
        for (const el of changed) app.history.style(el, () => fitText(el), { label: 'Fit text' });
        app.history.end();
        app.selection.refresh();
    } finally { refitting = false; }
}
// After any forward change (not an undo or redo, which put the recorded sizes back themselves).
app.history.addEventListener('before-step', () => { stepping = true; });
app.history.addEventListener('step', () => { setTimeout(() => { stepping = false; }, 0); });
app.history.addEventListener('change', () => { if (stepping || refitting || app.history.tx) return; setTimeout(refitSlide, 0); });
/* The page counter in the master layer follows the slide shown in the canvas. */
const stampCounter = () => { if (app.deck.isOpen) Deck.stampCounter(app.deck.stage, app.deck.current + 1, app.deck.slides.length); };
app.deck.addEventListener('slide', stampCounter);
app.deck.addEventListener('ready', stampCounter);
/* A theme change can resize the stage (Theme > Slide size): re-fit the zoom and redraw
   the strip, whose thumbnails are scaled copies of the stage. */
app.deck.addEventListener('overrides', () => {
    if (!app.deck.isOpen) return;
    const before = `${$('stageWrap').style.width}x${$('stageWrap').style.height}`;
    applyZoom();
    if (`${$('stageWrap').style.width}x${$('stageWrap').style.height}` !== before) { app.strip.rebuild(); app.selection.refresh(); }
});

/* ------------------------------------------------------------
   Selection on the canvas
   ------------------------------------------------------------ */
app.toast = toast;
app.selection = new Selection(app, { overlay: $('overlay'), wrap: $('stageWrap'), canvas: $('canvas') });
app.inspector = new Inspector(app, $('inspectorBody'));
keepNamed($('inspector'));
app.textEdit = new TextEditor(app, { overlay: $('overlay'), wrap: $('stageWrap'), canvas: $('canvas') });
app.inlineMath = new InlineMath(app);
// The panel's type fields follow the part of the text that is selected while editing in place.
app.textEdit.addEventListener('selection', () => app.inspector.sync());
app.strip = new SlideStrip(app, { list: $('stripList'), addButton: $('btnAddSlide') });
app.insert = new Inserter(app);
app.presenter = new Presenter(app);
app.exporter = new Exporter(app);
app.editops = new EditOps(app);
app.layers = new Layers(app, { pane: $('layersPane'), host: { setOpen: (on) => setLayers(on, { focus: true }), setHeight: setLayersHeight } });
applyPanels();                     // the Layers list's remembered state
app.cropper = new Cropper(app);
app.problems = new Problems(app, { badge: $('problemsBadge') });
app.fileDrop = new FileDrop(app, { canvas: $('canvas'), importDecks: importDroppedDecks, toast: (m, o) => toast(m, o) });
function runtimeState() {
    if (!app.deck.isOpen) return 'none';
    const el = app.deck.doc.getElementById('deck-runtime') || app.deck.doc.getElementById('deck-presenter');
    if (!el) return 'none';
    return el.id === 'deck-runtime' && /version: (1[2-9]|[2-9]\d)\b/.test(el.textContent) ? 'current' : 'old';
}
function showPresenterMenu(on) {
    const dd = $('presenterMenu').querySelector('.tb-dropdown');
    dd.hidden = !on;
    if (!on) return;
    const st = runtimeState();
    $('btnAddPresenter').disabled = !app.deck.isOpen || st === 'current';
    $('btnAddPresenter').textContent = st === 'current' ? 'Presentation features are built into this deck' : st === 'old' ? 'Update presentation features in this deck' : 'Add presentation features to this deck';
    $('presenterHint').textContent = st === 'current'
        ? 'Open the saved file on its own: P presenter, O overview, L laser, D draw, Space steps through fragments.'
        : 'Adds one script to the file so the deck has, on its own: presenter view (P), overview (O), laser pointer (L), drawing (D), click-to-reveal fragments and auto-animate between slides.';
}
$('btnPresenter').addEventListener('click', () => showPresenterMenu($('presenterMenu').querySelector('.tb-dropdown').hidden));
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#presenterMenu')) showPresenterMenu(false); }, true);
$('presenterMenu').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    showPresenterMenu(false);
    if (b.dataset.p === 'open') app.presenter.open();
    if (b.dataset.p === 'add') await addRuntimeScript();
    if (b.dataset.p === 'rehearse') startRehearsal();
});

/* Export menu: PDF (printed by the Chrome / Edge on this computer, or the browser's
   print dialog) and a single self-contained HTML file. Both from the live deck. */
function showExportMenu(on) {
    const dd = $('exportMenu').querySelector('.tb-dropdown');
    dd.hidden = !on;
    if (!on) return;
    const n = app.deck.isOpen ? app.exporter.pageCount() : 0;
    $('exportHint').textContent = `${n} slide${n === 1 ? '' : 's'} (skipped ones left out), unsaved edits included. PDF: one ${app.deck.stageW} x ${app.deck.stageH} page per slide, printed with the Chrome or Edge on this computer. Single file: scripts, styles, images and fonts embedded, opens anywhere. PowerPoint: editable text boxes, tables, charts and notes; drawings as pictures. Publish: a folder to put on a free web host you own, to get a link.`;
}
$('btnExport').addEventListener('click', () => { if (app.deck.isOpen) showExportMenu($('exportMenu').querySelector('.tb-dropdown').hidden); });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#exportMenu')) showExportMenu(false); }, true);
$('exportMenu').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    showExportMenu(false);
    if (b.dataset.x === 'pdf') await app.exporter.pdf();
    if (b.dataset.x === 'handout') await app.exporter.pdf({ handout: true });
    if (b.dataset.x === 'html') await app.exporter.standalone();
    if (b.dataset.x === 'publish') await showPublish(app);
    if (b.dataset.x === 'pptx') await app.exporter.pptx();
});

/* Put deck-runtime.js into the deck as an inline <script id="deck-runtime"> before </body>
   (replacing an older presenter/runtime script), so the saved file has presenter view,
   overview, fragments and auto-animate on its own. Undoable like any other change. */
export async function addRuntimeScript({ quiet = false } = {}) {
    const NL = String.fromCharCode(10);
    const d = app.deck;
    if (!d.isOpen) return false;
    try {
        const js = await api.runtimeScript();
        const old = d.doc.getElementById('deck-runtime') || d.doc.getElementById('deck-presenter');
        const script = d.doc.createElement('script');
        script.id = 'deck-runtime';
        script.textContent = NL + js.trim() + NL;
        app.history.begin('Presentation features');
        if (old) {
            app.history.insert(script, old.parentNode, old, 'Presentation features');
            app.history.remove(old, 'Presentation features');
        } else {
            const body = d.doc.body;
            const tail = body.lastChild && body.lastChild.nodeType === 3 && !body.lastChild.textContent.trim() ? body.lastChild : null;
            app.history.insert(d.doc.createTextNode(NL), body, tail, 'Presentation features');
            app.history.insert(script, body, tail, 'Presentation features');
        }
        app.history.end();
        if (!quiet) toast((old ? 'Presentation features updated.' : 'Presentation features added.') + ' Save, then open the file on its own: P presenter, O overview, L laser, D draw.', { ms: 5000 });
        return true;
    } catch (err) { toast('Could not add the presentation features: ' + err.message, { error: true }); return false; }
}

/* ------------------------------------------------------------
   Element menu (right-click on the canvas)
   ------------------------------------------------------------ */
function closeElementMenu() { document.querySelectorAll('.el-menu').forEach(m => m.remove()); }
function showElementMenu(x, y, el) {
    closeElementMenu();
    const sel = app.selection, n = sel.items.length;
    const canText = !!el && !el.hasAttribute('data-placeholder');
    const isGroup = !!el && el.hasAttribute('data-group') && el.tagName === 'DIV';
    const item = (a, label, { disabled = false, hint = '' } = {}) => `<button data-a="${a}" ${disabled ? 'disabled' : ''}>${label}${hint ? `<span class="hint">${hint}</span>` : ''}</button>`;
    const menu = document.createElement('div');
    menu.className = 'strip-menu el-menu';
    menu.innerHTML = el ? [
        item('text', el.hasAttribute('data-placeholder') ? 'Choose image...' : 'Edit text', { disabled: !canText && !el.hasAttribute('data-placeholder'), hint: el.hasAttribute('data-placeholder') ? '' : 'Enter' }),
        item('link', el.hasAttribute('data-href') ? 'Change link...' : 'Link to...'),
        ...(canCrop(el) ? [item('crop', 'Crop', { hint: 'Enter' })] : []),
        ...(cropBoxOf(el) ? [item('uncrop', 'Remove crop')] : []),
        '<hr>',
        item('cut', 'Cut', { hint: 'Ctrl+X' }), item('copy', 'Copy', { hint: 'Ctrl+C' }), item('paste', 'Paste', { hint: 'Ctrl+V' }), item('dup', 'Duplicate', { hint: 'Ctrl+D' }),
        item('copystyle', 'Copy style', { hint: 'Ctrl+Alt+C' }), item('pastestyle', 'Paste style', { hint: 'Ctrl+Alt+V', disabled: !app.editops.styleClip }),
        item('delete', 'Delete', { hint: 'Del' }), item('hide', 'Hide'), item('lock', el.closest('[data-locked]') ? 'Unlock' : 'Lock'),
        '<hr>',
        item('forward', 'Bring forward', { hint: 'Ctrl+]' }), item('backward', 'Send backward', { hint: 'Ctrl+[' }), item('front', 'Bring to front'), item('back', 'Send to back'),
        '<hr>',
        item('group', 'Group', { disabled: n < 2, hint: 'Ctrl+G' }), item('ungroup', 'Ungroup', { disabled: !isGroup }),
        '<hr>',
        item('parent', 'Select parent'),
    ].join('') : [
        item('paste', 'Paste', { hint: 'Ctrl+V' }),
        item('unhide', 'Unhide all on this slide'),
        '<hr>',
        item('newslide', 'New slide after this...'),
    ].join('');
    menu.style.left = Math.min(x, innerWidth - 230) + 'px';
    menu.style.top = Math.min(y, innerHeight - menu.children.length * 26 - 40) + 'px';
    document.body.appendChild(menu);
    menu.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
        closeElementMenu();
        switch (b.dataset.a) {
            case 'text': if (el.hasAttribute('data-placeholder')) chooseImage(el); else app.textEdit.start(el); break;
            case 'link': app.inspector.promptLink(); break;
            case 'crop': app.cropper.start(el); break;
            case 'uncrop': app.cropper.uncrop(el); break;
            case 'cut': app.editops.cut(); break;
            case 'copy': app.editops.copy(); break;
            case 'copystyle': app.editops.copyStyle(); toast('Style copied: Paste style puts it on another element', { ms: 2500 }); break;
            case 'pastestyle': app.editops.pasteStyle(); break;
            case 'paste': await app.editops.pasteFromMenu(); break;
            case 'dup': app.insert.duplicateSelection(); break;
            case 'delete': app.editops.remove(); break;
            case 'hide': sel.hide(); break;
            case 'lock': sel.lock(!sel.items.every(e => e.closest('[data-locked]'))); break;
            case 'forward': case 'backward': case 'front': case 'back': app.editops.layer(b.dataset.a); break;
            case 'group': app.editops.group(); break;
            case 'ungroup': app.editops.ungroup(); break;
            case 'parent': sel.selectParent(); break;
            case 'unhide': { const k = sel.unhideAll(); toast(k ? k + ' hidden element(s) restored' : 'Nothing is hidden on this slide'); break; }
            case 'newslide': app.strip.showLayoutPicker(app.deck.current, $('btnAddSlide')); break;
        }
    });
}
app.selection.addEventListener('menu', (e) => showElementMenu(e.detail.x, e.detail.y, e.detail.el));
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.el-menu')) closeElementMenu(); }, true);
window.addEventListener('editor:before-step', closeElementMenu);

/* ------------------------------------------------------------
   Theme panel: takes the inspector's place while it is open.
   ------------------------------------------------------------ */
app.rulers = new Rulers(app, { wrap: $('stageWrap'), canvas: $('canvas') });
setRulers(savedRulers === '1');
app.fontPicker = new FontPicker(app);
app.iconPicker = new IconPicker(app);

/* The command palette (Ctrl+K): the editor's actions, the slides, the built-in icons, and a
   way into the icon and font pickers with what was typed. Gathered when it opens. */
function paletteEntries() {
    const sel = app.selection, has = sel.items.length > 0, one = !!sel.single, open = app.deck.isOpen;
    const click = (q) => () => { const b = document.querySelector(q); if (b) b.click(); };
    const insert = (kind, label, hint = '') => ({ group: 'Insert', label, hint, run: click(`[data-insert="${kind}"]`) });
    const out = [];
    if (open) {
        out.push({ group: 'Slide', label: 'New slide (layout picker)', hint: 'Ctrl+M', run: () => app.strip.showLayoutPicker() });
        out.push({ group: 'Slide', label: 'New blank slide', hint: 'Ctrl+Shift+M', run: () => app.strip.addSlide(app.deck.current, 'blank') });
        out.push({ group: 'Slide', label: 'Duplicate this slide', run: () => app.strip.duplicateSlide() });
        // The moves act on the picked slides in the strip, or this slide. "move to 5" moves straight there.
        const moving = app.strip.selectedSlides(), what = slidesWord(moving.length), total = app.deck.slides.length;
        if (moving.length < total) {
            const max = total - moving.length + 1;
            // The places it can go are among its keywords, so "move to 12" keeps the entry in the list.
            out.push({ group: 'Slide', label: `Move ${what} to...`, keywords: 'reorder position number section ' + Array.from({ length: max }, (_, i) => i + 1).join(' '), run: (q) => {
                const m = /\b(\d+)\s*$/.exec(q);
                if (m && +m[1] >= 1 && +m[1] <= max) app.strip.moveSelected(+m[1] - 1, moving); else app.strip.showMoveTo(moving);
            } });
            out.push({ group: 'Slide', label: `Move ${what} up`, hint: 'Ctrl+Up', keywords: 'reorder', run: () => app.strip.moveSelected('up', moving) });
            out.push({ group: 'Slide', label: `Move ${what} down`, hint: 'Ctrl+Down', keywords: 'reorder', run: () => app.strip.moveSelected('down', moving) });
            for (const sec of app.strip.sections()) if (!moving.includes(sec.start)) out.push({ group: 'Slide', label: `Move ${what} to the end of section ${sec.name}`, keywords: 'reorder', quiet: true, run: () => app.strip.moveToSection(sec.start, moving) });
        }
        // Every layout of the picker, straight in: "new slide quote", "layout two columns".
        for (const l of LAYOUTS) out.push({ group: 'Slide', label: 'New slide: ' + l.label, keywords: 'layout add', quiet: true, run: () => app.strip.addSlide(app.deck.current, l.id) });
        out.push({ group: 'Slide', label: 'Auto-animate to the next slide (on / off)', run: () => { const s = app.deck.currentSlide; if (s) { sel.clear(); $('inspAutoAnimate').checked = !s.hasAttribute('data-auto-animate'); $('inspAutoAnimate').dispatchEvent(new Event('change')); } } });
        for (const [kind, label] of [['text', 'Text box'], ['list', 'Bullet list'], ['olist', 'Numbered list'], ['table', 'Table'], ['chart', 'Chart'], ['code', 'Code block'], ['image', 'Image from file...'], ['image-url', 'Image from URL...'], ['placeholder', 'Image placeholder'], ['video', 'Video from file...'], ['embed', 'Embed web page or video...'], ['rect', 'Rectangle'], ['rounded', 'Rounded rectangle'], ['ellipse', 'Ellipse'], ['shape:triangle', 'Triangle'], ['shape:diamond', 'Diamond'], ['shape:hexagon', 'Hexagon'], ['shape:star', 'Star'], ['shape:block-arrow', 'Block arrow'], ['shape:chevron', 'Chevron'], ['shape:bubble', 'Speech bubble'], ['line', 'Line'], ['arrow', 'Arrow'], ['curved', 'Curved arrow'], ['double', 'Double arrow'], ['master-footer', 'Footer on every slide']]) out.push(insert(kind, label));
        out.push({ group: 'Insert', label: 'Equation', keywords: 'math maths latex formula tex', run: click('[data-insert="equation"]') });
        // Into the text being edited, at the caret (or the text selected on the canvas, at its end).
        if (app.textEdit.el || one) out.push({ group: 'Insert', label: 'Equation in the text', hint: 'Alt+=', keywords: 'inline math maths latex formula tex sentence', run: () => app.inlineMath.fromCaret() });
        out.push({ group: 'Insert', label: 'Interactive chart (Plotly)...', keywords: 'plot plotly json figure graph live hover zoom', run: click('[data-insert="plot"]') });
        out.push({ group: 'Insert', label: 'Chemical structure', keywords: 'chemistry molecule smiles compound', run: click('[data-insert="structure"]') });
        out.push({ group: 'Insert', label: 'Font Awesome icon...', keywords: 'icons fa', run: (q) => { app.iconPicker.open($('btnInsert')); const words = q.replace(/\b(font awesome|icon|icons|fa)\b/gi, '').trim(); if (words && app.iconPicker.search) { app.iconPicker.search.value = words; app.iconPicker.search.dispatchEvent(new Event('input')); } } });
        out.push(...iconEntries(app));
        if (has) {
            out.push({ group: 'Element', label: 'Change font...', keywords: 'typeface family', run: (q) => { $('inspFont').click(); const words = q.replace(/\b(change|font|typeface|family)\b/gi, '').trim(); if (words && app.fontPicker.search) { app.fontPicker.search.value = words; app.fontPicker.search.dispatchEvent(new Event('input')); } } });
            out.push({ group: 'Element', label: 'Bring to front', hint: 'Ctrl+Shift+]', run: () => app.editops.layer('front') });
            out.push({ group: 'Element', label: 'Send to back', hint: 'Ctrl+Shift+[', run: () => app.editops.layer('back') });
            out.push({ group: 'Element', label: 'Bring forward', hint: 'Ctrl+]', run: () => app.editops.layer('forward') });
            out.push({ group: 'Element', label: 'Send backward', hint: 'Ctrl+[', run: () => app.editops.layer('backward') });
            out.push({ group: 'Element', label: sel.items.every(e => e.closest('[data-locked]')) ? 'Unlock' : 'Lock', run: () => sel.lock(!sel.items.every(e => e.closest('[data-locked]'))) });
            out.push({ group: 'Element', label: 'Hide', run: () => sel.hide() });
            out.push({ group: 'Element', label: 'Duplicate', hint: 'Ctrl+D', run: () => app.insert.duplicateSelection() });
            out.push({ group: 'Element', label: 'Delete', hint: 'Del', run: () => app.editops.remove() });
            out.push({ group: 'Element', label: 'Copy style', hint: 'Ctrl+Alt+C', run: () => { app.editops.copyStyle(); toast('Style copied', { ms: 2000 }); } });
            if (app.editops.styleClip) out.push({ group: 'Element', label: 'Paste style', hint: 'Ctrl+Alt+V', run: () => app.editops.pasteStyle() });
            if (sel.items.length > 1) out.push({ group: 'Element', label: 'Group', hint: 'Ctrl+G', run: () => app.editops.group() });
            if (one && sel.single.hasAttribute('data-group')) out.push({ group: 'Element', label: 'Ungroup', hint: 'Ctrl+Shift+G', run: () => app.editops.ungroup() });
            if (one && canCrop(sel.single)) out.push({ group: 'Element', label: 'Crop the picture', hint: 'Enter', keywords: 'trim zoom', run: () => app.cropper.start(sel.single) });
            if (one && cropBoxOf(sel.single)) out.push({ group: 'Element', label: 'Remove the crop', keywords: 'uncrop whole picture', run: () => app.cropper.uncrop(sel.single) });
            else if (one) out.push({ group: 'Element', label: 'Edit text', hint: 'Enter', run: () => app.textEdit.start(sel.single) });
        }
        out.push({ group: 'Element', label: 'Unhide all on this slide', run: () => { const k = sel.unhideAll(); toast(k ? k + ' hidden element(s) restored' : 'Nothing is hidden on this slide'); } });
        app.deck.slides.forEach((s, i) => {
            const heading = s.querySelector('h1, h2, h3');
            const name = s.getAttribute('data-name') || (heading ? readableText(heading) : '');
            out.push({ group: 'Slides', label: `Go to slide ${i + 1}` + (name.trim() ? ' · ' + name.trim().replace(/\s+/g, ' ').slice(0, 50) : ''), run: () => app.deck.goTo(i) });
        });
        out.push({ group: 'Deck', label: 'Find...', hint: 'Ctrl+F', keywords: 'search', run: () => app.find.show() });
        out.push({ group: 'Deck', label: 'Replace...', hint: 'Ctrl+H', keywords: 'find replace search', run: () => app.find.show({ replace: true }) });
        out.push({ group: 'Deck', label: 'Save', hint: 'Ctrl+S', run: () => saveDeck() });
        out.push({ group: 'Deck', label: 'Save as...', hint: 'Ctrl+Shift+S', run: () => saveDeckAs() });
        out.push({ group: 'Deck', label: 'Previous versions...', run: () => showVersions() });
        out.push({ group: 'Deck', label: 'Export PDF...', hint: 'Ctrl+P', run: () => app.exporter.pdf() });
        out.push({ group: 'Deck', label: 'Export PDF with notes (handout)...', run: () => app.exporter.pdf({ handout: true }) });
        out.push({ group: 'Deck', label: 'Export PowerPoint (.pptx)...', keywords: 'powerpoint pptx office microsoft', run: () => app.exporter.pptx() });
        out.push({ group: 'Deck', label: 'Export a single HTML file...', run: () => app.exporter.standalone() });
        out.push({ group: 'Deck', label: 'Publish...', keywords: 'website link host netlify github pages share online', run: () => showPublish(app) });
        out.push({ group: 'Deck', label: 'Presenter view', hint: 'P', run: () => app.presenter.open() });
        out.push({ group: 'Deck', label: 'Rehearse (time the slides, then keep the times)', keywords: 'timing auto advance kiosk', run: () => startRehearsal() });
        out.push({ group: 'Deck', label: 'Preview (present in the canvas)', run: click('#btnPreview') });
        out.push({ group: 'Deck', label: 'Theme panel', hint: 'Ctrl+T', run: () => setThemeMode(true) });
        out.push({ group: 'Deck', label: 'Add or update the presentation features script', run: () => addRuntimeScript() });
        const trust = app.deck.trust;
        if (trust && trust.scripts) {
            out.push(trust.trusted
                ? { group: 'Deck', label: "Pause this deck's own scripts", keywords: 'trust security script', run: () => setDeckTrust(app.file, false) }
                : { group: 'Deck', label: "Trust this deck (run its own scripts)", keywords: 'trust security script', run: () => setDeckTrust(app.file, true) });
        }
        out.push({ group: 'View', label: (app.rulers.on ? 'Hide' : 'Show') + ' the rulers and guides', keywords: 'ruler guide grid', run: () => setRulers(!app.rulers.on) });
        out.push({ group: 'View', label: 'Guides at the selection (or the thirds)', keywords: 'ruler grid', run: () => { if (!app.rulers.on) setRulers(true); app.rulers.addForSelection(); } });
        out.push({ group: 'View', label: 'Clear the guides', keywords: 'ruler', run: () => { if (!app.rulers.clear()) toast('This deck has no guides'); } });
        out.push({ group: 'View', label: 'Zoom to fit', hint: 'Ctrl+0', run: click('#btnZoomFit') });
        out.push({ group: 'View', label: 'Zoom in', hint: 'Ctrl++', run: click('#btnZoomIn') });
        out.push({ group: 'View', label: 'Zoom out', hint: 'Ctrl+-', run: click('#btnZoomOut') });
        out.push({ group: 'View', label: (panels.layers ? 'Hide' : 'Show') + ' layers', hint: 'Ctrl+Shift+L', keywords: 'layers stacking order z-index front back elements list', run: () => setLayers(!panels.layers, { focus: true }) });
        out.push({ group: 'View', label: 'Hide or show the side panels', hint: 'Ctrl+\\', run: click('#btnTogglePanel') });
        out.push({ group: 'View', label: 'Undo', hint: 'Ctrl+Z', run: () => app.history.undo() });
        out.push({ group: 'View', label: 'Redo', hint: 'Ctrl+Y', run: () => app.history.redo() });
    }
    out.push({ group: 'Decks', label: 'Open a deck (the deck list)', hint: 'Ctrl+O', run: () => showDrawer(true) });
    out.push({ group: 'Decks', label: 'Open a deck file anywhere on this computer...', keywords: 'browse', run: () => pickDeckFile() });
    out.push({ group: 'Decks', label: 'New deck...', keywords: 'template design gallery create', run: () => newDeck() });
    // Every template: the gallery opens with it chosen, waiting for a name.
    for (const t of templateList) out.push({ group: 'Decks', label: 'New deck from the ' + t.name + ' template...', keywords: 'template design theme ' + [t.tone, t.style, t.tagline].filter(Boolean).join(' '), quiet: true, run: () => newDeck(t.slug) });
    out.push({ group: 'Decks', label: 'Import a PowerPoint or Markdown file...', run: () => importDeck() });
    out.push({ group: 'Decks', label: 'Change folder...', keywords: 'browse directory where decks', run: () => changeFolder() });
    out.push({ group: 'Decks', label: 'Try the sample deck', run: () => openSampleDeck() });
    out.push({ group: 'Help', label: 'Keyboard map', hint: '?', run: () => showHelp(true, 'keys') });
    out.push({ group: 'Help', label: 'About Diapo', keywords: 'version release', run: () => showHelp(true, 'about') });
    out.push({ group: 'Help', label: 'Check for updates', keywords: 'new release version upgrade', run: () => { showHelp(true, 'about'); checkForUpdates(); } });
    out.push({ group: 'Help', label: 'Look (light / dark)', run: click('#btnLook') });
    out.push({ group: 'View', label: (app.spellcheck ? 'Turn off' : 'Turn on') + ' spelling check while typing', keywords: 'spellcheck spell', run: () => setSpell(!app.spellcheck) });
    return out;
}
app.palette = new Palette(app, { entries: paletteEntries });
app.find = new FindBar(app);
setSpell(app.spellcheck);          // the notes box exists now
app.theme = new ThemePanel(app, $('themeBody'));
export function setThemeMode(on) {
    if (!app.deck.isOpen) return;
    app.themeMode = on;
    document.body.classList.toggle('theme-mode', on);
    $('btnTheme').classList.toggle('on', on);
    $('inspectorBody').hidden = on;
    $('themeBody').hidden = !on;
    if (on) { app.textEdit.commit(); app.selection.clear(); app.theme.render(); if (!panels.inspector) togglePanel('inspector', true); }
}
$('btnTheme').addEventListener('click', () => setThemeMode(!app.themeMode));
app.selection.addEventListener('change', () => { if (app.themeMode && app.selection.items.length) setThemeMode(false); });
window.addEventListener('editor:open', () => setThemeMode(false));

/* ------------------------------------------------------------
   Insert menu
   ------------------------------------------------------------ */
$('insertIcons').innerHTML = Object.entries(ICONS).map(([name, d]) =>
    `<button data-icon="${name}" title="${name}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg></button>`).join('');
function showInsertMenu(on) { $('insertMenu').querySelector('.tb-dropdown').hidden = !on; }
$('btnInsert').addEventListener('click', () => { if (app.deck.isOpen) showInsertMenu($('insertMenu').querySelector('.tb-dropdown').hidden); });
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#insertMenu')) showInsertMenu(false); }, true);
$('insertMenu').addEventListener('click', async (e) => {
    const icon = e.target.closest('[data-icon]');
    if (icon) { showInsertMenu(false); app.insert.icon(icon.dataset.icon); return; }
    const b = e.target.closest('[data-insert]'); if (!b) return;
    showInsertMenu(false);
    const kind = b.dataset.insert;
    if (kind.startsWith('shape:')) { app.insert.shape(kind.slice(6)); return; }
    switch (kind) {
        case 'fa': app.iconPicker.open($('btnInsert')); break;
        case 'text': app.insert.text(); break;
        case 'list': app.insert.list(false); break;
        case 'olist': app.insert.list(true); break;
        case 'table': app.insert.table(); break;
        case 'chart': app.insert.chart(); break;
        case 'code': app.insert.code(); break;
        case 'equation': drawnInsert(() => app.insert.equation(), 'equation'); break;
        case 'structure': drawnInsert(() => app.insert.structure(), 'structure'); break;
        case 'plot': openPlotDialog(app); break;
        case 'master-footer': app.insert.masterFooter(); break;
        case 'image': chooseImage(null); break;
        case 'image-url': { const url = prompt('Image address (URL):', 'https://'); if (url && url !== 'https://') app.insert.image(url.trim()); break; }
        case 'placeholder': app.insert.placeholder(); break;
        case 'video': $('insertVideo').click(); break;
        case 'video-url': { const url = prompt('Video address (URL of an .mp4 or .webm file):', 'https://'); if (url && url !== 'https://') app.insert.video(url.trim()); break; }
        case 'embed': { const url = prompt('Web page or video address (YouTube and Vimeo links become players):', 'https://'); if (url && url !== 'https://') app.insert.embed(url.trim()); break; }
        case 'rect': app.insert.rect(false); break;
        case 'rounded': app.insert.rect(false, 28); break;
        case 'ellipse': app.insert.rect(true); break;
        case 'line': case 'arrow': case 'curved': case 'double': app.insert.drawLine(kind); break;
    }
});

/* Image files: from the Insert menu, or to fill a placeholder (double-click on it, or
   "Choose image..." in the properties panel). The placeholder is remembered until the
   file dialog comes back. */
let placeholderTarget = null;
/* Insert an equation or a structure: the first one loads its library (MathJax is 2 MB). */
async function drawnInsert(make, what) {
    const slow = setTimeout(() => status(`Loading the ${what} drawing...`, { busy: true }), 300);
    try { await make(); }
    catch (err) { toast(`Could not draw the ${what}: ${err.message}`, { error: true, ms: 5000 }); }
    finally { clearTimeout(slow); status(''); }
}

function chooseImage(placeholder) { placeholderTarget = placeholder; $(placeholder && placeholder.tagName === 'VIDEO' ? 'insertVideo' : 'insertFile').click(); }
app.selection.addEventListener('edit-text', (e) => { if (e.detail.el && e.detail.el.hasAttribute('data-placeholder')) chooseImage(e.detail.el); });
window.addEventListener('editor:choose-image', (e) => chooseImage(e.detail));
$('insertFile').addEventListener('change', async () => {
    const files = Array.from($('insertFile').files); $('insertFile').value = '';
    const placeholder = placeholderTarget; placeholderTarget = null;
    if (!files.length) return;
    try {
        const r = await app.insert.upload(files, { placeholder });
        toast(r.files.length + ' image(s) uploaded to assets/' + (r.refused.length ? ' | not an image: ' + r.refused.join(', ') : ''), { ms: r.refused.length ? 5000 : 2600 });
    }
    catch (err) { toast('Upload failed: ' + err.message, { error: true }); }
});
$('insertVideo').addEventListener('change', async () => {
    const files = Array.from($('insertVideo').files); $('insertVideo').value = '';
    const placeholder = placeholderTarget; placeholderTarget = null;
    if (!files.length) return;
    try {
        const r = await app.insert.upload(files, { placeholder });
        toast(r.files.length + ' video(s) uploaded to assets/' + (r.refused.length ? ' | not a video: ' + r.refused.join(', ') : ''), { ms: r.refused.length ? 5000 : 2600 });
    }
    catch (err) { toast('Upload failed: ' + err.message, { error: true }); }
});
window.addEventListener('editor:preview', (e) => { app.selection.enabled = !e.detail; if (e.detail) app.selection.clear(); });

/* Ctrl+wheel zooms around the canvas, plain wheel scrolls it. */
$('canvas').addEventListener('wheel', (e) => {
    if (!e.ctrlKey || app.preview) return;
    e.preventDefault();
    setZoom(app.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX, y: e.clientY });
}, { passive: false });

/* The middle button grabs the canvas: the view follows the mouse while it is held
   (instead of the browser's autoscroll, which drifts towards the pointer). */
let grab = null;
$('canvas').addEventListener('pointerdown', (e) => {
    if (e.button !== 1 || app.preview) return;
    e.preventDefault();                                             // no autoscroll
    const c = $('canvas');
    grab = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: c.scrollLeft, sy: c.scrollTop };
    c.setPointerCapture(e.pointerId);
    c.classList.add('grabbing');
});
$('canvas').addEventListener('pointermove', (e) => {
    if (!grab || e.pointerId !== grab.id) return;
    const c = $('canvas');
    c.scrollLeft = grab.sx - (e.clientX - grab.x);
    c.scrollTop = grab.sy - (e.clientY - grab.y);
});
const endGrab = (e) => { if (grab && e.pointerId === grab.id) { grab = null; $('canvas').classList.remove('grabbing'); } };
$('canvas').addEventListener('pointerup', endGrab);
$('canvas').addEventListener('pointercancel', endGrab);
$('canvas').addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

/* The wheel over a focused number field steps its value (Shift: ten steps), as the
   arrow keys do, and applies it like typing would. */
document.addEventListener('wheel', (e) => {
    const f = e.target;
    if (!(f instanceof HTMLInputElement) || f.type !== 'number' || document.activeElement !== f) return;
    e.preventDefault();
    const step = (parseFloat(f.step) || 1) * (e.shiftKey ? 10 : 1);
    const dir = e.deltaY < 0 ? 1 : -1;
    let v = (parseFloat(f.value) || 0) + dir * step;
    if (f.min !== '' && v < +f.min) v = +f.min;
    if (f.max !== '' && v > +f.max) v = +f.max;
    const decimals = (String(f.step || '1').split('.')[1] || '').length;
    f.value = v.toFixed(decimals);
    f.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new Event('change', { bubbles: true }));
}, { passive: false });

/* ------------------------------------------------------------
   Save (serialisation lives in document.js once history exists;
   for now the deck is written back verbatim to prove the pipe)
   ------------------------------------------------------------ */
export async function saveDeck({ overwrite = false } = {}) {
    if (!app.deck.isOpen || !app.file) return;
    window.dispatchEvent(new CustomEvent('editor:before-save'));   // text edits commit here
    clearTimeout(draftTimer); draftTimer = null;
    document.querySelectorAll('.bar.conflict-bar').forEach(b => b.remove());
    // A deck that carries an older edition of the presentation features gets the current one
    // with the save: the script is the editor's own, and what it does (the morph, the overview)
    // is what the deck shows when presented.
    const refreshed = runtimeState() === 'old' ? await addRuntimeScript({ quiet: true }) : false;
    try {
        const html = serialize();
        const r = await api.save(app.file, html, { base: app.deck.diskVersion, overwrite });
        if (r.version) app.deck.diskVersion = r.version;
        app.history.markSaved();
        app.deck.setSource(html, { reparse: false });   // the head splice follows the file; generated-content baseline stays as loaded
        draftWritten = false;
        await api.draftDelete(app.file).catch(() => {});
        toast(`Saved ${app.deckName}` + (refreshed ? ' | presentation features brought up to date' : '') + (r.backup ? ' | the previous version is under File > Previous versions' : ''), { ms: 3500 });
        status('Saved ' + new Date().toLocaleTimeString());
        window.dispatchEvent(new CustomEvent('editor:saved'));
    } catch (err) {
        if (err.status === 409 && err.data && err.data.reason === 'changed') return offerConflict();
        toast('Could not save: ' + err.message, { error: true, ms: 5000 });
    }
}
$('btnSave').addEventListener('click', () => saveDeck());

/* The file changed on disk after the deck was opened (another program, the diapo-deck
   skill, a second window saved it): Save stops and asks. The edits stay in the editor (and
   in the draft) whatever is chosen. */
function offerConflict() {
    document.querySelectorAll('.bar.conflict-bar').forEach(b => b.remove());
    const file = app.file;
    if (app.dirty) api.draftWrite(file, serialize()).then(() => { draftWritten = true; }).catch(() => {});
    const bar = document.createElement('div');
    bar.className = 'bar conflict-bar';
    bar.setAttribute('role', 'alert');
    bar.innerHTML = 'This deck was changed on disk after you opened it, by another program or window. Saving would replace those changes. '
        + '<button data-a="over">Save over it</button><button data-a="copy">Save mine as a copy...</button>'
        + '<button data-a="disk">Open the file on disk</button><button data-a="later">Not now</button>';
    barStack().appendChild(bar);
    bar.querySelector('button').focus();
    bar.addEventListener('click', async (e) => {
        const a = e.target.dataset.a; if (!a) return;
        if (a === 'disk' && app.dirty && !confirm('Open the file as it is on disk? Your unsaved edits here are dropped.')) return;
        bar.remove();
        if (app.file !== file) return;
        if (a === 'over') await saveDeck({ overwrite: true });           // what was on disk becomes the newest previous version
        else if (a === 'copy') await saveDeckAs();
        else if (a === 'disk') { await api.draftDelete(file).catch(() => {}); draftWritten = false; await openDeck(file, { discard: true }); }
    });
}

/* Save as: the live deck (edits included) under a new name or in another folder, with the
   pictures, scripts, styles and fonts it uses copied along, so the copy stands on its own.
   The editor then works on the copy; the original stays as it was last saved. */
export async function saveDeckAs({ to = null } = {}) {
    if (!app.deck.isOpen || !app.file) return null;
    window.dispatchEvent(new CustomEvent('editor:before-save'));
    clearTimeout(draftTimer); draftTimer = null;
    const oldFile = app.file;
    try {
        const html = serialize();
        let r;
        try {
            r = await api.saveAs(oldFile, html, { to });
        } catch (err) {
            if (!NO_DIALOG.test(err.message)) throw err;
            const typed = prompt('Save as (a file name in this folder, or a full path):\n(No file dialog is available on this computer.)', oldFile.split('/').pop().replace(/\.html$/i, '') + '-copy.html');
            if (!typed || !typed.trim()) return null;
            r = await api.saveAs(oldFile, html, { to: typed.trim() });
        }
        if (r.cancelled) return r;
        await api.draftDelete(oldFile).catch(() => {});      // the edits live in the new file now
        draftWritten = false;
        app.history.markSaved();
        if (r.workspace !== app.workspace) { app.workspace = r.workspace; await refreshFiles(); }
        await openDeck(r.file);
        const notes = r.notes && r.notes.length ? ' | ' + r.notes.join(' | ') : '';
        toast(`Saved as ${r.path}` + (r.copied ? ` with ${r.copied} file${r.copied === 1 ? '' : 's'} copied along` : '') + notes, { ms: notes ? 8000 : 4500 });
        return r;
    } catch (err) {
        toast('Could not save as: ' + err.message, { error: true, ms: 6000 });
        return null;
    }
}
$('btnZoomIn').addEventListener('click', () => zoomStep(1));
$('btnZoomOut').addEventListener('click', () => zoomStep(-1));
$('btnZoomFit').addEventListener('click', () => setZoom('fit'));

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
async function boot() {
    app.startRehearsal = startRehearsal; app.stopRehearsal = stopRehearsal;
    window.deckEditor = app;      // handy in the console and for the tests
    app.save = saveDeck;
    app.saveAs = saveDeckAs;
    app.openDeck = openDeck;
    app.setZoom = setZoom;
    app.openSampleDeck = openSampleDeck;
    app.setPreview = setPreview;
    app.addRuntimeScript = addRuntimeScript;
    document.body.classList.add('no-deck');
    // The logo's processing-date stamp reads this month, the way a lab stamped the mount.
    $('brandStamp').textContent = new Date().toLocaleDateString('en', { month: 'short', year: '2-digit' }).toUpperCase().replace(',', '');
    try {
        const s = await api.status();
        app.workspace = s.workspace;
        if (s.app) $('brandVersion').textContent = 'v' + s.app;      // the margin print carries the build number
        app.version = s.app || ''; app.released = s.released || ''; app.updateAuto = !!s.update_auto;
        autoUpdateCheck();
        showStatusFolder();
    } catch (err) {
        toast('The server is not running. Start it with serve.py.', { error: true, ms: 8000 });
    }
    const file = new URLSearchParams(location.search).get('file');
    if (file) await tabs.restore(file);                  // the tabs of the last session, around the deck of the address
    if (file && await openDeck(file)) return;
    refreshFiles();                                      // no deck: the welcome screen is the home, the drawer stays closed
}
boot();

function escapeAttr(s) { return escapeHtml(String(s == null ? '' : s)); }
