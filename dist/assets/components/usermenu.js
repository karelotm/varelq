// Sidebar user block (avatar, operator name, email) with a Claude-style account menu that opens above it.
// Also exports the small shared pieces the shell chrome uses: the local profile store, a body-level popover
// with menu keyboard handling, a few extra icons, and a toast fallback.
import { icon as baseIcon } from '../icons.js';
import { esc } from '../format.js';
import { t, getLang, setLang, LANGS } from '../i18n.js';
import './settings-modal.js'; // registers the page-hash tracker early so closing Settings returns to the right page

/* ---------- extra icons (Lucide, ISC) not in icons.js ---------- */
const EXTRA = {
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  'help-circle': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  'bar-chart': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  building: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  sliders: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  'chevrons-up-down': '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  compass: '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
};
/** icon(name, size, cls): icons.js first, then the extra set above. */
export function icon(name, size = 16, cls = '') {
  const s = baseIcon(name, size, cls);
  if (s || !EXTRA[name]) return s;
  return `<svg class="icon icon-${name}${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${EXTRA[name]}</svg>`;
}

/* ---------- local profile store (varelq.profile) ---------- */
const PKEY = 'varelq.profile';
const DEFAULT_ORG = { id: 'local', name: 'Local workspace' };
function readProfile() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PKEY) || '{}') || {}; } catch { p = {}; }
  return normalize(p);
}
function normalize(p) {
  const orgs = Array.isArray(p.orgs) ? p.orgs.filter((o) => o && typeof o.id === 'string' && typeof o.name === 'string' && o.name.trim()).slice(0, 50) : [];
  if (!orgs.length) orgs.push({ ...DEFAULT_ORG });
  const org = orgs.some((o) => o.id === p.org) ? p.org : orgs[0].id;
  const operator = p.operator && typeof p.operator === 'object' ? p.operator : {};
  return {
    orgs, org,
    operator: { name: typeof operator.name === 'string' ? operator.name.slice(0, 80) : '', email: typeof operator.email === 'string' ? operator.email.slice(0, 120) : '' },
  };
}
let profile = readProfile();
/** getProfile() -> {orgs:[{id,name}], org, operator:{name,email}} (a copy). */
export function getProfile() { return JSON.parse(JSON.stringify(profile)); }
export function currentOrg() { return profile.orgs.find((o) => o.id === profile.org) || profile.orgs[0]; }
/** setProfile(patch): shallow-merges, persists (best effort), dispatches 'varelq:profile'. */
export function setProfile(patch) {
  const next = { ...profile, ...patch };
  profile = normalize(next);
  try { localStorage.setItem(PKEY, JSON.stringify(profile)); } catch { /* session only */ }
  window.dispatchEvent(new CustomEvent('varelq:profile', { detail: getProfile() }));
}
window.addEventListener('storage', (e) => {
  if (e.key === PKEY) { profile = readProfile(); window.dispatchEvent(new CustomEvent('varelq:profile', { detail: getProfile() })); }
});

export function initials(name, fallback = 'L') {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

/* ---------- toast fallback ---------- */
export function quietToast(ctx, message, tone = 'info') {
  if (ctx && typeof ctx.toast === 'function') { ctx.toast(message, tone); return; }
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `${icon('info', 16)}<span>${esc(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

/* ---------- popover ---------- */
let openPop = null;
/**
 * openPopover({anchor, html, placement, className, label, role, onClose, onOpen}) mounts a fixed popover on <body>.
 * placement: 'above' | 'below' | 'below-end'. Closes on outside press, Esc (focus returns to anchor), resize and hashchange.
 * Returns {el, close(returnFocus)}.
 */
export function openPopover({ anchor, html, placement = 'below', className = '', label = '', role = 'menu', onClose, onOpen }) {
  if (openPop) openPop.close(false);
  const el = document.createElement('div');
  el.className = `xpop ${className}`.trim();
  el.setAttribute('role', role);
  if (label) el.setAttribute('aria-label', label);
  el.tabIndex = -1;
  el.innerHTML = html;
  document.body.appendChild(el);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = el.offsetWidth;
    let left = placement === 'below-end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    el.style.left = `${Math.round(left)}px`;
    if (placement === 'above') { el.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`; el.style.top = 'auto'; }
    else { el.style.top = `${Math.round(r.bottom + 6)}px`; el.style.bottom = 'auto'; }
    if (placement !== 'below-end' && el.dataset.matchWidth === '1') el.style.width = `${Math.round(r.width)}px`;
  };
  if (placement !== 'below-end' && !className.includes('xpop-free')) el.dataset.matchWidth = '1';
  place();
  el.dataset.placement = placement;
  anchor.setAttribute('aria-expanded', 'true');
  let closed = false;
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(false); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'Tab' && role === 'menu' && !e.target.closest('form')) { close(false); return; }
    if (role === 'menu' || el.querySelector('[data-menu-nav]')) menuKeys(el, e);
  };
  const onResize = () => close(false);
  function close(returnFocus) {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onDown, true);
    el.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('hashchange', onResize);
    anchor.setAttribute('aria-expanded', 'false');
    el.remove();
    if (openPop && openPop.el === el) openPop = null;
    if (returnFocus && anchor.isConnected) anchor.focus();
    if (onClose) onClose();
  }
  document.addEventListener('pointerdown', onDown, true);
  el.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  window.addEventListener('hashchange', onResize);
  openPop = { el, close, place };
  if (onOpen) onOpen(el, place);
  return openPop;
}

