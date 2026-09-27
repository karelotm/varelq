"""HTTP-level tests for server.py: hardening, routing, module isolation. No network, no key."""
import http.client
import json
import os
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import server
import storage


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patches = [patch.object(storage, 'DB', Path(self.temp.name) / 'test.db'),
                        patch.dict(os.environ, {'VARELQ_STUBS': '0', 'VARELQ_QUIET': '1'})]
        for p in self.patches:
            p.start()
        self.http = server.Server(('127.0.0.1', 0), server.Handler)
        self.port = self.http.server_port
        self.worker = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.worker.join()
        for p in reversed(self.patches):
            p.stop()
        self.temp.cleanup()

    def req(self, method, path, body=None, headers=None, host=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        conn.putrequest(method, path, skip_host=True)
        conn.putheader('Host', host or f'127.0.0.1:{self.port}')
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        hdrs = dict(headers or {})
        if data is not None:
            hdrs.setdefault('Content-Type', 'application/json')
            hdrs['Content-Length'] = str(len(data))
        for k, v in hdrs.items():
            conn.putheader(k, v)
        conn.endheaders(data)
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        ctype = resp.getheader('Content-Type') or ''
        return resp.status, (json.loads(raw) if ctype.startswith('application/json') else raw), resp

    def test_usage_endpoint_shape(self):
        with patch.dict(os.environ, {'NVIDIA_OCR_URL': ''}):
            status, body, _ = self.req('GET', '/api/usage')
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {'nvidia', 'ocr', 'gpu'})
        for key in ('rpm_limit', 'last_60s', 'models', 'fallback_model', 'limiter', 'totals'):
            self.assertIn(key, body['nvidia'])
        self.assertIsInstance(body['nvidia']['models'], dict)
        for key in ('calls', 'self_hosted', 'hosted', 'fallback_used', 'failures', 'latency_ms', 'recent'):
            self.assertIn(key, body['ocr'])
        self.assertFalse(body['gpu']['available'])
        self.assertIn('reason', body['gpu'])
        self.assertEqual(self.req('GET', '/api/usage', host=f'evil.example:{self.port}')[0], 400)

    def test_nim_json_is_deterministic(self):
        seen = {}
        def fake(messages, **kw):
            seen.update(kw)
            return {'ok': 1}, {'model': server.MODEL}
        with patch.object(server.nim, 'chat_json', fake):
            server.nim_json('s', 'u')
        self.assertEqual(seen['temperature'], 0)
        self.assertEqual(seen['seed'], server.NIM_JSON_SEED)

    def test_model_provenance_names_actual_model(self):
        server.begin_model_calls()
        meta = {'model': 'nvidia/nemotron-3.5-lightning-30b-a3b', 'requested_model': server.MODEL,
                'fallback_used': True, 'fallback_reason': 'x exhausted retries (HTTP 429)'}
        with patch.object(server.nim, 'chat_json', lambda *a, **k: ({'ok': 1}, meta)):
            server.nim_json('s', 'u')
        prov = server.model_provenance()
        self.assertEqual(prov['model'], 'nvidia/nemotron-3.5-lightning-30b-a3b')
        self.assertEqual(prov['requested_model'], server.MODEL)
        self.assertTrue(prov['fallback_used'])
        server.begin_model_calls()
        self.assertEqual(server.model_provenance(), {'model': server.MODEL, 'requested_model': server.MODEL,
                                                     'fallback_used': False, 'fallback_reason': None})

    def test_bad_host_rejected_on_get_and_post(self):
        self.assertEqual(self.req('GET', '/api/health', host=f'evil.example:{self.port}')[0], 400)
        self.assertEqual(self.req('POST', '/api/decision', {'id': 'x'}, host=f'evil.example:{self.port}')[0], 400)
        self.assertEqual(self.req('GET', '/', host=f'evil.example:{self.port}')[0], 400)
        self.assertEqual(self.req('GET', '/api/health', host=f'localhost:{self.port}')[0], 200)

    def test_extra_allowed_host(self):
        with patch.dict(os.environ, {'VARELQ_ALLOWED_HOSTS': 'demo.example'}):
            self.assertEqual(self.req('GET', '/api/health', host='demo.example')[0], 200)

    def test_bad_origin_on_post(self):
        status, body, _ = self.req('POST', '/api/decision', {'id': 'x', 'decision': 'reviewed'}, headers={'Origin': 'http://evil.example'})
        self.assertEqual(status, 403)

    def test_static_hardening(self):
        self.assertEqual(self.req('GET', '/assets/')[0], 404)
        self.assertEqual(self.req('GET', '/assets')[0], 404)
        self.assertEqual(self.req('GET', '/%2e%2e/server.py')[0], 404)
        self.assertEqual(self.req('GET', '/../server.py')[0], 404)
        status, _, resp = self.req('GET', '/')
        self.assertEqual(status, 200)
        self.assertTrue(resp.getheader('Content-Type').startswith('text/html'))
        self.assertEqual(resp.getheader('Cache-Control'), 'no-cache')
        js = next((server.DIST / 'assets').glob('*.js'), None)
        if js:
            status, _, resp = self.req('GET', '/assets/' + js.name)
            self.assertEqual(status, 200)
            self.assertTrue(resp.getheader('Content-Type').startswith('text/javascript'))

    def test_invalid_decision_body_saves_nothing(self):
        status, body, _ = self.req('POST', '/api/decision', b'[]')
        self.assertEqual(status, 400)
        self.assertIn('error', body)
        self.assertEqual(storage.list_runs(), [])
        self.assertEqual(self.req('POST', '/api/decision', b'not json')[0], 400)
        self.assertEqual(storage.list_runs(), [])

    def test_unknown_api_404_and_query_ignored(self):
        self.assertEqual(self.req('GET', '/api/nope')[0], 404)
        self.assertEqual(self.req('POST', '/api/nope', {})[0], 404)
        self.assertEqual(self.req('GET', '/api/health?x=1')[0], 200)

    def test_health_modules(self):
        status, body, _ = self.req('GET', '/api/health')
        self.assertEqual(status, 200)
        self.assertEqual(body['version'], 'v4')
        for name in ('reliability', 'agent_lab', 'samples', 'gpu'):
            self.assertIn(name, body['modules'])
        self.assertIn('embed_model', body)

    def test_runs_by_id(self):
        run = storage.save('documents', 'success', {'x': 1})
        status, body, _ = self.req('GET', '/api/runs/' + run['id'])
        self.assertEqual((status, body['x']), (200, 1))
        self.assertEqual(self.req('GET', '/api/runs/missing')[0], 404)

    def test_broken_module_is_isolated(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'varelq_broken_mod.py').write_text('def oops(:\n', encoding='utf-8')
            sys.path.insert(0, d)
            try:
                self.assertIsNone(server._optional('varelq_broken_mod'))
                self.assertIn('varelq_broken_mod', server._import_errors)
            finally:
                sys.path.remove(d)
        with patch.object(server, 'reliability', None), patch.object(server, 'agent_lab', None), \
                patch.object(server, 'samples', None), patch.object(server, 'gpu', None):
            for path in ('/api/reliability/datasets', '/api/reliability/traces/x', '/api/lab/scenarios',
                         '/api/lab/batches', '/api/lab/batches/b-12', '/api/lab/traces/t-1', '/api/samples',
                         '/api/samples/a/invoice', '/api/gpu/status'):
                status, body, _ = self.req('GET', path)
                self.assertEqual(status, 503, path)
                self.assertTrue(body['error'].endswith('unavailable'), path)
            self.assertEqual(self.req('POST', '/api/reliability/analyze', {'dataset': 'agentrx-tau-retail'})[0], 503)
            self.assertEqual(self.req('POST', '/api/lab/run', {'scenario_id': 'S1', 'guards': [], 'batch_id': 'b-1234', 'index': 0})[0], 503)
            self.assertFalse(self.req('GET', '/api/health')[1]['modules']['reliability'])
            self.assertEqual(self.req('GET', '/api/reliability/latest')[0], 404)

    def test_stubs_when_enabled(self):
        with patch.dict(os.environ, {'VARELQ_STUBS': '1'}), patch.object(server, 'reliability', None), patch.object(server, 'agent_lab', None):
            status, body, _ = self.req('GET', '/api/reliability/datasets')
            self.assertEqual(status, 200)
            self.assertTrue(body['stub'])
            status, body, _ = self.req('POST', '/api/lab/run', {'scenario_id': 'S1', 'guards': ['payment_precondition'], 'batch_id': 'b-1234', 'index': 3})
            self.assertEqual((status, body['stub'], body['run']['index'], body['variant']), (200, True, 3, 'guarded'))
            self.assertEqual(self.req('GET', '/api/lab/batches/b-1234')[1]['summary']['runs'], 5)

    def test_reliability_analyze_saves_schema2_and_latest(self):
        fake = types.SimpleNamespace(
            datasets=lambda: [{'id': 'agentrx-tau-retail', 'available': True}, {'id': 'agent-lab', 'available': False}],
            analyze=lambda dataset, explain: {'kind': 'reliability', 'dataset': dataset, 'groups': [], 'explain': explain},
            get_trace=lambda t: {'trace_id': t, 'steps': []} if t == 'agentrx-tau-1' else None)
        with patch.object(server, 'reliability', fake):
            self.assertEqual(self.req('POST', '/api/reliability/analyze', {'dataset': 'nope'})[0], 404)
            self.assertEqual(self.req('POST', '/api/reliability/analyze', {'dataset': 'agent-lab'})[0], 400)
            self.assertEqual(self.req('POST', '/api/reliability/analyze', {'explain': 'yes'})[0], 400)
            self.assertEqual(self.req('POST', '/api/reliability/analyze', [])[0], 400)
            status, run, _ = self.req('POST', '/api/reliability/analyze', {'dataset': 'agentrx-tau-retail', 'explain': False})
            self.assertEqual((status, run['schema'], run['kind'], run['status']), (200, 2, 'reliability', 'success'))
            status, latest, _ = self.req('GET', '/api/reliability/latest?dataset=agentrx-tau-retail')
            self.assertEqual((status, latest['id']), (200, run['id']))
            self.assertEqual(self.req('GET', '/api/reliability/latest?dataset=other')[0], 404)
            self.assertEqual(self.req('GET', '/api/reliability/traces/agentrx-tau-1')[0], 200)
            self.assertEqual(self.req('GET', '/api/reliability/traces/agentrx-tau-9')[0], 404)
        # legacy (schema-less) reliability runs never count as latest
        storage.save('reliability', 'success', {'dataset': 'x'})
        self.assertEqual(self.req('GET', '/api/reliability/latest?dataset=x')[0], 404)

    def test_lab_run_validation_and_dispatch(self):
        calls = []
        fake = types.SimpleNamespace(run_one=lambda s, g, b, i: calls.append((s, g, b, i)) or {'batch_id': b, 'run': {'index': i}})
        with patch.object(server, 'agent_lab', fake), patch.dict(os.environ, {'NVIDIA_API_KEY': 'test-not-a-key'}):
            for bad in ({'guards': []}, {'scenario_id': 'S1', 'batch_id': 'BAD ID'}, {'scenario_id': 'S1', 'index': -1},
                        {'scenario_id': 'S1', 'guards': 'payment_precondition'}, {'scenario_id': 'S1', 'index': True}):
                self.assertEqual(self.req('POST', '/api/lab/run', bad)[0], 400, bad)
            status, body, _ = self.req('POST', '/api/lab/run', {'scenario_id': 'S1', 'guards': ['payment_precondition'], 'batch_id': 'b-1727440000-x7', 'index': 2})
            self.assertEqual(status, 200)
            self.assertEqual(calls, [('S1', ['payment_precondition'], 'b-1727440000-x7', 2)])
        with patch.object(server, 'agent_lab', fake), patch.dict(os.environ, {'NVIDIA_API_KEY': ''}):
            self.assertEqual(self.req('POST', '/api/lab/run', {'scenario_id': 'S1'})[0], 503)

    def test_samples_allow_list_and_sample_id_on_analyze(self):
        sample_file = Path(self.temp.name) / 'inv.txt'
        sample_file.write_bytes(b'INVOICE BYTES')
        fake = types.SimpleNamespace(
            manifest=lambda: {'samples': []},
            resolve=lambda sid, role: (sample_file, 'text/plain') if (sid, role) == ('three-way-short-delivery', 'invoice') else None)
        docs = types.SimpleNamespace(analyze=lambda files, infer: {'sources': {k: {'filename': v[0]} for k, v in files.items()}, 'checks': [], 'findings': []})
        with patch.object(server, 'samples', fake), patch.object(server, 'documents', docs):
            status, body, resp = self.req('GET', '/api/samples/three-way-short-delivery/invoice')
            self.assertEqual((status, body), (200, b'INVOICE BYTES'))
            self.assertEqual(self.req('GET', '/api/samples/three-way-short-delivery/secrets')[0], 404)
            self.assertEqual(self.req('GET', '/api/samples/..%2F..%2Fserver.py/invoice')[0], 404)
            def multipart(blob, sample_id):
                b = b'--bnd\r\nContent-Disposition: form-data; name="invoice"; filename="inv.txt"\r\nContent-Type: text/plain\r\n\r\n' + blob + b'\r\n'
                if sample_id:
                    b += b'--bnd\r\nContent-Disposition: form-data; name="sample_id"\r\n\r\n' + sample_id + b'\r\n'
                return b + b'--bnd--\r\n'
            ct = {'Content-Type': 'multipart/form-data; boundary=bnd'}
            status, run, _ = self.req('POST', '/api/documents/analyze', multipart(b'INVOICE BYTES', b'three-way-short-delivery'), ct)
            self.assertEqual(status, 200)
            self.assertEqual(run['sources']['invoice']['sample'], {'id': 'three-way-short-delivery', 'role': 'invoice', 'url': '/api/samples/three-way-short-delivery/invoice'})
            status, run, _ = self.req('POST', '/api/documents/analyze', multipart(b'OTHER BYTES', b'three-way-short-delivery'), ct)
            self.assertNotIn('sample', run['sources']['invoice'])
            before = len(storage.list_runs())
            self.assertEqual(self.req('POST', '/api/documents/analyze', multipart(b'X', b'../bad'), ct)[0], 400)
            self.assertEqual(self.req('POST', '/api/documents/analyze', b'{}', {'Content-Type': 'application/json'})[0], 400)
            bad_ext = multipart(b'X', None).replace(b'inv.txt', b'inv.exe')
            self.assertEqual(self.req('POST', '/api/documents/analyze', bad_ext, ct)[0], 400)
            self.assertEqual(len(storage.list_runs()), before)


if __name__ == '__main__':
    unittest.main()
