"""Tests for chat.py (Ask VARELQ): digest building, citation validation, bad input, HTTP route. No network."""
import http.client
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import chat
import nim
import server
import storage

RUN_A = {'id': 'aaaa1111bbbb2222cccc3333dddd4444', 'kind': 'documents', 'status': 'success', 'created': '2026-09-27T10:00:00Z',
         'supplier': 'Atlas Supply', 'invoice_reference': 'INV-1', 'invoice_total': '100.50', 'currency': 'EUR',
         'decision': 'pending', 'limitations': [],
         'findings': [{'kind': 'qty_received_vs_ordered', 'title': 'SKU-1: received versus ordered', 'observed': '8',
                       'expected': '10', 'delta': '-2', 'unit': 'units', 'severity': 'high'}]}
RUN_B = dict(RUN_A, id='eeee5555ffff6666', invoice_reference='INV-2', invoice_total='49.50', decision='reviewed', findings=[])
RUN_C = dict(RUN_A, id='9999000011112222', supplier='Other Co', invoice_reference='INV-3', invoice_total='7', findings=[])
REPORT = {'id': 'rep1', 'kind': 'reliability', 'status': 'success', 'schema': 2, 'source_label': 'Traces', 'run_count': 9,
          'priority': {'formula': 'severity weight x runs affected'},
          'groups': [{'group_id': 'R2', 'title': 'Auth', 'severity': 'High', 'runs_affected': 2, 'occurrences': 4, 'priority_score': 4},
                     {'group_id': 'R1', 'title': 'Confirm', 'severity': 'Critical', 'runs_affected': 12, 'occurrences': 22, 'priority_score': 36}]}
BATCH = {'batch_id': 'b-s4-guard', 'scenario_id': 'S4', 'variant': 'guarded', 'guards': ['payment_precondition'],
         'provenance': 'Recorded live runs (nvidia/model-x, NVIDIA hosted API)',
         'summary': {'runs': 5, 'unsafe': 0, 'blocked_calls': 4, 'escalations': 4, 'errors': 0}}
ERROR_RUN = {'id': 'err0err0', 'kind': 'documents', 'status': 'error', 'error': 'boom'}


def digest():
    return chat.build_digest(runs=[RUN_A, RUN_B, RUN_C, REPORT, ERROR_RUN], batches=[BATCH], scenario_titles={'S4': 'Payment pressure'})


class DigestTests(unittest.TestCase):
    def test_contains_all_record_kinds_with_ids(self):
        text, reg = digest()
        kinds = {v['kind'] for v in reg.values()}
        self.assertEqual(kinds, {'supplier', 'document_run', 'finding', 'reliability_report', 'lab_batch'})
        self.assertIn('[aaaa1111]', text)
        self.assertIn('[aaaa1111-F1]', text)
        self.assertIn('[R1]', text)
        self.assertIn('[b-s4-guard]', text)
        self.assertIn('Payment pressure', text)
        self.assertNotIn('err0err0', text)
        self.assertEqual(reg['aaaa1111']['href'], '#cases/aaaa1111bbbb2222cccc3333dddd4444')
        self.assertEqual(reg['aaaa1111-F1']['href'], '#cases/aaaa1111bbbb2222cccc3333dddd4444')
        self.assertEqual(reg['R1']['href'], '#reliability')
        self.assertEqual(reg['b-s4-guard']['href'], '#lab')

    def test_supplier_totals_computed_in_code(self):
        text, reg = digest()
        # Atlas: 100.50 + 49.50 = 150.00 EUR, 2 invoices, 1 discrepancy, 1 pending; ranked first
        self.assertIn('[SUP1] Atlas Supply | invoices 2 | invoiced total 150.00 EUR | discrepancies 1 | pending review 1', text)
        self.assertEqual(reg['SUP2']['label'], 'Other Co')

    def test_reliability_sorted_by_priority(self):
        text, _ = digest()
        self.assertLess(text.index('[R1]'), text.index('[R2]'))

    def test_digest_is_bounded(self):
        many = [dict(RUN_A, id=f'{i:032x}', supplier=f'Supplier {i}', findings=RUN_A['findings'] * 12) for i in range(200)]
        text, reg = chat.build_digest(runs=many, batches=[BATCH] * 1, scenario_titles={})
        self.assertLessEqual(len(text), chat.MAX_DIGEST + 40)
        for key in reg:
            self.assertIn(f'[{key}]', text)

    def test_empty_storage(self):
        text, reg = chat.build_digest(runs=[], batches=[], scenario_titles={})
        self.assertEqual(reg, {})
        self.assertIn('none saved', text)

    def test_short_id_collision(self):
        a = dict(RUN_A, id='12345678aaaa')
        b = dict(RUN_A, id='12345678bbbb')
        _, reg = chat.build_digest(runs=[a, b], batches=[], scenario_titles={})
        self.assertIn('12345678', reg)
        self.assertIn('12345678bbbb', reg)


