// Search / command palette (Ctrl/Cmd+K). A modal dialog with a combobox input and a grouped listbox.
// Sources: pages (given by the shell), document runs (GET /api/runs), reliability findings
// (GET /api/reliability/latest?dataset=agentrx-tau-retail) and lab batches (GET /api/lab/batches).
// The last option is always "Ask VARELQ: <query>" -> #chat?q=<query>.
import { esc } from '../format.js';
import { icon } from '../icons.js';

const DATASET = 'agentrx-tau-retail';
const TTL = 60000;
const PER_GROUP = 6;

let data = null; let dataAt = 0; let loading = null;
let open = null; // { root, restoreFocus, ... }

const tr = (t, key, fallback) => (typeof t === 'function' ? t(key, fallback) : fallback);

function fold(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Score an item against the query tokens: every token must appear; prefix and early matches rank higher. */
export function score(item, tokens) {
  if (!tokens.length) return 1;
  const label = fold(item.label);
  const hay = item.hay;
  let s = 0;
  for (const tok of tokens) {
    const at = hay.indexOf(tok);
    if (at < 0) return 0;
    const inLabel = label.indexOf(tok);
    if (inLabel === 0) s += 6;
    else if (inLabel > 0) s += /[\s\-_/·]/.test(label[inLabel - 1]) ? 4 : 2;
    else s += 1;
  }
  return s;
}

function prep(item) { return { ...item, hay: fold(`${item.label} ${item.sub || ''} ${item.keywords || ''}`) }; }

async function loadData(api) {
  if (data && Date.now() - dataAt < TTL) return data;
  if (loading) return loading;
  const settle = (p) => p.then((v) => v, () => null);
  loading = Promise.all([
    settle(api.get('/api/runs')),
    settle(api.get(`/api/reliability/latest?dataset=${encodeURIComponent(DATASET)}`)),
    settle(api.get('/api/lab/batches')),
  ]).then(([runs, rel, lab]) => {
    const out = { documents: [], findings: [], batches: [], failed: [] };
    if (runs && Array.isArray(runs.runs)) {
      for (const r of runs.runs) {
        if (!r || r.kind !== 'documents') continue;
        const ref = r.invoice_reference || '';
        const sup = r.supplier || '';
        out.documents.push(prep({
          kind: 'document', icon: 'file-text', href: `#cases/${encodeURIComponent(r.id)}`,
          label: ref || sup || 'Document run', sub: [ref ? sup : '', r.decision ? String(r.decision).replace(/_/g, ' ') : ''].filter(Boolean).join(' · '),
          keywords: `${r.id} ${sup} ${ref} ${r.currency || ''}`,
        }));
      }
    } else out.failed.push('runs');
    const report = rel && (rel.groups ? rel : rel.report);
    if (report && Array.isArray(report.groups)) {
      for (const g of report.groups) {
        if (!g || !g.title) continue;
        out.findings.push(prep({
          kind: 'finding', icon: 'shield-alert', href: `#reliability?group=${encodeURIComponent(g.group_id || '')}`,
          label: g.title, sub: [g.severity, g.runs_affected != null ? `${g.runs_affected} runs` : ''].filter(Boolean).join(' · '),
          keywords: `${g.group_id || ''} ${g.pattern_id || ''}`,
        }));
      }
    } else if (!rel) out.failed.push('findings');
    if (lab && Array.isArray(lab.batches)) {
      for (const b of lab.batches) {
        if (!b) continue;
        const variant = b.variant || (b.guards && b.guards.length ? 'guarded' : 'baseline');
        const sm = b.summary || {};
        out.batches.push(prep({
          kind: 'batch', icon: 'flask-conical', href: '#lab',
          label: `${b.scenario_id || 'Scenario'} · ${variant}`,
          sub: [sm.runs != null ? `${sm.runs} runs` : '', sm.unsafe != null ? `${sm.unsafe} unsafe` : '', (b.guards || []).join(', ')].filter(Boolean).join(' · '),
          keywords: `${b.batch_id || ''} ${(b.guards || []).join(' ')} lab batch`,
        }));
      }
    } else out.failed.push('batches');
    data = out; dataAt = Date.now();
    return out;
  }).finally(() => { loading = null; });
  return loading;
}

/** Drop cached records (e.g. after a new upload). */
export function invalidatePalette() { data = null; }

export function isPaletteOpen() { return !!open; }

export function closePalette() {
  if (!open) return;
  const { root, restoreFocus, onKeyDoc } = open;
  open = null;
  document.removeEventListener('keydown', onKeyDoc, true);
  root.classList.add('closing');
  const done = () => root.remove();
  const m = document.documentElement.dataset.motion;
  const reduced = m === 'off' || m === 'reduced'
    || (m !== 'full' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduced) done(); else setTimeout(done, 120);
  document.body.classList.remove('palette-open');
  if (restoreFocus && document.contains(restoreFocus)) { try { restoreFocus.focus({ preventScroll: true }); } catch { /* ignore */ } }
}

/**
 * openPalette({ api, navigate, pages: [{label, href, icon, keywords?}], t?, query? })
 */
export function openPalette(opts) {
  if (open) { open.input.focus(); open.input.select(); return; }
  const { api, navigate, pages = [], t } = opts;
  const pageItems = pages.map((p) => prep({ kind: 'page', icon: p.icon || 'arrow-right', href: p.href || '', run: typeof p.run === 'function' ? p.run : null, label: p.label, sub: p.sub || '', keywords: p.keywords || '' }));
  const GROUPS = [
    { key: 'pages', label: tr(t, 'palette.pages', 'Pages') },
    { key: 'documents', label: tr(t, 'palette.documents', 'Document runs') },
    { key: 'findings', label: tr(t, 'palette.findings', 'Reliability findings') },
    { key: 'batches', label: tr(t, 'palette.batches', 'Lab batches') },
  ];

  const root = document.createElement('div');
  root.className = 'palette-root';
  const placeholder = tr(t, 'palette.searchAll', 'Search pages, invoices, suppliers, findings…');
  root.innerHTML = `
<div class="palette-scrim" data-palette-close></div>
<div class="palette" role="dialog" aria-modal="true" aria-label="${esc(tr(t, 'palette.title', 'Search'))}">
  <div class="palette-field">
    ${icon('search', 18)}
    <input class="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
      autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">
    <kbd class="palette-kbd">Esc</kbd>
  </div>
  <div class="palette-list" id="palette-list" role="listbox" aria-label="${esc(tr(t, 'palette.results', 'Results'))}"></div>
  <div class="palette-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> ${esc(tr(t, 'palette.move', 'move'))}</span><span><kbd>↵</kbd> ${esc(tr(t, 'palette.open', 'open'))}</span><span class="palette-status"></span></div>
</div>`;
  document.body.appendChild(root);
  document.body.classList.add('palette-open');
  const input = root.querySelector('.palette-input');
  const list = root.querySelector('.palette-list');
  const status = root.querySelector('.palette-status');
  let flat = []; let active = 0; let records = data;

  function render() {
    const q = input.value.trim();
    const tokens = fold(q).split(/\s+/).filter(Boolean);
    const sources = { pages: pageItems, documents: records ? records.documents : [], findings: records ? records.findings : [], batches: records ? records.batches : [] };
    flat = [];
    let html = '';
    for (const g of GROUPS) {
      const matches = sources[g.key].map((it) => ({ it, s: score(it, tokens) })).filter((x) => x.s > 0);
      if (tokens.length) matches.sort((a, b) => b.s - a.s);
      const shown = matches.slice(0, g.key === 'pages' && !tokens.length ? 12 : PER_GROUP);
      if (!shown.length) continue;
      html += `<div class="palette-group" role="presentation"><div class="palette-group-label" role="presentation">${esc(g.label)}</div>`;
      for (const { it } of shown) {
        const i = flat.length;
        flat.push(it);
        html += option(it, i);
      }
      html += '</div>';
    }
    if (q) {
      const ask = { kind: 'ask', icon: 'message-square', href: `#chat?q=${encodeURIComponent(q.slice(0, 1000))}`, label: `${tr(t, 'palette.ask', 'Ask VARELQ')}: ${q}`, sub: '' };
      const i = flat.length;
      flat.push(ask);
      html += `<div class="palette-group" role="presentation">${option(ask, i)}</div>`;
    }
    if (!flat.length) html = `<div class="palette-empty">${esc(tr(t, 'palette.empty', 'Type to search.'))}</div>`;
    list.innerHTML = html;
    active = Math.min(active, Math.max(0, flat.length - 1));
    highlight(false);
  }

  function option(it, i) {
    return `<div class="palette-item" role="option" id="palette-opt-${i}" data-i="${i}" aria-selected="false">${icon(it.icon, 16)}<span class="palette-text"><span class="palette-label truncate">${esc(it.label)}</span>${it.sub ? `<span class="palette-sub truncate">${esc(it.sub)}</span>` : ''}</span>${icon('corner-down-left', 14, 'palette-enter')}</div>`;
  }

  function highlight(scroll = true) {
    list.querySelectorAll('.palette-item').forEach((el) => el.setAttribute('aria-selected', String(Number(el.dataset.i) === active)));
    const el = list.querySelector(`#palette-opt-${active}`);
    if (el) {
      input.setAttribute('aria-activedescendant', el.id);
      if (scroll) el.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function choose(i, newTab) {
    const it = flat[i];
    if (!it) return;
    closePalette();
    if (it.run) { it.run(); return; }
    if (newTab) window.open(it.href, '_blank', 'noopener');
    else navigate(it.href);
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) { active = (active + 1) % flat.length; highlight(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) { active = (active - 1 + flat.length) % flat.length; highlight(); } }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); active = 0; highlight(); }
    else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); active = Math.max(0, flat.length - 1); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active, e.ctrlKey || e.metaKey); }
  });
  list.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.palette-item');
    if (el && Number(el.dataset.i) !== active) { active = Number(el.dataset.i); highlight(false); }
  });
  list.addEventListener('mousedown', (e) => { if (e.target.closest('.palette-item')) e.preventDefault(); });
  list.addEventListener('click', (e) => {
    const el = e.target.closest('.palette-item');
    if (el) choose(Number(el.dataset.i), e.ctrlKey || e.metaKey);
  });
  root.addEventListener('click', (e) => { if (e.target.closest('[data-palette-close]')) closePalette(); });

  // Focus trap: the input is the only focus stop; Esc closes. Captured so views never see these keys.
  const onKeyDoc = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); return; }
    if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
  };
  document.addEventListener('keydown', onKeyDoc, true);
  root.addEventListener('focusout', () => { setTimeout(() => { if (open && open.root === root && !root.contains(document.activeElement)) input.focus(); }, 0); });

  open = { root, input, restoreFocus: document.activeElement, onKeyDoc };
  if (opts.query) input.value = opts.query;
  render();
  input.focus();

  if (!records) {
    status.textContent = tr(t, 'palette.loading', 'Loading records…');
    loadData(api).then((d) => {
      if (!open || open.root !== root) return;
      records = d;
      status.textContent = d.failed.length ? tr(t, 'palette.partial', 'Some records could not be loaded') : '';
      render();
    }).catch(() => { if (open && open.root === root) status.textContent = tr(t, 'palette.partial', 'Some records could not be loaded'); });
  } else if (Date.now() - dataAt > TTL) {
    loadData(api).then((d) => { if (open && open.root === root) { records = d; render(); } }).catch(() => {});
  }
}
