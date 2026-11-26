"""Unit tests for the fetch behind Insert > 3D structure (serve.lookup_structure): what it asks
each site for, that an ID it cannot be is refused before anything goes out, that AlphaFold's
answer cannot send it to another site, the size limit, and the messages when it goes wrong.
urlopen is stubbed: nothing goes out. Also: a structure file may go to assets/ (STRUCTURE_EXT).

    py -3 -m unittest tests.test_structure_lookup     (from deck-editor/)
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


def answering(pages, seen):
    """urlopen that answers each URL from `pages` (bytes or str), recording the requests."""
    def urlopen(req, timeout=None):
        seen.append(req)
        body = pages[req.full_url]
        return Answer(body if isinstance(body, bytes) else body.encode("utf-8"))
    return urlopen


class Structures(unittest.TestCase):
    def test_pdb_asks_rcsb_for_the_mmcif(self):
        seen = []
        url = "https://files.rcsb.org/download/1FDN.cif"
        with mock.patch.object(serve.urllib.request, "urlopen", answering({url: "data_1FDN\n_entry.id 1FDN\n"}, seen)):
            got = serve.lookup_structure("pdb", " 1fdn ")
        self.assertEqual([r.full_url for r in seen], [url])
        self.assertTrue(seen[0].get_header("User-agent").startswith("Diapo/"))
        self.assertEqual(got, {"text": "data_1FDN\n_entry.id 1FDN\n", "format": "cif", "name": "1FDN", "site": "rcsb.org", "url": url})

    def test_alphafold_follows_its_api_to_the_file_on_its_own_site_only(self):
        seen = []
        api = "https://alphafold.ebi.ac.uk/api/prediction/P00195"
        cif = "https://alphafold.ebi.ac.uk/files/AF-P00195-F1-model_v4.cif"
        pages = {api: json.dumps([{"entryId": "AF-P00195-F1", "cifUrl": cif}]), cif: "data_AF\n"}
        with mock.patch.object(serve.urllib.request, "urlopen", answering(pages, seen)):
            got = serve.lookup_structure("alphafold", "p00195")
        self.assertEqual([r.full_url for r in seen], [api, cif])
        self.assertEqual(got["name"], "AF-P00195-F1")
        self.assertEqual(got["format"], "cif")
        # An answer that names a file elsewhere is not followed.
        seen = []
        pages = {api: json.dumps([{"cifUrl": "https://example.org/x.cif"}])}
        with mock.patch.object(serve.urllib.request, "urlopen", answering(pages, seen)):
            with self.assertRaisesRegex(serve.LookupError_, "no structure file"):
                serve.lookup_structure("alphafold", "P00195")
        self.assertEqual(len(seen), 1)

    def test_pubchem_by_name_and_by_cid_asks_for_the_3d_record(self):
        seen = []
        by_name = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/caffeine%20citrate/SDF?record_type=3d"
        by_cid = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2519/SDF?record_type=3d"
        with mock.patch.object(serve.urllib.request, "urlopen", answering({by_name: "2519\n", by_cid: "2519\n"}, seen)):
            self.assertEqual(serve.lookup_structure("pubchem", "caffeine citrate")["format"], "sdf")
            serve.lookup_structure("pubchem", "2519")
        self.assertEqual([r.full_url for r in seen], [by_name, by_cid])

    def test_what_cannot_be_an_id_never_goes_out(self):
        with mock.patch.object(serve.urllib.request, "urlopen", side_effect=AssertionError("asked")):
            for source, bad in (("pdb", ""), ("pdb", "FDN1"), ("pdb", "1fdn/../x"), ("alphafold", "P0"), ("alphafold", "x/y"),
                                ("pubchem", ""), ("pubchem", "x" * 300), ("elsewhere", "1FDN")):
                with self.subTest(source=source, id=bad):
                    with self.assertRaises(serve.LookupError_):
                        serve.lookup_structure(source, bad)

    def test_unknown_offline_and_too_large(self):
        def gone(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)
        with mock.patch.object(serve.urllib.request, "urlopen", gone):
            with self.assertRaisesRegex(serve.LookupError_, "Protein Data Bank has no entry 9XYZ"):
                serve.lookup_structure("pdb", "9xyz")
            with self.assertRaisesRegex(serve.LookupError_, "PubChem has no 3D structure"):
                serve.lookup_structure("pubchem", "unobtainium")
        with mock.patch.object(serve.urllib.request, "urlopen", side_effect=urllib.error.URLError("down")):
            with self.assertRaisesRegex(serve.LookupError_, "couldn't reach rcsb.org.*From a file"):
                serve.lookup_structure("pdb", "1FDN")
        big = b"x" * (serve.STRUCTURE_MAX_BYTES + 1)
        with mock.patch.object(serve.urllib.request, "urlopen", answering({"https://files.rcsb.org/download/1FDN.cif": big}, [])):
            with self.assertRaisesRegex(serve.LookupError_, "larger than 50 MB"):
                serve.lookup_structure("pdb", "1FDN")

    def test_structure_files_may_be_kept_in_assets(self):
        self.assertEqual(serve.safe_upload_name("Ribosome 4V9D.CIF"), "Ribosome 4V9D.cif")
        self.assertEqual(serve.safe_upload_name("ligand.mol2"), "ligand.mol2")
        self.assertIsNone(serve.safe_upload_name("viewer.js"))
        self.assertIn("deck-mol3d.js", serve.DECK_FILES)


if __name__ == "__main__":
    unittest.main()
