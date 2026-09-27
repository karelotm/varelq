// Top-bar bell with an unread dot. The panel lists real events derived from this server's data:
// GET /api/runs, /api/lab/batches, /api/gpu/status and /api/usage (each optional; failures are tolerated).
// Seen ids are kept in localStorage (varelq.notifications.seen). Polls every 30 s while the page is visible.
import { api } from '../api.js';
import { esc, relTime } from '../format.js';
import { t } from '../i18n.js';
import { icon, openPopover } from './usermenu.js';

const SEEN_KEY = 'varelq.notifications.seen';
const POLL_MS = 30000;
const MAX_ITEMS = 25;

function readSeen() {
  try {
    const arr = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}
let memorySeen = readSeen();
function writeSeen(ids) {
  memorySeen = new Set([...memorySeen, ...ids]);
  const arr = [...memorySeen].slice(-500);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(arr)); } catch { /* session only */ }
}

const soft = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

/** Pure: derive notification items from raw API payloads (any may be null). Newest first. */
export function deriveEvents({ runs, batches, gpu, usage }) {
  const out = [];
  for (const r of (runs && runs.runs) || []) {
    if (!r || !r.id) continue;
    const isDoc = r.kind === 'documents';
    const label = isDoc ? [r.supplier, r.invoice_reference].filter(Boolean).join(' · ') || 'Document run' : (r.source_label || r.dataset || 'Reliability analysis');
    if (r.status && r.status !== 'success') {
      out.push({ id: `failed:${r.id}`, tone: 'danger', icon: 'alert-triangle', title: t('bell.failed'), detail: `${label}${r.error ? ` — ${r.error}` : ''}`, href: isDoc ? `#cases/${r.id}` : '#reliability', at: r.created });
    } else if (isDoc && (r.decision === 'pending' || r.decision == null)) {
      out.push({ id: `review:${r.id}`, tone: 'warning', icon: 'file-text', title: t('bell.pending'), detail: label, href: `#cases/${r.id}`, at: r.created });
    } else if (r.kind === 'reliability') {
      const groups = Array.isArray(r.groups) ? r.groups.length : null;
      out.push({ id: `report:${r.id}`, tone: 'success', icon: 'shield-alert', title: t('bell.report'), detail: `${label}${groups != null ? ` · ${groups} failure group${groups === 1 ? '' : 's'}` : ''}`, href: '#reliability', at: r.created });
    }
  }
  for (const b of (batches && batches.batches) || []) {
    const s = (b && b.summary) || {};
    if (b && b.batch_id && Number(s.unsafe) > 0) {
      out.push({ id: `unsafe:${b.batch_id}`, tone: 'danger', icon: 'flask-conical', title: t('bell.unsafe'), detail: `${b.scenario_id || b.batch_id} · ${b.variant || ''} · ${s.unsafe} of ${s.runs ?? '?'} runs unsafe`, href: '#lab', at: b.created });
    }
  }
  const models = usage && usage.nvidia && usage.nvidia.models;
  if (models && typeof models === 'object') {
    for (const [name, m] of Object.entries(models)) {
      const n = Number(m && m.fallback_served) || 0;
      if (n > 0) out.push({ id: `fallback:${name}:${n}`, tone: 'warning', icon: 'cpu', title: t('bell.fallback'), detail: `${name} served ${n} request${n === 1 ? '' : 's'} as fallback`, href: '#settings/usage', at: usage.nvidia.since || null });
    }
  }
  const recent = [
    ...((gpu && Array.isArray(gpu.recent)) ? gpu.recent : []),
    ...((usage && usage.ocr && Array.isArray(usage.ocr.recent)) ? usage.ocr.recent : []),
  ].filter((x) => x && x.fallback_used);
  if (recent.length) {
    const latest = recent.reduce((a, b) => (String(b.at || '') > String(a.at || '') ? b : a));
    const count = new Set(recent.map((x) => x.at)).size;
    out.push({ id: `ocrfb:${latest.at || 'recent'}`, tone: 'warning', icon: 'file-text', title: t('bell.ocrfb'), detail: `${count} recent OCR call${count === 1 ? '' : 's'} used the hosted endpoint`, href: '#settings/gpu', at: latest.at || null });
  }
  out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return out.slice(0, MAX_ITEMS);
}

