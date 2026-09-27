// API client. All calls are same-origin JSON; failures throw Error(message) with .status and .body.

let inflight = 0;
const listeners = new Set();
function track(delta) {
  inflight = Math.max(0, inflight + delta);
  listeners.forEach((fn) => { try { fn(inflight); } catch { /* ignore */ } });
}
/** onBusy(fn): fn(count) is called whenever the number of in-flight requests changes. */
export function onBusy(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function request(path, init = {}) {
  track(1);
  let res;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init, headers: { Accept: 'application/json', ...(init.headers || {}) } });
  } catch (err) {
    track(-1);
    const e = new Error('The VARELQ server is not reachable. Check that it is running.');
    e.status = 0; e.cause = err;
    throw e;
  }
  track(-1);
  return res;
}

async function readJson(res) {
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!res.ok) {
    const message = (body && typeof body.error === 'string' && body.error)
      || (res.status === 404 ? 'Not found.' : res.status === 503 ? 'This service is unavailable.' : `Request failed (HTTP ${res.status}).`);
    const e = new Error(message);
    e.status = res.status; e.body = body;
    throw e;
  }
  if (body === null) {
    const e = new Error('The server returned an unreadable response.');
    e.status = res.status;
    throw e;
  }
  return body;
}

const blobCache = new Map();

export const api = {
  /** GET JSON. */
  async get(path) { return readJson(await request(path)); },
  /** POST JSON body. */
  async post(path, json) {
    return readJson(await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json ?? {}) }));
  },
  /** POST multipart FormData. */
  async form(path, formData) { return readJson(await request(path, { method: 'POST', body: formData })); },
  /** GET raw bytes as a Blob. */
  async blob(path) {
    const res = await request(path, { headers: { Accept: '*/*' } });
    if (!res.ok) {
      const e = new Error(res.status === 404 ? 'File not found.' : `Could not load file (HTTP ${res.status}).`);
      e.status = res.status;
      throw e;
    }
    return res.blob();
  },
  /** GET bytes and return a cached object URL (for images). */
  async blobUrl(path) {
    if (blobCache.has(path)) return blobCache.get(path);
    const blob = await api.blob(path);
    const url = URL.createObjectURL(blob);
    blobCache.set(path, url);
    return url;
  },
};

export default api;
