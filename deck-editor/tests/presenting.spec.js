// Presenting: the runtime in the saved deck (presenter, fragments, morph, laser, drawing, transitions, links, self-running) and its updates.
// Run with: npx playwright test   (from the deck-editor folder)
const { test, expect, fs, path, freshDeckEachTest, DECK, FILE, centre, drag, goTo, near, openDeck, own, readDeck, save, scale, slack, stageRect } = require('./helpers');

freshDeckEachTest();

/* ------------------------------------------------------------
   12. Standalone presenter (no editor): S opens it from the file itself
   ------------------------------------------------------------ */
test('12 standalone presenter (P): added through the editor, works from the saved file and from file://', async ({ page, context }) => {
    await openDeck(page);
    const original = readDeck();
    await page.evaluate(() => window.deckEditor.inspector.applyNotes('Standalone notes.'));
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await page.waitForFunction(() => window.deckEditor.deck.doc.getElementById('deck-runtime'));
    await save(page);
    const saved = readDeck();
    expect(saved).toMatch(/<script id="deck-runtime">[\s\S]*DECK RUNTIME[\s\S]*<\/script>\n<\/body>/);
    expect(saved).not.toContain('deck-editor-host');
    // Everything else is unchanged.
    const stripped = saved
        .replace(/<aside class="notes" hidden>[^<]*<\/aside>/, '<aside class="notes">Notes for slide one.</aside>')
        .replace(/\n<script id="deck-runtime">[\s\S]*?<\/script>\n<\/body>/, '\n</body>');
    expect(stripped).toBe(original);
    // A deck carrying an older edition of the script gets the current one with the next save.
    await page.evaluate(() => { const s = window.deckEditor.deck.doc.getElementById('deck-runtime'); s.textContent = s.textContent.replace(/version: \d+ \}/, 'version: 3 }'); });
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.doc.querySelector('h1')); ed.selection.nudge(1, 0); });
    await save(page);
    expect(readDeck()).not.toMatch(/version: 3 \}/);
    expect(readDeck()).toMatch(/DECK RUNTIME[\s\S]*version: (9|\d\d) \}/);
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.doc.querySelector('h1')); ed.selection.nudge(-1, 0); });
    await save(page);

    for (const url of ['/deck/' + FILE, 'file:///' + DECK.replace(/\\/g, '/')]) {
        const deck = await context.newPage();
        await deck.goto(url);
        await deck.waitForSelector('.slide.active');
        const [pop] = await Promise.all([context.waitForEvent('page'), deck.keyboard.press('p')]);
        await pop.waitForLoadState();
        await expect(pop.locator('#now')).toHaveText('1');
        await expect(pop.locator('#total')).toHaveText('3');
        await expect(pop.locator('#notes')).toHaveText('Standalone notes.');
        await expect.poll(() => pop.evaluate(() => document.getElementById('cur').src)).toMatch(/#1$/);
        await expect.poll(() => pop.evaluate(() => document.getElementById('next').src)).toMatch(/#2$/);
        // Arrow in the presenter moves the deck; arrow in the deck moves the presenter.
        await pop.bringToFront();
        await pop.keyboard.press('ArrowRight');
        await expect.poll(() => deck.evaluate(() => Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('active')))).toBe(1);
        await expect(pop.locator('#now')).toHaveText('2');
        await deck.bringToFront();
        await deck.keyboard.press('ArrowRight');
        await expect(pop.locator('#now')).toHaveText('3');
        await expect(pop.locator('#end')).toBeVisible();
        await pop.close();
        await deck.close();
    }
});

/* ------------------------------------------------------------
   14. Animation presets
   ------------------------------------------------------------ */
