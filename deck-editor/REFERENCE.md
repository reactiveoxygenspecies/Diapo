<img src="app/brand/logo.svg" alt="Diapo" width="120" align="left">

# Diapo

A local, zero-dependency editor for HTML slide decks. It opens any deck that
follows the file contract below, lets you edit it like a slide tool (slide strip,
canvas with direct manipulation, properties panel) and saves it back as the same
standalone HTML file.

- Plain HTML/CSS/JS for the app, Python 3 standard library for the server.
- No build step, no npm at runtime. Playwright is used for the tests only.
- The deck iframe is the single source of truth; the saved file is produced from it
  and cleaned so that a deck saved without edits is byte-identical to the original.

New to Diapo? [GUIDE.md](GUIDE.md) is the ten-minute version for people making
presentations; this file is the reference.

## Starting

You need Python 3.8 or newer. Chrome or Edge is recommended: Diapo uses it for
its own window and to print PDFs, and without it Diapo runs in a tab of the
default browser (Firefox included) and PDFs go through the browser's print
dialog. Nothing else is installed.

- **Windows**: double-click `Start Diapo.bat`.
- **macOS**: double-click `Start Diapo.command` (the first time, right-click >
  Open, or `chmod +x "Start Diapo.command" start-diapo.sh` in a terminal).
- **Linux**: `./start-diapo.sh`.

Diapo opens in its own window: Chrome or Edge in app mode, with no tabs or
address bar, a profile of its own (`~/.deck-editor-window-<port>`, so it never
mixes with your browsing and remembers the window size) and the mark as its
icon. Closing the window quits Diapo (on macOS, where Chrome stays open after
its last window, Cmd+Q does). Without Chrome or Edge it opens a tab in the
default browser instead and runs until Ctrl+C. Each launcher reopens the folder
you used last time (the first time: `workspace/`, next to `deck-editor`); drop or
pass a folder to start with that one. Or from a terminal:

```
py -3 serve.py [folder] [port] [--tab | --no-open] [--default <folder>] [--settings <file>] [--backups N]
python3 serve.py ...                                             (macOS, Linux)
```

**Without Python** on the target machine: `py -3 build-exe.py` (needs
`pip install pyinstaller` once) builds `dist/diapo.exe` (or
`dist/diapo` on macOS and Linux; build on the platform you ship to), a
single file that runs like `serve.py` and carries the app inside, with the
logo as its icon (`app/brand/icon.ico`, made by `node tools/build-icon.js`
together with the PNG icons the editor page declares for its app window).
It is windowed: no console, the app window is the program; what the server
would print goes to `~/.deck-editor.log`, and a fatal error (a missing
folder) is shown in a message box. `Start Diapo.bat` behaves the same way
when the python.org launcher is installed (`pyw` runs the server without a
console); otherwise it keeps a console open.

**File dialogs**: Open deck, Browse folder, Import and the export locations use
the system's dialog: tkinter where Python has it (the python.org installers
do), otherwise the native dialog on macOS (`osascript`) or `zenity` / `kdialog`
on Linux. Where none exists (a minimal Linux Python, a server), the editor asks
for the path in a text prompt instead, and exports go next to the deck under a
default name. Setting `DECK_EDITOR_NO_DIALOG=1` forces that behaviour.

- Without a `folder` the last used one is reopened; `--default` names the folder
  for a first run. `port` defaults to 8800. The server binds to 127.0.0.1 only.
- If the port is already Diapo's (a second double-click), a window on the
  running one is opened and nothing else starts; if another program has it,
  the next free port is used.
- `--tab` opens a normal browser tab instead of the app window (and the server
  then runs until Ctrl+C); `--no-open` opens nothing; `--settings` uses another settings file
  (the tests do this so they never touch yours). `--backups N` sets how many
  previous versions are kept per deck (default 10; remembered in the settings).

## Opening decks

The Decks drawer (Ctrl+O, or the Decks button) is the one place for this:

- **Open deck...** shows a normal file dialog; pick any `.html` deck on this
  computer. Its folder becomes the current folder.
- **Browse folder...** shows a folder dialog; every `*.html` in that folder and its
  subfolders is listed (`node_modules`, `.git`, dot-folders and this tool's own
  folder are skipped). You can also paste a path into the Folder field and press
  Enter.
- **Recent** lists the decks you opened last, wherever they are; one click reopens
  them. Every deck in the drawer goes by its name (its `<title>`, else its
  folder), with a picture of its first slide (the deck's own CSS, no scripts;
  a single-file export over 3 MB gets none) and, under it, where it is, when
  it changed and its size; the folder list shows the most recently changed
  first. The title bar names the open deck the same way, with the whole path
  on hover. The last folder and the recent decks are remembered in
  `~/.deck-editor.json`, so the next start lands where you left off.
- **New** creates `<name>/index.html` inside the current folder from a template,
  with the name as the deck's title (`my-talk` is "My talk"):
  the blank one, or one of the designs listed under Templates below (a card with
  the title slide for each).
- **Import...** makes a deck from a Markdown or PowerPoint file (see Importing).
- With no deck open, the canvas offers **Open a deck**, **New deck** and **Try
  the sample deck**: a tour of the editor in Diapo's own design, in three
  parts (Start here: the basics, in the order a first deck needs them;
  Present & share; For power users), with a live chart and a picture to
  crop (`app/templates/welcome.html`, built from `tools/templates-src/` like
  the other templates), free to edit and throw away. The earlier ten-slide
  edition is kept as `tools/templates-src/legacy/welcome-v3.html`. It lives in a folder of its
  own, `~/.deck-editor-samples/welcome/` beside the settings file, never in
  your folder, and is addressed as `@diapo/welcome/index.html` (the `@diapo/`
  folder is virtual: it opens from any workspace and is never listed). The
  file is reused once it exists; an older edition of the tour (from before a
  redesign) is replaced by the current one, the old file kept as a backup in
  its `.deck-editor/` folder.

A deck can also be opened directly with `?file=<path relative to the current
folder>` in the URL.

Decks made with the earlier in-deck editor prototype (a `<script src="editor.js">`
at the end of the file) open fine: that script is served as a no-op while the deck
is inside this editor, and the file is not changed.

## Importing

**Import...** in the Decks drawer picks a `.md` or `.pptx` file on this
computer and writes `<file name>/index.html` (a free folder name) into the
current folder, built on the blank template, so the result looks like a deck
made with New and everything in it is editable. Pictures are copied into the
deck's `assets/`. Anything that could not be carried over is listed in the
toast (a missing picture, a chart). From a Markdown file only pictures, videos
and sounds inside its own folder are copied: a path to any other file (one
outside the folder, or one that is not a picture, such as a key or a password
file named by a Markdown file from someone else) is left out and listed.

- **Markdown** (Marp / reveal-md style): slides are separated by a line of
  three dashes; a YAML front matter block is skipped (its `title:` is used).
  `#` makes a title or section slide (when it is alone), `##` a slide title,
  `-` `*` `+` and `1.` lists (indented lines nest one level), ``` fences code
  blocks, `>` quotes, `|` tables, a line that is only `![alt](picture)` a
  picture, HTML comments and `Notes:` lines speaker notes, blank lines
  paragraphs. Inline `**bold**`, `*italic*`, `` `code` ``, `[links](url)`,
  `~~strike~~`. A slide with one picture and some text gets two columns.
- **PowerPoint**: the deck comes over the way PowerPoint shows it. The
  stage is 1920px wide and keeps the file's proportions (a 4:3 file stays
  4:3); every shape keeps its position, size, rotation and flip. The theme
  is read (its colours with their tints and shades, the master's colour
  map, the theme fonts, the style references that give theme shapes their
  fill, outline and text colour), and so are the master's and the layout's
  backgrounds (solid, gradient, picture, and a duotone picture recoloured as
  PowerPoint does) and decorative shapes, drawn into
  each slide that shows them. Text follows PowerPoint's inheritance (run,
  paragraph, shape, layout placeholder, master placeholder, master text
  styles): size, bold, italic, underline, strike, super- and subscript,
  font, colour, alignment, line spacing, spacing before and after, the
  bullet glyphs themselves, numbered lists, indent levels, autofit shrink,
  vertical anchor, insets. Shapes keep their geometry (rectangles,
  ellipses, triangles, diamonds, chevrons, arrows, stars, hexagons and
  more become the editor's own SVG shapes; custom geometries too), solid
  and gradient fills, dashed outlines and simple shadows; lines and
  connectors keep their direction and arrowheads. Pictures (PNG, JPEG, SVG)
  are copied into `assets/`, cropped, rounded, flipped or made transparent
  as in the file. Tables keep column widths, merged cells, cell fills,
  per-cell alignment and the table style's header, banding and borders.
  Charts (bar and column, clustered or stacked; line; pie and doughnut;
  area) are drawn as SVG with their title, legend, axes and data labels, and
  come over as editable charts: the Chart section of the panel shows their
  figures, series colours, title and options (a percent format's fractions
  as percentages, a currency sign as the unit). PowerPoint's drawing stays
  until the chart is changed; the editor then draws it from the figures.
  SmartArt comes over as the shapes PowerPoint saves beside it. Speaker
  notes, hyperlinks and hidden slides (`data-skip`) are kept. Not carried
  over: effects beyond a simple shadow, 3-D, WordArt fills, animations and
  transitions, video and audio (the poster picture stays), embedded objects
  and scatter or radar charts (a note says so).
- **Limits.** A PowerPoint file from someone else can declare parts of many
  gigabytes that pack into a few kilobytes, so the import stops at sizes no
  real deck reaches: 64 MB for a slide's or a chart's XML (the import stops
  with a message), 1 GB for a picture or a video and 64 MB for a Windows
  metafile, packed or unpacked (left out, with a note), and 40 million pixels
  for a bitmap inside a metafile.

For scripts: `POST /api/import?path=<file on this machine>&name=<folder>` or a
multipart upload to the same endpoint.

## Presentation features without the editor

A deck can carry a small dependency-free runtime (`app/deck-runtime.js`, one
`<script id="deck-runtime">` before `</body>`), so the saved `.html` is all you
need on the day. It also works from `file://`. Keys in the deck:

