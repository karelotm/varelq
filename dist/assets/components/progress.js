import { esc } from '../format.js';

/** progress({value, max, label}): determinate when max is given, otherwise an indeterminate bar. */
export function progress({ value = 0, max, label = '' } = {}) {
  const determinate = typeof max === 'number' && max > 0;
  const v = determinate ? Math.max(0, Math.min(value, max)) : 0;
  const aria = determinate
    ? `role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${v}"`
    : 'role="progressbar" aria-busy="true"';
  const fill = determinate ? ` style="transform: scaleX(${(v / max).toFixed(4)})"` : '';
  return `<div class="progress${determinate ? '' : ' indeterminate'}" ${aria}${label ? ` aria-label="${esc(label)}"` : ''}><div class="progress-track"><div class="progress-fill"${fill}></div></div>${label ? `<div class="progress-label" aria-live="polite">${esc(label)}</div>` : ''}</div>`;
}
