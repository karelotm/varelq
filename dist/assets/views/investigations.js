// Investigations: every document case (successful document runs) with a review-status filter.
import { esc, num, money, relTime, dateTime } from '../format.js';
import { icon } from '../icons.js';
import { table } from '../components/table.js';
import { panel } from '../components/panel.js';
import { segmented } from '../components/segmented.js';
import { decisionBadge, badge } from '../components/badge.js';
import { errorState, retryButton } from '../components/empty.js';

export const meta = { title: 'Investigations', group: 'reconciliation' };

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'needs_clarification', label: 'Needs clarification' },
];
const EMPTY_TEXT = {
  all: 'No investigations yet.',
  pending: 'Nothing is waiting for review.',
  reviewed: 'No case has been marked reviewed yet.',
  needs_clarification: 'No case is waiting on a clarification.',
};

let cases = [];

/** Successful document runs, newest first (the server already orders by created DESC). */
export function documentCases(runs) {
  return (Array.isArray(runs) ? runs : []).filter((r) => r && r.kind === 'documents' && r.status === 'success');
}

export function statusOf(c) {
  const d = c && c.decision;
  return d === 'reviewed' || d === 'needs_clarification' ? d : 'pending';
}

function filtered(filter) {
  return filter === 'all' ? cases : cases.filter((c) => statusOf(c) === filter);
}

function casesTable(filter) {
  return table({
    ariaLabel: 'Investigations',
    columns: [
      { key: 'invoice_reference', label: 'Reference', render: (c) => `<span class="weight-500">${esc(c.invoice_reference || 'Unreferenced invoice')}</span>` },
      { key: 'supplier', label: 'Supplier', render: (c) => `<span class="truncate pages-cell-name">${esc(c.supplier || '—')}</span>` },
      { key: 'invoice_total', label: 'Total', align: 'right', render: (c) => `<span class="nowrap tabular">${esc(money(c.invoice_total, c.currency))}</span>` },
      { key: 'findings', label: 'Differences', align: 'right', render: (c) => {
        const n = Array.isArray(c.findings) ? c.findings.length : 0;
        return n ? badge(num(n), 'warning') : '<span class="subtle">0</span>';
      } },
      { key: 'decision', label: 'Status', render: (c) => decisionBadge(statusOf(c)) },
      { key: 'created', label: 'Date', align: 'right', render: (c) => `<span class="nowrap subtle" title="${esc(dateTime(c.created))}">${esc(relTime(c.created))}</span>` },
    ],
    rows: filtered(filter),
    rowHref: (c) => `#cases/${encodeURIComponent(c.id)}`,
    empty: EMPTY_TEXT[filter] || EMPTY_TEXT.all,
    emptyAction: filter === 'all' ? '<a class="btn btn-ghost btn-sm" href="#documents">Analyze documents</a>' : '<button type="button" class="btn btn-ghost btn-sm" data-action="show-all">Show all</button>',
  });
}

function filterControl(filter) {
  const counts = { all: cases.length };
  for (const c of cases) counts[statusOf(c)] = (counts[statusOf(c)] || 0) + 1;
  return segmented({
    name: 'inv-filter', label: 'Filter by review status', value: filter,
    options: FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${counts[f.value] || 0}` })),
  });
}

export async function render(ctx) {
  let runs;
  try {
    runs = await ctx.api.get('/api/runs');
  } catch (err) {
    return `<div class="page-head"><div class="titles"><h1>Investigations</h1></div></div>
<div class="panel">${errorState(err.message, retryButton())}</div>`;
  }
  cases = documentCases(runs.runs);
  const want = ctx.query.get('status');
  const filter = FILTERS.some((f) => f.value === want) ? want : 'all';
  return `
<div class="page-head">
  <div class="titles"><h1>Investigations</h1><div class="meta">Document cases from invoice, order and receiving analyses. Open a case to review its evidence.</div></div>
  <div class="actions"><a class="btn btn-secondary btn-sm" href="#documents">${icon('file-up', 16)}<span>New investigation</span></a></div>
</div>
${cases.length ? `<div class="pages-toolbar">${filterControl(filter)}</div>` : ''}
${panel({ title: 'Cases', count: num(cases.length), flush: true, body: `<div data-slot="cases">${casesTable(filter)}</div>` })}`;
}

export function mount(root, ctx) {
  const slot = () => root.querySelector('[data-slot="cases"]');
  const apply = (value) => {
    const el = slot();
    if (el) el.innerHTML = casesTable(value);
    const n = value === 'all' ? cases.length : filtered(value).length;
    ctx.announce(`${n} ${n === 1 ? 'case' : 'cases'} shown`);
  };
  const onChange = (e) => {
    if (e.target.matches('input[name="inv-filter"]')) apply(e.target.value);
  };
  const onClick = (e) => {
    if (e.target.closest('[data-action="retry"]')) { ctx.refresh(); return; }
    if (e.target.closest('[data-action="show-all"]')) {
      const all = root.querySelector('input[name="inv-filter"][value="all"]');
      if (all) { all.checked = true; all.focus(); }
      apply('all');
    }
  };
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  return () => { root.removeEventListener('change', onChange); root.removeEventListener('click', onClick); };
}