test('14 animation: a preset replaces the deck reveal, keeps the move, plays in the saved file, and undoes cleanly', async ({ page, context }) => {
    await openDeck(page);
    const original = readDeck();
    // The title has the deck's reveal; the panel says so.
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await expect(page.locator('#animNow')).toContainText("The deck's own entrance");
    await page.evaluate(() => window.deckEditor.selection.nudge(40, -20));
    await page.click('#animGrid [data-anim="fade-up"]');
    await expect(page.locator('#animNow')).toContainText('Fade up');
    await page.fill('#animDelay', '0.3');
    await page.locator('#animDelay').dispatchEvent('change');
    const h1 = await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); return { anim: h.dataset.anim, was: h.dataset.animWas, cls: h.className, style: h.getAttribute('style') }; });
    expect(h1).toEqual({ anim: 'fade-up', was: 'reveal', cls: '', style: '--i: 1; translate: 40px -20px; --anim-delay: 0.3s;' });
    await save(page);
    const saved = readDeck();
    expect(saved).toMatch(/@keyframes de-fade-up/);
    expect(saved).toMatch(/\.slide\.visible \[data-anim="fade-up"\]:not\(\[data-fragment\]\)[^{]*\{ animation: de-fade-up/);

    // The saved file animates on its own: the title ends at full opacity, moved by (40, -20).
    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE);
    await deck.waitForSelector('.slide.active.visible');
    await deck.waitForFunction(() => { const h = document.querySelector('h1'); return getComputedStyle(h).animationName === 'de-fade-up'; });
    await expect.poll(() => deck.evaluate(() => getComputedStyle(document.querySelector('h1')).opacity), { timeout: 5000 }).toBe('1');
    expect(await deck.evaluate(() => getComputedStyle(document.querySelector('h1')).translate)).toBe('40px -20px');
    await deck.close();

    // None gives the reveal back, with the move as --dx/--dy; undo everything -> original file.
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await page.click('#animGrid [data-anim=""]');
    expect(await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); return h.className + ' | ' + h.getAttribute('style'); })).toBe('reveal | --i: 1; --dx: 40px; --dy: -20px;');
    expect(await page.evaluate(() => window.deckEditor.deck.serialize({ isEdited: () => false }).includes('deck-editor-overrides'))).toBe(false);
    await page.evaluate(() => { const h = window.deckEditor.history; while (h.canUndo) h.undo(); });
    await save(page);
    // Back to the state saved with the preset; then undoing that too reaches the original.
    expect(readDeck()).toMatch(/data-anim="fade-up"/);
    await page.evaluate(() => { const a = window.deckEditor; a.selection.select(a.deck.doc.querySelector('h1')); });
    await page.click('#animGrid [data-anim=""]');
    await page.evaluate(() => window.deckEditor.selection.nudge(-40, 20));
    await save(page);
    // A fresh session cannot restore the exact "--i:1" spelling (the CSSOM writes "--i: 1;"); everything else is back.
    expect(readDeck().replace('<h1 class="reveal" style="--i: 1;"', '<h1 class="reveal" style="--i:1"')).toBe(original);
});

/* ------------------------------------------------------------
   15. Fragments, overview and auto-animate in the standalone deck
   ------------------------------------------------------------ */
