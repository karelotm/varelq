// Organization: local organization profile (shared with Settings > Organization) and a workspace access note.
import { esc } from '../format.js';
import { icon } from '../icons.js';
import { panel } from '../components/panel.js';
import { badge } from '../components/badge.js';

export const meta = { title: 'Organization', group: 'settings' };

// Same key and defaults as the Organization section in views/settings.js; unknown fields are preserved on save.
export const ORG_KEY = 'varelq.org.profile';
const ORG_DEFAULT = { name: 'Local workspace', country: '', contact: '', industry: '', operator: '' };
const PROFILE_KEY = 'varelq.profile'; // user menu profile (operator name and email, org list)

export function readOrg() {
  try {
    const raw = localStorage.getItem(ORG_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return { ...ORG_DEFAULT, ...(o && typeof o === 'object' ? o : {}) };
  } catch { return { ...ORG_DEFAULT }; }
}

function readOperator() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {};
    return p.operator && typeof p.operator === 'object' ? p.operator : {};
  } catch { return {}; }
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'L';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase();
}

function field(label, hint, control) {
  return `<div class="setting"><div><label class="label" for="${control.id}">${esc(label)}</label>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div><div>${control.html}</div></div>`;
}
function input(name, value, attrs = '', type = 'text') {
  const id = `orgp-${name}`;
  return { id, html: `<input class="input pages-input" type="${type}" id="${id}" name="${name}" value="${esc(value)}" ${attrs}>` };
}

function profileForm(o, operatorName) {
  return `<form id="org-page-form" novalidate>
${field('Organization name', 'Shown in the sidebar and on exports.', input('name', o.name, 'maxlength="80" required autocomplete="organization"'))}
${field('Industry', 'Optional. For example, manufacturing.', input('industry', o.industry, 'maxlength="80"'))}
${field('Country or region', 'Optional.', input('country', o.country, 'maxlength="60" autocomplete="country-name"'))}
${field('Operator name', 'The person reviewing cases on this computer.', input('operator', operatorName, 'maxlength="80" autocomplete="name"'))}
${field('Contact email', 'Optional. Who receives clarification requests.', input('contact', o.contact, 'maxlength="120" autocomplete="email"', 'email'))}
<div class="pages-form-foot"><span class="subtle text-sm">Stored in this browser only.</span><button type="submit" class="btn btn-primary btn-sm">Save organization</button></div>
</form>`;
}

function accessBody(o, operatorName) {
  const who = operatorName || 'Local operator';
  return `<div class="pages-member">
  <span class="org-avatar" aria-hidden="true">${esc(initials(who))}</span>
  <span class="pages-member-text"><strong>${esc(who)}</strong><small>Local operator · this computer</small></span>
  ${badge('Local access', 'neutral')}
</div>
<p class="pages-note">This installation has one local workspace. Organization details label it; they do not create separate data stores or access controls. Shared workspaces and invitations need an authenticated deployment.</p>`;
}

export async function render() {
  const o = readOrg();
  const op = readOperator();
  const operatorName = (typeof op.name === 'string' && op.name) || o.operator || '';
  return `
<div class="page-head">
  <div class="titles"><h1>Organization</h1><div class="meta">The identity behind this local workspace.</div></div>
  <div class="actions"><a class="btn btn-ghost btn-sm" href="#settings/general">${icon('settings', 16)}<span>Personal preferences</span></a></div>
</div>
<div class="pages-stack pages-narrow">
${panel({ title: 'Organization profile', flush: true, headExtra: `<span class="org-avatar pages-org-mark" aria-hidden="true" data-slot="org-mark">${esc(initials(o.name))}</span>`, body: profileForm(o, operatorName) })}
${panel({ title: 'Workspace access', body: `<div data-slot="access">${accessBody(o, operatorName)}</div>` })}
</div>`;
}

export function mount(root, ctx) {
  const form = root.querySelector('#org-page-form');
  if (!form) return undefined;
  const onSubmit = async (e) => {
    e.preventDefault();
    const nameEl = form.elements.name;
    const contactEl = form.elements.contact;
    const name = String(nameEl.value || '').trim().slice(0, 80);
    if (!name) { nameEl.setAttribute('aria-invalid', 'true'); ctx.toast('Enter an organization name.', 'danger'); nameEl.focus(); return; }
    nameEl.removeAttribute('aria-invalid');
    const contact = String(contactEl.value || '').trim().slice(0, 120);
    if (contact && !contactEl.checkValidity()) { contactEl.setAttribute('aria-invalid', 'true'); ctx.toast('Enter a valid contact email.', 'danger'); contactEl.focus(); return; }
    contactEl.removeAttribute('aria-invalid');
    const operator = String(form.elements.operator.value || '').trim().slice(0, 80);
    const next = {
      ...readOrg(),
      name,
      industry: String(form.elements.industry.value || '').trim().slice(0, 80),
      country: String(form.elements.country.value || '').trim().slice(0, 60),
      contact,
      operator,
    };
    let ok = true;
    try { localStorage.setItem(ORG_KEY, JSON.stringify(next)); } catch { ok = false; }
    // Keep the user menu and org switcher in step: operator name/email and the current org's label.
    try {
      const um = await import('../components/usermenu.js');
      if (um && typeof um.getProfile === 'function' && typeof um.setProfile === 'function') {
        const p = um.getProfile();
        const orgs = p.orgs.map((x) => (x.id === p.org ? { ...x, name } : x));
        um.setProfile({ orgs, operator: { ...p.operator, name: operator, email: p.operator.email || contact } });
      }
    } catch { /* user menu not available: the org profile is still saved */ }
    window.dispatchEvent(new CustomEvent('varelq:org', { detail: next }));
    const mark = root.querySelector('[data-slot="org-mark"]');
    if (mark) mark.textContent = initials(name);
    const access = root.querySelector('[data-slot="access"]');
    if (access) access.innerHTML = accessBody(next, operator);
    ctx.toast(ok ? 'Organization saved.' : 'Saved for this session only (browser storage unavailable).', ok ? 'success' : 'warning');
  };
  form.addEventListener('submit', onSubmit);
  return () => form.removeEventListener('submit', onSubmit);
}
