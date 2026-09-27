// Case: differences table on the left, source document with OCR boxes on the right.
import { esc, num, signed, money, humanize, plural, relTime, pct, ms, EMPTY } from '../format.js';
import { icon } from '../icons.js';
import { table } from '../components/table.js';
import { panel } from '../components/panel.js';
import { badge, severityBadge, decisionBadge } from '../components/badge.js';
import { tag } from '../components/tag.js';
import { errorState, retryButton, empty } from '../components/empty.js';
import { setBusy } from '../components/button.js';
import { uploadsFor } from '../state.js';

export const meta = { title: 'Case', group: 'reconciliation' };

const ROLE_ORDER = ['invoice', 'purchase_order', 'receiving_record'];
const ROLE_TAB = { invoice: 'Invoice', purchase_order: 'PO', receiving_record: 'Receipt' };
const SEV_RANK = { high: 0, medium: 1, low: 2, none: 3 };
// Within a severity, the three-way result (invoiced vs received) leads.
const DETAIL_TABS = ['differences', 'documents', 'evidence'];
let detailTab = 'differences'; // remembered across cases in this session
let tabsMod; // components/tabs.js (stream A) or null

async function loadTabs() {
  if (tabsMod !== undefined) return tabsMod;
  try { tabsMod = await import('../components/tabs.js'); } catch { tabsMod = null; }
  return tabsMod;
}
function detailTabsHtml(items, active) {
  if (tabsMod && typeof tabsMod.tabs === 'function') {
    try { return tabsMod.tabs({ id: 'case-tabs', items, active, label: 'Case detail' }); } catch { /* local markup below */ }
  }
  return `<div class="tabs" data-tablist="case-tabs" role="tablist" aria-label="Case detail">${items.map((it) => `<button type="button" class="tab" role="tab" id="case-tabs-tab-${it.id}" data-tab="${it.id}" aria-selected="${it.id === active}" aria-controls="case-tabs-panel" tabindex="${it.id === active ? 0 : -1}">${esc(it.label)}${it.count !== undefined ? ` <span class="subtle">${esc(it.count)}</span>` : ''}</button>`).join('')}</div>`;
}
const KIND_RANK = { qty_invoiced_vs_received: 0, qty_invoiced_vs_ordered: 1, qty_received_vs_ordered: 2, total_vs_net_plus_tax: 3, price_invoice_vs_order: 4 };

/** Checks with status "difference", highest severity first. */
export function differences(run) {
  const checks = Array.isArray(run.checks) ? run.checks : [];
  return checks.filter((c) => c && c.status === 'difference')
    .sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9)
      || (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9));
}

/** First evidence location of a check: {role, location} or null. */
export function firstEvidence(check) {
  const ev = check && Array.isArray(check.evidence) ? check.evidence.find((e) => e && e.document && e.location) : null;
  return ev ? { role: ev.document, location: ev.location, text: ev.text } : null;
}

/** "SKU-1" from "qty_invoiced_vs_received:SKU-1". */
function subject(check) {
  const i = String(check.id || '').indexOf(':');
  return i > 0 ? check.id.slice(i + 1) : '';
}

function checkLabel(check) {
  return humanize(check.kind);
}

function valueCell(check, role) {
  const v = check.values ? check.values[role] : undefined;
  if (v === null || v === undefined || v === '') return `<span class="subtle">${EMPTY}</span>`;
  return `<span class="mono">${esc(num(v))}</span>`;
}

function deltaCell(check) {
  if (check.delta === null || check.delta === undefined) return `<span class="subtle">${EMPTY}</span>`;
  const unit = check.unit && check.unit !== 'units' ? ` <span class="subtle text-xs">${esc(check.unit)}</span>` : '';
  return `<span class="mono weight-500">${esc(signed(check.delta))}</span>${unit}`;
}

