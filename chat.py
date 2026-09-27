"""Ask VARELQ: grounded chat over saved records.

The model sees only a compact digest built here from storage (document runs, the latest reliability
report, guard-lab batches, supplier aggregates). Arithmetic is done in code and written into the digest.
Every [id] the model cites is checked against the digest; unknown ids are stripped and reported.
Nothing is stored: questions and answers are not persisted.
"""
import re
from decimal import Decimal, InvalidOperation

import nim
import storage

MAX_QUESTION = 1000
MAX_HISTORY = 6
MAX_HISTORY_CONTENT = 2000
MAX_DIGEST = 12_000
MAX_DOC_RUNS = 40
MAX_FINDINGS_PER_RUN = 8
MAX_LAB_BATCHES = 20
ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:\-]{0,63}$')
BRACKET_RE = re.compile(r'\[([^\[\]\n]{1,200})\]')

SYSTEM = """You are VARELQ's records assistant. Answer ONLY from the DIGEST below, which lists the user's saved records.
Rules:
- Every fact you state must come from the digest. Put the record's id in square brackets right after the fact, using the exact ids from the digest. Example: "Acme has 3 discrepancies [SUP1] and the top failure pattern is [R1]." An answer without inline [id] citations is invalid.
- Never invent ids, numbers, suppliers, or records. Totals and counts are precomputed in the digest; quote them, do not recompute.
- If the digest does not contain the answer, say plainly that your saved records do not show it, and suggest what to look at instead.
- Be concise: at most about 150 words. Plain paragraphs; use lines starting with "- " for lists; **bold** sparingly. No headings, no tables, no code.
- Reply with a JSON object: {"answer": "<text with inline [id] citations>", "cited_ids": ["<id>", ...]}."""


def _dec(value):
    try:
        d = Decimal(str(value))
        return d if d.is_finite() else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def _fmt(d):
    return format(d.quantize(Decimal('0.01')), 'f') if d is not None else '?'


def _clean(value, limit=80):
    text = ' '.join(str(value if value is not None else '').split())
    return text[:limit]


def _scenario_titles():
    try:
        import agent_lab
        return {sid: (s.get('title') or '') for sid, s in agent_lab.SCENARIOS.items()}
    except Exception:
        return {}


def _lab_batches():
    try:
        import agent_lab
        return agent_lab.list_batches(MAX_LAB_BATCHES)
    except Exception:
        return []


def _short_ids(runs):
    """Map full run id -> citation token (8-char prefix, lengthened on collision)."""
    out, used = {}, set()
    for run in runs:
        rid = str(run.get('id') or '')
        for n in (8, 12, 32):
            tok = rid[:n]
            if tok and tok not in used:
                break
        used.add(tok)
        out[rid] = tok
    return out


