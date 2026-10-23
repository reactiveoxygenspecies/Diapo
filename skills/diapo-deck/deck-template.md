# Deck file architecture

Every deck this skill produces is one `index.html` in its own folder (plus
`assets/` for pictures), built on a fixed 1920x1080 stage, and follows the deck
editor's file contract so it opens, edits and saves in the editor without any
adaptation. Read [editor-integration.md](editor-integration.md) for the reasons
behind each rule; this file is the skeleton to fill.

```
<deck-name>/
  index.html      the deck: theme, base CSS, slides, controller, runtime
  assets/         pictures, videos, SVG files (relative paths only)
```

## Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Deck title</title>

<!-- Fonts: Google Fonts <link> (the editor reads it, can self-host or embed the files).
     One <link> with every family and weight the deck uses. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@700;900&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">

<style>
/* ===========================================
   THEME - the editor's Theme panel lists these and the properties panel
   offers the colours as swatches. Literal values only (no var() aliases
   for the colours you want as swatches). Keep the names below: the
   editor's "New slide" layouts look for accent / ink / rule / paper-2.
   =========================================== */
:root {
    --ink:      #1a1a1a;   /* headings, key text            */
    --ink-2:    #3a3a3a;   /* body text                     */
    --ink-3:    #7a7a7a;   /* captions, secondary           */
    --rule:     #e2ddd3;   /* hairlines, borders            */
    --paper:    #f5f3ee;   /* slide background              */
    --paper-2:  #ece8df;   /* panels, cards                 */
    --accent:   #c41e3a;   /* the one accent                */
    --accent-2: #e8d4c0;   /* optional second accent        */

    --stage-bg: #17150f;   /* letterbox outside the stage   */
    --slide-bg: #f5f3ee;   /* same literal as --paper       */
    --font: 'Work Sans', 'Helvetica Neue', Arial, sans-serif;          /* body: the deck's default font */
    --font-display: 'Fraunces', Georgia, serif;                         /* headings                       */

    --pad-x: 96px;         /* layout rhythm at 1920x1080     */
    --pad-top: 72px;
    --ease-out: cubic-bezier(0.16, 1, 0.3, 1);   /* motion: the reveal's curve, duration, */
    --dur: 0.7s;                                 /* stagger step and travel distance;     */
    --stagger: 0.12s;                            /* the editor's Motion section edits     */
    --reveal-y: 28px;                            /* these four                            */
}

* { margin: 0; padding: 0; box-sizing: border-box; }

/* --- PASTE deck-base.css HERE, IN FULL --- */

/* ===========================================
   TYPE - base styles on the tags themselves (the editor's Theme panel
   edits h1/h2/h3/p/li base styles, and "New slide" layouts keep their tags,
   so a slide added in the editor looks like the generated ones)
   =========================================== */
h1 { font-family: var(--font-display); font-size: 112px; font-weight: 900; line-height: 1.02; letter-spacing: -0.02em; color: var(--ink); }
h2 { font-family: var(--font-display); font-size: 68px; font-weight: 700; line-height: 1.08; letter-spacing: -0.015em; color: var(--ink); }
h3 { font-size: 40px; font-weight: 600; line-height: 1.2; color: var(--ink); }
p  { font-size: 32px; line-height: 1.45; }
ul, ol { font-size: 34px; line-height: 1.5; padding-left: 44px; }
li { margin-bottom: 12px; }
blockquote { font-family: var(--font-display); font-size: 64px; line-height: 1.3; }
.eyebrow { font-size: 22px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); margin-bottom: 24px; }

/* ===========================================
   LAYOUT - a small system of slide kinds. Each slide is a few discrete
   blocks inside .content (padding = the rhythm above).
   =========================================== */
.slide .content { position: absolute; left: var(--pad-x); right: var(--pad-x); top: var(--pad-top); bottom: var(--pad-top); }
.title-slide .content { top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
.title-slide h1 { max-width: 1400px; }
.body-slide h2 { margin-bottom: 40px; }
.two-col .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; margin-top: 24px; }
.card { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 16px; padding: 40px 44px; }
.stat { font-family: var(--font-display); font-size: 240px; font-weight: 900; line-height: 1; color: var(--accent); }

/* ===========================================
   DECOR - atmosphere: gradients, patterns, shapes. Real elements when the
   user might want to move them (a blob, a big number); pseudo-elements or
   backgrounds when they are pure texture.
   =========================================== */
.slide.dark { background: var(--ink); color: var(--paper); }
.slide.dark h1, .slide.dark h2, .slide.dark h3 { color: var(--paper); }
.blob { position: absolute; width: 720px; height: 720px; border-radius: 50%; filter: blur(80px); opacity: 0.35; background: var(--accent); }

