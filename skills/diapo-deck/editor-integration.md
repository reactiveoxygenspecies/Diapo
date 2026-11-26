# Working with the deck editor

The deck editor (`deck-editor/` in the Diapo repository) opens a
deck in an iframe, lets the user select, drag, resize, restyle and retype
anything directly on the slide, and saves the same HTML file back. It works on
any deck that follows its file contract; this file lists what that means for a
generated deck, and what breaks it. The full contract is in the editor's
REFERENCE.md ("Deck file contract"); the parts below are the ones a generator
touches.

## What the editor does to a deck (so you know what to leave room for)

- **Edits are inline.** Moves become `translate: x y` (or `--dx/--dy` on
  `.reveal*` elements), rotation `rotate:`, sizes `width/height`, text resizes
  `font-size`, colours and fonts inline `style`. The deck's `<style>` and
  `<script>` blocks are never rewritten.
- **The head is written back verbatim**, plus up to two blocks at its end:
  `<style id="deck-editor-fonts">` (fonts added in the editor) and
  `<style id="deck-editor-overrides">` (theme variable overrides, base text
  styles, custom CSS, animation keyframes, slide size, master-layer opt-outs).
  Never use those ids yourself; never remove them from a deck the user has
  edited.
- **Generated DOM is stripped on save**: `[data-fig]` hosts are emptied,
  `[data-svg]` hosts go back to their `<img>`, `[data-generated]` and any element
  with an `id` that was empty in the file are emptied, body-level nodes that
  scripts appended are dropped. Anything else a script injected is baked into
  the file.
- **While editing, `<html>` carries `class="deck-editing"`.** The editor forces
  the stage transform, shows fragments and placeholders, and captures keys.
  Preview mode (F5) removes the class and runs the deck as-is.
- **Thumbnails** are built from the head (scripts stripped) plus the slide
  forced visible: script-drawn content shows as a hatched placeholder there;
  CSS-drawn content shows.
- **Backups and drafts** go to `.deck-editor/` next to the deck. Ignore that
  folder; do not delete it.
- **New slides** made in the editor use the deck's `h1/h2/p/ul` tag styles,
  `--font` and its accent / muted / rule / paper-2 variables (matched by
  name), so a generated deck that styles tags and names its variables that way
  stays consistent when the user adds slides.

## Rules for the generator

### Must

1. Structure `div.deck-viewport > main.deck-stage#deckStage > section.slide`,
   first slide `active`, none `visible`. Include `deck-base.css` verbatim.
2. Slides shown with `.active`/`.visible`; no `display:none` for slides, no
   scroll-snap, no per-device reflow.
3. The controller from `deck-controller.js`, verbatim, byte for byte (hash `#n`, `deck:slide`,
   `deck:rescale`, `--ed-panel`, live slide list, page counters, stage size).
   Do not write a second navigation; do not add key handlers for letters
   (P, O, L, D, C, E, digits, `[` `]` belong to the runtime) or for keys while
   something is `contenteditable`.
4. The runtime as `<script id="deck-runtime">`, last in the body. No in-deck
   editor of any kind: no edit toggle, no `E` key, no `contenteditable`, no
   localStorage autosave. The editor is the editor.
5. `.reveal*` entrances end in `translate(var(--dx,0px), var(--dy,0px))`
   (deck-base.css does this). If you add your own entrance class, copy the
   pattern: `.slide.visible .x { opacity:1; transform: translate(var(--dx,0px), var(--dy,0px)) }`.
   Stagger with `style="--i:n"`, never with `:nth-child` delays (the editor
   shows and edits `--i`; reordering elements would silently change
   `:nth-child` timing).
6. Speaker notes as `<aside class="notes" hidden>` inside the slide.
7. `:root` colours as literal values, at least one `--font*` variable, and the
   body font on `.slide` (`font-family: var(--font)`), so inserted elements
   inherit the theme.
8. Script-generated content only inside empty `[data-fig]`, `[data-svg]` (with
   an `<img>` fallback) or `[data-generated]` hosts.
9. Relative asset paths under the deck folder. A `<title>`. UTF-8.
10. No `</body>` or `</script>` literals inside script strings.
11. Scripts of the deck's own only when they earn it. Diapo runs its own
    scripts (the controller and runtime, recognised by their exact text, so
    paste them unchanged) and pauses every other script, inline event
    handler and `javascript:` link until the user trusts the deck: a bar asks
    when the deck opens. A deck with no script of its own opens without the
    bar. So prefer the editor's charts (`figure[data-chart]`, no script,
    deck-template.md "Charts") and CSS over a chart library, and never use
    `onclick="..."` attributes or `javascript:` links. A `<script
    type="application/json">` data block is not a script: it never runs.
    The one library Diapo runs as its own is plotly.js for an interactive
    chart (`figure[data-plot="plotly"]`, below): use that form, never a
    Plotly `<script>` of your own with a `Plotly.newPlot(...)` call.
    Paste the controller and runtime without re-indenting them: whitespace
    round the whole script is tolerated, inside it is not.