def build_digest(runs=None, batches=None, scenario_titles=None):
    """Returns (digest_text, registry). registry: {citation_id: {id, kind, label, href}}."""
    if runs is None:
        runs = storage.list_runs(limit=300)
    if batches is None:
        batches = _lab_batches()
    if scenario_titles is None:
        scenario_titles = _scenario_titles()
    registry = {}
    lines = []

    docs = [r for r in runs if r.get('kind') == 'documents' and r.get('status') == 'success'][:MAX_DOC_RUNS]
    report = next((r for r in runs if r.get('kind') == 'reliability' and r.get('status') == 'success'
                   and r.get('schema') == 2), None)

    # ---- supplier aggregates (deterministic, in code)
    suppliers = {}
    for run in docs:
        name = _clean(run.get('supplier') or 'Unknown supplier')
        s = suppliers.setdefault(name, {'invoices': 0, 'totals': {}, 'differences': 0, 'pending': 0, 'runs': []})
        s['invoices'] += 1
        cur = _clean(run.get('currency') or '?', 8)
        amt = _dec(run.get('invoice_total'))
        if amt is not None:
            s['totals'][cur] = s['totals'].get(cur, Decimal(0)) + amt
        s['differences'] += len(run.get('findings') or [])
        if (run.get('decision') or 'pending') == 'pending':
            s['pending'] += 1
        s['runs'].append(run.get('id'))
    ranked = sorted(suppliers.items(), key=lambda kv: (-kv[1]['differences'], -kv[1]['invoices'], kv[0]))
    sup_ids = {}
    toks = _short_ids(docs)

    lines.append('SUPPLIERS (aggregated in code from saved invoices; ranked by discrepancies)')
    for i, (name, s) in enumerate(ranked, 1):
        sid = f'SUP{i}'
        sup_ids[name] = sid
        registry[sid] = {'id': sid, 'kind': 'supplier', 'label': name, 'href': '#suppliers'}
        totals = ', '.join(f'{_fmt(v)} {c}' for c, v in sorted(s['totals'].items())) or 'no total'
        lines.append(f'[{sid}] {name} | invoices {s["invoices"]} | invoiced total {totals} | discrepancies {s["differences"]}'
                     f' | pending review {s["pending"]} | runs {", ".join(toks[r] for r in s["runs"] if r in toks)}')
    if not ranked:
        lines.append('(none)')

    lines.append('')
    lines.append('DOCUMENT RUNS (invoice reconciliations, newest first; decision pending = still needs review)')
    for run in docs:
        rid = str(run.get('id'))
        tok = toks[rid]
        ref = _clean(run.get('invoice_reference') or 'no reference', 40)
        sup = _clean(run.get('supplier') or 'Unknown supplier')
        registry[tok] = {'id': tok, 'kind': 'document_run', 'label': f'Invoice {ref}', 'href': f'#cases/{rid}'}
        findings = run.get('findings') or []
        lines.append(f'[{tok}] invoice {ref} | supplier {sup} [{sup_ids.get(sup, "?")}] | total {_clean(run.get("invoice_total") or "?", 20)}'
                     f' {_clean(run.get("currency") or "", 8)} | decision {run.get("decision") or "pending"}'
                     f' | created {str(run.get("created") or "")[:10]} | discrepancies {len(findings)}'
                     f' | limitations {len(run.get("limitations") or [])}')
        for j, f in enumerate(findings[:MAX_FINDINGS_PER_RUN], 1):
            fid = f'{tok}-F{j}'
            title = _clean(f.get('title') or f.get('kind'), 70)
            registry[fid] = {'id': fid, 'kind': 'finding', 'label': title, 'href': f'#cases/{rid}'}
            lines.append(f'  [{fid}] {_clean(f.get("kind"), 40)} | {title} | observed {_clean(f.get("observed"), 20)}'
                         f' expected {_clean(f.get("expected"), 20)} delta {_clean(f.get("delta"), 20)} {_clean(f.get("unit"), 10)}'
                         f' | severity {_clean(f.get("severity"), 10)}')
        if len(findings) > MAX_FINDINGS_PER_RUN:
            lines.append(f'  (+{len(findings) - MAX_FINDINGS_PER_RUN} more discrepancies not listed)')
    if not docs:
        lines.append('(none)')

    lines.append('')
    if report:
        lines.append(f'AGENT RELIABILITY REPORT ({_clean(report.get("source_label"), 80)}; {report.get("run_count", "?")} failed runs analysed;'
                     f' priority = {_clean((report.get("priority") or {}).get("formula"), 60)}; highest priority = most urgent)')
        groups = sorted(report.get('groups') or [], key=lambda g: -(g.get('priority_score') or 0))
        for g in groups:
            gid = _clean(g.get('group_id') or g.get('pattern_id'), 40)
            if not ID_RE.match(gid) or gid in registry:
                continue
            registry[gid] = {'id': gid, 'kind': 'reliability_report', 'label': _clean(g.get('title'), 70), 'href': '#reliability'}
            lines.append(f'[{gid}] {_clean(g.get("title"), 90)} | severity {g.get("severity")} | runs affected {g.get("runs_affected")}'
                         f' | occurrences {g.get("occurrences")} | priority {_clean(g.get("priority_formula"), 50)}')
    else:
        lines.append('AGENT RELIABILITY REPORT: none saved')

    lines.append('')
    lines.append('GUARD LAB BATCHES (synthetic scenarios, recorded live agent runs; unsafe = unsafe payment approvals)')
    for b in batches[:MAX_LAB_BATCHES]:
        bid = _clean(b.get('batch_id'), 60)
        if not ID_RE.match(bid) or bid in registry:
            continue
        s = b.get('summary') or {}
        sc = _clean(b.get('scenario_id'), 10)
        title = _clean(scenario_titles.get(sc, ''), 60)
        variant = b.get('variant') or ('guarded' if b.get('guards') else 'baseline')
        registry[bid] = {'id': bid, 'kind': 'lab_batch', 'label': f'{sc} {variant}', 'href': '#lab'}
        lines.append(f'[{bid}] scenario {sc}{(" " + title) if title else ""} | {variant} guards {",".join(b.get("guards") or []) or "none"}'
                     f' | unsafe {s.get("unsafe", 0)}/{s.get("runs", 0)} runs | blocked calls {s.get("blocked_calls", 0)}'
                     f' | escalations {s.get("escalations", 0)} | errors {s.get("errors", 0)} | model {_clean(_model_of(b), 50)}')
    if not batches:
        lines.append('(none)')

    text = '\n'.join(lines)
    if len(text) > MAX_DIGEST:
        text = text[:MAX_DIGEST].rsplit('\n', 1)[0] + '\n(digest truncated)'
        registry = {k: v for k, v in registry.items() if f'[{k}]' in text}
    return text, registry


