"""OCR/GPU status for /api/gpu/status. Never raises.

- Readiness: GET {NVIDIA_OCR_URL scheme://host:port}/v1/health/ready, 2 s timeout, cached 15 s.
- GPU facts: one recorded nvidia-smi capture in deploy/gpu-capture.json (with captured_at). No live probe.
"""
import json
import os
import pathlib
import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlparse
from urllib.request import urlopen

import ocr

CAPTURE = pathlib.Path(__file__).resolve().parent / 'deploy' / 'gpu-capture.json'
CACHE_SECONDS = 15
_cache = {}
_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def ready_url(endpoint=None):
    endpoint = endpoint if endpoint is not None else ocr._self_hosted_url()
    if not endpoint:
        return None
    parts = urlparse(endpoint)
    if parts.scheme not in ('http', 'https') or not parts.netloc:
        return None
    return f'{parts.scheme}://{parts.netloc}/v1/health/ready'


def _probe(url):
    started = time.perf_counter()
    try:
        with urlopen(url, timeout=2) as response:
            ok = response.status == 200
        return ok, int((time.perf_counter() - started) * 1000), None
    except Exception as error:  # connection refused, timeout, 503 while loading
        return False, int((time.perf_counter() - started) * 1000), type(error).__name__


def readiness():
    url = ready_url()
    if not url:
        return {'ready': None, 'checked_at': None, 'probe': 'not probed: hosted endpoint'}
    with _lock:
        cached = _cache.get(url)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            return cached[1]
    ok, ms, error = _probe(url)
    value = {'ready': ok, 'checked_at': _now(), 'probe_ms': ms, 'probe': 'GET /v1/health/ready' + (f' failed ({error})' if error else '')}
    with _lock:
        _cache[url] = (time.monotonic(), value)
    return value


def capture():
    """The recorded nvidia-smi capture, or None."""
    try:
        data = json.loads(CAPTURE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not data.get('captured_at'):
        return None
    keys = ('name', 'memory_used_mib', 'memory_total_mib', 'driver', 'captured_at', 'instance', 'container')
    result = {k: data.get(k) for k in keys if k in data}
    result['source'] = 'nvidia-smi capture'
    return result


def status():
    try:
        config = ocr.configuration()
        probe = readiness()
        return {'ocr': {'mode': config['mode'], 'label': config['label'], 'ready': probe['ready'], 'model': config['model'],
                        'fallback': config['fallback'], 'checked_at': probe['checked_at'], 'probe': probe.get('probe'),
                        'configured': config['configured']},
                'gpu': capture(), 'recent': ocr.recent_latencies()}
    except Exception as error:  # status must never raise
        return {'ocr': {'mode': 'unknown', 'label': None, 'ready': None, 'model': None, 'fallback': None, 'checked_at': _now(),
                        'probe': f'status error ({type(error).__name__})'}, 'gpu': None, 'recent': []}
