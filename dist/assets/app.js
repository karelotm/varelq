// VARELQ shell: renders the sidebar and topbar once, routes hash changes, and re-renders only <main>.
import { api, onBusy } from './api.js';
import { icon } from './icons.js';
import { esc, shortModel } from './format.js';
import { prefs, setPref, onPrefs, isDark } from './state.js';
import { empty } from './components/empty.js';

/* i18n (stream A3). Optional: English fallbacks are used when the module is missing. */
let i18n = null;
try { i18n = await import('./i18n.js'); } catch { i18n = null; }
const t = (key, fallback) => {
  try { return (i18n && typeof i18n.t === 'function' && i18n.t(key, fallback)) || fallback; } catch { return fallback; }
};

/*
 * Route table. params are the hash segments after the route base:
 *   #cases/ab12              -> case.js,        params ['ab12']
 *   #reliability/trace/t-3   -> reliability.js, params ['trace', 't-3']
 * ctx = { params, query, api, navigate(hash), toast(msg, tone), prefs, setCrumb(text), health(), gpu(), refresh(), t, openSettings, openPalette }
 * #settings[/<section>] is not a view: it opens the settings modal over the current page.
 */
const ROUTES = [
  { base: 'overview', module: 'overview', group: 'workspace', nav: 'overview' },
  { base: 'investigations', module: 'investigations', group: 'workspace', nav: 'investigations' },
  { base: 'chat', module: 'chat', group: 'workspace', nav: 'chat' },
  { base: 'documents', module: 'documents', group: 'records', nav: 'documents' },
  { base: 'cases', module: 'case', group: 'records', nav: 'documents', minParams: 1 },
  { base: 'suppliers', module: 'suppliers', group: 'records', nav: 'suppliers' },
  { base: 'receiving', module: 'receiving', group: 'records', nav: 'receiving' },
  { base: 'reliability', module: 'reliability', group: 'intelligence', nav: 'reliability' },
  { base: 'lab', module: 'lab', group: 'intelligence', nav: 'lab' },
  { base: 'history', module: 'history', group: 'intelligence', nav: 'history' },
  { base: 'organization', module: 'organization', group: 'workspace', nav: null },
];
const LEGACY = {
  'documents-old': 'documents', inventory: 'receiving', agents: 'reliability', activity: 'history', cases: 'documents', ask: 'chat',
};
const GROUPS = {
  workspace: { key: 'group.workspace', label: 'Workspace' },
  records: { key: 'group.records', label: 'Records' },
  intelligence: { key: 'group.intelligence', label: 'Intelligence' },
};
const NAV = [
  { group: 'workspace', items: [
    { id: 'overview', key: 'nav.overview', label: 'Overview', icon: 'layout-dashboard' },
    { id: 'investigations', key: 'nav.investigations', label: 'Investigations', icon: 'folder-search' },
    { id: 'chat', key: 'nav.chat', label: 'Ask VARELQ', icon: 'message-square' },
  ] },
  { group: 'records', items: [
    { id: 'documents', key: 'nav.documents', label: 'Documents', icon: 'file-text' },
    { id: 'suppliers', key: 'nav.suppliers', label: 'Suppliers', icon: 'truck' },
    { id: 'receiving', key: 'nav.receiving', label: 'Receiving', icon: 'package' },
  ] },
  { group: 'intelligence', items: [
    { id: 'reliability', key: 'nav.reliability', label: 'Agent reliability', icon: 'shield-alert' },
    { id: 'lab', key: 'nav.lab', label: 'Guard lab', icon: 'flask-conical' },
    { id: 'history', key: 'nav.history', label: 'Execution history', icon: 'history' },
  ] },
];
const IS_MAC = /Mac|iPhone|iPad/.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

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
  return NAV.map((g) => {
    const gl = t(GROUPS[g.group].key, GROUPS[g.group].label);
    return `<div class="nav-group" role="group" aria-label="${esc(gl)}"><div class="nav-label" aria-hidden="true">${esc(gl)}</div>${g.items.map((it) => {
      const label = t(it.key, it.label);
      return `<a class="nav-item" href="#${it.id}" data-nav="${it.id}" data-label="${esc(label)}">${icon(it.icon, 16)}<span class="nav-text">${esc(label)}</span></a>`;
    }).join('')}</div>`;
  }).join('');
}

function orgFallback() {
  return `<a class="org" href="#organization" title="${esc(t('nav.organization', 'Organization'))}">
      <span class="org-avatar" aria-hidden="true">LW</span>
      <span class="org-text"><strong>Local workspace</strong><small>Keys stay on the server</small></span>
      ${icon('chevron-down', 14, 'org-chev')}
    </a>`;
}
function userFallback() {
  return `<div class="operator">
      <span class="operator-avatar" aria-hidden="true">L</span>
      <span class="org-text"><strong>Local operator</strong><small>This machine</small></span>
      <span class="dot dot-ok" id="operator-dot" title="Server reachable"></span>
    </div>`;
}

