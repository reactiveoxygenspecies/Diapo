"""Windows metafiles (.emf, .wmf) as SVG, for the PowerPoint import.

PowerPoint keeps pasted Office drawings, the previews of embedded objects (ChemDraw, Excel,
Visio...) and many pasted plots and pictures as metafile parts, which no browser draws. This
plays a metafile's GDI records into an SVG: paths, polygons, lines, curves and arcs, pens and
brushes (solid, hatched, dashed), text with its per-character spacing, bitmaps (decoded to PNG
and embedded, since an SVG shown as an image loads no other file), clipping, the mapping
modes and the world transform. Standard library only.

EMF+ (GDI+) records ride inside comment records. Office writes "dual" files that carry the
same picture as plain GDI records too, and that is what is played here; an EMF+-only file has
none, so it gives None.

    convert(data) -> (extension, bytes) | None

The extension is "svg", or "png" / "jpg" when the metafile is nothing but one picture filling
its frame (that picture is returned as it is, which is smaller and stays a photo in the
editor).
"""

import base64
import hashlib
import math
import re
import struct
import zlib

__all__ = ["convert"]

# -- small helpers ---------------------------------------------------------------------------

MM_TEXT, MM_ISOTROPIC, MM_ANISOTROPIC = 1, 7, 8
MM_UNIT_MM = {2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440}   # the fixed mapping modes
IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
SRCCOPY, SRCAND, SRCPAINT = 0x00CC0020, 0x008800C6, 0x00EE0086
# The largest bitmap decoded (40 million pixels: 8000 x 5000). A record can declare any size
# in a few bytes (an RLE bitmap of 20000 x 20000 is a handful of runs), and each pixel costs
# up to four bytes and the PNG encoding; a picture in a slide never needs more.
MAX_PIXELS = 40_000_000


def compose(m1, m2):
    """The affine map that applies m1, then m2 (each (a, b, c, d, e, f): x' = ax + cy + e,
    y' = bx + dy + f)."""
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2,
            e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2)


def colorref(v):
    return (v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF)


def hexcol(c):
    return "#%02x%02x%02x" % c


def xml_text(s):
    s = "".join(ch for ch in s if ch in "\t\n" or ord(ch) >= 32 and not 0xD800 <= ord(ch) <= 0xDFFF
                and ord(ch) not in (0xFFFE, 0xFFFF))
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def xml_attr(s):
    return xml_text(s).replace('"', "&quot;")


_TRAILING = re.compile(r"(\.\d*?)0+(?= |$)")       # 1.50 -> 1.5, 2.00 -> 2.
_BARE_DOT = re.compile(r"\.(?= |$)")                # 2. -> 2
_NEG_ZERO = re.compile(r"(?<![\d.])-0(?= |$)")

# -- bitmaps -----------------------------------------------------------------------------------

def _png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_bytes(w, h, colour_type, depth, rows, plte=None, trns=None):
    """A PNG from unfiltered rows (each without its filter byte)."""
    raw = b"".join(b"\x00" + r for r in rows)
    out = [b"\x89PNG\r\n\x1a\n", _png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, colour_type, 0, 0, 0))]
    if plte:
        out.append(_png_chunk(b"PLTE", plte))
    if trns:
        out.append(_png_chunk(b"tRNS", trns))
    out.append(_png_chunk(b"IDAT", zlib.compress(raw, 6)))
    out.append(_png_chunk(b"IEND", b""))
    return b"".join(out)


