import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import gpu


class GpuStatusTests(unittest.TestCase):
    def setUp(self):
        gpu._cache.clear()

    def test_hosted_mode_is_not_probed_and_capture_optional(self):
        with patch.dict('os.environ', {'NVIDIA_API_KEY': 'k'}, clear=True), patch.object(gpu, 'CAPTURE', pathlib.Path('missing.json')):
            with patch.object(gpu, 'urlopen') as probe:
                body = gpu.status()
        probe.assert_not_called()
        self.assertEqual(body['ocr']['mode'], 'hosted')
        self.assertIsNone(body['ocr']['ready'])
        self.assertIsNone(body['gpu'])
        self.assertIsInstance(body['recent'], list)

    def test_self_hosted_probe_is_cached_and_failure_is_not_ready(self):
        env = {'NVIDIA_OCR_URL': 'http://127.0.0.1:8000/v1/ocr', 'NVIDIA_OCR_LABEL': 'NIM on Brev L4', 'NVIDIA_OCR_FALLBACK': 'hosted'}
        with patch.dict('os.environ', env, clear=True):
            with patch.object(gpu, 'urlopen', side_effect=OSError('refused')) as probe,                     patch.object(gpu, '_fetch_metrics', side_effect=OSError('refused')):
                first, second = gpu.status(), gpu.status()
        self.assertEqual(first['live'], dict(first['live'], available=False, source='NIM /v1/metrics'))
        self.assertIn('OSError', first['live']['reason'])
        self.assertEqual(probe.call_count, 1)
        self.assertEqual(probe.call_args.args[0], 'http://127.0.0.1:8000/v1/health/ready')
        self.assertEqual(probe.call_args.kwargs['timeout'], 2)
        self.assertFalse(first['ocr']['ready'])
        self.assertEqual(first['ocr']['label'], 'NIM on Brev L4')
        self.assertEqual(first['ocr']['fallback'], 'hosted')
        self.assertEqual(first['ocr']['checked_at'], second['ocr']['checked_at'])

    def test_capture_file_is_reported_with_timestamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'gpu-capture.json'
            path.write_text(json.dumps({'name': 'NVIDIA L4', 'memory_used_mib': 2710, 'memory_total_mib': 23034, 'driver': '595.91',
                                        'captured_at': '2026-09-27T13:25:00Z'}), encoding='utf-8')
            with patch.object(gpu, 'CAPTURE', path):
                capture = gpu.capture()
        self.assertEqual(capture['source'], 'nvidia-smi capture')
        self.assertEqual(capture['captured_at'], '2026-09-27T13:25:00Z')
        self.assertEqual(capture['memory_total_mib'], 23034)

    def test_status_never_raises(self):
        with patch.object(gpu.ocr, 'configuration', side_effect=RuntimeError('boom')):
            body = gpu.status()
        self.assertEqual(body['ocr']['mode'], 'unknown')
        self.assertIsNone(body['gpu'])


