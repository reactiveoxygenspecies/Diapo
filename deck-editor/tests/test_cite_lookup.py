"""Unit tests for the two lookups behind citations and picture credits (serve.lookup_doi,
serve.lookup_commons): what they ask for, what they take from the answer, and the messages
when it goes wrong. urlopen is stubbed: nothing goes out.

    py -3 -m unittest tests.test_cite_lookup     (from deck-editor/)
"""
import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve_for_tests import serve  # noqa: E402


class Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def answering(obj, seen):
    def urlopen(req, timeout=None):
        seen.append(req)
        return Answer(json.dumps(obj).encode("utf-8"))
    return urlopen


class Doi(unittest.TestCase):
    def test_asks_doi_org_for_csl_json(self):
        seen = []
        item = {"title": "Synthesizing life", "author": [{"family": "Szostak", "given": "Jack W."}], "type": "article-journal"}
        with mock.patch.object(serve.urllib.request, "urlopen", answering(item, seen)):
            got = serve.lookup_doi("https://doi.org/10.1038/35053176")
        self.assertEqual(seen[0].full_url, "https://doi.org/10.1038/35053176")
        self.assertEqual(seen[0].get_header("Accept"), "application/vnd.citationstyles.csl+json")
        self.assertTrue(seen[0].get_header("User-agent").startswith("Diapo/"))
        self.assertEqual(got["title"], "Synthesizing life")
        self.assertEqual(got["DOI"], "10.1038/35053176")

    def test_not_a_doi_never_goes_out(self):
        with mock.patch.object(serve.urllib.request, "urlopen", side_effect=AssertionError("asked")):
            for bad in ("", "nature07018", "10.12/x", "doi:"):
                with self.assertRaises(serve.LookupError_):
                    serve.lookup_doi(bad)

    def test_unknown_and_offline(self):
        def gone(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)
        with mock.patch.object(serve.urllib.request, "urlopen", gone):
            with self.assertRaisesRegex(serve.LookupError_, "doi.org does not know it"):
                serve.lookup_doi("10.9999/nothing.here")
        with mock.patch.object(serve.urllib.request, "urlopen", side_effect=urllib.error.URLError("down")):
            with self.assertRaisesRegex(serve.LookupError_, "online"):
                serve.lookup_doi("10.1038/35053176")

    def test_an_answer_that_is_not_a_reference(self):
        with mock.patch.object(serve.urllib.request, "urlopen", answering(["not", "an", "item"], [])):
            with self.assertRaises(serve.LookupError_):
                serve.lookup_doi("10.1038/35053176")


class Commons(unittest.TestCase):
    def test_file_titles_from_addresses(self):
        t = serve.commons_title
        self.assertEqual(t("https://upload.wikimedia.org/wikipedia/commons/a/ab/Giant_vesicles.jpg"), "File:Giant_vesicles.jpg")
        self.assertEqual(t("https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Giant_vesicles.jpg/800px-Giant_vesicles.jpg"), "File:Giant_vesicles.jpg")
        self.assertEqual(t("https://commons.wikimedia.org/wiki/File:Giant%20vesicles.jpg"), "File:Giant vesicles.jpg")
        self.assertEqual(t("https://en.wikipedia.org/wiki/File:Vesicle.png"), "File:Vesicle.png")
        self.assertEqual(t("https://commons.wikimedia.org/w/index.php?title=File:Vesicle.png&oldid=1"), "File:Vesicle.png")
        self.assertIsNone(t("https://en.wikipedia.org/wiki/Protocell"))
        self.assertIsNone(t("https://example.org/File:Vesicle.png"))

    def test_author_and_licence_as_text(self):
        seen = []
        answer = {"query": {"pages": [{"title": "File:Vesicle.png", "imageinfo": [{
            "descriptionurl": "https://commons.wikimedia.org/wiki/File:Vesicle.png",
            "extmetadata": {"Artist": {"value": "<a href=\"//commons.wikimedia.org/wiki/User:Someone\">Some One</a> &amp; Another"},
                            "LicenseShortName": {"value": "CC BY-SA 4.0"}, "Credit": {"value": "Own work"}}}]}]}}
        with mock.patch.object(serve.urllib.request, "urlopen", answering(answer, seen)):
            got = serve.lookup_commons("https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Vesicle.png/640px-Vesicle.png")
        self.assertIn("titles=File%3AVesicle.png", seen[0].full_url)
        self.assertEqual(got, {"by": "Some One & Another", "from": "Wikimedia Commons", "license": "CC BY-SA 4.0", "url": "https://commons.wikimedia.org/wiki/File:Vesicle.png"})

    def test_missing_file_and_other_sites(self):
        with mock.patch.object(serve.urllib.request, "urlopen", answering({"query": {"pages": [{"title": "File:No.png", "missing": True}]}}, [])):
            with self.assertRaisesRegex(serve.LookupError_, "no file called No.png"):
                serve.lookup_commons("https://commons.wikimedia.org/wiki/File:No.png")
        with mock.patch.object(serve.urllib.request, "urlopen", side_effect=AssertionError("asked")):
            with self.assertRaises(serve.LookupError_):
                serve.lookup_commons("https://example.org/a.png")


if __name__ == "__main__":
    unittest.main()
