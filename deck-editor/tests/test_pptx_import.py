"""Unit tests for pptx_import: how placeholders inherit their text styles, on the Facet
fixture (a deck PowerPoint made from its Facet theme, one slide per built-in layout), and
the size limits that keep a hostile file from exhausting memory.

    py -3 -m unittest tests.test_pptx_import     (from deck-editor/)
"""
import gzip
import os
import re
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import import_deck  # noqa: E402
import pptx_import  # noqa: E402

FACET = os.path.join(HERE, "fixtures", "import", "facet.pptx")


def slides_of(html):
    """The markup of each slide, in order."""
    return re.split(r'<section class="slide', html)[1:]


def list_items(slide):
    """(style, text) of every list item on a slide."""
    return [(style, re.sub(r"<[^>]+>", "", body)) for style, body in re.findall(r'<li style="([^"]*)"[^>]*>(.*?)</li>', slide, re.S)]


class PlaceholderInheritance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as out:
            html, _ = import_deck.import_file(FACET, out)
        cls.slides = slides_of(html)

    def test_comparison_columns_take_the_master_body_style(self):
        # Slide 5 uses the Comparison layout: two content placeholders (idx 2 and 4, no type).
        # They inherit the master's body text (18pt = 36px on the 1920px stage, left aligned,
        # anchored at the top), not the master's date (idx 2) and slide number (idx 4)
        # placeholders, which are 12pt, right aligned and centred.
        items = list_items(self.slides[4])
        texts = [t for _, t in items]
        self.assertIn("Long sales cycle", texts)
        self.assertIn("Sign up in minutes", texts)
        for style, text in items:
            with self.subTest(item=text):
                self.assertIn("font-size:36px", style)
                self.assertNotIn("text-align:right", style)
        # The boxes holding the two lists start at the top, as PowerPoint draws them.
        boxes = re.findall(r'justify-content:([a-z-]+);[^>]*>\s*<ul', self.slides[4])
        self.assertEqual(boxes, ["flex-start", "flex-start"])

    def test_bullets_keep_their_glyph_and_colour(self):
        # Facet's body bullets: a Wingdings 3 triangle in the accent colour (buClr accent1), while
        # each run keeps its own text colour, so only the marker takes the accent.
        for style, text in list_items(self.slides[4]):
            with self.subTest(item=text):
                self.assertIn("list-style-type:'▶  '", style)
                self.assertIn("color:#90c226", style)
        self.assertIn("color:#", re.search(r'<li style="[^"]*"[^>]*><span style="([^"]*)"', self.slides[4]).group(1))

    def test_two_content_columns_match(self):
        # Slide 4 (Two Content): the second column is idx 2 with no type, like above.
        sizes = {re.search(r"font-size:([\d.]+)px", s).group(1) for s, _ in list_items(self.slides[3])}
        self.assertEqual(sizes, {"36"})


class SizeLimits(unittest.TestCase):
    """A .pptx from someone else can declare parts of many gigabytes that pack into a few
    kilobytes: the import refuses what unpacks past its limits (lowered here to test them)."""

    def test_a_picture_too_large_is_left_out_with_a_note(self):
        with tempfile.TemporaryDirectory() as out, mock.patch.object(pptx_import, "MAX_MEDIA_PART", 10):
            html, notes = import_deck.import_file(FACET, out)
            self.assertFalse(os.listdir(os.path.join(out, "assets")) if os.path.isdir(os.path.join(out, "assets")) else [])
        self.assertTrue(any("too large to import safely" in n for n in notes), notes)
        self.assertIn('<section class="slide', html)                # the deck itself still comes in

    def test_xml_too_large_stops_the_import(self):
        with tempfile.TemporaryDirectory() as out, mock.patch.object(pptx_import, "MAX_XML_PART", 100):
            with self.assertRaisesRegex(ValueError, "too large to read safely"):
                import_deck.import_file(FACET, out)

    def test_a_compressed_metafile_is_unpacked_only_up_to_the_limit(self):
        notes = []
        with tempfile.TemporaryDirectory() as out:
            deck = pptx_import.Pptx(FACET, out, notes)
            bomb = gzip.compress(b"\0" * 5_000_000)               # 5 MB from about 5 KB
            with mock.patch.object(pptx_import, "MAX_METAFILE", 1_000_000):
                self.assertEqual(deck.metafile(bomb, ".emz"), (None, None))
        self.assertTrue(any("too large" in n for n in notes), notes)


if __name__ == "__main__":
    unittest.main()
