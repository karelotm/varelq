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


class NimBase(unittest.TestCase):
    def setUp(self):
        # Fallback and client-side RPM limiter are off by default here; dedicated tests turn them on.
        self.env = patch.dict(os.environ, {'NVIDIA_API_KEY': 'test-not-a-key', 'NIM_FALLBACK_MODEL': '', 'NVIDIA_RPM_LIMIT': '0'})
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


class NimTests(NimBase):
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



PRIMARY, FALLBACK = 'nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3.5-lightning-30b-a3b'


class FallbackTests(NimBase):
    def setUp(self):
        super().setUp()
        self.fb = patch.dict(os.environ, {'NIM_FALLBACK_MODEL': FALLBACK})
        self.fb.start()
        nim._reset_usage()

    def tearDown(self):
        self.fb.stop()
        super().tearDown()

    def test_fallback_after_429_exhaustion(self):
        obj, meta, fake = self.run_chat(*([http_error(429)] * 7), completion('{"a": 2}'), model=PRIMARY)
        self.assertEqual(obj, {'a': 2})
        self.assertEqual([p['model'] for p in fake.payloads], [PRIMARY] * 7 + [FALLBACK])
        self.assertEqual(meta['model'], FALLBACK)
        self.assertEqual(meta['requested_model'], PRIMARY)
        self.assertTrue(meta['fallback_used'])
        self.assertIn('HTTP 429', meta['fallback_reason'])
        self.assertEqual(meta['attempts'], 8)
        usage = nim.usage()['models']
        self.assertEqual(usage[PRIMARY]['failures'], 1)
        self.assertEqual(usage[PRIMARY]['fallback_triggered'], 1)
        self.assertEqual(usage[FALLBACK]['successes'], 1)
        self.assertEqual(usage[FALLBACK]['fallback_served'], 1)
        self.assertEqual(usage[FALLBACK]['total_tokens'], 15)

    def test_fallback_after_503_and_timeout_exhaustion(self):
        _, meta, _ = self.run_chat(http_error(503), http_error(503), http_error(503), completion('{"a": 1}'))
        self.assertTrue(meta['fallback_used'])
        _, meta, _ = self.run_chat(TimeoutError(), TimeoutError(), TimeoutError(), completion('{"a": 1}'))
        self.assertTrue(meta['fallback_used'])
        self.assertIn('timeout', meta['fallback_reason'])

    def test_no_fallback_on_400(self):
        with self.assertRaises(nim.NimError) as ctx:
            self.run_chat(http_error(400), completion('{"a": 1}'), model=PRIMARY)
        self.assertEqual(ctx.exception.status, 400)
        self.assertNotIn(FALLBACK, nim.usage()['models'])

    def test_no_fallback_on_invalid_json_after_repair(self):
        with self.assertRaises(nim.NimError):
            self.run_chat(completion('nope'), completion('still nope'), completion('{"a": 1}'))

    def test_no_fallback_when_disabled_or_same_model(self):
        with patch.dict(os.environ, {'NIM_FALLBACK_MODEL': ''}):
            with self.assertRaises(nim.NimError):
                self.run_chat(http_error(503), http_error(503), http_error(503), completion('{"a": 1}'))
        with self.assertRaises(nim.NimError):
            self.run_chat(http_error(503), http_error(503), http_error(503), completion('{"a": 1}'), model=FALLBACK)

    def test_primary_success_meta(self):
        _, meta, _ = self.run_chat(completion('{"a": 1}'), model=PRIMARY)
        self.assertEqual((meta['model'], meta['requested_model'], meta['fallback_used']), (PRIMARY, PRIMARY, False))

    def test_both_fail_raises_with_meta(self):
        with self.assertRaises(nim.NimError) as ctx:
            self.run_chat(*([http_error(503)] * 3), http_error(503), http_error(503), model=PRIMARY)
        self.assertTrue(ctx.exception.meta['fallback_used'])
        self.assertIn('also failed', str(ctx.exception))


class LimiterTests(unittest.TestCase):
    def test_plan_wait_math(self):
        self.assertEqual(nim.plan_wait([], 100.0, 40), 0.0)
        self.assertEqual(nim.plan_wait([100.0] * 39, 100.0, 40), 0.0)
        self.assertAlmostEqual(nim.plan_wait([50.0] + [90.0] * 39, 100.0, 40), 10.0)
        self.assertAlmostEqual(nim.plan_wait([30.0, 50.0] + [90.0] * 39, 100.0, 40), 10.0)  # 30.0 already aged out
        self.assertAlmostEqual(nim.plan_wait([45.0, 50.0] + [90.0] * 39, 100.0, 40), 10.0)
        self.assertEqual(nim.plan_wait([100.0] * 99, 100.0, 0), 0.0)

    def test_acquire_waits_then_sends(self):
        clock = [1000.0]
        slept = []

        def sleep(s):
            slept.append(s)
            clock[0] += s
        nim._reset_usage()
        with patch.dict(os.environ, {'NVIDIA_RPM_LIMIT': '3', 'NVIDIA_RPM_MAX_WAIT_S': '120'}),                 patch.object(nim, '_monotonic', lambda: clock[0]), patch.object(nim, '_sleep', sleep):
            for _ in range(3):
                self.assertEqual(nim._acquire_slot(), 0)
            clock[0] += 10
            waited = nim._acquire_slot()
            self.assertGreaterEqual(waited, 50000)
            self.assertEqual(nim.usage()['last_60s'], 1)  # the first three aged out after the wait
            self.assertEqual(nim.usage()['limiter']['waits'], 1)
        nim._reset_usage()

    def test_acquire_wait_is_bounded(self):
        clock = [0.0]
        with patch.dict(os.environ, {'NVIDIA_RPM_LIMIT': '1', 'NVIDIA_RPM_MAX_WAIT_S': '2'}),                 patch.object(nim, '_monotonic', lambda: clock[0]), patch.object(nim, '_sleep', lambda s: None):
            nim._reset_usage()
            nim._acquire_slot()
            waited = nim._acquire_slot()
            self.assertLessEqual(waited, 2000)
            self.assertEqual(nim.usage()['limiter']['saturated'], 1)
        nim._reset_usage()

    def test_usage_shape(self):
        u = nim.usage()
        for key in ('rpm_limit', 'last_60s', 'headroom', 'limiter', 'models', 'totals', 'fallback_model', 'default_model'):
            self.assertIn(key, u)


if __name__ == '__main__':
    unittest.main()
