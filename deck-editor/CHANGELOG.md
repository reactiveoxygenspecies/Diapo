# Changelog

## Unreleased

- **Animations per element, from the Code section.** An element with an
  Animation preset gets the preset's rule in the list and, in the CSS box, its
  animation as values (`animation: de-spin 6s linear 0s infinite;`) with the
  keyframes: speed, direction, repeats and the keyframes themselves are
  changed for that element alone. Keyframes typed in the box are renamed for
  the element (`de-spin--el-3`), so the rest of the deck keeps the originals;
  the animation still waits for the slide or the click, as the preset's does.
  The Duration field of a looping preset reads **Cycle** (seconds per cycle,
  up to 120).
- **The element's own CSS wins.** It is written on `[data-id="..."]:not(#_)`,
  which outranks the deck's class rules and the presets'; before, a deck rule
  such as `.tri.teal { background }` or a preset's animation could quietly
  override what was typed.
- **The CSS box's start text keeps reveals working.** It leaves out what
  rules for a state set (the opacity and transform a `.reveal` moves between),
  rules for the editor only and `@media print` rules, and shows a deck's
  `transition` even when written with `var()` and a `transition-delay` after it
  (the browser gave its parts as empty values).

## 1.0.0 - 2026-10-24

- **Repository housekeeping.** The editor's reference is now `deck-editor/REFERENCE.md`
  (it was `deck-editor/README.md`, which read as a second README beside the
  project's own). The website (`site/`) and the roadmap (`NEXT.md`) are kept
  locally and no longer published with the code; `tools/release.py` builds the
  site only when the folder is there.
- **Open source.** Diapo is published under the MIT licence (`LICENSE`).
- **Equations and chemical structures.** Insert > Equation takes LaTeX, drawn
  by MathJax as you type in the panel's Equation section, reactions included
  (`\ce{2H2 + O2 -> 2H2O}`); a mistake shows what is wrong and the slide keeps
  the last drawing that worked. Insert > Chemical structure takes SMILES (as
  ChemDraw, Marvin or PubChem give it), drawn by SmilesDrawer with the
  molecular formula in the panel: aromatic rings with alternating double
  bonds as ChemDraw draws them (or circles, as an option), groups drawn out,
  atoms in the usual colours (or one colour), bonds in the text colour. Both
  are saved as a plain SVG with their source (`figure[data-math]`,
  `figure[data-chem]`), so the deck needs no script or font and they print,
  export to one file and show in any browser; a double-click goes to the
  source, every change is one undo step. The libraries load into the editor
  only when first needed (`app/vendor/`, `tools/build-vendor.js`). Figures
  written with the source alone (by hand or by the diapo-deck skill) are
  drawn when the deck opens, and one that does not draw is listed under
  Problems; the skill's checker knows both. Buttons under the LaTeX box insert
  operators, fractions, powers, roots, sums, integrals, Greek letters and reaction
  arrows (wrapping a selection), and a rotated structure keeps its atom labels level.
  Equations come in two looks, Classic (LaTeX) and STIX Two (the journals' look);
  atom labels follow the Font field and the deck's font.
- **The tests run in Firefox too** (`npm run test:firefox`), and Firefox no
  longer asks the editor's root for a deck's pictures when it builds
  thumbnails and deck previews. The Windows executable running Diapo in a
  browser tab opens a console window titled Diapo; closing it stops Diapo.
- **A loader of its own.** Long waits show the logo's slide mount turning a
  quarter at a time until it rests the right way up, the notch bottom-left,
  as a projectionist turns a slide to find which way it goes in. It sits
  beside the status bar's message while a PDF prints, a single file exports
  or a file imports; on the canvas, with the word, while a slow deck opens;
  in the Theme panel's Download and Embed buttons; in the icon picker
  while its catalog loads; and in the presenter window while it reconnects.
  It appears only after 300 ms (800 ms on the canvas), so quick waits show
  nothing, and with reduced motion it does not turn: the window brightens
  and dims instead. Import now shows it for the conversion only, not while
  the file dialog is open. `brand/loader.svg` and `loader-dark.svg` are the
  same mark as files.
- **The Decks drawer groups decks by folder.** The folder's own decks come
  first under "In this folder", then each subfolder under a heading of its
  own that folds away (remembered per folder), the one with the newest deck
  first. A deck kept as `<name>/index.html` counts as living in the folder
  above, so a folder of decks is one group, not one heading per deck. HTML
  files that are not decks (no `.deck-stage`: saved web pages, exports of
  other tools) are left out, with a "Show N other HTML files" switch at the
  end; shown, they say they are not decks instead of failing to open.

## 0.2.0 - 2026-10-02

- **Releases by one command.** `py -3 tools/release.py check` says whether the
  version, the release date, the changelog and the generated files agree and
  runs the tests; `py -3 tools/release.py 0.2.0` makes the release (version
  and date in `serve.py`, `package.json` and the changelog, the generated
  files, the tests, the exe) and prints the commands to commit and tag.
  `RELEASING.md` has the rest of the list (signing, the site). The site lists a download button that points
  nowhere as a placeholder, and its privacy policy no longer names a version.

- **The keyboard reaches the Decks drawer and the panel.** Each deck in the
  drawer is a button (Tab, Enter opens it; Rename and Duplicate show on
  focus), and so is every colour swatch, named by its colour ("Ink 2
  #3d3c3a", no more CSS variable names); the marks that put a field back to
  the deck's value are reachable too. A control reached with Tab keeps its
  keys: Enter no longer started editing the selected element's text, and
  arrows and Delete no longer moved or deleted it. A swatch pressed with Enter
  keeps the focus when the panel redraws.
- **Small things.**
  - The panel's labels and fields are a step larger (13px; hints and units
    12px), and so are the Decks drawer's details.
  - Insert, Theme, zoom, Preview, Presenter and Export are greyed out until a
    deck is open.
  - The status bar names the tour's own folder while the tour is open.
  - Deck previews no longer ask the editor for a deck's pictures first (a
    404 for each).
  - A single-file export of the tour inlines pictures added to it.
  - Rename takes the deck's previous versions, draft, trust and Recent entry
    along, and a change of case only works.

- **File names stay in the deck's folder.** Rename, Duplicate and the exports
  refused a slash but not a drive: on Windows `C:notes` named a file in drive
  C's current folder. Colons, control characters and the names Windows keeps
  for devices (`CON`, `NUL`...) are refused now, Save as refuses a drive
  without a path, and New with no name no longer writes `<workspace>.html`
  beside the workspace. A refused name answers 400 with the reason.
- **PowerPoint files cannot exhaust memory.** A part that unpacks past a
  limit no real deck reaches (64 MB of XML, 1 GB for a picture or video,
  64 MB for a Windows metafile, packed or unpacked) is left out with a note,
  or stops the import for XML; a bitmap in a metafile is decoded only up to
  40 million pixels (it was 400 million).

- **A trusted deck is paused again when a script file next to it changes.**
  Trust used to note a script file by its name only, so a deck stayed trusted
  when its `lib.js` was replaced; the file's contents count now. (Trusted
  decks with script files ask once more after this update.) A deck that loads
  scripts from the internet says so in its bar: their contents can change
  without Diapo noticing.
