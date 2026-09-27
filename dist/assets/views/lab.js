// VARELQ · Stream A2 · Guard lab (#lab): baseline vs guarded runs, before/after, span diff.
// Real API only (PLAN.md §5): /api/lab/scenarios, /api/lab/run, /api/lab/batches[/{id}], /api/lab/traces/{id}.
import { esc, num, plural, ms, compact, humanize, relTime, badge, tag, svgIcon, http, hashParts } from '../components/trace-timeline.js';
import { diffView } from '../components/diff-view.js';
import { labPair } from './overview.js';

export const meta = { title: 'Guard lab', group: 'reliability' };

const RUNS = 5;

const S = {
  cfg: null, cfgError: null,
  scenario: null, guards: null,
  batchList: [],            // summaries from GET /api/lab/batches
  batches: {},              // batch_id -> full batch
  pick: {},                 // `${scenario}|${variant}` -> batch_id
  running: null,            // {variant, done, failed, started, errors:[]}
  runError: null,
  compareIndex: 0,
  traces: {},               // trace_id -> trace | {error}
  compareBusy: false,
};

let rootEl = null;
let timer = null;

// ---------- pure helpers ----------
export function newBatchId() {
  const rnd = Math.random().toString(36).slice(2, 7).replace(/[^a-z0-9]/g, '') || 'x';
  return `b-${Date.now().toString(36)}-${rnd}`;
}

export function variantOf(guards) { return guards && guards.length ? 'guarded' : 'baseline'; }

// Latest batch per scenario|variant from the list endpoint (newest first expected; sort defensively).
export function latestPicks(list) {
  const out = {};
  const sorted = [...(list || [])].sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
  for (const b of sorted) {
    const k = `${b.scenario_id}|${b.variant || variantOf(b.guards)}`;
    if (!out[k]) out[k] = b.batch_id;
  }
  return out;
}

export function runsByIndex(batch) {
  return [...((batch && batch.runs) || [])].sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
}

export function escalatedCount(batch) {
  const sm = (batch && batch.summary) || {};
  if (sm.escalations !== undefined && sm.escalations !== null) return Number(sm.escalations);
  return runsByIndex(batch).filter(r => r.escalated_to_human).length;
}

// Sum retries_by_status over runs -> "429×2, 503×1"
export function retriesText(batch) {
  const t = {};
  for (const r of runsByIndex(batch)) for (const [k, n] of Object.entries(r.retries_by_status || {})) t[k] = (t[k] || 0) + Number(n || 0);
  const e = Object.entries(t).filter(([, n]) => n).sort();
  return e.length ? `Retries ${e.map(([k, n]) => `${k}×${n}`).join(', ')}` : '';
}

// Honest provenance of the LLM behind a batch.
export function liveTag(batch) {
  const runs = runsByIndex(batch);
  if (!runs.length) return '';
  const live = batch.live === true || runs.every(r => r.live === true);
  const scripted = runs.some(r => r.live === false || (r.llm_source && r.llm_source !== 'nim.chat_json'));
  if (live && !scripted) return tag('recorded', 'Recorded live run');
  if (scripted) return badge('Scripted LLM', 'warning');
  return '';
}

// ---------- loading ----------
async function loadAll() {
  S.cfgError = null;
  const [cfg, list] = await Promise.allSettled([
    S.cfg ? Promise.resolve(S.cfg) : http('/api/lab/scenarios'),
    http('/api/lab/batches?limit=50'),
  ]);
  if (cfg.status === 'fulfilled') S.cfg = cfg.value; else S.cfgError = cfg.reason.message;
  if (list.status === 'fulfilled') {
    S.batchList = (list.value && list.value.batches) || [];
    const latest = latestPicks(S.batchList);
    for (const k of Object.keys(latest)) if (!S.pick[k]) S.pick[k] = latest[k];
  }
  if (S.cfg) {
    const sc = S.cfg.scenarios || [];
    if (!S.scenario || !sc.some(s => s.id === S.scenario)) {
      // Open on the same paired scenario the Overview tile shows (largest measured guard difference), else S1.
      const pair = labPair(S.batchList);
      const want = pair && sc.some(s => s.id === pair.scenario) ? pair.scenario : 'S1';
      S.scenario = (sc.find(s => s.id === want) || sc[0] || {}).id || null;
    }
    if (!S.guards) S.guards = (S.cfg.guards || []).map(g => g.id);
  }
  await loadPickedBatches();
}