/* ===========================================
   MASTER LAYER - the footer every slide shows (a stage child that is not a
   slide). The editor edits it once for all slides; the page counter is kept
   in step by the controller and the runtime.
   =========================================== */
.deck-footer {
    position: absolute; left: var(--pad-x); right: var(--pad-x); bottom: 36px; z-index: 5;
    display: flex; justify-content: space-between; align-items: center;
    font-family: var(--font); font-size: 18px; letter-spacing: 0.04em; color: var(--ink-3);
}
.deck-footer .num { font-variant-numeric: tabular-nums; }
/* A slide with data-no-master hides the footer (the editor's own convention:
   its "Show the footer..." checkbox toggles the attribute) */
.deck-stage:has(> .slide.active[data-no-master]) > :not(.slide) { visibility: hidden; }
</style>
</head>
<body>

<div class="deck-viewport">
<main class="deck-stage" id="deckStage" data-guides="x:96,x:1824,y:72,y:1008">

<!-- ======================================================
     SLIDE 1 - Title
     ====================================================== -->
<section class="slide title-slide active" data-name="title" data-no-master>
    <div class="blob" style="left:1180px; top:-220px"></div>
    <div class="content">
        <div class="eyebrow reveal" style="--i:0">Eyebrow line</div>
        <h1 class="reveal" style="--i:1">Presentation title</h1>
        <p class="sub reveal" style="--i:2">Subtitle, author, date</p>
    </div>
    <aside class="notes" hidden>What to say on the title slide.</aside>
</section>

<!-- ======================================================
     SLIDE 2 - Bullets
     ====================================================== -->
<section class="slide body-slide" data-name="agenda" data-section="Context">
    <div class="content">
        <div class="eyebrow reveal" style="--i:0">Section</div>
        <h2 class="reveal" style="--i:1">Slide title</h2>
        <ul>
            <li class="reveal" style="--i:2">First point</li>
            <li class="reveal" style="--i:3">Second point</li>
            <li class="reveal" style="--i:4" data-fragment>Revealed on click</li>
        </ul>
    </div>
</section>

<!-- ======================================================
     SLIDE 3 - Text and image (free-positioned picture)
     ====================================================== -->
<section class="slide body-slide" data-name="feature">
    <div class="content">
        <h2 class="reveal" style="--i:0">A picture beside the point</h2>
        <p class="reveal" style="--i:1; width:760px">Text on the left; the picture on the right is
        absolutely positioned in stage pixels, so it drags freely in the editor.</p>
        <img class="reveal-img" style="--i:2; position:absolute; left:900px; top:120px; width:828px; height:620px; object-fit:cover; border-radius:16px"
             src="assets/photo.jpg" alt="What the photo shows">
    </div>
</section>

<!-- ======================================================
     SLIDE 4 - Big number
     ====================================================== -->
<section class="slide body-slide dark" data-name="stat">
    <div class="content">
        <div class="stat reveal" style="--i:0">42%</div>
        <p class="reveal" style="--i:1; font-size:40px; max-width:1100px">What the number means, in one line.</p>
    </div>
</section>

<!-- The master layer: shown on every slide, edited once in the editor -->
<div class="deck-footer">
    <span>Deck title</span>
    <span class="num"><b data-page-now>1</b> / <span data-page-total>4</span></span>
</div>

</main>
</div>

<div class="deck-controls" aria-label="Slide controls">
    <button id="btnPrev" title="Previous">&larr;</button>
    <span class="page"><span id="pageNow">1</span> / <span id="pageTotal">4</span></span>
    <button id="btnNext" title="Next">&rarr;</button>
</div>

<script>
/* --- PASTE deck-controller.js HERE, IN FULL (do not rewrite it) --- */
</script>

<!-- Presentation features: P presenter, O overview, L laser, D draw, Space steps through fragments. Added by the deck editor; safe to delete. -->
<script id="deck-runtime">
/* --- PASTE deck-runtime.js HERE, IN FULL. Use the editor's copy when the editor is installed
       (py -3 scripts/deckeditor.py runtime prints the path), else the bundled one. --- */