function menuItems(root) {
  return [...root.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [data-menu-nav]')].filter((x) => !x.closest('[hidden]') && !x.disabled);
}
/** Arrow/Home/End roving focus among menu items inside root. */
export function menuKeys(root, e) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  if (e.target.matches && e.target.matches('input, textarea')) return;
  const items = menuItems(root);
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement);
  let n;
  if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = items.length - 1;
  else if (e.key === 'ArrowDown') n = i < 0 ? 0 : (i + 1) % items.length;
  else n = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length;
  items[n].focus();
}
export function focusFirstItem(root) { const it = menuItems(root)[0]; if (it) it.focus(); else root.focus(); }

/* ---------- settings opener (lazy) ---------- */
export function openSettingsLazy(section, ctx) {
  return import('./settings-modal.js').then((m) => {
    if (m.setShellContext && ctx) m.setShellContext(ctx);
    return m.openSettings(section);
  }).catch((err) => { console.warn('Settings modal failed to load', err); quietToast(ctx, t('settings.failed'), 'danger'); });
}

/* ---------- user block + menu ---------- */
const HELP_URL = 'https://github.com/karelotm/varelq#readme';
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');

function blockHtml() {
  const p = profile.operator;
  const name = p.name || t('user.operator');
  const sub = p.email || t('user.local');
  return `<button type="button" class="operator xuser" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t('user.menu'))}: ${esc(name)}">
    <span class="operator-avatar" aria-hidden="true">${esc(initials(p.name, 'L'))}</span>
    <span class="org-text"><strong>${esc(name)}</strong><small>${esc(sub)}</small></span>
    ${icon('chevrons-up-down', 14, 'org-chev')}
  </button>`;
}

function menuHtml() {
  const p = profile.operator;
  const lang = getLang();
  const langLabel = (LANGS.find((l) => l.id === lang) || LANGS[0]).label;
  return `<div class="xpop-head">${esc(p.email || p.name || t('user.local'))}</div>
  <button type="button" role="menuitem" class="xpop-item" data-act="settings">${icon('settings', 16)}<span>${esc(t('user.settings'))}</span><kbd class="xpop-kbd">${isMac ? '⌘' : 'Ctrl'}+,</kbd></button>
  <button type="button" role="menuitem" class="xpop-item" data-act="usage">${icon('bar-chart', 16)}<span>${esc(t('user.usage'))}</span></button>
  <button type="button" role="menuitem" class="xpop-item" data-act="lang" aria-haspopup="true" aria-expanded="false">${icon('globe', 16)}<span>${esc(t('user.language'))}</span><span class="xpop-meta">${esc(langLabel)}</span>${icon('chevron-right', 14, 'xpop-chev')}</button>
  <div class="xpop-sub" role="group" aria-label="${esc(t('user.language'))}" hidden>
    ${LANGS.map((l) => `<button type="button" role="menuitemradio" aria-checked="${l.id === lang}" class="xpop-item" data-lang="${l.id}" lang="${l.id}"><span class="xpop-check">${l.id === lang ? icon('check', 14) : ''}</span><span>${esc(l.label)}</span></button>`).join('')}
  </div>
  <button type="button" role="menuitem" class="xpop-item" data-act="tour">${icon('compass', 16)}<span>${esc(t('user.tour', 'Take the tour'))}</span></button>
  <a role="menuitem" class="xpop-item" href="${HELP_URL}" target="_blank" rel="noopener noreferrer" data-act="help">${icon('help-circle', 16)}<span>${esc(t('user.help'))}</span>${icon('external-link', 13, 'xpop-chev')}</a>
  <div class="xpop-sep" role="separator"></div>
  <button type="button" role="menuitem" class="xpop-item" data-act="logout">${icon('log-out', 16)}<span>${esc(t('user.logout'))}</span></button>`;
}