function imageSource(run, role) {
  const up = uploadsFor(run.id);
  if (up && up[role] && up[role].url) return { url: up[role].url, origin: 'upload' };
  const src = run.sources && run.sources[role];
  if (!src) return null;
  const isImage = /\.(png|jpe?g)$/i.test(src.filename || '') || (src.sample && /\.(png|jpe?g)$/i.test(src.sample.url || ''));
  if (src.sample && src.sample.url && isImage) return { url: src.sample.url, origin: 'sample' };
  return null;
}

function rolesOf(run) {
  const src = run.sources || {};
  return ROLE_ORDER.filter((r) => src[r]).concat(Object.keys(src).filter((r) => !ROLE_ORDER.includes(r)));
}

function sortedLines(lines) {
  return Object.entries(lines || {}).sort((a, b) => {
    const pa = a[0].match(/p(\d+):l(\d+)/); const pb = b[0].match(/p(\d+):l(\d+)/);
    if (!pa || !pb) return a[0].localeCompare(b[0]);
    return (Number(pa[1]) - Number(pb[1])) || (Number(pa[2]) - Number(pb[2]));
  });
}

/* ---------- OCR review labels ---------- */
// The OCR score is the reader's own per-line score, not a probability of being right.
// Spot check (ACCURACY.md): every line under 0.80 was wrong; 0.80-0.90 was mixed; 0.90+ was right 98% of the time.
const OCR_LEGEND = "OCR review labels come from the reader's own score; they are warnings, not probabilities.";
function ocrScorePct(score) { return `${Math.round(score * 1000) / 10}%`; }
/** 'verify' | 'check' | null for a per-line OCR score. */
export function ocrReviewLevel(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (score < 0.80) return 'verify';
  if (score < 0.90) return 'check';
  return null;
}
/** Soft pill for a line score: red "Verify" below 0.80, amber "Check" for 0.80-0.90, nothing at 0.90+. */
function ocrReviewPill(score) {
  const level = ocrReviewLevel(score);
  if (level === 'verify') return badge('Verify', 'danger', { className: 'ocr-review', title: `Low OCR score (${ocrScorePct(score)}). Every line under 80% was wrong in our spot check; check the source.` });
  if (level === 'check') return badge('Check', 'warning', { className: 'ocr-review', title: `OCR score ${ocrScorePct(score)} (not a probability). Lines scoring 80-90% were sometimes misread in our spot check; check the source.` });
  return '';
}
function ocrScoreTitle(score) {
  return typeof score === 'number' ? `OCR score ${ocrScorePct(score)} (not a probability)` : '';
}
/** Lowest OCR score over a field cell's evidence lines, or null. */
function cellOcrScore(run, role, cell) {
  if (!cell || !Array.isArray(cell.evidence)) return null;
  let worst = null;
  for (const ev of cell.evidence) {
    if (!ev || !ev.location) continue;
    const b = (((run.sources || {})[ev.document || role] || {}).line_boxes || {})[ev.location];
    if (b && typeof b.confidence === 'number' && (worst === null || b.confidence < worst)) worst = b.confidence;
  }
  return worst;
}
/** Verify pill for a header field (e.g. invoice reference) when its source line scored below 0.80. */
function fieldVerifyPill(run, role, key) {
  const score = cellOcrScore(run, role, ((run.fields || {})[role] || {})[key]);
  return ocrReviewLevel(score) === 'verify' ? ocrReviewPill(score) : '';
}

