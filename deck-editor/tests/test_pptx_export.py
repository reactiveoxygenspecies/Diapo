"""pptx_export.py: a deck description becomes a .pptx that is well formed, and that our
own importer reads back with the same text, positions, pictures, tables and notes.
(PowerPoint itself opens it too: tools/pptx-export-check.ps1.)"""
import base64
import os
import shutil
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pptx_export  # noqa: E402
import pptx_import  # noqa: E402


def png(w=4, h=3, rgb=(47, 111, 237)):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


PNG_URL = "data:image/png;base64," + base64.b64encode(png()).decode()
RUN = {"font": "Arial", "size": 48, "color": "#1c1c1f"}


def sample_spec():
    return {
        "w": 1920, "h": 1080, "title": "Export test",
        "theme": {"colours": ["#1c1c1f", "#ffffff", "#45464d", "#f4f4f5", "#2f6fed", "#e8503f"], "fonts": ["Arial", "Arial"]},
        "slides": [
            {"notes": "Say hello.\nThen the second line.", "bg": {"color": "#fafaf7"}, "items": [
                {"kind": "shape", "x": 96, "y": 72, "w": 1200, "h": 140, "name": "Title",
                 "paras": [{"align": "l", "runs": [{**RUN, "t": "Hello ", "size": 96, "b": True}, {**RUN, "t": "world", "size": 96, "i": True, "color": "#e8503f"}]}]},
                {"kind": "shape", "x": 96, "y": 300, "w": 900, "h": 300, "name": "Points", "paras": [
                    {"bullet": {"char": "•"}, "marL": 40, "indent": -40, "runs": [{**RUN, "t": "First point"}]},
                    {"bullet": {"char": "•"}, "marL": 80, "indent": -40, "level": 1, "runs": [{**RUN, "t": "A sub point, H"}, {**RUN, "t": "2", "base": -25000}, {**RUN, "t": "O"}]},
                    {"bullet": {"auto": "arabicPeriod"}, "marL": 40, "indent": -40, "runs": [{**RUN, "t": "Numbered", "href": "https://example.com/"}]},
                ]},
                {"kind": "shape", "x": 1300, "y": 300, "w": 400, "h": 240, "geom": "roundRect", "radius": 24,
                 "fill": {"color": "#2f6fed", "alpha": 0.9}, "line": {"color": "#1c1c1f", "width": 4, "dash": "dash"}, "anchor": "ctr", "inset": [20, 20, 20, 20],
                 "paras": [{"align": "ctr", "runs": [{**RUN, "t": "In a box", "color": "#ffffff"}]}]},
                {"kind": "shape", "x": 1500, "y": 700, "w": 200, "h": 200, "geom": "ellipse", "fill": {"color": "#e8503f"}, "rot": 30},
                {"kind": "pic", "x": 96, "y": 700, "w": 400, "h": 300, "src": {"data": PNG_URL}, "crop": [0.1, 0, 0.1, 0], "alt": "A blue picture"},
                {"kind": "pic", "x": 560, "y": 700, "w": 300, "h": 300, "src": {"path": "assets/pic.png"}, "radius": 30},
                {"kind": "svg", "x": 900, "y": 700, "w": 300, "h": 300, "name": "Equation",
                 "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#123456"/></svg>', "png": PNG_URL},
            ]},
            {"hidden": True, "items": [
                {"kind": "table", "x": 96, "y": 96, "w": 1200, "h": 300, "cols": [400, 400, 400], "rows": [
                    {"h": 100, "cells": [{"paras": [{"runs": [{**RUN, "t": "Region", "b": True}]}], "fill": {"color": "#f4f4f5"}, "borders": {"b": {"color": "#1c1c1f", "width": 2}}},
                                         {"paras": [{"runs": [{**RUN, "t": "Both", "b": True}]}], "span": 2}, {"hmerge": True}]},
                    {"h": 100, "cells": [{"paras": [{"runs": [{**RUN, "t": "North"}]}], "rowspan": 2}, {"paras": [{"runs": [{**RUN, "t": "1"}]}]}, {"paras": [{"runs": [{**RUN, "t": "2"}]}]}]},
                    {"h": 100, "cells": [{"vmerge": True}, {"paras": [{"runs": [{**RUN, "t": "3"}]}]}, {"paras": [{"runs": [{**RUN, "t": "4"}]}]}]},
                ]},
                {"kind": "chart", "chart": "column", "x": 96, "y": 450, "w": 800, "h": 500, "labels": ["Q1", "Q2", "Q3"],
                 "series": [{"name": "2025", "values": [1, 2, 3], "color": "#2f6fed"}, {"name": "2026", "values": [2, None, 4], "color": "#e8503f"}],
                 "legend": True, "values": True, "grid": True, "unit": "%", "title": "Growth", "text": {"font": "Arial", "size": 24, "color": "#45464d"}},
                {"kind": "chart", "chart": "pie", "x": 1000, "y": 450, "w": 600, "h": 500, "labels": ["A", "B"], "series": [{"name": "Share", "values": [60, 40]}],
                 "palette": ["#2f6fed", "#e8503f"], "legend": True},
            ]},
        ],
    }


class ExportTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.dir, "assets"))
        with open(os.path.join(self.dir, "assets", "pic.png"), "wb") as f:
            f.write(png(6, 6, (232, 80, 63)))

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def resolve(self, pic):
        full = os.path.join(self.dir, pic["path"])
        if not os.path.isfile(full):
            return None
        with open(full, "rb") as f:
            return f.read(), "png"

    def build(self, spec=None):
        data, notes = pptx_export.build_pptx(spec or sample_spec(), self.resolve)
        path = os.path.join(self.dir, "out.pptx")
        with open(path, "wb") as f:
            f.write(data)
        return path, notes

    def test_package_is_well_formed(self):
        path, notes = self.build()
        self.assertEqual(notes, [])
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            for n in names:
                if n.endswith(".xml") or n.endswith(".rels"):
                    ET.fromstring(z.read(n))                       # every part parses
            types = z.read("[Content_Types].xml").decode()
            for n in names:
                if n.startswith("ppt/slides/slide") or n.startswith("ppt/charts/chart"):
                    self.assertIn("/" + n, types)
            for need in ("ppt/presentation.xml", "ppt/slides/slide2.xml", "ppt/notesSlides/notesSlide1.xml", "ppt/charts/chart1.xml",
                         "ppt/charts/chart2.xml", "ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx", "ppt/notesMasters/notesMaster1.xml"):
                self.assertIn(need, names)
            self.assertTrue(any(n.endswith(".svg") for n in names))
            self.assertIn('show="0"', z.read("ppt/slides/slide2.xml").decode())
            # every relationship target exists
            for n in names:
                if not n.endswith(".rels"):
                    continue
                base = n.replace("_rels/", "").rsplit(".rels", 1)[0]
                folder = os.path.dirname(base)
                for rel in ET.fromstring(z.read(n)):
                    if rel.get("TargetMode") == "External":
                        continue
                    target = os.path.normpath(os.path.join(folder, rel.get("Target"))).replace("\\", "/")
                    self.assertIn(target, names, f"{n} -> {rel.get('Target')}")
            with zipfile.ZipFile(__import__("io").BytesIO(z.read("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx"))) as wb:
                sheet = wb.read("xl/worksheets/sheet1.xml").decode()
                self.assertIn("Q2", sheet)
                self.assertIn("2026", sheet)

    def test_sizes_are_emu_and_points(self):
        path, _ = self.build()
        with zipfile.ZipFile(path) as z:
            pres = z.read("ppt/presentation.xml").decode()
            s1 = z.read("ppt/slides/slide1.xml").decode()
        self.assertIn('cx="12192000" cy="6858000"', pres)                  # 1920 x 1080 px = 13.333 x 7.5 in
        self.assertIn('<a:off x="609600" y="457200"/>', s1)                 # 96, 72 px
        self.assertIn('sz="4800"', s1)                                      # 96 px = 48 pt
        self.assertIn('rot="1800000"', s1)                                  # 30 degrees
        self.assertIn('baseline="-25000"', s1)
        self.assertIn('<a:srcRect l="10000" t="0" r="10000" b="0"/>', s1)

    def test_our_importer_reads_it_back(self):
        path, _ = self.build()
        out = os.path.join(self.dir, "deck")
        os.makedirs(out)
        html = pptx_import.import_pptx(path, out)
        html = html if isinstance(html, str) else html[0]
        for words in ("Hello", "world", "First point", "A sub point", "In a box", "Region", "North", "Say hello."):
            self.assertIn(words, html)
        self.assertIn("data-skip", html)                                     # the hidden slide
        self.assertIn("left: 96px", html.replace("left:96px", "left: 96px"))

    def test_fills_effects_and_corners(self):
        grad = {"angle": 90, "stops": [{"pos": 0, "color": "#0000ff"}, {"pos": 1, "color": "#ffff00", "alpha": 0.5}]}
        spec = {"slides": [{"bg": {"grad": {"radial": True, "stops": [{"pos": 0, "color": "#ff0000"}, {"pos": 1, "color": "#000000"}]}}, "items": [
            {"kind": "shape", "x": 0, "y": 0, "w": 400, "h": 200, "fill": {"grad": grad}, "shadow": {"color": "#000000", "alpha": 0.25, "x": 0, "y": 12, "blur": 32}},
            {"kind": "shape", "x": 0, "y": 300, "w": 200, "h": 200, "geom": "round2Diag", "radius": 80, "radius2": 0, "soft": 20},
            {"kind": "shape", "x": 0, "y": 600, "w": 200, "h": 100, "paras": [{"runs": [{"t": "code", "size": 32, "highlight": "#eeeeee"}],
                                                                              "bullet": {"char": "•", "scale": 1.5}}]}]}]}
        path, _ = self.build(spec)
        with zipfile.ZipFile(path) as z:
            s = z.read("ppt/slides/slide1.xml").decode()
        ET.fromstring(s)
        self.assertIn('<a:lin ang="0" scaled="0"/>', s)                     # CSS 90deg (to the right) is DrawingML 0
        self.assertIn('<a:gs pos="100000"><a:srgbClr val="FFFF00"><a:alpha val="50000"/>', s)
        self.assertIn('<a:path path="circle">', s)                            # the radial slide background
        self.assertIn('<a:outerShdw blurRad="203200" dist="76200" dir="5400000"', s)   # 12px down = 90 degrees
        self.assertIn('prst="round2DiagRect"', s)
        self.assertIn('<a:gd name="adj1" fmla="val 40000"/>', s)
        self.assertIn('<a:softEdge rad="127000"/>', s)
        self.assertIn('<a:highlight><a:srgbClr val="EEEEEE"/></a:highlight>', s)
        self.assertIn('<a:buSzPct val="150000"/>', s)

    def test_bad_input_is_left_out_with_a_note(self):
        spec = {"slides": [{"items": [{"kind": "pic", "x": 0, "y": 0, "w": 10, "h": 10, "src": {"path": "nope.png"}},
                                      {"kind": "shape", "x": "zero", "y": 0, "w": 10, "h": 10}]}]}
        path, notes = self.build(spec)
        self.assertTrue(any("nope.png" in n for n in notes))
        with zipfile.ZipFile(path) as z:
            ET.fromstring(z.read("ppt/slides/slide1.xml"))

    def test_text_is_escaped(self):
        spec = {"slides": [{"items": [{"kind": "shape", "x": 0, "y": 0, "w": 100, "h": 100, "name": 'a "<b>" & c',
                                       "paras": [{"runs": [{"t": "1 < 2 & \x07 \"quoted\"", "size": 32}]}]}]}]}
        path, _ = self.build(spec)
        with zipfile.ZipFile(path) as z:
            s = z.read("ppt/slides/slide1.xml").decode()
        ET.fromstring(s)
        self.assertIn("1 &lt; 2 &amp;  &quot;quoted&quot;", s)


if __name__ == "__main__":
    unittest.main()
