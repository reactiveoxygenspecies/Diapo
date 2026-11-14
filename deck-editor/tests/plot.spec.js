// Interactive charts (Insert > Interactive chart (Plotly)...): a figure pasted as JSON or read
// from a Plotly page becomes a <figure data-plot="plotly"> with the figure as data and a picture
// of it. The picture is what shows while editing, in the PDF and wherever scripts do not run;
// Preview and the saved deck draw it live, with the library beside the deck running as one of
// Diapo's own scripts (no "Trust this deck").
const { test, expect, fs, path, WS, own, openDeck, freshDeckEachTest, save, readDeck, DECK_DIR } = require('./helpers');

const FIGURE = {
    data: [
        { type: 'scatter', mode: 'lines+markers', name: 'Control', x: [0, 1, 2, 3], y: [1, 3, 2, 5] },
        { type: 'bar', name: 'Treated', x: [0, 1, 2, 3], y: [2, 1, 4, 3] },
    ],
    layout: { title: { text: 'Lab meeting figure' }, xaxis: { title: { text: 'Hours' } } },
};
const EXPORT = path.join(__dirname, 'fixtures', 'plotly', 'export.html');

/* A deck from the blank template: it has no script of its own, so nothing asks for trust. */
async function newDeck(page, name) {
    fs.rmSync(path.join(WS, name), { recursive: true, force: true });
    const r = await page.request.post('/api/new?path=' + encodeURIComponent(name + '/index.html'), { headers: own });
    expect(r.ok()).toBeTruthy();
    await open(page, name);
}
async function open(page, name, file = 'index.html') {
    await page.goto('/?file=' + name + '/' + file);
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
    await page.waitForTimeout(500);
}
async function insertFigure(page, text) {
    await page.click('#btnInsert');
    await page.click('[data-insert="plot"]');
    await page.fill('#plotInput', text);
    await expect(page.locator('#plotInsert')).toBeEnabled();
    await expect(page.locator('#plotPreview .plot-live .main-svg').first()).toBeVisible();      // the live preview drew
    await page.click('#plotInsert');
    await page.waitForFunction(() => { const s = window.deckEditor.selection.single; return s && s.matches('figure[data-plot]') && s.querySelector('img[data-plot-snapshot]'); });
}
const plot = (page, fn, arg) => page.evaluate(([src, arg]) => {
    const el = window.deckEditor.deck.doc.querySelector('figure[data-plot]');
    return new Function('el', 'arg', 'return (' + src + ')(el, arg)')(el, arg);
}, [fn.toString(), arg]);
const snapshotSvg = (page) => plot(page, (el) => decodeURIComponent(el.querySelector('img[data-plot-snapshot]').getAttribute('src')));

freshDeckEachTest();