test('15 runtime: fragments step with Space, O opens the overview, auto-animate morphs into the next slide', async ({ page, context }) => {
    await openDeck(page);
    // Slide 3: make the three list items fragments (second and third together), give it the runtime.
    await goTo(page, 2);
    await page.evaluate(() => { const a = window.deckEditor; const lis = a.deck.doc.querySelectorAll('.slide.active li'); a.selection.set(Array.from(lis)); });
    await page.check('#animFragment');
    await page.evaluate(() => { const a = window.deckEditor; const lis = a.deck.doc.querySelectorAll('.slide.active li'); a.selection.set([lis[1], lis[2]]); });
    await page.fill('#animFragIndex', '5');
    await page.locator('#animFragIndex').dispatchEvent('change');
    const frag = await page.evaluate(() => Array.from(window.deckEditor.deck.doc.querySelectorAll('.slide.active li')).map(li => [li.hasAttribute('data-fragment'), li.getAttribute('data-fragment-index'), li.getAttribute('data-anim'), li.className]));
    expect(frag).toEqual([[true, null, 'fade', ''], [true, '5', 'fade', ''], [true, '5', 'fade', '']]);
    // Slide 1 auto-animates into slide 2 (a duplicate with the title moved).
    await goTo(page, 0);
    await page.check('#inspAutoAnimate');
    expect(await page.evaluate(() => { const s = window.deckEditor.deck.slides[0]; return [s.hasAttribute('data-auto-animate'), s.querySelector('h1').getAttribute('data-id')]; })).toEqual([true, 'el-2']);
    await page.evaluate(() => window.deckEditor.strip.duplicateSlide(0));
    await page.waitForTimeout(300);
    await page.evaluate(() => { const a = window.deckEditor; a.selection.select(a.deck.doc.querySelectorAll('.slide')[1].querySelector('h1')); a.selection.nudge(300, 200); });
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await save(page);
    const saved = readDeck();
    expect(saved).toContain('data-fragment-index="5"');
    expect(saved).toMatch(/<section class="slide title-slide active" data-name="title" data-auto-animate>/);

    // The deck on its own.
    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE);
    await deck.waitForSelector('.slide.active.visible');
    await deck.waitForFunction(() => window.deckRuntime);
    // Fragments: Space reveals step 1, then step 2 (two items together), then the slide changes.
    await deck.evaluate(() => window.deckRuntime.goTo(3));       // the bullets slide (after the duplicate)
    await deck.waitForFunction(() => document.querySelectorAll('.slide')[3].classList.contains('visible'));
    const shown = () => deck.evaluate(() => Array.from(document.querySelectorAll('.slide')[3].querySelectorAll('li')).map(li => li.classList.contains('visible')));
    expect(await shown()).toEqual([false, false, false]);
    await deck.keyboard.press('Space');
    expect(await shown()).toEqual([true, false, false]);
    await deck.keyboard.press('ArrowRight');
    expect(await shown()).toEqual([true, true, true]);
    expect(await deck.evaluate(() => document.querySelectorAll('.slide')[3].classList.contains('active'))).toBe(true);
    await deck.keyboard.press('ArrowLeft');
    expect(await shown()).toEqual([true, false, false]);
    await deck.keyboard.press('ArrowLeft');
    expect(await shown()).toEqual([false, false, false]);
    await deck.keyboard.press('ArrowLeft');       // no fragments left: previous slide, with its fragments all shown
    await expect.poll(() => deck.evaluate(() => Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('active')))).toBe(2);
    // Overview: O opens a grid with one tile per slide, clicking a tile jumps, O closes.
    await deck.keyboard.press('o');
    await expect(deck.locator('.deck-overview .ov-tile')).toHaveCount(4);
    // The tiles never overlap (each frame keeps the deck's aspect ratio and the rows are sized to it),
    // every tile is captioned with its number, and the current slide is the highlighted one.
    const layout = await deck.evaluate(() => {
        const tiles = Array.from(document.querySelectorAll('.deck-overview .ov-tile'));
        const r = tiles.map(t => t.getBoundingClientRect());
        const overlap = r.some((a, i) => r.some((b, j) => j > i && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
        const f = tiles[0].querySelector('.ov-frame').getBoundingClientRect();
        return { overlap, ratio: f.width / f.height, numbers: tiles.map(t => t.querySelector('.ov-n').textContent), current: tiles.findIndex(t => t.classList.contains('current')) };
    });
    expect(layout.overlap).toBe(false);
    expect(layout.ratio).toBeCloseTo(16 / 9, 1);
    expect(layout.numbers).toEqual(['1', '2', '3', '4']);
    expect(layout.current).toBe(2);
    // Arrows move the highlight without leaving the overview; Enter opens the highlighted slide.
    await deck.keyboard.press('ArrowRight');
    await expect(deck.locator('.deck-overview .ov-tile.current .ov-n')).toHaveText('4');
    await deck.keyboard.press('ArrowLeft');
    await deck.keyboard.press('ArrowLeft');
    await expect(deck.locator('.deck-overview .ov-tile.current .ov-n')).toHaveText('2');
    await deck.keyboard.press('Enter');
    await expect(deck.locator('.deck-overview')).toHaveCount(0);
    await expect.poll(() => deck.evaluate(() => Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('active')))).toBe(1);
    // Clicking a tile jumps too.
    await deck.keyboard.press('o');
    await deck.locator('.deck-overview .ov-tile').nth(0).click();
    await expect(deck.locator('.deck-overview')).toHaveCount(0);
    await expect.poll(() => deck.evaluate(() => Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('active')))).toBe(0);
    // Auto-animate: moving to slide 2 morphs the matching title (a transform animation is running on it).
    await deck.keyboard.press('ArrowRight');
    // The morph starts a frame or two after the slide change; catch it while it runs (0.8 s).
    let morph = { count: 0 };
    for (let i = 0; i < 20 && !morph.count; i++) {
        // The morph is the animation with the sampled matrix keyframes (the deck's own CSS transition is there too).
        morph = await deck.evaluate(() => { const h = document.querySelectorAll('.slide')[1].querySelector('h1'); const a = h.getAnimations().filter(a => a.effect.getKeyframes().length > 10); return { count: a.length, keyframe: a.length ? a[0].effect.getKeyframes()[0].transform : '' }; });
        if (!morph.count) await deck.waitForTimeout(25);
    }
    expect(morph.count).toBeGreaterThan(0);
    // The title was moved by (300, 200) on the copy: the first keyframe starts it back where it was.
    const m0 = morph.keyframe.match(/matrix\(([^)]*)\)/)[1].split(',').map(Number);
    expect(Math.abs(m0[4] + 300)).toBeLessThan(2);
    expect(Math.abs(m0[5] + 200)).toBeLessThan(2);
    await deck.close();
});

/* ------------------------------------------------------------
   15b. Morph: shapes into shapes, colours into colours, ghosts for the rest
   ------------------------------------------------------------ */
