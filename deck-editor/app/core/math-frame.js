/* ============================================================
   math-frame.js - the STIX Two renderer (core/math-frame.html).
   MathJax 4, its TeX extensions and the STIX Two glyphs all come
   from vendor/mathjax4/ (tools/build-vendor.js): nothing is fetched
   from the internet, and the accessibility tools MathJax would load
   (speech, braille, the menu) stay off, as the drawing is all
   Diapo keeps. renderTex(tex) gives the <svg> markup, or throws
   MathJax's message.
   ============================================================ */
window.MathJax = {
    loader: {
        paths: { mathjax: '/vendor/mathjax4', fonts: '/vendor/mathjax4', 'mathjax-stix2': '/vendor/mathjax4/stix2' },
        load: ['[tex]/mhchem'],
    },
    tex: { packages: { '[+]': ['mhchem'] }, formatError: (jax, err) => { throw err; } },
    output: { font: 'mathjax-stix2', fontCache: 'none' },
    svg: { fontCache: 'none' },
    options: { enableMenu: false, enableEnrichment: false, enableSpeech: false, enableBraille: false, enableExplorer: false, enableAssistiveMml: false, enableComplexity: false },
    startup: { typeset: false },
};

const script = document.createElement('script');
script.src = '/vendor/mathjax4/tex-mml-svg-mathjax-stix2.js';
const loaded = new Promise((resolve, reject) => { script.onload = resolve; script.onerror = () => reject(new Error('could not load MathJax 4')); });
document.head.appendChild(script);

window.renderTex = async function (tex, { em = 16, ex = 8 } = {}) {
    await loaded;
    await window.MathJax.startup.promise;
    // The synchronous call, retried when MathJax has to load glyphs first (it throws with a
    // `retry` promise then): tex2svgPromise waits for an animation frame, which a browser does
    // not give a hidden frame in a window that is in the background.
    let node;
    for (let i = 0; !node; i++) {
        try { node = window.MathJax.tex2svg(tex, { display: true, em, ex, containerWidth: 1920 }); }
        catch (err) {
            if (err && err.retry && i < 30) { await err.retry; continue; }
            throw new Error(err && err.message ? err.message : String(err));
        }
    }
    const svg = node.querySelector('svg');
    if (!svg) throw new Error('nothing to draw');
    if (svg.querySelector('[data-mml-node="merror"]')) throw new Error((svg.textContent || 'error').trim());
    return svg.outerHTML;
};