- **Other pages cannot load your decks' files.** A page on another site, or
  another local server, could load a file from the workspace as a script of
  its own (a deck's `data.js`, say) and read what it defines; the server now
  refuses every request that the browser marks as coming from elsewhere.

- **The settings file can no longer be lost.** `~/.deck-editor.json` (trusted
  decks, saved themes, recent decks) used to be rewritten in place from
  several threads at once, so a crash or two changes at the same moment
  could leave it empty. Each
  change now goes to a temporary file that takes its place, one at a time; a
  damaged file is kept aside as `.deck-editor.json.broken-<time>`, and one
  that cannot be opened at start is not written over.

- **Save asks before writing over changes made elsewhere.** When a deck has
  been saved by another program, the diapo-deck skill or a second window
  since it was opened, Ctrl+S no longer replaces those changes without a word:
  a bar offers Save over it (what was on disk becomes the newest previous
  version), Save mine as a copy, Open the file on disk, or Not now. The
  server compares a hash of the file with the one the deck was opened at
  (`X-Diapo-Version`, `base=` on `/api/save`, 409 when they differ).
- **A Markdown import copies only pictures from its own folder.** A picture
  path in a Markdown file used to copy whatever file it named into the deck,
  anywhere on the computer and of any kind, so a Markdown file from someone
  else could carry a key or a password file into a deck (and from there into
  an export). Only pictures, videos and sounds inside the Markdown file's
  folder are copied now; anything else is left out and listed.
- **No other site can frame the editor.** Every page and file is served with
  `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`, so a web page
  cannot show the editor in a frame under a picture of its own and steer a
  click into it.

- **PowerPoint pictures in Windows metafile form show.** An `.emf` or `.wmf`
  picture (pasted Office drawings, plots from lab and analysis software, the
  previews of embedded objects) used to be copied as it was, which no browser
  draws; the import now turns it into an SVG (`emf_svg.py`, standard library
  only): shapes, lines, text with its spacing, bitmaps, clipping, and GDI's
  mask and dither tricks for transparency. A metafile that is only one picture
  becomes that picture. Embedded objects (Excel, ChemDraw...) come in as their
  picture instead of being skipped, and ink or equations as the fallback
  PowerPoint saves with them.
- **Decks keep going in sandboxed previews.** Where a page may not change its
  address (a deck previewed in Teams or SharePoint, or shown in a `srcdoc`
  frame), moving to the next slide used to stop the deck with an error; the
  controller now leaves the address alone there and carries on. Every
  template has the new controller.
- **Diapo opens maximized.** The app window fills the screen at every start
  instead of coming back at the size it was left.
- **Charts written by hand are drawn on open.** A `figure[data-chart]` that
  carries its table but no drawing (as the diapo-deck skill writes them) is
  drawn when the deck opens, once its fonts are in; saving keeps the drawing.
  The skill now makes its charts this way (no script, no trust bar), and its
  checker reports scripts Diapo would pause, a re-indented controller, inline
  handlers, undrawn charts and an outdated runtime.
- **A calmer panel.** Runs by itself (slide) and Box, Animation, Align,
  Position and Link (element) start folded, each heading saying in a few
  words what is set; opening and closing is remembered. A picture, a video or
  a plain shape has no Text section; "Unhide all" shows only when something is
  hidden; Parent and Inside became two arrows by the name. From about 100
  controls for a heading to about 30.
- **Words, not markup.** The name field offers what an element is ("Heading",
  "Shape"), not `div.class`; the Font field names the font, not `var(--font)`;
  the element's id is off the panel; tooltips no longer describe the file
  format. Plain labels: Advance after and All slides (was Runs on and Deck),
  All slides for the default transition, Reveal order (was Delay index `--i`),
  Padding; the deck's own entrance is described without its class name.
- **Decks by name.** The Decks drawer names each deck by its title (else its
  folder), with a picture of its first slide, where it is, when it changed and
  its size, most recent first; the filter searches titles too. The title bar
  and the window title name the open deck; the path is on hover. New writes
  the name typed into the deck's `<title>`.
- **New elements read on any slide.** Text, list, table, chart and footer
  colours are checked against the slide's background: on a dark slide in a
  light deck (the tour's title slide) new text is light.
- **First run.** A click on the canvas behind the open Decks drawer does what
  it was aimed at (Try the sample deck opens the tour in one click); the tour
  and save toasts no longer show internal paths.
- **Keyboard and screen readers.** A focus ring in the accent wherever the
  focus lands by keyboard; the dialogs, pickers, palette and the Decks drawer
  are announced as dialogs.
- PowerPoint import: bullet markers take the file's bullet colour (the
  accent in most themes) while the text keeps its own, and two more
  Wingdings 3 arrows are drawn as arrows (Wisp, Slice).
- Tests: the specs are split by area (`acceptance`, `editing`, `theme`,
  `presenting`, `files`) with the shared helpers in `tests/helpers.js`; a
  short user guide, `GUIDE.md`, sits beside the README.
- Fixes: element and slide descriptions read across line breaks ("Welcome to
  Diapo", not "Welcometo Diapo"); divider comments such as `SLIDES 5-8 -
  Gates` are no longer taken for speaker notes (editor and runtime, all
  templates rebuilt); the published `deck-base.css` has the skill copy's
  `var()` fallbacks; the server reads a file whole before sending it (up to
  16 MB), so a slow reader never keeps it from being renamed or deleted.

- **A deck's own scripts are paused until the deck is trusted.** A deck is
  shown from the editor's own origin, so a script in it could reach the
  server as if it were the editor (switch the folder, read any file, write
  anywhere). Every file under `/deck/` now comes with a Content-Security-
  Policy that runs only Diapo's own scripts (the controller, the
  presentation features, the print helpers; current and earlier editions by
  hash, `app/known-scripts.json` from `tools/build-known-scripts.py`);
  inline handlers, `javascript:` links and form posts stay off too. A deck
  with scripts of its own opens with a bar: **Trust this deck** runs them
  (kept per deck, lapsing when its scripts change), **Keep paused** leaves it.
  The editor's pages get a policy of their own (their inline scripts moved
  to `look.js` and `presenter.js`), thumbnails are sandboxed, and the
  printable copy of a paused deck keeps the policy for the PDF. A deck whose
  controller is paused still shows its first slide's reveal elements.
- PowerPoint import: a layout placeholder takes the master placeholder of its
  type, not of its idx number. The Comparison and Two Content layouts'
  content boxes had inherited the master's date and slide number (12pt,
  right-aligned, centred); they now get the body text. Duotone backgrounds
  (the Ion theme's texture) are recoloured as PowerPoint does, from the dark
  colour to the light one, as an SVG asset with the picture inside; tint and
  shade are worked out in linear light, as PowerPoint does. A unit test on
  the Facet fixture (`tests/test_pptx_import.py`).
- Website: the version line comes from `serve.py` (`site/build.py`), the
  macOS download says it is not there yet, and the build lists the
  placeholders still to fill in before launch.
- Notice bars (unsaved draft, paused scripts, older runtime) stack instead
  of covering each other.

- The tour (Try the sample deck) is rewritten for what the editor does
  now: 23 slides in three parts shown as sections in the strip. **Start
  here** takes a first deck from Ctrl+Z and Ctrl+K to selecting, writing
  (lists included), layouts, Insert, pictures (one to crop), charts (a live
  one), style and arranging; **Present & share** covers animation,
  presenting, PDF and handouts, import and saving with previous versions;
  **For power users** has precise selection, rulers and guides, the master
  layer and sections, transitions and text effects, self-running decks,
  fonts offline and the Code section. Its caption grey is a shade darker
  for contrast. The tour's edition mark is 4, so a copy of the old tour is
  replaced (and backed up) the next time the sample deck opens; the old
  edition's source is kept in `tools/templates-src/legacy/`.
- Crop mode no longer refuses a picture that only moves with the deck's
  entrance animation (its transform is a matrix without a turn), and a
  crop box written by hand, left in crop mode unchanged, keeps its style
  attribute as written and adds no undo step. Its hint stays inside the
  canvas.

- Charts from a PowerPoint import are editable: each comes over as the
  editor's chart, with its figures, series names and colours, the theme's
  accents as its palette (a pie's own slice colours), stacking, legend,
  grid lines, data labels and title, and a unit from the number format (a
  percent format's fractions become percentages, a percent-stacked chart
  the shares it shows, a currency sign the unit). The import's drawing,
  made to look like PowerPoint's, stays until the chart is changed in the
  editor, which then draws it from the figures. Charts the editor does not
  draw (scatter, radar) stay pictures as before.

  Charts have a title: a Title field in the Chart section, drawn across
  the top. A pie's shares are whole percents with a decimal under ten
  (7.5%, not 8.0%). Tests 24c and tests/test_pptx_chart.py.

- Crop a picture by hand: double-click it (or Enter, or Crop in the panel
  and the element menu) and the whole picture shows dimmed round its box.
  Drag the picture to move it in the box, drag the box's handles to change
  what shows, drag the picture's corners or turn the wheel to zoom; arrows
  move it a pixel. Enter, Esc or a click outside ends it, as one undo step,
  and a crop mode left without a change leaves the picture untouched. This
  does the crops Fit and Focus cannot: any part of the picture, at any zoom.
  The cropped picture is a `<div data-crop>` box with `overflow: hidden`
  that takes the picture's place, size, classes, id and animation, holding
  the `<img>` placed in percentages, so a resize keeps the crop and nothing
  is needed to show it. A picture already cropped by Fit and Focus starts
  from what shows. The Picture section works through the box (alt text,
  Replace) and has Remove crop, which gives the whole picture back in the
  box's place and width. Test 60.

- The command palette (Ctrl+K) offers every slide layout ("New slide:
  Quote") and every template ("New deck from the Swiss template..." opens
  New with it chosen, waiting for a name).

- Charts: Insert > Chart puts a column chart on the slide, and a Chart
  section in the properties panel edits it. Six kinds (column, bar, line,
  area, pie, doughnut); the figures are a grid of cells, typed, or pasted from
  a spreadsheet into any cell (a whole table into the top-left cell replaces
  the chart's, headings and all; `1,200`, `1.200,5`, `12%` and `$3` all read
  as numbers). The series take the deck's own colours in turn, as theme
  variables so a theme change recolours them, and a series can be given a
  colour of its own. Options: stacked, legend, values on the chart, grid
  lines, a unit. The text is the chart's own font, size and colour, set with
  the panel's Text fields. Every change is one undo step; a double-click on
  the chart goes to its table.

  The editor draws the chart as a plain inline SVG sized to its box, so the
  saved deck needs no library or script to show it, and it prints; the table
  it was drawn from is saved beside it as JSON
  (`<script type="application/json" data-chart-data>`). A resize, a new text
  size or font, and the undo of any of them draw it again. A slide's label in
  the strip no longer reads the text of charts or the speaker notes when the
  slide has no heading. Test 59.

- Numbered lists are a first-class kind, not just something Insert could
  make: the bar over the text has a numbered-list button beside the bullet
  one, and a List section in the panel switches a list between bulleted and
  numbered (the items move into a list of the other kind in one undo step,
  keeping their styles and their place), sets the marker (disc, circle,
  square; 1. / 01. / a. / A. / i. / I.; none) and the number a numbered list
  starts at. A marker an imported list carries on every item is taken off
  when the kind or the marker changes, so the choice is what shows. Tab and
  Shift+Tab in a list item now make it a sub-item and bring it back out;
  they used to do nothing.

  A list is the element being edited, and a browser will not split or replace
  the element it is editing inside: Enter at the end of an item did nothing
  at all, so a list could only ever have the items it was made with. Enter
  now makes the next item itself, carrying whatever followed the caret and
  the item's own classes and style (not its data-id), trimmed where the two
  part; Backspace at the start of an item joins it to the one before; an
  empty item left at the end goes when the edit is finished. The bar's list
  buttons rebuild the list as the other kind for the same reason.

  This holds wherever the item is. A line of a text box made into a list
  leaves the box as the element being edited with the list inside it, and
  there Enter fell through to the line break a text box gets, so the second
  item was a <br> in the first one: the keys look at the item the caret is
  in, not at what is being edited. An item selected on its own is edited as
  the list it belongs to, since a new item cannot go outside the element
  being edited. The panel's List section finds a list inside the selection
  too, so a text box that holds one still offers its kind and marker.
  Test 57.

- Font, Size, Weight, Style and Spacing now change the part of the text that
  is selected, as the colour fields already did: a press in the Text section
  or the font picker no longer ends the edit, and the words keep their
  selection. A field that takes the focus (Size, the picker's search) used to
  make the browser drop the selection in the deck frame; the last selection
  is remembered while the panel has the focus and put back before the change,
  so it lands on the right words. The section's heading reads "the selected
  words" while it does this, the fields show that part's formatting, and the
  x beside one takes that property off the part. Test 58 covers the four
  fields, the untouched element around them and the saved file.

- A deck with an older presentation features script is offered the current
  one when it is opened: a bar with "Update them" (undoable; a save writes
  it), or "Not now". A save already brought an older script up to date;
  this is the button for decks that are only being looked at. Test 56.
- Pressing A in Preview on a deck whose script is old or missing now runs
  the slides from the editor (fragments need the script) and says what to
  add, instead of doing nothing: the key belongs to the deck's script, so
  A did nothing at all on such a deck.

- Decks that run by themselves (runtime 10). A slide can say how long it
  waits - Runs on, in the panel's slide section, with a deck-wide default
  and Start again at the end - and the saved deck then steps through
  fragments and slides on its own: A starts and stops it, any key or click
  takes it back, and a deck whose stage carries a wait starts by itself
  when it is opened (a kiosk loop). `data-auto-advance`, `data-loop`.
- Rehearse (Presenter > Rehearse the timings..., or the command palette):
  the deck runs in Preview while the time on each slide
  is taken; Esc stops it and writes the times in as the slides' Runs on
  seconds, one undo step. The presenter window shows the time on the
  current slide beside the total, red once it is past the slide's own
  seconds. Test 55.

- Rulers and guides (Look > Rulers and guides): rulers along the canvas in
  slide pixels, following the zoom and the slide size, and guides dragged
  out of them. A guide is moved by dragging, removed by dragging it off the
  slide or double-clicking it, and moving or resizing snaps to it like to
  the smart guides. They belong to the deck, not the editor: kept on the
  stage as `data-guides="x:960,y:540"`, saved with the file and undone like
  any other change. The palette has "Guides at the selection (or the
  thirds)" and "Clear the guides". Test 54.

- The panel reads shorter. The notes under the fields were explaining what
  every field does; what a field does is on its tooltip now, the notes that
  stayed are one short line, and they are off unless asked for (Look >
  Hints under the fields, remembered per browser: the editor's first
  preference of that kind). The notes that report state, not meaning - how
  many fragments the slide has, how far an element was moved, that a deck
  has no theme colours or no presentation features script - are shown
  whatever the setting. Test 53.
- A click anywhere in the Look menu re-applied the current look (`<html>`
  carries `data-look`, so `closest('[data-look]')` matched it); only the
  menu's own buttons do now.

- The command palette (Ctrl+K): one search over the editor's actions, the
  slides by name, the built-in icons, and a way into the icon and font
  pickers with the words typed; arrows choose, Enter runs, Esc closes. What
  it offers fits the moment (element actions with a selection). Test 52.

- Pictures: the Picture section of the panel has, for pictures and videos,
  Replace (another file in the same box, size and look kept), Fit
  (stretch, fill the box cropping the edges, whole picture inside) with a
  Focus grid for what stays in view, Flip left-right and top-bottom, and a
  Grayscale slider. Test 48.
- Shrink to fit the box (Text section, for a text with a box of its own):
  when the text overflows, the font size steps down until it fits, and back
  up when there is room again; refitted after edits and resizes, as its own
  undo step, never during an undo. Saved as `data-fit="shrink"` with the
  fitted size inline. Test 49.
- Copy style / paste style: Ctrl+Alt+C takes the look of an element
  (colours, border, corners, shadow, opacity, type, padding), Ctrl+Alt+V
  puts what differs on the selection, inline, one undo step; also in the
  element menu. Test 50.
- PDF with notes (handout): Export > PDF with notes prints one page per
  slide, the slide at 60% at the top and its speaker notes under it. Test 51.

- Previous versions you can see: Export > Previous versions lists the
  backups the save keeps, newest first, each with its time, title and slide
  count; "Open a copy" puts one beside the deck as its own file and opens
  it, "Restore" makes it the deck again with the current file kept as the
  newest previous version. Test 46.
- Lock: an element locked from the panel or the element menu (`data-locked`)
  is passed by when clicking and marquee-selecting and cannot be moved or
  resized, so backgrounds and full-bleed pictures stay put; Ctrl+click still
  selects it (dotted box, no handles), Delete and the panel work on it.
- Alt text: a Picture section of the panel for pictures and videos (`alt`)
  and inline SVG such as icons (`aria-label`, `role="img"`). Test 47.
- `deck-editor/NEXT.md` holds what to build next, in order.

- The browser's own context menu (Back, Reload, View page source,
  Inspect) no longer appears on the editor's chrome or on the canvas
  where the editor has no menu of its own; fields keep it for cut, copy
  and paste. Test 26.

- The Code section's HTML cell is a field: change the markup and the
  element is replaced by what was typed (one element, with whatever is
  inside it; anything else is refused and the markup shown again), it is
  selected again, and undo brings the old one back. Esc puts the markup
  back without applying. Test 44.

- Part of a text can be coloured: while editing, select the part and use
  the panel's Text colour (a swatch, the picker or the hex field); it goes
  on that part alone, as a `<span style="color">`, the edit stays open and
  the part stays selected, so a second colour replaces the first and
  "none" takes it off. It used to need a bold first, to have something to
  select. Test 45.

- A Code section at the end of the properties panel, closed by default,
  for the curious: the selected element's markup and every rule of the
  deck's CSS that styles it, in order, each marked when it applies only
  while editing or only when presenting (a template's marquee keeps its
  animation for the show), with the @keyframes those rules use; and CSS of
  one's own for the element, applied at once, declarations on the element
  and @-rules on their own, saved as data-css and written into the
  editor's style block on save, scoped to the element's id and, unless
  "Plays while editing too" is ticked, to presenting. The box starts as
  the declarations the deck's rules give the element (later rules
  winning, shorthands kept) with the keyframes they use, dimmed until
  edited, so an effect is changed where it is read; left as it is, it is
  nothing of the element's. What is inside the element is looked at too:
  a rule on a child is listed "(on the span inside)", and an effect there
  (an animation or transition, like the scrolling of a marquee band's
  text) comes into the box as a nested rule, `& span { animation: ... }`,
  so it is changed from the element that holds it. The two read-only cells are for copying:
  click one, Ctrl+A selects its text and Ctrl+C takes it (the editor's own
  Ctrl+A leaves them alone). Test 44.

- The morph's easing was an expo-out: nearly all of the travel in the
  first tenth of a second, so a move read as a jump and a turn as a snap.
  It is a gentle in-out now (a start you can see, a soft landing) over
  0.8 s by default, so the intermediate angles and places are there to
  see. And a deck that carries an older edition of the presentation
  features script gets the current one with its next save (the save toast
  says so): the decks in a workspace were still running editions 3 to 7,
  which had none of the morphing. Test 12.

- Auto-animate: an element that turns between the two slides tweened
  badly, twisting and stretching on the way. The morph worked on bounding
  boxes (the box round a turned element is not its box) and added its move
  underneath the element's own rotation, so the travel itself was turned.
  It works on poses now: the centre, the angle (the short way round) and
  the element's own size, each eased and sampled into matrix keyframes
  that undo the element's own transforms first, so a turn tweens as a turn,
  a turned element that only moves keeps its angle, and the last frame is
  exactly where the element's own CSS puts it. The ghost of the cross-fade
  takes the same path. Both slides are measured at rest, with their
  transitions and entrance animations held off for the moment (the old
  slide's reveals were already on their way out, the new slide's not yet
  in), which also stops the reveal transition from running under the
  morph. Runtime 9; tests 15 and 15b.

- Elements have names and identities. Every element inserted or drawn gets
  a `data-id` at once (unique in the deck; a copy on the same slide, by
  paste, Ctrl+D or Alt+drag, takes a fresh one, a copy on another slide
  keeps it, which is what links the two for auto-animate). The label at the
  top of the panel is a field now: type a name there (saved as `data-name`,
  one undo step, shown next to it with the id), and the Morph from list
  shows it; unnamed elements are listed by what they are and say, with the
  id after two that read the same, so two icons no longer are two
  "shape (svg)". Test 15b.

- Resizing an element the deck lays out in flow (a badge in a row, a list
  item, a paragraph in a centred column) moved everything around it: the
  layout re-flowed to the new size, the row grew, the column re-centred,
  the neighbour's text wrapped. The element now keeps its footprint while
  it is resized: the growth is taken out of its trailing margins (a shrink
  put into them), so the box the layout sees stays the size it was, nothing
  around it moves, and the element spills over its neighbours as it would
  in a free-form editor. Written as margin-right / margin-bottom, undone
  with the resize. The W / H fields of the panel still set the CSS size as
  typed. Test 3b.

- Auto-animate morphs, not only moves. Two linked elements (same `data-id`)
  need not be the same thing any more: a shape drawn as one path morphs
  outline to outline into another shape (both sampled into polygons of
  equal point count, aligned so the points travel least, tweened frame by
  frame with the same easing as the move, the real path put back at the
  end), a box tweens its colour, corners, rotation and shadow into the
  other's, and two that do not look alike (a text into a picture, one word
  into another) cross-fade: a ghost of the old one travels and fades out
  over the new one fading in. No library: the polygon sampling is what
  anime.js's morphTo does, in sixty lines of the runtime. In the editor,
  an element on the slide after an auto-animating one has a **Morph from**
  row in its Animation section listing the previous slide's elements;
  choosing one links them (the same `data-id`, unique on this slide),
  "(nothing)" unlinks. Rectangles and ellipses (empty divs) get ids from
  the Auto-animate checkbox too. Runtime 8; test 15b.

- Resizing: Alt resizes about the centre, the opposite edge moving as
  much as the one dragged; with Shift on a corner the aspect ratio is
  kept as well, so Alt+Shift grows a picture in place. Underneath, the
  resize now measures where the element ended up after each change and
  puts it back so the anchored point (the opposite edge, or the centre) is
  exactly where it was, whether the element is a box, text scaling its
  font, or a shape scaling about its middle. Test 3b.

- The exact element under the cursor is picked with Ctrl+click now, not
  Alt+click: Alt is the duplicate modifier, so an element picked with Alt
  could not be dragged without copying it. And a plain press on an element
  picked that way keeps it selected (a plain click used to re-pick its
  group), so a drag moves just that element. Ctrl while dragging still
  turns snapping off. The hint in the panel, the shortcut list, the README
  and the welcome deck (edition 3) say Ctrl; tests 5, 23 and 32.

- Ungroup kept the members' places but not their look: the welcome deck's
  three cards (styled through the group, `.stack .c { width; background }`)
  came out as three bare words. A member leaving a group now keeps the
  look it had inside it, written inline only where the computed values
  changed (size, padding, borders, background, colour, type, shadow, flex
  settings, for the member and what is inside it); undo takes it away
  again. The members are also placed from the container's position after
  the group has gone, not before, so a container the group was sizing (a
  centred flex box) no longer shifts them on the way out. Test 23.

- Editing text under a full-stage master layer (the welcome deck's
  "Double-click any text"): a click in the text ended the edit instead of
  moving the caret, and nothing could be selected by dragging, because the
  layer, clickable while editing, caught the mouse before the text did.
  While text is being edited, the empty ground of a large master element
  lets the mouse through (its prints still click); the mark that does it
  is never saved. Test 36.

- A master layer that covers the whole stage (the welcome deck's margin
  print: a full-size div holding the corner prints) took every click on
  the slide, so the heading under it could not be selected; and "Send to
  back" on it dropped it under the active slide, where it vanished. The
  empty ground of a large master element now lets the click through to the
  slide (its prints and logos still select), and a master element stacks
  against the other master elements only, never against the slides. Also,
  sending an element under a sibling at z 0 no longer writes a negative
  z-index (which paints it behind its parent's background, a card or the
  slide): a free element takes z 0 and an earlier place in the document
  instead. Tests 23 and 36 cover both.

- The editor's icon on the taskbar was soft: the app window is Chrome's, which
  takes its icon from the page's favicon and scales a favicon-sized bitmap up
  to the taskbar. The page now also declares a 256 px PNG and a web app
  manifest with 256 and 512 px icons (`app/manifest.webmanifest`), so Chrome
  scales down instead. `build-icon.js` draws the frames below 48 px with
  their edges snapped to whole pixels (the card's inset and radius, the
  window's rectangle) and adds the 20, 24 and 40 px frames Windows asks for
  at 125 / 150 % scaling, so `icon.ico` on the exe is crisp at every size.

- Dark look: the list a select drops down (Transition, Deck default, the
  animation timing) was white with the look's light ink on it, readable
  only on the highlighted row: Chromium paints a transparent select's list
  white whatever the colour scheme. The select and its options carry the
  field's colours now.

- The controls at the bottom of a presented deck were two heavy pills, and
  the page number between them, white on nothing, vanished on a light
  slide. They are thin chevrons and a small counter now, drawn in whatever
  ink reads on the slide beneath (white blended by difference: dark on a
  light slide, light on a dark one), faint until hovered, and they fade out
  after 2 s without mouse movement, back on the first move or touch. H
  hides them altogether (H again brings them back), for when the mouse is
  needed where they sit. The markup is unchanged, so the base CSS and the
  controller carry it into every template, the Diapo Format and the skill;
  the editor strips the two state classes on save.

- Overview (O in a saved deck): the rows overlapped, so the tiles ran into
  one another and the grid read as one cramped sheet (Chrome sized the auto
  rows from the aspect-ratio box's minimum, not its height; the rows are
  `max-content` now). Redrawn while at it: each slide in a framed tile with a
  faint edge and a shadow so light slides stand off the dark ground and off
  each other, a caption under it with the number and the slide's name (or
  its heading), wider gutters, a header line with the deck's title, the
  count and the keys, sections as headed rows as before. Arrows move the
  highlight through the grid and Enter opens the highlighted slide (the
  arrows used to fall through to the deck behind). Runtime 7; the editor
  offers "Presentation features updated" to decks carrying the older one.
  Templates, the Diapo Format and the skill rebuilt with it; test 15 checks
  the tiles never overlap, keep the deck's ratio and answer the keys.

- The welcome deck is designed now, not imported from Markdown: ten slides
  in Diapo's own identity (the slide mount on the cover and as the master
  layer's margin print, Anton headlines, Instrument Sans, JetBrains Mono),
  each with a drawn demonstration of what it teaches: the selection handles,
  the text bar and caret, the layout picker, the stacking order, the theme's
  swatches and type, a parade of mounts that arrive with the deck's stagger,
  two fragments, an auto-animate into the Present slide's keycaps, the three
  export outputs, and the date stamp on Save. `tools/templates-src/welcome.html`,
  built to `app/templates/welcome.html`; `template=welcome` copies it like any
  other template. `welcome.md` is gone. The sample deck no longer lands in
  the user's folder: it lives in `~/.deck-editor-samples/welcome/` beside the
  settings file, reached as `@diapo/welcome/index.html` through a virtual
  folder the path helpers resolve, so it opens from any workspace, stays out
  of every folder listing, and shows as "Diapo's sample deck" in Recent. An
  older edition already there (the Markdown one, or any earlier design:
  titled like the tour, without the current `diapo-tour` edition mark) gets
  the new one when "Try the sample deck" is pressed, the old file kept as a
  backup; the current tour, edited or not, is opened as it is (test 28).

- Look > Dark: the whole editor dark, not only the bars. Panels sit a step
  above the canvas so the slide stays the brightest thing on screen; the
  drawer, the inspector, the theme panel, dialogs, menus and toasts all take
  the dark palette, and `color-scheme: dark` makes the browser's own
  controls and scrollbars follow. The indigo of Ink, lifted for contrast.
  The surfaces that were hard-coded light (the yellow notice bar, the
  thumbnail label, the in-place SVG text editor, the ink-on-white buttons of
  the icon picker and the font dialog) now read tokens.

- The website, in `site/` at the repository root: a landing page whose
  demos are the templates themselves (each card opens the real deck), the
  editor, PowerPoint import, privacy and download sections, and a
  privacy policy that lists every file the program writes and every
  connection it makes. Static, self-hosted Anton only, no third-party
  requests from the pages; `site/build.py` copies the brand files, the demo
  decks and the licence texts in (ignored by git). Placeholders in
  brackets (email, hosting provider, download links) are still to be
  filled in.

- PowerPoint import rewritten (`pptx_import.py`, `pptx_chart.py`) so a
  deck comes over the way PowerPoint shows it: the theme (scheme colours
  with their modifiers, the master's colour map, theme fonts, the style
  references behind theme shapes), master and layout backgrounds and
  decorative shapes, the full text inheritance chain (sizes, fonts,
  colours, bullet glyphs including the symbol fonts', numbering, indents,
  spacing, autofit, anchors, insets, strike, super- and subscript),
  preset and custom geometries as the editor's SVG shapes, gradients,
  dashes, shadows, lines with arrowheads, cropped and rounded pictures,
  tables with widths, merges, fills and table styles, charts (bar, column,
  line, pie, doughnut, area) as SVG, SmartArt from its saved drawing,
  hidden slides as `data-skip`. Measured against a corpus made with
  PowerPoint itself: `tools/pptx-corpus.ps1` writes one 14-slide deck per
  built-in theme with PowerPoint's own render of every slide, and
  `tools/pptx-compare.js` imports them and writes side-by-side images.
  Tests 24b (updated) and 24c (`tests/fixtures/import/facet.pptx`).

- `APP_VERSION` and `APP_RELEASED` in `serve.py` date the build (bump them
  per release).

- Diapo runs in its own window. The server opens the Chrome or Edge of the
  machine in app mode (`--app=`): no tabs or address bar, the mark and the
  name in the title bar, a profile of its own in `~/.deck-editor-window-<port>`
  that never mixes with the user's browsing and remembers the window size.
  Closing the window stops the server, so Diapo starts and quits like a
  program; `--tab` gives the old browser tab, and without Chrome or Edge the
  tab is the fallback. A second start on a port Diapo already serves opens a
  window on the running one instead of a second server (the port is probed
  before binding: `SO_REUSEADDR` would otherwise let Windows bind it twice);
  a port held by another program moves Diapo to the next free one. The
  executable is now windowed (no console): output goes to
  `~/.deck-editor.log` and a fatal error is shown in a message box.
  `Start Diapo.bat` starts the server with `pyw`, console-free, when the
  python.org launcher is installed.

- The editor is now called Diapo (from *diapositive*, the 35mm slide). The
  logo is a slide mount with the word reversed out of its window (on the dark
  looks, a charcoal mount with white film and the word in dark); it sits on
  the empty canvas (with this month as the processing-date stamp) and, without
  the word, as the mark in the top bar and the tab icon (`app/brand/`). The
  launchers are `Start Diapo.bat`, `Start Diapo.command` and `start-diapo.sh`,
  the executable builds as `diapo`, with the logo as its icon
  (`app/brand/icon.ico`, rendered by `node tools/build-icon.js`; the word
  appears from 48 px up). Nothing inside decks changes: the
  `deck-editor-*` ids and markers, the `.deck-editor/` sidecar folder and
  `~/.deck-editor.json` are part of the file contract and keep their names.

- Tomorrow: a creative-resume template in teal, slate and orange on light
  grey, with clusters of isometric CSS cubes and floating triangles in the
  corners (each cluster a movable group), Oswald capitals over a Lora body,
  and the resume structure: contents, about, experience timeline, skill
  bars, education, selected work, contact.

- Text formatting bar: strikethrough (Ctrl+Shift+X), superscript
  (Ctrl+Shift+=), subscript (Ctrl+=), code (monospace) and clear formatting,
  next to bold, italic and underline; saved as plain `<strike>`, `<sup>`,
  `<sub>` and `<code>` tags. Superscripts and subscripts are set at 65% of
  the text (the browser's default is about 83%; word processors use 65%,
  TeX 70%) without changing the line height: a rule in the blank template
  and the skill's base CSS, and a managed rule in the override block for
  decks whose CSS has none, present only while the deck uses them (test 42).

- Five more templates: Aurora (the launch keynote with a gradient wash and
  glass panels), Sunset (warm earthy shapes and a soft serif), Nordic
  (Scandinavian light in linen, sage and clay), Neon (magenta and cyan glows
  on near-black with a perspective grid) and Comic (a storyboard with panels,
  speech bubbles and bursts). Thirty templates in all.

- Five templates in aesthetic directions the set lacked: Retro (a seventies
  poster in mustard, rust and teal), Notebook (a ruled page with handwriting,
  hand-drawn SVG marks and sticky notes), Deco (art deco gold on near-black),
  Brutalist (3px borders, black offset shadows, marquee bands) and Broadsheet
  (a newspaper with a masthead, justified columns and drop caps).

- Five more templates for the deck types the set lacked: Academic (a
  conference talk with numbered figures, an equation and references), Pitch
  (the startup deck structure with market circles, a traction chart and a
  competition matrix), Workshop (timed exercises, a discussion slide, a quiz
  with a click-reveal answer), Portfolio (photo-led plates with a caption
  bar, a grid, before and after) and Report (a reading-first data deck with
  KPI rows, CSS charts, dense tables and status pills). Built like the others
  from `tools/templates-src/`.

- Decks drawer: everything under its header scrolls as one column, and the
  template cards scroll within their box, so a long list of templates, recent
  decks and files no longer runs off the bottom of the window.

- Panels and canvas: pasting with a panel field focused (a colour code into
  the hex field, say) goes into the field instead of onto the slide; the
  wheel over a focused number field steps its value (Shift: ten steps) and
  applies it; the middle mouse button grabs the view and drags it with the
  mouse (in place of the browser's autoscroll); Ctrl+wheel zooms around the
  pointer instead of the centre (test 41).

- Ten templates of the editor's own under New > Template: Folio (editorial,
  Fraunces and Libre Franklin on ivory), Boardroom (navy and amber business
  deck with KPI tiles, a CSS bar chart and a comparison table), Terrarium
  (dark botanical, Cormorant Garamond and Karla), Console (IDE dark theme,
  JetBrains Mono and Manrope, code and diff windows), Sorbet (playful pastels,
  Fredoka and Nunito, blobs and chips) and Blueprint (cyanotype drawing
  sheets, Archivo and Space Mono, a title block on every sheet), Minimal
  (white space and Hanken Grotesk at light weights), Bold (Anton capitals in
  black, warm white and red), Clean Dark (charcoal product keynote, Sora and
  Figtree, ice-blue accent) and Swiss (International Typographic Style on a
  visible twelve-column grid, Inter Tight, black, white and red). Each is a
  nine- or ten-slide deck on the contract: theme variables, type on the tags, reveal
  entrances, fragments, notes, image placeholders, a master layer. Sources in
  `tools/templates-src/`, built by `tools/build-templates.py`, which splices
  the blank template's base CSS, controller and runtime in verbatim. The
  master-layer rule is no longer duplicated into the override block when the
  deck's own CSS already handles `data-no-master`, so these templates (and
  decks from the diapo-deck skill) save byte-identical (test 39).

- Insert > Font Awesome icons...: a searchable picker over the 2000 icons of
  Font Awesome Free (solid, regular, brands). Icons are inserted as inline
  SVG with a `currentColor` path and Font Awesome's attribution comment, so
  they recolour through the Text colour field and need nothing when
  presenting: no font, no network, no script. The catalog is
  `app/icons/fontawesome.json`, built by `tools/build-fa.js` from the npm
  package (test 40).

- Templates: New > Template offers Blank plus five designs adapted from
  beautiful-html-templates (MIT): Sakura Chroma, Neo-Grid Bold, BlockFrame,
  Studio and 8-Bit Orbit, each the source's full sample deck rebuilt on the
  editor's contract (fixed stage, base CSS, controller, runtime, reveal
  classes, live page counters, theme variables). The conversion is
  `tools/import-bht.js`, so more of the library can follow. `/api/new` takes
  `template=<slug>`; the cards come from `app/templates/templates.json` with
  previews in `app/templates/previews/` (test 39).

- Theme panel: a Motion section. Slide transition (deck default, duration,
  Play) and element reveal (duration, easing as named curves or a custom
  cubic-bezier, stagger, distance, Replay), which are the deck's `--dur`,
  `--ease-out`, `--stagger` and `--reveal-y`. The blank template and the skill's
  base CSS read the two new variables; older decks get a compatibility rule
  in the override block while stagger or distance is set. Base rules can now
  attach to the slide itself (`&:not(.visible) .reveal`) and list several
  selectors. A `var(--x)` variable is grouped by what it points at, so
  `slide-bg` sits with the colours. Fixed: saving a deck with LF line endings
  after adding the runtime (which has CRLF) turned the whole body to CRLF
  (test 38).

- Fixed: slide transitions only animated the incoming slide, and with an
  easing that was over in about 150 ms, so a "fade" looked like a flash
  through white and "slide" like a small nudge. The outgoing slide now takes
  part (the deck's CSS hides it at once; the runtime keeps it shown while it
  leaves): fade is a cross-fade, slide and up push both slides a full width
  or height, zoom cross-zooms, all over the whole duration. Runtime version 6;
  "Update presentation features" in the Presenter menu brings older decks up
  to date (test 31).

- `skills/diapo-deck` (repository root): a Claude Code skill that generates
  decks in this editor's file contract (deck-base.css and the controller taken
  from the blank template, the runtime pasted in, editor conventions such as
  `--i`, `data-fragment`, `data-no-master`, `aside.notes[hidden]`), adapted
  from zarazhangrui/frontend-slides. `scripts/check-deck.py` checks any deck
  against the contract, `open-in-editor.py` opens it here, `import-deck.py`
  wraps `import_deck.py`. See `skills/README.md` for installing it.
- Theme panel: new colours can be added (Add under Colours): a `--name`
  variable in the override block that joins the swatches everywhere and the
  saved themes; added colours are marked and removable (test 37). The
  properties panel's swatches now follow theme edits instead of the values at
  load time.
- Master layer: stage-level elements (a footer, a page counter, a logo) are
  now selectable and editable on the canvas, once for every slide. Insert >
  Footer on every slide adds one; a slide can opt out (Show the footer... in
  the panel, saved as data-no-master with a rule in the override block);
  thumbnails and the PDF show the layer per slide with the right page number.
  The blank template's per-slide slide number became such a footer (test 36).
  Double-clicking between the lines of an SVG label now opens it for editing.
- Slide size (Theme panel): a deck can be any size, not only 1920 x 1080.
  Presets for 16:9, 16:10, 4:3, A4, square and 9:16, or a custom width and
  height. The size lives in the deck's override block; zoom, thumbnails,
  guides, position fields, new layouts and the PDF page follow it, and the
  template's controller now reads the stage's size (older copies are updated
  when the size is changed). The editor sets the stage transform itself while
  editing, so any deck scales right in the canvas whatever its own script
  assumes. A 4:3 PowerPoint file imports as a 4:3 deck (test 35).
- Look (status bar): the editor's chrome comes in three looks, Ink (the new
  default: dark bars, indigo accent), Clean (as before) and Slate. Only the editor's own colours change, never the
  deck's; the choice is remembered per browser and applied before the first
  paint (test 34). The stylesheet's chrome colours are now tokens
  (`--tb-*`, `--status-*`, `--primary-*`, ...) with Clean as the defaults.

## 0.1.2 - 2026-09-15

- Fixed: duplicating an element the deck lays out in flow (a heading in a
  flex column, a list item) reflowed the original and its neighbours, with
  Alt+drag, Ctrl+D and paste. Copies of such elements are now taken out of
  the flow: absolutely positioned at the original's exact place, same width
  (test 33).
- Links on any element (Link section of the panel, "Link to..." in the menu):
  saved as `data-href`, opened in a new tab by the runtime (version 5), and a
  real anchor in the PDF copy. Alt+drag duplicates what is dragged, in one
  undo step; disabling snapping moved from Alt to Ctrl while dragging. The
  DNA icon is gone. Test 32.
- Slide transitions (`data-transition` on a slide or as the deck default on
  the stage: fade, slide, up, zoom), text effects (`data-text-effect`:
  letters, words, typewriter; the runtime wraps and unwraps the text while it
  plays) and sections (`data-section`: headings in the slide strip that fold,
  and in the overview). Controls in the slide section and the Animation
  section of the properties panel and on the thumbnail menu. Runtime
  version 4 ("Update presentation features" for older decks). Test 31.
- Save as (Ctrl+Shift+S, Export menu): the live deck under a new name or in
  another folder, with the local files it references copied along; the
  editor moves to the copy, the original keeps its last saved state, and a
  folder outside the workspace becomes the workspace. `/api/saveas`, test 29.
- Labels inside inline SVG are editable: double-click (or select the text
  exactly and press Enter) opens a box over the `<text>` in its font at the
  current zoom; the SVG follows while typing, lines map to `<tspan>`s, one
  undo step. Test 30.
- Onboarding: the empty canvas offers Open, New and **Try the sample deck**,
  a ten-slide tour built from `app/templates/welcome.md` through the
  Markdown importer. A **Problems** badge in the status bar lists missing
  pictures, videos, stylesheets and scripts and errors thrown by the deck's
  scripts, with Show to select a missing picture. X and Y in the properties
  panel are now the element's position on the slide (the offset from the
  deck's layout is shown as a hint). Test 28. `core/problems.js`.
- Platforms: `start-editor.sh` and `Start editor.command` for macOS and
  Linux; `build-exe.py` makes a single-file executable with PyInstaller (the
  server finds its files in the bundle and shows dialogs by re-running
  itself). File dialogs fall back from tkinter to the system's own dialog
  (osascript, zenity, kdialog) and, where there is none, to a typed path in
  the editor (`DECK_EDITOR_NO_DIALOG=1` forces this; the tests run that way).
  Recent paths use the machine's own separator. Test 27.
- Backups and drafts moved out of the deck folder into `.deck-editor/` next
  to the deck (hidden on Windows); old ones are moved there on the next save.
  `--backups N` sets the number kept. A draft is removed when undo returns
  the deck to its saved state.
- Side panels hide and show (status bar buttons, Ctrl+\) and resize by
  dragging their inner edge; the choice is remembered. The Theme panel uses
  the panel's width (at least 400px), opens the panel when hidden, and
  closes on Esc. At narrow widths the top bar drops labels and zoom buttons
  instead of overlapping. Test 26.
- Import (Decks drawer): a Markdown file (Marp / reveal-md conventions:
  `---` between slides, headings, lists, code, quotes, tables, pictures,
  notes in comments) or a PowerPoint file (positions and sizes, text with
  bullets, sizes and colours, pictures including SVG, tables, filled shapes,
  groups, backgrounds, notes; placeholders inherit their place from the
  layout or master) becomes a deck built on the blank template, with its
  pictures in `assets/`. `import_deck.py`, `/api/import`, tests 24 and 24b.
- Fixed: saving a deck whose body script mentions "</body>" in a string or
  comment (the deck runtime does) appended the tail of that script as text
  at the end of the file. The save now splices at the last closing tag, and a
  file damaged that way is repaired when it is opened (test 25).
- Fixed: printing a large deck to PDF could fail on Windows while a browser
  helper still held the file; the print time limit now grows with the deck.
- Editing: copy, cut and paste (Ctrl+C / X / V) of elements, across slides and
  decks, through the system clipboard; pasted images and videos are uploaded,
  pasted URLs become pictures or players, other text a text box. Delete now
  deletes (Hide stays in the panel and the menu). Bring forward / send
  backward one step (Ctrl+] / Ctrl+[), front / back with Shift. Group and
  ungroup (Ctrl+G / Ctrl+Shift+G). A right-click menu on elements and on the
  empty canvas. Test 23. `core/editops.js`.
- Slide layouts: the + button, Ctrl+M and the thumbnail menu open a picker
  (blank, title, section, title and text, title and bullets, two columns,
  comparison, text and image, image and caption, two images, quote, big
  number). Layouts are positioned elements in the deck's font and colours;
  image placeholders are filled by double-click and stay out of the
  presentation until then. Ctrl+Shift+M adds a blank slide directly.
- Insert library: bullet and numbered lists (edited as a whole), tables
  (cell by cell, Tab to the next cell, rows and columns in the properties
  panel), code blocks with inline syntax colours, video from file or URL,
  embedded web pages (YouTube, Vimeo), rounded rectangle, triangle, diamond,
  hexagon, star, block arrow, chevron, speech bubble, and 16 more icons.
  Elements with `data-group` are always selected as a whole; a double-click
  edits the text block under the cursor. Tests 21 and 22.
- Export menu (top bar): **PDF** (Ctrl+P), one 1920 x 1080 page per slide
  with animations and fragments in their final state and charts rendered,
  printed by the Chrome or Edge on this computer (headless; the browser's
  print dialog when there is none), and **Single HTML file**, a copy with
  scripts, styles, images, fonts and Google Fonts embedded that opens
  anywhere from one file. Both from the live deck, both through a save
  dialog, both covered by tests 20 and 20b. `core/export.js`, `/api/pdf`,
  `/api/export`.
- Server: requests from other web pages are refused. Every request must name
  this server in `Host` (DNS rebinding), and every POST or DELETE must come
  from the editor's own origin (`Origin` / `Sec-Fetch-Site`); non-browser
  clients without those headers are still allowed. Uploads accept image, video
  and audio files only, under a sanitised plain file name; the reply lists
  refused files. Covered by test 9b.

## 0.1.1 - 2026-09-15

- Fonts: a searchable picker (deck fonts, about 80 Google Fonts families shown
  in their own face, system fonts, any other Google family by name) in the
  properties panel and the Theme panel; the Weight menu lists the weights a
  family really has; Italic and text case in the Style row. Google families are
  loaded through one `<style id="deck-editor-fonts">` block. "Fonts in this deck"
  in the Theme panel can download the font files into `fonts/` next to the deck
  or embed them in the HTML, so a saved deck presents without a network
  connection; the deck's own Google link is commented out meanwhile and
  restored by "Use Google Fonts again". Own font files can be added (copied
  into `fonts/`, described from their name tables) and, in Chrome, picked from
  the fonts installed on the computer, which copies them into the deck.

- Runtime: laser pointer (L) and a drawing layer (D) with colours, width, undo
  and per-slide clear, for presenting from the standalone file.

- Deck runtime (`deck-runtime.js`, replaces the presenter-only script): presenter
  window on P, overview on O, fragments (reveal on click, with order), and
  auto-animate between slides. Editor: "Reveal on click" and order in the
  Animation section, "Auto-animate to the next slide" on the slide, "Add /
  update presentation features" in the Presenter menu.

- Animation section: inspect the deck's own reveal (delay index) or apply one of
  23 CSS presets (entrances and loops) with duration, delay, easing and replay.
  Preset CSS lives in the override block, so saved decks animate on their own.
- Undo restores a removed attribute at its original position.

- Align and distribute (properties panel): left / centre / right / top / middle /
  bottom and equal-gap distribution, relative to the selection or to the slide.
- Undo and redo snap into place instead of easing through the deck's reveal
  transitions. Fixed: consecutive nudges of different elements merged into one
  undo step that only restored the first element.

- Standalone presenter: `deck-presenter.js`, a dependency-free script that gives
  the saved deck its own presenter view (press S). Built into the template;
  "Add presenter to this deck" in the Presenter menu adds it to existing decks.

- Theme panel (Ctrl+T): edit the deck's :root variables, base text styles and
  custom CSS live; save and apply named themes. Written as one
  `<style id="deck-editor-overrides">` block, undoable, removed when empty.

- Presenter view (Presenter button, Shift+F5): a second window with the current
  and next slide, the speaker notes, a timer and a clock, synced with the editor
  in both directions over a BroadcastChannel.
- Speaker notes are written as `<aside class="notes" hidden>`, so they never show
  on the slide in decks that have no CSS for them (they did before). Editing
  existing notes did not apply; fixed.

- Opening decks: native "Open deck..." and "Browse folder..." dialogs, a Folder
  field that accepts a pasted path, and a Recent list; the last folder and recent
  decks are remembered in `~/.deck-editor.json`, and the launcher reopens the last
  folder. New deck uses an inline name field and refuses paths.
- Decks that still load the earlier in-deck editor prototype (`editor.js`) get a
  no-op for it while edited here.
- Fixed: clicking a thumbnail in the slide strip did not change the slide (the
  drag-to-reorder code swallowed the click).
- Fixed: on a keep-alive connection a request body could be reused by the next
  request, which made a save after a draft restore fail.

## 0.1.0 - 2026-09-14

First version: every P0 item of the brief.

- Server (`serve.py`): editor app, workspace listing, deck files, save with
  rotating backups, uploads, new deck from template, rename, duplicate, draft
  sidecars. Binds to 127.0.0.1, refuses paths outside the workspace and bodies
  without `deck-stage`, writes through a temporary file.
- Editor shell: Decks drawer, slide strip with live thumbnails, canvas with zoom
  and pan, properties panel, preview mode, keyboard help.
- Deck loading in an iframe sized to the zoom, so the deck's own scaling code
  produces the zoom; navigation through the deck's hash handling with a
  class-toggle fallback; a MutationObserver as the single source of slide changes.
- Serialisation: head written back verbatim from the original file, runtime
  content stripped (`[data-fig]`, `[data-svg]`, `svg.dots`, `[data-generated]`,
  empty-by-id hosts, body-level script additions), bare attributes, self-closing
  SVG tags and CRLF preserved. Untouched decks save byte-identical.
- Undo/redo as a command stack with transactions and coalescing; dirty state
  derived from the save point.
- Selection: composite-aware hit testing in stage coordinates, hover, marquee,
  Shift/Alt/Tab, move with smart guides, resize (text scales its font, boxes set
  width/height, charts re-render), rotate, nudge, hide/unhide.
- Inspector: colour (deck theme swatches, recent, picker, hex), text, box,
  position, slide background, name and speaker notes.
- In-place text editing with a formatting bar; commits on Esc, click elsewhere,
  slide change, undo and save.
- Slides: add, duplicate, delete, reorder by drag and keyboard, skip.
- Insert: text box, image (upload or URL), rectangle, ellipse, line, arrow, icons.
- Drafts autosaved next to the deck and offered back on the next open.
- Playwright acceptance tests for the ten checks of the brief.
