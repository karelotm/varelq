// First-visit guided tour: dims the page, cuts out the target element with a soft ring and shows a small
// card next to it. Auto-starts once (localStorage varelq.tour = 'done' | 'skipped'); restart with startTour(),
// window event 'varelq:tour', the account menu or the Ctrl+K palette.
// Suppress auto-start with ?tour=0 (page URL or hash query) or localStorage varelq.tour.suppress = '1'; ?tour=1 forces it.
import { esc } from '../format.js';
import { t } from '../i18n.js';
import { motionReduced } from '../state.js';

const KEY = 'varelq.tour';
const SUPPRESS_KEY = 'varelq.tour.suppress';
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');

/* Each step: target selector (null = centered), i18n keys, preferred side. */
const STEPS = [
  { id: 'welcome', sel: null },
  { id: 'nav', sel: '#nav', side: 'right' },
  { id: 'documents', sel: '.nav-item[data-nav="documents"]', side: 'right' },
  { id: 'reliability', sel: '.nav-item[data-nav="reliability"]', side: 'right' },
  { id: 'lab', sel: '.nav-item[data-nav="lab"]', side: 'right' },
  { id: 'chat', sel: '.nav-item[data-nav="chat"]', side: 'right' },
  { id: 'search', sel: '.side-search', side: 'right' },
  { id: 'bell', sel: '#bell .xbell, #bell', side: 'below' },
  { id: 'account', sel: '#user-menu', side: 'right' },
];

const EN = {
  'tour.label': 'Product tour', 'tour.step': 'Step {n} of {total}', 'tour.back': 'Back', 'tour.next': 'Next',
  'tour.skip': 'Skip tour', 'tour.finish': 'Start exploring',
};

let state = null; // { root, hole, card, index, restoreFocus, cleanup }
let autoTried = false;

function tx(key) { return t(key, EN[key] || key); }

function readFlag(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeFlag(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } }

function tourParam() {
  try {
    const s = new URLSearchParams(location.search).get('tour');
    if (s !== null) return s;
    const h = location.hash || '';
    const qi = h.indexOf('?');
    if (qi >= 0) return new URLSearchParams(h.slice(qi + 1)).get('tour');
  } catch { /* ignore */ }
  return null;
}

const narrow = () => window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
const drawerMode = () => window.matchMedia && window.matchMedia('(max-width: 960px)').matches;

/** On phones the sidebar is a drawer: open it for steps whose target lives in it, close it otherwise. */
function inSidebar(step) {
  if (!step.sel) return false;
  const el = document.querySelector(step.sel);
  const sb = document.getElementById('sidebar');
  return !!(el && sb && sb.contains(el));
}
function syncDrawer(step) {
  if (!drawerMode()) return false;
  const want = inSidebar(step);
  const open = document.body.classList.contains('nav-open');
  if (want === open) return false;
  const btn = want ? document.querySelector('.menu-btn') : document.querySelector('.scrim[data-action="close-nav"]');
  if (!btn) return false;
  btn.click();
  if (want && state) state.openedDrawer = true;
  return true;
}

/** The step's element if it is actually visible to the user, else null. */
function targetFor(step) {
  if (!step.sel) return null;
  const el = document.querySelector(step.sel);
  if (!el || !el.isConnected) return null;
  const sb = document.getElementById('sidebar');
  if (sb && sb.contains(el) && drawerMode() && !document.body.classList.contains('nav-open')) return null;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  // Mostly off screen (for example a drawer still sliding in): treat as hidden for now.
  const vw = document.documentElement.clientWidth;
  if (r.right < 8 || r.left > vw - 8 || r.left < -r.width / 2) return null;
  return el;
}

function stepText(step, i) {
  let body = tx(`tour.${step.id}.body`);
  if (step.id === 'search') body = body.replace('{key}', IS_MAC ? '⌘K' : 'Ctrl+K');
  return {
    title: tx(`tour.${step.id}.title`),
    body,
    count: tx('tour.step').replace('{n}', String(i + 1)).replace('{total}', String(STEPS.length)),
  };
}

