// VARELQ shell: renders the sidebar and topbar once, routes hash changes, and re-renders only <main>.
import { api, onBusy } from './api.js';
import { icon } from './icons.js';
import { esc, shortModel } from './format.js';
import { prefs, setPref, onPrefs, isDark } from './state.js';
import { empty } from './components/empty.js';

/*
 * Route table. params are the hash segments after the route base:
 *   #cases/ab12              -> case.js,        params ['ab12']
 *   #reliability/trace/t-3   -> reliability.js, params ['trace', 't-3']
 * ctx = { params, query, api, navigate(hash), toast(msg, tone), prefs, setCrumb(text), health(), gpu(), refresh() }
 */
const ROUTES = [
  { base: 'overview', module: 'overview', group: 'reconciliation', nav: 'overview' },
  { base: 'documents', module: 'documents', group: 'reconciliation', nav: 'documents' },
  { base: 'cases', module: 'case', group: 'reconciliation', nav: 'overview', minParams: 1 },
  { base: 'reliability', module: 'reliability', group: 'reliability', nav: 'reliability' },
  { base: 'lab', module: 'lab', group: 'reliability', nav: 'lab' },
  { base: 'settings', module: 'settings', group: 'settings', nav: 'settings' },
];
const LEGACY = {
  investigations: 'overview', 'documents-old': 'overview', suppliers: 'overview', inventory: 'overview',
  agents: 'overview', activity: 'overview', organization: 'settings', cases: 'overview',
};
const GROUP_LABEL = { reliability: 'Agent reliability', reconciliation: 'Reconciliation', settings: null };
const NAV = [
  { label: 'Workspace', items: [
    { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  ] },
  { label: 'Records', items: [
    { id: 'documents', label: 'Documents', icon: 'file-text' },
  ] },
  { label: 'Intelligence', items: [
    { id: 'reliability', label: 'Agent reliability', icon: 'shield-alert' },
    { id: 'lab', label: 'Guard lab', icon: 'flask-conical' },
  ] },
  { label: null, items: [{ id: 'settings', label: 'Settings', icon: 'settings' }] },
];

const app = document.getElementById('app');
let mainEl; let crumbsEl; let toastsEl; let topbarEl; let chipsEl; let themeBtn; let liveEl;
let cleanup = null;
let navToken = 0;
const moduleCache = new Map();

/* ---------- shared cached status (health and GPU/OCR) ---------- */
const cache = { health: null, gpu: null, at: 0 };
function health(force = false) {
  if (!cache.health || force) cache.health = api.get('/api/health').catch((e) => { cache.health = null; throw e; });
  return cache.health;
}
function gpu(force = false) {
  if (!cache.gpu || force) cache.gpu = api.get('/api/gpu/status').catch((e) => { cache.gpu = null; throw e; });
  return cache.gpu;
}

/* ---------- shell ---------- */
function navHtml() {
  return NAV.map((g) => `<div class="nav-group${g.label ? '' : ' nav-group-plain'}">${g.label ? `<div class="nav-label">${esc(g.label)}</div>` : ''}${g.items.map((it) => `<a class="nav-item" href="#${it.id}" data-nav="${it.id}">${icon(it.icon, 16)}<span>${esc(it.label)}</span></a>`).join('')}</div>`).join('');
}

function renderShell() {
  app.innerHTML = `
<div class="shell">
  <aside class="sidebar" id="sidebar" aria-label="Primary">
    <a class="brand" href="#overview" aria-label="VARELQ home"><span class="brand-mark" aria-hidden="true">v</span><span class="brand-name">varelq<span class="brand-dot">.</span></span></a>
    <a class="org" href="#settings" title="Workspace settings">
      <span class="org-avatar" aria-hidden="true">LW</span>
      <span class="org-text"><strong>Local workspace</strong><small>Keys stay on the server</small></span>
      ${icon('chevron-down', 14, 'org-chev')}
    </a>
    <nav class="nav" aria-label="Sections">${navHtml()}</nav>
    <div class="operator">
      <span class="operator-avatar" aria-hidden="true">L</span>
      <span class="org-text"><strong>Local operator</strong><small>This machine</small></span>
      <span class="dot dot-ok" id="operator-dot" title="Server reachable"></span>
    </div>
  </aside>
  <div class="scrim" data-action="close-nav"></div>
  <div class="frame">
    <header class="topbar" id="topbar">
      <button type="button" class="btn btn-icon menu-btn" data-action="open-nav" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${icon('menu', 20)}</button>
      <nav class="crumbs" aria-label="Breadcrumb" id="crumbs"></nav>
      <div class="topbar-right">
        <div class="status-line" id="chips"></div>
        <button type="button" class="btn btn-icon" data-action="theme" id="theme-btn"></button>
      </div>
      <div class="busy-bar" aria-hidden="true"></div>
    </header>
    <main id="main" tabindex="-1"></main>
  </div>
</div>
<div class="toasts" id="toasts" aria-live="polite"></div>
<div class="sr-only" aria-live="polite" id="live"></div>`;
  mainEl = document.getElementById('main');
  crumbsEl = document.getElementById('crumbs');
  toastsEl = document.getElementById('toasts');
  topbarEl = document.getElementById('topbar');
  chipsEl = document.getElementById('chips');
  themeBtn = document.getElementById('theme-btn');
  liveEl = document.getElementById('live');
  updateThemeButton();
  onBusy((n) => topbarEl.classList.toggle('busy', n > 0));
}

function setNavOpen(open) {
  document.body.classList.toggle('nav-open', open);
  const btn = document.querySelector('.menu-btn');
  if (btn) btn.setAttribute('aria-expanded', String(open));
  if (open) { const first = document.querySelector('.sidebar .nav-item'); if (first) first.focus(); }
}

const THEME_NEXT = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };
function updateThemeButton() {
  if (!themeBtn) return;
  const ic = prefs.theme === 'system' ? 'monitor' : prefs.theme === 'dark' ? 'moon' : 'sun';
  themeBtn.innerHTML = icon(ic, 18);
  const label = `${THEME_LABEL[prefs.theme]}. Switch to ${THEME_NEXT[prefs.theme]}.`;
  themeBtn.setAttribute('aria-label', label);
  themeBtn.title = label;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.documentElement.style.colorScheme = isDark() ? 'dark' : 'light';
}

