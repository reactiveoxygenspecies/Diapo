// Files: import, export, PDF, save and save as, previous versions, templates, the platform fallbacks, scripts in decks.
// Run with: npx playwright test   (from the deck-editor folder)
const { test, expect, fs, path, freshDeckEachTest, DECK, DECK_DIR, FIXTURE, IMPORT_DIR, WS, goTo, openDeck, own, readDeck, save, stageRect } = require('./helpers');

freshDeckEachTest();

/* ------------------------------------------------------------
   20. Export: a single self-contained file, and a PDF
   ------------------------------------------------------------ */
test('20 export: the single-file copy embeds scripts, images and fonts, and opens from file://', async ({ page, context }) => {
    await openDeck(page);
    // An unsaved edit must be in the export: the copy comes from the live deck, not the file.
    await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); const before = h.innerHTML; h.innerHTML = 'Exported title'; window.deckEditor.history.html(h, before, h.innerHTML, 'Edit'); });
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(true);
    const r = await page.evaluate(() => window.deckEditor.exporter.standalone({ to: 'sample-standalone.html' }));
    expect(r.ok).toBe(true);
    expect(r.files).toBeGreaterThanOrEqual(2);                       // the shape (img + data-svg) and the Google faces
    const out = path.join(DECK_DIR, 'sample-standalone.html');
    const html = fs.readFileSync(out, 'utf8');
    expect(html).toContain('Exported title');
    expect(html).not.toMatch(/src="assets\//);
    expect(html).not.toMatch(/data-svg="assets\//);
    expect(html).toMatch(/data-svg="data:image\/svg\+xml;base64,/);
    expect(html).toMatch(/<link rel="preconnect"/);                  // harmless links stay
    expect(html).not.toMatch(/<link[^>]*fonts\.googleapis\.com[^>]*stylesheet/);
    expect(html).toMatch(/@font-face[^}]*Montserrat[^}]*data:font\/woff2;base64,/);
    expect(readDeck()).not.toContain('Exported title');              // the deck itself was not saved
    // The copy runs on its own from file://, with the inlined SVG resolved from the data URI.
    const p2 = await context.newPage();
    await p2.goto('file:///' + out.replace(/\\/g, '/'));
    await p2.waitForFunction(() => document.querySelector('.slide.active') && document.fonts.status === 'loaded');
    await p2.waitForTimeout(500);
    expect(await p2.evaluate(() => document.querySelectorAll('.slide').length)).toBe(3);
    expect(await p2.evaluate(() => !!document.querySelector('[data-svg] svg'))).toBe(true);
    expect(await p2.evaluate(() => document.fonts.check('600 20px Montserrat'))).toBe(true);
    await p2.close();
});

test('20b export: the printable copy shows every slide as a page, and Chrome prints it to a PDF', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.strip.toggleSkip(1));      // skipped slides are left out
    const printable = await page.evaluate(() => window.deckEditor.exporter.printableHtml());
    expect((printable.match(/<section class="slide[^"]*"/g) || []).length).toBe(2);
    expect(printable).not.toContain('data-skip');
    expect(printable).toMatch(/class="slide[^"]*active visible"/);
    expect(printable).toContain('id="deck-editor-print"');
    expect(printable).toContain('@page { size: 1920px 1080px; margin: 0; }');
    expect(printable).toContain('.deck-stage .slide .reveal,');             // the deck's own reveal classes are forced visible
    expect(printable).not.toContain('id="deck-runtime"');

    const r = await page.evaluate(() => window.deckEditor.exporter.pdf({ to: 'sample.pdf' }));
    test.skip(r && r.printed, 'no Chrome / Edge on this machine: the browser print dialog was used instead');
    expect(r.ok).toBe(true);
    const pdf = fs.readFileSync(path.join(DECK_DIR, 'sample.pdf'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.bytes).toBe(pdf.length);
    // Two pages of 1920x1080 CSS px = 1440x810 pt.
    const text = pdf.toString('latin1');
    expect((text.match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(2);
    expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+1440\s+810\s*\]/);
    expect(fs.readdirSync(DECK_DIR).filter(f => f.startsWith('.deck-editor-print'))).toEqual([]);   // the temp copy is gone
});

/* ------------------------------------------------------------
   24. Import: Markdown and PowerPoint
   ------------------------------------------------------------ */

test('24 import: a Markdown file becomes an editable deck with its pictures, notes, lists, code and tables', async ({ page, request }) => {
    fs.rmSync(path.join(WS, 'talk'), { recursive: true, force: true });
    const r = await request.post('/api/import?path=' + encodeURIComponent(path.join(IMPORT_DIR, 'talk.md')), { headers: own });
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.file).toBe('talk/index.html');
    expect(j.notes).toEqual(['missing file, left as a link: nope.png']);
    expect(fs.existsSync(path.join(WS, 'talk', 'assets', 'shape.svg'))).toBe(true);
    const html = fs.readFileSync(path.join(WS, 'talk', 'index.html'), 'utf8');
    expect(html).toContain('<title>Imported talk</title>');
    expect(html).toContain('<h1 class="reveal" style="--i:0" data-edit>Imported talk</h1>');
    expect(html).toContain('<p class="sub reveal" style="--i:1" data-edit>A subtitle line</p>');
    expect(html).toContain('<li class="reveal" style="--i:2" data-edit>First point with <b>bold</b> and <i>italic</i></li>');
    expect(html).toContain('<code>code</code><ul><li data-edit>a nested point</li></ul></li>');
    expect(html).toContain('<aside class="notes" hidden>Remember to breathe.</aside>');
    expect(html).toContain('<aside class="notes" hidden>the table is small.</aside>');
    expect(html).toContain('src="assets/shape.svg" alt="A shape"');
    expect(html).toMatch(/<code data-edit data-code data-lang="python">def hello\(\):\n    return "world"<\/code>/);
    expect(html).toContain('<th style="border:2px solid var(--rule); padding:14px 22px; text-align:left; vertical-align:top; background:var(--paper-2); font-weight:600;" data-edit>Name</th>');
    expect(html).toContain('<h1 class="reveal" style="--i:0" data-edit>Section two</h1>');
    expect(html).toContain('<span id="pageTotal">7</span>');
    // It opens in the editor as a normal deck: the right number of slides, the deck's own navigation, editable text.
    await page.goto('/?file=talk/index.html');
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
    expect(await page.evaluate(() => window.deckEditor.deck.slides.length)).toBe(7);
    await page.evaluate(() => window.deckEditor.deck.goTo(2));
    await page.waitForTimeout(1500);                    // the reveal transition of the picture
    const pic = await page.evaluate(() => { const d = window.deckEditor.deck; const img = d.currentSlide.querySelector('img'); return { w: img.naturalWidth, rect: d.stageRect(img), opacity: d.win.getComputedStyle(img).opacity }; });
    expect(pic.w).toBeGreaterThan(0);
    expect(pic.rect.x).toBeGreaterThan(900);            // right column
    expect(pic.opacity).toBe('1');
    // The multipart route works too (no pictures next to an uploaded file, so they are reported).
    const up = await request.post('/api/import?name=talk-upload', { headers: own, multipart: { file: { name: 'talk.md', mimeType: 'text/markdown', buffer: fs.readFileSync(path.join(IMPORT_DIR, 'talk.md')) } } });
    expect(up.status()).toBe(200);
    expect((await up.json()).file).toBe('talk-upload/index.html');
    expect((await up.json()).notes).toContain('missing file, left as a link: shape.svg');
    // A second import of the same name gets its own folder.
    const again = await request.post('/api/import?path=' + encodeURIComponent(path.join(IMPORT_DIR, 'talk.md')), { headers: own });
    expect((await again.json()).file).toBe('talk-2/index.html');
    for (const d of ['talk', 'talk-2', 'talk-upload']) fs.rmSync(path.join(WS, d), { recursive: true, force: true });
});