async function loadBatch(id, force = false) {
  if (!id) return null;
  if (!force && S.batches[id]) return S.batches[id];
  try { S.batches[id] = await http(`/api/lab/batches/${encodeURIComponent(id)}`); }
  catch (e) { S.batches[id] = { batch_id: id, error: e.message }; }
  return S.batches[id];
}

async function loadPickedBatches() {
  if (!S.scenario) return;
  await Promise.all(['baseline', 'guarded'].map(v => loadBatch(S.pick[`${S.scenario}|${v}`])));
}

function current(variant) {
  const id = S.pick[`${S.scenario}|${variant}`];
  const b = id ? S.batches[id] : null;
  return b && !b.error ? b : null;
}

async function loadTrace(id) {
  if (!id || S.traces[id]) return S.traces[id];
  try { S.traces[id] = await http(`/api/lab/traces/${encodeURIComponent(id)}`); }
  catch (e) { S.traces[id] = { error: e.message }; }
  return S.traces[id];
}

// ---------- rendering ----------
const cap = t => { const x = String(t || ''); return x.charAt(0).toUpperCase() + x.slice(1); };
function btn(label, { action, primary = false, disabled = false, busy = false, icon = null, extra = '' } = {}) {
  return `<button type="button" class="rl-btn ${primary ? 'rl-btn--primary' : 'rl-btn--secondary'}" data-action="${esc(action)}"${disabled || busy ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''} ${extra}>${busy ? '<span class="rl-spinner" aria-hidden="true"></span><span class="rl-working">Working…</span>' : `${icon ? svgIcon(icon, 16) : ''}<span>${esc(label)}</span>`}</button>`;
}

function scenarioObj() { return ((S.cfg && S.cfg.scenarios) || []).find(s => s.id === S.scenario) || null; }

function headerHtml() {
  const a = (S.cfg && S.cfg.agent) || {};
  const stub = S.cfg && S.cfg.stub;
  const agentBits = [
    a.model ? `<span class="rl-mono">${esc(String(a.model).replace(/^nvidia\//, ''))}</span>` : '',
    a.endpoint_kind ? esc(humanize(a.endpoint_kind)) : '',
    a.protocol ? esc(a.protocol === 'json-action' ? 'JSON-action' : humanize(a.protocol)) : '',
    a.temperature !== undefined ? `T ${esc(a.temperature)}` : '',
    a.max_turns !== undefined ? `max ${esc(a.max_turns)} turns` : '',
  ].filter(Boolean).join(' · ');
  return `<header class="rl-head"><div class="rl-head-title"><h1>Guard lab</h1>${tag('synthetic')}${stub ? tag('stub') : ''}</div>
    <div class="rl-head-meta">${agentBits ? `<span class="rl-muted">Agent</span> ${agentBits}` : ''}</div></header>`;
}

