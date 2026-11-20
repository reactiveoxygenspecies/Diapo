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

**File dialogs**: Open a file, Change folder, Import and the export locations use
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

**The welcome screen** is the home while no deck is open (at the first start,
and after the last tab closes); the Decks drawer stays closed over it. It has
**New deck...**, **Open...** (a file anywhere), **Import...** and **Try the
sample deck**, the folder your decks are in by its name (the whole path on
hover) with **Change folder...**, the recent decks, and the folder's newest
decks that Recent does not show, each a card with the picture of its first
slide; **All N decks in this folder...** opens the drawer.

**The File menu** (top left) holds the rest: **New deck...**, **Open...**
(Ctrl+O: the Decks drawer), **Open a file...**, **Import...**, **Save**,
**Save as...**, **Previous versions...**, **Rename...** and **Duplicate...**
(the open deck), and **Change folder...**, with the folder's name at its foot.

The Decks drawer (Ctrl+O, File > Open...) is the deck list while you work:

- **Open a file...** shows a normal file dialog; pick any `.html` deck on this
  computer. Its folder becomes the current folder.
- **Change folder...** shows a folder dialog; every `*.html` in that folder and its
  subfolders is listed (`node_modules`, `.git`, dot-folders and this tool's own
  folder are skipped). The folder shows by its name; the whole path is its
  tooltip. Where no dialog exists the path is typed instead.
- **Recent** lists the decks you opened last, wherever they are; one click reopens
  them. Every deck in the drawer goes by its name (its `<title>`, else its
  folder), with a picture of its first slide (the deck's own CSS, no scripts;
  a single-file export over 3 MB gets none; a recent deck in another folder is
  read through `/recent/<key>/`, which serves only that deck's own folder,
  read-only and with no scripts) and, under it, where it is, when
  it changed and its size; the folder list shows the most recently changed
  first. The title bar names the open deck the same way, with the whole path
  on hover. The last folder and the recent decks are remembered in
  `~/.deck-editor.json`, so the next start lands where you left off.
