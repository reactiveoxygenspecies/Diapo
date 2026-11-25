// PowerPoint equations (Office Math) come in as the editor's own: a display equation as a figure[data-math], one in a
// sentence as a span[data-math] in its text, both drawn by MathJax when the deck opens. Every construct of
// tests/fixtures/import/make_math_pptx.py (slide 2 of math.pptx) must draw, and the deck must still export to PowerPoint.
// Run with: npx playwright test tests/omml-import.spec.js   (from the deck-editor folder)
const { test, expect, fs, path, IMPORT_DIR, WS, own } = require('./helpers');

test('PowerPoint equations: imported as LaTeX, drawn by MathJax, exported back to PowerPoint', async ({ page, request }) => {
    test.setTimeout(120000);
    const dir = path.join(WS, 'math-pptx');
    fs.rmSync(dir, { recursive: true, force: true });
    const r = await request.post('/api/import?path=' + encodeURIComponent(path.join(IMPORT_DIR, 'math.pptx')) + '&name=math-pptx', { headers: own });
    expect(r.status()).toBe(200);
    const j = await r.json();
    // The surface integral has no LaTeX MathJax draws: it keeps PowerPoint's picture, and the import says so.
    expect(j.notes).toEqual(["an equation came in as PowerPoint's picture of it, not as an equation you can edit (the operator ∯)"]);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    expect(html).toContain('<figure data-math="x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}" style="position:absolute; left:254.4px; top:367.2px; margin:0; font-size:64px; color:#1f4e79;"></figure>');
    expect(html).toMatch(/The energy <\/span><span style="font-size:48px;"><span data-math="E=mc\^\{2\}"><\/span><\/span><span style="font-size:48px;"> of a body at rest\./);
    expect(html).toContain("background:url('assets/image1.png')");

    await page.goto('/?file=math-pptx/index.html');
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen && window.deckEditor.deck.doc.querySelector('.slide.active.visible'));
    // Every equation is drawn once the deck opens, none listed under Problems.
    const total = await page.evaluate(() => window.deckEditor.deck.doc.querySelectorAll('[data-math]').length);
    expect(total).toBe(2 + 69);
    await page.waitForFunction(() => Array.from(window.deckEditor.deck.doc.querySelectorAll('[data-math]')).every(el => el.querySelector(':scope > svg[data-key]')), null, { timeout: 60000 });
    const drawn = await page.evaluate(() => {
        const ed = window.deckEditor, d = ed.deck.doc;
        return {
            problems: ed.problems.items.filter(p => p.kind === 'drawn').map(p => p.url + ': ' + p.message),
            errors: d.querySelectorAll('[data-math] [data-mml-node="merror"]').length,
            empty: Array.from(d.querySelectorAll('[data-math] > svg')).filter(s => !s.querySelector('path, use')).map(s => s.parentElement.getAttribute('data-math')),
        };
    });
    expect(drawn).toEqual({ problems: [], errors: 0, empty: [] });

    // The display equation: in its colour and size, the drawing filled with it; the inline one on the line of its text.
    const look = await page.evaluate(() => {
        const ed = window.deckEditor, w = ed.deck.win, d = ed.deck.doc;
        const fig = d.querySelector('figure[data-math]'), span = d.querySelector('span[data-math]');
        const p = span.closest('p'), pr = p.getBoundingClientRect(), sr = span.querySelector('svg').getBoundingClientRect();
        return { fill: w.getComputedStyle(fig.querySelector('svg path')).fill, size: w.getComputedStyle(fig).fontSize, figH: ed.deck.stageRect(fig).h,
            inLine: sr.top >= pr.top - 2 && sr.bottom <= pr.bottom + 2, inlineStyle: span.querySelector('svg').style.display };
    });
    expect(look.fill).toBe('rgb(31, 78, 121)');
    expect(look.size).toBe('64px');
    expect(look.figH).toBeGreaterThan(64);                  // a fraction: taller than a line
    expect(look.inLine).toBe(true);
    expect(look.inlineStyle).toBe('inline');

    // PowerPoint export: the equations go as pictures (the inline one as text), none left out for want of a drawing.
    const spec = await page.evaluate(async () => { const { PptxCollector } = await import('/core/pptx.js'); const c = new PptxCollector(window.deckEditor); const s = await c.collect(() => {}); return { slides: s.slides.map(sl => sl.items.filter(i => i.kind === 'svg' && i.name === 'Equation').length), runs: s.slides[0].items.filter(i => i.paras).flatMap(i => i.paras.flatMap(p => p.runs.map(r => r.t || ''))).join(''), notes: c.notes }; });
    expect(spec.slides).toEqual([1, 69]);
    expect(spec.runs).toContain('The energy E=mc2 of a body at rest.');
    expect(spec.notes.join(' ')).not.toContain('without its drawing');
    const out = await page.evaluate(() => window.deckEditor.exporter.pptx({ to: 'math-export', dialog: false }));
    expect(out.ok).toBe(true);
    const file = path.join(dir, 'math-export.pptx');
    expect(fs.readFileSync(file).subarray(0, 2).toString()).toBe('PK');
    fs.rmSync(dir, { recursive: true, force: true });
});