class CitationTests(unittest.TestCase):
    def setUp(self):
        _, self.reg = digest()

    def test_known_kept_unknown_stripped(self):
        text, cites, dropped = chat.validate_citations('Atlas has 1 discrepancy [aaaa1111-F1] and [ZZ9] risk [R1].', ['R1', 'NOPE'], self.reg)
        self.assertEqual(text, 'Atlas has 1 discrepancy [aaaa1111-F1] and risk [R1].')
        self.assertEqual([c['id'] for c in cites], ['aaaa1111-F1', 'R1'])
        self.assertEqual(dropped, ['ZZ9', 'NOPE'])
        self.assertEqual(cites[0]['kind'], 'finding')

    def test_grouped_citations(self):
        text, cites, dropped = chat.validate_citations('See [R1, R9; b-s4-guard].', [], self.reg)
        self.assertEqual(text, 'See [R1][b-s4-guard].')
        self.assertEqual(dropped, ['R9'])
        self.assertEqual(len(cites), 2)

    def test_prose_brackets_untouched(self):
        text, cites, dropped = chat.validate_citations('A note [see the report] here.', None, self.reg)
        self.assertEqual(text, 'A note [see the report] here.')
        self.assertEqual((cites, dropped), ([], []))


class RequestTests(unittest.TestCase):
    def test_bad_inputs(self):
        for bad in [None, [], {}, {'question': ''}, {'question': '   '}, {'question': 5}, {'question': 'x' * 1001},
                    {'question': 'q', 'history': 'no'}, {'question': 'q', 'history': [{'role': 'system', 'content': 'x'}]},
                    {'question': 'q', 'history': [{'role': 'user', 'content': 'x'}] * 7},
                    {'question': 'q', 'history': [{'role': 'user', 'content': 3}]}]:
            with self.assertRaises(ValueError, msg=repr(bad)[:80]):
                chat.validate_request(bad)

    def test_good_input_truncates_history(self):
        q, h = chat.validate_request({'question': ' hi ', 'history': [{'role': 'assistant', 'content': 'y' * 5000}]})
        self.assertEqual(q, 'hi')
        self.assertEqual(len(h[0]['content']), chat.MAX_HISTORY_CONTENT)

    def test_answer_with_fake_llm(self):
        seen = {}

        def llm(messages):
            seen['messages'] = messages
            return ({'answer': 'Most urgent is [R1]; also [FAKE-1].', 'cited_ids': ['R1']},
                    {'model': 'm-fallback', 'fallback_used': True, 'ms': 1234})
        with patch.object(chat, 'build_digest', lambda d=digest(): d):
            out = chat.answer({'question': 'What is most urgent?', 'history': [{'role': 'user', 'content': 'hi'}]}, llm=llm)
        self.assertEqual(out['answer'], 'Most urgent is [R1]; also.')
        self.assertEqual(out['dropped_citations'], ['FAKE-1'])
        self.assertEqual(out['citations'][0], {'id': 'R1', 'kind': 'reliability_report', 'label': 'Confirm', 'href': '#reliability'})
        self.assertTrue(out['fallback_used'])
        self.assertEqual(out['latency_ms'], 1234)
        self.assertEqual(out['model'], 'm-fallback')
        self.assertEqual(seen['messages'][0]['role'], 'system')
        self.assertIn('DIGEST', seen['messages'][0]['content'])
        self.assertEqual(seen['messages'][-1], {'role': 'user', 'content': 'What is most urgent?'})
        self.assertEqual(len(seen['messages']), 3)

    def test_empty_model_answer_is_error(self):
        with patch.object(chat, 'build_digest', lambda d=digest(): d):
            with self.assertRaises(nim.NimError):
                chat.answer({'question': 'q'}, llm=lambda m: ({'answer': ''}, {}))


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [patch.object(storage, 'DB', Path(self.temp.name) / 'test.db'),
                        patch.dict(os.environ, {'VARELQ_QUIET': '1', 'NVIDIA_API_KEY': ''})]
        for p in self.patches:
            p.start()
        self.http = server.Server(('127.0.0.1', 0), server.Handler)
        self.worker = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.worker.join()
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def post(self, body):
        port = self.http.server_port
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
        data = json.dumps(body).encode()
        conn.request('POST', '/api/chat', body=data, headers={'Host': f'127.0.0.1:{port}', 'Content-Type': 'application/json'})
        res = conn.getresponse()
        out = res.status, json.loads(res.read() or b'{}')
        conn.close()
        return out

    def test_bad_input_400(self):
        status, body = self.post({'question': ''})
        self.assertEqual(status, 400)
        self.assertIn('error', body)

    def test_no_key_503(self):
        status, body = self.post({'question': 'Which supplier has the most discrepancies?'})
        self.assertEqual(status, 503)
        self.assertIn('error', body)


if __name__ == '__main__':
    unittest.main()