### Should

- Position freely draggable things (pictures, callouts, shapes, big numbers,
  decorative blobs) absolutely in stage px with inline `left/top/width/height`.
  Text columns may flow (flex/grid); the editor moves flow elements with an
  offset and shows the offset in the position fields.
- Keep the DOM shallow: slide > `.content` > blocks. Every heading, paragraph,
  list, card and picture its own element; no wrapper chains around single
  elements. A card (picture + caption, icon + label) as one parent with at most
  one text block and one picture is selected as a unit; that is the intended
  behaviour.
- No text in `::before`/`::after` (not selectable, not editable); pseudo-elements
  for texture only. A decorative shape the user may want to move (a blob, a
  band, a badge) is a real element without `pointer-events: none` (the editor
  cannot pick an element that has it). A full-slide texture layer that must
  never catch a click may keep `pointer-events: none`.
- No authored `transform` on elements the user will move or on `.reveal*`
  elements (the visible rule replaces it). Use `left/top`, margins, `rotate:`.
- Gate effects that fight the editor on `html:not(.deck-editing)`: custom
  cursors and `cursor: none`, autoplaying loops that cost CPU, parallax on
  mouse move, ambient audio.
- Fonts from Google Fonts through one `<link>`; the editor lists the families,
  their weights, and can download or embed them. Fontshare and other CDNs work
  in the deck but the editor cannot self-host them; if a preset names one, use
  it knowingly or pick the closest Google family.
- One `data-name` per slide (the slide strip, the presenter view and the
  overview label slides with it), `data-section="Name"` where a section starts.
- A master layer (footer, page counter, logo) as a stage child outside the
  slides, with `data-page-now`/`data-page-total`.
- `ul`/`ol` with `li` items; `table` with `data-group` so the editor selects it
  as one; `<pre><code data-code>` for code blocks (the editor colours them).

### Never

- `<deck-stage>` web components, shadow DOM, or any framework (React, reveal.js).
- `display:none` for hiding content the user should be able to find (the
  editor writes `display:none` + `data-hidden` for that itself).
- `!important` on properties the user will edit (colour, size, position of
  content elements). It blocks inline edits.
- `overflow: hidden` on text containers sized to their content; edited text
  would clip silently. `overflow:hidden` on the slide itself is fine.
- `clamp()`, `vw`, `vh` inside the stage. Stage pixels only.
- Absolute filesystem paths, `data:` images in the file, `srcset`.

## Markup the runtime and the editor understand (no CSS needed)

