"""Run the VARELQ expanded evaluation against an already-running server and store raw responses.

Usage (server started separately, key only in the server's environment):
    python scripts/eval/run_eval.py --base http://127.0.0.1:8391 --out <dir>/raw [--only sroie,cord,synthetic] [--concurrency 1]

Posts /api/documents/analyze the same way scripts/seed_demo.py seed_document does (multipart, role -> file):
- SROIE and CORD receipts: invoice role only, no sample_id (they are not in the app's sample manifest).
- Synthetic three-way eval sets: all three roles fetched from /api/samples/<id>/<role>, posted with sample_id.
Each response is written to <out>/<dataset>__<id>.json together with wall time and HTTP status.
The script never reads or sends an API key. Existing raw files are skipped unless --force is given.
"""
import argparse
import concurrent.futures
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from seed_demo import Api, log  # noqa: E402

SROIE_DIR = ROOT / 'public-data' / 'sroie'
CORD_DIR = ROOT / 'public-data' / 'cord'


def jobs(selected):
    out = []
    if 'sroie' in selected:
        for key in sorted(SROIE_DIR.glob('[0-9][0-9][0-9].json')):
            rid = key.stem
            out.append(('sroie', rid, {'invoice': (f'receipt-{rid}.jpg', SROIE_DIR / f'receipt-{rid}.jpg', 'image/jpeg')}, None))
    if 'cord' in selected:
        for key in sorted(CORD_DIR.glob('receipt-[0-9][0-9][0-9].json')):
            rid = key.stem.split('-')[1]
            out.append(('cord', rid, {'invoice': (f'receipt-{rid}.jpg', CORD_DIR / f'receipt-{rid}.jpg', 'image/jpeg')}, None))
    if 'synthetic' in selected:
        manifest = json.loads((ROOT / 'sample-documents' / 'manifest.json').read_text(encoding='utf-8'))
        for s in manifest['samples']:
            if s['id'].startswith('eval-'):
                out.append(('synthetic', s['id'], None, s['id']))
    return out


def run_one(api, dataset, rid, files, sample_id):
    payload = {}
    if sample_id:  # same as seed_demo.seed_document: fetch each role through the public API
        status, manifest = api.get('/api/samples')
        sample = next((s for s in manifest.get('samples', []) if s.get('id') == sample_id), None) if status == 200 else None
        if not sample:
            return {'ok': False, 'status': status, 'error': 'sample not served by /api/samples'}
        for role, meta in sample.get('files', {}).items():
            url = meta.get('url') or f'/api/samples/{sample_id}/{role}'
            st, blob, ctype = api.get_bytes(url)
            if st != 200:
                return {'ok': False, 'status': st, 'error': f'GET {url} -> {st}'}
            payload[role] = (meta.get('path', role).rsplit('/', 1)[-1], blob, meta.get('content_type') or ctype)
        fields = {'sample_id': sample_id}
    else:
        for role, (name, path, ctype) in files.items():
            payload[role] = (name, path.read_bytes(), ctype)
        fields = {}
    t0 = time.monotonic()
    status, run = api.post_form('/api/documents/analyze', fields, payload)
    ms = int((time.monotonic() - t0) * 1000)
    return {'ok': status == 200 and isinstance(run, dict) and 'fields' in run, 'status': status, 'wall_ms': ms,
            'error': None if status == 200 else run.get('error'), 'response': run}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--out', required=True, help='directory for raw responses')
    ap.add_argument('--only', default='sroie,cord,synthetic')
    ap.add_argument('--concurrency', type=int, default=1, choices=(1, 2))
    ap.add_argument('--timeout', type=int, default=240)
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    api = Api(args.base, timeout=args.timeout)
    todo = [j for j in jobs(set(args.only.split(','))) if args.force or not (out / f'{j[0]}__{j[1]}.json').exists()]
    log(f'{len(todo)} documents to run against {args.base}')

    def task(job):
        dataset, rid, files, sample_id = job
        started = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        try:
            res = run_one(api, dataset, rid, files, sample_id)
        except Exception as exc:  # timeouts and connection errors are recorded, not fatal
            res = {'ok': False, 'status': None, 'error': f'{type(exc).__name__}: {exc}'}
        res.update({'dataset': dataset, 'id': rid, 'started_utc': started})
        (out / f'{dataset}__{rid}.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
        log(f'{dataset} {rid}: {res.get("status")} ok={res["ok"]} {res.get("wall_ms")} ms {res.get("error") or ""}')
        return res

    with concurrent.futures.ThreadPoolExecutor(args.concurrency) as pool:
        results = list(pool.map(task, todo))
    print(json.dumps({'ran': len(results), 'ok': sum(r['ok'] for r in results)}))


if __name__ == '__main__':
    main()
