"""Hardened NVIDIA NIM client (hosted build.nvidia.com or any OpenAI-compatible NIM).

The API key is read from the NVIDIA_API_KEY environment variable only. It is never
logged, echoed or included in errors or meta.
"""
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


def _record(meta_before_attempts, meta, failed):
    with _STATS_LOCK:
        _STATS['requests'] += 1
        _STATS['attempts'] += meta.get('attempts', 0) - meta_before_attempts
        _STATS['failures'] += int(failed)


def _bump_retry(tag):
    with _STATS_LOCK:
        rbs = _STATS['retries_by_status']
        rbs[tag] = rbs.get(tag, 0) + 1


class NimError(ValueError):
    """Model or transport failure. `status` is the final HTTP status, or None."""

    def __init__(self, message, status=None, meta=None):
        super().__init__(message)
        self.status = status
        self.meta = meta or {}


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
    try:
        body = _request_inner(path, payload, url_base=url_base, retries=retries, timeout=timeout, meta=meta)
    except NimError:
        _record(before, meta, True)
        raise
    _record(before, meta, False)
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
    while True:
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
        _sleep((delay if delay is not None else min(8.0, 0.8 * (2 ** (attempt - 1)))) + random.uniform(0, 0.4))
    raise NimError(last_msg + f" Gave up after {meta['attempts']} attempts.", status=last_status, meta=meta)


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
              thinking=False, max_thinking_tokens=1024, retries=2, timeout=90):
    """Chat completion that must yield a JSON object. Returns (obj, meta).

    meta = {model, ms, attempts, retries_by_status, finish_reason, usage, repaired}
    Raises NimError on transport failure, length truncation, or unparseable output after one repair.
    """
    if not isinstance(messages, list) or not messages:
        raise NimError('messages must be a non-empty list.')
    model = model or default_model()
    meta = {'model': model, 'ms': 0, 'attempts': 0, 'retries_by_status': {}, 'finish_reason': None,
            'usage': {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}, 'repaired': False}
    started = time.monotonic()
    convo = list(messages)
    try:
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
                return parse_json_object(content), meta
            except ValueError as exc:
                if repair:
                    raise NimError('NVIDIA model returned invalid JSON after one repair attempt.', meta=meta) from exc
                meta['repaired'] = True
                convo = list(messages) + [
                    {'role': 'assistant', 'content': (content or '')[:4000]},
                    {'role': 'user', 'content': 'Your previous reply was not a valid JSON object. Reply again with only the JSON object, no prose.'}]
    finally:
        meta['ms'] = int((time.monotonic() - started) * 1000)
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
