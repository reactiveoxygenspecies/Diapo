// The acceptance tests of the brief (section 10): round trip, move, resize, text, colour, slides, insert, draft, safety, presenting.
// Run with: npx playwright test   (from the deck-editor folder)
const { test, expect, fs, path, freshDeckEachTest, DECK, DECK_DIR, FILE, centre, drag, goTo, near, openDeck, own, readDeck, save, scale, slack, stageRect } = require('./helpers');

freshDeckEachTest();

/* ------------------------------------------------------------
   1. Round trip
   ------------------------------------------------------------ */
test('1 round trip: open and save without edits is byte-identical', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 1);            // renders the chart and inlines the SVG on slide 2
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('[data-svg] svg'));
    await goTo(page, 0);
    const original = readDeck();
    await page.evaluate(() => window.deckEditor.save());
    await page.waitForTimeout(500);
    const saved = readDeck();
    expect(saved).toBe(original);
    expect(saved).not.toContain('contenteditable="true"');
    expect(saved).not.toContain('class="plot reveal-img fake-chart"');
    expect(saved).toMatch(/data-svg="assets\/shape.svg">\s*<img/);
    expect(saved).toMatch(/<svg class="dots"[^>]*><\/svg>/);
    expect(saved).toMatch(/id="genKey"><\/div>/);
    // The previous version goes into .deck-editor/ next to the deck, not beside it.
    expect(fs.existsSync(path.join(DECK_DIR, '.deck-editor', 'index.html.bak'))).toBe(true);
    expect(fs.existsSync(DECK + '.bak')).toBe(false);
    // A second save rotates; an old-style backup next to the deck is moved in.
    fs.writeFileSync(DECK + '.~3.bak', 'old');
    await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); const b = h.innerHTML; h.innerHTML = 'x'; window.deckEditor.history.html(h, b, 'x', 'Edit'); });
    await save(page);
    const side = fs.readdirSync(path.join(DECK_DIR, '.deck-editor')).sort();
    expect(side).toEqual(['index.html.bak', 'index.html.~1.bak', 'index.html.~4.bak']);   // the migrated ~3 rotated once
    expect(fs.existsSync(DECK + '.~3.bak')).toBe(false);
    expect(fs.readdirSync(DECK_DIR).filter(f => /\.bak$/.test(f))).toEqual([]);
});

/* ------------------------------------------------------------
   2. Move a reveal heading
   ------------------------------------------------------------ */
test('2 move: dragging a .reveal heading writes --dx/--dy and it still animates', async ({ page }) => {
    await openDeck(page);
    const k = await scale(page);
    const from = await centre(page, 'h1');
    await drag(page, from, { x: from.x + 40 * k, y: from.y - 20 * k }, { ctrl: true });   // Ctrl: no snapping
    const style = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').getAttribute('style'));
    const dx = +(style.match(/--dx: (-?[\d.]+)px/) || [])[1], dy = +(style.match(/--dy: (-?[\d.]+)px/) || [])[1];
    near(dx, 40, slack(k), '--dx');
    near(dy, -20, slack(k), '--dy');
    await save(page);
    expect(readDeck()).toContain(`--dx: ${dx}px; --dy: ${dy}px;`);

    await openDeck(page);
    const cs = await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); const c = window.deckEditor.deck.win.getComputedStyle(h); return { transform: c.transform, transition: c.transitionProperty, opacity: c.opacity }; });
    expect(cs.transform).toBe(`matrix(1, 0, 0, 1, ${dx}, ${dy})`);
    expect(cs.transition).toContain('transform');
    expect(cs.opacity).toBe('1');
});

/* ------------------------------------------------------------
   3. Resize a chart host
   ------------------------------------------------------------ */
