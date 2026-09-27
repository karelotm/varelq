import { esc, EMPTY } from '../format.js';
import { empty as emptyState, errorState, retryButton } from './empty.js';

/**
 * table({columns:[{key,label,align,mono,render,className,width}], rows, rowHref, rowKey, caption, empty, emptyAction,
 *        selectedKey, loading, error, ariaLabel})
 * - render(row) returns HTML; otherwise row[key] is escaped (null or '' shows an em dash).
 * - rowHref(row) makes the row navigate (data-href, keyboard reachable; the shell handles click and Enter).
 * - rowKey(row) (or row.key) adds data-key; with selectedKey the matching row gets aria-selected="true".
 * - loading: 3 skeleton rows. error: danger row with a Retry ghost button (data-action="retry").
 */
export function table({ columns = [], rows = [], rowHref, rowKey, caption, empty = 'Nothing to show.', emptyAction = '', selectedKey, loading = false, error, ariaLabel, className = '' } = {}) {
  const head = `<thead><tr>${columns.map((c) => `<th scope="col"${c.align ? ` class="align-${c.align}"` : ''}${c.width ? ` style="width:${esc(c.width)}"` : ''}>${esc(c.label ?? '')}</th>`).join('')}</tr></thead>`;
  const cap = caption ? `<caption>${esc(caption)}</caption>` : '';
  const aria = ariaLabel ? ` aria-label="${esc(ariaLabel)}"` : '';
  const span = Math.max(columns.length, 1);
  let body;
  if (loading) {
    body = [0, 1, 2].map(() => `<tr class="skeleton">${columns.map((c, i) => `<td><div class="skeleton-line${i % 2 ? ' short' : ''}"></div></td>`).join('')}</tr>`).join('');
  } else if (error) {
    const msg = typeof error === 'string' ? error : (error.message || 'Could not load.');
    body = `<tr class="row-error"><td colspan="${span}">${errorState(msg, retryButton())}</td></tr>`;
  } else if (!rows.length) {
    return `<div class="table-empty">${emptyState(empty, emptyAction)}</div>`;
  } else {
    body = rows.map((row) => {
      const key = rowKey ? rowKey(row) : row.key;
      const href = rowHref ? rowHref(row) : null;
      const attrs = [];
      if (href) attrs.push(`data-href="${esc(href)}"`, 'tabindex="0"');
      if (key !== undefined && key !== null) {
        attrs.push(`data-key="${esc(key)}"`);
        if (!href) attrs.push('tabindex="0"');
        if (selectedKey !== undefined) attrs.push(`aria-selected="${String(key) === String(selectedKey)}"`);
      }
      const cells = columns.map((c) => {
        const cls = [c.align ? `align-${c.align}` : '', c.mono ? 'mono' : '', c.className || ''].filter(Boolean).join(' ');
        let content;
        if (c.render) content = c.render(row);
        else {
          const v = row[c.key];
          content = v === null || v === undefined || v === '' ? `<span class="subtle">${EMPTY}</span>` : esc(v);
        }
        return `<td${cls ? ` class="${cls}"` : ''}>${content ?? ''}</td>`;
      }).join('');
      return `<tr${attrs.length ? ` ${attrs.join(' ')}` : ''}>${cells}</tr>`;
    }).join('');
  }
  return `<div class="table-wrap"><table class="table${className ? ` ${esc(className)}` : ''}"${aria}>${cap}${head}<tbody>${body}</tbody></table></div>`;
}
