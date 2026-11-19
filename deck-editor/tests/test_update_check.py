"""Unit tests for the update check (serve.update_check and its route helpers): version
comparison, the stubbed GitHub answers, and the once-a-day rule.

    py -3 -m unittest tests.test_update_check     (from deck-editor/)
"""
import http.server
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve_for_tests import serve, TMP  # noqa: E402


class Versions(unittest.TestCase):
    def test_numbers_not_text(self):
        self.assertTrue(serve.version_newer("v1.10.0", "1.9.0"))
        self.assertFalse(serve.version_newer("1.9.0", "1.10.0"))

    def test_same_and_older(self):
        self.assertFalse(serve.version_newer("1.2.0", "1.2.0"))
        self.assertFalse(serve.version_newer("v1.2", "1.2.0"))
        self.assertFalse(serve.version_newer("1.1.9", "1.2.0"))
        self.assertTrue(serve.version_newer("1.2.1", "1.2"))

    def test_not_a_release_tag(self):
        self.assertIsNone(serve.parse_version("1.3.0-rc1"))
        self.assertIsNone(serve.parse_version("nightly"))
        self.assertFalse(serve.version_newer("2.0.0-beta", "1.0.0"))

    def test_notes_are_plain_and_short(self):
        n = serve.plain_notes("## What's new\r\n\r\n- **Bold** and [a link](http://x.y)\r\n- `code` <b>tag</b>\r\n" + "word " * 1000)
        self.assertNotIn("#", n)
        self.assertNotIn("http", n)
        self.assertNotIn("<b>", n)
        self.assertIn("- Bold and a link", n)
        self.assertLessEqual(len(n), serve.UPDATE_NOTES_CHARS + 3)


class Check(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(dir=TMP)
        self.patches = [mock.patch.object(serve, "SETTINGS_FILE", os.path.join(self.dir, "settings.json")),
                        mock.patch.object(serve, "SETTINGS", {}),
                        mock.patch.object(serve, "SETTINGS_WRITABLE", True),
                        mock.patch.object(serve, "APP_VERSION", "1.2.0")]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        os.environ.pop("DIAPO_UPDATE_URL", None)

    def stub(self, data, raw=None):
        path = os.path.join(self.dir, "latest.json")
        with open(path, "w", encoding="utf-8") as f:
            f.write(raw if raw is not None else json.dumps(data))
        os.environ["DIAPO_UPDATE_URL"] = path

    def rel(self, tag, **kw):
        return {"tag_name": tag, "published_at": "2026-12-01T10:00:00Z", "body": "## Notes\n- one", **kw}

    def test_newer(self):
        self.stub(self.rel("v1.3.0"))
        r = serve.update_check()
        self.assertTrue(r["newer"])
        self.assertEqual((r["current"], r["latest"], r["published"]), ("1.2.0", "1.3.0", "2026-12-01"))
        self.assertTrue(r["url"].startswith("https://github.com/reactiveoxygenspecies/Diapo/releases/"))
        self.assertIn("one", r["notes"])

    def test_same(self):
        self.stub(self.rel("v1.2.0"))
        self.assertFalse(serve.update_check()["newer"])

    def test_older(self):
        self.stub(self.rel("v1.1.1"))
        self.assertFalse(serve.update_check()["newer"])

    def test_double_digit_minor(self):
        with mock.patch.object(serve, "APP_VERSION", "1.9.0"):
            self.stub(self.rel("v1.10.0"))
            self.assertTrue(serve.update_check()["newer"])

    def test_prerelease_and_draft_are_ignored(self):
        self.stub([self.rel("v2.0.0", prerelease=True), self.rel("v1.9.0", draft=True), self.rel("v1.3.0"), self.rel("v1.2.5-rc1")])
        self.assertEqual(serve.update_check()["latest"], "1.3.0")
        self.stub(self.rel("v2.0.0", prerelease=True))
        r = serve.update_check()
        self.assertIsNone(r["latest"])
        self.assertFalse(r["newer"])

    def test_bad_json(self):
        self.stub(None, raw="<html>not json")
        with self.assertRaises(serve.UpdateError) as c:
            serve.update_check()
        self.assertIn("expected", str(c.exception))

    def test_offline(self):
        os.environ["DIAPO_UPDATE_URL"] = "http://127.0.0.1:9/nothing"      # nothing listens on the discard port
        with self.assertRaises(serve.UpdateError) as c:
            serve.update_check()
        self.assertIn("Could not reach GitHub", str(c.exception))

    def test_http_answers(self):
        class H(http.server.BaseHTTPRequestHandler):
            seen = []

            def do_GET(self):
                H.seen.append(self.headers.get("User-Agent"))
                code = {"/limit": 403, "/none": 404}.get(self.path, 200)
                body = json.dumps({"tag_name": "v1.3.0", "body": "x"}).encode()
                self.send_response(code)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass
        srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            base = f"http://127.0.0.1:{srv.server_address[1]}"
            os.environ["DIAPO_UPDATE_URL"] = base + "/ok"
            self.assertTrue(serve.update_check()["newer"])
            self.assertEqual(H.seen, ["Diapo/1.2.0"])                       # generic, nothing personal
            os.environ["DIAPO_UPDATE_URL"] = base + "/limit"
            with self.assertRaises(serve.UpdateError) as c:
                serve.update_check()
            self.assertIn("limiting", str(c.exception))
            os.environ["DIAPO_UPDATE_URL"] = base + "/none"                  # no release published
            self.assertIsNone(serve.update_check()["latest"])
        finally:
            srv.shutdown()

    def test_once_a_day_and_only_when_on(self):
        self.assertTrue(serve.update_due())                                  # on by default
        with serve.settings_change() as s:
            s["update_check"] = {"auto": False}
        self.assertFalse(serve.update_due())                                 # switched off
        with serve.settings_change() as s:
            s["update_check"] = {"auto": True}
        self.assertTrue(serve.update_due())
        self.stub(self.rel("v1.2.0"))
        serve.update_check()                                                 # records the time
        self.assertFalse(serve.update_due())
        with serve.settings_change() as s:
            s["update_check"]["last"] -= serve.UPDATE_EVERY + 5
        self.assertTrue(serve.update_due())

    def test_links_are_fixed(self):
        self.assertEqual(serve.link_url("release", "1.3.0"), "https://github.com/reactiveoxygenspecies/Diapo/releases/tag/v1.3.0")
        for bad in ("../../evil", "1.3.0/../x", "javascript:alert(1)"):
            self.assertEqual(serve.link_url("release", bad), "https://github.com/reactiveoxygenspecies/Diapo/releases")
        self.assertEqual(serve.link_url("http://evil.example/"), "https://github.com/reactiveoxygenspecies/Diapo/releases")
        self.assertTrue(serve.link_url("guide").endswith("/GUIDE.md"))


if __name__ == "__main__":
    unittest.main()
