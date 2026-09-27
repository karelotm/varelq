// Settings sections rendered by the settings modal (components/settings-modal.js):
//   export const SETTINGS_SECTIONS = [{ id, label, icon, group, render(container, ctx) -> cleanup? }]
// The default view (#settings, if the router still calls it) shows the same sections as tabs and opens the modal when available.
import { esc, num, ms, hhmm, relTime, humanize, dateTime, plural, EMPTY } from '../format.js';
import { icon } from '../icons.js';
import { api as defaultApi } from '../api.js';
import { segmented } from '../components/segmented.js';
import { table } from '../components/table.js';
import { badge } from '../components/badge.js';
import { tag } from '../components/tag.js';
import { errorState, empty } from '../components/empty.js';
import { prefs, setPref, clearPrefs, onPrefs } from '../state.js';

export const meta = { title: 'Settings', group: 'settings' };

const REFRESH_MS = 10000;

/* ---------- shared helpers ---------- */
function apiOf(ctx) { return (ctx && ctx.api) || defaultApi; }
function toastOf(ctx) { return (ctx && typeof ctx.toast === 'function') ? ctx.toast : () => {}; }
function getJson(ctx, path) { return apiOf(ctx).get(path); }

function row(label, hint, control) {
  return `<div class="setting"><div><div class="label">${esc(label)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div><div>${control}</div></div>`;
}
function kvList(pairs) {
  return `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
}
function bytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return EMPTY;
  const gib = n / (1024 ** 3);
  return gib >= 1 ? `${gib.toFixed(1)} GiB` : `${Math.round(n / (1024 ** 2))} MiB`;
}
function clamp01(x) { return Math.max(0, Math.min(1, Number(x) || 0)); }

/** Thin horizontal meter. ratio in [0,1]; tone 'warn' past 0.9. */
export function meter(ratio, label) {
  const r = clamp01(ratio);
  const tone = r >= 0.9 ? ' meter-warn' : '';
  return `<div class="meter${tone}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(r * 100)}"${label ? ` aria-label="${esc(label)}"` : ''}><div class="meter-fill" style="width:${(r * 100).toFixed(1)}%"></div></div>`;
}
function meterRow(value, ratio, label) {
  return `<div class="meter-row"><span class="tabular">${value}</span>${ratio === null ? '' : meter(ratio, label)}</div>`;
}

/** Tabs: uses components/tabs.js (stream A) when present, else the same markup locally. */
let tabsModule;
async function loadTabs() {
  if (tabsModule !== undefined) return tabsModule;
  try { tabsModule = await import('../components/tabs.js'); } catch { tabsModule = null; }
  return tabsModule;
}
function localTabs({ id, items, active }) {
  return `<div class="tabs" role="tablist" data-tablist="${esc(id)}">${items.map((it) => `<button type="button" class="tab" role="tab" id="${esc(id)}-tab-${esc(it.id)}" data-tab="${esc(it.id)}" aria-selected="${it.id === active}" aria-controls="${esc(id)}-panel" tabindex="${it.id === active ? 0 : -1}">${esc(it.label)}${it.count !== undefined && it.count !== null ? ` <span class="subtle">${esc(it.count)}</span>` : ''}</button>`).join('')}</div>`;
}
function tabsMarkup(mod, opts) {
  if (mod && typeof mod.tabs === 'function') {
    try { return mod.tabs(opts); } catch { /* fall through */ }
  }
  return localTabs(opts);
}
/** Bind tab switching on the tablist inside `root`. onChange(tabId). Returns cleanup. */
function bindTabsSafe(mod, root, onChange) {
  const cb = (v) => onChange(v && typeof v === 'object' ? v.id : v);
  if (mod && typeof mod.bindTabs === 'function') {
    try { const c = mod.bindTabs(root, cb); return typeof c === 'function' ? c : () => {}; } catch { /* fall through */ }
  }
  const list = root.querySelector('[role="tablist"]');
  if (!list) return () => {};
  const tabsOf = () => [...list.querySelectorAll('[role="tab"]')];
  const idOf = (t) => t.dataset.tab || t.dataset.id || t.id;
  const select = (t, focus) => {
    tabsOf().forEach((x) => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
    if (focus) t.focus();
    cb(idOf(t));
  };
  const onClick = (e) => { const t = e.target.closest('[role="tab"]'); if (t && list.contains(t)) select(t, false); };
  const onKey = (e) => {
    const t = e.target.closest && e.target.closest('[role="tab"]');
    if (!t || !list.contains(t)) return;
    const all = tabsOf(); const i = all.indexOf(t);
    let n = null;
    if (e.key === 'ArrowRight') n = all[(i + 1) % all.length];
    else if (e.key === 'ArrowLeft') n = all[(i - 1 + all.length) % all.length];
    else if (e.key === 'Home') n = all[0];
    else if (e.key === 'End') n = all[all.length - 1];
    if (n) { e.preventDefault(); select(n, true); }
  };
  list.addEventListener('click', onClick);
  list.addEventListener('keydown', onKey);
  return () => { list.removeEventListener('click', onClick); list.removeEventListener('keydown', onKey); };
}

/** Poll fn every REFRESH_MS while container is connected and the page is visible. Returns stop(). */
function poll(container, fn) {
  let timer = setInterval(() => {
    if (!container.isConnected) { clearInterval(timer); timer = null; return; }
    if (document.hidden) return;
    fn();
  }, REFRESH_MS);
  const onHash = () => { if (!container.isConnected && timer) { clearInterval(timer); timer = null; } };
  window.addEventListener('hashchange', onHash);
  return () => { if (timer) clearInterval(timer); timer = null; window.removeEventListener('hashchange', onHash); };
}

/* ---------- General ---------- */
const THEMES = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];
function themeButtons() {
  const items = THEMES.map((o) => {
    const id = `set-theme-${o.value}`;
    return `<label class="seg-option seg-icon" for="${id}" title="${esc(o.label)}"><input type="radio" id="${id}" name="theme" value="${o.value}" aria-label="${esc(o.label)}"${prefs.theme === o.value ? ' checked' : ''}><span>${icon(o.icon, 16)}</span></label>`;
  }).join('');
  return `<div class="segmented" role="radiogroup" aria-label="Theme">${items}</div>`;
}
function generalHtml(i18n) {
  const motionValue = prefs.motion === 'system' || prefs.motion === 'full' ? 'system' : 'reduced';
  const rows = [
    row('Theme', 'System follows your operating system.', themeButtons()),
    row('Animations', 'Reduced keeps short fades only.', segmented({ name: 'motion', label: 'Animations', value: motionValue, options: [
      { value: 'system', label: 'System' }, { value: 'reduced', label: 'Reduced' }] })),
    row('Density', 'Compact fits more table rows on screen.', segmented({ name: 'density', label: 'Density', value: prefs.density, options: [
      { value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }] })),
  ];
  if (i18n && typeof i18n.getLang === 'function' && typeof i18n.setLang === 'function') {
    rows.push(row('Language', 'Applies to navigation and menus.', segmented({ name: 'lang', label: 'Language', value: i18n.getLang(), options: [
      { value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }] })));
  }
  return rows.join('');
}
async function renderGeneral(container) {
  let i18n = null;
  try { i18n = await import('../i18n.js'); } catch { i18n = null; }
  const draw = () => { container.innerHTML = `<div class="settings-rows">${generalHtml(i18n)}</div>`; };
  draw();
  const onChange = (e) => {
    const input = e.target;
    if (!input.matches('input[type=radio][name]')) return;
    if (['theme', 'density', 'motion'].includes(input.name)) setPref(input.name, input.value);
    else if (input.name === 'lang' && i18n) i18n.setLang(input.value);
  };
  container.addEventListener('change', onChange);
  // Keep the theme buttons in sync when the top-bar button changes the theme.
  const off = onPrefs(() => {
    const cur = container.querySelector(`input[name="theme"][value="${prefs.theme}"]`);
    if (cur && !cur.checked) cur.checked = true;
  });
  return () => { container.removeEventListener('change', onChange); off(); };
}

/* ---------- Organization ---------- */
const ORG_KEY = 'varelq.org.profile';
const ORG_DEFAULT = { name: 'Local workspace', legal: '', currency: 'EUR', country: '', contact: '', tolerance: '0' };
function readOrg() {
  try { const raw = localStorage.getItem(ORG_KEY); const o = raw ? JSON.parse(raw) : null; return { ...ORG_DEFAULT, ...(o && typeof o === 'object' ? o : {}) }; } catch { return { ...ORG_DEFAULT }; }
}
function writeOrg(o) {
  try { localStorage.setItem(ORG_KEY, JSON.stringify(o)); return true; } catch { return false; }
}
function orgHtml(o) {
  const text = (name, value, attrs = '') => `<input class="input" type="text" name="${name}" id="org-${name}" value="${esc(value)}" ${attrs}>`;
  const cur = ['EUR', 'USD', 'GBP', 'CHF'].map((c) => `<option value="${c}"${o.currency === c ? ' selected' : ''}>${c}</option>`).join('');
  return `<form class="settings-rows" id="org-form" novalidate>
  ${row('Organization name', 'Shown in the sidebar and on exports.', text('name', o.name, 'maxlength="80" required autocomplete="organization"'))}
  ${row('Legal entity', 'Registered name used on purchase orders.', text('legal', o.legal, 'maxlength="120"'))}
  ${row('Country', '', text('country', o.country, 'maxlength="60" autocomplete="country-name"'))}
  ${row('Default currency', 'Used when a document does not state one.', `<select class="select" name="currency" id="org-currency">${cur}</select>`)}
  ${row('Review contact', 'Who receives clarification requests.', `<input class="input" type="email" name="contact" id="org-contact" value="${esc(o.contact)}" maxlength="120" autocomplete="email">`)}
  ${row('Quantity tolerance', 'Differences at or below this many units are not flagged.', `<input class="input input-narrow" type="number" min="0" max="100" step="1" name="tolerance" id="org-tolerance" value="${esc(o.tolerance)}">`)}
  <div class="settings-actions"><span class="hint">Stored in this browser only.</span><button type="submit" class="btn btn-primary btn-sm">Save profile</button></div>
</form>`;
}
function renderOrganization(container, ctx) {
  container.innerHTML = orgHtml(readOrg());
  const onSubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const o = {
      name: String(f.name.value || '').trim().slice(0, 80) || ORG_DEFAULT.name,
      legal: String(f.legal.value || '').trim().slice(0, 120),
      country: String(f.country.value || '').trim().slice(0, 60),
      currency: f.currency.value,
      contact: String(f.contact.value || '').trim().slice(0, 120),
      tolerance: String(Math.max(0, Math.min(100, parseInt(f.tolerance.value, 10) || 0))),
    };
    if (o.contact && !f.contact.checkValidity()) { toastOf(ctx)('Enter a valid contact email.', 'danger'); f.contact.focus(); return; }
    const ok = writeOrg(o);
    window.dispatchEvent(new CustomEvent('varelq:org', { detail: o }));
    toastOf(ctx)(ok ? 'Organization profile saved.' : 'Saved for this session only (browser storage unavailable).', ok ? 'success' : 'warning');
  };
  const form = container.querySelector('#org-form');
  form.addEventListener('submit', onSubmit);
  return () => form.removeEventListener('submit', onSubmit);
}

/* ---------- NVIDIA usage ---------- */
function modelsTable(h) {
  if (!h) return errorState('Server health is unavailable.');
  const ocr = h.ocr || {};
  const hosted = 'integrate.api.nvidia.com (hosted)';
  const rows = [
    { role: 'Explanations and extraction', model: h.model, endpoint: hosted },
    { role: 'Guard lab agent', model: h.agent_model, endpoint: hosted },
    { role: 'Embeddings', model: h.embed_model, endpoint: hosted },
    { role: 'OCR', model: ocr.model, endpoint: ocr.mode === 'self-hosted' ? `${ocr.label || 'NIM'} (self-hosted)` : (/hosted/i.test(ocr.label || '') ? ocr.label : `${ocr.label || 'NVIDIA'} (hosted)`) },
  ].filter((r) => r.model);
  return table({ ariaLabel: 'Models', columns: [{ key: 'role', label: 'Role' }, { key: 'model', label: 'Model' }, { key: 'endpoint', label: 'Endpoint' }], rows });
}
function retriesText(rbs) {
  const e = Object.entries(rbs || {}).filter(([, n]) => n);
  if (!e.length) return '<span class="subtle">0</span>';
  return e.map(([k, n]) => `<span class="nowrap"><span class="subtle">${esc(k)}</span> ${esc(num(n))}</span>`).join(' · ');
}
export function usageHtml(u, h) {
  if (!u || !u.nvidia) return errorState('Usage is unavailable on this server.');
  const n = u.nvidia;
  if (n.error) return errorState(n.error);
  const limit = Number(n.rpm_limit) || 0;
  const used = Number(n.last_60s) || 0;
  const lim = n.limiter || {};
  const head = `<div class="pad">${kvList([
    ['Requests, last 60 s', meterRow(`${esc(num(used))}${limit ? ` / ${esc(num(limit))} per minute` : ''}`, limit ? used / limit : null, 'Requests in the last minute against the limit')],
    ['Headroom', n.headroom === null || n.headroom === undefined ? '<span class="subtle">No limit set</span>' : `<span class="tabular">${esc(num(n.headroom))} requests</span>`],
    ['Default model', esc(n.default_model || EMPTY)],
    ['Fallback model', n.fallback_model ? esc(n.fallback_model) : '<span class="subtle">None configured</span>'],
    ['Limiter waits', `<span class="tabular">${esc(num(lim.waits || 0))}</span>${lim.wait_ms_total ? ` <span class="subtle text-xs">${esc(ms(lim.wait_ms_total))} waited</span>` : ''}${lim.saturated ? ` <span class="subtle text-xs">· saturated ${esc(num(lim.saturated))}×</span>` : ''}`],
    ['Totals', `<span class="tabular">${esc(plural((n.totals || {}).requests || 0, 'request', 'requests'))} · ${esc(plural((n.totals || {}).attempts || 0, 'attempt', 'attempts'))} · ${esc(plural((n.totals || {}).failures || 0, 'failure', 'failures'))}</span>`],
  ])}</div>`;
  const models = Object.entries(n.models || {}).map(([model, m]) => ({ model, ...m }));
  const perModel = models.length
    ? table({
      ariaLabel: 'Usage by model',
      columns: [
        { key: 'model', label: 'Model', render: (r) => `<span class="break">${esc(r.model)}</span>` },
        { key: 'requests', label: 'Requests', align: 'right', render: (r) => `<span class="tabular">${esc(num(r.requests || 0))}</span>` },
        { key: 'successes', label: 'OK', align: 'right', render: (r) => `<span class="tabular">${esc(num(r.successes || 0))}</span>` },
        { key: 'failures', label: 'Failed', align: 'right', render: (r) => (r.failures ? badge(num(r.failures), 'warning') : '<span class="subtle">0</span>') },
        { key: 'retries', label: 'Retries', render: (r) => retriesText(r.retries_by_status) },
        { key: 'tokens', label: 'Tokens', align: 'right', render: (r) => `<span class="tabular" title="${esc(num(r.prompt_tokens || 0))} prompt · ${esc(num(r.completion_tokens || 0))} completion">${esc(num(r.total_tokens || 0))}</span>` },
        { key: 'lat', label: 'p50 / p95', align: 'right', render: (r) => { const l = r.latency_ms || {}; return `<span class="tabular nowrap">${esc(l.p50 == null ? EMPTY : ms(l.p50))} / ${esc(l.p95 == null ? EMPTY : ms(l.p95))}</span>`; } },
        { key: 'fb', label: 'Fallback served', align: 'right', render: (r) => (r.fallback_served ? badge(num(r.fallback_served), 'warning') : '<span class="subtle">0</span>') },
      ],
      rows: models,
    })
    : empty('No NVIDIA calls since the server started.');
  const since = n.since ? `<div class="settings-foot">Counts since server start ${esc(relTime(n.since))} · refreshes every 10 s</div>` : '';
  return `${head}<div class="sub-head bordered">By model</div>${perModel}<div class="sub-head bordered">Models</div>${modelsTable(h)}${since}`;
}
async function renderUsage(container, ctx) {
  let h = null;
  const load = async () => {
    let u = null; let err = null;
    try { u = await getJson(ctx, '/api/usage'); } catch (e) { err = e; }
    if (!h) { try { h = ctx && ctx.health ? await ctx.health() : await getJson(ctx, '/api/health'); } catch { h = null; } }
    if (!container.isConnected && container.dataset.loaded) return;
    container.dataset.loaded = '1';
    container.innerHTML = err ? errorState(err.status === 404 ? 'This server does not report usage yet.' : err.message) : usageHtml(u, h);
  };
  container.innerHTML = `<div class="pad muted">Loading usage…</div>`;
  await load();
  return poll(container, load);
}

/* ---------- GPU ---------- */
export function liveHtml(live) {
  if (!live || !live.available) {
    return `<div class="pad settings-note"><div>Live GPU metrics are available on the hosted deployment.</div>${live && live.reason ? `<div class="hint">${esc(live.reason)}</div>` : ''}</div>`;
  }
  const g = live.gpu || {};
  const o = live.ocr || {};
  const pairs = [];
  if (live.gpu) {
    pairs.push(['GPU', esc(g.name || EMPTY)]);
    const memR = g.memory_total_bytes ? g.memory_used_bytes / g.memory_total_bytes : null;
    pairs.push(['Memory', meterRow(`${esc(bytes(g.memory_used_bytes))} / ${esc(bytes(g.memory_total_bytes))}`, memR, 'GPU memory used')]);
    if (typeof g.utilization_ratio === 'number') pairs.push(['Utilization', meterRow(`${Math.round(g.utilization_ratio * 100)}%`, g.utilization_ratio, 'GPU utilization')]);
    if (typeof g.power_watts === 'number') {
      const pr = g.power_limit_watts ? g.power_watts / g.power_limit_watts : null;
      pairs.push(['Power', meterRow(`${Math.round(g.power_watts)} W${g.power_limit_watts ? ` / ${Math.round(g.power_limit_watts)} W` : ''}`, pr, 'GPU power draw')]);
    }
    if (typeof g.temperature_c === 'number') pairs.push(['Temperature', `<span class="tabular">${Math.round(g.temperature_c)} °C</span>`]);
    if (typeof g.sm_clock_mhz === 'number') pairs.push(['SM clock', `<span class="tabular">${esc(num(Math.round(g.sm_clock_mhz)))} MHz</span>`]);
  }
  if (o.requests_total !== null && o.requests_total !== undefined) pairs.push(['OCR requests', `<span class="tabular">${esc(num(o.requests_total))}</span>`]);
  const l = o.latency_ms || {};
  if (l.p50 !== null && l.p50 !== undefined) pairs.push(['OCR latency', `<span class="tabular">p50 ${esc(ms(l.p50))} · p95 ${esc(l.p95 == null ? EMPTY : ms(l.p95))} · p99 ${esc(l.p99 == null ? EMPTY : ms(l.p99))}</span>`]);
  pairs.push(['Source', `<span class="muted">${esc(live.source || 'NIM /v1/metrics')}</span>${live.fetched_at ? ` <span class="subtle text-xs">fetched ${esc(hhmm(live.fetched_at))}</span>` : ''}`]);
  return `<div class="pad">${kvList(pairs)}</div>`;
}
function ocrKv(h, g, gErr) {
  const ocr = (g && g.ocr) || (h && h.ocr) || null;
  const kv = [];
  if (ocr) {
    kv.push(['OCR mode', esc(humanize(ocr.mode || 'hosted'))]);
    kv.push(['OCR label', esc(ocr.label || EMPTY)]);
    let ready;
    if (ocr.ready === true) ready = badge('Ready', 'success');
    else if (ocr.ready === false) ready = badge('Not ready', 'danger');
    else ready = `<span class="muted">Not probed${ocr.mode === 'hosted' ? ' (hosted endpoint)' : ''}</span>`;
    kv.push(['Readiness', `${ready}${ocr.checked_at ? ` <span class="subtle text-xs">checked ${esc(relTime(ocr.checked_at))}</span>` : ''}`]);
    const fb = ocr.fallback || (h && h.ocr && h.ocr.fallback);
    kv.push(['Fallback', esc(fb ? humanize(fb) : 'None configured')]);
  }
  if (g && g.gpu) {
    const gp = g.gpu;
    kv.push(['Captured GPU', `${esc(gp.name || EMPTY)}${gp.driver ? ` <span class="subtle text-xs">driver ${esc(gp.driver)}</span>` : ''}`]);
    if (gp.memory_total_mib) kv.push(['Captured memory', `<span class="tabular">${esc(num(gp.memory_used_mib))} / ${esc(num(gp.memory_total_mib))} MiB</span>`]);
    kv.push(['Capture source', `${esc(gp.source || 'nvidia-smi capture')} ${gp.captured_at ? badge(`Captured at ${hhmm(gp.captured_at)}`, 'neutral', { title: dateTime(gp.captured_at) }) : ''}`]);
  }
  if (gErr) kv.push(['GPU status', `<span class="muted">${esc(gErr.status === 503 ? 'GPU module unavailable' : gErr.message)}</span>`]);
  return kv.length ? `<div class="pad bordered">${kvList(kv)}</div>` : '';
}
function recentTable(g) {
  const recent = g && Array.isArray(g.recent) ? g.recent.slice(0, 8) : []; // newest first
  return recent.length
    ? table({
      ariaLabel: 'Last OCR calls',
      columns: [
        { key: 'at', label: 'Time', render: (r) => `<span class="tabular">${esc(hhmm(r.at))}</span>` },
        { key: 'endpoint_kind', label: 'Endpoint', render: (r) => esc(humanize(r.endpoint_kind)) },
        { key: 'latency_ms', label: 'Latency', align: 'right', render: (r) => `<span class="tabular">${esc(ms(r.latency_ms))}</span>` },
        { key: 'fallback_used', label: 'Fallback', render: (r) => (r.fallback_used ? badge('Used', 'warning') : '<span class="subtle">No</span>') },
      ],
      rows: recent,
    })
    : empty('No OCR calls since the server started.');
}
async function renderGpu(container, ctx) {
  let h = null;
  const load = async () => {
    let g = null; let gErr = null;
    try { g = ctx && ctx.gpu ? await ctx.gpu(true) : await getJson(ctx, '/api/gpu/status'); } catch (e) { gErr = e; }
    if (!h) { try { h = ctx && ctx.health ? await ctx.health() : await getJson(ctx, '/api/health'); } catch { h = null; } }
    if (!container.isConnected && container.dataset.loaded) return;
    container.dataset.loaded = '1';
    container.innerHTML = `<div class="sub-head">Live GPU</div>${liveHtml(g && g.live)}${ocrKv(h, g, gErr)}<div class="sub-head bordered">Last OCR calls</div>${recentTable(g)}<div class="settings-foot">Refreshes every 10 s</div>`;
  };
  container.innerHTML = `<div class="pad muted">Loading GPU status…</div>`;
  await load();
  return poll(container, load);
}

/* ---------- Privacy ---------- */
function renderPrivacy(container, ctx) {
  container.innerHTML = `<div class="pad"><ul class="plain-list">
    <li>Analyses, cases and decisions are stored in a local SQLite file on the server. Uploaded files are processed in memory and not stored.</li>
    <li>The NVIDIA API key stays on the server. The browser never sees it; model calls go server to NVIDIA.</li>
    <li>Datasets: τ-bench retail trajectories (Sierra, MIT) via Microsoft AgentRx (MIT); SROIE receipt sample; synthetic procurement documents. Fonts: IBM Plex, Source Serif (OFL). Icons: Lucide (ISC).</li>
    <li>This browser stores only your appearance preferences and organization profile.</li>
  </ul></div><div class="settings-actions bordered"><span class="hint">Resets theme, density and animations.</span><button type="button" class="btn btn-secondary btn-sm" data-action="clear-prefs">Clear local preferences</button></div>`;
  const onClick = (e) => {
    if (!e.target.closest('[data-action="clear-prefs"]')) return;
    clearPrefs();
    toastOf(ctx)('Local preferences cleared.', 'success');
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

/* ---------- contract ---------- */
export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: 'settings', group: 'Preferences', render: renderGeneral },
  { id: 'organization', label: 'Organization', icon: 'database', group: 'Workspace', render: renderOrganization },
  { id: 'usage', label: 'NVIDIA usage', icon: 'history', group: 'System', render: renderUsage },
  { id: 'gpu', label: 'GPU and OCR', icon: 'cpu', group: 'System', render: renderGpu },
  { id: 'privacy', label: 'Data and privacy', icon: 'shield-alert', group: 'Workspace', render: renderPrivacy },
];

/* ---------- fallback page (#settings rendered as a view) ---------- */
// "System" groups the Appearance / GPU / NVIDIA usage tabs; organization and privacy follow.
const PAGE_TABS = [
  { id: 'general', label: 'Appearance' },
  { id: 'gpu', label: 'GPU' },
  { id: 'usage', label: 'NVIDIA usage' },
  { id: 'organization', label: 'Organization' },
  { id: 'privacy', label: 'Data and privacy' },
];
let tabsForPage = null;

export async function render(ctx) {
  tabsForPage = await loadTabs();
  const want = ctx.params && ctx.params[0];
  const active = PAGE_TABS.some((t) => t.id === want) ? want : 'general';
  return `
<div class="page-head"><div class="titles"><h1>Settings</h1><div class="meta">Appearance, workspace profile, NVIDIA usage and GPU.</div></div></div>
<section class="panel flush settings-page" aria-label="Settings">
  ${tabsMarkup(tabsForPage, { id: 'settings-tabs', items: PAGE_TABS, active, label: 'Settings sections' })}
  <div class="settings-pane" id="settings-tabs-panel" role="tabpanel" aria-labelledby="settings-tabs-tab-${esc(active)}" data-active="${esc(active)}"></div>
</section>`;
}

export function mount(root, ctx) {
  const pane = root.querySelector('#settings-tabs-panel');
  if (!pane) return undefined;
  let sectionCleanup = null;
  let seq = 0;
  const show = async (id) => {
    const sec = SETTINGS_SECTIONS.find((s) => s.id === id) || SETTINGS_SECTIONS[0];
    const mine = ++seq;
    if (typeof sectionCleanup === 'function') { try { sectionCleanup(); } catch { /* ignore */ } }
    sectionCleanup = null;
    pane.dataset.active = sec.id;
    const host = document.createElement('div');
    pane.replaceChildren(host);
    const c = await sec.render(host, ctx);
    if (mine !== seq) { if (typeof c === 'function') c(); return; }
    sectionCleanup = c;
  };
  const unbind = bindTabsSafe(tabsForPage, root.querySelector('.settings-page'), (id) => show(id));
  show(pane.dataset.active);
  // Open the modal when stream A3's component is present (the router may still route #settings here).
  import('../components/settings-modal.js').then((m) => {
    if (m && typeof m.openSettings === 'function' && root.contains(pane)) m.openSettings(ctx.params && ctx.params[0]);
  }).catch(() => { /* modal not shipped: the tabbed page above is the settings UI */ });
  return () => {
    seq++;
    unbind();
    if (typeof sectionCleanup === 'function') { try { sectionCleanup(); } catch { /* ignore */ } }
  };
}
