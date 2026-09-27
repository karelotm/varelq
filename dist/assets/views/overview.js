// Overview: headline tiles, top failure patterns, and the cases table (reconciliation runs).
import { esc, num, money, plural, relTime, humanize, ratio } from '../format.js';
import { icon } from '../icons.js';
import { table } from '../components/table.js';
import { panel } from '../components/panel.js';
import { severityBadge, decisionBadge, badge } from '../components/badge.js';
import { tag } from '../components/tag.js';
import { errorState, retryButton } from '../components/empty.js';

export const meta = { title: 'Overview', group: 'reconciliation' };

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

async function settle(promise) {
  try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error }; }
}

/** Distinct traces touched by Critical groups (exact count, no double counting across groups). */
export function criticalRuns(report) {
  if (!report || !Array.isArray(report.groups)) return null;
  const ids = new Set();
  let fallback = 0;
  for (const g of report.groups) {
    if (String(g.severity).toLowerCase() !== 'critical') continue;
    if (Array.isArray(g.items) && g.items.length) g.items.forEach((it) => ids.add(it.trace_id));
    else fallback = Math.max(fallback, Number(g.runs_affected) || 0);
  }
  return ids.size || fallback;
}

/** Pick the newest baseline and guarded batches for one scenario (prefers S1). */
export function labPair(batches) {
  if (!Array.isArray(batches) || !batches.length) return null;
  const done = batches.filter((b) => b && b.summary && b.summary.runs > 0);
  const byScenario = {};
  for (const b of done) {
    const s = (byScenario[b.scenario_id] ||= {});
    const v = b.variant || (b.guards && b.guards.length ? 'guarded' : 'baseline');
    if (!s[v] || String(b.created) > String(s[v].created)) s[v] = b;
  }
  // Show the pair where the guard made the largest measured difference (baseline unsafe minus guarded unsafe).
  // Ties keep the preferred order below, so a seeded demo with no difference anywhere still shows S1.
  let best = null;
  for (const id of [...new Set(['S1', 'S4', 'S3', 'S0', ...Object.keys(byScenario)])]) {
    const s = byScenario[id];
    if (!(s && s.baseline && s.guarded)) continue;
    const diff = (Number(s.baseline.summary.unsafe) || 0) - (Number(s.guarded.summary.unsafe) || 0);
    if (!best || diff > best.diff) best = { scenario: id, baseline: s.baseline, guarded: s.guarded, diff };
  }
  if (!best) return null;
  const { diff, ...pair } = best;
  return pair;
}

function tile({ label, value, sub = '', tags = '', href }) {
  const inner = `<div class="tile-label">${esc(label)}${tags}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}`;
  return href ? `<a class="tile" href="${esc(href)}">${inner}</a>` : `<div class="tile">${inner}</div>`;
}

