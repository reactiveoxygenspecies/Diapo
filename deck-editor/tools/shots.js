// Screenshots every slide of the given templates served by the preview server (scratch tool, not part of the app).
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2];
const slugs = process.argv.slice(3);
(async () => {
    const browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    for (const slug of slugs) {
        await page.goto('http://localhost:8802/templates/' + slug + '.html');
        await page.waitForSelector('.slide.active.visible');
        await page.waitForFunction(() => document.fonts.status === 'loaded');
        const n = await page.evaluate(() => document.querySelectorAll('.slide').length);
        for (let i = 0; i < n; i++) {
            await page.evaluate((i) => window.deckRuntime.goTo(i), i);
            await page.waitForTimeout(1400);
            await page.screenshot({ path: path.join(OUT, `${slug}-${i + 1}.png`) });
        }
        console.log(slug, n, 'slides');
    }
    console.log('errors:', errors);
    await browser.close();
})();
