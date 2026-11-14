// Three canvas fixes: files dropped from the computer land where they are dropped, new elements
// stop piling up in the centre (one placement routine for every insert), and changing slides
// while editing shows the slide as it ends up unless Look > Play entrances is on.
const { test, expect, fs, path, freshDeckEachTest, DECK_DIR, goTo, near, openDeck, stagePoint } = require('./helpers');

freshDeckEachTest();

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGP4z8AARwzIHABvqgf5gNwAKAAAAABJRU5ErkJggg==';   // 4 x 2 px, red

const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;

/* A blank slide after the current one, made current. */
async function blankSlide(page) {
    await page.evaluate(() => window.deckEditor.strip.addSlide(window.deckEditor.deck.current, 'blank'));
    await page.waitForTimeout(400);
}

/* Drag files over a point and drop them, the way the browser does: dragover, then drop, on the
   element under the point, in the deck's document (inDeck) or the editor's. Files are
   [name, type, base64]. Returns what the overlay said during the dragover. */
async function dropFiles(page, files, client, { inDeck = true } = {}) {
    return page.evaluate(([files, client, inDeck]) => {
        const ed = window.deckEditor;
        const dt = new DataTransfer();
        for (const [name, type, b64] of files) {
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            dt.items.add(new File([bytes], name, { type }));
        }
        let doc = document, x = client.x, y = client.y;
        if (inDeck) {
            const f = ed.deck.iframe.getBoundingClientRect();
            doc = ed.deck.doc; x -= f.left; y -= f.top;
        }
        const target = doc.elementFromPoint(x, y) || doc.body;
        const opts = { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true };
        const over = new DragEvent('dragover', opts);
        target.dispatchEvent(over);
        const o = document.querySelector('.drop-overlay');
        const said = o && !o.hidden ? o.textContent : null;
        target.dispatchEvent(new DragEvent('drop', opts));
        return { said, prevented: over.defaultPrevented };
    }, [files, client, inDeck]);
}

test('placement: the routine picks the centre, else the freest grid spot nearest it, else the cascade', async ({ page }) => {
    await openDeck(page);
    const r = await page.evaluate(async () => {
        const { choosePlace } = await import('/core/placement.js');
        const S = { stageW: 1920, stageH: 1080 };
        const chart = { x: 410, y: 230, w: 1100, h: 620 };
        return {
            empty: choosePlace({ w: 400, h: 120, ...S }),
            besideChart: choosePlace({ w: 400, h: 120, ...S, rects: [chart] }),
            full: choosePlace({ w: 400, h: 300, ...S, rects: [{ x: 0, y: 0, w: 1920, h: 1080 }], cascade: 2 }),
            wide: choosePlace({ w: 1900, h: 100, ...S, rects: [{ x: 0, y: 490, w: 1920, h: 100 }] }),
            chart,
        };
    });
    expect(r.empty).toEqual({ x: 760, y: 480, how: 'centre' });
    // Next to the chart (above or below it), clear of it, inside the 54 px margins, centred across.
    expect(r.besideChart.how).toBe('grid');
    expect(overlaps({ ...r.besideChart, w: 400, h: 120 }, r.chart)).toBe(false);
    expect(r.besideChart.x).toBe(760);
    expect(r.besideChart.y).toBeGreaterThanOrEqual(54);
    expect(r.besideChart.y + 120).toBeLessThanOrEqual(1080 - 54);
    // Nothing is free: the cascade from the centre, two steps along.
    expect(r.full).toEqual({ x: 760 + 48, y: 390 + 48, how: 'cascade' });
    // Wider than the space between the margins: centred across, moved off the band in the middle.
    expect(r.wide.x).toBe(10);
    expect(overlaps({ ...r.wide, w: 1900, h: 100 }, { x: 0, y: 490, w: 1920, h: 100 })).toBe(false);
});

test('placement: a chart, an equation, a structure, a text box and a shape inserted in turn do not land on each other', async ({ page }) => {
    test.setTimeout(60000);
    await openDeck(page);
    await blankSlide(page);
    const rects = await page.evaluate(async () => {
        const ed = window.deckEditor, ins = ed.insert;
        const els = [ins.chart(), await ins.equation(), await ins.structure(), ins.text('Note'), ins.rect(false)];
        ed.textEdit.commit();
        await new Promise(r => setTimeout(r, 300));
        return els.map(el => ed.deck.stageRect(el));
    });
    // The first one is in the middle of the empty slide.
    expect(Math.round(rects[0].x + rects[0].w / 2)).toBe(960);
    expect(Math.round(rects[0].y + rects[0].h / 2)).toBe(540);
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        expect(r.x, `element ${i} inside the slide`).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(1920);
        expect(r.y + r.h).toBeLessThanOrEqual(1080);
        // The equation and the text box find room clear of everything. A 520 x 400 structure or a
        // 420 x 260 rectangle cannot clear an 1100 x 620 chart on a 1920 x 1080 slide: each takes
        // the spot that covers least, off to one side, never the chart's middle.
        for (let j = 0; j < i; j++) {
            const q = rects[j];
            if (i === 1 || i === 3 || j === 1 || j === 3) { expect(overlaps(r, q), `element ${i} over element ${j}`).toBe(false); continue; }
            const ox = Math.max(0, Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x)), oy = Math.max(0, Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y));
            expect(ox * oy / Math.min(r.w * r.h, q.w * q.h), `element ${i} covers element ${j} by less than half`).toBeLessThan(0.5);
        }
        if (i > 0) expect(Math.abs(r.x + r.w / 2 - 960) > 300 || Math.abs(r.y + r.h / 2 - 540) > 300, `element ${i} off the middle`).toBe(true);
    }
});

