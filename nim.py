"""Hardened NVIDIA NIM client (hosted build.nvidia.com or any OpenAI-compatible NIM).

The API key is read from the NVIDIA_API_KEY environment variable only. It is never
logged, echoed or included in errors or meta.
"""
import collections
import json
import os
import random
import re
import socket
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1'
DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b'
DEFAULT_EMBED_MODEL = 'nvidia/nemotron-3-embed-1b'
DEFAULT_FALLBACK_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b'
DEFAULT_RPM_LIMIT = 40
RETRY_STATUSES = {429, 500, 502, 503, 504}
_SEMAPHORE = threading.BoundedSemaphore(max(1, int(os.getenv('NIM_CONCURRENCY', '4') or 4)))
_THINK = re.compile(r'<think>[\s\S]*?(</think>|$)')
_FENCE = re.compile(r'```(?:json)?\s*([\s\S]*?)```')


_STATS_LOCK = threading.Lock()
_STATS = {'requests': 0, 'attempts': 0, 'failures': 0, 'retries_by_status': {}, 'since': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}


def stats():
    """Process-wide counters since start: requests, attempts, failures, retries_by_status."""
    with _STATS_LOCK:
        return dict(_STATS, retries_by_status=dict(_STATS['retries_by_status']))


def _record(meta_before_attempts, meta, failed, model=None, ms=None, body=None):
    attempts = meta.get('attempts', 0) - meta_before_attempts
    with _STATS_LOCK:
        _STATS['requests'] += 1
        _STATS['attempts'] += attempts
        _STATS['failures'] += int(failed)
        m = _model_entry(model or 'unknown')
        m['requests'] += 1
        m['attempts'] += attempts
        m['successes' if not failed else 'failures'] += 1
        if ms is not None:
            m['_lat'].append(int(ms))
        usage = body.get('usage') if isinstance(body, dict) else None
        if isinstance(usage, dict):
            for k in ('prompt_tokens', 'completion_tokens', 'total_tokens'):
                v = usage.get(k)
                if isinstance(v, int) and not isinstance(v, bool):
                    m[k] += v


# ------------------------------------------------------------------ usage accounting + limiter

_MODELS = {}
_WINDOW = collections.deque()  # monotonic timestamps of HTTP attempts sent in the last 60 s
_LIMIT_LOCK = threading.Lock()
_LIMITER = {'waits': 0, 'wait_ms_total': 0, 'saturated': 0}


def _monotonic():  # patched in tests
    return time.monotonic()


def _model_entry(model):
    m = _MODELS.get(model)
    if m is None:
        m = _MODELS[model] = {'requests': 0, 'successes': 0, 'failures': 0, 'attempts': 0, 'retries_by_status': {},
                              'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0,
                              'fallback_triggered': 0, 'fallback_served': 0,
                              '_lat': collections.deque(maxlen=200)}
    return m


def _bump_model(model, key):
    with _STATS_LOCK:
        _model_entry(model or 'unknown')[key] += 1


def _bump_model_retry(model, tag):
    with _STATS_LOCK:
        rbs = _model_entry(model or 'unknown')['retries_by_status']
        rbs[tag] = rbs.get(tag, 0) + 1


def _percentile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, int(round(q * (len(ordered) - 1)))))
    return ordered[idx]


def rpm_limit():
    """Client-side requests-per-minute ceiling for the NVIDIA key (NVIDIA_RPM_LIMIT, default 40; 0 disables)."""
    try:
        return max(0, int(os.getenv('NVIDIA_RPM_LIMIT', str(DEFAULT_RPM_LIMIT)) or 0))
    except ValueError:
        return DEFAULT_RPM_LIMIT


def _max_wait_s():
    try:
        return max(0.0, float(os.getenv('NVIDIA_RPM_MAX_WAIT_S', '20') or 0))
    except ValueError:
        return 20.0


def fallback_model():
    """Model tried once when the primary exhausts retries on 429/5xx/timeout. Empty string disables."""
    value = os.getenv('NIM_FALLBACK_MODEL')
    if value is None:
        return DEFAULT_FALLBACK_MODEL
    return value.strip() or None


def _prune(now):
    while _WINDOW and now - _WINDOW[0] >= 60.0:
        _WINDOW.popleft()


def last_60s():
    with _LIMIT_LOCK:
        _prune(_monotonic())
        return len(_WINDOW)


def plan_wait(timestamps, now, limit):
    """Pure limiter math: seconds until one more request fits under `limit` per rolling 60 s (0 = send now)."""
    if not limit:
        return 0.0
    recent = sorted(t for t in timestamps if now - t < 60.0)
    if len(recent) < limit:
        return 0.0
    # after the oldest (len - limit + 1) requests age out, len - (that) = limit - 1 remain -> one more fits
    return max(0.0, recent[len(recent) - limit] + 60.0 - now)


