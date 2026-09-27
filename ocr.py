"""Image OCR with NVIDIA nemotron-ocr-v2: self-hosted NIM first, hosted NIM as honest fallback.

Environment:
  NVIDIA_OCR_URL       self-hosted endpoint, e.g. http://127.0.0.1:8000/v1/infer (unset = hosted only)
  NVIDIA_OCR_LABEL     human label for the self-hosted endpoint, e.g. "NIM on Brev L4"
  NVIDIA_OCR_FALLBACK  "hosted" to retry once on the hosted endpoint after a connection error,
                       timeout or 5xx from the self-hosted endpoint; anything else disables fallback
  NVIDIA_OCR_TIMEOUT   self-hosted timeout in seconds (default 20)
  NVIDIA_OCR_API_KEY   optional bearer for the self-hosted endpoint (the Build key is never sent to it)
  NVIDIA_API_KEY       Build key, used only for the hosted endpoint

Every result carries endpoint_kind, latency_ms (measured wall clock of the HTTP call) and fallback_used.
"""
import base64
import collections
import io
import json
import os
import threading
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from PIL import Image, ImageOps

HOSTED_ENDPOINT = 'https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2'
DEFAULT_ENDPOINT = HOSTED_ENDPOINT  # kept for compatibility
HOSTED_LABEL = 'NVIDIA hosted'

_recent = collections.deque(maxlen=20)
_recent_lock = threading.Lock()


class _Transient(Exception):
    """Connection error, timeout or 5xx: eligible for fallback."""


def _is_hosted(endpoint):
    return urlparse(endpoint).hostname == 'ai.api.nvidia.com'


def _self_hosted_url():
    url = (os.getenv('NVIDIA_OCR_URL') or '').strip()
    return url if url and not _is_hosted(url) else None


def _fallback():
    return 'hosted' if (os.getenv('NVIDIA_OCR_FALLBACK') or '').strip().lower() == 'hosted' else None


def configuration():
    """Shape used by /api/health 'ocr'."""
    model = os.getenv('NVIDIA_OCR_MODEL', 'nvidia/nemotron-ocr-v2')
    local = _self_hosted_url()
    if local:
        return {'provider': 'Configured OCR service', 'label': os.getenv('NVIDIA_OCR_LABEL') or 'Self-hosted NIM',
                'model': model, 'configured': True, 'mode': 'self-hosted', 'fallback': _fallback(),
                'fallback_configured': bool(_fallback() and os.getenv('NVIDIA_API_KEY'))}
    return {'provider': 'NVIDIA hosted GPU', 'label': HOSTED_LABEL, 'model': model,
            'configured': bool(os.getenv('NVIDIA_API_KEY')), 'mode': 'hosted', 'fallback': None,
            'fallback_configured': False}


def recent_latencies():
    """Last 20 OCR calls, newest first: {at, endpoint_kind, latency_ms, fallback_used, ok}."""
    with _recent_lock:
        return list(reversed(_recent))


def _record(endpoint_kind, latency_ms, fallback_used, ok):
    with _recent_lock:
        _recent.append({'at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'endpoint_kind': endpoint_kind,
                        'latency_ms': latency_ms, 'fallback_used': fallback_used, 'ok': ok})


def _prepare(blob):
    # Decode and normalize, including EXIF orientation, before uploading.
    with Image.open(io.BytesIO(blob)) as original:
        if original.width * original.height > 30000000:
            raise ValueError('Image exceeds 30 megapixels. Resize before uploading.')
        original.load()
        image = ImageOps.exif_transpose(original).convert('RGB')
        if max(image.size) > 3200:
            image.thumbnail((3200, 3200))
        output = io.BytesIO()
        image.save(output, format='JPEG', quality=95)
        return base64.b64encode(output.getvalue()).decode('ascii'), image.size


def _call(endpoint, key, encoded, timeout):
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    payload = {'input': [{'type': 'image_url', 'url': 'data:image/jpeg;base64,' + encoded}], 'merge_levels': ['paragraph']}
    started = time.perf_counter()
    try:
        with urlopen(Request(endpoint, data=json.dumps(payload).encode(), headers=headers), timeout=timeout) as response:
            result = json.load(response)
    except HTTPError as error:
        ms = int((time.perf_counter() - started) * 1000)
        if error.code >= 500:
            raise _Transient(f'HTTP {error.code}', ms) from error
        raise ValueError(f'NVIDIA OCR returned HTTP {error.code}. Check OCR model access and quota.') from error
    except (URLError, TimeoutError, ConnectionError, OSError) as error:
        raise _Transient(type(error).__name__, int((time.perf_counter() - started) * 1000)) from error
    return result, int((time.perf_counter() - started) * 1000)


def _parse(result):
    data = result.get('data') if isinstance(result, dict) else None
    if not isinstance(data, list) or len(data) != 1:
        raise ValueError('OCR returned an invalid image result.')
    detections = data[0].get('text_detections')
    if not isinstance(detections, list):
        raise ValueError('OCR returned no text detections.')
    blocks = []
    for detection in detections:
        prediction = detection.get('text_prediction') or {}
        text = prediction.get('text')
        if isinstance(text, str) and text.strip():
            blocks.append({'text': text, 'bounding_box': detection.get('bounding_box'), 'ocr_confidence': prediction.get('confidence')})
    if not blocks:
        raise ValueError('No readable text detected in the image. Upload a sharper scan.')
    return blocks


def recognize(blob):
    encoded, (width, height) = _prepare(blob)
    model = os.getenv('NVIDIA_OCR_MODEL', 'nvidia/nemotron-ocr-v2')
    local = _self_hosted_url()
    attempts = []
    if local:
        attempts.append(('self-hosted', local, os.getenv('NVIDIA_OCR_API_KEY'), float(os.getenv('NVIDIA_OCR_TIMEOUT', '20')),
                         os.getenv('NVIDIA_OCR_LABEL') or 'Self-hosted NIM'))
        if _fallback() == 'hosted' and os.getenv('NVIDIA_API_KEY'):
            attempts.append(('hosted', HOSTED_ENDPOINT, os.getenv('NVIDIA_API_KEY'), 120, HOSTED_LABEL))
    else:
        endpoint = os.getenv('NVIDIA_OCR_URL') or HOSTED_ENDPOINT
        if not os.getenv('NVIDIA_API_KEY'):
            raise ValueError('NVIDIA_API_KEY is required for hosted GPU OCR.')
        attempts.append(('hosted', endpoint, os.getenv('NVIDIA_API_KEY'), 120, HOSTED_LABEL))
    failure = None
    for index, (kind, endpoint, key, timeout, label) in enumerate(attempts):
        fallback_used = index > 0
        try:
            result, ms = _call(endpoint, key, encoded, timeout)
        except _Transient as error:
            _record(kind, error.args[1] if len(error.args) > 1 else None, fallback_used, False)
            failure = f'{kind} OCR endpoint unavailable ({error.args[0]})'
            continue
        except ValueError:
            _record(kind, None, fallback_used, False)
            raise
        blocks = _parse(result)
        _record(kind, ms, fallback_used, True)
        return {'blocks': blocks, 'width': width, 'height': height, 'model': result.get('model') or model,
                'provider': label, 'endpoint_kind': kind, 'latency_ms': ms, 'fallback_used': fallback_used,
                'fallback_reason': failure if fallback_used else None}
    raise ValueError(f'OCR service is unavailable or timed out ({failure}). Retry after checking the connection.')
