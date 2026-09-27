import io
import json
import unittest
from unittest.mock import patch
from PIL import Image
from pypdf import PdfWriter
import ocr
import documents


class OCRTests(unittest.TestCase):
    def image(self):
        output = io.BytesIO()
        Image.new('RGB', (80, 40), 'white').save(output, format='PNG')
        return output.getvalue()

    def response(self, detections):
        return io.BytesIO(json.dumps({'data': [{'text_detections': detections}]}).encode())

    def test_custom_endpoint_does_not_receive_build_key(self):
        box = {'points': [{'x': 0.1, 'y': 0.2}]}
        detection = {'text_prediction': {'text': 'Total 9.00', 'confidence': 0.9}, 'bounding_box': box}
        with patch.dict('os.environ', {'NVIDIA_API_KEY': 'build-secret', 'NVIDIA_OCR_URL': 'http://127.0.0.1:8000/v1/ocr'}, clear=True):
            with patch.object(ocr, 'urlopen', return_value=self.response([detection])) as request:
                result = ocr.recognize(self.image())
        self.assertIsNone(request.call_args.args[0].get_header('Authorization'))
        self.assertEqual(result['blocks'][0]['bounding_box'], box)
        self.assertEqual(result['blocks'][0]['ocr_confidence'], 0.9)

    def detection(self):
        return {'text_prediction': {'text': 'Total 9.00', 'confidence': 0.9}, 'bounding_box': {'points': [{'x': 0.1, 'y': 0.2}]}}

    def test_self_hosted_success_reports_kind_latency_and_label(self):
        env = {'NVIDIA_API_KEY': 'build-secret', 'NVIDIA_OCR_URL': 'http://127.0.0.1:8000/v1/infer',
               'NVIDIA_OCR_LABEL': 'NIM on Brev L4', 'NVIDIA_OCR_FALLBACK': 'hosted'}
        with patch.dict('os.environ', env, clear=True):
            with patch.object(ocr, 'urlopen', return_value=self.response([self.detection()])) as request:
                result = ocr.recognize(self.image())
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0].full_url, 'http://127.0.0.1:8000/v1/infer')
        self.assertEqual((result['endpoint_kind'], result['fallback_used'], result['provider']), ('self-hosted', False, 'NIM on Brev L4'))
        self.assertIsInstance(result['latency_ms'], int)
        self.assertEqual(ocr.recent_latencies()[0]['endpoint_kind'], 'self-hosted')

    def test_tunnel_down_falls_back_to_hosted_once(self):
        from urllib.error import URLError
        env = {'NVIDIA_API_KEY': 'build-secret', 'NVIDIA_OCR_URL': 'http://127.0.0.1:8000/v1/infer', 'NVIDIA_OCR_FALLBACK': 'hosted'}
        calls = []

        def fake(request, timeout):
            calls.append((request.full_url, request.get_header('Authorization'), timeout))
            if '127.0.0.1' in request.full_url:
                raise URLError(ConnectionRefusedError())
            return self.response([self.detection()])
        with patch.dict('os.environ', env, clear=True):
            with patch.object(ocr, 'urlopen', side_effect=fake):
                result = ocr.recognize(self.image())
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][1:], (None, 20.0))  # Build key never sent to the self-hosted endpoint
        self.assertEqual(calls[1][0], ocr.HOSTED_ENDPOINT)
        self.assertEqual(calls[1][1], 'Bearer build-secret')
        self.assertTrue(result['fallback_used'])
        self.assertEqual(result['endpoint_kind'], 'hosted')
        self.assertIn('self-hosted OCR endpoint unavailable', result['fallback_reason'])
        recent = ocr.recent_latencies()
        self.assertEqual((recent[0]['endpoint_kind'], recent[0]['fallback_used'], recent[0]['ok']), ('hosted', True, True))
        self.assertEqual((recent[1]['endpoint_kind'], recent[1]['ok']), ('self-hosted', False))

    def test_no_fallback_without_opt_in(self):
        from urllib.error import URLError
        with patch.dict('os.environ', {'NVIDIA_API_KEY': 'k', 'NVIDIA_OCR_URL': 'http://127.0.0.1:8000/v1/infer'}, clear=True):
            with patch.object(ocr, 'urlopen', side_effect=URLError('down')) as request:
                with self.assertRaisesRegex(ValueError, 'unavailable'):
                    ocr.recognize(self.image())
        self.assertEqual(request.call_count, 1)

    def test_client_error_does_not_fall_back(self):
        from urllib.error import HTTPError
        env = {'NVIDIA_API_KEY': 'k', 'NVIDIA_OCR_URL': 'http://127.0.0.1:8000/v1/infer', 'NVIDIA_OCR_FALLBACK': 'hosted'}
        with patch.dict('os.environ', env, clear=True):
            with patch.object(ocr, 'urlopen', side_effect=HTTPError('u', 422, 'bad', {}, None)) as request:
                with self.assertRaisesRegex(ValueError, 'HTTP 422'):
                    ocr.recognize(self.image())
        self.assertEqual(request.call_count, 1)

    def test_configuration_shape(self):
        env = {'NVIDIA_OCR_URL': 'http://127.0.0.1:8000/v1/infer', 'NVIDIA_OCR_LABEL': 'NIM on Brev L4', 'NVIDIA_OCR_FALLBACK': 'hosted'}
        with patch.dict('os.environ', env, clear=True):
            config = ocr.configuration()
        self.assertEqual({k: config[k] for k in ('label', 'mode', 'fallback', 'configured')},
                         {'label': 'NIM on Brev L4', 'mode': 'self-hosted', 'fallback': 'hosted', 'configured': True})
        with patch.dict('os.environ', {}, clear=True):
            self.assertEqual((ocr.configuration()['mode'], ocr.configuration()['configured']), ('hosted', False))

    def test_recent_latencies_ring_buffer_holds_20(self):
        for i in range(25):
            ocr._record('hosted', i, False, True)
        recent = ocr.recent_latencies()
        self.assertEqual(len(recent), 20)
        self.assertEqual(recent[0]['latency_ms'], 24)

    def test_blank_ocr_fails_instead_of_inventing_text(self):
        with patch.dict('os.environ', {'NVIDIA_API_KEY': 'test'}, clear=True):
            with patch.object(ocr, 'urlopen', return_value=self.response([])):
                with self.assertRaisesRegex(ValueError, 'No readable text'):
                    ocr.recognize(self.image())

    def test_scan_limit_prevents_gpu_requests(self):
        writer = PdfWriter()
        for _ in range(6):
            writer.add_blank_page(width=100, height=100)
        output = io.BytesIO(); writer.write(output)
        with patch.object(ocr, 'recognize') as recognize:
            with self.assertRaisesRegex(ValueError, 'five OCR pages'):
                documents.read_source('scan.pdf', output.getvalue())
            recognize.assert_not_called()

    def test_scanned_pdf_renders_and_keeps_page_evidence(self):
        writer = PdfWriter(); writer.add_blank_page(width=100, height=100)
        output = io.BytesIO(); writer.write(output)
        with patch.object(ocr, 'recognize', return_value={'blocks': [{'text': 'Total 9.00'}], 'width': 200, 'height': 200}) as recognize:
            source = documents.read_source('scan.pdf', output.getvalue())
        self.assertTrue(recognize.call_args.args[0].startswith(b'\x89PNG'))
        self.assertEqual(source['lines']['p1:l1'], 'Total 9.00')
        self.assertEqual(source['ocr_pages'][0]['page'], 1)


if __name__ == '__main__':
    unittest.main()
