// Maths inside a sentence: <span data-math> in the text, put in from a popover while typing (Alt+=), drawn in em on
// the baseline in the text's colour, an atom for the caret and Backspace, saved with its drawing, pasted with its
// LaTeX, skipped by find, listed under Problems when it does not parse, and read out as text in PowerPoint.
// Run with: npx playwright test tests/inline-math.spec.js   (from the deck-editor folder)
const { test, expect, fs, freshDeckEachTest, readDeck, save, openDeck, DECK } = require('./helpers');

freshDeckEachTest();

const SUB = '<p class="sub reveal" style="--i:2" data-edit>Subtitle or author</p>';

/* Edit an element of the first slide, the caret at the end of its text. */
async function editEnd(page, sel) {
    await page.evaluate((sel) => {
        const ed = window.deckEditor, el = ed.deck.doc.querySelector(sel);
        ed.selection.select(el);
        ed.textEdit.start(el);
    }, sel);
    await page.waitForFunction(() => window.deckEditor.textEdit.el);
}
/* The equation spans of an element: their LaTeX, whether drawn, and the editing mark. */
const spans = (page, sel) => page.evaluate((sel) => Array.from(window.deckEditor.deck.doc.querySelector(sel).querySelectorAll('span[data-math]'))
    .map(s => ({ tex: s.getAttribute('data-math'), drawn: !!s.querySelector(':scope > svg[data-key]'), ce: s.getAttribute('contenteditable') })), sel);
/* A deck whose subtitle holds `html`. */
function deckWith(html) {
    const deck = readDeck();
    expect(deck).toContain(SUB);
    fs.writeFileSync(DECK, deck.replace(SUB, `<p class="sub reveal" style="--i:2" data-edit>${html}</p>`));
}

test('inline maths: typed in with Alt+=, on the baseline, sized and coloured by the text, Backspace and undo', async ({ page }) => {
    test.setTimeout(90000);
    await openDeck(page);
    await editEnd(page, 'p.sub');
    await page.keyboard.type(' with ');
    await page.keyboard.press('Alt+Equal');
    await expect(page.locator('.mathpop')).toBeVisible();
    await expect(page.locator('.mathpop-in')).toBeFocused();
    await page.keyboard.type('k_{obs}');
    await page.waitForSelector('.mathpop-preview svg');            // the live preview
    await page.keyboard.press('Enter');
    await expect(page.locator('.mathpop')).toHaveCount(0);
    expect(await spans(page, 'p.sub')).toEqual([{ tex: 'k_{obs}', drawn: true, ce: 'false' }]);
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Insert equation');
    // The caret is after it: typing goes on there.
    await page.keyboard.type(' rises');
    await page.keyboard.press('Escape');
    const html = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('p.sub').innerHTML);
    expect(html.replace(/&nbsp;/g, ' ')).toMatch(/^Subtitle or author with <span data-math="k_\{obs\}"><svg[\s\S]*<\/svg><\/span> rises$/);
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('\u200B');

    // Sized in em, on the baseline (MathJax's depth below it), filled with the text's colour.
    const geo = () => page.evaluate(() => {
        const w = window.deckEditor.deck.win, p = window.deckEditor.deck.doc.querySelector('p.sub'), svg = p.querySelector('span[data-math] > svg');
        const mark = w.document.createElement('span'); mark.style.cssText = 'display:inline-block;width:0;height:0';
        svg.parentElement.after(mark);
        const cs = w.getComputedStyle(svg), r = svg.getBoundingClientRect(), k = r.height / parseFloat(cs.height);
        const out = { font: parseFloat(w.getComputedStyle(p).fontSize), h: parseFloat(cs.height), va: parseFloat(cs.verticalAlign), w: svg.style.width,
            drop: (r.bottom - mark.getBoundingClientRect().top) / k, fill: w.getComputedStyle(svg.querySelector('path')).fill, colour: w.getComputedStyle(p).color };
        mark.remove();
        return out;
    });
    let g = await geo();
    expect(g.w).toMatch(/em$/);
    expect(g.va).toBeLessThan(0);                                   // the subscript hangs below the baseline
    expect(Math.abs(g.drop + g.va)).toBeLessThan(1.5);              // ... by MathJax's depth, the rest above it
    expect(g.fill).toBe(g.colour);
    const ratio = g.h / g.font;
    await page.evaluate(() => { const ed = window.deckEditor, p = ed.deck.doc.querySelector('p.sub'); ed.history.style(p, (el) => { el.style.fontSize = '96px'; el.style.color = 'rgb(200, 0, 0)'; }, { label: 'Text' }); });
    g = await geo();
    expect(g.font).toBe(96);
    expect(Math.abs(g.h / g.font - ratio)).toBeLessThan(0.01);      // follows the size
    expect(Math.abs(g.drop + g.va)).toBeLessThan(1.5);
    expect(g.fill).toBe('rgb(200, 0, 0)');                          // and the colour
    await page.evaluate(() => window.deckEditor.history.undo());

    // An atom: Backspace right after it takes it whole, as an undo step; Ctrl+Z brings it back.
    await page.evaluate(() => {
        const ed = window.deckEditor, p = ed.deck.doc.querySelector('p.sub');
        ed.selection.select(p); ed.textEdit.start(p);
        const r = ed.deck.doc.createRange(); r.setStartAfter(p.querySelector('span[data-math]')); r.collapse(true);
        const s = ed.deck.win.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('Backspace');
    expect(await spans(page, 'p.sub')).toEqual([]);
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Delete equation');
    await page.keyboard.press('Control+z');
    expect(await spans(page, 'p.sub')).toEqual([{ tex: 'k_{obs}', drawn: true, ce: null }]);
    // Undo again: the insert goes.
    await page.evaluate(() => window.deckEditor.history.undo());
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await spans(page, 'p.sub')).toEqual([]);
});