- **New deck...** opens the gallery of designs, a large dialog: Blank first,
  then the designs listed under Templates below as big cards with their title
  slide, filtered by background (**All**, **Light**, **Dark**) and by style
  (**Formal**, **Elegant**, **Technical**, **Playful**, **Minimal**, **Bold**:
  the `tone` and `style` of each entry in `app/templates/templates.json`).
  Blank is never filtered away. The chosen design is shown larger beside the
  grid with its slide count, its description and four more of its slides
  (drawn from the template itself, like the drawer's pictures). Arrows move
  through the cards (Up and Down by a row), Enter goes to the name, Enter
  there creates; Esc closes. It creates `<name>/index.html` inside the current
  folder, with the name as the deck's title (`my-talk` is "My talk"). Ctrl+K
  "New deck from the ... template" opens it with that design chosen.
- **Import...** makes a deck from a Markdown or PowerPoint file (see Importing).
- **Try the sample deck** (welcome screen, Ctrl+K) opens a tour of the editor in Diapo's own design, in three
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

**Import...** (File menu, welcome screen, Decks drawer) picks a `.md` or `.pptx` file on this
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
  area; scatter, with its points, lines, markers, trend lines, Y error bars
  given point by point or as one size, and both axes' titles, ranges, steps
  and log scales; a series whose X differ from the first's adds rows of its
  own) are drawn as SVG with their title, legend, axes and data labels, and
  come over as editable charts: the Chart section of the panel shows their
  figures, series colours, title and options (a percent format's fractions
  as percentages, a currency sign as the unit). PowerPoint's drawing stays
  until the chart is changed; the editor then draws it from the figures.
  SmartArt comes over as the shapes PowerPoint saves beside it. Speaker
  notes, hyperlinks and hidden slides (`data-skip`) are kept. Not carried
  over: effects beyond a simple shadow, 3-D, WordArt fills, animations and
  transitions, video and audio (the poster picture stays), embedded objects
  and radar, bubble or surface charts (a note says so).
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
| O | Overview: a grid of all slides, numbered and named; click one or move with the arrows and press Enter to jump; O or Esc closes. Its field (/ or a click) finds, as below |
| Ctrl+Shift+F, Ctrl+K, / | Find a slide: the overview opens with its field focused, and typing keeps the slides that match, in the deck's order, with the words marked and a line of text round them. A slide matches when it has every word typed, without regard to case or accents, in its heading or name (`data-name`), its text, a picture's `alt` or `aria-label`, a chart's title (`data-chart-data`, a Plotly figure's `layout.title`), an equation's LaTeX (`data-math`, not its drawing) or its section's name (`data-section`, up to the next one). The notes are never searched on the deck, which the class sees; a skipped slide (`data-skip`) is left out. A number also picks that slide. The highlight starts on the best match (the slide of that number, else the first whose title has the words); arrows move it, Enter or a click goes there, Esc closes. Picked by its words, the slide shows its steps up to the element that matched (the innermost one with all the words, widened from a word to its line) and that element is outlined for about 2 s (`.deck-found`, outside the stage, never saved). Inside a frame (the editor's Preview) only / finds: the Ctrl keys stay the editor's |
| 12, Enter | Go to slide 12: the number shows at the bottom while it is typed (`.deck-num`); Backspace takes a digit back, Esc or 3 s without a key forget it. Not while drawing (1-5 are the colours) |
| Find, in a presenter window | The runtime's presenter window and the editor's (`presenter.js`) have a Find button (and Ctrl+Shift+F, Ctrl+K, /): a list of the slides that match, titles first, which also searches the notes ("In the notes"), since only the presenter sees it. Empty, it lists every slide by title. Enter or a click moves the deck: in the editor through the presenter channel (`{type: 'find'}`), which in Preview reveals and outlines as above and while editing just goes to the slide. The list is the runtime's (`deckRuntime.openFinder(doc, {notes, pick})`), borrowed from the deck in the editor's "current" frame, so a deck without runtime 15 says to add or update the presentation features. A number and Enter work there too |
| L | Laser pointer: the cursor becomes a bright dot with a glow; L or Esc turns it off |
| D | Draw on the slide: a layer over the slide, never saved. Keys 1-5 colours, `[` `]` thinner / thicker, Ctrl+Z undo, C clear this slide, D or Esc done. Strokes are kept per slide while the deck is open and follow a window resize |
| Space, Right, Down, PgDn | next fragment, then next slide |
| Left, Up, PgUp | previous fragment, then previous slide |
| ? (or Shift+/ on the / key) | A list of these keys over the deck, grouped Move / Show / Draw, in plain words and large type (a `role="dialog"` panel; the runtime builds it, `.deck-keys`, outside the stage). Esc, ? or a click closes it; it opens over draw mode and Esc closes it before it ends the drawing. It is never saved (the editor keeps only the body the file had), printed, exported or drawn in thumbnails. A saved deck opened on its own (not in a frame: neither the editor's Preview nor a presenter preview) also shows "Press ? for keys" for about 4 s, once per page load; Preview's header says "? for keys" instead. The editor's presenter window (`presenter.js`) and the runtime's own presenter window answer ? with the keys they have (arrows, Home / End, a number, Find). Shift+/ counts as ? only on the / key itself (`code` Slash): on a keyboard where / is typed with Shift (Shift+7, Italian or German), / finds |
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
| Ctrl+O | Decks drawer (File > Open...). Tab reaches each deck (Enter opens it) and its Rename and Duplicate |
| Tab in the panels | Every control is reachable: the colour swatches (named by colour, "Text 2 #3d3c3a"; one swatch per colour, so two variables with the same value share one named for both, "Background and Slide background #ffffff"), the marks that put a field back to the deck's value, the section headings. A control reached with Tab keeps its keys: Enter and Space press it, arrows and Delete are not the canvas's. After a mouse click in a panel the canvas keys work as before |
| Ctrl+\ | Hide or show both side panels. The status bar has a button for each; drag a panel's inner edge to resize it, double-click the edge to reset. A narrow window starts with the panels hidden |
| Ctrl+T | Theme panel: the deck's variables, base text styles, custom CSS, saved themes |
| Ctrl+S | Save (keeps a backup, see below) |
| Ctrl+Shift+S | Save as: the deck with its unsaved edits under a new name or in another folder (File menu too). The pictures, scripts, styles and fonts it uses are copied along, so the copy stands on its own; the editor then works on the copy and the original stays as last saved. A folder outside the current one becomes the current folder |
| Ctrl+P | Export as PDF (Export menu: also PDF with notes, a single self-contained HTML file, PowerPoint) |
| F5 / Esc | Preview the deck as-is / back to the editor |
| P, Shift+F5 | Presenter view in a second window (current and next slide, notes, timer); the same key in a saved deck on its own |
| ? | Keyboard help; its second tab, About Diapo, shows the version and checks for updates (see Checking for updates) |
| Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z | Undo / redo (also with a text edit still open) |
| Ctrl++ / Ctrl+- / Ctrl+0, Ctrl+wheel | Zoom in / out / fit; Ctrl+wheel zooms around the pointer |
| Middle button, Space+drag, wheel | Grab and drag the view, pan, scroll the canvas when zoomed in |
| Wheel over a focused number field | Step the value (Shift: ten steps), in the panels |
| PgUp / PgDn, Home / End, arrows (nothing selected) | Change slide |
| Ctrl+M | New slide after the current one: the layout picker (Ctrl+Shift+M: a blank slide straight away) |
| Ctrl+D | Duplicate the selection, or the slide when nothing is selected |
| Ctrl+Up / Ctrl+Down | Move the picked slides (the current one without a pick) up / down, one undo step, as PowerPoint does: each picked slide passes its unpicked neighbour, a run of picked slides moves as a block, nothing goes past the deck's ends |
| Ctrl+click / Shift+click a thumbnail | Pick several slides (toggle / the run from the current slide). Shift+Up / Shift+Down (strip last clicked) grow or shrink the pick by one slide; Esc clears it. The pick survives moves, undo and redo |
| Drag a thumbnail | Reorder. Dragging a picked slide drags all the picked ones (a badge says how many); they land together, in deck order, as a block where the line shows, even if they were scattered; one undo step. Over a section heading's lower half or just under it, they go into that section, first (the first of them takes over the section's name); over its upper half, before it, at the end of the section above. Near the strip's top or bottom edge the strip scrolls. Only the moved thumbnails reload |
| Thumbnail menu: Move up / down / to top / to bottom / to... | The same moves for the picked slides ("Move 3 slides up"). **Move to...** takes a slide number (where the first of them lands, the others follow) or a section (they go to its end). Also in Ctrl+K: "Move 3 slides to..." ("move to 5" goes straight there), up, down, and to each section |
| Delete / Backspace, Ctrl+C / X / V (slide strip last clicked, nothing picked on the canvas) | Delete, copy, cut, paste the picked slides (the current one without a pick), one undo step; a paste lands after them and works between decks (pictures are uploaded into the target deck's `assets/`) |
| Click, Shift+click, Ctrl+click | Select, add to the selection, select the exact element under the cursor (a plain drag then moves just that element, not its group) |
| Lock (panel, element menu) | A locked element (`data-locked`) is passed by when clicking and marquee-selecting and cannot be moved or resized: backgrounds and full-bleed pictures stay put. Ctrl+click still selects it (dotted box, no handles); Delete, the panel and Unlock work on it |
| Picture section (panel) | Alt text for a picture or video (`alt`) and an inline SVG such as an icon (`aria-label` with `role="img"`); empty for a decorative one. For pictures and videos also: **Replace...** (another file in the same box, size and look kept), **Fit** (stretch, fill the box cropping the edges, whole picture inside: `object-fit`) with a **Focus** grid for what stays in view (`object-position`), **Flip** left-right / top-bottom (the `scale` property) and a **Grayscale** slider (`filter`). **Crop...** and **Remove crop**: see the next row |
| Double-click or Enter on a picture, Crop | Crop mode: the whole picture shows dimmed round its box. Drag the picture to move it in the box, drag the white handles to change what shows (Shift on a corner keeps the box's proportions), drag the round corner handles or turn the wheel to zoom, arrows move it a pixel (Shift: ten). Enter, Esc or a click outside the picture ends it; the crop is one undo step, and leaving without a change leaves the picture as it was. A cropped picture is saved as a `<div data-crop>` box (`overflow: hidden`, the picture's place, size, classes, id and animation) holding the `<img>` placed in percentages, so resizing the box keeps the crop. **Remove crop** (panel, element menu) gives the whole picture back in the box's place and width. A rotated picture is straightened before cropping |
| Shrink to fit the box (Text section) | For a text with a width or height of its own: when it overflows, the font size steps down until it fits, and back up when there is room again; the size in the panel is the most it gets. Refitted after edits and resizes; saved as `data-fit="shrink"` with the fitted size inline, so the deck needs nothing to show it |
| Look > Rulers and guides | Rulers along the canvas in slide pixels, and the guides the deck keeps: drag one out of a ruler, drag it to move it, drag it off the slide (or double-click it) to remove it. Moving and resizing snap to them like to the smart guides. The guides live on the stage as `data-guides="x:960,y:540"`, so they are saved with the deck, travel with the file and are undone like any other change; the setting itself is the editor's, remembered per browser. The palette has "Guides at the selection (or the thirds)" and "Clear the guides" |
| Look > Hints under the fields | The one-line notes under the panel's fields, off by default: what a field does is on its tooltip either way, and the notes that report state (how many fragments, how far an element was moved, what a deck is missing) are shown whatever the setting. Remembered per browser, like the editor's look and the panel widths |
| Ctrl+K | The command palette: one search over the editor's actions (insert, arrange, save, export, present, view), the slides by name ("Go to slide 3 · bullets"), the built-in icons, every slide layout ("New slide: Quote"), every template ("New deck from the Swiss template..." opens New with it chosen), and "Font Awesome icon..." / "Change font..." which open those pickers with the words typed. Arrows choose, Enter runs, Esc closes |
| Ctrl+F / Ctrl+H, Find... / Replace... (palette) | Find and replace across the whole deck (the browser's own find does not see into the deck); in a panel field the keys stay the browser's. The bar has the find field, **Match case**, **Whole word**, **Include speaker notes**, a count ("3 of 12"), Next / Previous (Enter / Shift+Enter, or the arrows) and, with Ctrl+H, the Replace with field and Replace / Replace all (Enter in that field replaces). Every slide is searched, skipped ones too, and the master layer (the footer); text, lists, tables, shapes with text (SVG labels) and, if asked, the notes, but not chart data, equations, structures or code blocks. A match is found across formatting ("Hello **world**"). Going to a match opens its slide, selects its element (a hidden element or a note is not selected; the bar says so) and marks the match: with the CSS Custom Highlight API where the browser has it (`::highlight` rules in the editor's host style, removed on save), else boxes drawn over the stage in the editor's own layer, so a highlight is never in the saved file. Replace and Replace all edit text nodes only, so bold, links and sub / sup survive, and go through the undo history as the text editor does (the element's innerHTML before / after); Replace all is one undo step. **A match that runs across two formatting runs ("Thi" + bold "rd") is skipped, not replaced** (joining the runs would drop one of the two formattings): Replace all counts it ("skipped 1") and it stays in the list for a hand edit. Esc closes the bar, clears the highlight and gives back the selection the user had |
| Ctrl+Alt+C / Ctrl+Alt+V, Copy style / Paste style (element menu) | The look of an element (colours, border, corners, shadow, opacity, type, padding, not its place or size) copied, then put on the selection: only what differs is written, inline, one undo step |
| Alt+drag | Duplicate what you drag and move the copy (one undo step); a selection when the press lands on it, else the element under the cursor. A copy of an element the deck lays out in flow is placed absolutely at the original's spot, so nothing else moves (Ctrl+D and paste do the same) |
| Ctrl while dragging | Disable snapping |
| Link section in the panel | A link on any element (a picture, an icon, a shape, a text box): a click opens it in a new tab when presenting. Saved as `data-href`, opened by the presentation features script; the PDF export carries it as a real link. Also "Link to..." on the right-click menu. Links inside text are set while editing the text |
| Drag on empty canvas | Marquee select |
| Drag, handles, top handle | Move, resize (Shift on a corner keeps the aspect ratio, Alt resizes about the centre, both together both; an element in the deck's own flow keeps its footprint, so its neighbours stay put), rotate (Shift: 15 degree steps) |
| Arrows, Shift+arrows | Nudge 1 px / 10 px |
| Insert > Line, Arrow, Curved arrow, Double arrow | Drag on the slide to draw (Shift: 15 degree steps; a click places a default one; Esc cancels). A line is one inline `<svg data-line="x1 y1 x2 y2">` (points in the svg's own pixels; the viewBox is its box, fitted to the line and its heads) with optional `data-curve="x y"` (the point the curve passes through half way: a quadratic Bezier), `data-head-start` / `data-head-end` (`arrow`, `open`, `triangle`, `circle`, `bar`; none when absent), `data-head-size` (a multiple, 1 by default), `data-dash` (`dashed`, `dotted`), `stroke-width` (px, never scaled) and `stroke-linecap`; the colour is `color`. Heads are drawn as paths, no `<marker>`. A selected line shows a handle at each end (drag; Shift 15 degree steps; they snap to other elements, guides and the other end's level; Ctrl: no snapping) and a dot in the middle that bends it (it snaps to a symmetric arc and back to straight; double-click it to straighten), instead of the box handles. The panel has width, dashes, ends, both heads, head size, straight or curved and Flip direction. Each drag is one undo step. Older arrows (a fixed 480x24 picture) stay plain boxes; their panel offers **Make it an editable line** |
| Tab / Shift+Tab | Next / previous sibling |
| X, Y in the panel | The element's position on the slide in stage px (top left corner). Typing a value moves it there; the hint says how far it is from where the deck lays it out, and the x next to the field puts it back |
| Align section in the panel | Align left / centre / right / top / middle / bottom, distribute horizontally / vertically (3+). Several elements align to their common box, or to the slide with the checkbox; one element aligns to the slide |
| Delete, Backspace | Delete the selection (undoable). "Hide" in the properties panel or the element menu keeps it in the file as `display:none` + `data-hidden`; "Unhide all" brings it back |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy / cut / paste, also across slides and between decks; pasting where the copy came from steps the copies aside. A paste with a panel field focused goes into that field. Images, videos and text copied elsewhere paste too: files go to `assets/`, an image URL becomes a picture, a YouTube or Vimeo link a player, other text a text box |
| Ctrl+G / Ctrl+Shift+G | Group the selection in one positioned box / ungroup a group; children keep their place on the slide |
| Ctrl+] / Ctrl+[ | Bring forward / send backward one step; with Shift, to the front / to the back. Free elements are reordered in the file; z-index is written only when a sibling already carries one |
| Ctrl+Shift+L, Show layers (palette), Layers bar in the panel | The **Layers list** (`core/layers.js`): the current slide's elements front to back, docked above the properties (it stays while they scroll); open or closed, and its height (drag the grip under it, double-click to reset), are remembered with the other panel options. A row is what the canvas would select, not every tag: plain wrappers such as the content box are passed through, a group is a row that opens onto its children, a chart or picture is one row. Each row has an icon by kind and the words the panel header uses (`nameOf`). Order is the stacking order of Ctrl+] (z-index, then file order). **On every slide** at the bottom is the master layer, folded. Click selects, Ctrl+click toggles, Shift+click takes the rows between; the selection is shared with the canvas both ways, and hovering a row outlines the element. The eye (Hide) and lock use the same code as the panel's Hide and Lock; a hidden row is struck through and cannot be selected, a locked one is italic (a lock inherited from a group shows locked). Double-click the name or F2 renames (`data-name`, as the panel's name field). **Drag a row** onto another row of the same container to restack: one undo step (`EditOps.layerTo`: free elements share the target's z-index and sit next to it in the file; others get a z-index one past it, which is not always the exact slot when several siblings share a z-index). Keys in the list: Up / Down / Home / End move, Right / Left open / close a group, Enter or Space selects, Delete deletes the selection, Esc cancels a drag or rename. It redraws (deferred 60 ms, and not at all when the rows come out the same) on history changes, undo / redo, slide changes, slide add / remove and when another deck tab is shown; selecting only changes classes |
| Right-click an element | Element menu: edit text, cut, copy, paste, duplicate, delete, hide, layer order, group, ungroup, select parent (on empty canvas: paste, unhide all, new slide) |
| Enter, double-click | Edit text in place; Esc when done. The bar over the text (and the keys) has bold, italic, underline (Ctrl+B / I / U), strikethrough (Ctrl+Shift+X), superscript (Ctrl+Shift+=), subscript (Ctrl+=), code, clear formatting, link, bullet list, numbered list, alignment and an equation in the text (Alt+=, see Equations and chemical structures); formatting is saved as plain `<sup>`, `<sub>`, `<strike>`, `<code>` tags. With part of the text selected, the panel changes that part only, as a `<span>` around it: the Colour section (a swatch, the picker, the hex field; none takes it off again) and the Text section's Font, Size, Weight, Style and Spacing, whose heading then reads "the selected words". The edit stays open, the x next to a field takes that property off the part, and a press in those sections keeps the selection even when the field takes the focus. A label inside an inline SVG (a scheme, an exported chart) opens a small box over it in the label's font: Enter adds a line, Esc finishes, the SVG follows as you type |
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
- `span[data-math]` inside text is an equation in a sentence (see Equations and
  chemical structures): part of its text, never selected, moved or exported as
  a picture of its own.
- `figure[data-math]` (LaTeX) and `figure[data-chem]` (SMILES) are an equation and a
  chemical structure the editor drew (see Equations and chemical structures): the
  source in the attribute and one drawn `<svg>` inside. Selected as a whole; a
  figure with the attribute alone is drawn when the deck opens.
- `figure[data-plot="plotly"]` is an interactive chart (see Interactive charts): the
  figure as JSON in `<script type="application/json" data-plot-figure>` and a picture
  of it in `<img data-plot-snapshot>`. Selected as a whole; the editor keeps the
  picture up to date, and a figure with the JSON alone gets its picture when the
  deck opens. What the deck's renderer draws when presenting (`.deck-plot-live`) is
  never saved.
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

**Play entrances when changing slides** (Look menu, off by default) is about
the canvas while you edit. Off, a slide you go to shows at once as it ends up:
it is marked `.visible` straight away with transitions off, and every entrance
still running on it (a deck reveal's transition, a preset's keyframes) is
finished; loops keep looping. On, the deck marks it `.visible` a frame later as
it would when presenting, so its reveals and entrances play each time. Preview,
presenting, the Animation section's Play and the Theme panel's Replay the
reveal animate either way. Remembered per browser.

**Check spelling while typing** (Look, on by default, remembered like the other options) gives the text being edited, and the notes box, the browser's own spell checker in the browser's language. The element carries `spellcheck` only while it is edited: ending the edit removes it, and the saved file never has it (the serialiser strips it from the stage as well). Panel fields for colours, names, CSS, code, LaTeX and SMILES are never checked.

**Keep the screen on** (Look, on by default, `deck-editor-wake` in localStorage) holds the browser's Screen Wake Lock (`navigator.wakeLock.request('screen')`, `core/wakelock.js`) while the editor is visible, so the computer does not turn the screen off or go to sleep. It is held in edit mode too, not only in Preview: a slide left up during a lesson is often just the editor. The browser releases the lock whenever the page is hidden (another tab, a minimised window), and it is asked for again when the page is visible. The presenter window holds its own lock under the same setting and follows changes made in the editor (`storage` event). A refused request (battery saver, a policy) is not retried until the page next becomes visible; a browser without the API (Firefox before 126) shows "not in this browser". A deck opened on its own, outside the editor, takes the lock itself through its presentation features script (runtime 15 and later), always and with no setting. It does this from the server or from `file://`, which both browsers treat as a secure context. A deck inside a frame (the editor's canvas and Preview, a presenter preview) leaves the decision to the page around it.

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

**Insert** (top bar) adds one element to the current slide. Every way in
(Insert, the palette, the icon picker, a paste, a drop) places it the same way
(`core/placement.js`): measured on the slide, it goes in the centre when that
area is free; otherwise on the position of a 40 px grid, nearest the centre,
that overlaps what the slide shows least (text, pictures, drawings, groups,
filled boxes and the master layer's elements, 16 px of clear space wanted round
each; an element covering most of the slide counts as ground), kept inside
margins of 5% of the slide; on a slide too full for that (the best spot still
covers half of the new element), the cascade from the centre, 24 px further
per insert. A chart, an equation and a structure inserted in turn so end up
side by side, not on top of each other.

**Files dragged from the computer** onto the canvas are added where they are
dropped: pictures, video and sound (the server's upload types: png, jpg, gif,
webp, avif, bmp, svg, mp4, webm, mov, mp3, m4a, wav, ogg) are copied into the
deck's `assets/` and the first is centred on the drop point (kept whole on the
slide), the next ones 24 px further on; all of them are one undo step and stay
selected. A picture is 640 px wide (narrower when tall, to fit the slide's
height); a sound becomes an `<audio controls>` player. An overlay says what a
drop will do while files are held over the window. A PowerPoint (.pptx) or
Markdown (.md) file dropped anywhere is offered as a new deck (the drawer's
Import, the file uploaded), which opens in a tab of its own. Other files are
refused with a note saying what can be dropped; with no deck open, a picture
only brings a hint. A file dropped where nothing takes it is never opened by
the browser in place of the editor.

The kinds of element:

- Text: text box, bullet list, numbered list, table, code block.
  A list is edited as a whole (Enter makes a new item). A table is edited cell
  by cell: double-click the cell, Tab moves to the next one and adds a row
  after the last; the Table section of the properties panel adds or removes
  rows and columns. A code block keeps its text as plain text with inline
  colours for comments, strings, numbers and common keywords, re-coloured
  after each edit.
- Chart: column, bar, line, area, pie, doughnut or scatter, drawn by the editor from a
  table (see Charts below).
- Interactive chart (Plotly)...: a Plotly figure pasted as JSON or read from a
  file, live when the deck is presented (see Interactive charts below).
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

- **Kind**: column, bar, line, area, pie, doughnut, scatter. A pie draws the
  first series, a slice per row. Changing the kind keeps the table, so a
  chart goes to another kind and back unchanged.
- **Scatter (XY)**: the first column is X, each series a column of Y; both
  axes are numbers. Labels that are numbers (`0.5`, `1,5`, `-2`, `1e-3`) are
  X, so a column or line chart of years or doses becomes a scatter as it is;
  labels that are not all numbers (Q1, Q2...) put the points at 1, 2, 3, as
  a spreadsheet does, until X is typed in. Two or more columns of numbers
  pasted into the top-left cell fill X and Y (a first row of numbers is data,
  not headings; a CSV of numbers with decimal points or two commas or more
  splits at the commas); with headings, the one over X becomes the X axis
  title when it has none. The series' points (shape under **Points**, size
  in Chart style), **Lines between points** (in the table's order, a gap
  where a row has no value; a line chart turned into a scatter keeps its
  line; smooth only where X goes up), Y error bars as for the other kinds,
  and **Trend line** for the series picked by its chip: the least-squares
  straight line over its points' X, dashed, with R² after its name in the
  legend. On log axes it is fitted to the logarithms, so it is straight as
  drawn (a power law on log-log, an exponential on a log Y). The range
  follows the data rather than zero; where zero falls inside it a faint line
  marks it on each axis, and the numbers stay at the edges unless an axis
  is asked to cross.
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
- **Options**: stacked (column, bar, area), legend (and where: top, bottom
  or right; a pie picks its side when left on Automatic), values on the
  chart, grid lines, a unit written with every number (`$` before it, `%` or
  ` kg` after it) and the decimals of every number (Automatic: as each needs).
- **Series look** (line, area and scatter): the series picked by its chip gets its
  points (circle, square, triangle, diamond, each filled or open, or none)
  and its line (solid, dashed, dotted); the legend shows both.
- **Error bars** (column, bar, line, area): **Error bars** under the colours
  gives the series picked by its chip a column after its values in the
  table, the size of each bar (plus or minus; an empty cell, no bar). A table
  pasted into the top-left cell whose column after a series is headed `SD`,
  `SEM`, `CI`, `Error` or `±` (Mean | SD | Mean | SD) makes those columns its
  error bars. **Error is** (SD, SEM, 95% CI, or not named) heads the columns;
  the bars look the same whatever they stand for. Chart style draws them
  both ways or outward (up from a positive value, down from a negative one)
  and with or without caps. They count in the axis range and the values on
  the chart move past their ends; over bars they are in the text colour, on
  lines in the series' colour. A pie leaves them out (and keeps them).
- **Chart axes** (not for a pie): for the value axis (the numbers: up the
  side, or along the bottom of a bar chart) a line, a title, a minimum, a
  maximum and a step (empty: from the data; what falls outside a range set
  by hand is cut), and a log scale (powers of ten, with 2 and 5 between them
  over a short range; zero and negative values are left out, and stacking is
  off); for the label axis a line, a title and the labels level, turned 45
  degrees or upright; for both, tick marks (none, outside, inside) and the
  thickness of the lines. A title up the side reads from the bottom.
  **Crosses at** is where an axis meets the other (empty: at the edge): the
  value axis runs through the point of a label (pick 0 for a graph of x),
  the label axis at a value (0, for negative values below it). On a line or
  an area chart the numbers or names go with their axis, the number on the
  other axis' line and the name the value axis runs through moved off it;
  on a column or bar chart they stay at the edge, where the bars leave them
  readable. A label renamed in the table keeps the value axis; the
  PowerPoint chart crosses where the editor's does. On a scatter the X axis
  has a minimum, a maximum, a step and a log scale of its own, the Y axis
  crosses at an X typed in (0 for a graph of a function), and the numbers
  go with an axis that crosses inside the plot, as on a line chart.
- **Chart style** (not for a pie): the bar width (the share of its slot a bar
  or a group of bars fills) and rounded corners; the line width, the point
  size and a smooth curve (monotone: it never overshoots a point). **Clean**
  and **Scientific** set the look in one click: the editor's own (grid
  lines, no axis lines, rounded bars), or a journal figure's (both axis
  lines, ticks outside, no grid, square bars).
- The chart's text is the element's own font, size and colour: the Text
  fields of the panel change it. A double-click on the chart goes to its
  table.

Every change is one undo step. The chart is saved as a
`<figure data-chart="column">` holding a plain inline `<svg>` sized to its box
and the table it was drawn from, as JSON in a
`<script type="application/json" data-chart-data>` (the look only where it
differs from the default: `valueAxis`, `labelAxis`, `ticks`, `legendPos`, a
series' `marker`, `dash` and `trend`, a scatter's `lines`, ...). A scatter
is `data-chart="scatter"` with the same table: its labels are X,
`labelAxis` takes `min`, `max`, `step` and `log` as well, and
`valueAxis.at` is the X the Y axis crosses at, written as text. Export >
PowerPoint makes it a native scatter chart (`c:scatterChart`, X in column A
of its workbook as numbers, trend lines with R² shown). The deck needs no library
or script to show it (in the PDF and the single-file export too), and the
editor draws it again from the table whenever the box, the text size or the
font changes. A chart title is drawn across the top (the Title field). Charts
a deck renders with its own script (`[data-fig]`, below) stay the deck's.

### Interactive charts (Plotly)

**Insert > Interactive chart (Plotly)...** (and the palette) opens a dialog that
takes a Plotly figure in any of three forms: the JSON `fig.to_json()` gives
(`{"data": [...], "layout": {...}, "frames": [...]}`, or the list of traces
alone), pasted; a `.json` file; or a page saved with `fig.write_html()`, with
plotly.js inside it or from a CDN, from which the data, layout and config of
its `Plotly.newPlot(...)` call are read (and the frames of `Plotly.addFrames`;
a page made by R's htmlwidgets too). The dialog draws the figure as it will
look on the slide and says what is wrong when the text does not parse: the
line where the JSON breaks, Python text pasted instead of JSON, a figure with
no data, a page with no Plotly chart in it. **Try a sample** fills in a small
figure. A figure that needs the internet to draw (a map's outlines or tiles,
a picture given by address) is not drawn until **Draw it** or Insert is
pressed, and the panel says that the chart fetches them whenever it shows.

On the slide the chart is an element like any other: placed, sized, rotated,
animated, a fragment, copied between slides and decks. While editing it is a
picture of itself, so clicks and drags are the editor's; the picture is drawn
again a moment after the figure, the box or the deck's look changes. In
**Preview** (F5) and in the saved deck it is live: hover, zoom, pan, the
legend, animation frames. Only the slide on show is drawn (a browser keeps
few WebGL drawings at once); the slide that leaves goes back to its picture.
A swipe that starts on the chart, the wheel over it and a click on it are the
chart's, not the deck's cue to change slide; the keys still move the deck.
On a slide with fragments the presentation features take the wheel first.

The **Interactive chart** section of the panel has the figure's JSON (Apply,
Ctrl+Enter or leaving the box draws it; a mistake is said under the box and
the slide keeps the chart it had; a figure over 1.5 MB is replaced from a file
instead), **Replace from a file...**, and three options:

- **Live in the presentation**: off, the slide shows the picture when
  presented too (`data-plot-live="off"`).
- **Use the deck's colours and fonts** (on for a new chart,
  `data-plot-theme="deck"`): a clear ground, the element's own text colour,
  font and size (the Text and Colour sections, 22px to start with), the deck's
  accent colours for the series (a trace still in one of Plotly's default
  colours takes the deck's colour in the same place; a colour set on purpose
  stays), axis and grid lines in the text colour. Off, the figure looks as
  it was made.
