"""Unit tests for emf_svg (Windows metafiles as SVG) and for how the PowerPoint import uses
it, on small metafiles written here record by record.

    py -3 -m unittest tests.test_emf_svg     (from deck-editor/)
"""
import os
import re
import shutil
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import emf_svg  # noqa: E402
import import_deck  # noqa: E402

FACET = os.path.join(HERE, "fixtures", "import", "facet.pptx")
SRCCOPY, SRCAND, SRCPAINT = 0x00CC0020, 0x008800C6, 0x00EE0086


# -- writing metafiles --------------------------------------------------------------------------

def record(rtype, body=b""):
    return struct.pack("<II", rtype, 8 + len(body)) + body


def emf(*records, size=100):
    """An EMF of `size` x `size` device pixels on a 1 px/mm reference device."""
    body = b"".join(records) + record(14, struct.pack("<III", 0, 16, 20))
    head_len = 108
    head = struct.pack("<II4i4iIIIIHHIIIiiiiIIIii", 1, head_len, 0, 0, size - 1, size - 1, 0, 0, size * 100, size * 100,
                       0x464D4520, 0x10000, head_len + len(body), len(records) + 2, 4, 0, 0, 0, 0,
                       size, size, size, size, 0, 0, 0, size * 1000, size * 1000)
    return head + body


def brush(ih, rgb):
    r, g, b = rgb
    return record(39, struct.pack("<IIII", ih, 0, r | g << 8 | b << 16, 0))


def select(ih):
    return record(37, struct.pack("<I", ih))


def polygon16(points):
    flat = [v for p in points for v in p]
    return record(86, struct.pack("<4iI%dh" % len(flat), 0, 0, 0, 0, len(points), *flat))


def text(x, y, s, dx):
    n = len(s)
    raw = s.encode("utf-16-le")
    raw += b"\0" * (-len(raw) % 4)
    off_str = 8 + 16 + 12 + 40
    off_dx = off_str + len(raw)
    body = struct.pack("<4iIff", 0, 0, 0, 0, 1, 1.0, 1.0)
    body += struct.pack("<iiIII4iI", x, y, n, off_str, 0, 0, 0, 0, 0, off_dx)
    return record(84, body + raw + struct.pack("<%di" % n, *dx))


def font(ih, height, face="Arial"):
    name = face.encode("utf-16-le").ljust(64, b"\0")
    return record(82, struct.pack("<I5i8B", ih, height, 0, 0, 0, 400, 0, 0, 0, 0, 0, 0, 0, 0) + name)


def dib24(pixels, w, h):
    """BITMAPINFO and bottom-up pixel rows of a 24-bit bitmap from top-down (r, g, b) rows."""
    bmi = struct.pack("<IiiHHIIiiII", 40, w, h, 1, 24, 0, 0, 0, 0, 0, 0)
    stride = (w * 3 + 3) // 4 * 4
    rows = []
    for row in reversed(pixels):
        data = b"".join(bytes((b, g, r)) for r, g, b in row)
        rows.append(data + b"\0" * (stride - len(data)))
    return bmi, b"".join(rows)


def stretch_dibits(bmi, bits, x, y, cx, cy, w, h, rop=SRCCOPY):
    off_bmi = 80
    off_bits = off_bmi + len(bmi)
    body = struct.pack("<4i6iIIIIIIii", 0, 0, 0, 0, x, y, 0, 0, w, h, off_bmi, len(bmi), off_bits, len(bits), 0, rop, cx, cy)
    return record(81, body + bmi + bits)