function searchLabel() { return t('palette.search', 'Search'); }

function renderShell() {
  app.innerHTML = `
<div class="shell">
  <aside class="sidebar" id="sidebar" aria-label="Primary">
    <div class="side-head">
      <a class="brand" href="#overview" aria-label="VARELQ home"><span class="brand-mark" aria-hidden="true">v</span><span class="brand-name">varelq<span class="brand-dot">.</span></span></a>
      <button type="button" class="btn btn-icon side-collapse" data-action="toggle-sidebar" aria-controls="sidebar"></button>
    </div>
    <div id="org-switch" class="slot-org">${orgFallback()}</div>
    <button type="button" class="side-search" data-action="palette" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K">
      ${icon('search', 16)}<span class="side-search-label">${esc(searchLabel())}</span><kbd class="side-kbd">${MOD_KEY} K</kbd>
    </button>
    <nav class="nav" aria-label="Sections" id="nav">${navHtml()}</nav>
    <div id="user-menu" class="slot-user">${userFallback()}</div>
  </aside>
  <div class="scrim" data-action="close-nav"></div>
  <div class="frame">
    <header class="topbar" id="topbar">
      <button type="button" class="btn btn-icon menu-btn" data-action="open-nav" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${icon('menu', 20)}</button>
      <nav class="crumbs" aria-label="Breadcrumb" id="crumbs"></nav>
      <div class="topbar-right">
        <div class="status-line" id="chips"></div>
        <div id="bell" class="slot-bell"></div>
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
  updateSidebarState();
  onBusy((n) => topbarEl.classList.toggle('busy', n > 0));
}

/** Context handed to the shell components (org switcher, user menu, bell). */
function shellCtx() {
  return { api, navigate, toast, prefs, setPref, health, gpu, t, openSettings: openSettingsRoute, openPalette: showPalette, refreshChips };
}

async function mountSlot(id, path, fn, fallback) {
  const el = document.getElementById(id);
  if (!el) return;
  let mod;
  try { mod = await import(path); } catch { return; } // module not there yet: keep the fallback markup
  if (typeof mod[fn] !== 'function') return;
  try {
    el.innerHTML = '';
    await mod[fn](el, shellCtx());
  } catch (err) {
    console.warn(`${fn} failed`, err);
    el.innerHTML = fallback ? fallback() : '';
  }
}
function mountShellParts() {
  mountSlot('org-switch', './components/orgswitch.js', 'mountOrgSwitch', orgFallback);
  mountSlot('user-menu', './components/usermenu.js', 'mountUserMenu', userFallback);
  mountSlot('bell', './components/notifications.js', 'mountBell', null);
}

/* ---------- collapsible sidebar (desktop icon rail) ---------- */
const railQuery = window.matchMedia ? window.matchMedia('(min-width: 961px)') : null;
function isCollapsed() { return prefs.sidebar === 'collapsed' && (!railQuery || railQuery.matches); }
function updateSidebarState() {
  const collapsed = isCollapsed();
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.toggle('is-collapsed', collapsed);
  const btn = document.querySelector('.side-collapse');
  if (btn) {
    const label = collapsed ? t('nav.expand', 'Expand sidebar') : t('nav.collapse', 'Collapse sidebar');
    btn.innerHTML = icon(collapsed ? 'panel-left-open' : 'panel-left-close', 18);
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.setAttribute('aria-expanded', String(!collapsed));
  }
  document.querySelectorAll('.nav-item').forEach((a) => {
    if (collapsed) { a.title = a.dataset.label; a.setAttribute('aria-label', a.dataset.label); } else { a.removeAttribute('title'); a.removeAttribute('aria-label'); }
  });
  const search = document.querySelector('.side-search');
  if (search) {
    const label = `${searchLabel()} (${MOD_KEY}+K)`;
    search.setAttribute('aria-label', label);
    if (collapsed) search.title = label; else search.removeAttribute('title');
  }
}
function toggleSidebar() {
  setPref('sidebar', prefs.sidebar === 'collapsed' ? 'expanded' : 'collapsed');
  updateSidebarState();
  window.dispatchEvent(new CustomEvent('varelq:sidebar', { detail: { collapsed: isCollapsed() } }));
}

/* ---------- command palette ---------- */
function paletteItems() {
  const pages = [];
  for (const g of NAV) {
    for (const it of g.items) pages.push({ label: t(it.key, it.label), href: `#${it.id}`, icon: it.icon, sub: t(GROUPS[g.group].key, GROUPS[g.group].label), keywords: `${it.label} ${it.id}` });
  }
  pages.push({ label: t('nav.organization', 'Organization'), href: '#organization', icon: 'building-2', keywords: 'organization org workspace members team' });
  pages.push({ label: t('palette.tour', 'Take the tour'), run: startTourLazy, icon: 'help-circle', keywords: 'tour guide onboarding help introduction walkthrough visite' });
  pages.push({ label: t('nav.settings', 'Settings'), href: '#settings', icon: 'settings', sub: `${MOD_KEY}+,`, keywords: 'settings preferences theme language usage gpu privacy' });
  return pages;
}
async function showPalette(query) {
  let mod;
  try { mod = await import('./components/palette.js'); } catch (err) { console.warn('Palette failed to load', err); toast(t('palette.unavailable', 'Search is unavailable.'), 'danger'); return; }
  setNavOpen(false);
  mod.openPalette({ api, navigate, pages: paletteItems(), t, query: typeof query === 'string' ? query : '' });
}