test('24b import: a PowerPoint file keeps positions, text styles, bullets, tables, pictures and notes', async ({ page, request }) => {
    fs.rmSync(path.join(WS, 'sample-pptx'), { recursive: true, force: true });
    const r = await request.post('/api/import?path=' + encodeURIComponent(path.join(IMPORT_DIR, 'sample.pptx')) + '&name=sample-pptx', { headers: own });
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.file).toBe('sample-pptx/index.html');
    expect(j.notes).toEqual([]);
    const html = fs.readFileSync(path.join(WS, 'sample-pptx', 'index.html'), 'utf8');
    expect(html).toContain('<title>PowerPoint import</title>');
    // The title placeholder had no position of its own: it comes from the layout (1524000 EMU -> 240px);
    // its run is 60pt (120px on the 1920 stage) and the box anchors its text at the bottom.
    expect(html).toMatch(/<div style="position:absolute; left:240px; top:176\.8px; width:1440px; height:376px;[^"]*justify-content:flex-end;[^"]*">\s*<h1 [^>]*text-align:center;[^"]*" data-edit><span style="font-size:120px;"><b>PowerPoint import<\/b><\/span><\/h1>/);
    expect(html).toContain('<span style="font-size:48px; color:#e8503f;"><i>colour</i></span>');
    expect(html).toContain('<img src="assets/image1.png" alt="" style="position:absolute; left:1440px; top:720px; width:240px; height:240px;');
    expect(fs.existsSync(path.join(WS, 'sample-pptx', 'assets', 'image1.png'))).toBe(true);
    expect(html).toMatch(/<section class="slide body-slide" data-name="bullets-and-a-table" style="background:#f4f4f5;[^"]*">/);
    // Body bullets: a list with the nested point indented one level, then the buNone paragraph as plain text.
    expect(html).toMatch(/<ul [^>]*data-group>\s*<li style="[^"]*margin-left:0px;[^"]*" data-edit>First point<\/li>\s*<li style="[^"]*margin-left:72px;[^"]*" data-edit>Nested point<\/li>\s*<li style="[^"]*margin-left:0px;[^"]*" data-edit>Second point<\/li>\s*<\/ul>\s*<p [^>]*data-edit>A plain closing line<\/p>/);
    expect(html).toMatch(/<table style="position:absolute; left:1007\.9px; top:287\.5px; width:780\.1px;[^"]*" data-group>\s*<colgroup><col style="width:390px"><col style="width:390px"><\/colgroup>/);
    expect(html).toContain('<div style="position:absolute; left:1007.9px; top:503.9px; width:240px; height:240px; background:#2f6fed; border-radius:50%;"></div>');
    expect(html).toContain('<aside class="notes" hidden>Say something about the table.</aside>');
    // Opens and edits like any deck.
    await page.goto('/?file=sample-pptx/index.html');
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
    expect(await page.evaluate(() => window.deckEditor.deck.slides.length)).toBe(2);
    const title = await page.evaluate(() => { const d = window.deckEditor.deck; const h = d.doc.querySelector('h1'); return { rect: d.stageRect(h), px: parseFloat(d.win.getComputedStyle(h.querySelector('span')).fontSize) }; });
    expect(title.px).toBe(120);
    expect(title.rect.y).toBeGreaterThan(300);           // anchored to the bottom of its box
    fs.rmSync(path.join(WS, 'sample-pptx'), { recursive: true, force: true });
});

