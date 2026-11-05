// Arrows in equations: typed -> is drawn as an arrow outside \ce{} and \text{}, the palette inserts the TeX arrow or the mhchem one by the caret.
// Run with: npx playwright test tests/math-arrows.spec.js   (from the deck-editor folder)
const { test, expect, freshDeckEachTest, readDeck, save, openDeck } = require('./helpers');

freshDeckEachTest();

// The equation's drawing: its svg's content (not the label), and its data-key.
const drawing = (page) => page.evaluate(() => {
    const f = window.deckEditor.deck.doc.querySelector('figure[data-math]');
    const svg = f && f.querySelector(':scope > svg');
    return svg ? { inner: svg.innerHTML, key: svg.getAttribute('data-key'), label: svg.getAttribute('aria-label'), paths: svg.querySelectorAll('path').length } : null;
});

async function insertEquation(page) {
    await page.click('#btnInsert');
    await page.click('[data-insert="equation"]');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-math] > svg'));
}

// Types a formula in the panel and waits until its drawing shows it.
async function typeFormula(page, tex) {
    await page.fill('#mathTex', tex);
    await page.waitForFunction((tex) => {
        const svg = window.deckEditor.deck.doc.querySelector('figure[data-math] > svg');
        return svg && svg.getAttribute('aria-label') === tex;
    }, tex);
    await expect(page.locator('#mathError')).toBeHidden();
}

test('math arrows: a typed -> is drawn as the arrow, the source stays as typed', async ({ page }) => {
    test.setTimeout(60000);
    await openDeck(page);
    await insertEquation(page);

    await typeFormula(page, 'a -> b');
    const typed = await drawing(page);
    // The drawing is the one for the TeX arrow: same glyphs, same key.
    await typeFormula(page, '\\to ');
    const tex = await drawing(page);
    await typeFormula(page, 'a \\to b');
    const toArrow = await drawing(page);
    expect(typed.inner).toBe(toArrow.inner);
    expect(typed.key).toBe(toArrow.key);
    // ... and not the minus and the greater-than sign it used to be.
    await typeFormula(page, 'a - > b');
    expect((await drawing(page)).inner).not.toBe(toArrow.inner);

    // Each arrow the user can type, outside \ce{}: <-> , <=> and => too; <= stays a less-or-equal sign.
    for (const [typedTex, tex] of [['a <-> b', 'a \\leftrightarrow b'], ['A <=> B', 'A \\rightleftharpoons B'], ['x => y', 'x \\Rightarrow y'], ['a <- b', 'a \\leftarrow b']]) {
        await typeFormula(page, typedTex);
        const a = await drawing(page);
        await typeFormula(page, tex);
        expect((await drawing(page)).inner, typedTex).toBe(a.inner);
    }
    // <= is not an arrow and stays as it is (MathJax draws the < and the =, as before).
    expect(await page.evaluate(async () => (await import('/core/math.js')).drawnTex('x <= y'))).toBe('x <= y');
    await typeFormula(page, 'x <= y');
    await typeFormula(page, 'x \\leq y');

    // The source is saved as typed; the drawing is what the slide shows.
    await typeFormula(page, 'a -> b');
    await page.locator('#mathTex').blur();
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-math]').getAttribute('data-math') === 'a -> b');
    await save(page);
    const saved = /<figure[^>]*data-math="([^"]*)"/.exec(readDeck());   // the file escapes > in an attribute
    expect(saved && saved[1].replace(/&gt;/g, '>')).toBe('a -> b');
});

test('math arrows: mhchem keeps -> inside \\ce{} and \\text{}', async ({ page }) => {
    test.setTimeout(60000);
    await openDeck(page);
    await insertEquation(page);

    await typeFormula(page, '\\ce{A -> B}');
    const ce = await drawing(page);
    expect(ce.paths).toBeGreaterThanOrEqual(3);
    // The mhchem reaction arrow is not the TeX arrow: the drawing differs from \ce{A \to B}.
    await typeFormula(page, '\\ce{A \\to B}');
    expect((await drawing(page)).inner).not.toBe(ce.inner);
    // Back to the mhchem arrow: the same drawing as before.
    await typeFormula(page, '\\ce{A -> B}');
    expect((await drawing(page)).inner).toBe(ce.inner);

    // Inside \text{}, the arrow is text and is left as it is.
    await typeFormula(page, '\\text{a -> b}');
    expect(await page.evaluate(async () => (await import('/core/math.js')).drawnTex('\\text{a -> b}'))).toBe('\\text{a -> b}');

    // A structure's arrow after the \ce{} closes is drawn as an arrow again.
    await typeFormula(page, '\\ce{H2 + O2} -> \\ce{H2O}');
    const after = await drawing(page);
    await typeFormula(page, '\\ce{H2 + O2} \\to \\ce{H2O}');
    expect((await drawing(page)).inner).toBe(after.inner);
});

test('math arrows: the palette inserts the TeX arrow, or the mhchem one inside \\ce{}', async ({ page }) => {
    test.setTimeout(60000);
    await openDeck(page);
    await insertEquation(page);

    // Outside \ce{}: the TeX arrow.
    await page.fill('#mathTex', 'a ');
    await page.evaluate(() => { const t = document.getElementById('mathTex'); t.focus(); t.setSelectionRange(2, 2); });
    await page.click('#mathKeys button[title^="Arrow:"]');
    expect(await page.inputValue('#mathTex')).toBe('a \\to ');

    // Inside \ce{}: the mhchem arrow, with the caret where the palette left it.
    await page.fill('#mathTex', '\\ce{A B}');
    await page.evaluate(() => { const t = document.getElementById('mathTex'); t.focus(); t.setSelectionRange(6, 6); });
    await page.click('#mathKeys button[title^="Arrow:"]');
    expect(await page.inputValue('#mathTex')).toBe('\\ce{A  -> B}');
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-math] > svg').getAttribute('aria-label') === '\\ce{A  -> B}');

    // After \ce{...} is closed, the TeX arrow again.
    await page.fill('#mathTex', '\\ce{A} x');
    await page.evaluate(() => { const t = document.getElementById('mathTex'); t.focus(); t.setSelectionRange(8, 8); });
    await page.click('#mathKeys button[title^="Arrow:"]');
    expect(await page.inputValue('#mathTex')).toBe('\\ce{A} x\\to ');
});

test('math arrows: a drawing made from a -> before this change is drawn again on open', async ({ page }) => {
    test.setTimeout(60000);
    await openDeck(page);
    await insertEquation(page);
    await typeFormula(page, 'a -> b');
    await page.locator('#mathTex').blur();
    await page.waitForFunction(() => window.deckEditor.deck.doc.querySelector('figure[data-math]').getAttribute('data-math') === 'a -> b');
    // A drawing with the key the old code gave the raw source (djb2 of the text as typed).
    const stale = await page.evaluate(() => {
        const h = (s) => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };
        const svg = window.deckEditor.deck.doc.querySelector('figure[data-math] > svg');
        svg.setAttribute('data-key', 'm' + h('a -> b'));
        return svg.getAttribute('data-key');
    });
    const fresh = await page.evaluate(async () => {
        const m = await import('/core/math.js');
        await m.refreshMath(window.deckEditor.deck.stage);
        const svg = window.deckEditor.deck.doc.querySelector('figure[data-math] > svg');
        return { key: svg.getAttribute('data-key'), want: m.mathKey('a -> b') };
    });
    expect(fresh.key).toBe(fresh.want);
    expect(fresh.key).not.toBe(stale);
});