test('15b morph: Morph from links an element to one on the previous slide; a shape morphs outline to outline, a box tweens its corners and colour, unlike elements cross-fade', async ({ page, context }) => {
    await openDeck(page);
    // Slide A (new, index 1): a rectangle, a star and a text. Slide B (index 2): an ellipse, a chevron and another text.
    await page.evaluate(() => { const ed = window.deckEditor; ed.strip.addSlide(0, 'blank'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const ed = window.deckEditor; ed.insert.rect(); ed.insert.shape('star'); const t = ed.insert.text('Alpha'); ed.textEdit.commit(); ed.selection.select(t); ed.selection.nudge(0, 400); ed.selection.clear(); });
    await page.check('#inspAutoAnimate');
    const idsA = await page.evaluate(() => Array.from(window.deckEditor.deck.slides[1].children).map(e => e.tagName.toLowerCase() + ':' + e.getAttribute('data-id')));
    expect(idsA).toEqual(['div:el-1', 'svg:el-2', 'div:el-3']);          // the empty div (a shape) gets an id too
    await page.evaluate(() => { const ed = window.deckEditor; ed.strip.addSlide(1, 'blank'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const ed = window.deckEditor; const e = ed.insert.rect(true); ed.selection.select(e); ed.selection.nudge(500, 100); const c = ed.insert.shape('chevron'); ed.selection.select(c); ed.selection.nudge(-300, 300); const t = ed.insert.text('Beta'); ed.textEdit.commit(); ed.selection.select(t); ed.selection.nudge(600, 500); });
    // The Morph from row lists the previous slide's elements; choosing one shares its data-id.
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.children[0]); });
    await expect(page.locator('#animMorphRow')).toBeVisible();
    const options = await page.evaluate(() => Array.from(document.querySelectorAll('#animMorph option')).map(o => o.textContent));
    expect(options).toEqual(['(nothing: it fades in)', 'box (div)', 'shape (svg)', 'text: Alpha']);
    await page.selectOption('#animMorph', '0');
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.children[1]); });
    await page.selectOption('#animMorph', '1');
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.children[2]); });
    await page.selectOption('#animMorph', '2');
    expect(await page.evaluate(() => Array.from(window.deckEditor.deck.slides[2].children).map(e => e.getAttribute('data-id')))).toEqual(['el-1', 'el-2', 'el-3']);
    expect(await page.evaluate(() => document.querySelector('#animMorph').value)).toBe('2');
    // Undo takes one link away (back to the id it was inserted with); "(nothing)" gives the element an id of its own.
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.slides[2].children[2].getAttribute('data-id'))).toBe('el-6');
    await page.keyboard.press('Control+y');
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.children[2]); });
    await page.selectOption('#animMorph', '');
    expect(await page.evaluate(() => window.deckEditor.deck.slides[2].children[2].getAttribute('data-id'))).toMatch(/^el-\d+$/);
    expect(await page.evaluate(() => window.deckEditor.deck.slides[2].children[2].getAttribute('data-id'))).not.toBe('el-3');
    await page.selectOption('#animMorph', '2');
    // Names: the panel's header field names an element (data-name); the list shows names, and two
    // unnamed alike get their ids after. A same-slide duplicate takes a fresh id.
    await goTo(page, 1);
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.children[1]); });
    expect(await page.evaluate(() => document.querySelector('#inspName').placeholder)).toBe('Shape');
    await page.fill('#inspName', 'Star');
    await page.locator('#inspName').dispatchEvent('change');
    expect(await page.evaluate(() => window.deckEditor.deck.slides[1].children[1].getAttribute('data-name'))).toBe('Star');
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.children[0]); ed.insert.duplicateSelection(); });
    const idsDup = await page.evaluate(() => Array.from(window.deckEditor.deck.slides[1].children).map(e => e.getAttribute('data-id')));
    expect(idsDup.length).toBe(4);
    expect(new Set(idsDup).size).toBe(4);                                    // the copy took an id of its own
    expect(idsDup[1]).toMatch(/^el-\d+$/);
    await goTo(page, 2);
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.children[1]); });
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('#animMorph option')).map(o => o.textContent))).toEqual(['(nothing: it fades in)', 'box (div) · el-1', 'box (div) · ' + idsDup[1], 'Star', 'text: Alpha']);
    expect(await page.evaluate(() => document.querySelector('#animMorph').value)).toBe('2');
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.children[0]); });
    await page.selectOption('#animMorph', '0');
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.children[0]); ed.selection.setRotation ? ed.selection.setRotation(30) : (ed.deck.currentSlide.children[0].style.rotate = '30deg'); });
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await save(page);

    // The deck on its own: A to B morphs.
    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE + '#2');
    await deck.waitForSelector('.slide.active.visible');
    await deck.waitForFunction(() => window.deckRuntime);
    await deck.waitForTimeout(400);
    const chevronD = await deck.evaluate(() => document.querySelectorAll('.slide')[2].querySelector('svg path').getAttribute('d'));
    const stageBox = (sel) => deck.evaluate((sel) => { const st = document.querySelector('.deck-stage'), k = parseFloat(getComputedStyle(st).transform.split('(')[1]) || 1; const r = document.querySelector(sel).getBoundingClientRect(), s = st.getBoundingClientRect(); return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k }; }, sel);
    const rectA = await stageBox('.slide:nth-of-type(2) > div');
    await deck.keyboard.press('ArrowRight');
    // The ellipse on B is turned 30 degrees; at the start of the morph it sits exactly in the
    // rectangle's box (a pose, not a bounding box, is what tweens), and its transform keyframes
    // are matrices that end where the element's own transforms leave it.
    await deck.waitForFunction(() => document.querySelectorAll('.slide')[2].children[0].getAnimations().some(a => a.effect.getKeyframes().some(k => k.transform)));
    const start = await deck.evaluate(() => { const el = document.querySelectorAll('.slide')[2].children[0]; const a = el.getAnimations().find(a => a.effect.getKeyframes().some(k => k.transform)); a.pause(); a.currentTime = 0; const st = document.querySelector('.deck-stage'), k = parseFloat(getComputedStyle(st).transform.split('(')[1]) || 1; const r = el.getBoundingClientRect(), s = st.getBoundingClientRect(); const frames = a.effect.getKeyframes(); const out = { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k, n: frames.length, last: frames[frames.length - 1].transform, rotate: getComputedStyle(el).rotate }; a.play(); return out; });
    expect(start.n).toBeGreaterThan(10);
    expect(start.rotate).toBe('30deg');
    for (const key of ['x', 'y', 'w', 'h']) expect(Math.abs(start[key] - rectA[key])).toBeLessThan(2);
    const last = start.last.match(/matrix\(([^)]*)\)/)[1].split(',').map(Number);
    [1, 0, 0, 1, 0, 0].forEach((v, i) => expect(Math.abs(last[i] - v)).toBeLessThan(0.001));
    let seen = null;
    for (let i = 0; i < 40 && !seen; i++) {
        seen = await deck.evaluate(() => {
            const B = document.querySelectorAll('.slide')[2];
            const [ell, chev] = B.children;
            const d = chev.querySelector('path').getAttribute('d');
            const ghost = B.querySelector('.deck-morph-ghost');
            const radius = ell.getAnimations().some(a => a.effect.getKeyframes().some(k => 'borderTopLeftRadius' in k));
            const polygon = (d.match(/L/g) || []).length > 50;
            return polygon && ghost && radius ? { polygon, ghostText: ghost.textContent, ghostTag: ghost.tagName, radius, moving: chev.getAnimations().length } : null;
        });
        if (!seen) await deck.waitForTimeout(20);
    }
    expect(seen).not.toBeNull();
    expect(seen.ghostText).toBe('Alpha');
    expect(seen.moving).toBeGreaterThan(0);
    // When it is over: the chevron's real path is back, the ghost is gone.
    await deck.waitForTimeout(1200);
    expect(await deck.evaluate(() => document.querySelectorAll('.slide')[2].querySelector('svg path').getAttribute('d'))).toBe(chevronD);
    expect(await deck.evaluate(() => document.querySelectorAll('.deck-morph-ghost').length)).toBe(0);
    await deck.close();
});