test('24c import: a themed PowerPoint deck (Facet) keeps its theme colours, fonts, layout decorations, backgrounds, shapes, lines, charts, table style and hidden slide', async ({ page, request }) => {
    fs.rmSync(path.join(WS, 'facet'), { recursive: true, force: true });
    const r = await request.post('/api/import?path=' + encodeURIComponent(path.join(IMPORT_DIR, 'facet.pptx')) + '&name=facet', { headers: own });
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.notes).toEqual([]);
    const html = fs.readFileSync(path.join(WS, 'facet', 'index.html'), 'utf8');
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(main.match(/<section class="slide/g).length).toBe(14);
    // Theme: the accent (Facet green) reaches shape fills through the style references, the theme's minor font reaches the text.
    expect(html).toContain('background:#90c226;');
    expect(html).toContain("font-family:'Trebuchet MS', sans-serif");
    // The layout's decorative custom-geometry shapes are drawn into the slide, translucent, as the editor's SVG shapes.
    expect(html).toMatch(/<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="[^"]*color:rgba\(144,194,38,0\.\d+\);"><path d="M[\d.]+ [\d.]+ L/);
    // Text: the bullet glyph from the master (Wingdings 3 "u" is a right-pointing triangle), a hyperlink in the theme's link colour,
    // superscript, subscript, strikethrough and justified text from a free text box.
    expect(html).toContain("list-style-type:'\u25b6  '");
    expect(html).toMatch(/<a href="https:\/\/diapo\.app\/" style="color:#[0-9a-f]{6};">/);
    expect(html).toContain('<sup>2</sup>');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<s>struck</s>');
    expect(html).toContain('text-align:justify');
    // Shapes: preset geometries as SVG paths, a gradient, a dashed outline, lines with an arrowhead; a shadow.
    expect(html).toContain('<path d="M0 0H70L100 50 70 100H0L30 50Z"');       // chevron
    expect(html).toMatch(/linear-gradient\(\d+deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)/);
    expect(html).toMatch(/border:8px dashed #/);
    expect(html).toMatch(/<line x1="0\.0" y1="160\.0" x2="720\.0" y2="0\.0" vector-effect="non-scaling-stroke"\/><path d="M[\d.]+ -?[\d.]+ L720\.0 0\.0 L/);
    expect(html).toMatch(/box-shadow:[\d.]+px [\d.]+px [\d.]+px (#[0-9a-f]{6}|rgba\()/);
    // Table: column widths, the merged header cell, the table style's header and banding fills, an explicit cell fill, right-aligned numbers.
    expect(html).toMatch(/<colgroup><col style="width:600px"><col style="width:360px"><col style="width:360px"><col style="width:360px"><\/colgroup>/);
    expect(html).toContain('colspan="2"');
    expect(html).toContain('background:#f0d060');
    expect(html).toMatch(/<td style="[^"]*"><p style="[^"]*text-align:right;" data-edit><span [^>]*>120<\/span><\/p><\/td>/);
    // Charts: a column chart and a pie drawn as SVG, with the title, the legend, the axis labels and the pie's percentage labels,
    // written as editable charts: the drawing plus the table the editor draws from once the chart is changed.
    expect(html.match(/<figure data-chart="(column|pie)"/g).length).toBe(2);
    expect(html).toContain('<script type="application/json" data-chart-data>{"labels":["Q1","Q2","Q3","Q4"],"series":[{"name":"2025","values":[4.2,4.8,5.1,5.9],"colour":"#90c226"},{"name":"2026","values":[5.0,5.6,6.3,7.1],"colour":"#54a021"}]');
    expect(html).toContain('"title":"Share by segment"');
    expect(html).toContain('Revenue by quarter (M)');
    expect(html).toMatch(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#90c226"\/>/);
    expect(html).toContain('>46%</text>');
    // Pictures: the cropped one is a clipped box, the transparent logo keeps its file, the picture background is stretched.
    expect(html).toMatch(/<div style="[^"]*overflow:hidden;[^"]*" data-group><img src="assets\/image1\.jpg"/);
    expect(fs.existsSync(path.join(WS, 'facet', 'assets', 'image2.png'))).toBe(true);
    expect(html).toContain("background:url('assets/image1.jpg') center / 100% 100% no-repeat;");
    // Notes and the hidden slide.
    expect(html).toContain('<aside class="notes" hidden>Keep this short.</aside>');
    expect(html).toMatch(/<section class="slide body-slide" data-skip data-name="hidden-slide"/);
    // It opens, and the imported shapes are ordinary editable elements.
    await page.goto('/?file=facet/index.html');
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
    expect(await page.evaluate(() => window.deckEditor.deck.slides.length)).toBe(14);
    // An imported chart opens in the Chart section; its PowerPoint drawing stays until it is changed, then the editor draws it.
    const chart = await page.evaluate(async () => {
        const ed = window.deckEditor, d = ed.deck, fig = d.doc.querySelector('figure[data-chart="column"]');
        d.goTo(d.slides.indexOf(fig.closest('.slide'))); await new Promise(r => setTimeout(r, 600));
        ed.selection.select(fig); await new Promise(r => setTimeout(r, 100));
        ed.history.forceDirty();                       // a history change: the imported drawing is not redrawn for it
        const kept = !fig.querySelector('svg').hasAttribute('data-key');
        const cell = document.querySelector('#chartGrid input[data-r="1"][data-c="1"]').value;
        const title = document.querySelector('#chartTitle').value;
        ed.inspector.chart.apply('Chart values', (s) => { s.values = true; });
        const svg = fig.querySelector('svg');
        return { kept, cell, title, key: svg.hasAttribute('data-key'), text: svg.textContent, visible: !document.querySelector('#inspChart').hidden };
    });
    expect(chart.visible).toBe(true);
    expect(chart.kept).toBe(true);
    expect(chart.cell).toBe('4.2');
    expect(chart.title).toBe('Revenue by quarter (M)');
    expect(chart.key).toBe(true);
    expect(chart.text).toContain('Revenue by quarter (M)');
    expect(chart.text).toContain('5.9');
    const bg = await page.evaluate(() => { const d = window.deckEditor.deck; d.goTo(11); const s = d.doc.querySelectorAll('.slide')[11]; return d.win.getComputedStyle(s).backgroundImage; });
    expect(bg).toContain('image1.jpg');
    fs.rmSync(path.join(WS, 'facet'), { recursive: true, force: true });
});

/* ------------------------------------------------------------
   25. A script that mentions "</body>" must not break the save
   ------------------------------------------------------------ */
test('25 save: a body script containing "</body>" is written once, and a file damaged that way is repaired on load', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await page.waitForTimeout(300);
    await save(page);
    let saved = readDeck();
    expect((saved.match(/DECK RUNTIME/g) || []).length).toBe(1);
    expect((saved.match(/<script\b/g) || []).length).toBe((saved.match(/<\/script>/g) || []).length);
    // Damage the file the way older versions did: the runtime's tail appended after the real </body> markup.
    const tail = saved.slice(saved.indexOf('window.deckRuntime = '), saved.lastIndexOf('</script>') + 9);
    const damaged = saved.replace(/<\/body>\s*<\/html>\s*$/, '\n' + tail + '\n</body>\n</html>\n');
    expect(damaged).not.toBe(saved);
    fs.writeFileSync(DECK, damaged);
    await openDeck(page);
    expect(await page.evaluate(() => window.deckEditor.deck.repaired)).toBe(true);
    expect(await page.evaluate(() => Array.from(window.deckEditor.deck.doc.body.childNodes).filter(n => n.nodeType === 3 && n.textContent.trim().length > 80).length)).toBe(0);
    await page.evaluate(() => window.deckEditor.strip.addSlide(0, 'blank'));
    await save(page);
    saved = readDeck();
    expect((saved.match(/window\.deckRuntime = /g) || []).length).toBe(1);
    expect((saved.match(/<script\b/g) || []).length).toBe((saved.match(/<\/script>/g) || []).length);
});

/* ------------------------------------------------------------
   27. Without a native dialog, paths are typed (the test server runs with DECK_EDITOR_NO_DIALOG)
   ------------------------------------------------------------ */
test('27 platform: when no file dialog exists, Browse and Open ask for a typed path and the exports use default names', async ({ page, request }) => {
    const pick = await request.post('/api/workspace/pick', { headers: own });
    expect(pick.status()).toBe(500);
    expect((await pick.json()).error).toMatch(/no file dialog is available/);
    await openDeck(page);
    // Browse folder: the prompt takes a path.
    await page.evaluate((ws) => { window.__answers = [ws]; window.prompt = () => window.__answers.shift(); }, WS);
    await page.click('#btnFiles');
    await page.click('#btnPickFolder');
    await expect(page.locator('#drawerWs')).toHaveValue(WS);
    // Open deck: a typed file path opens it.
    await page.evaluate((deck) => { window.__answers = [deck]; }, DECK);
    await page.click('#btnPickFile');
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.file === 'index.html');   // its folder is the workspace now
    await expect(page.locator('#drawer')).toBeHidden();
    // Exports fall back to a default name next to the deck.
    const r = await page.evaluate(() => window.deckEditor.exporter.standalone());
    expect(r.ok).toBe(true);
    expect(r.name).toBe('sample-standalone.html');
    expect(fs.existsSync(path.join(DECK_DIR, 'sample-standalone.html'))).toBe(true);
    // Opening a deck by path made its folder the current one (as the native route does).
    await page.click('#btnFiles');
    await expect(page.locator('#drawerWs')).toHaveValue(DECK_DIR);
    // Cancelling the prompt does nothing.
    await page.evaluate(() => { window.__answers = [null]; });
    await page.click('#btnPickFolder');
    await expect(page.locator('#drawerWs')).toHaveValue(DECK_DIR);
    // Back to the test workspace for the tests that follow.
    await request.post('/api/workspace?path=' + encodeURIComponent(WS), { headers: own });
    // Windows scans a freshly written file when another process opens it (the drawer reads its
    // title), and it cannot be deleted for a moment meanwhile.
    for (let i = 0; i < 40; i++) {
        try { fs.rmSync(path.join(DECK_DIR, 'sample-standalone.html'), { force: true }); break; }
        catch (e) { if (i === 39 || !['EBUSY', 'EPERM'].includes(e.code)) throw e; await page.waitForTimeout(250); }
    }
});

/* ------------------------------------------------------------
   28. Onboarding: the sample deck, the Problems list, absolute X / Y
   ------------------------------------------------------------ */
test('28 onboarding: the empty state builds the tour deck; problems list missing files and deck errors; X and Y are slide positions', async ({ page }) => {
    const SAMPLES = path.join(WS, '.deck-editor-samples');                  // beside the settings file, hidden from the folder list
    fs.rmSync(SAMPLES, { recursive: true, force: true });
    await page.goto('/');
    await page.waitForFunction(() => window.deckEditor);
    await page.keyboard.press('Escape');                                   // the drawer opens by itself with no deck
    await expect(page.locator('#btnEmptySample')).toBeVisible();
    await page.click('#btnEmptySample');
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.file === '@diapo/welcome/index.html');
    expect(await page.evaluate(() => window.deckEditor.deck.slides.length)).toBe(23);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.title)).toBe('Welcome to Diapo');
    expect(fs.existsSync(path.join(SAMPLES, 'welcome', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(WS, 'welcome'))).toBe(false);
    expect((await page.evaluate(() => window.deckEditor.api.list(''))).files.some(f => f.path.includes('welcome'))).toBe(false);
    // Opening it again reuses the file instead of making welcome-2.
    await page.evaluate(() => window.deckEditor.openSampleDeck());
    await page.waitForTimeout(500);
    expect(fs.existsSync(path.join(SAMPLES, 'welcome-2'))).toBe(false);
    // An older edition of the tour in the folder (titled like it, no edition mark) is replaced and kept as a backup;
    // the current tour with edits is not.
    const tour = path.join(SAMPLES, 'welcome', 'index.html');
    const current = fs.readFileSync(tour, 'utf8');
    fs.writeFileSync(tour, '<!DOCTYPE html><html><head><title>Welcome to the deck editor</title></head><body><section class="slide active">old</section></body></html>');
    await page.evaluate(() => window.deckEditor.openSampleDeck());
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.deck.slides.length === 23);
    expect(fs.readFileSync(tour, 'utf8')).toBe(current);
    expect(fs.existsSync(path.join(SAMPLES, 'welcome', '.deck-editor', 'index.html.bak'))).toBe(true);
    fs.writeFileSync(tour, current.replace('A tour in three parts', 'My own tour'));
    await page.evaluate(() => window.deckEditor.openSampleDeck());
    await page.waitForTimeout(500);
    expect(fs.readFileSync(tour, 'utf8')).toContain('My own tour');
    fs.writeFileSync(tour, current);
    await page.evaluate(() => window.deckEditor.openSampleDeck());
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.deck.slides.length === 23);

    // Problems: nothing at first; a missing picture and a deck script error are listed; Show selects the picture.
    await expect(page.locator('#problemsBadge')).toBeHidden();
    await page.evaluate(() => { const ed = window.deckEditor; ed.insert.image('assets/nope.png'); ed.selection.clear(); ed.deck.goTo(1); });
    await page.waitForTimeout(600);
    // The error a deck's own script would throw (a script injected here would not run: the tour
    // is not a trusted deck, so only Diapo's scripts do; test 62).
    await page.evaluate(() => { const w = window.deckEditor.deck.win; w.dispatchEvent(new w.ErrorEvent('error', { message: 'Uncaught Error: chart failed', error: new Error('chart failed') })); });
    await expect(page.locator('#problemsBadge')).toHaveText('2 problems');
    await page.click('#problemsBadge');
    await expect(page.locator('.problems')).toContainText('Missing picture on slide 1: assets/nope.png');
    await expect(page.locator('.problems')).toContainText('Deck script error');
    await expect(page.locator('.problems')).toContainText('chart failed');
    await page.click('.problems [data-select]');
    await page.waitForFunction(() => window.deckEditor.deck.current === 0 && window.deckEditor.selection.primary && window.deckEditor.selection.primary.tagName === 'IMG');
    await expect(page.locator('.problems')).toHaveCount(0);
    // A reload starts the list afresh.
    await page.evaluate(() => window.deckEditor.history.clear());
    await openDeck(page);
    await expect(page.locator('#problemsBadge')).toBeHidden();

    // X and Y in the panel are the element's place on the slide; typing a new X moves it there.
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('h1')));
    const shown = await page.evaluate(() => ({ x: +document.getElementById('inspX').value, y: +document.getElementById('inspY').value, r: window.deckEditor.deck.stageRect(window.deckEditor.deck.doc.querySelector('h1')) }));
    expect(shown.x).toBe(Math.round(shown.r.x));
    expect(shown.y).toBe(Math.round(shown.r.y));
    await page.fill('#inspX', '300');
    await page.locator('#inspX').press('Enter');
    await page.waitForTimeout(300);
    const moved = await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); return { rx: Math.round(window.deckEditor.deck.stageRect(h).x), dx: h.style.getPropertyValue('--dx'), hint: document.getElementById('inspPosHint').textContent }; });
    expect(moved.rx).toBe(300);
    expect(moved.dx).toBe((300 - shown.x) + 'px');
    expect(moved.hint).toContain(`Moved +${300 - shown.x}, 0 px`);
    // The x next to the field puts it back where the deck lays it out.
    await page.click('.insp-field[data-prop="_x"] .insp-clear');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => +document.getElementById('inspX').value)).toBe(shown.x);
    fs.rmSync(path.join(WS, 'welcome'), { recursive: true, force: true });
});