async function load() {
  const [runs, batches, gpu, usage] = await Promise.all([
    soft(api.get('/api/runs')), soft(api.get('/api/lab/batches')), soft(api.get('/api/gpu/status')), soft(api.get('/api/usage')),
  ]);
  // /api/usage may not exist on older servers (404): that is not a read failure worth flagging.
  const partial = !runs.ok || !batches.ok || (!gpu.ok && gpu.e && gpu.e.status !== 404) || (!usage.ok && usage.e && usage.e.status !== 404);
  return { items: deriveEvents({ runs: runs.ok ? runs.v : null, batches: batches.ok ? batches.v : null, gpu: gpu.ok ? gpu.v : null, usage: usage.ok ? usage.v : null }), partial };
}

function panelHtml(state) {
  const unread = state.items.filter((i) => !memorySeen.has(i.id)).length;
  const list = state.items.length
    ? `<ul class="xnotif-list" role="list">${state.items.map((i) => {
      const isNew = !memorySeen.has(i.id);
      return `<li><a class="xnotif-item${isNew ? ' is-unread' : ''}" href="${esc(i.href)}" data-menu-nav data-nid="${esc(i.id)}">
        <span class="xnotif-icon xnotif-${i.tone}" aria-hidden="true">${icon(i.icon, 15)}</span>
        <span class="xnotif-text"><strong>${esc(i.title)}</strong><span class="xnotif-detail">${esc(i.detail)}</span>${i.at ? `<small>${esc(relTime(i.at))}</small>` : ''}</span>
        ${isNew ? '<span class="dot dot-ok xnotif-new" aria-label="Unread"></span>' : ''}
      </a></li>`;
    }).join('')}</ul>`
    : `<p class="xnotif-empty">${esc(t('bell.empty'))}</p>`;
  return `<div class="xnotif-head"><strong>${esc(t('bell.label'))}</strong>
      <button type="button" class="btn btn-ghost btn-sm" data-act="markall"${unread ? '' : ' disabled'} data-menu-nav>${esc(t('bell.markall'))}</button></div>
    ${list}
    <p class="xpop-caption">${esc(state.partial ? t('bell.unavailable') : t('bell.caption'))}</p>`;
}

/** mountBell(el, ctx): renders the bell into el and starts polling; returns cleanup. */
export function mountBell(el, ctx) {
  if (!el) return () => {};
  const state = { items: [], partial: false, loaded: false };
  let pop = null;
  let timer = null;
  let alive = true;

  const unreadCount = () => state.items.filter((i) => !memorySeen.has(i.id)).length;
  function renderButton() {
    const n = unreadCount();
    const label = n ? `${t('bell.label')} (${n} ${t('bell.unread')})` : t('bell.label');
    const btn = el.querySelector('.xbell');
    if (!btn) {
      el.innerHTML = `<button type="button" class="btn btn-icon xbell" aria-haspopup="dialog" aria-expanded="false">${icon('bell', 18)}<span class="xbell-dot" hidden></span></button>`;
      return renderButton();
    }
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.querySelector('.xbell-dot').hidden = n === 0;
  }
  function renderPanel() {
    if (!pop) return;
    const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.nid : null;
    pop.el.innerHTML = panelHtml(state);
    if (focusedId) pop.el.querySelector(`[data-nid="${CSS.escape(focusedId)}"]`)?.focus();
  }
  async function refresh() {
    if (!alive) return;
    try {
      const r = await load();
      if (!alive) return;
      state.items = r.items; state.partial = r.partial; state.loaded = true;
      renderButton();
      renderPanel();
    } catch { /* keep previous state */ }
  }
  function open() {
    const anchor = el.querySelector('.xbell');
    pop = openPopover({
      anchor, html: panelHtml(state), placement: 'below-end', className: 'xpop-free xnotif', label: t('bell.label'), role: 'dialog',
      onClose: () => { pop = null; },
      onOpen: (root) => { (root.querySelector('.xnotif-item') || root.querySelector('button') || root).focus(); },
    });
    pop.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="markall"]')) {
        writeSeen(state.items.map((i) => i.id));
        renderButton(); renderPanel();
        pop.el.querySelector('.xnotif-item')?.focus();
        return;
      }
      const a = e.target.closest('.xnotif-item');
      if (a) { writeSeen([a.dataset.nid]); renderButton(); pop.close(false); }
    });
    if (!state.loaded) refresh();
  }
  const onClick = (e) => {
    if (!e.target.closest('.xbell')) return;
    if (pop) pop.close(true); else open();
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { if (!document.hidden) refresh(); schedule(); }, POLL_MS); };
  const onVisible = () => { if (!document.hidden) refresh(); };
  const onLang = () => { renderButton(); refresh(); };

  renderButton();
  el.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('varelq:lang', onLang);
  refresh();
  schedule();
  return () => {
    alive = false;
    clearTimeout(timer);
    if (pop) pop.close(false);
    el.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('varelq:lang', onLang);
  };
}
