// VARELQ · Stream A2 · trace timeline + small shared helpers for the reliability views.
// Self-contained on purpose: depends on nothing outside A2's files, so it keeps working
// whatever state the shell helpers are in.

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf = new Intl.NumberFormat('en-US');
export const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? '–' : nf.format(Number(v));

const pr = new Intl.PluralRules('en-US');
export const plural = (n, one, other) => `${num(n)} ${pr.select(Number(n)) === 'one' ? one : other}`;

export function ms(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  const n = Number(v);
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} s`;
}

export function compact(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  const n = Number(v);
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return num(n);
}

export function humanize(s) {
  if (s === null || s === undefined) return '';
  const t = String(s).replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function relTime(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return plural(Math.floor(d / 60), 'minute', 'minutes') + ' ago';
  if (d < 86400) return plural(Math.floor(d / 3600), 'hour', 'hours') + ' ago';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function hhmm(iso) {
  const t = Date.parse(iso);
  return t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
}

// Readable, compact rendering of tool args / span payloads without dumping JSON.
export function fmtValue(v, depth = 0) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return `"${v.length > 160 ? v.slice(0, 157) + '…' : v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (depth > 1) return `[${v.length}]`;
    const items = v.slice(0, 4).map(x => fmtValue(x, depth + 1));
    return `[${items.join(', ')}${v.length > 4 ? `, +${v.length - 4}` : ''}]`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth > 1) return `{${keys.length}}`;
    const parts = keys.slice(0, 6).map(k => `${k}: ${fmtValue(v[k], depth + 1)}`);
    return `{${parts.join(', ')}${keys.length > 6 ? `, +${keys.length - 6}` : ''}}`;
  }
  return String(v);
}

export function fmtArgs(args) {
  if (!args || typeof args !== 'object') return args == null ? '' : String(args);
  return Object.keys(args).map(k => `${k}: ${fmtValue(args[k], 1)}`).join(', ');
}

// ---- badges and tags (spec §6 tones) ----
export function badge(text, tone = 'neutral', extra = '') {
  return `<span class="rl-badge rl-tone-${esc(tone)}" ${extra}>${esc(text)}</span>`;
}

export const sevTone = s => ({ critical: 'danger', high: 'warning', medium: 'neutral', low: 'neutral' }[String(s || '').toLowerCase()] || 'neutral');

const TAGS = {
  rule: ['Rule', 'info'],
  deterministic: ['Deterministic', 'info'],
  model: ['Model explanation', 'neutral'],
  template: ['Template', 'neutral'],
  synthetic: ['Synthetic', 'warning'],
  recorded: ['Recorded', 'accent'],
  stub: ['Stub', 'danger'],
};
export function tag(kind, label) {
  const [text, tone] = TAGS[kind] || [humanize(kind), 'neutral'];
  if (kind === 'model') return `<span class="rl-badge rl-tone-neutral"><span class="rl-badge-prefix">Model</span>${esc(label || 'explanation')}</span>`;
  return badge(label || text, tone);
}

export function sourceTag(source, what = 'explanation') {
  return source === 'model' ? tag('model', what) : tag('template');
}

export function svgIcon(name, size = 16) {
  const P = {
    'chevron-right': 'M9 18l6-6-6-6',
    'chevron-down': 'M6 9l6 6 6-6',
    'chevron-up': 'M18 15l-6-6-6 6',
    'external-link': 'M15 3h6v6 M10 14L21 3 M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    'shield-alert': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M12 8v4 M12 16h.01',
    'flask-conical': 'M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2 M8.5 2h7 M7 16h10',
    'play': 'M6 3l14 9-14 9V3z',
    'rotate-ccw': 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5',
    'git-compare': 'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M13 6h3a2 2 0 0 1 2 2v7 M11 18H8a2 2 0 0 1-2-2V9',
    'alert-triangle': 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
    'check-circle-2': 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M9 12l2 2 4-4',
    'circle-dashed': 'M10.1 2.18a9.93 9.93 0 0 1 3.8 0 M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7 M21.82 10.1a9.93 9.93 0 0 1 0 3.8 M20.29 17.6a9.95 9.95 0 0 1-2.7 2.69 M13.9 21.82a9.94 9.94 0 0 1-3.8 0 M6.4 20.29a9.95 9.95 0 0 1-2.69-2.7 M2.18 13.9a9.93 9.93 0 0 1 0-3.8 M3.71 6.4a9.95 9.95 0 0 1 2.7-2.69',
    'history': 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5 M12 7v5l4 2',
    'x': 'M18 6L6 18 M6 6l12 12',
    'upload': 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  };
  const d = P[name] || P['circle-dashed'];
  return `<svg class="rl-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d.split(' M').map((p, i) => `<path d="${i ? 'M' + p : p}"/>`).join('')}</svg>`;
}

// ---- HTTP (real API; keeps the status code so 404 can drive empty states) ----
export async function http(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  let r;
  try { r = await fetch(path, opts); } catch { const e = new Error('Server unreachable. Check that VARELQ is running.'); e.status = 0; throw e; }
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) {
    const e = new Error((data && data.error) || `Request failed (HTTP ${r.status})`);
    e.status = r.status;
    throw e;
  }
  return data;
}

// Hash parsing that does not depend on how the shell splits params.
export function hashParts() {
  const h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  const [path, q] = h.split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(q || '') };
}

// ---- step ordering ----
export function stepKey(id) {
  return String(id ?? '').split('.').map(x => Number.parseInt(x, 10) || 0);
}
export function cmpStep(a, b) {
  const x = stepKey(a), y = stepKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}