test('plot: a figure pasted as JSON is inserted, saved with the library beside the deck, and runs on reopening without asking for trust', async ({ page }) => {
    await newDeck(page, 'plot-json');
    await insertFigure(page, JSON.stringify(FIGURE));

    // On the slide: the figure as data that never runs, and a picture of it; nothing of Plotly's.
    const made = await plot(page, (el) => ({
        kind: el.getAttribute('data-plot'), theme: el.getAttribute('data-plot-theme'), id: !!el.getAttribute('data-id'),
        holder: el.querySelector('script[data-plot-figure]').type, traces: JSON.parse(el.querySelector('script[data-plot-figure]').textContent).data.length,
        src: el.querySelector('img').getAttribute('src').slice(0, 19), alt: el.querySelector('img').alt,
        live: el.querySelectorAll('.deck-plot-live, .js-plotly-plot').length, w: el.offsetWidth, h: el.offsetHeight, position: el.style.position,
    }));
    expect(made).toMatchObject({ kind: 'plotly', theme: 'deck', id: true, holder: 'application/json', traces: 2, src: 'data:image/svg+xml,', alt: 'Lab meeting figure', live: 0, position: 'absolute' });
    expect(made.w).toBeGreaterThan(600);
    expect(await snapshotSvg(page)).toContain('Lab meeting figure');

    // The panel has its section; a click on the chart selected the element, not something inside Plotly.
    await expect(page.locator('#inspPlot')).toBeVisible();
    await expect(page.locator('#plotLive')).toBeChecked();
    expect(await page.inputValue('#plotJson')).toContain('"Lab meeting figure"');

    await save(page);
    const dir = path.join(WS, 'plot-json');
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    expect(html).toContain('<script src="deck-plotly.min.js" data-deck-plot="library"></script>\n<script src="deck-plot.js" data-deck-plot="renderer"></script>\n</body>');
    expect(html).not.toContain('deck-plot-live');
    expect(html).not.toContain('data-ed-');
    expect(fs.readFileSync(path.join(dir, 'deck-plotly.min.js')).equals(fs.readFileSync(path.join(__dirname, '..', 'app', 'vendor', 'plotly.min.js')))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'deck-plot.js'))).toBe(true);
    // Saving again changes nothing: the round trip is stable.
    await save(page);
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe(html);

    // Reopened: Diapo's scripts run from their files, nothing asks for trust, the file is unchanged by a save.
    await open(page, 'plot-json');
    expect(await page.evaluate(() => window.deckEditor.deck.trust)).toMatchObject({ trusted: false, scripts: 0 });
    await expect(page.locator('.bar.trust-bar')).toHaveCount(0);
    expect(await page.evaluate(() => { const w = window.deckEditor.deck.win; return { plotly: typeof w.Plotly, renderer: !!w.DeckPlot }; })).toEqual({ plotly: 'object', renderer: true });
    expect(await page.evaluate(() => document.getElementById('problemsBadge').hidden)).toBe(true);
    // Still a picture while editing, even after the library had every chance to draw.
    await page.waitForTimeout(1800);
    expect(await plot(page, (el) => el.querySelectorAll('.deck-plot-live').length)).toBe(0);
    await page.evaluate(() => window.deckEditor.save());
    await page.waitForTimeout(400);
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe(html);

    // Preview: the chart is live and answers the mouse; back in the editor it is its picture again.
    await page.keyboard.press('F5');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-plot] > .deck-plot-live.ready .main-svg'));
    const shown = await plot(page, (el) => ({ picture: getComputedStyle(el.querySelector('img')).display, w: el.querySelector('.deck-plot-live').offsetWidth, own: el.offsetWidth }));
    expect(shown.picture).toBe('none');
    expect(shown.w).toBe(shown.own);
    // A drag across the plot area zooms it (Plotly's own gesture), and the deck stays on its slide.
    const frame = page.frameLocator('#deckFrame');
    const area = await frame.locator('figure[data-plot] .nsewdrag').first().boundingBox();
    const before = await plot(page, (el) => el.querySelector('.deck-plot-live')._fullLayout.xaxis.range.slice());
    await page.mouse.move(area.x + area.width * 0.3, area.y + area.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width * 0.6, area.y + area.height * 0.6, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await plot(page, (el) => el.querySelector('.deck-plot-live')._fullLayout.xaxis.range.slice());
    expect(after[1] - after[0]).toBeLessThan((before[1] - before[0]) * 0.6);
    expect(await page.evaluate(() => window.deckEditor.deck.current)).toBe(0);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.deckEditor.deck.doc.querySelector('.deck-plot-live'));
    expect(await plot(page, (el) => getComputedStyle(el.querySelector('img')).display)).toBe('block');
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(false);
});

