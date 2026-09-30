import * as R from '/rules.js';

// =================================================================== tiny html toolkit
// Everything interpolated into html`` is escaped unless it is itself html``.
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);
const part = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));
function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

// =================================================================== state & api
const app = { today: localToday(), me: null, templates: null };
function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
class SignInNeeded extends Error {}

async function api(path, { method = 'GET', body, file } = {}) {
  const init = { method, headers: {} };
  if (file) { init.body = file; init.headers['content-type'] = file.type || 'application/octet-stream'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, init); }
  catch { throw new Error('Could not reach the server. Check the connection and try again.'); }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && data?.signin) { showSignin(data.setup); throw new SignInNeeded('Please sign in'); }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
async function getTemplates() {
  if (!app.templates) app.templates = (await api('/api/templates')).templates;
  return app.templates;
}

// =================================================================== formatters
const fmt = R.fmtDate;
const pct = R.fmtPct;
const icon = (name, cls = '') => html`<span class="ms ${cls}" aria-hidden="true">${name}</span>`;
const fileUrl = (key) => `/api/files/${key}`;
function tsDate(ts) {
  if (!ts) return null;
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function ago(ts) {
  const s = (Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d < 7 ? `${d} d ago` : fmt(tsDate(ts), true);
}
function longDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
const unitName = (u) => (u.kind === 'kitchen' || u.site_kind === 'kitchen' ? `${u.name ?? u.site_name}, ${u.city ?? u.site_city}` : (u.name ?? u.site_name));
const unitSub = (u) => (u.kind === 'kitchen' ? (u.area || 'Central kitchen') : u.city);
function deltaSpan(d, { unit = '' } = {}) {
  if (d == null) return '';
  const v = R.round1(d);
  return html`<small class="${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}${unit}</small>`;
}

// =================================================================== components
const bandChip = (key, { small = false, label } = {}) => {
  const k = key || 'none';
  return html`<span class="band b-${k}${small ? ' sm' : ''}">${icon(R.LEVELS[k].icon)}<span class="lbl">${label || R.LEVELS[k].label}</span></span>`;
};
const prioChip = (p) => html`<span class="prio p-${p}" title="${R.PRIORITY[p].label}: ${R.PRIORITY[p].response}">${R.PRIORITY[p].short}</span>`;
const kindTag = (k) => (k === 'paperwork' ? html`<span class="tag paper" title="${R.KINDS.paperwork.hint}">${icon('description')}Paperwork</span>` : '');
const statusTag = (st) => html`<span class="tag">${icon(R.FINDING_STATUS[st].icon)}${R.FINDING_STATUS[st].label}</span>`;
const repeatTag = (f) => (f.is_repeat ? html`<span class="tag repeat" title="Also failed at the previous visit">${icon('replay')}Repeat</span>` : '');
const ratingChip = (scheme, result) => html`<span class="rating r-${result}">${R.SCHEMES[scheme]?.ratings[result] || result}</span>`;
const star = (critical) => (critical ? html`<span class="star" title="★ critical: counts double">★</span>` : '');
function meter(score, { band = R.bandFor(score), target = false } = {}) {
  const w = Math.max(0, Math.min(100, score ?? 0));
  return html`<div class="meter${target ? ' target' : ''}" role="img" aria-label="${score == null ? 'No score' : pct(score)}${target ? `, target ${R.TARGET}%` : ''}"><span class="f-${band || 'none'}" style="width:${w}%"></span></div>`;
}
function reasonsList(reasons, { siteId = null, showDomain = false } = {}) {
  const href = (r) => (r.kind === 'audit' && r.id ? `#/audits/${r.id}` : r.kind === 'licence' && r.id ? `#/licences/${r.id}`
    : r.kind === 'findings' && siteId ? `#/fixes?unit=${siteId}&domain=${r.domain}${r.filter === 'p1' ? '&priority=critical' : '&status=overdue'}`
      : r.kind === 'route' && siteId ? `#/units/${siteId}#route-${r.domain}` : r.kind === 'audit-due' && siteId ? `#/audits/new?unit=${siteId}&domain=${r.domain}` : null);
  return html`<ul class="reasons">${reasons.map((r) => {
    const h = href(r);
    return html`<li>${icon(R.LEVELS[r.tone || 'none'].icon, `t-${r.tone || 'none'}`)}<span><span class="sr-only">${R.LEVELS[r.tone || 'none'].label}: </span>${
      showDomain && r.domain ? html`<span class="dom">${R.DOMAINS[r.domain].label}</span>` : ''}${h ? html`<a href="${h}">${r.text}</a>` : r.text}</span></li>`;
  })}</ul>`;
}
function emptyState({ iconName = 'inbox', title, text = '', action = '' }) {
  return html`<div class="empty">${icon(iconName)}<h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}
function dueInfo(f, today = app.today) {
  if (f.status === 'closed') return { text: `Closed ${fmt(tsDate(f.closed_at))}`, tone: null };
  if (f.status === 'fixed') return { text: 'Awaiting verification', tone: 'improve' };
  const d = R.daysBetween(today, f.due_date);
  if (d < 0) return { text: `${R.plural(-d, 'day')} overdue`, tone: 'noncompliance' };
  if (d === 0) return { text: 'Due today', tone: 'improve' };
  return { text: `Due ${fmt(f.due_date)}`, tone: null };
}
const dueSpan = (f) => { const d = dueInfo(f); return html`<span class="${d.tone ? `t-${d.tone}` : ''}">${d.text}</span>`; };

function fixRow(f, { showUnit = true } = {}) {
  const photo = f.photos?.[0];
  const lead = f.status === 'closed' ? html`<span class="lead b-satisfactory">${icon('task_alt')}</span>`
    : photo ? html`<img class="thumb-sm" src="${fileUrl(photo)}" alt="" loading="lazy">`
      : html`<span class="lead b-${f.priority === 'critical' ? 'noncompliance' : f.priority === 'major' ? 'improve' : 'none'}">${icon(f.kind === 'paperwork' ? 'description' : 'build')}</span>`;
  return html`<a class="list-item" href="#/fixes/${f.id}">
    ${lead}
    <span class="body">
      <span class="title clamp-2">${f.title}</span>
      <span class="meta">${prioChip(f.priority)}${showUnit ? html`<span>${unitName(f)}</span>` : ''}<span>${R.DOMAINS[f.domain].label}${f.item_area ? ` · ${f.item_area}` : ''}</span>${kindTag(f.kind)}<span>+${R.fmtNum(f.marks)} ${f.domain === 'food' ? 'marks' : 'pts'}</span>${dueSpan(f)}${repeatTag(f)}</span>
    </span>
    <span class="trail"><span class="desktop-only">${statusTag(f.status)}</span>${icon('chevron_right', 'chev')}</span>
  </a>`;
}

function licenceRow(l, today = app.today, { showUnit = true } = {}) {
  const left = l.expires_on ? R.daysBetween(today, l.expires_on) : null;
  let tone = 'satisfactory', text = l.expires_on ? `Valid until ${fmt(l.expires_on, true)}` : 'No expiry date';
  if (left != null && left < 0) { tone = l.severity === 'minor' ? 'improve' : 'noncompliance'; text = `Expired ${R.plural(-left, 'day')} ago (${fmt(l.expires_on, true)})`; }
  else if (left != null && left <= R.LICENCE_WARN_DAYS) { tone = 'improve'; text = `Expires in ${R.plural(left, 'day')} (${fmt(l.expires_on, true)})`; }
  else if (left != null && left <= R.LICENCE_NOTICE_DAYS) text = `Renew soon: ${R.plural(left, 'day')} left`;
  return html`<a class="list-item" href="#/licences/${l.id}">
    <span class="lead b-${tone}">${icon(R.LEVELS[tone].icon)}</span>
    <span class="body"><span class="title">${l.type}</span>
      <span class="meta">${showUnit && l.site_name ? html`<span>${unitName({ name: l.site_name, city: l.site_city, kind: l.site_kind })}</span>` : ''}${l.number ? html`<span>No. ${l.number}</span>` : ''}<span class="${tone !== 'satisfactory' ? `t-${tone}` : ''}">${text}</span>${l.file_key ? html`<span>${icon('attach_file')} scan</span>` : ''}</span></span>
    <span class="trail">${icon('chevron_right', 'chev')}</span>
  </a>`;
}

/** Visit 1 → latest visit → target, one row per unit, on the four grade bands. */
const X = (v) => Math.max(0, Math.min(100, ((v - 30) / 70) * 100));
function progressChart(units) {
  const rows = units.filter((u) => u.food.latest != null).sort((a, b) => b.food.latest - a.food.latest);
  const axis = [30, 50, 80, 90, 100];
  return html`<div class="db">
    <div class="db-legend" aria-hidden="true">
      <span><i class="k-v1"></i>Visit 1</span><span><i class="k-v2"></i>Latest visit (colour = grade)</span><span><i class="k-t"></i>Target ${R.TARGET}%</span>
      <span><i class="k-z" style="background:var(--z-nc)"></i>Non-Compliance</span><span><i class="k-z" style="background:var(--z-ni)"></i>Needs Improvement</span>
      <span><i class="k-z" style="background:var(--z-sa)"></i>Satisfactory</span><span><i class="k-z" style="background:var(--z-ex)"></i>Exemplar</span>
    </div>
    ${rows.map((u) => {
      const v = u.food.visits, last = v.at(-1), first = v.length > 1 ? v[0] : null;
      const label = `${unitName(u)}: ${first ? `visit 1 ${pct(first.score)}, ` : ''}visit ${v.length} ${pct(last.score)}, ${R.bandLabel(last.band)}${u.food.delta != null ? `, change ${R.fmtDelta(u.food.delta)}` : ''}. Target ${R.TARGET}%.`;
      const a = first ? X(first.score) : null, b = X(last.score);
      return html`<a class="db-row" href="#/units/${u.id}" aria-label="${label}">
        <span class="db-label"><b>${u.name}</b><small>${u.city}</small></span>
        <span class="db-track" aria-hidden="true"><span class="db-target"></span>
          ${first ? html`<span class="db-line" style="left:${Math.min(a, b)}%;width:${Math.abs(b - a)}%"></span><span class="db-v1" style="left:${a}%"></span>` : ''}
          <span class="db-v2 f-${last.band}" style="left:${b}%"></span></span>
        <span class="db-val"><b>${pct(last.score)}</b>${first ? deltaSpan(u.food.delta) : html`<small class="flat">1 visit</small>`}</span>
      </a>`;
    })}
    <div class="db-axis" aria-hidden="true">${axis.map((t) => html`<span style="left:${X(t)}%">${t}%</span>`)}</div>
  </div>`;
}

function routeList(route, { domain, unitId, compact = false }) {
  if (!route) return '';
  const unitWord = domain === 'food' ? 'marks' : 'points';
  if (route.score >= R.TARGET) {
    return html`<p>${bandChip(R.bandFor(route.score), { small: true })} Already at ${pct(route.score)}. Next goal: ${R.STRETCH}% (Exemplar), by closing the ${R.plural(route.open, 'open fix', 'open fixes')}.</p>`;
  }
  const steps = compact ? route.steps.slice(0, 5) : route.steps;
  const last = route.steps.at(-1);
  return html`<div class="stack" style="gap:10px">
    <p><b>${R.fmtNum(route.needed)} ${unitWord} short of ${R.TARGET}%.</b> Close ${route.reached ? `these ${R.plural(route.steps.length, 'fix', 'fixes')}` : 'every open fix'}, in this order${route.reached ? `, to reach ${pct(last.after)}` : ''}. Priority 1 alone takes it to ${pct(route.afterP1)}.</p>
    <ol class="route">
      ${steps.map((s) => html`<li><span class="what"><a href="#/fixes/${s.id}">${s.title}</a><span class="meta small muted row-flex" style="gap:6px">${prioChip(s.priority)}${s.area ? html`<span>${s.area}</span>` : ''}${s.code ? html`<span>${s.code}</span>` : ''}${kindTag(s.kind)}</span></span>
        <span class="after">+${R.fmtNum(s.marks)} ${unitWord}<b>${pct(s.after)}</b></span></li>`)}
      ${compact && route.steps.length > steps.length ? html`<li class="goal"><span class="what"><a href="#/units/${unitId}#route-${domain}">${R.plural(route.steps.length - steps.length, 'more fix', 'more fixes')} to ${R.TARGET}%</a></span><span class="after"><b>${pct(last.after)}</b></span></li>`
        : route.reached ? html`<li class="goal"><span class="what"><b>${R.bandLabel(R.bandFor(last.after))}</b><span class="small muted">Target reached</span></span><span class="after"><b>${pct(last.after)}</b></span></li>` : ''}
    </ol>
    ${route.pending ? html`<p class="small muted">Once the fixes already marked fixed are verified at the next visit: ${pct(route.pending)}.</p>` : ''}
  </div>`;
}

function categoryBars(sections) {
  return html`<div class="bars">${sections.map((s) => html`<div class="bar-row"><span>${s.section}</span><b class="num">${s.score == null ? 'N/A' : `${Math.round(s.score)}%`}</b>${meter(s.score)}</div>`)}</div>`;
}

// =================================================================== snackbar, dialogs, uploads
let snackTimer;
function toast(msg, { error = false, ms = 4500 } = {}) {
  const el = $('#snackbar');
  el.textContent = msg;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.remove('show'), ms);
}
const dlg = $('#dialog');
const cdlg = $('#confirmDlg');
const dlgHandlers = new Map();
function openDialog({ title, body, actions, onSubmit, on = {} }, el = dlg) {
  dlgHandlers.set(el, on);
  if (el.open) el.close();
  el.innerHTML = part(html`<form novalidate>
    <div class="dlg-head"><h2 id="${el.id}-title">${title}</h2><button class="icon-btn" type="button" data-click="close" aria-label="Close">${icon('close')}</button></div>
    <div class="dlg-body">${body}</div>
    <div class="dlg-actions">${actions}</div>
  </form>`);
  const form = $('form', el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    try { await onSubmit?.(new FormData(form), btn?.value, form); }
    catch (err) { if (!(err instanceof SignInNeeded)) toast(err.message, { error: true }); }
    finally { if (btn) btn.disabled = false; }
  });
  el.showModal();
  const first = $('input:not([type=hidden]), select, textarea', el);
  if (first && window.matchMedia('(min-width: 600px)').matches) first.focus();
}
function closeDialog(el = dlg) { if (el.open) el.close(); }
function confirmDialog({ title, text, ok = 'Confirm', danger = false, withNote = null }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openDialog({
      title,
      body: html`<div class="form"><p class="muted">${text}</p>${withNote ? html`<div class="field"><label for="cNote">${withNote.label}</label><textarea class="input" id="cNote" name="note"></textarea></div>` : ''}</div>`,
      actions: html`<button class="btn text" type="button" data-click="close">Cancel</button><button class="btn ${danger ? 'tonal danger' : 'filled'}" value="ok">${ok}</button>`,
      onSubmit: (fd) => {
        const note = (fd.get('note') || '').trim();
        if (withNote?.required && !note) { $('#cNote', cdlg).classList.add('invalid'); return; }
        finish({ note }); closeDialog(cdlg);
      },
    }, cdlg);
    cdlg.addEventListener('close', () => finish(null), { once: true });
  });
}
async function downscale(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.type === 'image/jpeg' && file.size < 1.5e6) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.82));
  } catch { return file; }
}
function pickAndUpload({ accept = 'image/*' } = {}) {
  const input = $('#filePicker');
  input.accept = accept;
  input.value = '';
  return new Promise((resolve, reject) => {
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      try {
        toast('Uploading…', { ms: 30000 });
        const blob = file.type.startsWith('image/') ? await downscale(file) : file;
        const r = await api('/api/uploads', { method: 'POST', file: blob });
        toast('Attached');
        resolve(r.key);
      } catch (e) { toast(e.message, { error: true }); reject(e); }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// =================================================================== sign-in
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function showSignin(setup = false) {
  $('#app').hidden = true;
  const box = $('#signin');
  box.hidden = false;
  box.innerHTML = part(html`<div class="signin"><form class="card" id="signinForm" novalidate>
    <div class="word"><b>BOOKENDS</b><small>HOSPITALITY · COMPLIANCE</small></div>
    <p class="muted">Food safety, maintenance and licences for every Bookends unit.</p>
    ${setup ? html`<div class="note-banner">${icon('key')}<span>Sign-in is not set up yet. The administrator sets the team access code once, with <b>npx wrangler secret put ACCESS_CODE</b>.</span></div>` : ''}
    <div class="field"><label for="siName">Your name</label><input class="input" id="siName" name="name" autocomplete="name" required value="${localStorageGet('bk-name') || ''}"></div>
    <div class="field"><label for="siCode">Team access code</label><input class="input" id="siCode" name="code" type="password" autocomplete="current-password" required></div>
    <div class="error-text" id="siErr" hidden></div>
    <button class="btn filled big" type="submit">${icon('login')}Sign in</button>
  </form></div>`);
  $('#signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const btn = $('button[type=submit]', e.currentTarget);
    btn.disabled = true;
    const err = $('#siErr');
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: fd.get('name'), code: fd.get('code') }) });
      const data = await res.json().catch(() => ({}));
      if (!data.setup) $('.note-banner', box)?.remove(); // the code has been set since this page loaded
      if (!res.ok) throw new Error(data.error || 'Could not sign in');
      localStorageSet('bk-name', data.name);
      box.hidden = true; box.innerHTML = '';
      boot();
    } catch (x) { err.hidden = false; err.textContent = x.message; }
    finally { btn.disabled = false; }
  });
  const nameInput = $('#siName');
  (nameInput.value ? $('#siCode') : nameInput).focus();
}

// =================================================================== router & shell
let on = {};
let cleanups = [];
let navToken = 0;
let navCount = 0;
let keepScrollOnce = false;

function bindDelegation(root, getMap) {
  for (const type of ['click', 'change', 'input']) {
    root.addEventListener(type, (e) => {
      const el = e.target.closest(`[data-${type}]`);
      if (!el || !root.contains(el)) return;
      const fn = getMap()[type]?.[el.dataset[type]];
      if (fn) { if (type === 'click' && el.tagName === 'BUTTON') e.preventDefault(); fn(el, e); }
    });
  }
}
bindDelegation(view, () => on);
for (const el of [dlg, cdlg]) {
  bindDelegation(el, () => { const m = dlgHandlers.get(el) || {}; return { ...m, click: { close: () => closeDialog(el), ...(m.click || {}) } }; });
  el.addEventListener('click', (e) => { if (e.target === el) closeDialog(el); });
}

function parseHash() {
  const h = location.hash.slice(1) || '/';
  const [pathPart, qs] = h.split('?');
  const [path, anchor] = pathPart.split('#');
  return { path: path || '/', query: new URLSearchParams(qs || ''), anchor };
}
const routes = [
  [/^\/$/, pageOverview, 'overview'],
  [/^\/units$/, pageUnits, 'units'],
  [/^\/units\/(\d+)$/, pageUnit, 'units'],
  [/^\/audits$/, pageAudits, 'audits'],
  [/^\/audits\/new$/, pageNewAudit, 'audits'],
  [/^\/audits\/(\d+)$/, pageAudit, 'audits'],
  [/^\/fixes$/, pageFixes, 'fixes'],
  [/^\/fixes\/(\d+)$/, pageFix, 'fixes'],
  [/^\/licences$/, pageLicences, 'licences'],
  [/^\/licences\/(\d+)$/, pageLicences, 'licences'],
  [/^\/framework$/, pageFramework, 'framework'],
];
async function router() {
  const { path, query, anchor } = parseHash();
  const token = ++navToken;
  cleanups.forEach((fn) => fn()); cleanups = [];
  on = {};
  closeDialog(cdlg); closeDialog(dlg);
  const route = routes.find(([re]) => re.test(path));
  if (!route) { mount({ title: 'Not found', body: emptyState({ iconName: 'explore_off', title: 'This page does not exist', action: html`<a class="btn filled" href="#/">Go to overview</a>` }) }); return; }
  const [re, page, nav] = route;
  $$('.nav-item').forEach((a) => (a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  view.classList.add('loading');
  try {
    await page({ params: path.match(re).slice(1), query, token, anchor });
    if (anchor && token === navToken) document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
  } catch (err) {
    if (err instanceof SignInNeeded) return;
    if (token === navToken) {
      mount({ title: 'Something went wrong', body: emptyState({ iconName: 'error', title: 'Could not load this page', text: err.message, action: html`<button class="btn filled" data-click="retry">Try again</button>` }) });
      on.click = { retry: () => router() };
    }
  } finally {
    if (token === navToken) view.classList.remove('loading');
  }
}
const stale = (token) => token !== navToken;
function rerender() { keepScrollOnce = true; return router(); }
function mount({ title, kicker = '', back = null, body, fab = true }) {
  $('#pageTitle').textContent = title;
  $('#kicker').textContent = kicker;
  document.title = `${title} · Bookends Compliance`;
  const b = $('#backBtn');
  b.hidden = !back;
  b.dataset.back = back || '';
  $('#fab').hidden = !fab;
  $('#newAuditBtn').hidden = !fab;
  view.innerHTML = part(body);
  if (!keepScrollOnce) window.scrollTo(0, 0);
  keepScrollOnce = false;
}
$('#backBtn').addEventListener('click', (e) => { if (navCount > 1) history.back(); else location.hash = e.currentTarget.dataset.back || '#/'; });
window.addEventListener('hashchange', () => { navCount += 1; router(); });
window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
$('#avatar').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'Sign out?', text: `Signed in as ${app.me?.name || ''}.`, ok: 'Sign out' });
  if (!ok) return;
  await fetch('/api/auth/logout', { method: 'POST' });
  app.me = null;
  showSignin(false);
});
function setBadge(n) {
  const b = $('#fixBadge');
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : String(n);
  b.setAttribute('aria-label', `${n} Priority 1 fixes open`);
}

// =================================================================== page: overview
async function pageOverview({ token }) {
  const d = await api('/api/overview');
  if (stale(token)) return;
  app.today = d.today;
  const k = d.kpis, fk = k.food;
  setBadge(k.fixes.p1);
  if (!d.units.length) {
    mount({ title: 'Overview', fab: false, body: html`<div class="card">${emptyState({ iconName: 'storefront', title: 'Add your units', text: 'Add each outlet and central kitchen, then run the first audit at each.', action: html`<a class="btn filled" href="#/units?add=1">${icon('add')}Add a unit</a>` })}</div>` });
    return;
  }
  const avgBand = R.bandFor(fk.latestAvg);
  const sharedRow = (g) => html`<details class="list-item" style="display:block">
      <summary style="list-style:none;cursor:pointer;display:flex;gap:12px;align-items:flex-start">
        <span class="lead b-${g.priority === 'critical' ? 'noncompliance' : g.priority === 'major' ? 'improve' : 'none'}">${icon(g.kind === 'paperwork' ? 'description' : 'build')}</span>
        <span class="body"><span class="title clamp-2">${g.title}</span>
          <span class="meta">${prioChip(g.priority)}<b style="color:var(--on-surface)">${g.units.length} units</b><span>${R.DOMAINS[g.domain].label}${g.area ? ` · ${g.area}` : ''}</span>${kindTag(g.kind)}<span>${R.fmtNum(g.marks)} ${g.domain === 'food' ? 'marks' : 'pts'} in total</span></span></span>
        ${icon('expand_more', 'chev')}
      </summary>
      <div class="row-flex small" style="margin:10px 0 0 52px;gap:6px">${g.units.map((u) => html`<a class="tag" href="#/fixes/${u.finding_id}">${u.name}</a>`)}</div>
    </details>`;
  const table = html`<div class="table-wrap"><table class="utable">
      <thead><tr><th>Unit</th><th class="n">Visit 1</th><th class="n">Visit 2</th><th class="n">Change</th><th>Grade now</th><th class="n">Short of ${R.TARGET}%</th><th class="n">P1 open</th><th class="n">Maintenance</th></tr></thead>
      <tbody>${[...d.units].sort((a, b) => (b.food.latest ?? -1) - (a.food.latest ?? -1)).map((u) => {
        const v = u.food.visits;
        return html`<tr data-click="goUnit" data-id="${u.id}"><td><a href="#/units/${u.id}" style="text-decoration:none"><b>${u.name}</b></a> <span class="muted small">${u.city}</span></td>
          <td class="n">${v.length > 1 ? pct(v[0].score) : '—'}</td><td class="n"><b>${pct(u.food.latest)}</b></td><td class="n">${deltaSpan(u.food.delta)}</td>
          <td>${bandChip(u.status.domains.food.level, { small: true })}</td>
          <td class="n">${u.food.route && u.food.latest < R.TARGET ? `${R.fmtNum(u.food.route.needed)} marks` : '—'}</td>
          <td class="n">${u.open.p1 || '—'}</td><td class="n">${u.maintenance.latest ? pct(u.maintenance.latest.score) : html`<span class="muted">not yet</span>`}</td></tr>`;
      })}</tbody></table></div>`;

  mount({
    title: 'Overview', kicker: longDate(d.today),
    body: html`<div class="stack-lg">
      <section class="hero" aria-labelledby="hl">
        <div>
          <span class="kicker">Food safety · where we are</span>
          <h2 id="hl">${pct(fk.latestAvg)} average across ${R.plural(fk.audited, 'unit')}. ${fk.atTarget ? `${fk.atTarget} of ${fk.audited} at ${R.TARGET}%.` : `No unit is at ${R.TARGET}% yet.`}</h2>
          <p><b>Where we want to be:</b> every unit at ${R.TARGET}% (Satisfactory), then ${R.STRETCH}% (Exemplar).</p>
          ${fk.compared ? html`<p>The ${fk.compared} units audited twice moved from <b>${pct(fk.firstAvg)}</b> at visit 1 to <b>${pct(fk.secondAvg)}</b> at visit 2 (${R.fmtDelta(fk.secondAvg - fk.firstAvg)}). ${fk.improved} of ${fk.compared} improved.</p>` : ''}
        </div>
        <div class="hero-score ${avgBand === 'noncompliance' ? '' : avgBand === 'improve' ? 'ni' : 'sa'}">
          <span class="lbl">Average score</span>
          <span class="big">${pct(fk.latestAvg)}</span>
          <span class="line">Latest food safety visit at each unit</span>
          <span class="pill">${R.bandLabel(avgBand)}</span>
        </div>
      </section>

      <section class="grid-kpi" aria-label="Key numbers">
        <a class="card kpi" href="#/units"><span class="label">Units at ${R.TARGET}% or more</span>
          <span class="value">${fk.atTarget}<small> of ${fk.audited}</small></span>
          <span class="sub">Food safety. Maintenance: <b>${k.maintenance.atTarget} of ${k.maintenance.audited}</b> dockets.</span></a>
        <a class="card kpi" href="#/fixes?priority=critical"><span class="label">Priority 1 fixes open</span>
          <span class="value">${k.fixes.p1 ? icon('report', 't-noncompliance fill') : ''}${k.fixes.p1}</span>
          <span class="sub">Act within 48 hours. Then <b>${k.fixes.p2}</b> P2 and <b>${k.fixes.p3}</b> P3.</span></a>
        <a class="card kpi" href="#/fixes?kind=paperwork"><span class="label">Quick wins: paperwork</span>
          <span class="value">${icon('description', 'muted')}${k.fixes.paperwork}</span>
          <span class="sub">Records, certificates and logs. The work often happens; the proof is missing.</span></a>
        <a class="card kpi" href="#/audits?domain=maintenance"><span class="label">Maintenance average</span>
          <span class="value">${k.maintenance.avg != null ? pct(k.maintenance.avg) : '—'}</span>
          ${meter(k.maintenance.avg, { target: true })}
          <span class="sub">${R.plural(k.maintenance.audited, 'docket')} so far.</span></a>
      </section>

      <section class="card" aria-labelledby="prog">
        <div class="card-head"><h2 id="prog">Visit 1 → visit 2 → target</h2><span class="spacer"></span>
          <button class="btn text" data-click="toggleTable" aria-pressed="false">${icon('table')}Show as table</button>
          <span class="sub">Food safety score per unit. The ring is the first visit, the dot the latest; the black line is ${R.TARGET}%. Visit 1 used the 39-point checklist and visit 2 the expanded one, so read the change as a direction, not to the decimal.</span></div>
        <div id="progChart">${progressChart(d.units)}</div>
        <div id="progTable" hidden>${table}</div>
      </section>

      <div class="grid-2">
        <section class="card tight" aria-labelledby="shared">
          <div class="card-head"><h2 id="shared">Fix once, for every unit</h2><span class="spacer"></span><a class="btn text" href="#/fixes?view=problem">All problems</a>
            <span class="sub">The same gap open at 3 or more units. Solve these centrally: one vendor, one contract, one training batch.</span></div>
          <div class="list">${d.shared.length ? d.shared.slice(0, 8).map(sharedRow) : html`<div class="list-item"><span class="muted">No gap is shared by three or more units.</span></div>`}</div>
        </section>
        <div class="stack">
          <section class="card" aria-labelledby="mh">
            <div class="card-head"><h2 id="mh">Maintenance dockets</h2><span class="sub">Latest walk-through at each unit. OK 1 · Observation 0.5 · NC 0.</span></div>
            <div class="bars" style="grid-template-columns:1fr">${d.units.filter((u) => u.maintenance.latest).sort((a, b) => b.maintenance.latest.score - a.maintenance.latest.score).map((u) => html`
              <a class="bar-row" href="#/audits/${u.maintenance.latest.id}" style="text-decoration:none"><span>${u.name}</span><b class="num">${pct(u.maintenance.latest.score)}</b>${meter(u.maintenance.latest.score, { target: true })}</a>`)}</div>
            ${d.units.some((u) => !u.maintenance.latest) ? html`<p class="small muted" style="margin-top:12px">No docket yet: ${d.units.filter((u) => !u.maintenance.latest).map((u) => unitName(u)).join(', ')}.</p>` : ''}
          </section>
          <section class="card tight" aria-labelledby="act">
            <div class="card-head"><h2 id="act">Recent activity</h2></div>
            <div class="list">${d.activity.slice(0, 6).map((a) => html`<div class="list-item" style="min-height:0"><span class="body"><span class="small">${a.finding_title ? html`<a href="#/fixes/${a.entity_id}"><b>${a.finding_title}</b></a>: ` : ''}${a.detail || `${a.entity} ${a.action}`}</span>
              <span class="meta"><span>${a.actor || ''}</span>${a.site_name ? html`<span>${a.site_name}${/Kitchen/.test(a.site_name) ? `, ${a.site_city}` : ''}</span>` : ''}<span>${ago(a.at)}</span></span></span></div>`)}</div>
          </section>
        </div>
      </div>

      <section class="card tight" aria-labelledby="ut">
        <div class="card-head"><h2 id="ut">Where each unit stands</h2><span class="sub">Sorted by latest food safety score. Tap a unit for its route to ${R.TARGET}%.</span></div>
        ${table}
      </section>
    </div>`,
  });
  on.click = {
    toggleTable: (btn) => {
      const show = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(show));
      btn.innerHTML = part(html`${icon(show ? 'insights' : 'table')}${show ? 'Show as chart' : 'Show as table'}`);
      $('#progTable').hidden = !show; $('#progChart').hidden = show;
    },
    goUnit: (el, e) => { if (!e.target.closest('a')) location.hash = `#/units/${el.dataset.id}`; },
  };
}

// =================================================================== page: units
function unitForm(u = {}) {
  return html`<div class="form">
    <div class="field"><label for="uName">Unit name</label><input class="input" id="uName" name="name" required maxlength="120" value="${u.name || ''}" placeholder="e.g. Capiche Vesu"></div>
    <div class="form-2">
      <div class="field"><label for="uBrand">Brand</label><input class="input" id="uBrand" name="brand" value="${u.brand || ''}" placeholder="Capiche, AIKO, Beshak…"></div>
      <div class="field"><label for="uKind">Type</label><select class="input" id="uKind" name="kind"><option value="restaurant" ${u.kind !== 'kitchen' ? 'selected' : ''}>Restaurant / outlet</option><option value="kitchen" ${u.kind === 'kitchen' ? 'selected' : ''}>Central kitchen</option></select><span class="hint">Decides which checklist lines apply.</span></div>
    </div>
    <div class="form-2">
      <div class="field"><label for="uArea">Area</label><input class="input" id="uArea" name="area" value="${u.area || ''}"></div>
      <div class="field"><label for="uCity">City</label><input class="input" id="uCity" name="city" value="${u.city || ''}"></div>
    </div>
    <div class="form-2">
      <div class="field"><label for="uMgr">Unit manager</label><input class="input" id="uMgr" name="manager" value="${u.manager || ''}"><span class="hint">New fixes at this unit are assigned to them.</span></div>
      <div class="field"><label for="uPh">Manager phone</label><input class="input" id="uPh" name="manager_phone" type="tel" value="${u.manager_phone || ''}"></div>
    </div>
  </div>`;
}
function openUnitDialog(u = null) {
  openDialog({
    title: u ? 'Edit unit' : 'Add a unit',
    body: unitForm(u || {}),
    actions: html`${u ? html`<button class="btn text danger" type="button" data-click="archive">Archive</button><span class="spacer"></span>` : ''}<button class="btn text" type="button" data-click="close">Cancel</button><button class="btn filled" value="save">${u ? 'Save' : 'Add unit'}</button>`,
    on: { click: { archive: async () => {
      const ok = await confirmDialog({ title: 'Archive this unit?', text: 'It leaves the dashboard. Its audits and fixes are kept.', ok: 'Archive', danger: true });
      if (!ok) return;
      await api(`/api/sites/${u.id}`, { method: 'PUT', body: { ...u, active: false } });
      toast('Unit archived'); location.hash = '#/units';
    } } },
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd);
      if (!body.name?.trim()) { $('#uName', dlg).classList.add('invalid'); return; }
      if (u) { await api(`/api/sites/${u.id}`, { method: 'PUT', body }); toast('Unit saved'); closeDialog(); rerender(); }
      else { const r = await api('/api/sites', { method: 'POST', body }); toast('Unit added'); closeDialog(); location.hash = `#/units/${r.id}`; }
    },
  });
}