/* ------------------------------------------------------------
   16. Laser pointer and drawing layer in the standalone deck
   ------------------------------------------------------------ */
test('16 runtime: L shows a laser dot, D draws on a layer kept per slide and never saved', async ({ page, context }) => {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await save(page);
    const before = readDeck();

    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE);
    await deck.waitForSelector('.slide.active.visible');
    await deck.waitForFunction(() => window.deckRuntime && window.deckRuntime.version >= 3);
    // Laser
    await deck.keyboard.press('l');
    await deck.mouse.move(400, 300);
    await expect(deck.locator('.deck-laser')).toHaveCount(1);
    expect(await deck.evaluate(() => getComputedStyle(document.body).cursor)).toBe('none');
    const laser = await deck.evaluate(() => document.querySelector('.deck-laser').style.left);
    expect(laser).toMatch(/^[\d.]+px$/);
    near(parseFloat(laser), 400, slack(), 'laser x');
    await deck.keyboard.press('l');
    await expect(deck.locator('.deck-laser')).toHaveCount(0);
    // Drawing: two strokes, colour 2, undo one, slide change keeps them per slide
    await deck.keyboard.press('d');
    await expect(deck.locator('.deck-draw')).toHaveCount(1);
    await expect(deck.locator('.deck-draw-bar')).toBeVisible();
    await deck.keyboard.press('2');
    await deck.mouse.move(300, 300); await deck.mouse.down(); await deck.mouse.move(500, 350, { steps: 6 }); await deck.mouse.up();
    await deck.mouse.move(300, 500); await deck.mouse.down(); await deck.mouse.move(600, 520, { steps: 6 }); await deck.mouse.up();
    const strokes = () => deck.evaluate(() => Object.fromEntries(Object.entries(window.deckRuntime.strokes()).map(([k, v]) => [k, v.map(st => [st.colour, st.points.length])])));
    let st = await strokes();
    expect(st['0'].length).toBe(2);
    expect(st['0'][0][0]).toBe('#ffcc00');
    expect(st['0'][0][1]).toBeGreaterThan(2);
    await deck.keyboard.press('Control+z');
    expect((await strokes())['0'].length).toBe(1);
    // Strokes are in stage coordinates: the first point maps back to where the mouse was.
    const p0 = await deck.evaluate(() => { const s = document.querySelector('.deck-stage').getBoundingClientRect(); const k = new DOMMatrix(getComputedStyle(document.querySelector('.deck-stage')).transform).a; const pt = window.deckRuntime.strokes()['0'][0].points[0]; return [Math.round(s.left + pt.x * k), Math.round(s.top + pt.y * k)]; });
    expect(p0).toEqual([300, 300]);
    // Next slide: nothing drawn there; back: the stroke is still there. C clears.
    await deck.keyboard.press('ArrowRight');
    await expect.poll(() => deck.evaluate(() => Array.from(document.querySelectorAll('.slide')).findIndex(x => x.classList.contains('active')))).toBe(1);
    expect(((await strokes())['1'] || []).length).toBe(0);
    await deck.keyboard.press('ArrowLeft');
    expect((await strokes())['0'].length).toBe(1);
    await deck.keyboard.press('c');
    expect((await strokes())['0'].length).toBe(0);
    await deck.keyboard.press('Escape');
    await expect(deck.locator('.deck-draw')).toHaveCount(0);
    expect(await deck.evaluate(() => document.querySelectorAll('.deck-stage canvas').length)).toBe(0);
    await deck.close();
    expect(readDeck()).toBe(before);
});