test('plot: a page exported by Plotly gives its figure, and what does not parse is said in words', async ({ page }) => {
    await newDeck(page, 'plot-html');
    await page.click('#btnInsert');
    await page.click('[data-insert="plot"]');

    // Malformed JSON: where it breaks, Insert stays off, nothing lands on the slide.
    await page.fill('#plotInput', '{"data": [{"type": "bar", "y": [1, 2, 3]}');
    await expect(page.locator('#plotMsg')).toContainText('not valid JSON');
    await expect(page.locator('#plotMsg')).toHaveClass(/bad/);
    await expect(page.locator('#plotInsert')).toBeDisabled();
    await page.fill('#plotInput', "{'data': [{'type': 'bar', 'visible': True}]}");
    await expect(page.locator('#plotMsg')).toContainText('fig.to_json()');
    await page.fill('#plotInput', '{"layout": {"title": "no traces"}}');
    await expect(page.locator('#plotMsg')).toContainText('no "data"');
    await page.fill('#plotInput', '<html><body><p>Nothing here</p></body></html>');
    await expect(page.locator('#plotMsg')).toContainText('No Plotly chart was found');
    await expect(page.locator('#plotInsert')).toBeDisabled();
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('figure[data-plot]').length)).toBe(0);

    // The exported page, from a file: data, layout and config come out of its Plotly.newPlot(...) call.
    await page.setInputFiles('#plotFileInput', EXPORT);
    await expect(page.locator('#plotInsert')).toBeEnabled();
    await expect(page.locator('#plotMsg')).toContainText('2 traces');
    await page.uncheck('#plotTheme');
    await expect(page.locator('#plotPreview .plot-live .main-svg').first()).toBeVisible();
    await page.click('#plotInsert');
    await page.waitForFunction(() => { const s = window.deckEditor.selection.single; return s && s.matches('figure[data-plot]') && s.querySelector('img[data-plot-snapshot]'); });
    const fig = await plot(page, (el) => ({ theme: el.getAttribute('data-plot-theme'), fig: JSON.parse(el.querySelector('script[data-plot-figure]').textContent), raw: el.querySelector('script[data-plot-figure]').textContent }));
    expect(fig.theme).toBeNull();
    expect(fig.fig.data.map(t => t.name)).toEqual(['wild type, (a) [b]', 'mutant']);
    expect(fig.fig.layout.title.text).toBe('Exported growth');
    expect(fig.fig.config).toEqual({ responsive: true, scrollZoom: true });
    expect(fig.raw).not.toContain('<');                    // nothing in the block can end it
    const plain = await snapshotSvg(page);
    expect(plain).toContain('Exported growth');
    expect(plain).toContain('rgb(229, 236, 246)');     // the figure's own ground, since the deck's look is off

    // One undo step takes the chart away; redo brings it back.
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('figure[data-plot]').length)).toBe(0);
    await page.keyboard.press('Control+y');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('figure[data-plot]').length)).toBe(1);
});

test('plot: the panel edits the figure and its options, a resize redraws the picture, each one undo step', async ({ page }) => {
    await newDeck(page, 'plot-panel');
    await insertFigure(page, JSON.stringify(FIGURE));
    const key = () => plot(page, (el) => el.querySelector('img').getAttribute('data-key'));
    const k0 = await key();

    // A mistake in the box is said and the slide keeps its chart.
    await page.fill('#plotJson', '{"data": [}');
    await page.click('#plotApply');
    await expect(page.locator('#plotError')).toContainText('not valid JSON');
    expect(await key()).toBe(k0);
    // A good figure replaces it, with a new picture.
    await page.fill('#plotJson', JSON.stringify({ data: [{ type: 'bar', x: ['a', 'b'], y: [3, 4] }], layout: { title: { text: 'Second figure' } } }));
    await page.click('#plotApply');
    await expect.poll(() => snapshotSvg(page)).toContain('Second figure');
    await expect(page.locator('#plotError')).toBeHidden();
    await page.keyboard.press('Control+z');
    await expect.poll(() => snapshotSvg(page)).toContain('Lab meeting figure');
    await page.keyboard.press('Control+y');
    await expect.poll(() => snapshotSvg(page)).toContain('Second figure');

    // The deck's look: on, the ground is clear and the text is the element's colour; off, the figure's own.
    await page.evaluate(() => { const ed = window.deckEditor; ed.history.style(ed.selection.single, (el) => { el.style.color = 'rgb(200, 30, 40)'; }); });
    await expect.poll(() => snapshotSvg(page)).toContain('rgb(200, 30, 40)');
    await page.uncheck('#plotDeckLook');
    await expect.poll(() => plot(page, (el) => el.getAttribute('data-plot-theme'))).toBeNull();
    await expect.poll(() => snapshotSvg(page)).not.toContain('rgb(200, 30, 40)');
    await page.uncheck('#plotLive');
    await page.uncheck('#plotToolbar');
    expect(await plot(page, (el) => [el.getAttribute('data-plot-live'), el.getAttribute('data-plot-toolbar')])).toEqual(['off', 'off']);

    // A new size: the picture is drawn again for it.
    const k1 = await key();
    await page.fill('#inspW', '700');
    await page.press('#inspW', 'Enter');
    await expect.poll(key).not.toBe(k1);
    expect(await snapshotSvg(page)).toMatch(/width="700"/);

    // Off "live", Preview keeps the picture.
    await page.keyboard.press('F5');
    await page.waitForFunction(() => window.deckEditor.deck.win.DeckPlot && window.deckEditor.deck.win.Plotly);
    await page.waitForTimeout(600);
    expect(await plot(page, (el) => el.querySelectorAll('.deck-plot-live').length)).toBe(0);
    await page.keyboard.press('Escape');
});