async function pageUnits({ token, query }) {
  const d = await api('/api/sites');
  if (stale(token)) return;
  app.today = d.today;
  const cities = [...new Set(d.units.map((u) => u.city))];
  const card = (u) => {
    const v = u.food.visits;
    return html`<a class="card stack" style="gap:12px" href="#/units/${u.id}">
      <div class="row-flex" style="align-items:flex-start;flex-wrap:nowrap"><div style="flex:1;min-width:0">
        <div style="font-size:19px;font-weight:800;font-stretch:85%">${u.name}</div>
        <div class="small muted">${[u.kind === 'kitchen' ? 'Central kitchen' : u.brand, u.area].filter(Boolean).join(' · ')}</div></div>
        ${bandChip(u.status.overall)}</div>
      <div class="journey">
        <div><span class="k">Visit 1</span><span class="v">${v.length ? pct(v[0].score) : '—'}</span><span class="s">${v[0] ? fmt(v[0].date) : 'not yet'}</span></div>
        <div><span class="k">Visit 2</span><span class="v">${v.length > 1 ? pct(v.at(-1).score) : '—'}</span><span class="s">${v.length > 1 ? deltaSpan(u.food.delta, { unit: ' pts' }) : 'not yet'}</span></div>
        <div class="goal"><span class="k">Target</span><span class="v">${R.TARGET}%</span><span class="s">${u.food.latest >= R.TARGET ? 'reached' : u.food.route ? `${R.fmtNum(u.food.route.needed)} marks to go` : ''}</span></div>
      </div>
      <div class="row-flex small" style="gap:6px 12px">
        <span>${icon('handyman', 'muted')} Maintenance ${u.maintenance.latest ? html`<b>${pct(u.maintenance.latest.score)}</b>` : html`<span class="muted">not yet</span>`}</span>
        <span>${u.open.p1 ? html`${prioChip('critical')} <b>${u.open.p1}</b> open` : html`<span class="muted">No P1 open</span>`}</span>
        <span class="muted">${R.plural(u.open.total, 'fix', 'fixes')} open</span>
      </div>
    </a>`;
  };
  mount({
    title: 'Units', kicker: `${R.plural(d.units.length, 'unit')} · ${cities.join(' & ')}`,
    body: html`<div class="stack">
      <div class="row-flex"><span class="spacer"></span><button class="btn tonal" data-click="add">${icon('add')}Add unit</button></div>
      ${cities.map((c) => html`<h2 class="section-title">${c}</h2><div class="grid-3">${d.units.filter((u) => u.city === c).map(card)}</div>`)}
    </div>`,
  });
  on.click = { add: () => openUnitDialog() };
  if (query.get('add')) { history.replaceState(null, '', '#/units'); openUnitDialog(); }
}

