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


def save(kind, status, payload):
    run = dict(payload, id=uuid4().hex, created=datetime.now(timezone.utc).isoformat(), kind=kind, status=status)
    with connection() as db:
        db.execute('INSERT INTO runs VALUES (?,?,?,?,?)', (run['id'], run['created'], kind, status, json.dumps(run, allow_nan=False)))
    return run


def list_runs():
    with connection() as db:
        return [json.loads(row[0]) for row in db.execute('SELECT payload FROM runs ORDER BY created DESC LIMIT 100')]


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
        run.setdefault('decisions', []).append({'decision': decision, 'at': datetime.now(timezone.utc).isoformat(), 'reviewer': 'Local operator'})
        db.execute('UPDATE runs SET payload=? WHERE id=?', (json.dumps(run), run_id))
    return run
