// The Theme panel in plain words: plain names for the deck's variables, base text styles that fit
// the panel, the designs' ready-made looks (by name and by role), and one swatch per colour.
const { test, expect, fs, path, freshDeckEachTest, WS, openDeck } = require('./helpers');

freshDeckEachTest();

const RAW = /(^|[^\w-])(--[\w-]+|ink-[23]|paper-2|accent-[23]|pad-x|pad-top|font-display|font-mono|stage-bg|slide-bg|h[1-3])(?![\w-])/;

test('theme plain words: variables show plain names (the CSS name only in the tooltip), no code in the text', async ({ page }) => {
    await openDeck(page);
    await page.click('#btnTheme');
    const label = (v) => page.locator(`.theme-var[data-var="${v}"] > label`);
    await expect(label('ink')).toHaveText('Text');
    await expect(label('ink-2')).toHaveText('Text 2');
    await expect(label('rule')).toHaveText('Lines');
    await expect(label('paper')).toHaveText('Background');
    await expect(label('slide-bg')).toHaveText('Slide background');
    await expect(label('accent-2')).toHaveText('Accent 2');
    await expect(label('font')).toHaveText('Body text');
    await expect(label('pad-x')).toHaveText('Side margin');
    await expect(label('pad-top')).toHaveText('Top margin');
    expect(await label('ink-2').getAttribute('title')).toContain('--ink-2');
    // A colour that points at another reads so, and typing another colour's name points it there.
    const slideBg = page.locator('.theme-var[data-var="slide-bg"] .theme-text');
    await expect(slideBg).toHaveValue('Same as Background');
    await slideBg.fill('Same as Accent');
    await slideBg.dispatchEvent('change');
    expect(await page.evaluate(() => window.deckEditor.deck.overrides.vars['slide-bg'])).toBe('var(--accent)');
    await page.evaluate(() => window.deckEditor.history.undo());
    // Base styles are named for people too.
    await expect(page.locator('.theme-style[data-sel="h1"] .theme-style-name')).toHaveText('Title');
    await expect(page.locator('.theme-style[data-sel=""] .theme-style-name')).toHaveText('Slide text');
    // Nothing visible in the panel reads like code: no variable names, no tags, no "override block".
    const text = await page.locator('#themeBody').innerText();
    expect(text).not.toMatch(RAW);
    expect(text).not.toMatch(/override block|\.deck-stage|\{ \.\.\. \}/);
    // A custom variable a deck invents gets a humanised name.
    await page.fill('#thNewName', 'brand_blue');
    await page.click('[data-act="addcolour"]');
    await expect(page.locator('.theme-var[data-var="brand-blue"] > label')).toHaveText('Brand blue');
});

test('theme base styles: one block per kind of text, nothing scrolls sideways at the panel\'s narrowest', async ({ page }) => {
    await openDeck(page);
    // The narrowest the panel gets in theme mode: the properties panel at its narrowest (the theme column is never under 400px).
    await page.evaluate(() => document.documentElement.style.setProperty('--inspector-w', '240px'));
    await page.click('#btnTheme');
    await expect(page.locator('.theme-style')).toHaveCount(6);
    const m = await page.evaluate(() => {
        const body = document.getElementById('themeBody'), base = document.querySelector('.theme-base');
        const r = base.getBoundingClientRect();
        const out = Array.from(base.querySelectorAll('input, select, button')).filter(el => { const b = el.getBoundingClientRect(); return b.right > r.right + 0.5 || b.left < r.left - 0.5; }).length;
        return { panel: body.getBoundingClientRect().width, bodyScroll: body.scrollWidth - body.clientWidth, baseScroll: base.scrollWidth - base.clientWidth, styles: Array.from(base.querySelectorAll('.theme-style')).map(s => s.scrollWidth - s.clientWidth), out, rows: new Set(Array.from(base.querySelectorAll('.theme-style[data-sel="h1"] .theme-field')).map(f => Math.round(f.getBoundingClientRect().top))).size };
    });
    expect(m.panel).toBeLessThanOrEqual(401);
    expect(m.bodyScroll).toBeLessThanOrEqual(0);
    expect(m.baseScroll).toBeLessThanOrEqual(0);
    expect(m.styles.every(x => x <= 0)).toBe(true);
    expect(m.out).toBe(0);
    expect(m.rows).toBe(2);                                    // six fields on two lines
    // The fields still work: a size for the title is written as before.
    const size = page.locator('.theme-base [data-sel="h1"] [data-prop="font-size"] input');
    await size.fill('88');
    await size.dispatchEvent('change');
    expect(await page.evaluate(() => window.deckEditor.deck.overrides.rules.h1['font-size'])).toBe('88px');
    await expect(page.locator('.theme-style[data-sel="h1"]')).toHaveClass(/set/);
});

