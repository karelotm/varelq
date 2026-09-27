"""Image OCR via NVIDIA hosted GPU NIM or a configured self-hosted endpoint."""
import base64
import io
import json
import os
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from PIL import Image, ImageOps

DEFAULT_ENDPOINT = 'https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2'


def configuration():
    endpoint = os.getenv('NVIDIA_OCR_URL', DEFAULT_ENDPOINT)
    hosted = urlparse(endpoint).hostname == 'ai.api.nvidia.com'
    return {'provider': 'NVIDIA hosted GPU' if hosted else 'Configured OCR service',
            'model': os.getenv('NVIDIA_OCR_MODEL', 'nvidia/nemotron-ocr-v2'),
            'configured': bool(os.getenv('NVIDIA_API_KEY')) if hosted else True,
            'mode': 'hosted' if hosted else 'self-hosted'}


def recognize(blob):
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
        width, height = image.size
    encoded = base64.b64encode(output.getvalue()).decode('ascii')
    endpoint = os.getenv('NVIDIA_OCR_URL', DEFAULT_ENDPOINT)
    hosted = urlparse(endpoint).hostname == 'ai.api.nvidia.com'
    key = os.getenv('NVIDIA_API_KEY') if hosted else os.getenv('NVIDIA_OCR_API_KEY')
    if hosted and not key:
        raise ValueError('NVIDIA_API_KEY is required for hosted GPU OCR.')
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    payload = {'input': [{'type': 'image_url', 'url': 'data:image/jpeg;base64,' + encoded}], 'merge_levels': ['paragraph']}
    try:
        with urlopen(Request(endpoint, data=json.dumps(payload).encode(), headers=headers), timeout=120) as response:
            result = json.load(response)
    except HTTPError as error:
        raise ValueError(f'NVIDIA OCR returned HTTP {error.code}. Check OCR model access and quota.') from error
    except (URLError, TimeoutError) as error:
        raise ValueError('OCR service is unavailable or timed out. Retry after checking the connection.') from error
    data = result.get('data')
    if not isinstance(data, list) or len(data) != 1:
        raise ValueError('OCR returned an invalid image result.')
    detections = data[0].get('text_detections')
    if not isinstance(detections, list):
        raise ValueError('OCR returned no text detections.')
    blocks = []
    for detection in detections:
        prediction = detection.get('text_prediction', {})
        text = prediction.get('text')
        if isinstance(text, str) and text.strip():
            blocks.append({'text': text, 'bounding_box': detection.get('bounding_box'), 'ocr_confidence': prediction.get('confidence')})
    if not blocks:
        raise ValueError('No readable text detected in the image. Upload a sharper scan.')
    return {'blocks': blocks, 'width': width, 'height': height,
            'model': result.get('model', configuration()['model']), 'provider': configuration()['provider']}
