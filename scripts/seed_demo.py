"""Seed a VARELQ demo DB through the public HTTP API and print the numbers for the video and SUBMISSION.md.

Usage (server already running against the demo DB, key in its environment):
    python scripts/seed_demo.py --base http://127.0.0.1:8390 > seed-output.json

Public API only. Every value printed comes from a server response and carries its run or batch ID.
Progress goes to stderr; the JSON result goes to stdout. The API key is never read or sent by this script.
"""
import argparse
import concurrent.futures
import json
import random
import string
import sys
import time
import urllib.error
import urllib.request
import uuid

SCENARIOS = ('S0', 'S1', 'S3', 'S4')
GUARD = 'payment_precondition'


def log(*parts):
    print(*parts, file=sys.stderr, flush=True)


class Api:
    def __init__(self, base, timeout=180):
        self.base = base.rstrip('/')
        self.timeout = timeout

    def _open(self, req):
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.status, resp.read(), resp.headers.get('Content-Type', '')
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read(), exc.headers.get('Content-Type', '')

    def get(self, path):
        status, body, _ = self._open(urllib.request.Request(self.base + path))
        return status, _json(body)

    def get_bytes(self, path):
        status, body, ctype = self._open(urllib.request.Request(self.base + path))
        return status, body, ctype

    def post(self, path, payload):
        req = urllib.request.Request(self.base + path, data=json.dumps(payload).encode('utf-8'), method='POST',
                                     headers={'Content-Type': 'application/json'})
        status, body, _ = self._open(req)
        return status, _json(body)

    def post_form(self, path, fields, files):
        body, ctype = encode_multipart(fields, files)
        req = urllib.request.Request(self.base + path, data=body, method='POST', headers={'Content-Type': ctype})
        status, raw, _ = self._open(req)
        return status, _json(raw)


def _json(raw):
    try:
        return json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return {'error': 'non-JSON response', 'raw': raw[:200].decode('utf-8', 'replace')}


def encode_multipart(fields, files, boundary=None):
    """fields: {name: str}; files: {name: (filename, bytes, content_type)} -> (body, content_type)."""
    boundary = boundary or 'varelq-' + uuid.uuid4().hex
    out = []
    for name, value in fields.items():
        out += [f'--{boundary}\r\n'.encode(), f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                str(value).encode('utf-8'), b'\r\n']
    for name, (filename, blob, ctype) in files.items():
        out += [f'--{boundary}\r\n'.encode(),
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode(),
                f'Content-Type: {ctype}\r\n\r\n'.encode(), blob, b'\r\n']
    out.append(f'--{boundary}--\r\n'.encode())
    return b''.join(out), f'multipart/form-data; boundary={boundary}'


def new_batch_id(scenario, variant):
    tail = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f'seed-{scenario.lower()}-{variant[0]}-{int(time.time())}-{tail}'


# ---------------------------------------------------------------- steps

def seed_document(api, sample_id):
    status, manifest = api.get('/api/samples')
    if status != 200:
        return {'sample_id': sample_id, 'ok': False, 'error': f'GET /api/samples -> {status}: {manifest.get("error")}'}
    sample = next((s for s in manifest.get('samples', []) if s.get('id') == sample_id), None)
    if not sample:
        return {'sample_id': sample_id, 'ok': False, 'error': 'sample not in manifest'}
    files = {}
    for role, meta in sample.get('files', {}).items():
        url = meta.get('url') or f'/api/samples/{sample_id}/{role}'
        st, blob, ctype = api.get_bytes(url)
        if st != 200:
            return {'sample_id': sample_id, 'ok': False, 'error': f'GET {url} -> {st}'}
        files[role] = (meta.get('path', role).rsplit('/', 1)[-1], blob, meta.get('content_type') or ctype)
    t0 = time.monotonic()
    status, run = api.post_form('/api/documents/analyze', {'sample_id': sample_id}, files)
    ms = int((time.monotonic() - t0) * 1000)
    if status != 200:
        return {'sample_id': sample_id, 'ok': False, 'status': status, 'error': run.get('error'), 'wall_ms': ms}
    return {'sample_id': sample_id, 'ok': True, 'wall_ms': ms, **document_facts(run)}


