// Execution history: every recorded run of every kind (document analyses, reliability reports, lab batches), newest first.
import { esc, num, ms, relTime, dateTime, shortModel, humanize, plural } from '../format.js';
import { icon } from '../icons.js';
import { panel } from '../components/panel.js';
import { segmented } from '../components/segmented.js';
import { badge } from '../components/badge.js';
import { empty, errorState, retryButton } from '../components/empty.js';

export const meta = { title: 'Execution history', group: 'reliability' };

const KINDS = [
  { value: 'all', label: 'All' },
  { value: 'documents', label: 'Documents' },
  { value: 'reliability', label: 'Reliability' },
  { value: 'lab', label: 'Guard lab' },
];
const KIND_LABEL = { documents: 'Document analysis', reliability: 'Reliability analysis', lab: 'Guard lab batch' };
const KIND_ICON = { documents: 'file-text', reliability: 'shield-alert', lab: 'flask-conical' };

let entries = [];

function modelFromProvenance(p) {
  const m = /\(([a-z0-9._-]+\/[a-z0-9._-]+)/i.exec(String(p || ''));
  return m ? m[1] : null;
}

/** Normalise runs and lab batches into one list: {id, kind, created, source, status, error, model, fallback, duration, href}. */
export function historyEntries(runs, batches) {
  const out = [];
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || !r.kind) continue;
    const failed = r.status !== 'success';
    let source; let model = r.model || null; let duration = null; let href = null;
    if (r.kind === 'documents') {
      source = failed ? 'Document analysis' : [r.invoice_reference, r.supplier].filter(Boolean).join(' · ') || 'Invoice';
      if (!failed) href = `#cases/${encodeURIComponent(r.id)}`;
    } else if (r.kind === 'reliability') {
      source = r.source_label || humanize(r.dataset || 'dataset');
      if (!model && r.models) model = r.models.explain || null;
      duration = r.timings_ms && Number.isFinite(Number(r.timings_ms.total)) ? Number(r.timings_ms.total) : null;
      if (!failed) href = '#reliability';
    } else {
      source = humanize(r.kind);
    }
    if (r.timings_ms && duration === null && Number.isFinite(Number(r.timings_ms.total))) duration = Number(r.timings_ms.total);
    out.push({
      id: r.id, kind: r.kind, created: r.created, source,
      status: failed ? 'failed' : 'success',
      error: failed ? String(r.error || 'The run failed without an error message.') : null,
      model, fallback: r.fallback_used ? (r.fallback_reason || 'Fallback model used') : null,
      duration, durationNote: null, href,
    });
  }
  for (const b of Array.isArray(batches) ? batches : []) {
    if (!b || !b.batch_id) continue;
    const s = b.summary || {};
    const runsN = Number(s.runs) || 0;
    const errors = Number(s.errors) || 0;
    const incomplete = Number(s.incomplete) || 0;
    let status = 'success';
    if (!runsN) status = 'empty';
    else if (errors >= runsN) status = 'failed';
    else if (errors || incomplete) status = 'partial';
    out.push({
      id: b.batch_id, kind: 'lab', created: b.created,
      source: `${b.scenario_id || 'Scenario'} · ${b.variant === 'guarded' || (b.guards && b.guards.length) ? 'guarded' : 'baseline'} · ${plural(runsN, 'run', 'runs')}`,
      status,
      error: status === 'failed' || status === 'partial' ? `${plural(errors, 'run errored', 'runs errored')}${incomplete ? `, ${num(incomplete)} incomplete` : ''}` : null,
      model: b.model || modelFromProvenance(b.provenance) || (b.live === false ? 'Recorded replay' : null),
      fallback: null,
      duration: Number.isFinite(Number(s.duration_ms_median)) && s.duration_ms_median !== null ? Number(s.duration_ms_median) : null,
      durationNote: 'median per run',
      href: '#lab',
    });
  }
  return out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

function statusPill(e) {
  if (e.status === 'failed') return badge('Failed', 'danger');
  if (e.status === 'partial') return badge('Partial', 'warning');
  if (e.status === 'empty') return badge('No runs', 'neutral');
  return badge('Succeeded', 'success');
}

