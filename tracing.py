"""Guard-lab tracing: its own SQLite tables beside storage.DB (storage.py is not modified).

Tables: lab_batches, lab_traces, lab_spans. Every value written is passed through
redact(), which strips Authorization/Bearer tokens, nvapi- keys and the literal values
of secret-looking environment variables.
"""
import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import storage

_SECRET_ENV = re.compile(r'(KEY|TOKEN|SECRET|PASSWORD|AUTH)', re.I)
_PATTERNS = [
    (re.compile(r'(?i)(authorization\s*[:=]\s*)("?)[^",}\s][^",}]*'), r'\1\2[redacted]'),
    (re.compile(r'(?i)bearer\s+[A-Za-z0-9._\-]+'), 'Bearer [redacted]'),
    (re.compile(r'nvapi-[A-Za-z0-9_\-]+'), 'nvapi-[redacted]'),
]

SCHEMA = [
    '''CREATE TABLE IF NOT EXISTS lab_batches (batch_id TEXT PRIMARY KEY, created TEXT, scenario_id TEXT,
       variant TEXT, guards TEXT)''',
    '''CREATE TABLE IF NOT EXISTS lab_traces (trace_id TEXT PRIMARY KEY, batch_id TEXT, idx INTEGER, created TEXT,
       scenario_id TEXT, variant TEXT, guards TEXT, model TEXT, status TEXT, outcome TEXT, run TEXT, final_answer TEXT)''',
    '''CREATE TABLE IF NOT EXISTS lab_spans (trace_id TEXT, seq INTEGER, span_id TEXT, kind TEXT, name TEXT,
       status TEXT, ms INTEGER, payload TEXT, PRIMARY KEY (trace_id, seq))''',
    'CREATE INDEX IF NOT EXISTS lab_traces_batch ON lab_traces(batch_id, idx)',
]


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _secret_values():
    return [v for k, v in os.environ.items() if v and len(v) >= 8 and _SECRET_ENV.search(k)]


def redact(value):
    """Redact credentials from any JSON-able value (returns a new value)."""
    if isinstance(value, dict):
        return {k: ('[redacted]' if str(k).lower() in ('authorization', 'api_key', 'apikey') else redact(v)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    if isinstance(value, str):
        for secret in _secret_values():
            if secret in value:
                value = value.replace(secret, '[redacted]')
        for pattern, repl in _PATTERNS:
            value = pattern.sub(repl, value)
        return value
    return value


def _dump(value):
    return json.dumps(redact(value), ensure_ascii=False, allow_nan=False, default=str)


@contextmanager
def connection():
    db_path = Path(storage.DB)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(db_path, timeout=30)
    try:
        with db:
            for statement in SCHEMA:
                db.execute(statement)
            yield db
    finally:
        db.close()


def ensure_batch(batch_id, scenario_id, variant, guards):
    """Create the batch on first use. A batch holds one scenario and one guard set."""
    with connection() as db:
        row = db.execute('SELECT scenario_id, variant, guards FROM lab_batches WHERE batch_id=?', (batch_id,)).fetchone()
        if row:
            if row[0] != scenario_id or json.loads(row[2]) != list(guards):
                raise ValueError(f'Batch {batch_id} already holds scenario {row[0]} with guards {json.loads(row[2])}.')
            return False
        db.execute('INSERT OR IGNORE INTO lab_batches VALUES (?,?,?,?,?)',
                   (batch_id, now(), scenario_id, variant, json.dumps(list(guards))))
        return True


def save_trace(trace, run, spans):
    """Persist one finished trace (header + run summary + spans) in a single transaction."""
    with connection() as db:
        db.execute('INSERT OR REPLACE INTO lab_traces VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', (
            trace['trace_id'], trace.get('batch_id'), trace.get('index'), trace.get('created') or now(),
            trace['scenario_id'], trace['variant'], json.dumps(trace['guards']), trace.get('model'),
            run.get('status'), run.get('outcome'), _dump(run), redact(run.get('final_answer') or '')))
        db.execute('DELETE FROM lab_spans WHERE trace_id=?', (trace['trace_id'],))
        db.executemany('INSERT INTO lab_spans VALUES (?,?,?,?,?,?,?,?)', [
            (trace['trace_id'], s['seq'], s['span_id'], s['kind'], s['name'], s['status'], int(s.get('ms') or 0), _dump(s))
            for s in spans])


def get_trace(trace_id):
    with connection() as db:
        row = db.execute('SELECT trace_id, batch_id, idx, created, scenario_id, variant, guards, model, status, outcome, run, final_answer '
                         'FROM lab_traces WHERE trace_id=?', (trace_id,)).fetchone()
        if not row:
            return None
        spans = [json.loads(r[0]) for r in db.execute('SELECT payload FROM lab_spans WHERE trace_id=? ORDER BY seq', (trace_id,))]
    run = json.loads(row[10])
    return {'trace_id': row[0], 'batch_id': row[1], 'index': row[2], 'created': row[3], 'scenario_id': row[4],
            'variant': row[5], 'guards': json.loads(row[6]), 'model': row[7], 'status': row[8], 'outcome': row[9],
            'synthetic': True, 'provenance': run.get('provenance'), 'run': run, 'spans': spans, 'final_answer': row[11]}


def get_batch_rows(batch_id):
    with connection() as db:
        head = db.execute('SELECT batch_id, created, scenario_id, variant, guards FROM lab_batches WHERE batch_id=?', (batch_id,)).fetchone()
        if not head:
            return None, []
        runs = [json.loads(r[0]) for r in db.execute('SELECT run FROM lab_traces WHERE batch_id=? ORDER BY idx, created', (batch_id,))]
    return {'batch_id': head[0], 'created': head[1], 'scenario_id': head[2], 'variant': head[3], 'guards': json.loads(head[4])}, runs


def list_batch_ids(limit=20):
    with connection() as db:
        return [r[0] for r in db.execute('SELECT batch_id FROM lab_batches ORDER BY created DESC LIMIT ?', (int(limit),))]
