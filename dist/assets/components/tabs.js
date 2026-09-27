// Tabs: an accessible tablist (WAI-ARIA tabs pattern, automatic activation).
//
//   tabs({ id: 'runs', items: [{ id: 'all', label: 'All', count: 12 }, ...], active: 'all' })
//     -> '<div class="tabs" role="tablist" ...>...</div>'
//   The matching panel is yours to render: <div role="tabpanel" id="runs-panel" aria-labelledby="runs-tab-all">.
//   tabPanelAttrs('runs', 'all') returns those attributes as a string.
//
//   const off = bindTabs(root, (tabId, tablistId) => { ... });  // click + ArrowLeft/Right/Home/End; returns cleanup
import { esc } from '../format.js';

const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '-');

export function tabId(listId, itemId) { return `${safe(listId)}-tab-${safe(itemId)}`; }

export function tabPanelAttrs(listId, activeId) {
  return `role="tabpanel" id="${safe(listId)}-panel" aria-labelledby="${tabId(listId, activeId)}" tabindex="0"`;
}

export function tabs({ id, items = [], active, label = '' } = {}) {
  const list = items.filter(Boolean);
  const current = list.some((it) => it.id === active) ? active : (list[0] && list[0].id);
  const buttons = list.map((it) => {
    const on = it.id === current;
    const count = it.count === undefined || it.count === null ? ''
      : `<span class="tab-count" aria-label="${esc(`${it.count} items`)}">${esc(it.count)}</span>`;
    return `<button type="button" class="tab" role="tab" id="${tabId(id, it.id)}" data-tab="${esc(it.id)}" aria-selected="${on}" aria-controls="${safe(id)}-panel" tabindex="${on ? 0 : -1}">${esc(it.label)}${count}</button>`;
  }).join('');
  return `<div class="tabs" role="tablist" data-tablist="${esc(id)}"${label ? ` aria-label="${esc(label)}"` : ''}>${buttons}</div>`;
}

function select(tab, focus) {
  const list = tab.closest('[role="tablist"]');
  if (!list) return;
  list.querySelectorAll('[role="tab"]').forEach((t) => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  });
  const panel = document.getElementById(tab.getAttribute('aria-controls'));
  if (panel) panel.setAttribute('aria-labelledby', tab.id);
  if (focus) tab.focus();
}

export function bindTabs(root, onChange) {
  if (!root) return () => {};
  const fire = (tab) => {
    if (typeof onChange === 'function') {
      const list = tab.closest('[role="tablist"]');
      onChange(tab.dataset.tab, list && list.dataset.tablist);
    }
  };
  const onClick = (e) => {
    const tab = e.target.closest('[role="tab"][data-tab]');
    if (!tab || !root.contains(tab) || tab.getAttribute('aria-selected') === 'true') return;
    select(tab, false);
    fire(tab);
  };
  const onKey = (e) => {
    const tab = e.target.closest && e.target.closest('[role="tab"][data-tab]');
    if (!tab || !root.contains(tab)) return;
    const all = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]:not([disabled])')];
    const i = all.indexOf(tab);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = all[(i + 1) % all.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = all[(i - 1 + all.length) % all.length];
    else if (e.key === 'Home') next = all[0];
    else if (e.key === 'End') next = all[all.length - 1];
    if (!next) return;
    e.preventDefault();
    if (next === tab) return;
    select(next, true);
    fire(next);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  return () => { root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); };
}
