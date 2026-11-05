// Lines and arrows: draw, end and bend handles, the panel, undo, save, copy and paste, older arrows.
// Run with: npx playwright test tests/arrows.spec.js   (from the deck-editor folder)
const { test, expect, freshDeckEachTest, openDeck, readDeck, save, stagePoint, goTo } = require('./helpers');

freshDeckEachTest();

const SEL = 'svg[data-line]';
const model = (page) => page.evaluate((sel) => {
    const el = window.deckEditor.deck.doc.querySelector(sel);
    const r = window.deckEditor.deck.stageRect(el);
    const nums = (s) => (s || '').split(/\s+/).filter(Boolean).map(Number);
    // The ends in stage px, whatever the box has been fitted to.
    const l = nums(el.getAttribute('data-line')), c = nums(el.getAttribute('data-curve'));
    return { line: l, curve: c, abs: [r.x + l[0], r.y + l[1], r.x + l[2], r.y + l[3]], w: r.w, h: r.h, d: el.querySelectorAll('path').length, el: el.outerHTML };
}, SEL);
const labels = (page) => page.evaluate(() => window.deckEditor.history.undoStack.length);

/* Client position of one handle of the selected line. */
const handle = (page, which) => page.evaluate((w) => {
    const r = document.querySelector(`.ov-lh[data-lh="${w}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, which);

async function drawArrow(page, kind, from, to) {
    await page.evaluate((k) => window.deckEditor.insert.drawLine(k), kind);
    const a = await stagePoint(page, from[0], from[1]), b = await stagePoint(page, to[0], to[1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 6, a.y + 3);
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
}

test('arrow: drawn by dragging, one undo step, ends where the pointer was', async ({ page }) => {
    await openDeck(page);
    const before = await labels(page);
    await drawArrow(page, 'arrow', [300, 700], [900, 700]);
    const m = await model(page);
    expect(Math.abs(m.abs[0] - 300)).toBeLessThan(8);
    expect(Math.abs(m.abs[2] - 900)).toBeLessThan(8);
    expect(m.line.length).toBe(4);
    expect(m.curve.length).toBe(0);
    expect(m.d).toBe(3);                          // hit path, stroke, head
    expect(await labels(page)).toBe(before + 1);
    expect(await page.evaluate(() => window.deckEditor.selection.items.length)).toBe(1);
    // The box and rotation handles give way to the end handles.
    await expect(page.locator('.ov-lh[data-lh="a"]')).toBeVisible();
    await expect(page.locator('.ov-main .ov-h[data-h="se"]')).toBeHidden();
    await expect(page.locator('.ov-rot')).toBeHidden();
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await page.locator(SEL).count()).toBe(0);
    await page.evaluate(() => window.deckEditor.history.redo());
    expect(await page.locator(SEL).count()).toBe(0);      // (the deck is in the iframe)
    expect(await page.evaluate((s) => window.deckEditor.deck.doc.querySelectorAll(s).length, SEL)).toBe(1);
});

test('arrow: a click places a default one; the menu offers curved and double arrows', async ({ page }) => {
    await openDeck(page);
    await page.click('#btnInsert');
    await page.click('[data-insert="curved"]');
    const p = await stagePoint(page, 960, 500);
    await page.mouse.click(p.x, p.y);
    const m = await model(page);
    expect(m.curve.length).toBe(2);
    await page.evaluate(() => window.deckEditor.insert.line('double'));
    const heads = await page.evaluate((s) => Array.from(window.deckEditor.deck.doc.querySelectorAll(s)).map(e => [e.getAttribute('data-head-start'), e.getAttribute('data-head-end')]), SEL);
    expect(heads).toEqual([[null, 'arrow'], ['arrow', 'arrow']]);
});

test('arrow: dragging an end, Shift snaps to 15 degrees, the other end stays put; one undo step', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.insert.line('arrow'));
    const m0 = await model(page);
    const n = await labels(page);
    const h = await handle(page, 'b');
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 20, h.y + 40, { steps: 5 });
    await page.mouse.move(h.x - 60, h.y + 130, { steps: 8 });
    await page.mouse.up();
    const m1 = await model(page);
    expect(Math.abs(m1.abs[0] - m0.abs[0])).toBeLessThan(0.6);
    expect(Math.abs(m1.abs[1] - m0.abs[1])).toBeLessThan(0.6);
    expect(m1.abs[3] - m1.abs[1]).toBeGreaterThan(60);
    expect(await labels(page)).toBe(n + 1);
    // Shift: the angle is a multiple of 15 degrees.
    const h2 = await handle(page, 'b');
    await page.keyboard.down('Shift');
    await page.mouse.move(h2.x, h2.y);
    await page.mouse.down();
    await page.mouse.move(h2.x + 10, h2.y - 10, { steps: 3 });
    await page.mouse.move(h2.x + 130, h2.y - 77, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const m2 = await model(page);
    const deg = Math.atan2(m2.abs[3] - m2.abs[1], m2.abs[2] - m2.abs[0]) * 180 / Math.PI;
    expect(Math.abs(deg / 15 - Math.round(deg / 15))).toBeLessThan(0.02);
    await page.evaluate(() => { window.deckEditor.history.undo(); window.deckEditor.history.undo(); });
    const m3 = await model(page);
    expect(m3.abs.map(Math.round)).toEqual(m0.abs.map(Math.round));
});

test('arrow: the middle handle bends it, double-click straightens, panel keeps the stroke width as pixels', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.insert.line('arrow'));
    const m0 = await model(page);
    const h = await handle(page, 'c');
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 3, h.y - 10, { steps: 3 });
    await page.mouse.move(h.x, h.y - 120, { steps: 8 });
    await page.mouse.up();
    const m1 = await model(page);
    expect(m1.curve.length).toBe(2);
    expect(m1.h).toBeGreaterThan(m0.h + 60);                 // the box grew with the bend
    // The end points did not move.
    expect(Math.abs(m1.abs[0] - m0.abs[0])).toBeLessThan(0.6);
    expect(Math.abs(m1.abs[3] - m0.abs[3])).toBeLessThan(0.6);
    // Straighten by double-click on the handle.
    const h2 = await handle(page, 'c');
    await page.mouse.dblclick(h2.x, h2.y);
    expect((await model(page)).curve.length).toBe(0);
    await page.evaluate(() => window.deckEditor.history.undo());
    expect((await model(page)).curve.length).toBe(2);
    // Resizing the box does not exist for lines; the stroke width is the attribute in px.
    expect(await page.evaluate((s) => window.deckEditor.deck.doc.querySelector(s).getAttribute('stroke-width'), SEL)).toBe('6');
});

test('arrow: the panel changes width, heads, dashes and shape; undo restores', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.insert.line('arrow'));
    await expect(page.locator('#inspArrow')).toBeVisible();
    await expect(page.locator('#inspW')).toBeHidden();
    const n = await labels(page);
    await page.locator('#lnWidth').fill('14');
    expect(await page.evaluate((s) => window.deckEditor.deck.doc.querySelector(s).getAttribute('stroke-width'), SEL)).toBe('14');
    await page.selectOption('#lnStart', 'circle');
    await page.selectOption('#lnEnd', 'triangle');
    await page.click('#lnDash [data-v="dashed"]');
    await page.click('#lnShape [data-v="curved"]');
    const m = await model(page);
    expect(m.curve.length).toBe(2);
    expect(m.el).toContain('data-head-start="circle"');
    expect(m.el).toContain('data-head-end="triangle"');
    expect(m.el).toContain('stroke-dasharray');
    expect(m.d).toBe(4);
    await page.click('[data-ln="flip"]');
    expect((await model(page)).el).toContain('data-head-start="triangle"');
    for (let i = 0; i < 6; i++) await page.evaluate(() => window.deckEditor.history.undo());
    const back = await model(page);
    expect(back.el).toContain('stroke-width="6"');
    expect(back.el).not.toContain('data-curve');
    expect(back.el).not.toContain('data-head-start');
    expect(await labels(page)).toBe(n);
});

test('arrow: saved, reopened, copied and pasted keeps its geometry', async ({ page, context }) => {
    if (test.info().project.name === 'chrome') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openDeck(page);
    await drawArrow(page, 'curved', [400, 600], [1200, 760]);
    const m0 = await model(page);
    await save(page);
    expect(readDeck()).toContain('data-line="');
    expect(readDeck()).toContain('data-curve="');
    await page.reload();
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
    await page.waitForTimeout(900);
    const m1 = await model(page);
    expect(m1.line).toEqual(m0.line);
    expect(m1.curve).toEqual(m0.curve);
    // Copy and paste onto another slide.
    await page.evaluate((s) => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector(s)), SEL);
    await page.keyboard.press('Control+c');
    await goTo(page, 2);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(400);
    const pasted = await page.evaluate((s) => Array.from(window.deckEditor.deck.currentSlide.querySelectorAll(s)).map(e => [e.getAttribute('data-line'), e.getAttribute('data-curve')]), SEL);
    expect(pasted).toEqual([[m0.el.match(/data-line="([^"]+)"/)[1], m0.el.match(/data-curve="([^"]+)"/)[1]]]);
});

test('arrow: moves with the keys and with the box, and an older arrow stays a plain box that can be made editable', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => {
        const a = window.deckEditor, doc = a.deck.doc;
        const old = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        old.setAttribute('viewBox', '0 0 480 24'); old.setAttribute('fill', 'none'); old.setAttribute('stroke', '#2f6fed'); old.setAttribute('stroke-width', '6');
        old.innerHTML = '<path d="M6 12h460"/><path d="m448 2 20 10-20 10"/>';
        old.style.cssText = 'position:absolute; left:300px; top:800px; width:480px; height:24px; overflow:visible; max-width:none; max-height:none;';
        a.history.insert(old, a.deck.currentSlide, null, 'old arrow');
        a.selection.select(old);
    });
    const r0 = await page.evaluate(() => { const r = window.deckEditor.deck.stageRect(window.deckEditor.selection.primary); return [r.x, r.y, r.w, r.h]; });
    await page.keyboard.press('ArrowRight');
    const r1 = await page.evaluate(() => { const r = window.deckEditor.deck.stageRect(window.deckEditor.selection.primary); return [r.x, r.y, r.w, r.h]; });
    expect(Math.abs(r1[0] - r0[0] - 1)).toBeLessThan(0.01);
    await expect(page.locator('.ov-main .ov-h[data-h="se"]')).toBeVisible();      // still a plain box
    await expect(page.locator('#inspArrow')).toBeVisible();
    await page.click('[data-ln="upgrade"]');
    const e = await page.evaluate(() => window.deckEditor.selection.primary.outerHTML);
    expect(e).toContain('data-line=');
    expect(e).toContain('data-head-end="arrow"');
    const r2 = await page.evaluate(() => { const el = window.deckEditor.selection.primary; const r = window.deckEditor.deck.stageRect(el); const l = el.getAttribute('data-line').split(' ').map(Number); return [r.x + l[0], r.y + l[1], r.x + l[2], r.y + l[3]]; });
    expect(Math.abs(r2[0] - (r1[0] + 6))).toBeLessThan(1.5);
    expect(Math.abs(r2[2] - (r1[0] + 468))).toBeLessThan(1.5);
    await expect(page.locator('.ov-lh[data-lh="b"]')).toBeVisible();
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await page.evaluate(() => window.deckEditor.selection.primary.hasAttribute('data-line'))).toBe(false);
});