- **Plotly's toolbar**: the row of buttons over the chart when the mouse is
  on it (`data-plot-toolbar="off"` hides it). The links to Plotly's cloud are
  always off.

Every change is one undo step. The chart is saved as

```html
<figure data-plot="plotly" data-plot-theme="deck" style="position:absolute; ...">
  <img data-plot-snapshot data-key="..." src="data:image/svg+xml,..." alt="the figure's title">
  <script type="application/json" data-plot-figure>{"data": [...], "layout": {...}}</script>
</figure>
```

The JSON never runs (a data block, with every `<` written `\u003c`). The
picture is an SVG made by `Plotly.toImage` in the editor (a PNG at twice the
size when the SVG would pass 3 MB) and is what shows wherever scripts do not
run: the slide strip and the Decks drawer (sandboxed frames), the PDF and the
handout (the printable copy leaves the library out), PowerPoint (the SVG with
a PNG beside it, as one picture), a deck whose scripts are blocked, and a
chart that fails to draw. Text in the picture uses the fonts installed on the
computer, as any SVG shown as a picture does: with a web font the live chart
and the picture can differ slightly.

To draw it live, a deck with a chart ends with two script tags, written on
save (and taken out again when the last chart is deleted):

```html
<script src="deck-plotly.min.js" data-deck-plot="library"></script>
<script src="deck-plot.js" data-deck-plot="renderer"></script>
```

