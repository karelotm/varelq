// Settings modal (Claude-app style): centered ~960x640 dialog, full-screen sheet on phones.
// Left: "Search settings" + grouped section list from views/settings.js SETTINGS_SECTIONS. Right: the selected section.
// Router contract: #settings and #settings/<section> call openSettings(section) and keep the page behind.
// The modal keeps the hash in sync with history.replaceState (no hashchange, so the router does not re-render)
// and restores the page hash on close. Esc, the X and the backdrop close it; focus is trapped and restored.
import { esc } from '../format.js';
import { api } from '../api.js';
import { prefs } from '../state.js';
import { t } from '../i18n.js';
import { icon, menuKeys, quietToast } from './usermenu.js';

const isSettingsHash = (h) => /^#\/?settings(\/|$|\?)/.test(h || '');
let lastPage = isSettingsHash(location.hash) ? null : (location.hash || null);
let shellCtx = null;
let modal = null; // { root, select(id), close(opts) }

window.addEventListener('hashchange', (e) => {
  const now = location.hash;
  if (isSettingsHash(now)) {
    try { const old = new URL(e.oldURL).hash; if (old && !isSettingsHash(old)) lastPage = old; } catch { /* ignore */ }
    return;
  }
  lastPage = now || null;
  if (modal) modal.close({ restoreHash: false });
});

/** setShellContext(ctx): the shell's ctx (api, toast, navigate, health, gpu...) passed to section renderers. */
export function setShellContext(ctx) { if (ctx && typeof ctx === 'object') shellCtx = ctx; }

export function isSettingsOpen() { return !!modal; }

async function loadSections() {
  try {
    const mod = await import('../views/settings.js');
    if (Array.isArray(mod.SETTINGS_SECTIONS) && mod.SETTINGS_SECTIONS.length) return mod.SETTINGS_SECTIONS;
    if (typeof mod.render === 'function') {
      // Older settings view: show it as one section.
      return [{ id: 'general', label: 'General', icon: 'settings', group: 'Preferences', render: async (el, ctx) => {
        el.innerHTML = await mod.render(ctx);
        return typeof mod.mount === 'function' ? mod.mount(el, ctx) : undefined;
      } }];
    }
  } catch (err) { console.warn('Settings sections failed to load', err); }
  return [];
}

function sectionLabel(s) { return t(`settings.${s.id}`, s.label || s.id); }
function groupLabel(g) { return t(`settings.group.${String(g || '').toLowerCase()}`, g || ''); }

function navHtml(sections, active, query) {
  const q = String(query || '').trim().toLowerCase();
  const match = (s) => !q || [sectionLabel(s), s.label, s.id, s.group, groupLabel(s.group), ...(s.keywords || [])].filter(Boolean).join(' ').toLowerCase().includes(q);
  const groups = [];
  for (const s of sections.filter(match)) {
    let g = groups.find((x) => x.name === (s.group || ''));
    if (!g) { g = { name: s.group || '', items: [] }; groups.push(g); }
    g.items.push(s);
  }
  if (!groups.length) return `<p class="xmodal-none">${esc(t('settings.none'))}</p>`;
  return groups.map((g) => `<div class="xmodal-group">${g.name ? `<div class="nav-label">${esc(groupLabel(g.name))}</div>` : ''}${g.items.map((s) => `
    <a class="nav-item xmodal-link" href="#settings/${esc(s.id)}" data-section="${esc(s.id)}" data-menu-nav${s.id === active ? ' aria-current="page"' : ''}>${icon(s.icon || 'settings', 16)}<span>${esc(sectionLabel(s))}</span></a>`).join('')}</div>`).join('');
}

function shellHtml() {
  return `<div class="xmodal-root" data-state="enter">
  <div class="xmodal-scrim" data-close></div>
  <div class="xmodal" role="dialog" aria-modal="true" aria-labelledby="xmodal-title">
    <aside class="xmodal-side">
      <h2 class="xmodal-title" id="xmodal-title">${esc(t('settings.title'))}</h2>
      <label class="xmodal-search">${icon('search', 15)}<span class="sr-only">${esc(t('settings.search'))}</span>
        <input type="search" class="input" placeholder="${esc(t('settings.search'))}" autocomplete="off" spellcheck="false"></label>
      <nav class="xmodal-nav" aria-label="${esc(t('settings.title'))}"></nav>
    </aside>
    <section class="xmodal-pane" aria-labelledby="xmodal-pane-title">
      <header class="xmodal-pane-head"><h3 id="xmodal-pane-title"></h3>
        <button type="button" class="btn btn-icon" data-close aria-label="${esc(t('settings.close'))}" title="${esc(t('settings.close'))} (Esc)">${icon('x', 18)}</button></header>
      <div class="xmodal-body" tabindex="-1"></div>
    </section>
  </div>
</div>`;
}

