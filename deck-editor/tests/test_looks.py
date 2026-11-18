"""Unit tests for app/templates/looks.json, the designs' ready-made looks in the Theme panel:
the checked-in file is what tools/build-templates.py extracts from the designs today, and every
look has the roles the panel maps onto a deck (text, background, accent, lines, body font).

    py -3 -m unittest tests.test_looks     (from deck-editor/)
"""
import importlib.util
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def builder():
    spec = importlib.util.spec_from_file_location("build_templates", os.path.join(ROOT, "tools", "build-templates.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class Looks(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "app", "templates", "looks.json"), encoding="utf-8") as f:
            self.saved = json.load(f)

    def test_the_file_is_up_to_date_with_the_designs(self):
        self.assertEqual(builder().looks(), self.saved, "run py -3 tools/build-templates.py to rewrite looks.json")

    def test_every_design_but_blank_has_a_look_with_the_roles(self):
        with open(os.path.join(ROOT, "app", "templates", "templates.json"), encoding="utf-8") as f:
            slugs = [t["slug"] for t in json.load(f)["templates"] if t["slug"] != "blank"]
        self.assertEqual([l["slug"] for l in self.saved["looks"]], slugs)
        for look in self.saved["looks"]:
            v = look["vars"]
            for role in ("ink", "paper", "accent", "rule", "slide-bg", "font"):
                self.assertIn(role, v, look["slug"])
            self.assertRegex(v["ink"], r"^#[0-9a-fA-F]{3,8}$")
            self.assertNotIn("dur", v)                        # motion is not part of a look
            for value in v.values():
                self.assertNotIn("var(", value, look["slug"])   # pointers are resolved
            # Every Google family a look's fonts name comes with the weights the design loads.
            for fam, g in look["google"].items():
                self.assertTrue(g["weights"] or g["italics"], fam)

    def test_google_urls_are_read_with_their_weights(self):
        b = builder()
        got = b.google_families("https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,600;1,300&family=Inter+Tight:wght@400..600&family=Rubik&display=swap")
        self.assertEqual(got, {
            "Fraunces": {"weights": [300, 600], "italics": [300]},
            "Inter Tight": {"weights": [400, 500, 600], "italics": []},
            "Rubik": {"weights": [400], "italics": []},
        })


if __name__ == "__main__":
    unittest.main()