`deck-plotly.min.js` is plotly.js 4.3.0 (`app/vendor/plotly.min.js`, the npm
package `plotly.js-dist-min` byte for byte, copied in by
`node tools/build-vendor.js`) and `deck-plot.js` is the editor's renderer
(`app/deck-plot.js`, also in `diapo-format/`). The server copies both beside
the deck when it is saved or saved as (never for a draft or an export), and
replaces an older edition of its own there; keep them with the deck, like
`assets/`. They run without "Trust this deck": see Scripts in decks. A deck
that got its first chart in this session has no library in its page yet, so
for Preview the editor puts both into the page it shows as inline scripts
(never into the file). **Export > Single HTML file** writes both into the
file, so it plays anywhere on its own (about 5 MB more).

`data-plot` names the library: the element is built so that another one
(Vega-Lite, Chart.js) can come in as another value with the same two
children. Charts a deck draws with a script of its own (`[data-fig]`) stay
the deck's, and still need its trust.

### Equations and chemical structures

Insert > Equation puts `E = mc^2` on the slide; the Equation section of the
panel holds its LaTeX, drawn on the slide as you type (`x^2`, `\frac{a}{b}`,
`\sqrt{x}`, `\alpha`, matrices, `\begin{aligned}`; reactions with mhchem,
`\ce{2H2 + O2 -> 2H2O}`). Ctrl+Enter or leaving the box makes it one undo step;
a mistake shows MathJax's message and the slide keeps the last drawing that
worked. The equation is sized by its font size (the Text size field, or a
corner handle) and coloured by its text colour. Buttons under the box put the LaTeX in
at the cursor (operators, fraction, powers and indices, roots, sums, integrals,
Greek letters, reaction arrows); with words selected they wrap them, so selecting
`a` and pressing the fraction gives `\frac{a}{}` with the cursor in the second slot.
Arrows: a typed `->`, `<-`, `<->`, `=>` or `<=>` outside `\ce{}` and `\text{}` is drawn
as the arrow (→, ←, ↔, ⇒, ⇌); the source keeps what was typed. The arrow buttons insert
the TeX arrow, or the mhchem one (`->`, `<=>`) when the cursor is inside `\ce{}`.
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

