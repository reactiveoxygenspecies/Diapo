"""Unit tests for pptx_chart.chart_spec: a PowerPoint chart part read as the editor's
chart table (app/core/chart.js), on small hand-written parts.

    py -3 -m unittest tests.test_pptx_chart     (from deck-editor/)
"""
import os
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from pptx_chart import chart_spec  # noqa: E402

NSDECL = ('xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
          'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"')


class Theme:
    minor = "Calibri"
    COLOURS = {"accent1": "4472c4", "accent2": "ed7d31", "accent3": "a5a5a5", "accent4": "ffc000",
               "accent5": "5b9bd5", "accent6": "70ad47", "tx1": "000000"}

    def scheme(self, name):
        return self.COLOURS[name]


def ser(name, vals, code="General", labels=""):
    pts = "".join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(vals) if v is not None)   # a gap has no point
    cats = "".join(f'<c:pt idx="{i}"><c:v>C{i + 1}</c:v></c:pt>' for i in range(len(vals)))
    return (f'<c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>{name}</c:v></c:pt></c:strCache></c:strRef></c:tx>{labels}'
            f'<c:cat><c:strRef><c:strCache><c:ptCount val="{len(vals)}"/>{cats}</c:strCache></c:strRef></c:cat>'
            f'<c:val><c:numRef><c:numCache><c:formatCode>{code}</c:formatCode><c:ptCount val="{len(vals)}"/>{pts}</c:numCache></c:numRef></c:val></c:ser>')


def part(plot, title=""):
    t = f'<c:title><c:tx><c:rich><a:p><a:r><a:t>{title}</a:t></a:r></a:p></c:rich></c:tx></c:title>' if title else '<c:autoTitleDeleted val="1"/>'
    return ET.fromstring(f'<c:chartSpace {NSDECL}><c:chart>{t}<c:plotArea>{plot}<c:valAx><c:majorGridlines/></c:valAx></c:plotArea><c:legend/></c:chart></c:chartSpace>')


class ChartSpec(unittest.TestCase):
    def test_column_with_a_percent_format(self):
        kind, s = chart_spec(part('<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>' + ser("Rate", [0.25, 0.5], "0%") + '</c:barChart>', "Rates"), Theme())
        self.assertEqual(kind, "column")
        self.assertEqual(s["labels"], ["C1", "C2"])
        self.assertEqual(s["series"][0]["values"], [25.0, 50.0])         # fractions become percentages
        self.assertEqual(s["unit"], "%")
        self.assertEqual(s["title"], "Rates")
        self.assertTrue(s["legend"] and s["grid"])

    def test_percent_stacked_bars(self):
        kind, s = chart_spec(part('<c:barChart><c:barDir val="bar"/><c:grouping val="percentStacked"/>' + ser("A", [1, 3]) + ser("B", [3, 1]) + '</c:barChart>'), Theme())
        self.assertEqual(kind, "bar")
        self.assertTrue(s["stacked"])
        self.assertEqual([x["values"] for x in s["series"]], [[25.0, 75.0], [75.0, 25.0]])
        self.assertEqual(s["unit"], "%")
        self.assertNotIn("title", s)

    def test_line_with_a_currency_and_theme_colours(self):
        kind, s = chart_spec(part('<c:lineChart><c:grouping val="standard"/>' + ser("Cash", [10, 12.5], '"$"#,##0') + ser("Debt", [4, None]) + '</c:lineChart>'), Theme())
        self.assertEqual(kind, "line")
        self.assertEqual(s["unit"], "$")
        self.assertEqual([x["colour"] for x in s["series"]], ["#4472c4", "#ed7d31"])
        self.assertEqual(s["series"][1]["values"], [4.0, None])
        self.assertEqual(s["palette"][:2], ["#4472c4", "#ed7d31"])

    def test_pie_says_each_share_once(self):
        labels = '<c:dLbls><c:showVal val="1"/><c:showPercent val="0"/></c:dLbls>'
        kind, s = chart_spec(part('<c:pieChart>' + ser("Share", [46, 31, 15, 8], labels=labels) + '</c:pieChart>'), Theme())
        self.assertEqual(kind, "pie")
        self.assertFalse(s["values"])                                     # the values are the shares
        self.assertNotIn("colour", s["series"][0])                        # slices take the palette
        self.assertEqual(len(s["palette"]), 4)

    def test_kinds_the_editor_does_not_draw(self):
        self.assertIsNone(chart_spec(part('<c:scatterChart>' + ser("XY", [1, 2]) + '</c:scatterChart>'), Theme()))


if __name__ == "__main__":
    unittest.main()
