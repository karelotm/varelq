// VARELQ · Stream A2 · Baseline vs guarded span diff for the guard lab.
// Pairs runs by index (never "same seed" / "replay") and aligns two anchors:
// the first guard span, and the final outcome.
import { esc, num, ms, humanize, fmtValue, fmtArgs, badge, svgIcon } from './trace-timeline.js';

const KIND = { user: 'User', llm: 'LLM', tool: 'Tool', guard: 'Guard', assistant: 'Agent' };
const bySeq = spans => [...(spans || [])].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));

// Pure: returns rows [{type:'span'|'anchor'|'final', left, right, differs}]
export function alignSpans(baseSpans, guardSpans) {
  const L = bySeq(baseSpans), R = bySeq(guardSpans);
  const gi = R.findIndex(s => s.kind === 'guard');
  let li = -1;
  if (gi >= 0) {
    const tool = (R[gi].input && (R[gi].input.tool || R[gi].input.name)) || null;
    if (tool) li = L.findIndex(s => s.kind === 'tool' && s.name === tool);
  }
  const rows = [];
  const pair = (a, b) => {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) rows.push({ type: 'span', left: a[i] || null, right: b[i] || null, differs: differs(a[i], b[i]) });
  };
  if (gi < 0) {
    pair(L, R);
  } else {
    const lPre = li >= 0 ? L.slice(0, li) : L.slice();
    const lPost = li >= 0 ? L.slice(li + 1) : [];
    pair(lPre, R.slice(0, gi));
    rows.push({ type: 'anchor', left: li >= 0 ? L[li] : null, right: R[gi], differs: true });
    pair(lPost, R.slice(gi + 1));
  }
  rows.push({ type: 'final', left: null, right: null, differs: false });
  return rows;
}

function differs(a, b) {
  if (!a || !b) return !!(a || b);
  return a.kind !== b.kind || a.name !== b.name || a.status !== b.status;
}

function statusBadge(s) {
  if (s.status === 'blocked') return badge('Blocked at dispatch', 'danger');
  if (s.status === 'error') return badge('Error', 'danger');
  return '';
}

function payload(s) {
  const bits = [];
  if (s.kind === 'llm' && s.output && typeof s.output === 'object') {
    const o = s.output;
    if (o.action) bits.push(`<div class="rl-mono rl-occ-call"><span class="rl-tool">${esc(o.action)}</span>(${esc(fmtArgs(o.args))})</div>`);
    if (o.thought) bits.push(`<div class="rl-span-text rl-clamp-2">${esc(o.thought)}</div>`);
    if (o.answer) bits.push(`<div class="rl-span-text rl-clamp-2">${esc(o.answer)}</div>`);
    if (!bits.length) bits.push(`<div class="rl-mono rl-span-text rl-clamp-2">${esc(fmtValue(o))}</div>`);
    return bits.join('');
  }
  if (s.kind === 'tool') {
    bits.push(`<div class="rl-mono rl-occ-call"><span class="rl-tool">${esc(s.name)}</span>(${esc(fmtArgs(s.input))})</div>`);
  } else if (s.input && s.kind !== 'guard') {
    const t = typeof s.input === 'object' && s.input.text ? s.input.text : fmtValue(s.input);
    bits.push(`<div class="rl-span-text rl-clamp-2">${esc(t)}</div>`);
  }
  if (s.error) bits.push(`<div class="rl-span-err">${esc(s.error)}</div>`);
  else if (s.output !== null && s.output !== undefined && s.kind !== 'guard') {
    const t = typeof s.output === 'string' ? s.output : (s.output.text || s.output.message || fmtValue(s.output));
    bits.push(`<div class="rl-span-text rl-muted rl-clamp-2">${esc(t)}</div>`);
  }
  return bits.join('');
}

// Guard lifecycle, only the stages the recorded span/run actually shows.
export function guardLifecycle(span, run) {
  if (!span || span.kind !== 'guard') return [];
  const out = [];
  const tool = span.input && span.input.tool;
  out.push({ label: tool ? `Checked before ${tool}` : 'Checked at dispatch', tone: 'neutral' });
  if (span.status === 'blocked') out.push({ label: 'Blocked at dispatch', tone: 'danger' });
  else out.push({ label: 'Allowed', tone: 'success' });
  const msg = span.output && span.output.message;
  if (msg) out.push({ label: 'Message returned to agent', tone: 'neutral' });
  const esc2 = (span.output && span.output.escalated_to_human) || (span.status === 'blocked' && run && run.escalated_to_human);
  if (esc2) out.push({ label: 'Escalated to a human', tone: 'info' });
  return out;
}