function controlsHtml() {
  const sc = (S.cfg && S.cfg.scenarios) || [];
  const guards = (S.cfg && S.cfg.guards) || [];
  const s = scenarioObj();
  const run = S.running;
  const seg = `<div class="rl-seg" role="radiogroup" aria-label="Scenario">${sc.map(x => `<button type="button" role="radio" class="rl-seg-opt" aria-checked="${x.id === S.scenario}" data-scenario="${esc(x.id)}"${run ? ' disabled' : ''}><span class="rl-mono">${esc(x.id)}</span> ${esc(x.title)}</button>`).join('')}</div>`;
  const sDesc = s ? `<dl class="rl-scn">
      <div><dt>Fault</dt><dd>${esc(cap(s.fault))}</dd></div>
      <div><dt>Expected</dt><dd>${esc(cap(s.expected))}</dd></div>
      ${s.precondition ? `<div><dt>Payment precondition</dt><dd>${esc(s.precondition)}</dd></div>` : ''}
    </dl>` : '';
  const gl = guards.map(g => `<label class="rl-check"><input type="checkbox" data-guard="${esc(g.id)}"${S.guards && S.guards.includes(g.id) ? ' checked' : ''}${run ? ' disabled' : ''}>
      <span><strong>${esc(g.label || humanize(g.id))}</strong> <span class="rl-muted">${esc(g.mode || '')}</span></span></label>`).join('');
  const noGuard = !S.guards || !S.guards.length;
  const prog = run ? progressHtml(run) : `<div class="rl-progress-wrap" aria-live="polite"></div>`;
  return `<section class="rl-panel rl-controls" aria-label="Run setup">
    <div class="rl-ctl-row"><span class="rl-label">Scenario</span>${seg}</div>
    ${sDesc}
    <div class="rl-ctl-row"><span class="rl-label">Guard</span><div class="rl-guards">${gl || '<span class="rl-muted">No guards available</span>'}</div></div>
    <div class="rl-ctl-row rl-ctl-actions">
      ${btn(`Run baseline ×${RUNS}`, { action: 'run-baseline', busy: run && run.variant === 'baseline', disabled: !!run || !S.scenario, icon: 'play' })}
      ${btn(`Run guarded ×${RUNS}`, { action: 'run-guarded', primary: true, busy: run && run.variant === 'guarded', disabled: !!run || !S.scenario || noGuard, icon: 'play' })}
      ${prog}
    </div>
    ${S.runError ? `<div class="rl-error" role="alert">${svgIcon('alert-triangle', 16)}<span>${esc(S.runError)}</span></div>` : ''}
  </section>`;
}

function progressHtml(run) {
  const pct = Math.round((run.done / RUNS) * 100);
  const secs = Math.floor((Date.now() - run.started) / 1000);
  const label = `Run ${run.done} of ${RUNS} complete${run.failed ? ` · ${plural(run.failed, 'failed', 'failed')}` : ''}`;
  return `<div class="rl-progress-wrap">
    <div class="rl-progress" role="progressbar" aria-label="${esc(humanize(run.variant))} runs" aria-valuemin="0" aria-valuemax="${RUNS}" aria-valuenow="${run.done}"><div class="rl-progress-fill" style="transform:scaleX(${pct / 100})"></div></div>
    <span class="rl-progress-label" aria-live="polite">${esc(label)}</span><span class="rl-muted rl-mono" data-elapsed>${secs} s</span>
  </div>`;
}

function metric(label, value, of, tone = '') {
  return `<div class="rl-metric${tone ? ' rl-metric--' + tone : ''}"><span class="rl-metric-label">${esc(label)}</span><span class="rl-metric-value">${value}${of !== undefined ? `<span class="rl-of">/${esc(of)}</span>` : ''}</span></div>`;
}

function batchOptions(variant) {
  const opts = S.batchList.filter(b => b.scenario_id === S.scenario && (b.variant || variantOf(b.guards)) === variant);
  const cur = S.pick[`${S.scenario}|${variant}`];
  if (opts.length < 2) return '';
  return `<label class="rl-batch-pick"><span class="rl-sr">Choose ${variant} batch</span>${svgIcon('history', 14)}<select data-batch-variant="${variant}">${opts.map(b => `<option value="${esc(b.batch_id)}"${b.batch_id === cur ? ' selected' : ''}>${esc(relTime(b.created) || b.batch_id)} · ${esc(b.batch_id)}</option>`).join('')}</select></label>`;
}

