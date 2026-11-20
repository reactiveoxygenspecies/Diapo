// Finding a slide in a presented deck (deck-runtime.js 15): Ctrl+Shift+F, Ctrl+K or / opens the
// overview with a search field (title, words, pictures' descriptions, equations, section; never the
// notes), Enter goes there, shows the steps up to what matched and outlines it; a number and Enter
// goes to that slide; the presenter windows (the deck's own and the editor's) find in the notes too.
const { test, expect, fs, path, freshDeckEachTest, WS, openDeck, save } = require('./helpers');

freshDeckEachTest();

const DIR = path.join(WS, 'find-deck');
const URL = '/deck/find-deck/index.html';

/* A 30-slide deck made from the blank template (its controller and runtime as they are). */
function writeDeck() {
    const blank = fs.readFileSync(path.join(__dirname, '..', 'app', 'templates', 'blank.html'), 'utf8');
    const slides = [];
    for (let n = 1; n <= 30; n++) {
        let attrs = '', body = `<h2>Topic ${n}</h2><p>Filler text ${n}</p>`;
        if (n === 1) { attrs = ' data-name="title"'; body = '<h1>Welcome</h1><p>Opening words</p>'; }
        if (n === 5) { attrs = ' data-section="Chemistry"'; body = '<h2>Reactions</h2><p>The Le Châtelier principle at work</p>'; }
        if (n === 10) { attrs = ' data-section="Biology"'; body = '<h2>Cells</h2><p>Membranes</p>'; }
        if (n === 12) body = '<h2>Photosynthesis</h2><ul><li data-fragment>Light reactions</li><li data-fragment>The Calvin cycle</li><li data-fragment>Glucose output</li></ul>';
        if (n === 18) body = '<h2>Energy</h2><img src="x.svg" alt="Mitochondria diagram" style="width:200px;height:100px"><figure data-math="E = mc^2"><svg width="10" height="10"><text>junk</text></svg></figure>';
        if (n === 20) { attrs = ' data-skip'; body = '<h2>Hidden extra</h2><p>More on the Calvin cycle</p>'; }
        if (n === 25) { attrs = ' data-name="quiz"'; body = '<h2>Final check</h2><p>Ten questions</p>'; }
        const notes = n === 5 ? '<aside class="notes" hidden>Remember the catalyst joke.</aside>' : '';
        slides.push(`<section class="slide${n === 1 ? ' active' : ''}"${attrs}><div class="content">${body}</div>${notes}</section>`);
    }
    const a = blank.indexOf('<main class="deck-stage" id="deckStage">') + '<main class="deck-stage" id="deckStage">'.length;
    const b = blank.indexOf('</main>', a);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'index.html'), blank.slice(0, a) + '\n' + slides.join('\n') + '\n' + blank.slice(b));
}
async function openFindDeck(context) {
    writeDeck();
    const deck = await context.newPage();
    await deck.goto(URL);
    await deck.waitForFunction(() => window.deckRuntime && window.deckRuntime.version >= 16);
    await deck.waitForTimeout(300);
    return deck;
}
const active = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.deck-stage .slide')).findIndex(s => s.classList.contains('active')));
const shownTiles = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.deck-overview .ov-tile')).filter(t => !t.hidden).map(t => +t.querySelector('.ov-n').textContent));

test('F1 Ctrl+Shift+F: the overview finds slides by title, name, words, accents or not, pictures, equations and section; never the notes or a skipped slide', async ({ context }) => {
    const deck = await openFindDeck(context);
    await deck.keyboard.press('Control+Shift+F');
    await expect(deck.locator('.deck-overview .ov-find')).toBeFocused();
    const find = deck.locator('.deck-overview .ov-find');
    const expectShown = async (q, nums) => { await find.fill(q); await expect.poll(() => shownTiles(deck), q).toEqual(nums); };
    await expectShown('calvin', [12]);                          // slide 20 says it too, but is skipped
    await expect(deck.locator('.deck-overview .ov-head b')).toContainText('1 of 30 slides');
    await expect(deck.locator('.deck-overview .ov-tile:not([hidden]) .ov-snip mark')).toHaveText('Calvin');
    await expectShown('chatelier', [5]);                        // no accent typed, the slide has one
    await expectShown('photosynthesis', [12]);                  // the title
    await expectShown('quiz', [25]);                            // the slide's name
    await expectShown('mitochondria', [18]);                    // a picture's description
    await expectShown('mc^2', [18]);                            // an equation, by its LaTeX
    await expectShown('junk', []);                              // ...not the drawing of it
    await expectShown('chemistry', [5, 6, 7, 8, 9]);            // the section, up to the next one
    await expectShown('topic 17', [17]);                        // all the words
    await expectShown('7', [7, 17, 27]);                       // a number is also words on slides
    await expectShown('catalyst', []);                          // the notes are never searched on the deck
    await expect(deck.locator('.deck-overview .ov-none')).toHaveText('No slide has “catalyst”.');
    await expectShown('', Array.from({ length: 30 }, (_, i) => i + 1));
    // A number: that slide is the pick; Enter goes there.
    await find.fill('25');
    await expect(deck.locator('.deck-overview .ov-tile.current .ov-n')).toHaveText('25');
    await deck.keyboard.press('Enter');
    await expect(deck.locator('.deck-overview')).toHaveCount(0);
    await expect.poll(() => active(deck)).toBe(24);
    // Typing in the field moves no slide (the controller never sees the keys) and Esc closes.
    await deck.keyboard.press('/');
    await expect(find).toBeFocused();
    await deck.keyboard.type('a b');
    await deck.keyboard.press('ArrowRight');
    expect(await active(deck)).toBe(24);
    await deck.keyboard.press('Escape');
    await expect(deck.locator('.deck-overview')).toHaveCount(0);
    expect(await active(deck)).toBe(24);
});

