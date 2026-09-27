"""Reviewer corrections: deterministic recompute, validation, audit trail, no model call."""
import socket
import unittest
from unittest.mock import patch

import documents
import storage
import test_server


def receipt_run():
    lines = {'p1:l1': 'Sub-total 75.00', 'p1:l2': 'GST 6% 70.75 4.25', 'p1:l3': 'Total 75.00'}

    def infer(prompt, payload):
        return {'invoice': {'reference': {'value': 'R-031', 'locations': ['p1:l3']}, 'supplier': {'value': 'Shop', 'locations': ['p1:l1']},
                            'net': {'value': 75.00, 'locations': ['p1:l1']}, 'vat': {'value': 4.25, 'locations': ['p1:l2']},
                            'total': {'value': 75.00, 'locations': ['p1:l3']}, 'vat_rate': {'value': 0.06, 'locations': ['p1:l2']},
                            'items': [{'sku': {'value': None, 'locations': []}, 'description': {'value': 'Item', 'locations': ['p1:l1']},
                                       'quantity': {'value': 1, 'locations': ['p1:l3']}, 'unit_price': {'value': 75, 'locations': ['p1:l3']},
                                       'line_total': {'value': 75, 'locations': ['p1:l3']}}]}}
    with patch.object(documents, 'read_source', lambda name, blob: {'filename': name, 'lines': dict(lines), 'ocr_pages': []}):
        out = documents.analyze({'invoice': ('r.txt', b'x')}, infer)
    return storage.save('documents', 'success', out)


class CorrectionTests(unittest.TestCase):
    setUp = test_server.ServerTests.setUp
    tearDown = test_server.ServerTests.tearDown
    req = test_server.ServerTests.req

    def post(self, run_id, body):
        return self.req('POST', f'/api/runs/{run_id}/corrections', body)

    def test_correcting_net_clears_false_alarms_without_network(self):
        run = receipt_run()
        before = {c['kind']: c['status'] for c in run['checks']}
        self.assertEqual(before['total_vs_net_plus_tax'], 'difference')
        self.assertEqual(before['tax_vs_rate'], 'difference')
        # Direct call with sockets blocked: the recompute never reaches the network.
        with patch.object(socket.socket, 'connect', side_effect=AssertionError('network call')):
            direct = storage.correct(run['id'], {'role': 'invoice', 'field': 'net', 'value': '70.75', 'note': 'GST summary shows 70.75'})
        self.assertEqual(direct['checks_recomputed_at'][:4], direct['corrections'][0]['at'][:4])
        status, body, _ = self.req('GET', f'/api/runs/{run["id"]}')
        self.assertEqual(status, 200, body)
        after = {c['kind']: c['status'] for c in body['checks']}
        self.assertEqual(after['total_vs_net_plus_tax'], 'passed')
        self.assertEqual(after['tax_vs_rate'], 'passed')
        self.assertFalse([f for f in body['findings'] if f['kind'] in ('total_vs_net_plus_tax', 'tax_vs_rate')])
        # audit: originals preserved
        self.assertEqual(body['original_fields']['invoice']['net']['value'], 75.0)
        self.assertEqual({c['kind']: c['status'] for c in body['original_checks']}, before)
        cell = body['fields']['invoice']['net']
        self.assertEqual((cell['value'], cell['model_value'], cell['provenance']), ('70.75', 75.0, 'corrected by reviewer'))
        self.assertTrue(cell['evidence'])
        corr = body['corrections'][0]
        self.assertEqual((corr['field'], corr['original'], corr['value'], corr['by'], corr['note']),
                         ('net', 75.0, '70.75', 'Local operator', 'GST summary shows 70.75'))
        # revert restores the model's value and checks
        status, back, _ = self.post(run['id'], {'role': 'invoice', 'field': 'net', 'revert': True})
        self.assertEqual(status, 200, back)
        self.assertEqual(back['fields']['invoice']['net']['value'], 75.0)
        self.assertEqual({c['kind']: c['status'] for c in back['checks']}, before)
        self.assertTrue(back['corrections'][0]['reverted_at'])

    def test_http_correction_and_aliases(self):
        run = receipt_run()
        status, body, _ = self.post(run['id'], {'role': 'invoice', 'field': 'net', 'value': 70.75})
        self.assertEqual(status, 200, body)
        self.assertEqual({c['kind']: c['status'] for c in body['checks']}['total_vs_net_plus_tax'], 'passed')
        status, body, _ = self.post(run['id'], {'role': 'invoice', 'field': 'tax', 'value': 4.5})
        self.assertEqual(status, 200, body)
        self.assertEqual(body['corrections'][-1]['field'], 'vat')
        status, body, _ = self.post(run['id'], {'role': 'invoice', 'field': 'items[0].quantity', 'value': '2'})
        self.assertEqual(status, 200, body)
        self.assertEqual(body['fields']['invoice']['items'][0]['quantity']['value'], '2')
        status, body, _ = self.post(run['id'], {'role': 'invoice', 'field': 'invoice_reference', 'value': 'R-032'})
        self.assertEqual((status, body['invoice_reference']), (200, 'R-032'))
        # second correction on the same field supersedes the first
        status, body, _ = self.post(run['id'], {'role': 'invoice', 'field': 'net', 'value': '70.00'})
        active = [c for c in body['corrections'] if c['field'] == 'net' and not c.get('reverted_at')]
        self.assertEqual([c['value'] for c in active], ['70.00'])
        self.assertEqual(body['fields']['invoice']['net']['model_value'], 75.0)

    def test_invalid_input(self):
        run = receipt_run()
        bad = [{'role': 'invoice', 'field': 'bogus', 'value': '1'},
               {'role': 'invoice', 'field': 'items[5].quantity', 'value': '1'},
               {'role': 'invoice', 'field': 'items', 'value': '1'},
               {'role': 'purchase_order', 'field': 'net', 'value': '1'},
               {'role': 'nope', 'field': 'net', 'value': '1'},
               {'role': 'invoice', 'field': 'net', 'value': 'abc'},
               {'role': 'invoice', 'field': 'net', 'value': 'NaN'},
               {'role': 'invoice', 'field': 'net', 'value': 'Infinity'},
               {'role': 'invoice', 'field': 'net', 'value': True},
               {'role': 'invoice', 'field': 'net', 'value': [1]},
               {'role': 'invoice', 'field': 'net', 'value': '1', 'note': 'x' * 301},
               {'role': 'invoice', 'field': 'net', 'revert': True}]
        for body in bad:
            self.assertEqual(self.post(run['id'], body)[0], 400, body)
        self.assertEqual(self.post('0' * 32, {'role': 'invoice', 'field': 'net', 'value': '1'})[0], 404)
        self.assertEqual(self.req('POST', f'/api/runs/{run["id"]}/corrections', {'role': 'invoice', 'field': 'net', 'value': '1'},
                                  headers={'Origin': 'http://evil.example'})[0], 403)
        self.assertEqual(self.req('POST', f'/api/runs/{run["id"]}/corrections', {'role': 'invoice', 'field': 'net', 'value': '1'},
                                  host='evil.example')[0], 400)
        self.assertIsNone(storage.get_run(run['id']).get('corrections'))


if __name__ == '__main__':
    unittest.main()
