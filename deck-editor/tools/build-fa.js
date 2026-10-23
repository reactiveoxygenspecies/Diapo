/* ============================================================
   build-fa.js - writes app/icons/fontawesome.json, the icon catalog the
   editor's icon picker loads on demand, from the Font Awesome Free package
   (npm i -D @fortawesome/fontawesome-free; run: node tools/build-fa.js).

   Only what the picker needs goes in: name, label, search terms, and for
   each free style (solid, regular, brands) the viewBox width and the path.
   The icons are CC BY 4.0: every inserted icon carries the attribution
   comment Font Awesome itself puts in its SVG files.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const PKG = path.join(__dirname, '..', 'node_modules', '@fortawesome', 'fontawesome-free');
const OUT = path.join(__dirname, '..', 'app', 'icons', 'fontawesome.json');

const version = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
const families = JSON.parse(fs.readFileSync(path.join(PKG, 'metadata', 'icon-families.json'), 'utf8'));

const STYLES = { solid: 's', regular: 'r', brands: 'b' };
const icons = [];
for (const [name, e] of Object.entries(families)) {
    const free = (e.familyStylesByLicense && e.familyStylesByLicense.free) || [];
    const svgs = (e.svgs && e.svgs.classic) || {};
    const styles = {};
    for (const { family, style } of free) {
        if (family !== 'classic' || !STYLES[style] || !svgs[style]) continue;
        const s = svgs[style];
        styles[STYLES[style]] = [s.width, s.path];
    }
    if (!Object.keys(styles).length) continue;
    const terms = Array.from(new Set([...(e.search && e.search.terms || []), ...(e.aliases && e.aliases.names || [])])).filter(t => t !== name && !/^[0-9a-f]{4,5}$/i.test(t));
    icons.push({ n: name, l: e.label || name, t: terms.join(' '), s: styles });
}
icons.sort((a, b) => a.n.localeCompare(b.n));
const out = {
    source: 'Font Awesome Free ' + version,
    license: 'Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT - https://fontawesome.com/license/free',
    attribution: `<!--!Font Awesome Free ${version} by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright ${new Date().getFullYear()} Fonticons, Inc.-->`,
    icons,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const counts = { s: 0, r: 0, b: 0 };
for (const i of icons) for (const k of Object.keys(i.s)) counts[k]++;
console.log(`${icons.length} icons (solid ${counts.s}, regular ${counts.r}, brands ${counts.b}), ${Math.round(fs.statSync(OUT).size / 1024)} KB -> ${path.relative(process.cwd(), OUT)}`);