**Maths inside a sentence** ("the rate constant k_obs rises with...") is an
equation in the text itself. While editing text, **Alt+=** (Word's key), the ∑
button of the text bar, or Ctrl+K > Equation in the text opens a small popover
by the caret: a LaTeX field and a live preview. Enter puts the equation in at
the caret, Esc leaves the text as it was; a TeX that does not draw shows
MathJax's message and is not put in. With TeX selected in the text, the
popover opens with it (its `\( \)`, `\[ \]` or `$` delimiters taken off) and
Enter replaces it. TeX typed as `\(...\)` or `$...$` right before the caret is
converted at once by Alt+= (the popover opens with the message when it does not
draw). A click on an equation in the text opens the popover again (a
double-click on one in a text not being edited too); emptied, Enter removes it.
In the text the equation is one atom: the caret steps over it, Backspace or
Delete next to it takes it whole. Inserting, changing and removing one are each
an undo step of their own. It is drawn in MathJax's inline style, sized in em
(so it follows the text's size: a new font size needs no redraw), dropped below
the baseline by MathJax's own depth, and filled with currentColor (so it takes
the text's colour, a coloured selection's too). It is saved as
`<span data-math="LaTeX"><svg ...></svg></span>`, its size and
`vertical-align` in the svg's own style so a deck's CSS for `svg` does not
change it; `contenteditable=false` is only there while the text is edited.
Copy and cut write the clipboard themselves: the HTML keeps each equation's
LaTeX (pasted into a text box here it is drawn again; the clipboard's drawing is
never taken), the plain text has it as `$`. Find and replace never looks
inside one, and no match runs across one. A span written with the LaTeX alone is
drawn when the deck opens; one that does not parse is listed under Problems and
shows its LaTeX as text. The PowerPoint export writes it as text (Greek letters
and operators as their characters, `\frac{a}{b}` as a/b, `\ce{H2O}` as H₂O),
powers raised and indices lowered as runs, and says so in the export's notes:
PowerPoint has no picture inside a line of text. The PDF, print, thumbnails and
the single-file export show the drawing.

Both are saved as a `<figure>` holding one plain inline `<svg>` (every glyph a
path: no font, no script, no library in the deck) with the source in
`data-math` or `data-chem`, so they show in the PDF, the single-file export and
any browser. The libraries that draw them (MathJax 3, SmilesDrawer 2, in
`app/vendor/`, see `tools/build-vendor.js`) load into the editor the first time
one is needed. A figure written with the source alone (by hand, by the
diapo-deck skill) is drawn when the deck opens; one whose source does not draw
is listed under Problems. A double-click on either goes to its source.

### Citations and picture credits

**The deck's references.** Insert > Citation library... lists them: search,
a filter for the cited and the uncited, and for each one where it is cited
and how the style writes it. Import a file (a `.bib` from Zotero, Mendeley or
JabRef, BibLaTeX, RIS or CSL-JSON), paste the same, drop a `.bib` on the
dialog, or add one by its DOI (Diapo asks doi.org for it, then and only
then). An import adds new keys and updates the ones the deck has already; a
reference without a key gets one from its first author and year
(`szostak2001`). Changing a key changes the citations that use it; Remove
unused takes out what is cited nowhere. Every change is one undo step. The
references are kept in the deck itself, as CSL-JSON in
`<script type="application/vnd.citationstyles.csl+json" id="deck-references">`
on the stage, with only the fields a style reads, so the deck can be edited
again without the file they came from.

**The style** (the dialog's Style list, or the Sources slide's panel) writes
every citation and the reference list: APA 7th (the default), Nature,
Science, Cell, PNAS, ACS, Angewandte, RSC, AIP, APS, IEEE, AMA, BMJ, eLife,
Nucleic Acids Research, PLOS, Annual Reviews, Chicago author-date, Elsevier
Harvard, Cite Them Right, MLA, Vancouver, or any other independent CSL style
loaded from a `.csl` file (kept in the deck as
`<script type="application/vnd.citationstyles.csl+xml" id="deck-csl">`).
It is `data-csl-style` on the stage. Numbered styles number in the order the
deck first cites, slide by slide.

**A citation in a text.** While editing text, **Alt+[**, the ❝ button of the
text bar, Insert > Citation... or Ctrl+K > Citation in the text opens a
popover by the caret: search the references (or paste a DOI to add one), tick
one or more, choose the form (in brackets, in the sentence, year only) and
see it as the style writes it; Enter puts it in, Esc leaves the text as it
was. The field under the form is the citation in Pandoc's syntax, the one
Pandoc, Quarto and R Markdown use: `[@key]` in brackets, `@key` in the
sentence, `[-@key]` the year only, `[@key, p. 4]` with a page (`fig.`, `chap.`,
`sec.`... too), `[see @a; @b]` several with a prefix; type into it to add a
page. **Typing** works as well: `[@` (or `@` after a space) opens a list of
the references under the caret, narrowed as you type a key, an author, title
words or a year; Enter or Tab takes one. A citation typed out becomes one when
its `]` is typed, and only when the deck has the key; `@key` taken from the
list becomes one at once. Ctrl+Z gives back the typed text. In the text a
citation is an atom, like an equation: the caret steps over it, Backspace
takes it whole, a click opens it in the popover (none ticked, Change removes
it). Copied as plain text it is its Pandoc text, so it can be typed back.
It is saved as `<span data-cite="[@key, p. 4]">(Mansy et al., 2008, p. 4)</span>`:
the words the style wrote are plain text in the deck, which needs no script
or library to show them (a superscript number that follows a typed space
carries the class `deck-cite-tight`, which takes the space back). A
citation written with the key alone (by hand, by a generator) is written when
the deck opens; one whose key the library lacks shows as typed, marked in the
editor, and the deck says which keys are missing when it opens.

**References at the foot of the slides.** A slide's panel, when the deck
cites something, has a References part. "At the foot of each slide that
cites" (`data-cite-foot` on the stage) lists, at the bottom of every slide,
what that slide cites, in the order of the style's numbers: the short form
(`Szostak et al., Nature 409, 387 (2001)`, numbered with a superscript in a
numbered style), the style's full entry, or author and year. "Not on this
slide" is `data-cite-foot="off"` on that slide. "No citation marks in the
text" (`data-cite-intext="hide"`) leaves the text clean and the foot says it
all; the editor still shows a faint ❝ where each citation is. The foot is
`<div class="deck-slide-refs" data-slide-refs>`, written by Diapo and locked.

**The Sources slide.** Insert > Sources slide (or the button in the slide's
References part, or in Theme > Image credits) adds a slide at the end that
lists the references the deck cites in its style and every picture's credit,
by slide (`section.slide[data-sources="references credits"]`). Its title and
its look are yours; the list (`div.deck-sources[data-sources-body]`, locked)
is written by Diapo and kept current: cite something new and it appears, take
out the last citation of a paper and it goes. Its panel chooses the style,
what it lists (the cited references or the whole library, the references, the
picture credits or both, the pictures without a credit as "source not given"
or not), and whether DOIs and addresses are links. The type is the largest
that fits, from 24 down to 15 px; a list longer than that continues on slides
of its own (`data-sources-more`), made and removed as the list needs. "Stop
updating it" turns it into an ordinary slide, as it is.

**A picture's credit.** Picture > Credit in the panel: By, From, Licence (a
list of the usual ones, or your own words) and a Link, saved on the `<img>` as
`data-credit-by`, `-from`, `-license` and `-url`. "Show the credit on this
picture" off is `data-credit-show="off"` (listed on the Sources slide only);
"It needs no credit" (`data-credit-none`) is for a logo or a decoration. What
Diapo can find is filled in: a picture inserted from its address (Insert >
Image from URL) or dragged in from a page in the browser gets its site as
From and its address as Link; one from Wikimedia Commons also gets its author
and licence from its Commons page (Diapo asks Commons, then only). A picture
dragged from a page without a file of its own is put in by its address, like
Image from URL. A picture made by a deck's own script (`[data-svg]`,
`[data-fig]`) has no credit: the save writes it back as the file had it.

