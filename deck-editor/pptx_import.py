"""PowerPoint (.pptx) -> deck, in the markup of app/templates/blank.html.

What is carried over (standard library only; import_deck.import_file calls
import_pptx):

  - the slide size (a 1920px-wide stage whose height keeps the file's
    proportions), every shape's position, size, rotation and flip, z-order;
  - the theme: scheme colours with their modifiers (lumMod, tint, shade,
    alpha...), the colour map of the master, theme fonts, and the style
    references (fillRef / lnRef / fontRef) that give theme shapes their
    default fill, outline and text colour;
  - backgrounds (solid, gradient, picture) and the decorative shapes of the
    master and the layout, drawn into every slide that shows them;
  - text with the full inheritance chain (run < paragraph < shape list style
    < layout placeholder < master placeholder < master text styles <
    presentation defaults): size, bold, italic, underline, strike, super /
    subscript, font, colour, alignment, line spacing, space before / after,
    bullets (the glyph itself, numbered lists), indent levels, autofit
    shrink, vertical anchor and insets;
  - shapes: preset geometries (rectangles, ellipses, triangles, diamonds,
    chevrons, arrows, stars, hexagons and more, as the editor's own SVG
    shapes), solid and gradient fills, outlines with dashes, simple
    shadows; lines and connectors with arrowheads; groups (flattened,
    scaled when the group is);
  - pictures (copied into assets/, cropped, rounded, flipped, transparent;
    Windows metafiles, .emf / .wmf, which browsers do not draw, turned into
    SVG by emf_svg.py), embedded objects (Excel, ChemDraw, equations...) as
    the picture PowerPoint keeps of them, ink and other newer content as the
    fallback PowerPoint saves for older readers, tables (column widths, merged cells, cell fills, per-cell alignment,
    the table style's header and banding), charts (bar / column, line,
    pie / doughnut, area drawn as inline SVG), SmartArt (from the drawing
    PowerPoint saves beside it), speaker notes, hidden slides (data-skip);
  - hyperlinks on text.

Not carried over: effects beyond a simple shadow, 3-D, WordArt text fills,
animations and transitions, embedded video and audio, the embedded objects
themselves (only their pictures).
"""
import base64
import colorsys
import copy
import json
import math
import os
import re
import xml.etree.ElementTree as ET
import zipfile
import zlib

from import_deck import attr, build_deck, esc, section, slug

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "dsp": "http://schemas.microsoft.com/office/drawing/2008/diagram",
    "dgm": "http://schemas.openxmlformats.org/drawingml/2006/diagram",
    "asvg": "http://schemas.microsoft.com/office/drawing/2016/SVG/main",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
}
METAFILES = (".emf", ".wmf", ".emz", ".wmz")
# How large a part of the file may be once unpacked. A .pptx from someone else can declare
# a part of many gigabytes that packs into a few kilobytes; real decks stay far below these
# (a slide or a chart is kilobytes of XML, a metafile a few megabytes, a video hundreds).
MAX_XML_PART = 64 * 1024 * 1024
MAX_METAFILE = 64 * 1024 * 1024        # packed or unpacked (.emz / .wmz)
MAX_MEDIA_PART = 1024 * 1024 * 1024
# The master's placeholder a layout placeholder of each type inherits from. A master has
# only title, body, date, footer and slide number: content, subtitle, picture, table,
# chart and every other kind take the body's text styles.
MASTER_PH_TYPE = {"title": "title", "ctrTitle": "title", "dt": "dt", "ftr": "ftr", "sldNum": "sldNum", "hdr": "hdr"}
EMU_PER_PT = 12700
STAGE_W = 1920


def q(tag):
    p, t = tag.split(":")
    return "{%s}%s" % (NS[p], t)


