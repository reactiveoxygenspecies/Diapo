// The Layers list: the slide's elements front to back above the panel; select, hide, lock,
// rename, reorder by drag, and following undo, slide changes, deck tabs.
const { test, expect, fs, path, freshDeckEachTest, openDeck, goTo, FIXTURE, WS } = require('./helpers');

freshDeckEachTest();

const rows = (page) => page.locator('#layersList .layer-row');
const names = (page) => page.locator('#layersList .layer-row .lr-name').allTextContents();
const row = (page, name) => page.locator('#layersList .layer-row', { has: page.locator('.lr-name', { hasText: name }) });
const selected = (page) => page.evaluate(() => window.deckEditor.selection.items.map(e => e.getAttribute('data-name') || e.tagName));
const undoDepth = (page) => page.evaluate(() => window.deckEditor.history.undoStack.length);

/* The title slide plus three free elements (Alpha, Beta, Gamma, in that file order, so Gamma is on top),
   the layers list open. */
async function setup(page, { open = true } = {}) {
    await openDeck(page);
    await page.evaluate(() => {
        const a = window.deckEditor, doc = a.deck.doc, slide = a.deck.currentSlide;
        for (const [n, x, y] of [['Alpha', 100, 700], ['Beta', 200, 720], ['Gamma', 300, 740]]) {
            const d = doc.createElement('div');
            d.setAttribute('data-name', n); d.setAttribute('data-edit', '');
            d.style.cssText = `position:absolute; left:${x}px; top:${y}px; width:240px; height:90px;`;
            d.textContent = n + ' text';
            a.history.insert(d, slide);
        }
    });
    if (open) {
        await page.keyboard.press('Control+Shift+L');
        await expect(page.locator('#layersPane')).toHaveClass(/open/);
        await expect(row(page, 'Gamma')).toHaveCount(1);
    }
}

test('layers: opens with Ctrl+Shift+L and the palette, lists the slide front to back, and is remembered', async ({ page }) => {
    await setup(page, { open: false });
    await expect(page.locator('#layersPane .layers-body')).toBeHidden();
    await page.keyboard.press('Control+Shift+L');
    await expect(page.locator('#layersPane .layers-body')).toBeVisible();
    // Gamma is last in the file, so on top; then the slide's own things, passing through the content box.
    const list = await names(page);
    expect(list.slice(0, 3)).toEqual(['Alpha', 'Beta', 'Gamma'].reverse());
    expect(list.some(n => /heading: Sample deck title/.test(n))).toBe(true);
    expect(list.some(n => /^(div|section)/.test(n) && /content/.test(n))).toBe(false);   // the plain wrapper is not a row
    // The same order as the layer commands see (z-index, then the file), top first.
    const expected = await page.evaluate(() => {
        const a = window.deckEditor, g = a.deck.doc.querySelector('[data-name=Gamma]');
        return a.editops.stack(g).map(s => s.el.getAttribute('data-name') || '').reverse().slice(0, 3);
    });
    expect(expected).toEqual(['Gamma', 'Beta', 'Alpha']);
    // A z-index on Alpha puts it first.
    await page.evaluate(() => {
        const a = window.deckEditor, al = a.deck.doc.querySelector('[data-name=Alpha]');
        a.history.style(al, () => { al.style.zIndex = '5'; }, { label: 'z' });
    });
    await expect.poll(() => names(page).then(n => n.slice(0, 3))).toEqual(['Alpha', 'Gamma', 'Beta']);
    // Closed from the palette entry, open again from the bar; the choice survives a reload.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('hide layers');
    await page.keyboard.press('Enter');
    await expect(page.locator('#layersPane .layers-body')).toBeHidden();
    await page.click('#btnLayers');
    await expect(page.locator('#layersPane .layers-body')).toBeVisible();
    await page.reload();
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen);
    await expect(page.locator('#layersPane .layers-body')).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
});