async function pageUnit({ token, params: [id] }) {
  const d = await api(`/api/sites/${id}`);
  if (stale(token)) return;
  app.today = d.today;
  const s = d.site, u = d.summary, st = u.status;
  const food = d.audits.food, maint = d.audits.maintenance;
  const clean = (n) => n.replace(/^[A-C][.—\s-]+/, '').trim();
  const foodSections = () => {
    if (!food.length) return '';
    const names = [...new Set(food.flatMap((a) => (d.sections[a.id] || []).map((x) => clean(x.section))))];
    const cell = (a, n) => { const x = (d.sections[a.id] || []).find((y) => clean(y.section) === n); return x ? pct(x.score) : '—'; };
    return html`<div class="table-wrap"><table class="table num"><thead><tr><th>Section</th>${food.map((a) => html`<th>Visit ${a.visit} · ${fmt(a.audit_date)}</th>`)}</tr></thead>
      <tbody>${names.map((n) => html`<tr><td>${n}</td>${food.map((a) => html`<td>${cell(a, n)}</td>`)}</tr>`)}
      <tr><td><b>Total</b></td>${food.map((a) => html`<td><b>${pct(a.score)}</b> <span class="muted">(${R.fmtNum(a.earned)}/${R.fmtNum(a.possible)})</span></td>`)}</tr></tbody></table></div>`;
  };
  const open = d.findings.filter((f) => R.UNRESOLVED.includes(f.status) || f.status === 'fixed').map((f) => ({ ...f, site_name: s.name, site_city: s.city, site_kind: s.kind, photos: safeList(f.photos) }));
  const byPrio = R.PRIORITY_ORDER.map((p) => [p, open.filter((f) => f.priority === p)]).filter(([, l]) => l.length);
  const lastMaint = maint.at(-1);
  const flags = food.filter((a) => a.flag);
  mount({
    title: s.name, kicker: [s.kind === 'kitchen' ? 'Central kitchen' : s.brand, s.area, s.city].filter(Boolean).join(' · '), back: '#/units',
    body: html`<div class="stack-lg">
      <section class="card stack">
        <div class="row-flex">${bandChip(st.overall)}<span class="muted small">Overall = the lower of food safety and maintenance</span><span class="spacer"></span>
          ${s.manager ? html`<span class="small muted">${icon('person', 'small')} ${s.manager}</span>` : ''}<button class="btn text" data-click="edit">${icon('edit')}Edit</button></div>
        <div><div class="small muted" style="margin-bottom:8px;font-weight:700">Why</div>${reasonsList(st.reasons, { siteId: s.id, showDomain: true })}</div>
      </section>

      <section class="card stack" id="route-food">
        <div class="card-head" style="margin:0">${icon('restaurant', 'muted')}<h2>Food safety: where we are → where we want to be</h2></div>
        ${food.length ? html`
          <div class="journey">
            <div><span class="k">Visit 1 · ${fmt(food[0].audit_date)}</span><span class="v">${pct(food[0].score)}</span><span class="s">${R.bandLabel(food[0].band)}</span></div>
            <div><span class="k">Visit 2${food.length > 1 ? ` · ${fmt(food.at(-1).audit_date)}` : ''}</span><span class="v">${food.length > 1 ? pct(food.at(-1).score) : '—'}</span><span class="s">${food.length > 1 ? html`${R.bandLabel(food.at(-1).band)} ${deltaSpan(u.food.delta, { unit: ' pts' })}` : 'Not done yet'}</span></div>
            <div class="goal"><span class="k">Where we want to be</span><span class="v">${R.TARGET}%</span><span class="s">${u.food.latest >= R.TARGET ? 'Reached' : `${R.fmtNum(u.food.route.needed)} marks to go`}</span></div>
          </div>
          ${flags.map((a) => html`<div class="note-banner">${icon('info')}<span><b>Data note, visit ${a.visit}:</b> ${a.flag}</span></div>`)}
          ${foodSections()}
          <h3 style="font-size:15px;margin-top:4px">Route to ${R.TARGET}%</h3>
          ${routeList(u.food.route, { domain: 'food', unitId: s.id })}`
        : html`<p class="muted">No food safety audit yet.</p><div><a class="btn filled" href="#/audits/new?unit=${s.id}&domain=food">${icon('add')}Start food safety audit</a></div>`}
      </section>

      <section class="card stack" id="route-maintenance">
        <div class="card-head" style="margin:0">${icon('handyman', 'muted')}<h2>Maintenance</h2>${lastMaint ? html`<span class="spacer"></span>${bandChip(lastMaint.band, { small: true })}` : ''}</div>
        ${lastMaint ? html`
          <a class="big-score" href="#/audits/${lastMaint.id}" style="text-decoration:none"><span class="n">${pct(lastMaint.score)}</span><span class="muted small">docket, ${fmt(lastMaint.audit_date, true)} · ${R.fmtNum(lastMaint.earned)} of ${R.fmtNum(lastMaint.possible)} points</span></a>
          ${categoryBars(d.sections[lastMaint.id] || [])}
          <h3 style="font-size:15px;margin-top:4px">Route to ${R.TARGET}%</h3>
          ${routeList(u.maintenance.route, { domain: 'maintenance', unitId: s.id })}`
        : html`<p class="muted">No maintenance docket yet.</p><div><a class="btn outlined" href="#/audits/new?unit=${s.id}&domain=maintenance">${icon('add')}Start maintenance walk-through</a></div>`}
      </section>

      <section class="card tight"><div class="card-head"><h2>All open fixes (${open.length})</h2><span class="spacer"></span><a class="btn text" href="#/fixes?unit=${s.id}">Open in fix plan</a></div>
        ${open.length ? html`<div class="list">${byPrio.map(([p, list]) => html`<div class="group-head">${prioChip(p)}<h3>${R.PRIORITY[p].label}</h3><span class="muted small">${list.length}</span><span class="sub">${R.PRIORITY[p].response}</span></div>${list.map((f) => fixRow(f, { showUnit: false }))}`)}</div>`
          : html`<div class="list"><div class="list-item"><span class="lead b-satisfactory">${icon('check_circle')}</span><span class="body"><span class="title">Nothing open</span></span></div></div>`}
      </section>

      <div class="grid-2 even">
        <section class="card tight"><div class="card-head"><h2>Audit history</h2></div><div class="list">
          ${[...food, ...maint].sort((a, b) => b.audit_date.localeCompare(a.audit_date)).map((a) => html`<a class="list-item" href="#/audits/${a.id}">
            <span class="lead b-none">${icon(R.DOMAINS[a.domain].icon)}</span>
            <span class="body"><span class="title">${R.DOMAINS[a.domain].label} · visit ${a.visit}</span><span class="meta"><span>${fmt(a.audit_date, true)}</span><span>${a.auditor || ''}</span>${a.source === 'import' ? html`<span class="tag">${icon('upload_file')}From report</span>` : ''}</span></span>
            <span class="trail"><b class="num">${pct(a.score)}</b>${bandChip(a.band, { small: true })}</span></a>`)}
          ${!food.length && !maint.length ? html`<div class="list-item"><span class="muted">No audits yet.</span></div>` : ''}</div></section>
        <section class="card tight"><div class="card-head"><h2>Licences</h2><span class="spacer"></span><button class="btn text" data-click="addLicence">${icon('add')}Add</button></div>
          <div class="list">${d.licences.length ? d.licences.map((l) => licenceRow(l, d.today, { showUnit: false })) : html`<div class="list-item"><span class="muted small">No licences recorded yet. Add FSSAI, Fire NOC, water test, pest control and medical fitness with their expiry dates to get 30-day warnings.</span></div>`}</div></section>
      </div>
      ${d.closedFindings.length ? html`<details class="card"><summary style="cursor:pointer;font-weight:700">Recently closed fixes (${d.closedFindings.length})</summary><div class="list" style="margin:12px -16px -16px">${d.closedFindings.map((f) => fixRow({ ...f, site_name: s.name, site_city: s.city, site_kind: s.kind, photos: safeList(f.photos) }, { showUnit: false }))}</div></details>` : ''}
    </div>`,
  });
  on.click = {
    edit: () => openUnitDialog(s),
    addLicence: async () => { const sites = (await api('/api/sites')).units; openLicenceDialog(null, sites, s.id); },
  };
}
function safeList(v) { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } }

