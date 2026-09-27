// VARELQ · Stream A2 · Findings (#reliability) and Trace inspector (#reliability/trace/<id>).
// Real API only (PLAN.md §5): /api/reliability/latest, /analyze, /datasets, /traces/{id}.
import {
  esc, num, plural, ms, humanize, relTime, fmtArgs, badge, tag, sevTone, sourceTag, svgIcon, http, hashParts,
  sortSteps, flagList, initialFlag, markPolicy, traceTimeline, wireExpanders, scrollToEl,
} from '../components/trace-timeline.js';

export const meta = { title: 'Findings', group: 'reliability' };

const DATASET = 'agentrx-tau-retail';
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const OCC_PREVIEW = 8;

const S = {
  report: null, reportError: null, notFound: false, datasets: null,
  selected: null, busy: false, runError: null, showAllOcc: false,
  trace: null, traceError: null, traceId: null, flags: [], active: -1,
  imp: { open: false, fileName: '', rows: null, runs: 0, error: null, busy: false, result: null },
};

// ---------- imported agent logs (POST /api/agent-failures) ----------
const IMPORT_REQUIRED = ['trace_id', 'tool', 'status', 'message', 'agent_reply'];
const IMPORT_MAX_ROWS = 500;

/** Parse a .json array or .jsonl file into contract rows. Throws Error with a readable message. */
export function parseAgentLogs(text, fileName = '') {
  const src = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!src) throw new Error('The file is empty.');
  let rows;
  if (src.startsWith('[')) {
    try { rows = JSON.parse(src); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
  } else {
    rows = [];
    src.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      try { rows.push(JSON.parse(line)); } catch { throw new Error(`Line ${i + 1} is not valid JSON${/\.json$/i.test(fileName) ? ' (a .json file must be one array)' : ''}.`); }
    });
  }
  if (!Array.isArray(rows) || !rows.length) throw new Error('No trace rows found. Use a JSON array or one object per line.');
  if (rows.length > IMPORT_MAX_ROWS) throw new Error(`${num(rows.length)} rows; the limit is ${IMPORT_MAX_ROWS} per import. Split the file.`);
  const counts = new Map();
  const out = rows.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`Row ${i + 1} is not an object.`);
    const missing = IMPORT_REQUIRED.filter(k => typeof r[k] !== 'string');
    if (missing.length) throw new Error(`Row ${i + 1} is missing text field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
    if (!r.trace_id.trim()) throw new Error(`Row ${i + 1} has an empty trace_id.`);
    const row = { trace_id: r.trace_id.trim(), tool: r.tool, status: r.status, message: r.message, agent_reply: r.agent_reply };
    for (const k of ['user_message', 'timestamp', 'run_id']) if (typeof r[k] === 'string') row[k] = r[k];
    row.run_id = row.run_id || row.trace_id;
    counts.set(row.trace_id, (counts.get(row.trace_id) || 0) + 1);
    return row;
  });
  // One row per tool call: repeated trace_ids are steps of one run. Give each step a unique id and keep the run.
  const seen = new Map();
  out.forEach(row => {
    if (counts.get(row.trace_id) > 1) {
      const n = (seen.get(row.trace_id) || 0) + 1;
      seen.set(row.trace_id, n);
      row.trace_id = `${row.trace_id} · step ${n}`;
    }
  });
  return { rows: out, runs: new Set(out.map(r => r.run_id)).size };
}

function importPanel() {
  const I = S.imp;
  if (!I.open && !I.result) return '';
  const summary = I.rows ? `<p class="rl-caption">${esc(I.fileName)}: ${plural(I.rows.length, 'step', 'steps')} from ${plural(I.runs, 'run', 'runs')}.</p>` : '';
  const form = I.open ? `<section class="rl-panel rl-import" aria-label="Import agent logs">
    <div class="rl-panel-head"><h2>Import agent logs</h2><button type="button" class="rl-btn rl-btn--ghost" data-action="import-close">Close</button></div>
    <p class="rl-caption">A JSON array (.json) or one object per line (.jsonl). Each row is one tool call with text fields <strong>trace_id</strong>, <strong>tool</strong>, <strong>status</strong>, <strong>message</strong> (the tool result) and <strong>agent_reply</strong>; <strong>timestamp</strong> and <strong>user_message</strong> are optional. Rows that share a trace_id are steps of one run. Up to ${IMPORT_MAX_ROWS} rows. <a href="assets/examples/agent-logs-example.jsonl" download="agent-logs-example.jsonl">Download example</a></p>
    <div class="rl-import-row">
      <label class="rl-btn rl-btn--secondary rl-import-file">${svgIcon('upload', 16)}<span>${I.fileName ? 'Choose another file' : 'Choose file'}</span><input type="file" accept=".json,.jsonl,application/json" data-import-file class="rl-sr"></label>
      ${btn('Analyse with NVIDIA', { action: 'import-run', primary: true, busy: I.busy, disabled: !I.rows })}
    </div>
    ${summary}
    ${I.busy ? `<div class="rl-busy" role="status" aria-live="polite"><div class="rl-indeterminate" aria-hidden="true"></div><span>Nemotron is grouping recurring failures; every cited step is checked against your file…</span></div>` : ''}
    ${I.error ? errorRow(I.error) : ''}
  </section>` : '';
  return `${form}${I.result ? importResult(I.result) : ''}`;
}

function importResult(r) {
  const issues = Array.isArray(r.issues) ? r.issues : [];
  const cell = v => `<td>${esc(v || '—')}</td>`;
  const body = issues.map(g => `<article class="rl-import-group">
      <div class="rl-panel-head"><h3>${badge(g.severity, sevTone(g.severity))} ${esc(g.title)}</h3>
        <span class="rl-caption">${plural(g.run_count, 'run', 'runs')} affected${g.priority_score !== undefined ? ` · priority ${num(g.priority_score)}` : ''}</span></div>
      ${g.explanation ? `<p class="rl-import-text">${esc(g.explanation)}</p>` : ''}
      ${g.fix ? `<p class="rl-import-text"><span class="rl-muted">Suggested fix:</span> ${esc(g.fix)}</p>` : ''}
      <div class="rl-table-wrap"><table class="rl-table rl-import-table">
        <caption class="rl-sr">Cited steps for ${esc(g.title)}</caption>
        <thead><tr><th scope="col">Step</th><th scope="col">Tool</th><th scope="col">Status</th><th scope="col">Message</th><th scope="col">Agent reply</th></tr></thead>
        <tbody>${(g.evidence || []).map(e => `<tr>${cell(e.trace_id)}${cell(e.tool)}${cell(e.status)}${cell(e.message)}${cell(e.agent_reply)}</tr>`).join('')}</tbody>
      </table></div>
    </article>`).join('');
  const rejected = Number(r.rejected_groups) > 0 ? ` · ${plural(r.rejected_groups, 'model group', 'model groups')} dropped (unknown steps cited or only one run)` : '';
  return `<section class="rl-panel rl-import-result" aria-label="Imported logs analysis">
    <div class="rl-panel-head"><h2>Imported logs</h2><div class="rl-tags">${badge('Imported logs', 'info')}${tag('model', 'grouping, evidence-checked')}</div></div>
    <p class="rl-caption">${esc(r.source_label || 'Imported traces')} · ${plural(r.trace_count, 'step', 'steps')} analysed${r.model ? ` · ${esc(r.model)}` : ''}${rejected}</p>
    ${issues.length ? body : emptyState('No recurring failure across two or more runs was confirmed in these logs.')}
  </section>`;
}

function paintImport(root) {
  const slot = root.querySelector('[data-slot="import"]');
  if (slot) slot.innerHTML = importPanel();
}

async function readImportFile(root, file) {
  const I = S.imp;
  I.error = null; I.rows = null; I.runs = 0; I.fileName = file ? file.name : '';
  if (file) {
    try {
      if (!/\.(json|jsonl)$/i.test(file.name)) throw new Error('Choose a .json or .jsonl file.');
      if (file.size > 5e6) throw new Error('The file is larger than 5 MB.');
      const parsed = parseAgentLogs(await file.text(), file.name);
      I.rows = parsed.rows; I.runs = parsed.runs;
    } catch (e) { I.error = e.message; }
  }
  paintImport(root);
}

async function runImport(root) {
  const I = S.imp;
  if (I.busy || !I.rows) return;
  I.busy = true; I.error = null; paintImport(root);
  try {
    const res = await fetch('/api/agent-failures', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ logs: I.rows, source_label: `Imported logs: ${I.fileName}` }) });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) throw new Error((body && body.error) || `Analysis failed (HTTP ${res.status}).`);
    if (!body || !Array.isArray(body.issues)) throw new Error('The server returned an unreadable analysis.');
    I.result = body;
  } catch (e) {
    I.error = e && e.name === 'TypeError' ? 'The VARELQ server is not reachable.' : (e.message || 'Analysis failed.');
  } finally {
    I.busy = false;
    paintImport(root);
  }
}

// ---------- data shaping (pure) ----------
export function sortGroups(groups) {
  return [...(groups || [])].sort((a, b) => (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0)
    || (SEV_ORDER[String(a.severity).toLowerCase()] ?? 9) - (SEV_ORDER[String(b.severity).toLowerCase()] ?? 9)
    || String(a.group_id).localeCompare(String(b.group_id)));
}

export function priorityText(g) {
  if (g.priority_formula) return g.priority_formula;
  if (g.priority_score !== undefined) return `${g.severity} · ${num(g.runs_affected)} runs = ${num(g.priority_score)}`;
  return '–';
}

export function traceHref(traceId, stepId, groupId) {
  const q = new URLSearchParams();
  if (stepId !== undefined && stepId !== null) q.set('step', stepId);
  if (groupId) q.set('group', groupId);
  const qs = q.toString();
  return `#reliability/trace/${encodeURIComponent(traceId)}${qs ? '?' + qs : ''}`;
}