/* ---------- guided tour (components/tour.js) ---------- */
function startTourLazy() {
  import('./components/tour.js').then((m) => m.startTour()).catch((err) => console.warn('Tour failed to load', err));
}

/* ---------- language ---------- */
function onLang() {
  const nav = document.getElementById('nav');
  if (nav) nav.innerHTML = navHtml();
  const sl = document.querySelector('.side-search-label');
  if (sl) sl.textContent = searchLabel();
  updateSidebarState();
  if (renderedHash !== null) route();
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
function chip(text, tone, ic, title, section = 'usage') {
  return `<a class="status-item" href="#settings/${section}" title="${esc(title)}"><span class="dot ${DOT[tone] || ''}"></span><span>${esc(text)}</span></a>`;
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
  if (ocr) parts.push(chip(ocr.text, ocr.tone, 'file-text', ocr.title, 'gpu'));
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
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }
function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const qi = raw.indexOf('?');
  const pathPart = qi < 0 ? raw : raw.slice(0, qi);
  const queryPart = qi < 0 ? '' : raw.slice(qi + 1);
  const segs = pathPart.split('/').filter(Boolean).map(safeDecode);
  return { segs, query: new URLSearchParams(queryPart) };
}

export function navigate(hash) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (location.hash === target) route(); else location.hash = target;
}

function setCrumbs(route, title, detail) {
  const g = GROUPS[route.group];
  const groupLabel = g ? t(g.key, g.label) : null;
  const parts = [];
  if (groupLabel) parts.push(`<span class="crumb-parent">${esc(groupLabel)}</span><span class="crumb-sep" aria-hidden="true">/</span>`);
  if (detail) {
    parts.push(`<a href="#${route.nav || route.base}" class="crumb-parent">${esc(title)}</a><span class="crumb-sep" aria-hidden="true">/</span><span aria-current="page" class="truncate">${esc(detail)}</span>`);
  } else {
    parts.push(`<span aria-current="page" class="truncate">${esc(title)}</span>`);
  }
  crumbsEl.innerHTML = parts.join('');
  document.title = `${detail || title} · VARELQ`;
}

