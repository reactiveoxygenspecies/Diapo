"""Unit tests for Export > Publish...: the folder serve.py writes for a free web host.

    py -3 -m unittest tests.test_publish     (from deck-editor/)
"""
import os
import shutil
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve_for_tests import serve, TMP  # noqa: E402

DECK = """<!DOCTYPE html><html><head><title>Talk</title>
<link rel="stylesheet" href="theme.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<script src="extra.js"></script>
</head><body><div class="deck-stage" style="width:1920px;height:1080px">
<section class="slide"><h1>Hello</h1><img src="assets/pic.png"><img src="assets/gone.png">
<img src="../secret.png"><video src="assets/clip.mp4" poster="assets/pic.png"></video><img src="assets/space%20name.png"></section>
</div><!-- padding so that the page passes for a deck: """ + "x" * 200 + """ --></body></html>"""


def touch(path, data=b"x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


class PublishFolder(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(dir=TMP)
        self.addCleanup(shutil.rmtree, self.root, True)
        self.deck_dir = os.path.join(self.root, "talk")
        self.deck = os.path.join(self.deck_dir, "index.html")
        touch(self.deck, DECK.encode())
        touch(os.path.join(self.deck_dir, "theme.css"), b"@font-face{src:url(fonts/own.woff2)} body{background:url('bg/back.jpg')}")
        touch(os.path.join(self.deck_dir, "fonts", "own.woff2"))
        touch(os.path.join(self.deck_dir, "bg", "back.jpg"))
        touch(os.path.join(self.deck_dir, "extra.js"), b"1")
        touch(os.path.join(self.deck_dir, "assets", "pic.png"))
        touch(os.path.join(self.deck_dir, "assets", "clip.mp4"))
        touch(os.path.join(self.deck_dir, "assets", "space name.png"))
        touch(os.path.join(self.root, "secret.png"))
        touch(os.path.join(self.deck_dir, "assets", "unused.png"))
        # The editor's own files, beside the deck.
        touch(os.path.join(self.deck_dir, ".deck-editor", "index.html.~draft"))
        touch(os.path.join(self.deck_dir, ".deck-editor", "index.html.bak"))
        touch(os.path.join(self.deck_dir, "index.html.~2.bak"))
        self.dest = os.path.join(self.root, "talk-site")

    def publish(self, **kw):
        return serve.write_publish_folder(self.deck, DECK, **kw)

    def files(self, folder):
        return sorted(os.path.relpath(os.path.join(d, f), folder).replace(os.sep, "/") for d, _, fs in os.walk(folder) for f in fs)

    def test_default_folder_is_named_after_the_deck_folder_and_sits_beside_it(self):
        self.assertEqual(serve.publish_default_dest(self.deck), self.dest)
        r = self.publish()
        self.assertEqual(r["path"], os.path.realpath(self.dest))

    def test_the_deck_and_what_it_references_are_copied_and_nothing_else(self):
        r = self.publish()
        self.assertEqual(self.files(self.dest), ["assets/clip.mp4", "assets/pic.png", "assets/space name.png", "bg/back.jpg",
                                                 "extra.js", "fonts/own.woff2", "index.html", "theme.css"])
        self.assertEqual(r["files"], 8)
        with open(os.path.join(self.dest, "index.html"), encoding="utf-8") as f:
            self.assertEqual(f.read(), DECK)                  # the page as given, links to Google Fonts untouched
        self.assertIn("not found next to the deck, not copied: assets/gone.png", r["notes"])

    def test_editor_files_never_travel_even_when_the_deck_names_them(self):
        page = DECK.replace("<h1>Hello</h1>", '<h1>Hello</h1><img src=".deck-editor/index.html.bak"><img src="index.html.~2.bak">')
        r = serve.write_publish_folder(self.deck, page, to=self.dest)
        listing = self.files(self.dest)
        self.assertFalse([f for f in listing if ".deck-editor" in f or f.endswith(".bak") or f.endswith(".~draft")])
        self.assertTrue(any("belongs to the editor" in n for n in r["notes"]))

    def test_a_path_outside_the_deck_folder_is_refused_and_said(self):
        r = self.publish()
        self.assertFalse(os.path.exists(os.path.join(self.root, "talk-site", "secret.png")))
        self.assertFalse(os.path.exists(os.path.join(self.dest, "..", "secret.png.copy")))
        self.assertIn("outside the deck folder, left out: ../secret.png", r["notes"])
        self.assertNotIn("secret.png", " ".join(self.files(self.dest)))

    def test_a_link_that_leaves_the_deck_folder_through_a_symlink_is_left_out(self):
        outside = os.path.join(self.root, "elsewhere")
        touch(os.path.join(outside, "private.png"))
        link = os.path.join(self.deck_dir, "linked")
        try:
            os.symlink(outside, link, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks are not allowed here")
        page = DECK.replace("<h1>Hello</h1>", '<h1>Hello</h1><img src="linked/private.png">')
        r = serve.write_publish_folder(self.deck, page, to=self.dest)
        self.assertNotIn("linked/private.png", self.files(self.dest))
        self.assertIn("outside the deck folder, left out: linked/private.png", r["notes"])

    def test_the_destination_cannot_be_the_deck_folder_or_above_it(self):
        for to in (self.deck_dir, self.root):
            with self.subTest(to=to), self.assertRaises(serve.PublishError):
                self.publish(to=to)

    def test_a_non_empty_folder_needs_a_confirmation_and_is_untouched_until_then(self):
        touch(os.path.join(self.dest, "old.txt"), b"keep me")
        with self.assertRaises(serve.PublishError) as caught:
            self.publish()
        self.assertEqual((caught.exception.status, caught.exception.reason), (409, "not-empty"))
        self.assertEqual(self.files(self.dest), ["old.txt"])
        r = self.publish(overwrite=True)
        self.assertIn("index.html", self.files(self.dest))
        self.assertIn("old.txt", self.files(self.dest))        # nothing else is deleted
        self.assertEqual(r["path"], os.path.realpath(self.dest))

    def test_an_empty_existing_folder_needs_no_confirmation(self):
        os.makedirs(self.dest)
        self.publish()
        self.assertIn("index.html", self.files(self.dest))

    def test_a_file_where_the_folder_should_be_is_refused(self):
        touch(self.dest, b"a file")
        with self.assertRaises(serve.PublishError):
            self.publish()

    def test_a_name_is_taken_relative_to_the_deck_folders_parent(self):
        r = self.publish(to="my-site")
        self.assertEqual(r["path"], os.path.realpath(os.path.join(self.root, "my-site")))

    def test_the_zip_holds_exactly_the_published_files_with_index_at_the_top(self):
        touch(os.path.join(self.dest, "old.txt"), b"left from before")
        r = self.publish(overwrite=True, make_zip=True)
        self.assertEqual(r["zip"], os.path.realpath(self.dest) + ".zip")
        with zipfile.ZipFile(r["zip"]) as z:
            names = sorted(z.namelist())
            self.assertIsNone(z.testzip())
            self.assertEqual(z.read("index.html").decode("utf-8"), DECK)
        self.assertEqual(names, ["assets/clip.mp4", "assets/pic.png", "assets/space name.png", "bg/back.jpg",
                                 "extra.js", "fonts/own.woff2", "index.html", "theme.css"])
        self.assertFalse(os.path.exists(os.path.join(self.dest, os.path.basename(r["zip"]))))      # beside the folder, not in it

    def test_an_existing_zip_is_not_replaced_without_a_confirmation(self):
        touch(self.dest + ".zip", b"old zip")
        with self.assertRaises(serve.PublishError) as caught:
            self.publish(make_zip=True)
        self.assertEqual(caught.exception.reason, "not-empty")
        self.assertFalse(os.path.exists(self.dest))
        self.publish(make_zip=True, overwrite=True)
        self.assertTrue(zipfile.is_zipfile(self.dest + ".zip"))

    def test_interactive_chart_files_come_from_diapo_when_the_deck_folder_lacks_them(self):
        page = DECK.replace("</head>", '<script src="deck-plotly.min.js"></script><script src="deck-plot.js"></script></head>')
        serve.write_publish_folder(self.deck, page, to=self.dest)
        listing = self.files(self.dest)
        self.assertIn("deck-plotly.min.js", listing)
        self.assertIn("deck-plot.js", listing)
        with open(os.path.join(self.dest, "deck-plot.js"), "rb") as a, open(os.path.join(serve.APP_DIR, "deck-plot.js"), "rb") as b:
            self.assertEqual(a.read(), b.read())

    def test_google_fonts_are_downloaded_into_the_folder_on_request(self):
        css = "/* latin */\n@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/inter.woff2) format('woff2'); }"
        calls = []

        def fake(url, timeout=30):
            calls.append(url)
            return css.encode() if "googleapis" in url else b"WOFF2"
        real, serve.fetch_url = serve.fetch_url, fake
        self.addCleanup(setattr, serve, "fetch_url", real)
        r = self.publish(fonts=True)
        self.assertEqual(r["fonts"], 1)
        with open(os.path.join(self.dest, "index.html"), encoding="utf-8") as f:
            page = f.read()
        self.assertNotIn("<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com", page)
        self.assertIn("url(fonts/Inter-400-latin.woff2)", page)
        self.assertIn("fonts/Inter-400-latin.woff2", self.files(self.dest))

    def test_without_the_option_google_fonts_links_stay_and_nothing_is_fetched(self):
        def boom(url, timeout=30):
            raise AssertionError("no request expected")
        real, serve.fetch_url = serve.fetch_url, boom
        self.addCleanup(setattr, serve, "fetch_url", real)
        self.publish()
        with open(os.path.join(self.dest, "index.html"), encoding="utf-8") as f:
            self.assertIn("fonts.googleapis.com", f.read())

    def test_offline_the_link_stays_and_a_note_says_so(self):
        def offline(url, timeout=30):
            raise OSError("network is unreachable")
        real, serve.fetch_url = serve.fetch_url, offline
        self.addCleanup(setattr, serve, "fetch_url", real)
        r = self.publish(fonts=True)
        self.assertEqual(r["fonts"], 0)
        self.assertTrue(any("Google Fonts could not be downloaded" in n for n in r["notes"]))

    def test_only_a_folder_just_published_may_be_revealed(self):
        r = self.publish()
        self.assertIn(r["path"], serve.PUBLISHED)
        self.assertNotIn(self.root, serve.PUBLISHED)

    def test_the_host_links_are_fixed_addresses(self):
        self.assertEqual(serve.link_url("netlify-drop"), "https://app.netlify.com/drop")
        self.assertEqual(serve.link_url("github-new"), "https://github.com/new")
        self.assertTrue(serve.link_url("https://evil.example/").startswith("https://github.com/reactiveoxygenspecies/Diapo"))


if __name__ == "__main__":
    unittest.main()