def fnum(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def css_px(v):
    """A CSS length from a float: integers stay integers."""
    r = round(v, 1)
    return str(int(r)) if r == int(r) else str(r)


# ------------------------------------------------------------------
# Colours
# ------------------------------------------------------------------
PRESET_COLOURS = {"black": "000000", "white": "ffffff", "red": "ff0000", "green": "008000", "blue": "0000ff", "yellow": "ffff00",
                  "gray": "808080", "grey": "808080", "darkGray": "a9a9a9", "lightGray": "d3d3d3", "orange": "ffa500", "purple": "800080"}


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return "%02x%02x%02x" % tuple(max(0, min(255, int(round(c)))) for c in rgb)


def to_linear(c):
    """sRGB channel (0..1) to linear light."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def from_linear(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def apply_modifiers(hexcol, node):
    """The child elements of a colour (lumMod, lumOff, tint, shade, alpha, satMod ...)
    applied to a hex colour; returns (hex, alpha 0..1)."""
    r, g, b = [c / 255.0 for c in hex_to_rgb(hexcol)]
    alpha = 1.0
    for m in node:
        tag = m.tag.split("}")[-1]
        val = fnum(m.get("val")) / 100000.0
        if tag == "alpha":
            alpha = val
        elif tag in ("lumMod", "lumOff", "satMod", "satOff", "hueMod", "hueOff"):
            h, l, s = colorsys.rgb_to_hls(r, g, b)
            if tag == "lumMod":
                l *= val
            elif tag == "lumOff":
                l += val
            elif tag == "satMod":
                s *= val
            elif tag == "satOff":
                s += val
            elif tag == "hueMod":
                h = (h * val) % 1.0
            elif tag == "hueOff":
                h = (h + fnum(m.get("val")) / 21600000.0) % 1.0
            l, s = max(0.0, min(1.0, l)), max(0.0, min(1.0, s))
            r, g, b = colorsys.hls_to_rgb(h, l, s)
        elif tag == "tint":                      # towards white, in linear light as PowerPoint does
            r, g, b = (from_linear(1 - (1 - to_linear(c)) * val) for c in (r, g, b))
        elif tag == "shade":                     # towards black, in linear light
            r, g, b = (from_linear(to_linear(c) * val) for c in (r, g, b))
        elif tag == "inv":
            r, g, b = 1 - r, 1 - g, 1 - b
        elif tag == "gray":
            y = 0.299 * r + 0.587 * g + 0.114 * b
            r = g = b = y
    return rgb_to_hex((r * 255, g * 255, b * 255)), alpha


class Theme:
    """The colour scheme (with the master's colour map), the fonts and the
    format scheme (fill / line / effect style lists used by style references)."""

    def __init__(self, root, clr_map, part=None):
        self.part = part                                   # the theme's zip name, for pictures its fills refer to
        self.colours = {}
        cs = root.find("a:themeElements/a:clrScheme", NS)
        if cs is not None:
            for child in cs:
                name = child.tag.split("}")[-1]
                src = child.find("a:srgbClr", NS)
                sysc = child.find("a:sysClr", NS)
                self.colours[name] = (src.get("val") if src is not None else (sysc.get("lastClr") if sysc is not None else "000000")).lower()
        self.map = dict(clr_map or {})
        fs = root.find("a:themeElements/a:fontScheme", NS)
        self.major = self.minor = None
        if fs is not None:
            mj, mn = fs.find("a:majorFont/a:latin", NS), fs.find("a:minorFont/a:latin", NS)
            self.major = mj.get("typeface") if mj is not None else None
            self.minor = mn.get("typeface") if mn is not None else None
        fmt = root.find("a:themeElements/a:fmtScheme", NS)
        self.fills = fmt.findall("a:fillStyleLst/*", NS) if fmt is not None else []
        self.lines = fmt.findall("a:lnStyleLst/*", NS) if fmt is not None else []
        self.bg_fills = fmt.findall("a:bgFillStyleLst/*", NS) if fmt is not None else []

    def scheme(self, name):
        name = self.map.get(name, name)
        # the map's own names: bg1 -> lt1 etc. already resolved; text/background aliases
        alias = {"bg1": "lt1", "tx1": "dk1", "bg2": "lt2", "tx2": "dk2"}
        name = alias.get(name, name)
        return self.colours.get(name, "000000")

    def font(self, typeface):
        if typeface in ("+mj-lt", "+mj-ea", "+mj-cs"):
            return self.major
        if typeface in ("+mn-lt", "+mn-ea", "+mn-cs"):
            return self.minor
        return typeface


def colour_of(node, theme, ph_colour=None):
    """(hex, alpha) of a colour element (srgbClr / schemeClr / sysClr / prstClr /
    scrgbClr / hslClr), or None. ph_colour replaces schemeClr val="phClr"."""
    if node is None:
        return None
    tag = node.tag.split("}")[-1]
    if tag == "srgbClr":
        base = node.get("val", "000000").lower()
    elif tag == "schemeClr":
        v = node.get("val")
        if v == "phClr":
            if not ph_colour:
                return None
            base = ph_colour
        else:
            base = theme.scheme(v) if theme else "000000"
    elif tag == "sysClr":
        base = (node.get("lastClr") or "000000").lower()
    elif tag == "prstClr":
        base = PRESET_COLOURS.get(node.get("val", ""), "000000")
    elif tag == "scrgbClr":
        base = rgb_to_hex(tuple(fnum(node.get(k)) / 100000.0 * 255 for k in ("r", "g", "b")))
    elif tag == "hslClr":
        h, s, l = fnum(node.get("hue")) / 21600000.0, fnum(node.get("sat")) / 100000.0, fnum(node.get("lum")) / 100000.0
        base = rgb_to_hex(tuple(c * 255 for c in colorsys.hls_to_rgb(h, l, s)))
    else:
        return None
    return apply_modifiers(base, node)


def first_colour(parent, theme, ph_colour=None):
    """The colour element directly under parent (a solidFill, a gs, a line fill)."""
    if parent is None:
        return None
    for child in parent:
        c = colour_of(child, theme, ph_colour)
        if c:
            return c
    return None


def css_colour(c):
    if not c:
        return None
    h, a = c
    if a >= 0.995:
        return "#" + h
    r, g, b = hex_to_rgb(h)
    return f"rgba({r},{g},{b},{a:.2f})"


# Bullet characters of the symbol fonts PowerPoint uses, as Unicode; anything
# else from those fonts becomes a plain bullet (a text font would show a box).
SYMBOL_BULLETS = {
    "Wingdings": {"\u00a7": "\u25aa", "n": "\u25a0", "l": "\u25cf", "q": "\u2751", "v": "\u2756", "\u00d8": "\u27a2", "\u00fc": "\u2713",
                  "\u00fb": "\u2717", "\u00e8": "\u2192", "\u0080": "\u25a3", "p": "\u2610", "o": "\u25ab", "w": "\u2666", "\u00a8": "\u25a1",
                  "\u00b2": "\u2460", "F": "\u261e", "J": "\u263a", "u": "\u25c6", "\u00a1": "\u25cb"},
    "Wingdings 2": {"\u00d8": "\u2022", "\u0098": "\u25cf", "\u0099": "\u25cf", "\u0097": "\u25cf", "\u0096": "\u25cf", "\u00da": "\u25a0"},
    "Wingdings 3": {"u": "\u25b6", "\u0080": "\u25b8", "\u0084": "\u25b8", "\u00b4": "\u279c","\u00fc": "\u25b6", "\u2022": "\u25b8", "}": "\u25b8", "\u00d5": "\u2192", "\u00da": "\u25b8"},
    "Symbol": {"\u00b7": "\u2022", "\u00d8": "\u2022", "\u00b8": "\u2022", "\u00d7": "\u2022", "-": "\u2013", "\u00d1": "\u25a0"},
    "Courier New": {"o": "o"},
}


def bullet_glyph(char, font):
    if len(char) == 1 and 0xF000 <= ord(char) <= 0xF0FF:  # symbol-font characters are stored in the private use area
        char = chr(ord(char) - 0xF000)
    if font in SYMBOL_BULLETS:
        return SYMBOL_BULLETS[font].get(char, "\u2022")
    if font and font.startswith("Wingdings"):
        return "\u2022"
    return char


# ------------------------------------------------------------------
# Fills
# ------------------------------------------------------------------
def fill_css(node, theme, ph_colour=None, pictures=None):
    """CSS background for a fill element's parent (spPr, bgPr, a theme fill).
    Returns (css value, kind) where kind is 'none' | 'solid' | 'gradient' | 'picture'
    | None (no fill element). pictures resolves a blip r:embed to an assets/ path."""
    if node is None:
        return None, None
    for child in node:
        tag = child.tag.split("}")[-1]
        if tag == "noFill":
            return "transparent", "none"
        if tag == "solidFill":
            c = css_colour(first_colour(child, theme, ph_colour))
            return (c, "solid") if c else (None, None)
        if tag == "gradFill":
            return gradient_css(child, theme, ph_colour), "gradient"
        if tag == "pattFill":
            fg = css_colour(first_colour(child.find("a:fgClr", NS), theme, ph_colour))
            return (fg, "solid") if fg else (None, None)
        if tag == "blipFill" and pictures is not None:
            blip = child.find("a:blip", NS)
            src = pictures(blip.get(q("r:embed"))) if blip is not None else None
            if src:
                tile = child.find("a:tile", NS) is not None
                # a:stretch fills the box exactly (PowerPoint's default for backgrounds); a tile repeats
                pic = f"url('{src}') " + ("repeat" if tile else "center / 100% 100% no-repeat")
                duo = blip.find("a:duotone", NS)
                if duo is not None:
                    # a duotone texture: PowerPoint maps the picture's luminance from the first colour
                    # (black) to the second (white). A stretched picture gets exactly that, as an SVG
                    # asset with a filter; a tiled one the light colour with the picture blended in.
                    cols = [colour_of(c, theme, ph_colour) for c in duo]
                    cols = [c for c in cols if c]
                    duotone = getattr(pictures, "duotone", None)
                    if len(cols) >= 2 and not tile and duotone:
                        recoloured = duotone(blip.get(q("r:embed")), cols[0][0], cols[-1][0])
                        if recoloured:
                            return f"url('{recoloured}') center / 100% 100% no-repeat", "picture"
                    if cols:
                        light = css_colour(cols[-1])
                        r, g, b = hex_to_rgb(cols[-1][0])
                        # the picture multiplied into the light colour, lifted by half of it: dark
                        # parts of the texture end at half the colour, light parts at the colour
                        return f"linear-gradient(rgba({r},{g},{b},0.5), rgba({r},{g},{b},0.5)), {pic}, {light}; background-blend-mode: normal, multiply", "picture"
                return pic, "picture"
            return None, None
        if tag == "grpFill":
            return None, None
    return None, None


def gradient_css(grad, theme, ph_colour=None):
    stops = []
    for gs in grad.findall("a:gsLst/a:gs", NS):
        c = css_colour(first_colour(gs, theme, ph_colour))
        if c:
            stops.append((fnum(gs.get("pos")) / 1000.0, c))
    if not stops:
        return None
    stops.sort()
    lin = grad.find("a:lin", NS)
    path = grad.find("a:path", NS)
    stop_css = ", ".join(f"{c} {p:g}%" for p, c in stops)
    if path is not None and path.get("path") in ("circle", "rect"):
        return f"radial-gradient(circle at center, {stop_css})"
    ang = (fnum(lin.get("ang")) / 60000.0) if lin is not None else 90.0
    # OOXML angles go clockwise from the x axis; CSS gradient angles from the top, clockwise.
    css_ang = (ang + 90) % 360
    return f"linear-gradient({css_ang:g}deg, {stop_css})"


# ------------------------------------------------------------------
# Geometry: preset shapes as paths on a 100x100 grid (the editor's own convention,
# stretched to the box with preserveAspectRatio="none")
# ------------------------------------------------------------------
def _star(n, inner):
    pts = []
    for i in range(2 * n):
        r = 48 if i % 2 == 0 else 48 * inner
        a = -math.pi / 2 + i * math.pi / n
        pts.append(f"{50 + r * math.cos(a):.1f} {50 + r * math.sin(a):.1f}")
    return "M" + " L".join(pts) + "Z"


def _poly(n, rot=-90):
    pts = []
    for i in range(n):
        a = math.radians(rot + i * 360.0 / n)
        pts.append(f"{50 + 48 * math.cos(a):.1f} {50 + 48 * math.sin(a):.1f}")
    return "M" + " L".join(pts) + "Z"


PRESET_PATHS = {
    "triangle": "M50 0 100 100H0Z",
    "rtTriangle": "M0 0 100 100H0Z",
    "diamond": "M50 0 100 50 50 100 0 50Z",
    "hexagon": "M25 0H75L100 50 75 100H25L0 50Z",
    "pentagon": _poly(5),
    "octagon": "M29 0H71L100 29V71L71 100H29L0 71V29Z",
    "heptagon": _poly(7),
    "decagon": _poly(10),
    "parallelogram": "M25 0H100L75 100H0Z",
    "trapezoid": "M25 0H75L100 100H0Z",
    "chevron": "M0 0H70L100 50 70 100H0L30 50Z",
    "homePlate": "M0 0H70L100 50 70 100H0Z",
    "rightArrow": "M0 30H60V6L100 50 60 94V70H0Z",
    "leftArrow": "M100 30H40V6L0 50 40 94V70H100Z",
    "upArrow": "M30 100V40H6L50 0 94 40H70V100Z",
    "downArrow": "M30 0V60H6L50 100 94 60H70V0Z",
    "leftRightArrow": "M0 50 25 10V35H75V10L100 50 75 90V65H25V90Z",
    "star5": _star(5, 0.38), "star4": _star(4, 0.45), "star6": _star(6, 0.55), "star8": _star(8, 0.65),
    "star10": _star(10, 0.7), "star12": _star(12, 0.75), "star16": _star(16, 0.8), "star24": _star(24, 0.85),
    "plus": "M35 0H65V35H100V65H65V100H35V65H0V35H35Z",
    "wedgeRectCallout": "M0 0H100V70H45L25 95V70H0Z",
    "wedgeRoundRectCallout": "M8 0H92a8 8 0 0 1 8 8V62a8 8 0 0 1-8 8H45L25 95V70H8a8 8 0 0 1-8-8V8a8 8 0 0 1 8-8Z",
    "cloudCallout": None, "cloud": None,
    "flowChartProcess": None, "flowChartDecision": "M50 0 100 50 50 100 0 50Z", "flowChartTerminator": "roundfull",
    "flowChartAlternateProcess": "round", "flowChartConnector": "ellipse", "flowChartDocument": "M0 0H100V85Q75 70 50 85T0 100Z",
    "snip1Rect": "M0 0H80L100 20V100H0Z", "snip2SameRect": "M20 0H80L100 20V100H0V20Z",
    "round1Rect": "M0 0H80a20 20 0 0 1 20 20V100H0Z", "round2SameRect": "M20 0H80a20 20 0 0 1 20 20V100H0V20a20 20 0 0 1 20-20Z",
    "round2DiagRect": "M20 0H100V80a20 20 0 0 1-20 20H0V20A20 20 0 0 1 20 0Z",
    "ellipse": "ellipse", "rect": None, "roundRect": "round", "line": "line", "straightConnector1": "line",
    "bentConnector3": "line", "curvedConnector3": "line", "bentConnector2": "line",
    "teardrop": "M50 0H100V50A50 50 0 1 1 50 0Z", "heart": "M50 100 8 55A25 25 0 0 1 50 20 25 25 0 0 1 92 55Z",
    "donut": "ellipse", "noSmoking": "ellipse", "blockArc": None, "can": None, "cube": None,
    "mathPlus": "M40 0H60V40H100V60H60V100H40V60H0V40H40Z", "mathMinus": "M0 40H100V60H0Z",
    "arc": None, "bracketPair": None, "bracePair": None, "leftBracket": None, "rightBracket": None,
    "ribbon": None, "ribbon2": None, "verticalScroll": None, "horizontalScroll": None, "wave": None, "doubleWave": None,
    "frame": "M0 0H100V100H0ZM10 10V90H90V10Z",
    "lightningBolt": "M40 0 70 35 55 40 100 100 45 55 60 50 20 20Z", "sun": "ellipse", "moon": "M70 0A50 50 0 1 0 70 100 40 40 0 1 1 70 0Z",
    "smileyFace": "ellipse", "irregularSeal1": _star(12, 0.75), "irregularSeal2": _star(16, 0.72),
    "notchedRightArrow": "M0 30H60V6L100 50 60 94V70H0L15 50Z", "stripedRightArrow": "M20 30H60V6L100 50 60 94V70H20ZM0 30H12V70H0Z",
    "bentArrow": None, "uturnArrow": None, "curvedRightArrow": None, "quadArrow": None, "leftRightUpArrow": None,
    "actionButtonBlank": None, "actionButtonHome": None,
}


def preset_kind(prst):
    """'rect' | 'round' | 'roundfull' | 'ellipse' | 'line' | a path | None (unknown: rect)."""
    if prst is None or prst == "rect":
        return "rect"
    if prst == "custom":
        return "custom"
    v = PRESET_PATHS.get(prst)
    if v is None:
        return "rect"
    return v


# ------------------------------------------------------------------
# The importer
# ------------------------------------------------------------------
class Pptx:
    def __init__(self, path, deck_dir, notes):
        self.z = zipfile.ZipFile(path)
        self.deck_dir = deck_dir
        self.notes = notes
        self.names = set(self.z.namelist())
        self._xml_cache = {}
        self._rels_cache = {}
        self.copied = {}                                   # zip name -> assets/ path
        pres = self.xml("ppt/presentation.xml")
        sz = pres.find("p:sldSz", NS)
        self.cx = int(sz.get("cx")) if sz is not None else 12192000
        self.cy = int(sz.get("cy")) if sz is not None else 6858000
        self.stage_w = STAGE_W
        self.stage_h = max(100, round(STAGE_W * self.cy / self.cx))
        self.k = self.stage_w / self.cx                    # css px per EMU
        self.pt = self.k * EMU_PER_PT                      # css px per point
        self.default_text = pres.find("p:defaultTextStyle", NS)
        rels = self.rels("ppt/presentation.xml")
        self.slides = []
        lst = pres.find("p:sldIdLst", NS)
        for sid in (lst.findall("p:sldId", NS) if lst is not None else []):
            target = rels.get(sid.get(q("r:id")))
            if target:
                self.slides.append(target)
        self.svg_ids = 0

    # -- parts ----------------------------------------------------------
    def xml(self, name):
        if name not in self._xml_cache:
            data = self.part(name, MAX_XML_PART)
            if data is None:
                raise ValueError(f"this PowerPoint file has a part too large to read safely ({name})")
            self._xml_cache[name] = ET.fromstring(data)
        return self._xml_cache[name]

    def part(self, name, limit):
        """The bytes of a part, or None (with a note) when it unpacks to more than `limit`.
        zipfile stops at the size a part declares, so checking that size is enough."""
        size = self.z.getinfo(name).file_size
        if size > limit:
            self.notes.append(f"left out, too large to import safely: {os.path.basename(name)} ({size / 1048576:.0f} MB)")
            return None
        return self.z.read(name)

    @staticmethod
    def norm(name):
        parts = []
        for p in name.replace("\\", "/").split("/"):
            if p == "..":
                if parts:
                    parts.pop()
            elif p and p != ".":
                parts.append(p)
        return "/".join(parts)

    def rels(self, name):
        if name in self._rels_cache:
            return self._rels_cache[name]
        d, base = os.path.split(name)
        rn = (d + "/" if d else "") + "_rels/" + base + ".rels"
        out = {}
        if rn in self.names:
            for r in self.xml(rn).findall("rel:Relationship", NS):
                t = r.get("Target")
                if r.get("TargetMode") == "External":
                    target = t
                elif t.startswith("/"):
                    target = t[1:]
                else:
                    target = self.norm((d + "/" if d else "") + t)
                out[r.get("Id")] = target
                out.setdefault("type:" + r.get("Type").rsplit("/", 1)[-1], []).append(target)
        self._rels_cache[name] = out
        return out

    def asset(self, zip_name):
        """Copy a media part into assets/ once; returns 'assets/<name>' or None. A Windows
        metafile is converted on the way (to an SVG, or to the one picture it holds)."""
        if not zip_name or zip_name not in self.names:
            return None
        if zip_name in self.copied:
            return self.copied[zip_name]
        name = re.sub(r"[^\w.\-]+", "_", os.path.basename(zip_name))
        stem, ext = os.path.splitext(name)
        data = self.part(zip_name, MAX_METAFILE if ext.lower() in METAFILES else MAX_MEDIA_PART)
        if data is None:
            self.copied[zip_name] = None
            return None
        if ext.lower() in METAFILES:
            data, ext = self.metafile(data, ext.lower())
            if data is None:
                self.copied[zip_name] = None
                return None
            name = f"{stem}.{ext}"
        assets = os.path.join(self.deck_dir, "assets")
        os.makedirs(assets, exist_ok=True)
        dest = os.path.join(assets, name)
        n = 1
        while os.path.exists(dest):
            with open(dest, "rb") as f:
                if f.read() == data:
                    break
            n += 1
            stem, ext = os.path.splitext(name)
            dest = os.path.join(assets, f"{stem}-{n}{ext}")
        with open(dest, "wb") as f:
            f.write(data)
        self.copied[zip_name] = "assets/" + os.path.basename(dest)
        return self.copied[zip_name]

    def metafile(self, data, ext):
        """An .emf / .wmf part (or its gzipped .emz / .wmz) as (bytes, extension) a browser
        shows, or (None, None)."""
        from emf_svg import convert
        if ext in (".emz", ".wmz"):
            try:
                unpack = zlib.decompressobj(16 + zlib.MAX_WBITS)          # gzip, stopped at MAX_METAFILE
                data = unpack.decompress(data, MAX_METAFILE)
                if unpack.unconsumed_tail:
                    self.notes.append("left out, too large to import safely: a compressed Windows metafile picture")
                    return None, None
            except zlib.error:
                data = b""
        out = convert(data)
        if not out:
            self.notes.append("a Windows metafile picture (.emf / .wmf) could not be converted")
            return None, None
        return out[1], out[0]

    def duotone_asset(self, zip_name, dark, light):
        """A picture recoloured as PowerPoint's duotone does (its luminance mapped from `dark`
        to `light`, two hex colours), written as assets/<name>-duotone-<dark>-<light>.svg: an
        SVG with the picture inside as a data URI (an SVG shown as a CSS background loads no
        other file) and a filter that makes the mapping. None for a part that is not a picture."""
        mime = {".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".gif": "image/gif"}.get(
            os.path.splitext(zip_name or "")[1].lower())
        if not mime or zip_name not in self.names:
            return None
        key = (zip_name, dark, light)
        if key in self.copied:
            return self.copied[key]
        raw = self.part(zip_name, MAX_METAFILE)            # the picture goes inside the SVG as text
        if raw is None:
            self.copied[key] = None
            return None
        data = base64.b64encode(raw).decode("ascii")
        table = lambda i: f"{int(dark[i * 2:i * 2 + 2], 16) / 255:.4f} {int(light[i * 2:i * 2 + 2], 16) / 255:.4f}"
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">'
               '<filter id="duotone" color-interpolation-filters="sRGB">'
               '<feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/>'
               f'<feComponentTransfer><feFuncR type="table" tableValues="{table(0)}"/><feFuncG type="table" tableValues="{table(1)}"/>'
               f'<feFuncB type="table" tableValues="{table(2)}"/></feComponentTransfer></filter>'
               f'<image width="100" height="100" preserveAspectRatio="none" filter="url(#duotone)" href="data:{mime};base64,{data}"/></svg>')
        stem = re.sub(r"[^\w.\-]+", "_", os.path.splitext(os.path.basename(zip_name))[0])
        assets = os.path.join(self.deck_dir, "assets")
        os.makedirs(assets, exist_ok=True)
        name = f"{stem}-duotone-{dark}-{light}.svg"
        with open(os.path.join(assets, name), "w", encoding="utf-8") as f:
            f.write(svg)
        self.copied[key] = "assets/" + name
        return self.copied[key]

    def picture_resolver(self, rels):
        def resolve(rid):
            return self.asset(rels.get(rid)) if rid else None
        resolve.duotone = lambda rid, dark, light: self.duotone_asset(rels.get(rid), dark, light) if rid else None
        return resolve

    # -- slide context: master, layout, theme --------------------------------
    def context(self, slide_name):
        rels = self.rels(slide_name)
        layout = (rels.get("type:slideLayout") or [None])[0]
        master = (self.rels(layout).get("type:slideMaster") or [None])[0] if layout else None
        theme_part = (self.rels(master).get("type:theme") or [None])[0] if master else None
        clr_map = {}
        if master:
            cm = self.xml(master).find("p:clrMap", NS)
            if cm is not None:
                clr_map = dict(cm.attrib)
        # a layout or slide may override the map (rarely anything but masterClrMapping)
        for part in (layout, slide_name):
            if part:
                ov = self.xml(part).find("p:clrMapOvr/a:overrideClrMapping", NS)
                if ov is not None:
                    clr_map = dict(ov.attrib)
        theme = Theme(self.xml(theme_part) if theme_part else ET.Element("x"), clr_map, theme_part)
        return {"slide": slide_name, "layout": layout, "master": master, "theme": theme, "rels": rels}

    # -- geometry -----------------------------------------------------------
    def xfrm(self, node):
        """Geometry dict of an a:xfrm (or p:xfrm) element in EMU, or None."""
        if node is None:
            return None
        off, ext = node.find("a:off", NS), node.find("a:ext", NS)
        if off is None or ext is None:
            return None
        return {"x": int(off.get("x")), "y": int(off.get("y")), "w": int(ext.get("cx")), "h": int(ext.get("cy")),
                "rot": int(node.get("rot", "0")) / 60000.0, "flipH": node.get("flipH") == "1", "flipV": node.get("flipV") == "1"}

    def place(self, g, extra=""):
        """position:absolute box CSS for a geometry (already offset), with rotation and flips."""
        if not g:
            return "position:absolute; left:96px; top:72px; width:1728px;"
        css = f"position:absolute; left:{css_px(g['x'] * self.k)}px; top:{css_px(g['y'] * self.k)}px; width:{css_px(g['w'] * self.k)}px; height:{css_px(g['h'] * self.k)}px;"
        tf = []
        if g.get("rot"):
            css += f" rotate:{round(g['rot'], 1):g}deg;"
        if g.get("flipH"):
            tf.append("scaleX(-1)")
        if g.get("flipV"):
            tf.append("scaleY(-1)")
        if tf:
            css += " transform:" + " ".join(tf) + ";"
        return css + extra

    def transformed(self, g, tf):
        """A child geometry under a group transform (dx, dy, sx, sy, in EMU / factors)."""
        if not g or not tf:
            return g
        dx, dy, sx, sy = tf
        return dict(g, x=int(round(dx + g["x"] * sx)), y=int(round(dy + g["y"] * sy)), w=int(round(g["w"] * sx)), h=int(round(g["h"] * sy)))

    # -- placeholders and inheritance ----------------------------------------
    @staticmethod
    def ph_of(sp):
        ph = sp.find("p:nvSpPr/p:nvPr/p:ph", NS)
        if ph is None:
            ph = sp.find("p:nvPicPr/p:nvPr/p:ph", NS)
        if ph is None:
            ph = sp.find("p:nvGraphicFramePr/p:nvPr/p:ph", NS)
        return ph

    def matching_placeholder(self, part, typ, idx):
        """The placeholder shape in a layout / master part that a slide placeholder inherits from."""
        if not part:
            return None
        root = self.xml(part)
        title_like = ("title", "ctrTitle")
        best = None
        for cand in root.iter(q("p:sp")):
            cph = self.ph_of(cand)
            if cph is None:
                continue
            ctyp, cidx = cph.get("type", "body"), cph.get("idx")
            if idx is not None and cidx == idx:
                return cand
            same = ctyp == typ or (typ in title_like and ctyp in title_like)
            if same and best is None:
                best = cand
        # a body placeholder with an idx the layout does not know falls back to the layout's body
        if best is None and typ == "body":
            for cand in root.iter(q("p:sp")):
                cph = self.ph_of(cand)
                if cph is not None and cph.get("type", "body") == "body":
                    return cand
        return best

    def inherit_chain(self, sp, ctx):
        """[(shape, part)] from the slide shape up through the layout and master placeholders."""
        chain = [(sp, ctx["slide"])]
        ph = self.ph_of(sp)
        if ph is None:
            return chain
        typ, idx = ph.get("type", "body"), ph.get("idx")
        lay = self.matching_placeholder(ctx["layout"], typ, idx)
        if lay is not None:
            chain.append((lay, ctx["layout"]))
            typ = self.ph_of(lay).get("type", "body")
        # A layout placeholder inherits from the master placeholder of its type, never by idx:
        # idx numbers pair a slide with its layout only. The master's idx 2, 3, 4 are the date,
        # footer and slide number, so matching by idx gave the Comparison layout's content
        # boxes (idx 2 and 4) their 12pt, right-aligned, centred text.
        mas = self.matching_placeholder(ctx["master"], MASTER_PH_TYPE.get(typ, "body"), None)
        if mas is not None:
            chain.append((mas, ctx["master"]))
        return chain

    def master_text_style(self, ctx, kind):
        """The master's titleStyle / bodyStyle / otherStyle element."""
        if not ctx["master"]:
            return None
        ts = self.xml(ctx["master"]).find("p:txStyles", NS)
        if ts is None:
            return None
        name = "p:titleStyle" if kind in ("title", "ctrTitle") else "p:bodyStyle" if kind in ("body", "subTitle", "obj") else "p:otherStyle"
        return ts.find(name, NS)

    # -- text properties ------------------------------------------------------
    def level_props(self, lst_style, lvl):
        """The a:lvlNpPr element for a level (0-based) in a list style, or None."""
        if lst_style is None:
            return None
        return lst_style.find(f"a:lvl{lvl + 1}pPr", NS)

    def text_chain(self, sp, ctx, kind):
        """List styles to consult for a shape's text, nearest first: the shape's own,
        the layout's and master's placeholders', the master text style, the
        presentation default."""
        chain = []
        for node, part in self.inherit_chain(sp, ctx):
            ls = node.find("p:txBody/a:lstStyle", NS)
            if ls is not None and len(ls):
                chain.append(ls)
        ph = self.ph_of(sp)
        if ph is not None:
            ms = self.master_text_style(ctx, kind)
            if ms is not None:
                chain.append(ms)
        elif kind != "cell":                              # a table cell takes its colour from the table style instead
            other = self.master_text_style(ctx, "other")
            if other is not None:
                chain.append(other)
        if self.default_text is not None:
            chain.append(self.default_text)
        return chain

    def resolve_para(self, ppr, chain, lvl):
        """Effective paragraph properties (dict) and the default run properties element list
        (nearest first) for a paragraph at indent level lvl."""
        props = {}
        rprs = []
        sources = [ppr] if ppr is not None else []
        for ls in chain:
            lp = self.level_props(ls, lvl)
            if lp is not None:
                sources.append(lp)
            if lvl > 0:                       # levels inherit nothing from level 1 in OOXML, but a missing level uses the master's
                pass
        for src in sources:
            for k in ("algn", "marL", "indent", "lvl"):
                if k not in props and src.get(k) is not None:
                    props[k] = src.get(k)
            for tag in ("lnSpc", "spcBef", "spcAft"):
                if tag not in props:
                    el = src.find("a:" + tag, NS)
                    if el is not None:
                        props[tag] = el
            if "bullet" not in props:
                if src.find("a:buNone", NS) is not None:
                    props["bullet"] = None
                elif src.find("a:buChar", NS) is not None:
                    props["bullet"] = ("char", src.find("a:buChar", NS).get("char", "\u2022"))
                elif src.find("a:buAutoNum", NS) is not None:
                    props["bullet"] = ("num", src.find("a:buAutoNum", NS).get("type", "arabicPeriod"))
            if "buFont" not in props and src.find("a:buFont", NS) is not None:
                props["buFont"] = src.find("a:buFont", NS).get("typeface", "")
            if "buClr" not in props and src.find("a:buClr", NS) is not None:
                props["buClr"] = src.find("a:buClr", NS)
            if "buSzPct" not in props and src.find("a:buSzPct", NS) is not None:
                props["buSzPct"] = fnum(src.find("a:buSzPct", NS).get("val")) / 100000.0
            d = src.find("a:defRPr", NS)
            if d is not None:
                rprs.append(d)
        return props, rprs

    def run_style(self, rpr, defaults, theme, font_ref_colour, scale, kind):
        """CSS declarations + wrappers for a run: (styles list, size px, tags list, href)."""
        sources = ([rpr] if rpr is not None else []) + defaults

        def get(attr):
            for s in sources:
                if s.get(attr) is not None:
                    return s.get(attr)
            return None

        def find(path):
            for s in sources:
                el = s.find(path, NS)
                if el is not None:
                    return el
            return None

        sz = get("sz")
        px = round(fnum(sz, 1800) / 100.0 * self.pt * scale, 1) if sz else None
        styles, tags = [], []
        col = None
        if kind == "cell" and font_ref_colour:
            # a table cell: the table style's colour beats the presentation defaults, the run's own colour beats both
            own = rpr.find("a:solidFill", NS) if rpr is not None else None
            col = css_colour(first_colour(own, theme)) if own is not None else font_ref_colour
        else:
            fill = find("a:solidFill")
            if fill is not None:
                col = css_colour(first_colour(fill, theme))
            if col is None and font_ref_colour:
                col = font_ref_colour
        if col:
            styles.append("color:" + col)
        latin = find("a:latin")
        face = theme.font(latin.get("typeface")) if latin is not None else None
        if face and not face.startswith("+"):
            styles.append(f"font-family:'{face}', sans-serif" if " " in face else f"font-family:{face}, sans-serif")
        if get("b") == "1":
            tags.append("b")
        if get("i") == "1":
            tags.append("i")
        u = get("u")
        if u and u != "none":
            tags.append("u")
        st = get("strike")
        if st and st != "noStrike":
            tags.append("s")
        base = get("baseline")
        if base:
            b = fnum(base)
            if b > 0:
                tags.append("sup")
            elif b < 0:
                tags.append("sub")
        cap = get("cap")
        if cap == "all":
            styles.append("text-transform:uppercase")
        elif cap == "small":
            styles.append("font-variant:small-caps")
        spc = get("spc")
        if spc and fnum(spc):
            styles.append(f"letter-spacing:{fnum(spc) / 100.0 * self.pt:.1f}px")
        return styles, px, tags

    # -- text body ---------------------------------------------------------------
    def body_html(self, sp, tx_body, ctx, kind, font_ref_colour, box_h_px, inherited_body_pr=None):
        """(inner HTML, css for the container) for a text body."""
        theme = ctx["theme"]
        chain = self.text_chain(sp, ctx, kind)
        body_pr = tx_body.find("a:bodyPr", NS)
        # bodyPr inherits too (anchor, insets, autofit) from the layout / master placeholder
        bprs = [body_pr] if body_pr is not None else []
        for node, part in self.inherit_chain(sp, ctx)[1:]:
            bp = node.find("p:txBody/a:bodyPr", NS)
            if bp is not None:
                bprs.append(bp)

        def bget(attr, default=None):
            for bp in bprs:
                if bp.get(attr) is not None:
                    return bp.get(attr)
            return default

        anchor = bget("anchor", "t")
        ins = {k: fnum(bget(k), d) * self.k for k, d in (("lIns", 91440), ("tIns", 45720), ("rIns", 91440), ("bIns", 45720))}
        scale = 1.0
        lnsp_red = 0.0
        for bp in bprs:
            af = bp.find("a:normAutofit", NS)
            if af is not None:
                scale = fnum(af.get("fontScale"), 100000) / 100000.0
                lnsp_red = fnum(af.get("lnSpcReduction"), 0) / 100000.0
                break
            if bp.find("a:spAutoFit", NS) is not None or bp.find("a:noAutofit", NS) is not None:
                break
        wrap_none = bget("wrap") == "none"
        vert = bget("vert")
        default_px = round(18 * self.pt * scale, 1)
        blocks = []
        cur_list = None                                    # [tag, style, items]
        first_px = None
        for para in tx_body.findall("a:p", NS):
            ppr = para.find("a:pPr", NS)
            lvl = int(ppr.get("lvl", "0")) if ppr is not None else 0
            props, defaults = self.resolve_para(ppr, chain, lvl)
            end_rpr = para.find("a:endParaRPr", NS)
            runs = []
            para_px = None
            has_text = False
            for node in para:
                tag = node.tag.split("}")[-1]
                if tag in ("r", "fld"):
                    t = node.find("a:t", NS)
                    text = t.text if t is not None else ""
                    if tag == "fld" and node.get("type") == "slidenum":
                        text = ""                          # the deck has its own counter
                    if text is None:
                        text = ""
                    rpr = node.find("a:rPr", NS)
                    styles, px, tags = self.run_style(rpr, defaults, theme, font_ref_colour, scale, kind)
                    if px is None:
                        px = default_px
                    if text.strip():
                        has_text = True
                        para_px = max(para_px or 0, px)
                    html_text = esc(text)
                    for tg in tags:
                        html_text = f"<{tg}>{html_text}</{tg}>"
                    if px != default_px:
                        styles.insert(0, f"font-size:{css_px(px)}px")
                    link = rpr.find("a:hlinkClick", NS) if rpr is not None else None
                    if link is not None:
                        href = ctx["rels"].get(link.get(q("r:id")))
                        if href and not href.startswith("ppt/"):
                            html_text = f'<a href="{attr(href)}" style="color:#{theme.scheme("hlink")};">{html_text}</a>'
                    runs.append(f'<span style="{"; ".join(styles)};">{html_text}</span>' if styles else html_text)
                elif tag == "br":
                    runs.append("<br>")
            text = "".join(runs)
            if not has_text and not runs:
                # an empty paragraph keeps its height (a blank line), at the end-of-paragraph size
                _, epx, _ = self.run_style(end_rpr, defaults, theme, font_ref_colour, scale, kind)
                if cur_list is not None:
                    blocks.append(cur_list); cur_list = None
                blocks.append(f'<p style="margin:0; font-size:{css_px(epx or default_px)}px; line-height:{1.2 - lnsp_red:.2f};">&nbsp;</p>')
                continue
            if para_px is None:
                para_px = default_px
            if first_px is None:
                first_px = para_px
            # paragraph css
            pst = [f"margin:0", f"font-size:{css_px(para_px)}px"]
            ln = props.get("lnSpc")
            lh = None
            if ln is not None:
                pct = ln.find("a:spcPct", NS)
                pts = ln.find("a:spcPts", NS)
                if pct is not None:
                    lh = f"{max(0.8, fnum(pct.get('val')) / 100000.0 * 1.2 - lnsp_red):.2f}"
                elif pts is not None:
                    lh = f"{css_px(fnum(pts.get('val')) / 100.0 * self.pt)}px"
            pst.append("line-height:" + (lh or f"{1.2 - lnsp_red:.2f}"))
            for key, prop in (("spcBef", "margin-top"), ("spcAft", "margin-bottom")):
                el = props.get(key)
                if el is not None:
                    pct = el.find("a:spcPct", NS)
                    pts = el.find("a:spcPts", NS)
                    if pts is not None:
                        pst.append(f"{prop}:{css_px(fnum(pts.get('val')) / 100.0 * self.pt)}px")
                    elif pct is not None:
                        pst.append(f"{prop}:{fnum(pct.get('val')) / 100000.0:.2f}em")
            algn = props.get("algn")
            if algn in ("ctr", "r", "just"):
                pst.append("text-align:" + {"ctr": "center", "r": "right", "just": "justify"}[algn])
            bullet = props.get("bullet")
            if "bullet" not in props and kind == "body":
                bullet = ("char", "•")                # a file without master text styles: PowerPoint's built-in default
            # PowerPoint's built-in margins when the file defines none: 0.375in hanging bullets, 0.5in per level
            mar_l = fnum(props.get("marL"), (342900 if bullet else 0) + 457200 * lvl) * self.k
            indent = fnum(props.get("indent"), -342900 if bullet else 0) * self.k
            if bullet:
                # a list item: the marker glyph from the file, hanging by the indent
                if cur_list is None or cur_list[0] != ("ol" if bullet[0] == "num" else "ul"):
                    if cur_list is not None:
                        blocks.append(cur_list)
                    cur_list = ["ol" if bullet[0] == "num" else "ul", [], []]
                li_st = list(pst)
                hang = max(0.0, -indent) if indent < 0 else 0.0
                li_st.append(f"margin-left:{css_px(max(0.0, mar_l - hang))}px")
                if bullet[0] == "char":
                    glyph = bullet_glyph(bullet[1], props.get("buFont", ""))
                    li_st.append(f"list-style-type:'{glyph}  '" if glyph != "\u2022" else "list-style-type:disc")
                else:
                    li_st.append("list-style-type:" + {"alphaLcPeriod": "lower-alpha", "alphaUcPeriod": "upper-alpha", "romanLcPeriod": "lower-roman",
                                                       "romanUcPeriod": "upper-roman"}.get(bullet[1], "decimal"))
                # The marker's own colour (buClr, often the accent): the item's colour paints the marker,
                # so it is only set when every run of the item carries its colour, which the text keeps.
                bu_colour = css_colour(first_colour(props["buClr"], theme)) if props.get("buClr") is not None else None
                if bu_colour and runs and all(r == "<br>" or (r.startswith("<span") and "color:" in r[:r.index(">")]) for r in runs):
                    li_st.append(f"color:{bu_colour}")
                cur_list[2].append(f'<li style="{"; ".join(li_st)};" data-edit>{text}</li>')
                continue
            if cur_list is not None:
                blocks.append(cur_list); cur_list = None
            if mar_l:
                pst.append(f"padding-left:{css_px(mar_l)}px")
            if indent and not bullet:
                pst.append(f"text-indent:{css_px(indent)}px")
            tag = "h1" if kind == "ctrTitle" else "h2" if kind == "title" else "p"
            if tag != "p":
                pst.append("font-weight:inherit")
            blocks.append(f'<{tag} style="{"; ".join(pst)};" data-edit>{text}</{tag}>')
        if cur_list is not None:
            blocks.append(cur_list)
        out = []
        for b in blocks:
            if isinstance(b, list):
                tag, _, items = b
                out.append(f'<{tag} style="margin:0; padding-left:1em; list-style-position:outside;" data-group>\n' + "\n".join(items) + f"\n</{tag}>")
            else:
                out.append(b)
        container = (f"display:flex; flex-direction:column; justify-content:{'center' if anchor == 'ctr' else 'flex-end' if anchor == 'b' else 'flex-start'};"
                     f" padding:{css_px(ins['tIns'])}px {css_px(ins['rIns'])}px {css_px(ins['bIns'])}px {css_px(ins['lIns'])}px; box-sizing:border-box;"
                     f" font-size:{css_px(first_px or default_px)}px; line-height:1.2; overflow:visible;")
        if wrap_none:
            container += " white-space:nowrap;"
        if vert in ("vert", "vert270", "eaVert"):
            container += " writing-mode:vertical-rl;" + (" transform:rotate(180deg);" if vert == "vert270" else "")
        return "\n".join(out), container

    # -- style references ------------------------------------------------------
    def style_refs(self, sp, theme):
        """(fill css, fill kind, line css dict, font colour) from a shape's p:style, or Nones."""
        st = sp.find("p:style", NS)
        if st is None:
            return None, None, None, None
        fill_css_v, fill_kind = None, None
        fr = st.find("a:fillRef", NS)
        if fr is not None:
            idx = int(fr.get("idx", "0"))
            ph = first_colour(fr, theme)
            if 1 <= idx <= len(theme.fills):
                fill_css_v, fill_kind = fill_css(self._wrap(theme.fills[idx - 1]), theme, ph[0] if ph else None)
            elif idx >= 1001 and theme.bg_fills:
                i = idx - 1001
                if i < len(theme.bg_fills):
                    fill_css_v, fill_kind = fill_css(self._wrap(theme.bg_fills[i]), theme, ph[0] if ph else None)
        line = None
        lr = st.find("a:lnRef", NS)
        if lr is not None:
            idx = int(lr.get("idx", "0"))
            ph = first_colour(lr, theme)
            if 1 <= idx <= len(theme.lines):
                line = self.line_props(theme.lines[idx - 1], theme, ph[0] if ph else None)
        font_col = None
        fo = st.find("a:fontRef", NS)
        if fo is not None:
            c = first_colour(fo, theme)
            font_col = css_colour(c) if c else None
        return fill_css_v, fill_kind, line, font_col

    @staticmethod
    def _wrap(el):
        w = ET.Element("wrap")
        w.append(el)
        return w

    def line_props(self, ln, theme, ph_colour=None):
        """{'w': px, 'color': css, 'dash': css, 'head': bool, 'tail': bool} of an a:ln, or None for no line."""
        if ln is None:
            return None
        if ln.find("a:noFill", NS) is not None:
            return {"none": True}
        col = css_colour(first_colour(ln.find("a:solidFill", NS), theme, ph_colour))
        grad = ln.find("a:gradFill", NS)
        if col is None and grad is not None:
            gs = grad.find("a:gsLst/a:gs", NS)
            col = css_colour(first_colour(gs, theme, ph_colour)) if gs is not None else None
        w = fnum(ln.get("w"), 9525) * self.k
        dash = ln.find("a:prstDash", NS)
        d = dash.get("val") if dash is not None else "solid"
        head = ln.find("a:headEnd", NS)
        tail = ln.find("a:tailEnd", NS)
        return {"w": w, "color": col, "dash": d,
                "head": head is not None and head.get("type", "none") != "none",
                "tail": tail is not None and tail.get("type", "none") != "none",
                "has_fill": col is not None}

    @staticmethod
    def merge_line(own, ref):
        """The shape's own a:ln properties over the style reference's."""
        if own is None:
            return ref
        if own.get("none"):
            return own
        out = dict(ref or {})
        for k, v in own.items():
            if k == "color" and v is None:
                continue
            if k == "has_fill" and not v:
                continue
            out[k] = v
        if "w" not in out:
            out["w"] = 1
        return out

    def border_css(self, line):
        if not line or line.get("none") or not line.get("color"):
            return ""
        style = {"dash": "dashed", "sysDash": "dashed", "lgDash": "dashed", "dot": "dotted", "sysDot": "dotted",
                 "dashDot": "dashed", "lgDashDot": "dashed", "sysDashDot": "dashed"}.get(line.get("dash", "solid"), "solid")
        return f" border:{css_px(max(1.0, line['w']))}px {style} {line['color']};"

    def effect_css(self, sp_pr, theme):
        el = sp_pr.find("a:effectLst/a:outerShdw", NS) if sp_pr is not None else None
        if el is None:
            return ""
        col = css_colour(first_colour(el, theme)) or "rgba(0,0,0,0.4)"
        dist = fnum(el.get("dist"), 0) * self.k
        ang = math.radians(fnum(el.get("dir"), 0) / 60000.0)
        blur = fnum(el.get("blurRad"), 0) * self.k
        return f" box-shadow:{css_px(dist * math.cos(ang))}px {css_px(dist * math.sin(ang))}px {css_px(blur)}px {col};"

    # -- shapes ---------------------------------------------------------------------
    def shape_html(self, sp, ctx, tf=None, from_layout=False):
        theme = ctx["theme"]
        ph = self.ph_of(sp)
        kind = ph.get("type", "body") if ph is not None else "free"
        if kind in ("sldNum", "dt", "ftr", "hdr"):
            return ""
        sp_pr = sp.find("p:spPr", NS)
        g = self.xfrm(sp_pr.find("a:xfrm", NS) if sp_pr is not None else None)
        if g is None and ph is not None:
            for node, part in self.inherit_chain(sp, ctx)[1:]:
                npr = node.find("p:spPr", NS)
                g = self.xfrm(npr.find("a:xfrm", NS) if npr is not None else None)
                if g:
                    break
        g = self.transformed(g, tf)
        tx = sp.find("p:txBody", NS)
        has_text = tx is not None and any((t.text or "").strip() for t in tx.iter(q("a:t")))
        if from_layout and ph is not None:
            return ""                                       # a layout's placeholder is a prompt, not content
        # fill: the shape's own, else the style reference's
        ref_fill, ref_kind, ref_line, ref_font = self.style_refs(sp, theme)
        own_fill, own_kind = fill_css(sp_pr, theme, None, self.picture_resolver(ctx["rels"])) if sp_pr is not None else (None, None)
        fill, fkind = (own_fill, own_kind) if own_kind else (ref_fill, ref_kind)
        if fkind == "none":
            fill = None
        line = self.merge_line(self.line_props(sp_pr.find("a:ln", NS), theme) if sp_pr is not None and sp_pr.find("a:ln", NS) is not None else None, ref_line)
        prst_el = sp_pr.find("a:prstGeom", NS) if sp_pr is not None else None
        prst = prst_el.get("prst") if prst_el is not None else ("rect" if sp_pr is not None and sp_pr.find("a:custGeom", NS) is None else "custom")
        shape = preset_kind(prst)
        if not g:
            g = {"x": 0, "y": 0, "w": self.cx, "h": self.cy, "rot": 0}
        if shape == "line":
            return self.line_html(g, line, theme)
        shadow = self.effect_css(sp_pr, theme)
        box = self.place(g)
        visible_fill = fill is not None
        visible_line = line is not None and not line.get("none") and line.get("color")
        if not has_text and not visible_fill and not visible_line:
            return ""
        # the shape body: a box (rect / round / ellipse) or an SVG path
        body_css = ""
        svg = ""
        if shape in ("rect", "round", "roundfull", "ellipse"):
            if visible_fill:
                body_css += f" background:{fill};"
            if shape == "ellipse":
                body_css += " border-radius:50%;"
            elif shape == "round":
                adj = sp_pr.find("a:prstGeom/a:avLst/a:gd", NS) if sp_pr is not None else None
                frac = fnum(adj.get("fmla", "val 16667").split()[-1], 16667) / 100000.0 if adj is not None else 0.16667
                body_css += f" border-radius:{css_px(min(g['w'], g['h']) * self.k * frac)}px;"
            elif shape == "roundfull":
                body_css += " border-radius:9999px;"
            body_css += self.border_css(line) + shadow
        else:
            path = shape if shape not in ("custom",) else self.custom_path(sp_pr, g)
            if path:
                stroke = f' stroke="{line["color"]}" stroke-width="{css_px(max(1.0, line["w"]))}" vector-effect="non-scaling-stroke"' if visible_line else ""
                fill_attr = self.svg_fill(fill, fkind, g)
                svg = (f'<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute; inset:0; width:100%; height:100%; z-index:-1; overflow:visible; max-width:none; max-height:none;{self.drop_shadow(shadow)}">'
                       f'{fill_attr[0]}<path d="{path}" fill="{fill_attr[1]}"{stroke}/></svg>')
            else:
                if visible_fill:
                    body_css += f" background:{fill};"
                body_css += self.border_css(line) + shadow
        if not has_text:
            if svg:
                # a bare shape: the editor's own form (recolourable through the Text colour field)
                col = fill if fkind == "solid" else None
                st = f"{box} overflow:visible; max-width:none; max-height:none;" + (f" color:{col};" if col else "")
                path = shape if shape not in ("custom",) else self.custom_path(sp_pr, g)
                stroke = f' stroke="{line["color"]}" stroke-width="{css_px(max(1.0, line["w"]))}" vector-effect="non-scaling-stroke"' if visible_line else ""
                fill_attr = self.svg_fill(fill, fkind, g) if fkind != "solid" else ("", "currentColor" if col else "none")
                return f'<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="{st}{self.drop_shadow(shadow)}">{fill_attr[0]}<path d="{path}" fill="{fill_attr[1]}"{stroke}/></svg>'
            return f'<div style="{box}{body_css}"></div>'
        inner, container = self.body_html(sp, tx, ctx, kind, ref_font, g["h"] * self.k)
        if svg:
            return f'<div style="{box}{body_css} isolation:isolate; {container}">\n{svg}\n{inner}\n</div>'
        return f'<div style="{box}{body_css} {container}">\n{inner}\n</div>'

    @staticmethod
    def drop_shadow(box_shadow_css):
        """A box-shadow declaration as an SVG-friendly filter declaration (the path, not the box, casts it)."""
        if not box_shadow_css:
            return ""
        return " filter:drop-shadow(" + box_shadow_css.split("box-shadow:")[1].strip().rstrip(";") + ");"

    def svg_fill(self, fill, fkind, g):
        """(defs, fill attribute value) for an SVG path from a CSS fill."""
        if fill is None:
            return "", "none"
        if fkind == "solid":
            return "", fill
        if fkind == "gradient" and fill.startswith("linear-gradient"):
            self.svg_ids += 1
            gid = f"pg{self.svg_ids}"
            m = re.match(r"linear-gradient\(([\d.]+)deg, (.*)\)$", fill)
            if m:
                ang = math.radians(fnum(m.group(1)) - 90)
                x2, y2 = 50 + 50 * math.cos(ang), 50 + 50 * math.sin(ang)
                x1, y1 = 100 - x2, 100 - y2
                stops = "".join(f'<stop offset="{p}%" stop-color="{c}"/>' for c, p in re.findall(r"(#[0-9a-f]{6}|rgba?\([^)]*\)) ([\d.]+)%", m.group(2)))
                return f'<defs><linearGradient id="{gid}" x1="{x1:.0f}%" y1="{y1:.0f}%" x2="{x2:.0f}%" y2="{y2:.0f}%">{stops}</linearGradient></defs>', f"url(#{gid})"
        return "", "#999"

    def custom_path(self, sp_pr, g=None):
        """A custom geometry as a 100x100 path (moveTo / lnTo / close, curves approximated by
        their end points). A path without its own w / h is in the shape's EMU extents."""
        cg = sp_pr.find("a:custGeom", NS) if sp_pr is not None else None
        if cg is None:
            return None
        out = []
        for pth in cg.findall("a:pathLst/a:path", NS):
            w = fnum(pth.get("w"), 0) or (g["w"] if g else 1) or 1
            h = fnum(pth.get("h"), 0) or (g["h"] if g else 1) or 1
            for cmd in pth:
                tag = cmd.tag.split("}")[-1]
                pts = [(fnum(pt.get("x")) / w * 100, fnum(pt.get("y")) / h * 100) for pt in cmd.findall("a:pt", NS)]
                if tag == "moveTo" and pts:
                    out.append(f"M{pts[0][0]:.1f} {pts[0][1]:.1f}")
                elif tag == "lnTo" and pts:
                    out.append(f"L{pts[0][0]:.1f} {pts[0][1]:.1f}")
                elif tag == "cubicBezTo" and len(pts) == 3:
                    out.append("C" + " ".join(f"{x:.1f} {y:.1f}" for x, y in pts))
                elif tag == "quadBezTo" and len(pts) == 2:
                    out.append("Q" + " ".join(f"{x:.1f} {y:.1f}" for x, y in pts))
                elif tag in ("arcTo",):
                    pass                                    # an arc needs the current point; the next segment continues from its end
                elif tag == "close":
                    out.append("Z")
        return " ".join(out) or None

    def line_html(self, g, line, theme):
        """A straight line / connector as an SVG in its bounding box; flips give the direction."""
        if not line or line.get("none"):
            return ""
        col = line.get("color") or "#888"
        w = max(1.0, line.get("w", 1))
        bw, bh = max(1.0, g["w"] * self.k), max(1.0, g["h"] * self.k)
        x1, y1, x2, y2 = 0, 0, bw, bh
        if g.get("flipH"):
            x1, x2 = bw, 0
        if g.get("flipV"):
            y1, y2 = bh, 0
        box = (f"position:absolute; left:{css_px(g['x'] * self.k)}px; top:{css_px(g['y'] * self.k)}px; width:{css_px(bw)}px; height:{css_px(bh)}px;"
               + (f" rotate:{round(g['rot'], 1):g}deg;" if g.get("rot") else ""))
        dash = {"dash": f"{w * 4:.0f} {w * 3:.0f}", "sysDash": f"{w * 3:.0f} {w:.0f}", "lgDash": f"{w * 8:.0f} {w * 3:.0f}", "dot": f"{w:.0f} {w:.0f}",
                "sysDot": f"{w:.0f} {w:.0f}", "dashDot": f"{w * 4:.0f} {w * 3:.0f} {w:.0f} {w * 3:.0f}"}.get(line.get("dash", "solid"))
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        ang = math.atan2(y2 - y1, x2 - x1)
        parts = [f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}"{dash_attr} vector-effect="non-scaling-stroke"/>']
        size = max(8.0, w * 4)                              # PowerPoint's medium arrowhead is about four line widths long

        def head(px, py, a):
            l = px - size * math.cos(a) + size * 0.5 * math.sin(a), py - size * math.sin(a) - size * 0.5 * math.cos(a)
            r = px - size * math.cos(a) - size * 0.5 * math.sin(a), py - size * math.sin(a) + size * 0.5 * math.cos(a)
            return f'<path d="M{l[0]:.1f} {l[1]:.1f} L{px:.1f} {py:.1f} L{r[0]:.1f} {r[1]:.1f}" fill="{col}" stroke="none"/>'
        if line.get("tail"):
            parts.append(head(x2, y2, ang))
        if line.get("head"):
            parts.append(head(x1, y1, ang + math.pi))
        return (f'<svg viewBox="0 0 {bw:.1f} {bh:.1f}" preserveAspectRatio="none" fill="none" stroke="{col}" stroke-width="{css_px(w)}" stroke-linecap="round" '
                f'style="{box} overflow:visible; max-width:none; max-height:none;">{"".join(parts)}</svg>')

    # -- pictures ------------------------------------------------------------------
    def picture_html(self, pic, ctx, tf=None):
        blip = pic.find("p:blipFill/a:blip", NS)
        sp_pr = pic.find("p:spPr", NS)
        g = self.transformed(self.xfrm(sp_pr.find("a:xfrm", NS) if sp_pr is not None else None), tf)
        if blip is None:
            return ""
        if g is None:
            ph = self.ph_of(pic)
            if ph is not None:
                for node, part in self.inherit_chain(pic, ctx)[1:]:
                    npr = node.find("p:spPr", NS)
                    g = self.xfrm(npr.find("a:xfrm", NS) if npr is not None else None)
                    if g:
                        break
        if pic.find("p:nvPicPr/p:nvPr/a:videoFile", NS) is not None or pic.find("p:nvPicPr/p:nvPr/a:audioFile", NS) is not None:
            self.notes.append("a video or audio clip was left out (its poster picture was kept)")
        svg = blip.find("asvg:svgBlip", NS)
        rid = (svg.get(q("r:embed")) if svg is not None else None) or blip.get(q("r:embed"))
        target = ctx["rels"].get(rid)
        src = self.asset(target)
        if not src:
            if not (target or "").lower().endswith(METAFILES):     # those have their own note
                self.notes.append("a picture could not be read")
            return ""
        st = [self.place(g), "max-width:none; max-height:none;"]
        crop = pic.find("p:blipFill/a:srcRect", NS)
        if crop is not None and any(fnum(crop.get(k)) for k in ("l", "t", "r", "b")):
            l, t, r, b = (fnum(crop.get(k)) / 100000.0 for k in ("l", "t", "r", "b"))
            vis_w, vis_h = max(0.01, 1 - l - r), max(0.01, 1 - t - b)
            st.append(f"object-fit:fill; object-position:0 0;")
            # crop: the image scaled so the visible part fills the box, shifted by the crop
            st.append(f"clip-path:inset(0);")
            inner = (f'<img src="{src}" alt="" style="position:absolute; left:{-l / vis_w * 100:.2f}%; top:{-t / vis_h * 100:.2f}%; '
                     f'width:{100 / vis_w:.2f}%; height:{100 / vis_h:.2f}%; max-width:none; max-height:none;">')
            radius = self.picture_radius(sp_pr, g)
            alpha = self.picture_alpha(blip)
            return f'<div style="{self.place(g)} overflow:hidden;{radius}{alpha}" data-group>{inner}</div>'
        st.append("object-fit:fill;")
        st.append(self.picture_radius(sp_pr, g))
        st.append(self.picture_alpha(blip))
        line = self.line_props(sp_pr.find("a:ln", NS), ctx["theme"]) if sp_pr is not None and sp_pr.find("a:ln", NS) is not None else None
        st.append(self.border_css(line))
        st.append(self.effect_css(sp_pr, ctx["theme"]))
        return f'<img src="{src}" alt="" style="{" ".join(s for s in st if s)}">'

    def picture_radius(self, sp_pr, g):
        prst = sp_pr.find("a:prstGeom", NS) if sp_pr is not None else None
        p = prst.get("prst") if prst is not None else "rect"
        if p == "ellipse":
            return " border-radius:50%;"
        if p in ("roundRect", "round2SameRect", "flowChartAlternateProcess"):
            return f" border-radius:{css_px(min(g['w'], g['h']) * self.k * 0.1667)}px;"
        return ""

    @staticmethod
    def picture_alpha(blip):
        am = blip.find("a:alphaModFix", NS)
        if am is not None:
            return f" opacity:{fnum(am.get('amt'), 100000) / 100000.0:.2f};"
        return ""

    # -- tables ---------------------------------------------------------------------
    def table_html(self, frame, ctx, tf=None):
        theme = ctx["theme"]
        tbl = frame.find(".//a:tbl", NS)
        g = self.transformed(self.xfrm(frame.find("p:xfrm", NS)), tf)
        if tbl is None:
            return ""
        cols = [fnum(c.get("w")) * self.k for c in tbl.findall("a:tblGrid/a:gridCol", NS)]
        tpr = tbl.find("a:tblPr", NS)
        first_row = tpr is not None and tpr.get("firstRow") == "1"
        band_row = tpr is not None and tpr.get("bandRow") == "1"
        style = self.table_style(tpr, theme)
        px = round(18 * self.pt, 1)
        rows = []
        trs = tbl.findall("a:tr", NS)
        for r, tr in enumerate(trs):
            cells = []
            h = fnum(tr.get("h")) * self.k
            for ci, tc in enumerate(tr.findall("a:tc", NS)):
                if tc.get("hMerge") == "1" or tc.get("vMerge") == "1":
                    continue
                span = int(tc.get("gridSpan", "1"))
                rspan = int(tc.get("rowSpan", "1"))
                tx = tc.find("a:txBody", NS)
                tcpr = tc.find("a:tcPr", NS)
                is_head = first_row and r == 0
                band = band_row and not is_head and ((r - (1 if first_row else 0)) % 2 == 0)
                part = style.get("first") if is_head else (style.get("band1") if band else style.get("whole"))
                cell_fill = None
                if tcpr is not None:
                    cell_fill, _ = fill_css(tcpr, theme)
                # the table style's borders (whole-table part): its inside lines on every cell, so the grid reads the same
                border = (style.get("whole") or {}).get("border") or "1px solid rgba(128,128,128,0.35)"
                css = ["padding:8px 12px", "vertical-align:top", "text-align:left", f"border:{border}"]
                bg = cell_fill or (part or {}).get("fill")
                if bg:
                    css.append(f"background:{bg}")
                col = (part or {}).get("color")
                if tcpr is not None:
                    anchor = tcpr.get("anchor")
                    if anchor in ("ctr", "b"):
                        css[1] = "vertical-align:" + ("middle" if anchor == "ctr" else "bottom")
                    for side, name in (("lnL", "border-left"), ("lnR", "border-right"), ("lnT", "border-top"), ("lnB", "border-bottom")):
                        ln = tcpr.find("a:" + side, NS)
                        if ln is not None:
                            lp = self.line_props(ln, theme)
                            if lp and lp.get("none"):
                                css.append(f"{name}:none")
                            elif lp and lp.get("color"):
                                css.append(f"{name}:{css_px(max(1.0, lp['w']))}px solid {lp['color']}")
                if is_head or (part and part.get("bold")):
                    css.append("font-weight:600")
                text = ""
                if tx is not None:
                    inner, _ = self.body_html(tc, tx, ctx, "cell", col, h)
                    text = inner
                if col and "color:" not in text:
                    css.append(f"color:{col}")
                if h:
                    css.append(f"height:{css_px(h)}px")
                tag = "th" if is_head else "td"
                attrs = (f' colspan="{span}"' if span > 1 else "") + (f' rowspan="{rspan}"' if rspan > 1 else "")
                cells.append(f'<{tag} style="{"; ".join(css)};"{attrs}>{text}</{tag}>')
            rows.append("<tr>" + "".join(cells) + "</tr>")
        colgroup = "<colgroup>" + "".join(f'<col style="width:{css_px(w)}px">' for w in cols) + "</colgroup>" if cols else ""
        box = self.place(dict(g, h=0)) if g else "position:absolute; left:96px; top:250px; width:1728px;"
        box = box.replace(" height:0px;", "")
        font = f"font-family:'{theme.minor}', sans-serif;" if theme.minor else ""
        return (f'<table style="{box} border-collapse:collapse; table-layout:fixed; font-size:{css_px(px)}px; line-height:1.3; {font}" data-group>\n'
                f"{colgroup}\n" + "\n".join(rows) + "\n</table>")

    def table_style(self, tpr, theme):
        """Fills and text colours of the table style's whole / first row / band parts, from ppt/tableStyles.xml."""
        out = {}
        sid = tpr.find("a:tableStyleId", NS) if tpr is not None else None
        if sid is None or "ppt/tableStyles.xml" not in self.names:
            return out
        root = self.xml("ppt/tableStyles.xml")
        for ts in root.findall("a:tblStyle", NS):
            if ts.get("styleId") != (sid.text or "").strip():
                continue
            for part, name in (("whole", "a:wholeTbl"), ("first", "a:firstRow"), ("band1", "a:band1H"), ("last", "a:lastRow")):
                el = ts.find(name, NS)
                if el is None:
                    continue
                d = {}
                fill_el = el.find("a:tcStyle/a:fill", NS)
                if fill_el is not None:
                    d["fill"], _ = fill_css(fill_el, theme)
                fref = el.find("a:tcStyle/a:fillRef", NS)
                if fref is not None and not d.get("fill"):
                    idx = int(fref.get("idx", "0"))
                    ph = first_colour(fref, theme)
                    if 1 <= idx <= len(theme.fills):
                        d["fill"], _ = fill_css(self._wrap(theme.fills[idx - 1]), theme, ph[0] if ph else None)
                bdr = el.find("a:tcStyle/a:tcBdr", NS)
                if bdr is not None:
                    for side in ("insideH", "insideV", "top", "left"):
                        ln = bdr.find(f"a:{side}/a:ln", NS)
                        if ln is not None:
                            lp = self.line_props(ln, theme)
                            if lp and lp.get("none"):
                                d["border"] = "none"
                                break
                            if lp and lp.get("color"):
                                d["border"] = f"{css_px(max(1.0, lp['w']))}px solid {lp['color']}"
                                break
                tx = el.find("a:tcTxStyle", NS)
                if tx is not None:
                    c = first_colour(tx, theme)
                    fr = tx.find("a:fontRef", NS)
                    if c is None and fr is not None:
                        c = first_colour(fr, theme)
                    if c:
                        d["color"] = css_colour(c)
                    if tx.get("b") == "on":
                        d["bold"] = True
                out[part] = d
        return out

    # -- charts ------------------------------------------------------------------------
    def chart_html(self, frame, ctx, tf=None):
        g = self.transformed(self.xfrm(frame.find("p:xfrm", NS)), tf)
        ch = frame.find(".//c:chart", NS)
        if ch is None or not g:
            return ""
        part = ctx["rels"].get(ch.get(q("r:id")))
        if not part or part not in self.names:
            return ""
        try:
            from pptx_chart import chart_svg, chart_spec, chart_text
            root = self.xml(part)
            svg = chart_svg(root, ctx["theme"], self.rels(part), g["w"] * self.k, g["h"] * self.k, self.pt)
            spec = chart_spec(root, ctx["theme"]) if svg else None
        except Exception as e:  # noqa: BLE001 - a chart must never break the import
            self.notes.append(f"a chart could not be drawn ({type(e).__name__})")
            return ""
        if not svg:
            self.notes.append("a chart of a kind the import does not draw was skipped")
            return ""
        if not spec:
            return f'<div style="{self.place(g)} overflow:visible;" data-group data-chart>{svg}</div>'
        # An editable chart (app/core/chart.js): PowerPoint's drawing as it came, which the editor
        # keeps until the chart is changed, and the table the editor draws it from after that.
        kind, data = spec
        minor, fs, text_col = chart_text(root, ctx["theme"], self.pt)
        font = f" font-family:'{minor}', sans-serif;" if minor else ""
        table = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
        return (f'<figure data-chart="{kind}" style="{self.place(g)} margin:0;{font} font-size:{fs:.1f}px; color:{text_col};">'
                f'{svg}<script type="application/json" data-chart-data>{table}</script></figure>')

    # -- SmartArt ------------------------------------------------------------------------
    def diagram_html(self, frame, ctx, tf=None):
        g = self.transformed(self.xfrm(frame.find("p:xfrm", NS)), tf)
        rel = frame.find(".//dgm:relIds", NS)
        drawing = None
        for target in ctx["rels"].get("type:diagramDrawing", []):
            drawing = target
        if rel is None or not g:
            return ""
        if drawing is None:
            self.notes.append("a SmartArt graphic was skipped (the file has no drawing of it)")
            return ""
        root = self.xml(drawing)
        out = []
        tf2 = (g["x"], g["y"], 1.0, 1.0)
        for sp in root.iter(q("dsp:sp")):
            out.append(self.shape_html(self._as_p_shape(sp), ctx, tf2))
        return "\n".join(o for o in out if o)

    @staticmethod
    def _as_p_shape(dsp):
        """A dsp:sp (SmartArt drawing shape) re-tagged as a p:sp so shape_html reads it."""
        sp = ET.Element(q("p:sp"))
        nv = ET.SubElement(sp, q("p:nvSpPr"))
        ET.SubElement(nv, q("p:cNvPr"), {"id": "0", "name": "smartart"})
        ET.SubElement(nv, q("p:nvPr"))
        for child in dsp:
            tag = child.tag.split("}")[-1]
            if tag == "spPr":
                el = ET.SubElement(sp, q("p:spPr"))
                el.extend(list(child))
                el.attrib.update(child.attrib)
            elif tag == "style":
                el = ET.SubElement(sp, q("p:style"))
                el.extend(list(child))
            elif tag == "txBody":
                el = ET.SubElement(sp, q("p:txBody"))
                el.extend(list(child))
        return sp

    # -- groups and dispatch ---------------------------------------------------------------
    def group_html(self, grp, ctx, tf=None, from_layout=False):
        x = grp.find("p:grpSpPr/a:xfrm", NS)
        dx, dy, sx, sy = 0, 0, 1.0, 1.0
        if x is not None:
            off, ext, choff, chext = x.find("a:off", NS), x.find("a:ext", NS), x.find("a:chOff", NS), x.find("a:chExt", NS)
            if off is not None and choff is not None:
                ox, oy = int(off.get("x")), int(off.get("y"))
                cx, cy = int(choff.get("x")), int(choff.get("y"))
                if ext is not None and chext is not None and int(chext.get("cx")) and int(chext.get("cy")):
                    sx = int(ext.get("cx")) / int(chext.get("cx"))
                    sy = int(ext.get("cy")) / int(chext.get("cy"))
                dx, dy = ox - cx * sx, oy - cy * sy
        # compose with the outer transform
        if tf:
            odx, ody, osx, osy = tf
            dx, dy, sx, sy = odx + dx * osx, ody + dy * osy, sx * osx, sy * osy
        inner = (dx, dy, sx, sy)
        out = [self.node_html(child, ctx, inner, from_layout) for child in grp]
        return "\n".join(o for o in out if o)

    def node_html(self, node, ctx, tf=None, from_layout=False):
        tag = node.tag
        if tag == q("p:sp"):
            return self.shape_html(node, ctx, tf, from_layout)
        if tag == q("p:pic"):
            if from_layout and self.ph_of(node) is not None:
                return ""
            return self.picture_html(node, ctx, tf)
        if tag == q("p:graphicFrame"):
            if from_layout and self.ph_of(node) is not None:
                return ""
            if node.find(".//a:tbl", NS) is not None:
                return self.table_html(node, ctx, tf)
            if node.find(".//c:chart", NS) is not None:
                return self.chart_html(node, ctx, tf)
            if node.find(".//dgm:relIds", NS) is not None:
                return self.diagram_html(node, ctx, tf)
            if node.find(".//p:oleObj", NS) is not None:
                return self.ole_html(node, ctx, tf)
            self.notes.append("an embedded object was skipped (not a picture, table, chart or SmartArt)")
            return ""
        if tag == q("p:grpSp"):
            return self.group_html(node, ctx, tf, from_layout)
        if tag == q("p:cxnSp"):
            return self.shape_html(node, ctx, tf, from_layout)
        if tag == q("mc:AlternateContent"):
            # newer content (ink, equations...) with what PowerPoint saves for older readers,
            # most often a picture of it
            branch = node.find("mc:Fallback", NS)
            if branch is None:
                return ""
            out = [self.node_html(child, ctx, tf, from_layout) for child in branch]
            return "\n".join(o for o in out if o)
        return ""

    def ole_html(self, frame, ctx, tf=None):
        """An embedded object (an Excel sheet, a ChemDraw drawing...) as the picture PowerPoint
        keeps of it."""
        pic = frame.find(".//p:oleObj/p:pic", NS)
        if pic is None:
            self.notes.append("an embedded object was skipped (the file has no picture of it)")
            return ""
        sp_pr = pic.find("p:spPr", NS)
        if sp_pr is None or sp_pr.find("a:xfrm", NS) is None:
            xfrm = frame.find("p:xfrm", NS)
            if xfrm is not None:
                if sp_pr is None:
                    sp_pr = ET.SubElement(pic, q("p:spPr"))
                own = ET.Element(q("a:xfrm"), dict(xfrm.attrib))
                own.extend(copy.deepcopy(list(xfrm)))
                sp_pr.insert(0, own)
        return self.picture_html(pic, ctx, tf)

    # -- background --------------------------------------------------------------------------
    def background_css(self, ctx):
        """The slide's background (its own, else the layout's, else the master's) as CSS."""
        theme = ctx["theme"]
        for part in (ctx["slide"], ctx["layout"], ctx["master"]):
            if not part:
                continue
            bg = self.xml(part).find("p:cSld/p:bg", NS)
            if bg is None:
                continue
            pr = bg.find("p:bgPr", NS)
            if pr is not None:
                css, kind = fill_css(pr, theme, None, self.picture_resolver(self.rels(part)))
                if css and kind != "none":
                    return f"background:{css};"
                return ""
            ref = bg.find("p:bgRef", NS)
            if ref is not None:
                idx = int(ref.get("idx", "0"))
                ph = first_colour(ref, theme)
                fills = theme.bg_fills if idx >= 1001 else theme.fills
                i = idx - 1001 if idx >= 1001 else idx - 1
                if 0 <= i < len(fills):
                    css, kind = fill_css(self._wrap(fills[i]), theme, ph[0] if ph else None, self.picture_resolver(self.rels(theme.part)) if theme.part else None)
                    if css and kind != "none":
                        return f"background:{css};"
                elif ph:
                    return f"background:{css_colour(ph)};"
        return ""

    def layout_shapes(self, ctx):
        """The decorative (non-placeholder) shapes of the master and the layout the slide shows."""
        out = []
        slide_root = self.xml(ctx["slide"])
        show = slide_root.find("p:cSld", NS).get("showMasterSp", "1") != "0" if slide_root.find("p:cSld", NS) is not None else True
        if not show:
            return out
        parts = []
        if ctx["layout"]:
            lay_root = self.xml(ctx["layout"])
            lay_show = lay_root.find("p:cSld", NS).get("showMasterSp", "1") != "0" if lay_root.find("p:cSld", NS) is not None else True
            if lay_show and ctx["master"]:
                parts.append(ctx["master"])
            parts.append(ctx["layout"])
        elif ctx["master"]:
            parts.append(ctx["master"])
        for part in parts:
            tree = self.xml(part).find("p:cSld/p:spTree", NS)
            if tree is None:
                continue
            sub = dict(ctx, slide=part, rels=self.rels(part))
            for node in tree:
                h = self.node_html(node, sub, None, from_layout=True)
                if h:
                    out.append(h)
        return out

    # -- slides -----------------------------------------------------------------------------------
    def slide_html(self, name, number):
        root = self.xml(name)
        ctx = self.context(name)
        tree = root.find("p:cSld/p:spTree", NS)
        parts = self.layout_shapes(ctx)
        for n in (tree if tree is not None else []):
            h = self.node_html(n, ctx)
            if h:
                parts.append(h)
        style = self.background_css(ctx)
        # default text colour of the slide: tx1 through the colour map, so text without a colour of its own is readable on dark themes
        style += f" color:{css_colour((ctx['theme'].scheme('tx1'), 1.0))};"
        if ctx["theme"].minor:
            style += f" font-family:'{ctx['theme'].minor}', sans-serif;"
        notes = ""
        for target in ctx["rels"].get("type:notesSlide", []):
            if target in self.names:
                nroot = self.xml(target)
                texts = []
                for sp in nroot.iter(q("p:sp")):
                    ph = self.ph_of(sp)
                    if ph is not None and ph.get("type") == "body":
                        for para in sp.iter(q("a:p")):
                            t = "".join((x.text or "") for x in para.iter(q("a:t")))
                            if t.strip():
                                texts.append(t.strip())
                notes = "\n".join(texts)
        title = ""
        for sp in root.iter(q("p:sp")):
            ph = self.ph_of(sp)
            if ph is not None and ph.get("type") in ("title", "ctrTitle"):
                title = "".join((t.text or "") for t in sp.iter(q("a:t"))).strip()
                break
        inner = "\n".join("    " + p.replace("\n", "\n    ") for p in parts)
        html = section(inner, "body", slug(title) if title else f"slide-{number}", notes, number=None, style=style)
        if root.get("show") == "0":
            html = html.replace('<section class="slide body-slide"', '<section class="slide body-slide" data-skip', 1)
        return html, title


def import_pptx(path, deck_dir):
    notes = []
    p = Pptx(path, deck_dir, notes)
    sections, deck_title = [], ""
    for i, name in enumerate(p.slides):
        html_, title = p.slide_html(name, i + 1)
        if not deck_title and title:
            deck_title = title
        sections.append(html_)
    if not sections:
        raise ValueError("the file has no slides")
    p.z.close()
    return build_deck(sections, deck_title, (p.stage_w, p.stage_h), footer=False), sorted(set(notes))