</script>
</body>
</html>
```

## What each part is for

| Part | Rule |
|---|---|
| `:root` variables | Literal colours (`#hex`, `rgb()`), at least one `--font*` variable. The editor shows them as swatches and in the Theme panel; saved themes can be applied across decks that share the names. |
| `deck-base.css` | Verbatim. It is the editor's own base (stage, slide visibility, print, reduced motion, the `.reveal` family with `--dx/--dy`). |
| Type on tags | `h1 h2 h3 p li blockquote` styled on the tag so the Theme panel's base styles and the editor's "New slide" layouts match the deck. Class-based variants on top are fine. |
| `.slide` | `<section class="slide">`, first one `active`, `data-name` for the slide strip and presenter, `data-section="Name"` where a section starts. |
| Blocks | Headings, paragraphs, lists, cards, pictures: each a discrete element. Flow (flex/grid) for text columns; absolute stage-px positions for anything the user will drag (pictures, callouts, decorative shapes, big numbers). |
| `.reveal` + `--i` | Entrances. Every animated element carries `class="reveal"` (or `-img`, `-right`) and `style="--i:n"`. |
| `data-fragment` | Reveal on click (runtime). `data-fragment-index="n"` orders them. |
| `<aside class="notes" hidden>` | Speaker notes, inside the slide, one per slide at most. Not HTML comments. |
| `data-guides` on the stage | The layout's margins (`--pad-x`, `--pad-top`) as editor guides, so drags snap to the deck's rhythm. |
| `data-locked` | On backgrounds and decoration that should not move on a stray click. Not on pictures or text the user will place. |
| Master layer | Stage children that are not slides: a footer with `data-page-now` / `data-page-total`, a logo. Optional but recommended. |
| `.deck-controls` | Prev/next chevrons and the page number outside the stage; keep the markup and ids, the controller binds them and fades them after 2 s idle (H hides them). Never restyle them per deck. |
| Controller | `deck-controller.js` verbatim: scaling, keys, touch, wheel, `#n` hash, `deck:slide`, `deck:rescale`, `--ed-panel`, live slide list, page counters. |
| Runtime | `<script id="deck-runtime">` last in the body: presenter, overview, laser, drawing, fragments, transitions, text effects, auto-animate, links. The editor updates old copies itself. |

## Other slide sizes

The default is 16:9 at 1920x1080. For another format (4:3, A4, square, 9:16),
set the size once on both the stage and the slides and the controller and the
editor follow it:

```css
.deck-stage, .deck-stage .slide { width: 1440px; height: 1080px; }   /* 4:3 */
@media print { .slide { width: 1440px; height: 1080px; } }
```

Author the layout for that size. Do not change the editor's own sizes in the
base block; add the override after it.

## Charts

Charts are the editor's own: a `figure[data-chart]` holding its table as
JSON. The deck needs no script or library for them (no trust bar, prints,
exports to one file), and the user edits the figures in the editor's Chart
section like a spreadsheet.

```html
<figure data-chart="column" class="reveal-img"
        style="--i:1; position:absolute; left:96px; top:220px; width:1100px; height:620px; margin:0; font-size:24px; color:var(--ink-2)"><script type="application/json" data-chart-data>{"labels":["Q1","Q2","Q3","Q4"],"series":[{"name":"2025","values":[42,55,61,70]},{"name":"2026","values":[48,63,72,86]}],"palette":["var(--accent)","var(--ink-3)"],"legend":true,"values":true,"grid":true,"stacked":false,"unit":"%"}</script></figure>
```

- `data-chart`: `column | bar | line | area | pie | doughnut` (a pie draws the
  first series, a slice per label).
- The table: `labels`, `series` of `{name, values}` (one number or `null` per
  label; a series may carry its own `colour`), `palette` (colours for the
  series in turn: the deck's variables as `var(--accent)` so a theme change
  recolours the chart, literal colours otherwise), `legend`, `values`
  (numbers on the chart), `grid`, `stacked` (column, bar, area), optional
  `unit` (`$` goes before the number, `%` or ` kg` after) and `title`.
- The chart's text takes the figure's `font-family`, `font-size` and `color`:
  set them inline or by class. Give the figure a box in stage px.
- No `<svg>` in what you write: the editor draws it from the table when it
  opens the deck; save there (Ctrl+S) and the drawing is in the file, so the
  deck shows it anywhere. Until then the figure is empty outside the editor
  (check-deck warns). No `<` in the JSON (write it as \u003c).

A chart kind the editor does not draw (scatter, maps, networks) goes through
a library in a `[data-fig]` host, below; Diapo pauses the deck's scripts until
the user trusts it, so say that when delivering.

## Equations and chemical structures

Equations and structures are the editor's own too: a `figure` holding the
source, which the editor draws as plain SVG (no script or library in the
deck) and the user edits in its Equation or Structure section.

```html
<figure data-math="k = A\,e^{-E_a/RT}" class="reveal"
        style="--i:1; position:absolute; left:96px; top:300px; margin:0; font-size:64px; color:var(--ink)"></figure>

<figure data-chem="CC(=O)Oc1ccccc1C(=O)O" class="reveal-img"
        style="--i:2; position:absolute; left:1100px; top:240px; width:600px; height:440px; margin:0; color:var(--ink)"></figure>
```

