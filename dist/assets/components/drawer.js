import { esc } from '../format.js';
import { icon } from '../icons.js';

/** drawer({title, body}) -> drawer HTML (not mounted). Use openDrawer() to show one. */
export function drawer({ title = '', body = '' } = {}) {
  return `<div class="drawer-root"><div class="drawer-scrim" data-drawer-close></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="drawer-head"><h2>${esc(title)}</h2><span class="spacer"></span><button type="button" class="btn btn-icon" data-drawer-close aria-label="Close">${icon('x', 16)}</button></div><div class="drawer-body">${body}</div></aside></div>`;
}

/** openDrawer({title, body, onClose}) mounts a drawer, closes on Esc or scrim click, restores focus; returns close(). */
export function openDrawer({ title, body, onClose } = {}) {
  const prev = document.activeElement;
  const host = document.createElement('div');
  host.innerHTML = drawer({ title, body });
  const root = host.firstElementChild;
  document.body.appendChild(root);
  let closed = false;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    if (prev && prev.focus) prev.focus();
    if (onClose) onClose();
  }
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', (e) => { if (e.target.closest('[data-drawer-close]')) close(); });
  const btn = root.querySelector('.drawer-head .btn');
  if (btn) btn.focus();
  return close;
}