test('layers: a click selects, the canvas selection lights the row, Ctrl and Shift add', async ({ page }) => {
    await setup(page);
    await row(page, 'Beta').click();
    expect(await selected(page)).toEqual(['Beta']);
    await expect(row(page, 'Beta')).toHaveClass(/sel/);
    await expect(page.locator('#overlay .ov-main')).toBeVisible();
    // From the canvas the other way.
    await page.evaluate(() => { const a = window.deckEditor; a.selection.select(a.deck.doc.querySelector('[data-name=Gamma]')); });
    await expect(row(page, 'Gamma')).toHaveClass(/sel/);
    await expect(row(page, 'Beta')).not.toHaveClass(/sel/);
    await row(page, 'Alpha').click({ modifiers: ['Control'] });
    expect(await selected(page)).toEqual(['Gamma', 'Alpha']);
    await row(page, 'Beta').click({ modifiers: ['Control'] });
    await row(page, 'Beta').click({ modifiers: ['Control'] });
    expect(await selected(page)).toEqual(['Gamma', 'Alpha']);
    // Shift takes the rows between the last plain pick and this one.
    await row(page, 'Gamma').click();
    await row(page, 'Alpha').click({ modifiers: ['Shift'] });
    expect((await selected(page)).sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
    // Pointing at a row points at the element on the canvas.
    await page.evaluate(() => window.deckEditor.selection.clear());
    await row(page, 'Beta').hover();
    await expect(page.locator('#overlay .ov-hover')).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(page.locator('#overlay .ov-hover')).toBeHidden();
});

test('layers: dragging a row restacks the element, one undo step', async ({ page }) => {
    await setup(page);
    const before = await undoDepth(page);
    const src = await row(page, 'Alpha').boundingBox(), dst = await row(page, 'Gamma').boundingBox();
    await page.mouse.move(src.x + 60, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + 60, src.y + src.height / 2 - 8, { steps: 3 });
    await page.mouse.move(dst.x + 60, dst.y + 3, { steps: 6 });
    await expect(row(page, 'Gamma')).toHaveClass(/drop-above/);
    await page.mouse.up();
    await expect.poll(() => names(page).then(n => n.slice(0, 3))).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(await undoDepth(page)).toBe(before + 1);
    // On the slide too: Alpha now paints over Gamma.
    const top = await page.evaluate(() => {
        const a = window.deckEditor, s = a.deck.currentSlide;
        const stack = a.editops.stack(s.querySelector('[data-name=Alpha]'));
        return stack[stack.length - 1].el.getAttribute('data-name');
    });
    expect(top).toBe('Alpha');
    await page.evaluate(() => window.deckEditor.history.undo());
    await expect.poll(() => names(page).then(n => n.slice(0, 3))).toEqual(['Gamma', 'Beta', 'Alpha']);
    expect(await undoDepth(page)).toBe(before);
    await page.evaluate(() => window.deckEditor.history.redo());
    await expect.poll(() => names(page).then(n => n.slice(0, 3))).toEqual(['Alpha', 'Gamma', 'Beta']);
    // Below a row works too, and a click that ends a drag does not select.
    const b = await row(page, 'Alpha').boundingBox(), c = await row(page, 'Beta').boundingBox();
    await page.mouse.move(b.x + 60, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + 14, { steps: 3 });
    await page.mouse.move(c.x + 60, c.y + c.height - 3, { steps: 6 });
    await expect(row(page, 'Beta')).toHaveClass(/drop-below/);
    await page.mouse.up();
    await expect.poll(() => names(page).then(n => n.slice(0, 3))).toEqual(['Gamma', 'Beta', 'Alpha']);
    expect(await selected(page)).toEqual([]);
});

test('layers: the eye hides and shows, the lock locks and unlocks, as the panel does', async ({ page }) => {
    await setup(page);
    const beta = (p) => p.evaluate(() => { const e = window.deckEditor.deck.doc.querySelector('[data-name=Beta]'); return { hidden: e.getAttribute('data-hidden'), display: e.style.display, locked: e.hasAttribute('data-locked') }; });
    const before = await undoDepth(page);
    await row(page, 'Beta').hover();
    await row(page, 'Beta').locator('.lr-eye').click();
    expect(await beta(page)).toMatchObject({ hidden: '1', display: 'none' });
    await expect(row(page, 'Beta')).toHaveClass(/is-hidden/);
    expect(await undoDepth(page)).toBe(before + 1);
    // A hidden one has nothing on the canvas to select.
    await row(page, 'Beta').click();
    expect(await selected(page)).toEqual([]);
    await row(page, 'Beta').locator('.lr-eye').click();
    expect(await beta(page)).toMatchObject({ hidden: null, display: '' });
    await expect(row(page, 'Beta')).not.toHaveClass(/is-hidden/);

    await row(page, 'Beta').locator('.lr-lock').click();
    expect((await beta(page)).locked).toBe(true);
    await expect(row(page, 'Beta')).toHaveClass(/is-locked/);
    // A locked one is still selectable here (as with Ctrl+click), and the panel says so.
    await row(page, 'Beta').click();
    expect(await selected(page)).toEqual(['Beta']);
    await expect(page.locator('#inspLock')).toHaveText('Unlock');
    await row(page, 'Beta').locator('.lr-lock').click();
    expect((await beta(page)).locked).toBe(false);
    await expect(page.locator('#inspLock')).toHaveText('Lock');
    // Hiding an element that is not selected leaves the selection alone.
    await row(page, 'Beta').click();
    await row(page, 'Alpha').locator('.lr-eye').click();
    expect(await selected(page)).toEqual(['Beta']);
    await page.evaluate(() => window.deckEditor.history.undo());
    await expect(row(page, 'Alpha')).not.toHaveClass(/is-hidden/);
});

test('layers: a group is a row that opens onto its children', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
        const a = window.deckEditor, doc = a.deck.doc, slide = a.deck.currentSlide;
        const g = doc.createElement('div');
        g.setAttribute('data-group', ''); g.setAttribute('data-name', 'Pair');
        g.style.cssText = 'position:absolute; left:900px; top:600px; width:400px; height:200px;';
        for (const [n, x] of [['Left', 0], ['Right', 200]]) {
            const c = doc.createElement('div');
            c.setAttribute('data-name', n); c.setAttribute('data-edit', '');
            c.style.cssText = `position:absolute; left:${x}px; top:0; width:180px; height:100px;`;
            c.textContent = n + ' text';
            g.appendChild(c);
        }
        a.history.insert(g, slide);
    });
    await expect(row(page, 'Pair')).toHaveCount(1);
    await expect(row(page, 'Pair').locator('.lr-ico')).toBeVisible();
    await expect(row(page, 'Left')).toHaveCount(0);
    await row(page, 'Pair').locator('.lr-twist').click();
    await expect(row(page, 'Left')).toHaveCount(1);
    expect(await row(page, 'Left').getAttribute('style')).toContain('--depth:1');
    expect((await names(page)).slice(0, 3)).toEqual(['Pair', 'Right', 'Left']);
    await row(page, 'Left').click();
    expect(await selected(page)).toEqual(['Left']);
    // Selecting something inside a closed group on the canvas opens the group (and a group with
    // a selected child stays open, so the row can be seen).
    await page.evaluate(() => window.deckEditor.selection.clear());
    await row(page, 'Pair').locator('.lr-twist').click();
    await expect(row(page, 'Left')).toHaveCount(0);
    await page.evaluate(() => { const a = window.deckEditor; a.selection.select(a.deck.doc.querySelector('[data-name=Right]')); });
    await expect(row(page, 'Right')).toHaveClass(/sel/);
    // Children are ordered among themselves.
    const src = await row(page, 'Left').boundingBox(), dst = await row(page, 'Right').boundingBox();
    await page.mouse.move(src.x + 60, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + 60, src.y + 4, { steps: 3 });
    await page.mouse.move(dst.x + 60, dst.y + 3, { steps: 6 });
    await page.mouse.up();
    expect((await names(page)).slice(0, 3)).toEqual(['Pair', 'Left', 'Right']);
});

