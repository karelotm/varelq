"""Local run storage. Never stores credentials or uploaded document binaries."""
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from contextlib import contextmanager

DB = Path(os.environ.get('VARELQ_DB', Path(__file__).parent / 'data' / 'varelq.sqlite3'))


@contextmanager
def connection():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=15)
    try:
        with db:
            db.execute('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created TEXT, kind TEXT, status TEXT, payload TEXT)')
            yield db
    finally:
        db.close()


def now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def save(kind, status, payload):
    run = dict(payload, id=uuid4().hex, created=now_iso(), kind=kind, status=status)
    with connection() as db:
        db.execute('INSERT INTO runs VALUES (?,?,?,?,?)', (run['id'], run['created'], kind, status, json.dumps(run, allow_nan=False)))
    return run


def list_runs(limit=100):
    with connection() as db:
        return [json.loads(row[0]) for row in db.execute('SELECT payload FROM runs ORDER BY created DESC LIMIT ?', (int(limit),))]


def get_run(run_id):
    if not isinstance(run_id, str):
        return None
    with connection() as db:
        row = db.execute('SELECT payload FROM runs WHERE id=?', (run_id,)).fetchone()
    return json.loads(row[0]) if row else None


def latest_reliability(dataset, schema=2):
    """Newest successful reliability report of the given schema for a dataset, or None."""
    with connection() as db:
        rows = db.execute("SELECT payload FROM runs WHERE kind='reliability' AND status='success' ORDER BY created DESC")
        for (payload,) in rows:
            run = json.loads(payload)
            if run.get('schema') == schema and run.get('dataset') == dataset:
                return run
    return None


def decide(run_id, decision):
    if decision not in ('reviewed', 'needs_clarification'):
        raise ValueError('Choose reviewed or needs_clarification.')
    with connection() as db:
        row = db.execute('SELECT payload FROM runs WHERE id=?', (run_id,)).fetchone()
        if not row:
            raise ValueError('Investigation not found.')
        run = json.loads(row[0])
        if run['kind'] != 'documents' or run['status'] != 'success':
            raise ValueError('Only completed investigations can be reviewed.')
        run['decision'] = decision
        run.setdefault('decisions', []).append({'decision': decision, 'at': now_iso(), 'reviewer': 'Local operator'})
        db.execute('UPDATE runs SET payload=? WHERE id=?', (json.dumps(run), run_id))
    return run


def correct(run_id, payload):
    """Apply or revert a reviewer correction and re-run deterministic checks only (no model call).

    Raises LookupError for an unknown run, ValueError for bad input."""
    import documents
    from uuid import uuid4 as _uuid
    if not isinstance(payload, dict):
        raise ValueError('Request body must be a JSON object.')
    with connection() as db:
        row = db.execute('SELECT payload FROM runs WHERE id=?', (run_id,)).fetchone()
        if not row:
            raise LookupError('Run not found')
        run = json.loads(row[0])
        if run.get('kind') != 'documents' or run.get('status') != 'success' or not isinstance(run.get('fields'), dict):
            raise ValueError('Only completed investigations can be corrected.')
        fields = run.get('original_fields') or run['fields']
        corrections = run.setdefault('corrections', [])
        role = payload.get('role')
        if payload.get('revert') is True:
            if role not in documents.ROLES:
                raise ValueError('Role must be invoice, purchase_order or receiving_record.')
            path, _, _ = documents._locate(fields, role, payload.get('field'))
            active = [c for c in corrections if c['role'] == role and c['field'] == path and not c.get('reverted_at')]
            if not active:
                raise ValueError('No active correction for this field.')
            for c in active:
                c['reverted_at'] = now_iso()
        else:
            path, value, note = documents.validate_correction(fields, role, payload.get('field'), payload.get('value'), payload.get('note'))
            _, _, cell = documents._locate(fields, role, path)
            at = now_iso()
            for c in corrections:  # a new correction supersedes the previous one on the same field
                if c['role'] == role and c['field'] == path and not c.get('reverted_at'):
                    c['reverted_at'] = at
                    c['superseded'] = True
            corrections.append({'id': _uuid().hex[:12], 'role': role, 'field': path, 'original': cell.get('value'),
                                'value': value, 'note': note, 'by': 'Local operator', 'at': at})
        documents.recompute(run)
        run['checks_recomputed_at'] = now_iso()
        db.execute('UPDATE runs SET payload=? WHERE id=?', (json.dumps(run, allow_nan=False), run_id))
    return run
