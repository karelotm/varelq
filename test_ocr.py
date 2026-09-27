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