test('F2 Enter on a slide found by its words shows its steps up to the match and outlines it', async ({ context }) => {
    const deck = await openFindDeck(context);
    await deck.keyboard.press('Control+Shift+F');
    await deck.keyboard.type('calvin');
    await deck.keyboard.press('Enter');
    await expect.poll(() => active(deck)).toBe(11);
    await expect.poll(() => deck.evaluate(() => Array.from(document.querySelectorAll('.slide.active li')).map(li => li.classList.contains('visible')))).toEqual([true, true, false]);
    const found = deck.locator('.deck-found');
    await expect(found).toHaveCount(1);
    const li = await deck.locator('.slide.active li').nth(1).boundingBox(), box = await found.boundingBox();
    expect(Math.abs(box.x + 8 - li.x)).toBeLessThan(3);
    expect(Math.abs(box.y + 8 - li.y)).toBeLessThan(3);
    await expect(found).toHaveCount(0, { timeout: 4000 });       // it goes by itself
    // The arrows go on from there: the next step is the third point.
    await deck.keyboard.press('ArrowRight');
    await expect.poll(() => deck.evaluate(() => document.querySelectorAll('.slide.active li.visible').length)).toBe(3);
    // Ctrl+K opens the same; a title match outlines the heading.
    await deck.keyboard.press('Control+K');
    await deck.keyboard.type('reactions');
    await deck.keyboard.press('Enter');
    await expect.poll(() => active(deck)).toBe(4);
    await expect(deck.locator('.deck-found')).toHaveCount(1);
});

test('F3 a number and Enter goes to that slide; O still opens and closes the overview; ? still lists the keys, with Find in it', async ({ context }) => {
    const deck = await openFindDeck(context);
    await deck.keyboard.press('2');
    await deck.keyboard.press('7');
    await expect(deck.locator('.deck-num')).toHaveText(/Go to slide 27/);
    await deck.keyboard.press('Enter');
    await expect.poll(() => active(deck)).toBe(26);
    await expect(deck.locator('.deck-num')).toHaveCount(0);
    // Backspace takes a digit back; Esc forgets it.
    await deck.keyboard.press('3'); await deck.keyboard.press('1'); await deck.keyboard.press('Backspace');
    await expect(deck.locator('.deck-num')).toHaveText(/Go to slide 3\b/);
    await deck.keyboard.press('Enter');
    await expect.poll(() => active(deck)).toBe(2);
    await deck.keyboard.press('9'); await deck.keyboard.press('Escape');
    await expect(deck.locator('.deck-num')).toHaveCount(0);
    await deck.keyboard.press('Enter');
    expect(await active(deck)).toBe(2);
    // O: the overview, its field not focused, O again closes.
    await deck.keyboard.press('o');
    await expect(deck.locator('.deck-overview')).toHaveCount(1);
    await expect(deck.locator('.deck-overview .ov-find')).not.toBeFocused();
    await deck.keyboard.press('o');
    await expect(deck.locator('.deck-overview')).toHaveCount(0);
    await deck.keyboard.press('?');
    await expect(deck.locator('.deck-keys')).toContainText('Find a slide by its title or words');
    await expect(deck.locator('.deck-keys')).toContainText('Go to slide 12');
    await deck.keyboard.press('Escape');
    // "/" typed with Shift (Shift+7 on an Italian keyboard) finds; it is not "?".
    await deck.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Digit7', shiftKey: true, bubbles: true, cancelable: true })));
    await expect(deck.locator('.deck-overview .ov-find')).toBeFocused();
    await expect(deck.locator('.deck-keys')).toHaveCount(0);
});