test('layers: the footer layer is its own folded section', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
        const a = window.deckEditor, doc = a.deck.doc;
        const f = doc.createElement('div');
        f.setAttribute('data-name', 'Footer note'); f.setAttribute('data-edit', '');
        f.style.cssText = 'position:absolute; left:80px; bottom:30px; width:400px; height:40px;';
        f.textContent = 'Every slide';
        a.history.insert(f, a.deck.stage);
    });
    const sec = page.locator('#layersList .layer-sec');
    await expect(sec).toHaveCount(1);
    await expect(sec).toContainText('On every slide');
    await expect(row(page, 'Footer note')).toHaveCount(0);        // folded
    await sec.click();
    await expect(row(page, 'Footer note')).toHaveCount(1);
    // It comes after the slide's own rows, and selects the master element.
    expect((await names(page)).pop()).toBe('Footer note');
    await row(page, 'Footer note').click();
    expect(await selected(page)).toEqual(['Footer note']);
    await expect(page.locator('#inspRole')).toContainText('on every slide');
    // The same footer on another slide: still there, still folded state kept.
    await goTo(page, 1);
    await expect(row(page, 'Footer note')).toHaveCount(1);
    expect((await names(page)).some(n => /Alpha/.test(n))).toBe(false);
    // A row of the footer is not ordered against the slide's.
    await goTo(page, 0);
});

