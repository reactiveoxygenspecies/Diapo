# Third-party notices

Diapo is written by Daniele Rossetto and licensed under the MIT Licence
(`LICENSE`). It includes or uses the following work of other authors, each under
its own licence. All of them permit commercial use; the obligations they carry
(keeping a notice, giving attribution) are met as described here.

Last reviewed: 17 October 2026 (MathJax and SmilesDrawer added); before that 20 September 2026, for Diapo 0.1.2.

| Component | Where | Licence | Obligation |
|---|---|---|---|
| beautiful-html-templates (Zara Zhang) | `deck-editor/app/templates/{8-bit-orbit,block-frame,neo-grid-bold,sakura-chroma,studio}.html`, their previews, and the sources in `deck-editor/tools/bht-src/` | MIT | Keep the copyright and permission notice (below, and `app/templates/LICENSE-beautiful-html-templates.txt`) |
| frontend-slides (Zara Zhang) | `skills/diapo-deck/STYLE_PRESETS.md`, `skills/diapo-deck/bold-template-pack/` (design.md, preview.md, selection-index.json) | MIT | Keep the copyright and permission notice (below, and `skills/diapo-deck/LICENSE-frontend-slides.txt`) |
| Font Awesome Free 7.3.1 (Fonticons, Inc.) | `deck-editor/app/icons/fontawesome.json` (built by `tools/build-fa.js` from the npm package; the package itself is not shipped) | Icons CC BY 4.0, code MIT (the fonts, SIL OFL 1.1, are not used) | Attribution: this file, and the `<!--!Font Awesome Free ...-->` comment the editor writes into every inserted icon |
| MathJax 3.2.2 (The MathJax Consortium; mhchem by Martin Hensel) | `deck-editor/app/vendor/mathjax-tex-svg.js` (copied by `tools/build-vendor.js` from the npm package), loaded into the editor to draw equations; decks hold only the SVG it draws | Apache 2.0 | Ship the licence (`app/vendor/LICENSE-mathjax.txt`) and keep its notices; the file is unmodified but for a one-line header |
| MathJax 4.1.3 with its STIX Two font and mhchem font extension (The MathJax Consortium; glyphs from STIX Two Math, The STIX Fonts Project) | `deck-editor/app/vendor/mathjax4/` (copied by `tools/build-vendor.js` from the npm tarballs), loaded into a frame of the editor for the STIX Two look of equations; decks hold only the SVG it draws | Apache 2.0; the STIX Two glyph outlines SIL OFL 1.1 | Ship the Apache licence (`app/vendor/LICENSE-mathjax.txt`); the OFL allows the outlines in documents (below) |
| SmilesDrawer 2.4.1 (GDB / Reymond Research Group), with chroma.js (Gregor Aisch) inside | `deck-editor/app/vendor/smiles-drawer.min.js` (copied by `tools/build-vendor.js`), loaded into the editor to draw chemical structures; decks hold only the SVG it draws | MIT; chroma.js BSD-3-Clause, its ColorBrewer colours Apache 2.0 | Keep the copyright and permission notices (`app/vendor/LICENSE-smiles-drawer.txt`, `LICENSE-chroma-js.txt`, summarised below) |
| Anton (The Anton Project Authors) | `deck-editor/app/brand/anton-latin.woff2`, the face of the logo; its outlines in `logo.svg` and `logo-dark.svg` | SIL OFL 1.1 | Keep the notice below; the font is not sold on its own and is shipped unmodified |
| Google Fonts | Referenced by URL from templates and decks; downloaded or embedded into a deck only on request | SIL OFL 1.1, Apache 2.0 or Ubuntu Font Licence, per family | None for referencing; embedding in documents is permitted; the files are not modified |
| Python (Python Software Foundation) | Runtime of `serve.py`; bundled into `dist/deck-editor.exe` by `build-exe.py` | PSF Licence | Keep the PSF notice when the executable is shipped |
| Tcl/Tk (Regents of the University of California, Sun Microsystems, Scriptics, ActiveState and others) | File dialogs via tkinter; bundled into the executable | BSD-style Tcl/Tk licence | Keep the notice when the executable is shipped |
| PyInstaller | Build tool for the executable; its bootloader is embedded in the executable | GPL 2.0 with the PyInstaller bootloader exception | None: the exception allows the built executable to be distributed under any licence |
| Playwright (Microsoft) | Tests only (`tests/`, `tools/shots.js`); not shipped | Apache 2.0 | None |

Not third-party, and published on its own: the Diapo Format (`diapo-format/`:
`deck-base.css`, `deck-controller.js`, `deck-runtime.js` and the file
contract), written by the same author and published under the MIT Licence
(`diapo-format/LICENSE`) so that every deck stays free to share. The copies of
those files inside the editor (`app/deck-runtime.js`, the base and controller
blocks of every template, and `skills/diapo-deck/`) are the same MIT code.
The diapo-deck skill (`skills/diapo-deck/`, instructions, scripts and style
material for AI agents that generate decks) is MIT as well
(`skills/diapo-deck/LICENSE`).