- `data-math`: LaTeX as in a paper, display style. Reactions with mhchem:
  `\ce{2H2 + O2 -> 2H2O}`. The equation is sized by `font-size` (no width or
  height) and coloured by `color`. Write `"` in the LaTeX as `&quot;`.
- `data-chem`: SMILES (canonical or as ChemDraw / PubChem gives it). Give the
  figure a box in stage px; the drawing scales into it. Bonds and carbon take
  `color`; other atoms the usual colours, or one colour with
  `data-chem-colours="off"`. Aromatic rings get alternating double bonds;
  `data-chem-aromatic="circles"` draws circles.
- No `<svg>` in what you write: the editor draws it when it opens the deck;
  save there (Ctrl+S) and the drawing is in the file. Until then the figure
  is empty outside the editor (check-deck warns), and a source that does not
  draw is listed under the editor's Problems.

## Inlined SVG and generated content

Anything a script builds at load time must live in an element that is empty
in the file, so the editor can strip the generated DOM on save and the deck
regenerates it on load:

```html
<!-- A chart: the host has its size inline; the script renders into it
     and re-renders on the editor's deck:resize event. -->
<div class="plot reveal-img" style="--i:1; position:absolute; left:0; top:140px; width:1200px; height:640px" data-fig="revenue"></div>

<!-- An SVG file inlined at load so its shapes are recolourable in the editor.
     The <img> is the fallback and what the file keeps. -->
<div class="scheme reveal-img" style="--i:2; position:absolute; left:1240px; top:140px; width:560px" data-svg="assets/scheme.svg">
    <img src="assets/scheme.svg" alt="Pipeline scheme">
</div>

<!-- Decoration generated by script (particles, dot fields, a canvas) -->
<div class="field" data-generated></div>
```

```js
/* Render figures on demand: when their slide shows, and again on resize. */
function renderFigure(el) {
    if (el.dataset.rendered) return;
    el.dataset.rendered = '1';
    const draw = () => { /* Plotly.newPlot(el, data, {...layout, width: el.clientWidth, height: el.clientHeight}) */ };
    draw();
    el.addEventListener('deck:resize', draw);        // the editor fires this after a resize
}
document.addEventListener('deck:slide', (e) => {
    document.querySelectorAll('.slide')[e.detail].querySelectorAll('[data-fig]').forEach(renderFigure);
});
document.querySelectorAll('[data-svg]').forEach(async (host) => {
    if (host.querySelector('svg')) return;
    try {
        const res = await fetch(host.dataset.svg);
        const svg = new DOMParser().parseFromString(await res.text(), 'image/svg+xml').documentElement;
        host.replaceChildren(svg);
    } catch (e) { /* keep the <img> */ }
});
```

Load chart libraries from a local file next to the deck (`<script src="plotly.min.js">`)
when the deck must work offline; the editor's single-file export inlines it.
Every script here is the deck's own: the editor shows a bar asking to trust
the deck, and the charts stay empty (in the `/deck/` screenshots too) until
the user does.

## Images

- Relative paths only: `assets/name.jpg`. Never absolute file-system paths, never base64 in the file (the editor's single-file export does that on demand).
- Give every picture a box in stage pixels (`width`/`height` inline or via a class) and `object-fit: cover` or `contain`; a picture without a box takes its natural size, which is rarely right at 1920x1080.
- Resize originals over ~2000px wide before copying them into `assets/` (Pillow: `img.thumbnail((2400, 2400))`), keep the originals elsewhere.
- Slots for pictures the user has not supplied yet: an image placeholder the editor fills with a double-click:
  ```html
  <div data-placeholder="image" style="display:none; position:absolute; left:960px; top:140px; width:800px; height:620px; border-radius:16px"></div>
  ```
  It is invisible when presenting and shown as a dashed box in the editor.
- Never repeat a picture on several slides (logos on the title and closing slide excepted).

## Code quality

- A `/* === SECTION === */ ` comment block before every CSS section and a
  `<!-- === SLIDE n - name === -->` comment before every slide (the editor
  ignores comments that only name the slide; anything else in a comment
  before a slide is read as legacy speaker notes, so keep those comments to the
  slide name).
- Semantic tags (`section`, `main`, `h1`-`h3`, `p`, `ul`, `blockquote`, `figure`).
- No em dashes in slide text or comments; use a hyphen, a comma or a colon.
- Nothing in the file depends on the editor: the deck presents on its own from
  `file://` and from any static host.