/* ---------- viewer ---------- */
function viewerHtml(run, role, location) {
  const src = (run.sources || {})[role];
  if (!src) return empty('No source document for this role.');
  const img = imageSource(run, role);
  const boxes = src.line_boxes || {};
  const sel = location && boxes[location] ? boxes[location] : null;
  const page = sel ? sel.page : 1;
  const lines = sortedLines(src.lines);
  const selectedText = location && src.lines ? src.lines[location] : null;

  let visual = '';
  if (img) {
    const rects = Object.entries(boxes).filter(([, b]) => b && b.page === page && Array.isArray(b.bbox)).map(([loc, b]) => {
      const [x0, y0, x1, y1] = b.bbox;
      return `<rect data-loc="${esc(loc)}" class="${loc === location ? 'sel' : ''}" x="${x0}" y="${y0}" width="${Math.max(0, x1 - x0)}" height="${Math.max(0, y1 - y0)}"/>`;
    });
    // Draw the selected box last so it sits on top.
    rects.sort((a, b) => (a.includes('class="sel"') ? 1 : 0) - (b.includes('class="sel"') ? 1 : 0));
    visual = `<div class="viewer"><div class="viewer-canvas" id="viewer-canvas"><div class="page"><img src="${esc(img.url)}" alt="${esc(humanize(role))} page ${page}: ${esc(src.filename || '')}" id="viewer-img"><svg class="boxes" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">${rects.join('')}</svg></div></div></div>`;
  }

  const ocrPage = Array.isArray(src.ocr_pages) ? src.ocr_pages.find((p) => p.page === page) || src.ocr_pages[0] : null;
  const selScore = sel && typeof sel.confidence === 'number' ? sel.confidence : null;
  const lineTitle = selScore !== null ? ` title="${esc(ocrScoreTitle(selScore))}"` : '';
  const evidence = location
    ? `<div class="evidence-line"><div class="row wrap text-xs muted"><span${lineTitle}>Line <span class="mono">${esc(location)}</span></span>${ocrReviewPill(selScore)}</div><div class="quote">${selectedText ? esc(selectedText) : '<span class="subtle">Line text not available</span>'}</div></div>`
    : '';

  const listHtml = lines.length
    ? `<ul class="line-list" id="line-list">${lines.map(([loc, text]) => { const sc = boxes[loc] ? boxes[loc].confidence : null; return `<li data-loc="${esc(loc)}" class="${loc === location ? 'sel' : ''}"${typeof sc === 'number' ? ` title="${esc(ocrScoreTitle(sc))}"` : ''}><span class="loc">${esc(loc.replace(/^p\d+:/, ''))}</span><span>${esc(text)} ${ocrReviewPill(sc)}</span></li>`; }).join('')}</ul>`
    : empty('No text lines were extracted.');
  const list = img
    ? `<details class="disclosure"><summary>${icon('chevron-right', 16, 'chev')}All lines <span class="subtle">${esc(num(lines.length))}</span></summary>${listHtml}</details>`
    : listHtml;

  const metaParts = [];
  metaParts.push(badge(src.ingestion || 'Unknown ingestion', 'neutral'));
  if (ocrPage) {
    if (ocrPage.model) metaParts.push(`<span class="mono">${esc(String(ocrPage.model).split('/').pop())}</span>`);
    if (ocrPage.provider) metaParts.push(`<span>${esc(ocrPage.provider)}</span>`);
    if (ocrPage.endpoint_kind) metaParts.push(`<span>${esc(humanize(ocrPage.endpoint_kind))}</span>`);
    if (typeof ocrPage.latency_ms === 'number') metaParts.push(`<span class="tabular">${esc(ms(ocrPage.latency_ms))} measured</span>`);
    if (ocrPage.fallback_used) metaParts.push(badge('Fallback used', 'warning'));
  }
  if (src.sample) metaParts.push(tag('synthetic', { text: 'Sample file' }));
  const metaLine = `<div class="ocr-meta"><span class="mono">${esc(src.filename || '')}</span>${metaParts.join('<span class="subtle">·</span>')}</div>`;

  const legend = `<div class="text-xs muted ocr-legend">${esc(OCR_LEGEND)}</div>`;
  return `${visual}${evidence}${metaLine}${legend}${list}`;
}

function tabsHtml(run, active) {
  return `<div class="tabs" id="src-tabs" role="tablist" aria-label="Source documents">${rolesOf(run).map((r) => `<button type="button" class="tab" role="tab" id="tab-${r}" aria-selected="${r === active}" aria-controls="viewer-panel" data-role="${esc(r)}" tabindex="${r === active ? 0 : -1}">${esc(ROLE_TAB[r] || humanize(r))}</button>`).join('')}</div>`;
}

