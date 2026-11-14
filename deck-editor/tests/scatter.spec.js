// Scatter (XY) charts: the seventh chart kind, X from the first column, both axes numbers.
// Run with: npx playwright test tests/scatter.spec.js   (from the deck-editor folder)
const { test, expect, openDeck, readDeck, save, freshDeckEachTest } = require('./helpers');

freshDeckEachTest();

const fig = (page) => page.evaluate(() => {
    const f = window.deckEditor.deck.doc.querySelector('figure[data-chart]');
    if (!f) return null;
    const svg = f.querySelector(':scope > svg');
    return { kind: f.dataset.chart, spec: JSON.parse(f.querySelector(':scope > script[data-chart-data]').textContent),
        text: svg.textContent, circles: svg.querySelectorAll('circle').length,
        lines: Array.from(svg.querySelectorAll('path[stroke-linejoin="round"]')).length, trend: svg.querySelectorAll('path[data-trend]').length,
        label: svg.getAttribute('aria-label') };
});

async function paste(page, selector, text) {
    await page.focus(selector);
    if (test.info().project.name === 'firefox') {
        await page.evaluate((t) => { const a = document.createElement('textarea'); a.id = 'pasteSrc'; a.value = t; document.body.appendChild(a); a.select(); }, text);
        await page.keyboard.press('Control+c');
        await page.evaluate(() => document.getElementById('pasteSrc').remove());
        await page.focus(selector);
        await page.keyboard.press('Control+v');
    } else {
        await page.evaluate((t) => {
            const dt = new DataTransfer(); dt.setData('text/plain', t);
            document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        }, text);
    }
}

test('scatter: switch a chart to scatter and back, paste X and Y, edit cells, log axes, lines, a trend line; saved and reopened the same', async ({ page }) => {
    await openDeck(page);
    await page.click('#btnInsert');
    await page.click('[data-insert="chart"]');
    // A column chart of quarters becomes a scatter with the points at 1, 2, 3, 4, its table untouched.
    await page.click('#chartKind [data-kind="scatter"]');
    let c = await fig(page);
    expect(c.kind).toBe('scatter');
    expect(c.spec.labels).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(c.circles).toBe(8 + 2);                                         // two series of four points, and the legend's
    expect(c.label).toMatch(/^Scatter chart of 4 points/);
    await expect(page.locator('#chartLinesRow')).toBeVisible();
    await expect(page.locator('#chartXRange')).toBeVisible();
    await expect(page.locator('#chartTrendRow')).toBeVisible();
    await expect(page.locator('#chartAngleRow')).toBeHidden();
    await expect(page.locator('#chartLabelHead')).toHaveText('X axis: the first column');
    // Back to columns: the same quarters.
    await page.click('#chartKind [data-kind="column"]');
    expect((await fig(page)).spec.labels).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    await page.click('#chartKind [data-kind="scatter"]');

    // Two columns of numbers pasted into the top-left cell, no headings: X and one series of Y.
    await paste(page, '#chartGrid input[data-r="0"][data-c="0"]', '0.5\t1.2\n1\t2.1\n2\t3.9\n4\t8.3\n');
    c = await fig(page);
    expect(c.spec.labels).toEqual(['0.5', '1', '2', '4']);
    expect(c.spec.series.map(s => s.values)).toEqual([[1.2, 2.1, 3.9, 8.3]]);
    expect(c.circles).toBe(4 + 1);
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Paste into chart');
    // A CSV with headings: the X heading becomes the X axis title; a negative exponent reads right.
    await paste(page, '#chartGrid input[data-r="0"][data-c="0"]', 'Dose (mg),Signal,Blank\n0.5,1.2,0.2\n1,2.1,1e-1\n2,3.9,0.3\n4,8.3,0.25\n');
    c = await fig(page);
    expect(c.spec.series.map(s => s.name)).toEqual(['Signal', 'Blank']);
    expect(c.spec.series[1].values).toEqual([0.2, 0.1, 0.3, 0.25]);
    expect(c.spec.labelAxis.title).toBe('Dose (mg)');
    expect(c.text).toContain('Dose (mg)');
    // A typed X moves its point; the axis reaches it.
    await page.fill('#chartGrid input[data-r="4"][data-c="0"]', '12');
    await page.press('#chartGrid input[data-r="4"][data-c="0"]', 'Tab');      // Enter on the last row would add one
    c = await fig(page);
    expect(c.spec.labels[3]).toBe('12');
    expect(c.text).toContain('12');
    // Log scale on both axes: powers of ten.
    await page.check('#inspChartAxes [data-set="valueAxis.log"]');
    await page.check('#inspChartAxes [data-set="labelAxis.log"]');
    c = await fig(page);
    expect(c.spec.valueAxis.log && c.spec.labelAxis.log).toBe(true);
    expect(c.text).toContain('100');                                       // 0.5 .. 12 on X spans 0.1 .. 100
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Chart label axis log');
    // An X range by hand, and where the Y axis crosses.
    await page.uncheck('#inspChartAxes [data-set="labelAxis.log"]');
    await page.fill('#inspChartAxes [data-set="labelAxis.max"]', '15');
    await page.press('#inspChartAxes [data-set="labelAxis.max"]', 'Enter');
    await page.fill('#chartValueAtX', '1');
    await page.press('#chartValueAtX', 'Enter');
    c = await fig(page);
    expect(c.spec.labelAxis.max).toBe(15);
    expect(c.spec.valueAxis.at).toBe('1');
    expect(c.text).toContain('15');
    // Lines between points, then a trend line with its R² in the legend.
    expect(c.lines).toBe(0);
    await page.check('#inspChart [data-opt="lines"]');
    c = await fig(page);
    expect(c.spec.lines).toBe(true);
    expect(c.lines).toBe(2);
    await page.check('#chartTrendRow [data-series-trend]');
    c = await fig(page);
    expect(c.spec.series[0].trend).toBe(true);
    expect(c.trend).toBe(1);
    expect(c.text).toMatch(/Signal \(R² = 0\.\d{3}\)/);
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Add trend line');
    // Error bars on Y work here too.
    await page.check('#chartErrRow [data-series-err]');
    await page.fill('#chartGrid input[data-r="1"][data-c="2"]', '0.3');
    await page.press('#chartGrid input[data-r="1"][data-c="2"]', 'Enter');
    c = await fig(page);
    expect(c.spec.series[0].errors[0]).toBe(0.3);
    // Undo takes back one step at a time.
    await page.evaluate(() => window.deckEditor.history.undo());
    expect((await fig(page)).spec.series[0].errors[0]).toBeNull();
    await page.evaluate(() => window.deckEditor.history.redo());

    // The PowerPoint export gets X as numbers and the scatter's own options.
    const item = await page.evaluate(async () => {
        const m = await import('/core/pptx.js');
        const s = await new m.PptxCollector(window.deckEditor).collect();
        const it = s.slides.flatMap(sl => sl.items).find(i => i.kind === 'chart');
        return { chart: it.chart, xValues: it.xValues, lines: it.lines, trend: it.series[0].trend, log: it.valueAxis.log, max: it.labelAxis.max };
    });
    expect(item).toEqual({ chart: 'scatter', xValues: [0.5, 1, 2, 12], lines: true, trend: true, log: true, max: 15 });

    // Saved, reopened: the same chart, and a second save is byte-identical.
    await save(page);
    const saved = readDeck();
    expect(saved).toMatch(/<figure data-chart="scatter"[^>]*>\s*<svg /);
    expect(saved).toContain('"lines":true');
    await openDeck(page);
    c = await fig(page);
    expect(c.kind).toBe('scatter');
    expect(c.spec.series[0].trend).toBe(true);
    expect(c.trend).toBe(1);
    await page.evaluate(() => window.deckEditor.history.forceDirty());
    await save(page);
    expect(readDeck()).toBe(saved);
    // The thumbnail shows the drawing too (it is plain SVG in the slide).
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.thumb-frame')).some(f => f.contentDocument && f.contentDocument.querySelector('figure[data-chart="scatter"] svg circle')));
});