**How credits look** is Theme > Image credits, for the whole deck
(`data-credits` on the stage): on the picture in a corner (which corner:
`data-credit-corner`), along its right edge, under it, one line in the
slide's footer, or an ⓘ that shows the credit on hover and, in the PDF, as the
footer line. Size (`data-credit-size`) and what the line reads
(`data-credit-format`: By · From · Licence, By and From, From, © By). Each
caption is `<div class="deck-credit corner" data-credit-for="<the picture's
data-id>">`, placed from the picture's box and moved with it, revealed with
it when the picture is a fragment, and locked. It is ordinary text: the PDF,
the PowerPoint export and the thumbnails have it.

Everything Diapo writes for citations and credits (the words of the
citations, the feet of the slides, the Sources slide's list, the captions) is
written again from the deck after every change and when it opens, outside the
undo history: undo and redo change what it is written from, and it follows.
The look is a block of its own in the editor's style element,
`/* citations and credits (managed by the deck editor) */`.
citation.js (MIT) reads the files and citeproc-js (CPAL) writes the styles;
both are `app/vendor/citation.js`, loaded into the editor the first time a
deck has a citation, never into a deck. The styles beyond APA, Vancouver and
Harvard are `app/vendor/csl/` (see `tools/build-vendor.js`).

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
  `.visible`. Keyframes touch transform, opacity and filter; moves and
  rotation made in the editor use the `translate` / `rotate` properties, so they
  compose with the animation. The presets that move (fade up/down/left/right,
  bounce, drop, slide, drift) animate `translate` with
  `animation-composition: add`, so they follow the screen's directions
  whatever the element's rotation, and add to its position.
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

- **Deck CSS** (folded until opened; remembered): the deck's own `<style>`
  blocks from the file's head, one editable box each (the editor's blocks are
  not shown). Tab indents; applied on leaving the box, Ctrl+Enter or Apply, as
  one undo step. On save only that block's text is replaced in the file, so no
  block is duplicated. Bad CSS is kept as typed and flagged. Local linked
  stylesheets are listed read-only (the editor saves the deck file only).

- **Variables**: every custom property the deck defines on `:root`, grouped into
  colours, fonts, sizes and other (a `var(--x)` counts as whatever it points
  at, so `--slide-bg: var(--paper)` is a colour). Each is shown by what it does,
  not by its CSS name, which is in the tooltip: `--ink` / `--ink-2` are Text /
  Text 2, `--rule` Lines, `--paper` Background, `--slide-bg` Slide background,
  `--stage-bg` Around the slides, `--accent-2` Accent 2, `--font` Body text,
  `--font-display` Headings, `--font-mono` Code, `--pad-x` Side margin,
  `--pad-top` Top margin; any other name is humanised (`--brand_blue` reads
  Brand blue). The same names label the colour swatches everywhere
  (`colourName` in `core/dom.js`). A colour that points at another reads
  "Same as Background"; typing another colour's name, with or without "Same
  as", points it there. The deck's own value is the default; an
  override is highlighted and its "x" reverts it. **Add** under the colours
  creates a new variable (`--name`, from the name you type, or `--colour-N`)
  in the override block; it shows in the list marked as added, in every colour
  swatch row of the properties panel, and in saved themes. Its "x" removes it.
- **Base text styles**: font, size, weight, colour, line height and spacing for
  the Title (h1), Heading (h2), Subheading (h3), Paragraph (p), List item (li)
  and the slide's default text, for decks whose CSS sets these directly; one
  block per kind of text with its six fields on two lines, so nothing scrolls
  sideways at the panel's 400px. Written as `.deck-stage .slide h1 { ... }`,
  which outranks the usual deck rules without `!important`.
- **Motion**: the slide transition (the deck default, its duration, and Play to
  see it on the canvas) and the element reveal: duration, easing (named
  curves or a custom `cubic-bezier`), stagger (the step between `--i`
  values) and distance (how far elements travel), with Replay. These are the
  deck's `--dur`, `--ease-out`, `--stagger` and `--reveal-y` variables, kept
  out of the variable list. A deck made before the last two existed gets a
  small rule in the override block that makes its reveal read them (the panel
  says so); it goes away when both are cleared.
- **Custom CSS**: free text, applied live after a short pause.
- **Themes**: cards with a strip of each theme's colours and its heading font's
  name (set in that font only when the editor has it loaded already: opening
  the panel never fetches a font).
  - **Your themes** (shown when there are any): save the current overrides under
    a name, apply a saved theme to any deck that uses the same variable names
    (decks made from the same template), delete with its "x". Themes live in
    `~/.deck-editor.json`.
  - **Looks from the designs** (folded at first; opening or closing it is
    remembered): the colours, fonts and
    margins of the 31 designs, read from `app/templates/looks.json`, which
    `tools/build-templates.py` extracts from each design's `:root` variables
    (motion left out, `var()` pointers resolved) with the Google families it
    loads; `tests/test_looks.py` checks the file is current. Applying one
    (`core/looks.js`) is one undo step that sets override variables and adds
    the Google families its fonts need. A deck variable with the look's name
    takes its value; any other colour is matched by role: its name (`bg`,
    `surface`, `fg`, `muted`, `border`, `primary`, `brand`...), else vivid
    enough to be an accent, else what the deck's CSS uses it for (`color`,
    `background`, `border`), else how light it is next to the slide's own
    background and text. Text colours go to Text, Text 2, Text 3 by contrast;
    backgrounds to Background, Background 2 by closeness to the slide's; extra
    accents take the look's accents in turn; a background on the text's side of
    the lightness scale (an inverted panel) takes the look's text colour and
    the text on it the look's background. Font variables go by name (display /
    heading / title, mono / code, hand, else body text). State colours (danger,
    success, warning...), sizes other than the look's own names, and variables
    that point at another are left alone; the result line says how many
    settings changed and how many had no match.

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
New deck (File menu, welcome screen) creates a deck from it, or from one of the templates below.

## Templates