test('inline maths: \\( \\) typed and converted, a click opens it again, Esc cancels, saved and opened again', async ({ page }) => {
    test.setTimeout(90000);
    await openDeck(page);
    await editEnd(page, 'p.sub');
    await page.keyboard.type(' \\(x^2\\)');
    await page.keyboard.press('Alt+Equal');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('p.sub span[data-math] > svg'));
    expect(await spans(page, 'p.sub')).toEqual([{ tex: 'x^2', drawn: true, ce: 'false' }]);
    await expect(page.locator('.mathpop')).toHaveCount(0);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('p.sub').textContent)).not.toContain('\\(');

    // A click on it while editing: the popover with its LaTeX; Esc leaves it as it is, Enter changes it.
    const at = async () => page.evaluate(() => {
        const s = window.deckEditor.deck.doc.querySelector('p.sub span[data-math]').getBoundingClientRect(), f = window.deckEditor.deck.iframe.getBoundingClientRect();
        return { x: f.left + s.left + s.width / 2, y: f.top + s.top + s.height / 2 };
    });
    let p = await at();
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('.mathpop-in')).toHaveValue('x^2');
    await page.keyboard.press('Escape');
    await expect(page.locator('.mathpop')).toHaveCount(0);
    expect(await page.evaluate(() => !!window.deckEditor.textEdit.el)).toBe(true);    // still editing
    await page.mouse.click(p.x, p.y);
    await page.fill('.mathpop-in', '\\frac{a}{b');
    await page.keyboard.press('Enter');
    await expect(page.locator('.mathpop-err')).toBeVisible();      // does not draw: not put in
    await page.fill('.mathpop-in', 'x^3');
    await page.keyboard.press('Enter');
    await expect(page.locator('.mathpop')).toHaveCount(0);
    expect((await spans(page, 'p.sub'))[0].tex).toBe('x^3');
    expect(await page.evaluate(() => window.deckEditor.history.top.label)).toBe('Edit equation');
    await page.keyboard.press('Escape');

    // Ctrl+K inside the text: Equation in the text.
    await editEnd(page, 'p.sub');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('equation in the text');
    await page.keyboard.press('Enter');
    await expect(page.locator('.mathpop-in')).toBeFocused();
    await page.keyboard.type('\\alpha');
    await page.keyboard.press('Enter');
    await expect(page.locator('.mathpop')).toHaveCount(0);
    expect((await spans(page, 'p.sub')).map(s => s.tex)).toEqual(['x^3', '\\alpha']);
    await page.keyboard.press('Escape');

    // Saved with its drawing, no editing marks; opened again, nothing to draw and nothing changed.
    const before = await page.evaluate(() => window.deckEditor.deck.doc.querySelector('p.sub').innerHTML);
    await save(page);
    const saved = readDeck();
    expect(saved).toMatch(/<span data-math="x\^3"><svg[^>]*style="display:inline; vertical-align:[^"]*em;/);
    expect(saved).not.toMatch(/<span data-math[^>]*contenteditable/);
    await openDeck(page);
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('p.sub').innerHTML)).toBe(before);
    expect(await page.evaluate(() => window.deckEditor.dirty)).toBe(false);
});