def png_pixels(data):
    """(colour type, rows of raw bytes) of a PNG written without filters."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    w, h, depth, ctype = struct.unpack(">IIBB", data[16:26])
    idat, o = b"", 8
    while o < len(data):
        n, kind = struct.unpack(">I4s", data[o:o + 8])
        if kind == b"IDAT":
            idat += data[o + 8:o + 8 + n]
        o += 12 + n
    raw = zlib.decompress(idat)
    step = w * {2: 3, 6: 4}[ctype]
    return ctype, [raw[y * (step + 1) + 1:(y + 1) * (step + 1)] for y in range(h)]


# -- the converter ---------------------------------------------------------------------------

class Converter(unittest.TestCase):
    def test_shapes_and_text_become_svg(self):
        ext, data = emf_svg.convert(emf(
            brush(1, (255, 0, 0)), select(1),
            polygon16([(10, 10), (90, 10), (50, 80)]),
            font(2, -20), select(2), text(10, 90, "Hi", [12, 10])))
        self.assertEqual(ext, "svg")
        svg = data.decode("utf-8")
        self.assertIn('viewBox="0 0 100 100"', svg)
        self.assertRegex(svg, r'<path d="M10 10L90 10 50 80Z" fill="#ff0000"')
        # the text keeps its font, size and the width its advances give it
        self.assertRegex(svg, r"<text [^>]*textLength=\"22\"[^>]*font-family=\"'Arial',sans-serif\" font-size=\"20\"[^>]*>Hi</text>")

    def test_a_lone_picture_is_returned_as_it_is(self):
        bmi, bits = dib24([[(255, 0, 0), (0, 255, 0)], [(0, 0, 255), (255, 255, 255)]], 2, 2)
        ext, data = emf_svg.convert(emf(stretch_dibits(bmi, bits, 0, 0, 100, 100, 2, 2)))
        self.assertEqual(ext, "png")
        ctype, rows = png_pixels(data)
        self.assertEqual(ctype, 2)
        self.assertEqual(rows, [bytes((255, 0, 0, 0, 255, 0)), bytes((0, 0, 255, 255, 255, 255))])

    def test_a_mask_and_its_picture_become_one_transparent_picture(self):
        # GDI's two-pass transparency: a mask ORed (white where the picture shows), then the
        # picture ANDed (white where it does not)
        mask = dib24([[(255, 255, 255), (0, 0, 0)]], 2, 1)
        pic = dib24([[(200, 10, 10), (255, 255, 255)]], 2, 1)
        ext, data = emf_svg.convert(emf(stretch_dibits(*mask, 0, 0, 100, 100, 2, 1, SRCPAINT),
                                        stretch_dibits(*pic, 0, 0, 100, 100, 2, 1, SRCAND)))
        self.assertEqual(ext, "png")
        ctype, rows = png_pixels(data)
        self.assertEqual(ctype, 6)
        self.assertEqual(rows[0][:4], bytes((200, 10, 10, 255)))
        self.assertEqual(rows[0][7], 0)

    def test_a_wmf_with_a_placeable_header(self):
        recs = [
            struct.pack("<IHHIH", 7, 0x02FC, 0, 0x0000FF, 0),        # red brush (a COLORREF is 0x00bbggrr)
            struct.pack("<IHH", 4, 0x012D, 0),                       # select it
            struct.pack("<IH4h", 7, 0x041B, 40, 90, 10, 10),         # rectangle (bottom, right, top, left)
            struct.pack("<IH", 3, 0),
        ]
        body = b"".join(recs)
        head = struct.pack("<HHHIHIH", 1, 9, 0x300, 9 + len(body) // 2, 1, 7, 0)
        placeable = struct.pack("<IH4hHIH", 0x9AC6CDD7, 0, 0, 0, 100, 50, 1440, 0, 0)
        ext, data = emf_svg.convert(placeable + head + body)
        self.assertEqual(ext, "svg")
        svg = data.decode("utf-8")
        self.assertIn('viewBox="0 0 100 50"', svg)
        self.assertRegex(svg, r'<path d="M10 10 90 10 90 40 10 40Z" fill="#ff0000"')

    def test_what_is_not_a_metafile(self):
        self.assertIsNone(emf_svg.convert(b"not a metafile at all"))
        self.assertIsNone(emf_svg.convert(emf()))                  # nothing drawn

    def test_a_bitmap_declared_huge_is_not_decoded(self):
        # 20000 x 20000 in a 40-byte header and two bytes of RLE: decoding it would take
        # 400 million pixels. Over MAX_PIXELS a bitmap is left out, at once.
        bmi = struct.pack("<IiiHHIIiiII", 40, 20000, 20000, 1, 8, 1, 2, 0, 0, 0, 0)
        self.assertIsNone(emf_svg.dib_image(bmi, b"\x00\x01"))
        self.assertIsNone(emf_svg.dib_image(bmi, b"\x00\x01", raw=True))
        small = struct.pack("<IiiHHIIiiII", 40, 2, 2, 1, 8, 1, 2, 0, 0, 0, 0)
        self.assertIsNotNone(emf_svg.dib_image(small + b"\x00\x00\x00\x00" * 256, b"\x02\x00\x00\x00\x02\x00\x00\x01"))


# -- the PowerPoint import ----------------------------------------------------------------------

EMF_PART = emf(brush(1, (0, 128, 0)), select(1), polygon16([(0, 0), (99, 0), (99, 99)]))
PIC = ('<p:pic><p:nvPicPr><p:cNvPr id="90" name="Metafile"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
       '<p:blipFill><a:blip r:embed="rIdE"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
       '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>'
       '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')
OLE = ('<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="91" name="Object"/><p:cNvGraphicFramePr/><p:nvPr/>'
       '</p:nvGraphicFramePr><p:xfrm><a:off x="2000000" y="0"/><a:ext cx="1000000" cy="500000"/></p:xfrm>'
       '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">'
       '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
       '<mc:Choice xmlns:v="urn:schemas-microsoft-com:vml" Requires="v"><p:oleObj r:id="rIdO" imgW="1" imgH="1" progId="X"><p:embed/></p:oleObj></mc:Choice>'
       '<mc:Fallback><p:oleObj r:id="rIdO" imgW="1" imgH="1" progId="X"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id="0" name=""/>'
       '<p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdE"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
       '<p:spPr/></p:pic></p:oleObj></mc:Fallback></mc:AlternateContent></a:graphicData></a:graphic></p:graphicFrame>')
INK = ('<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
       '<mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14">'
       '<p:contentPart p14:bwMode="auto" r:id="rIdX"/></mc:Choice><mc:Fallback>'
       + PIC.replace('id="90" name="Metafile"', 'id="92" name="Ink"').replace('x="0" y="0"', 'x="4000000" y="0"')
       + '</mc:Fallback></mc:AlternateContent>')


class ImportMetafiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        src = os.path.join(cls.tmp, "metafiles.pptx")
        with zipfile.ZipFile(FACET) as zin, zipfile.ZipFile(src, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "ppt/slides/slide1.xml":
                    data = data.replace(b"</p:spTree>", (PIC + OLE + INK).encode() + b"</p:spTree>")
                elif item.filename == "ppt/slides/_rels/slide1.xml.rels":
                    data = data.replace(b"</Relationships>", b'<Relationship Id="rIdE" Type="http://schemas.openxmlformats.org/'
                                        b'officeDocument/2006/relationships/image" Target="../media/drawing.emf"/></Relationships>')
                zout.writestr(item, data)
            zout.writestr("ppt/media/drawing.emf", EMF_PART)
        out = os.path.join(cls.tmp, "deck")
        cls.html, cls.notes = import_deck.import_file(src, out)
        cls.assets = os.listdir(os.path.join(out, "assets"))
        cls.slide = re.split(r'<section class="slide', cls.html)[1]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_the_metafile_is_an_svg_asset(self):
        self.assertIn("drawing.svg", self.assets)
        self.assertFalse([a for a in self.assets if a.endswith(".emf")])

    def test_picture_object_and_ink_all_show_it(self):
        # the picture itself, the embedded object's preview (placed by its frame) and the
        # ink's fallback picture
        self.assertEqual(len(re.findall(r'<img src="assets/drawing\.svg"', self.slide)), 3)
        self.assertFalse([n for n in self.notes if "embedded object" in n or "metafile" in n])


if __name__ == "__main__":
    unittest.main()