The New deck gallery offers, besides Blank, twenty-six of the editor's own designs and five
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
step. It also rewrites `app/templates/looks.json` from every design listed in
`templates.json` (the Theme panel's looks), so run it after changing a
design's colours or fonts or adding a design. Everything else in them follows the deck file contract: theme variables
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
`app/templates/templates.json` (with its `tone`, light or dark, and its
`style` for the gallery's filters) and a preview in `app/templates/previews/`.

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

- **Publish...**: a folder ready for a free web host, for when someone wants "a link". Diapo
  hosts nothing and makes no network call of its own for this. The dialog asks for the folder
  (default `<deck folder name>-site` beside the deck's folder; "Choose folder..." opens the
  native dialog, and without one the path is typed) and writes the deck as `index.html` with
  every local file it uses at the same relative paths: pictures, video, fonts, the deck's own
  scripts and styles (and what those styles load), and, for an interactive chart, the Plotly
  files (Diapo's current edition when the deck folder has none or an older one). Left behind:
  anything in a dot-folder (`.deck-editor`, `.git`), `.bak` and `.~draft` files, and files that
  leave the deck folder (by `..` or a link); the dialog's notes name them. The deck's scripts are
  kept as written, because a host serves them without Diapo's script pausing: the dialog warns
  when the deck has scripts the user has not trusted. Google Fonts links stay as they are,
  unless "Download the Google Fonts into the folder" is ticked (the "Download into fonts/" code
  of the font picker, so the only network use, and only on that tick). A folder that already has
  files in it, or a `.zip` of that name, is not written until the user confirms; confirming
  replaces files of the same names and deletes nothing. "Also make a .zip" writes
  `<folder>.zip` beside the folder (not inside it) for hosts that take a zip. The result
  dialog gives the steps for Netlify Drop, GitHub Pages and any web host, with buttons to show
  the folder (Explorer / Finder; only a folder published in this session) and copy its path.
  The two host links go through `POST /api/open-link?page=netlify-drop|github-new`, which opens
  fixed addresses in the user's browser, only on a click. The routes are `GET /api/publish/plan`,
  `POST /api/publish` (`file`, `to`, `overwrite`, `fonts`, `zip`; body = the live deck),
  `POST /api/publish/pick` and `POST /api/publish/reveal`; the writer is `write_publish_folder`
  in `serve.py` (tests: `tests/test_publish.py`, `tests/publish.spec.js`). Also in the Ctrl+K palette.

PDF and Single HTML file ask where to save with a normal dialog; the default is next to the deck
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
- **File > Previous versions...** lists those backups, newest first, each
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
- The server refuses to write a file outside the folder of decks, or a body that does not
  contain `deck-stage`. Writes go through a temporary file, so a crash cannot leave
  a truncated deck.
- Unsaved edits are autosaved after a short pause to
  `.deck-editor/<name>.~draft`. When the deck is opened again the editor offers
  to restore or discard the draft; saving removes it, and so does undoing back
  to the saved state. (The draft is a complete deck file, so structural edits
  such as added slides survive too.)
- **Decks in tabs keep their undo history.** Several decks can be open at once,
  one tab each. Leaving a tab writes its draft (when it has unsaved edits) and
  keeps the deck itself alive, hidden (`core/tabs.js`, `Deck.park`), with its
  undo and redo steps: back on that tab, Ctrl+Z and Ctrl+Y go on as if it had
  never been left, and undoing back to the saved state makes it clean and
  removes its draft. Up to four decks are kept so in the background; past that
  the one left longest ago is let go, and its tab comes back from its draft with
  an empty history. A deck without unsaved edits
  whose file changed on disk while it was in the background is read again,
  history dropped. Closing a tab drops its history, and so does reloading the
  editor page. Each deck keeps its last 200 undo steps.
- **Rename** (File menu for the open deck, or a deck's row in the Decks drawer) takes the deck's history along: its previous
  versions and draft in `.deck-editor/`, its trust (scripts in decks) and its
  place in Recent. A change of case only works too.
- **Duplicate** (File menu, or the Decks drawer) copies the HTML file only; the copy shares
  `assets/` and `fonts/` with the original, so a picture replaced in one shows
  in both. **Save as** (Ctrl+Shift+S) is the way to make an independent copy:
  it writes the live deck under a new name or folder and copies the local
  files it references (`src`, `href`, `url()`, `data-svg` below the deck
  folder); files it cannot find are listed in the toast.
- Uploaded images go to `<deck folder>/assets/`; an existing file is never
  overwritten (a numeric suffix is added). Only image, video and audio files are
  accepted (png, jpg, gif, webp, avif, bmp, svg, mp4, webm, mov, mp3, m4a, wav,
  ogg), under a plain file name.

## Checking for updates

The "?" button (or `?`) opens the Keyboard dialog; its **About Diapo** tab, also
reachable from Ctrl+K ("About Diapo", "Check for updates"), shows the version and
release date, links to the guide and the changelog, and a **Check for updates**
button. The click makes the server ask GitHub
(`api.github.com/repos/reactiveoxygenspecies/Diapo/releases/latest`, 8 s timeout,
`User-Agent: Diapo/<version>` and nothing else about you) for the newest release.
Versions are compared as numbers (1.10.0 is above 1.9.0); drafts, pre-releases and
tags that are not plain version numbers are ignored. The answer is either "You have
the latest version", or the new version with the date and the start of its notes
and a button that opens the release page in the normal browser (the editor window
is a Chrome app window, so `POST /api/open-link` does it through `webbrowser`, and
only for a fixed github.com/reactiveoxygenspecies/Diapo address). Offline,
rate-limited, no releases and an unreadable answer each give their own message.
The dialog also says how to update (a new `diapo.exe`, or `git pull` / the ZIP
again); decks are not affected.

"Check for updates when Diapo starts" (same tab) is on by default, the
`update_check.auto` entry of the settings file (missing counts as on; unticking it
writes `false`). When on, the editor asks once at
start; the server answers only if the last check is over 24 hours old
(`update_check.last`, written by every check), so at most once a day, and a newer
release shows a small notice with a link to the About tab. For tests and offline
use the address can be replaced by the environment variable `DIAPO_UPDATE_URL`
(a path to a JSON file, or an http(s) address).

## The settings file

`~/.deck-editor.json` holds the last workspace, the recent decks, the trusted
decks, the saved themes and the update-check setting. It is never half-written: each change goes to a
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
  dialogs, themes, fonts, drafts, the update check and opening links) must come from the editor's own origin. The
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
  pasted in with other blank lines round it counts too. Two of Diapo's
  scripts are files beside the deck, not text in it: the library and the
  renderer of an interactive chart (`deck-plotly.min.js`, `deck-plot.js`). A
  deck page may load one of them for as long as the file's bytes are an
  edition of Diapo's (SHA-256 of the file, checked each time the page is
  served; earlier editions under `files` in `known-scripts.json`): the policy
  then names that one address. A file of that name with anything else in it
  is the deck's own script, paused like any other. Written into a page (the
  single-file export) they are recognised as text, like the rest. Everything else stays
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

## Diapo for AI agents (MCP)

`mcp_server.py` lets any assistant that speaks the Model Context Protocol work
on the decks of a folder: Claude Desktop, Cursor, Claude Code, a local model.
The assistant starts it and talks to it over stdin / stdout (MCP's stdio
transport: JSON-RPC 2.0, one message per line; protocol revisions 2025-11-25
back to 2024-11-05). It is a separate program, standard library only, and
works on the files: the editor need not be running.

```
py -3 mcp_server.py [--folder <decks folder>] [--settings <file>] [--online]
```

Without `--folder` it uses the last folder Diapo opened (`workspace` in
`~/.deck-editor.json`, or in the file `--settings` names). It only reads the
settings: the trusted decks (so a render runs a trusted deck's scripts) and
the number of backups to keep.

Tools:

| Tool | What it does |
|---|---|
| `list_decks` | the decks in the folder (or a sub-folder): path, title, slide count, size, modified time |
| `read_deck` | an outline: each slide's number, name (`data-name`), id, section, layout classes, text (headings, paragraphs, list items, tables as rows, inline equations as `\( TeX \)`), speaker notes, pictures (src, alt, missing), charts, equations, structures and Plotly figures by kind, element ids; the deck's stage size, its own scripts and whether they are trusted, and its **version**. `slide_html` adds one slide's exact HTML, `include_css` the deck's styles |
| `write_slide` | replace a slide (`slide`: number, id or name) or insert one (`after`: 0 = first) with one whole `<section class="slide">` element |
| `set_notes` | a slide's speaker notes (plain text; empty removes them), written as the editor does: `<aside class="notes" hidden>` with `<br>` line breaks |
| `delete_slide`, `move_slide` | remove a slide (not the only one), put one at another position; the comment right before a slide goes with it |
| `create_deck` | a new deck from a template of `app/templates` (`talk` becomes `talk/index.html`, titled "Talk") |
| `check_deck` | the problems of a deck as ERROR / WARN / INFO: the diapo-deck skill's `check-deck.py` (missing files, scripts Diapo pauses, the file contract), plus TeX of equations that will not draw (braces, `\begin` / `\end`, `\left` / `\right`; MathJax in the editor has the last word) |
| `render_slide` | a PNG of one slide (`scale` 0.1 to 1 of the stage, default 0.5) with every step revealed, returned as MCP image content |
| `import_file` | a `.pptx` or `.md` inside the folder becomes `<name>/index.html`, as File > Import does |
| `export_pdf` | the printable copy (skipped slides out, every step revealed, interactive charts as their picture, links kept) printed to `<deck folder>/<name>.pdf`, as File > Export > PDF does |

Writes follow the editor's rules, through serve.py's own functions: every
write names the version `read_deck` (or the previous write) returned and is
refused when the file has changed since, as the editor's save is (409); the
previous file becomes `.deck-editor/<name>.bak` and the older ones rotate;
the file is written whole through a temporary file; only the slide or notes
block being changed is touched, so the head, the styles, the runtime and the
deck's scripts stay byte for byte; only the first slide keeps `active`. A
deck open in the editor notices the change on disk and offers to reload it,
as it does for any other program that saves the file.

Safety:

- Only files inside the folder are read or written: `..`, absolute paths
  elsewhere, drive-relative paths and `@diapo/` are refused, and so is a path
  that a symlink or junction takes outside (`list_decks` leaves those out).
- A script an agent writes into a deck is one of the deck's own: Diapo
  pauses it until the user trusts the deck, and a deck trusted before is
  paused again, since trust is kept per fingerprint of its scripts (see
  "Scripts in decks").
- The program sends nothing over the network. `render_slide` serves the deck
  to headless Chrome / Edge from a server on 127.0.0.1, on a free port, that
  answers GET `/deck/...` inside the folder only, with the same script policy
  as serve.py, and stops after the call; `export_pdf` prints from a file next
  to the deck that carries the editor's policy. The browser finds every other
  host unreachable and has its own background traffic turned off, so web
  fonts and pictures a deck links from the internet are missing from renders
  and PDFs; `--online` lets it fetch them.
- What leaves the computer depends on the agent: a cloud assistant receives
  what it reads (outlines, slide HTML, pictures of slides); a local model
  keeps everything on the machine.

Setting it up (replace the paths; on macOS and Linux the command is
`python3` with the script as its first argument):

Claude Desktop, in `claude_desktop_config.json` (Settings > Developer > Edit
Config):

```json
{
  "mcpServers": {
    "diapo": {
      "command": "py",
      "args": ["-3", "C:\\path\\to\\Diapo\\deck-editor\\mcp_server.py", "--folder", "C:\\Users\\me\\Decks"]
    }
  }
}
```

Cursor, in `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project): the
same `mcpServers` block.

Claude Code:

```
claude mcp add diapo -- py -3 C:\path\to\Diapo\deck-editor\mcp_server.py --folder C:\Users\me\Decks
```

Live edits in the open editor (an agent changing the deck the user is
looking at, each change an undo step) are not part of it yet; the protocol,
the tool table and the deck model in `mcp_server.py` are kept apart from the
file writes so that can be added on top.

## Files

```
deck-editor/
  serve.py            static server + JSON API
  mcp_server.py       the MCP server for AI agents (stdio; see "Diapo for AI agents (MCP)")
  Start Diapo.bat     Windows launcher
  app/
    index.html        the editor shell (look.js sets the Look before the first paint)
    presenter.html    the presenter window, and presenter.js its script
    print/            prep.js and keeper.js, the two scripts of the printable copy (PDF)
    deck-plot.js      draws interactive charts in a deck (copied beside a deck that has one)
    vendor/           MathJax, SmilesDrawer, plotly.js and citation.js (with citeproc-js), with their licences; csl/, the CSL styles and locales (tools/build-vendor.js)
    known-scripts.json  hashes of earlier editions of Diapo's scripts (see Scripts in decks)
    brand/            the logo: mark.svg (favicon, no word), logo.svg (the mount with DIAPO, outlined), loader.svg (the loading mark, animated), Anton, its face; icon.ico for the exe and icon-256/512.png for the page and its manifest
    editor.css
    editor.js         boot, layout, File menu, welcome screen, drawer, keyboard map
    core/
      api.js          the only module that talks to serve.py
      document.js     deck loading, slide model, navigation, serialisation
      history.js      undo/redo command stack (200 steps; parked with its deck's tab)
      tabs.js         deck tabs: switching, closing, the decks kept alive in the background
      dom.js          how deck elements are classified
      selection.js    hit testing, selection, drag / resize / rotate, guides
      transform.js    move / size / rotate primitives, snapping maths
      inspector.js    properties panel
      textedit.js     in-place text editing and the formatting bar
      slides.js       slide strip, thumbnails, slide operations
      insert.js       new elements
      placement.js    where a new element lands (centre, freest grid spot, cascade)
      filedrop.js     files dragged in from the computer (pictures, video, sound, decks to import), and pictures from a page
      cite.js         citations: the deck's library, Pandoc's citation syntax, the CSL styles, writing them (citeproc)
      citepop.js      a citation in a text: the popover (Alt+[) and the list under a typed [@
      citelib.js      the deck's references in a dialog: import, DOI, keys, the style
      citepanel.js    the panel's Credit, References and Sources slide parts, Theme > Image credits
      sources.js      what is written from citations and credits: their words, the feet of the slides, the Sources slide, the captions
      credits.js      a picture's credit from where it came from (its address, Wikimedia Commons)
      chart.js        charts: the drawing from a table, the panel's Chart section
      plot.js         interactive charts (Plotly): reading the figure, its picture, the dialog, the panel's section
      crop.js         cropping a picture by hand (the data-crop box, crop mode)
      fonts.js        the font block, Google Fonts URLs, self-hosting, the picker
      export.js       the printable copy, PDF, single-file export
      layouts.js      slide layouts and their picker sketches
      previews.js     what a deck is called, and the picture of its first slide (drawer, welcome screen) or of a template's slides (gallery)
      gallery.js      New deck: the gallery of designs, its filters and keys
      editops.js      copy / cut / paste, delete, layer order, group / ungroup
      layers.js       the Layers list above the panel (rows, select, hide / lock, rename, drag to restack)
      loader.js       the loading mark: the mount turning until it is upright (brand/loader.svg)
  import_deck.py      Markdown -> deck, the deck builder, the .pptx dispatch (used by serve.py)
  pptx_import.py      PowerPoint -> deck: theme, masters and layouts, text inheritance, shapes, pictures, tables, SmartArt
  pptx_chart.py       PowerPoint charts -> inline SVG
  start-diapo.sh, Start Diapo.command   Linux / macOS launchers
  build-exe.py        PyInstaller build of a single-file executable
      font-catalog.js popular Google families with their weights
      icons.js        the Font Awesome icon picker
    icons/fontawesome.json  the icon catalog (built by tools/build-fa.js)
    templates/      blank.html, the templates, templates.json, looks.json (the designs' looks for the Theme panel), previews/
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

Find and replace and the spelling option have `tests/find-spell.spec.js`.

The installed-fonts test (`tests/fonts-local.spec.js`) needs a visible Chrome and
Windows fonts, so it only runs with `DECK_LOCAL_FONTS=1` set.

```
npm install            (once; installs @playwright/test only)
npm test               (the installed Chrome, in parts side by side:
                        tools/test-parallel.js; -n 4 for four parts, other
                        arguments go to Playwright)
npm run test:serial    (the same, one test at a time)
npm run test:firefox   (the same specs in Firefox; once before:
                        npx playwright install firefox)
npm run test:py        (the Python tests: pptx_chart.py, pptx_import.py, emf_svg.py,
                        which files a Markdown import may copy, the
                        settings file written whole or not at all, the update check
                        (version comparison and stubbed GitHub answers), which
                        script files beside a deck count as Diapo's own, and the
                        file types a drop on the canvas sends matching the
                        server's upload types, mcp_server.py driven over stdio:
                        reading, writing, stale writes and outside paths refused,
                        paused scripts, the checker, a render and a PDF, and the
                        DOI and Wikimedia Commons lookups with stubbed answers)
```

Citations and picture credits have `tests/citations.spec.js` (the DOI and Commons
answers are stubbed there too, so it needs no network).

The tests start `serve.py` on a throw-away workspace made from
`tests/fixtures/sample-deck`, a small deck that exercises every hook of the
contract, and run the acceptance checks of the brief with the installed Chrome. The
specs are split by area (`acceptance`, `editing`, `theme`, `presenting`,
`files`), sharing the fixture and canvas helpers in `tests/helpers.js`; tests
keep their numbers and titles, so `npx playwright test -g "62 deck scripts"` runs
one (in both browsers; add `--project=chrome` or `--project=firefox` for one).

The suite runs one test at a time against one server and workspace, so `npm test`
splits it with `--shard` instead of Playwright's workers: each part gets its own
`serve.py` port (`DIAPO_TEST_PORT`), its own workspace (`DIAPO_TEST_WS`,
`tests/.tmp-workspace-N`) and results folder, and writes its output to
`test-results/shard-N.log`. Tests reach the workspace through `WS` and the port
through `PORT` from the helpers, never a fixed path or port. After a change,
`settle(page)` from the helpers waits for the deck to come to rest (no animation
running but the looping ones) instead of a fixed pause.

`tests/zz-pptx.spec.js` is a tool, not a test: it exports templates to PowerPoint
with screenshots beside them (`tools/pptx-export/`) and runs only when asked,
`PPTX_SHOTS=1 npx playwright test --project=chrome zz-pptx`.

Firefox runs every spec but the installed-fonts one (a Chrome feature). Playwright's
Firefox puts a synthetic mouse event up to about a pixel from where it was asked to,
so checks of a dragged distance use `near()` with `slack()` from the helpers, which
is 0 in Chrome. Firefox also writes `style` before other attributes of a new
element and short forms of some CSS; checks of saved markup accept both.

GitHub Actions (`.github/workflows/tests.yml`, on push and pull request to `main`)
runs the same on a Windows runner: it first rebuilds the generated copies
(`tools/build-templates.py`, which also writes `diapo-format/` and the skill's
runtime and controller) and fails if that changes a tracked file, then runs
`npm run test:py`; the browser tests run in three parts (`--shard=N/3`), each on
a runner of its own, side by side. A part that fails uploads its report and
results. Set `DIAPO_TEST_PORT` (the workflow uses
8828) when running two sets of tests at once.

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
