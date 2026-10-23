// Temporary: export templates to PowerPoint and screenshot Diapo's slides beside them; delete after use.
const { test, fs, path, WS } = require('./helpers');
const OUT = path.join(__dirname, '..', 'tools', 'pptx-export');
const SLUGS = (process.env.PPTX_SLUGS || 'folio,boardroom,terrarium,console,sorbet,blueprint,minimal,academic,welcome').split(',');

for (const slug of SLUGS) {
    test('zz pptx ' + slug, async ({ page }) => {
        test.setTimeout(180000);
        await page.setViewportSize({ width: 2700, height: 1400 });
        await page.goto('/');
        await page.waitForFunction(() => window.deckEditor);
        const r = await page.evaluate((slug) => window.deckEditor.api.newDeck('px-' + slug + '/index.html', slug), slug);
        await page.goto('/?file=' + r.file);
        await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
        await page.waitForTimeout(1500);
        const dir = path.join(OUT, slug);
        fs.mkdirSync(dir, { recursive: true });
        const spec = await page.evaluate(async () => { const m = await import('/core/pptx.js'); const c = new m.PptxCollector(window.deckEditor); const s = await c.collect(); s.slides.forEach(sl => sl.items.forEach(it => { if (it.png) it.png = it.png.length; if (it.svg) it.svg = it.svg.length; if (it.src && it.src.data) it.src.data = it.src.data.length; })); return s; });
        fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 1));
        const res = await page.evaluate(async () => window.deckEditor.exporter.pptx({ to: 'export', dialog: false }));
        fs.copyFileSync(res.path, path.join(OUT, slug + '.pptx'));
        fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify(res.notes, null, 1));
        // Diapo's own slides, at zoom 1, for the side-by-side.
        await page.evaluate(() => { window.deckEditor.setZoom(1); window.deckEditor.selection.clear(); });
        const n = await page.evaluate(() => window.deckEditor.deck.slides.length);
        for (let i = 0; i < n; i++) {
            await page.evaluate((i) => window.deckEditor.deck.goTo(i), i);
            await page.waitForTimeout(900);
            await page.frameLocator('#deckFrame').locator('.deck-stage').screenshot({ path: path.join(dir, `diapo-${String(i + 1).padStart(2, '0')}.png`) });
        }
        fs.rmSync(path.join(WS, 'px-' + slug), { recursive: true, force: true });
    });
}
