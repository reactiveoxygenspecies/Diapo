/* ============================================================
   build-vendor.js - copies the libraries the editor loads on demand
   into app/vendor/, with their licences (run: node tools/build-vendor.js,
   after npm install; the versions are pinned in package.json).

     mathjax-tex-svg.js    MathJax 3 tex-svg-full (Apache-2.0): LaTeX to SVG,
                           every TeX extension and font in one file
     smiles-drawer.min.js  SmilesDrawer 2 (MIT, with chroma-js inside,
                           BSD-3-Clause and Apache-2.0): SMILES to 2D SVG

   They run in the editor only (math.js, chem.js): a deck keeps the
   source and the drawing, never the library. The editor's
   Content-Security-Policy allows scripts from vendor/ (serve.py).
   ============================================================ */
const fs = require('fs');
const path = require('path');

const NM = path.join(__dirname, '..', 'node_modules');
const OUT = path.join(__dirname, '..', 'app', 'vendor');

const version = (pkg) => JSON.parse(fs.readFileSync(path.join(NM, pkg, 'package.json'), 'utf8')).version;
const FILES = [
    [path.join('mathjax', 'es5', 'tex-svg-full.js'), 'mathjax-tex-svg.js', `MathJax ${version('mathjax')} (tex-svg-full), Apache-2.0, https://www.mathjax.org - licence: LICENSE-mathjax.txt`],
    [path.join('smiles-drawer', 'dist', 'smiles-drawer.min.js'), 'smiles-drawer.min.js', `SmilesDrawer ${version('smiles-drawer')}, MIT, https://github.com/reymond-group/smilesDrawer - licences: LICENSE-smiles-drawer.txt, LICENSE-chroma-js.txt (chroma-js ${version('chroma-js')} is bundled in)`],
];
const LICENCES = [
    [path.join('mathjax', 'LICENSE'), 'LICENSE-mathjax.txt'],
    [path.join('smiles-drawer', 'LICENSE.md'), 'LICENSE-smiles-drawer.txt'],
    [path.join('chroma-js', 'LICENSE'), 'LICENSE-chroma-js.txt'],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [src, dst, note] of FILES) {
    const body = fs.readFileSync(path.join(NM, src), 'utf8').replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
    fs.writeFileSync(path.join(OUT, dst), `/* ${note} */\n` + body);
    console.log(dst, Math.round(fs.statSync(path.join(OUT, dst)).size / 1024) + ' KB');
}
for (const [src, dst] of LICENCES) fs.copyFileSync(path.join(NM, src), path.join(OUT, dst));
console.log('licences:', LICENCES.map(l => l[1]).join(', '));

/* MathJax 4 with the STIX Two maths font, for equations in the "STIX Two" look (math.js runs it
   in a frame of its own, core/math-frame.html, since MathJax 3 has the editor page). Not npm
   dependencies (mathjax@4 would pull in its 49 MB default font): the two packages are fetched
   as tarballs into tools/vendor-src/ with
       npm pack mathjax@4.1.3 @mathjax/mathjax-stix2-font@4.1.3 --pack-destination tools/vendor-src
   and unpacked here. Only what the frame loads is copied: the combined component, the TeX
   extensions it loads on demand (mhchem...) and the font's extra glyph files. */
const { execFileSync } = require('child_process');
const SRC = path.join(__dirname, 'vendor-src');
const MJ4 = path.join(OUT, 'mathjax4');
function unpack(tgz, dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xzf', tgz, '-C', path.basename(dir)], { cwd: SRC });   // relative: GNU tar reads "D:" as a host
    return path.join(dir, 'package');
}
function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
        else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
    }
}
if (fs.existsSync(path.join(SRC, 'mathjax-4.1.3.tgz')) && fs.existsSync(path.join(SRC, 'mathjax-mathjax-stix2-font-4.1.3.tgz'))) {
    const core = unpack('mathjax-4.1.3.tgz', path.join(SRC, 'mathjax4'));
    const stix = unpack('mathjax-mathjax-stix2-font-4.1.3.tgz', path.join(SRC, 'stix2'));
    fs.rmSync(MJ4, { recursive: true, force: true });
    fs.mkdirSync(MJ4, { recursive: true });
    const body = fs.readFileSync(path.join(stix, 'tex-mml-svg-mathjax-stix2.js'), 'utf8').replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
    fs.writeFileSync(path.join(MJ4, 'tex-mml-svg-mathjax-stix2.js'), '/* MathJax 4.1.3 tex-mml-svg with the mathjax-stix2 font (Apache-2.0; glyphs from STIX Two Math, SIL OFL 1.1) - licence: ../LICENSE-mathjax.txt */\n' + body);
    copyDir(path.join(core, 'input', 'tex', 'extensions'), path.join(MJ4, 'input', 'tex', 'extensions'));
    copyDir(path.join(stix, 'svg', 'dynamic'), path.join(MJ4, 'stix2', 'svg', 'dynamic'));
    // \ce{} (mhchem) in MathJax 4 draws its arrows from a font extension of its own:
    //     npm pack @mathjax/mathjax-mhchem-font-extension@4.1.3 --pack-destination tools/vendor-src
    if (fs.existsSync(path.join(SRC, 'mathjax-mathjax-mhchem-font-extension-4.1.3.tgz'))) {
        const mh = unpack('mathjax-mathjax-mhchem-font-extension-4.1.3.tgz', path.join(SRC, 'mhchemx'));
        const dst = path.join(MJ4, 'mathjax-mhchem-font-extension');
        fs.mkdirSync(dst, { recursive: true });
        fs.copyFileSync(path.join(mh, 'svg.js'), path.join(dst, 'svg.js'));
        if (fs.existsSync(path.join(mh, 'svg'))) copyDir(path.join(mh, 'svg'), path.join(dst, 'svg'));
    } else console.log('mathjax4: no mhchem font extension tarball, \\ce{} will not draw in STIX Two');
    console.log('mathjax4 + stix2 copied');
} else console.log('mathjax4: tarballs not in tools/vendor-src, skipped (see the comment above)');
