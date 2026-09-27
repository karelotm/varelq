"""Convert recorded VARELQ guard-lab runs into the agent-log import format.

Usage: python build_agent_logs.py PATH/TO/varelq.sqlite3 [OUT.jsonl]

Reads lab_traces / lab_spans for the two demo batches (S4 baseline pressure probe,
S1 baseline HTTP run) and writes one JSON object per tool call:
trace_id, timestamp, tool, status, message, user_message, agent_reply.
trace_id is the run id and repeats for every step of that run.
"""
import json
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

BATCHES = ('b-probe-s4-b-fb59', 'b-http-s1-base')


def clip(text, limit):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= limit else text[:limit - 1] + '…'


def summary(span):
    if span.get('error'):
        return clip(span['error'], 400)
    out = span.get('output')
    if isinstance(out, dict):
        out = {k: v for k, v in out.items() if k != 'items'} if 'items' in out and len(json.dumps(out)) > 400 else out
    return clip(json.dumps(out, ensure_ascii=False) if not isinstance(out, str) else out, 400)


def convert(db_path):
    db = sqlite3.connect(db_path)
    rows = []
    traces = db.execute('SELECT trace_id, created, final_answer FROM lab_traces WHERE batch_id IN (?, ?) '
                        'ORDER BY batch_id DESC, idx', BATCHES).fetchall()
    for trace_id, created, final in traces:
        spans = [json.loads(p) for (p,) in db.execute('SELECT payload FROM lab_spans WHERE trace_id=? ORDER BY seq', (trace_id,))]
        start = datetime.fromisoformat(created.replace('Z', '+00:00'))
        user = next((s.get('input', {}).get('text', '') for s in spans if s.get('kind') == 'user'), '')
        elapsed = 0
        for i, span in enumerate(spans):
            elapsed += int(span.get('ms') or 0)
            if span.get('kind') != 'tool':
                continue
            nxt = next((s for s in spans[i + 1:] if s.get('kind') in ('llm', 'assistant')), None)
            reply = ''
            if nxt and nxt.get('kind') == 'llm':
                reply = (nxt.get('output') or {}).get('thought') or ''
            if not reply:
                reply = final or ''
            rows.append({
                'trace_id': trace_id,
                'timestamp': (start + timedelta(milliseconds=elapsed)).isoformat().replace('+00:00', 'Z'),
                'tool': span.get('name', ''),
                'status': span.get('status', ''),
                'message': summary(span),
                'user_message': clip(user, 600),
                'agent_reply': clip(reply, 600),
            })
    return rows


if __name__ == '__main__':
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).with_name('agent-logs-varelq-lab.jsonl')
    rows = convert(sys.argv[1])
    out.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')
    print(f'{len(rows)} rows from {len({r["trace_id"] for r in rows})} runs -> {out} ({len(json.dumps(rows))} chars)')
