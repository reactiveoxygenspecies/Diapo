"""Scatter (XY) charts to and from PowerPoint: pptx_chart_export writes the editor's scatter as a
native c:scatterChart, and pptx_chart / pptx_import read one back into an editable scatter.

    py -3 -m unittest tests.test_pptx_scatter     (from deck-editor/)
"""
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import pptx_chart_export  # noqa: E402
import pptx_export  # noqa: E402
import pptx_import  # noqa: E402
from pptx_chart import chart_spec, chart_svg  # noqa: E402

NS = {"c": "http://schemas.openxmlformats.org/drawingml/2006/chart", "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
NSDECL = f'xmlns:c="{NS["c"]}" xmlns:a="{NS["a"]}"'


class Theme:
    minor = "Calibri"
    COLOURS = {"accent1": "4472c4", "accent2": "ed7d31", "accent3": "a5a5a5", "accent4": "ffc000",
               "accent5": "5b9bd5", "accent6": "70ad47", "tx1": "000000"}

    def scheme(self, name):
        return self.COLOURS[name]


def scatter_item(**more):
    return {"kind": "chart", "chart": "scatter", "x": 100, "y": 100, "w": 900, "h": 600,
            "labels": ["0.5", "1", "2", "4"], "xValues": [0.5, 1, 2, 4],
            "series": [{"name": "Signal", "values": [1.2, 2.1, 3.9, 8.3], "color": "#2f6fed", "marker": "square", "trend": True,
                        "errors": [0.1, 0.2, None, 0.4]},
                       {"name": "Blank", "values": [0.2, None, 0.3, 0.25], "color": "#e8503f"}],
            "legend": True, "grid": True, "title": "Response", "text": {"font": "Arial", "size": 24, "color": "#222222"},
            "valueAxis": {"title": "Signal (a.u.)", "log": True, "line": True}, "labelAxis": {"title": "Dose (mg)", "min": 0, "max": 5, "step": 1, "at": 1},
            **more}


class ScatterExport(unittest.TestCase):
    def test_a_native_scatter_with_two_value_axes(self):
        xml, wb = pptx_chart_export.chart_part(scatter_item(lines=True))
        root = ET.fromstring(xml.encode())
        plot = root.find(".//c:plotArea/c:scatterChart", NS)
        self.assertIsNotNone(plot)
        self.assertEqual(plot.find("c:scatterStyle", NS).get("val"), "lineMarker")
        axes = root.findall(".//c:plotArea/c:valAx", NS)
        self.assertEqual(len(axes), 2)                                   # X and Y are both value axes
        self.assertIsNone(root.find(".//c:catAx", NS))
        sers = plot.findall("c:ser", NS)
        xs = [p.find("c:v", NS).text for p in sers[0].findall("c:xVal//c:pt", NS)]
        ys = [p.find("c:v", NS).text for p in sers[0].findall("c:yVal//c:pt", NS)]
        self.assertEqual(xs, ["0.5", "1", "2", "4"])
        self.assertEqual(ys, ["1.2", "2.1", "3.9", "8.3"])
        self.assertEqual(len(sers[1].findall("c:yVal//c:pt", NS)), 3)   # a gap has no point
        self.assertEqual(sers[0].find("c:marker/c:symbol", NS).get("val"), "square")
        # The Y axis is logarithmic, so the trend line straight on it is an exponential; R² shown.
        tl = sers[0].find("c:trendline", NS)
        self.assertEqual(tl.find("c:trendlineType", NS).get("val"), "exp")
        self.assertEqual(tl.find("c:dispRSqr", NS).get("val"), "1")
        self.assertIsNone(sers[1].find("c:trendline", NS))
        eb = sers[0].find("c:errBars", NS)
        self.assertEqual(eb.find("c:errDir", NS).get("val"), "y")
        # Schema order inside a series: trendline before errBars before xVal, yVal, smooth.
        order = [c.tag.split("}")[1] for c in sers[0]]
        self.assertLess(order.index("trendline"), order.index("errBars"))
        self.assertLess(order.index("errBars"), order.index("xVal"))
        self.assertEqual(order[-3:], ["xVal", "yVal", "smooth"])
        # The axes: X with its range and step, crossing the Y axis at Y = 1; Y log, at the left edge.
        x_ax, y_ax = axes
        self.assertEqual(x_ax.find("c:axPos", NS).get("val"), "b")
        self.assertEqual(x_ax.find("c:scaling/c:max", NS).get("val"), "5")
        self.assertEqual(x_ax.find("c:scaling/c:min", NS).get("val"), "0")
        self.assertEqual(x_ax.find("c:majorUnit", NS).get("val"), "1")
        self.assertEqual(x_ax.find("c:crossesAt", NS).get("val"), "1")
        self.assertIn("Dose (mg)", "".join(t.text for t in x_ax.iter("{%s}t" % NS["a"])))
        self.assertIsNotNone(y_ax.find("c:scaling/c:logBase", NS))
        self.assertEqual(y_ax.find("c:crosses", NS).get("val"), "min")
        # Lines between points: the series' line is drawn.
        self.assertIsNone(sers[0].find("c:spPr/a:ln/a:noFill", NS))
        # The workbook holds X as numbers.
        with zipfile.ZipFile(io.BytesIO(wb)) as z:
            sheet = z.read("xl/worksheets/sheet1.xml").decode()
        self.assertIn('<c r="A2"><v>0.5</v></c>', sheet)

    def test_points_alone_and_trend_kinds(self):
        xml, _ = pptx_chart_export.chart_part(scatter_item(valueAxis={}, labelAxis={"log": True, "at": None}))
        root = ET.fromstring(xml.encode())
        ser = root.find(".//c:scatterChart/c:ser", NS)
        self.assertIsNotNone(ser.find("c:spPr/a:ln/a:noFill", NS))       # no lines between points
        self.assertEqual(ser.find("c:trendline/c:trendlineType", NS).get("val"), "log")
        xml, _ = pptx_chart_export.chart_part(scatter_item(valueAxis={"log": True}, labelAxis={"log": True}))
        self.assertIn('<c:trendlineType val="power"/>', xml)
        xml, _ = pptx_chart_export.chart_part(scatter_item(valueAxis={}, labelAxis={}))
        self.assertIn('<c:trendlineType val="linear"/>', xml)

    def test_labels_that_are_not_numbers_go_at_1_2_3(self):
        it = scatter_item(labels=["Q1", "Q2", "Q3", "Q4"])
        del it["xValues"]
        xml, _ = pptx_chart_export.chart_part(it)
        root = ET.fromstring(xml.encode())
        xs = [p.find("c:v", NS).text for p in root.find(".//c:scatterChart/c:ser", NS).findall("c:xVal//c:pt", NS)]
        self.assertEqual(xs, ["1", "2", "3", "4"])
        self.assertEqual(pptx_chart_export.scatter_x(["0,5", "1e-3", "-2", ""]), [0.5, 0.001, -2.0, None])


class ScatterImport(unittest.TestCase):
    def part(self, plot, axes):
        return ET.fromstring(f'<c:chartSpace {NSDECL}><c:chart><c:autoTitleDeleted val="1"/><c:plotArea>{plot}{axes}</c:plotArea><c:legend/></c:chart></c:chartSpace>')

    def test_a_scatter_reads_as_an_editable_scatter(self):
        def ser(name, xs, ys, extra=""):
            xp = "".join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(xs))
            yp = "".join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(ys) if v is not None)
            return (f'<c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>{name}</c:v></c:pt></c:strCache></c:strRef></c:tx>{extra}'
                    f'<c:xVal><c:numRef><c:numCache><c:ptCount val="{len(xs)}"/>{xp}</c:numCache></c:numRef></c:xVal>'
                    f'<c:yVal><c:numRef><c:numCache><c:ptCount val="{len(ys)}"/>{yp}</c:numCache></c:numRef></c:yVal></c:ser>')
        errs = ('<c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="cust"/>'
                '<c:plus><c:numLit><c:ptCount val="3"/><c:pt idx="0"><c:v>0.5</c:v></c:pt><c:pt idx="2"><c:v>1</c:v></c:pt></c:numLit></c:plus></c:errBars>')
        plot = ('<c:scatterChart><c:scatterStyle val="lineMarker"/>'
                + ser("A", [1, 2, 3], [2, 4, 6], '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="triangle"/></c:marker><c:trendline><c:trendlineType val="linear"/></c:trendline>' + errs)
                + ser("B", [10, 20], [5, None], '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>')
                + '<c:axId val="1"/><c:axId val="2"/></c:scatterChart>')
        axes = ('<c:valAx><c:axId val="1"/><c:scaling><c:logBase val="10"/><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/>'
                '<c:title><c:tx><c:rich><a:p><a:r><a:t>Time (s)</a:t></a:r></a:p></c:rich></c:tx></c:title><c:crossAx val="2"/></c:valAx>'
                '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/><c:max val="40"/><c:min val="0"/></c:scaling><c:axPos val="l"/><c:majorGridlines/><c:majorUnit val="10"/><c:crossAx val="1"/></c:valAx>')
        root = self.part(plot, axes)
        kind, s = chart_spec(root, Theme())
        self.assertEqual(kind, "scatter")
        self.assertEqual(s["labels"], ["1", "2", "3", "10", "20"])       # B's own X add rows
        self.assertEqual(s["series"][0]["values"], [2.0, 4.0, 6.0, None, None])
        self.assertEqual(s["series"][1]["values"], [None, None, None, 5.0, None])
        self.assertEqual(s["series"][0]["marker"], "triangle")
        self.assertTrue(s["series"][0]["trend"])
        self.assertEqual(s["series"][0]["errors"], [0.5, None, 1.0, None, None])
        self.assertNotIn("lines", s)                                     # the lines have no fill: points alone
        self.assertEqual(s["labelAxis"], {"title": "Time (s)", "log": True})
        self.assertEqual(s["valueAxis"], {"min": 0.0, "max": 40.0, "step": 10.0})
        self.assertTrue(s["grid"])
        svg = chart_svg(root, Theme(), {}, 800, 500, 2.0)
        self.assertIsNotNone(svg)
        self.assertEqual(svg.count("<circle"), 4)                        # every point, no lines
        self.assertNotIn("<polyline", svg)


