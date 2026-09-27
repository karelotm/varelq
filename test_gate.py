"""deploy/gate.py GET /__logout: clears the gate cookie and returns to /__gate, never reaching the app."""
import http.client
import importlib.util
import pathlib
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _load_gate():
    spec = importlib.util.spec_from_file_location('varelq_gate_logout', pathlib.Path(__file__).resolve().parent / 'deploy' / 'gate.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GateLogoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gate = _load_gate()
        hits = cls.hits = []

        class Upstream(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                hits.append(self.path)
                self.send_response(200)
                self.send_header('Content-Length', '0')
                self.end_headers()

        cls.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        limiter = cls.gate.Limiter(5, 100, 10)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), cls.gate.make_handler('correct-horse', f'http://127.0.0.1:{cls.upstream.server_address[1]}', limiter))
        for s in (cls.upstream, cls.server):
            threading.Thread(target=s.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for s in (cls.server, cls.upstream):
            s.shutdown()
            s.server_close()

    def get(self, path, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_address[1], timeout=5)
        conn.request('GET', path, headers=headers or {})
        response = conn.getresponse()
        response.read()
        conn.close()
        return response

    def cookie(self):
        return f'{self.gate.COOKIE}={self.gate.token("correct-horse")}'

    def test_logout_clears_cookie_and_redirects_to_gate(self):
        self.hits.clear()
        response = self.get('/__logout', {'Cookie': self.cookie()})
        self.assertEqual((response.status, response.getheader('Location')), (303, '/__gate'))
        set_cookie = response.getheader('Set-Cookie')
        self.assertTrue(set_cookie.startswith(f'{self.gate.COOKIE}=;'))
        self.assertIn('Max-Age=0', set_cookie)
        self.assertIn('Path=/', set_cookie)
        self.assertNotIn(self.gate.token('correct-horse'), set_cookie)
        self.assertEqual(self.hits, [])  # handled by the gate, not forwarded

    def test_logout_without_cookie_and_secure_behind_https(self):
        response = self.get('/__logout', {'X-Forwarded-Proto': 'https'})
        self.assertEqual(response.status, 303)
        self.assertIn('Secure', response.getheader('Set-Cookie'))

    def test_cookie_still_works_for_other_paths(self):
        self.hits.clear()
        response = self.get('/', {'Cookie': self.cookie()})
        self.assertEqual(response.status, 200)
        self.assertEqual(self.hits, ['/'])


if __name__ == '__main__':
    unittest.main()