test('layers: it follows undo, redo and slide changes, and rename and the keys work', async ({ page }) => {
    await setup(page);
    const base = (await names(page)).length;
    await page.evaluate(() => {
        const a = window.deckEditor, d = a.deck.doc.createElement('div');
        d.setAttribute('data-name', 'Delta'); d.setAttribute('data-edit', '');
        d.style.cssText = 'position:absolute; left:500px; top:300px; width:200px; height:60px;';
        d.textContent = 'Delta text';
        a.history.insert(d, a.deck.currentSlide);
    });
    await expect(row(page, 'Delta')).toHaveCount(1);
    expect((await names(page))[0]).toBe('Delta');
    await page.evaluate(() => window.deckEditor.history.undo());
    await expect(row(page, 'Delta')).toHaveCount(0);
    expect((await names(page)).length).toBe(base);
    await page.evaluate(() => window.deckEditor.history.redo());
    await expect(row(page, 'Delta')).toHaveCount(1);
    // Another slide, another list.
    await goTo(page, 1);
    await expect(row(page, 'Delta')).toHaveCount(0);
    expect((await names(page)).some(n => /A chart and a scheme/.test(n))).toBe(true);
    await goTo(page, 0);
    await expect(row(page, 'Delta')).toHaveCount(1);

    // Rename: double-click the name, Enter; one undo step; the panel shows it.
    const depth = await undoDepth(page);
    await row(page, 'Delta').locator('.lr-name').dblclick();
    await expect(page.locator('#layersList .lr-rename')).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Renamed');
    await page.keyboard.press('Enter');
    await expect(row(page, 'Renamed')).toHaveCount(1);
    expect(await undoDepth(page)).toBe(depth + 1);
    await page.evaluate(() => window.deckEditor.history.undo());
    await expect(row(page, 'Delta')).toHaveCount(1);
    // Esc leaves the name as it was.
    await row(page, 'Delta').locator('.lr-name').dblclick();
    await page.keyboard.type('zzz');
    await page.keyboard.press('Escape');
    await expect(row(page, 'Delta')).toHaveCount(1);
    expect(await undoDepth(page)).toBe(depth);

    // Keys: the arrows move through the rows, Enter selects, Delete deletes.
    await row(page, 'Delta').click();
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'Gamma')).toHaveClass(/cur/);
    expect(await selected(page)).toEqual(['Delta']);          // moving is not selecting
    await page.keyboard.press('Enter');
    expect(await selected(page)).toEqual(['Gamma']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    expect(await selected(page)).toEqual(['Beta']);
    await page.keyboard.press('Delete');
    await expect(row(page, 'Beta')).toHaveCount(0);
    expect(await page.evaluate(() => !!window.deckEditor.deck.doc.querySelector('[data-name=Beta]'))).toBe(false);
    await page.keyboard.press('Control+z');
    await expect(row(page, 'Beta')).toHaveCount(1);
    // The canvas keys are not taken: arrows in the list did not nudge anything.
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('[data-name=Beta]').style.left)).toBe('200px');
});