export function sortSteps(steps) {
  return [...(steps || [])].sort((a, b) => cmpStep(a.step_id, b.step_id));
}

// Flag occurrences in timeline order: [{step_id, flagIndex, flag}]
export function flagList(steps) {
  const out = [];
  for (const s of sortSteps(steps)) (s.flags || []).forEach((f, i) => out.push({ step_id: String(s.step_id), flagIndex: i, flag: f }));
  return out;
}

// Choose which flag to open first: exact step (+group) when given, else first flag of group, else first flag.
export function initialFlag(flags, { step, group } = {}) {
  if (!flags.length) return -1;
  let i = -1;
  if (step) i = flags.findIndex(f => f.step_id === String(step) && (!group || f.flag.group_id === group));
  if (i < 0 && step) i = flags.findIndex(f => f.step_id === String(step));
  if (i < 0 && group) i = flags.findIndex(f => f.flag.group_id === group);
  return i < 0 ? 0 : i;
}

// Policy text with the clause [start,end) marked; validated so a bad offset never breaks the text.
export function markPolicy(policy, clause) {
  const text = String(policy || '');
  if (!clause || !Number.isInteger(clause.start) || !Number.isInteger(clause.end) || clause.start < 0 || clause.end > text.length || clause.end <= clause.start) {
    return { html: esc(text), marked: false };
  }
  return {
    html: `${esc(text.slice(0, clause.start))}<mark class="rl-mark" id="rl-policy-mark">${esc(text.slice(clause.start, clause.end))}</mark>${esc(text.slice(clause.end))}`,
    marked: true,
  };
}

const ROLE = { system: 'System', user: 'User', assistant: 'Agent', tool_call: 'Tool call', tool_result: 'Tool result' };

function stepBody(s) {
  if (s.kind === 'tool_call') {
    return `<div class="rl-step-call"><span class="rl-mono rl-tool">${esc(s.name || 'tool')}</span><span class="rl-mono rl-args">(${esc(fmtArgs(s.args))})</span></div>`;
  }
  if (s.kind === 'system') {
    return `<div class="rl-step-text rl-muted">System prompt. The policy text is shown in the policy panel.</div>`;
  }
  const clamp = s.kind === 'tool_result' ? 'rl-clamp-2' : 'rl-clamp-3';
  const pre = s.kind === 'tool_result' && s.name ? `<span class="rl-mono rl-tool">${esc(s.name)}</span> ` : '';
  const content = s.content === null || s.content === undefined ? '' : (typeof s.content === 'string' ? s.content : fmtValue(s.content));
  const long = content.length > (s.kind === 'tool_result' ? 140 : 260);
  return `<div class="rl-step-text ${clamp}" data-clamp>${pre}${esc(content) || '<span class="rl-muted">(empty)</span>'}</div>${long ? `<button type="button" class="rl-link-btn" data-expand>Show more</button>` : ''}`;
}

// Renders the vertical step timeline. `active` = index into flagList(steps).
export function traceTimeline(steps, { activeFlag = -1 } = {}) {
  const sorted = sortSteps(steps);
  const flags = flagList(sorted);
  const activeStep = activeFlag >= 0 && flags[activeFlag] ? flags[activeFlag].step_id : null;
  let fi = 0;
  const rows = sorted.map(s => {
    const fl = s.flags || [];
    const sev = fl.length ? fl.reduce((best, f) => (sevRank(f.severity) > sevRank(best) ? f.severity : best), fl[0].severity) : null;
    const flagsHtml = fl.map(f => {
      const idx = fi++;
      return `<div class="rl-flag" data-flag-index="${idx}">
        ${badge(f.severity || 'Flag', sevTone(f.severity))}
        <span class="rl-flag-pattern">${esc(f.group_id ? f.group_id + ' · ' : '')}${esc(humanize(f.pattern_id))}</span>
        <div class="rl-flag-reason">${esc(f.reason || '')}</div>
      </div>`;
    }).join('');
    const isActive = activeStep !== null && String(s.step_id) === activeStep;
    return `<li class="rl-step rl-kind-${esc(s.kind)}${fl.length ? ` rl-flagged rl-sev-${esc(sevTone(sev))}` : ''}${isActive ? ' rl-active' : ''}" id="rl-step-${esc(String(s.step_id).replace(/\./g, '-'))}" data-step-id="${esc(s.step_id)}"${isActive ? ' aria-current="step"' : ''}>
      <div class="rl-step-meta"><span class="rl-mono rl-step-id">${esc(s.step_id)}</span><span class="rl-step-role">${esc(ROLE[s.kind] || humanize(s.role || s.kind))}</span></div>
      <div class="rl-step-main">${stepBody(s)}${flagsHtml}</div>
    </li>`;
  }).join('');
  return `<ol class="rl-timeline" aria-label="Trace steps">${rows}</ol>`;
}

function sevRank(s) { return { critical: 3, high: 2, medium: 1 }[String(s || '').toLowerCase()] || 0; }

// Wire "Show more" toggles inside a container.
export function wireExpanders(root) {
  const onClick = e => {
    const b = e.target.closest('[data-expand]');
    if (!b || !root.contains(b)) return;
    const box = b.previousElementSibling;
    if (!box) return;
    const open = box.classList.toggle('rl-unclamped');
    b.textContent = open ? 'Show less' : 'Show more';
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

export function scrollToEl(el) {
  if (!el) return;
  const reduce = document.documentElement.dataset.motion === 'off' || document.documentElement.dataset.motion === 'reduced'
    || (document.documentElement.dataset.motion !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
}