test('plot: the single-file export carries the library and runs on its own; the PDF copy and the slide strip use the picture', async ({ page, browser }) => {
    await newDeck(page, 'plot-export');
    await insertFigure(page, JSON.stringify(FIGURE));

    // The printable copy: the picture, no library.
    const printable = await page.evaluate(async () => { await window.deckEditor.exporter.helpersReady; return window.deckEditor.exporter.printableHtml(); });
    expect(printable).toContain('data-plot-snapshot');
    expect(printable).toContain('data:image/svg+xml,');
    expect(printable).not.toContain('data-deck-plot');
    expect(printable).not.toContain('deck-plotly.min.js');
    // The slide strip (frames without scripts) shows the picture too.
    await expect.poll(() => page.evaluate(() => { const f = document.querySelector('.strip-item.current iframe, .strip-item iframe'); const img = f && f.contentDocument.querySelector('figure[data-plot] img'); return !!img && img.naturalWidth > 0; })).toBe(true);
    // PowerPoint takes it as a picture of the element.
    const spec = await page.evaluate(async () => { const { PptxCollector } = await import('/core/pptx.js'); return new PptxCollector(window.deckEditor).collect(() => {}); });
    const item = spec.slides[0].items.find(i => i.name === 'Chart' || /Lab meeting/.test(i.alt || ''));
    expect(item).toMatchObject({ kind: 'svg', alt: 'Lab meeting figure' });
    expect(item.png).toMatch(/^data:image\/png/);

    // The single file, exported before the deck was ever saved with its chart: both scripts are inside.
    const r = await page.evaluate(() => window.deckEditor.exporter.standalone({ to: 'plot-standalone.html', fonts: false }));
    expect(r.notes.join(' ')).not.toMatch(/deck-plot/);
    const out = path.join(WS, 'plot-export', 'plot-standalone.html');
    const html = fs.readFileSync(out, 'utf8');
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(html).toMatch(/<script data-deck-plot="library">\n\/\*\*\n\* plotly\.js v/);
    expect(html).toContain('<script data-deck-plot="renderer">');
    expect(fs.existsSync(path.join(WS, 'plot-export', 'deck-plotly.min.js'))).toBe(false);     // nothing was copied for an export

    // Opened on its own, away from the server and the deck folder: the chart draws live.
    const alone = path.join(WS, 'elsewhere');
    fs.mkdirSync(alone, { recursive: true });
    fs.copyFileSync(out, path.join(alone, 'talk.html'));
    const ctx = await browser.newContext({ offline: true });
    const solo = await ctx.newPage();
    await solo.goto('file:///' + path.join(alone, 'talk.html').replace(/\\/g, '/'));
    await solo.waitForFunction(() => document.querySelector('figure[data-plot] > .deck-plot-live.ready .main-svg'));
    expect(await solo.evaluate(() => getComputedStyle(document.querySelector('figure[data-plot] img')).display)).toBe('none');
    await ctx.close();

    // And in the editor, the exported file needs no trust: its inline scripts are Diapo's by their hash.
    await open(page, 'plot-export', 'plot-standalone.html');
    expect(await page.evaluate(() => window.deckEditor.deck.trust)).toMatchObject({ trusted: false, scripts: 0 });
    await expect(page.locator('.bar.trust-bar')).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.deckEditor.deck.win.Plotly)).toBe('object');
});

test('plot: a WebGL trace draws under the deck policy, in the picture and live', async ({ page }) => {
    // plotly.py switches a scatter of more than a thousand points to scattergl by itself, and the
    // pages Diapo serves allow no eval: the bundle has to draw it without.
    await newDeck(page, 'plot-gl');
    const n = 400, x = Array.from({ length: n }, (_, i) => i), y = x.map(i => Math.sin(i / 20));
    await insertFigure(page, JSON.stringify({ data: [{ type: 'scattergl', mode: 'markers', x, y }], layout: { title: { text: 'Many points' } } }));
    expect(await snapshotSvg(page)).toMatch(/<image [^>]*href="data:image\/png/);       // the WebGL layer, as a picture inside the SVG
    await save(page);
    await open(page, 'plot-gl');
    await page.keyboard.press('F5');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-plot] > .deck-plot-live.ready canvas'));
    expect(await page.evaluate(() => window.deckEditor.problems.items.length)).toBe(0);
    await page.keyboard.press('Escape');
});
