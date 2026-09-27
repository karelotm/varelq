// Ask VARELQ: grounded chat over saved records. POST /api/chat; answers cite record ids checked on the server.
// Model text is never assigned to innerHTML: it is rendered node by node (paragraphs, "- " lists, **bold**, [id] citations).
import { esc, shortModel, num } from '../format.js';
import { icon } from '../icons.js';
import { badge } from '../components/badge.js';

export const meta = { title: 'Ask VARELQ', group: 'workspace' };

const SUGGESTIONS = [
  'Which supplier has the most discrepancies?',
  'Summarise the S4 guard result',
  'What is the most urgent agent failure?',
  'Which invoices still need review?',
];
const MAX_Q = 1000;
const MAX_HISTORY = 6;

// Kept at module scope so the conversation survives navigating away and back (not persisted anywhere).
const thread = [];
let pending = false;
let live = null; // { refresh() } of the currently mounted view

export function render() {
  return `
<section class="chat" aria-label="Ask VARELQ">
  <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-relevant="additions"></div>
  <div class="chat-dock">
    <form class="chat-composer" id="chat-form" autocomplete="off">
      <label class="sr-only" for="chat-input">Ask a question about your records</label>
      <textarea id="chat-input" class="chat-input" rows="1" maxlength="${MAX_Q}" placeholder="Ask about suppliers, invoices, agent failures or guard runs"></textarea>
      <button type="submit" class="btn btn-primary btn-icon chat-send" id="chat-send" aria-label="Send">${icon('arrow-right', 18)}</button>
    </form>
    <p class="chat-hint">Enter to send · Shift+Enter for a new line · Answers are drafted by a model from your saved records only</p>
  </div>
</section>`;
}

/* ---------- safe markdown-lite ---------- */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Append inline text with **bold** and [id] citations to parent. */
function inline(parent, text, citeIndex) {
  const re = /\*\*([^*\n]+)\*\*|\[([A-Za-z0-9][A-Za-z0-9._:-]{0,63})\]/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      parent.appendChild(el('strong', '', m[1]));
    } else {
      const c = citeIndex.get(m[2]);
      if (c) {
        const a = el('a', 'chat-ref', String(c.n));
        a.href = c.href;
        a.title = c.label;
        a.setAttribute('aria-label', `Source ${c.n}: ${c.label}`);
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(m[0]));
      }
    }
    last = re.lastIndex;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function renderAnswer(text, citeIndex) {
  const frag = document.createDocumentFragment();
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    let list = null; let para = null;
    for (const line of lines) {
      const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (bullet) {
        if (!list) { list = el('ul'); frag.appendChild(list); para = null; }
        const li = el('li');
        inline(li, bullet[1], citeIndex);
        list.appendChild(li);
      } else {
        list = null;
        if (!para) { para = el('p'); frag.appendChild(para); } else para.appendChild(document.createTextNode(' '));
        inline(para, line.trim(), citeIndex);
      }
    }
  }
  return frag;
}

/* ---------- message nodes ---------- */
function userNode(text) {
  const wrap = el('div', 'chat-msg chat-msg-user');
  wrap.appendChild(el('div', 'chat-bubble', text));
  return wrap;
}

function assistantNode(msg) {
  const wrap = el('div', 'chat-msg chat-msg-assistant');
  if (msg.error) {
    const err = el('div', 'inline-error chat-error');
    err.innerHTML = icon('alert-triangle', 16);
    err.appendChild(el('span', '', msg.error));
    const retry = el('button', 'btn btn-ghost btn-sm', 'Retry');
    retry.type = 'button';
    retry.dataset.chatRetry = msg.question;
    err.appendChild(retry);
    wrap.appendChild(err);
    return wrap;
  }
  const r = msg.result;
  const cites = Array.isArray(r.citations) ? r.citations : [];
  const citeIndex = new Map(cites.map((c, i) => [c.id, { n: i + 1, href: safeHref(c.href), label: c.label || c.id }]));
  const body = el('div', 'chat-answer');
  body.appendChild(renderAnswer(r.answer, citeIndex));
  wrap.appendChild(body);
  if (cites.length) {
    const list = el('div', 'chat-sources');
    list.setAttribute('aria-label', 'Sources');
    cites.forEach((c, i) => {
      const a = el('a', 'chat-source');
      a.href = safeHref(c.href);
      a.appendChild(el('span', 'chat-source-n', String(i + 1)));
      a.appendChild(el('span', 'chat-source-label', c.label || c.id));
      a.title = `${KIND_LABEL[c.kind] || 'Record'} · ${c.id}`;
      list.appendChild(a);
    });
    wrap.appendChild(list);
  }
  const foot = el('div', 'chat-foot');
  const parts = ['Answers use only your saved records', shortModel(r.model), `${num(r.latency_ms)} ms`];
  foot.appendChild(el('span', '', parts.join(' · ')));
  if (r.fallback_used) foot.insertAdjacentHTML('beforeend', badge('Fallback', 'warning', { title: `Answered by fallback model ${r.model || ''}` }));
  const dropped = Array.isArray(r.dropped_citations) ? r.dropped_citations.length : 0;
  if (dropped) {
    const d = el('span', 'chat-dropped', `${dropped} unverified ${dropped === 1 ? 'reference' : 'references'} removed`);
    d.title = 'The model cited ids that are not in your records; they were removed on the server.';
    foot.appendChild(d);
  }
  wrap.appendChild(foot);
  return wrap;
}

