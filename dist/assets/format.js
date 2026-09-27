// Formatting helpers. Every string that reaches innerHTML goes through esc() first.

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

const DASH = '—';
export const EMPTY = DASH;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

const CURRENCY_ALIASES = { RM: 'MYR', 'US$': 'USD', $: 'USD', '€': 'EUR', '£': 'GBP', DT: 'TND', TD: 'TND' };
export function currencyCode(currency) {
  if (!currency) return null;
  const raw = String(currency).trim();
  const code = CURRENCY_ALIASES[raw] || CURRENCY_ALIASES[raw.toUpperCase()] || raw.toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** money('2500.00', 'TND') -> "2,500.000 TND"-style string with the ISO code. */
export function money(value, currency) {
  const n = toNumber(value);
  if (n === null) return DASH;
  const code = currencyCode(currency);
  // Keep the precision the document states (2500.00 stays two decimals); default to two.
  const m = typeof value === 'string' ? value.trim().match(/\.(\d+)$/) : null;
  const decimals = m ? Math.min(Math.max(m[1].length, 2), 4) : 2;
  const amount = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  return code ? `${amount} ${code}` : amount;
}

/** num(1082) -> "1,082". Decimal strings keep their precision. */
export function num(value, options) {
  const n = toNumber(value);
  if (n === null) return DASH;
  if (!options && typeof value === 'string' && /\.\d+$/.test(value.trim())) {
    const decimals = value.trim().split('.')[1].length;
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  }
  return new Intl.NumberFormat('en-US', options || { maximumFractionDigits: 2 }).format(n);
}

/** Signed number for deltas: +20, −20, 0. */
export function signed(value) {
  const n = toNumber(value);
  if (n === null) return DASH;
  const body = num(typeof value === 'string' ? value.replace(/^[-+]/, '') : Math.abs(n));
  if (n > 0) return `+${body}`;
  if (n < 0) return `−${body}`;
  return body;
}

/** pct(3, 12) -> "25%". Returns an em dash when the denominator is 0 or missing. */
export function pct(n, d) {
  const a = toNumber(n); const b = toNumber(d);
  if (a === null || !b) return DASH;
  const p = (100 * a) / b;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
}

/** ratio(3, 5) -> "3/5". */
export function ratio(n, d) {
  const a = toNumber(n); const b = toNumber(d);
  if (a === null || b === null) return DASH;
  return `${num(a)}/${num(b)}`;
}

/** ms(412) -> "412 ms"; ms(9100) -> "9.1 s"; ms(125000) -> "2 min 5 s". */
export function ms(value) {
  const n = toNumber(value);
  if (n === null) return DASH;
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} s`;
  const m = Math.floor(n / 60000); const s = Math.round((n % 60000) / 1000);
  return s ? `${m} min ${s} s` : `${m} min`;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** relTime(iso) -> "3 min ago", "yesterday", or a date. */
export function relTime(value) {
  const d = toDate(value);
  if (!d) return DASH;
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return dateTime(d);
}

/** dateTime(iso) -> "27 Sep 2026, 13:20" in the viewer's zone. */
export function dateTime(value) {
  const d = toDate(value);
  if (!d) return DASH;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** hhmm(iso) -> "13:20" in the viewer's zone. */
export function hhmm(value) {
  const d = toDate(value);
  if (!d) return DASH;
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(d);
}

const PLURAL = new Intl.PluralRules('en-US');
/** plural(3, 'run', 'runs') -> "3 runs" (count included). */
export function plural(n, one, other) {
  return `${num(n)} ${word(n, one, other)}`;
}
/** word(3, 'run', 'runs') -> "runs" (no count). */
export function word(n, one, other) {
  const v = toNumber(n) ?? 0;
  return PLURAL.select(v) === 'one' ? one : (other ?? `${one}s`);
}

const LABELS = {
  // decisions and statuses
  pending: 'Pending review', reviewed: 'Reviewed', needs_clarification: 'Needs clarification',
  success: 'Success', error: 'Error', difference: 'Difference', passed: 'Passed', pass: 'Passed', ok: 'OK', blocked: 'Blocked',
  // document roles
  invoice: 'Invoice', purchase_order: 'Purchase order', receiving_record: 'Receiving record',
  // check kinds
  total_vs_net_plus_tax: 'Total vs net plus tax', tax_vs_rate: 'Tax vs rate', line_qty_x_price: 'Line quantity × price',
  qty_invoiced_vs_ordered: 'Invoiced vs ordered', price_invoice_vs_order: 'Unit price, invoice vs order',
  qty_received_vs_ordered: 'Received vs ordered', qty_invoiced_vs_received: 'Invoiced vs received',
  // reliability patterns
  write_without_confirmation: 'Write without confirmation', action_before_authentication: 'Action before authentication',
  tool_error_ignored: 'Tool error ignored',
  // lab outcomes
  approved_payment: 'Approved payment', requested_clarification: 'Requested clarification', held_invoice: 'Held invoice',
  hold_invoice: 'Held invoice', legit_approval: 'Legitimate approval', false_block: 'False block', unsafe: 'Unsafe', safe: 'Safe',
  guarded: 'Guarded', baseline: 'Baseline', 'self-hosted': 'Self-hosted', hosted: 'Hosted',
  // extracted fields
  order_reference: 'Order reference', vat_rate: 'VAT rate', vat: 'VAT', net: 'Net', total: 'Total', currency: 'Currency',
  supplier: 'Supplier', reference: 'Reference', sku: 'SKU', unit_price: 'Unit price', line_total: 'Line total', quantity: 'Quantity',
};
/** humanize('needs_clarification') -> "Needs clarification". Unknown enums become sentence case. */
export function humanize(value) {
  if (value === null || value === undefined || value === '') return DASH;
  const key = String(value);
  if (LABELS[key]) return LABELS[key];
  const text = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/** Short model name: "nvidia/nemotron-3-super-120b-a12b" -> "nemotron-3-super". */
export function shortModel(model) {
  if (!model) return DASH;
  const name = String(model).split('/').pop();
  return name.replace(/-\d+(\.\d+)?b(-a\d+b)?.*$/i, '') || name;
}

/** Numeric sort key for step ids like "17.1". */
export function stepKey(id) {
  return String(id).split('.').map((p) => Number(p) || 0);
}
export function compareStepIds(a, b) {
  const x = stepKey(a); const y = stepKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}
