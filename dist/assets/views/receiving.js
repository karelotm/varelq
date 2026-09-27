// Receiving: ordered vs received vs invoiced quantities per line, for cases that include a receiving record.
import { esc, num, relTime, dateTime, plural, signed } from '../format.js';
import { icon } from '../icons.js';
import { panel } from '../components/panel.js';
import { badge, decisionBadge } from '../components/badge.js';
import { empty, errorState, retryButton } from '../components/empty.js';

export const meta = { title: 'Receiving', group: 'reconciliation' };

function val(field) {
  if (field && typeof field === 'object' && 'value' in field) return field.value;
  return field;
}
function qty(field) {
  const v = val(field);
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
function lineKey(item) {
  const sku = val(item && item.sku);
  if (sku) return `sku:${String(sku).trim().toLowerCase()}`;
  const desc = val(item && item.description);
  return desc ? `desc:${String(desc).trim().toLowerCase().replace(/\s+/g, ' ')}` : null;
}
function items(doc) {
  return doc && Array.isArray(doc.items) ? doc.items : [];
}

/** Lines matched by SKU (or description) across order, receiving record and invoice. */
export function receivingLines(run) {
  const f = (run && run.fields) || {};
  const rec = f.receiving_record;
  if (!rec || !items(rec).length) return null;
  const lines = new Map();
  const add = (doc, slot) => {
    items(doc).forEach((it, i) => {
      const key = lineKey(it) || `${slot}:${i}`;
      let line = lines.get(key);
      if (!line) {
        line = { key, sku: val(it.sku) || null, description: val(it.description) || null, ordered: null, received: null, invoiced: null };
        lines.set(key, line);
      }
      if (!line.sku && val(it.sku)) line.sku = val(it.sku);
      if (!line.description && val(it.description)) line.description = val(it.description);
      line[slot] = qty(it.quantity);
    });
  };
  add(f.purchase_order, 'ordered');
  add(rec, 'received');
  add(f.invoice, 'invoiced');
  return [...lines.values()].map((l) => {
    const gaps = [];
    if (l.ordered !== null && l.received !== null && l.received !== l.ordered) {
      gaps.push({ label: l.received < l.ordered ? 'Short delivery' : 'Over delivery', delta: l.received - l.ordered, tone: 'warning' });
    }
    if (l.received !== null && l.invoiced !== null && l.invoiced > l.received) {
      gaps.push({ label: 'Invoiced above received', delta: l.invoiced - l.received, tone: 'danger' });
    } else if (l.received !== null && l.invoiced !== null && l.invoiced < l.received) {
      gaps.push({ label: 'Invoiced below received', delta: l.invoiced - l.received, tone: 'neutral' });
    }
    if (l.received === null) gaps.push({ label: 'Not on receiving record', delta: null, tone: 'warning' });
    return { ...l, gaps };
  });
}

function qtyCell(v, highlight) {
  if (v === null) return '<span class="subtle">—</span>';
  return `<span class="tabular${highlight ? ' pages-gap' : ''}">${esc(num(v))}</span>`;
}

function caseTable(lines) {
  const rows = lines.map((l) => {
    const hasGap = l.gaps.length > 0;
    const recvGap = l.gaps.some((g) => g.label !== 'Invoiced below received');
    const gapHtml = hasGap
      ? l.gaps.map((g) => badge(g.delta === null ? g.label : `${g.label} ${signed(g.delta)}`, g.tone)).join(' ')
      : badge('Matches', 'success');
    return `<tr${hasGap ? ' class="pages-row-gap"' : ''}>
  <td><span class="weight-500">${esc(l.sku || '—')}</span></td>
  <td><span class="clamp-2">${esc(l.description || '—')}</span></td>
  <td class="align-right">${qtyCell(l.ordered, false)}</td>
  <td class="align-right">${qtyCell(l.received, recvGap && l.received !== null)}</td>
  <td class="align-right">${qtyCell(l.invoiced, l.gaps.some((g) => g.label.startsWith('Invoiced')))}</td>
  <td><div class="pages-badges">${gapHtml}</div></td>
</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="table" aria-label="Line quantities"><thead><tr>
<th scope="col">SKU</th><th scope="col">Description</th><th scope="col" class="align-right">Ordered</th><th scope="col" class="align-right">Received</th><th scope="col" class="align-right">Invoiced</th><th scope="col">Result</th>
</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tile(label, value, sub) {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${esc(sub)}</div>` : ''}</div>`;
}

export async function render(ctx) {
  let runs;
  try {
    runs = await ctx.api.get('/api/runs');
  } catch (err) {
    return `<div class="page-head"><div class="titles"><h1>Receiving</h1></div></div>
<div class="panel">${errorState(err.message, retryButton())}</div>`;
  }
  const cases = (runs.runs || [])
    .filter((r) => r && r.kind === 'documents' && r.status === 'success')
    .map((r) => ({ run: r, lines: receivingLines(r) }))
    .filter((c) => c.lines && c.lines.length);

  const head = `<div class="page-head"><div class="titles"><h1>Receiving</h1><div class="meta">Ordered, received and invoiced quantities for each line, from cases that include a receiving record. No stock balance is inferred.</div></div></div>`;
  if (!cases.length) {
    return `${head}${panel({ title: 'Receiving records', body: empty('No case includes a receiving record yet.', '<a class="btn btn-ghost btn-sm" href="#documents">Add a receiving record</a>') })}`;
  }
  const allLines = cases.flatMap((c) => c.lines);
  const gapLines = allLines.filter((l) => l.gaps.length);
  const short = allLines.reduce((sum, l) => sum + (l.ordered !== null && l.received !== null && l.received < l.ordered ? l.ordered - l.received : 0), 0);
  const tiles = `<div class="tiles pages-tiles-3">
${tile('Cases with receiving', esc(num(cases.length)), `${plural(allLines.length, 'line', 'lines')} compared`)}
${tile('Lines with a gap', esc(num(gapLines.length)), gapLines.length ? 'Highlighted below' : 'Every line matches')}
${tile('Units short', esc(num(short)), 'Ordered minus received')}
</div>`;

  const panels = cases.map(({ run, lines }) => {
    const gaps = lines.filter((l) => l.gaps.length).length;
    const grn = val(run.fields.receiving_record.reference);
    return panel({
      title: `${run.invoice_reference || 'Unreferenced invoice'} · ${run.supplier || 'Unknown supplier'}`,
      flush: true,
      headExtra: `<span class="pages-head-meta">${gaps ? badge(plural(gaps, 'gap', 'gaps'), 'warning') : badge('No gaps', 'success')} ${decisionBadge(run.decision || 'pending')}</span>`,
      actions: `<a class="btn btn-ghost btn-sm" href="#cases/${encodeURIComponent(run.id)}">Open case${icon('chevron-right', 16)}</a>`,
      body: caseTable(lines),
      footer: `<span class="subtle">${grn ? `Receiving record ${esc(grn)} · ` : ''}analyzed <span title="${esc(dateTime(run.created))}">${esc(relTime(run.created))}</span></span>`,
    });
  }).join('');
  return `${head}${tiles}<div class="pages-stack">${panels}</div>`;
}

export function mount(root, ctx) {
  const onClick = (e) => { if (e.target.closest('[data-action="retry"]')) ctx.refresh(); };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
