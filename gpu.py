"""OCR/GPU status for /api/gpu/status. Never raises.

- Readiness: GET {NVIDIA_OCR_URL scheme://host:port}/v1/health/ready, 2 s timeout, cached 15 s.
- GPU facts: one recorded nvidia-smi capture in deploy/gpu-capture.json (with captured_at).
- Live metrics: GET {NIM base}/v1/metrics (Prometheus text), 2 s timeout, cached 5 s, only for a self-hosted
  NVIDIA_OCR_URL whose host is loopback or a private address. Never derived from request input.
"""
import ipaddress
import math
import re
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
METRICS_CACHE_SECONDS = 5
METRICS_SOURCE = 'NIM /v1/metrics'
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


# ------------------------------------------------------------------ live NIM metrics

_SAMPLE = re.compile(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)(?:\s+\S+)?\s*$')
_LABEL = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"')


def parse_prometheus(text):
    """Prometheus text exposition -> {metric_name: [(labels_dict, float_value), ...]}. Skips bad lines."""
    out = {}
    if not isinstance(text, str):
        return out
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        match = _SAMPLE.match(line)
        if not match:
            continue
        name, _, labels_text, value = match.groups()
        try:
            number = float(value)
        except ValueError:
            continue
        labels = {k: v.replace('\\"', '"').replace('\\\\', '\\') for k, v in _LABEL.findall(labels_text or '')}
        out.setdefault(name, []).append((labels, number))
    return out


def metrics_url(endpoint=None):
    """{scheme://host:port}/v1/metrics for a self-hosted OCR URL on loopback/private hosts, else None."""
    endpoint = endpoint if endpoint is not None else ocr._self_hosted_url()
    if not endpoint:
        return None
    parts = urlparse(endpoint)
    if parts.scheme not in ('http', 'https') or not parts.hostname:
        return None
    host = parts.hostname
    if host != 'localhost':
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            return None
        # link-local (169.254.x, incl. cloud metadata) is "private" to ipaddress but never a NIM
        if not (address.is_loopback or address.is_private) or address.is_unspecified or address.is_link_local:
            return None
    return f'{parts.scheme}://{parts.netloc}/v1/metrics'


def _first(parsed, name, **labels):
    for sample_labels, value in parsed.get(name, []):
        if all(sample_labels.get(k) == v for k, v in labels.items()):
            return sample_labels, value
    return None, None


def _num(value, as_int=False):
    if value is None or not math.isfinite(value):  # None, NaN or +/-Inf (Infinity is not valid JSON)
        return None
    return int(value) if as_int else round(value, 4)


def summarize_metrics(parsed):
    """Parsed Prometheus samples -> the 'gpu' and 'ocr' blocks of the live field (first GPU only)."""
    labels, mem_total = _first(parsed, 'gpu_memory_total_bytes')
    gpu_id = (labels or {}).get('gpu')
    sel = {'gpu': gpu_id} if gpu_id is not None else {}
    value = lambda name: _first(parsed, name, **sel)[1]
    gpu_block = None
    if labels is not None or parsed.get('gpu_utilization_ratio'):
        gpu_block = {'name': (labels or {}).get('name'), 'memory_used_bytes': _num(value('gpu_memory_used_bytes'), True),
                     'memory_total_bytes': _num(mem_total, True), 'utilization_ratio': _num(value('gpu_utilization_ratio')),
                     'memory_utilization_ratio': _num(value('gpu_memory_utilization_ratio')),
                     'power_watts': _num(value('gpu_power_usage_watts')), 'power_limit_watts': _num(value('gpu_power_limit_watts')),
                     'temperature_c': _num(value('gpu_temperature_celsius')), 'sm_clock_mhz': _num(value('gpu_sm_clock_mhz')),
                     'energy_joules': _num(value('gpu_total_energy_consumption_joules'))}
    quantile = lambda q: _num(_first(parsed, 'ocr_request_latency_ms', quantile=q)[1])
    ocr_block = {'requests_total': _num(_first(parsed, 'ocr_requests_total')[1], True),
                 'latency_ms': {'p50': quantile('0.5'), 'p95': quantile('0.95'), 'p99': quantile('0.99')},
                 'count': _num(_first(parsed, 'ocr_request_latency_ms_count')[1], True)}
    return gpu_block, ocr_block


def _fetch_metrics(url):  # patched in tests
    with urlopen(url, timeout=2) as response:
        return response.read(2_000_000).decode('utf-8', 'replace')


def live():
    """Live GPU/OCR metrics from the self-hosted NIM, or {available: False, reason}. Never raises."""
    try:
        url = metrics_url()
        if not url:
            reason = ('OCR runs on the NVIDIA hosted endpoint; no self-hosted NIM to read metrics from'
                      if not ocr._self_hosted_url() else 'NVIDIA_OCR_URL host is not loopback/private; metrics not fetched')
            return {'available': False, 'source': METRICS_SOURCE, 'reason': reason}
        key = ('metrics', url)
        with _lock:
            cached = _cache.get(key)
            if cached and time.monotonic() - cached[0] < METRICS_CACHE_SECONDS:
                return cached[1]
        try:
            text = _fetch_metrics(url)
            gpu_block, ocr_block = summarize_metrics(parse_prometheus(text))
            if gpu_block is None and ocr_block['requests_total'] is None:
                value = {'available': False, 'source': METRICS_SOURCE, 'reason': 'metrics endpoint returned no GPU or OCR series',
                         'fetched_at': _now()}
            else:
                value = {'available': True, 'source': METRICS_SOURCE, 'fetched_at': _now(), 'gpu': gpu_block, 'ocr': ocr_block}
        except Exception as error:
            value = {'available': False, 'source': METRICS_SOURCE, 'reason': f'GET /v1/metrics failed ({type(error).__name__})',
                     'fetched_at': _now()}
        with _lock:
            _cache[key] = (time.monotonic(), value)
        return value
    except Exception as error:
        return {'available': False, 'source': METRICS_SOURCE, 'reason': f'metrics error ({type(error).__name__})'}


def status():
    try:
        config = ocr.configuration()
        probe = readiness()
        return {'ocr': {'mode': config['mode'], 'label': config['label'], 'ready': probe['ready'], 'model': config['model'],
                        'fallback': config['fallback'], 'checked_at': probe['checked_at'], 'probe': probe.get('probe'),
                        'configured': config['configured']},
                'gpu': capture(), 'recent': ocr.recent_latencies(), 'live': live()}
    except Exception as error:  # status must never raise
        return {'ocr': {'mode': 'unknown', 'label': None, 'ready': None, 'model': None, 'fallback': None, 'checked_at': _now(),
                        'probe': f'status error ({type(error).__name__})'}, 'gpu': None, 'recent': [],
                'live': {'available': False, 'source': METRICS_SOURCE, 'reason': 'status error'}}