async function logout(ctx) {
  let res = null;
  try { res = await fetch('/__logout', { credentials: 'same-origin', cache: 'no-store' }); } catch { res = null; }
  if (res && (res.redirected || res.ok) && /\/__gate$/.test(new URL(res.url, location.href).pathname)) {
    location.assign('/__gate');
    return;
  }
  quietToast(ctx, t('user.nologout'), 'info');
}

/** mountUserMenu(el, ctx): renders the user block into el; returns cleanup. */
export function mountUserMenu(el, ctx) {
  if (!el) return () => {};
  let pop = null;
  const render = () => { el.innerHTML = blockHtml(); };
  render();
  const trigger = () => el.querySelector('.xuser');

  function open() {
    const anchor = trigger();
    pop = openPopover({
      anchor, html: menuHtml(), placement: 'above', className: 'xpop-menu', label: t('user.menu'),
      onClose: () => { pop = null; },
      onOpen: (root) => focusFirstItem(root),
    });
    pop.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act], [data-lang]');
      if (!b) return;
      if (b.dataset.lang) { pop.close(true); setLang(b.dataset.lang); return; }
      const act = b.dataset.act;
      if (act === 'lang') { toggleLang(b); return; }
      if (act === 'help') { pop.close(false); return; }
      pop.close(false);
      if (act === 'settings') openSettingsLazy(undefined, ctx);
      else if (act === 'usage') openSettingsLazy('usage', ctx);
      else if (act === 'logout') logout(ctx);
      else if (act === 'tour') import('./tour.js').then((m) => m.startTour()).catch((err) => console.warn('Tour failed to load', err));
    });
    pop.el.addEventListener('keydown', (e) => {
      const b = e.target.closest('[data-act="lang"]');
      if (b && e.key === 'ArrowRight') { e.preventDefault(); toggleLang(b, true); }
      if (e.target.closest('.xpop-sub') && e.key === 'ArrowLeft') { e.preventDefault(); const lb = pop.el.querySelector('[data-act="lang"]'); toggleLang(lb, false); lb.focus(); }
    });
  }
  function toggleLang(b, force) {
    const sub = pop.el.querySelector('.xpop-sub');
    const show = force !== undefined ? force : sub.hidden;
    sub.hidden = !show;
    b.setAttribute('aria-expanded', String(show));
    b.classList.toggle('is-open', show);
    if (show) { const cur = sub.querySelector('[aria-checked="true"]') || sub.querySelector('button'); cur.focus(); }
  }
  const onClick = (e) => {
    if (!e.target.closest('.xuser')) return;
    if (pop) pop.close(true); else open();
  };
  const onKeyTrigger = (e) => {
    if (e.target.closest('.xuser') && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !pop) { e.preventDefault(); open(); }
  };
  const onGlobalKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ',' && !e.defaultPrevented) { e.preventDefault(); openSettingsLazy(undefined, ctx); }
  };
  const rerender = () => { const had = el.contains(document.activeElement); if (pop) pop.close(false); render(); if (had) el.querySelector('button')?.focus(); };
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKeyTrigger);
  document.addEventListener('keydown', onGlobalKey);
  window.addEventListener('varelq:profile', rerender);
  window.addEventListener('varelq:lang', rerender);
  return () => {
    if (pop) pop.close(false);
    el.removeEventListener('click', onClick);
    el.removeEventListener('keydown', onKeyTrigger);
    document.removeEventListener('keydown', onGlobalKey);
    window.removeEventListener('varelq:profile', rerender);
    window.removeEventListener('varelq:lang', rerender);
  };
}
