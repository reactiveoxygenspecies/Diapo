# Diapo Format

The file format of Diapo: the file contract for a standalone HTML slide
deck, and the three pieces of code every such deck carries. MIT licensed
(see `LICENSE`), so a deck made with the editor, or by anything else that
follows this format, can be copied, shared, sold and modified without any
obligation beyond the notice that is already inside the code.

The editor itself (the application that opens, edits and saves these decks)
is a separate project, MIT licensed too. Nothing here depends on it: a
deck built on this format plays in any modern browser, from a file or a web
server, with no build step and no network access except the fonts it links.

| File | What it is | Where it goes in a deck |
|---|---|---|
| `deck-base.css` | The fixed 1920x1080 stage, slide visibility, print layout, reduced motion and the `.reveal` entrance family | Inside the `<style>` block, after the deck's `:root` variables and reset |
| `deck-controller.js` | Scales the stage into the window; keyboard, touch and wheel navigation; `#n` in the URL; the `deck:slide` / `deck:rescale` events | A `<script>` at the end of `<body>` |
| `deck-runtime.js` | Presentation features: presenter window, overview, laser, drawing, fragments, auto-animate, transitions, text effects, links, speaker notes | `<script id="deck-runtime">` right after the controller |

The three files are generated from the editor's own template and runtime by
`deck-editor/tools/build-format.py`, so they are always exactly what the
editor writes into a new deck. `deck-runtime.js` reports its version as
`window.deckRuntime.version` (currently 6); the editor offers to update older
copies in a deck.

## A deck

One `.html` file, plus optional sibling files (`assets/`, `fonts/`, `*.js`,
`*.css`) in the same folder:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My talk</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root { --font: Inter, sans-serif; --ink: #1a1a1a; --paper: #fff; --accent: #d33; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* deck-base.css, in full */

    /* the deck's own slide styles */
    .title { font: 700 120px/1 var(--font); color: var(--accent); }
  </style>
</head>
<body>
  <div class="deck-viewport">
    <main class="deck-stage" id="deckStage">
      <section class="slide active" data-name="Cover">
        <h1 class="title reveal" style="left:120px;top:400px" data-edit>Hello</h1>
        <aside class="notes" hidden>Say hello.</aside>
      </section>
      <section class="slide" data-name="Second">
        <p class="reveal" style="--i:1" data-fragment>One thing at a time.</p>
      </section>
    </main>
  </div>
  <script>
    /* deck-controller.js, in full */
  </script>
  <script id="deck-runtime">
    /* deck-runtime.js, in full */
  </script>
</body>
</html>
```

## The contract

Required:

- The DOM is `.deck-viewport > .deck-stage > .slide` (one `section.slide` per
  slide). The stage is 1920x1080 unless the deck's CSS sets another size on
  `.deck-stage` and `.slide` together; the controller reads the laid-out size.
- Slides are `position: absolute; inset: 0`, the stage's size, and their
  visibility is switched with the `.active` / `.visible` classes, never with
  `display: none` (`deck-base.css` does this).
- The stage is scaled into the window with `transform: translate() scale()`
  on `.deck-stage`, recomputed on `resize` (`deck-controller.js` does this).
- The deck shows slide n for `#n` in the URL and dispatches `deck:slide`
  (detail = index) or updates the hash when it navigates; the runtime and any
  tool that drives the deck rely on it (`deck-controller.js` does both).

Conventions the runtime and the editor understand, all optional:

| Markup | Meaning |
|---|---|
| `data-name` on a slide | its name in strips and overviews |
| `data-auto-advance="8"` on a slide or the stage | running by itself: the seconds this slide (or every slide) waits before the runtime steps on; `data-loop` on the stage starts again at the end |
| `data-guides` on the stage | the editor's guides for this deck (`x:960,y:540`); nothing in the deck reads them |
| `data-locked` on an element | the editor passes it by when clicking and marquee-selecting, and does not move or resize it |
| `data-css` on an element | CSS of its own written in the editor's Code section, regenerated into the editor's style block on save (`data-css-live` for the editor too) |
| `data-id`, `data-name` on an element | its identity for auto-animate (the editor gives every inserted element one, unique in the deck; the same id on two slides links the two) and the name the user gave it (the editor's panel and Morph from list) |
| `data-skip` on a slide | skipped when presenting (the editor's convention; the controller and runtime show every slide) |
| `<aside class="notes" hidden>` | speaker notes (the reveal.js convention); shown in the presenter window |
| `.reveal`, `.reveal-img`, `.reveal-right` with `--i: n` | entrance animation, staggered by `--i`; moves are written as `--dx` / `--dy` so the entrance still runs |
| `data-fragment`, `data-fragment-index="n"` | revealed one step at a time, in that order |
| `data-auto-animate` on a slide | elements matched by `data-id` (else tag + text or image) morph into the next slide: they travel and resize, colours and corners tween, a single-path `<svg>` morphs outline to outline into another, unlike elements cross-fade |
| `data-transition="fade\|slide\|zoom\|up\|none"`, `data-transition-duration="0.5"` | how a slide comes in, on the slide or as the default on `.deck-stage` |
| `data-text-effect="letters\|words\|typewriter"`, `data-text-effect-speed` | text entrance |
| `data-href`, `data-href-target="_self"` | a link the runtime opens on click |
| `data-edit` | text the author means to be editable |
| `data-group` | an element always selected as a whole |
| `data-hidden` | hidden in the presentation (editor convention) |
| `[data-fig]`, `[data-svg]`, `[data-generated]` | content rendered by the deck's own script (charts, inlined SVG); tools restore the host on save |
| `figure[data-chart="column\|bar\|line\|area\|pie\|doughnut"]` | a chart drawn by an editor: a plain inline `<svg>` and the table it was drawn from in `<script type="application/json" data-chart-data>`; tools keep both. A generator may write the table alone; Diapo draws it on open |
| `figure[data-math="LaTeX"]` | an equation drawn by an editor: one plain inline `<svg>` (glyphs as paths, sized in `em`, `currentColor`); tools keep both. A generator may write the figure with the LaTeX alone; Diapo draws it on open |
| `figure[data-chem="SMILES"]` | a chemical structure drawn by an editor: one plain inline `<svg>` scaled into the figure's box; optional `data-chem-colours="off"` (one colour) and `data-chem-aromatic="circles"`. A generator may write the SMILES alone; Diapo draws it on open |
| `div[data-crop]` | a cropped picture: a box with `overflow: hidden` holding the `<img>`, placed in percentages of the box |
| `code[data-code]` | a code block |
| `[data-placeholder="image"]` | an unfilled image box |

Events: the deck dispatches `deck:slide` when it navigates and listens for
`deck:rescale` (re-measure and re-scale). An editing tool dispatches
`deck:slides-changed` after adding, removing or reordering slides; a deck
that caches its slide list should re-read it then (the controller reads the
list live, so it needs no listener).

Keys the runtime adds: `P` / Shift+F5 presenter window, `O` overview, `L`
laser, `D` draw (1-5 colours, `[` `]` width, Ctrl+Z, `C` clear), Space /
arrows / PgUp / PgDn for fragments and slides. The runtime is safe to leave
out; the deck then has the controller's navigation only.

Everything an editing tool changes should be stored as inline `style`
attributes, edited text or added and removed elements, never by rewriting the
deck's `<style>` and `<script>` blocks; that is what keeps a deck a plain,
diffable file that any tool can open.

## Notices

Each file carries a short copyright and MIT line in its header comment;
leave it in place when you copy the file into a deck, and you have met the
licence. Nothing else is required, and no attribution to Diapo is
needed in the deck or when you show it.