/* ---------- provenance chips ---------- */
const DOT = { neutral: 'dot-ok', success: 'dot-ok', warning: 'dot-warn', danger: 'dot-bad' };
function chip(text, tone, ic, title) {
  return `<a class="status-item" href="#settings" title="${esc(title)}"><span class="dot ${DOT[tone] || ''}"></span><span>${esc(text)}</span></a>`;
}
async function refreshChips() {
  const parts = [];
  let h = null; let g = null;
  try { h = await health(true); } catch { /* server down */ }
  try { g = await gpu(true); } catch { /* gpu module unavailable */ }
  if (h) {
    const configured = h.nim_configured !== false;
    parts.push(chip(`NVIDIA · ${configured ? shortModel(h.model) : 'no key'}`, configured ? 'neutral' : 'warning', 'cpu',
      configured ? `Model: ${h.model || ''}` : 'NVIDIA_API_KEY is not configured on the server'));
  } else {
    parts.push(chip('Server offline', 'danger', 'alert-triangle', 'The VARELQ server did not answer'));
  }
  const ocr = ocrChip(h, g);
  if (ocr) parts.push(chip(ocr.text, ocr.tone, 'file-text', ocr.title));
  chipsEl.innerHTML = parts.join('');
  const od = document.getElementById('operator-dot');
  if (od) { od.className = `dot ${h ? 'dot-ok' : 'dot-bad'}`; od.title = h ? 'Server reachable' : 'Server offline'; }
}
function ocrChip(h, g) {
  const recent = g && Array.isArray(g.recent) && g.recent.length ? g.recent[0] : null; // newest first (ocr.recent_latencies)
  const o = (g && g.ocr) || (h && h.ocr) || null;
  if (!o) return null;
  if (recent && recent.fallback_used) return { text: 'OCR · fallback', tone: 'warning', title: 'Last OCR call fell back to the hosted endpoint' };
  if (o.mode === 'self-hosted') {
    if (g && g.ocr && g.ocr.ready === false) return { text: 'OCR · fallback', tone: 'warning', title: `${o.label || 'Self-hosted OCR'} is not ready; hosted fallback is used` };
    const label = String(o.label || '');
    const short = /\bL4\b/.test(label) ? 'L4' : (g && g.gpu && /L4/.test(g.gpu.name || '') ? 'L4' : 'self-hosted');
    return { text: `OCR · ${short}`, tone: 'neutral', title: `${label || 'Self-hosted OCR'} · ${o.model || ''}` };
  }
  return { text: 'OCR · hosted', tone: 'neutral', title: `Hosted OCR · ${o.model || ''}` };
}

/* ---------- toast ---------- */
const TOAST_ICON = { danger: 'alert-triangle', success: 'check-circle-2', info: 'info', warning: 'alert-triangle' };
export function toast(message, tone = 'info') {
  if (!toastsEl) return;
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  el.innerHTML = `${icon(TOAST_ICON[tone] || 'info', 16)}<span>${esc(message)}</span>`;
  toastsEl.appendChild(el);
  setTimeout(() => el.remove(), tone === 'danger' ? 8000 : 4500);
}

/* ---------- router ---------- */
function parseHash() {
  const raw = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
  const [pathPart, queryPart = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  return { segs, query: new URLSearchParams(queryPart) };
}

export function navigate(hash) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (location.hash === target) route(); else location.hash = target;
}