/* ------------------------------------------------------------
   31. Slide transitions, text effects, sections
   ------------------------------------------------------------ */
test('31 finishing: transitions and text effects play in the saved deck; sections head the strip and the overview', async ({ page, context }) => {
    await openDeck(page);
    // Sections: the slide panel's field starts one; the strip shows a header with the count; folding hides the others.
    await goTo(page, 1);
    await page.fill('#inspSection', 'Results');
    await page.locator('#inspSection').dispatchEvent('change');
    await expect(page.locator('.strip-section .name')).toHaveText('Results');
    await expect(page.locator('.strip-section .count')).toHaveText('2');
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('#stripList > *')).map(e => e.className.split(' ')[0]))).toEqual(['strip-item', 'strip-section', 'strip-item', 'strip-item']);
    await page.click('.strip-section');
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('.strip-item')).map(e => e.hidden))).toEqual([false, false, true]);   // the current slide stays visible
    await page.click('.strip-section');
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('.strip-item')).map(e => e.hidden))).toEqual([false, false, false]);
    expect(await page.evaluate(() => window.deckEditor.deck.slides[1].getAttribute('data-section'))).toBe('Results');
    // Transitions: a deck default and one slide's own; text effect on the heading parks its deck reveal.
    await page.selectOption('#inspTransitionDeck', 'fade');
    await page.selectOption('#inspTransition', 'zoom');
    expect(await page.evaluate(() => [window.deckEditor.deck.stage.getAttribute('data-transition'), window.deckEditor.deck.slides[1].getAttribute('data-transition')])).toEqual(['fade', 'zoom']);
    await goTo(page, 0);
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await page.selectOption('#animTextFx', 'letters');
    const h1 = await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); return { fx: h.getAttribute('data-text-effect'), was: h.getAttribute('data-anim-was'), cls: h.className }; });
    expect(h1).toEqual({ fx: 'letters', was: 'reveal', cls: '' });
    await page.selectOption('#animTextFx', '');
    expect(await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); return [h.hasAttribute('data-text-effect'), h.className]; })).toEqual([false, 'reveal']);
    await page.selectOption('#animTextFx', 'typewriter');
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await save(page);
    const saved = readDeck();
    expect(saved).toContain('<main class="deck-stage" id="deckStage" data-transition="fade">');
    expect(saved).toMatch(/<section class="slide body-slide" data-name="chart" data-section="Results" data-transition="zoom">/);
    expect(saved).toContain('data-text-effect="typewriter"');
    expect(saved).not.toContain('<span class="de-fx"');

    // The deck on its own: the zoom transition animates slide 2, the typewriter wraps then unwraps, O shows the section.
    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE);
    await deck.waitForSelector('.slide.active.visible');
    await deck.waitForFunction(() => window.deckRuntime && window.deckRuntime.version >= 4);
    await deck.evaluate(() => window.deckRuntime.goTo(1));
    let anim = { n: 0 };
    for (let i = 0; i < 20 && !anim.n; i++) {
        anim = await deck.evaluate(() => { const s = document.querySelectorAll('.slide')[1]; const a = s.getAnimations(); return { n: a.length, kf: a.length ? JSON.stringify(a[0].effect.getKeyframes().map(k => k.transform)) : '' }; });
        if (!anim.n) await deck.waitForTimeout(25);
    }
    expect(anim.n).toBeGreaterThan(0);
    expect(anim.kf).toContain('scale(0.92)');
    // The outgoing slide takes part too: kept visible and opaque while the new one comes in over it.
    const out = await deck.evaluate(() => { const s = document.querySelectorAll('.slide')[0]; const a = s.getAnimations(); const cs = getComputedStyle(s); return { n: a.length, visibility: cs.visibility, opacity: cs.opacity }; });
    expect(out.n).toBe(1); expect(out.visibility).toBe('visible'); expect(parseFloat(out.opacity)).toBeGreaterThan(0);   // fading out under the zoom
    await deck.evaluate(() => window.deckRuntime.goTo(0));
    await deck.waitForFunction(() => document.querySelector('h1 .de-fx'));                 // letters wrapped while it types
    const during = await deck.evaluate(() => { const h = document.querySelector('h1'); return { spans: h.querySelectorAll('.de-fx').length, text: h.textContent }; });
    expect(during.spans).toBe('Sample deck title'.length);
    expect(during.text).toBe('Sample deck title');
    await deck.waitForFunction(() => !document.querySelector('h1 .de-fx'), null, { timeout: 5000 });   // and unwrapped afterwards
    expect(await deck.evaluate(() => document.querySelector('h1').innerHTML)).toBe('Sample deck title');
    await deck.keyboard.press('o');
    await expect(deck.locator('.deck-overview .ov-section')).toHaveText('Results');
    await deck.close();
});