def _acquire_slot():
    """Wait (bounded by NVIDIA_RPM_MAX_WAIT_S, default 20 s) until a request fits under the RPM limit, then claim it.

    Returns milliseconds waited. When the bound is hit the request is sent anyway (429 handling still
    applies), so a busy minute degrades to waiting, never to a hang."""
    limit, budget, waited = rpm_limit(), _max_wait_s(), 0.0
    while True:
        with _LIMIT_LOCK:
            now = _monotonic()
            _prune(now)
            wait = plan_wait(_WINDOW, now, limit)
            if wait <= 0 or waited >= budget:
                if wait > 0:
                    _LIMITER['saturated'] += 1
                _WINDOW.append(now)
                if waited:
                    _LIMITER['waits'] += 1
                    _LIMITER['wait_ms_total'] += int(waited * 1000)
                return int(waited * 1000)
        step = max(0.05, min(wait + random.uniform(0.05, 0.25), budget - waited))
        waited += step
        _sleep(step)


def usage():
    """Process-wide usage snapshot for /api/usage (counts since process start)."""
    with _STATS_LOCK:
        models = {}
        for name, m in _MODELS.items():
            lat = list(m['_lat'])
            entry = {k: v for k, v in m.items() if not k.startswith('_')}
            entry['retries_by_status'] = dict(m['retries_by_status'])
            entry['latency_ms'] = {'p50': _percentile(lat, 0.5), 'p95': _percentile(lat, 0.95), 'samples': len(lat)}
            models[name] = entry
        totals = {k: _STATS[k] for k in ('requests', 'attempts', 'failures')}
        since = _STATS['since']
    with _LIMIT_LOCK:
        _prune(_monotonic())
        window = len(_WINDOW)
        limiter = dict(_LIMITER)
    limit = rpm_limit()
    return {'rpm_limit': limit, 'last_60s': window, 'headroom': (max(0, limit - window) if limit else None),
            'limiter': dict(limiter, max_wait_s=_max_wait_s()), 'models': models, 'totals': totals,
            'fallback_model': fallback_model(), 'default_model': default_model(), 'since': since}


def _reset_usage():  # tests
    with _STATS_LOCK:
        _MODELS.clear()
    with _LIMIT_LOCK:
        _WINDOW.clear()
        _LIMITER.update(waits=0, wait_ms_total=0, saturated=0)


def _bump_retry(tag):
    with _STATS_LOCK:
        rbs = _STATS['retries_by_status']
        rbs[tag] = rbs.get(tag, 0) + 1


class NimError(ValueError):
    """Model or transport failure. `status` is the final HTTP status, or None."""

    def __init__(self, message, status=None, meta=None, retryable_exhausted=False):
        super().__init__(message)
        self.status = status
        self.meta = meta or {}
        # True only when retries ran out on 429/5xx/timeout: the one case that may use the fallback model.
        self.retryable_exhausted = retryable_exhausted


def configured():
    return bool(os.getenv('NVIDIA_API_KEY'))


def default_model():
    return os.getenv('NVIDIA_MODEL', DEFAULT_MODEL)


def base_url():
    return os.getenv('NVIDIA_BASE_URL', DEFAULT_BASE_URL).rstrip('/')


def _sleep(seconds):  # patched in tests
    time.sleep(seconds)