test('scatter: negative values get faint zero lines and the numbers stay at the edge; axes crossing at zero take them along', async ({ page }) => {
    await openDeck(page);
    await page.click('#btnInsert');
    await page.click('[data-insert="chart"]');
    await page.click('#chartKind [data-kind="scatter"]');
    await paste(page, '#chartGrid input[data-r="0"][data-c="0"]', 'x\ty\n-4\t-3\n-1\t2\n2\t-1\n5\t4\n');
    const draw = () => page.evaluate(() => {
        const svg = window.deckEditor.deck.doc.querySelector('figure[data-chart] svg');
        const faint = Array.from(svg.querySelectorAll('line[stroke-width="1.5"]')).map(l => [+l.getAttribute('x1'), +l.getAttribute('y1'), +l.getAttribute('x2'), +l.getAttribute('y2')]);
        const zeroText = Array.from(svg.querySelectorAll('text')).filter(t => t.textContent === '0').map(t => [+t.getAttribute('x'), +t.getAttribute('y')]);
        return { faint, zeroText, w: svg.viewBox.baseVal.width };
    });
    let d = await draw();
    // A horizontal and a vertical line at zero, besides the faint X axis at the bottom.
    expect(d.faint.some(([x1, y1, x2, y2]) => y1 === y2 && x2 - x1 > 100)).toBe(true);
    expect(d.faint.some(([x1, y1, x2, y2]) => x1 === x2 && y2 - y1 > 100)).toBe(true);
    expect(d.zeroText.length).toBe(2);                                      // a 0 on each axis, at the edges
    // Both axes drawn and crossing at zero: the 0s an axis line would strike through go.
    await page.check('#inspChartAxes [data-set="valueAxis.line"]');
    await page.check('#inspChartAxes [data-set="labelAxis.line"]');
    await page.fill('#chartValueAtX', '0');
    await page.press('#chartValueAtX', 'Enter');
    await page.fill('#chartLabelAt', '0');
    await page.press('#chartLabelAt', 'Enter');
    d = await draw();
    expect(d.zeroText.length).toBe(0);
    expect(d.faint.length).toBe(0);
});
