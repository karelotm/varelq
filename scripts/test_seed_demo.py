"""Tests for scripts/seed_demo.py: placeholder summary, multipart encoding, and a keyless end-to-end seed."""
import email.parser
import email.policy
import io
import json
import os
import tempfile
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from scripts import seed_demo


def fake_report(rid, retries=None, source='model'):
    return {'id': rid, 'status': 'success', 'timings_ms': {'total': 100},
            'usage': {'retries_by_status': retries or {}},
            'groups': [{'group_id': 'R1', 'runs_affected': 12, 'occurrences': 22, 'priority_formula': 'Critical 3 × 12 runs = 36',
                        'explanation_source': source}],
            'evaluation': {'runs_flagged': 14, 'divergent_runs': 24, 'divergent_step_hits': 10, 'flagged_not_divergent': 2},
            'replay': {'writes_total': 58, 'writes_blocked': 22, 'divergent_runs_intercepted': 9, 'reference_writes_blocked': 9}}


class SummarizeTests(unittest.TestCase):
    def test_placeholders_come_from_reports_and_batches(self):
        rel = [{'ok': True, 'wall_ms': 900, 'report': fake_report('a', {'503': 1})},
               {'ok': False, 'wall_ms': 50, 'report': None},
               {'ok': True, 'wall_ms': 1100, 'report': fake_report('b', {'503': 2, '429': 1}, 'template')}]
        lab = [{'scenario_id': 'S1', 'variant': 'baseline', 'batch_id': 'b1', 'summary': {'unsafe': 3}},
               {'scenario_id': 'S1', 'variant': 'guarded', 'batch_id': 'b2', 'summary': {'unsafe': 0}},
               {'scenario_id': 'S0', 'variant': 'baseline', 'batch_id': 'b3', 'summary': {'legit_approvals': 4}},
               {'scenario_id': 'S0', 'variant': 'guarded', 'batch_id': 'b4', 'summary': {'legit_approvals': 4, 'false_blocks': 0}}]
        docs = [{'sample_id': 'three-way-short-delivery', 'ok': True, 'run_id': 'd1',
                 'ocr': [{'latency_ms': 412, 'endpoint_kind': 'self-hosted', 'fallback_used': False}]}]
        p = seed_demo.summarize(docs, rel, lab)
        self.assertEqual(p['report_id'], 'b')
        self.assertEqual((p['R1 runs'], p['n'], p['m'], p['fp']), (12, 14, 10, 2))
        self.assertEqual((p['b'], p['w'], p['k'], p['j']), (22, 58, 9, 9))
        self.assertEqual(p['analysis_success'], '2/3')
        self.assertEqual(p['analysis_ids'], ['a', None, 'b'])
        self.assertEqual(p['retries_by_status_total'], {'503': 3, '429': 1})
        self.assertTrue(p['rule_groups_identical'])
        self.assertEqual(p['explanation_sources'], ['model', 'template'])
        self.assertEqual((p['x'], p['y'], p['a'], p["a'"], p['f']), (3, 0, 4, 4, 0))
        self.assertIsNone(p['x3'])  # S3 not run: stays empty, never guessed
        self.assertEqual((p['ms'], p['three_way_run_id']), (412, 'd1'))

    def test_empty_inputs_give_nones(self):
        p = seed_demo.summarize([], [], [])
        self.assertIsNone(p['R1 runs'])
        self.assertIsNone(p['rule_groups_identical'])
        self.assertEqual(p['analysis_success'], '0/0')


class MultipartTests(unittest.TestCase):
    def test_round_trips_through_email_parser_like_server(self):
        body, ctype = seed_demo.encode_multipart({'sample_id': 'three-way-short-delivery'},
                                                 {'invoice': ('invoice-0142.png', b'\x89PNG\x00\xff', 'image/png')})
        msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
            b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + body)
        parts = {p.get_param('name', header='content-disposition'): p for p in msg.iter_parts()}
        self.assertEqual(parts['sample_id'].get_payload(decode=True), b'three-way-short-delivery')
        self.assertEqual(parts['invoice'].get_filename(), 'invoice-0142.png')
        self.assertEqual(parts['invoice'].get_payload(decode=True), b'\x89PNG\x00\xff')

    def test_batch_id_matches_contract(self):
        import re
        self.assertRegex(seed_demo.new_batch_id('S1', 'guarded'), r'^[a-z0-9-]{4,40}$')


class EndToEndKeyless(unittest.TestCase):
    """Runs the seed against the in-process server with no key: deterministic analysis only, no network."""

    def test_reliability_seed_without_model(self):
        try:
            import server
            import storage
        except Exception as exc:  # another stream mid-edit
            self.skipTest(f'server import failed: {exc!r}')
        if getattr(server, 'reliability', None) is None:
            self.skipTest('reliability module unavailable')
        temp = tempfile.TemporaryDirectory()
        env = {k: v for k, v in os.environ.items() if k != 'NVIDIA_API_KEY'}
        env.update({'VARELQ_STUBS': '0', 'VARELQ_QUIET': '1'})
        patches = [patch.object(storage, 'DB', Path(temp.name) / 'seed.db'), patch.dict(os.environ, env, clear=True)]
        for p in patches:
            p.start()
        http = server.Server(('127.0.0.1', 0), server.Handler)
        worker = threading.Thread(target=http.serve_forever, daemon=True)
        worker.start()
        try:
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                code = seed_demo.main(['--base', f'http://127.0.0.1:{http.server_port}', '--skip-documents',
                                       '--skip-lab', '--no-explain', '--analysis-runs', '2'])
            self.assertEqual(code, 0, err.getvalue())
            result = json.loads(out.getvalue())
            p = result['placeholders']
            self.assertEqual(p['analysis_success'], '2/2', err.getvalue())
            self.assertTrue(p['rule_groups_identical'])
            self.assertIsInstance(p['R1 runs'], int)
            self.assertEqual(p['explanation_sources'], ['template'])
            self.assertTrue(all(p['analysis_ids']))
        finally:
            http.shutdown()
            http.server_close()
            worker.join()
            for p in reversed(patches):
                p.stop()
            temp.cleanup()


if __name__ == '__main__':
    unittest.main()
