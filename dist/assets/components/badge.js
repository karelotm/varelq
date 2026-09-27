import { esc } from '../format.js';
import { icon } from '../icons.js';

const TONES = new Set(['danger', 'warning', 'success', 'info', 'accent', 'neutral']);
/** badge(text, tone): tone in danger|warning|success|info|accent|neutral. opts: {icon, prefix, title, className} */
export function badge(text, tone = 'neutral', opts = {}) {
  const t = TONES.has(tone) ? tone : 'neutral';
  const pre = opts.prefix ? `<span class="prefix">${esc(opts.prefix)}</span>` : '';
  const ic = opts.icon ? icon(opts.icon, 12) : '';
  const title = opts.title ? ` title="${esc(opts.title)}"` : '';
  return `<span class="badge badge-${t}${opts.className ? ` ${esc(opts.className)}` : ''}"${title}>${ic}${pre}${esc(text)}</span>`;
}

const SEVERITY = { critical: 'danger', high: 'warning', medium: 'neutral', low: 'neutral', none: 'neutral' };
/** severityBadge('Critical') -> danger badge. 'none' renders nothing. */
export function severityBadge(severity) {
  if (!severity) return '';
  const s = String(severity).toLowerCase();
  if (s === 'none') return '';
  return badge(s.charAt(0).toUpperCase() + s.slice(1), SEVERITY[s] || 'neutral');
}

const DECISIONS = { pending: ['Pending review', 'warning'], reviewed: ['Reviewed', 'success'], needs_clarification: ['Needs clarification', 'info'] };
/** decisionBadge('needs_clarification') -> info badge "Needs clarification". */
export function decisionBadge(decision) {
  const d = DECISIONS[decision] || DECISIONS.pending;
  return badge(d[0], d[1]);
}