function columnHtml(variant) {
  const b = current(variant);
  const id = S.pick[`${S.scenario}|${variant}`];
  const errB = id && S.batches[id] && S.batches[id].error;
  const title = variant === 'baseline' ? 'Baseline' : 'Guarded';
  const head = `<div class="rl-panel-head"><h2>${title}</h2><div class="rl-tags">${b ? liveTag(b) : ''}${b && b.guards && b.guards.length ? badge(b.guards.map(humanize).join(', '), 'neutral') : variant === 'baseline' ? badge('No guard', 'neutral') : ''}${batchOptions(variant)}</div></div>`;
  if (errB) return `<section class="rl-panel rl-col">${head}<div class="rl-error" role="alert">${svgIcon('alert-triangle', 16)}<span>${esc(errB)}</span><button type="button" class="rl-btn rl-btn--ghost" data-action="reload">Retry</button></div></section>`;
  if (!b) return `<section class="rl-panel rl-col">${head}<div class="rl-empty"><p>No ${variant} runs for this scenario yet.</p>${btn(`Run ${variant} ×${RUNS}`, { action: `run-${variant}`, primary: variant === 'guarded', disabled: !!S.running || (variant === 'guarded' && (!S.guards || !S.guards.length)), icon: 'play' })}</div></section>`;
  const sm = b.summary || {};
  const n = sm.runs ?? runsByIndex(b).length;
  const so = scenarioObj();
  const control = S.scenario === 'S0' || (so && (so.payable === true || so.expected === 'approve'));
  const tiles = [];
  if (control) {
    tiles.push(metric('Legitimate approvals', num(sm.legit_approvals), num(n), 'good'));
    tiles.push(metric('False blocks', num(sm.false_blocks), undefined, Number(sm.false_blocks) ? 'bad' : ''));
    tiles.push(metric('Unsafe', num(sm.unsafe), num(n), Number(sm.unsafe) ? 'bad' : ''));
  } else {
    tiles.push(metric('Unsafe', num(sm.unsafe), num(n), Number(sm.unsafe) ? 'bad' : 'good'));
    if (variant === 'guarded') tiles.push(metric('False blocks', num(sm.false_blocks), undefined, Number(sm.false_blocks) ? 'bad' : ''));
    else tiles.push(metric('Legitimate approvals', num(sm.legit_approvals)));
  }
  if (variant === 'guarded') {
    tiles.push(metric('Blocked calls', num(sm.blocked_calls)));
    tiles.push(metric('Escalated to a human', num(escalatedCount(b)), num(n)));
  } else {
    tiles.push(metric('Clarifications', num(sm.clarifications)));
    tiles.push(metric('Holds', num(sm.holds)));
  }
  const foot = [
    `Turns median ${num(sm.turns_median)}`,
    `${ms(sm.duration_ms_median)} median`,
    `${compact(sm.tokens_total)} tokens`,
    sm.errors ? plural(sm.errors, 'error', 'errors') : '',
    sm.dishonest_final_answers ? `${plural(sm.dishonest_final_answers, 'dishonest final answer', 'dishonest final answers')}` : '',
    retriesText(b),
  ].filter(Boolean).join(' · ');
  const runs = runsByIndex(b).map(r => {
    const tone = r.unsafe ? 'danger' : r.false_block ? 'warning' : r.status === 'error' ? 'danger' : r.legit_approval ? 'success' : 'neutral';
    const lab = r.unsafe ? 'Unsafe' : r.false_block ? 'False block' : r.status === 'error' ? 'Error' : r.legit_approval ? 'Legitimate approval' : 'Safe';
    const sel = Number(r.index) === S.compareIndex;
    return `<tr class="rl-row${sel ? ' rl-selected' : ''}" data-index="${esc(r.index)}" tabindex="0" aria-selected="${sel}">
      <td class="rl-mono">#${esc(r.index)}</td><td>${esc(humanize(r.outcome))}</td><td>${badge(lab, tone)}</td>
      <td class="rl-num">${r.blocked_count ? plural(r.blocked_count, 'block', 'blocks') : ''}</td>
      <td class="rl-num rl-mono">${num(r.turns)}</td><td class="rl-num rl-mono">${esc(ms(r.duration_ms))}</td></tr>`;
  }).join('');
  return `<section class="rl-panel rl-col" aria-label="${title} runs">${head}
    <div class="rl-metrics">${tiles.join('')}</div>
    <p class="rl-caption">${esc(foot)}</p>
    <div class="rl-table-wrap"><table class="rl-table rl-table--runs"><caption class="rl-sr">${title} runs</caption>
      <thead><tr><th scope="col">Run</th><th scope="col">Outcome</th><th scope="col">Safety</th><th scope="col" class="rl-num">Guard</th><th scope="col" class="rl-num">Turns</th><th scope="col" class="rl-num">Time</th></tr></thead>
      <tbody>${runs}</tbody></table></div>
    <p class="rl-caption rl-mono">${esc(b.batch_id)}${b.created ? ` · ${esc(relTime(b.created))}` : ''}</p>
  </section>`;
}

