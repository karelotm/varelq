// Documents: load a sample set or choose files, then analyze into a case.
import { esc, humanize, plural } from '../format.js';
import { icon } from '../icons.js';
import { panel } from '../components/panel.js';
import { tag } from '../components/tag.js';
import { errorState, retryButton, empty } from '../components/empty.js';
import { setBusy } from '../components/button.js';
import { rememberUploads } from '../state.js';

export const meta = { title: 'Documents', group: 'reconciliation' };

const ROLES = [
  { role: 'invoice', label: 'Invoice', required: true },
  { role: 'purchase_order', label: 'Purchase order', required: false },
  { role: 'receiving_record', label: 'Receiving record', required: false },
];
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.txt,.csv,application/pdf,image/png,image/jpeg,text/plain,text/csv';
const MAX_BYTES = 10 * 1024 * 1024;

// Chosen files survive re-renders within this tab (never persisted).
const chosen = { files: {}, sampleId: null, sampleFiles: {} };

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function validateFile(file) {
  if (!file) return 'No file chosen.';
  if (file.size > MAX_BYTES) return 'File is larger than 10 MB.';
  if (!/\.(pdf|png|jpe?g|txt|csv)$/i.test(file.name)) return 'Use PDF, PNG, JPG, TXT or CSV.';
  return null;
}

function zoneHtml({ role, label, required }) {
  const f = chosen.files[role];
  const fromSample = f && chosen.sampleFiles[role] === f;
  const inner = f
    ? `<div class="file-chosen">${icon('file-text', 16)}<span class="name truncate">${esc(f.name)}</span><span class="subtle text-xs nowrap">${esc(fileSize(f.size))}</span><span class="spacer"></span><button type="button" class="btn btn-ghost btn-sm" data-action="remove" data-role="${role}">Remove</button></div>${fromSample ? '<div class="subtle text-xs">From sample set</div>' : ''}`
    : `${icon('upload', 20)}<span>Choose ${esc(label.toLowerCase())} (PDF, PNG, JPG, TXT, CSV)</span><span class="subtle text-xs">or drop it here</span><input type="file" accept="${ACCEPT}" data-role="${role}" aria-label="Choose ${esc(label.toLowerCase())}">`;
  return `<div class="dz-field"><div class="dz-label">${esc(label)}${required ? '' : '<span class="subtle text-xs">Optional</span>'}</div><div class="dropzone${f ? ' chosen' : ''}" data-zone="${role}">${inner}</div><div class="dz-error" data-error="${role}" aria-live="polite"></div></div>`;
}

function samplesHtml(result) {
  if (!result.ok) {
    if (result.error.status === 503 || result.error.status === 404) return empty('Sample sets are unavailable on this server.');
    return errorState(result.error.message, retryButton());
  }
  const list = Array.isArray(result.value.samples) ? result.value.samples : [];
  if (!list.length) return empty('No sample sets on this server.');
  return `<div class="samples">${list.map((s) => {
    const roles = Object.keys(s.files || {});
    const prov = s.synthetic ? tag('synthetic') : tag('public');
    const lic = s.license && !s.synthetic ? `<span class="subtle text-xs">${esc(s.license)}</span>` : '';
    return `<div class="sample"><div class="row wrap"><h3 class="mono">${esc(s.title || s.id)}</h3>${prov}${result.value.stub ? tag('stub') : ''}</div>${s.description ? `<p class="muted text-sm">${esc(s.description)}</p>` : ''}<div class="sample-files">${roles.map((r) => `<span>${esc(humanize(r))} <span class="mono">${esc((s.files[r].path || '').split('/').pop())}</span></span>`).join('')}</div><div class="row">${lic}<span class="spacer"></span><button type="button" class="btn btn-secondary btn-sm" data-action="load-sample" data-sample="${esc(s.id)}">Load sample</button></div></div>`;
  }).join('')}</div>`;
}

let samplesCache = null;

export async function render(ctx) {
  let samples;
  try { samples = { ok: true, value: await ctx.api.get('/api/samples') }; } catch (error) { samples = { ok: false, error }; }
  samplesCache = samples.ok ? samples.value : null;
  const ready = !!chosen.files.invoice;
  return `
<div class="page-head">
  <div class="titles"><h1>Documents</h1><div class="meta">Three-way match: invoice against purchase order and receiving record. Every difference cites the document line it came from.</div></div>
</div>
${panel({ title: 'Sample sets', flush: true, body: samplesHtml(samples) })}
${panel({ title: 'Files', id: 'files-panel', body: `<div class="dropzones" id="zones">${ROLES.map(zoneHtml).join('')}</div>`,
    footer: `<div class="row wrap" id="analyze-row"><button type="button" class="btn btn-primary" data-action="analyze" id="analyze-btn"${ready ? '' : ' disabled'}>${icon('play', 16)}<span class="btn-label">Analyze</span></button><div class="stages" id="stages" aria-live="polite">${ready ? '' : '<span>Choose an invoice to start.</span>'}</div></div>` })}`;
}