function sectionCtx(onRefresh, isCurrent) {
  const base = shellCtx || {};
  return {
    api, prefs, params: [], query: new URLSearchParams(),
    navigate: (h) => { location.hash = h; },
    health: (force) => api.get('/api/health'),
    gpu: (force) => api.get('/api/gpu/status'),
    ...base,
    toast: (m, tone) => quietToast(base, m, tone),
    setCrumb: () => {}, announce: base.announce || (() => {}),
    refresh: onRefresh, isCurrent,
  };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** openSettings(sectionId?): opens the modal (or switches section if already open). Returns a promise. */
export async function openSettings(sectionId) {
  if (modal) { modal.select(sectionId || modal.active); return; }
  const prevFocus = document.activeElement;
  const host = document.createElement('div');
  host.innerHTML = shellHtml();
  const root = host.firstElementChild;
  document.body.appendChild(root);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const dialog = root.querySelector('.xmodal');
  const nav = root.querySelector('.xmodal-nav');
  const body = root.querySelector('.xmodal-body');
  const paneTitle = root.querySelector('#xmodal-pane-title');
  const search = root.querySelector('.xmodal-search input');
  let sections = [];
  let cleanup = null;
  let token = 0;
  let closed = false;

  if (!isSettingsHash(location.hash)) {
    lastPage = location.hash || null;
    try { history.pushState({ varelqSettings: true }, '', '#settings'); } catch { /* ignore */ }
  }

  const state = { active: null };
  const renderNav = () => { nav.innerHTML = navHtml(sections, state.active, search.value); };

  let loaded = false;
  async function select(id, { focusBody = false } = {}) {
    if (closed) return;
    if (!loaded) { if (id) api_ref.active = id; return; }
    const sec = sections.find((s) => s.id === id) || sections[0];
    if (!sec) { paneTitle.textContent = t('settings.title'); body.innerHTML = `<p class="xmodal-none">${esc(t('settings.failed'))}</p>`; return; }
    const mine = ++token;
    if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
    cleanup = null;
    state.active = sec.id;
    api_ref.active = sec.id;
    renderNav();
    paneTitle.textContent = sectionLabel(sec);
    try { history.replaceState(history.state, '', `#settings/${sec.id}`); } catch { /* ignore */ }
    document.title = `${sectionLabel(sec)} · ${t('settings.title')} · VARELQ`;
    const el = document.createElement('div');
    el.className = 'xmodal-section';
    body.replaceChildren(el);
    body.scrollTop = 0;
    try {
      const c = await sec.render(el, sectionCtx(() => select(sec.id), () => !closed && mine === token));
      if (mine !== token || closed) { if (typeof c === 'function') c(); return; }
      cleanup = c;
    } catch (err) {
      console.warn(`Settings section ${sec.id} failed`, err);
      if (mine === token) el.innerHTML = `<p class="xmodal-none">${esc(t('settings.failed'))}</p>`;
    }
    if (focusBody && mine === token) body.focus({ preventScroll: true });
  }

  function close({ restoreHash = true } = {}) {
    if (closed) return;
    closed = true;
    token++;
    if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('varelq:lang', onLang);
    document.body.style.overflow = prevOverflow;
    modal = null;
    const finish = () => root.remove();
    root.dataset.state = 'leave';
    const dur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-2')) || 0;
    if (dur > 0) setTimeout(finish, dur); else finish();
    if (restoreHash && isSettingsHash(location.hash)) {
      if (lastPage) { try { history.replaceState(null, '', lastPage); } catch { location.hash = lastPage; } }
      else location.hash = '#overview';
    }
    const h1 = document.querySelector('main h1');
    if (h1 && document.title.includes(t('settings.title'))) document.title = `${h1.textContent.trim()} · VARELQ`;
    if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus();
  }

  function onKey(e) {
    if (closed) return;
    if (e.key === 'Escape') {
      if (e.target === search && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; renderNav(); return; }
      if (document.querySelector('.drawer-root, .xpop')) return; // let an inner drawer or popover close first
      e.preventDefault(); e.stopPropagation(); close(); return;
    }
    if (e.key === 'Tab') {
      const list = [...dialog.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0]; const last = list[list.length - 1];
      if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (nav.contains(e.target)) menuKeys(nav, e);
    if (e.target === search && e.key === 'ArrowDown') { e.preventDefault(); nav.querySelector('.xmodal-link')?.focus(); }
  }
  function onLang() {
    root.querySelector('.xmodal-title').textContent = t('settings.title');
    search.placeholder = t('settings.search');
    renderNav();
    const sec = sections.find((s) => s.id === state.active);
    if (sec) paneTitle.textContent = sectionLabel(sec);
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    const link = e.target.closest('[data-section]');
    if (link) { e.preventDefault(); select(link.dataset.section, { focusBody: false }); link.focus(); }
  });
  search.addEventListener('input', renderNav);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const first = nav.querySelector('[data-section]'); if (first) select(first.dataset.section, { focusBody: true }); }
  });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('varelq:lang', onLang);

  const api_ref = { root, select: (id) => select(id), close, active: sectionId || null };
  modal = api_ref;
  requestAnimationFrame(() => { if (root.dataset.state === 'enter') root.dataset.state = 'open'; });
  (window.matchMedia && window.matchMedia('(max-width: 720px)').matches ? dialog.querySelector('[data-close]') : search).focus({ preventScroll: true });

  sections = await loadSections();
  loaded = true;
  if (closed) return;
  const want = api_ref.active || (location.hash.match(/^#\/?settings\/([\w-]+)/) || [])[1];
  await select(want || (sections[0] && sections[0].id));
}

/** closeSettings(): closes the modal if open. */
export function closeSettings() { if (modal) modal.close(); }