def document_facts(run):
    inv = (run.get('sources') or {}).get('invoice') or {}
    pages = inv.get('ocr_pages') or []
    checks = run.get('checks') or []
    return {
        'run_id': run.get('id'),
        'status': run.get('status'),
        'ingestion': inv.get('ingestion'),
        'ocr': [{'page': p.get('page'), 'endpoint_kind': p.get('endpoint_kind'), 'latency_ms': p.get('latency_ms'),
                 'fallback_used': p.get('fallback_used'), 'provider': p.get('provider')} for p in pages],
        'differences': [c.get('id') for c in checks if c.get('status') == 'difference'],
        'has_qty_invoiced_vs_received': any(c.get('kind') == 'qty_invoiced_vs_received' and c.get('status') == 'difference'
                                            for c in checks),
        'line_boxes': len(inv.get('line_boxes') or {}),
        'invoice_total': run.get('invoice_total'), 'currency': run.get('currency'),
    }


def seed_reliability(api, runs, explain=True):
    out = []
    for i in range(runs):
        t0 = time.monotonic()
        status, rep = api.post('/api/reliability/analyze', {'dataset': 'agentrx-tau-retail', 'explain': explain})
        ms = int((time.monotonic() - t0) * 1000)
        ok = status == 200 and rep.get('status') == 'success'
        log(f'reliability {i + 1}/{runs}: {status} {rep.get("id") or rep.get("error")} {ms} ms')
        out.append({'ok': ok, 'status': status, 'wall_ms': ms, 'report': rep if ok else None,
                    'error': None if ok else rep.get('error')})
    return out


def run_batch(api, scenario, guarded, n):
    variant = 'guarded' if guarded else 'baseline'
    batch_id = new_batch_id(scenario, variant)
    guards = [GUARD] if guarded else []

    def one(index):
        st, body = api.post('/api/lab/run', {'scenario_id': scenario, 'guards': guards, 'batch_id': batch_id,
                                             'index': index})
        return index, st, body

    errors = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=n) as pool:
        for index, st, body in pool.map(one, range(n)):
            if st != 200:
                errors.append({'index': index, 'status': st, 'error': body.get('error')})
    status, batch = api.get(f'/api/lab/batches/{batch_id}')
    summary = batch.get('summary') if status == 200 else None
    log(f'lab {scenario} {variant}: batch {batch_id} -> {summary}')
    return {'batch_id': batch_id, 'scenario_id': scenario, 'variant': variant, 'summary': summary,
            'trace_ids': [r.get('trace_id') for r in (batch.get('runs') or [])] if status == 200 else [],
            'request_errors': errors}


# ---------------------------------------------------------------- summary

def _median(values):
    values = sorted(v for v in values if isinstance(v, (int, float)))
    if not values:
        return None
    mid = len(values) // 2
    return values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2


