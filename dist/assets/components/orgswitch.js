// Sidebar organization block: initials avatar + name + "Local workspace". Opens a popover to switch between
// local organization profiles (stored in varelq.profile), create one inline, or open Organization settings.
// Switching fires window event 'varelq:org' ({detail:{id,name}}).
import { esc } from '../format.js';
import { t } from '../i18n.js';
import { icon, getProfile, setProfile, currentOrg, initials, openPopover, focusFirstItem, openSettingsLazy, quietToast } from './usermenu.js';

function blockHtml() {
  const org = currentOrg();
  return `<button type="button" class="org xorg" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t('org.switch'))}: ${esc(org.name)}">
    <span class="org-avatar" aria-hidden="true">${esc(initials(org.name, 'LW'))}</span>
    <span class="org-text"><strong>${esc(org.name)}</strong><small>${esc(t('org.local'))}</small></span>
    ${icon('chevrons-up-down', 14, 'org-chev')}
  </button>`;
}

function listHtml() {
  const p = getProfile();
  const items = p.orgs.map((o) => `<button type="button" role="menuitemradio" aria-checked="${o.id === p.org}" class="xpop-item" data-org="${esc(o.id)}">
      <span class="org-avatar xpop-avatar" aria-hidden="true">${esc(initials(o.name, 'LW'))}</span><span class="truncate">${esc(o.name)}</span>
      <span class="xpop-check xpop-end">${o.id === p.org ? icon('check', 14) : ''}</span></button>`).join('');
  return `<div class="xpop-head">${esc(t('org.switch'))}</div>
  <div class="xpop-list" role="group">${items}</div>
  <div class="xpop-sep" role="separator"></div>
  <button type="button" role="menuitem" class="xpop-item" data-act="new">${icon('plus', 16)}<span>${esc(t('org.new'))}</span></button>
  <form class="xpop-form" data-form="new" hidden>
    <label class="sr-only" for="xorg-name">${esc(t('org.name'))}</label>
    <input id="xorg-name" class="input" name="name" maxlength="60" autocomplete="off" placeholder="${esc(t('org.name'))}" required>
    <div class="xpop-form-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-act="cancel">${esc(t('org.cancel'))}</button>
      <button type="submit" class="btn btn-primary btn-sm">${esc(t('org.create'))}</button>
    </div>
  </form>
  <button type="button" role="menuitem" class="xpop-item" data-act="settings">${icon('settings', 16)}<span>${esc(t('org.settings'))}</span></button>
  <p class="xpop-caption">${esc(t('org.caption'))}</p>`;
}

function slugId(name, taken) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'org';
  let id = base; let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

// The Organization settings section (views/settings.js) keeps its form in varelq.org.profile; its name mirrors the
// current organization here: switching writes the name there, saving there renames the current organization.
const SETTINGS_ORG_KEY = 'varelq.org.profile';
function readSettingsOrg() {
  try { const o = JSON.parse(localStorage.getItem(SETTINGS_ORG_KEY) || 'null'); return o && typeof o === 'object' ? o : null; } catch { return null; }
}
function mirrorToSettings(name) {
  try { localStorage.setItem(SETTINGS_ORG_KEY, JSON.stringify({ ...(readSettingsOrg() || {}), name })); } catch { /* ignore */ }
}
function renameCurrent(name) {
  const clean = String(name || '').trim().slice(0, 60);
  const p = getProfile();
  if (!clean || currentOrg().name === clean) return;
  setProfile({ orgs: p.orgs.map((o) => (o.id === p.org ? { ...o, name: clean } : o)) });
}

function announceOrg() {
  const o = currentOrg();
  mirrorToSettings(o.name);
  window.dispatchEvent(new CustomEvent('varelq:org', { detail: { id: o.id, name: o.name, source: 'orgswitch' } }));
}

/** mountOrgSwitch(el, ctx): renders the org block into el; returns cleanup. */
export function mountOrgSwitch(el, ctx) {
  if (!el) return () => {};
  let pop = null;
  const render = () => { el.innerHTML = blockHtml(); };
  render();

  function open() {
    const anchor = el.querySelector('.xorg');
    pop = openPopover({
      anchor, html: listHtml(), placement: 'below', className: 'xpop-menu xpop-org', label: t('org.switch'),
      onClose: () => { pop = null; },
      onOpen: (root) => { const cur = root.querySelector('[aria-checked="true"]'); if (cur) cur.focus(); else focusFirstItem(root); },
    });
    const root = pop.el;
    const form = root.querySelector('[data-form="new"]');
    const newBtn = root.querySelector('[data-act="new"]');
    root.addEventListener('click', (e) => {
      const orgBtn = e.target.closest('[data-org]');
      if (orgBtn) {
        const id = orgBtn.dataset.org;
        pop.close(true);
        if (id !== getProfile().org) {
          setProfile({ org: id });
          announceOrg();
          quietToast(ctx, `${t('org.switched')} ${currentOrg().name}`, 'success');
        }
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'new') { form.hidden = false; newBtn.hidden = true; pop.place(); form.querySelector('input').focus(); }
      else if (act === 'cancel') { form.hidden = true; newBtn.hidden = false; newBtn.focus(); }
      else if (act === 'settings') { pop.close(false); openSettingsLazy('organization', ctx); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.querySelector('input').value.trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!name) return;
      const p = getProfile();
      const id = slugId(name, new Set(p.orgs.map((o) => o.id)));
      setProfile({ orgs: [...p.orgs, { id, name }], org: id });
      pop.close(true);
      announceOrg();
      quietToast(ctx, `${t('org.created')}: ${name}`, 'success');
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); form.hidden = true; newBtn.hidden = false; newBtn.focus(); }
    });
  }
  const onClick = (e) => {
    if (!e.target.closest('.xorg')) return;
    if (pop) pop.close(true); else open();
  };
  const onKey = (e) => {
    if (e.target.closest('.xorg') && e.key === 'ArrowDown' && !pop) { e.preventDefault(); open(); }
  };
  const rerender = () => { const had = el.contains(document.activeElement); if (pop) pop.close(false); render(); if (had) el.querySelector('button')?.focus(); };
  const onOrg = (e) => { const d = e.detail || {}; if (d.source !== 'orgswitch' && d.name) renameCurrent(d.name); };
  const saved = readSettingsOrg();
  if (saved && saved.name) renameCurrent(saved.name);
  render();
  window.addEventListener('varelq:org', onOrg);
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  window.addEventListener('varelq:profile', rerender);
  window.addEventListener('varelq:lang', rerender);
  return () => {
    if (pop) pop.close(false);
    el.removeEventListener('click', onClick);
    el.removeEventListener('keydown', onKey);
    window.removeEventListener('varelq:profile', rerender);
    window.removeEventListener('varelq:lang', rerender);
    window.removeEventListener('varelq:org', onOrg);
  };
}