export function provenanceLabel(p) {
  if (!p) return null;
  const commit = p.commit ? String(p.commit).slice(0, 7) : '';
  return { text: `τ-bench (Sierra, ${p.license || 'MIT'}) via AgentRx (Microsoft, ${p.license || 'MIT'})${commit ? ' · ' + commit : ''}`, url: p.url || p.upstream || null, title: p.name || '' };
}

function isValidReport(r) {
  return r && r.kind === 'reliability' && Number(r.schema) === 2 && Array.isArray(r.groups);
}

// ---------- rendering helpers ----------
const cap = t => { const x = String(t || ''); return x.charAt(0).toUpperCase() + x.slice(1); };
function provChip(p) {
  const l = provenanceLabel(p);
  if (!l) return '';
  const inner = `<span class="rl-chip-text">${esc(l.text)}</span>${l.url ? svgIcon('external-link', 14) : ''}`;
  return l.url
    ? `<a class="rl-chip" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.title)}">${inner}</a>`
    : `<span class="rl-chip" title="${esc(l.title)}">${inner}</span>`;
}

function btn(label, { action, primary = false, disabled = false, busy = false, icon = null, extra = '' } = {}) {
  return `<button type="button" class="rl-btn ${primary ? 'rl-btn--primary' : 'rl-btn--secondary'}" data-action="${esc(action)}"${disabled || busy ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''} ${extra}>${busy ? '<span class="rl-spinner" aria-hidden="true"></span><span class="rl-working">Working…</span>' : `${icon ? svgIcon(icon, 16) : ''}<span>${esc(label)}</span>`}</button>`;
}