/* ------------------------------------------------------------
   29. Save as
   ------------------------------------------------------------ */
test('29 save as: the live deck goes under a new name or folder with its files copied along, and the editor moves to the copy', async ({ page, request }) => {
    await openDeck(page);
    const original = readDeck();
    await page.evaluate(() => { const h = window.deckEditor.deck.doc.querySelector('h1'); const b = h.innerHTML; h.innerHTML = 'Variant title'; window.deckEditor.history.html(h, b, h.innerHTML, 'Edit'); });
    await expect.poll(() => fs.existsSync(path.join(DECK_DIR, '.deck-editor', 'index.html.~draft')), { timeout: 5000 }).toBe(true);
    // Same folder, new name: no files to copy; the editor works on the copy, the original is untouched, the draft is gone.
    let r = await page.evaluate(() => window.deckEditor.saveAs({ to: 'variant.html' }));
    expect(r.ok).toBe(true);
    expect(r.file).toBe('sample/variant.html');
    expect(r.copied).toBe(0);
    await page.waitForFunction(() => window.deckEditor.file === 'sample/variant.html' && !window.deckEditor.dirty);
    expect(fs.readFileSync(path.join(DECK_DIR, 'variant.html'), 'utf8')).toContain('Variant title');
    expect(readDeck()).toBe(original);
    expect(fs.existsSync(path.join(DECK_DIR, '.deck-editor', 'index.html.~draft'))).toBe(false);
    // Another folder inside the workspace: the shape the deck references comes along; a missing one is reported.
    await page.evaluate(() => window.deckEditor.insert.image('assets/gone.png'));
    r = await page.evaluate((to) => window.deckEditor.saveAs({ to }), path.join(WS, 'elsewhere', 'deck.html'));
    expect(r.ok).toBe(true);
    expect(r.file).toBe('elsewhere/deck.html');
    expect(r.copied).toBe(1);
    expect(r.notes).toEqual(['not found next to the deck, not copied: assets/gone.png']);
    expect(fs.existsSync(path.join(WS, 'elsewhere', 'assets', 'shape.svg'))).toBe(true);
    await page.waitForFunction(() => window.deckEditor.file === 'elsewhere/deck.html');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('[data-svg] svg, [data-svg] img').length)).toBeGreaterThan(0);
    // An existing file is not overwritten by accident.
    const clash = await request.post('/api/saveas?file=elsewhere/deck.html&to=' + encodeURIComponent(path.join(DECK_DIR, 'index.html')), { data: original, headers: { ...own, 'Content-Type': 'text/html' } });
    expect(clash.status()).toBe(409);
    expect(readDeck()).toBe(original);
    // Outside the workspace: the new folder becomes the workspace, like Open deck... does.
    const outside = fs.mkdtempSync(path.join(require('os').tmpdir(), 'deck-saveas-'));
    r = await page.evaluate((to) => window.deckEditor.saveAs({ to }), path.join(outside, 'talk.html'));
    expect(r.ok).toBe(true);
    expect(r.workspace.toLowerCase()).toBe(outside.toLowerCase());
    expect(r.file).toBe('talk.html');
    expect(fs.existsSync(path.join(outside, 'assets', 'shape.svg'))).toBe(true);
    await page.waitForFunction(() => window.deckEditor.file === 'talk.html');
    // Back to the test workspace for the tests that follow.
    await request.post('/api/workspace?path=' + encodeURIComponent(WS), { headers: own });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(path.join(WS, 'elsewhere'), { recursive: true, force: true });
    fs.rmSync(path.join(DECK_DIR, 'variant.html'), { force: true });
});