/* ---------- left column ---------- */
function differencesTable(run, selectedKey) {
  const rows = differences(run);
  const roles = rolesOf(run);
  const cols = [
    { key: 'check', label: 'Check', render: (c) => `<div class="stack gap-1"><span class="weight-500">${esc(checkLabel(c))}</span>${subject(c) ? `<span class="mono subtle text-xs">${esc(subject(c))}</span>` : ''}</div>` },
  ];
  if (roles.includes('invoice') || rows.some((c) => c.values && 'invoice' in c.values)) cols.push({ key: 'inv', label: 'Invoice', align: 'right', render: (c) => valueCell(c, 'invoice') });
  if (roles.includes('purchase_order')) cols.push({ key: 'po', label: 'PO', align: 'right', render: (c) => valueCell(c, 'purchase_order') });
  if (roles.includes('receiving_record')) cols.push({ key: 'grn', label: 'Receipt', align: 'right', render: (c) => valueCell(c, 'receiving_record') });
  cols.push({ key: 'delta', label: 'Δ', align: 'right', render: deltaCell });
  cols.push({ key: 'sev', label: 'Severity', render: (c) => severityBadge(c.severity) });
  cols.push({ key: 'tag', label: 'Source', render: () => tag('deterministic') });
  return table({ columns: cols, rows, rowKey: (c) => c.id, selectedKey: selectedKey ?? '', empty: 'No differences found by the checks that ran.', ariaLabel: 'Differences' });
}

function checksList(run) {
  const checks = Array.isArray(run.checks) ? run.checks : [];
  if (!checks.length) return empty('No checks were recorded for this case.');
  return `<ul class="check-list">${checks.map((c) => {
    const diff = c.status === 'difference';
    const ic = diff ? icon('alert-triangle', 16, c.severity === 'high' ? 'tone-danger' : 'tone-warning') : icon('check-circle-2', 16, 'tone-success');
    return `<li>${ic}<div class="stack gap-1"><span>${esc(c.title || humanize(c.kind))}</span>${c.detail ? `<span class="detail">${esc(c.detail)}</span>` : ''}</div><span class="text-xs muted nowrap">${diff ? esc(humanize('difference')) : 'Passed'}</span></li>`;
  }).join('')}</ul>`;
}

function limitationsList(run) {
  const lim = Array.isArray(run.limitations) ? run.limitations : [];
  if (!lim.length) return '';
  return `<ul class="check-list">${lim.map((l) => `<li>${icon('circle-dashed', 16, 'subtle')}<span class="muted">${esc(l)}</span><span></span></li>`).join('')}</ul>`;
}

function fieldRows(run) {
  const rows = [];
  const boxesFor = (role) => ((run.sources || {})[role] || {}).line_boxes || {};
  for (const role of rolesOf(run)) {
    const f = (run.fields || {})[role];
    if (!f || typeof f !== 'object') continue;
    for (const [name, cell] of Object.entries(f)) {
      if (name === 'items' && Array.isArray(cell)) {
        cell.forEach((item, i) => {
          for (const [k, c] of Object.entries(item || {})) {
            if (!c || typeof c !== 'object' || !('value' in c)) continue;
            rows.push({ role, field: `Line ${i + 1} · ${humanize(k)}`, cell: c, boxes: boxesFor(role) });
          }
        });
      } else if (cell && typeof cell === 'object' && 'value' in cell) {
        rows.push({ role, field: humanize(name), cell, boxes: boxesFor(role) });
      }
    }
  }
  return rows;
}