test('inline maths: copied between text boxes with its LaTeX, skipped by find, a bad one under Problems', async ({ page, context }) => {
    test.setTimeout(90000);
    deckWith('The rate <span data-math="k_{obs}"></span> rises, <span data-math="\\frac{"></span> no.');
    await openDeck(page);
    // Written with the LaTeX alone: drawn on open; the one that does not parse is a problem, its LaTeX shown.
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('p.sub span[data-math="k_{obs}"] > svg'));
    await expect(page.locator('#problemsBadge')).toHaveText('1 problem');
    await page.click('#problemsBadge');
    await expect(page.locator('.problems')).toContainText('Equation not drawn on slide 1');
    await expect(page.locator('.problems')).toContainText('\\frac{');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('p.sub span[data-math="\\\\frac{"]').textContent)).toBe('\\frac{');
    await page.keyboard.press('Escape');

    // Find: not inside the equations (their LaTeX is not words), and no match runs across one.
    const found = (q) => page.evaluate((q) => { const f = window.deckEditor.find; f.show(); f.input.value = q; f.refresh({ jump: false }); return f.matches.length; }, q);
    expect(await found('obs')).toBe(0);
    expect(await found('frac')).toBe(0);
    expect(await found('rate  rises')).toBe(0);
    expect(await found('rises')).toBe(1);
    await page.evaluate(() => window.deckEditor.find.close());

    // Clicking an equation on the canvas picks its text.
    expect(await page.evaluate(() => { const ed = window.deckEditor, s = ed.deck.doc.querySelector('p.sub span[data-math] svg path'); return ed.selection.pick(s) === ed.deck.doc.querySelector('p.sub'); })).toBe(true);

    // Copy from one text box, paste into another: the equation comes with its LaTeX, drawn again here.
    test.skip(test.info().project.name !== 'chrome', 'the clipboard round trip is checked in Chrome');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => {
        const ed = window.deckEditor, p = ed.deck.doc.querySelector('p.sub');
        ed.selection.select(p); ed.textEdit.start(p);
        const r = ed.deck.doc.createRange(); r.setStart(p.firstChild, 4); r.setEnd(p.querySelector('span[data-math]').nextSibling, 6);   // 'rate ' the equation ' rises'
        const s = ed.deck.win.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('Control+c');
    // As plain text, the equation is its LaTeX between $ signs.
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('rate $k_{obs}$ rises');
    await page.keyboard.press('Escape');
    await editEnd(page, 'h1');
    await page.keyboard.type(' ');
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('h1 span[data-math] > svg'));
    expect(await spans(page, 'h1')).toEqual([{ tex: 'k_{obs}', drawn: true, ce: 'false' }]);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.deckEditor.deck.doc.querySelector('h1').textContent)).toContain('rises');
    // The drawing is the h1's own: the same LaTeX drawn the same way, in the h1's size.
    expect(await page.evaluate(() => { const d = window.deckEditor.deck.doc; return d.querySelector('h1 span[data-math] svg').getAttribute('data-key') === d.querySelector('p.sub span[data-math] svg').getAttribute('data-key'); })).toBe(true);
});

test('inline maths: PowerPoint gets the equation as text, the index lowered, and says so', async ({ page }) => {
    test.setTimeout(90000);
    deckWith('The rate <span data-math="k_{obs}"></span> and <span data-math="E = mc^2"></span>, \\ce{} <span data-math="\\ce{H2O}"></span>');
    await openDeck(page);
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelectorAll('p.sub span[data-math] > svg').length === 3);
    const r = await page.evaluate(async () => {
        const m = await import('/core/pptx.js');
        const c = new m.PptxCollector(window.deckEditor);
        const spec = await c.collect();
        const item = spec.slides[0].items.find(i => i.paras && i.paras.some(p => p.runs.some(r => /rate/.test(r.t || ''))));
        return { runs: item ? item.paras.flatMap(p => p.runs).map(r => [r.t, r.base || 0]) : null, pics: spec.slides[0].items.filter(i => i.kind === 'svg').length, notes: c.notes };
    });
    expect(r.runs).not.toBeNull();
    const text = r.runs.map(([t]) => t).join('');
    expect(text).toContain('The rate kobs and E = mc2');
    expect(r.runs).toContainEqual(['obs', -25000]);
    expect(r.runs).toContainEqual(['2', 30000]);
    expect(text).toContain('H2O');
    expect(r.notes.join(' ')).toContain('equations inside text');
    // The plain-text reading of some common LaTeX.
    const plain = await page.evaluate(async () => { const m = await import('/core/math.js'); return ['\\frac{a}{b}', '\\alpha + \\beta \\to \\gamma', '\\sqrt{x+1}', 'T = 25^\\circ C', '\\ce{SO4^2-}', '\\text{rate} \\propto [A]'].map(m.texToText); });
    expect(plain).toEqual(['a/b', 'α + β → γ', '√(x+1)', 'T = 25° C', 'SO₄²⁻', 'rate ∝ [A]']);
});