| Key | Feature |
|---|---|
| A (in the saved deck) | Runs the deck by itself: each slide waits its **Advance after** seconds (panel, Runs by itself) (fragments first, a step at a time), then moves on; at the end it stops, or starts again with **Start again at the end**. Any key or click takes it back. A deck whose stage carries a wait starts by itself when it is opened on its own (a kiosk loop) |
| Presenter > Rehearse the timings... | Preview with the time on each slide taken; Esc stops it and writes the times into the slides as their **Advance after** seconds, one undo step. The presenter window shows the time on the current slide beside the total, red past the slide's own seconds |
| P, Shift+F5 | Presenter window: current and next slide, notes, timer, clock, fragment step. Arrows there move the deck too. |
| O | Overview: a grid of all slides, numbered and named; click one or move with the arrows and press Enter to jump; O or Esc closes |
| L | Laser pointer: the cursor becomes a bright dot with a glow; L or Esc turns it off |
| D | Draw on the slide: a layer over the slide, never saved. Keys 1-5 colours, `[` `]` thinner / thicker, Ctrl+Z undo, C clear this slide, D or Esc done. Strokes are kept per slide while the deck is open and follow a window resize |
| Space, Right, Down, PgDn | next fragment, then next slide |
| Left, Up, PgUp | previous fragment, then previous slide |
| H | Hide the on-screen controls (the chevrons and page number at the bottom), for when the mouse is needed where they sit; H again brings them back. Without it they fade out after 2 s without mouse movement and return on the first move |

- Decks created with **New** have it built in.
- For an existing deck: Presenter menu > **Add presentation features to this
  deck**, then save. An older presenter-only script is replaced by the same
  action ("Update ...").
- Deck generators can paste the script themselves. The deck must show slide n for
  `#n` in the URL and dispatch `deck:slide` or update the hash when it navigates
  (the template does; a MutationObserver on `.deck-stage` covers decks that do
  neither).

**Fragments** (reveal on click): elements with `data-fragment` are hidden until
revealed; `data-fragment-index="n"` sets the order (equal numbers reveal
together; without an index, document order). A fragment's entrance is its
animation preset (see Animations); a fragment without one fades in. Going back
to a slide shows all its fragments. In the editor: select the element(s) and
tick **Reveal on click** in the Animation section; fragments stay visible while
editing.