class ScatterRoundTrip(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_written_and_read_back(self):
        spec = {"w": 1920, "h": 1080, "title": "Scatter", "theme": {"colours": ["#1c1c1f", "#ffffff", "#45464d", "#f4f4f5", "#2f6fed", "#e8503f"], "fonts": ["Arial", "Arial"]},
                "slides": [{"items": [scatter_item(lines=True, smooth=True)]}]}
        data, notes = pptx_export.build_pptx(spec, lambda pic: None)
        self.assertEqual(notes, [])
        path = os.path.join(self.dir, "scatter.pptx")
        with open(path, "wb") as f:
            f.write(data)
        out = os.path.join(self.dir, "deck")
        os.makedirs(out)
        html = pptx_import.import_pptx(path, out)
        html = html if isinstance(html, str) else html[0]
        self.assertIn('<figure data-chart="scatter"', html)
        m = re.search(r'<script type="application/json" data-chart-data>(.*?)</script>', html)
        table = json.loads(m.group(1))
        self.assertEqual(table["labels"], ["0.5", "1", "2", "4"])
        self.assertEqual([x["name"] for x in table["series"]], ["Signal", "Blank"])
        self.assertEqual(table["series"][0]["values"], [1.2, 2.1, 3.9, 8.3])
        self.assertEqual(table["series"][1]["values"], [0.2, None, 0.3, 0.25])
        self.assertEqual(table["series"][0]["marker"], "square")
        self.assertTrue(table["series"][0]["trend"])
        self.assertEqual(table["series"][0]["errors"], [0.1, 0.2, None, 0.4])
        self.assertTrue(table["lines"] and table["smooth"])
        self.assertTrue(table["valueAxis"]["log"])
        self.assertEqual(table["valueAxis"]["title"], "Signal (a.u.)")
        self.assertEqual(table["labelAxis"], {"title": "Dose (mg)", "min": 0.0, "max": 5.0, "step": 1.0})
        self.assertEqual(table["series"][0]["colour"], "#2f6fed")


if __name__ == "__main__":
    unittest.main()
