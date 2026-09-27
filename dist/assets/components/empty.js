import { esc } from '../format.js';
import { icon } from '../icons.js';

/** empty(text, actionHtml): one line plus one action. */
export function empty(text, actionHtml = '', opts = {}) {
  return `<div class="empty" role="status">${icon(opts.icon || 'circle-dashed', 16)}<span>${esc(text)}</span>${actionHtml || ''}</div>`;
}

/** errorState(message, actionHtml): danger-tone line plus one action (for example retryButton()). */
export function errorState(message, actionHtml = '') {
  return `<div class="empty error" role="alert">${icon('alert-triangle', 16)}<span>${esc(message)}</span>${actionHtml || ''}</div>`;
}

/** retryButton(): ghost button with data-action="retry"; the view handles the click. */
export function retryButton(label = 'Retry') {
  return `<button type="button" class="btn btn-ghost btn-sm" data-action="retry">${icon('rotate-ccw', 16)}<span>${esc(label)}</span></button>`;
}
