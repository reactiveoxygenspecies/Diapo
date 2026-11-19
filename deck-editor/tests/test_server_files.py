"""Unit tests for serve.py's file handling: the names a request may give, a renamed deck's
history, and what a single-file export of the tour may inline.

    py -3 -m unittest tests.test_server_files     (from deck-editor/)
"""
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve_for_tests import serve, TMP  # noqa: E402


class FileNames(unittest.TestCase):
    def test_plain_names_pass_and_get_their_extension(self):
        self.assertEqual(serve.bare_name("talk", ".html"), "talk.html")
        self.assertEqual(serve.bare_name(" talk.HTML ", ".html"), "talk.HTML")
        self.assertEqual(serve.bare_name("notes. v2", ".pdf"), "notes. v2.pdf")

    def test_names_that_would_land_elsewhere_are_refused(self):
        for name in ("C:notes", "x:y", "a/b", "a\\b", "..", ".", " ", "", "tab\there", "CON", "nul.html", "com1.txt", "Lpt9"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                serve.bare_name(name, ".html")


class RenameKeepsHistory(unittest.TestCase):
    def test_versions_and_draft_follow_the_new_name(self):
        with tempfile.TemporaryDirectory(dir=TMP) as d:
            old, new = os.path.join(d, "talk.html"), os.path.join(d, "renamed.html")
            side = os.path.join(d, ".deck-editor")
            os.makedirs(side)
            for suffix in (".bak", ".~1.bak", ".~draft"):
                open(os.path.join(side, "talk.html" + suffix), "w").close()
            open(os.path.join(side, "talk.html.unrelated"), "w").close()
            open(os.path.join(d, "talk.html.~2.bak"), "w").close()          # an older Diapo's, beside the deck
            serve.move_sidecars(old, new)
            self.assertEqual(sorted(os.listdir(side)), ["renamed.html.bak", "renamed.html.~1.bak", "renamed.html.~2.bak",
                                                        "renamed.html.~draft", "talk.html.unrelated"])


class TourExport(unittest.TestCase):
    def test_the_tour_inlines_its_own_pictures(self):
        # The tour lives outside the workspace (beside the settings), as it does for users.
        samples = tempfile.mkdtemp(prefix="diapo-samples-")
        self.addCleanup(shutil.rmtree, samples, True)
        deck = os.path.join(samples, "welcome", "index.html")
        os.makedirs(os.path.join(samples, "welcome", "assets"), exist_ok=True)
        with open(os.path.join(samples, "welcome", "assets", "dot.svg"), "w") as f:
            f.write('<svg xmlns="http://www.w3.org/2000/svg"/>')
        page = '<img src="assets/dot.svg"><img src="../../outside.svg">'
        with mock.patch.object(serve, "SAMPLES_DIR", samples):
            inl = serve.Inliner(deck)
            html = inl.run(page, embed_google=False)
        self.assertIn('src="data:image/svg+xml;base64,', html)
        self.assertIn('src="../../outside.svg"', html)                       # outside the tour's folder: a link
        self.assertTrue(any("outside" in n for n in inl.notes), inl.notes)


class RecentPreviews(unittest.TestCase):
    """/recent/<key>/<path> serves a recent deck's own folder, and nothing else."""

    def test_only_the_recent_decks_folder_is_reachable(self):
        with tempfile.TemporaryDirectory(dir=TMP) as ws:
            os.makedirs(os.path.join(ws, "talk", "assets"))
            os.makedirs(os.path.join(ws, "other"))
            for p in (("talk", "index.html"), ("talk", "assets", "a.png"), ("other", "index.html"), ("loose.html",)):
                open(os.path.join(ws, *p), "w").close()
            entry = {"workspace": ws, "file": "talk/index.html", "when": 1}
            key = serve.recent_key(entry)
            with mock.patch.dict(serve.SETTINGS, {"recent": [entry]}):
                self.assertEqual(serve.recent_path(key, "talk/index.html"), os.path.realpath(os.path.join(ws, "talk", "index.html")))
                self.assertEqual(serve.recent_path(key, "talk/assets/a.png"), os.path.realpath(os.path.join(ws, "talk", "assets", "a.png")))
                for rel in ("other/index.html", "loose.html", "talk/../other/index.html", "talk/%2e%2e/loose.html", "talk", ""):
                    with self.subTest(rel=rel), self.assertRaises(PermissionError):
                        serve.recent_path(key, rel)
                with self.assertRaises(PermissionError):
                    serve.recent_path("0" * 16, "talk/index.html")              # not on the list
                listed = serve.recent_decks()
                self.assertEqual(listed[0]["key"], key)
                self.assertEqual(listed[0]["size"], 0)

    def test_the_tour_is_not_served_this_way(self):
        entry = {"workspace": TMP, "file": "@diapo/welcome/index.html", "when": 1}
        with mock.patch.dict(serve.SETTINGS, {"recent": [entry]}), self.assertRaises(PermissionError):
            serve.recent_path(serve.recent_key(entry), "@diapo/welcome/index.html")


if __name__ == "__main__":
    unittest.main()
