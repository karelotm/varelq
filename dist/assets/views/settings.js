// Settings: appearance (live, persisted), NVIDIA and GPU facts, data and privacy.
import { esc, num, ms, hhmm, relTime, humanize, dateTime } from '../format.js';
import { panel } from '../components/panel.js';
import { segmented } from '../components/segmented.js';
import { table } from '../components/table.js';
import { badge } from '../components/badge.js';
import { tag } from '../components/tag.js';
import { errorState, empty } from '../components/empty.js';
import { prefs, setPref, clearPrefs } from '../state.js';

export const meta = { title: 'Settings', group: 'settings' };

function appearance() {
  const row = (label, hint, control) => `<div class="setting"><div><div class="label">${esc(label)}</div><div class="hint">${esc(hint)}</div></div><div>${control}</div></div>`;
  return [
    row('Theme', 'System follows your operating system.', segmented({ name: 'theme', label: 'Theme', value: prefs.theme, options: [
      { value: 'system', label: 'System', icon: 'monitor' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }] })),
    row('Density', 'Compact fits more table rows on screen.', segmented({ name: 'density', label: 'Density', value: prefs.density, options: [
      { value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }] })),
    row('Motion', 'Reduced keeps short fades only. Off removes all animation.', segmented({ name: 'motion', label: 'Motion', value: prefs.motion, options: [
      { value: 'system', label: 'System' }, { value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }, { value: 'off', label: 'Off' }] })),
  ].join('');
}

function modelsTable(h) {
  if (!h) return errorState('Server health is unavailable.');
  const ocr = h.ocr || {};
  const hosted = 'integrate.api.nvidia.com (hosted)';
  const rows = [
    { role: 'Explanations and extraction', model: h.model, endpoint: hosted },
    { role: 'Guard lab agent', model: h.agent_model, endpoint: hosted },
    { role: 'Embeddings', model: h.embed_model, endpoint: hosted },
    { role: 'OCR', model: ocr.model, endpoint: ocr.mode === 'self-hosted' ? `${ocr.label || 'NIM'} (self-hosted)` : (/hosted/i.test(ocr.label || '') ? ocr.label : `${ocr.label || 'NVIDIA'} (hosted)`) },
  ].filter((r) => r.model);
  return table({
    ariaLabel: 'Models',
    columns: [
      { key: 'role', label: 'Role' },
      { key: 'model', label: 'Model', mono: true },
      { key: 'endpoint', label: 'Endpoint' },
    ],
    rows,
  });
}

function gpuBody(h, g, gErr) {
  const parts = [];
  const ocr = (g && g.ocr) || (h && h.ocr) || null;
  const kv = [];
  if (ocr) {
    kv.push(['OCR mode', esc(humanize(ocr.mode || 'hosted'))]);
    kv.push(['OCR label', esc(ocr.label || '—')]);
    let ready;
    if (ocr.ready === true) ready = badge('Ready', 'success');
    else if (ocr.ready === false) ready = badge('Not ready', 'danger');
    else ready = `<span class="muted">Not probed${ocr.mode === 'hosted' ? ' (hosted endpoint)' : ''}</span>`;
    kv.push(['Readiness', `${ready}${ocr.checked_at ? ` <span class="subtle text-xs">checked ${esc(relTime(ocr.checked_at))}</span>` : ''}`]);
    const fb = ocr.fallback || (h && h.ocr && h.ocr.fallback);
    kv.push(['Fallback', esc(fb ? humanize(fb) : 'None configured')]);
  }
  if (g && g.gpu) {
    const gp = g.gpu;
    kv.push(['GPU', `${esc(gp.name || '—')}${gp.driver ? ` <span class="subtle text-xs">driver ${esc(gp.driver)}</span>` : ''}`]);
    if (gp.memory_total_mib) kv.push(['GPU memory', `<span class="tabular">${esc(num(gp.memory_used_mib))} / ${esc(num(gp.memory_total_mib))} MiB</span>`]);
    kv.push(['Source', `${esc(gp.source || 'nvidia-smi capture')} ${gp.captured_at ? badge(`Captured at ${hhmm(gp.captured_at)}`, 'neutral', { title: dateTime(gp.captured_at) }) : ''}`]);
  } else if (g) {
    kv.push(['GPU', '<span class="muted">No GPU capture on this server</span>']);
  }
  if (gErr) kv.push(['GPU status', `<span class="muted">${esc(gErr.status === 503 ? 'GPU module unavailable' : gErr.message)}</span>`]);
  parts.push(`<div class="pad bordered"><dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl></div>`);

  const recent = g && Array.isArray(g.recent) ? g.recent.slice(0, 8) : []; // newest first
  parts.push(`<div class="sub-head">Last OCR calls</div>`);
  parts.push(recent.length
    ? table({
      ariaLabel: 'Last OCR calls',
      columns: [
        { key: 'at', label: 'Time', render: (r) => `<span class="tabular">${esc(hhmm(r.at))}</span>` },
        { key: 'endpoint_kind', label: 'Endpoint', render: (r) => esc(humanize(r.endpoint_kind)) },
        { key: 'latency_ms', label: 'Latency', align: 'right', render: (r) => `<span class="tabular">${esc(ms(r.latency_ms))}</span>` },
        { key: 'fallback_used', label: 'Fallback', render: (r) => (r.fallback_used ? badge('Used', 'warning') : '<span class="subtle">No</span>') },
      ],
      rows: recent,
    })
    : empty('No OCR calls since the server started.'));
  return parts.join('');
}

export async function render(ctx) {
  let h = null; let g = null; let gErr = null;
  try { h = await ctx.health(); } catch { h = null; }
  try { g = await ctx.gpu(true); } catch (e) { gErr = e; }

  const privacy = `<ul class="plain-list">
    <li>Analyses, cases and decisions are stored in a local SQLite file on this machine. Uploaded files are processed in memory and not stored.</li>
    <li>Datasets: τ-bench retail trajectories (Sierra, MIT) via Microsoft AgentRx (MIT); SROIE receipt sample; synthetic procurement documents. Fonts: IBM Plex (OFL). Icons: Lucide (ISC).</li>
    <li>This browser stores only your appearance preferences. <button type="button" class="btn btn-ghost btn-sm" data-action="clear-prefs">Clear local preferences</button></li>
  </ul>`;

  return `
<div class="page-head"><div class="titles"><h1>Settings</h1></div></div>
${panel({ title: 'Appearance', flush: true, body: appearance() })}
${panel({ title: 'NVIDIA and GPU', flush: true, headExtra: h && h.stubs ? tag('stub') : '', body: `${modelsTable(h)}${gpuBody(h, g, gErr)}` })}
${panel({ title: 'Data and privacy', body: privacy })}`;
}

export function mount(root, ctx) {
  const onChange = (e) => {
    const input = e.target;
    if (input.matches('input[type=radio][name]') && ['theme', 'density', 'motion'].includes(input.name)) {
      setPref(input.name, input.value);
    }
  };
  const onClick = (e) => {
    if (e.target.closest('[data-action="clear-prefs"]')) {
      clearPrefs();
      ctx.toast('Local preferences cleared.', 'success');
      ctx.refresh();
    }
  };
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  return () => { root.removeEventListener('change', onChange); root.removeEventListener('click', onClick); };
}