function setActiveNav(navId) {
  document.querySelectorAll('.nav-item').forEach((a) => {
    if (navId && a.dataset.nav === navId) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function loadModule(name) {
  if (moduleCache.has(name)) return moduleCache.get(name);
  const mod = await import(`./views/${name}.js`);
  moduleCache.set(name, mod);
  return mod;
}

/* ---------- settings modal (#settings, #settings/<section>) ---------- */
let renderedHash = null; // hash of the view currently rendered in <main>
let settingsOpen = false;
function openSettingsRoute(section) {
  navigate(section ? `#settings/${encodeURIComponent(section)}` : '#settings');
}
function closeSettingsRoute() {
  settingsOpen = false;
  if (/^#\/?settings\b/.test(location.hash)) {
    const back = renderedHash || '#overview';
    history.replaceState(null, '', back);
    if (!renderedHash) route();
  }
}
async function showSettings(section) {
  if (!renderedHash) {
    // Deep link straight to #settings: render the overview underneath the modal.
    await renderView(ROUTES[0], [], new URLSearchParams(), '#overview');
  }
  let mod = null;
  try { mod = await import('./components/settings-modal.js'); } catch (err) { console.warn('Settings modal failed to load', err); }
  if (mod && typeof mod.openSettings === 'function') {
    settingsOpen = true;
    if (typeof mod.setShellContext === 'function') { try { mod.setShellContext(shellCtx()); } catch { /* ignore */ } }
    // The modal is lazy-loaded after the hash already changed, so it cannot see the page underneath:
    // put that page back in the URL first; openSettings then pushes #settings[/section] itself and restores it on close.
    const already = typeof mod.isSettingsOpen === 'function' && mod.isSettingsOpen();
    if (!already && renderedHash) { try { history.replaceState(null, '', renderedHash); } catch { /* ignore */ } }
    try { await mod.openSettings(section || undefined); } catch (err) { console.warn('openSettings failed', err); }
    return;
  }
  // Fallback: the settings view as a full page, if it still renders one.
  try {
    const view = await loadModule('settings');
    if (typeof view.render === 'function') { await renderView({ base: 'settings', module: 'settings', group: null, nav: null }, [], new URLSearchParams(), location.hash); return; }
  } catch { /* fall through */ }
  toast(t('settings.unavailable', 'Settings are unavailable.'), 'danger');
  closeSettingsRoute();
}

async function route() {
  const { segs, query } = parseHash();
  const base = segs[0] || 'overview';
  if (base === 'settings') { setNavOpen(false); showSettings(segs[1]); return; }
  const r = ROUTES.find((x) => x.base === base && segs.length - 1 >= (x.minParams || 0));
  if (!r) {
    location.replace(`#${LEGACY[base] || 'overview'}`);
    return;
  }
  const hash = location.hash || '#overview';
  if (settingsOpen) {
    settingsOpen = false;
    // Closing the modal returns to the page underneath: no re-render needed.
    if (hash === renderedHash) return;
  }
  await renderView(r, segs.slice(1), query, hash);
}

async function renderView(r, params, query, hash) {
  const token = ++navToken;
  setNavOpen(false);
  setActiveNav(r.nav);
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  renderedHash = hash;

  let mod;
  try {
    mod = await loadModule(r.module);
  } catch (err) {
    if (token !== navToken) return;
    console.warn(`View ${r.module} failed to load`, err);
    setCrumbs(r, t('view.unavailable', 'Unavailable'));
    mainEl.innerHTML = `<div class="panel">${empty(t('view.notLoaded', 'View not loaded.'), `<a class="btn btn-ghost btn-sm" href="#overview">${esc(t('view.openOverview', 'Open overview'))}</a>`, { icon: 'alert-triangle' })}</div>`;
    enter();
    return;
  }
  const title = (mod.meta && mod.meta.title) || r.base;
  let detail = null;
  setCrumbs(r, title);
  const ctx = {
    params, query, api, navigate, toast, prefs, health, gpu, t,
    openSettings: openSettingsRoute, openPalette: showPalette,
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
  enter();
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
  if (!settingsOpen && (document.activeElement === document.body || !mainEl.contains(document.activeElement))) {
    const sb = document.getElementById('sidebar');
    if (!(sb && sb.contains(document.activeElement))) mainEl.focus({ preventScroll: true });
  }
}
function enter() {
  mainEl.classList.remove('view-enter');
  void mainEl.offsetWidth;
  mainEl.classList.add('view-enter');
}

/* ---------- global events ---------- */
function onClick(e) {
  const actionEl = e.target.closest('[data-action]');
  const action = actionEl && actionEl.dataset.action;
  if (action === 'open-nav') { setNavOpen(true); return; }
  if (action === 'close-nav') { setNavOpen(false); return; }
  if (action === 'theme') { setPref('theme', THEME_NEXT[prefs.theme]); return; }
  if (action === 'reload-view') { route(); return; }
  if (action === 'toggle-sidebar') { toggleSidebar(); return; }
  if (action === 'palette') { showPalette(); return; }
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a, button, input, select, textarea, label')) {
    const href = row.dataset.href;
    if (e.ctrlKey || e.metaKey) window.open(href, '_blank', 'noopener'); else navigate(href);
  }
}
function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); showPalette(); return; }
  if (mod && !e.altKey && e.key === ',') { e.preventDefault(); openSettingsRoute(); return; }
  if (e.key === 'Escape' && document.body.classList.contains('nav-open')) { setNavOpen(false); document.querySelector('.menu-btn')?.focus(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-href]')) {
    e.preventDefault();
    navigate(e.target.dataset.href);
  }
}

renderShell();
mountShellParts();
onPrefs(updateThemeButton);
if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', updateThemeButton);
if (railQuery && railQuery.addEventListener) railQuery.addEventListener('change', updateSidebarState);
document.addEventListener('click', onClick);
document.addEventListener('keydown', onKey);
window.addEventListener('hashchange', route);
window.addEventListener('varelq:lang', onLang);
window.addEventListener('varelq:settings-close', closeSettingsRoute);
route();
refreshChips();
setInterval(refreshChips, 60000);
// First-visit tour (auto-starts once; also registers the window 'varelq:tour' event).
import('./components/tour.js').then((m) => m.autoStartTour()).catch(() => { /* tour is optional */ });