test('placement: on a full slide inserts fall back to the cascade, and undo takes an insert away whole', async ({ page }) => {
    await openDeck(page);
    await blankSlide(page);
    const r = await page.evaluate(() => {
        const ed = window.deckEditor, ins = ed.insert;
        // Twelve 600 x 340 cards fill the slide (none is ground: each is under 60% of it).
        const slide = ed.deck.currentSlide;
        for (let i = 0; i < 12; i++) {
            const d = ed.deck.doc.createElement('div');
            d.style.cssText = `position:absolute; left:${(i % 4) * 480}px; top:${Math.floor(i / 4) * 360}px; width:480px; height:360px; background:#ccc;`;
            slide.appendChild(d);
        }
        const a = ins.rect(false), b = ins.rect(false);
        return { a: ed.deck.stageRect(a), b: ed.deck.stageRect(b), n: slide.children.length };
    });
    near(r.b.x - r.a.x, 24, 0.01);
    near(r.b.y - r.a.y, 24, 0.01);
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.children.length)).toBe(r.n - 1);
});

test('drop: pictures dropped on the slide are uploaded and centred where they fell, several cascade, one undo step', async ({ page }) => {
    await openDeck(page);
    await blankSlide(page);
    const at = await stagePoint(page, 500, 400);
    const res = await dropFiles(page, [['dot.png', 'image/png', PNG_1x1], ['dot2.png', 'image/png', PNG_1x1]], at);
    expect(res.prevented).toBe(true);
    expect(res.said).toBe('Drop to add to this slide');
    await page.waitForFunction(() => window.deckEditor.deck.currentSlide.querySelectorAll('img').length === 2);
    await page.waitForTimeout(300);
    const imgs = await page.evaluate(() => Array.from(window.deckEditor.deck.currentSlide.querySelectorAll('img')).map(i => ({ src: i.getAttribute('src'), r: window.deckEditor.deck.stageRect(i) })));
    expect(imgs.map(i => i.src).sort()).toEqual(['assets/dot.png', 'assets/dot2.png']);
    expect(fs.existsSync(path.join(DECK_DIR, 'assets', 'dot.png'))).toBe(true);
    // A 2:1 picture 640 px wide, centred on the drop point; the second 24 px further on.
    const [a, b] = imgs.map(i => i.r);
    expect(Math.round(a.w)).toBe(640);
    expect(Math.round(a.h)).toBe(320);
    // A drag event carries whole screen pixels: within a couple of stage pixels at this zoom.
    near(a.x + a.w / 2, 500, 2.5);
    near(a.y + a.h / 2, 400, 2.5);
    expect(Math.round(b.x - a.x)).toBe(24);
    expect(Math.round(b.y - a.y)).toBe(24);
    expect(await page.evaluate(() => window.deckEditor.selection.items.length)).toBe(2);
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await page.evaluate(() => window.deckEditor.deck.currentSlide.querySelectorAll('img').length)).toBe(0);
});

test('drop: on the grey around the slide (the editor document) it lands on the slide, kept whole on it; other files are refused with a toast', async ({ page }) => {
    await openDeck(page);
    await blankSlide(page);
    // Left of the slide, in the canvas but outside the deck's frame.
    const p = await page.evaluate(() => { const c = document.getElementById('canvas').getBoundingClientRect(), w = document.getElementById('stageWrap').getBoundingClientRect(); return { x: Math.max(c.left + 4, w.left - 8), y: w.top + 60 }; });
    const sound = Buffer.from('RIFF0000WAVEfmt ').toString('base64');
    await dropFiles(page, [['beep.wav', 'audio/wav', sound]], p, { inDeck: false });
    await page.waitForFunction(() => window.deckEditor.deck.currentSlide.querySelector('audio'));
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => window.deckEditor.deck.stageRect(window.deckEditor.deck.currentSlide.querySelector('audio')));
    expect(Math.round(r.x)).toBe(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => window.deckEditor.selection.primary && window.deckEditor.selection.primary.tagName)).toBe('AUDIO');

    await dropFiles(page, [['notes.zip', 'application/zip', 'UEsDBA==']], await stagePoint(page, 960, 540));
    await expect(page.locator('.toast.show')).toContainText('Not added: notes.zip');
    expect(fs.existsSync(path.join(DECK_DIR, 'assets', 'notes.zip'))).toBe(false);
});