/* ------------------------------------------------------------
   32. Links on elements, Alt+drag duplicates, icon set
   ------------------------------------------------------------ */
test('32 links and Alt+drag: an element gets a link that the saved deck opens and the PDF copy carries; Alt+drag makes a moved copy in one step', async ({ page, context }) => {
    await openDeck(page);
    // A link on the heading through the panel; a bare domain gets https://.
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await page.fill('#inspHref', 'example.com/talk');
    await page.locator('#inspHref').dispatchEvent('change');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').getAttribute('data-href'))).toBe('https://example.com/talk');
    expect(await page.locator('#inspHref').inputValue()).toBe('https://example.com/talk');
    // The printable copy wraps it in a real anchor without touching the layout.
    const printable = await page.evaluate(() => window.deckEditor.exporter.printableHtml());
    expect(printable).toMatch(/<a href="https:\/\/example.com\/talk" target="_blank" style="display: contents;"><h1 /);
    // Alt+drag on the chart host makes a copy and moves the copy; the original stays; one undo step removes both.
    await goTo(page, 1);
    const k = await scale(page);
    const before = await stageRect(page, '[data-fig]');
    const c = await centre(page, '[data-fig]');
    await drag(page, c, { x: c.x + 200 * k, y: c.y + 100 * k }, { alt: true });
    const after = await page.evaluate(() => { const hosts = window.deckEditor.deck.doc.querySelectorAll('[data-fig]'); return { n: hosts.length, rects: Array.from(hosts).map(h => window.deckEditor.deck.stageRect(h)), selectedIsCopy: window.deckEditor.selection.primary === hosts[1], top: window.deckEditor.history.top.label }; });
    expect(after.n).toBe(2);
    expect(Math.abs(after.rects[0].x - before.x)).toBeLessThan(1);
    expect(after.rects[1].x - before.x).toBeGreaterThan(150);
    expect(after.selectedIsCopy).toBe(true);
    expect(after.top).toBe('Duplicate');
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('[data-fig]').length)).toBe(1);
    // Ctrl+click selects the exact element; Alt+click without a drag selects as a plain click does.
    await page.keyboard.down('Control');
    const sc = await centre(page, '[data-svg] rect');
    await page.mouse.click(sc.x, sc.y);
    await page.keyboard.up('Control');
    expect(await page.evaluate(() => window.deckEditor.selection.primary.tagName)).toBe('rect');
    await page.mouse.click(sc.x, sc.y);                                  // a plain click keeps the exact pick (it is what a drag would move)
    expect(await page.evaluate(() => window.deckEditor.selection.primary.tagName)).toBe('rect');
    await page.evaluate(() => window.deckEditor.selection.clear());
    await page.keyboard.down('Alt');
    await page.mouse.click(sc.x, sc.y);
    await page.keyboard.up('Alt');
    expect(await page.evaluate(() => window.deckEditor.selection.primary.hasAttribute('data-svg'))).toBe(true);
    // No DNA icon any more.
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('#insertIcons [data-icon]')).map(b => b.dataset.icon))).not.toContain('dna');

    // The saved deck opens the link on click (the runtime), and not while editing.
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await save(page);
    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE);
    await deck.waitForSelector('.slide.active.visible');
    await deck.waitForFunction(() => window.deckRuntime && window.deckRuntime.version >= 5);
    await deck.evaluate(() => { window.__opened = []; window.open = (u, t) => { window.__opened.push([u, t]); return null; }; });
    expect(await deck.evaluate(() => getComputedStyle(document.querySelector('h1')).cursor)).toBe('pointer');
    await deck.click('h1');
    expect(await deck.evaluate(() => window.__opened)).toEqual([['https://example.com/talk', '_blank']]);
    await deck.close();
});

/* ------------------------------------------------------------
   55. Self-running decks and rehearsal
   ------------------------------------------------------------ */
