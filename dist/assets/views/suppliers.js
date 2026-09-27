// Suppliers: aggregated from successful document runs. Click a supplier to list its cases.
import { esc, num, money, relTime, dateTime, currencyCode, plural } from '../format.js';
import { icon } from '../icons.js';
import { panel } from '../components/panel.js';
import { decisionBadge, badge } from '../components/badge.js';
import { empty, errorState, retryButton } from '../components/empty.js';

export const meta = { title: 'Suppliers', group: 'reconciliation' };

let suppliers = [];
const open = new Set();

function keyOf(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase() || '(unknown)';
}

/** Group successful document runs by supplier name. Totals are summed per currency, never converted. */
export function aggregateSuppliers(runs) {
  const map = new Map();
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || r.kind !== 'documents' || r.status !== 'success') continue;
    const key = keyOf(r.supplier);
    let s = map.get(key);
    if (!s) {
      s = { key, name: String(r.supplier || '').trim() || 'Unknown supplier', cases: [], totals: {}, differences: 0, lastSeen: null, pending: 0 };
      map.set(key, s);
    }
    s.cases.push(r);
    const n = Number(r.invoice_total);
    if (r.invoice_total !== null && r.invoice_total !== undefined && r.invoice_total !== '' && Number.isFinite(n)) {
      const cur = currencyCode(r.currency) || String(r.currency || '').trim() || '';
      s.totals[cur] = (s.totals[cur] || 0) + n;
    }
    s.differences += Array.isArray(r.findings) ? r.findings.length : 0;
    if ((r.decision || 'pending') === 'pending') s.pending += 1;
    if (!s.lastSeen || String(r.created) > String(s.lastSeen)) s.lastSeen = r.created;
  }
  return [...map.values()].sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
}

function totalsHtml(totals) {
  const entries = Object.entries(totals);
  if (!entries.length) return '<span class="subtle">—</span>';
  return entries.map(([cur, v]) => `<span class="nowrap tabular">${esc(money(v.toFixed(2), cur))}</span>`).join('<br>');
}

function casesList(s) {
  return `<ul class="pages-sublist" aria-label="Cases for ${esc(s.name)}">${s.cases.map((c) => {
    const n = Array.isArray(c.findings) ? c.findings.length : 0;
    return `<li><a href="#cases/${encodeURIComponent(c.id)}" class="pages-subrow">
      <span class="weight-500">${esc(c.invoice_reference || 'Unreferenced invoice')}</span>
      <span class="nowrap tabular">${esc(money(c.invoice_total, c.currency))}</span>
      <span class="subtle nowrap">${esc(plural(n, 'difference', 'differences'))}</span>
      <span>${decisionBadge(c.decision || 'pending')}</span>
      <span class="subtle nowrap" title="${esc(dateTime(c.created))}">${esc(relTime(c.created))}</span>
      ${icon('chevron-right', 16)}</a></li>`;
  }).join('')}</ul>`;
}

function suppliersTable() {
  const rows = suppliers.map((s, i) => {
    const expanded = open.has(s.key);
    const id = `sup-${i}`;
    return `<tr class="pages-expandable${expanded ? ' is-open' : ''}">
  <td><button type="button" class="pages-disclosure" data-action="toggle" data-key="${esc(s.key)}" aria-expanded="${expanded}" aria-controls="${id}">${icon(expanded ? 'chevron-down' : 'chevron-right', 16)}<span class="weight-500">${esc(s.name)}</span></button></td>
  <td class="align-right tabular">${esc(num(s.cases.length))}</td>
  <td class="align-right">${totalsHtml(s.totals)}</td>
  <td class="align-right">${s.differences ? badge(num(s.differences), 'warning') : '<span class="subtle">0</span>'}</td>
  <td class="align-right"><span class="nowrap subtle" title="${esc(dateTime(s.lastSeen))}">${esc(relTime(s.lastSeen))}</span></td>
</tr>
<tr class="pages-detail" id="${id}"${expanded ? '' : ' hidden'}><td colspan="5">${casesList(s)}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="table" aria-label="Suppliers"><thead><tr>
<th scope="col">Supplier</th><th scope="col" class="align-right">Invoices</th><th scope="col" class="align-right">Total invoiced</th><th scope="col" class="align-right">Differences</th><th scope="col" class="align-right">Last seen</th>
</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export async function render(ctx) {
  let runs;
  try {
    runs = await ctx.api.get('/api/runs');
  } catch (err) {
    return `<div class="page-head"><div class="titles"><h1>Suppliers</h1></div></div>
<div class="panel">${errorState(err.message, retryButton())}</div>`;
  }
  suppliers = aggregateSuppliers(runs.runs);
  const head = `<div class="page-head"><div class="titles"><h1>Suppliers</h1><div class="meta">Suppliers named on the invoices you analyzed. Totals are summed per currency and never converted.</div></div></div>`;
  if (!suppliers.length) {
    return `${head}${panel({ title: 'Suppliers', body: empty('No suppliers yet. They appear after a document analysis.', '<a class="btn btn-ghost btn-sm" href="#documents">Analyze documents</a>') })}`;
  }
  return `${head}${panel({ title: 'Suppliers', count: num(suppliers.length), flush: true, body: `<div data-slot="suppliers">${suppliersTable()}</div>` })}`;
}

export function mount(root, ctx) {
  const onClick = (e) => {
    if (e.target.closest('[data-action="retry"]')) { ctx.refresh(); return; }
    const btn = e.target.closest('[data-action="toggle"]');
    if (!btn) return;
    const key = btn.dataset.key;
    if (open.has(key)) open.delete(key); else open.add(key);
    const expanded = open.has(key);
    btn.setAttribute('aria-expanded', String(expanded));
    const ic = btn.querySelector('svg, .icon');
    if (ic) ic.outerHTML = icon(expanded ? 'chevron-down' : 'chevron-right', 16);
    const tr = btn.closest('tr');
    tr.classList.toggle('is-open', expanded);
    const detail = document.getElementById(btn.getAttribute('aria-controls'));
    if (detail) detail.hidden = !expanded;
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