| Attribute | On | Effect |
|---|---|---|
| `data-fragment` | any element | Hidden until revealed with Space / Right; `data-fragment-index="n"` orders them, equal numbers reveal together. Its entrance is its `data-anim` preset or a fade. |
| `data-transition="fade\|slide\|up\|zoom\|none"` | a slide, or `.deck-stage` as the default | Slide entrance when presenting; `data-transition-duration="0.5"` in seconds. |
| `data-auto-animate` | a slide | Morph into the next slide: elements present on both (matched by `data-id`, else tag + text or image `src`) move and resize into place; `data-auto-animate-duration="0.8"`. |
| `data-text-effect="letters\|words\|typewriter"` | a text element | Text appears piece by piece when its slide shows (or when revealed as a fragment); `data-text-effect-speed="1.5"`. |
| `data-section="Name"` | a slide | Starts a section (slide strip heading, overview heading). |
| `data-name="short"` | a slide | Label in the slide strip and presenter. |
| `data-href="https://..."` | any element | Click opens the link when presenting; `data-href-target="_self"`. |
| `data-skip` | a slide | Skipped when presenting and in the PDF. |
| `data-no-master` | a slide | Hides the master layer (footer, page number) on that slide. The editor's checkbox toggles it; the deck's own CSS needs `.deck-stage:has(> .slide.active[data-no-master]) > :not(.slide) { visibility: hidden; }` (deck-template.md has it). |
| `data-anim="fade-up"` | any element | An editor animation preset. Prefer `.reveal` classes in generated decks: the keyframes for `data-anim` live in the editor's override block, which a fresh deck does not have. |
| `data-placeholder="image"` | a `div` with inline `display:none` | Unfilled picture slot: dashed box in the editor, invisible when presenting. |
| `data-group` | any container | Always selected as a whole (tables, lists to edit as one, composed figures). |
| `data-edit` | a text element | Marks text the author intends to be editable (all text is editable anyway). |
| `data-fig` / `data-svg` / `data-generated` | hosts | Script-rendered content, see deck-template.md. |
| `data-chart` | `<figure>` | A chart the editor draws and edits (Insert > Chart): an inline `<svg>` plus its table as JSON in `<script type="application/json" data-chart-data>`. A generator writes the figure with the JSON only; the editor draws the `<svg>` when it opens the deck, and Ctrl+S keeps it. deck-template.md has the format. |
| `data-plot="plotly"` | `<figure>` | An interactive chart (Insert > Interactive chart (Plotly)...): live when presented (hover, zoom, legend), a picture everywhere else. See "Interactive charts (Plotly)" below. |
| `data-math` | `<span>` in text | An equation inside a sentence: the LaTeX in the attribute, one inline `<svg>` inside (MathJax's inline style, sized in `em`, `vertical-align` in `em` for its baseline, `currentColor`). Written with the LaTeX alone, the editor draws it on open. While text is edited it is an atom (`contenteditable=false`, never saved). PowerPoint export writes it as text. |
| `data-cite="[@key]"` | `<span>` in text | A citation, in Pandoc's syntax (`[@key]`, `@key` in the sentence, `[-@key]` year only, `[@key, p. 4]`, `[@a; @b]`). Write the span with the key alone (`<span data-cite="[@szostak2001]"></span>`) and the deck's references in `<script type="application/vnd.citationstyles.csl+json" id="deck-references">[...CSL-JSON, id = key...]</script>` as the first child of `.deck-stage`; the editor writes the words in the deck's style (`data-csl-style="nature"` on the stage, APA when absent) when it opens the deck. An atom while text is edited. |
| `data-sources` | a slide | The Sources slide: its title is the generator's, its list (`div.deck-sources[data-sources-body]`) is written by the editor from the citations and the pictures' credits. `data-sources="references"`, `"credits"` or both. |
| `data-credit-by`, `data-credit-from`, `data-credit-license`, `data-credit-url` | `<img>` | A picture's credit (Picture > Credit in the panel). Listed on the Sources slide; with `data-credits="corner"` (or `edge`, `under`, `footer`, `info`) on the stage, the editor writes it beside the picture. |
| `data-math` / `data-chem` | `<figure>` | An equation (LaTeX) or a chemical structure (SMILES) the editor draws and edits (Insert > Equation, Insert > Chemical structure): the source in the attribute, one inline `<svg>` inside. A generator writes the figure with the source only; the editor draws it on open and Ctrl+S keeps it. Options on structures: `data-chem-colours="off"`, `data-chem-aromatic="circles"`. A structure from a Molfile or ChemDraw CDXML (drawn with the file's own 2D coordinates): `data-chem="" data-chem-format="molfile"` (or `"cdxml"`) with the file inside in `<script type="chemical/x-mdl-molfile" data-chem-source>` (`chemical/x-cdxml`). |
| `data-auto-advance="8"` | a slide, or `.deck-stage` as the default | The deck moves on by itself after that many seconds (fragments first, one step at a time). When the first slide has a wait (its own or the stage's), the deck starts running as soon as it is opened on its own: a kiosk. A (in the deck) starts and stops it. |
| `data-loop` | `.deck-stage` | A deck that runs by itself starts again after the last slide. |
| `data-locked` | any element | Passed by when clicking and marquee-selecting, cannot be dragged: full-bleed backgrounds, texture layers, frames. Ctrl+click still selects it. |
| `data-guides="x:96,x:1824,y:72"` | `.deck-stage` | Guides the editor shows with Look > Rulers and guides; drags snap to them. Stage px. |
| `data-fit="shrink"` + `data-fit-size="32px"` | a text with a box of its own | Shrink to fit: when edited text overflows its box, the editor steps the font size down (never above `data-fit-size`, which equals the inline `font-size`). For cards and captions the user will retype. |
| `data-id="name"` | any element | Links elements across slides for auto-animate, and names them in Morph from. Unique within a slide. The editor gives every element it inserts one. |
| `data-name="Logo"` | any element | The element's name in the editor's panel and lists (on a slide: the slide's label). |
| `data-crop` | a `div` round an `<img>` | A picture cropped in the editor (the div is the box, the picture placed in % inside). Written by the editor; leave it. |
| `data-page-now` / `data-page-total` | in the master layer | Page counter kept in step by the controller and the runtime. |

## Opening a deck in the editor

What a bar at the top of the editor means when a deck opens:

- **Trust this deck?** The deck has scripts of its own (not the controller
  or runtime, or those re-indented); they stay paused until the user trusts
  it. Charts or effects drawn by those scripts are missing until then,
  in the `/deck/` URL too.
- **Older edition of the presentation features.** The runtime pasted was
  not the current one; `py -3 scripts/deckeditor.py runtime` prints the
  current one. The editor also updates it on save.


`scripts/open-in-editor.py <deck.html>` finds the editor (env `DECK_EDITOR_HOME`,
then `config.json` next to the scripts, then the repository next to this skill),
reuses a running server on the port if there is one (switching its folder to
the deck's parent folder when needed) or starts `py -3 serve.py <parent> <port> --no-open`,
and prints the URL `http://127.0.0.1:<port>/?file=<name>/index.html`. The deck
alone (no editor chrome) is at `http://127.0.0.1:<port>/deck/<name>/index.html#n`,
which is what to screenshot.

Inside the editor: the status bar's **Problems** badge lists missing pictures,
scripts and errors thrown by the deck's own scripts; the slide strip shows
every slide; click a heading and it should select as a single element with a
box and handles; Ctrl+S saves and the file must stay byte-identical when
nothing was changed.

## Verification checklist (run before delivery)

1. `py -3 scripts/check-deck.py <deck.html>` reports no errors (warnings
   explained in the message to the user).
2. Every slide screenshot at 1280x720 (`/deck/<name>/index.html#n`): no text
   overflowing its box or the stage, no panel covering another, fonts loaded.
3. One phone-width screenshot (375px): the stage letterboxes, nothing reflows.
4. Opened in the editor: Problems badge absent, no bar at the top,
   thumbnails present, a heading selects as one element, an `.reveal` element
   dragged in Preview still fades in. Charts drawn; Ctrl+S once so the file
   keeps the drawings (check-deck warns while a chart has none).
5. Keys in the deck alone: arrows and Space navigate, `#3` in the URL shows
   slide 3, P opens the presenter, O the overview, H hides the on-screen
   controls (they fade after 2 s without mouse movement anyway). A deck
   meant to run by itself: A starts it, and it moves on at the set seconds.

## Interactive charts (Plotly)

When the user has a Plotly figure (from Python, R or a notebook) and wants it
live in the talk, write it exactly like this. Use the editor's own charts
(`figure[data-chart]`) for anything a column, bar, line, area or pie chart can
say: they need no library.

```html
<figure data-plot="plotly" data-plot-theme="deck" data-id="fig-growth"
        style="position:absolute; left:410px; top:230px; width:1100px; height:620px; margin:0; font-size:22px;">
  <script type="application/json" data-plot-figure>{"data":[{"type":"scatter","mode":"lines+markers","name":"Control","x":[0,10,20,30],"y":[0.02,0.05,0.11,0.24]}],"layout":{"title":{"text":"Growth over time"},"xaxis":{"title":{"text":"Time (min)"}}}}</script>
</figure>
```

and, once per deck, as the last two lines before `</body>` (after the
controller and the runtime):

```html
<script src="deck-plotly.min.js" data-deck-plot="library"></script>
<script src="deck-plot.js" data-deck-plot="renderer"></script>
```

- The JSON is the figure as `fig.to_json()` gives it: `data` (required),
  `layout`, optionally `config` and `frames`. Paste it whole, on one line, with
  every `<` written `\u003c`. Do not put `width`, `height` or `autosize` in
  the layout to size it: the chart takes the size of the figure element, which
  needs a width and a height.
- `data-plot-theme="deck"` gives the chart the deck's look: the figure
  element's `color`, `font-family` and `font-size` for its text (22px reads
  well on a 1920x1080 slide), a clear ground, the deck's accent colours for the
  series. Leave the attribute out to keep the figure's own colours (then give
  the layout a `paper_bgcolor` that suits the slide).
- `data-plot-live="off"` shows the picture only; `data-plot-toolbar="off"`
  hides Plotly's toolbar.
- Do not write the `<img data-plot-snapshot>` picture yourself: Diapo draws it
  the first time the deck is opened in the editor and keeps it up to date. Tell
  the user to open the deck in Diapo and save it once: that draws the pictures
  (what the PDF, PowerPoint and the slide strip show) and puts
  `deck-plotly.min.js` and `deck-plot.js` beside the deck. Until then the chart
  is blank outside the editor. `deck-plot.js` is in this skill's folder and
  may be copied beside the deck straight away; the library comes with Diapo
  (`deck-editor/app/vendor/plotly.min.js`, copied as `deck-plotly.min.js`,
  unchanged).
- The deck opens in Diapo without the "Trust this deck" bar: these two files
  are Diapo's own, recognised by their contents. Any change to them, or any
  other way of loading Plotly, makes them the deck's own scripts.
- Maps (`scattergeo`, `choropleth`, `scattermap`...) fetch their outlines or
  tiles from the internet whenever they are drawn; say so to the user.