const perRun = (t, n) => (Number(n) ? Math.round(Number(t) / Number(n)) : null);

function beforeAfterHtml() {
  const base = current('baseline'), g = current('guarded');
  if (!base || !g) return '';
  const a = base.summary || {}, b = g.summary || {};
  const na = a.runs ?? runsByIndex(base).length, nb = b.runs ?? runsByIndex(g).length;
  const row = (label, x, y, of = true) => `<div class="rl-ba"><span class="rl-metric-label">${esc(label)}</span><span class="rl-ba-values"><span class="rl-mono">${esc(x)}${of ? `/${esc(na)}` : ''}</span>${svgIcon('chevron-right', 14)}<span class="rl-mono">${esc(y)}${of ? `/${esc(nb)}` : ''}</span></span></div>`;
  return `<section class="rl-panel rl-before-after" aria-label="Before and after">
    <div class="rl-panel-head"><h2>Before → after</h2><div class="rl-tags">${tag('synthetic')}</div></div>
    <div class="rl-ba-grid">
      ${row('Unsafe approvals', num(a.unsafe), num(b.unsafe))}
      ${row('Legitimate approvals', num(a.legit_approvals), num(b.legit_approvals))}
      ${row('False blocks', num(a.false_blocks), num(b.false_blocks), false)}
      ${row('Turns median', num(a.turns_median), num(b.turns_median), false)}
      ${row('Duration median', ms(a.duration_ms_median), ms(b.duration_ms_median), false)}
      ${row('Tokens per run', compact(perRun(a.tokens_total, na)), compact(perRun(b.tokens_total, nb)), false)}
    </div>
  </section>`;
}

function compareShell() {
  const base = current('baseline'), g = current('guarded');
  if (!base || !g) return '';
  const idx = [...new Set([...runsByIndex(base), ...runsByIndex(g)].map(r => Number(r.index)))].sort((x, y) => x - y);
  if (!idx.includes(S.compareIndex)) S.compareIndex = idx[0] ?? 0;
  const seg = `<div class="rl-seg" role="radiogroup" aria-label="Run to compare">${idx.map(i => `<button type="button" role="radio" class="rl-seg-opt" aria-checked="${i === S.compareIndex}" data-compare="${i}"><span class="rl-mono">#${i}</span></button>`).join('')}</div>`;
  return `<section class="rl-panel" aria-label="Compare runs">
    <div class="rl-panel-head"><h2>${svgIcon('git-compare', 20)} Compare run #${esc(S.compareIndex)} <span class="rl-muted">· paired by index</span></h2>${seg}</div>
    <div data-slot="diff">${diffBody()}</div>
  </section>`;
}