function render() {
  const { card, index } = state;
  const step = STEPS[index];
  const txt = stepText(step, index);
  const last = index === STEPS.length - 1;
  card.innerHTML = `
    <p class="tour-count" id="tour-count" aria-live="polite">${esc(txt.count)}</p>
    <h2 class="tour-title" id="tour-title">${esc(txt.title)}</h2>
    <p class="tour-body" id="tour-body">${esc(txt.body)}</p>
    <div class="tour-foot">
      <button type="button" class="tour-skip" data-tour="skip">${esc(tx('tour.skip'))}</button>
      <span class="tour-actions">
        ${index > 0 ? `<button type="button" class="btn btn-ghost btn-sm" data-tour="back">${esc(tx('tour.back'))}</button>` : ''}
        <button type="button" class="btn btn-primary btn-sm" data-tour="next">${esc(last ? tx('tour.finish') : tx('tour.next'))}</button>
      </span>
    </div>`;
  card.dataset.step = step.id;
  if (syncDrawer(step)) setTimeout(() => { if (state) place(); }, 320);
  const el = targetFor(step);
  if (el) { try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ } }
  place();
  const next = card.querySelector('[data-tour="next"]');
  if (next) next.focus({ preventScroll: true });
}

/** Position the spotlight hole and the card for the current step. */
function place() {
  if (!state) return;
  const { root, hole, card } = state;
  const step = STEPS[state.index];
  const el = targetFor(step);
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const sheet = narrow();
  root.classList.toggle('tour-sheet', sheet);
  root.classList.toggle('tour-has-target', !!el);

  if (el) {
    const r = el.getBoundingClientRect();
    const p = 4;
    hole.hidden = false;
    hole.style.left = `${Math.round(r.left - p)}px`;
    hole.style.top = `${Math.round(r.top - p)}px`;
    hole.style.width = `${Math.round(r.width + p * 2)}px`;
    hole.style.height = `${Math.round(r.height + p * 2)}px`;
  } else {
    hole.hidden = true;
  }

  if (sheet) {
    card.style.left = ''; card.style.top = ''; card.dataset.side = 'sheet';
    const low = !!el && (el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2) > vh * 0.5;
    root.classList.toggle('tour-sheet-top', low);
    return;
  }
  root.classList.remove('tour-sheet-top');
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const pad = 16; const gap = 16;
  const clampX = (x) => Math.max(pad, Math.min(x, vw - cw - pad));
  const clampY = (y) => Math.max(pad, Math.min(y, vh - ch - pad));
  let left; let top; let side = 'center';
  if (el) {
    const r = el.getBoundingClientRect();
    const fits = {
      right: r.right + gap + cw <= vw - pad,
      left: r.left - gap - cw >= pad,
      below: r.bottom + gap + ch <= vh - pad,
      above: r.top - gap - ch >= pad,
    };
    const order = [step.side || 'right', 'right', 'below', 'left', 'above'];
    side = order.find((s) => fits[s]) || 'center';
    if (side === 'right') { left = r.right + gap; top = clampY(r.top + r.height / 2 - ch / 2); }
    else if (side === 'left') { left = r.left - gap - cw; top = clampY(r.top + r.height / 2 - ch / 2); }
    else if (side === 'below') { left = clampX(r.left + r.width / 2 - cw / 2); top = r.bottom + gap; }
    else if (side === 'above') { left = clampX(r.left + r.width / 2 - cw / 2); top = r.top - gap - ch; }
  }
  if (side === 'center') { left = clampX((vw - cw) / 2); top = clampY((vh - ch) / 2); }
  card.dataset.side = side;
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

function go(i) {
  if (!state) return;
  if (i < 0) return;
  if (i >= STEPS.length) { endTour('done'); return; }
  state.index = i;
  render();
}

/** Close the tour and remember why ('done' | 'skipped'). */
export function endTour(reason = 'skipped') {
  if (!state) return;
  const { root, restoreFocus, cleanup, openedDrawer } = state;
  state = null;
  if (openedDrawer && document.body.classList.contains('nav-open')) document.querySelector('.scrim[data-action="close-nav"]')?.click();
  cleanup();
  writeFlag(KEY, reason === 'done' ? 'done' : 'skipped');
  root.remove();
  document.body.classList.remove('tour-open');
  if (restoreFocus && restoreFocus.isConnected && restoreFocus !== document.body) {
    try { restoreFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
}

export function isTourOpen() { return !!state; }

/** Start (or restart) the tour at step 0. */
export function startTour() {
  if (state) { go(0); return; }
  const root = document.createElement('div');
  root.className = 'tour-root';
  // No fade when motion is reduced, or when the tab is in the background (transitions would not run).
  if (motionReduced() || document.hidden) root.classList.add('tour-still');
  root.innerHTML = `<div class="tour-block"></div><div class="tour-hole" hidden></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabindex="-1"></div>`;
  document.body.appendChild(root);
  document.body.classList.add('tour-open');
  const hole = root.querySelector('.tour-hole');
  const card = root.querySelector('.tour-card');

  let raf = 0;
  const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; place(); }); };
  const onKey = (e) => {
    if (!state) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour('skipped'); return; }
    if (e.key === 'Tab') {
      const f = [...card.querySelectorAll('button:not([disabled])')];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i === f.length - 1 ? 0 : i + 1);
      f[n].focus();
      return;
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(state.index + 1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(state.index - 1); return; }
    if (e.key === 'Enter' && !(e.target && e.target.closest && e.target.closest('.tour-card button'))) {
      e.preventDefault(); e.stopPropagation(); go(state.index + 1); return;
    }
    // Keep page shortcuts (Ctrl+K, Ctrl+,) from opening things underneath the tour.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === ',')) { e.preventDefault(); e.stopPropagation(); }
  };
  const onClick = (e) => {
    const b = e.target.closest('[data-tour]');
    if (!b) return;
    const act = b.dataset.tour;
    if (act === 'skip') endTour('skipped');
    else if (act === 'back') go(state.index - 1);
    else if (act === 'next') go(state.index + 1);
  };
  const onFocusIn = (e) => { if (state && !card.contains(e.target)) { const n = card.querySelector('[data-tour="next"]'); (n || card).focus({ preventScroll: true }); } };
  const onLang = () => { if (state) render(); };

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('focusin', onFocusIn);
  root.addEventListener('click', onClick);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('varelq:sidebar', schedule);
  document.addEventListener('transitionend', schedule, true); // e.g. the sidebar finishing its collapse animation
  window.addEventListener('varelq:lang', onLang);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  if (ro) { const sb = document.getElementById('sidebar'); if (sb) ro.observe(sb); ro.observe(card); }

  state = {
    root, hole, card, index: 0, restoreFocus: document.activeElement,
    cleanup: () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('varelq:sidebar', schedule);
      document.removeEventListener('transitionend', schedule, true);
      window.removeEventListener('varelq:lang', onLang);
      if (ro) ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    },
  };
  render();
  requestAnimationFrame(() => root.classList.add('tour-in'));
}

/**
 * Start once on a first visit. Skipped when the tour was completed or skipped before, when ?tour=0 or
 * localStorage varelq.tour.suppress='1', or when it already ran in this page load (storage unavailable).
 */
export function autoStartTour(delay = 700) {
  const param = tourParam();
  if (param === '0' || param === 'off') return false;
  const forced = param === '1';
  if (!forced) {
    if (autoTried) return false;
    if (readFlag(SUPPRESS_KEY) === '1') return false;
    const v = readFlag(KEY);
    if (v === 'done' || v === 'skipped') return false;
  }
  autoTried = true;
  setTimeout(() => {
    if (state) return;
    // Don't open over the settings modal or the palette; the next visit will try again.
    if (/^#\/?settings\b/.test(location.hash) || document.querySelector('.palette-root, .xmodal-root')) { autoTried = false; return; }
    startTour();
  }, delay);
  return true;
}

window.addEventListener('varelq:tour', () => startTour());
