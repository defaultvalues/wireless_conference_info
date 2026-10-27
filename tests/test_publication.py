import json
from pathlib import Path
import tempfile
import unittest
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from update_data import update
from test_refresh import comsoc, item

class PublicationTests(unittest.TestCase):
    def test_next_run_restores_updated_date_after_all_sources_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);seed=root/'seed.json';out=root/'data/latest.json';seed.write_text(json.dumps([item('secon-2027')]))
            first=update(seed,out,lambda _:comsoc('7 December 2026'))
            def fail(_):raise TimeoutError()
            second=update(seed,out,fail)
            self.assertEqual(second['conferences'][0]['deadline'],'2026-12-07')
            self.assertEqual(second['conferences'][0]['lastChecked'],first['conferences'][0]['lastChecked'])
            self.assertEqual(second['status'],'offline');self.assertEqual(second['schemaVersion'],1)
            self.assertEqual(json.loads(out.read_text()),second)
    def test_new_seed_entry_keeps_existing_cache_and_adds_conference(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);seed=root/'seed.json';out=root/'data/latest.json';seed.write_text(json.dumps([item('secon-2027')]))
            update(seed,out,lambda _:comsoc('7 December 2026'))
            seed.write_text(json.dumps([item('secon-2027'),item('isit-2027')]))
            def fail(_):raise TimeoutError()
            result=update(seed,out,fail)
            self.assertEqual(len(result['conferences']),2);self.assertEqual(result['conferences'][0]['deadline'],'2026-12-07')
    def test_snapshot_merge_preserves_source_provenance(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);seed=root/'seed.json';out=root/'data/latest.json';seed.write_text(json.dumps([item('icc-2027')]))
            first=update(seed,out,lambda _:'<h1>IEEE ICC 2027</h1><p>Paper Submission Deadline: 30 October 2026</p>')
            def fail(_):raise TimeoutError()
            second=update(seed,out,fail)
            self.assertEqual(second['conferences'][0]['source'],'https://icc2027.ieee-icc.org/')
            self.assertEqual(second['conferences'][0]['deadline'],'2026-10-30')