def summarize(documents, reliability, lab):
    """Turn raw seed results into the placeholder values used by DEMO.md and SUBMISSION.md."""
    ok_reports = [r['report'] for r in reliability if r.get('ok')]
    latest = ok_reports[-1] if ok_reports else {}
    groups = {g.get('group_id'): g for g in latest.get('groups') or []}
    r1 = groups.get('R1') or {}
    ev = latest.get('evaluation') or {}
    rp = latest.get('replay') or {}
    retries = {}
    for rep in ok_reports:
        for k, v in ((rep.get('usage') or {}).get('retries_by_status') or {}).items():
            retries[k] = retries.get(k, 0) + v
    signature = [sorted((g.get('group_id'), g.get('runs_affected'), g.get('occurrences')) for g in rep.get('groups') or [])
                 for rep in ok_reports]
    sources = sorted({g.get('explanation_source') for rep in ok_reports for g in rep.get('groups') or []} - {None})

    lab_by = {}
    for b in lab:
        lab_by.setdefault(b['scenario_id'], {})[b['variant']] = b

    def lab_val(scn, variant, key):
        s = ((lab_by.get(scn) or {}).get(variant) or {}).get('summary') or {}
        return s.get(key)

    three_way = next((d for d in documents if d.get('sample_id') == 'three-way-short-delivery'), {})
    ocr0 = (three_way.get('ocr') or [{}])[0] if three_way.get('ok') else {}

    return {
        'report_id': latest.get('id'),
        'R1 runs': r1.get('runs_affected'),
        'R1 occurrences': r1.get('occurrences'),
        'R1 priority_formula': r1.get('priority_formula'),
        'n': ev.get('runs_flagged'), 'm': ev.get('divergent_step_hits'), 'fp': ev.get('flagged_not_divergent'),
        'divergent_runs': ev.get('divergent_runs'),
        'b': rp.get('writes_blocked'), 'w': rp.get('writes_total'), 'k': rp.get('divergent_runs_intercepted'),
        'j': rp.get('reference_writes_blocked'),
        'analysis_success': f'{len(ok_reports)}/{len(reliability)}',
        'analysis_ids': [r['report'].get('id') if r.get('ok') else None for r in reliability],
        'analysis_ms_median': _median([(rep.get('timings_ms') or {}).get('total') for rep in ok_reports]),
        'analysis_wall_ms_median': _median([r.get('wall_ms') for r in reliability if r.get('ok')]),
        'retries_by_status_total': retries,
        'rule_groups_identical': len({json.dumps(s) for s in signature}) == 1 if signature else None,
        'explanation_sources': sources,
        'x': lab_val('S1', 'baseline', 'unsafe'), 'y': lab_val('S1', 'guarded', 'unsafe'),
        'x3': lab_val('S3', 'baseline', 'unsafe'), 'y3': lab_val('S3', 'guarded', 'unsafe'),
        'x4': lab_val('S4', 'baseline', 'unsafe'), 'y4': lab_val('S4', 'guarded', 'unsafe'),
        'a': lab_val('S0', 'baseline', 'legit_approvals'), "a'": lab_val('S0', 'guarded', 'legit_approvals'),
        'f': lab_val('S0', 'guarded', 'false_blocks'),
        'lab_batches': {f"{b['scenario_id']}/{b['variant']}": b['batch_id'] for b in lab},
        'ms': ocr0.get('latency_ms'), 'ocr_endpoint_kind': ocr0.get('endpoint_kind'),
        'ocr_fallback_used': ocr0.get('fallback_used'), 'three_way_run_id': three_way.get('run_id'),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--base', required=True, help='e.g. http://127.0.0.1:8390')
    ap.add_argument('--analysis-runs', type=int, default=5)
    ap.add_argument('--lab-runs', type=int, default=5)
    ap.add_argument('--scenarios', default=','.join(SCENARIOS))
    ap.add_argument('--skip-documents', action='store_true')
    ap.add_argument('--skip-reliability', action='store_true')
    ap.add_argument('--skip-lab', action='store_true')
    ap.add_argument('--no-explain', action='store_true', help='analysis without model calls (templates)')
    args = ap.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):  # Windows consoles default to cp1252; the output contains τ and ×
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    api = Api(args.base)

    status, health = api.get('/api/health')
    if status != 200:
        log(f'/api/health -> {status}; is the server running at {args.base}?')
        return 2
    log('health:', json.dumps({k: health.get(k) for k in ('nim_configured', 'model', 'modules', 'ocr')}))

    documents = []
    if not args.skip_documents:
        for sample_id in ('three-way-short-delivery', 'sroie-receipt-000'):
            doc = seed_document(api, sample_id)
            log(f'document {sample_id}: {doc.get("run_id") or doc.get("error")}')
            documents.append(doc)
    reliability = [] if args.skip_reliability else seed_reliability(api, args.analysis_runs, not args.no_explain)
    lab = []
    if not args.skip_lab:
        for scn in [s.strip() for s in args.scenarios.split(',') if s.strip()]:
            for guarded in (False, True):
                lab.append(run_batch(api, scn, guarded, args.lab_runs))

    result = {'seeded_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'base': args.base,
              'placeholders': summarize(documents, reliability, lab), 'documents': documents,
              'reliability': [{k: v for k, v in r.items() if k != 'report'} | {'id': (r.get('report') or {}).get('id')}
                              for r in reliability],
              'lab': lab}
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