test('theme looks: the designs\' looks are cards; applying one restyles the deck as one undo step, fonts load only then', async ({ page }) => {
    const fontRequests = [];
    page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url()) && /Fraunces|Libre/.test(decodeURIComponent(r.url()))) fontRequests.push(r.url()); });
    await openDeck(page);
    await page.click('#btnTheme');
    await expect(page.locator('#thLooks .theme-look')).toHaveCount(31);
    await expect(page.locator('#thSaved')).toBeHidden();          // no saved themes yet: no empty list
    const folio = page.locator('#thLooks .theme-look[data-key="folio"]');
    await expect(folio.locator('.theme-look-name')).toHaveText('Folio');
    await expect(folio.locator('.theme-look-font')).toHaveText('Fraunces');
    expect(await folio.locator('.theme-look-strip i').count()).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(300);
    expect(fontRequests).toEqual([]);                             // opening the panel fetched none of the look's fonts

    const before = await page.evaluate(() => ({ vars: { ...window.deckEditor.deck.overrides.vars }, google: Object.keys(window.deckEditor.deck.fonts.google), undo: window.deckEditor.history.undoStack.length }));
    expect(before.vars).toEqual({});
    await folio.locator('.theme-look-apply').click();
    await expect(page.locator('#thLookHint')).toContainText('Folio look applied');
    const after = await page.evaluate(() => {
        const d = window.deckEditor.deck, cs = d.win.getComputedStyle(d.doc.documentElement);
        return { vars: { ...d.overrides.vars }, ink: cs.getPropertyValue('--ink').trim(), google: Object.keys(d.fonts.google), undo: window.deckEditor.history.undoStack.length };
    });
    expect(after.vars).toMatchObject({ ink: '#1e1a17', 'ink-2': '#3d3630', paper: '#f4efe4', 'slide-bg': '#f4efe4', accent: '#8b1e2d', rule: '#d3c9b6', 'pad-x': '120px', 'pad-top': '88px' });
    expect(after.vars.font).toContain('Libre Franklin');
    expect(after.vars['accent-3']).toBe('#8b1e2d');                // the deck's third accent takes the look's accents in turn
    expect(after.ink).toBe('#1e1a17');
    expect(after.google).toContain('Libre Franklin');             // the look's body font is now loaded by the deck
    expect(after.undo).toBe(before.undo + 1);                     // one undo step
    // One undo puts everything back: variables and fonts.
    await page.evaluate(() => window.deckEditor.history.undo());
    const undone = await page.evaluate(() => ({ vars: { ...window.deckEditor.deck.overrides.vars }, google: Object.keys(window.deckEditor.deck.fonts.google) }));
    expect(undone).toEqual({ vars: {}, google: before.google });

    // A saved theme is listed above the looks and still applies.
    await folio.locator('.theme-look-apply').click();
    await page.fill('#thName', 'My folio');
    await page.click('[data-act="save"]');
    await expect(page.locator('#thSaved .theme-look[data-key="My folio"]')).toBeVisible();
    const order = await page.evaluate(() => document.getElementById('thSaved').compareDocumentPosition(document.getElementById('thLooks')) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order).toBeTruthy();
    await page.click('#themeBody [data-act="reset"]');
    expect(await page.evaluate(() => Object.keys(window.deckEditor.deck.overrides.vars).length)).toBe(0);
    await page.locator('#thSaved .theme-look[data-key="My folio"] .theme-look-apply').click();
    expect(await page.evaluate(() => window.deckEditor.deck.overrides.vars.ink)).toBe('#1e1a17');
    page.once('dialog', (d) => d.accept());
    await page.locator('#thSaved .theme-look[data-key="My folio"] [data-del]').click();
    await expect(page.locator('#thSaved')).toBeHidden();
});