function fieldsTable(run) {
  const rows = fieldRows(run).map((r) => ({ ...r, score: cellOcrScore(run, r.role, r.cell) }));
  return table({
    ariaLabel: 'Extracted fields',
    columns: [
      { key: 'role', label: 'Document', render: (r) => esc(ROLE_TAB[r.role] || humanize(r.role)) },
      { key: 'field', label: 'Field', render: (r) => esc(r.field) },
      { key: 'value', label: 'Value', render: (r) => (r.cell.value === null || r.cell.value === undefined ? `<span class="subtle">Not found</span>` : `<span class="mono break">${esc(r.cell.value)}</span>${ocrReviewLevel(r.score) === 'verify' ? ` ${ocrReviewPill(r.score)}` : ''}`) },
      { key: 'line', label: 'Source line', render: (r) => {
        const ev = (r.cell.evidence || [])[0];
        return ev ? `<button type="button" class="btn btn-ghost btn-sm mono" data-action="show-line" data-role="${esc(ev.document || r.role)}" data-loc="${esc(ev.location)}">${esc(ev.location)}</button>` : `<span class="subtle">${EMPTY}</span>`;
      } },
      { key: 'ocr', label: 'OCR review', align: 'right', render: (r) => {
        if (r.score === null) return `<span class="subtle">${EMPTY}</span>`;
        return ocrReviewPill(r.score) || `<span class="subtle" title="${esc(ocrScoreTitle(r.score))}">${EMPTY}</span>`;
      } },
    ],
    rows,
    empty: 'No fields were extracted.',
  });
}