test('39 templates: New offers the imported designs; each one opens, presents and saves byte-identical', async ({ page }) => {
    test.setTimeout(240000);
    await page.goto('/');
    await page.waitForFunction(() => window.deckEditor);
    if (await page.locator('#drawer').isHidden()) await page.click('#btnFiles');   // the drawer opens by itself with no deck open
    await page.click('#btnNewDeck');
    await expect(page.locator('.tpl-card')).toHaveCount(32);
    await expect(page.locator('.tpl-card input[value="blank"]')).toBeChecked();
    for (const img of await page.locator('.tpl-card img').all()) {      // lazy: Firefox loads them only near the view
        await img.scrollIntoViewIfNeeded();
        await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth > 0)).toBe(true);
    }
    // Create one from a template through the form.
    await page.click('.tpl-card:has(input[value="sakura-chroma"])');
    await page.fill('#newDeckName', 'sakura-test');
    await page.click('#btnNewCreate');
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.deck.file === 'sakura-test/index.html');
    expect(await page.evaluate(() => window.deckEditor.deck.slides.map(s => s.dataset.name))).toEqual(['cover', 'manifesto', 'catalogue', 'stripe', 'data', 'quote', 'cal', 'colophon']);
    // The new deck is the template with the name it was given as its title (what the Decks list shows).
    const named = (file, name) => fs.readFileSync(file, 'utf8').replace(/<title([^>]*)>[\s\S]*?<\/title>/i, (m, a) => `<title${a}>${name}</title>`);
    expect(fs.readFileSync(path.join(__dirname, '.tmp-workspace', 'sakura-test', 'index.html'), 'utf8'))
        .toBe(named(path.join(__dirname, '..', 'app', 'templates', 'sakura-chroma.html'), 'Sakura test'));
    // Every template: the runtime is in, the reveal shows the text, a save without edits changes nothing.
    for (const slug of ['folio', 'boardroom', 'terrarium', 'console', 'sorbet', 'blueprint', 'minimal', 'bold', 'clean-dark', 'swiss', 'academic', 'pitch', 'workshop', 'portfolio', 'report', 'retro', 'notebook', 'deco', 'brutalist', 'broadsheet', 'aurora', 'sunset', 'nordic', 'neon', 'comic', 'tomorrow', 'sakura-chroma', 'neo-grid-bold', 'block-frame', 'studio', '8-bit-orbit', 'welcome']) {
        const r = await page.evaluate((slug) => window.deckEditor.api.newDeck('tpl-' + slug + '/index.html', slug), slug);
        const file = path.join(__dirname, '.tmp-workspace', 'tpl-' + slug, 'index.html');
        const created = fs.readFileSync(file);
        const template = path.join(__dirname, '..', 'app', 'templates', slug + '.html');
        expect(created.toString('utf8'), slug + ' named').toBe(slug === 'welcome' ? fs.readFileSync(template, 'utf8') : named(template, 'Tpl ' + slug.replace(/-/g, ' ')));
        await page.goto('/?file=' + r.file);
        await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
        await page.waitForFunction(() => window.deckEditor.deck.win.deckRuntime && window.deckEditor.deck.win.deckRuntime.version >= 6);
        await page.waitForTimeout(1500);
        const shown = await page.evaluate(() => { const d = window.deckEditor.deck; const el = d.currentSlide.querySelector('.reveal, [data-fx]'); return el ? +d.win.getComputedStyle(el).opacity : 1; });
        expect(shown, slug + ' reveal').toBe(1);
        expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('.deck-stage [data-page-total]').length)).toBeGreaterThan(0);
        await save(page);
        expect(Buffer.compare(fs.readFileSync(file), created), slug + ' round trip').toBe(0);
        fs.rmSync(path.join(__dirname, '.tmp-workspace', 'tpl-' + slug), { recursive: true, force: true });
    }
    fs.rmSync(path.join(__dirname, '.tmp-workspace', 'sakura-test'), { recursive: true, force: true });
});

/* ------------------------------------------------------------
   46. Previous versions: listed, opened as a copy, restored
   ------------------------------------------------------------ */