test('55 auto-advance: the panel sets the waits, a rehearsal records them, and the saved deck runs by itself with A, a key stopping it', async ({ page, context }) => {
    await openDeck(page);
    // The panel: this slide's wait, the deck's, and the loop (shown once there is a wait).
    await page.evaluate(() => window.deckEditor.selection.clear());
    await page.waitForTimeout(200);
    await expect(page.locator('#inspLoopRow')).toBeHidden();
    await page.fill('#inspAdvance', '2');
    await page.locator('#inspAdvance').dispatchEvent('change');
    await page.fill('#inspAdvanceDeck', '1');
    await page.locator('#inspAdvanceDeck').dispatchEvent('change');
    await page.waitForTimeout(100);
    await expect(page.locator('#inspLoopRow')).toBeVisible();
    await page.check('#inspLoop');
    expect(await page.evaluate(() => { const ed = window.deckEditor; return [ed.deck.slides[0].getAttribute('data-auto-advance'), ed.deck.stage.getAttribute('data-auto-advance'), ed.deck.stage.hasAttribute('data-loop')]; })).toEqual(['2', '1', true]);
    // A rehearsal times the slides and writes the times in (one undo step).
    await page.evaluate(() => { const ed = window.deckEditor; ed.deck.slides.forEach(s => s.removeAttribute('data-auto-advance')); });
    await page.click('#btnPresenter');
    await page.click('[data-p="rehearse"]');
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.deckEditor.deck.goTo(1));
    await page.waitForTimeout(1200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const timed = await page.evaluate(() => window.deckEditor.deck.slides.map(s => s.getAttribute('data-auto-advance')));
    expect(timed[0]).toMatch(/^[123]$/);
    expect(timed[1]).toMatch(/^[123]$/);
    expect(await page.evaluate(() => window.deckEditor.preview)).toBe(false);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.slides.some(s => s.hasAttribute('data-auto-advance')))).toBe(false);
    await page.keyboard.press('Control+y');
    // A deck without the presentation features script still runs in Preview: the editor steps the
    // slides itself, and the rehearsal's toast says what to add for the rest.
    expect(await page.evaluate(() => !!window.deckEditor.deck.doc.getElementById('deck-runtime'))).toBe(false);
    await page.click('#btnPreview');
    await page.waitForTimeout(200);
    const startAt = await page.evaluate(() => window.deckEditor.deck.current);
    await page.keyboard.press('a');
    await expect.poll(() => page.evaluate(() => window.deckEditor.deck.current), { timeout: 8000 }).toBeGreaterThan(startAt);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // Saved and opened on its own: A runs it, the slide changes by itself, a key stops it.
    await page.evaluate(() => { const ed = window.deckEditor; ed.history.attr(ed.deck.slides[0], 'data-auto-advance', '1', 'x'); ed.history.attr(ed.deck.slides[1], 'data-auto-advance', '1', 'x'); ed.history.attr(ed.deck.stage, 'data-auto-advance', '1', 'x'); });
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await save(page);
    expect(readDeck()).toContain('data-auto-advance="1"');
    const deck = await context.newPage();
    await deck.goto('/deck/' + FILE);
    await deck.waitForSelector('.slide.active.visible');
    await deck.waitForFunction(() => window.deckRuntime && window.deckRuntime.version >= 10);
    // It starts by itself (the deck carries a wait) and moves on.
    await expect.poll(() => deck.evaluate(() => Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('active'))), { timeout: 8000 }).toBeGreaterThan(0);
    expect(await deck.evaluate(() => window.deckRuntime.autoRunning())).toBe(true);
    const at = await deck.evaluate(() => Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('active')));
    await deck.keyboard.press('ArrowRight');
    expect(await deck.evaluate(() => window.deckRuntime.autoRunning())).toBe(false);
    await deck.waitForTimeout(1600);
    expect(await deck.evaluate(() => Array.from(document.querySelectorAll('.slide')).findIndex(s => s.classList.contains('active')))).toBe(at + 1);
    // A starts it again.
    await deck.keyboard.press('a');
    expect(await deck.evaluate(() => window.deckRuntime.autoRunning())).toBe(true);
    await deck.close();
});

/* ------------------------------------------------------------
   56. Older decks are offered the current presentation features
   ------------------------------------------------------------ */
test('56 runtime update: a deck with an older presentation features script offers a button that writes the current one in', async ({ page }) => {
    await openDeck(page);
    // Give the deck an old edition of the script, save, and open it again: the bar offers the update.
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await page.waitForFunction(() => window.deckEditor.deck.doc.getElementById('deck-runtime'));
    await save(page);
    // Age the file on disk (a save would bring it up to date by itself, which is the point).
    const age = () => fs.writeFileSync(DECK, readDeck().replace(/version: \d+ \}/, 'version: 4 }'));
    age();
    expect(readDeck()).toMatch(/version: 4 \}/);
    await openDeck(page);
    await expect(page.locator('.bar.runtime-bar')).toBeVisible();
    await page.click('.bar.runtime-bar [data-a="update"]');
    await expect(page.locator('.bar.runtime-bar')).toHaveCount(0);
    expect(await page.evaluate(() => /version: (1[0-9]|[2-9]\d) \}/.test(window.deckEditor.deck.doc.getElementById('deck-runtime').textContent))).toBe(true);
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(true);
    // Undoable, and saving writes it; a deck that is up to date gets no bar.
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => /version: 4 \}/.test(window.deckEditor.deck.doc.getElementById('deck-runtime').textContent))).toBe(true);
    await page.keyboard.press('Control+y');
    await save(page);
    expect(readDeck()).not.toMatch(/version: 4 \}/);
    await openDeck(page);
    await page.waitForTimeout(600);
    await expect(page.locator('.bar.runtime-bar')).toHaveCount(0);
    // "Not now" keeps it away until the deck is opened again.
    age();
    await openDeck(page);
    await expect(page.locator('.bar.runtime-bar')).toBeVisible();
    await page.click('.bar.runtime-bar [data-a="later"]');
    await openDeck(page);
    await page.waitForTimeout(600);
    await expect(page.locator('.bar.runtime-bar')).toBeVisible();      // a fresh open asks again
});