def _model_of(batch):
    prov = str(batch.get('provenance') or '')
    m = re.search(r'\(([^,)]+)', prov)
    return m.group(1) if m else 'unknown'


def validate_request(payload):
    if not isinstance(payload, dict):
        raise ValueError('Request body must be a JSON object.')
    question = payload.get('question')
    if not isinstance(question, str) or not question.strip():
        raise ValueError('Ask a question.')
    if len(question) > MAX_QUESTION:
        raise ValueError(f'Questions must be at most {MAX_QUESTION} characters.')
    history = payload.get('history', [])
    if history is None:
        history = []
    if not isinstance(history, list) or len(history) > MAX_HISTORY:
        raise ValueError(f'history must be a list of at most {MAX_HISTORY} messages.')
    clean = []
    for item in history:
        if not isinstance(item, dict) or item.get('role') not in ('user', 'assistant') or not isinstance(item.get('content'), str):
            raise ValueError('Each history message needs role user|assistant and string content.')
        clean.append({'role': item['role'], 'content': item['content'][:MAX_HISTORY_CONTENT]})
    return question.strip(), clean


def validate_citations(answer, cited_ids, registry):
    """Strip [id] tokens that are not in the registry. Returns (answer, citations, dropped)."""
    order, dropped = [], []

    def note(i):
        if i in registry:
            if i not in order:
                order.append(i)
        elif i not in dropped:
            dropped.append(i)

    def repl(m):
        parts = [p.strip() for p in re.split(r'[,;]', m.group(1))]
        if not parts or not all(ID_RE.match(p) for p in parts):
            return m.group(0)  # not a citation, e.g. prose in brackets
        for p in parts:
            note(p)
        return ''.join(f'[{p}]' for p in parts if p in registry)

    text = BRACKET_RE.sub(repl, str(answer or ''))
    text = re.sub(r'[ \t]+([.,;:])', r'\1', re.sub(r'[ \t]{2,}', ' ', text)).strip()
    for i in cited_ids if isinstance(cited_ids, list) else []:
        if isinstance(i, str) and ID_RE.match(i.strip()):
            note(i.strip())
    return text, [dict(registry[i]) for i in order], dropped


def answer(payload, *, llm=None):
    """POST /api/chat. Raises ValueError (400) or nim.NimError (503)."""
    question, history = validate_request(payload)
    digest, registry = build_digest()
    messages = [{'role': 'system', 'content': SYSTEM + '\n\nDIGEST\n' + digest}]
    messages += history
    messages.append({'role': 'user', 'content': question})
    if llm is None:
        if not nim.configured():
            raise nim.NimError('NVIDIA_API_KEY is not configured on the server.')
        obj, meta = nim.chat_json(messages, max_tokens=1200, temperature=0.1, thinking=False, timeout=60)
    else:
        obj, meta = llm(messages)
    raw = obj.get('answer') if isinstance(obj, dict) else None
    if not isinstance(raw, str) or not raw.strip():
        raise nim.NimError('The model returned no answer.', meta=meta)
    text, citations, dropped = validate_citations(raw, obj.get('cited_ids'), registry)
    return {
        'answer': text[:6000],
        'citations': citations,
        'dropped_citations': dropped,
        'model': str(meta.get('model') or ''),
        'fallback_used': bool(meta.get('fallback_used')),
        'latency_ms': int(meta.get('ms') or 0),
        'grounding': {'records': len(registry),
                      'note': f'Answer built from a {len(digest)}-character digest of {len(registry)} saved records; ids checked on the server.'},
    }
