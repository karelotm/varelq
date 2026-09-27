"""Access-code gate + rate limit in front of VARELQ (stdlib only). No changes to server.py needed.

    browser --(public tunnel, lead-approved only)--> gate 127.0.0.1:GATE_PORT --> app 127.0.0.1:8390

- Every request needs the gate cookie, obtained by posting the shared access code to /__gate.
- POST requests (the ones that spend NVIDIA credits) are rate limited per client and capped per day.
- The gate rewrites Host/Origin to the upstream's loopback address, so the app's Host allow-list and
  Origin check stay strict (no VARELQ_ALLOWED_HOSTS change needed).

Environment:
  VARELQ_ACCESS_CODE   required, >= 8 characters; never logged
  GATE_PORT            default 8080 (binds 127.0.0.1 only)
  GATE_UPSTREAM        default http://127.0.0.1:8390
  GATE_POST_PER_MIN    per-client POST limit per minute, default 6
  GATE_GET_PER_MIN     per-client GET limit per minute, default 240
  GATE_DAILY_POST_CAP  global POST cap per UTC day, default 300
  GATE_CLIENT_IP_HEADER header carrying the visitor IP from the tunnel (e.g. CF-Connecting-IP); default none
"""
import hashlib
import hmac
import html
import http.client
import json
import os
import sys
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

COOKIE = 'varelq_gate'
HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'content-length'}
MAX_BODY = 13 * 1024 * 1024


class Limiter:
    def __init__(self, post_per_min, get_per_min, daily_post_cap, login_per_min=5, clock=time.time):
        self.limits = {'POST': post_per_min, 'GET': get_per_min, 'LOGIN': login_per_min}
        self.daily_cap = daily_post_cap
        self.clock = clock
        self.hits = defaultdict(deque)
        self.day, self.day_count = None, 0
        self.lock = threading.Lock()

    def allow(self, client, kind):
        """Returns (allowed, retry_after_seconds)."""
        now = self.clock()
        with self.lock:
            window = self.hits[(client, kind)]
            while window and now - window[0] >= 60:
                window.popleft()
            if len(window) >= self.limits[kind]:
                return False, max(1, int(60 - (now - window[0])))
            if kind == 'POST':
                day = time.strftime('%Y-%m-%d', time.gmtime(now))
                if day != self.day:
                    self.day, self.day_count = day, 0
                if self.day_count >= self.daily_cap:
                    return False, 3600
                self.day_count += 1
            window.append(now)
            return True, 0


def token(code):
    return hmac.new(code.encode(), b'varelq-gate-v1', hashlib.sha256).hexdigest()


