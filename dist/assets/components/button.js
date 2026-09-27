import { esc } from '../format.js';
import { icon } from '../icons.js';

/** button({label, variant:'primary'|'secondary'|'ghost'|'icon', icon, action, href, disabled, type, ariaLabel, size, attrs}) */
export function button({ label = '', variant = 'secondary', icon: ic, action, href, disabled = false, type = 'button', ariaLabel, size, attrs = '' } = {}) {
  const cls = `btn btn-${variant}${size === 'sm' ? ' btn-sm' : ''}`;
  const inner = `${ic ? icon(ic, 16) : ''}${variant === 'icon' ? '' : `<span class="btn-label">${esc(label)}</span>`}`;
  const aria = ariaLabel || (variant === 'icon' ? label : '');
  const common = `class="${cls}"${action ? ` data-action="${esc(action)}"` : ''}${aria ? ` aria-label="${esc(aria)}"` : ''}${variant === 'icon' && label ? ` title="${esc(label)}"` : ''}${attrs ? ` ${attrs}` : ''}`;
  if (href) return `<a ${common} href="${esc(href)}"${disabled ? ' aria-disabled="true" tabindex="-1"' : ''}>${inner}</a>`;
  return `<button type="${esc(type)}" ${common}${disabled ? ' disabled' : ''}>${inner}</button>`;
}

/** setBusy(btn, true) swaps the label for "Working..." plus a 12px spinner (the spinner hides when motion is Off). */
export function setBusy(btn, busy) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.idleHtml) btn.dataset.idleHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="btn-label">Working…</span>';
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
  } else {
    if (btn.dataset.idleHtml) btn.innerHTML = btn.dataset.idleHtml;
    delete btn.dataset.idleHtml;
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
  }
}
