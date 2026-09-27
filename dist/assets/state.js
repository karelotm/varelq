// Preferences (persisted under varelq.preferences) and in-session state.

const KEY = 'varelq.preferences';
export const DEFAULT_PREFS = Object.freeze({ theme: 'system', density: 'comfortable', motion: 'system', sidebar: 'expanded' });
const ALLOWED = { theme: ['system', 'light', 'dark'], density: ['comfortable', 'compact'], motion: ['system', 'full', 'reduced', 'off'], sidebar: ['expanded', 'collapsed'] };

function readStored() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function sanitize(input) {
  const out = { ...DEFAULT_PREFS };
  // Keep unknown keys other modules store in the same object (for example a language choice).
  if (input && typeof input === 'object') {
    for (const k of Object.keys(input)) if (!(k in ALLOWED) && typeof input[k] !== 'object') out[k] = input[k];
  }
  for (const k of Object.keys(ALLOWED)) {
    if (input && ALLOWED[k].includes(input[k])) out[k] = input[k];
  }
  return out;
}

export const prefs = sanitize(readStored());
const prefListeners = new Set();

/** Apply preferences to <html> data attributes (live). */
export function applyPrefs(p = prefs) {
  const root = document.documentElement;
  if (p.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', p.theme);
  root.setAttribute('data-density', p.density);
  root.setAttribute('data-motion', p.motion);
  if (p.sidebar === 'collapsed') root.setAttribute('data-sidebar', 'collapsed'); else root.removeAttribute('data-sidebar');
}

export function setPref(name, value) {
  if (!ALLOWED[name] || !ALLOWED[name].includes(value)) return;
  prefs[name] = value;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable: still applies for this session */ }
  applyPrefs();
  prefListeners.forEach((fn) => { try { fn({ ...prefs }); } catch { /* ignore */ } });
}

export function clearPrefs() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  Object.assign(prefs, DEFAULT_PREFS);
  applyPrefs();
  prefListeners.forEach((fn) => { try { fn({ ...prefs }); } catch { /* ignore */ } });
}

export function onPrefs(fn) { prefListeners.add(fn); return () => prefListeners.delete(fn); }

/** True when the effective theme is dark. */
export function isDark() {
  if (prefs.theme === 'dark') return true;
  if (prefs.theme === 'light') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** True when motion should be minimised (Off, Reduced, or System + OS reduced motion). */
export function motionOff() { return prefs.motion === 'off'; }
export function motionReduced() {
  if (prefs.motion === 'off' || prefs.motion === 'reduced') return true;
  if (prefs.motion === 'full') return false;
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Upload blobs kept for this tab only, keyed by run id then role, so a case opened right after
// an upload can show the page image. Never persisted.
const uploads = new Map();
export function rememberUploads(runId, byRole) { if (runId && byRole) uploads.set(runId, byRole); }
export function uploadsFor(runId) { return uploads.get(runId) || null; }

applyPrefs();
