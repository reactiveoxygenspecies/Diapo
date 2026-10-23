/* ============================================================
   build-icon.js - renders the Diapo logo into the application icon files
   build-exe.py hands to PyInstaller and the page declares for Chrome
   (run: node tools/build-icon.js; needs the Playwright dev dependency and
   Chrome or Edge, like the tests).

   Writes to app/brand/:
     icon.ico       Windows icon: 16, 20, 24, 32, 40, 48, 64, 128, 256 px
                    (20/24/40 are what the taskbar and Explorer ask for at
                    125 / 150 % scaling; without them Windows resamples a
                    neighbour and the edges go soft)
     icon-256.png   the largest ICO frame on its own (Linux desktop files,
                    or `iconutil` on a Mac to make icon.icns); also the
                    page's large favicon
     icon-512.png   for the web app manifest (app/manifest.webmanifest),
                    which Chrome reads for the window and taskbar icon of
                    the editor's app window

   Below 48 px the frame is the mark without the word, drawn here with its
   edges snapped to whole pixels of that size (the card's inset, corner
   radius and the window's rectangle), so the small frames are crisp rather
   than anti-aliased smears of mark.svg's fractional coordinates. From 48 px
   up it is logo.svg, the mount with DIAPO in the window. The ICO is written
   here directly (PNG-compressed entries, supported since Vista), so no image
   library is needed.
   ============================================================ */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BRAND = path.join(__dirname, '..', 'app', 'brand');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const WORD_FROM = 48;   // below this the logo carries no word

/* mark.svg's geometry (a 100-unit box: card inset 2, radius 7, window 14..86 x 26..74),
   scaled to `size` and rounded to whole pixels. The rounding is symmetric at every
   size in ICO_SIZES, so the window stays centred. */
function snappedMark(size) {
    const r = (v) => Math.round(v * size / 100);
    const inset = r(2), rx = Math.max(1, r(7));
    const x0 = r(14), x1 = r(86), y0 = r(26), y1 = r(74);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">`
        + `<rect x="${inset}" y="${inset}" width="${size - 2 * inset}" height="${size - 2 * inset}" rx="${rx}" fill="#EAE3D0" shape-rendering="auto"/>`
        + `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#141418"/></svg>`;
}

function ico(frames) {
    // frames: [{ size, png }] -> Buffer. ICONDIR, one ICONDIRENTRY per frame, then the PNG data.
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);              // reserved
    header.writeUInt16LE(1, 2);              // type: icon
    header.writeUInt16LE(frames.length, 4);
    const entries = [];
    let offset = 6 + 16 * frames.length;
    for (const f of frames) {
        const e = Buffer.alloc(16);
        e.writeUInt8(f.size === 256 ? 0 : f.size, 0);   // 0 means 256
        e.writeUInt8(f.size === 256 ? 0 : f.size, 1);
        e.writeUInt8(0, 2);                  // colours in palette (none)
        e.writeUInt8(0, 3);                  // reserved
        e.writeUInt16LE(1, 4);               // colour planes
        e.writeUInt16LE(32, 6);              // bits per pixel
        e.writeUInt32LE(f.png.length, 8);
        e.writeUInt32LE(offset, 12);
        offset += f.png.length;
        entries.push(e);
    }
    return Buffer.concat([header, ...entries, ...frames.map(f => f.png)]);
}

(async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    const logo = fs.readFileSync(path.join(BRAND, 'logo.svg'), 'utf8');
    const render = async (size) => {
        const svg = size < WORD_FROM ? snappedMark(size) : logo;
        const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        await page.setContent(`<body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}"></body>`);
        await page.waitForFunction(() => document.fonts.status === 'loaded');
        const png = await page.screenshot({ omitBackground: true, type: 'png' });
        await page.close();
        console.log(size, 'px', png.length, 'bytes');
        return png;
    };
    const frames = [];
    for (const size of ICO_SIZES) frames.push({ size, png: await render(size) });
    fs.writeFileSync(path.join(BRAND, 'icon.ico'), ico(frames));
    fs.writeFileSync(path.join(BRAND, 'icon-256.png'), frames[frames.length - 1].png);
    fs.writeFileSync(path.join(BRAND, 'icon-512.png'), await render(512));
    await browser.close();
    console.log('wrote app/brand/icon.ico, icon-256.png and icon-512.png');
})();