def _rle_decode(bits, w, h, four):
    """BI_RLE8 / BI_RLE4 to one index byte per pixel, bottom-up rows."""
    px = bytearray(w * h)
    x = y = i = 0
    n = len(bits)
    while i + 1 < n and y < h:
        a, b = bits[i], bits[i + 1]
        i += 2
        if a:                                   # a run of `a` pixels
            vals = ((b >> 4, b & 15) if four else (b, b))
            for k in range(a):
                if x < w:
                    px[y * w + x] = vals[k & 1]
                x += 1
        elif b == 0:                            # end of line
            x, y = 0, y + 1
        elif b == 1:                            # end of bitmap
            break
        elif b == 2:                            # delta
            if i + 1 >= n:
                break
            x += bits[i]
            y += bits[i + 1]
            i += 2
        else:                                   # b literal pixels
            if four:
                cnt = (b + 1) // 2
                for k in range(b):
                    v = bits[i + k // 2]
                    if x < w:
                        px[y * w + x] = (v >> 4) if k % 2 == 0 else (v & 15)
                    x += 1
            else:
                cnt = b
                for k in range(b):
                    if x < w and i + k < n:
                        px[y * w + x] = bits[i + k]
                    x += 1
            i += cnt + (cnt & 1)
    return px


def dib_image(bmi, bits, alpha=None, transparent=None, raw=False):
    """A device-independent bitmap (its BITMAPINFO and pixel bytes) as (mime, data, w, h,
    bottom_up), or None. alpha: True for a 32-bit bitmap whose alpha channel is premultiplied
    (AlphaBlend's), False to ignore that channel, None to keep it when it holds anything but
    one value (GDI ignores it, but Office plays the EMF+ copy of the picture, which has it);
    transparent is an (r, g, b) colour to make see-through. raw gives (w, h, rgb, bottom_up)
    instead, the pixels as top-down RGB bytes (None for an embedded JPEG or PNG)."""
    if len(bmi) < 12:
        return None
    hsize = struct.unpack_from("<I", bmi, 0)[0]
    if hsize == 12:
        w, h, _, bpp = struct.unpack_from("<HHHH", bmi, 4)
        comp, size_image, used, pal_off, pal_step = 0, 0, 0, 12, 3
    elif hsize >= 40 and len(bmi) >= 40:
        w, h, _, bpp, comp, size_image = struct.unpack_from("<iiHHII", bmi, 4)
        used = struct.unpack_from("<I", bmi, 32)[0]
        pal_off, pal_step = hsize, 4
    else:
        return None
    if comp in (4, 5):                            # BI_JPEG, BI_PNG: the file itself
        if raw:
            return None
        data = bytes(bits[:size_image] if size_image else bits)
        return ("image/jpeg" if comp == 4 else "image/png", data, w, abs(h), False)
    bottom_up = h > 0
    h = abs(h)
    if w <= 0 or h <= 0 or w * h > MAX_PIXELS:
        return None
    masks = None
    if comp == 3 or comp == 6:                    # BI_BITFIELDS (masks after a 40-byte header)
        masks = struct.unpack_from("<III", bmi, 40) if len(bmi) >= 52 else None
        pal_off = hsize + (12 if hsize == 40 else 0)
    palette = []
    if bpp <= 8:
        count = used or (1 << bpp)
        for k in range(count):
            o = pal_off + k * pal_step
            if o + 3 > len(bmi):
                break
            palette.append((bmi[o + 2], bmi[o + 1], bmi[o]))
        if not palette:
            palette = [(0, 0, 0), (255, 255, 255)] if bpp == 1 else [(v, v, v) for v in range(0, 256, max(1, 256 >> bpp))]
    if comp in (1, 2) and bpp in (4, 8):          # RLE: expand to 8-bit indices
        idx = _rle_decode(bits, w, h, comp == 2)
        rows = [bytes(idx[y * w:(y + 1) * w]) for y in range(h)]
        if bottom_up:
            rows.reverse()
        if raw:
            return w, h, _indices_rgb(b"".join(rows), palette), bottom_up
        return ("image/png",) + _palette_png(w, h, 8, rows, palette, transparent) + (bottom_up,)
    stride = ((w * bpp + 31) // 32) * 4
    if len(bits) < stride * (h - 1) + (w * bpp + 7) // 8:
        h = len(bits) // stride if stride else 0          # a truncated bitmap: keep the rows there are
        if h <= 0:
            return None
    rowbytes = (w * bpp + 7) // 8
    rows = [bits[y * stride:y * stride + rowbytes] for y in range(h)]
    if bottom_up:
        rows.reverse()
    if bpp in (1, 4, 8):
        if raw:
            return w, h, _indices_rgb(_unpack_indices(rows, bpp, w), palette), bottom_up
        return ("image/png",) + _palette_png(w, h, bpp, rows, palette, transparent) + (bottom_up,)
    buf = b"".join(rows)
    if bpp == 24:
        rgb = bytearray(len(buf))
        rgb[0::3], rgb[1::3], rgb[2::3] = buf[2::3], buf[1::3], buf[0::3]
        if raw:
            return w, h, rgb, bottom_up
        return ("image/png", _truecolour_png(w, h, rgb, 3, transparent), w, h, bottom_up)
    if bpp == 32 and (masks is None or masks[:3] == (0xFF0000, 0xFF00, 0xFF)):
        a_chan = buf[3::4]
        if raw:
            rgb = bytearray(w * h * 3)
            rgb[0::3], rgb[1::3], rgb[2::3] = buf[2::4], buf[1::4], buf[0::4]
            return w, h, rgb, bottom_up
        if alpha is not False and a_chan.count(0) != len(a_chan) and a_chan.count(255) != len(a_chan):
            rgba = bytearray(len(buf))
            rgba[0::4], rgba[1::4], rgba[2::4], rgba[3::4] = buf[2::4], buf[1::4], buf[0::4], buf[3::4]
            if alpha is None:                             # premultiplied when no colour exceeds its alpha
                step = max(1, len(a_chan) // 4000)
                alpha = all(max(rgba[i * 4:i * 4 + 3]) <= rgba[i * 4 + 3] for i in range(0, len(a_chan), step))
            if alpha:
                partial = a_chan.translate(_PARTIAL)
                i = partial.find(1)
                while i >= 0:
                    a = a_chan[i]
                    k = i * 4
                    rgba[k] = min(255, rgba[k] * 255 // a)
                    rgba[k + 1] = min(255, rgba[k + 1] * 255 // a)
                    rgba[k + 2] = min(255, rgba[k + 2] * 255 // a)
                    i = partial.find(1, i + 1)
            rows = [bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h)]
            return ("image/png", png_bytes(w, h, 6, 8, rows), w, h, bottom_up)
        rgb = bytearray(w * h * 3)
        rgb[0::3], rgb[1::3], rgb[2::3] = buf[2::4], buf[1::4], buf[0::4]
        return ("image/png", _truecolour_png(w, h, rgb, 3, transparent), w, h, bottom_up)
    if bpp in (16, 32):                            # bit fields: pixel by pixel
        if masks is None:
            masks = (0x7C00, 0x3E0, 0x1F)
        shifts = []
        for m in masks:
            s = (m & -m).bit_length() - 1 if m else 0
            top = (m >> s) if m else 1
            shifts.append((m, s, top or 1))
        fmt = "<%d%s" % (w * h, "H" if bpp == 16 else "I")
        vals = struct.unpack_from(fmt, buf, 0) if len(buf) >= w * h * bpp // 8 else ()
        rgb = bytearray(w * h * 3)
        for i, v in enumerate(vals):
            for k, (m, s, top) in enumerate(shifts):
                rgb[i * 3 + k] = ((v & m) >> s) * 255 // top
        if raw:
            return w, h, rgb, bottom_up
        return ("image/png", _truecolour_png(w, h, rgb, 3, transparent), w, h, bottom_up)
    return None


_PARTIAL = bytes([0] + [1] * 254 + [0])      # alpha values strictly between 0 and 255
_INVERT = bytes(range(255, -1, -1))
_BITS1 = [bytes((b >> (7 - k)) & 1 for k in range(8)) for b in range(256)]
_BITS4 = [bytes((b >> 4, b & 15)) for b in range(256)]


def _unpack_indices(rows, bpp, w):
    """Rows of 1- or 4-bit palette indices as one byte per pixel."""
    if bpp == 8:
        return b"".join(rows)
    table = _BITS1 if bpp == 1 else _BITS4
    return b"".join(b"".join(table[b] for b in row)[:w] for row in rows)


def _indices_rgb(idx, palette):
    pal = (list(palette) + [(0, 0, 0)] * 256)[:256]
    rgb = bytearray(len(idx) * 3)
    for c in range(3):
        rgb[c::3] = idx.translate(bytes(p[c] for p in pal))
    return rgb


def masked_image(mask, image, mask_is_or):
    """The two bitmaps of GDI's two-pass transparency (a black-and-white mask ORed or ANDed
    onto the page, then the picture ANDed or ORed over it) as one PNG with an alpha channel:
    (mime, data, w, h). An ORed mask is white where the picture shows, an ANDed one black."""
    mw, mh, m_rgb, _ = mask
    w, h, rgb, _ = image
    if (mw, mh) != (w, h):
        return None
    alpha = bytes(m_rgb[1::3])
    if not mask_is_or:
        alpha = alpha.translate(_INVERT)
    rgba = bytearray(w * h * 4)
    rgba[0::4], rgba[1::4], rgba[2::4], rgba[3::4] = rgb[0::3], rgb[1::3], rgb[2::3], alpha
    rows = [bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h)]
    return "image/png", png_bytes(w, h, 6, 8, rows), w, h


def dark_fraction(bmi, bits):
    """How much of a monochrome pattern brush is dark (0..1); 0.5 for any other bitmap."""
    if len(bmi) < 48 or struct.unpack_from("<I", bmi, 0)[0] < 40:
        return 0.5
    w, h, _, bpp = struct.unpack_from("<iiHH", bmi, 4)
    if bpp != 1 or w <= 0 or not h:
        return 0.5
    hsize = struct.unpack_from("<I", bmi, 0)[0]
    lum = [sum(bmi[hsize + 4 * k:hsize + 4 * k + 3]) / 765 for k in range(2)]
    stride = ((w + 31) // 32) * 4
    ones = total = 0
    for y in range(abs(h)):
        row = bits[y * stride:y * stride + stride]
        for x in range(w):
            if x // 8 < len(row):
                ones += (row[x // 8] >> (7 - x % 8)) & 1
                total += 1
    if not total:
        return 0.5
    return ((total - ones) * (1 - lum[0]) + ones * (1 - lum[1])) / total


def _palette_png(w, h, depth, rows, palette, transparent):
    n = 1 << depth
    pal = (palette + [(0, 0, 0)] * n)[:n]
    plte = b"".join(bytes(c) for c in pal)
    trns = None
    if transparent is not None:
        trns = bytes(0 if c == tuple(transparent) else 255 for c in pal)
    return png_bytes(w, h, 3, depth, rows, plte, trns), w, h


def _truecolour_png(w, h, rgb, _, transparent):
    rows = [bytes(rgb[y * w * 3:(y + 1) * w * 3]) for y in range(h)]
    trns = struct.pack(">HHH", *transparent) if transparent is not None else None
    return png_bytes(w, h, 2, 8, rows, None, trns)


# -- the drawing state -------------------------------------------------------------------------

class DC:
    """A GDI device context's drawing state (what SaveDC keeps)."""
    __slots__ = ("pen", "brush", "font", "text_colour", "bk_colour", "bk_mode", "fill_rule",
                 "text_align", "rop2", "map_mode", "win_org", "win_ext", "vp_org", "vp_ext",
                 "world", "clip", "arc_ccw", "cp", "M")

    def __init__(self):
        self.pen = STOCK[7]
        self.brush = STOCK[0]
        self.font = STOCK[13]
        self.text_colour = (0, 0, 0)
        self.bk_colour = (255, 255, 255)
        self.bk_mode = 2
        self.fill_rule = "evenodd"
        self.text_align = 0
        self.rop2 = 13
        self.map_mode = MM_TEXT
        self.win_org, self.win_ext = (0.0, 0.0), (1.0, 1.0)
        self.vp_org, self.vp_ext = (0.0, 0.0), (1.0, 1.0)
        self.world = IDENTITY
        self.clip = ()
        self.arc_ccw = True
        self.cp = (0.0, 0.0)
        self.M = IDENTITY

    def copy(self):
        c = DC.__new__(DC)
        for k in DC.__slots__:
            setattr(c, k, getattr(self, k))
        return c


def _pen(style=0, width=0.0, colour=(0, 0, 0), cosmetic=True, dashes=None):
    return {"kind": "pen", "style": style & 0xF, "width": width, "colour": colour, "cosmetic": cosmetic,
            "cap": {0: "round", 0x100: "square", 0x200: "butt"}.get(style & 0xF00, "round"),
            "join": {0: "round", 0x1000: "bevel", 0x2000: "miter"}.get(style & 0xF000, "round"),
            "dashes": dashes}


def _brush(style="solid", colour=(255, 255, 255), hatch=0, image=None):
    return {"kind": "brush", "style": style, "colour": colour, "hatch": hatch, "image": image}


def _font(height=-16, escapement=0, weight=400, italic=False, underline=False, strike=False,
          charset=0, family=0, face=""):
    return {"kind": "font", "height": height, "escapement": escapement, "weight": weight,
            "italic": italic, "underline": underline, "strike": strike, "charset": charset,
            "family": family, "face": face}


STOCK = {
    0: _brush(colour=(255, 255, 255)), 1: _brush(colour=(192, 192, 192)), 2: _brush(colour=(128, 128, 128)),
    3: _brush(colour=(64, 64, 64)), 4: _brush(colour=(0, 0, 0)), 5: _brush("null"),
    6: _pen(colour=(255, 255, 255)), 7: _pen(), 8: _pen(5),
    10: _font(face="Courier New", family=0x30), 11: _font(face="Courier New", family=0x30),
    12: _font(face="Arial"), 13: _font(face="Arial", weight=700), 14: _font(face="Arial"),
    16: _font(face="Courier New", family=0x30), 17: _font(face="Segoe UI", height=-11),
    18: _brush(colour=(255, 255, 255)), 19: _pen(),
}

HATCH = {  # an 8 x 8 cell's lines for each hatch style
    0: "M0 4H8", 1: "M4 0V8", 2: "M0 0L8 8M-1 7L1 9M7 -1L9 1", 3: "M0 8L8 0M-1 1L1 -1M7 9L9 7",
    4: "M0 4H8M4 0V8", 5: "M0 0L8 8M0 8L8 0",
}
GENERIC = {0x10: "serif", 0x20: "sans-serif", 0x30: "monospace", 0x40: "cursive", 0x50: "fantasy"}


class Player:
    """Plays GDI drawing calls into SVG elements, all in device coordinates."""

    def __init__(self):
        self.dc = DC()
        self.stack = []
        self.objects = {}
        self.body = []
        self.defs = []
        self.def_ids = {}
        self.open_clip = ()
        self.pending = None          # [key, [d...]] a stroke-only path that may absorb the next one
        self.path = None             # the path bracket's segments, in device coordinates
        self.path_start = None
        self.path_widened = False
        self.clip_path = None        # the last closed path, for SelectClipPath / FillPath
        self.mask_job = None         # a SRCAND / SRCPAINT blit waiting for its picture
        self.xor = None              # an open PATINVERT: ((x, y, w, h, colour), [masked shapes])
        self.images = []             # (id, transform, plain, w, h) of every image drawn
        self.image_data = {}         # image id -> (mime, bytes)
        self.drawn = 0               # every other element drawn
        self.prec = 2
        self.stroke_cache = {}
        self.bounds = (0, 0, 0, 0)
        self.px_per_mm = (96 / 25.4, 96 / 25.4)
        self.unsupported = {}

    # -- transforms --
    def update(self):
        dc = self.dc
        mm = dc.map_mode
        if mm == MM_TEXT:
            sx = sy = 1.0
        elif mm in MM_UNIT_MM:
            sx = MM_UNIT_MM[mm] * self.px_per_mm[0]
            sy = -MM_UNIT_MM[mm] * self.px_per_mm[1]
        else:
            sx = dc.vp_ext[0] / dc.win_ext[0] if dc.win_ext[0] else 1.0
            sy = dc.vp_ext[1] / dc.win_ext[1] if dc.win_ext[1] else 1.0
            if mm == MM_ISOTROPIC:
                m = min(abs(sx), abs(sy))
                sx, sy = math.copysign(m, sx), math.copysign(m, sy)
        page = (sx, 0.0, 0.0, sy, dc.vp_org[0] - dc.win_org[0] * sx, dc.vp_org[1] - dc.win_org[1] * sy)
        dc.M = compose(dc.world, page)

    def pt(self, x, y):
        a, b, c, d, e, f = self.dc.M
        return (a * x + c * y + e, b * x + d * y + f)

    def pts(self, flat):
        """Device points of a flat [x0, y0, x1, y1, ...] list of logical coordinates."""
        a, b, c, d, e, f = self.dc.M
        xs, ys = flat[0::2], flat[1::2]
        return [(a * x + c * y + e, b * x + d * y + f) for x, y in zip(xs, ys)]

    def scale(self):
        a, b, c, d = self.dc.M[:4]
        return math.sqrt(abs(a * d - b * c)) or 1.0

    # -- number formatting --
    def n(self, v):
        s = ("%.*f" % (self.prec, v)).rstrip("0").rstrip(".")
        return "0" if s in ("", "-0") else s

    def coords(self, points):
        if not points:
            return ""
        fmt = "%%.%df" % self.prec
        out = " ".join([fmt + " " + fmt] * len(points)) % tuple(v for pt in points for v in pt)
        return _NEG_ZERO.sub("0", _BARE_DOT.sub("", _TRAILING.sub(r"\1", out)))

    # -- styles --
    def fill_attr(self, colour_only=None):
        dc = self.dc
        if colour_only is not None:
            return 'fill="%s"' % hexcol(colour_only)
        b = dc.brush
        if dc.rop2 == 1:
            return 'fill="#000"'
        if dc.rop2 == 16:
            return 'fill="#fff"'
        if b["style"] == "null":
            return 'fill="none"'
        if b["style"] == "hatch" and b["hatch"] in HATCH:
            key = ("hatch", b["hatch"], b["colour"], dc.bk_mode == 2 and dc.bk_colour)
            pid = self.def_ids.get(key)
            if pid is None:
                pid = self.def_ids[key] = "h%d" % len(self.def_ids)
                bg = '<rect width="8" height="8" fill="%s"/>' % hexcol(dc.bk_colour) if dc.bk_mode == 2 else ""
                self.defs.append('<pattern id="%s" width="8" height="8" patternUnits="userSpaceOnUse">%s'
                                 '<path d="%s" stroke="%s" stroke-width="1" fill="none"/></pattern>'
                                 % (pid, bg, HATCH[b["hatch"]], hexcol(b["colour"])))
            return 'fill="url(#%s)"' % pid
        if b["style"] == "pattern" and b["image"]:
            href, w, h = b["image"]
            key = ("pat", href)
            pid = self.def_ids.get(key)
            if pid is None:
                pid = self.def_ids[key] = "p%d" % len(self.def_ids)
                self.defs.append('<pattern id="%s" width="%d" height="%d" patternUnits="userSpaceOnUse">'
                                 '<image width="%d" height="%d" href="%s"/></pattern>' % (pid, w, h, w, h, href))
            return 'fill="url(#%s)"' % pid
        return 'fill="%s"' % hexcol(b["colour"])

    def stroke_attr(self, pen=None, colour=None):
        dc = self.dc
        p = pen or dc.pen
        key = (id(p), colour, dc.rop2, dc.M[:4])
        hit = self.stroke_cache.get(key)
        if hit is not None and hit[0] is p:
            return hit[1]
        out = self._stroke_attr(p, colour)
        if len(self.stroke_cache) > 5000:
            self.stroke_cache.clear()
        self.stroke_cache[key] = (p, out)
        return out

    def _stroke_attr(self, p, colour):
        dc = self.dc
        if p["style"] == 5:
            return ""
        col = colour or p["colour"]
        if dc.rop2 == 1:
            col = (0, 0, 0)
        elif dc.rop2 == 16:
            col = (255, 255, 255)
        s = self.scale()
        w = p["width"] * s
        cosmetic = p["cosmetic"] or w < 1          # GDI draws no line thinner than a pixel
        if cosmetic:
            w = 1.0
        out = 'stroke="%s" stroke-width="%s"' % (hexcol(col), self.n(w))
        if cosmetic:
            out += ' vector-effect="non-scaling-stroke"'
        else:
            if p["cap"] != "butt":
                out += ' stroke-linecap="%s"' % p["cap"]
            if p["join"] != "miter":
                out += ' stroke-linejoin="%s"' % p["join"]
        style = p["style"]
        unit = 1.0 if cosmetic else max(w, 1.0)
        dashes = None
        if style == 7 and p["dashes"]:
            dashes = [v * (1 if cosmetic else s) for v in p["dashes"]]
        elif style in (1, 2, 3, 4):
            base = {1: [6, 2], 2: [1, 2], 3: [6, 2, 1, 2], 4: [6, 2, 1, 2, 1, 2]}[style] if cosmetic else \
                {1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1]}[style]
            dashes = [v * unit for v in base]
        if dashes:
            out += ' stroke-dasharray="%s"' % " ".join(self.n(v) for v in dashes)
        return out

    # -- output --
    def flush(self):
        if self.pending:
            key, ds = self.pending
            self.body.append('<path d="%s" fill="none" %s/>' % ("".join(ds), key[0]))
            self.pending = None

    def set_clip_groups(self):
        want = self.dc.clip
        if want == self.open_clip:
            return
        self.flush()
        k = 0
        while k < len(want) and k < len(self.open_clip) and want[k] == self.open_clip[k]:
            k += 1
        self.body.append("</g>" * (len(self.open_clip) - k))
        for cid in want[k:]:
            self.body.append('<g clip-path="url(#%s)">' % cid)
        self.open_clip = want

    def put(self, el):
        if self.mask_job:
            self.flush_mask()
        if self.dc.rop2 == 11:                      # R2_NOP draws nothing
            return
        self.set_clip_groups()
        self.flush()
        self.body.append(el)
        self.drawn += 1

    def put_stroke(self, d):
        """A stroke-only path: consecutive ones with the same pen become one element."""
        if self.dc.rop2 == 11 or not d:
            return
        if self.mask_job:
            self.flush_mask()
        attr = self.stroke_attr()
        if not attr:
            return
        self.set_clip_groups()
        key = (attr, self.open_clip)
        if self.pending and self.pending[0] == key and len(self.pending[1]) < 5000:
            self.pending[1].append(d)
        else:
            self.flush()
            self.pending = [key, [d]]
        self.drawn += 1

    def put_shape(self, d, fill=True, stroke=True):
        dc = self.dc
        if self.xor is not None and dc.rop2 == 9 and fill and dc.brush["style"] != "null":
            b = dc.brush
            cover = b.get("dark", 1 - sum(b["colour"]) / 765)
            self.xor[1].append((d, cover, dc.fill_rule))
            return
        f = self.fill_attr() if fill else 'fill="none"'
        s = self.stroke_attr() if stroke else ""
        if f == 'fill="none"' and not s:
            return
        if f == 'fill="none"':
            return self.put_stroke(d)
        rule = ' fill-rule="evenodd"' if dc.fill_rule == "evenodd" and fill else ""
        blend = {9: "multiply", 15: "lighten", 7: "difference"}.get(dc.rop2)
        if blend:
            rule += ' style="mix-blend-mode:%s"' % blend
        self.put('<path d="%s" %s%s%s/>' % (d, f, rule, " " + s if s else ""))

    def add_clip(self, d, rule="nonzero", mode="and"):
        key = ("clip", d, rule)
        cid = self.def_ids.get(key)
        if cid is None:
            cid = self.def_ids[key] = "c%d" % len(self.def_ids)
            self.defs.append('<clipPath id="%s"><path d="%s"%s/></clipPath>'
                             % (cid, d, ' clip-rule="evenodd"' if rule == "evenodd" else ""))
        dc = self.dc
        dc.clip = (cid,) if mode == "copy" else dc.clip + (cid,)

    def rect_d(self, l, t, r, b, logical=True):
        corners = [(l, t), (r, t), (r, b), (l, b)]
        if logical:
            corners = [self.pt(x, y) for x, y in corners]
        return "M" + self.coords(corners) + "Z"

    # -- geometry into the path bracket or onto the page --
    def figure(self, d, closed, fill=True):
        """One figure (a 'M...' string); in a path bracket it is recorded, else drawn."""
        if self.path is not None:
            self.path.append(d + ("Z" if closed and not d.endswith("Z") else ""))
            return
        if closed:
            self.put_shape(d if d.endswith("Z") else d + "Z", fill=fill)
        else:
            self.put_stroke(d)

    def polyline(self, flat, closed):
        p = self.pts(flat)
        if len(p) < 2:
            return
        self.figure("M" + self.coords(p[:1]) + "L" + self.coords(p[1:]), closed)

    def polybezier(self, flat, start=None):
        p = self.pts(flat)
        if start is not None:
            p = [start] + p
        if len(p) < 4:
            return
        n = 1 + (len(p) - 1) // 3 * 3
        self.figure("M" + self.coords(p[:1]) + "C" + self.coords(p[1:n]), False)

    def to_line(self, flat):
        """LineTo / PolylineTo: lines from the current position."""
        p = self.pts(flat)
        if not p:
            return
        start = self.pt(*self.dc.cp)
        self.dc.cp = (flat[-2], flat[-1])
        if self.path is not None:
            self._path_move(start)
            self.path.append("L" + self.coords(p))
        else:
            self.put_stroke("M" + self.coords([start]) + "L" + self.coords(p))

    def to_bezier(self, flat):
        p = self.pts(flat)
        n = len(p) // 3 * 3
        if not n:
            return
        start = self.pt(*self.dc.cp)
        self.dc.cp = (flat[2 * n - 2], flat[2 * n - 1])
        if self.path is not None:
            self._path_move(start)
            self.path.append("C" + self.coords(p[:n]))
        else:
            self.put_stroke("M" + self.coords([start]) + "C" + self.coords(p[:n]))

    def _path_move(self, start):
        if not self.path or self.path[-1].endswith("Z") or self.path_start is None:
            self.path.append("M" + self.coords([start]))
            self.path_start = start

    def move_to(self, x, y):
        self.dc.cp = (x, y)
        if self.path is not None:
            p = self.pt(x, y)
            self.path.append("M" + self.coords([p]))
            self.path_start = p

    def ellipse_pts(self, l, t, r, b, a0=0.0, sweep=2 * math.pi):
        """Bezier points (logical) of an arc of the ellipse in the box, from angle a0 through
        sweep (radians, counterclockwise on a y-down page)."""
        cx, cy, rx, ry = (l + r) / 2, (t + b) / 2, abs(r - l) / 2, abs(b - t) / 2
        segs = max(1, int(math.ceil(abs(sweep) / (math.pi / 2) - 1e-9)))
        da = sweep / segs
        k = 4 / 3 * math.tan(da / 4)
        out = [(cx + rx * math.cos(a0), cy - ry * math.sin(a0))]
        a = a0
        for _ in range(segs):
            a2 = a + da
            c1 = (cx + rx * (math.cos(a) - k * math.sin(a)), cy - ry * (math.sin(a) + k * math.cos(a)))
            c2 = (cx + rx * (math.cos(a2) + k * math.sin(a2)), cy - ry * (math.sin(a2) - k * math.cos(a2)))
            out += [c1, c2, (cx + rx * math.cos(a2), cy - ry * math.sin(a2))]
            a = a2
        return out, (cx, cy)

    def arc(self, kind, l, t, r, b, xs, ys, xe, ye):
        cx, cy, rx, ry = (l + r) / 2, (t + b) / 2, abs(r - l) / 2 or 1, abs(b - t) / 2 or 1
        a0 = math.atan2(-(ys - cy) / ry, (xs - cx) / rx)
        a1 = math.atan2(-(ye - cy) / ry, (xe - cx) / rx)
        if self.dc.arc_ccw:
            sweep = (a1 - a0) % (2 * math.pi) or 2 * math.pi
        else:
            sweep = -((a0 - a1) % (2 * math.pi) or 2 * math.pi)
        pts, centre = self.ellipse_pts(l, t, r, b, a0, sweep)
        dev = [self.pt(x, y) for x, y in pts]
        if kind == "arcto":
            start = self.pt(*self.dc.cp)
            self.dc.cp = pts[-1]
            if self.path is not None:
                self._path_move(start)
                self.path.append("L" + self.coords(dev[:1]) + "C" + self.coords(dev[1:]))
            else:
                self.put_stroke("M" + self.coords([start]) + "L" + self.coords(dev[:1]) + "C" + self.coords(dev[1:]))
            return
        d = "M" + self.coords(dev[:1]) + "C" + self.coords(dev[1:])
        if kind == "arc":
            self.figure(d, False)
        elif kind == "chord":
            self.figure(d + "Z", True)
        else:
            self.figure(d + "L" + self.coords([self.pt(*centre)]) + "Z", True)

    def ellipse(self, l, t, r, b):
        pts, _ = self.ellipse_pts(l, t, r, b)
        dev = [self.pt(x, y) for x, y in pts]
        self.figure("M" + self.coords(dev[:1]) + "C" + self.coords(dev[1:]) + "Z", True)

    def rectangle(self, l, t, r, b):
        self.figure(self.rect_d(l, t, r, b), True)

    def round_rect(self, l, t, r, b, cw, ch):
        l, r = min(l, r), max(l, r)
        t, b = min(t, b), max(t, b)
        rx, ry = min(abs(cw) / 2, (r - l) / 2), min(abs(ch) / 2, (b - t) / 2)
        if rx <= 0 or ry <= 0:
            return self.rectangle(l, t, r, b)
        k = 0.5523
        p = [(l + rx, t), (r - rx, t), (r - rx + rx * k, t), (r, t + ry - ry * k), (r, t + ry),
             (r, b - ry), (r, b - ry + ry * k), (r - rx + rx * k, b), (r - rx, b),
             (l + rx, b), (l + rx - rx * k, b), (l, b - ry + ry * k), (l, b - ry),
             (l, t + ry), (l, t + ry - ry * k), (l + rx - rx * k, t), (l + rx, t)]
        dv = [self.pt(x, y) for x, y in p]
        c = self.coords
        self.figure("M%sL%sC%sL%sC%sL%sC%sL%sC%sZ" % (c(dv[0:1]), c(dv[1:2]), c(dv[2:5]), c(dv[5:6]), c(dv[6:9]),
                                                     c(dv[9:10]), c(dv[10:13]), c(dv[13:14]), c(dv[14:17])), True)

    # -- the path bracket --
    def begin_path(self):
        self.path = []
        self.path_start = None
        self.path_widened = False

    def end_path(self):
        if self.path is not None:
            self.clip_path = "".join(self.path)
        self.path = None

    def close_figure(self):
        if self.path and not self.path[-1].endswith("Z"):
            self.path.append("Z")

    def draw_path(self, fill, stroke):
        d = self.clip_path
        self.clip_path = None
        if not d:
            return
        if self.path_widened and fill:               # a widened path filled: the pen's outline in the brush
            b = self.dc.brush
            if b["style"] != "null":
                self.put('<path d="%s" fill="none" %s/>' % (d, self.stroke_attr(colour=b["colour"])))
            return
        self.put_shape(d, fill=fill, stroke=stroke)

    def select_clip_path(self, mode):
        d = self.clip_path
        self.clip_path = None
        if d:
            self.add_clip(d, self.dc.fill_rule, "copy" if mode == 5 else "and")

    # -- text --
    def text(self, x, y, s, dx=None, opaque_rect=None, update_cp=None):
        dc = self.dc
        s = s.rstrip("\x00")
        if not s and not opaque_rect:
            return
        f = dc.font
        if opaque_rect:
            l, t, r, b = opaque_rect
            if r > l and b > t:
                self.put('<path d="%s" %s/>' % (self.rect_d(l, t, r, b), self.fill_attr(dc.bk_colour)))
        if not s.strip():
            return
        align = dc.text_align
        if align & 1 and update_cp is not False:     # TA_UPDATECP
            x, y = dc.cp
        a, b, c, d, e, g = dc.M
        ox, oy = a * x + c * y + e, b * x + d * y + g
        su, sv = math.hypot(a, b) or 1.0, math.hypot(c, d) or 1.0
        ux, uy = a / su, b / su
        # everything below is in device units, on a baseline along the logical x axis (turned
        # by the escapement), glyphs upright: the height scales with y, the advances with x
        h = f["height"]
        em = (-h if h < 0 else (h / 1.15 if h > 0 else 12.0)) * sv
        if dx:
            dx = [v * su for v in dx[:len(s)]]
            dx += [dx[-1] if dx else em * 0.5] * (len(s) - len(dx))
            if len(dx) > 1 and dx[-1] <= 0:
                dx[-1] = sorted(dx[:-1])[(len(dx) - 1) // 2]
            elif dx[-1] <= 0:
                dx = None
        width = sum(dx) if dx else None
        halign, valign = align & 6, align & 24
        ybase = 0.0 if valign == 24 else (-0.22 * em if valign == 8 else 0.9 * em)
        anchor = ""
        x0 = 0.0
        if width:
            x0 = {0: 0.0, 2: -width, 6: -width / 2}.get(halign, 0.0)
            gaps = sorted(dx)
            if gaps[-1] <= 3 * max(gaps[len(gaps) // 2], em * 0.2):
                # even advances: the text fills the width it had (the font here may be wider
                # or narrower than the one it was laid out with)
                xattr = 'x="%s" textLength="%s" lengthAdjust="spacingAndGlyphs"' % (self.n(x0), self.n(width))
            else:                                   # tabs or wide gaps: each character where it was
                xs, acc = [], x0
                for v in dx:
                    xs.append(acc)
                    acc += v
                xattr = 'x="%s"' % " ".join(self.n(v) for v in xs)
        else:
            xattr = 'x="0"'
            anchor = {2: ' text-anchor="end"', 6: ' text-anchor="middle"'}.get(halign, "")
        if align & 1 and width is not None:
            dc.cp = (x + (width / su if halign == 0 else 0), y)
        tf = "matrix(%.6g %.6g %.6g %.6g %s %s)" % (ux, uy, -uy, ux, self.n(ox), self.n(oy))
        if f["escapement"]:
            flip = 1 if a * d - b * c < 0 else -1
            tf += " rotate(%.6g)" % (flip * f["escapement"] / 10)
        face = f["face"].replace("'", "")
        generic = GENERIC.get(f["family"] & 0xF0, "sans-serif")
        family = ("'%s'," % xml_attr(face) if face else "") + generic
        weight = f["weight"]
        low = face.lower()
        if weight in (0, 400):
            weight = next((w for k, w in (("black", 900), ("heavy", 900), ("extrabold", 800), ("bold", 700),
                                          ("semibold", 600), ("medium", 500), ("light", 300), ("thin", 100))
                           if k in low), weight)
        style = ' font-weight="%d"' % weight if weight and weight != 400 else ""
        if "condensed" in low or "narrow" in low:
            style += ' font-stretch="condensed"'
        if f["italic"]:
            style += ' font-style="italic"'
        deco = " ".join(k for k, on in (("underline", f["underline"]), ("line-through", f["strike"])) if on)
        if deco:
            style += ' text-decoration="%s"' % deco
        if dc.bk_mode == 2 and width and not opaque_rect:
            bg = [(x0, ybase - 0.9 * em), (x0 + width, ybase - 0.9 * em), (x0 + width, ybase + 0.25 * em), (x0, ybase + 0.25 * em)]
            self.put('<path d="M%sZ" transform="%s" %s/>' % (self.coords(bg), tf, self.fill_attr(dc.bk_colour)))
        self.put('<text transform="%s" %s y="%s" font-family="%s" font-size="%s"%s%s fill="%s" xml:space="preserve">%s</text>'
                 % (tf, xattr, self.n(ybase), family, self.n(em), style, anchor, hexcol(dc.text_colour), xml_text(s)))

    # -- bitmaps --
    def image_def(self, img):
        mime, data, w, h, _ = img
        digest = hashlib.md5(data).hexdigest()
        key = ("img", digest)
        iid = self.def_ids.get(key)
        if iid is None:
            iid = self.def_ids[key] = "i%d" % len(self.def_ids)
            self.defs.append('<image id="%s" width="%d" height="%d" preserveAspectRatio="none" href="data:%s;base64,%s"/>'
                             % (iid, w, h, mime, base64.b64encode(data).decode("ascii")))
            self.image_data[iid] = (mime, data)
        return iid

    def blit(self, bmi, bits, x, y, cw, ch, sx, sy, sw, sh, rop=SRCCOPY, from_bottom=False, opacity=1.0, **kw):
        """Draw a bitmap (its BITMAPINFO and pixel bytes): its source rectangle (sx, sy, sw, sh;
        pixels) into the logical rectangle (x, y, cw, ch). A mask blitted with SRCAND or
        SRCPAINT waits for the picture that may follow it onto the same place."""
        if not bmi or self.dc.rop2 == 11:
            return
        job = (bmi, bits, (x, y, cw, ch, sx, sy, sw, sh), rop, from_bottom, opacity, kw, self.dc.M)
        if rop in (SRCAND, SRCPAINT):
            prev, self.mask_job = self.mask_job, None
            if prev and prev[3] != rop and prev[2] == job[2] and prev[7] == job[7]:
                mask = dib_image(prev[0], prev[1], raw=True)
                image = dib_image(bmi, bits, raw=True)
                img = masked_image(mask, image, prev[3] == SRCPAINT) if mask and image else None
                if img:
                    self.draw_image(img + (image[3],), job[2], SRCCOPY, from_bottom, opacity, job[7])
                    return
            if prev:
                self.run_job(prev)
            self.mask_job = job
            return
        self.flush_mask()
        self.run_job(job)

    def flush_mask(self):
        job, self.mask_job = self.mask_job, None
        if job:
            self.run_job(job)

    def run_job(self, job):
        bmi, bits, rect, rop, from_bottom, opacity, kw, M = job
        img = dib_image(bmi, bits, **kw)
        if img:
            self.draw_image(img, rect, rop, from_bottom, opacity, M)

    def draw_image(self, img, rect, rop, from_bottom, opacity, M):
        x, y, cw, ch, sx, sy, sw, sh = rect
        W, H = img[2], img[3]
        if sw <= 0 or sh <= 0:
            sx, sy, sw, sh = 0, 0, W, H
        if from_bottom and img[4]:
            sy = H - sy - sh
        iid = self.image_def(img)
        m = compose((cw / sw, 0.0, 0.0, ch / sh, x - sx * cw / sw, y - sy * ch / sh), M)
        tf = "matrix(%s)" % " ".join("%.6g" % v for v in m)
        blend = {SRCAND: "multiply", SRCPAINT: "lighten", 0x00660046: "difference"}.get(rop)
        style = ' style="mix-blend-mode:%s"' % blend if blend else ""
        if opacity < 1:
            style += ' opacity="%.3f"' % opacity
        whole = (sx, sy, sw, sh) == (0, 0, W, H)
        if whole:
            el = '<use href="#%s" transform="%s"%s/>' % (iid, tf, style)
        else:
            el = ('<svg x="%s" y="%s" width="%s" height="%s" viewBox="%s %s %s %s" preserveAspectRatio="none" '
                  'overflow="hidden"><use href="#%s"/></svg>' % tuple(
                      ["%.6g" % v for v in (sx, sy, sw, sh, sx, sy, sw, sh)] + [iid]))
            el = '<g transform="%s"%s>%s</g>' % (tf, style, el)
        self.put(el)
        self.drawn -= 1
        self.images.append((iid, m, whole and not style and not self.dc.clip, W, H))

    def pat_fill(self, x, y, cw, ch, rop):
        """A BitBlt without a source: the brush (or black / white) over a rectangle."""
        if rop == 0x005A0049:
            # PATINVERT, a mask drawn with R2_MASKPEN, PATINVERT again: GDI's way to lay a colour
            # through a dither pattern, which stands for transparency. The shapes are drawn in
            # the colour with the pattern's density as their opacity.
            key = (x, y, cw, ch, self.dc.brush["colour"])
            if self.xor and self.xor[0] == key:
                self.flush_xor()
            else:
                self.flush_xor()
                self.xor = (key, [])
            return
        if rop == 0x00000042:
            f = self.fill_attr((0, 0, 0))
        elif rop == 0x00FF0062:
            f = self.fill_attr((255, 255, 255))
        elif rop in (0x00F00021, 0x005A0049):
            f = self.fill_attr()
        else:
            return
        if f != 'fill="none"':
            self.put('<path d="%s" %s/>' % (self.rect_d(x, y, x + cw, y + ch), f))

    def flush_xor(self):
        if not self.xor:
            return
        (_, _, _, _, colour), shapes = self.xor
        self.xor = None
        for d, cover, rule in shapes:
            if cover > 0.01:
                self.put('<path d="%s" fill="%s" fill-opacity="%.2f"%s/>'
                         % (d, hexcol(colour), min(1.0, cover), ' fill-rule="evenodd"' if rule == "evenodd" else ""))

    # -- objects --
    def select(self, handle):
        o = STOCK.get(handle & 0x7FFFFFFF) if handle & 0x80000000 else self.objects.get(handle)
        if o is None:
            return
        k = o["kind"]
        if k == "pen":
            self.dc.pen = o
        elif k == "brush":
            self.dc.brush = o
        elif k == "font":
            self.dc.font = o

    def save(self):
        self.stack.append(self.dc.copy())

    def restore(self, rel):
        if rel >= 0:                           # an absolute level (WMF only uses -1, EMF negatives)
            rel = rel - len(self.stack) - 1 if rel else -1
        for _ in range(-rel):
            if not self.stack:
                return
            self.dc = self.stack.pop()

    def note(self, what):
        self.unsupported[what] = self.unsupported.get(what, 0) + 1

    # -- the document --
    def svg(self, vx, vy, vw, vh, width_px, height_px):
        self.flush_mask()
        self.flush_xor()
        self.flush()
        self.body.append("</g>" * len(self.open_clip))
        self.open_clip = ()
        n = self.n
        head = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s %s %s %s" width="%s" height="%s" '
                'preserveAspectRatio="none" overflow="hidden">' % (n(vx), n(vy), n(vw), n(vh), n(width_px), n(height_px)))
        defs = "<defs>%s</defs>" % "".join(self.defs) if self.defs else ""
        return head + defs + "\n".join(self.body) + "</svg>"

    def lone_image(self, vx, vy, vw, vh):
        """The one picture a metafile is made of, when it fills the frame and nothing else is
        drawn: (mime, data)."""
        if self.drawn or len(self.images) != 1:
            return None
        iid, m, plain, W, H = self.images[0]
        if not plain or abs(m[1]) > 1e-6 or abs(m[2]) > 1e-6 or m[0] <= 0 or m[3] <= 0:
            return None
        x0, y0, x1, y1 = m[4], m[5], m[4] + m[0] * W, m[5] + m[3] * H
        tol = 0.02 * max(vw, vh)
        if all(abs(p - q) <= tol for p, q in ((x0, vx), (y0, vy), (x1, vx + vw), (y1, vy + vh))):
            return self.image_data[iid]
        return None


# -- EMF ------------------------------------------------------------------------------------------

def _i32(d, o, n=1):
    return struct.unpack_from("<%di" % n, d, o)


def _points(d, o, count, small):
    if count <= 0:
        return []
    fmt = "<%d%s" % (count * 2, "h" if small else "i")
    need = count * (4 if small else 8)
    if o + need > len(d):
        return []
    return list(struct.unpack_from(fmt, d, o))


def emf_to_svg(data):
    d = memoryview(data).tobytes() if not isinstance(data, bytes) else data
    if len(d) < 88 or struct.unpack_from("<I", d, 0)[0] != 1 or d[40:44] != b" EMF":
        return None
    hsize = struct.unpack_from("<I", d, 4)[0]
    bounds = _i32(d, 8, 4)
    frame = _i32(d, 24, 4)
    dev = _i32(d, 72, 2)
    mm = _i32(d, 80, 2)
    p = Player()
    p.bounds = bounds
    if hsize >= 108 and len(d) >= 108:
        um = _i32(d, 100, 2)
        if um[0] > 0 and um[1] > 0 and abs(um[0] / 1000 - mm[0]) < 1.5 and abs(um[1] / 1000 - mm[1]) < 1.5:
            mm = (um[0] / 1000, um[1] / 1000)
    if dev[0] > 0 and dev[1] > 0 and mm[0] > 0 and mm[1] > 0:
        p.px_per_mm = (dev[0] / mm[0], dev[1] / mm[1])
    ppx, ppy = p.px_per_mm
    fl, ft, fr, fb = frame
    if fr > fl and fb > ft:
        vx, vy = fl / 100 * ppx, ft / 100 * ppy
        vw, vh = (fr - fl) / 100 * ppx, (fb - ft) / 100 * ppy
        width_mm, height_mm = (fr - fl) / 100, (fb - ft) / 100
    else:
        bl, bt, br, bb = bounds
        vx, vy, vw, vh = bl, bt, max(1, br - bl + 1), max(1, bb - bt + 1)
        width_mm, height_mm = vw / ppx, vh / ppy
    p.prec = 2 if max(vw, vh) < 2000 else 1
    plus_only = False

    handlers = _emf_handlers()
    off = 0
    n = len(d)
    while off + 8 <= n:
        rtype, size = struct.unpack_from("<II", d, off)
        if size < 8 or off + size > n:
            break
        if rtype == 14:
            break
        if rtype == 70 and off == hsize and size >= 16 and d[off + 12:off + 16] == b"EMF+":
            # an EMF+ header's flags: bit 0 set means the GDI records are there to be played too
            if size >= 32 and not (struct.unpack_from("<I", d, off + 16 + 12)[0] & 1):
                plus_only = True
        h = handlers.get(rtype)
        if h is not None:
            try:
                h(p, d, off, size)
            except (struct.error, IndexError, ValueError, ZeroDivisionError, OverflowError):
                p.note("bad record %d" % rtype)
        elif rtype not in _EMF_IGNORED:
            p.note("record %d" % rtype)
        off += size
    if plus_only and not (p.drawn or p.images):
        return None
    if not (p.drawn or p.images):
        return None
    lone = p.lone_image(vx, vy, vw, vh)
    if lone:
        return lone
    px = 96 / 25.4
    return ("image/svg+xml", p.svg(vx, vy, vw, vh, width_mm * px, height_mm * px).encode("utf-8"))


_EMF_IGNORED = {1, 16, 23, 26, 48, 49, 50, 51, 52, 65, 68, 69, 70, 98, 99, 100, 101, 102, 103,
                104, 105, 106, 107, 110, 111, 112, 113, 115, 117, 119, 120, 121, 122}


def _emf_handlers():
    H = {}

    def reg(*types):
        def wrap(fn):
            for t in types:
                H[t] = fn
            return fn
        return wrap

    # -- state --
    @reg(9)
    def set_window_ext(p, d, o, s):
        x, y = _i32(d, o + 8, 2)
        p.dc.win_ext = (float(x), float(y))
        p.update()

    @reg(10)
    def set_window_org(p, d, o, s):
        x, y = _i32(d, o + 8, 2)
        p.dc.win_org = (float(x), float(y))
        p.update()

    @reg(11)
    def set_viewport_ext(p, d, o, s):
        x, y = _i32(d, o + 8, 2)
        p.dc.vp_ext = (float(x), float(y))
        p.update()

    @reg(12)
    def set_viewport_org(p, d, o, s):
        x, y = _i32(d, o + 8, 2)
        p.dc.vp_org = (float(x), float(y))
        p.update()

    @reg(31, 32)
    def scale_ext(p, d, o, s):
        xn, xd, yn, yd = _i32(d, o + 8, 4)
        if xd and yd:
            ext = p.dc.vp_ext if struct.unpack_from("<I", d, o)[0] == 31 else p.dc.win_ext
            ext = (ext[0] * xn / xd, ext[1] * yn / yd)
            if struct.unpack_from("<I", d, o)[0] == 31:
                p.dc.vp_ext = ext
            else:
                p.dc.win_ext = ext
            p.update()

    @reg(17)
    def set_map_mode(p, d, o, s):
        p.dc.map_mode = _i32(d, o + 8)[0]
        p.update()

    @reg(35)
    def set_world(p, d, o, s):
        p.dc.world = struct.unpack_from("<6f", d, o + 8)
        p.update()

    @reg(36)
    def modify_world(p, d, o, s):
        x = struct.unpack_from("<6f", d, o + 8)
        mode = struct.unpack_from("<I", d, o + 32)[0]
        if mode == 1:
            p.dc.world = IDENTITY
        elif mode == 2:
            p.dc.world = compose(x, p.dc.world)
        elif mode == 3:
            p.dc.world = compose(p.dc.world, x)
        elif mode == 4:
            p.dc.world = x
        p.update()

    @reg(33)
    def save_dc(p, d, o, s):
        p.save()

    @reg(34)
    def restore_dc(p, d, o, s):
        p.restore(_i32(d, o + 8)[0])

    @reg(18)
    def set_bk_mode(p, d, o, s):
        p.dc.bk_mode = _i32(d, o + 8)[0]

    @reg(19)
    def set_fill_mode(p, d, o, s):
        p.dc.fill_rule = "nonzero" if _i32(d, o + 8)[0] == 2 else "evenodd"

    @reg(20)
    def set_rop2(p, d, o, s):
        p.dc.rop2 = _i32(d, o + 8)[0]

    @reg(22)
    def set_text_align(p, d, o, s):
        p.dc.text_align = _i32(d, o + 8)[0]

    @reg(24)
    def set_text_colour(p, d, o, s):
        p.dc.text_colour = colorref(struct.unpack_from("<I", d, o + 8)[0])

    @reg(25)
    def set_bk_colour(p, d, o, s):
        p.dc.bk_colour = colorref(struct.unpack_from("<I", d, o + 8)[0])

    @reg(57)
    def set_arc_direction(p, d, o, s):
        p.dc.arc_ccw = _i32(d, o + 8)[0] != 2

    @reg(13, 21, 58, 28, 66)
    def ignored(p, d, o, s):
        pass

    # -- objects --
    @reg(37)
    def select_object(p, d, o, s):
        p.select(struct.unpack_from("<I", d, o + 8)[0])

    @reg(40)
    def delete_object(p, d, o, s):
        p.objects.pop(struct.unpack_from("<I", d, o + 8)[0], None)

    @reg(38)
    def create_pen(p, d, o, s):
        ih, style, wx, wy, col = struct.unpack_from("<IIiiI", d, o + 8)
        p.objects[ih] = _pen(style, float(wx), colorref(col), cosmetic=wx <= 0)   # width 0: one pixel

    @reg(95)
    def ext_create_pen(p, d, o, s):
        ih = struct.unpack_from("<I", d, o + 8)[0]
        off_bmi, cb_bmi, off_bits, cb_bits = struct.unpack_from("<IIII", d, o + 12)
        style, width, bstyle, col, hatch, nent = struct.unpack_from("<IIIIII", d, o + 28)
        dashes = list(struct.unpack_from("<%dI" % nent, d, o + 52)) if nent and o + 52 + 4 * nent <= o + s else None
        pen = _pen(style, float(width), colorref(col), cosmetic=not (style & 0x10000), dashes=dashes)
        if bstyle == 1:                         # BS_NULL: no pen at all
            pen["style"] = 5
        p.objects[ih] = pen

    @reg(39)
    def create_brush(p, d, o, s):
        ih, style, col, hatch = struct.unpack_from("<IIII", d, o + 8)
        kind = {0: "solid", 1: "null", 2: "hatch"}.get(style, "solid")
        p.objects[ih] = _brush(kind, colorref(col), hatch)

    @reg(93, 94)
    def create_dib_brush(p, d, o, s):
        ih, usage, off_bmi, cb_bmi, off_bits, cb_bits = struct.unpack_from("<IIIIII", d, o + 8)
        img = dib_image(d[o + off_bmi:o + off_bmi + cb_bmi], d[o + off_bits:o + off_bits + cb_bits])
        if img:
            href = "data:%s;base64,%s" % (img[0], base64.b64encode(img[1]).decode("ascii"))
            p.objects[ih] = _brush("pattern", (128, 128, 128), image=(href, img[2], img[3]))
        else:
            p.objects[ih] = _brush("solid", (128, 128, 128))
        p.objects[ih]["dark"] = dark_fraction(d[o + off_bmi:o + off_bmi + cb_bmi], d[o + off_bits:o + off_bits + cb_bits])

    @reg(82)
    def create_font(p, d, o, s):
        ih = struct.unpack_from("<I", d, o + 8)[0]
        h, w, esc, orient, weight = struct.unpack_from("<iiiii", d, o + 12)
        italic, underline, strike, charset, _, _, _, family = struct.unpack_from("<8B", d, o + 32)
        face = d[o + 40:o + 104].decode("utf-16-le", "replace").split("\x00")[0]
        p.objects[ih] = _font(h, esc, weight, bool(italic), bool(underline), bool(strike), charset, family, face)

    # -- clipping --
    @reg(30)
    def intersect_clip(p, d, o, s):
        l, t, r, b = _i32(d, o + 8, 4)
        bl, bt, br, bb = p.bounds
        if p.dc.M != IDENTITY and max(abs(l - bl), abs(t - bt), abs(r - br - 1), abs(b - bb - 1)) <= 2:
            # Office writes the whole picture's clip in device pixels while a transform is set;
            # read literally it would cut the picture down to a corner
            p.add_clip(p.rect_d(l, t, r, b, logical=False))
            return
        p.add_clip(p.rect_d(l, t, r, b))

    @reg(29)
    def exclude_clip(p, d, o, s):
        l, t, r, b = _i32(d, o + 8, 4)
        big = "M-100000 -100000H100000V100000H-100000Z"
        p.add_clip(big + p.rect_d(l, t, r, b), "evenodd")

    @reg(75)
    def ext_select_clip(p, d, o, s):
        cb, mode = struct.unpack_from("<II", d, o + 8)
        if mode == 5 and cb == 0 or cb < 32:
            if mode == 5:
                p.dc.clip = ()
            return
        count = struct.unpack_from("<I", d, o + 16 + 8)[0]
        rects = [_i32(d, o + 48 + 16 * k, 4) for k in range(count) if o + 48 + 16 * k + 16 <= o + s]
        dd = "".join(p.rect_d(l, t, r, b, logical=False) for l, t, r, b in rects)
        if not dd:
            return
        if mode == 5:
            p.add_clip(dd, mode="copy")
        elif mode == 1:
            p.add_clip(dd)
        elif mode == 4:
            p.add_clip("M-100000 -100000H100000V100000H-100000Z" + dd, "evenodd")
        # RGN_OR and RGN_XOR widen the clip; leaving it as it is draws at least as much

    @reg(67)
    def select_clip_path(p, d, o, s):
        p.select_clip_path(_i32(d, o + 8)[0])

    # -- paths --
    @reg(59)
    def begin_path(p, d, o, s):
        p.begin_path()

    @reg(60)
    def end_path(p, d, o, s):
        p.end_path()

    @reg(61)
    def close_figure(p, d, o, s):
        p.close_figure()

    @reg(62)
    def fill_path(p, d, o, s):
        p.draw_path(True, False)

    @reg(63)
    def stroke_fill_path(p, d, o, s):
        p.draw_path(True, True)

    @reg(64)
    def stroke_path(p, d, o, s):
        p.draw_path(False, True)

    @reg(65)
    def flatten_path(p, d, o, s):
        pass

    @reg(66)
    def widen_path(p, d, o, s):
        p.path_widened = True

    @reg(68)
    def abort_path(p, d, o, s):
        p.path = None
        p.clip_path = None

    # -- drawing --
    @reg(27)
    def move_to(p, d, o, s):
        x, y = _i32(d, o + 8, 2)
        p.move_to(x, y)

    @reg(54)
    def line_to(p, d, o, s):
        p.to_line(list(_i32(d, o + 8, 2)))

    def poly(small, closed=None, kind="line"):
        def fn(p, d, o, s):
            count = struct.unpack_from("<I", d, o + 24)[0]
            flat = _points(d, o + 28, count, small)
            if kind == "line":
                p.polyline(flat, closed)
            elif kind == "bezier":
                p.polybezier(flat)
            elif kind == "lineto":
                p.to_line(flat)
            elif kind == "bezierto":
                p.to_bezier(flat)
        return fn

    H[3], H[86] = poly(False, True), poly(True, True)
    H[4], H[87] = poly(False, False), poly(True, False)
    H[2], H[85] = poly(False, kind="bezier"), poly(True, kind="bezier")
    H[6], H[89] = poly(False, kind="lineto"), poly(True, kind="lineto")
    H[5], H[88] = poly(False, kind="bezierto"), poly(True, kind="bezierto")

    def polypoly(small, closed):
        def fn(p, d, o, s):
            npolys, total = struct.unpack_from("<II", d, o + 24)
            counts = struct.unpack_from("<%dI" % npolys, d, o + 32)
            flat = _points(d, o + 32 + 4 * npolys, total, small)
            if closed:
                c = p.coords
                pts = p.pts(flat)
                parts, k = [], 0
                for cnt in counts:
                    seg = pts[k:k + cnt]
                    k += cnt
                    if len(seg) >= 2:
                        parts.append("M" + c(seg[:1]) + "L" + c(seg[1:]) + "Z")
                if parts:
                    p.figure("".join(parts), True)
            else:
                k = 0
                for cnt in counts:
                    p.polyline(flat[2 * k:2 * (k + cnt)], False)
                    k += cnt
        return fn

    H[8], H[91] = polypoly(False, True), polypoly(True, True)
    H[7], H[90] = polypoly(False, False), polypoly(True, False)

    def polydraw(small):
        def fn(p, d, o, s):
            count = struct.unpack_from("<I", d, o + 24)[0]
            flat = _points(d, o + 28, count, small)
            types = d[o + 28 + count * (4 if small else 8):][:count]
            k = 0
            while k < count:
                t = types[k]
                kind = t & 6
                if kind == 6:
                    p.move_to(flat[2 * k], flat[2 * k + 1])
                    k += 1
                elif kind == 2:
                    p.to_line(flat[2 * k:2 * k + 2])
                    k += 1
                elif kind == 4 and k + 2 < count:
                    p.to_bezier(flat[2 * k:2 * k + 6])
                    t = types[k + 2]
                    k += 3
                else:
                    k += 1
                    continue
                if t & 1 and p.path is not None:
                    p.close_figure()
        return fn

    H[56], H[92] = polydraw(False), polydraw(True)

    @reg(43)
    def rectangle(p, d, o, s):
        p.rectangle(*_i32(d, o + 8, 4))

    @reg(44)
    def round_rect(p, d, o, s):
        l, t, r, b, cw, ch = _i32(d, o + 8, 6)
        p.round_rect(l, t, r, b, cw, ch)

    @reg(42)
    def ellipse(p, d, o, s):
        p.ellipse(*_i32(d, o + 8, 4))

    def arcs(kind):
        def fn(p, d, o, s):
            p.arc(kind, *_i32(d, o + 8, 8))
        return fn

    H[45], H[46], H[47], H[55] = arcs("arc"), arcs("chord"), arcs("pie"), arcs("arcto")

    @reg(41)
    def angle_arc(p, d, o, s):
        x, y = _i32(d, o + 8, 2)
        r = struct.unpack_from("<I", d, o + 16)[0]
        a0, sweep = struct.unpack_from("<ff", d, o + 20)
        pts, _ = p.ellipse_pts(x - r, y - r, x + r, y + r, math.radians(a0), math.radians(sweep))
        p.to_line([pts[0][0], pts[0][1]])
        flat = [v for q in pts[1:] for v in q]
        p.to_bezier(flat)

    @reg(15)
    def set_pixel(p, d, o, s):
        x, y = _i32(d, o + 8, 2)
        col = colorref(struct.unpack_from("<I", d, o + 16)[0])
        p.put('<path d="%s" %s/>' % (p.rect_d(x, y, x + 1, y + 1), p.fill_attr(col)))

    @reg(71)
    def fill_rgn(p, d, o, s):
        cb, ih = struct.unpack_from("<II", d, o + 24)
        count = struct.unpack_from("<I", d, o + 32 + 8)[0]
        rects = [_i32(d, o + 64 + 16 * k, 4) for k in range(count)]
        dd = "".join(p.rect_d(l, t, r, b) for l, t, r, b in rects)
        saved = p.dc.brush
        p.select(ih)
        if dd:
            p.put('<path d="%s" %s/>' % (dd, p.fill_attr()))
        p.dc.brush = saved

    @reg(74)
    def paint_rgn(p, d, o, s):
        count = struct.unpack_from("<I", d, o + 28 + 8)[0]
        rects = [_i32(d, o + 60 + 16 * k, 4) for k in range(count)]
        dd = "".join(p.rect_d(l, t, r, b) for l, t, r, b in rects)
        if dd:
            p.put('<path d="%s" %s/>' % (dd, p.fill_attr()))

    @reg(118)
    def gradient_fill(p, d, o, s):
        nver, ntri, mode = struct.unpack_from("<III", d, o + 24)
        verts = [struct.unpack_from("<iiHHHH", d, o + 36 + 16 * k) for k in range(nver)]
        base = o + 36 + 16 * nver
        col = lambda v: "#%02x%02x%02x" % (v[2] >> 8, v[3] >> 8, v[4] >> 8)
        for k in range(ntri):
            if mode in (0, 1):
                i, j = struct.unpack_from("<II", d, base + 8 * k)
                if i >= nver or j >= nver:
                    continue
                a, b = verts[i], verts[j]
                gid = "g%d" % len(p.def_ids)
                p.def_ids[("grad", gid)] = gid
                x1, y1 = p.pt(a[0], a[1])
                x2, y2 = p.pt(b[0], a[1]) if mode == 0 else p.pt(a[0], b[1])
                p.defs.append('<linearGradient id="%s" gradientUnits="userSpaceOnUse" x1="%s" y1="%s" x2="%s" y2="%s">'
                              '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>'
                              % (gid, p.n(x1), p.n(y1), p.n(x2), p.n(y2), col(a), col(b)))
                p.put('<path d="%s" fill="url(#%s)"/>' % (p.rect_d(a[0], a[1], b[0], b[1]), gid))
            elif mode == 2:
                ids = struct.unpack_from("<III", d, base + 12 * k)
                if max(ids) >= nver:
                    continue
                vs = [verts[i] for i in ids]
                avg = tuple(sum(v[c] >> 8 for v in vs) // 3 for c in (2, 3, 4))
                pts = [p.pt(v[0], v[1]) for v in vs]
                p.put('<path d="M%sZ" %s/>' % (p.coords(pts), p.fill_attr(avg)))

    # -- text --
    def ext_text(wide):
        def fn(p, d, o, s):
            x, y, nchars, off_str, opts = struct.unpack_from("<iiIII", d, o + 36)
            rect = None
            dx_at = o + 56
            if not opts & 0x100:                  # ETO_NO_RECT: no rectangle field
                rect = _i32(d, o + 56, 4)
                dx_at = o + 72
            off_dx = struct.unpack_from("<I", d, dx_at)[0]
            if opts & 0x10:                        # glyph indices, not characters
                p.note("glyph-index text")
                return
            if wide:
                raw = d[o + off_str:o + off_str + 2 * nchars]
                text = raw.decode("utf-16-le", "replace")
            else:
                text = d[o + off_str:o + off_str + nchars].decode("cp1252", "replace")
            if p.dc.font["charset"] == 2 and not wide:
                text = "".join(chr(0xF000 + ord(c)) if ord(c) < 256 else c for c in text)
            dx = None
            if off_dx and o + off_dx + 4 * nchars <= o + s:
                step = 2 if opts & 0x2000 else 1
                vals = struct.unpack_from("<%di" % (nchars * step), d, o + off_dx)
                dx = list(vals[0::step])
                if wide and len(text) < nchars:        # surrogate pairs: one advance per character
                    merged, k = [], 0
                    for ch in text:
                        n2 = 2 if ord(ch) > 0xFFFF else 1
                        merged.append(sum(dx[k:k + n2]))
                        k += n2
                    dx = merged
            opaque = rect if (opts & 0x2) and rect else None
            p.text(x, y, text, dx, opaque)
        return fn

    H[84], H[83] = ext_text(True), ext_text(False)

    @reg(108)
    def small_text(p, d, o, s):
        x, y, nchars, opts, mode = struct.unpack_from("<iiIII", d, o + 8)
        at = o + 36 + (0 if opts & 0x100 else 16)
        if opts & 0x10:
            p.note("glyph-index text")
            return
        if opts & 0x200:
            text = d[at:at + nchars].decode("cp1252", "replace")
        else:
            text = d[at:at + 2 * nchars].decode("utf-16-le", "replace")
        p.text(x, y, text)

    # -- bitmaps --
    def part(d, o, off, size):
        return d[o + off:o + off + size] if size else b""

    @reg(81)
    def stretch_dibits(p, d, o, s):
        xd, yd, xs, ys, cxs, cys, ob, cbb, obits, cbbits, usage, rop, cxd, cyd = struct.unpack_from("<iiiiiiIIIIIIii", d, o + 24)
        p.blit(part(d, o, ob, cbb), part(d, o, obits, cbbits), xd, yd, cxd, cyd, xs, ys, cxs, cys, rop, from_bottom=True)

    @reg(80)
    def set_dibits(p, d, o, s):
        xd, yd, xs, ys, cxs, cys, ob, cbb, obits, cbbits, usage, start, scans = struct.unpack_from("<iiiiiiIIIIIII", d, o + 24)
        p.blit(part(d, o, ob, cbb), part(d, o, obits, cbbits), xd, yd, cxs, cys, xs, ys, cxs, cys, from_bottom=True)

    @reg(76, 77)
    def bitblt(p, d, o, s):
        rtype = struct.unpack_from("<I", d, o)[0]
        xd, yd, cxd, cyd, rop, xs, ys = struct.unpack_from("<iiiiIii", d, o + 24)
        bk, usage, ob, cbb, obits, cbbits = struct.unpack_from("<IIIIII", d, o + 76)
        cxs, cys = (struct.unpack_from("<ii", d, o + 100) if rtype == 77 else (cxd, cyd))
        if not cbb:
            p.pat_fill(xd, yd, cxd, cyd, rop)
            return
        p.blit(part(d, o, ob, cbb), part(d, o, obits, cbbits), xd, yd, cxd, cyd, xs, ys, cxs, cys, rop)

    @reg(114, 116)
    def alpha_blend(p, d, o, s):
        rtype = struct.unpack_from("<I", d, o)[0]
        xd, yd, cxd, cyd, blend, xs, ys = struct.unpack_from("<iiiiIii", d, o + 24)
        bk, usage, ob, cbb, obits, cbbits, cxs, cys = struct.unpack_from("<IIIIIIii", d, o + 76)
        bmi, px = part(d, o, ob, cbb), part(d, o, obits, cbbits)
        if rtype == 114:
            p.blit(bmi, px, xd, yd, cxd, cyd, xs, ys, cxs, cys, opacity=((blend >> 16) & 0xFF) / 255,
                   alpha=bool((blend >> 24) & 1))
        else:
            p.blit(bmi, px, xd, yd, cxd, cyd, xs, ys, cxs, cys, transparent=colorref(blend))

    @reg(78, 79)
    def mask_blt(p, d, o, s):
        p.note("MaskBlt/PlgBlt")

    return H


# -- WMF ------------------------------------------------------------------------------------------

def wmf_to_svg(data):
    d = bytes(data)
    off = 0
    bbox = None
    inch = 1440
    if len(d) >= 22 and struct.unpack_from("<I", d, 0)[0] == 0x9AC6CDD7:
        l, t, r, b, inch = struct.unpack_from("<hhhhH", d, 6)
        bbox = (l, t, r, b)
        off = 22
    if len(d) < off + 18:
        return None
    ftype, hsize = struct.unpack_from("<HH", d, off)
    if ftype not in (1, 2) or hsize != 9:
        return None
    off += 18
    p = Player()
    objects = {}                       # slot -> object (None for a placeholder slot)

    def alloc(o):
        k = 0
        while k in objects:
            k += 1
        objects[k] = o

    # the playback maps the window onto a device rectangle the size of the picture
    first = {"org": None, "ext": None}
    state = {"win_org": (0.0, 0.0), "win_ext": None}
    dev = {}

    def set_mapping():
        dc = p.dc
        dc.map_mode = MM_ANISOTROPIC
        ext = state["win_ext"] or dev["ext"]
        dc.win_org = state["win_org"]
        dc.win_ext = ext
        dc.vp_org = (0.0, 0.0)
        dc.vp_ext = dev["ext_abs"]
        p.update()

    if bbox:
        l, t, r, b = bbox
        dev["ext"] = (float(r - l), float(b - t))
        state["win_org"] = (float(l), float(t))
    else:
        dev["ext"] = None
    records = []
    # a first pass finds the window, when there is no placeable header to size the picture
    k = off
    while k + 6 <= len(d):
        size, fn = struct.unpack_from("<IH", d, k)
        if size < 3 or k + size * 2 > len(d):
            break
        records.append((k, size * 2, fn))
        if fn == 0:
            break
        if fn == 0x020C and first["ext"] is None:
            y, x = struct.unpack_from("<hh", d, k + 6)
            first["ext"] = (float(x), float(y))
        if fn == 0x020B and first["org"] is None:
            y, x = struct.unpack_from("<hh", d, k + 6)
            first["org"] = (float(x), float(y))
        k += size * 2
    if dev["ext"] is None:
        if first["ext"] is None:
            return None
        dev["ext"] = first["ext"]
        state["win_org"] = first["org"] or (0.0, 0.0)
    dev["ext_abs"] = (abs(dev["ext"][0]) or 1.0, abs(dev["ext"][1]) or 1.0)
    vw, vh = dev["ext_abs"]
    p.prec = 2 if max(vw, vh) < 2000 else 1
    set_mapping()

    def h16(o, n):
        return struct.unpack_from("<%dh" % n, d, o)

    for o, size, fn in records:
        a = o + 6                           # the parameters
        try:
            if fn == 0x020B:
                y, x = h16(a, 2)
                state["win_org"] = (float(x), float(y))
                set_mapping()
            elif fn == 0x020C:
                y, x = h16(a, 2)
                state["win_ext"] = (float(x), float(y))
                set_mapping()
            elif fn in (0x020D, 0x020E, 0x0103, 0x0211, 0x0412):
                pass                            # the viewport and mapping mode are the player's
            elif fn == 0x0104:
                p.dc.rop2 = h16(a, 1)[0]
            elif fn == 0x0102:
                p.dc.bk_mode = h16(a, 1)[0]
            elif fn == 0x0201:
                p.dc.bk_colour = colorref(struct.unpack_from("<I", d, a)[0])
            elif fn == 0x0209:
                p.dc.text_colour = colorref(struct.unpack_from("<I", d, a)[0])
            elif fn == 0x0106:
                p.dc.fill_rule = "nonzero" if h16(a, 1)[0] == 2 else "evenodd"
            elif fn == 0x012E:
                p.dc.text_align = struct.unpack_from("<H", d, a)[0]
            elif fn == 0x001E:
                p.save()
            elif fn == 0x0127:
                p.restore(h16(a, 1)[0])
            elif fn == 0x0214:
                y, x = h16(a, 2)
                p.move_to(x, y)
            elif fn == 0x0213:
                y, x = h16(a, 2)
                p.to_line([x, y])
            elif fn in (0x0324, 0x0325):
                n = h16(a, 1)[0]
                p.polyline(list(h16(a + 2, 2 * n)), fn == 0x0324)
            elif fn == 0x0538:
                npoly = h16(a, 1)[0]
                counts = h16(a + 2, npoly)
                flat = h16(a + 2 + 2 * npoly, 2 * sum(counts))
                pts = p.pts(list(flat))
                parts, k = [], 0
                for cnt in counts:
                    seg = pts[k:k + cnt]
                    k += cnt
                    if len(seg) >= 2:
                        parts.append("M" + p.coords(seg[:1]) + "L" + p.coords(seg[1:]) + "Z")
                if parts:
                    p.figure("".join(parts), True)
            elif fn == 0x041B:
                b, r, t, l = h16(a, 4)
                p.rectangle(l, t, r, b)
            elif fn == 0x0418:
                b, r, t, l = h16(a, 4)
                p.ellipse(l, t, r, b)
            elif fn == 0x061C:
                ch, cw, b, r, t, l = h16(a, 6)
                p.round_rect(l, t, r, b, cw, ch)
            elif fn in (0x0817, 0x081A, 0x0830):
                ye, xe, ys, xs, b, r, t, l = h16(a, 8)
                p.arc({0x0817: "arc", 0x081A: "pie", 0x0830: "chord"}[fn], l, t, r, b, xs, ys, xe, ye)
            elif fn == 0x02FA:
                style, wx, wy = struct.unpack_from("<Hhh", d, a)
                col = colorref(struct.unpack_from("<I", d, a + 6)[0])
                alloc(_pen(style, float(wx), col, cosmetic=wx <= 0))
            elif fn == 0x02FC:
                style, col, hatch = struct.unpack_from("<HIH", d, a)
                alloc(_brush({0: "solid", 1: "null", 2: "hatch"}.get(style, "solid"), colorref(col), hatch))
            elif fn == 0x0142:
                img = dib_image(*split_packed(d[a + 4:o + size]))
                if img:
                    href = "data:%s;base64,%s" % (img[0], base64.b64encode(img[1]).decode("ascii"))
                    alloc(_brush("pattern", (128, 128, 128), image=(href, img[2], img[3])))
                else:
                    alloc(_brush("solid", (128, 128, 128)))
            elif fn == 0x01F9:
                alloc(_brush("solid", (128, 128, 128)))
            elif fn == 0x02FB:
                h, w, esc, orient, weight = h16(a, 5)
                italic, underline, strike, charset, _, _, _, family = struct.unpack_from("<8B", d, a + 10)
                face = d[a + 18:o + size].split(b"\x00")[0].decode("cp1252", "replace")
                alloc(_font(h, esc, weight, bool(italic), bool(underline), bool(strike), charset, family, face))
            elif fn in (0x00F7, 0x06FF):
                alloc({"kind": "other"})
            elif fn == 0x012D:
                o2 = objects.get(struct.unpack_from("<H", d, a)[0])
                if o2 is not None:
                    k2 = o2["kind"]
                    if k2 == "pen":
                        p.dc.pen = o2
                    elif k2 == "brush":
                        p.dc.brush = o2
                    elif k2 == "font":
                        p.dc.font = o2
            elif fn == 0x01F0:
                objects.pop(struct.unpack_from("<H", d, a)[0], None)
            elif fn == 0x0416:
                b, r, t, l = h16(a, 4)
                p.add_clip(p.rect_d(l, t, r, b))
            elif fn == 0x0415:
                b, r, t, l = h16(a, 4)
                p.add_clip("M-100000 -100000H100000V100000H-100000Z" + p.rect_d(l, t, r, b), "evenodd")
            elif fn == 0x0521:
                n = h16(a, 1)[0]
                s = d[a + 2:a + 2 + n]
                y, x = h16(a + 2 + n + (n & 1), 2)
                p.text(x, y, _wmf_str(s, p.dc.font))
            elif fn == 0x0A32:
                y, x, n, opts = struct.unpack_from("<hhhH", d, a)
                k = a + 8
                rect = None
                if opts & 0x6:
                    t_, l_, b_, r_ = None, None, None, None
                    l_, t_, r_, b_ = h16(k, 4)
                    rect = (l_, t_, r_, b_)
                    k += 8
                s = d[k:k + n]
                k += n + (n & 1)
                dx = list(h16(k, n)) if k + 2 * n <= o + size else None
                p.text(x, y, _wmf_str(s, p.dc.font), dx, rect if opts & 0x2 else None)
            elif fn == 0x061D:
                rop = struct.unpack_from("<I", d, a)[0]
                hgt, wid, y, x = h16(a + 4, 4)
                p.pat_fill(x, y, wid, hgt, rop)
            elif fn == 0x0F43:
                rop = struct.unpack_from("<I", d, a)[0]
                usage, sh, sw, sy, sx, dh, dw, dy, dx_ = h16(a + 4, 9)
                p.blit(*split_packed(d[a + 22:o + size]), dx_, dy, dw, dh, sx, sy, sw, sh, rop, from_bottom=True)
            elif fn == 0x0B41:
                rop = struct.unpack_from("<I", d, a)[0]
                if size == 2 * (3 + 2 + 9):                 # no bitmap: a pattern fill
                    sh, sw, sy, sx, _, dh, dw, dy, dx_ = h16(a + 4, 9)
                    p.pat_fill(dx_, dy, dw, dh, rop)
                else:
                    sh, sw, sy, sx, dh, dw, dy, dx_ = h16(a + 4, 8)
                    p.blit(*split_packed(d[a + 20:o + size]), dx_, dy, dw, dh, sx, sy, sw, sh, rop)
            elif fn == 0x0940:
                rop = struct.unpack_from("<I", d, a)[0]
                if size == 2 * (3 + 2 + 7):
                    sy, sx, _, hh, ww, dy, dx_ = h16(a + 4, 7)
                    p.pat_fill(dx_, dy, ww, hh, rop)
                else:
                    sy, sx, hh, ww, dy, dx_ = h16(a + 4, 6)
                    p.blit(*split_packed(d[a + 16:o + size]), dx_, dy, ww, hh, sx, sy, ww, hh, rop)
            elif fn == 0x0D33:
                usage, scans, start, sy, sx, hh, ww, dy, dx_ = h16(a, 9)
                p.blit(*split_packed(d[a + 18:o + size]), dx_, dy, ww, hh, sx, sy, ww, hh, from_bottom=True)
            elif fn in (0x0000, 0x0626, 0x0234, 0x0035, 0x0037, 0x0231, 0x0107, 0x0105, 0x0108):
                pass
            else:
                p.note("wmf 0x%04x" % fn)
        except (struct.error, IndexError, ValueError, ZeroDivisionError, OverflowError):
            p.note("bad wmf 0x%04x" % fn)
    if not (p.drawn or p.images):
        return None
    lone = p.lone_image(0, 0, vw, vh)
    if lone:
        return lone
    px = 96 / inch if bbox else 1.0
    return ("image/svg+xml", p.svg(0, 0, vw, vh, vw * px, vh * px).encode("utf-8"))


def split_packed(packed):
    """A packed DIB (BITMAPINFO then the pixels, as in WMF records) as (bmi, bits)."""
    if len(packed) < 12:
        return b"", b""
    hsize = struct.unpack_from("<I", packed, 0)[0]
    if hsize == 12:
        bpp = struct.unpack_from("<H", packed, 10)[0]
        ncol = (1 << bpp) if bpp <= 8 else 0
        head = 12 + 3 * ncol
    else:
        bpp, comp = struct.unpack_from("<HI", packed, 14)
        used = struct.unpack_from("<I", packed, 32)[0] if len(packed) >= 36 else 0
        ncol = used or ((1 << bpp) if bpp <= 8 else 0)
        head = hsize + 4 * ncol + (12 if comp == 3 and hsize == 40 else 0)
    return packed[:head], packed[head:]


def _wmf_str(raw, font):
    if font.get("charset") == 2:
        return "".join(chr(0xF000 + b) for b in raw)
    return raw.decode("cp1252", "replace")


# -- entry point ----------------------------------------------------------------------------------

def convert(data):
    """A metafile's bytes as (extension, bytes) a browser can show, or None."""
    try:
        out = emf_to_svg(data) if data[:4] == b"\x01\x00\x00\x00" else wmf_to_svg(data)
    except (struct.error, IndexError, ValueError, ZeroDivisionError, OverflowError, MemoryError):
        return None
    if not out:
        return None
    mime, blob = out
    return {"image/svg+xml": "svg", "image/png": "png", "image/jpeg": "jpg"}.get(mime, "png"), blob


if __name__ == "__main__":                 # emf_svg.py in.emf [out.svg]: convert one file
    import sys
    src = open(sys.argv[1], "rb").read()
    res = convert(src)
    if not res:
        sys.exit("could not convert")
    dest = sys.argv[2] if len(sys.argv) > 2 else sys.argv[1].rsplit(".", 1)[0] + "." + res[0]
    with open(dest, "wb") as fh:
        fh.write(res[1])
    print(dest, len(res[1]))
