// Imports every deck of the PowerPoint corpus (tools/pptx-corpus.ps1), screenshots
// each imported slide as the deck shows it on its own (file://, 1920x1080), and
// writes side-by-side comparison images, PowerPoint's render on the left and the
// import on the right, plus a contact sheet per theme:
//
//     node tools/pptx-compare.js [theme ...]          (from deck-editor/; all themes when none given)
//
//     tools/pptx-corpus/out/<theme>/index.html        the imported deck (+ assets/)
//     tools/pptx-corpus/out/<theme>/NN.png            the import, rendered
//     tools/pptx-corpus/cmp/<theme>/NN.png            reference | import, 1920x540
//     tools/pptx-corpus/cmp/<theme>.html              all pairs of the theme on one page
//
// Scratch tool for working on import_deck.py; not part of the app.
const { chromium } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const CORPUS = path.join(HERE, 'pptx-corpus');
const PY = process.platform === 'win32' ? 'py' : 'python3';
const PYARGS = process.platform === 'win32' ? ['-3'] : [];

function importDeck(pptx, outDir) {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const code = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(HERE, '..'))})
import import_deck
html, notes = import_deck.import_file(sys.argv[1], sys.argv[2])
open(sys.argv[2] + '/index.html', 'w', encoding='utf-8').write(html)
print(json.dumps(notes))`;
    const out = execFileSync(PY, [...PYARGS, '-c', code, pptx, outDir], { encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').pop());
}

(async () => {
    const themes = process.argv.slice(2).length ? process.argv.slice(2)
        : fs.readdirSync(CORPUS).filter(f => f.endsWith('.pptx') && f !== 'base.pptx').map(f => f.slice(0, -5));
    const browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    for (const theme of themes) {
        const pptx = path.join(CORPUS, theme + '.pptx');
        const outDir = path.join(CORPUS, 'out', theme);
        const cmpDir = path.join(CORPUS, 'cmp', theme);
        const refDir = path.join(CORPUS, 'ref', theme);
        fs.mkdirSync(cmpDir, { recursive: true });
        const t0 = Date.now();
        const notes = importDeck(pptx, outDir);
        await page.goto('file:///' + path.join(outDir, 'index.html').replace(/\\/g, '/'));
        await page.waitForSelector('.slide.active');
        await page.waitForFunction(() => document.fonts.status === 'loaded');
        const n = await page.evaluate(() => document.querySelectorAll('.slide').length);
        const rows = [];
        for (let i = 0; i < n; i++) {
            await page.evaluate((i) => window.deckRuntime.goTo(i), i);
            await page.waitForTimeout(900);
            const nn = String(i + 1).padStart(2, '0');
            await page.screenshot({ path: path.join(outDir, nn + '.png') });
            rows.push(nn);
        }
        // Side-by-side images and the contact sheet, drawn by the same browser.
        for (const nn of rows) {
            const ref = fs.existsSync(path.join(refDir, nn + '.png')) ? 'file:///' + path.join(refDir, nn + '.png').replace(/\\/g, '/') : '';
            const imp = 'file:///' + path.join(outDir, nn + '.png').replace(/\\/g, '/');
            await page.setViewportSize({ width: 1920, height: 540 });
            await page.setContent(`<body style="margin:0;background:#222;display:flex"><img src="${ref}" style="width:960px;height:540px"><img src="${imp}" style="width:960px;height:540px"></body>`);
            await page.waitForTimeout(150);
            await page.screenshot({ path: path.join(cmpDir, nn + '.png') });
        }
        await page.setViewportSize({ width: 1920, height: 1080 });
        const sheet = rows.map(nn => `<figure><figcaption>${theme} ${nn}</figcaption><img src="${theme}/${nn}.png"></figure>`).join('\n');
        fs.writeFileSync(path.join(CORPUS, 'cmp', theme + '.html'),
            `<!doctype html><title>${theme}: PowerPoint | import</title><style>body{margin:0;background:#111;color:#ddd;font:13px system-ui}figure{margin:0 0 6px}figcaption{padding:4px 8px}img{display:block;width:100%}</style>\n${sheet}`);
        console.log(`${theme}: ${n} slides, ${((Date.now() - t0) / 1000).toFixed(1)}s` + (notes.length ? ' | notes: ' + notes.join('; ') : ''));
    }
    if (errors.length) console.log('page errors:', errors);
    await browser.close();
})();
