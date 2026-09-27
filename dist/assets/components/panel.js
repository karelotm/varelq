import { esc } from '../format.js';

/** panel({title, count, actions, body, flush, id, footer, headExtra}) -> section HTML. title is escaped; body/actions/headExtra are HTML. */
export function panel({ title, count, actions = '', body = '', flush = false, id, footer = '', headExtra = '', className = '', titleTag = 'h2' } = {}) {
  const idAttr = id ? ` id="${esc(id)}"` : '';
  const labelId = id ? `${esc(id)}-title` : '';
  const hasTitle = title !== undefined && title !== null && title !== '';
  const countHtml = count !== undefined && count !== null ? ` <span class="count">${esc(count)}</span>` : '';
  const head = hasTitle
    ? `<div class="panel-head"><${titleTag}${labelId ? ` id="${labelId}"` : ''}>${esc(title)}${countHtml}</${titleTag}>${headExtra}${actions ? `<div class="panel-actions">${actions}</div>` : ''}</div>`
    : '';
  const aria = hasTitle && labelId ? ` aria-labelledby="${labelId}"` : '';
  return `<section class="panel${flush ? ' flush' : ''}${className ? ` ${esc(className)}` : ''}"${idAttr}${aria}>${head}<div class="panel-body">${body}</div>${footer ? `<div class="panel-foot">${footer}</div>` : ''}</section>`;
}