function diffBody() {
  const base = current('baseline'), g = current('guarded');
  const rb = runsByIndex(base).find(r => Number(r.index) === S.compareIndex);
  const rg = runsByIndex(g).find(r => Number(r.index) === S.compareIndex);
  if (!rb || !rg) return `<div class="rl-empty"><p>Run #${esc(S.compareIndex)} is missing on one side.</p></div>`;
  const tb = S.traces[rb.trace_id], tg = S.traces[rg.trace_id];
  if (!tb || !tg) return `<div class="rl-busy" role="status"><div class="rl-indeterminate" aria-hidden="true"></div><span>Loading spans…</span></div>`;
  if (tb.error || tg.error) return `<div class="rl-error" role="alert">${svgIcon('alert-triangle', 16)}<span>${esc(tb.error || tg.error)}</span><button type="button" class="rl-btn rl-btn--ghost" data-action="retry-diff">Retry</button></div>`;
  return diffView({ trace: tb, run: rb }, { trace: tg, run: rg }, { index: S.compareIndex });
}

async function refreshDiff() {
  const base = current('baseline'), g = current('guarded');
  if (!base || !g) return;
  const rb = runsByIndex(base).find(r => Number(r.index) === S.compareIndex);
  const rg = runsByIndex(g).find(r => Number(r.index) === S.compareIndex);
  const slot = () => rootEl && rootEl.querySelector('[data-slot="diff"]');
  if (slot()) slot().innerHTML = diffBody();
  if (!rb || !rg) return;
  await Promise.all([loadTrace(rb.trace_id), loadTrace(rg.trace_id)]);
  if (slot()) slot().innerHTML = diffBody();
}

function pageHtml() {
  if (S.cfgError && !S.cfg) return `${`<header class="rl-head"><div class="rl-head-title"><h1>Guard lab</h1>${tag('synthetic')}</div></header>`}<div class="rl-error" role="alert">${svgIcon('alert-triangle', 16)}<span>${esc(S.cfgError)}</span><button type="button" class="rl-btn rl-btn--ghost" data-action="reload">Retry</button></div>`;
  return `${headerHtml()}${controlsHtml()}
    ${beforeAfterHtml()}
    <div class="rl-cols">${columnHtml('baseline')}${columnHtml('guarded')}</div>
    ${compareShell()}`;
}

function paint() {
  if (!rootEl || !rootEl.isConnected || !rootEl.querySelector('.rl-view[data-view="lab"]')) return;
  rootEl.innerHTML = `<div class="rl-view" data-view="lab">${pageHtml()}</div>`;
  refreshDiff();
}

// ---------- actions ----------
async function runFive(variant) {
  if (S.running || !S.scenario) return;
  const guards = variant === 'guarded' ? [...(S.guards || [])] : [];
  if (variant === 'guarded' && !guards.length) return;
  const batch_id = newBatchId();
  const scenario_id = S.scenario;
  S.running = { variant, done: 0, failed: 0, started: Date.now(), errors: [] };
  S.runError = null;
  paint();
  clearInterval(timer);
  timer = setInterval(() => {
    const el = rootEl && rootEl.querySelector('[data-elapsed]');
    if (el && S.running) el.textContent = `${Math.floor((Date.now() - S.running.started) / 1000)} s`;
  }, 1000);
  const tick = () => {
    const wrap = rootEl && rootEl.querySelector('.rl-progress-wrap');
    if (wrap && S.running) wrap.outerHTML = progressHtml(S.running);
  };
  await Promise.allSettled(Array.from({ length: RUNS }, (_, index) =>
    http('/api/lab/run', { scenario_id, guards, batch_id, index })
      .then(() => { S.running.done++; tick(); })
      .catch(e => { S.running.done++; S.running.failed++; S.running.errors.push(e.message); tick(); })));
  const failed = S.running.failed, errs = S.running.errors;
  clearInterval(timer);
  try {
    const b = await loadBatch(batch_id, true);
    if (b && !b.error) {
      S.pick[`${scenario_id}|${variant}`] = batch_id;
      S.batchList.unshift({ batch_id, scenario_id, variant, guards, created: b.created || new Date().toISOString(), summary: b.summary });
    } else {
      S.runError = `No runs were recorded: ${errs[0] || (b && b.error) || 'unknown error'}`;
    }
    if (failed && !S.runError) S.runError = `${plural(failed, 'run', 'runs')} of ${RUNS} failed: ${errs[0]}`;
  } finally {
    S.running = null;
    paint();
  }
}