Also related: the deck file format borrows attribute names
from reveal.js (`data-fragment`, `data-auto-animate`, `aside.notes`) and the
Markdown import reads Marp / reveal-md style files; no code from those
projects is used. The user's browser (Chrome or Edge) prints the PDFs and is
not distributed.


## beautiful-html-templates

https://github.com/zarazhangrui/beautiful-html-templates

```
MIT License

Copyright (c) 2026 Zara Zhang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```


## frontend-slides

https://github.com/zarazhangrui/frontend-slides

```
MIT License

Copyright (c) 2025 Zara Zhang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The design documents in the bold template pack mention fonts served by
Fontshare and by Chinese font CDNs (cn-fontsource, chinese-fonts-cdn). Those
fonts are not bundled and the editor's own templates do not use them; a deck
generated from such a design loads them from the CDN under the font's own
licence (Fontshare's ITF Free Font Licence; the Chinese families named are
published under the SIL OFL). Check a font's licence before self-hosting it.


## Font Awesome Free 7.3.1

https://fontawesome.com - https://fontawesome.com/license/free

Font Awesome Free is free, open source, and GPL friendly. Icons are licensed
under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), fonts under
SIL OFL 1.1 (https://scripts.sil.org/OFL) and code under the MIT License
(https://opensource.org/licenses/MIT). Attribution is required by the CC BY
licence; Font Awesome asks that the following comment stay in the SVG:

```
<!--!Font Awesome Free 7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.-->
```

The editor writes that comment into every icon it inserts (as an inline
`<svg>` whose path is copied unchanged from the package), and the catalog
`app/icons/fontawesome.json` carries it too. Brand icons are trademarks of
their owners; Font Awesome's licence allows them only to represent the brand
they depict.

Font Awesome and the Font Awesome logo are trademarks of Fonticons, Inc.; the
name is used here only to identify the icon set.


## MathJax 3.2.2

https://www.mathjax.org - Apache License 2.0 - Copyright (c) 2009-2022 The
MathJax Consortium; the mhchem extension Copyright (c) 2015-2021 Martin Hensel.

`app/vendor/mathjax-tex-svg.js` is MathJax's `es5/tex-svg-full.js`, copied
unchanged apart from a one-line comment naming it. The full licence text is in
`app/vendor/LICENSE-mathjax.txt`. It runs in the editor only: what goes into a
deck is the SVG drawing it produces (paths, no fonts, no code), together with
the LaTeX the user typed.

MathJax 4.1.3 (`app/vendor/mathjax4/`: the `tex-mml-svg-mathjax-stix2.js`
component of `@mathjax/mathjax-stix2-font`, the TeX extensions of `mathjax`,
the extra glyph files of the STIX Two font and `@mathjax/mathjax-mhchem-font-extension`)
is Apache License 2.0 as well, same licence file. It draws the "STIX Two" look in
a frame of the editor. Its glyphs are the outlines of STIX Two Math, Copyright
(c) 2001-2021 The STIX Fonts Project Authors, published under the SIL Open Font
License 1.1 (https://openfontlicense.org), which allows a font's outlines to be
embedded in documents: a deck receives those outlines as SVG paths, never a
font file.


## SmilesDrawer 2.4.1 and chroma.js

https://github.com/reymond-group/smilesDrawer - MIT License - Copyright (c)
2017 GDB / Reymond Research Group. The authors ask that work using it cite
D. Probst and J.-L. Reymond, "SmilesDrawer: Parsing and Drawing SMILES-Encoded
Molecular Structures Using Client-Side JavaScript", J. Chem. Inf. Model. 2018,
58 (1), 1-7, doi:10.1021/acs.jcim.7b00425.

Its bundle includes chroma.js, Copyright (c) 2011-2024 Gregor Aisch,
BSD 3-Clause License, with colours from ColorBrewer (Copyright (c) 2002 Cynthia
Brewer, Mark Harrower and The Pennsylvania State University, Apache License
2.0). Both licences require their copyright and permission notices to travel
with the code: the full texts ship beside it, in
`app/vendor/LICENSE-smiles-drawer.txt` and `app/vendor/LICENSE-chroma-js.txt`.

`app/vendor/smiles-drawer.min.js` is the package's `dist/smiles-drawer.min.js`
with a one-line comment added. It runs in the editor only; a deck receives the
SVG drawing and the SMILES.


## Anton

https://github.com/googlefonts/AntonFont - https://fonts.google.com/specimen/Anton

Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is available with a FAQ at: https://openfontlicense.org

Anton sets the word in the Diapo logo. The editor ships the latin subset as
served by Google Fonts (`deck-editor/app/brand/anton-latin.woff2`, version
2.116), unmodified, for its own chrome only: it is not offered to decks, not
sold separately, and the word in `logo.svg` is drawn from its outlines. The
OFL allows all of this; it asks that the copyright and licence notice above
stay with the font, which this file and the header of `editor.css` do.

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.


## Google Fonts

https://fonts.google.com - https://developers.google.com/fonts/faq

Every family on Google Fonts is published under an open licence: the SIL Open
Font License 1.1 for most, Apache License 2.0 (for example Roboto, Open Sans)
or the Ubuntu Font Licence (Ubuntu). All three allow commercial use, embedding
in documents and self-hosting; the OFL asks that a modified font be renamed and
that the font not be sold by itself, neither of which the editor does. The
editor requests a family's CSS and woff2 files from fonts.googleapis.com and
fonts.gstatic.com only when the user looks a family up, downloads it into
`fonts/` or embeds it in a deck, and writes them unchanged. The licence of
each family is shown on its Google Fonts page.


## Python

https://www.python.org - https://docs.python.org/3/license.html

`serve.py` and `import_deck.py` use only the Python standard library (no
packages are installed). The single-file executable built by `build-exe.py`
bundles the Python interpreter and the standard library modules it uses,
licensed under the PSF License Agreement for Python. When the executable is
shipped, include Python's `LICENSE.txt` (found in the Python installation the
executable was built with) next to this file.

```
PSF LICENSE AGREEMENT FOR PYTHON 3