// =================================================================== page: audits
async function pageAudits({ token, query }) {
  const unit = query.get('unit') || '', domain = query.get('domain') || '';
  const [d, sites] = await Promise.all([api(`/api/audits?site=${encodeURIComponent(unit)}&domain=${encodeURIComponent(domain)}`), api('/api/sites')]);
  if (stale(token)) return;
  const prevOf = (a) => d.audits.find((x) => x.site_id === a.site_id && x.domain === a.domain && x.visit === a.visit - 1);
  const setQ = (k, v) => { const q = new URLSearchParams(query); v ? q.set(k, v) : q.delete(k); location.hash = `#/audits${q.toString() ? `?${q}` : ''}`; };
  mount({
    title: 'Audits', kicker: `${R.plural(d.audits.length, 'audit')} on record`,
    body: html`<div class="stack">
      <div class="filters" role="toolbar" aria-label="Filter audits">
        ${[['', 'All'], ['food', 'Food safety'], ['maintenance', 'Maintenance']].map(([v, l]) => html`<button class="chip" data-click="domain" data-v="${v}" aria-pressed="${domain === v}">${l}</button>`)}
        <select class="chip" data-change="unit" aria-label="Unit"><option value="">All units</option>${sites.units.map((s) => html`<option value="${s.id}" ${String(s.id) === unit ? 'selected' : ''}>${unitName(s)}</option>`)}</select>
      </div>
      <section class="card tight">${d.audits.length ? html`<div class="list">${d.audits.map((a) => {
        const p = prevOf(a);
        return html`<a class="list-item" href="#/audits/${a.id}">
          <span class="lead b-none">${icon(R.DOMAINS[a.domain].icon)}</span>
          <span class="body"><span class="title">${unitName({ name: a.site_name, city: a.site_city, kind: a.site_kind })}</span>
            <span class="meta"><span>${R.DOMAINS[a.domain].label} · visit ${a.visit}</span><span>${fmt(a.audit_date, true)}</span><span>${a.auditor || ''}</span><span>${R.plural(a.findings_count, 'gap')}</span>${a.flag ? html`<span class="tag" title="${a.flag}">${icon('info')}Data note</span>` : ''}</span></span>
          <span class="trail"><span class="nowrap"><b class="num">${pct(a.score)}</b> ${p ? deltaSpan(a.score - p.score) : ''}</span>${bandChip(a.band, { small: true })}</span></a>`;
      })}</div>` : emptyState({ iconName: 'fact_check', title: 'No audits here yet', action: html`<a class="btn filled" href="#/audits/new">${icon('add')}New audit</a>` })}</section>
    </div>`,
  });
  on.click = { domain: (el) => setQ('domain', el.dataset.v) };
  on.change = { unit: (el) => setQ('unit', el.value) };
}