**Slide transitions**: `data-transition="fade|slide|up|zoom|none"` on a slide
(or, as the deck's default, on `.deck-stage`) animates the change of slide
when presenting: fade cross-fades, slide and up push the old slide out as the
new one comes in, zoom cross-zooms; `data-transition-duration="0.5"` sets the
seconds. Both slides take part (the runtime keeps the outgoing slide shown
while it leaves, whatever the deck's CSS does with inactive slides). In the
editor: the slide section of the properties panel has **Transition** for the
slide and **All slides**. A slide that auto-animates uses the morph instead.

**Text effects**: `data-text-effect="letters|words|typewriter"` on a text
element makes its text appear piece by piece when the slide shows (or when
the element is revealed as a fragment); `data-text-effect-speed="1.5"` makes
it faster. The runtime wraps the text in spans only while it plays, so the
file never carries them. In the editor: **Text effect** in the Animation
section (a deck reveal on the element is parked meanwhile, as with presets),
and **Play** replays it.

**Sections**: `data-section="Name"` on a slide starts a section. The slide
strip shows a heading with the count that folds and unfolds on click (the
editor only), the overview (O) shows the heading when presenting. In the
editor: the **Section** field in the slide section of the panel, or "Start a
section here..." on a thumbnail's menu.

**Auto-animate**: a slide with `data-auto-animate` morphs into the next slide:
elements present on both (matched by `data-id`, else by same tag + text or same
image `src`) move and resize into their new place; everything else fades in.
Two linked elements need not be the same thing: a shape (an `<svg>` of one
path, as Insert draws them) morphs outline to outline into another shape, a
box tweens its colour, corners, rotation and shadow into the other's (a
rectangle into an ellipse), and two that do not look alike (a text into a
picture, one word into another) cross-fade along the way.
In the editor: tick **Auto-animate to the next slide** in the slide section
(elements get `data-id` tags), then either duplicate the slide (Ctrl+D) and
rearrange the copy, or on the next slide select any element and choose what it
takes over from in **Morph from** (Animation section), which gives both the
same `data-id`. Every inserted element gets a `data-id` of its own (unique in
the deck; a copy on the same slide takes a fresh one, a copy on another slide
keeps it, which is the link). The list names elements as the user named them
(the field at the top of the panel, saved as `data-name`), else by what they
are and say, with the id after two that read the same.
`data-auto-animate-duration="0.8"` on either slide changes the timing.

The editor's own Presenter view (P or Shift+F5 inside the editor) is separate:
it follows unsaved edits and the editor's navigation, and steps through
fragments in Preview mode.

The conventions (`data-fragment`, `data-fragment-index`, `data-id`,
`data-auto-animate`, `aside.notes`) follow reveal.js on purpose, but the deck
does not use reveal.js: the fixed 1920x1080 stage with absolutely positioned
elements is what makes direct manipulation possible, and the small runtime keeps
the file self-contained and the DOM predictable for the round trip.

## Keyboard

| Keys | Action |
|---|---|
| Ctrl+O | Decks drawer. Tab reaches each deck (Enter opens it) and its Rename and Duplicate |
| Tab in the panels | Every control is reachable: the colour swatches (named by colour, "Ink 2 #3d3c3a"), the marks that put a field back to the deck's value, the section headings. A control reached with Tab keeps its keys: Enter and Space press it, arrows and Delete are not the canvas's. After a mouse click in a panel the canvas keys work as before |
| Ctrl+\ | Hide or show both side panels. The status bar has a button for each; drag a panel's inner edge to resize it, double-click the edge to reset. A narrow window starts with the panels hidden |
| Ctrl+T | Theme panel: the deck's variables, base text styles, custom CSS, saved themes |
| Ctrl+S | Save (keeps a backup, see below) |
| Ctrl+Shift+S | Save as: the deck with its unsaved edits under a new name or in another folder (Export menu too). The pictures, scripts, styles and fonts it uses are copied along, so the copy stands on its own; the editor then works on the copy and the original stays as last saved. A folder outside the current one becomes the current folder |
| Ctrl+P | Export as PDF (Export menu: also a single self-contained HTML file) |
| F5 / Esc | Preview the deck as-is / back to the editor |
| P, Shift+F5 | Presenter view in a second window (current and next slide, notes, timer); the same key in a saved deck on its own |
| ? | Keyboard help |
| Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z | Undo / redo (also with a text edit still open) |
| Ctrl++ / Ctrl+- / Ctrl+0, Ctrl+wheel | Zoom in / out / fit; Ctrl+wheel zooms around the pointer |
| Middle button, Space+drag, wheel | Grab and drag the view, pan, scroll the canvas when zoomed in |
| Wheel over a focused number field | Step the value (Shift: ten steps), in the panels |
| PgUp / PgDn, Home / End, arrows (nothing selected) | Change slide |
| Ctrl+M | New slide after the current one: the layout picker (Ctrl+Shift+M: a blank slide straight away) |
| Ctrl+D | Duplicate the selection, or the slide when nothing is selected |
| Ctrl+Up / Ctrl+Down | Move the slide up / down |
| Click, Shift+click, Ctrl+click | Select, add to the selection, select the exact element under the cursor (a plain drag then moves just that element, not its group) |
| Lock (panel, element menu) | A locked element (`data-locked`) is passed by when clicking and marquee-selecting and cannot be moved or resized: backgrounds and full-bleed pictures stay put. Ctrl+click still selects it (dotted box, no handles); Delete, the panel and Unlock work on it |
| Picture section (panel) | Alt text for a picture or video (`alt`) and an inline SVG such as an icon (`aria-label` with `role="img"`); empty for a decorative one. For pictures and videos also: **Replace...** (another file in the same box, size and look kept), **Fit** (stretch, fill the box cropping the edges, whole picture inside: `object-fit`) with a **Focus** grid for what stays in view (`object-position`), **Flip** left-right / top-bottom (the `scale` property) and a **Grayscale** slider (`filter`). **Crop...** and **Remove crop**: see the next row |
| Double-click or Enter on a picture, Crop | Crop mode: the whole picture shows dimmed round its box. Drag the picture to move it in the box, drag the white handles to change what shows (Shift on a corner keeps the box's proportions), drag the round corner handles or turn the wheel to zoom, arrows move it a pixel (Shift: ten). Enter, Esc or a click outside the picture ends it; the crop is one undo step, and leaving without a change leaves the picture as it was. A cropped picture is saved as a `<div data-crop>` box (`overflow: hidden`, the picture's place, size, classes, id and animation) holding the `<img>` placed in percentages, so resizing the box keeps the crop. **Remove crop** (panel, element menu) gives the whole picture back in the box's place and width. A rotated picture is straightened before cropping |
| Shrink to fit the box (Text section) | For a text with a width or height of its own: when it overflows, the font size steps down until it fits, and back up when there is room again; the size in the panel is the most it gets. Refitted after edits and resizes; saved as `data-fit="shrink"` with the fitted size inline, so the deck needs nothing to show it |
| Look > Rulers and guides | Rulers along the canvas in slide pixels, and the guides the deck keeps: drag one out of a ruler, drag it to move it, drag it off the slide (or double-click it) to remove it. Moving and resizing snap to them like to the smart guides. The guides live on the stage as `data-guides="x:960,y:540"`, so they are saved with the deck, travel with the file and are undone like any other change; the setting itself is the editor's, remembered per browser. The palette has "Guides at the selection (or the thirds)" and "Clear the guides" |
| Look > Hints under the fields | The one-line notes under the panel's fields, off by default: what a field does is on its tooltip either way, and the notes that report state (how many fragments, how far an element was moved, what a deck is missing) are shown whatever the setting. Remembered per browser, like the editor's look and the panel widths |
| Ctrl+K | The command palette: one search over the editor's actions (insert, arrange, save, export, present, view), the slides by name ("Go to slide 3 · bullets"), the built-in icons, every slide layout ("New slide: Quote"), every template ("New deck from the Swiss template..." opens New with it chosen), and "Font Awesome icon..." / "Change font..." which open those pickers with the words typed. Arrows choose, Enter runs, Esc closes |
| Ctrl+Alt+C / Ctrl+Alt+V, Copy style / Paste style (element menu) | The look of an element (colours, border, corners, shadow, opacity, type, padding, not its place or size) copied, then put on the selection: only what differs is written, inline, one undo step |
| Alt+drag | Duplicate what you drag and move the copy (one undo step); a selection when the press lands on it, else the element under the cursor. A copy of an element the deck lays out in flow is placed absolutely at the original's spot, so nothing else moves (Ctrl+D and paste do the same) |
| Ctrl while dragging | Disable snapping |
| Link section in the panel | A link on any element (a picture, an icon, a shape, a text box): a click opens it in a new tab when presenting. Saved as `data-href`, opened by the presentation features script; the PDF export carries it as a real link. Also "Link to..." on the right-click menu. Links inside text are set while editing the text |
| Drag on empty canvas | Marquee select |
| Drag, handles, top handle | Move, resize (Shift on a corner keeps the aspect ratio, Alt resizes about the centre, both together both; an element in the deck's own flow keeps its footprint, so its neighbours stay put), rotate (Shift: 15 degree steps) |
| Arrows, Shift+arrows | Nudge 1 px / 10 px |
| Tab / Shift+Tab | Next / previous sibling |
| X, Y in the panel | The element's position on the slide in stage px (top left corner). Typing a value moves it there; the hint says how far it is from where the deck lays it out, and the x next to the field puts it back |
| Align section in the panel | Align left / centre / right / top / middle / bottom, distribute horizontally / vertically (3+). Several elements align to their common box, or to the slide with the checkbox; one element aligns to the slide |
| Delete, Backspace | Delete the selection (undoable). "Hide" in the properties panel or the element menu keeps it in the file as `display:none` + `data-hidden`; "Unhide all" brings it back |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy / cut / paste, also across slides and between decks; pasting where the copy came from steps the copies aside. A paste with a panel field focused goes into that field. Images, videos and text copied elsewhere paste too: files go to `assets/`, an image URL becomes a picture, a YouTube or Vimeo link a player, other text a text box |
| Ctrl+G / Ctrl+Shift+G | Group the selection in one positioned box / ungroup a group; children keep their place on the slide |
| Ctrl+] / Ctrl+[ | Bring forward / send backward one step; with Shift, to the front / to the back. Free elements are reordered in the file; z-index is written only when a sibling already carries one |
| Right-click an element | Element menu: edit text, cut, copy, paste, duplicate, delete, hide, layer order, group, ungroup, select parent (on empty canvas: paste, unhide all, new slide) |
| Enter, double-click | Edit text in place; Esc when done. The bar over the text (and the keys) has bold, italic, underline (Ctrl+B / I / U), strikethrough (Ctrl+Shift+X), superscript (Ctrl+Shift+=), subscript (Ctrl+=), code, clear formatting, link, bullet list, numbered list and alignment; formatting is saved as plain `<sup>`, `<sub>`, `<strike>`, `<code>` tags. With part of the text selected, the panel changes that part only, as a `<span>` around it: the Colour section (a swatch, the picker, the hex field; none takes it off again) and the Text section's Font, Size, Weight, Style and Spacing, whose heading then reads "the selected words". The edit stays open, the x next to a field takes that property off the part, and a press in those sections keeps the selection even when the field takes the focus. A label inside an inline SVG (a scheme, an exported chart) opens a small box over it in the label's font: Enter adds a line, Esc finishes, the SVG follows as you type |
| Right-click a thumbnail | Slide menu: new slide after it, duplicate, delete, move, skip in presentation |
| Tab / Shift+Tab in a table cell | Next / previous cell; past the last cell a new row |
| Enter in a list item | The next item, carrying whatever followed the caret and the item's own classes and style; Backspace at the start of an item joins it to the one before. An empty item at the end is how a list is finished: it goes when the edit does |
| Tab / Shift+Tab in a list item | A sub-item (a nested list of the same kind) / back out again |
| List section in the panel | Shown for a list, an item in one, or a text box holding one: **Bulleted** or **Numbered** (the items move into a list of the other kind in one undo step, keeping their styles and their place), the **Marker** (disc, circle, square for bullets; 1. / 01. / a. / A. / i. / I. for numbers, or none) and, for a numbered list, the number it **starts at** (the `start` attribute, for a list carried on from another slide). A marker an imported list put on every item is taken off, so the choice shows |

## Deck file contract

The contract and the code every deck carries are also published on their own,
MIT licensed, in `diapo-format/` (see its README).

The editor works on decks built on a fixed-size stage (1920x1080 unless the deck
says otherwise, see "Slide size") that is scaled to the window with a CSS
transform. A deck is one `.html` file plus optional sibling files (`assets/`,
`*.js`, `*.css`) in the same folder, and its DOM contains:

```html
<div class="deck-viewport">
  <main class="deck-stage" id="deckStage">      <!-- 1920x1080, transform: translate() scale() -->
    <section class="slide active"> ... </section>  <!-- one per slide, .active = shown -->
    <section class="slide"> ... </section>
  </main>
</div>
```

Required:

- `.slide` elements are `position:absolute; inset:0`, the stage's size;
  visibility is switched with the `.active` / `.visible` classes, never
  `display:none`.
- The deck scales the stage itself with `transform: translate(...) scale(...)`
  on `.deck-stage` and recomputes it on `resize`. While a deck is open in the
  editor, the editor's own host CSS sets that transform (the iframe is exactly
  stage x zoom), so a deck whose script assumes another size still edits right.

### Slide size

The stage is 1920 x 1080 by default. **Theme > Slide size** offers 16:9, 16:10,
4:3, A4 landscape and portrait, square and 9:16 presets, or a custom width and
height (100 to 20000 px). The size is written into the override block as
`.deck-stage, .deck-stage .slide { width; height }`, so the deck itself carries
it; the editor reads the live stage's laid-out size on load, which means a deck
whose own CSS makes the stage another size is edited in its own pixels too.
Zoom, thumbnails, guides, the position fields, new slide layouts (stretched from
their 1920 x 1080 design) and the PDF page follow the size. Elements keep their
positions in px, so shrinking a deck with content clips whatever lies past the
new edge; move it back in. Changing the size also teaches the controller of
decks made from the editor's template to read the stage's size (their older
versions assumed 1920 x 1080); a deck with its own scaling script shows a hint
that it may present at the wrong proportions outside the editor.

Optional hooks, used when present and tolerated when absent:

- `[data-edit]` marks text the author intends to be editable (all headings,
  paragraphs, list items and text-bearing spans are editable anyway).
- `.reveal`, `.reveal-img`, `.reveal-right` elements animate in with `transform`;
  the deck's visible rule should read `translate(var(--dx, 0px), var(--dy, 0px))`.
  Moves of such elements are written as `--dx` / `--dy`, so the entrance animation
  still runs. The editor also detects any other element whose transform reads
  `--dx` / `--dy`. Elements without that rule get the CSS `translate` property,
  which composes with any transform the author set. Rotation uses `rotate`.
- `[data-fig]` hosts are rendered by the deck's own script. They are selected as a
  whole and can be moved and resized; on resize the editor calls
  `Plotly.relayout(host, {width, height})` when the host is a Plotly graph and
  dispatches a bubbling `deck:resize` event on the host in every case. On save the
  host is emptied and its attributes restored to what the file had (the class the
  deck stored in `data-ed-class`, or the file's own attributes).
- `figure[data-chart]` is a chart the editor made (see Charts): a drawn `<svg>`
  and its table in `<script type="application/json" data-chart-data>`. It is
  selected as a whole; the editor redraws the SVG from the table, and saves both.
  A figure with the table alone (a deck generator's) is drawn when the deck opens.
- `figure[data-math]` (LaTeX) and `figure[data-chem]` (SMILES) are an equation and a
  chemical structure the editor drew (see Equations and chemical structures): the
  source in the attribute and one drawn `<svg>` inside. Selected as a whole; a
  figure with the attribute alone is drawn when the deck opens.
- `[data-svg]` hosts inline an SVG file at load. On save the host goes back to its
  original `<img>` unless a shape inside it was edited (then the inlined SVG is kept).
- `svg.dots` and `[data-generated]` contents are regenerated at load; they are
  emptied on save unless edited. Any element with an `id` that was empty in the
  file but has content at save time is treated the same way.
- Body-level elements that scripts append at runtime (Plotly's tester SVG,
  tooltips) are not written back.
- The deck may dispatch `deck:slide` (detail = index) on navigation and listen for
  `deck:rescale`; it may honour `#n` in the URL to show slide n. The editor
  navigates by setting the hash first so the deck's own controller stays in sync,
  and falls back to toggling `.active` / `.visible` itself.
- The editor dispatches `deck:slides-changed` on the deck document after slides
  are added, removed or reordered. A deck that caches its slide list should
  re-read it then (the blank template reads it live).
- Speaker notes: `<aside class="notes" hidden>` inside a `.slide` (the reveal.js
  convention; the `hidden` attribute keeps it off the slide without any CSS), or
  an HTML comment right before the section. Both are read; the `<aside>` form is
  written. Notes are shown only in the presenter view. Comments that only name
  the slide (`=== SLIDE 3 ===`, `SLIDES 5-8 - Gates`) are ignored.
- Hidden elements carry `data-hidden`; slides skipped in the presentation carry
  `data-skip` (the deck's navigation may honour it). `data-href` on an element
  is a link the runtime opens on click (`data-href-target="_self"` for the
  same tab). `data-group` marks an
  element that is always selected as a whole (lists and tables the editor
  inserts carry it). `[data-placeholder="image"]` is an unfilled image box
  (inline `display:none`, shown by the editor only); `code[data-code]` is a
  code block the editor colours.

Everything the editor changes is stored as inline `style` attributes, edited text,
or added/removed elements. It never rewrites the deck's `<style>` or `<script>`
blocks; the `<head>` is written back verbatim from the original file, with two
exceptions: the Theme panel writes a single `<style id="deck-editor-overrides">`
block at the end of the head (see below), and fonts added in the editor go into
a `<style id="deck-editor-fonts">` block right before it (see Fonts). Both are
removed again when there is nothing left to write. Self-hosting fonts also
comments the deck's own Google Fonts `<link>` out (`<!--deck-editor:hosted ...-->`)
and restores it on "Use Google Fonts again".

## Look

**Look** in the status bar picks how the editor itself is drawn; the deck is
never affected. **Ink**, the default, frames the slide with dark top and
status bars and one indigo accent; **Dark** is the whole editor dark, panels
and canvas included, with the slide as the brightest thing on screen (native
controls and scrollbars follow); **Clean** is the light chrome; **Slate** is
slate chrome with teal for anything you can act on and orange only as the
"where you are" marker (current slide, unsaved changes, problems). The choice
is remembered per browser, like the side panels.

## The properties panel

The panel shows what fits the selection: a picture, a video or a plain shape
has no Text section, a list gets List, a table Table, a chart Chart. The
sections a slide tool keeps out of the way until asked (Runs by itself for a
slide; Box, Animation, Align, Position and Link for an element) start folded:
their heading opens and closes them and, folded, says in a few words what is
set ("820 × 396", "Fade up"). What is folded is remembered per browser. The
arrows by the element's name select what contains it and what is inside it.
New elements take their colours from the deck, checked against the slide they
land on: on a dark slide in a light deck they take the theme colour that reads
best there (at least 3:1), else white.

Everything answers the keyboard: the focus shows as a ring in the accent, and
the dialogs (keyboard help, versions, palette, pickers, the Decks
drawer) are announced as dialogs to screen readers.

## Problems

The status bar shows **N problems** when something in the open deck is wrong:
a picture, video, stylesheet or script that did not load (a missing file, a
wrong path), or an error thrown by the deck's own scripts after loading (a
chart that fails to render). Click it for the list; **Show** selects a missing
picture on its slide. The list is only a report: nothing is changed, and it
starts afresh when a deck is opened.

## Adding slides and content

**New slide** (the + above the slide strip, Ctrl+M, or "New slide after
this..." on a thumbnail) opens a picker of layouts: blank, title, section,
title and text, title and bullets, two columns, comparison, text and image,
image and caption, two images, quote, big number. A layout is a set of
positioned elements with inline styles in stage pixels, built from the deck's
own font and colours; headings keep their tags (h1, h2, p, ul) so the deck's
type styles apply, and get a stage-sized fallback only when the deck leaves
them at browser default size. The last layout used is preselected; Enter adds
it, Esc closes, Ctrl+Shift+M skips the picker and adds a blank slide.

Image placeholders in a layout are dashed boxes: double-click one (or "Choose
image..." in the properties panel) to pick a picture, which takes the box
(`object-fit: cover`). A placeholder that is never filled is not shown when
the deck is presented or printed: it is written with `display:none` and only
the editor shows it.

**Insert** (top bar) adds one element to the current slide, at the centre:

- Text: text box, bullet list, numbered list, table, code block.
  A list is edited as a whole (Enter makes a new item). A table is edited cell
  by cell: double-click the cell, Tab moves to the next one and adds a row
  after the last; the Table section of the properties panel adds or removes
  rows and columns. A code block keeps its text as plain text with inline
  colours for comments, strings, numbers and common keywords, re-coloured
  after each edit.
- Chart: column, bar, line, area, pie or doughnut, drawn by the editor from a
  table (see Charts below).
- Media: image from file or URL, image placeholder, video from file
  (mp4, webm, mov, uploaded to `assets/`) or URL, embedded web page
  (YouTube and Vimeo links become their players).
- Shapes: rectangle, rounded rectangle, ellipse, triangle, diamond, hexagon,
  star, block arrow, chevron, speech bubble, line, arrow, and a set of icons.
  Filled shapes take their colour from the Text colour field (they are
  `fill: currentColor`).
- **Font Awesome icons...**: about 2000 icons of Font Awesome Free (solid,
  regular and brands), searchable by name or keyword. An icon goes into the
  deck as an inline `<svg>` with a `currentColor` path (plus `data-fa` naming
  it and Font Awesome's attribution comment), so it needs no font, network or
  script, prints, scales like a shape and recolours through the Text colour
  field. The catalog the picker loads, `app/icons/fontawesome.json`, is built
  from the npm package by `node tools/build-fa.js`; the icons are CC BY 4.0.

Everything is a plain element with inline styles, so the saved deck needs
nothing from the editor to show it.

### Charts

Insert > Chart puts a column chart of sample figures on the slide; the Chart
section of the properties panel edits it:

- **Kind**: column, bar, line, area, pie, doughnut. A pie draws the first
  series, a slice per row.
- **The table**: a grid of cells, the series names across the top and the
  labels down the side. Type in a cell (Enter goes down, past the last row a
  new one), or paste cells copied from a spreadsheet into any cell: they fill
  the grid from there, adding rows and series as needed. A table pasted into
  the top-left cell replaces the chart's table, headings and all. Numbers can
  be written `1,200`, `1.200,5`, `12%` or `$3`; an empty cell is a gap.
  + Row, + Series, - Row, - Series grow and shrink it.
- **Colours**: every series takes the deck's colours in turn (its accents
  first, as `var(--accent)` and the like, so a theme change recolours the
  chart); a chip beside a series name picks that series, and a swatch gives
  it a colour of its own.
- **Options**: stacked (column, bar, area), legend, values on the chart, grid
  lines, and a unit written with every number (`$` before it, `%` or ` kg`
  after it).
- The chart's text is the element's own font, size and colour: the Text
  fields of the panel change it. A double-click on the chart goes to its
  table.

Every change is one undo step. The chart is saved as a
`<figure data-chart="column">` holding a plain inline `<svg>` sized to its box
and the table it was drawn from, as JSON in a
`<script type="application/json" data-chart-data>`. The deck needs no library
or script to show it (in the PDF and the single-file export too), and the
editor draws it again from the table whenever the box, the text size or the
font changes. A chart title is drawn across the top (the Title field). Charts
a deck renders with its own script (`[data-fig]`, below) stay the deck's.

### Equations and chemical structures

Insert > Equation puts `E = mc^2` on the slide; the Equation section of the
panel holds its LaTeX, drawn on the slide as you type (`x^2`, `rac{a}{b}`,
`\sqrt{x}`, `lpha`, matrices, `egin{aligned}`; reactions with mhchem,
`\ce{2H2 + O2 -> 2H2O}`). Ctrl+Enter or leaving the box makes it one undo step;
a mistake shows MathJax's message and the slide keeps the last drawing that
worked. The equation is sized by its font size (the Text size field, or a
corner handle) and coloured by its text colour. Buttons under the box put the LaTeX in
at the cursor (operators, fraction, powers and indices, roots, sums, integrals,
Greek letters, reaction arrows); with words selected they wrap them, so selecting
`a` and pressing the fraction gives `rac{a}{}` with the cursor in the second slot.
Look switches the maths font: Classic (the LaTeX look, MathJax 3) or STIX Two (the
look of journals, MathJax 4 with the STIX Two Math glyphs, run in a hidden frame of
its own); new equations take the look chosen last. A maths font is needed for the
symbols, so the Text section's Font field does not apply to equations.

Insert > Chemical structure puts aspirin on the slide; the Structure section
holds its SMILES (ChemDraw: Edit > Copy As > SMILES; Marvin and PubChem give it
too), drawn as you type, with the molecular formula under it. Aromatic rings
are drawn with alternating double bonds, as ChemDraw draws them ("Aromatic
rings as circles" for the other style), groups are drawn out, and atoms take
the usual colours (O red, N blue, S, P, halogens) unless "Atom colours" is off;
bonds and carbon take the text colour, atom labels the text font (the deck's, or the
Font field's). The structure scales into its box. Rotated,
its bonds turn and its atom labels stay level (each label is turned back about its
own centre, kept in the file as `data-upright` on the drawing).

Both are saved as a `<figure>` holding one plain inline `<svg>` (every glyph a
path: no font, no script, no library in the deck) with the source in
`data-math` or `data-chem`, so they show in the PDF, the single-file export and
any browser. The libraries that draw them (MathJax 3, SmilesDrawer 2, in
`app/vendor/`, see `tools/build-vendor.js`) load into the editor the first time
one is needed. A figure written with the source alone (by hand, by the
diapo-deck skill) is drawn when the deck opens; one whose source does not draw
is listed under Problems. A double-click on either goes to its source.

## Animations

The Animation section of the properties panel shows what an element has and lets
you change it:

- **Deck reveal**: elements animated by the deck's own CSS (classes such as
  `.reveal`, detected from rules under `.slide.visible`) show their **Reveal order**
  (`--i`), which you can edit.
- **Presets**: a grid of entrances (fade, fade up/down/left/right, zoom, zoom out,
  pop, bounce, drop, slide in X/Y, scale in X/Y, blur, twirl, flip, stomp) and
  loops (pulse, drift X/Y, spin, rotate, marked with an infinity sign), with
  duration (for a loop, **Cycle**: the seconds one cycle takes, lower is
  faster), delay and easing, and a Play button to replay the entrance. Anything
  else (direction, repeats, the keyframes themselves) is changed for one
  element in the Code section (below). Presets
  are pure CSS: the element gets `data-anim="name"` (plus `--anim-duration`,
  `--anim-delay`, `--anim-ease` inline when they differ from the preset's
  defaults), and the keyframes of every preset in use are written into the
  override block, so the saved file animates on its own when the slide becomes
  `.visible`. Keyframes only touch transform, opacity and filter; moves and
  rotation made in the editor use the `translate` / `rotate` properties, so they
  compose with the animation.
- Applying a preset to a deck-reveal element hands it over: the reveal class is
  parked in `data-anim-was` and the element's `--dx/--dy` move becomes
  `translate`. **None** gives the deck reveal back.

**Reveal on click** in the same section makes the element a fragment (see
Presentation features). **Text effect** in the same section makes the text
appear by letters, by words or as a typewriter (see Presentation features).

## The master layer (footer, page number, logo)

Elements that sit in the stage beside the slides (`.deck-stage > *` that is not
a `.slide`) show on every slide: a footer line, a page counter, a logo. The
editor treats them as the **master layer**: click one on the canvas to select
it, edit its text, move or restyle it, and every slide has the change (the
panel says "on every slide"). While editing, the editor makes them clickable
even when the deck's CSS gives them `pointer-events: none`; a large empty
layer (a decorative backdrop) never swallows clicks meant for the slide.

- **Insert > Footer on every slide** adds one to a deck that has none: a text
  and a page counter (`data-page-now` / `data-page-total`, kept in step by the
  editor, the template's controller and the presentation features script).
  New decks from the template start with such a footer.
- **Show the footer and page number on this slide** (the Slide section of the
  panel, shown when the deck has a master layer) lets a slide opt out: the
  slide gets `data-no-master`, and the override block carries the rule that
  hides the layer there, so it holds when presenting too (a deck whose own
  CSS already has a `[data-no-master]` rule, as the templates and the
  diapo-deck skill's decks do, keeps its rule and gets no copy).
- Thumbnails show the master layer with each slide's number; the PDF gets a
  copy of it on each page, as it looks on that slide (a deck that hides its
  own footer on the title slide keeps that in the PDF).

## Code (for the curious)

The last section of the properties panel, closed by default. Open, it shows
the selected element's markup (a field: change it and the element is replaced
by what is typed, one element with whatever is inside it, selected again; Esc
puts the markup back) and every rule of the deck's own CSS that styles
it, in sheet order (the later ones win), each marked when it applies only while
editing or only when presenting (a template's marquee keeps its animation for
the show: `html:not(.deck-editing) .marquee span { animation: ... }`), with
the `@keyframes` those rules use. Below it, **CSS for this element**, which
starts as the declarations those rules give the element, with the effects on
what is inside it as nested rules (`& span { animation: ... }`: a marquee's
scrolling sits on the span in the band) and the keyframes they use (dimmed
until edited, and nothing of the element's while left so): what is typed there goes on the
element (declarations, nested `&` rules), top-level @-rules (`@keyframes`,
`@media`) stand on their own, and it applies at once.
What the start leaves out: rules for the editor only, rules inside an `@media`
that does not apply (print), and what rules for a state set (`.slide.visible
.reveal { opacity: 1 }`): written on the element they would hold in every state
and its reveal would stop. Its `transition` is there, to change.
An element with an Animation preset gets the preset's rule in the list (marked
**the Animation section**) and, in the box, `animation: de-spin 6s linear 0s
infinite;` with the element's own values, and the preset's keyframes: change
the speed, `reverse` or `alternate` it, give it a count, or rewrite the
keyframes. Its animation declarations are written on the preset's selectors, so
the animation still waits for the slide to show or the fragment to be revealed;
once the box sets the animation, the Duration, Delay and easing fields no longer
change it (the Animation section says so).
Keyframes typed in the box are the element's own: they are written as
`name--<data-id>` and its animations renamed with them, so changing a copy of
`de-spin` or of a deck's keyframes changes that element and nothing else.
Saved as `data-css` on the element (so a copy of the element takes it along,
and undo takes it away) and written into the editor's style block on save,
scoped to `[data-id="..."]:not(#_)` (the `:not(#_)` counts as an id, so the
element's own CSS outranks the deck's class rules and the presets'; what the
panel sets inline still wins) and, unless **Plays while editing too** is on, to
`html:not(.deck-editing)` so the canvas stays still.

## Theme panel (master styling)

The Theme button (Ctrl+T) replaces the properties panel with the deck's base
styling, applied live to whatever slide is shown:

- **Variables**: every custom property the deck defines on `:root`, grouped into
  colours, fonts, sizes and other (a `var(--x)` counts as whatever it points
  at, so `--slide-bg: var(--paper)` is a colour). The deck's own value is the default; an
  override is highlighted and its "x" reverts it. **Add** under the colours
  creates a new variable (`--name`, from the name you type, or `--colour-N`)
  in the override block; it shows in the list marked as added, in every colour
  swatch row of the properties panel, and in saved themes. Its "x" removes it.
- **Base text styles**: font, size, weight, colour, line height and spacing for
  h1, h2, h3, p, li and the slide's default text, for decks whose CSS sets these
  directly. Written as `.deck-stage .slide h1 { ... }`, which outranks the usual
  deck rules without `!important`.
- **Motion**: the slide transition (the deck default, its duration, and Play to
  see it on the canvas) and the element reveal: duration, easing (named
  curves or a custom `cubic-bezier`), stagger (the step between `--i`
  values) and distance (how far elements travel), with Replay. These are the
  deck's `--dur`, `--ease-out`, `--stagger` and `--reveal-y` variables, kept
  out of the variable list. A deck made before the last two existed gets a
  small rule in the override block that makes its reveal read them (the panel
  says so); it goes away when both are cleared.
- **Custom CSS**: free text, applied live after a short pause.
- **Themes**: save the current overrides under a name, apply a saved theme to any
  deck that uses the same variable names (decks made from the same template),
  delete. Themes live in `~/.deck-editor.json`.

All of it is one override block, every change is an undo step, and a deck with no
overrides has no block. Deleting the block from a file by hand is safe: the deck
then uses its own styles again.

## Fonts

The Font field in the properties panel and every font field in the Theme panel
open the same picker: the fonts this deck already uses, then about 80 popular
Google Fonts families by category (each shown in its own face), then system
fonts. Typing a name that is not listed offers "Look up on Google Fonts": the
server asks Google which weights the family has, and it is added if it exists.

- Picking a Google family writes an `@import` for it into the
  `<style id="deck-editor-fonts">` block, with the weights the selection (or,
  for a theme-level change, the whole deck) uses. The Weight menu lists only the
  weights the family has; choosing one that is not loaded yet extends the
  import, and so does Italic. Nothing is requested twice: faces the deck's own
  `<link>` already loads are left alone.
- **Fonts in this deck** (Theme panel) lists every web font with its weights and
  where it comes from, and can make the deck independent of the network:
  - **Download into fonts/** fetches the woff2 files into a `fonts/` folder next
    to the deck and writes `@font-face` rules for them into the block (every
    subset Google offers, around 30 KB per file). Keep the folder with the deck.
  - **Embed in the file** writes the files into the HTML as data URIs (Latin and
    Greek subsets only), for a deck that travels as one file. Expect roughly
    100 KB per weight.
  - **Use Google Fonts again** drops the downloaded faces and restores the links.
  A family added after downloading loads from Google until you download again;
  the panel says so.
- **Add font files...** (picker or Theme panel) copies `.woff2`, `.woff`, `.ttf` or
  `.otf` files of your own into `fonts/` and reads the family, weight and style
  from the font itself (you can correct them before adding). They get their own
  `@font-face` rules in the same block, are embedded along with the rest by
  "Embed in the file", and are never touched by Download or "Use Google Fonts
  again". Check the licence of a font before sharing a deck that carries it.
- **Installed fonts...** (picker; Chrome only, it asks once for permission) lists
  the fonts on this computer. Picking one copies its regular, bold, italic and
  bold italic files into `fonts/` the same way, so the deck still works on a
  machine that does not have the font.

`app/templates/blank.html` is a complete reference deck that follows this contract;
"New" in the Decks drawer creates a deck from it, or from one of the templates below.

## Templates

New > Template offers, besides Blank, twenty-six of the editor's own designs and five
adapted from [beautiful-html-templates](https://github.com/zarazhangrui/beautiful-html-templates)
(MIT; the licence is in `app/templates/LICENSE-beautiful-html-templates.txt`).

The editor's own, each a nine- or ten-slide deck showing its layouts (cover, contents,
section, bullets, picture, numbers, quote, steps or a diagram, a table, closing)
with fonts and a palette chosen for the style:

| Template | Look | Type |
|---|---|---|
| Folio | Editorial spreads on ivory paper: hairline rules, oxblood numerals, a drop cap, a magazine contents page | Fraunces, Libre Franklin |
| Boardroom | Business deck in deep navy and white with one amber accent: KPI tiles, a CSS bar chart, a comparison table | DM Serif Display, DM Sans |
| Terrarium | Dark botanical: forest green, sage and blush, drawn rings, an arched picture plate | Cormorant Garamond, Karla |
| Console | Developer deck in an IDE dark theme: window chrome, syntax-coloured code, a diff, an architecture sketch, a status bar | JetBrains Mono, Manrope |
| Sorbet | Playful peach, mint and lavender on cream: big soft blobs, pill chips, cards with hard pastel shadows | Fredoka, Nunito |
| Blueprint | Engineering sheets on cyanotype blue: a line grid, dimension lines, dashed detail frames, a title block on every sheet | Archivo, Space Mono |
| Minimal | White space and one quiet grotesque at light weights: black on off-white, hairlines, a page number and nothing else | Hanken Grotesk |
| Bold | Enormous condensed capitals, black, warm white and one hot red; slides that are mostly one word, a ranking with meters | Anton, Public Sans |
| Clean Dark | Product-keynote look on charcoal: soft bordered panels, one ice-blue accent, glows, a feature grid, a roadmap | Sora, Figtree |
| Swiss | International Typographic Style: a visible twelve-column grid, flush-left grotesque, asymmetric blocks, black, white and red | Inter Tight |
| Academic | A conference talk on white: navy accent, numbered figures and tables, an equation slide, references, a running short title | Source Serif 4, Source Sans 3 |
| Pitch | The startup deck structure on warm neutrals with one coral accent: problem, solution, market circles, traction chart, competition matrix, team, the ask | Bricolage Grotesque, Albert Sans |
| Workshop | Teaching slides with room to draw on: timed exercises, a discussion question, group roles, a quiz with a click-reveal answer, a recap | Rubik |
| Portfolio | Photo-led slides on near-black with almost no chrome: full-bleed plates with a caption bar, a grid of six, before and after, a triptych, an index of plates | Instrument Serif, Instrument Sans |
| Report | A reading-first data deck: KPI rows, CSS bar and stacked-bar charts with annotations, dense tables, status pills, recommendations | IBM Plex Sans, IBM Plex Mono |
| Retro | A seventies poster: mustard, rust, teal and cream, arches and discs, a sunburst, stripes, a rainbow-road timeline | Bricolage Grotesque, Karla |
| Notebook | Paper and ink: a ruled page with a red margin and punched holes, handwriting, hand-drawn underlines, circles and arrows as inline SVG, sticky notes, a taped picture, a sketched flow | Caveat, Mulish |
| Deco | Art deco luxury: near-black with gold hairlines, a double frame, stepped section frames, a sunburst fan, chevrons and diamonds, a dinner-menu table | Cinzel, Cormorant Garamond |
| Brutalist | The raw-web look: 3px borders on everything, black offset shadows, one acid accent, blue underlined links, mono labels, marquee bands, a bordered status bar | Archivo Black, Space Grotesk, Space Mono |
| Broadsheet | A newspaper: masthead with a dateline, justified serif columns with drop caps, a photo slot with a caption, section pages, pull quotes, a stats box, listings | Playfair Display, Source Serif 4 |
| Aurora | The launch keynote: a dark base with one big blurred gradient wash per slide, glass panels with a light edge, gradient text, a glowing timeline | Outfit, Instrument Sans |
| Sunset | Warm and earthy: terracotta, sand, olive and clay, a low sun and hills as movable shapes, an arched picture plate, stepping stones | Fraunces, Nunito Sans |
| Nordic | Scandinavian light: linen and pale wood, muted sage, clay and fjord blue, generous space, thin rules, soft circles | Manrope |
| Neon | Sleek cyber dark: magenta and cyan glows on near-black, a perspective grid floor on the cover, outlined panels with a glow edge, glowing stat bars, scan lines | Chakra Petch, Barlow, Share Tech Mono |
| Comic | A storyboard: panels with thick black borders and offset shadows, speech bubbles, halftone dots, action bursts, a splash page, a dialogue slide with a click-reveal punchline | Bangers, Patrick Hand |
| Tomorrow | A creative resume: clusters of isometric cubes (three clip-path faces each, grouped so a cluster moves as one) and floating triangles in the corners, teal, slate and orange on light grey; contents, about with a portrait, an experience timeline, skill bars, education cards, a work slide, contact | Oswald, Lora |

They are written in `tools/templates-src/<slug>.html` with two markers, and
`py -3 tools/build-templates.py` splices in `blank.html`'s base CSS, controller
and runtime verbatim to produce `app/templates/<slug>.html`; run it after
changing the blank template's base block or scripts so the templates stay in
step. Everything else in them follows the deck file contract: theme variables
with the editor's names, type on the tags, `.reveal` entrances with `--i`,
fragments, notes, image placeholders, a master layer with the page counter,
`data-name` and `data-section` on the slides.

The adapted designs:

| Template | Look |
|---|---|
| Sakura Chroma | Vintage Japanese cassette-package aesthetic: cream paper, diagonal rainbow ribbons, condensed bold type |
| Neo-Grid Bold | Twelve-column card grid on grey with neon-yellow accents, black ink panels and mono tags |
| BlockFrame | Neobrutalist pastel-neon colour blocks, chunky black borders, hard shadows |
| Studio | Black canvas with electric-yellow type; high-voltage design studio |
| 8-Bit Orbit | Pixel-art neon arcade aesthetic on a deep navy void: scanlines, starfields, CRT glow |

Each adapted one is the source's full sample deck (8 to 12 slides showing its layouts:
cover, contents, statements, cards, charts, quotes, closing) rebuilt on this
editor's contract: the fixed 1920x1080 stage, `deck-base.css`, the controller
and the runtime, the deck's reveal classes on the text blocks, live page
counters, the editor's theme variable names next to the template's own (so the
Theme panel, swatches and "New slide" layouts work), and no script of the
source's left in. Opening and saving one without edits is byte-identical.

The conversion is a script, `tools/import-bht.js` (Node plus the project's
Playwright, for a DOM to work in): it resolves the source's viewport units and
`clamp()` maths at 1920x1080, drops its stage and navigation rules, renames the
wrappers and rewrites JS-driven decoration (8-Bit Orbit's stars, particles and
charts) as markup and CSS. `node tools/import-bht.js --fetch` downloads the
sources into `tools/bht-src/`; without `--fetch` it converts what is there.
Adding another template is one entry in its `TEMPLATES` table plus a line in
`app/templates/templates.json` and a preview in `app/templates/previews/`.

## Exporting

**PDF with notes (handout)** in the Export menu prints one page per slide with
the slide at 60% at the top and its speaker notes in the band under it ("Slide
3 of 12", the deck's own type, "No notes." when there are none); the page keeps
the slide's size, so it is the same shape as the plain PDF.

The Export menu (top bar) makes a copy of the deck as it is in the editor,
unsaved edits included; the deck file itself is not touched.

- **PDF... (Ctrl+P)**: one page per slide at the stage's size, in order, skipped slides
  left out, every reveal animation and fragment in its final state, charts
  rendered. It is printed by the Chrome or Edge installed on this computer
  (found automatically; set `DECK_EDITOR_CHROME` to a browser executable to
  use another). Without one, the browser's own print dialog opens on the same
  printable copy: choose "Save as PDF" there. Chrome and Edge need about a
  third of a second per slide. Things outside the slides (a deck's own page
  counter or footer on the stage) cannot be per page and are left out.
- **Single HTML file...**: everything the deck loads from its folder (scripts,
  stylesheets, images, videos, fonts, `data-svg` sources, `url()` references)
  is written into one `.html` as inline blocks and data URIs, and the Google
  Fonts it links are embedded too, so the file opens anywhere, offline,
  with no folder next to it. PDFs embed pictures at their full resolution, so
  a deck with many large photographs makes a large PDF. The reply names anything that could not be
  embedded (a missing file, an external URL, `srcset`), and the editor shows
  it in the toast. Count on roughly the size of the assets plus a third.

Both ask where to save with a normal dialog; the default is next to the deck
(`<deck name>.pdf`, `<deck name>-standalone.html`). For scripts and tests,
`POST /api/pdf?file=&to=` and `POST /api/export?file=&to=` take a bare file
name and skip the dialog.

## Saving, backups, drafts

- Ctrl+S writes the file in place. The previous version is kept in a
  `.deck-editor/` folder next to the deck (hidden on Windows) as
  `<name>.bak`, and older backups rotate through `<name>.~1.bak` ...
  `<name>.~10.bak` there (`--backups N` changes the count; `0` keeps none).
  The deck folder itself holds only the deck and its assets, so it can live in
  git or a synced folder without noise: add `.deck-editor/` to `.gitignore`.
  Backups and drafts that an earlier version wrote next to the deck are moved
  into the folder on the next save.
- A deck carrying an older edition of the presentation features script gets a
  bar across the top when it is opened: **Update them** writes the editor's
  current script in (undoable, saved with the next save), **Not now** puts it
  away until the deck is opened again. Saving a deck updates an older script
  by itself, so decks keep up with the editor without being asked; the
  Presenter menu has the same action for a deck that never had the script.
- **Export > Previous versions...** lists those backups, newest first, each
  with its time, title and slide count. **Open a copy** puts the version
  beside the deck as `<name> (<date> <time>).html` and opens it; **Restore**
  makes it the deck again (the current file becomes the newest previous
  version, so a restore can be undone the same way).
- Save does not write over changes made elsewhere. A deck comes with a version
  (`X-Diapo-Version`, a hash of the file) and every save sends it back; when
  another program, the diapo-deck skill or a second window has saved the
  file since, the server answers `409` and a bar asks: **Save over it** (what
  was on disk becomes the newest previous version), **Save mine as a copy...**,
  **Open the file on disk** (drops the edits here), or **Not now**. The edits
  stay in the editor and its draft meanwhile.
- Rename, Duplicate and the exports take a file name, not a path: a name with
  a slash, a colon (`C:notes` is a file in drive C's current folder on
  Windows, not in the deck's) or a control character is refused, and so are
  the names Windows keeps for devices (`CON`, `NUL`, `COM1`...). Save as takes
  a name or a full path, never a drive without one.
- The server refuses to write a file outside the workspace, or a body that does not
  contain `deck-stage`. Writes go through a temporary file, so a crash cannot leave
  a truncated deck.
- Unsaved edits are autosaved after a short pause to
  `.deck-editor/<name>.~draft`. When the deck is opened again the editor offers
  to restore or discard the draft; saving removes it, and so does undoing back
  to the saved state. (The draft is a complete deck file, so structural edits
  such as added slides survive too.)
- **Rename** (Decks drawer) takes the deck's history along: its previous
  versions and draft in `.deck-editor/`, its trust (scripts in decks) and its
  place in Recent. A change of case only works too.
- **Duplicate** (Decks drawer) copies the HTML file only; the copy shares
  `assets/` and `fonts/` with the original, so a picture replaced in one shows
  in both. **Save as** (Ctrl+Shift+S) is the way to make an independent copy:
  it writes the live deck under a new name or folder and copies the local
  files it references (`src`, `href`, `url()`, `data-svg` below the deck
  folder); files it cannot find are listed in the toast.
- Uploaded images go to `<deck folder>/assets/`; an existing file is never
  overwritten (a numeric suffix is added). Only image, video and audio files are
  accepted (png, jpg, gif, webp, avif, bmp, svg, mp4, webm, mov, mp3, m4a, wav,
  ogg), under a plain file name.

## The settings file

`~/.deck-editor.json` holds the last workspace, the recent decks, the trusted
decks and the saved themes. It is never half-written: each change goes to a
temporary file that then takes its place, one at a time. A file that is not
valid JSON is moved aside as `.deck-editor.json.broken-<time>`, and one that
cannot be opened at start is left alone for that session rather than
replaced; both are noted in `~/.deck-editor.log` or the console.

## Who can talk to the server

The server listens on 127.0.0.1 only, but other web pages open in the same
browser could still send it requests. So:

- Every request must be addressed to this server (`Host: 127.0.0.1:<port>`,
  `localhost:<port>` or `[::1]:<port>`). A page that reaches the server through
  DNS rebinding names another host and is refused.
- Every request that changes something (save, upload, new, rename, workspace,
  dialogs, themes, fonts, drafts) must come from the editor's own origin. The
  browser states the origin of such requests in `Origin` and `Sec-Fetch-Site`;
  a request from another site, or from a sandboxed frame, gets `403`.
- Reads too come only from the editor itself or a window opened on it: a
  request whose `Sec-Fetch-Site` says another site or another origin (another
  port on this machine included) gets `403`. Otherwise a page elsewhere could
  load a deck's `data.js` as a script of its own and read what it defines.
- Requests with neither header are not from a browser (curl, scripts, the
  tests) and are allowed: a local process already has the disk.
- Every file is served with `frame-ancestors 'self'` (and `X-Frame-Options:
  SAMEORIGIN`): only the editor may show its pages and the decks in a frame,
  so a page elsewhere cannot lay the editor under a picture of its own and
  steer a click (on "Trust this deck", say).

Nothing else is needed on the user's side, and a refused request never leaves a
half-written file.

## Scripts in decks

The editor reaches into the deck's page, so the deck is served from the
editor's own origin, and a script in a deck would pass every check above: it
could switch the folder, read any file on the computer and write anywhere.
So a deck's own scripts are paused until the user trusts the deck:

- Every file under `/deck/` is served with a Content-Security-Policy. A page
  may run only Diapo's own scripts (the controller and the presentation
  features every template carries, the print helpers), recognised by the
  SHA-256 of their text: the current editions, hashed by the server at start,
  and every earlier one in `app/known-scripts.json`, made from the git history
  by `py -3 tools/build-known-scripts.py` (`tools/release.py` runs it). An edition
  pasted in with other blank lines round it counts too. Everything else stays
  off: other inline scripts, script files, inline event handlers, `javascript:`
  links, form posts. Any other file a frame could show as a document (an SVG)
  runs no script at all.
- A deck with scripts of its own (a chart library, a generator) opens with a
  bar that says so: **Trust this deck** opens it again with them running,
  **Keep paused** leaves it as it is (the deck still edits and presents; what
  its scripts draw is missing). The palette has "Trust this deck" and "Pause
  this deck's own scripts". Trust is kept per deck in `~/.deck-editor.json`,
  with a fingerprint of those scripts: a deck whose scripts change is paused
  again. Inline scripts and script files on this computer count by their text
  (a library next to the deck that changes pauses it); a script from the
  internet counts by its address only, and the bar says that its contents can
  change without Diapo noticing. Files that a script loads by itself (an
  `import`, a script it adds) are not checked.
- The editor's own pages get a policy too (their script files and Diapo's
  known scripts only), so deck text that reaches the editor as HTML cannot run
  there. Thumbnails are sandboxed frames (no scripts). The printable copy of a
  paused deck carries the same policy in its head, since the PDF is printed
  from a file on disk; the browser's print dialog (the fallback without Chrome
  or Edge) prints a trusted deck without its own scripts.

## Files

```
deck-editor/
  serve.py            static server + JSON API
  Start Diapo.bat     Windows launcher
  app/
    index.html        the editor shell (look.js sets the Look before the first paint)
    presenter.html    the presenter window, and presenter.js its script
    print/            prep.js and keeper.js, the two scripts of the printable copy (PDF)
    known-scripts.json  hashes of earlier editions of Diapo's scripts (see Scripts in decks)
    brand/            the logo: mark.svg (favicon, no word), logo.svg (the mount with DIAPO, outlined), loader.svg (the loading mark, animated), Anton, its face; icon.ico for the exe and icon-256/512.png for the page and its manifest
    editor.css
    editor.js         boot, layout, drawer, keyboard map
    core/
      api.js          the only module that talks to serve.py
      document.js     deck loading, slide model, navigation, serialisation
      history.js      undo/redo command stack
      dom.js          how deck elements are classified
      selection.js    hit testing, selection, drag / resize / rotate, guides
      transform.js    move / size / rotate primitives, snapping maths
      inspector.js    properties panel
      textedit.js     in-place text editing and the formatting bar
      slides.js       slide strip, thumbnails, slide operations
      insert.js       new elements
      chart.js        charts: the drawing from a table, the panel's Chart section
      crop.js         cropping a picture by hand (the data-crop box, crop mode)
      fonts.js        the font block, Google Fonts URLs, self-hosting, the picker
      export.js       the printable copy, PDF, single-file export
      layouts.js      slide layouts and their picker sketches
      previews.js     what a deck is called, and the picture of its first slide in the Decks drawer
      editops.js      copy / cut / paste, delete, layer order, group / ungroup
      loader.js       the loading mark: the mount turning until it is upright (brand/loader.svg)
  import_deck.py      Markdown -> deck, the deck builder, the .pptx dispatch (used by serve.py)
  pptx_import.py      PowerPoint -> deck: theme, masters and layouts, text inheritance, shapes, pictures, tables, SmartArt
  pptx_chart.py       PowerPoint charts -> inline SVG
  start-diapo.sh, Start Diapo.command   Linux / macOS launchers
  build-exe.py        PyInstaller build of a single-file executable
      font-catalog.js popular Google families with their weights
      icons.js        the Font Awesome icon picker
    icons/fontawesome.json  the icon catalog (built by tools/build-fa.js)
    templates/      blank.html, the templates, templates.json, previews/
  tests/              Playwright acceptance tests (see below)
  tools/              templates-src/ + build-templates.py (the editor's own templates),
                      build-format.py (diapo-format/ and the skill's runtime),
                      build-known-scripts.py (app/known-scripts.json, from the git history),
                      pptx-corpus.ps1 + pptx-corpus-charts.py (a PowerPoint import corpus made with
                      PowerPoint itself, one deck per built-in theme, with reference renders) and
                      pptx-compare.js (imports it and writes side-by-side comparison images),
                      import-bht.js (templates from beautiful-html-templates),
                      build-fa.js (the Font Awesome catalog), shots.js,
                      release.py (check the repository, or make a release: RELEASING.md)
```

## Tests

The installed-fonts test (`tests/fonts-local.spec.js`) needs a visible Chrome and
Windows fonts, so it only runs with `DECK_LOCAL_FONTS=1` set.

```
npm install            (once; installs @playwright/test only)
npm test               (the installed Chrome)
npm run test:firefox   (the same specs in Firefox; once before:
                        npx playwright install firefox)
npm run test:py        (the Python tests: pptx_chart.py, pptx_import.py, emf_svg.py,
                        which files a Markdown import may copy, and the
                        settings file written whole or not at all)
```

The tests start `serve.py` on a throw-away workspace made from
`tests/fixtures/sample-deck`, a small deck that exercises every hook of the
contract, and run the acceptance checks of the brief with the installed Chrome. The
specs are split by area (`acceptance`, `editing`, `theme`, `presenting`,
`files`), sharing the fixture and canvas helpers in `tests/helpers.js`; tests
keep their numbers and titles, so `npx playwright test -g "62 deck scripts"` runs
one (in both browsers; add `--project=chrome` or `--project=firefox` for one).

Firefox runs every spec but the installed-fonts one (a Chrome feature). Playwright's
Firefox puts a synthetic mouse event up to about a pixel from where it was asked to,
so checks of a dragged distance use `near()` with `slack()` from the helpers, which
is 0 in Chrome. Firefox also writes `style` before other attributes of a new
element and short forms of some CSS; checks of saved markup accept both.

## Not yet

Every P0, P1 and P2 item of the brief is built. Ideas beyond it live in the
changelog's next version when they come.

## Licence

Diapo is open source under the MIT licence: see `LICENSE` in the repository
root. The decks it saves are the user's. What every deck carries from the editor, the base
styles, the controller and the runtime, is the **Diapo Format**, published
under the MIT licence in `diapo-format/` (built from `blank.html` and
`app/deck-runtime.js` by `tools/build-format.py`), so a deck is free to share,
sell and modify; template material inside a deck is granted the same freedom
by the licence. The `diapo-deck` skill (`skills/diapo-deck/`) is MIT too.
What the editor includes from other authors (five templates
and the skill's style material by Zara Zhang, MIT; Font Awesome Free icons,
CC BY 4.0; Python, Tcl/Tk and the PyInstaller bootloader in the executable)
is listed with the licences in `THIRD-PARTY-NOTICES.md`.
