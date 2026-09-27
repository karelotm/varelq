"""nim.py tests with a patched transport; no network, no key needed."""
import io
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import nim


def completion(content, finish='stop', usage=None):
    return 200, {'choices': [{'message': {'content': content}, 'finish_reason': finish}],
                 'usage': usage or {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}}


def http_error(code):
    return HTTPError('https://x/chat/completions', code, 'err', {}, io.BytesIO(b'{"detail":"x"}'))


class Scripted:
    def __init__(self, *steps):
        self.steps = list(steps)
        self.payloads = []

    def __call__(self, url, payload, key, timeout):
        self.payloads.append(payload)
        step = self.steps.pop(0)
        if isinstance(step, BaseException):
            raise step
        return step


class NimTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'NVIDIA_API_KEY': 'test-not-a-key'})
        self.env.start()
        self.sleep = patch.object(nim, '_sleep', lambda s: None)
        self.sleep.start()

    def tearDown(self):
        self.sleep.stop()
        self.env.stop()

    def run_chat(self, *steps, **kw):
        fake = Scripted(*steps)
        with patch.object(nim, '_post', fake):
            obj, meta = nim.chat_json([{'role': 'user', 'content': 'hi'}], **kw)
        return obj, meta, fake

    def test_plain_object(self):
        obj, meta, fake = self.run_chat(completion('{"a": 1}'))
        self.assertEqual(obj, {'a': 1})
        self.assertEqual(meta['attempts'], 1)
        self.assertEqual(meta['usage']['total_tokens'], 15)
        self.assertEqual(fake.payloads[0]['response_format'], {'type': 'json_object'})
        self.assertEqual(fake.payloads[0]['chat_template_kwargs'], {'enable_thinking': False})

    def test_bare_array_is_wrapped(self):
        obj, _, _ = self.run_chat(completion('[{"x": 1}, {"x": 2}]'))
        self.assertEqual(obj, {'items': [{'x': 1}, {'x': 2}]})

    def test_prose_around_json(self):
        obj, _, _ = self.run_chat(completion('Sure! Here it is:\n{"ok": true, "n": [1,2]}\nHope that helps {not json}'))
        self.assertEqual(obj, {'ok': True, 'n': [1, 2]})

    def test_think_and_fence_stripped(self):
        obj, _, _ = self.run_chat(completion('<think>{"wrong": 1}</think>```json\n{"right": 2}\n```'))
        self.assertEqual(obj, {'right': 2})

    def test_length_raises(self):
        with self.assertRaises(nim.NimError):
            self.run_chat(completion('{"a": ', finish='length'))

    def test_503_then_200_counts_retry(self):
        obj, meta, _ = self.run_chat(http_error(503), completion('{"a": 1}'))
        self.assertEqual(obj, {'a': 1})
        self.assertEqual(meta['retries_by_status']['503'], 1)
        self.assertEqual(meta['attempts'], 2)

    def test_timeout_and_429_retried(self):
        obj, meta, _ = self.run_chat(TimeoutError(), http_error(429), completion('{"a": 1}'))
        self.assertEqual(meta['retries_by_status'], {'timeout': 1, '429': 1})

    def test_429_has_own_budget(self):
        obj, meta, _ = self.run_chat(http_error(429), http_error(429), http_error(429), http_error(429), http_error(503), http_error(503), completion('{"a": 1}'))
        self.assertEqual(meta['retries_by_status'], {'429': 4, '503': 2})
        with self.assertRaises(nim.NimError) as ctx:
            self.run_chat(*[http_error(429)] * 7)
        self.assertEqual(ctx.exception.status, 429)

    def test_process_stats_accumulate(self):
        before = nim.stats()
        self.run_chat(http_error(503), completion('{"a": 1}'))
        after = nim.stats()
        self.assertEqual(after['requests'] - before['requests'], 1)
        self.assertEqual(after['attempts'] - before['attempts'], 2)
        self.assertEqual(after['retries_by_status'].get('503', 0) - before['retries_by_status'].get('503', 0), 1)

    def test_retries_exhausted(self):
        with self.assertRaises(nim.NimError) as ctx:
            self.run_chat(http_error(503), http_error(503), http_error(503))
        self.assertEqual(ctx.exception.status, 503)

    def test_400_not_retried(self):
        with self.assertRaises(nim.NimError) as ctx:
            self.run_chat(http_error(400), completion('{"a": 1}'))
        self.assertEqual(ctx.exception.status, 400)

    def test_one_repair_retry(self):
        obj, meta, fake = self.run_chat(completion('no json here'), completion('{"fixed": 1}'))
        self.assertEqual(obj, {'fixed': 1})
        self.assertTrue(meta['repaired'])
        self.assertEqual(meta['usage']['total_tokens'], 30)
        self.assertEqual(fake.payloads[1]['messages'][-1]['role'], 'user')

    def test_repair_fails(self):
        with self.assertRaises(nim.NimError):
            self.run_chat(completion('nope'), completion('still nope'))

    def test_seed_and_thinking(self):
        _, _, fake = self.run_chat(completion('{}'), seed=3, thinking=True, max_thinking_tokens=512)
        self.assertEqual(fake.payloads[0]['seed'], 3)
        self.assertEqual(fake.payloads[0]['chat_template_kwargs'], {'enable_thinking': True, 'reasoning_budget': 512})

    def test_connection_error(self):
        with self.assertRaises(nim.NimError):
            self.run_chat(URLError('refused'), URLError('refused'), URLError('refused'))

    def test_not_configured(self):
        with patch.dict(os.environ, {'NVIDIA_API_KEY': ''}):
            self.assertFalse(nim.configured())
            with self.assertRaises(nim.NimError):
                nim.chat_json([{'role': 'user', 'content': 'x'}])

    def test_embed_orders_by_index(self):
        body = (200, {'data': [{'index': 1, 'embedding': [0.0, 1.0]}, {'index': 0, 'embedding': [1.0, 0.0]}],
                      'usage': {'prompt_tokens': 4, 'total_tokens': 4}})
        fake = Scripted(body)
        with patch.object(nim, '_post', fake):
            vecs, meta = nim.embed(['a', 'b'], input_type='query')
        self.assertEqual(vecs, [[1.0, 0.0], [0.0, 1.0]])
        self.assertEqual(fake.payloads[0]['input_type'], 'query')
        self.assertEqual(meta['usage']['prompt_tokens'], 4)


if __name__ == '__main__':
    unittest.main()