def _load_gate():
    import importlib.util
    spec = importlib.util.spec_from_file_location('varelq_gate', pathlib.Path(__file__).resolve().parent / 'deploy' / 'gate.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DeployGateTests(unittest.TestCase):
    """deploy/gate.py: access code + rate limit in front of the app (hosting prep; nothing is exposed)."""

    @classmethod
    def setUpClass(cls):
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        cls.gate = _load_gate()
        seen = cls.seen = []

        class Upstream(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _ok(self):
                length = int(self.headers.get('Content-Length') or 0)
                seen.append({'method': self.command, 'host': self.headers.get('Host'), 'origin': self.headers.get('Origin'),
                             'cookie': self.headers.get('Cookie'), 'body': self.rfile.read(length) if length else b''})
                data = b'{"ok": true}'
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            do_GET = do_POST = _ok

        cls.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        up = f'http://127.0.0.1:{cls.upstream.server_address[1]}'
        cls.clock = [1000.0]
        cls.limiter = cls.gate.Limiter(2, 100, 3, login_per_min=3, clock=lambda: cls.clock[0])
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), cls.gate.make_handler('correct-horse', up, cls.limiter))
        cls.port = cls.server.server_address[1]
        for s in (cls.upstream, cls.server):
            threading.Thread(target=s.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.upstream.shutdown()
        cls.server.server_close(); cls.upstream.server_close()

    def request(self, method, path, body=None, headers=None):
        import http.client
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        data = response.read()
        conn.close()
        return response, data

    def cookie(self):
        return f'{self.gate.COOKIE}={self.gate.token("correct-horse")}'

    def test_requires_code_and_sets_cookie(self):
        response, _ = self.request('GET', '/')
        self.assertEqual((response.status, response.getheader('Location')), (303, '/__gate'))
        response, _ = self.request('GET', '/api/health')
        self.assertEqual(response.status, 401)
        response, _ = self.request('POST', '/__gate', 'code=wrong', {'Content-Type': 'application/x-www-form-urlencoded'})
        self.assertEqual(response.status, 401)
        response, _ = self.request('POST', '/__gate', 'code=correct-horse', {'Content-Type': 'application/x-www-form-urlencoded'})
        self.assertEqual(response.status, 303)
        self.assertIn(self.gate.token('correct-horse'), response.getheader('Set-Cookie'))
        self.assertIn('HttpOnly', response.getheader('Set-Cookie'))

    def test_forwards_with_loopback_host_and_origin_and_strips_cookie(self):
        self.seen.clear()
        response, data = self.request('POST', '/api/x', b'{}', {'Cookie': self.cookie(), 'Host': 'demo.example.com',
                                                               'Origin': 'https://demo.example.com', 'Content-Type': 'application/json'})
        self.assertEqual((response.status, data), (200, b'{"ok": true}'))
        up = f'127.0.0.1:{self.upstream.server_address[1]}'
        self.assertEqual((self.seen[0]['host'], self.seen[0]['origin'], self.seen[0]['cookie'], self.seen[0]['body']),
                         (up, 'http://' + up, None, b'{}'))
        response, _ = self.request('POST', '/api/x', b'{}', {'Cookie': self.cookie(), 'Host': 'demo.example.com', 'Origin': 'https://evil.example'})
        self.assertEqual(response.status, 403)

    def test_post_rate_limit_and_daily_cap(self):
        limiter = self.gate.Limiter(2, 100, 3, clock=lambda: self.clock[0])
        self.assertEqual([limiter.allow('a', 'POST')[0] for _ in range(3)], [True, True, False])
        self.clock[0] += 61
        self.assertEqual([limiter.allow('b', 'POST')[0] for _ in range(2)], [True, False])  # daily cap 3 reached
        self.assertTrue(limiter.allow('a', 'GET')[0])



SAMPLE_METRICS = """# HELP ocr_requests_total Total OCR requests
# TYPE ocr_requests_total counter
ocr_requests_total 1
gpu_memory_total_bytes{gpu="0",uuid="GPU-abc",name="NVIDIA L4"} 24152899584
gpu_memory_used_bytes{gpu="0",uuid="GPU-abc",name="NVIDIA L4"} 2889875456
gpu_utilization_ratio{gpu="0",uuid="GPU-abc",name="NVIDIA L4"} 0
gpu_memory_utilization_ratio{gpu="0",uuid="GPU-abc",name="NVIDIA L4"} 0
gpu_power_usage_watts{gpu="0",uuid="GPU-abc",name="NVIDIA L4"} 30.435
gpu_power_limit_watts{gpu="0",uuid="GPU-abc",name="NVIDIA L4"} 72
gpu_temperature_celsius{gpu="0",uuid="GPU-abc",name="NVIDIA L4"} 62
gpu_sm_clock_mhz{gpu="0",uuid="GPU-abc",name="NVIDIA L4"} 2040
gpu_total_energy_consumption_joules{gpu="0",uuid="GPU-abc",name="NVIDIA L4"} 190682.576
# TYPE ocr_request_latency_ms summary
ocr_request_latency_ms{quantile="0.5"} 246.241
ocr_request_latency_ms{quantile="0.95"} 310.5
ocr_request_latency_ms{quantile="0.99"} 402
ocr_request_latency_ms_sum 246.241
ocr_request_latency_ms_count 1
garbage line without value
weird{label="a \\"quoted\\" }"} NaN
"""


class LiveMetricsTests(unittest.TestCase):
    ENV = {'NVIDIA_OCR_URL': 'http://127.0.0.1:8000/v1/ocr'}

    def setUp(self):
        gpu._cache.clear()

    def test_parser_handles_labels_quantiles_and_junk(self):
        parsed = gpu.parse_prometheus(SAMPLE_METRICS)
        self.assertEqual(parsed['ocr_requests_total'], [({}, 1.0)])
        self.assertEqual(parsed['gpu_memory_total_bytes'][0][0]['name'], 'NVIDIA L4')
        self.assertEqual(len(parsed['ocr_request_latency_ms']), 3)
        self.assertEqual(parsed['weird'][0][0]['label'], 'a "quoted" }')
        self.assertNotIn('garbage', parsed)
        self.assertEqual(gpu.parse_prometheus(None), {})

    def test_live_block_from_sample(self):
        with patch.dict('os.environ', self.ENV, clear=True),                 patch.object(gpu, '_fetch_metrics', return_value=SAMPLE_METRICS) as fetch:
            live, again = gpu.live(), gpu.live()
        fetch.assert_called_once_with('http://127.0.0.1:8000/v1/metrics')
        self.assertIs(live, again)  # cached
        self.assertTrue(live['available'])
        self.assertEqual(live['source'], 'NIM /v1/metrics')
        self.assertEqual(live['gpu'], {'name': 'NVIDIA L4', 'memory_used_bytes': 2889875456, 'memory_total_bytes': 24152899584,
                                       'utilization_ratio': 0.0, 'memory_utilization_ratio': 0.0, 'power_watts': 30.435,
                                       'power_limit_watts': 72.0, 'temperature_c': 62.0, 'sm_clock_mhz': 2040.0,
                                       'energy_joules': 190682.576})
        self.assertEqual(live['ocr'], {'requests_total': 1, 'latency_ms': {'p50': 246.241, 'p95': 310.5, 'p99': 402.0}, 'count': 1})

    def test_unavailable_paths_never_raise(self):
        with patch.dict('os.environ', {}, clear=True):
            self.assertFalse(gpu.live()['available'])
        for url in ('http://example.com:8000/v1/ocr', 'http://8.8.8.8:8000/v1/ocr', 'file:///etc/passwd', 'http://0.0.0.0:8000/v1/ocr'):
            self.assertIsNone(gpu.metrics_url(url), url)
        self.assertEqual(gpu.metrics_url('http://10.0.0.5:8000/v1/ocr'), 'http://10.0.0.5:8000/v1/metrics')
        self.assertEqual(gpu.metrics_url('http://localhost:8000/v1/ocr'), 'http://localhost:8000/v1/metrics')
        with patch.dict('os.environ', {'NVIDIA_OCR_URL': 'http://example.com:8000/v1/ocr'}, clear=True),                 patch.object(gpu, '_fetch_metrics') as fetch:
            self.assertFalse(gpu.live()['available'])
        fetch.assert_not_called()
        with patch.dict('os.environ', self.ENV, clear=True), patch.object(gpu, '_fetch_metrics', return_value='nothing here 1'):
            self.assertEqual(gpu.live()['reason'], 'metrics endpoint returned no GPU or OCR series')


if __name__ == '__main__':
    unittest.main()