export async function render(ctx) {
  const [rel, runs, lab] = await Promise.all([
    settle(ctx.api.get('/api/reliability/latest?dataset=agentrx-tau-retail')),
    settle(ctx.api.get('/api/runs')),
    settle(ctx.api.get('/api/lab/batches?limit=20')),
  ]);

  const report = rel.ok && rel.value && rel.value.schema === 2 ? rel.value : null;
  const groups = report && Array.isArray(report.groups) ? [...report.groups] : [];
  groups.sort((a, b) => (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0)
    || (SEV_RANK[String(a.severity).toLowerCase()] ?? 9) - (SEV_RANK[String(b.severity).toLowerCase()] ?? 9));

  const cases = runs.ok && Array.isArray(runs.value.runs) ? runs.value.runs.filter((r) => r.kind === 'documents' && r.status === 'success') : [];
  const pending = cases.filter((c) => (c.decision || 'pending') === 'pending').length;
  const pair = lab.ok ? labPair(lab.value.batches) : null;

  // Tiles
  const tiles = [
    tile({ label: 'Failure patterns', value: report ? num(groups.length) : '—', href: '#reliability',
      sub: report ? esc(report.source_label || 'Latest analysis') : 'No analysis yet', tags: report && report.stub ? tag('stub') : '' }),
    tile({ label: 'Critical runs', value: report ? num(criticalRuns(report)) : '—', href: '#reliability',
      sub: report ? `of ${esc(plural(report.run_count, 'run', 'runs'))} analysed` : 'Run the analysis in Findings' }),
    tile({ label: 'Cases pending', value: runs.ok ? num(pending) : '—', href: '#documents',
      sub: runs.ok ? `${esc(plural(cases.length, 'case', 'cases'))} in total` : 'Cases unavailable' }),
    pair
      ? tile({ label: `Unsafe approvals, ${pair.scenario}`, href: '#lab', tags: tag('synthetic'),
        value: `${esc(ratio(pair.baseline.summary.unsafe, pair.baseline.summary.runs))}<span class="unit">baseline</span> ${icon('arrow-right', 16, 'inline-arrow')} ${esc(ratio(pair.guarded.summary.unsafe, pair.guarded.summary.runs))}<span class="unit">guarded</span>`,
        sub: `False blocks ${esc(num(pair.guarded.summary.false_blocks ?? 0))} · paired lab batches` })
      : tile({ label: 'Guard lab', value: '—', href: '#lab', tags: tag('synthetic'), sub: 'No baseline and guarded pair yet' }),
  ].join('');

  // Top failure patterns
  let patternsBody;
  if (report) {
    patternsBody = table({
      ariaLabel: 'Top failure patterns',
      columns: [
        { key: 'severity', label: 'Severity', render: (g) => severityBadge(g.severity) },
        { key: 'title', label: 'Pattern', render: (g) => `<span class="clamp-2">${esc(g.title || humanize(g.pattern_id))}</span>` },
        { key: 'runs_affected', label: 'Runs', align: 'right', render: (g) => esc(num(g.runs_affected)) },
        { key: 'priority_score', label: 'Priority', align: 'right', render: (g) => `<span class="mono" title="${esc(g.priority_formula || '')}">${esc(num(g.priority_score))}</span>` },
      ],
      rows: groups.slice(0, 5),
      rowHref: (g) => `#reliability?group=${encodeURIComponent(g.group_id || '')}`,
      empty: 'No failure patterns in the latest analysis.',
    });
  } else if (rel.ok || (rel.error && rel.error.status === 404)) {
    patternsBody = `<div class="empty" role="status">${icon('circle-dashed', 16)}<span>No analysis yet.</span><a class="btn btn-ghost btn-sm" href="#reliability">Open findings</a></div>`;
  } else {
    patternsBody = errorState(rel.error.message, retryButton());
  }
  const patternsFoot = report
    ? `<div class="row wrap">${tag('rule')}<span>${esc(plural(report.run_count, 'run', 'runs'))} · ${esc(plural(report.step_count, 'step', 'steps'))} · analysed ${esc(relTime(report.created))}</span></div>`
    : '';

  // Cases
  let casesBody;
  if (runs.ok) {
    casesBody = table({
      ariaLabel: 'Cases',
      columns: [
        { key: 'decision', label: 'Status', render: (c) => decisionBadge(c.decision || 'pending') },
        { key: 'supplier', label: 'Supplier', render: (c) => `<span class="truncate" style="display:block;max-width:160px">${esc(c.supplier || '—')}</span>` },
        { key: 'invoice_reference', label: 'Reference', mono: true },
        { key: 'invoice_total', label: 'Amount', align: 'right', render: (c) => `<span class="nowrap">${esc(money(c.invoice_total, c.currency))}</span>` },
        { key: 'findings', label: 'Differences', align: 'right', render: (c) => {
          const n = Array.isArray(c.findings) ? c.findings.length : 0;
          return n ? badge(num(n), 'warning') : `<span class="subtle">0</span>`;
        } },
      ],
      rows: cases.slice(0, 12),
      rowHref: (c) => `#cases/${encodeURIComponent(c.id)}`,
      empty: 'No cases yet.',
      emptyAction: '<a class="btn btn-ghost btn-sm" href="#documents">Load a sample</a>',
    });
  } else {
    casesBody = errorState(runs.error.message, retryButton());
  }

  return `
<div class="page-head">
  <div class="titles"><h1>Overview</h1><div class="meta">Agent failure patterns and document reconciliation cases in this workspace.</div></div>
</div>
<div class="tiles">${tiles}</div>
<div class="grid-2">
  ${panel({ title: 'Top failure patterns', flush: true, body: patternsBody, footer: patternsFoot, actions: '<a class="btn btn-ghost btn-sm" href="#reliability">Findings' + icon('chevron-right', 16) + '</a>' })}
  ${panel({ title: 'Cases', count: runs.ok ? num(cases.length) : null, flush: true, body: casesBody, actions: '<a class="btn btn-ghost btn-sm" href="#documents">New case' + icon('chevron-right', 16) + '</a>' })}
</div>`;
}

export function mount(root, ctx) {
  const onClick = (e) => { if (e.target.closest('[data-action="retry"]')) ctx.refresh(); };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