function setCrumbs(route, title, detail) {
  const groupLabel = GROUP_LABEL[route.group];
  const parts = [];
  if (groupLabel) parts.push(`<span class="crumb-parent">${esc(groupLabel)}</span><span class="crumb-sep" aria-hidden="true">/</span>`);
  if (detail) {
    parts.push(`<a href="#${route.nav}" class="crumb-parent">${esc(title)}</a><span class="crumb-sep" aria-hidden="true">/</span><span aria-current="page" class="truncate">${esc(detail)}</span>`);
  } else {
    parts.push(`<span aria-current="page" class="truncate">${esc(title)}</span>`);
  }
  crumbsEl.innerHTML = parts.join('');
  document.title = `${detail || title} · VARELQ`;
}

function setActiveNav(navId) {
  document.querySelectorAll('.nav-item').forEach((a) => {
    if (a.dataset.nav === navId) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function loadModule(name) {
  if (moduleCache.has(name)) return moduleCache.get(name);
  const mod = await import(`./views/${name}.js`);
  moduleCache.set(name, mod);
  return mod;
}

async function route() {
  const { segs, query } = parseHash();
  const base = segs[0] || 'overview';
  const r = ROUTES.find((x) => x.base === base && segs.length - 1 >= (x.minParams || 0));
  if (!r) {
    location.replace(`#${LEGACY[base] || 'overview'}`);
    return;
  }
  const token = ++navToken;
  setNavOpen(false);
  setActiveNav(r.nav);
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }

  let mod;
  try {
    mod = await loadModule(r.module);
  } catch (err) {
    if (token !== navToken) return;
    console.warn(`View ${r.module} failed to load`, err);
    setCrumbs(r, 'Unavailable');
    mainEl.innerHTML = `<div class="panel">${empty('View not loaded.', '<a class="btn btn-ghost btn-sm" href="#overview">Open overview</a>', { icon: 'alert-triangle' })}</div>`;
    return;
  }
  const title = (mod.meta && mod.meta.title) || r.base;
  let detail = null;
  setCrumbs(r, title);
  const ctx = {
    params: segs.slice(1), query, api, navigate, toast, prefs, health, gpu,
    setCrumb: (text) => { if (token === navToken) { detail = text; setCrumbs(r, title, text); } },
    refresh: () => { if (token === navToken) route(); },
    announce: (text) => { liveEl.textContent = ''; setTimeout(() => { liveEl.textContent = text; }, 30); },
    isCurrent: () => token === navToken,
  };
  mainEl.setAttribute('aria-busy', 'true');
  let html;
  try {
    html = await mod.render(ctx);
  } catch (err) {
    if (token !== navToken) return;
    console.warn(`View ${r.module} failed to render`, err);
    html = `<div class="panel">${empty(err && err.message ? err.message : 'This view failed to render.', '<button type="button" class="btn btn-ghost btn-sm" data-action="reload-view">Retry</button>', { icon: 'alert-triangle' })}</div>`;
  }
  if (token !== navToken) return;
  mainEl.removeAttribute('aria-busy');
  mainEl.innerHTML = html || '';
  mainEl.classList.remove('view-enter');
  void mainEl.offsetWidth;
  mainEl.classList.add('view-enter');
  window.scrollTo(0, 0);
  if (detail) setCrumbs(r, title, detail);
  if (typeof mod.mount === 'function') {
    try {
      const c = mod.mount(mainEl, ctx);
      if (typeof c === 'function') cleanup = c;
    } catch (err) {
      console.warn(`View ${r.module} mount failed`, err);
    }
  }
  if (document.activeElement === document.body || !mainEl.contains(document.activeElement)) mainEl.focus({ preventScroll: true });
}

/* ---------- global events ---------- */
function onClick(e) {
  const actionEl = e.target.closest('[data-action]');
  const action = actionEl && actionEl.dataset.action;
  if (action === 'open-nav') { setNavOpen(true); return; }
  if (action === 'close-nav') { setNavOpen(false); return; }
  if (action === 'theme') { setPref('theme', THEME_NEXT[prefs.theme]); return; }
  if (action === 'reload-view') { route(); return; }
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a, button, input, select, textarea, label')) {
    const href = row.dataset.href;
    if (e.ctrlKey || e.metaKey) window.open(href, '_blank', 'noopener'); else navigate(href);
  }
}
function onKey(e) {
  if (e.key === 'Escape' && document.body.classList.contains('nav-open')) { setNavOpen(false); document.querySelector('.menu-btn')?.focus(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-href]')) {
    e.preventDefault();
    navigate(e.target.dataset.href);
  }
}

renderShell();
onPrefs(updateThemeButton);
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', updateThemeButton);
document.addEventListener('click', onClick);
document.addEventListener('keydown', onKey);
window.addEventListener('hashchange', route);
route();
refreshChips();
setInterval(refreshChips, 60000);