function emptyState(text, actionHtml = '') {
  return `<div class="rl-empty"><p>${esc(text)}</p>${actionHtml}</div>`;
}

function errorRow(text, action) {
  return `<div class="rl-error" role="alert">${svgIcon('alert-triangle', 16)}<span>${esc(text)}</span>${action ? `<button type="button" class="rl-btn rl-btn--ghost" data-action="${esc(action)}">Retry</button>` : ''}</div>`;
}

function header(title, chips, actions, desc = '') {
  return `<header class="rl-head"><div class="rl-head-text"><div class="rl-head-title"><h1>${esc(title)}</h1>${chips}</div>${desc ? `<p class="rl-head-meta">${esc(desc)}</p>` : ''}</div><div class="rl-head-actions">${actions}</div></header>`;
}

function evalStrip(r) {
  const e = r.evaluation || {};
  const d = e.definitions || {};
  const parts = [
    `<span><strong>${num(r.run_count)}</strong> runs</span>`,
    `<span><strong>${num(r.step_count)}</strong> steps</span>`,
    `<span><strong>${num(r.groups.length)}</strong> ${r.groups.length === 1 ? 'pattern' : 'patterns'}</span>`,
  ];
  if (e.runs_total !== undefined) {
    parts.push(`<span title="Runs with at least one flagged step">Flagged <strong>${num(e.runs_flagged)}/${num(e.runs_total)}</strong></span>`);
    parts.push(`<span title="${esc(d.divergent_step_hit || '')}">Hits the divergent write in <strong>${num(e.divergent_step_hits)}/${num(e.divergent_runs)}</strong></span>`);
    parts.push(`<span title="Flagged runs whose write calls match the reference: false positives at run level"><strong>${num(e.flagged_not_divergent)}</strong> flagged ${Number(e.flagged_not_divergent) === 1 ? 'run matches' : 'runs match'} the reference</span>`);
  }
  const meta = [];
  if (r.models && r.models.explain) meta.push(`Explain · ${esc(String(r.models.explain).replace(/^nvidia\//, ''))}`);
  if (r.timings_ms && r.timings_ms.total !== undefined) meta.push(`${ms(r.timings_ms.total)} total`);
  if (r.usage && r.usage.calls !== undefined) meta.push(plural(r.usage.calls, 'model call', 'model calls'));
  const retries = r.usage && r.usage.retries_by_status ? Object.entries(r.usage.retries_by_status).filter(([, n]) => n) : [];
  if (retries.length) meta.push(`Retries ${retries.map(([k, n]) => `${esc(k)}×${num(n)}`).join(', ')}`);
  if (r.created) meta.push(`Run ${esc(relTime(r.created))}`);
  return `<section class="rl-strip" aria-label="Evaluation">
    <div class="rl-strip-main">${parts.join('<span class="rl-sep" aria-hidden="true">·</span>')}</div>
    <div class="rl-strip-meta">${e.reference ? tag('deterministic', 'Held-out reference') : ''}<span class="rl-muted"${r.id ? ` title="Report ${esc(r.id)}"` : ''}>${meta.join(' · ')}</span></div>
  </section>`;
}

