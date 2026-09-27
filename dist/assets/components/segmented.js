import { esc } from '../format.js';
import { icon } from '../icons.js';

/**
 * segmented({name, options:[{value,label,icon?,disabled?}] | string[], value, label}) -> radio group HTML.
 * Listen for 'change' on input[name=...].
 */
export function segmented({ name, options = [], value, label, disabled = false } = {}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const items = opts.map((o) => {
    const id = `seg-${name}-${String(o.value).replace(/[^a-z0-9-]/gi, '')}`;
    const checked = String(o.value) === String(value) ? ' checked' : '';
    const dis = disabled || o.disabled ? ' disabled' : '';
    return `<label class="seg-option" for="${esc(id)}"><input type="radio" id="${esc(id)}" name="${esc(name)}" value="${esc(o.value)}"${checked}${dis}><span>${o.icon ? icon(o.icon, 14) : ''}${esc(o.label)}</span></label>`;
  }).join('');
  return `<div class="segmented" role="radiogroup"${label ? ` aria-label="${esc(label)}"` : ''}>${items}</div>`;
}