1. This LICENSE AGREEMENT is between the Python Software Foundation ("PSF"),
and the Individual or Organization ("Licensee") accessing and otherwise using
Python software in source or binary form and its associated documentation.

2. Subject to the terms and conditions of this License Agreement, PSF hereby
grants Licensee a nonexclusive, royalty-free, world-wide license to reproduce,
analyze, test, perform and/or display publicly, prepare derivative works,
distribute, and otherwise use Python alone or in any derivative version,
provided, however, that PSF's License Agreement and PSF's notice of copyright,
i.e., "Copyright (c) 2001 Python Software Foundation; All Rights Reserved" are
retained in Python alone or in any derivative version prepared by Licensee.

3. In the event Licensee prepares a derivative work that is based on or
incorporates Python or any part thereof, and wants to make the derivative work
available to others as provided herein, then Licensee hereby agrees to include
in any such work a brief summary of the changes made to Python.

4. PSF is making Python available to Licensee on an "AS IS" basis. PSF MAKES
NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT
NOT LIMITATION, PSF MAKES NO AND DISCLAIMS ANY REPRESENTATION OR WARRANTY OF
MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF PYTHON
WILL NOT INFRINGE ANY THIRD PARTY RIGHTS.

5. PSF SHALL NOT BE LIABLE TO LICENSEE OR ANY OTHER USERS OF PYTHON FOR ANY
INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES OR LOSS AS A RESULT OF MODIFYING,
DISTRIBUTING, OR OTHERWISE USING PYTHON, OR ANY DERIVATIVE THEREOF, EVEN IF
ADVISED OF THE POSSIBILITY THEREOF.

6. This License Agreement will automatically terminate upon a material breach
of its terms and conditions.

7. Nothing in this License Agreement shall be deemed to create any
relationship of agency, partnership, or joint venture between PSF and
Licensee. This License Agreement does not grant permission to use PSF
trademarks or trade name in a trademark sense to endorse or promote products
or services of Licensee, or any third party.

8. By copying, installing or otherwise using Python, Licensee agrees to be
bound by the terms and conditions of this License Agreement.
```

Python is not modified (clause 3: no changes).


## Tcl/Tk

https://www.tcl.tk/software/tcltk/license.html

tkinter (the file dialogs) links Tcl/Tk, which the executable bundles.
Tcl/Tk is distributed under a BSD-style licence that permits use, copying,
modification and distribution for any purpose provided the existing copyright
notices are retained and the licence notice is included verbatim in any
distribution. When the executable is shipped, include the `license.terms`
file from the Python installation's `tcl/` folder next to this file.


## PyInstaller

https://pyinstaller.org - https://pyinstaller.org/en/stable/license.html

PyInstaller is licensed under the GNU General Public License v2 (or later)
with a special exception: the bootloader that PyInstaller embeds in the
executables it builds may be distributed under any licence, so bundling with
PyInstaller does not make the executable GPL. PyInstaller itself is a build
dependency (`pip install pyinstaller`) and is not shipped.


## Playwright

https://playwright.dev - Apache License 2.0

`@playwright/test` is a development dependency for the acceptance tests and
the template screenshots (`tools/shots.js`). It is not part of the product.