test('theme looks: a deck with its own variable names is matched by role; what cannot be matched is left alone', async ({ page }) => {
    const dir = path.join(WS, 'looks-odd');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Odd names</title>
<style>
:root {
  --bg: #101418; --surface: #1b2129; --fg: #e8ecf1; --muted: #9aa5b1;
  --brand: #ff6a3d; --border-col: #2a323c; --danger: #e5484d;
  --heading-font: Georgia, serif; --gap: 24px; --hero: var(--brand);
}
body { margin: 0; background: #000; }
.deck-stage { position: relative; width: 1920px; height: 1080px; }
.slide { position: absolute; inset: 0; background: var(--bg); color: var(--fg); font-family: Arial, sans-serif; }
.slide h1 { font-family: var(--heading-font); color: var(--hero); }
.card { background: var(--surface); border: 1px solid var(--border-col); padding: var(--gap); }
.slide p { color: var(--muted); }
.bad { color: var(--danger); }
</style></head>
<body><div class="deck-stage">
<section class="slide active visible"><h1>Odd names</h1><div class="card"><p>A card</p><p class="bad">Careful</p></div></section>
</div></body></html>
`);
    await page.goto('/?file=looks-odd/index.html');
    await page.waitForFunction(() => window.deckEditor && window.deckEditor.deck.isOpen);
    await page.waitForTimeout(500);
    await page.click('#btnTheme');
    // Its own names are humanised in the panel.
    await expect(page.locator('.theme-var[data-var="border-col"] > label')).toHaveText('Border col');
    await page.locator('#thLooks .theme-look[data-key="folio"] .theme-look-apply').click();
    await expect(page.locator('#thLookHint')).toContainText('Folio look applied');
    const vars = await page.evaluate(() => ({ ...window.deckEditor.deck.overrides.vars }));
    expect(vars).toEqual({
        bg: '#f4efe4',                 // the slide's background: the look's background
        surface: '#eae3d2',            // the next background: the look's second one
        fg: '#1e1a17',                 // the strongest text: the look's text
        muted: '#3d3630',              // the softer text: the look's second text colour
        brand: '#8b1e2d',              // vivid, and named so: the accent
        'border-col': '#d3c9b6',       // the lines
        'heading-font': expect.stringContaining('Fraunces'),
    });
    // Left alone: a state colour (danger), a size other than the margins (gap), a pointer (hero follows brand).
    await expect(page.locator('#thLookHint')).toContainText('1 setting of this deck had no match');
    const h1 = await page.evaluate(() => { const d = window.deckEditor.deck; return d.win.getComputedStyle(d.doc.querySelector('h1')).color; });
    expect(h1).toBe('rgb(139, 30, 45)');
    // One undo step puts the deck back.
    await page.evaluate(() => window.deckEditor.history.undo());
    expect(await page.evaluate(() => Object.keys(window.deckEditor.deck.overrides.vars).length)).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('swatches: two variables with one colour make one swatch, named for both', async ({ page }) => {
    await openDeck(page);
    // Paper is #ffffff; give Slide background the same value written another way.
    await page.evaluate(() => { const d = window.deckEditor.deck; d.setOverrides({ ...d.overrides, vars: { 'slide-bg': 'rgb(255, 255, 255)' } }); });
    await page.waitForTimeout(200);
    const slideRow = await page.evaluate(() => Array.from(document.querySelectorAll('#inspSlideSwatches .insp-swatch')).map(b => b.getAttribute('aria-label')));
    expect(slideRow.filter(l => /#ffffff$/.test(l))).toEqual(['Background and Slide background #ffffff']);
    expect(new Set(slideRow).size).toBe(slideRow.length);
    await page.evaluate(() => window.deckEditor.selection.select(window.deckEditor.deck.doc.querySelector('.slide.active h1')));
    await page.waitForTimeout(200);
    const labels = await page.locator('#inspSwatches .insp-swatch').evaluateAll(bs => bs.map(b => b.getAttribute('aria-label')));
    expect(labels.filter(l => /#ffffff$/.test(l))).toHaveLength(1);
    expect(labels).toContain('Text #1c1c1f');
    // The swatch applies the first of the two.
    await page.locator('#inspSwatches .insp-swatch[aria-label="Background and Slide background #ffffff"]').click();
    expect(await page.evaluate(() => window.deckEditor.selection.primary.style.color)).toBe('var(--paper)');
});
