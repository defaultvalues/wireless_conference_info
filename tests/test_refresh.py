import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from collector import ConferenceStore, parse_page, PageText, parse_event_dates

DATA=json.loads((Path(__file__).resolve().parents[1]/'dist/conferences.json').read_text())
def item(id):return next(dict(c) for c in DATA if c['id']==id)
def page(body):return '<html><head><title>Conference 2027</title></head><body>'+body+'</body></html>'
def comsoc(deadline='30 November 2026',dates='5 - 7 May 2027',location='Lisbon, Portugal'):
    return page(f'<div>Date</div><div>{dates}</div><div>Location</div><div>{location}</div><div>Call for Technical Papers Deadline</div><div>{deadline}</div><div>Location Type</div><div>In Person</div>')

class ParsingTests(unittest.TestCase):
    def test_official_directory_dates_and_location(self):
        result=parse_page(comsoc(),item('secon-2027'))
        self.assertEqual(result['deadline'],'2026-11-30');self.assertEqual(result['start'],'2027-05-05');self.assertEqual(result['location'],'Lisbon, Portugal');self.assertIsNone(result['deadlineAt'])
    def test_extension_struck_out_date_not_selected(self):
        result=parse_page(page('<p>Paper submission deadline: <del>January 10, 2027</del> January 17, 2027 (23:59 AoE)</p>'),item('isit-2027'))
        self.assertEqual(result['deadline'],'2027-01-17');self.assertEqual(result['deadlineAt'],'2027-01-17T23:59:00-12:00')
    def test_final_and_abstract_dates_are_not_paper_dates(self):
        result=parse_page(page('<p>Abstract Submission Deadline: January 3, 2027</p><p>Paper submission deadline: January 10, 2027 (23:59 AoE)</p><p>Final Paper Submission: April 17, 2027</p><p>Camera-ready Paper Submission: April 17, 2027</p>'),item('isit-2027'))
        self.assertEqual(result['deadline'],'2027-01-10')
    def test_camera_ready_only_is_failure(self):
        with self.assertRaises(ValueError):parse_page(page('<p>Final Paper Submission: April 17, 2027</p>'),item('isit-2027'))
    def test_conflicting_dates_are_not_guessed(self):
        with self.assertRaises(ValueError):parse_page(page('<p>Paper Submission: January 10, 2027</p><p>Paper Submission: January 17, 2027</p>'),item('isit-2027'))
    def test_changed_date_does_not_inherit_old_timezone(self):
        result=parse_page(page('<p>Paper submission deadline: January 17, 2027</p>'),item('isit-2027'))
        self.assertIsNone(result['deadlineAt']);self.assertIsNone(result['timezone'])
    def test_scripts_hidden_and_struck_content_ignored(self):
        result=parse_page(page('<script>Paper Submission: January 1, 2027</script><div hidden>Paper Submission: January 2, 2027</div><p>Paper Submission: January 10, 2027</p>'),item('isit-2027'))
        self.assertEqual(result['deadline'],'2027-01-10')
    def test_wrong_year_and_challenge_rejected(self):
        with self.assertRaises(ValueError):parse_page(comsoc(dates='5 - 7 May 2026'),item('secon-2027'))
        with self.assertRaises(ValueError):parse_page(page('<p>Verify you are human</p>'),item('secon-2027'))
    def test_cross_month_event_dates(self):
        self.assertEqual(parse_event_dates('30 May - 3 June 2027'),('2027-05-30','2027-06-03'))
    def test_full_paper_label_with_ordinal(self):
        result=parse_page(page('<p>Full Paper Submission: 6th November 2026</p>'),item('ccwc-2027'))
        self.assertEqual(result['deadline'],'2026-11-06')

class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.cache=Path(self.tmp.name)/'conferences.json'
    def tearDown(self):self.tmp.cleanup()
    def test_every_call_fetches_again_and_updates_date(self):
        store=ConferenceStore([item('secon-2027')],self.cache)
        calls=[]
        def fetch(url):calls.append(url);return comsoc('30 November 2026' if len(calls)==1 else '7 December 2026')
        self.assertEqual(store.refresh(fetch)['conferences'][0]['deadline'],'2026-11-30')
        self.assertEqual(store.refresh(fetch)['conferences'][0]['deadline'],'2026-12-07');self.assertEqual(len(calls),2)
    def test_network_failure_preserves_last_success_and_timestamp(self):
        store=ConferenceStore([item('secon-2027')],self.cache);first=store.refresh(lambda url:comsoc('7 December 2026'))
        def fail(url):raise TimeoutError('offline')
        store=ConferenceStore([item('secon-2027')],self.cache);second=store.refresh(fail)
        self.assertEqual(second['status'],'offline');self.assertEqual(second['freshCount'],0)
        self.assertEqual(second['conferences'][0]['deadline'],'2026-12-07')
        self.assertEqual(second['conferences'][0]['lastChecked'],first['conferences'][0]['lastChecked']);self.assertEqual(second['conferences'][0]['syncStatus'],'stale')
    def test_partial_refresh_keeps_failed_entry(self):
        store=ConferenceStore([item('secon-2027'),item('isit-2027')],self.cache)
        def fetch(url):
            if 'comsoc' in url:return comsoc()
            raise TimeoutError()
        result=store.refresh(fetch);self.assertEqual(result['status'],'partial');self.assertEqual(result['freshCount'],1);self.assertEqual(result['conferences'][1]['deadline'],'2027-01-10')
    def test_malformed_page_is_not_marked_fresh(self):
        result=ConferenceStore([item('isit-2027')],self.cache).refresh(lambda url:page('<p>No CFP yet</p>'))
        self.assertEqual(result['status'],'offline');self.assertNotIn('lastChecked',result['conferences'][0])
    def test_concurrent_tabs_share_inflight_refresh(self):
        import threading
        from concurrent.futures import ThreadPoolExecutor
        store=ConferenceStore([item('secon-2027')],self.cache);entered=threading.Event();release=threading.Event();calls=[]
        def fetch(url):calls.append(url);entered.set();release.wait(2);return comsoc()
        with ThreadPoolExecutor(max_workers=2) as pool:
            a=pool.submit(store.refresh,fetch);entered.wait(1);b=pool.submit(store.refresh,fetch)
            # Ensure the second caller has observed the in-flight request.
            import time;time.sleep(.05);release.set();self.assertEqual(a.result(),b.result())
        self.assertEqual(len(calls),1)

if __name__=='__main__':unittest.main()