def _post(url, payload, key, timeout):
    """POST JSON, return (status, parsed_body). Raises HTTPError/URLError/timeout."""
    req = Request(url, data=json.dumps(payload).encode(), method='POST',
                  headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Accept': 'application/json'})
    with urlopen(req, timeout=timeout) as response:
        return response.status, json.load(response)


def _request(path, payload, *, url_base, retries, timeout, meta):
    before = meta.get('attempts', 0)
    model = payload.get('model') if isinstance(payload, dict) else None
    started = time.monotonic()
    try:
        body = _request_inner(path, payload, url_base=url_base, retries=retries, timeout=timeout, meta=meta)
    except NimError:
        _record(before, meta, True, model, (time.monotonic() - started) * 1000)
        raise
    _record(before, meta, False, model, (time.monotonic() - started) * 1000, body)
    return body


def _request_inner(path, payload, *, url_base, retries, timeout, meta):
    """Send with retry/backoff on 429/5xx/timeouts. Updates meta attempts and retries_by_status."""
    key = os.getenv('NVIDIA_API_KEY')
    if not key:
        raise NimError('NVIDIA_API_KEY is not configured on the server.', status=None, meta=meta)
    url = (url_base or base_url()).rstrip('/') + path
    last_status, last_msg = None, 'no attempt'
    extra_429 = max(0, int(os.getenv('NIM_EXTRA_429_RETRIES', '4') or 0))  # rate limits get a separate budget
    attempt = used_429 = 0
    model = payload.get('model') if isinstance(payload, dict) else None
    tag = None
    while True:
        waited_ms = _acquire_slot()
        if waited_ms:
            meta['rate_limit_wait_ms'] = meta.get('rate_limit_wait_ms', 0) + waited_ms
        meta['attempts'] = meta.get('attempts', 0) + 1
        try:
            with _SEMAPHORE:
                _, body = _post(url, payload, key, timeout)
            return body
        except HTTPError as exc:
            last_status = exc.code
            last_msg = f'NVIDIA NIM returned HTTP {exc.code}.'
            if exc.code == 400:
                detail = ''
                try:
                    detail = exc.read().decode('utf-8', 'replace')[:300]
                except Exception:
                    pass
                raise NimError(f'NVIDIA NIM rejected the request (HTTP 400). {detail}'.strip(), status=400, meta=meta) from exc
            if exc.code not in RETRY_STATUSES:
                raise NimError(last_msg + ' Check model access and account quota.', status=exc.code, meta=meta) from exc
            tag = str(exc.code)
            try:
                retry_after = float((exc.headers or {}).get('Retry-After') or 0)
            except (TypeError, ValueError):
                retry_after = 0
            if exc.code == 429 and used_429 < extra_429:
                used_429 += 1
                rbs = meta.setdefault('retries_by_status', {})
                rbs[tag] = rbs.get(tag, 0) + 1
                _bump_retry(tag)
                _bump_model_retry(model, tag)
                _sleep(min(10.0, retry_after or 1.5 * used_429) + random.uniform(0, 0.8))
                continue
            delay = min(10.0, retry_after) if retry_after > 0 else None
        except (socket.timeout, TimeoutError):
            last_status, last_msg, tag, delay = None, 'NVIDIA NIM request timed out.', 'timeout', None
        except URLError as exc:
            delay = None
            if isinstance(exc.reason, (socket.timeout, TimeoutError)):
                last_status, last_msg, tag = None, 'NVIDIA NIM request timed out.', 'timeout'
            else:
                last_status, last_msg, tag = None, f'NVIDIA NIM connection failed: {exc.reason}', 'connection'
        except (json.JSONDecodeError, UnicodeDecodeError):
            last_status, last_msg, tag, delay = None, 'NVIDIA NIM returned a non-JSON body.', 'bad_body', None
        if attempt >= retries:
            break
        attempt += 1
        rbs = meta.setdefault('retries_by_status', {})
        rbs[tag] = rbs.get(tag, 0) + 1
        _bump_retry(tag)
        _bump_model_retry(model, tag)
        _sleep((delay if delay is not None else min(8.0, 0.8 * (2 ** (attempt - 1)))) + random.uniform(0, 0.4))
    raise NimError(last_msg + f" Gave up after {meta['attempts']} attempts.", status=last_status, meta=meta,
                   retryable_exhausted=(last_status in RETRY_STATUSES or tag == 'timeout'))


def parse_json_object(text):
    """Extract the first JSON value from model text. Arrays are wrapped as {"items": [...]}.

    Returns a dict or raises ValueError."""
    if not isinstance(text, str):
        raise ValueError('Model returned no text content.')
    text = _THINK.sub('', text).strip()
    candidates = [m.group(1) for m in _FENCE.finditer(text)] + [text]
    decoder = json.JSONDecoder(parse_constant=lambda _: None)
    for candidate in candidates:
        for i, ch in enumerate(candidate):
            if ch not in '{[':
                continue
            try:
                value, _ = decoder.raw_decode(candidate, i)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                return value
            if isinstance(value, list):
                return {'items': value}
    raise ValueError('Model did not return a JSON object.')


def _add_usage(meta, usage):
    total = meta.setdefault('usage', {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0})
    if isinstance(usage, dict):
        for k in total:
            v = usage.get(k)
            if isinstance(v, int):
                total[k] += v


def chat_json(messages, *, model=None, base_url=None, max_tokens=2048, temperature=0.1, seed=None,
              thinking=False, max_thinking_tokens=1024, retries=2, timeout=90, fallback=True):
    """Chat completion that must yield a JSON object. Returns (obj, meta).

    meta = {model, requested_model, fallback_used, fallback_reason, ms, attempts, retries_by_status,
            finish_reason, usage, repaired}
    `model` in meta is the model that actually produced the answer. When the requested model exhausts its
    retries on 429/5xx/timeout (never on 400, length or invalid JSON), the request is sent once through
    NIM_FALLBACK_MODEL (default nvidia/nemotron-3.5-lightning-30b-a3b; empty disables) and meta says so.
    Raises NimError on transport failure, length truncation, or unparseable output after one repair.
    """
    if not isinstance(messages, list) or not messages:
        raise NimError('messages must be a non-empty list.')
    model = model or default_model()
    meta = {'model': model, 'requested_model': model, 'fallback_used': False, 'fallback_reason': None,
            'ms': 0, 'attempts': 0, 'retries_by_status': {}, 'finish_reason': None,
            'usage': {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}, 'repaired': False}
    started = time.monotonic()
    kwargs = dict(base_url=base_url, max_tokens=max_tokens, temperature=temperature, seed=seed, thinking=thinking,
                  max_thinking_tokens=max_thinking_tokens, retries=retries, timeout=timeout)
    try:
        try:
            return _chat_once(messages, model, meta, **kwargs), meta
        except NimError as exc:
            alt = fallback_model() if fallback else None
            if not (exc.retryable_exhausted and alt and alt != model):
                raise
            reason = (f'{model} exhausted retries (HTTP {exc.status})' if exc.status
                      else f'{model} exhausted retries (timeout)')
            _bump_model(model, 'fallback_triggered')
            meta.update(model=alt, fallback_used=True, fallback_reason=reason, repaired=False, finish_reason=None)
            try:
                obj = _chat_once(messages, alt, meta, **dict(kwargs, retries=min(int(retries), 1)))
            except NimError as exc2:
                exc2.meta = meta
                raise NimError(f'{exc} Fallback model {alt} also failed: {exc2}', status=exc2.status, meta=meta) from exc2
            _bump_model(alt, 'fallback_served')
            return obj, meta
    finally:
        meta['ms'] = int((time.monotonic() - started) * 1000)


def _chat_once(messages, model, meta, *, base_url, max_tokens, temperature, seed, thinking, max_thinking_tokens,
               retries, timeout):
    convo = list(messages)
    for repair in range(2):
        payload = {'model': model, 'messages': convo, 'temperature': temperature, 'max_tokens': max_tokens,
                   'response_format': {'type': 'json_object'}}
        if seed is not None:
            payload['seed'] = int(seed)
        if 'nemotron' in model:
            kwargs = {'enable_thinking': bool(thinking)}
            if thinking:
                kwargs['reasoning_budget'] = int(max_thinking_tokens)
            payload['chat_template_kwargs'] = kwargs
        body = _request('/chat/completions', payload, url_base=base_url, retries=retries, timeout=timeout, meta=meta)
        _add_usage(meta, body.get('usage') if isinstance(body, dict) else None)
        choices = body.get('choices') if isinstance(body, dict) else None
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise NimError('NVIDIA response has no completion.', meta=meta)
        choice = choices[0]
        meta['finish_reason'] = choice.get('finish_reason')
        if choice.get('finish_reason') == 'length':
            raise NimError('NVIDIA output reached its length limit.', meta=meta)
        content = (choice.get('message') or {}).get('content')
        try:
            return parse_json_object(content)
        except ValueError as exc:
            if repair:
                raise NimError('NVIDIA model returned invalid JSON after one repair attempt.', meta=meta) from exc
            meta['repaired'] = True
            convo = list(messages) + [
                {'role': 'assistant', 'content': (content or '')[:4000]},
                {'role': 'user', 'content': 'Your previous reply was not a valid JSON object. Reply again with only the JSON object, no prose.'}]
    raise NimError('unreachable', meta=meta)


def embed(texts, *, input_type='passage', model=DEFAULT_EMBED_MODEL, base_url=None, retries=2, timeout=60, batch=64):
    """Embed texts. Returns (vectors in input order, meta)."""
    if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
        raise NimError('texts must be a list of strings.')
    meta = {'model': model, 'ms': 0, 'attempts': 0, 'retries_by_status': {},
            'usage': {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}}
    started = time.monotonic()
    vectors = []
    try:
        for i in range(0, len(texts), batch):
            chunk = [t if t.strip() else ' ' for t in texts[i:i + batch]]
            payload = {'model': model, 'input': chunk, 'input_type': input_type, 'encoding_format': 'float', 'truncate': 'END'}
            body = _request('/embeddings', payload, url_base=base_url, retries=retries, timeout=timeout, meta=meta)
            _add_usage(meta, body.get('usage') if isinstance(body, dict) else None)
            data = body.get('data') if isinstance(body, dict) else None
            if not isinstance(data, list) or len(data) != len(chunk):
                raise NimError('NVIDIA embeddings response has the wrong shape.', meta=meta)
            data = sorted(data, key=lambda d: d.get('index', 0))
            for d in data:
                vec = d.get('embedding')
                if not isinstance(vec, list):
                    raise NimError('NVIDIA embeddings response is missing vectors.', meta=meta)
                vectors.append(vec)
    finally:
        meta['ms'] = int((time.monotonic() - started) * 1000)
    return vectors, meta