function historyTable(kind) {
  const rows = kind === 'all' ? entries : entries.filter((e) => e.kind === kind);
  if (!rows.length) return `<div class="table-empty">${empty('No runs of this kind yet.', '<button type="button" class="btn btn-ghost btn-sm" data-action="show-all">Show all</button>')}</div>`;
  const body = rows.map((e) => `<tr${e.status === 'failed' ? ' class="pages-row-failed"' : ''}>
  <td><span class="pages-kind">${icon(KIND_ICON[e.kind] || 'history', 16)}<span>${esc(KIND_LABEL[e.kind] || humanize(e.kind))}</span></span></td>
  <td><span class="clamp-2">${esc(e.source)}</span></td>
  <td><div class="pages-status">${statusPill(e)}${e.error ? `<span class="pages-error${e.status === 'failed' ? '' : ' is-soft'} clamp-2" title="${esc(e.error)}">${esc(e.error)}</span>` : ''}</div></td>
  <td>${e.model ? `<span class="nowrap" title="${esc(e.model)}">${esc(shortModel(e.model))}</span>` : '<span class="subtle">—</span>'}${e.fallback ? ` ${badge('Fallback', 'warning', { title: e.fallback })}` : ''}</td>
  <td class="align-right">${e.duration !== null ? `<span class="tabular nowrap">${esc(ms(e.duration))}</span>${e.durationNote ? `<div class="subtle text-xs nowrap">${esc(e.durationNote)}</div>` : ''}` : '<span class="subtle">—</span>'}</td>
  <td class="align-right"><span class="nowrap subtle" title="${esc(dateTime(e.created))}">${esc(relTime(e.created))}</span></td>
  <td class="align-right">${e.href ? `<a class="btn btn-ghost btn-sm" href="${esc(e.href)}" aria-label="Open ${esc(KIND_LABEL[e.kind] || '')} ${esc(e.source)}">Open</a>` : '<span class="subtle text-xs">No result</span>'}</td>
</tr>`).join('');
  return `<div class="table-wrap"><table class="table" aria-label="Execution history"><thead><tr>
<th scope="col">Kind</th><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Model</th><th scope="col" class="align-right">Duration</th><th scope="col" class="align-right">When</th><th scope="col" class="align-right"><span class="sr-only">Action</span></th>
</tr></thead><tbody>${body}</tbody></table></div>`;
}

async function settle(p) {
  try { return { ok: true, value: await p }; } catch (error) { return { ok: false, error }; }
}

export async function render(ctx) {
  const [runs, lab] = await Promise.all([
    settle(ctx.api.get('/api/runs')),
    settle(ctx.api.get('/api/lab/batches?limit=100')),
  ]);
  const head = `<div class="page-head"><div class="titles"><h1>Execution history</h1><div class="meta">Every recorded run, newest first: document analyses, reliability analyses and guard lab batches, including failures.</div></div></div>`;
  if (!runs.ok && !lab.ok) return `${head}<div class="panel">${errorState(runs.error.message, retryButton())}</div>`;
  entries = historyEntries(runs.ok ? runs.value.runs : [], lab.ok ? lab.value.batches : []);
  const partial = !runs.ok || !lab.ok
    ? `<div class="panel">${errorState(`${!runs.ok ? 'Analyses' : 'Lab batches'} could not be loaded: ${(!runs.ok ? runs.error : lab.error).message}`, retryButton())}</div>`
    : '';
  if (!entries.length) {
    return `${head}${partial}${panel({ title: 'Runs', body: empty('Nothing has run yet.', '<a class="btn btn-ghost btn-sm" href="#documents">Analyze documents</a>') })}`;
  }
  const want = ctx.query.get('kind');
  const kind = KINDS.some((k) => k.value === want) ? want : 'all';
  const counts = { all: entries.length };
  entries.forEach((e) => { counts[e.kind] = (counts[e.kind] || 0) + 1; });
  const failed = entries.filter((e) => e.status === 'failed').length;
  return `${head}${partial}
<div class="pages-toolbar">${segmented({ name: 'hist-kind', label: 'Filter by kind', value: kind, options: KINDS.map((k) => ({ value: k.value, label: `${k.label} ${counts[k.value] || 0}` })) })}${failed ? `<span class="subtle text-sm">${esc(plural(failed, 'failed run', 'failed runs'))}</span>` : ''}</div>
${panel({ title: 'Runs', count: num(entries.length), flush: true, body: `<div data-slot="history">${historyTable(kind)}</div>` })}`;
}

export function mount(root, ctx) {
  const apply = (value) => {
    const el = root.querySelector('[data-slot="history"]');
    if (el) el.innerHTML = historyTable(value);
  };
  const onChange = (e) => { if (e.target.matches('input[name="hist-kind"]')) apply(e.target.value); };
  const onClick = (e) => {
    if (e.target.closest('[data-action="retry"]')) { ctx.refresh(); return; }
    if (e.target.closest('[data-action="show-all"]')) {
      const all = root.querySelector('input[name="hist-kind"][value="all"]');
      if (all) { all.checked = true; all.focus(); }
      apply('all');
    }
  };
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  return () => { root.removeEventListener('change', onChange); root.removeEventListener('click', onClick); };
}