// ---------- module contract ----------
export async function render(ctx) {
  const { query } = hashParts();
  await loadAll();
  const want = query.get('guard');
  if (want && S.cfg && (S.cfg.guards || []).some(g => g.id === want) && !S.guards.includes(want)) S.guards.push(want);
  return `<div class="rl-view" data-view="lab">${pageHtml()}</div>`;
}

export function mount(root, ctx) {
  rootEl = root;
  const onClick = async e => {
    const a = e.target.closest('[data-action]');
    if (a && root.contains(a)) {
      const act = a.dataset.action;
      if (act === 'run-baseline') return runFive('baseline');
      if (act === 'run-guarded') return runFive('guarded');
      if (act === 'reload') { S.cfg = null; S.batches = {}; await loadAll(); return paint(); }
      if (act === 'retry-diff') {
        for (const k of Object.keys(S.traces)) if (S.traces[k] && S.traces[k].error) delete S.traces[k];
        return refreshDiff();
      }
    }
    const sc = e.target.closest('[data-scenario]');
    if (sc && root.contains(sc) && !S.running) {
      if (sc.dataset.scenario === S.scenario) return;
      S.scenario = sc.dataset.scenario; S.compareIndex = 0; S.runError = null;
      await loadPickedBatches();
      return paint();
    }
    const cmp = e.target.closest('[data-compare]');
    if (cmp && root.contains(cmp)) { S.compareIndex = Number(cmp.dataset.compare); return paintCompare(); }
    const row = e.target.closest('.rl-row[data-index]');
    if (row && root.contains(row)) { S.compareIndex = Number(row.dataset.index); paintCompare(); const d = root.querySelector('[data-slot="diff"]'); if (d && d.scrollIntoView) d.scrollIntoView({ block: 'start', behavior: 'auto' }); }
  };
  const onChange = async e => {
    const cb = e.target.closest('[data-guard]');
    if (cb) {
      const id = cb.dataset.guard;
      S.guards = cb.checked ? [...new Set([...(S.guards || []), id])] : (S.guards || []).filter(x => x !== id);
      const gb = root.querySelector('[data-action="run-guarded"]');
      if (gb) gb.disabled = !S.guards.length || !!S.running;
      return;
    }
    const sel = e.target.closest('[data-batch-variant]');
    if (sel) {
      S.pick[`${S.scenario}|${sel.dataset.batchVariant}`] = sel.value;
      await loadBatch(sel.value);
      paint();
    }
  };
  const onKey = e => {
    const row = e.target.closest && e.target.closest('.rl-row[data-index]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKey);
  refreshDiff();
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('keydown', onKey);
    if (rootEl === root) rootEl = null;
  };
}

function paintCompare() {
  if (!rootEl) return;
  rootEl.querySelectorAll('[data-compare]').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.compare) === S.compareIndex)));
  rootEl.querySelectorAll('.rl-row[data-index]').forEach(r => { const on = Number(r.dataset.index) === S.compareIndex; r.classList.toggle('rl-selected', on); r.setAttribute('aria-selected', String(on)); });
  const h = rootEl.querySelector('[aria-label="Compare runs"] h2');
  if (h) h.innerHTML = `${svgIcon('git-compare', 20)} Compare run #${esc(S.compareIndex)} <span class="rl-muted">· paired by index</span>`;
  refreshDiff();
}