def make_handler(code, upstream, limiter, ip_header=None):
    target = urlparse(upstream)
    expected = token(code)

    class Gate(BaseHTTPRequestHandler):
        server_version = 'VARELQ-gate'
        sys_version = ''
        timeout = 120

        def log_message(self, fmt, *args):  # no query strings, no cookies
            sys.stderr.write('[gate] %s %s %s\n' % (self.command, urlparse(self.path).path[:120], args[1] if len(args) > 1 else ''))

        def client(self):
            if ip_header and self.headers.get(ip_header):
                return self.headers.get(ip_header).split(',')[0].strip()[:64]
            return self.client_address[0]

        def authed(self):
            for part in (self.headers.get('Cookie') or '').split(';'):
                name, _, value = part.strip().partition('=')
                if name == COOKIE and hmac.compare_digest(value, expected):
                    return True
            return False

        def reply(self, status, body, ctype='application/json; charset=utf-8', extra=()):
            data = body.encode() if isinstance(body, str) else body
            self.send_response(status)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Robots-Tag', 'noindex, nofollow')
            for k, v in extra:
                self.send_header(k, v)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)

        def login_page(self, message=''):
            note = f'<p role="alert">{html.escape(message)}</p>' if message else ''
            icon = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect x='4' y='4' width='56' height='56' rx='14' "
                    "fill='%23faf9f5' stroke='%231f1e1d' stroke-width='4'/%3E%3Cpath d='M20 20l12 26 12-26' fill='none' stroke='%231f1e1d' stroke-width='5' "
                    "stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
            page = ('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                    f'<link rel="icon" type="image/svg+xml" href="{icon}">'
                    '<title>VARELQ demo access</title><style>html{background:#faf9f5}body{font:15px/22px system-ui,sans-serif;max-width:380px;margin:18vh auto;padding:0 16px;color:#1f1e1d}'
                    'h1{font:500 32px/1.1 Georgia,serif;margin:0 0 8px}h1 span{color:#2f6b4f}p{color:#6b6a66}'
                    'input,button{font:inherit;height:36px;padding:0 12px;border:1px solid #e8e6df;border-radius:8px;background:#fff;color:#1f1e1d}'
                    'button{background:#1f1e1d;color:#faf9f5;border-color:#1f1e1d;cursor:pointer}</style>'
                    '<h1>varelq<span>.</span></h1><p>Enter the access code shared by the team.</p>' + note +
                    '<form method="post" action="/__gate"><input name="code" type="password" autocomplete="off" aria-label="Access code" required> '
                    '<button>Continue</button></form>')
            self.reply(401 if message else 200, page, 'text/html; charset=utf-8')

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            path = urlparse(self.path).path
            if path == '/__gate':
                return self.login_page()
            if path == '/__logout':
                return self.logout()
            self.forward()

        def logout(self):
            """Clears the gate cookie and returns to the access-code page. Works with or without a valid cookie."""
            secure = '; Secure' if (self.headers.get('X-Forwarded-Proto') or '').lower() == 'https' else ''
            self.send_response(303)
            self.send_header('Location', '/__gate')
            self.send_header('Set-Cookie', f'{COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_POST(self):
            if urlparse(self.path).path == '/__gate':
                ok, retry = limiter.allow(self.client(), 'LOGIN')
                if not ok:
                    return self.reply(429, json.dumps({'error': 'Too many attempts. Retry later.'}), extra=[('Retry-After', str(retry))])
                length = int(self.headers.get('Content-Length') or 0)
                form = parse_qs(self.rfile.read(min(length, 4096)).decode('utf-8', 'replace'))
                if hmac.compare_digest((form.get('code') or [''])[0].encode(), code.encode()):
                    secure = '; Secure' if (self.headers.get('X-Forwarded-Proto') or '').lower() == 'https' else ''
                    self.send_response(303)
                    self.send_header('Location', '/')
                    self.send_header('Set-Cookie', f'{COOKIE}={expected}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200{secure}')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                return self.login_page('That code is not valid.')
            self.forward()

        def forward(self):
            path = urlparse(self.path).path
            if not self.authed():
                if path.startswith('/api/') or self.command == 'POST':
                    return self.reply(401, json.dumps({'error': 'Access code required.'}))
                self.send_response(303)
                self.send_header('Location', '/__gate')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            kind = 'POST' if self.command == 'POST' else 'GET'
            ok, retry = limiter.allow(self.client(), kind)
            if not ok:
                return self.reply(429, json.dumps({'error': 'Rate limit reached for this demo. Retry later.'}), extra=[('Retry-After', str(retry))])
            body = None
            if self.command == 'POST':
                length = int(self.headers.get('Content-Length') or 0)
                if length > MAX_BODY:
                    return self.reply(413, json.dumps({'error': 'Request too large.'}))
                body = self.rfile.read(length)
            headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP | {'host', 'cookie', 'origin', 'referer'}}
            headers['Host'] = target.netloc
            origin = self.headers.get('Origin')
            if origin is not None:
                public = (self.headers.get('Host') or '').lower()
                if origin.lower() not in ('https://' + public, 'http://' + public):
                    return self.reply(403, json.dumps({'error': 'Cross-origin requests are not accepted.'}))
                headers['Origin'] = f'{target.scheme}://{target.netloc}'
            if body is not None:
                headers['Content-Length'] = str(len(body))
            try:
                conn = http.client.HTTPConnection(target.hostname, target.port or 80, timeout=150)
                conn.request(self.command if self.command != 'HEAD' else 'GET', self.path, body=body, headers=headers)
                response = conn.getresponse()
                data = response.read()
            except OSError:
                return self.reply(502, json.dumps({'error': 'VARELQ app is not reachable.'}))
            self.send_response(response.status)
            for k, v in response.getheaders():
                if k.lower() not in HOP:
                    self.send_header(k, v)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('X-Robots-Tag', 'noindex, nofollow')
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)
            conn.close()

    return Gate


def main():
    code = os.getenv('VARELQ_ACCESS_CODE', '')
    if len(code) < 8:
        sys.exit('Set VARELQ_ACCESS_CODE (at least 8 characters) before starting the gate.')
    limiter = Limiter(int(os.getenv('GATE_POST_PER_MIN', '6')), int(os.getenv('GATE_GET_PER_MIN', '240')), int(os.getenv('GATE_DAILY_POST_CAP', '300')))
    port = int(os.getenv('GATE_PORT', '8080'))
    upstream = os.getenv('GATE_UPSTREAM', 'http://127.0.0.1:8390')
    handler = make_handler(code, upstream, limiter, os.getenv('GATE_CLIENT_IP_HEADER') or None)
    print(f'VARELQ gate on http://127.0.0.1:{port} -> {upstream}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()


if __name__ == '__main__':
    main()