function rerenderZones(root) {
  const zones = root.querySelector('#zones');
  if (zones) zones.innerHTML = ROLES.map(zoneHtml).join('');
  const btn = root.querySelector('#analyze-btn');
  if (btn && !btn.hasAttribute('aria-busy')) btn.disabled = !chosen.files.invoice;
  const stages = root.querySelector('#stages');
  if (stages && !btn?.hasAttribute('aria-busy')) stages.innerHTML = chosen.files.invoice ? '' : '<span>Choose an invoice to start.</span>';
}

function setFile(root, role, file) {
  const errEl = root.querySelector(`[data-error="${role}"]`);
  const problem = validateFile(file);
  const zone = root.querySelector(`[data-zone="${role}"]`);
  if (problem) {
    if (errEl) errEl.textContent = problem;
    if (zone) zone.classList.add('error');
    return;
  }
  chosen.files[role] = file;
  rerenderZones(root);
}

export function mount(root, ctx) {
  let timer = null;

  async function loadSample(id, btn) {
    const s = samplesCache && samplesCache.samples.find((x) => x.id === id);
    if (!s) return;
    setBusy(btn, true);
    try {
      const files = {};
      for (const [role, meta] of Object.entries(s.files || {})) {
        const blob = await ctx.api.blob(meta.url);
        const name = (meta.path || `${role}`).split('/').pop();
        files[role] = new File([blob], name, { type: meta.content_type || blob.type });
      }
      chosen.files = { ...files };
      chosen.sampleFiles = { ...files };
      chosen.sampleId = s.id;
      rerenderZones(root);
      ctx.toast(`Loaded ${s.title || s.id}. Run Analyze to create the case.`, 'info');
      root.querySelector('#analyze-btn')?.focus();
    } catch (e) {
      ctx.toast(e.message, 'danger');
    } finally {
      setBusy(btn, false);
    }
  }

  async function analyze(btn) {
    if (!chosen.files.invoice) return;
    const stages = root.querySelector('#stages');
    const fd = new FormData();
    const blobs = {};
    for (const { role } of ROLES) {
      const f = chosen.files[role];
      if (!f) continue;
      fd.append(role, f, f.name);
      if (/^image\//.test(f.type) || /\.(png|jpe?g)$/i.test(f.name)) blobs[role] = { url: URL.createObjectURL(f), type: f.type || 'image/png', name: f.name };
    }
    const anyFromSample = chosen.sampleId && ROLES.some(({ role }) => chosen.files[role] && chosen.sampleFiles[role] === chosen.files[role]);
    if (anyFromSample) fd.append('sample_id', chosen.sampleId);
    setBusy(btn, true);
    const started = Date.now();
    const draw = () => {
      const s = Math.floor((Date.now() - started) / 1000);
      if (stages) stages.innerHTML = `<span class="on">Reading documents</span>${icon('chevron-right', 14)}<span class="on">Extracting with Nemotron</span>${icon('chevron-right', 14)}<span class="on">Checking</span><span class="subtle tabular">${s} s</span>`;
    };
    draw();
    timer = setInterval(draw, 1000);
    try {
      const run = await ctx.api.form('/api/documents/analyze', fd);
      clearInterval(timer); timer = null;
      if (!run || !run.id) throw new Error('The server returned no case id.');
      rememberUploads(run.id, blobs);
      chosen.files = {}; chosen.sampleFiles = {}; chosen.sampleId = null;
      ctx.toast(`Case created: ${plural(Array.isArray(run.findings) ? run.findings.length : 0, 'difference', 'differences')}.`, 'success');
      ctx.navigate(`#cases/${encodeURIComponent(run.id)}`);
    } catch (e) {
      clearInterval(timer); timer = null;
      setBusy(btn, false);
      if (stages) stages.innerHTML = `<span class="inline-error">${icon('alert-triangle', 16)}<span>${esc(e.message)}</span></span>`;
    }
  }

  const onClick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    if (a === 'retry') ctx.refresh();
    else if (a === 'load-sample') loadSample(el.dataset.sample, el);
    else if (a === 'remove') {
      delete chosen.files[el.dataset.role];
      rerenderZones(root);
      root.querySelector(`[data-zone="${el.dataset.role}"] input`)?.focus();
    } else if (a === 'analyze') analyze(el);
  };
  const onChange = (e) => {
    const input = e.target.closest('input[type=file][data-role]');
    if (input && input.files && input.files[0]) setFile(root, input.dataset.role, input.files[0]);
  };
  const onDragOver = (e) => {
    const zone = e.target.closest('.dropzone');
    if (!zone) return;
    e.preventDefault();
    zone.classList.add('dragover');
  };
  const onDragLeave = (e) => {
    const zone = e.target.closest('.dropzone');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('dragover');
  };
  const onDrop = (e) => {
    const zone = e.target.closest('.dropzone');
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) setFile(root, zone.dataset.zone, file);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);
  return () => {
    if (timer) clearInterval(timer);
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('dragover', onDragOver);
    root.removeEventListener('dragleave', onDragLeave);
    root.removeEventListener('drop', onDrop);
  };
}