test('F4 the deck\'s presenter window finds in the notes too, and a pick moves the deck', async ({ context }) => {
    const deck = await openFindDeck(context);
    const [pop] = await Promise.all([context.waitForEvent('page'), deck.keyboard.press('p')]);
    await pop.waitForLoadState();
    await pop.keyboard.press('Control+Shift+F');
    const input = pop.locator('.deck-finder .df-input');
    await expect(input).toBeFocused();
    // Empty: every slide but the skipped one, by title.
    await expect(pop.locator('.deck-finder .df-item')).toHaveCount(29);
    await input.fill('catalyst');
    await expect(pop.locator('.deck-finder .df-item')).toHaveCount(1);
    await expect(pop.locator('.deck-finder .df-item .df-where')).toHaveText('In the notes');
    await expect(pop.locator('.deck-finder .df-item .df-snip mark')).toHaveText('catalyst');
    await pop.keyboard.press('Enter');
    await expect(pop.locator('.deck-finder')).toHaveCount(0);
    await expect.poll(() => active(deck)).toBe(4);
    await expect(pop.locator('#now')).toHaveText('5');
    // Titles come before words: "cycle" is in slide 12's words only; "cells" is slide 10's title.
    await pop.click('#find');
    await input.fill('cells');
    await expect(pop.locator('.deck-finder .df-item').first().locator('.df-n')).toHaveText('10');
    await pop.keyboard.press('Escape');
    await expect(pop.locator('.deck-finder')).toHaveCount(0);
    // A number and Enter in the presenter window too.
    await pop.keyboard.press('1'); await pop.keyboard.press('2'); await pop.keyboard.press('Enter');
    await expect.poll(() => active(deck)).toBe(11);
    await pop.close();
});

test('F5 the editor\'s presenter window finds with the deck\'s runtime; a pick moves the editor; in Preview Ctrl+Shift+F stays the editor\'s', async ({ page, context }) => {
    await openDeck(page);
    await page.evaluate(() => window.deckEditor.inspector.applyNotes('Mention the octopus.'));
    await page.evaluate(() => window.deckEditor.addRuntimeScript());
    await page.waitForFunction(() => window.deckEditor.deck.win.deckRuntime && window.deckEditor.deck.win.deckRuntime.version >= 16);
    await save(page);
    await page.click('#btnPresenter');
    const [presenter] = await Promise.all([context.waitForEvent('page'), page.click('#presenterMenu [data-p="open"]')]);
    await presenter.waitForLoadState();
    await presenter.waitForFunction(() => { try { return document.getElementById('cur').contentWindow.deckRuntime.version >= 16; } catch (e) { return false; } });
    await presenter.keyboard.press('Control+Shift+F');
    const input = presenter.locator('.deck-finder .df-input');
    await expect(input).toBeFocused();
    await input.fill('three points');
    await expect(presenter.locator('.deck-finder .df-item .df-n')).toHaveText(['3']);
    await presenter.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.deckEditor.deck.current)).toBe(2);
    await presenter.click('#btnFind');
    await input.fill('octopus');
    await expect(presenter.locator('.deck-finder .df-item .df-where')).toHaveText('In the notes');
    await presenter.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.deckEditor.deck.current)).toBe(0);
    // A number and Enter.
    await presenter.keyboard.press('2'); await presenter.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.deckEditor.deck.current)).toBe(1);
    await presenter.close();
    // In Preview the deck sits in a frame: Ctrl+Shift+F is not the deck's.
    await page.bringToFront();
    await page.evaluate(() => window.deckEditor.setPreview(true));
    await page.evaluate(() => window.deckEditor.deck.win.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
    expect(await page.evaluate(() => !!window.deckEditor.deck.doc.querySelector('.deck-overview'))).toBe(false);
    await page.evaluate(() => window.deckEditor.setPreview(false));
});

test('F6 a deck without the current runtime: the editor\'s presenter window says what to do', async ({ page, context }) => {
    await openDeck(page);                                        // the fixture has no runtime
    await page.click('#btnPresenter');
    const [presenter] = await Promise.all([context.waitForEvent('page'), page.click('#presenterMenu [data-p="open"]')]);
    await presenter.waitForLoadState();
    await expect(presenter.locator('#now')).toHaveText('1');
    await presenter.click('#btnFind');
    await expect(presenter.locator('#say')).toContainText('presentation features');
    await expect(presenter.locator('.deck-finder')).toHaveCount(0);
    await presenter.close();
});