test('drop: a Markdown file dropped on the window is offered as a new deck and opens in a tab', async ({ page }) => {
    await openDeck(page);
    const before = await page.evaluate(() => window.deckEditor.deck.file);
    let asked = '';
    page.once('dialog', d => { asked = d.message(); d.accept(); });
    const md = Buffer.from('# Dropped deck\n\n## Second slide\n\n- one point\n').toString('base64');
    const res = await dropFiles(page, [['dropped-notes.md', 'text/markdown', md]], { x: 20, y: 20 }, { inDeck: false });
    expect(res.said).toBe('Drop to import as a new deck');
    await page.waitForFunction((b) => window.deckEditor.deck.isOpen && window.deckEditor.deck.file !== b, before, { timeout: 15000 });
    expect(asked).toContain('dropped-notes.md');
    const file = await page.evaluate(() => window.deckEditor.deck.file);
    expect(file).toMatch(/dropped-notes\/index\.html$/);
    fs.rmSync(path.join(path.dirname(DECK_DIR), path.dirname(file)), { recursive: true, force: true });
});

/* The state of the new slide the moment the editor hears of the change (the 'slide' event, before a paint). */
async function changeAndLook(page, to) {
    return page.evaluate((to) => new Promise((resolve) => {
        const d = window.deckEditor.deck;
        const on = () => {
            d.removeEventListener('slide', on);
            const s = d.currentSlide, rv = s.querySelector('.reveal');
            const running = d.stage.getAnimations({ subtree: true }).filter(a => a.playState === 'running' && a.effect.getComputedTiming().iterations !== Infinity).length;
            resolve({ visible: s.classList.contains('visible'), opacity: rv ? getComputedStyle(rv).opacity : null, running, reveal: !!rv });
        };
        d.addEventListener('slide', on);
        d.goTo(to);
    }), to);
}

test('entrances: changing slides while editing shows the slide as it ends up; Look > Play entrances brings them back, remembered', async ({ page }) => {
    await openDeck(page);
    const target = await page.evaluate(() => window.deckEditor.deck.slides.findIndex((s, i) => i > 0 && s.querySelector('.reveal')));
    expect(target).toBeGreaterThan(0);
    // Off by default: visible at once, nothing fading in.
    await expect(page.locator('#btnEntrancesState')).toHaveText('off');
    let s = await changeAndLook(page, target);
    expect(s).toEqual({ visible: true, opacity: '1', running: 0, reveal: true });
    s = await changeAndLook(page, 0);
    expect(s.visible).toBe(true);
    expect(s.running).toBe(0);

    // On: the deck marks the slide .visible a frame later, and the reveal plays.
    await page.click('#btnLook');
    await page.click('#btnEntrances');
    await expect(page.locator('#btnEntrancesState')).toHaveText('on');
    s = await changeAndLook(page, target);
    expect(s.visible).toBe(false);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => window.deckEditor.deck.stage.getAnimations({ subtree: true }).length)).toBeGreaterThan(0);

    // Remembered per browser.
    await page.reload();
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen);
    await expect(page.locator('#btnEntrancesState')).toHaveText('on');
    expect(await page.evaluate(() => window.deckEditor.deck.playEntrances)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('deck-editor-entrances'))).toBe('1');
});

test('entrances: preview still plays them, and the Animation Play button still replays a preset', async ({ page }) => {
    await openDeck(page);
    const target = await page.evaluate(() => window.deckEditor.deck.slides.findIndex((s, i) => i > 0 && s.querySelector('.reveal')));
    await page.keyboard.press('F5');
    await page.waitForFunction(() => window.deckEditor.preview);
    const s = await changeAndLook(page, target);
    expect(s.visible).toBe(false);                 // the deck adds it a frame later and the reveal runs
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.deckEditor.preview);
    await goTo(page, 0);

    // A preset on the editor's slide: settled on a change of slide, replayed by Play.
    const running = await page.evaluate(async (target) => {
        const ed = window.deckEditor, d = ed.deck;
        const el = d.slides[target].querySelector('.reveal');
        const { applyPreset, deckRevealClasses, replay } = await import('/core/animate.js');
        applyPreset(ed.history, d, el, 'fade', deckRevealClasses(d.doc));
        d.goTo(target);
        await new Promise(r => setTimeout(r, 200));
        const settled = el.getAnimations().filter(a => a.playState === 'running').length;
        replay(d, null);
        const played = el.getAnimations().filter(a => a.playState === 'running').length;
        return { settled, played };
    }, target);
    expect(running.settled).toBe(0);
    expect(running.played).toBe(1);
});
