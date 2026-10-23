"""Unit tests for the Markdown import: which local files a picture may bring into the deck.

    py -3 -m unittest tests.test_md_import     (from deck-editor/)
"""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import import_deck  # noqa: E402

PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")


class MarkdownPictures(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        self.src = os.path.join(root, "talk")
        self.out = os.path.join(root, "deck")
        os.makedirs(os.path.join(self.src, "img"))
        os.makedirs(self.out)
        with open(os.path.join(self.src, "img", "chart.png"), "wb") as f:
            f.write(PNG)
        with open(os.path.join(root, "outside.png"), "wb") as f:
            f.write(PNG)
        with open(os.path.join(self.src, "secret.env"), "w") as f:
            f.write("SECRET=1\n")
        self.secret_abs = os.path.join(root, "secret-abs.txt")
        with open(self.secret_abs, "w") as f:
            f.write("SECRET=2\n")

    def tearDown(self):
        self.tmp.cleanup()

    def run_import(self, body):
        md = os.path.join(self.src, "talk.md")
        with open(md, "w", encoding="utf-8") as f:
            f.write("# Talk\n\n---\n\n" + body + "\n")
        return import_deck.import_file(md, self.out)

    def copied(self):
        assets = os.path.join(self.out, "assets")
        return sorted(os.listdir(assets)) if os.path.isdir(assets) else []

    def test_a_picture_in_the_folder_is_copied(self):
        html, notes = self.run_import("![chart](img/chart.png)")
        self.assertIn('src="assets/chart.png"', html)
        self.assertEqual(self.copied(), ["chart.png"])
        self.assertEqual(notes, [])

    def test_files_that_are_not_media_are_never_copied(self):
        html, notes = self.run_import("![x](secret.env)\n\n![y](" + self.secret_abs.replace(os.sep, "/") + ")")
        self.assertEqual(self.copied(), [])
        self.assertNotIn("secret", html.lower())
        self.assertEqual(len(notes), 2)

    def test_pictures_outside_the_folder_are_never_copied(self):
        html, notes = self.run_import("![x](../outside.png)")
        self.assertEqual(self.copied(), [])
        self.assertTrue(any("outside.png" in n for n in notes))

    def test_remote_pictures_stay_links(self):
        html, notes = self.run_import("![x](https://example.com/a.png)")
        self.assertIn('src="https://example.com/a.png"', html)
        self.assertEqual(notes, [])


if __name__ == "__main__":
    unittest.main()