/* ---------- render ---------- */
export async function render(ctx) {
  const id = ctx.params[0];
  let run;
  try {
    run = await ctx.api.get(`/api/runs/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e.status === 404) return `<div class="panel">${empty('Case not found.', '<a class="btn btn-ghost btn-sm" href="#overview">Open overview</a>')}</div>`;
    return `<div class="panel">${errorState(e.message, retryButton())}</div>`;
  }
  ctx.setCrumb(run.invoice_reference || id);
  if (run.status !== 'success' || run.kind !== 'documents') {
    return `<div class="page-head"><div class="titles"><h1>Case unavailable</h1><div class="meta"><span class="truncate" title="${esc(id)}">Case ${esc(String(id).slice(0, 8))}</span></div></div></div><div class="panel">${errorState(run.error || 'This analysis did not complete.', '<a class="btn btn-ghost btn-sm" href="#documents">Open documents</a>')}</div>`;
  }
  const diffs = differences(run);
  const first = diffs[0] || null;
  const ev = firstEvidence(first);
  const roles = rolesOf(run);
  const state = { key: first ? first.id : null, role: ev ? ev.role : roles[0], location: ev ? ev.location : null };
  ctx.caseState = { run, state };

  const decision = run.decision || 'pending';
  const checksCount = Array.isArray(run.checks) ? run.checks.length : 0;
  const head = `
<div class="page-head sticky">
  <div class="titles">
    <h1 title="${esc(run.supplier || '')}">${esc(run.supplier || 'Supplier unavailable')}${run.supplier ? ` ${fieldVerifyPill(run, 'invoice', 'supplier')}` : ''}</h1>
    <div class="meta"><span id="decision-badge">${decisionBadge(decision)}</span>${run.invoice_reference ? `<span class="tabular">${esc(run.invoice_reference)}</span>${fieldVerifyPill(run, 'invoice', 'reference')}<span class="subtle">·</span>` : ''}<span class="tabular">${esc(money(run.invoice_total, run.currency))}</span>${fieldVerifyPill(run, 'invoice', 'total')}<span class="subtle">·</span><span title="Case ${esc(run.id)}">Created ${esc(relTime(run.created))}</span>${run.stub ? tag('stub') : ''}</div>
  </div>
  <div class="actions">
    <button type="button" class="btn btn-secondary" data-action="decide" data-decision="needs_clarification"${decision === 'needs_clarification' ? ' aria-pressed="true"' : ''}>Request clarification</button>
    <button type="button" class="btn btn-primary" data-action="decide" data-decision="reviewed"${decision === 'reviewed' ? ' disabled' : ''}>${icon('check', 16)}<span class="btn-label">${decision === 'reviewed' ? 'Reviewed' : 'Mark reviewed'}</span></button>
  </div>
</div>`;

  await loadTabs();
  if (!DETAIL_TABS.includes(detailTab)) detailTab = 'differences';
  const fieldCount = fieldRows(run).length;
  const limCount = Array.isArray(run.limitations) ? run.limitations.length : 0;
  const items = [
    { id: 'differences', label: 'Differences', count: num(diffs.length) },
    { id: 'documents', label: 'Documents', count: num(fieldCount) },
    { id: 'evidence', label: 'Evidence', count: num(checksCount) },
  ];
  const pane = (id, body) => `<div class="case-pane" data-pane="${id}"${id === detailTab ? '' : ' hidden'}>${body}</div>`;
  const left = `
<section class="panel flush case-detail" id="diffs" aria-label="Case detail">
  ${detailTabsHtml(items, detailTab)}
  <div role="tabpanel" id="case-tabs-panel" aria-labelledby="case-tabs-tab-${detailTab}">
  ${pane('differences', `<div id="diff-table">${differencesTable(run, state.key)}</div>`)}
  ${pane('documents', `<div class="sub-head">Extracted fields</div>${fieldsTable(run)}`)}
  ${pane('evidence', `<div class="sub-head">All checks</div><p class="text-xs muted ocr-legend">${esc(OCR_LEGEND)}</p>${checksList(run)}${limCount ? `<div class="sub-head bordered">Not checked</div>${limitationsList(run)}` : ''}`)}
  </div>
</section>`;

  const right = `<section class="panel flush" aria-label="Source document">${tabsHtml(run, state.role)}<div id="viewer-panel" role="tabpanel" aria-labelledby="tab-${esc(state.role)}">${viewerHtml(run, state.role, state.location)}</div></section>`;

  return `${head}<div class="split"><div class="stack">${left}</div><div class="side">${right}</div></div>`;
}

export function mount(root, ctx) {
  const cs = ctx.caseState;
  if (!cs) {
    const onRetry = (e) => { if (e.target.closest('[data-action="retry"]')) ctx.refresh(); };
    root.addEventListener('click', onRetry);
    return () => root.removeEventListener('click', onRetry);
  }
  const { run, state } = cs;

  function scrollToSelected() {
    const canvas = root.querySelector('#viewer-canvas');
    const img = root.querySelector('#viewer-img');
    const src = (run.sources || {})[state.role] || {};
    const b = state.location && src.line_boxes ? src.line_boxes[state.location] : null;
    if (canvas && img && b) {
      const place = () => {
        const h = img.clientHeight;
        const y = ((b.bbox[1] + b.bbox[3]) / 2) * h;
        canvas.scrollTo({ top: Math.max(0, y - canvas.clientHeight / 2), behavior: 'auto' });
      };
      if (img.complete) place(); else img.addEventListener('load', place, { once: true });
    }
    const li = root.querySelector('#line-list li.sel');
    const list = root.querySelector('#line-list');
    if (li && list && list.offsetParent) list.scrollTop = li.offsetTop - list.clientHeight / 2;
  }

  function drawViewer() {
    const tabs = root.querySelector('#src-tabs');
    if (tabs) tabs.outerHTML = tabsHtml(run, state.role);
    const vp = root.querySelector('#viewer-panel');
    if (vp) {
      vp.setAttribute('aria-labelledby', `tab-${state.role}`);
      vp.innerHTML = viewerHtml(run, state.role, state.location);
    }
    scrollToSelected();
  }

  function selectCheck(key) {
    const check = (run.checks || []).find((c) => c.id === key);
    if (!check) return;
    state.key = key;
    root.querySelectorAll('#diff-table tr[data-key]').forEach((tr) => tr.setAttribute('aria-selected', String(tr.dataset.key === key)));
    const ev = firstEvidence(check);
    if (ev) {
      state.role = ev.role; state.location = ev.location;
      drawViewer();
      ctx.announce(`Showing ${humanize(ev.role).toLowerCase()} line ${ev.location}`);
    }
  }

  function showLine(role, loc) {
    state.role = role; state.location = loc;
    drawViewer();
    ctx.announce(`Showing ${humanize(role).toLowerCase()} line ${loc}`);
    const side = root.querySelector('.side');
    if (side && window.matchMedia('(max-width: 1100px)').matches) side.scrollIntoView({ block: 'start' });
  }

  async function decide(btn) {
    const decision = btn.dataset.decision;
    setBusy(btn, true);
    try {
      await ctx.api.post('/api/decision', { id: run.id, decision });
      run.decision = decision;
      ctx.toast(decision === 'reviewed' ? 'Case marked reviewed.' : 'Clarification requested.', 'success');
      ctx.refresh();
    } catch (e) {
      setBusy(btn, false);
      ctx.toast(e.message, 'danger');
    }
  }

  function showDetail(id) {
    if (!DETAIL_TABS.includes(id)) return;
    detailTab = id;
    root.querySelectorAll('.case-detail [data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== id; });
    root.querySelector('#case-tabs-panel')?.setAttribute('aria-labelledby', `case-tabs-tab-${id}`);
    root.querySelectorAll('.case-detail [role="tablist"] [role="tab"]').forEach((t) => {
      const on = t.dataset.tab === id;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
    });
  }
  let unbindTabs = null;
  const detailRoot = root.querySelector('.case-detail');
  if (detailRoot && tabsMod && typeof tabsMod.bindTabs === 'function') {
    try { const c = tabsMod.bindTabs(detailRoot, (v) => showDetail(v && typeof v === 'object' ? v.id : v)); if (typeof c === 'function') unbindTabs = c; else unbindTabs = () => {}; } catch { unbindTabs = null; }
  }
  const tabIdOf = (t) => t.dataset.tab;

  const onClick = (e) => {
    const dt = !unbindTabs && e.target.closest('.case-detail [role="tab"][data-tab]');
    if (dt) { showDetail(tabIdOf(dt)); return; }
    const act = e.target.closest('[data-action]');
    if (act) {
      if (act.dataset.action === 'decide') { decide(act); return; }
      if (act.dataset.action === 'retry') { ctx.refresh(); return; }
      if (act.dataset.action === 'show-line') { showLine(act.dataset.role, act.dataset.loc); return; }
    }
    const tab = e.target.closest('.tab[data-role]');
    if (tab) {
      state.role = tab.dataset.role;
      const check = (run.checks || []).find((c) => c.id === state.key);
      const ev = check && (check.evidence || []).find((x) => x.document === state.role);
      state.location = ev ? ev.location : null;
      drawViewer();
      root.querySelector(`#tab-${state.role}`)?.focus();
      return;
    }
    const li = e.target.closest('#line-list li[data-loc]');
    if (li) { state.location = li.dataset.loc; drawViewer(); return; }
    const tr = e.target.closest('#diff-table tr[data-key]');
    if (tr) selectCheck(tr.dataset.key);
  };
  const onKey = (e) => {
    const dt = !unbindTabs && e.target.closest && e.target.closest('.case-detail [role="tab"][data-tab]');
    if (dt && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const i = DETAIL_TABS.indexOf(tabIdOf(dt));
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? DETAIL_TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : DETAIL_TABS.length - 1)) % DETAIL_TABS.length;
      showDetail(DETAIL_TABS[n]);
      root.querySelector('.case-detail [role="tab"][aria-selected="true"]')?.focus();
      return;
    }
    const tr = e.target.closest && e.target.closest('#diff-table tr[data-key]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectCheck(tr.dataset.key); return; }
    if (tr && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const sib = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
      if (sib && sib.dataset.key) { sib.focus(); selectCheck(sib.dataset.key); }
      return;
    }
    const tab = e.target.closest && e.target.closest('.tab[data-role]');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const roles = rolesOf(run);
      const i = roles.indexOf(tab.dataset.role);
      const next = roles[(i + (e.key === 'ArrowRight' ? 1 : roles.length - 1)) % roles.length];
      state.role = next; state.location = null;
      drawViewer();
      root.querySelector(`#tab-${next}`)?.focus();
    }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  scrollToSelected();
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
    if (unbindTabs) { try { unbindTabs(); } catch { /* ignore */ } }
    delete ctx.caseState;
  };
}