async function pageAudit({ token, params: [id] }) {
  const d = await api(`/api/audits/${id}`);
  if (stale(token)) return;
  const a = d.audit, scheme = a.scheme;
  const resp = new Map(d.responses.map((r) => [r.item_id, r]));
  const fByItem = new Map(d.findings.map((f) => [f.item_id, f]));
  const unitWord = a.domain === 'food' ? 'marks' : 'points';
  let gapsOnly = true;
  const sections = [...new Set(d.items.map((i) => i.section))];
  const lineHtml = (i) => {
    const r = resp.get(i.id), f = fByItem.get(i.id);
    return html`<div class="list-item" style="display:grid;gap:6px">
      <div class="row-flex" style="gap:8px">${ratingChip(scheme, r.result)}<span class="small muted num">${i.code}</span>${star(i.critical)}${i.criticality ? html`<span class="small muted">${i.criticality}</span>` : ''}${i.area && i.area !== i.section ? html`<span class="small muted">${i.area}</span>` : ''}
        <span class="spacer"></span><span class="small num muted">${r.result === 'na' ? 'N/A' : `${R.fmtNum(r.points)} / ${R.fmtNum(i.weight)}`}</span></div>
      <div>${i.text}</div>
      ${r.note ? html`<div class="small" style="white-space:pre-wrap">“${r.note}”</div>` : ''}
      ${r.photos.length ? html`<div class="thumbs">${r.photos.map((p) => html`<a href="${fileUrl(p)}" target="_blank" rel="noopener"><img class="thumb" src="${fileUrl(p)}" alt="Photo for ${i.code}" loading="lazy"></a>`)}</div>` : ''}
      ${f ? html`<div class="meta small row-flex" style="gap:8px">${prioChip(f.priority)}<a href="#/fixes/${f.id}">Fix #${f.id}</a>${statusTag(f.status)}</div>` : ''}
    </div>`;
  };
  const linesHtml = () => sections.map((sec) => {
    const items = d.items.filter((i) => i.section === sec && (!gapsOnly || ['fail', 'partial'].includes(resp.get(i.id)?.result)));
    if (!items.length) return '';
    const sc = d.sections.find((x) => x.section === sec);
    return html`<div class="group-head"><h3>${sec}</h3><span class="muted small">${sc?.score == null ? '' : pct(sc.score)}</span></div>${items.map(lineHtml)}`;
  });
  const openF = d.findings.filter((f) => f.status !== 'closed');
  const route = {
    ...d.route, score: a.score, open: openF.length,
    afterP1: R.round1(((a.earned + openF.filter((f) => f.priority === 'critical').reduce((x, f) => x + f.marks, 0)) / a.possible) * 100),
    steps: d.route.steps.map((s) => { const f = d.findings.find((x) => x.id === s.id); const it = d.items.find((i) => i.id === f?.item_id); return { ...s, title: f?.title, kind: f?.kind, code: it?.code, area: it?.area }; }),
  };
  const prev = a.previous;
  mount({
    title: unitName({ name: a.site_name, city: a.site_city, kind: a.site_kind }), kicker: `${R.DOMAINS[a.domain].label} · visit ${a.visit} of ${a.visits} · ${fmt(a.audit_date, true)}`, back: '#/audits',
    body: html`<div class="stack-lg">
      <section class="card stack">
        <div class="row-flex" style="align-items:flex-end"><div class="big-score"><span class="n">${pct(a.score)}</span>${bandChip(a.band)}</div><span class="spacer"></span>
          ${prev ? html`<span class="small">Visit ${a.visit - 1}: <b>${pct(prev.score)}</b> ${deltaSpan(a.score - prev.score, { unit: ' pts' })}</span>` : ''}</div>
        ${meter(a.score, { band: a.band, target: true })}
        <p class="small muted">${R.fmtNum(a.earned)} of ${R.fmtNum(a.possible)} ${unitWord}. ${R.SCHEMES[scheme].marking} Bands: Exemplar 90%+, Satisfactory 80%+, Needs Improvement 50%+, Non-Compliance below 50%.</p>
        <div class="row-flex small">${['pass', 'partial', 'fail', 'na'].map((k) => html`${ratingChip(scheme, k)}<b class="num" style="margin-right:6px">${d.counts[k]}</b>`)}${d.counts.criticalFails ? html`<span class="t-noncompliance"><span class="star">★</span> ${R.plural(d.counts.criticalFails, 'critical line')} rated ${R.SCHEMES[scheme].ratings.fail}</span>` : ''}</div>
        <div class="facts">
          <div class="fact"><div class="k">Unit</div><div class="v"><a href="#/units/${a.site_id}">${a.site_name}</a></div></div>
          <div class="fact"><div class="k">Auditor</div><div class="v">${a.auditor || '—'}</div></div>
          <div class="fact"><div class="k">Type</div><div class="v">${a.audit_type || '—'}${a.time_range ? html`<br><span class="small muted">${a.time_range}</span>` : ''}</div></div>
          <div class="fact"><div class="k">Checklist</div><div class="v small">${a.template_name}</div></div>
        </div>
        ${a.flag ? html`<div class="note-banner">${icon('info')}<span><b>Data note:</b> ${a.flag}</span></div>` : ''}
        ${a.source === 'import' ? html`<p class="small muted">${icon('upload_file', 'small')} Loaded from ${a.source_ref}${a.prepared_by ? `, prepared by ${a.prepared_by}` : ''}.</p>` : ''}
      </section>
      ${a.summary ? html`<section class="card"><div class="card-head"><h2>Auditor’s conclusion</h2></div><div class="prose">${a.summary.split('\n').map((p) => html`<p>${p}</p>`)}</div></section>` : ''}
      <div class="grid-2">
        <section class="card"><div class="card-head"><h2>Score by ${a.domain === 'food' ? 'section' : 'category'}</h2></div>${categoryBars(d.sections)}</section>
        <section class="card"><div class="card-head"><h2>Route to ${R.TARGET}%</h2><span class="sub">From this visit’s open fixes.</span></div>${routeList(route, { domain: a.domain, unitId: a.site_id, compact: true })}</section>
      </div>
      <section class="card tight">
        <div class="card-head"><h2>Checklist</h2><span class="spacer"></span>
          <div class="seg" role="group" aria-label="Show"><button type="button" data-click="gaps" data-v="1" aria-pressed="true">Gaps only</button><button type="button" data-click="gaps" data-v="0" aria-pressed="false">All ${d.items.length} lines</button></div></div>
        <div class="list" id="lines">${linesHtml()}</div>
      </section>
    </div>`,
  });
  on.click = {
    gaps: (el) => {
      gapsOnly = el.dataset.v === '1';
      $$('[data-click="gaps"]', view).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === el.dataset.v)));
      $('#lines').innerHTML = part(linesHtml());
    },
  };
}

// =================================================================== page: new audit (the phone flow)
const DRAFT_KEY = 'bk-audit-draft:v2';
const loadDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null; } catch { return null; } };
const saveDraft = (x) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(x)); } catch { /* private mode */ } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

async function pageNewAudit({ token, query }) {
  const [sitesRes, templates] = await Promise.all([api('/api/sites'), getTemplates()]);
  if (stale(token)) return;
  const units = sitesRes.units;
  const fresh = () => ({
    site_id: +query.get('unit') || null, domain: R.AUDIT_DOMAINS.includes(query.get('domain')) ? query.get('domain') : null,
    audit_date: app.today, auditor: app.me?.name || '', audit_type: 'Surprise', answers: {}, summary: '',
  });
  let draft = loadDraft();
  let conflict = null;
  if (draft && !units.some((s) => s.id === draft.site_id)) draft = null;
  if (draft && Object.keys(draft.answers || {}).length && ((query.get('unit') && +query.get('unit') !== draft.site_id) || (query.get('domain') && query.get('domain') !== draft.domain))) { conflict = draft; draft = fresh(); }
  draft = draft || fresh();
  const persist = () => saveDraft(draft);
  const unit = () => units.find((s) => s.id === draft.site_id);
  const tpl = () => templates.find((t) => t.domain === draft.domain && t.active);
  const lines = () => { const t = tpl(), u = unit(); if (!t || !u) return []; return t.items.filter((i) => i.applies === 'Both' || (u.kind === 'kitchen' ? i.applies === 'CPK' : i.applies === 'Restaurant')); };
  const labels = () => R.SCHEMES[tpl().scheme].ratings;

  const itemHtml = (i) => {
    const a = draft.answers[i.id] || {};
    const L = labels();
    const prio = a.result === 'fail' || a.result === 'partial' ? R.priorityFor(i, a.result) : null;
    return html`<div class="item${a.result === 'fail' ? ' is-fail' : a.result === 'partial' ? ' is-partial' : ''}" id="item-${i.id}">
      <div class="item-main stack" style="gap:6px">
        <div class="item-head"><span class="code">${i.code}</span>${star(i.critical)}${i.critical ? html`<span class="small muted">critical</span>` : ''}${i.criticality && !i.critical ? html`<span class="small muted">${i.criticality}</span>` : ''}${i.area && i.area !== i.section ? html`<span class="small muted">${i.area}</span>` : ''}<span class="small muted">· ${R.fmtNum(i.weight)} ${draft.domain === 'food' ? 'marks' : 'pt'}</span></div>
        <div class="text">${i.text}</div>
        ${i.guidance ? html`<div class="guidance">${icon('lightbulb')}<span>${i.guidance}</span></div>` : ''}
      </div>
      <div class="seg answer" role="group" aria-label="Rating for ${i.code}">
        ${['pass', 'partial', 'fail', 'na'].map((v) => html`<button type="button" data-click="answer" data-id="${i.id}" data-v="${v}" aria-pressed="${a.result === v}">${L[v]}</button>`)}
      </div>
      ${prio ? html`<div class="fail-box">
        <label class="sr-only" for="note-${i.id}">Remark</label>
        <textarea class="input" id="note-${i.id}" data-input="note" data-id="${i.id}" rows="2" placeholder="Remark (required): what exactly did you see?">${a.note || ''}</textarea>
        <div class="photo-row">
          ${(a.photos || []).map((p, n) => html`<span style="position:relative"><img class="thumb" src="${fileUrl(p)}" alt="Photo ${n + 1} for ${i.code}"><button type="button" class="icon-btn" style="position:absolute;top:-10px;right:-10px;width:28px;height:28px;background:var(--surface-card);box-shadow:var(--shadow)" data-click="rmPhoto" data-id="${i.id}" data-n="${n}" aria-label="Remove photo">${icon('close')}</button></span>`)}
          ${(a.photos || []).length < 4 ? html`<button type="button" class="btn outlined" data-click="photo" data-id="${i.id}">${icon('photo_camera')}Add photo</button>` : ''}
          <span class="small muted">${prioChip(prio)} ${R.PRIORITY[prio].response}</span>
        </div>
      </div>` : ''}
    </div>`;
  };
  const stats = () => {
    const ls = lines();
    const answers = Object.fromEntries(Object.entries(draft.answers).filter(([, v]) => v.result).map(([k, v]) => [k, v.result]));
    return { ls, s: R.scoreAudit(ls, answers) };
  };
  const barHtml = () => {
    const { ls, s } = stats();
    const answered = ls.filter((i) => draft.answers[i.id]?.result).length;
    return html`<div class="line1"><b class="num">${answered}/${ls.length}</b><span class="muted">rated</span>
        ${s.possible ? html`<span>·</span><span>Live score <b class="num">${pct(s.score)}</b></span>${bandChip(s.band, { small: true })}` : ''}
        ${s.criticalFails ? html`<span class="small t-noncompliance"><span class="star">★</span> ${R.plural(s.criticalFails, 'critical line')} ${labels().fail}</span>` : ''}
        <span class="spacer"></span>
        ${answered < ls.length ? html`<button class="btn text" data-click="next">Next unrated ${icon('arrow_downward')}</button>` : html`<button class="btn text" data-click="toSubmit">Review &amp; submit</button>`}</div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${ls.length}" aria-valuenow="${answered}" aria-label="Checklist progress"><div style="width:${ls.length ? (answered / ls.length) * 100 : 0}%"></div></div>`;
  };
  const secCount = (items) => {
    const n = items.filter((i) => draft.answers[i.id]?.result).length;
    const g = items.filter((i) => ['fail', 'partial'].includes(draft.answers[i.id]?.result)).length;
    return html`<span class="small muted num">${n}/${items.length}</span>${g ? html`<span class="small t-improve">${R.plural(g, 'gap')}</span>` : n === items.length ? icon('check_circle', 't-satisfactory') : ''}`;
  };
  const refresh = (i) => {
    $(`#item-${i.id}`).outerHTML = part(itemHtml(i));
    const b = $('#auditBar'); if (b) b.innerHTML = part(barHtml());
    const el = $(`[data-seccount="${CSS.escape(i.section)}"]`);
    if (el) el.innerHTML = part(secCount(lines().filter((x) => x.section === i.section)));
  };
  const render = () => {
    const t = draft.site_id && draft.domain ? tpl() : null;
    const ls = t ? lines() : [];
    const secs = [...new Set(ls.map((i) => i.section))];
    mount({
      title: 'New audit', kicker: t ? `${R.DOMAINS[draft.domain].label} · ${unitName(unit())}` : 'Walk the unit with your phone', back: '#/audits', fab: false,
      body: html`<div class="stack">
        ${conflict ? html`<div class="note-banner info">${icon('history')}<span style="flex:1">Unfinished ${R.DOMAINS[conflict.domain].label.toLowerCase()} audit for <b>${unitName(units.find((x) => x.id === conflict.site_id))}</b> (${R.plural(Object.keys(conflict.answers).length, 'rating')}).</span><button class="btn text" data-click="resume">Continue it</button></div>` : ''}
        <section class="card form" aria-label="Audit details">
          <div class="form-2">
            <div class="field"><label for="aUnit">Unit</label><select class="input" id="aUnit" data-change="unit"><option value="">Choose a unit…</option>${units.map((s) => html`<option value="${s.id}" ${s.id === draft.site_id ? 'selected' : ''}>${unitName(s)}</option>`)}</select></div>
            <div class="field"><span class="label" id="typeLbl">Audit</span><div class="seg" role="group" aria-labelledby="typeLbl">
              ${R.AUDIT_DOMAINS.map((dom) => html`<button type="button" data-click="domain" data-v="${dom}" aria-pressed="${draft.domain === dom}">${icon(R.DOMAINS[dom].icon)}${R.DOMAINS[dom].label}</button>`)}</div></div>
          </div>
          <div class="form-2">
            <div class="field"><label for="aDate">Date</label><input class="input" type="date" id="aDate" max="${app.today}" value="${draft.audit_date}" data-change="date"></div>
            <div class="field"><label for="aBy">Auditor</label><input class="input" id="aBy" value="${draft.auditor}" data-input="auditor" autocomplete="name"></div>
          </div>
          ${t ? html`<p class="small muted">${t.name}: ${R.plural(ls.length, 'line')} apply to this ${unit().kind === 'kitchen' ? 'kitchen' : 'restaurant'}. ${R.SCHEMES[t.scheme].marking}</p>` : ''}
        </section>
        ${t ? html`
          <div class="audit-bar" id="auditBar">${barHtml()}</div>
          ${secs.map((sec) => { const items = ls.filter((i) => i.section === sec); return html`<details class="section" open>
            <summary><h3>${sec}</h3><span class="row-flex" data-seccount="${sec}">${secCount(items)}</span>${icon('expand_more', 'chev')}</summary>${items.map(itemHtml)}</details>`; })}
          <section class="card form" id="submit">
            <div class="field"><label for="aSum">Conclusion (optional)</label><textarea class="input" id="aSum" data-input="summary" placeholder="Overall standing, what to close first, who was present">${draft.summary || ''}</textarea></div>
            <div id="submitErr" class="error-text" hidden></div>
            <div class="row-flex"><button class="btn text danger" type="button" data-click="discard">Discard draft</button><span class="spacer"></span><button class="btn filled big" type="button" data-click="submit">${icon('send')}Submit audit</button></div>
            <p class="small muted">Ratings are saved on this phone as you go, so you can close the page and come back.</p>
          </section>`
          : html`<div class="card">${emptyState({ iconName: 'checklist', title: 'Choose the unit and the audit', text: 'Food safety uses the FSSAI internal checklist; maintenance uses the inspection docket.' })}</div>`}
      </div>`,
    });
  };
  on.click = {
    resume: () => { draft = conflict; conflict = null; persist(); render(); },
    domain: async (el) => {
      if (el.dataset.v === draft.domain) return;
      if (Object.keys(draft.answers).length) {
        const ok = await confirmDialog({ title: 'Switch audit?', text: `This clears the ${R.plural(Object.keys(draft.answers).length, 'rating')} given so far.`, ok: 'Switch and clear', danger: true });
        if (!ok) return;
      }
      draft.domain = el.dataset.v; draft.answers = {}; persist(); render();
    },
    answer: (el) => {
      const i = lines().find((x) => x.id === +el.dataset.id);
      draft.answers[i.id] = { ...(draft.answers[i.id] || {}), result: el.dataset.v };
      persist(); refresh(i);
      if (el.dataset.v === 'fail' || el.dataset.v === 'partial') $(`#note-${i.id}`)?.focus();
    },
    photo: async (el) => {
      const i = lines().find((x) => x.id === +el.dataset.id);
      const key = await pickAndUpload().catch(() => null);
      if (!key) return;
      const a = draft.answers[i.id];
      a.photos = [...(a.photos || []), key].slice(0, 4);
      persist(); refresh(i);
    },
    rmPhoto: (el) => {
      const i = lines().find((x) => x.id === +el.dataset.id);
      draft.answers[i.id].photos.splice(+el.dataset.n, 1);
      persist(); refresh(i);
    },
    next: () => {
      const i = lines().find((x) => !draft.answers[x.id]?.result);
      if (!i) return;
      const el = $(`#item-${i.id}`);
      el.closest('details').open = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('flagged');
    },
    toSubmit: () => $('#submit').scrollIntoView({ behavior: 'smooth' }),
    discard: async () => {
      const ok = await confirmDialog({ title: 'Discard this draft?', text: 'All ratings, remarks and photos for this audit are removed from this phone.', ok: 'Discard', danger: true });
      if (!ok) return;
      clearDraft(); draft = fresh(); render();
    },
    submit: async (btn) => {
      const ls = lines();
      $$('.flagged').forEach((x) => x.classList.remove('flagged'));
      const missing = ls.filter((i) => !draft.answers[i.id]?.result);
      const noNote = ls.filter((i) => ['fail', 'partial'].includes(draft.answers[i.id]?.result) && !draft.answers[i.id]?.note?.trim());
      const err = $('#submitErr');
      const bad = missing.length ? missing : noNote;
      if (!draft.auditor.trim()) { err.hidden = false; err.textContent = 'Add the auditor’s name.'; $('#aBy').classList.add('invalid'); $('#aBy').focus(); return; }
      if (bad.length) {
        err.hidden = false;
        err.textContent = missing.length ? `${R.plural(missing.length, 'line')} still to rate.` : `Add a remark to ${R.plural(noNote.length, 'line')} rated ${labels().partial} or ${labels().fail}.`;
        bad.forEach((i) => $(`#item-${i.id}`)?.classList.add('flagged'));
        const first = $(`#item-${bad[0].id}`); first.closest('details').open = true; first.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      btn.disabled = true;
      try {
        const r = await api('/api/audits', { method: 'POST', body: {
          site_id: draft.site_id, domain: draft.domain, audit_date: draft.audit_date, auditor: draft.auditor, audit_type: draft.audit_type, summary: draft.summary,
          answers: ls.map((i) => ({ item_id: i.id, result: draft.answers[i.id].result, note: draft.answers[i.id].note || null, photos: draft.answers[i.id].photos || [] })),
        } });
        clearDraft();
        toast(`Audit saved: ${pct(r.score)}, ${R.bandLabel(r.band)} · ${R.plural(r.created, 'fix', 'fixes')} raised${r.autoClosed ? `, ${r.autoClosed} closed by this visit` : ''}`, { ms: 7000 });
        location.hash = `#/audits/${r.id}`;
      } catch (e2) {
        if (e2 instanceof SignInNeeded) return;
        toast(e2.message, { error: true }); err.hidden = false; err.textContent = e2.message;
      } finally { btn.disabled = false; }
    },
  };
  on.change = {
    unit: async (el) => {
      const v = +el.value || null;
      if (Object.keys(draft.answers).length && v !== draft.site_id) {
        const ok = await confirmDialog({ title: 'Change unit?', text: 'Ratings given so far move with the audit. Only continue if the wrong unit was picked.', ok: 'Change unit' });
        if (!ok) { el.value = draft.site_id || ''; return; }
      }
      draft.site_id = v; persist(); render();
    },
    date: (el) => { draft.audit_date = el.value || app.today; persist(); },
  };
  on.input = {
    note: (el) => { const idv = +el.dataset.id; draft.answers[idv] = { ...draft.answers[idv], note: el.value }; el.classList.remove('invalid'); persist(); },
    auditor: (el) => { draft.auditor = el.value; el.classList.remove('invalid'); persist(); },
    summary: (el) => { draft.summary = el.value; persist(); },
  };
  render();
}

// =================================================================== page: fix plan
const STATUS_FILTERS = [
  ['open', 'Open', (f) => R.UNRESOLVED.includes(f.status)],
  ['overdue', 'Overdue', (f, today) => R.UNRESOLVED.includes(f.status) && f.due_date < today],
  ['fixed', 'Awaiting verification', (f) => f.status === 'fixed'],
  ['closed', 'Closed', (f) => f.status === 'closed'],
  ['all', 'All', () => true],
];
async function pageFixes({ token, query }) {
  const [d, sites] = await Promise.all([api('/api/findings'), api('/api/sites')]);
  if (stale(token)) return;
  app.today = d.today;
  const state = {
    view: query.get('view') === 'problem' ? 'problem' : 'priority',
    status: STATUS_FILTERS.some(([k]) => k === query.get('status')) ? query.get('status') : 'open',
    priority: query.get('priority') || '', unit: query.get('unit') || '', domain: query.get('domain') || '', kind: query.get('kind') || '',
  };
  const LIMIT = 40;
  const expanded = new Set();
  const base = () => d.findings.filter((f) => (!state.unit || String(f.site_id) === state.unit) && (!state.domain || f.domain === state.domain)
    && (!state.priority || f.priority === state.priority) && (!state.kind || f.kind === state.kind));
  const rows = () => { const pred = STATUS_FILTERS.find(([k]) => k === state.status)[2]; return base().filter((f) => pred(f, d.today)); };
  const sortFix = (a, b) => R.PRIORITY_ORDER.indexOf(a.priority) - R.PRIORITY_ORDER.indexOf(b.priority) || (a.kind === 'paperwork' ? 0 : 1) - (b.kind === 'paperwork' ? 0 : 1) || b.marks - a.marks || a.due_date.localeCompare(b.due_date);
  const listHtml = () => {
    const rs = rows();
    if (!rs.length) return emptyState({ iconName: 'task_alt', title: 'Nothing here', text: 'No fixes match these filters.' });
    if (state.view === 'problem') {
      const groups = new Map();
      for (const f of rs) {
        const key = `${f.domain}:${f.item_area || ''}:${f.title}`;
        if (!groups.has(key)) groups.set(key, { title: f.title, area: f.item_area, domain: f.domain, kind: f.kind, priority: f.priority, marks: 0, list: [] });
        const g = groups.get(key);
        if (R.PRIORITY_ORDER.indexOf(f.priority) < R.PRIORITY_ORDER.indexOf(g.priority)) g.priority = f.priority;
        g.marks += f.marks; g.list.push(f);
      }
      const gs = [...groups.values()].sort((a, b) => b.list.length - a.list.length || R.PRIORITY_ORDER.indexOf(a.priority) - R.PRIORITY_ORDER.indexOf(b.priority));
      return html`<div class="list">${gs.map((g) => html`<details class="list-item" style="display:block">
        <summary style="list-style:none;cursor:pointer;display:flex;gap:12px;align-items:flex-start">
          <span class="lead b-${g.priority === 'critical' ? 'noncompliance' : g.priority === 'major' ? 'improve' : 'none'}"><b>${g.list.length}</b></span>
          <span class="body"><span class="title clamp-2">${g.title}</span><span class="meta">${prioChip(g.priority)}<span>${R.plural(new Set(g.list.map((f) => f.site_id)).size, 'unit')}</span><span>${R.DOMAINS[g.domain].label}${g.area ? ` · ${g.area}` : ''}</span>${kindTag(g.kind)}<span>${R.fmtNum(g.marks)} ${g.domain === 'food' ? 'marks' : 'pts'}</span></span></span>${icon('expand_more', 'chev')}</summary>
        <div class="list" style="margin:8px -16px -12px">${g.list.sort(sortFix).map((f) => fixRow(f))}</div></details>`)}</div>`;
    }
    return html`<div class="list">${R.PRIORITY_ORDER.map((p) => {
      const l = rs.filter((f) => f.priority === p).sort(sortFix);
      if (!l.length) return '';
      const shown = expanded.has(p) ? l : l.slice(0, LIMIT);
      const paper = l.filter((f) => f.kind === 'paperwork').length;
      return html`<div class="group-head">${prioChip(p)}<h3>${R.PRIORITY[p].label}</h3><span class="muted small">${l.length}${paper ? ` · ${paper} paperwork` : ''}</span><span class="sub">${R.PRIORITY[p].meaning} ${R.PRIORITY[p].response}</span></div>
        ${shown.map((f) => fixRow(f))}${l.length > shown.length ? html`<button class="list-more" data-click="more" data-p="${p}">Show all ${l.length}</button>` : ''}`;
    })}</div>`;
  };
  const chipsHtml = () => html`
    <div class="seg" role="group" aria-label="View" style="flex:none">${[['priority', 'By priority'], ['problem', 'By problem']].map(([v, l]) => html`<button type="button" data-click="view" data-v="${v}" aria-pressed="${state.view === v}">${l}</button>`)}</div>
    ${STATUS_FILTERS.map(([k, l, pred]) => html`<button class="chip" data-click="status" data-v="${k}" aria-pressed="${state.status === k}">${l} <span class="count">${base().filter((f) => pred(f, d.today)).length}</span></button>`)}
    <select class="chip" data-change="priority" aria-label="Priority"><option value="">Any priority</option>${R.PRIORITY_ORDER.map((p) => html`<option value="${p}" ${state.priority === p ? 'selected' : ''}>${R.PRIORITY[p].label}</option>`)}</select>
    <select class="chip" data-change="kind" aria-label="Kind"><option value="">Paperwork &amp; on-site</option><option value="paperwork" ${state.kind === 'paperwork' ? 'selected' : ''}>Paperwork only</option><option value="physical" ${state.kind === 'physical' ? 'selected' : ''}>On-site only</option></select>
    <select class="chip" data-change="domain" aria-label="Audit"><option value="">Food &amp; maintenance</option>${R.AUDIT_DOMAINS.map((x) => html`<option value="${x}" ${state.domain === x ? 'selected' : ''}>${R.DOMAINS[x].label}</option>`)}</select>
    <select class="chip" data-change="unit" aria-label="Unit"><option value="">All units</option>${sites.units.map((s) => html`<option value="${s.id}" ${String(s.id) === state.unit ? 'selected' : ''}>${unitName(s)}</option>`)}</select>`;
  const summaryHtml = () => {
    const rs = rows();
    return html`<b>${R.plural(rs.length, 'fix', 'fixes')}</b> · ${R.PRIORITY_ORDER.map((p) => `${rs.filter((f) => f.priority === p).length} ${R.PRIORITY[p].short}`).join(' · ')} · ${rs.filter((f) => f.kind === 'paperwork').length} paperwork · ${R.fmtNum(R.round1(rs.reduce((s, f) => s + (f.domain === 'food' ? f.marks : 0), 0)))} food safety marks to win back`;
  };
  const sync = () => {
    const q = new URLSearchParams(Object.entries(state).filter(([k, v]) => v && !(k === 'status' && v === 'open') && !(k === 'view' && v === 'priority')));
    history.replaceState(null, '', `#/fixes${q.toString() ? `?${q}` : ''}`);
    $('#chips').innerHTML = part(chipsHtml());
    $('#fixSummary').innerHTML = part(summaryHtml());
    $('#fixList').innerHTML = part(listHtml());
  };
  mount({
    title: 'Fix plan', kicker: 'What to fix, in what order',
    body: html`<div class="stack">
      <div class="filters" id="chips" role="toolbar" aria-label="Filter fixes">${chipsHtml()}</div>
      <p class="small" id="fixSummary">${summaryHtml()}</p>
      <p class="small muted">Inside each priority: paperwork first (quick to close), then the biggest mark gains. Priority 1: act within 48 hours · Priority 2: 7 days · Priority 3: 30 days. Deadlines for the Aug–Sep reports start from 26 Sep 2026, the day they were loaded.</p>
      <section class="card tight" id="fixList">${listHtml()}</section>
    </div>`,
  });
  on.click = {
    status: (el) => { state.status = el.dataset.v; sync(); },
    view: (el) => { state.view = el.dataset.v; sync(); },
    more: (el) => { expanded.add(el.dataset.p); $('#fixList').innerHTML = part(listHtml()); },
  };
  on.change = Object.fromEntries(['priority', 'kind', 'domain', 'unit'].map((k) => [k, (el) => { state[k] = el.value; sync(); }]));
}

async function pageFix({ token, params: [id] }) {
  const d = await api(`/api/findings/${id}`);
  if (stale(token)) return;
  app.today = d.today;
  const f = d.finding;
  const closed = f.status === 'closed';
  let evidence = f.evidence_key;
  const unitWord = f.domain === 'food' ? 'marks' : 'points';
  const due = dueInfo(f);
  const evidenceHtml = () => (evidence
    ? html`<a href="${fileUrl(evidence)}" target="_blank" rel="noopener"><img class="thumb-lg" src="${fileUrl(evidence)}" alt="Proof of the fix"></a>${closed ? '' : html`<div><button class="btn text danger" type="button" data-click="rmEvidence">Remove photo</button></div>`}`
    : closed ? html`<p class="muted small">No photo.</p>` : html`<button class="btn outlined" type="button" data-click="evidence">${icon('photo_camera')}Add proof photo</button>`);
  const buttons = {
    open: html`<button class="btn text" data-click="save">Save</button><button class="btn tonal" data-click="to" data-v="in_progress">Start work</button><button class="btn filled" data-click="to" data-v="fixed">${icon('done')}Mark fixed</button>`,
    in_progress: html`<button class="btn text" data-click="save">Save</button><button class="btn filled" data-click="to" data-v="fixed">${icon('done')}Mark fixed</button>`,
    fixed: html`<button class="btn text" data-click="save">Save</button><button class="btn tonal" data-click="sendBack">${icon('undo')}Send back</button><button class="btn filled" data-click="close">${icon('verified')}Verify &amp; close</button>`,
    closed: html`<button class="btn tonal" data-click="reopen">${icon('restart_alt')}Reopen</button>`,
  }[f.status];
  mount({
    title: `Fix #${f.id}`, kicker: `${unitName(f)} · ${R.DOMAINS[f.domain].label}`, back: '#/fixes', fab: false,
    body: html`<div class="stack-lg">
      <section class="card stack">
        <div class="row-flex">${prioChip(f.priority)}<b>${R.PRIORITY[f.priority].label}</b>${f.scheme ? ratingChip(f.scheme, f.rating) : ''}${star(f.item_critical)}${kindTag(f.kind)}${statusTag(f.status)}${repeatTag(f)}</div>
        <h2 style="font-size:22px;line-height:1.3;font-stretch:90%;font-weight:700">${f.title}</h2>
        <p class="small">${R.PRIORITY[f.priority].response} Closing it wins back <b>${R.fmtNum(f.marks)} ${unitWord}</b>${f.possible ? html` (<b>+${R.fmtNum(R.round1((f.marks / f.possible) * 100))} pts</b> on this unit’s score)` : ''}.</p>
        <div class="facts">
          <div class="fact"><div class="k">Unit</div><div class="v"><a href="#/units/${f.site_id}">${unitName(f)}</a></div></div>
          <div class="fact"><div class="k">Found</div><div class="v">${f.audit_id ? html`<a href="#/audits/${f.audit_id}">${fmt(f.audit_date, true)}</a>` : fmt(tsDate(f.created_at), true)}${f.item_code ? html` <span class="muted small">(${f.item_code}${f.item_area ? `, ${f.item_area}` : ''})</span>` : ''}</div></div>
          <div class="fact"><div class="k">Due</div><div class="v ${due.tone ? `t-${due.tone}` : ''}">${fmt(f.due_date, true)}<br><span class="small">${due.text}</span></div></div>
          <div class="fact"><div class="k">Owner</div><div class="v">${f.owner || '—'}</div></div>
        </div>
      </section>
      <div class="grid-2 even">
        <section class="card stack">
          <div class="card-head" style="margin:0"><h2>What the auditor saw</h2></div>
          ${f.detail ? html`<p style="white-space:pre-wrap">${f.detail}</p>` : html`<p class="muted">No remark.</p>`}
          ${f.photos.length ? html`<div class="thumbs">${f.photos.map((p) => html`<a href="${fileUrl(p)}" target="_blank" rel="noopener"><img class="thumb-lg" style="max-width:260px" src="${fileUrl(p)}" alt="Photo from the audit" loading="lazy"></a>`)}</div>` : ''}
          ${f.guidance ? html`<div class="small muted" style="display:flex;gap:6px">${icon('lightbulb')}<span><b>How to verify:</b> ${f.guidance}</span></div>` : ''}
        </section>
        <section class="card form" aria-label="Corrective action">
          <div class="card-head" style="margin:0"><h2>Corrective action</h2></div>
          <div class="form-2">
            <div class="field"><label for="fOwner">Owner</label><input class="input" id="fOwner" value="${f.owner || ''}" ${closed ? 'disabled' : ''} placeholder="Who will fix it"></div>
            <div class="field"><label for="fDue">Due date</label><input class="input" type="date" id="fDue" value="${f.due_date}" ${closed ? 'disabled' : ''}><span class="hint">Moving a date is recorded in the history.</span></div>
          </div>
          <div class="field"><label for="fRoot">Root cause</label><textarea class="input" id="fRoot" ${closed ? 'disabled' : ''} placeholder="Why did it happen? e.g. nobody owns the pest-control file">${f.root_cause || ''}</textarea></div>
          <div class="field"><label for="fAct">What was done</label><textarea class="input" id="fAct" ${closed ? 'disabled' : ''} placeholder="The fix, and what stops it coming back">${f.action_taken || ''}</textarea></div>
          <div class="field"><span class="label">Proof of the fix</span><div id="evidence" class="stack" style="gap:8px">${evidenceHtml()}</div></div>
          ${closed ? html`<p class="small muted">${icon('task_alt', 'small')} Closed ${fmt(tsDate(f.closed_at), true)} by ${f.closed_by}${f.close_note ? html`: “${f.close_note}”` : ''}</p>` : ''}
          <div id="formErr" class="error-text" hidden></div>
        </section>
      </div>
      <div class="sticky-actions">${buttons}</div>
      <section class="card"><div class="card-head"><h2>History</h2></div>
        <ul class="timeline">${d.history.map((h) => html`<li><span><b>${h.actor}</b> ${h.detail}<br><span class="small muted">${ago(h.at)}</span></span></li>`)}
          <li><span>Found at the ${f.audit_date ? `${fmt(f.audit_date, true)} audit` : 'audit'}${f.is_repeat ? ' (also failed at the previous visit)' : ''}</span></li></ul>
      </section>
    </div>`,
  });
  const collect = () => ({ owner: $('#fOwner').value, due_date: $('#fDue').value, root_cause: $('#fRoot').value, action_taken: $('#fAct').value, evidence_key: evidence || null });
  const patch = async (extra, msg) => {
    const err = $('#formErr');
    err.hidden = true;
    try { await api(`/api/findings/${f.id}`, { method: 'PATCH', body: { ...collect(), ...extra } }); toast(msg); rerender(); }
    catch (e) { if (e instanceof SignInNeeded) return; err.hidden = false; err.textContent = e.message; toast(e.message, { error: true }); }
  };
  on.click = {
    save: () => patch({}, 'Saved'),
    to: (el) => {
      if (el.dataset.v === 'fixed' && !$('#fAct').value.trim()) {
        $('#fAct').classList.add('invalid'); $('#fAct').focus();
        const err = $('#formErr'); err.hidden = false; err.textContent = 'Describe what was done before marking it fixed. A proof photo makes verification quick.';
        return;
      }
      patch({ status: el.dataset.v }, el.dataset.v === 'fixed' ? 'Marked fixed. The Compliance Head will verify it.' : 'Work started');
    },
    close: async () => {
      const r = await confirmDialog({ title: 'Verify and close?', text: 'Close it only after checking the fix yourself, on site or from the proof photo.', ok: 'Verify & close', withNote: { label: 'Closing note (optional)' } });
      if (r) patch({ status: 'closed', close_note: r.note || null }, 'Fix verified and closed');
    },
    sendBack: async () => {
      const r = await confirmDialog({ title: 'Send back to the unit?', text: 'It goes back to Open. Say what is still missing.', ok: 'Send back', withNote: { label: 'What is still missing?', required: true } });
      if (r) patch({ status: 'open', note: r.note }, 'Sent back to the unit');
    },
    reopen: async () => {
      const r = await confirmDialog({ title: 'Reopen this fix?', text: 'Use this if the problem has come back.', ok: 'Reopen', withNote: { label: 'Why?', required: true } });
      if (r) patch({ status: 'open', note: r.note }, 'Fix reopened');
    },
    evidence: async () => { const key = await pickAndUpload().catch(() => null); if (key) { evidence = key; $('#evidence').innerHTML = part(evidenceHtml()); } },
    rmEvidence: () => { evidence = null; $('#evidence').innerHTML = part(evidenceHtml()); },
  };
  $('#fAct')?.addEventListener('input', (e) => e.target.classList.remove('invalid'));
}

// =================================================================== page: licences
function openLicenceDialog(l, units, presetUnit = null) {
  const known = R.LICENCE_TYPES.some((t) => t.type === l?.type);
  let fileKey = l?.file_key || null;
  const fileHtml = () => (fileKey
    ? html`<div class="row-flex"><a class="btn text" href="${fileUrl(fileKey)}" target="_blank" rel="noopener">${icon('attach_file')}View scan</a><button class="btn text danger" type="button" data-click="rmFile">Remove</button></div>`
    : html`<button class="btn outlined" type="button" data-click="file">${icon('upload')}Upload scan or photo</button>`);
  openDialog({
    title: l ? 'Edit licence' : 'Add licence',
    body: html`<div class="form">
      <div class="field"><label for="lSite">Unit</label><select class="input" id="lSite" name="site_id" required>${units.map((s) => html`<option value="${s.id}" ${(l?.site_id ?? presetUnit) === s.id ? 'selected' : ''}>${unitName(s)}</option>`)}</select></div>
      <div class="field"><label for="lType">Licence or certificate</label><select class="input" id="lType" name="typeSel" data-change="type">
        ${R.LICENCE_TYPES.map((t) => html`<option value="${t.type}" ${l?.type === t.type ? 'selected' : ''}>${t.type}</option>`)}<option value="__other" ${l && !known ? 'selected' : ''}>Other…</option></select></div>
      <div class="field" id="otherWrap" ${l && !known ? '' : 'hidden'}><label for="lOther">Name</label><input class="input" id="lOther" name="typeOther" value="${l && !known ? l.type : ''}"></div>
      <div class="form-2">
        <div class="field"><label for="lNum">Number</label><input class="input" id="lNum" name="number" value="${l?.number || ''}"></div>
        <div class="field"><label for="lAuth">Issued by</label><input class="input" id="lAuth" name="authority" value="${l?.authority || ''}"></div>
      </div>
      <div class="form-2">
        <div class="field"><label for="lIss">Issued on</label><input class="input" type="date" id="lIss" name="issued_on" value="${l?.issued_on || ''}"></div>
        <div class="field"><label for="lExp">Expires on</label><input class="input" type="date" id="lExp" name="expires_on" value="${l?.expires_on || ''}"><span class="hint">Leave empty if it never expires.</span></div>
      </div>
      <div class="field"><label for="lSev">If it lapses</label><select class="input" id="lSev" name="severity">${[['critical', 'Critical: the unit is Non-Compliance'], ['major', 'Major: the unit is Non-Compliance'], ['minor', 'Minor: Needs Improvement']].map(([v, t]) => html`<option value="${v}" ${(l?.severity || R.LICENCE_TYPES[0].severity) === v ? 'selected' : ''}>${t}</option>`)}</select></div>
      <div class="field"><span class="label">Document</span><div id="lFile">${fileHtml()}</div></div>
      <div class="field"><label for="lNotes">Notes</label><textarea class="input" id="lNotes" name="notes" rows="2">${l?.notes || ''}</textarea></div>
    </div>`,
    actions: html`${l ? html`<button class="btn text danger" type="button" data-click="del">Delete</button><span class="spacer"></span>` : ''}<button class="btn text" type="button" data-click="close">Cancel</button><button class="btn filled" value="save">Save</button>`,
    on: {
      change: { type: (el) => { const t = R.LICENCE_TYPES.find((x) => x.type === el.value); $('#otherWrap', dlg).hidden = el.value !== '__other'; if (t) $('#lSev', dlg).value = t.severity; } },
      click: {
        file: async () => { const k = await pickAndUpload({ accept: 'image/*,application/pdf' }).catch(() => null); if (k) { fileKey = k; $('#lFile', dlg).innerHTML = part(fileHtml()); } },
        rmFile: () => { fileKey = null; $('#lFile', dlg).innerHTML = part(fileHtml()); },
        del: async () => {
          const ok = await confirmDialog({ title: 'Delete this licence?', text: 'It is removed from the register; the deletion is recorded.', ok: 'Delete', danger: true });
          if (!ok) return;
          await api(`/api/licences/${l.id}`, { method: 'DELETE' });
          toast('Licence deleted'); location.hash = '#/licences';
        },
      },
    },
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd);
      body.type = body.typeSel === '__other' ? (body.typeOther || '').trim() : body.typeSel;
      if (!body.type) { $('#lOther', dlg).classList.add('invalid'); return; }
      body.file_key = fileKey;
      if (l) await api(`/api/licences/${l.id}`, { method: 'PUT', body }); else await api('/api/licences', { method: 'POST', body });
      toast('Licence saved'); closeDialog();
      if (location.hash.startsWith('#/licences/')) location.hash = '#/licences'; else rerender();
    },
  });
}
async function pageLicences({ token, params: [openId], query }) {
  const [d, sitesRes] = await Promise.all([api('/api/licences'), api('/api/sites')]);
  if (stale(token)) return;
  app.today = d.today;
  const units = sitesRes.units;
  const kindOf = new Map(units.map((u) => [u.id, u.kind]));
  d.licences.forEach((l) => { l.site_kind = kindOf.get(l.site_id); });
  let unit = query.get('unit') || '';
  const groups = () => {
    const rows = d.licences.filter((l) => !unit || String(l.site_id) === unit);
    const left = (l) => (l.expires_on ? R.daysBetween(d.today, l.expires_on) : null);
    return [
      ['Expired', 'noncompliance', rows.filter((l) => left(l) != null && left(l) < 0)],
      [`Due within ${R.LICENCE_WARN_DAYS} days`, 'improve', rows.filter((l) => left(l) != null && left(l) >= 0 && left(l) <= R.LICENCE_WARN_DAYS)],
      [`Due within ${R.LICENCE_NOTICE_DAYS} days`, null, rows.filter((l) => left(l) != null && left(l) > R.LICENCE_WARN_DAYS && left(l) <= R.LICENCE_NOTICE_DAYS)],
      ['Valid', 'satisfactory', rows.filter((l) => left(l) != null && left(l) > R.LICENCE_NOTICE_DAYS)],
      ['No expiry date', null, rows.filter((l) => left(l) == null)],
    ].filter(([, , r]) => r.length);
  };
  const body = () => {
    const g = groups();
    return g.length ? g.map(([title, tone, rows]) => html`<section class="card tight"><div class="card-head">${tone ? icon(R.LEVELS[tone].icon, `t-${tone}`) : icon('event', 'muted')}<h2>${title}</h2><span class="muted small">${rows.length}</span></div><div class="list">${rows.map((l) => licenceRow(l, d.today))}</div></section>`)
      : html`<div class="card">${emptyState({ iconName: 'verified', title: 'No licences recorded yet', text: 'The audits show gaps in FSSAI display, water reports, pest-control records, medical fitness and FoSTaC. Record each with its expiry date and the dashboard warns 30 days ahead.', action: html`<button class="btn filled" data-click="add">${icon('add')}Add licence</button>` })}</div>`;
  };
  mount({
    title: 'Licences', kicker: 'Licences & certificates register',
    body: html`<div class="stack">
      <div class="row-flex"><select class="chip" data-change="unit" aria-label="Unit"><option value="">All units</option>${units.map((s) => html`<option value="${s.id}" ${String(s.id) === unit ? 'selected' : ''}>${unitName(s)}</option>`)}</select><span class="spacer"></span><button class="btn tonal" data-click="add">${icon('add')}Add licence</button></div>
      <div class="stack" id="licGroups">${body()}</div>
    </div>`,
  });
  on.click = { add: () => openLicenceDialog(null, units, unit ? +unit : null) };
  on.change = { unit: (el) => { unit = el.value; $('#licGroups').innerHTML = part(body()); } };
  if (openId) {
    const l = d.licences.find((x) => x.id === +openId);
    if (l) { openLicenceDialog(l, units); dlg.addEventListener('close', () => { if (location.hash.startsWith('#/licences/')) history.replaceState(null, '', '#/licences'); }, { once: true }); }
  }
}