test('46 versions: the saves keep previous versions; the list shows them with title and slide count; a copy opens beside the deck; restore brings one back', async ({ page }) => {
    await openDeck(page);
    // Two saves with a visible difference each: the title changes, then a slide is added.
    const setTitle = (t) => page.evaluate((t) => { const ed = window.deckEditor; const h = ed.deck.doc.querySelector('h1'); ed.history.remember(h); const before = h.innerHTML; h.innerHTML = t; ed.history.html(h, before, t, 'Edit text'); }, t);
    await setTitle('Version one');
    await save(page);
    await setTitle('Version two');
    await page.evaluate(() => { const ed = window.deckEditor; ed.strip.addSlide(0, 'blank'); });
    await page.waitForTimeout(300);
    await save(page);
    // The list: newest previous first (the one before the last save: "Version one", 4 slides), then the original.
    await page.click('#btnExport');
    await page.click('[data-x="versions"]');
    await expect(page.locator('.help.versions')).toBeVisible();
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.versions-card tr')).map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toMatch(/before the last save/);
    expect(rows[0]).toMatch(/Sample deck \(test fixture\) · 3 slides/);
    expect(rows[1]).toMatch(/· 3 slides/);
    // Open a copy: a new file beside the deck, opened, the deck itself untouched.
    await page.click('.versions-card tr:nth-child(1) [data-a="copy"]');
    await page.waitForTimeout(800);
    const copy = await page.evaluate(() => ({ file: window.deckEditor.file, title: window.deckEditor.deck.doc.querySelector('h1').textContent, slides: window.deckEditor.deck.slides.length }));
    expect(copy.file).toMatch(/^sample\/index \(\d{4}-\d\d-\d\d \d\d\.\d\d\)\.html$/);
    expect(copy.title).toBe('Version one');
    expect(copy.slides).toBe(3);
    expect(readDeck()).toContain('Version two');
    // Restore the original from the deck: the deck is the original again, "Version two" the newest previous version.
    await openDeck(page);
    await page.click('#btnExport');
    await page.click('[data-x="versions"]');
    await page.click('.versions-card tr:nth-child(2) [data-a="restore"]');
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').textContent)).toBe('Sample deck title');
    expect(readDeck()).toContain('Sample deck title');
    await page.click('#btnExport');
    await page.click('[data-x="versions"]');
    await expect(page.locator('.versions-card tr').first()).toBeVisible();
    const after = await page.evaluate(() => Array.from(document.querySelectorAll('.versions-card tr')).map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
    expect(after[0]).toMatch(/· 4 slides/);
    await page.click('#verClose');
    await expect(page.locator('.help.versions')).toHaveCount(0);
    fs.rmSync(path.join(DECK_DIR, copy.file.slice('sample/'.length)), { force: true });
});

/* ------------------------------------------------------------
   51. Handout PDF: a slide and its notes per page
   ------------------------------------------------------------ */
test('51 handout: the PDF with notes has each slide scaled down with its notes under it, one page per slide', async ({ page }) => {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.inspector.applyNotes('First line of notes.\n\nSecond paragraph.'));
    const printable = await page.evaluate(() => window.deckEditor.exporter.printableHtml({ handout: true }));
    const doc = printable;
    expect((doc.match(/class="print-notes"/g) || []).length).toBe(3);
    expect(doc).toMatch(/<section class="slide title-slide[^>]*>[\s\S]*?<\/section>\s*<div class="print-notes"><div class="print-notes-h">Slide 1 of 3<\/div><p>First line of notes\.<\/p><p>Second paragraph\.<\/p><\/div>/);
    expect(doc).toContain('<p class="print-notes-none">No notes.</p>');
    expect(doc).toContain('.deck-stage > .slide { zoom: 0.6;');
    expect(doc).toMatch(/print-notes"[^>]*data-print-last=""|data-print-last="" class="print-notes"/);
    const r = await page.evaluate(() => window.deckEditor.exporter.pdf({ to: 'handout.pdf', handout: true }));
    test.skip(r && r.printed, 'no Chrome / Edge on this machine: the browser print dialog was used instead');
    expect(r.ok).toBe(true);
    const pdf = fs.readFileSync(path.join(DECK_DIR, 'handout.pdf'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(3);
    fs.rmSync(path.join(DECK_DIR, 'handout.pdf'), { force: true });
});

/* ------------------------------------------------------------
   62. Scripts in decks: only Diapo's run until the deck is trusted
   ------------------------------------------------------------ */
test('62 deck scripts: a deck\'s own scripts and handlers are paused, Diapo\'s run, trusting runs them, a change pauses them again', async ({ page }) => {
    // A deck made from the blank template, plus a script and an inline handler of its own that
    // would, if they ran, reach the server as if they were the editor.
    const dir = path.join(__dirname, '.tmp-workspace', 'untrusted');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const blank = fs.readFileSync(path.join(__dirname, '..', 'app', 'templates', 'blank.html'), 'utf8');
    const evil = '<script>window.__ownScript = 1; fetch("/api/workspace?path=" + encodeURIComponent("C:\\\\"), { method: "POST" });</script>';
    // (the last </body>: the runtime's own text mentions one)
    const end = (html, tag, add) => { const i = html.lastIndexOf(tag); return html.slice(0, i) + add + html.slice(i); };
    const withScripts = (extra) => end(end(blank, '</main>', '<img src="nope.png" onerror="window.__handler = 1">'), '</body>', evil + extra);
    fs.writeFileSync(path.join(dir, 'index.html'), withScripts(''));
    const file = 'untrusted/index.html';

    // The server says so in a header, and in /api/trust.
    const res = await page.request.get('/deck/' + file);
    expect(res.headers()['content-security-policy']).toMatch(/^script-src 'sha256-/);
    expect((await page.request.get('/')).headers()['content-security-policy']).toContain('/core/');
    await page.goto('/?file=' + file);
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.trust);
    await page.waitForTimeout(500);
    let st = await page.evaluate(() => { const d = window.deckEditor.deck; return { own: d.win.__ownScript, handler: d.win.__handler, runtime: !!d.win.deckRuntime, trust: d.trust }; });
    expect(st.own).toBeUndefined();
    expect(st.handler).toBeUndefined();
    expect(st.runtime).toBe(true);                         // the presentation features are Diapo's: they run
    expect(st.trust).toMatchObject({ trusted: false, scripts: 1 });
    expect((await (await page.request.get('/api/status')).json()).workspace).toBe(path.join(__dirname, '.tmp-workspace'));
    await expect(page.locator('.bar.trust-bar')).toContainText('paused');
    // Thumbnails are copies of slides inside the editor: never scripts there.
    await expect(page.locator('.thumb-frame').first()).toHaveAttribute('sandbox', 'allow-same-origin');
    // The printable copy (the PDF is printed from a file) keeps them paused too.
    const printable = await page.evaluate(async () => { await window.deckEditor.exporter.helpersReady; return window.deckEditor.exporter.printableHtml(); });
    expect(printable).toMatch(/<meta http-equiv="Content-Security-Policy" content="script-src 'sha256-/);

    // Trusting the deck opens it again with its scripts running (and the handler).
    await page.route('**/api/workspace?**', r => r.fulfill({ status: 200, body: '{"ok":true}' }));   // what the script asks for is not the point
    await page.click('.bar.trust-bar [data-a="trust"]');
    await page.waitForFunction(() => window.deckEditor.deck.trust && window.deckEditor.deck.trust.trusted && window.deckEditor.deck.win.__ownScript === 1);
    expect(res.headers()['content-security-policy']).toBeTruthy();
    expect((await page.request.get('/deck/' + file)).headers()['content-security-policy']).toBe("frame-ancestors 'self'");   // scripts free, framing still not
    expect(await page.evaluate(() => window.deckEditor.exporter.printableHtml())).not.toContain('Content-Security-Policy');

    // A deck whose scripts change is not the deck that was trusted: paused again.
    fs.writeFileSync(path.join(dir, 'index.html'), withScripts('<script>window.__another = 1;</script>'));
    expect((await page.request.get('/deck/' + file)).headers()['content-security-policy']).toMatch(/^script-src/);
    expect((await (await page.request.get('/api/trust?file=' + encodeURIComponent(file))).json())).toMatchObject({ trusted: false, scripts: 2 });
    // Any other file under /deck/ that a frame could show as a document runs nothing.
    fs.writeFileSync(path.join(dir, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await page.request.get('/deck/untrusted/pic.svg')).headers()['content-security-policy']).toBe("script-src 'none'; form-action 'none'; frame-ancestors 'self'");

    // A script file next to the deck is trusted by its contents: a changed library pauses the deck.
    const policy = async () => (await page.request.get('/deck/' + file)).headers()['content-security-policy'];
    const trustNow = async () => (await (await page.request.post('/api/trust?file=' + encodeURIComponent(file) + '&on=1')).json());
    fs.writeFileSync(path.join(dir, 'lib.js'), 'window.__lib = 1;');
    fs.writeFileSync(path.join(dir, 'index.html'), withScripts('<script src="lib.js"></script>'));
    expect(await trustNow()).toMatchObject({ trusted: true, scripts: 2, remote: 0 });
    expect(await policy()).toBe("frame-ancestors 'self'");
    fs.writeFileSync(path.join(dir, 'lib.js'), 'window.__lib = 2; /* something else now */');
    expect(await policy()).toMatch(/^script-src 'sha256-/);
    expect((await (await page.request.get('/api/trust?file=' + encodeURIComponent(file))).json()).trusted).toBe(false);
    // A script from the internet is trusted by its address: the bar says its contents can change.
    fs.writeFileSync(path.join(dir, 'index.html'), withScripts('<script src="https://cdn.example.com/chart.js"></script>'));
    expect((await (await page.request.get('/api/trust?file=' + encodeURIComponent(file))).json())).toMatchObject({ trusted: false, scripts: 2, remote: 1 });
    await page.evaluate((f) => window.deckEditor.openDeck(f), file);
    await expect(page.locator('.bar.trust-bar')).toContainText('One of them comes from the internet');
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });   // Windows may hold the folder a moment (EPERM)
});

test('65 save conflict: a deck changed on disk after it was opened is not overwritten unasked; Save over it, Open the file on disk', async ({ page }) => {
    await openDeck(page);
    const v0 = (await page.request.get('/deck/sample/index.html')).headers()['x-diapo-version'];
    expect(v0).toMatch(/^[0-9a-f]{24}$/);
    expect(await page.evaluate(() => window.deckEditor.deck.diskVersion)).toBe(v0);

    // Saving with nothing changed elsewhere goes through and moves the version on.
    await page.evaluate(() => { window.deckEditor.deck.doc.querySelector('h1').textContent = 'Mine 1'; window.deckEditor.history.forceDirty(); });
    await save(page);
    const v1 = await page.evaluate(() => window.deckEditor.deck.diskVersion);
    expect(v1).not.toBe(v0);
    expect(v1).toBe((await page.request.get('/deck/sample/index.html')).headers()['x-diapo-version']);

    // Another program changes the file; the next save stops and asks.
    const theirs = readDeck().replace('Mine 1', 'Theirs');
    fs.writeFileSync(DECK, theirs);
    await page.evaluate(() => { window.deckEditor.deck.doc.querySelector('h1').textContent = 'Mine 2'; window.deckEditor.history.forceDirty(); });
    await page.evaluate(() => window.deckEditor.save());
    await expect(page.locator('.bar.conflict-bar')).toContainText('changed on disk');
    expect(readDeck()).toBe(theirs);
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(true);
    // Straight to the server, an old version is refused too (409), and overwrite=1 writes.
    const refused = await page.request.post('/api/save?file=sample%2Findex.html&base=' + v1, { data: theirs.replace('Theirs', 'X'), headers: { 'Content-Type': 'text/html' } });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).reason).toBe('changed');

    // Save over it: the editor's text is written, theirs is the newest previous version.
    await page.click('.bar.conflict-bar [data-a="over"]');
    await page.waitForFunction(() => !window.deckEditor.dirty);
    expect(readDeck()).toContain('Mine 2');
    expect(fs.readFileSync(path.join(DECK_DIR, '.deck-editor', 'index.html.bak'), 'utf8')).toContain('Theirs');

    // Open the file on disk: the edits are dropped and the editor shows what is there.
    fs.writeFileSync(DECK, readDeck().replace('Mine 2', 'Theirs again'));
    await page.evaluate(() => { window.deckEditor.deck.doc.querySelector('h1').textContent = 'Mine 3'; window.deckEditor.history.forceDirty(); });
    await page.evaluate(() => window.deckEditor.save());
    page.once('dialog', d => d.accept());
    await page.click('.bar.conflict-bar [data-a="disk"]');
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && !window.deckEditor.dirty && window.deckEditor.deck.doc.querySelector('h1').textContent === 'Theirs again');
    expect(readDeck()).toContain('Theirs again');

    // A draft left from an earlier session, older than the file: restoring it does not make the
    // file's new text the base, so its first save asks too.
    const draftFile = path.join(DECK_DIR, '.deck-editor', 'index.html.~draft');
    fs.mkdirSync(path.dirname(draftFile), { recursive: true });
    fs.writeFileSync(draftFile, readDeck().replace('Theirs again', 'From the draft'));
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(draftFile, past, past);
    await page.goto('/?file=sample/index.html');
    await page.click('.bar [data-a="keep"]');
    await page.waitForFunction(() => window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('h1').textContent === 'From the draft');
    expect(await page.evaluate(() => window.deckEditor.deck.diskVersion)).toBe('draft-older-than-file');
    await page.evaluate(() => window.deckEditor.save());
    await expect(page.locator('.bar.conflict-bar')).toBeVisible();
    expect(readDeck()).toContain('Theirs again');
});

test('66 framing: the editor, its pages and the decks may be shown in a frame only by the editor itself', async ({ page }) => {
    for (const url of ['/', '/presenter.html', '/deck/sample/index.html', '/deck/sample/assets/shape.svg', '/editor.css']) {
        const h = (await page.request.get(url)).headers();
        expect(h['content-security-policy'], url).toContain("frame-ancestors 'self'");
        expect(h['x-frame-options'], url).toBe('SAMEORIGIN');
    }
    // A page of another origin (a server on another port; a site on the internet is held back by
    // the browser's local network checks anyway) that frames the editor gets nothing.
    const srv = require('http').createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<iframe src="http://127.0.0.1:8811/"></iframe>'); });
    await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
    try {
        await page.goto('http://127.0.0.1:' + srv.address().port + '/');
        await page.waitForTimeout(1500);
        const frame = page.frames().find(f => f !== page.mainFrame());
        expect(frame).toBeTruthy();
        // (the request itself is refused too, test 9c: the frame shows the refusal, not the editor)
        expect(await frame.evaluate(() => !!window.deckEditor).catch(() => false)).toBe(false);
    } finally { srv.close(); }
});
test('68 small things: the tour\'s folder in the status bar, rename keeps versions, draft and trust, previews fetch no stray pictures', async ({ page }) => {
    // The status bar names the tour's own folder while the tour is open.
    await openDeck(page);
    await expect(page.locator('#statusWorkspace')).toHaveText(WS);
    await page.evaluate(() => window.deckEditor.openSampleDeck());
    await page.waitForFunction(() => window.deckEditor.file === '@diapo/welcome/index.html');
    await expect(page.locator('#statusWorkspace')).toHaveText('Diapo tour, in a folder of its own');

    // Rename: the previous versions, the draft, trust and the Recent entry follow the deck.
    const file = 'sample/index.html', q = encodeURIComponent;
    const deck = readDeck();
    for (const n of [1, 2]) await page.request.post('/api/save?file=' + q(file), { data: deck.replace('Sample deck title', 'Version ' + n), headers: { 'Content-Type': 'text/html' } });
    await page.request.post('/api/draft?file=' + q(file), { data: deck.replace('Sample deck title', 'Draft'), headers: { 'Content-Type': 'text/html' } });
    await page.request.post('/api/recent?file=' + q(file));
    const versions = (await (await page.request.get('/api/versions?file=' + q(file))).json()).versions.length;
    expect(versions).toBeGreaterThan(0);
    const r = await page.request.post('/api/rename?file=' + q(file) + '&to=renamed');
    expect(r.status()).toBe(200);
    const moved = 'sample/renamed.html';
    try {
        expect((await (await page.request.get('/api/versions?file=' + q(moved))).json()).versions.length).toBe(versions);
        expect((await (await page.request.get('/api/draft?file=' + q(moved))).json()).exists).toBe(true);
        expect((await (await page.request.get('/api/trust?file=' + q(moved))).json()).trusted).toBe(true);
        expect((await (await page.request.get('/api/status')).json()).recent.some(x => x.file === moved)).toBe(true);
        expect(fs.readdirSync(path.join(DECK_DIR, '.deck-editor')).filter(f => f.startsWith('index.html'))).toEqual([]);
    } finally {
        await page.request.post('/api/rename?file=' + q(moved) + '&to=index');
    }

    // Deck previews: a deck whose first slide shows a picture fetches it from its own folder only.
    const dir = path.join(WS, 'previewcheck');
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.copyFileSync(path.join(DECK_DIR, 'assets', 'shape.svg'), path.join(dir, 'assets', 'pic.svg'));
    const blank = fs.readFileSync(path.join(__dirname, '..', 'app', 'templates', 'blank.html'), 'utf8');
    const at = blank.indexOf('<section class="slide');
    const end = blank.indexOf('>', at) + 1;
    fs.writeFileSync(path.join(dir, 'index.html'), blank.slice(0, end) + '<img src="assets/pic.svg" alt="">' + blank.slice(end));
    const stray = [];
    page.on('response', res => { if (/\/assets\/pic\.svg$/.test(res.url()) && !res.url().includes('/deck/previewcheck/')) stray.push(res.url() + ' ' + res.status()); });
    try {
        await page.keyboard.press('Control+o');
        await page.fill('#drawerFilter', 'previewcheck');
        await page.waitForSelector('#drawerList .deck-thumb.filled');
        await page.waitForTimeout(800);
        expect(stray).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('69 decks drawer: grouped by subfolder, folds remembered, web pages that are not decks hidden until asked for', async ({ page }) => {
    const dir = path.join(WS, 'drawer-check');
    const deckDir = path.join(dir, 'talks', 'keynote');
    fs.mkdirSync(deckDir, { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(deckDir, 'index.html'));
    fs.writeFileSync(path.join(dir, 'talks', 'page.html'), '<!doctype html><title>A saved page</title><p>Not a deck</p>');
    try {
        const files = (await (await page.request.get('/api/list?dir=')).json()).files;
        expect(files.find(f => f.path === 'drawer-check/talks/keynote/index.html').deck).toBe(true);
        expect(files.find(f => f.path === 'drawer-check/talks/page.html').deck).toBe(false);

        await page.goto('/');
        await page.waitForFunction(() => window.deckEditor && document.body.classList.contains('no-deck'));
        await page.keyboard.press('Control+o');
        // A deck kept as <name>/index.html lives in the folder above: "drawer-check / talks".
        const heading = page.locator('#drawerList [data-fold="drawer-check/talks"]');
        await expect(heading).toHaveAttribute('aria-expanded', 'true');
        const keynote = page.locator('#drawerList .drawer-file[data-path="drawer-check/talks/keynote/index.html"]');
        await expect(keynote.locator('.meta')).toContainText('keynote/index.html');
        await expect(page.locator('#drawerList .drawer-file[data-path="sample/index.html"]')).toBeVisible();
        await expect(page.locator('#drawerList .drawer-file.other')).toHaveCount(0);
        await expect(page.locator('#drawerList [data-other]')).toHaveText('Show 1 other HTML file');

        // Folded, and still folded after a reload; a filter shows the matches anyway.
        await heading.click();
        await expect(keynote).toHaveCount(0);
        await page.reload();
        await page.waitForFunction(() => window.deckEditor && document.body.classList.contains('no-deck'));
        await page.keyboard.press('Control+o');
        await expect(heading).toHaveAttribute('aria-expanded', 'false');
        await expect(keynote).toHaveCount(0);
        await page.fill('#drawerFilter', 'keynote');
        await expect(keynote).toBeVisible();
        await page.fill('#drawerFilter', '');
        await heading.click();

        // The page that is not a deck shows when asked for, and says so instead of opening.
        await page.locator('#drawerList [data-other]').click();
        const other = page.locator('#drawerList .drawer-file.other[data-path="drawer-check/talks/page.html"]');
        await expect(other.locator('.meta')).toContainText('Not a deck');
        await other.locator('.drawer-deck').click();
        await expect(page.locator('.toast')).toContainText('not a deck');
        expect(await page.evaluate(() => window.deckEditor.deck.isOpen)).toBeFalsy();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ------------------------------------------------------------
   71. PowerPoint export
   ------------------------------------------------------------ */
test('71 powerpoint: Export > PowerPoint measures every slide into text boxes, pictures, drawings, a native chart and notes; the editor is left as it was', async ({ page }) => {
    test.setTimeout(90000);
    await openDeck(page);
    // An editor chart and an equation on slide 3, a selection and slide 3 showing when the export starts.
    await goTo(page, 2);
    await page.evaluate(async () => { const ed = window.deckEditor; ed.insert.chart(); await ed.insert.equation('x^2'); });
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.querySelector('h2')); });
    const spec = await page.evaluate(async () => {
        const m = await import('/core/pptx.js');
        const s = await new m.PptxCollector(window.deckEditor).collect();
        return s.slides.map(sl => ({ hidden: sl.hidden, notes: sl.notes, bg: sl.bg,
            items: sl.items.map(it => ({ kind: it.kind, chart: it.chart, name: it.name, text: (it.paras || []).map(p => p.runs.map(r => r.t || '').join('')).join('|'),
                bullets: (it.paras || []).filter(p => p.bullet).length, svg: !!it.svg, png: !!it.png, series: it.series && it.series.length, x: Math.round(it.x), w: Math.round(it.w) })) }));
    });
    expect(spec).toHaveLength(3);
    expect(spec[0].notes).toBe('Notes for slide one.');
    const texts = (i) => spec[i].items.map(it => it.text).join(' / ');
    expect(texts(0)).toContain('Sample deck title');
    expect(texts(0)).toContain('Presenter name');
    expect(texts(1)).toContain('A chart and a scheme');
    expect(spec[1].items.some(it => it.kind === 'svg' && it.svg && it.png)).toBe(true);        // the deck's own chart, as a drawing
    const list = spec[2].items.find(it => it.text.includes('First point'));
    expect(list.text).toBe('Section|Three points|First point|Second point|Third point');   // the column of text is one box, a paragraph each
    expect(list.bullets).toBe(3);
    const chart = spec[2].items.find(it => it.kind === 'chart');
    expect(chart.chart).toBe('column');
    expect(chart.series).toBeGreaterThan(0);
    expect(spec[2].items.some(it => it.kind === 'svg' && it.name === 'Equation')).toBe(true);
    expect(spec[0].bg.color).toMatch(/^#[0-9a-f]{6}$/);
    // The export itself: a .pptx beside the deck, and the editor back on slide 3 with its selection.
    await goTo(page, 2);
    await page.evaluate(() => { const ed = window.deckEditor; ed.selection.select(ed.deck.currentSlide.querySelector('h2')); });
    const r = await page.evaluate(() => window.deckEditor.exporter.pptx({ to: 'export-test', dialog: false }));
    expect(r.ok).toBe(true);
    const out = path.join(DECK_DIR, 'export-test.pptx');
    const head = fs.readFileSync(out).subarray(0, 2).toString();
    expect(head).toBe('PK');                                                                     // a zip: the OOXML package
    expect(fs.statSync(out).size).toBeGreaterThan(5000);
    expect(Array.isArray(r.notes)).toBe(true);
    expect(await page.evaluate(() => window.deckEditor.deck.current)).toBe(2);
    expect(await page.evaluate(() => window.deckEditor.selection.single && window.deckEditor.selection.single.tagName)).toBe('H2');
    for (let i = 0; i < 40; i++) {
        try { fs.rmSync(out, { force: true }); break; }
        catch (e) { if (i === 39 || !['EBUSY', 'EPERM'].includes(e.code)) throw e; await page.waitForTimeout(250); }
    }
});
