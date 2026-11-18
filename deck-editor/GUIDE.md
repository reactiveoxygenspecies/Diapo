# Diapo in ten minutes

A short guide for people who make presentations with Diapo. Everything here is
covered in more detail in the [reference](REFERENCE.md).

## Start

Double-click **Start Diapo** (`Start Diapo.bat` on Windows, `Start Diapo.command`
on a Mac). With Chrome or Edge on the computer, Diapo opens in a window of its
own and closing it quits Diapo; without them it opens in a tab of your usual
browser.

Diapo opens on its welcome screen: **New deck**, **Open**, **Import** and **Try
the sample deck**, the folder your decks are in (with **Change folder...**), and
your recent decks with a picture of their first slide. The first time, try **Try
the sample deck**: a tour of the editor, made with the editor, that you can
change freely. Your own decks never mix with it.

## Your first deck

1. **New deck** (on the welcome screen, or in the **File** menu, top left) shows
   the designs in a large gallery: filter them by Light or Dark and by style,
   look at one more closely, type a name and press **Create**. The deck is a
   folder with an `index.html` inside, named as you typed. Arrows, Enter and
   Tab do it all from the keyboard.
2. **File > Open...** (Ctrl+O) lists the decks in your folder by name, with a
   picture of the first slide. **File > Change folder...** picks another folder.
3. **File > Import...** turns a PowerPoint (.pptx) or Markdown (.md) file into a
   deck you can edit like any other.

A deck is one HTML file (plus its `assets/` folder for pictures). It opens in
any browser, without Diapo, and presents on its own.

## Edit

- **Click** selects, **double-click** edits text, **Esc** finishes. **Drag** to
  move, the handles to resize, the round handle on top to rotate. Hold **Shift**
  to keep proportions, **Ctrl** to stop snapping.
- **Insert** (top bar) adds text, lists, tables, charts, pictures, video,
  shapes and icons to the current slide, in a free spot (the centre when it is
  free). You can also **drag pictures, video or sound** from your folders onto
  the slide; a PowerPoint or Markdown file dragged into the window becomes a
  new deck. **Interactive chart (Plotly)...** takes a Plotly figure (paste what
  `fig.to_json()` gives, or choose the file `fig.write_html()` saved): on the
  slide it is a picture you move and size like any other, and when you present
  (F5, or the saved deck) it is live: hover, zoom, click the legend.
- The **panel on the right** changes what is selected: colour, text, and below,
  folded until you open them, Box, Animation, Align, Position and Link. With
  nothing selected it shows the slide: its name, transition, background and
  speaker notes.
- **Ctrl+Z** undoes anything, **Ctrl+Y** redoes. **Ctrl+K** finds any action,
  slide, layout, icon or font by typing its name. **Ctrl+F** finds text anywhere in the deck (Ctrl+H replaces it, all in one undo step); **Look > Check spelling while typing** marks misspelt words while you edit.
- **Ctrl+M** adds a slide with a layout; right-click a slide in the strip for
  more (duplicate, move, skip, start a section). Ctrl+click or Shift+click
  slides in the strip to pick several, then drag one of them (or Ctrl+Up /
  Ctrl+Down, or Move to... on the menu) to move them all at once.
- **Theme** (Ctrl+T) changes the whole deck at once: its colours, fonts and
  text styles, and how things move.

## Present

- **Preview** (F5) shows the deck full screen in the window; Esc comes back.
- **Presenter** (P) opens a second window with the next slide, your notes and
  a timer; put it on your laptop screen and the deck on the projector.
- In the saved file, on any computer: **P** presenter view, **O** overview,
  **L** laser pointer, **D** draw on the slide, **A** run by itself. Press
  **?** to see the keys over the deck; a deck opened on its own says
  "Press ? for keys" for a few seconds.

## Save and share

- **Save** (Ctrl+S) writes the deck. The version before is kept: **File >
  Previous versions** lists them and brings one back. The **File** menu also
  renames and duplicates the deck.
- Unsaved changes are kept aside as you work; if the window closes, Diapo
  offers them back the next time the deck opens.
- **Export > PDF** (Ctrl+P) prints one page per slide; **PDF with notes** adds
  your speaker notes under each slide.
- **Export > Single HTML file** puts everything (pictures, fonts) into one file
  to send by email or put online.
- **File > Save as** (Ctrl+Shift+S) copies the deck with its pictures to another
  name or folder.

## A deck with scripts of its own

Some decks, often ones written by hand or by an AI assistant, run scripts of
their own (a chart library, an animation). A script in a deck could read or
change files on your computer, so Diapo pauses them and says so in a bar at the
top. Choose **Trust this deck** only for decks you made or whose source you
know; the deck then opens again with its scripts running. Decks made with
Diapo never need it.