const KIND_LABEL = { document_run: 'Invoice run', reliability_report: 'Failure pattern', finding: 'Discrepancy', lab_batch: 'Guard lab batch', supplier: 'Supplier' };

function safeHref(href) {
  const h = String(href || '');
  return /^#[A-Za-z0-9/_.-]*$/.test(h) ? h : '#chat';
}

function introHtml() {
  return `<div class="chat-intro">
  <h1 class="chat-title">What would you like to know?</h1>
  <p class="chat-lede">Ask about your invoices, suppliers, agent failure patterns and guard-lab runs. Every answer cites the records it used.</p>
  <div class="chat-suggest">${SUGGESTIONS.map((s) => `<button type="button" class="chat-chip" data-chat-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>
</div>`;
}

function typingNode() {
  const n = el('div', 'chat-msg chat-msg-assistant chat-typing');
  n.setAttribute('aria-label', 'VARELQ is answering');
  n.innerHTML = '<span></span><span></span><span></span>';
  return n;
}

/* ---------- mount ---------- */
export function mount(root, ctx) {
  const log = root.querySelector('#chat-log');
  const form = root.querySelector('#chat-form');
  const input = root.querySelector('#chat-input');
  const send = root.querySelector('#chat-send');
  let typing = null;

  function paint() {
    log.textContent = '';
    if (!thread.length) { log.innerHTML = introHtml(); return; }
    for (const m of thread) log.appendChild(m.role === 'user' ? userNode(m.content) : assistantNode(m));
    if (pending) { typing = typingNode(); log.appendChild(typing); }
  }

  function setPending(on) {
    pending = on;
    input.disabled = on;
    send.disabled = on || !input.value.trim();
    form.setAttribute('aria-busy', String(on));
  }

  function grow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
    send.disabled = pending || !input.value.trim();
  }

  function scrollEnd() {
    const last = log.lastElementChild;
    if (last) last.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  async function ask(question) {
    const q = String(question || '').trim().slice(0, MAX_Q);
    if (!q || pending) return;
    const hist = [];
    thread.forEach((m, i) => {
      const next = thread[i + 1];
      if (m.role === 'user' && next && next.result) hist.push({ role: 'user', content: m.content }, { role: 'assistant', content: next.result.answer });
    });
    hist.splice(0, Math.max(0, hist.length - MAX_HISTORY));
    thread.push({ role: 'user', content: q });
    input.value = '';
    grow();
    setPending(true);
    paint();
    scrollEnd();
    let msg;
    try {
      const result = await ctx.api.post('/api/chat', { question: q, history: hist });
      msg = { role: 'assistant', result, question: q };
    } catch (err) {
      const text = err && err.status === 503 ? `NVIDIA is unavailable right now. ${err.message || ''}`.trim() : (err && err.message) || 'The question could not be answered.';
      msg = { role: 'assistant', error: text, question: q };
    }
    thread.push(msg);
    pending = false;
    if (live) live.refresh(msg);
  }

  function refresh(msg) {
    setPending(false);
    paint();
    scrollEnd();
    if (ctx.announce) ctx.announce(msg.error ? 'Answer failed.' : 'Answer received.');
    input.focus({ preventScroll: true });
  }

  function onSubmit(e) { e.preventDefault(); ask(input.value); }
  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
  }
  function onClick(e) {
    const s = e.target.closest('[data-chat-suggest]');
    if (s) { ask(s.dataset.chatSuggest); return; }
    const r = e.target.closest('[data-chat-retry]');
    if (r) {
      // Remove the failed exchange, then ask again.
      let idx = -1;
      thread.forEach((m, i) => { if (m.error) idx = i; });
      if (idx > 0 && thread[idx - 1].role === 'user') thread.splice(idx - 1, 2);
      ask(r.dataset.chatRetry);
    }
  }

  form.addEventListener('submit', onSubmit);
  input.addEventListener('keydown', onKey);
  input.addEventListener('input', grow);
  log.addEventListener('click', onClick);
  live = { refresh };
  setPending(pending);
  paint();
  grow();

  const q = ctx.query && ctx.query.get('q');
  if (q) {
    try { history.replaceState(null, '', '#chat'); } catch { /* ignore */ }
    ask(q);
  } else if (!pending) {
    input.focus({ preventScroll: true });
  }

  return () => {
    if (live && live.refresh === refresh) live = null;
    form.removeEventListener('submit', onSubmit);
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('input', grow);
    log.removeEventListener('click', onClick);
  };
}