test('layers: a slide with 120 elements redraws only when it changed', async ({ page }) => {
    await setup(page, { open: false });
    await page.evaluate(() => {
        const a = window.deckEditor, doc = a.deck.doc, slide = a.deck.currentSlide;
        a.history.begin('many');
        for (let i = 0; i < 120; i++) {
            const d = doc.createElement('div');
            d.setAttribute('data-name', 'E' + i); d.setAttribute('data-edit', '');
            d.style.cssText = `position:absolute; left:${(i % 12) * 150}px; top:${Math.floor(i / 12) * 90}px; width:140px; height:60px;`;
            d.textContent = 'E' + i;
            a.history.insert(d, slide);
        }
        a.history.end();
    });
    await page.keyboard.press('Control+Shift+L');
    await expect(row(page, 'E119')).toHaveCount(1);
    expect(await rows(page).count()).toBeGreaterThanOrEqual(120);
    // One drawing of the list takes well under a second.
    const ms = await page.evaluate(() => { const l = window.deckEditor.layers; l._html = ''; const t = performance.now(); l.render(); return performance.now() - t; });
    expect(ms).toBeLessThan(400);
    // Selecting does not rebuild the rows: the very same node is still there.
    await page.evaluate(() => { document.querySelector('#layersList .layer-row').dataset.same = '1'; });
    await page.locator('#layersList .layer-row', { has: page.locator('.lr-name', { hasText: /^E5$/ }) }).click();
    await page.locator('#layersList .layer-row', { has: page.locator('.lr-name', { hasText: /^E7$/ }) }).click({ modifiers: ['Control'] });
    expect(await page.evaluate(() => document.querySelector('#layersList .layer-row').dataset.same)).toBe('1');
    // And a rebuild that comes out the same leaves the DOM alone as well.
    await page.evaluate(() => window.deckEditor.layers.render());
    expect(await page.evaluate(() => document.querySelector('#layersList .layer-row').dataset.same)).toBe('1');
});

test.describe('deck tabs', () => {
    const B_FILE = 'second/index.html';
    test.beforeEach(async ({ page }) => {
        const B_PATH = path.join(WS, 'second', 'index.html');
        fs.rmSync(path.join(WS, 'second'), { recursive: true, force: true });
        fs.cpSync(path.dirname(FIXTURE), path.join(WS, 'second'), { recursive: true });
        fs.writeFileSync(B_PATH, fs.readFileSync(B_PATH, 'utf8').replace('Sample deck title', 'Second deck title'));
        await page.request.post('/api/trust?file=' + encodeURIComponent(B_FILE) + '&on=1');
    });
    test('layers: another deck tab shows its own elements', async ({ page }) => {
        await setup(page);
        await expect(row(page, 'Sample deck title')).toHaveCount(1);
        await page.evaluate((f) => window.deckEditor.openDeck(f), B_FILE);
        await expect.poll(() => page.evaluate(() => window.deckEditor.file)).toBe(B_FILE);
        await expect(row(page, 'Second deck title')).toHaveCount(1);
        await expect(row(page, 'Alpha')).toHaveCount(0);
        await page.click('.deck-tab >> nth=0');
        await expect.poll(() => page.evaluate(() => window.deckEditor.file)).toBe('sample/index.html');
        await expect(row(page, 'Alpha')).toHaveCount(1);
        await expect(row(page, 'Second deck title')).toHaveCount(0);
    });
});