function groupsTable(groups, selectedId) {
  const rows = groups.map(g => {
    const sel = g.group_id === selectedId;
    return `<tr class="rl-row${sel ? ' rl-selected' : ''}" data-group="${esc(g.group_id)}" tabindex="0" aria-selected="${sel}">
      <td>${badge(g.severity, sevTone(g.severity))}</td>
      <td><div class="rl-pattern"><span class="rl-mono rl-muted">${esc(g.group_id)}</span> ${esc(g.title || humanize(g.pattern_id))}</div></td>
      <td>${g.detector === 'rule' ? tag('rule') : badge(humanize(g.detector), 'neutral')}</td>
      <td class="rl-num">${num(g.runs_affected)}</td>
      <td class="rl-num">${num(g.occurrences)}</td>
      <td class="rl-num rl-formula" title="${esc(priorityText(g))}">${g.priority_score !== undefined ? num(g.priority_score) : esc(priorityText(g))}</td>
    </tr>`;
  }).join('');
  return `<div class="rl-table-wrap"><table class="rl-table">
    <caption class="rl-sr">Failure patterns ranked by priority</caption>
    <thead><tr><th scope="col">Severity</th><th scope="col">Pattern</th><th scope="col">Detector</th><th scope="col" class="rl-num">Runs</th><th scope="col" class="rl-num">Occurrences</th><th scope="col" class="rl-num">Priority</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function tableFoot(r) {
  const bits = [];
  const p = r.priority;
  if (p && p.formula) {
    const w = p.weights ? Object.entries(p.weights).map(([k, v]) => `${k} ${v}`).join(', ') : '';
    bits.push(`Priority = ${esc(p.formula)}${w ? ` (${esc(w)})` : ''}`);
  }
  const zero = (r.rules_checked || []).filter(x => !Number(x.occurrences) && !(r.groups || []).some(g => g.group_id === x.group_id));
  if (zero.length) bits.push(`Also checked, no occurrences: ${zero.map(x => `<span class="rl-mono">${esc(x.group_id)}</span> ${esc(x.title || humanize(x.pattern_id))}`).join(' · ')}`);
  return bits.length ? `<div class="rl-table-foot">${bits.map(b => `<p class="rl-caption">${b}</p>`).join('')}</div>` : '';
}

function occurrenceList(g) {
  const items = g.items || [];
  if (!items.length) return emptyState('No occurrences recorded for this pattern.');
  const shown = S.showAllOcc ? items : items.slice(0, OCC_PREVIEW);
  const li = shown.map(it => `<li><a class="rl-occ" href="${esc(traceHref(it.trace_id, it.step_id, g.group_id))}">
      <div class="rl-occ-top"><span class="rl-mono">${esc(it.trace_id)}</span><span class="rl-mono rl-muted">step ${esc(it.step_id)}</span>
        ${it.matches_reference === true ? badge('In reference', 'neutral') : it.matches_reference === false ? badge('Not in reference', 'warning') : ''}
        ${svgIcon('chevron-right', 16)}</div>
      ${it.tool ? `<div class="rl-mono rl-occ-call"><span class="rl-tool">${esc(it.tool)}</span>(${esc(fmtArgs(it.args))})</div>` : ''}
      <div class="rl-occ-reason">${esc(it.reason || '')}</div>
      ${it.excerpt ? `<div class="rl-occ-excerpt rl-clamp-2">${esc(it.excerpt)}</div>` : ''}
    </a></li>`).join('');
  const more = items.length > OCC_PREVIEW ? `<button type="button" class="rl-btn rl-btn--ghost" data-action="toggle-occ">${S.showAllOcc ? 'Show fewer' : `Show all ${num(items.length)}`}</button>` : '';
  return `<ul class="rl-occ-list">${li}</ul>${more}`;
}

// Lab guards and the datasets (domains) they actually apply to. payment_precondition gates
// approve_payment in the supplier-payment lab; it is not a retail guard, so it is never linked from retail rules.
const LAB_GUARD_DATASETS = { payment_precondition: ['agent-lab'] };
function guardApplies(guardId, report) {
  const ds = report && report.dataset;
  return Boolean(guardId && ds && (LAB_GUARD_DATASETS[guardId] || []).includes(ds));
}
function cohesionValue(coh) {
  const v = coh.mean_pairwise_cosine !== undefined ? coh.mean_pairwise_cosine : coh.value;
  return typeof v === 'number' ? v.toFixed(2) : '';
}

function detailPanel(g, report) {
  if (!g) return `<aside class="rl-side">${emptyState('Select a pattern to see its evidence.')}</aside>`;
  const c = g.policy_clause;
  const guard = g.suggested_guard;
  const coh = g.cohesion;
  const hl = g.hand_labels; // optional, additive: {labelled, true_violations}
  return `<aside class="rl-side" aria-label="Pattern detail">
    <div class="rl-panel">
      <div class="rl-panel-head"><h2><span class="rl-label rl-h2-id">${esc(g.group_id)}</span>${esc(g.title || humanize(g.pattern_id))}</h2>
        <div class="rl-tags">${badge(g.severity, sevTone(g.severity))}${g.detector === 'rule' ? tag('rule') : ''}</div></div>
      <div class="rl-kv"><span class="rl-label">Priority</span><span class="rl-formula-lg">${esc(priorityText(g))}</span></div>
      <div class="rl-kv"><span class="rl-label">Affected</span><span>${plural(g.runs_affected, 'run', 'runs')} · ${plural(g.occurrences, 'occurrence', 'occurrences')}</span></div>
      ${hl && hl.labelled ? `<div class="rl-kv"><span class="rl-label">Hand-labelled precision</span><span class="rl-mono">${num(hl.true_violations)}/${num(hl.labelled)}</span></div>` : ''}
      ${g.rule_definition ? `<div class="rl-section"><div class="rl-section-head"><span class="rl-label">Rule</span>${tag('deterministic')}</div><p>${esc(g.rule_definition)}</p></div>` : ''}
      ${c && c.text ? `<div class="rl-section"><div class="rl-section-head"><span class="rl-label">Policy clause</span>${c.verified ? badge('Verified in policy', 'info') : badge('Offsets not verified', 'warning')}</div>
        <blockquote class="rl-quote">${esc(c.text)}</blockquote></div>` : ''}
      ${g.explanation ? `<div class="rl-section"><div class="rl-section-head"><span class="rl-label">Explanation</span>${sourceTag(g.explanation_source)}</div><p>${esc(g.explanation)}</p></div>` : ''}
      ${g.fix ? `<div class="rl-section"><div class="rl-section-head"><span class="rl-label">Suggested fix</span>${sourceTag(g.fix_source, 'fix')}</div><p>${esc(g.fix)}</p></div>` : ''}
      ${coh ? `<div class="rl-kv"><span class="rl-label">Cohesion</span><span title="${esc(coh.note || 'Mean pairwise cosine similarity of the occurrences')}"><span class="rl-mono">${esc(cohesionValue(coh))}</span>${typeof coh.min_pairwise_cosine === 'number' ? ` <span class="rl-muted">(min ${esc(coh.min_pairwise_cosine.toFixed(2))})</span>` : ''} <span class="rl-muted">similarity, not accuracy${coh.method ? ` · ${esc(coh.method)}` : ''}</span></span></div>` : ''}
      ${guard ? `<div class="rl-section"><div class="rl-section-head"><span class="rl-label">Suggested guard</span></div>
        <p>${esc(cap(guard.family))}</p>${guardApplies(guard.lab_guard_id, report) ? `<a class="rl-btn rl-btn--secondary" href="#lab?guard=${esc(encodeURIComponent(guard.lab_guard_id))}">${svgIcon('flask-conical', 16)}<span>Test the guard in the lab</span></a>` : `<p class="rl-muted">No lab guard for this rule yet.</p>`}</div>` : ''}
      <div class="rl-section"><div class="rl-section-head"><span class="rl-label">Occurrences</span>${tag('recorded')}</div>${occurrenceList(g)}</div>
    </div>
  </aside>`;
}

function replayPanel(r) {
  const x = r.replay;
  if (!x) return '';
  return `<section class="rl-panel rl-replay" aria-label="Replay">
    <div class="rl-panel-head"><h2>Replay of this guard over the recorded runs</h2><div class="rl-tags">${tag('deterministic')}</div></div>
    <p class="rl-muted">${esc(cap(x.guard_family))}</p>
    <div class="rl-metrics">
      <div class="rl-metric"><span class="rl-metric-label">Writes blocked</span><span class="rl-metric-value">${num(x.writes_blocked)}<span class="rl-of">/${num(x.writes_total)}</span></span></div>
      <div class="rl-metric"><span class="rl-metric-label">Divergent runs intercepted</span><span class="rl-metric-value">${num(x.divergent_runs_intercepted)}<span class="rl-of">/${num(x.divergent_runs)}</span></span></div>
      <div class="rl-metric rl-metric--warn"><span class="rl-metric-label">Reference-correct writes wrongly blocked</span><span class="rl-metric-value">${num(x.reference_writes_blocked)}<span class="rl-of">/${num(x.reference_writes_total)}</span></span></div>
    </div>
    ${byRule(x)}
    ${handLabelLine(r)}
    <p class="rl-caption">${esc(x.method || '')}</p>
    <a class="rl-btn rl-btn--secondary" href="#lab">${svgIcon('flask-conical', 16)}<span>Test a guard live in the lab</span></a>
  </section>`;
}

function handLabelLine(r) {
  const g = (r.groups || []).find((it) => it && it.hand_labels && it.hand_labels.labelled);
  if (!g) return '';
  const hl = g.hand_labels;
  return `<div class="rl-kv"><span class="rl-label">${esc(g.group_id)} precision (hand-labelled)</span><span class="rl-mono">${num(hl.true_violations)}/${num(hl.labelled)}</span></div>`;
}

function byRule(x) {
  const e = x.by_rule ? Object.entries(x.by_rule).filter(([, v]) => v && (v.writes_blocked || v.reference_writes_blocked || v.divergent_runs_intercepted)) : [];
  if (!e.length) return '';
  return `<ul class="rl-byrule">${e.map(([k, v]) => `<li><span class="rl-mono">${esc(k)}</span> alone: blocks ${num(v.writes_blocked)} ${Number(v.writes_blocked) === 1 ? 'write' : 'writes'} · intercepts ${num(v.divergent_runs_intercepted)} divergent ${Number(v.divergent_runs_intercepted) === 1 ? 'run' : 'runs'} · wrongly blocks ${num(v.reference_writes_blocked)} reference-correct ${Number(v.reference_writes_blocked) === 1 ? 'write' : 'writes'}</li>`).join('')}</ul>`;
}

function limitationsBlock(list) {
  if (!list || !list.length) return '';
  return `<details class="rl-details"><summary>${svgIcon('chevron-right', 16)}Limitations (${num(list.length)})</summary><ul class="rl-bullets">${list.map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>`;
}

function rawBlock(id) {
  return `<details class="rl-details" data-raw="${esc(id)}"><summary>${svgIcon('chevron-right', 16)}View raw</summary><pre class="rl-raw" data-raw-target></pre></details>`;
}

// ---------- Findings ----------
async function loadFindings() {
  S.reportError = null; S.notFound = false;
  const [rep, ds] = await Promise.allSettled([
    http(`/api/reliability/latest?dataset=${encodeURIComponent(DATASET)}`),
    S.datasets ? Promise.resolve(S.datasets) : http('/api/reliability/datasets'),
  ]);
  if (ds.status === 'fulfilled') S.datasets = ds.value;
  if (rep.status === 'fulfilled') {
    if (isValidReport(rep.value)) S.report = rep.value;
    else { S.report = null; S.notFound = true; }
  } else if (rep.reason && rep.reason.status === 404) {
    S.report = null; S.notFound = true;
  } else {
    S.reportError = rep.reason ? rep.reason.message : 'Could not load findings.';
  }
}

function datasetInfo() {
  const list = S.datasets && S.datasets.datasets;
  return list ? list.find(d => d.id === DATASET) : null;
}

function findingsHtml() {
  const r = S.report;
  const ds = datasetInfo();
  const prov = (r && r.provenance && r.provenance.url ? r.provenance : null) || (ds && ds.provenance) || (r && r.provenance);
  const stub = (r && r.stub) || (S.datasets && S.datasets.stub);
  const chips = `${r ? tag('recorded') : ''}${stub ? tag('stub') : ''}`;
  const action = r
    ? btn('Re-run analysis', { action: 'analyze', busy: S.busy, icon: 'rotate-ccw' })
    : btn('Run analysis', { action: 'analyze', primary: true, busy: S.busy, icon: 'play' });
  const desc = r ? `Failure patterns in ${plural(r.run_count, 'recorded τ-bench run', 'recorded τ-bench runs')}.` : 'Failure patterns in recorded τ-bench runs.';
  const importBtn = btn('Import agent logs', { action: 'import-open', icon: 'upload' });
  const head = `${header('Findings', r ? chips : `${provChip(prov)}${chips}`, `${importBtn}${action}`, desc)}<div data-slot="import">${importPanel()}</div>`;
  const runDetails = `<details class="rl-details rl-run-details"><summary>${svgIcon('chevron-right', 14)}Run details</summary><div class="rl-run-details-body">${provChip(prov) ? `<div class="rl-tags">${provChip(prov)}</div>` : ''}${r ? evalStrip(r) : ''}</div></details>`;
  const busyLine = S.busy ? `<div class="rl-busy" role="status" aria-live="polite"><div class="rl-indeterminate" aria-hidden="true"></div><span>Running rules over ${ds ? plural(ds.runs, 'recorded run', 'recorded runs') : 'the recorded runs'} and asking Nemotron to explain each group…</span></div>` : '<div class="rl-busy" role="status" aria-live="polite"></div>';
  const runErr = S.runError ? errorRow(S.runError, 'analyze') : '';
  if (S.reportError && !r) return `${head}${busyLine}${errorRow(S.reportError, 'reload')}`;
  if (!r) return `${head}${busyLine}${runErr}${emptyState(`No analysis yet for ${ds ? ds.title : 'the τ-bench retail runs'}.`, S.busy ? '' : btn('Run analysis', { action: 'analyze', primary: true, icon: 'play' }))}`;
  const groups = sortGroups(r.groups);
  if (!S.selected || !groups.some(g => g.group_id === S.selected)) S.selected = groups[0] ? groups[0].group_id : null;
  const g = groups.find(x => x.group_id === S.selected);
  return `${head}${busyLine}${runErr}
    <div class="rl-split">
      <section class="rl-main" aria-label="Failure patterns">
        <div class="rl-panel rl-panel--flush">${groups.length ? groupsTable(groups, S.selected) : emptyState('No failure patterns were flagged in this run.')}${tableFoot(r)}</div>
        ${runDetails}
        ${replayPanel(r)}
        ${limitationsBlock(r.limitations)}
        ${rawBlock('report')}
      </section>
      <div class="rl-side-slot" data-slot="detail">${detailPanel(g, r)}</div>
    </div>`;
}

function selectGroup(root, id) {
  if (!S.report || id === S.selected) return;
  S.selected = id; S.showAllOcc = false;
  root.querySelectorAll('.rl-row[data-group]').forEach(tr => {
    const on = tr.dataset.group === id;
    tr.classList.toggle('rl-selected', on);
    tr.setAttribute('aria-selected', String(on));
  });
  const g = S.report.groups.find(x => x.group_id === id);
  const slot = root.querySelector('[data-slot="detail"]');
  if (slot) slot.innerHTML = detailPanel(g, S.report);
  try { history.replaceState(null, '', `#reliability?group=${encodeURIComponent(id)}`); } catch { /* ignore */ }
  if (window.innerWidth < 1100 && slot) scrollToEl(slot);
}

async function runAnalysis(root, ctx) {
  if (S.busy) return;
  S.busy = true; S.runError = null;
  const repaint = () => { if (currentMode === 'findings') paint(root, findingsHtml()); };
  repaint();
  try {
    const rep = await http('/api/reliability/analyze', { dataset: DATASET, explain: true });
    if (isValidReport(rep)) { S.report = rep; S.notFound = false; }
    else await loadFindings();
    if (ctx && ctx.toast) ctx.toast(`Analysis complete: ${plural((S.report && S.report.groups.length) || 0, 'pattern', 'patterns')}`, 'success');
  } catch (e) {
    S.runError = `Analysis failed: ${e.message}`;
  } finally {
    S.busy = false;
    repaint();
  }
}

// ---------- Trace inspector ----------
async function loadTrace(id) {
  S.traceId = id; S.trace = null; S.traceError = null;
  try {
    S.trace = await http(`/api/reliability/traces/${encodeURIComponent(id)}`);
  } catch (e) {
    S.traceError = e.status === 404 ? 'notfound' : e.message;
  }
}

function activeClause(t) {
  const f = S.flags[S.active];
  return f ? f.flag.policy_clause : null;
}

function flagCard(t) {
  const f = S.flags[S.active];
  if (!f) return `<div class="rl-panel">${emptyState('No steps were flagged in this trace.', '<a class="rl-btn rl-btn--secondary" href="#reliability">Back to findings</a>')}</div>`;
  const step = (t.steps || []).find(s => String(s.step_id) === f.step_id) || {};
  return `<div class="rl-panel" aria-live="polite">
    <div class="rl-panel-head"><h2>Flag ${num(S.active + 1)} of ${num(S.flags.length)}</h2><div class="rl-tags">${badge(f.flag.severity, sevTone(f.flag.severity))}${tag('rule')}</div></div>
    <div class="rl-kv"><span class="rl-label">Pattern</span><span><span class="rl-mono">${esc(f.flag.group_id || '')}</span> ${esc(humanize(f.flag.pattern_id))}</span></div>
    <div class="rl-kv"><span class="rl-label">Step</span><span class="rl-mono">${esc(f.step_id)}${step.name ? ` · ${esc(step.name)}` : ''}</span></div>
    ${step.kind === 'tool_call' ? `<div class="rl-mono rl-occ-call"><span class="rl-tool">${esc(step.name)}</span>(${esc(fmtArgs(step.args))})</div>` : ''}
    <div class="rl-kv"><span class="rl-label">Reason</span><span>${esc(f.flag.reason || '')}</span></div>
  </div>`;
}

function policyPanel(t) {
  const c = activeClause(t);
  const m = markPolicy(t.policy, c);
  const clauseText = m.marked ? String(t.policy).slice(c.start, c.end) : '';
  return `<div class="rl-panel" data-slot="policy">
    <div class="rl-panel-head"><h2>Policy</h2><div class="rl-tags">${m.marked ? badge(`Clause at ${num(c.start)}–${num(c.end)}`, 'info') : ''}</div></div>
    ${m.marked ? `<blockquote class="rl-quote">${esc(clauseText)}</blockquote>` : ''}
    <details class="rl-details" data-policy${m.marked ? ' open' : ''}><summary>${svgIcon('chevron-right', 16)}Full policy text</summary>
      <div class="rl-policy" tabindex="0" aria-label="Policy text">${m.html}</div></details>
  </div>`;
}

function traceHtml() {
  const id = S.traceId;
  const crumbs = `<nav class="rl-crumbs" aria-label="Breadcrumb"><a href="#reliability">Findings</a>${svgIcon('chevron-right', 14)}<span class="rl-mono">${esc(id)}</span></nav>`;
  if (S.traceError === 'notfound') return `${crumbs}${emptyState(`Trace ${id} was not found.`, '<a class="rl-btn rl-btn--secondary" href="#reliability">Back to findings</a>')}`;
  if (S.traceError) return `${crumbs}${errorRow(S.traceError, 'reload-trace')}`;
  const t = S.trace;
  const steps = sortSteps(t.steps);
  const chips = `${provChip(t.provenance)}${tag('recorded')}${t.stub ? tag('stub') : ''}`;
  const nav = S.flags.length > 1 ? `<div class="rl-flag-nav">
      ${btn('Previous flag', { action: 'prev-flag', icon: 'chevron-up' })}
      ${btn('Next flag', { action: 'next-flag', icon: 'chevron-down' })}</div>` : '';
  return `${crumbs}${header(`Trace ${id}`, chips, nav)}
    <div class="rl-strip"><div class="rl-strip-main"><span><strong>${num(steps.length)}</strong> steps</span><span class="rl-sep" aria-hidden="true">·</span><span><strong>${num(S.flags.length)}</strong> ${S.flags.length === 1 ? 'flag' : 'flags'}</span>${t.dataset ? `<span class="rl-sep" aria-hidden="true">·</span><span class="rl-mono rl-muted">${esc(t.dataset)}</span>` : ''}</div></div>
    <div class="rl-split">
      <section class="rl-main" aria-label="Timeline"><div class="rl-panel rl-panel--flush" data-slot="timeline">${traceTimeline(steps, { activeFlag: S.active })}</div>${rawBlock('trace')}</section>
      <div class="rl-side-slot"><aside class="rl-side rl-side--stack" aria-label="Flag and policy"><div data-slot="flag">${flagCard(t)}</div>${policyPanel(t)}</aside></div>
    </div>`;
}

function focusActive(root, { scroll = true } = {}) {
  const f = S.flags[S.active];
  if (!f) return;
  root.querySelectorAll('.rl-step.rl-active').forEach(el => { el.classList.remove('rl-active'); el.removeAttribute('aria-current'); });
  const el = root.querySelector(`.rl-step[data-step-id="${CSS.escape(f.step_id)}"]`);
  if (el) { el.classList.add('rl-active'); el.setAttribute('aria-current', 'step'); }
  root.querySelectorAll('.rl-flag.rl-flag--active').forEach(x => x.classList.remove('rl-flag--active'));
  const fe = root.querySelector(`.rl-flag[data-flag-index="${S.active}"]`);
  if (fe) fe.classList.add('rl-flag--active');
  const slot = root.querySelector('[data-slot="flag"]');
  if (slot && S.trace) slot.innerHTML = flagCard(S.trace);
  const pol = root.querySelector('[data-slot="policy"]');
  if (pol && S.trace) { pol.outerHTML = policyPanel(S.trace); }
  scrollPolicyToMark(root);
  if (scroll && el) scrollToEl(el);
  try { history.replaceState(null, '', `#reliability/trace/${encodeURIComponent(S.traceId)}?step=${encodeURIComponent(f.step_id)}${f.flag.group_id ? '&group=' + encodeURIComponent(f.flag.group_id) : ''}`); } catch { /* ignore */ }
}

function scrollPolicyToMark(root) {
  const box = root.querySelector('.rl-policy');
  const mark = root.querySelector('#rl-policy-mark');
  if (box && mark) box.scrollTop = Math.max(0, mark.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 24);
}

// ---------- module contract ----------
let currentMode = 'findings';

function paint(root, html) {
  // Never paint over another view if the user navigated away during an async action.
  if (!root || !root.isConnected || !root.querySelector('.rl-view')) return;
  root.innerHTML = `<div class="rl-view">${html}</div>`;
}

export async function render(ctx) {
  const { parts, query } = hashParts();
  if (parts[1] === 'trace' && parts[2]) {
    currentMode = 'trace';
    await loadTrace(parts[2]);
    if (S.trace) {
      S.flags = flagList(S.trace.steps);
      S.active = initialFlag(S.flags, { step: query.get('step'), group: query.get('group') });
    } else { S.flags = []; S.active = -1; }
    if (ctx && typeof ctx.setCrumb === 'function') ctx.setCrumb(`Trace ${parts[2]}`);
    return `<div class="rl-view">${traceHtml()}</div>`;
  }
  currentMode = 'findings';
  if (query.get('group')) S.selected = query.get('group');
  if (!S.busy) await loadFindings();
  return `<div class="rl-view">${findingsHtml()}</div>`;
}

export function mount(root, ctx) {
  const offExpand = wireExpanders(root);
  const onClick = async e => {
    const a = e.target.closest('[data-action]');
    const row = e.target.closest('.rl-row[data-group]');
    if (a && root.contains(a)) {
      const act = a.dataset.action;
      if (act === 'analyze') return runAnalysis(root, ctx);
      if (act === 'import-open') { S.imp.open = true; paintImport(root); const f = root.querySelector('.rl-import'); if (f) scrollToEl(f); return; }
      if (act === 'import-close') { S.imp.open = false; S.imp.error = null; return paintImport(root); }
      if (act === 'import-run') return runImport(root);
      if (act === 'reload') { await loadFindings(); return paint(root, findingsHtml()); }
      if (act === 'reload-trace') { await loadTrace(S.traceId); if (S.trace) { S.flags = flagList(S.trace.steps); S.active = initialFlag(S.flags, {}); } paint(root, traceHtml()); return focusActive(root); }
      if (act === 'toggle-occ') {
        S.showAllOcc = !S.showAllOcc;
        const slot = root.querySelector('[data-slot="detail"]');
        if (slot && S.report) slot.innerHTML = detailPanel(S.report.groups.find(x => x.group_id === S.selected), S.report);
        return;
      }
      if ((act === 'next-flag' || act === 'prev-flag') && S.flags.length) {
        S.active = (S.active + (act === 'next-flag' ? 1 : -1) + S.flags.length) % S.flags.length;
        return focusActive(root);
      }
    }
    if (row && root.contains(row)) return selectGroup(root, row.dataset.group);
    const flagEl = e.target.closest('.rl-flag[data-flag-index]');
    if (flagEl && root.contains(flagEl)) { S.active = Number(flagEl.dataset.flagIndex); focusActive(root, { scroll: false }); }
  };
  const onKey = e => {
    const row = e.target.closest && e.target.closest('.rl-row[data-group]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectGroup(root, row.dataset.group); }
  };
  const onToggle = e => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement)) return;
    if (d.dataset.raw !== undefined && d.open) {
      const pre = d.querySelector('[data-raw-target]');
      const obj = d.dataset.raw === 'trace' ? S.trace : S.report;
      if (pre && !pre.textContent) pre.textContent = JSON.stringify(obj, null, 2);
    }
    if (d.dataset.policy !== undefined && d.open) scrollPolicyToMark(root);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  root.addEventListener('toggle', onToggle, true);
  const onChange = e => {
    const input = e.target.closest && e.target.closest('[data-import-file]');
    if (input && root.contains(input)) readImportFile(root, input.files && input.files[0]);
  };
  root.addEventListener('change', onChange);
  if (currentMode === 'trace' && S.flags.length) requestAnimationFrame(() => focusActive(root));
  return () => {
    offExpand();
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
    root.removeEventListener('toggle', onToggle, true);
    root.removeEventListener('change', onChange);
  };
}