// =================================================================== page: framework
async function pageFramework({ token }) {
  const templates = await getTemplates();
  if (stale(token)) return;
  let active = templates.find((t) => t.scheme === 'fssai2')?.id;
  const checklist = () => {
    const t = templates.find((x) => x.id === active);
    const secs = [...new Set(t.items.map((i) => i.section))];
    return html`<p class="small muted" style="margin-bottom:12px">${t.name}: ${R.plural(t.items.length, 'line')}, ${t.items.filter((i) => i.critical).length} ★ critical. ${t.description || ''}</p>
      ${secs.map((s) => html`<h3 style="font-size:14px;margin:16px 0 4px">${s}</h3><div class="list">${t.items.filter((i) => i.section === s).map((i) => html`<div class="list-item" style="padding-left:0;padding-right:0;min-height:0">
        <span class="small muted num" style="width:44px;flex:none">${i.code}</span><span class="body"><span class="small">${i.text}</span>${i.area && i.area !== s ? html`<span class="meta">${i.area}${i.applies !== 'Both' ? ` · ${i.applies} only` : ''}</span>` : ''}</span>${star(i.critical)}${i.criticality ? html`<span class="small muted">${i.criticality}</span>` : html`<span class="small muted num">${i.weight}</span>`}</div>`)}</div>`)}`;
  };
  const steps = [
    ['Audit', 'Walk the unit on a phone. Rate every line; a remark and a photo for every gap.'],
    ['Score', 'Marks earned ÷ marks possible. N/A lines are left out. ★ critical lines count double.'],
    ['Prioritise', 'Every gap becomes a fix: Priority 1, 2 or 3, with a due date and the marks it wins back.'],
    ['Fix', 'The unit closes paperwork first, then on-site fixes, and uploads proof.'],
    ['Verify', 'The Compliance Head checks and closes, or sends back.'],
    ['Re-audit', 'Next visit within 30 days. Compare visit to visit; repeat gaps are flagged.'],
  ];
  const bandText = { exemplar: '90% or more. Where the best units go next.', satisfactory: '80–89%. Where every unit has to be: the target.',
    improve: '50–79%. Working, but with gaps a regulator would write up.', noncompliance: 'Below 50%. Re-audit within 3 weeks of the fixes being closed.' };
  mount({
    title: 'Framework', kicker: 'How compliance is measured at Bookends',
    body: html`<div class="stack-lg">
      <section class="hero"><div><span class="kicker">The rules</span>
        <h2>Every unit at 80% (Satisfactory), then 90% (Exemplar). Every gap fixed with proof.</h2>
        <p>These are the marking rules and grade bands used in Vishal Patel’s audit reports. The dashboard scores with the same code this page is built from.</p></div></section>

      <section class="stack"><h2 class="section-title">1 · The grade bands</h2>
        <div class="band-demo" role="img" aria-label="Below 50 Non-Compliance, 50 to 79 Needs Improvement, 80 to 89 Satisfactory, 90 and above Exemplar">
          <div class="b-noncompliance">Below 50%: Non-Compliance</div><div class="b-improve">50–79%: Needs Improvement</div><div class="b-satisfactory">80–89%</div><div class="b-exemplar">90%+</div></div>
        <div class="def-grid four">${['exemplar', 'satisfactory', 'improve', 'noncompliance'].map((k) => html`<div class="card stack" style="gap:8px">${bandChip(k)}<p class="small">${bandText[k]}</p></div>`)}</div>
        <p class="small muted">A unit gets a band for food safety and for maintenance. Its overall status is the lower of the two, always shown with the reason.</p></section>

      <section class="stack"><h2 class="section-title">2 · Marking</h2>
        <div class="def-grid three">${['fssai2', 'docket', 'fssai1'].map((k) => html`<div class="card stack" style="gap:8px"><b>${R.SCHEMES[k].name}</b><div class="row-flex">${['pass', 'partial', 'fail', 'na'].map((r) => ratingChip(k, r))}</div><p class="small muted">${R.SCHEMES[k].marking}</p>${k === 'fssai1' ? html`<p class="small muted">Used for the first visits in Aug 2026.</p>` : ''}</div>`)}</div></section>

      <section class="stack"><h2 class="section-title">3 · Priorities for fixing</h2>
        <div class="card tight"><div class="table-wrap"><table class="table"><thead><tr><th>Priority</th><th>What it is</th><th>Fix within</th></tr></thead>
          <tbody>${R.PRIORITY_ORDER.map((p) => html`<tr><td class="nowrap">${prioChip(p)} ${R.PRIORITY[p].label}</td><td>${R.PRIORITY[p].meaning}</td><td class="nowrap">${R.plural(R.PRIORITY[p].fixDays, 'day')}</td></tr>`)}</tbody></table></div></div>
        <p class="small muted">Within a priority: <b>paperwork first</b> (records, certificates, logs: the work is often done but not written down, so it closes in a week or two), then the fixes that win back the most marks.</p></section>

      <section class="stack"><h2 class="section-title">4 · From audit to 80%</h2>
        <div class="steps">${steps.map(([t, s]) => html`<div class="step"><b>${t}</b><span>${s}</span></div>`)}</div>
        <div class="card prose small"><ul>
          <li><b>Route to 80%:</b> for each unit, the shortest ordered list of fixes that lifts the score to ${R.TARGET}%, Priority 1 first.</li>
          <li><b>Fix once:</b> a gap open at three or more units (pest-control records, water reports, FoSTaC) is solved centrally, not outlet by outlet.</li>
          <li>Rating a line Compliant at the next visit closes its fix automatically; still failing marks it a <b>repeat</b>.</li>
          <li>Every change (status, due date, owner, proof) is recorded with who and when.</li>
        </ul></div></section>

      <section class="stack"><h2 class="section-title">5 · Who does what</h2>
        <div class="def-grid">${R.ROLES.map((r) => html`<div class="card stack" style="gap:6px"><b>${r.role}</b><span class="small muted">${r.who}</span><p class="small">${r.owns}</p></div>`)}</div></section>
      <section class="stack"><h2 class="section-title">6 · Escalation</h2>
        <div class="card prose"><ol>${R.ESCALATION.map((e) => html`<li>${e}</li>`)}</ol></div></section>

      <section class="stack"><h2 class="section-title">7 · The checklists</h2>
        <div class="card">
          <div class="seg" role="group" aria-label="Checklist" style="margin-bottom:12px">${templates.map((t) => html`<button type="button" data-click="tab" data-v="${t.id}" aria-pressed="${t.id === active}">${t.scheme === 'fssai2' ? 'Food safety' : t.scheme === 'docket' ? 'Maintenance' : 'Food (Aug)'}</button>`)}</div>
          <div id="checklist">${checklist()}</div>
        </div></section>
    </div>`,
  });
  on.click = { tab: (el) => { active = +el.dataset.v; $$('[data-click="tab"]', view).forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === active))); $('#checklist').innerHTML = part(checklist()); } };
}

// =================================================================== boot
async function boot() {
  try {
    app.me = await api('/api/me');
    app.today = app.me.today;
    $('#avatar').textContent = (app.me.name || '?').trim()[0] || '?';
    $('#avatar').title = `${app.me.name}: sign out`;
    $('#signin').hidden = true;
    $('#app').hidden = false;
    router();
  } catch (e) {
    if (e instanceof SignInNeeded) return;
    $('#app').hidden = false;
    mount({ title: 'Offline', body: emptyState({ iconName: 'cloud_off', title: 'Could not reach the server', text: e.message, action: html`<button class="btn filled" onclick="location.reload()">Reload</button>` }) });
  }
}
boot();