test('3 resize: a [data-fig] host re-renders and saves as width/height only', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 1);
    const before = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('[data-fig] .bars').dataset.size);
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('[data-fig]')));
    const h = await page.locator('.ov-h[data-h="se"]').boundingBox();
    await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x - 100, y: h.y - 60 });
    const after = await page.evaluate(() => { const el = window.deckEditor.deck.doc.querySelector('[data-fig]'); return { size: el.querySelector('.bars').dataset.size, style: el.getAttribute('style') }; });
    expect(after.size).not.toBe(before);
    expect(after.style).toMatch(/width: \d+px; height: \d+px/);
    await save(page);
    const saved = readDeck();
    const host = /<div class="plot reveal-img"[^>]*data-fig="demo"[^>]*><\/div>/.exec(saved);
    expect(host).not.toBeNull();
    expect(host[0]).toMatch(/width: \d+px; height: \d+px/);
    expect(host[0]).not.toContain('data-rendered');
});

test('3b resize modifiers: a handle keeps the opposite edge, Alt keeps the centre, Alt+Shift keeps the centre and the ratio', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => { const ed = window.deckEditor; ed.strip.addSlide(1, 'blank'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const ed = window.deckEditor; ed.insert.rect(); });
    const k = await page.evaluate(() => window.deckEditor.deck.scale);
    const rect = () => page.evaluate(() => window.deckEditor.deck.stageRect(window.deckEditor.selection.single));
    const handle = async (name) => { const b = await page.locator(`.ov-h[data-h="${name}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const near = (a, b, tol = 2) => expect(Math.abs(a - b)).toBeLessThan(tol);
    // East handle by +80: the width grows by 80, the left edge and the height stay.
    let r0 = await rect(), h = await handle('e');
    await drag(page, h, { x: h.x + 80 * k, y: h.y });
    let r = await rect();
    near(r.w, r0.w + 80); near(r.x, r0.x); near(r.h, r0.h); near(r.y, r0.y);
    // West handle by -40 with Alt: both sides move, the width grows by 80 and the centre stays.
    r0 = r; h = await handle('w');
    await page.keyboard.down('Alt');
    await drag(page, h, { x: h.x - 40 * k, y: h.y });
    await page.keyboard.up('Alt');
    r = await rect();
    near(r.w, r0.w + 80); near(r.x + r.w / 2, r0.x + r0.w / 2); near(r.h, r0.h); near(r.y + r.h / 2, r0.y + r0.h / 2);
    // South-east corner with Alt+Shift: the ratio and the centre are kept.
    r0 = r; h = await handle('se');
    await page.keyboard.down('Alt'); await page.keyboard.down('Shift');
    await drag(page, h, { x: h.x + 50 * k, y: h.y + 10 * k });
    await page.keyboard.up('Shift'); await page.keyboard.up('Alt');
    r = await rect();
    near(r.w / r.h, r0.w / r0.h, 0.02); near(r.x + r.w / 2, r0.x + r0.w / 2); near(r.y + r.h / 2, r0.y + r0.h / 2);
    expect(r.w).toBeGreaterThan(r0.w + 90);
    // Undo: one step per drag.
    await page.keyboard.press('Control+z');
    near((await rect()).w, r0.w);
    // Text scales its font from a corner: the opposite corner stays; with Alt, its centre does.
    await goTo(page, 0);
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    r0 = await rect(); h = await handle('sw');
    await drag(page, h, { x: h.x - 30 * k, y: h.y + 30 * k });
    r = await rect();
    expect(r.h).toBeGreaterThan(r0.h + 10);
    near(r.x + r.w, r0.x + r0.w); near(r.y, r0.y);
    r0 = r; h = await handle('se');
    await page.keyboard.down('Alt');
    await drag(page, h, { x: h.x + 30 * k, y: h.y + 30 * k });
    await page.keyboard.up('Alt');
    r = await rect();
    expect(r.h).toBeGreaterThan(r0.h + 10);
    near(r.x + r.w / 2, r0.x + r0.w / 2); near(r.y + r.h / 2, r0.y + r0.h / 2);
    // An element in flow keeps its footprint: the first list item grows, the second stays put.
    await goTo(page, 3);                                     // the bullets slide (a blank one was added at 1)
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('.slide.active li')));
    const second = () => page.evaluate(() => window.deckEditor.deck.stageRect(window.deckEditor.deck.doc.querySelectorAll('.slide.active li')[1]));
    const s0 = await second(); r0 = await rect(); h = await handle('se');
    await drag(page, h, { x: h.x + 40 * k, y: h.y + 40 * k });
    r = await rect(); const s1 = await second();
    expect(r.h).toBeGreaterThan(r0.h + 10);
    near(s1.y, s0.y); near(s1.x, s0.x);
    expect(await page.evaluate(() => window.deckEditor.selection.single.style.marginBottom)).toMatch(/^-\d+px$/);
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.selection.single.style.marginBottom)).toBe('');
});

/* ------------------------------------------------------------
   4. Text editing
   ------------------------------------------------------------ */
test('4 text: double-click, type, Esc saves the text; undo works with the edit still open', async ({ page }) => {
    await openDeck(page);
    const c = await centre(page, 'h1');
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    await page.keyboard.press('End');
    await page.keyboard.type(' EDITED');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.deckEditor.textEdit.active)).toBe(false);
    const text1 = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').textContent);
    expect(text1).toContain('EDITED');

    // A second edit left open: Ctrl+Z must commit it and then undo it.
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    await page.keyboard.press('End');
    await page.keyboard.type(' MORE');
    await page.keyboard.press('Control+z');
    const text2 = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').textContent);
    expect(text2).toBe(text1);
    expect(await page.evaluate(() => window.deckEditor.textEdit.active)).toBe(false);

    await save(page);
    expect(readDeck()).toContain('EDITED');
    expect(readDeck()).not.toContain(' MORE');
});

/* ------------------------------------------------------------
   5. Colour inside an inlined SVG
   ------------------------------------------------------------ */
test('5 colour: a recoloured SVG shape keeps the SVG inline; untouched it goes back to <img>', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 1);
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('[data-svg] svg rect'));
    const c = await centre(page, '[data-svg] svg rect');
    await page.keyboard.down('Control');
    await page.mouse.click(c.x, c.y);
    await page.keyboard.up('Control');
    expect(await page.evaluate(() => window.deckEditor.selection.primary.tagName)).toBe('rect');
    await page.click('[data-when="some"] .insp-swatch[data-c="var(--accent-3)"]');
    await save(page);
    let saved = readDeck();
    expect(saved).toMatch(/data-svg="assets\/shape.svg">\s*<svg/);
    expect(saved).toContain('fill: var(--accent-3)');

    await page.keyboard.press('Control+z');
    await save(page);
    saved = readDeck();
    expect(saved).toMatch(/data-svg="assets\/shape.svg">\s*<img src="assets\/shape.svg"/);
    expect(saved).not.toContain('fill: var(--accent-3)');
});

/* ------------------------------------------------------------
   6. Slides
   ------------------------------------------------------------ */
test('6 slides: add, duplicate, reorder, delete survive save and reload', async ({ page }) => {
    await openDeck(page);
    await page.keyboard.press('Control+Shift+m');               // blank slide after slide 1 (Ctrl+M opens the layout picker)
    await page.waitForTimeout(300);
    await page.evaluate(() => window.deckEditor.strip.duplicateSlide(0));
    await page.waitForTimeout(300);
    // order now: title, title(copy), blank, chart, bullets  -> move bullets to the top, delete the blank
    await page.evaluate(() => window.deckEditor.strip.moveSlide(4, 0));
    await page.evaluate(() => window.deckEditor.strip.deleteSlide(3));
    await page.waitForTimeout(300);
    const names = () => page.evaluate(() => window.deckEditor.deck.slides.map(s => s.dataset.name || '(blank)'));
    expect(await names()).toEqual(['bullets', 'title', 'title', 'chart']);
    const stripLabels = await page.locator('.strip-item .thumb-label').allTextContents();
    expect(stripLabels).toEqual(['bullets', 'title', 'title', 'chart']);
    // Clicking a thumbnail navigates (a press without a drag).
    await page.locator('.strip-item').nth(3).click();
    await expect.poll(() => page.evaluate(() => window.deckEditor.deck.current)).toBe(3);
    await page.locator('.strip-item').nth(1).click();
    await expect.poll(() => page.evaluate(() => window.deckEditor.deck.current)).toBe(1);
    await save(page);

    await openDeck(page);
    expect(await names()).toEqual(['bullets', 'title', 'title', 'chart']);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.getElementById('pageTotal').textContent)).toBe('4');
    // The deck's own navigation reaches the last slide.
    await page.evaluate(() => { window.deckEditor.deck.win.location.hash = '#4'; });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.getElementById('pageNow').textContent)).toBe('4');
    expect(await page.evaluate(() => window.deckEditor.deck.current)).toBe(3);
});

/* ------------------------------------------------------------
   7. Insert
   ------------------------------------------------------------ */
test('7 insert: a text box and an uploaded image live inside the slide in stage pixels', async ({ page }) => {
    await openDeck(page);
    await goTo(page, 2);
    await page.click('#btnInsert');
    await page.click('[data-insert="text"]');
    await page.waitForFunction(() => window.deckEditor.textEdit.active);
    await page.keyboard.type('Inserted text');
    await page.keyboard.press('Escape');

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('#insertFile', { name: 'pixel.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('img[src="assets/pixel.png"]'));
    expect(fs.existsSync(path.join(DECK_DIR, 'assets', 'pixel.png'))).toBe(true);
    await save(page);

    await openDeck(page);
    await goTo(page, 2);
    const found = await page.evaluate(() => {
        const s = window.deckEditor.deck.slides[2];
        const t = Array.from(s.querySelectorAll('[data-edit]')).find(e => e.textContent.includes('Inserted text'));
        const img = s.querySelector('img[src="assets/pixel.png"]');
        return { text: t && t.getAttribute('style'), img: img && img.getAttribute('style') };
    });
    expect(found.text).toMatch(/position: absolute; left: \d+px; top: \d+px; width: \d+px/);
    expect(found.img).toMatch(/position: absolute; left: \d+px; top: \d+px; width: \d+px/);
});

/* ------------------------------------------------------------
   8. Draft
   ------------------------------------------------------------ */
test('8 draft: an unsaved edit is offered back after the tab closes; saving clears it', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    let page = await context.newPage();
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(1300);
    expect(fs.existsSync(path.join(DECK_DIR, '.deck-editor', 'index.html.~draft'))).toBe(true);
    await page.close();          // the beforeunload guard does not block a programmatic close

    page = await context.newPage();
    await openDeck(page);
    const bar = page.locator('.bar');
    await expect(bar).toBeVisible();
    await bar.locator('[data-a="keep"]').click();
    await page.waitForFunction(() => window.deckEditor.dirty);
    const style = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').getAttribute('style'));
    expect(style).toContain('--dx: 10px');
    await save(page);
    expect(fs.existsSync(path.join(DECK_DIR, '.deck-editor', 'index.html.~draft'))).toBe(false);
    expect(readDeck()).toContain('--dx: 10px');
    await context.close();
});

/* ------------------------------------------------------------
   9. Server safety
   ------------------------------------------------------------ */
test('9 safety: the save API refuses paths outside the workspace and non-deck bodies', async ({ request }) => {
    const deck = readDeck();
    const outside = await request.post('/api/save?file=../evil.html', { data: deck, headers: { 'Content-Type': 'text/html' } });
    expect(outside.status()).toBe(403);
    const junk = await request.post('/api/save?file=' + FILE, { data: '<html><body>' + 'not a deck '.repeat(40) + '</body></html>', headers: { 'Content-Type': 'text/html' } });
    expect(junk.status()).toBe(400);
    expect(readDeck()).toBe(deck);
    const list = await request.get('/api/list?dir=..');
    expect(list.status()).toBe(403);
    // Names that would land outside the deck's folder: a drive ("C:notes" is a file in drive C's
    // current folder on Windows), a stream, a device name, nothing at all.
    const post = (url) => request.post(url, { data: deck, headers: { 'Content-Type': 'text/html' } });
    const f = encodeURIComponent(FILE);
    for (const to of ['C:notes', 'x:y', 'CON', 'nul.html', ' ', '..', 'a/b']) {
        const t = encodeURIComponent(to);
        expect((await post(`/api/rename?file=${f}&to=${t}`)).status(), 'rename ' + to).toBe(400);
        expect((await post(`/api/duplicate?file=${f}&to=${t}`)).status(), 'duplicate ' + to).toBe(400);
        if (to.trim()) expect((await post(`/api/export?file=${f}&to=${t}`)).status(), 'export ' + to).toBe(400);   // no name: the save dialog
    }
    expect((await post(`/api/saveas?file=${f}&to=${encodeURIComponent('C:notes')}`)).status()).toBe(400);
    expect((await post('/api/new?path=')).status()).toBe(400);
    expect((await post('/api/new?path=%40diapo')).status()).toBe(400);
    expect(fs.existsSync(path.join(DECK_DIR, '..', '..', '.tmp-workspace.html'))).toBe(false);
    expect(readDeck()).toBe(deck);
});

test('9b safety: requests from other origins, other hosts and non-media uploads are refused', async ({ request, page }) => {
    const deck = readDeck();
    const html = { 'Content-Type': 'text/html' };
    // A web page on another site (its browser sends Origin and Sec-Fetch-Site).
    const foreign = await request.post('/api/save?file=' + FILE, { data: deck, headers: { ...html, Origin: 'http://evil.example', 'Sec-Fetch-Site': 'cross-site' } });
    expect(foreign.status()).toBe(403);
    // A form post from a sandboxed frame (Origin: null), and a cross-site request without Origin.
    expect((await request.post('/api/recent?file=' + FILE, { headers: { Origin: 'null' } })).status()).toBe(403);
    expect((await request.post('/api/workspace?path=' + encodeURIComponent(DECK_DIR), { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status()).toBe(403);
    expect((await request.delete('/api/draft?file=' + FILE, { headers: { Origin: 'http://evil.example:8811' } })).status()).toBe(403);
    // DNS rebinding: the request reaches this server but names another host.
    expect((await request.get('/api/status', { headers: { Host: 'evil.example:8811' } })).status()).toBe(403);
    expect((await request.get('/deck/' + FILE, { headers: { Host: 'evil.example:8811' } })).status()).toBe(403);
    // The editor's own origin (and localhost) are fine; so is a non-browser client without either header.
    expect((await request.post('/api/recent?file=' + FILE, { headers: { Origin: 'http://127.0.0.1:8811', 'Sec-Fetch-Site': 'same-origin' } })).status()).toBe(200);
    expect((await request.post('/api/recent?file=' + FILE, { headers: { Origin: 'http://localhost:8811' } })).status()).toBe(200);
    expect((await request.post('/api/recent?file=' + FILE)).status()).toBe(200);
    // Uploads: only media, and only a plain file name.
    const own = { Origin: 'http://127.0.0.1:8811' };
    const bat = await request.post('/api/upload?dir=sample', { headers: own, multipart: { file: { name: 'run.bat', mimeType: 'text/plain', buffer: Buffer.from('echo hi') } } });
    expect(bat.status()).toBe(400);
    expect((await bat.json()).error).toContain('run.bat');
    const png = await request.post('/api/upload?dir=sample', { headers: own, multipart: { file: { name: '../../odd name#1.PNG', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } } });
    expect(png.status()).toBe(200);
    expect((await png.json()).files).toEqual(['assets/odd name_1.png']);
    expect(fs.existsSync(path.join(DECK_DIR, 'assets', 'odd name_1.png'))).toBe(true);
    expect(fs.existsSync(path.join(DECK_DIR, 'assets', 'run.bat'))).toBe(false);
    expect(readDeck()).toBe(deck);
    // The editor itself still saves (the browser sends its own Origin).
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.strip.addSlide());
    await save(page);
    expect(readDeck()).not.toBe(deck);
});

/* ------------------------------------------------------------
   10. Presenting
   ------------------------------------------------------------ */
test("9c safety: a page on another site or origin cannot load the workspace's files or the editor's", async ({ request, page }) => {
    const from = (site) => ({ headers: { 'Sec-Fetch-Site': site } });
    for (const url of ['/deck/' + FILE, '/editor.js', '/api/status', '/api/list?dir=']) {
        expect((await request.get(url, from('cross-site'))).status(), url).toBe(403);
        expect((await request.get(url, from('same-site'))).status(), url).toBe(403);      // another port on this machine
        expect((await request.get(url, from('same-origin'))).status(), url).toBe(200);
        expect((await request.get(url, from('none'))).status(), url).toBe(200);           // the app window, a typed address
        expect((await request.get(url)).status(), url).toBe(200);                         // not a browser
    }
    // In a browser: a page of another origin loads a deck's script file as its own script.
    const data = path.join(DECK_DIR, 'data.js');
    fs.writeFileSync(data, 'window.leaked = "the data of the deck";');
    const srv = require('http').createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<script src="http://127.0.0.1:8811/deck/sample/data.js"></script>'); });
    await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
    try {
        await page.goto('http://127.0.0.1:' + srv.address().port + '/');
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.leaked)).toBeUndefined();
        // The editor itself still loads everything.
        await openDeck(page);
        expect(await page.evaluate(() => fetch('/deck/sample/data.js').then(r => r.status))).toBe(200);
    } finally { srv.close(); fs.rmSync(data, { force: true }); }
});

test('10 presenting: preview mode shows the deck without editor chrome', async ({ page }) => {
    await openDeck(page);
    await page.keyboard.press('F5');
    await expect(page.locator('body')).toHaveClass(/preview/);
    await expect(page.locator('#topbar')).toBeHidden();
    await expect(page.locator('#strip')).toBeHidden();
    await expect(page.locator('#inspector')).toBeHidden();
    const controls = await page.evaluate(() => window.deckEditor.deck.win.getComputedStyle(window.deckEditor.deck.doc.querySelector('.deck-controls')).display);
    expect(controls).not.toBe('none');
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/preview/);
    await expect(page.locator('#topbar')).toBeVisible();
});

test('10b presenter view opens in a second window and stays in sync both ways', async ({ page, context }) => {
    await openDeck(page);
    // Notes written by the editor are hidden in the deck and shown to the presenter.
    await page.evaluate(() => window.deckEditor.inspector.applyNotes('Say hello.\nThen smile.'));
    await page.click('#btnPresenter');
    const [presenter] = await Promise.all([context.waitForEvent('page'), page.click('#presenterMenu [data-p="open"]')]);
    await presenter.waitForLoadState();
    await expect(presenter.locator('#now')).toHaveText('1');
    await expect(presenter.locator('#total')).toHaveText('3');
    await expect(presenter.locator('#notes')).toHaveText(/Say hello\.\s+Then smile\./);
    await presenter.waitForFunction(() => { const f = document.getElementById('cur'); return f.contentDocument && f.contentDocument.querySelector('.slide.active'); });
    const asideDisplay = await page.evaluate(() => { const a = window.deckEditor.deck.currentSlide.querySelector('aside.notes'); return window.deckEditor.deck.win.getComputedStyle(a).display; });
    expect(asideDisplay).toBe('none');

    // Editor -> presenter
    await goTo(page, 1);
    await expect(presenter.locator('#now')).toHaveText('2');
    await expect.poll(() => presenter.evaluate(() => { const d = document.getElementById('cur').contentDocument; return Array.from(d.querySelectorAll('.slide')).findIndex(s => s.classList.contains('active')); })).toBe(1);
    await expect.poll(() => presenter.evaluate(() => { const d = document.getElementById('next').contentDocument; return Array.from(d.querySelectorAll('.slide')).findIndex(s => s.classList.contains('active')); })).toBe(2);

    // Presenter -> editor
    await presenter.bringToFront();
    await presenter.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => window.deckEditor.deck.current)).toBe(2);
    await expect(presenter.locator('#now')).toHaveText('3');
    await expect(presenter.locator('#nextEmpty')).toBeVisible();

    await save(page);
    expect(readDeck()).toContain('<aside class="notes" hidden>Say hello.<br>Then smile.</aside>');
    await presenter.close();
});
