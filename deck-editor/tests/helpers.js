// Shared by the Playwright specs in this folder: the fixture deck, how to open it, and small
// helpers for the canvas. Run the tests with: npx playwright test   (from deck-editor/)
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, 'fixtures', 'sample-deck', 'index.html');
const DECK_DIR = path.join(__dirname, '.tmp-workspace', 'sample');
const DECK = path.join(DECK_DIR, 'index.html');
const FILE = 'sample/index.html';

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function resetDeck() {
    fs.copyFileSync(FIXTURE, DECK);
    for (const f of fs.readdirSync(DECK_DIR)) {
        if (/\.bak$|\.~draft$|-standalone\.html$|\.pdf$|^\.deck-editor-print/.test(f)) fs.rmSync(path.join(DECK_DIR, f));
    }
    fs.rmSync(path.join(DECK_DIR, '.deck-editor'), { recursive: true, force: true });
    const assets = path.join(DECK_DIR, 'assets');
    for (const f of fs.readdirSync(assets)) if (f !== 'shape.svg') fs.rmSync(path.join(assets, f));
    fs.rmSync(path.join(DECK_DIR, 'fonts'), { recursive: true, force: true });
}
const readDeck = () => fs.readFileSync(DECK, 'utf8');

/* Chrome puts a synthetic mouse event exactly where it is asked to; Playwright's Firefox up to
   about a pixel away. slack(k) is a pixel and a half in stage px at scale k (in screen px
   without k), and 0 in Chrome, so Chrome keeps exact checks. near() checks within a slack. */
const slack = (k = 1) => test.info().project.name === 'firefox' ? 1.5 / k : 0;
function near(actual, expected, tol, what = '') {
    expect(Math.abs(actual - expected), `${what} ${actual} should be ${expected} (within ${tol})`.trim()).toBeLessThanOrEqual(tol + 1e-6);
}

async function openDeck(page) {
    // The fixture runs scripts of its own (charts, generated content): the user trusts it, as
    // they would their own deck (serve.py pauses a deck's own scripts until then; test 62).
    await page.request.post('/api/trust?file=' + encodeURIComponent(FILE) + '&on=1');
    await page.goto('/?file=' + FILE);
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
    await page.waitForFunction(() => window.deckEditor.deck.doc.fonts.status === 'loaded');
    await page.waitForTimeout(900);     // let the reveal transitions of the first slide finish
}

/* Client coordinates of a point given in stage pixels. */
async function stagePoint(page, sx, sy) {
    return page.evaluate(([sx, sy]) => {
        const d = window.deckEditor.deck;
        const w = document.getElementById('stageWrap').getBoundingClientRect();
        const s = d.stage.getBoundingClientRect(), k = d.scale;
        return { x: w.left + s.left + sx * k, y: w.top + s.top + sy * k };
    }, [sx, sy]);
}
/* Stage-space rect of a deck element. */
async function stageRect(page, selector) {
    return page.evaluate((sel) => window.deckEditor.deck.stageRect(window.deckEditor.deck.doc.querySelector(sel)), selector);
}
async function centre(page, selector) {
    const r = await stageRect(page, selector);
    return stagePoint(page, r.x + r.w / 2, r.y + r.h / 2);
}
async function drag(page, from, to, { alt = false, ctrl = false } = {}) {
    if (alt) await page.keyboard.down('Alt');
    if (ctrl) await page.keyboard.down('Control');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 5, from.y + 5);
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    if (ctrl) await page.keyboard.up('Control');
    if (alt) await page.keyboard.up('Alt');
}
async function save(page) {
    await page.evaluate(() => window.deckEditor.save());
    await page.waitForFunction(() => !window.deckEditor.dirty);
}
const scale = (page) => page.evaluate(() => window.deckEditor.deck.scale);
const goTo = async (page, i) => { await page.evaluate((i) => window.deckEditor.deck.goTo(i), i); await page.waitForTimeout(1000); };
const IMPORT_DIR = path.join(__dirname, 'fixtures', 'import');
const WS = path.join(__dirname, '.tmp-workspace');
const own = { Origin: 'http://127.0.0.1:8811' };

/* Every test starts from the fixture deck as it is on disk, with every panel section open
   (a new user sees some folded; test 63 checks that). */
function freshDeckEachTest() {
    test.beforeEach(async ({ page }) => {
        resetDeck();
        // The panel folds its secondary sections for a new user; the tests reach into every field,
        // so they start with all of them open (test 63 checks the folding itself).
        await page.addInitScript(() => { try { if (!sessionStorage.getItem('fold-test')) localStorage.setItem('diapo-panel-folded', '[]'); } catch (e) { /* ignore */ } });
    });
}

module.exports = { test, expect, fs, path, freshDeckEachTest, DECK, DECK_DIR, FILE, FIXTURE, IMPORT_DIR, WS, centre, drag, goTo, near, openDeck, own, readDeck, resetDeck, save, scale, slack, stagePoint, stageRect };
