"""The files a drop on the canvas sends to /api/upload (MEDIA_EXT in app/core/filedrop.js) are
the ones the server keeps (UPLOAD_EXT in serve.py): a list that drifted would either refuse a
picture the server takes or send one it refuses."""
import os
import re
import unittest

from tests import serve_for_tests  # noqa: F401  (imports serve.py on a throw-away workspace)
import serve

HERE = os.path.dirname(os.path.abspath(__file__))


class UploadExtensions(unittest.TestCase):
    def test_drop_matches_server(self):
        with open(os.path.join(HERE, "..", "app", "core", "filedrop.js"), encoding="utf-8") as f:
            src = f.read()
        m = re.search(r"export const MEDIA_EXT = \[([^\]]*)\]", src)
        self.assertIsNotNone(m, "MEDIA_EXT not found in filedrop.js")
        client = {"." + e for e in re.findall(r"'([a-z0-9]+)'", m.group(1))}
        self.assertEqual(client, set(serve.UPLOAD_EXT))


if __name__ == "__main__":
    unittest.main()