function spanCell(s, side, run) {
  if (!s) return `<div class="rl-span rl-span--gap" aria-hidden="true"></div>`;
  const guard = s.kind === 'guard';
  const life = guard ? guardLifecycle(s, run) : [];
  return `<div class="rl-span rl-span--${esc(s.kind)}${s.status === 'blocked' ? ' rl-span--blocked' : ''}${s.status === 'error' ? ' rl-span--error' : ''}">
    <div class="rl-span-head"><span class="rl-side-label">${side}</span><span class="rl-mono rl-muted">#${esc(s.seq)}</span><span class="rl-span-kind">${esc(KIND[s.kind] || humanize(s.kind))}</span>
      ${s.kind !== 'tool' ? `<span class="rl-mono rl-span-name">${esc(s.name || '')}</span>` : ''}${statusBadge(s)}<span class="rl-mono rl-muted rl-span-ms">${esc(ms(s.ms))}</span></div>
    ${payload(s)}
    ${guard && s.output && s.output.message ? `<div class="rl-span-text">${esc(s.output.message)}</div>` : ''}
    ${life.length ? `<ol class="rl-lifecycle" aria-label="Guard lifecycle">${life.map(x => `<li>${badge(x.label, x.tone)}</li>`).join(`<li aria-hidden="true" class="rl-life-sep">${svgIcon('chevron-right', 14)}</li>`)}</ol>` : ''}
  </div>`;
}

function outcomeCell(trace, run, side) {
  const unsafe = run && run.unsafe;
  const tone = unsafe ? 'danger' : run && run.false_block ? 'warning' : run && run.legit_approval ? 'success' : 'neutral';
  const label = unsafe ? 'Unsafe' : run && run.false_block ? 'False block' : run && run.legit_approval ? 'Legitimate approval' : humanize((run && run.status) || (trace && trace.status) || '');
  const outcome = (run && run.outcome) || (trace && trace.outcome);
  const answer = (trace && trace.final_answer) || (run && run.final_answer) || '';
  return `<div class="rl-span rl-span--final">
    <div class="rl-span-head"><span class="rl-side-label">${side}</span><span class="rl-span-kind">Final outcome</span>${label ? badge(label, tone) : ''}</div>
    <div class="rl-span-outcome">${esc(humanize(outcome || 'unknown'))}</div>
    ${answer ? `<div class="rl-span-text rl-clamp-3">${esc(answer)}</div>` : ''}
  </div>`;
}

// base/guard: {trace, run}
export function diffView(base, guard, { index } = {}) {
  const rows = alignSpans(base.trace && base.trace.spans, guard.trace && guard.trace.spans);
  const body = rows.map(r => {
    if (r.type === 'final') {
      return `<div class="rl-diff-anchor-label">Anchor · final outcome</div>
        <div class="rl-diff-row rl-diff-row--anchor">${outcomeCell(base.trace, base.run, 'Baseline')}${outcomeCell(guard.trace, guard.run, 'Guarded')}</div>`;
    }
    if (r.type === 'anchor') {
      return `<div class="rl-diff-anchor-label">Anchor · first guard span</div>
        <div class="rl-diff-row rl-diff-row--anchor">${r.left ? spanCell(r.left, 'Baseline', base.run) : `<div class="rl-span rl-span--gap"><span class="rl-muted">No matching call in baseline</span></div>`}${spanCell(r.right, 'Guarded', guard.run)}</div>`;
    }
    return `<div class="rl-diff-row${r.differs ? ' rl-diff-row--differs' : ''}">${spanCell(r.left, 'Baseline', base.run)}${spanCell(r.right, 'Guarded', guard.run)}</div>`;
  }).join('');
  return `<div class="rl-diff" aria-label="Span comparison, run ${num(index)} paired by index">
    <div class="rl-diff-row rl-diff-cols" aria-hidden="true"><div class="rl-label">Baseline · <span class="rl-mono">${esc(base.trace ? base.trace.trace_id : '')}</span></div><div class="rl-label">Guarded · <span class="rl-mono">${esc(guard.trace ? guard.trace.trace_id : '')}</span></div></div>
    ${body}
  </div>`;
}
