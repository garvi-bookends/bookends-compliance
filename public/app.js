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
/** An error with a message written for people (from the server, or about the connection). */
class ApiError extends Error {}

async function api(path, { method = 'GET', body, file } = {}) {
  const init = { method, headers: {} };
  if (file) { init.body = file; init.headers['content-type'] = file.type || 'application/octet-stream'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, init); }
  catch { const e = new ApiError('Could not reach the server. Check the connection and try again.'); e.offline = true; throw e; }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && data?.signin) { showSignin(data.setup); throw new SignInNeeded('Please sign in'); }
  if (!res.ok) { const e = new ApiError(data?.error || `The server could not complete this (error ${res.status}). Try again.`); e.status = res.status; throw e; }
  if (method !== 'GET') alertsCache = null; // a saved change may add or clear an alert
  return data;
}
async function getTemplates() {
  if (!app.templates) app.templates = (await api('/api/templates')).templates;
  return app.templates;
}
/** Never show raw JavaScript errors: only messages meant for people. */
function friendly(err) {
  if (err instanceof ApiError) return err.message;
  console.error(err);
  return 'Something unexpected went wrong. Please try again.';
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
const unitType = (u) => ((u.kind ?? u.site_kind) === 'kitchen' ? 'Central kitchen' : 'Restaurant');
const unitLoc = (u) => [u.area, u.city].filter(Boolean).join(', ');
const unitWordFor = (domain) => (domain === 'food' ? 'marks' : 'points');
function deltaSpan(d, { unit = '' } = {}) {
  if (d == null) return '';
  const v = R.round1(d);
  return html`<small class="${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}${unit}</small>`;
}
function safeList(v) { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } }

// Colour carries meaning only: grade bands map onto good / warn / bad / neutral.
const TONE = { exemplar: 'good', satisfactory: 'good', improve: 'warn', noncompliance: 'bad', none: 'neutral' };
const toneOf = (band) => TONE[band || 'none'];

// =================================================================== reusable components
/** PageHeader: title, one line of context, and the page's main actions. */
function pageHeader({ title, sub = '', actions = '', crumb = null, long = false, compact = false }) {
  return html`<header class="page-head${compact ? ' compact' : ''}">
    <div class="ph-text">${crumb ? html`<a class="crumb" href="${crumb.href}">${icon('arrow_back')}${crumb.label}</a>` : ''}
      <h1 class="${long ? 'long' : ''}">${title}</h1>${sub ? html`<div class="ph-sub">${sub}</div>` : ''}</div>
    ${actions ? html`<div class="ph-actions">${actions}</div>` : ''}
  </header>`;
}
/** StatCard: one number that matters, with a label and one line of context. */
function statCard({ label, value, sub = '', tone = '', href = null, click = null, v = null, pressed = null }) {
  const inner = html`<span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub ? html`<span class="stat-sub">${sub}</span>` : ''}`;
  const cls = `card stat${tone ? ` tone-${tone}` : ''}`;
  if (href) return html`<a class="${cls}" href="${href}">${inner}</a>`;
  if (click) return html`<button type="button" class="${cls}" data-click="${click}" data-v="${v ?? ''}" aria-pressed="${pressed ? 'true' : 'false'}">${inner}</button>`;
  return html`<div class="${cls}">${inner}</div>`;
}
/** StatusBadge: a grade band (or "Not audited"), always with its text label. */
const statusBadge = (level, { label, lg = false } = {}) => html`<span class="badge tone-${toneOf(level)}${lg ? ' lg' : ''}"><span class="dot"></span>${label || R.LEVELS[level || 'none'].label}</span>`;
const toneBadge = (tone, label, iconName = null) => html`<span class="badge tone-${tone}">${iconName ? icon(iconName) : html`<span class="dot"></span>`}${label}</span>`;
/** PriorityBadge: P1 / P2 / P3. */
const prioBadge = (p) => html`<span class="prio p-${p}" title="${R.PRIORITY[p].label}: ${R.PRIORITY[p].response}">${R.PRIORITY[p].short}</span>`;
const kindTag = (k) => (k === 'paperwork' ? html`<span class="tag" title="${R.KINDS.paperwork.hint}">${icon('description')}Paperwork</span>` : '');
const repeatTag = (f) => (f.is_repeat ? html`<span class="tag repeat" title="Also failed at the previous visit">${icon('replay')}Repeat</span>` : '');
const ratingChip = (scheme, result) => html`<span class="rating r-${result}">${R.SCHEMES[scheme]?.ratings[result] || result}</span>`;
const star = (critical) => (critical ? html`<span class="star" title="★ critical: counts double">★</span>` : '');
const FIX_STATUS = { open: ['neutral', 'Open'], in_progress: ['info', 'In progress'], fixed: ['info', 'Awaiting verification'], closed: ['good', 'Closed'] };
const isOverdue = (f, today = app.today) => R.UNRESOLVED.includes(f.status) && f.due_date < today;
function fixStatusBadge(f, today = app.today) {
  if (isOverdue(f, today)) return toneBadge('bad', 'Overdue', 'schedule');
  const [tone, label] = FIX_STATUS[f.status];
  return toneBadge(tone, label);
}
/** ScoreDisplay: a percentage coloured by its grade band. */
function scoreDisplay(score, { size = '', band } = {}) {
  const b = band ?? R.bandFor(score);
  return html`<span class="score ${size} tone-${score == null ? 'neutral' : toneOf(b)}">${score == null ? '—' : pct(score)}</span>`;
}
/** ProgressBar: a score bar, optionally with the 80% target marked. */
function progressBar(score, { band = R.bandFor(score), target = false, thin = false } = {}) {
  const w = Math.max(0, Math.min(100, score ?? 0));
  return html`<div class="progress${target ? ' target' : ''}${thin ? ' thin' : ''}" role="img" aria-label="${score == null ? 'No score' : pct(score)}${target ? `, target ${R.TARGET}%` : ''}"><span class="fill-${toneOf(band)}" style="width:${w}%"></span></div>`;
}
/** SearchBar: a search box that reports through data-input. */
const searchBar = ({ name = 'q', value = '', placeholder = 'Search' }) => html`<label class="searchbar">${icon('search')}<span class="sr-only">${placeholder}</span><input type="search" data-input="${name}" value="${value}" placeholder="${placeholder}" autocomplete="off"></label>`;
/** FilterBar pieces: a labelled select and a segmented control. */
const selectFilter = ({ name, value = '', label, options }) => html`<select class="select" data-change="${name}" aria-label="${label}">${options.map(([v, l]) => html`<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${l}</option>`)}</select>`;
const segmented = ({ name, value, options, label, fill = false }) => html`<div class="seg${fill ? ' fill' : ''}" role="group" aria-label="${label}">${options.map(([v, l, n]) => html`<button type="button" data-click="${name}" data-v="${v}" aria-pressed="${String(v) === String(value)}">${l}${n != null ? html` <span class="count">${n}</span>` : ''}</button>`)}</div>`;
const tabsBar = ({ name, value, tabs }) => html`<div class="tabs" role="tablist">${tabs.map(([v, l, n]) => html`<button type="button" role="tab" data-click="${name}" data-v="${v}" aria-selected="${v === value}">${l}${n ? html`<span class="count">${n}</span>` : ''}</button>`)}</div>`;
/** EmptyState: never a blank area; say what is missing and offer the next step. */
function emptyState({ iconName = 'inbox', title, text = '', action = '', tone = '', compact = false }) {
  return html`<div class="empty${tone ? ` tone-${tone}` : ''}${compact ? ' compact' : ''}"><span class="e-icon">${icon(iconName)}</span><h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action ? html`<div class="e-actions">${action}</div>` : ''}</div>`;
}
const skeleton = () => html`<div class="skel-page" aria-busy="true" aria-label="Loading"><div class="skel skel-title"></div><div class="skel skel-sub"></div>
  <div class="grid-stats">${[1, 2, 3, 4].map(() => html`<div class="skel skel-card"></div>`)}</div><div class="skel skel-block"></div></div>`;
/** DataTable: a header and grid rows on wide screens; each row becomes a compact card on phones.
 *  Cell classes: main (title), aside (status, top-right on phones), kv (label: value on phones), full, action (desktop only). */
function dataTable(cols, rows) {
  return html`<div class="dt" role="table" style="--cols:${cols.map((c) => c.w).join(' ')}">
    <div class="dt-head" role="row">${cols.map((c) => html`<div class="dt-cell${c.r ? ' r' : ''}" role="columnheader">${c.label}</div>`)}</div>${rows}</div>`;
}
function dtRow(href, cells) {
  const inner = cells.map((c) => html`<div class="dt-cell ${c.cls || 'kv'}${c.r ? ' r' : ''}${c.hideSm ? ' hide-sm' : ''}" role="cell">${c.lbl ? html`<span class="lbl">${c.lbl}:</span>` : ''}${c.v}</div>`);
  return href ? html`<a class="dt-row" role="row" href="${href}">${inner}</a>` : html`<div class="dt-row" role="row">${inner}</div>`;
}
const viewCell = (label = 'View') => ({ cls: 'action', r: true, v: html`<span class="btn sm">${label}</span>` });
/** MobileBottomActions: the page's main buttons, always within thumb reach. */
const bottomBar = (buttons, info = '') => html`<div class="bottom-bar" role="toolbar" aria-label="Actions">${info ? html`<span class="bb-info">${info}</span>` : ''}${buttons}</div>`;
function collapse({ title, sub = '', body, open = false, id = '', flush = false, iconName = null }) {
  return html`<details class="collapse" ${open ? 'open' : ''} ${id ? html`id="${id}"` : ''}><summary>${iconName ? icon(iconName, 'muted') : ''}<span class="sum-title"><h3>${title}</h3>${sub ? html`<span class="sum-sub">${sub}</span>` : ''}</span>${icon('expand_more', 'chev')}</summary><div class="collapse-body${flush ? ' flush' : ''}">${body}</div></details>`;
}

function reasonsList(reasons, { siteId = null, showDomain = false } = {}) {
  const href = (r) => (r.kind === 'audit' && r.id ? `#/audits/${r.id}` : r.kind === 'licence' && r.id ? `#/licences/${r.id}`
    : r.kind === 'findings' && siteId ? `#/fixes?unit=${siteId}&domain=${r.domain}${r.filter === 'p1' ? '&priority=critical' : '&status=overdue'}`
      : r.kind === 'route' && siteId ? `#/units/${siteId}#route-${r.domain}` : r.kind === 'audit-due' && siteId ? `#/audits/new?unit=${siteId}&domain=${r.domain}` : null);
  return html`<ul class="reasons">${reasons.map((r) => {
    const h = href(r);
    const t = r.tone || 'none';
    return html`<li>${icon(R.LEVELS[t].icon, `t-${toneOf(t)}`)}<span><span class="sr-only">${R.LEVELS[t].label}: </span>${
      showDomain && r.domain ? html`<span class="dom">${R.DOMAINS[r.domain].label}</span>` : ''}${h ? html`<a href="${h}">${r.text}</a>` : r.text}</span></li>`;
  })}</ul>`;
}
function dueInfo(f, today = app.today) {
  if (f.status === 'closed') return { text: `Closed ${fmt(tsDate(f.closed_at))}`, tone: null };
  if (f.status === 'fixed') return { text: 'Awaiting verification', tone: null };
  const d = R.daysBetween(today, f.due_date);
  if (d < 0) return { text: `${R.plural(-d, 'day')} overdue`, tone: 'bad' };
  if (d === 0) return { text: 'Due today', tone: 'warn' };
  return { text: `Due ${fmt(f.due_date)}`, tone: null };
}
const dueSpan = (f) => { const d = dueInfo(f); return html`<span class="${d.tone ? `t-${d.tone}` : ''}">${d.text}</span>`; };

/** FindingCard: one gap, its proof and who is on it. Opens the fix for the full details. */
function findingCard(f, { showUnit = false } = {}) {
  const photo = f.photos?.[0];
  const d = dueInfo(f);
  const lead = photo ? html`<img class="thumb-sm" src="${fileUrl(photo)}" alt="" loading="lazy">`
    : html`<span class="thumb-ph">${icon(f.kind === 'paperwork' ? 'description' : 'build')}</span>`;
  return html`<a class="finding" href="#/fixes/${f.id}">${lead}
    <span class="f-body"><span class="f-title clamp-2">${f.title}</span>
      <span class="f-meta">${prioBadge(f.priority)}${fixStatusBadge(f)}${showUnit ? html`<span>${unitName(f)}</span>` : ''}
        <span>${icon('person')}${f.owner || 'Unassigned'}</span><span class="${d.tone ? `t-${d.tone}` : ''}">${icon('event')}${f.status === 'closed' || f.status === 'fixed' ? d.text : `${fmt(f.due_date, true)}${d.tone ? ` · ${d.text}` : ''}`}</span>${repeatTag(f)}</span></span>
    ${icon('chevron_right', 'chev muted')}</a>`;
}
/** Fixes grouped Priority 1 → 3, each group collapsible; only Priority 1 starts open. */
function priorityGroups(list, { showUnit = false, openFirst = true } = {}) {
  const groups = R.PRIORITY_ORDER.map((p) => [p, list.filter((f) => f.priority === p)]).filter(([, l]) => l.length);
  return groups.map(([p, l], n) => html`<details class="group" ${openFirst && n === 0 && p === 'critical' ? 'open' : ''}>
    <summary>${prioBadge(p)}<h3>${R.PRIORITY[p].label}</h3><span class="muted small">${l.length}</span><span class="muted small desktop-hint">· ${R.PRIORITY[p].response}</span>${icon('expand_more', 'chev')}</summary>
    <div class="list">${l.map((f) => findingCard(f, { showUnit }))}</div></details>`);
}

function routeList(route, { domain, unitId, compact = false }) {
  if (!route) return '';
  const unitWord = unitWordFor(domain);
  if (route.score >= R.TARGET) {
    return html`<p>${statusBadge(R.bandFor(route.score))} Already at ${pct(route.score)}. Next goal: ${R.STRETCH}% (Exemplar), by closing the ${R.plural(route.open, 'open fix', 'open fixes')}.</p>`;
  }
  const steps = compact ? route.steps.slice(0, 5) : route.steps;
  const last = route.steps.at(-1);
  return html`<div class="stack" style="gap:10px">
    <p><b>${R.fmtNum(route.needed)} ${unitWord} short of ${R.TARGET}%.</b> Close ${route.reached ? `these ${R.plural(route.steps.length, 'fix', 'fixes')}` : 'every open fix'}, in this order${route.reached ? `, to reach ${pct(last.after)}` : ''}. Priority 1 alone takes it to ${pct(route.afterP1)}.</p>
    <ol class="route">
      ${steps.map((s) => html`<li><span class="what"><a href="#/fixes/${s.id}">${s.title}</a><span class="small muted row" style="gap:6px">${prioBadge(s.priority)}${s.area ? html`<span>${s.area}</span>` : ''}${s.code ? html`<span>${s.code}</span>` : ''}${kindTag(s.kind)}</span></span>
        <span class="after">+${R.fmtNum(s.marks)} ${unitWord}<b>${pct(s.after)}</b></span></li>`)}
      ${compact && route.steps.length > steps.length ? html`<li class="goal"><span class="what"><a href="#/units/${unitId}#route-${domain}">${R.plural(route.steps.length - steps.length, 'more fix', 'more fixes')} to ${R.TARGET}%</a></span><span class="after"><b>${pct(last.after)}</b></span></li>`
        : route.reached ? html`<li class="goal"><span class="what"><b>${R.bandLabel(R.bandFor(last.after))}</b><span class="small muted">Target reached</span></span><span class="after"><b>${pct(last.after)}</b></span></li>` : ''}
    </ol>
    ${route.pending ? html`<p class="small muted">Once the fixes already marked fixed are verified at the next visit: ${pct(route.pending)}.</p>` : ''}
  </div>`;
}
function routeSummary(route, domain) {
  if (!route) return '';
  if (route.score >= R.TARGET) return `At target · ${R.plural(route.open, 'open fix', 'open fixes')}`;
  return `${R.fmtNum(route.needed)} ${unitWordFor(domain)} short · ${route.reached ? `${R.plural(route.steps.length, 'fix', 'fixes')} to get there` : 'close every open fix'}`;
}
function categoryBars(sections, { one = false } = {}) {
  return html`<div class="bars${one ? ' one' : ''}">${sections.map((s) => html`<div class="bar-row"><span>${s.section}</span><b class="num">${s.score == null ? 'N/A' : `${Math.round(s.score)}%`}</b>${progressBar(s.score, { thin: true })}</div>`)}</div>`;
}
const checklistCaveat = (from, to, n) => html`<div class="banner info">${icon('info')}<span class="b-body">Visit 1 used the <b>${R.SCHEMES[from]?.name || 'earlier'}</b> checklist and visit ${n} the <b>${R.SCHEMES[to]?.name || 'current'}</b> checklist. They are different checklists, so read the change as a direction of travel, not an exact like-for-like measurement.</span></div>`;

// =================================================================== snackbar, dialogs, uploads
let snackTimer;
function toast(msg, { error = false, success = false, ms = 4500 } = {}) {
  const el = $('#snackbar');
  el.innerHTML = part(html`${error ? icon('error') : success ? icon('check_circle') : ''}<span>${msg}</span>`);
  el.classList.toggle('error', error);
  el.classList.toggle('success', success);
  el.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.remove('show'), ms);
}
const dlg = $('#dialog');
const cdlg = $('#confirmDlg');
const sdlg = $('#searchDlg');
const dlgHandlers = new Map();
/** FormModal: a dialog with a form; onSubmit gets the form data. */
function openDialog({ title, body, actions, onSubmit, on = {}, locked = false }, el = dlg) {
  dlgHandlers.set(el, on);
  el.dataset.locked = locked ? '1' : '';
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
    catch (err) { if (!(err instanceof SignInNeeded)) toast(friendly(err), { error: true }); }
    finally { if (btn) btn.disabled = false; }
  });
  el.showModal();
  const first = $('input:not([type=hidden]), select, textarea', el);
  if (first && window.matchMedia('(min-width: 600px)').matches) first.focus();
}
function closeDialog(el = dlg) { if (el.open) el.close(); }
/** ConfirmModal: resolves { note } on confirm, null on cancel. */
function confirmDialog({ title, text, ok = 'Confirm', danger = false, tone = null, withNote = null }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openDialog({
      title,
      body: html`<div class="form"><p class="muted">${text}</p>${withNote ? html`<div class="field"><label for="cNote">${withNote.label}${withNote.required ? '' : html` <span class="muted">(optional)</span>`}</label>
        <textarea class="input${withNote.large ? ' tall' : ''}" id="cNote" name="note" placeholder="${withNote.placeholder || ''}"></textarea><span class="error-text" id="cNoteErr" hidden>${withNote.requiredText || 'This is required.'}</span></div>` : ''}</div>`,
      actions: html`<button class="btn" type="button" data-click="close">Cancel</button><button class="btn ${danger ? 'danger-solid' : tone === 'success' ? 'success' : 'primary'}" value="ok">${ok}</button>`,
      onSubmit: (fd) => {
        const note = (fd.get('note') || '').trim();
        if (withNote?.required && !note) { $('#cNote', cdlg).classList.add('invalid'); $('#cNoteErr', cdlg).hidden = false; $('#cNote', cdlg).focus(); return; }
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
        toast('Photo attached', { success: true });
        resolve(r.key);
      } catch (e) { toast(friendly(e), { error: true }); reject(e); }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// =================================================================== working with no network (audits only)
// An audit must never be lost to a bad signal. Ratings already live in the draft on the phone. Photos taken with no
// network are kept on the phone (IndexedDB) under a "local:" key and uploaded later. An audit submitted with no network
// goes into an outbox on the phone and is sent by itself when the network is back. Each audit carries a client_id made
// on the phone, so a send that reached the server but lost its reply is recognised, not saved twice.
const newId = () => crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const isLocalPhoto = (k) => typeof k === 'string' && k.startsWith('local:');
const localThumbs = new Map(); // local key -> object URL for the thumbnail
const photoSrc = (k) => (isLocalPhoto(k) ? localThumbs.get(k) || '' : fileUrl(k));
const idb = (() => {
  let dbp;
  const open = () => (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('bk-offline', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos');
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => { const tx = db.transaction('photos', mode); const req = fn(tx.objectStore('photos')); tx.oncomplete = () => res(req.result); tx.onerror = () => rej(tx.error); });
  };
  return { get: (k) => run('readonly', (s) => s.get(k)), put: (k, v) => run('readwrite', (s) => s.put(v, k)), del: (k) => run('readwrite', (s) => s.delete(k)) };
})();
/** Makes thumbnails for the photos of these answers that are still only on the phone. */
async function loadLocalThumbs(answers) {
  for (const a of answers) for (const k of a?.photos || []) {
    if (!isLocalPhoto(k) || localThumbs.has(k)) continue;
    const blob = await idb.get(k).catch(() => null);
    if (blob) localThumbs.set(k, URL.createObjectURL(blob));
  }
}
function dropLocalPhotos(answers) {
  for (const a of answers) for (const k of a?.photos || []) if (isLocalPhoto(k)) { idb.del(k).catch(() => {}); localThumbs.delete(k); }
}
/** Uploads the photos of these answers that are still only on the phone, swapping in the server key one by one
 *  (so a dropped connection halfway never uploads a photo twice). Throws the upload error, e.g. still offline. */
async function uploadLocalPhotos(answers, save) {
  for (const a of answers) {
    if (!(a.photos || []).some(isLocalPhoto)) continue;
    for (let n = 0; n < a.photos.length; n += 1) {
      const k = a.photos[n];
      if (!isLocalPhoto(k)) continue;
      const blob = await idb.get(k).catch(() => null);
      if (!blob) { a.photos.splice(n, 1); n -= 1; save(); continue; } // lost from the phone (storage cleared): nothing to send
      const r = await api('/api/uploads', { method: 'POST', file: blob });
      a.photos[n] = r.key; save();
      idb.del(k).catch(() => {});
    }
  }
}
/** Photo for an audit line: uploaded straight away when there is network, otherwise kept on the phone for later. */
function pickAuditPhoto() {
  const input = $('#filePicker');
  input.accept = 'image/*';
  input.value = '';
  return new Promise((resolve) => {
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      const blob = file.type.startsWith('image/') ? await downscale(file) : file;
      if (navigator.onLine) {
        try {
          toast('Uploading…', { ms: 30000 });
          const r = await api('/api/uploads', { method: 'POST', file: blob });
          toast('Photo attached', { success: true });
          return resolve(r.key);
        } catch (e) {
          if (e instanceof SignInNeeded) return resolve(null);
          if (!e.offline) { toast(friendly(e), { error: true }); return resolve(null); }
        }
      }
      try {
        const key = `local:${newId()}`;
        await idb.put(key, blob);
        localThumbs.set(key, URL.createObjectURL(blob));
        toast('No network: photo saved on this phone. It uploads by itself when the network is back.', { ms: 6000 });
        resolve(key);
      } catch { toast('Could not keep the photo on this phone. Try again.', { error: true }); resolve(null); }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// The outbox: audits submitted with no network, waiting on this phone. Each belongs to the person who submitted it.
const OUTBOX_KEY = 'bk-outbox:v1';
const outboxAll = () => { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch { return []; } };
const outboxOwner = () => app.me?.username || app.me?.name || '';
const outboxMine = () => outboxAll().filter((x) => x.owner === outboxOwner());
function outboxSave(list) {
  try { if (list.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)); else localStorage.removeItem(OUTBOX_KEY); } catch { /* private mode */ }
}
function outboxPut(entry) { outboxSave([...outboxAll().filter((x) => x.client_id !== entry.client_id), entry]); }
function outboxDrop(clientId) { outboxSave(outboxAll().filter((x) => x.client_id !== clientId)); }
const outboxName = (x) => `${x.unit} · ${R.DOMAINS[x.body.domain]?.label.toLowerCase() || ''} audit, ${fmt(x.body.audit_date, true)}`;

let syncing = null;
/** Sends what is waiting. Stops at the first sign of no network (tries again later); an audit the server turns down is
 *  kept, marked with the reason, for the auditor to open and correct. */
function syncOutbox({ manual = false } = {}) {
  if (syncing || !app.me) return syncing;
  const todo = outboxMine().filter((x) => manual || !x.error);
  if (!todo.length) return null;
  syncing = (async () => {
    let sent = 0;
    for (const entry of todo) {
      delete entry.error;
      try {
        await uploadLocalPhotos(entry.body.answers, () => outboxPut(entry));
        const r = await api('/api/audits', { method: 'POST', body: entry.body });
        outboxDrop(entry.client_id); sent += 1;
        toast(`Audit sent: ${entry.unit}, ${pct(r.score)} ${R.bandLabel(r.band)}`, { success: true, ms: 7000 });
      } catch (e) {
        if (e instanceof SignInNeeded || !(e instanceof ApiError) || e.offline || e.status >= 500) { outboxPut(entry); break; } // try again later
        entry.error = friendly(e); outboxPut(entry);
        if (manual) toast(`Could not send ${entry.unit}: ${entry.error}`, { error: true, ms: 8000 });
      }
    }
    if (sent) {
      searchData = null; alertsCache = null;
      // show the new results, unless someone is in the middle of an audit or a form
      if (!/^#\/audits\/new/.test(location.hash) && !dlg.open && !cdlg.open && !sdlg.open) { keepScrollOnce = true; router(); }
    }
  })().finally(() => { syncing = null; drawOutbox(); });
  drawOutbox();
  return syncing;
}
/** The strip at the top of every page while audits wait on this phone, and the "Offline" chip in the top bar. */
function drawOutbox() {
  $('#netChip').hidden = navigator.onLine;
  $('#outboxBanner')?.remove();
  if (!app.me || $('#app').hidden) return;
  const list = outboxMine();
  if (!list.length) return;
  const waiting = list.filter((x) => !x.error), failed = list.filter((x) => x.error);
  const el = document.createElement('div');
  el.id = 'outboxBanner';
  el.className = 'outbox stack';
  el.innerHTML = part(html`
    ${waiting.length ? html`<div class="banner ${navigator.onLine ? 'info' : 'warn'}">${icon(syncing ? 'sync' : navigator.onLine ? 'cloud_upload' : 'cloud_off', syncing ? 'spin' : '')}
      <span class="b-body"><b>${R.plural(waiting.length, 'audit')} saved on this phone, ${syncing ? 'sending now…' : 'waiting to be sent'}.</b>
        <span class="small">${navigator.onLine ? 'It goes by itself in a moment.' : 'No network. It is sent by itself when the network is back; keep this app on this phone until then.'} ${waiting.map(outboxName).join('; ')}</span></span>
      ${syncing ? '' : html`<button class="btn sm" type="button" data-ob="send">${icon('send')}Send now</button>`}</div>` : ''}
    ${failed.map((x) => html`<div class="banner bad">${icon('error')}<span class="b-body"><b>Not sent: ${outboxName(x)}.</b> <span class="small">${x.error}</span></span>
      <button class="btn sm" type="button" data-ob="open" data-id="${x.client_id}">Open to fix</button><button class="btn ghost sm" type="button" data-ob="drop" data-id="${x.client_id}">Delete</button></div>`)}`);
  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-ob]'); if (!b) return;
    const x = outboxMine().find((y) => y.client_id === b.dataset.id);
    if (b.dataset.ob === 'send') { syncOutbox({ manual: true }); return; }
    if (!x) return;
    if (b.dataset.ob === 'drop') {
      const ok = await confirmDialog({ title: 'Delete this audit?', text: `${outboxName(x)} has not reached the server. Deleting removes its ratings, remarks and photos from this phone for good.`, ok: 'Delete', danger: true });
      if (!ok) return;
      dropLocalPhotos(x.body.answers); outboxDrop(x.client_id); drawOutbox(); return;
    }
    // back into the audit form, with every rating, remark and photo, to correct and submit again
    const cur = loadDraft();
    if (cur && Object.keys(cur.answers || {}).length) {
      const ok = await confirmDialog({ title: 'Replace the unfinished audit?', text: 'There is an unfinished audit on this phone. Opening this one replaces it.', ok: 'Replace', danger: true });
      if (!ok) return;
      dropLocalPhotos(Object.values(cur.answers));
    }
    const { body } = x;
    saveDraft({ site_id: body.site_id, domain: body.domain, audit_date: body.audit_date, auditor: body.auditor, audit_type: body.audit_type, summary: body.summary || '',
      started_at: body.started_at || undefined, client_id: x.client_id, step: 999,
      answers: Object.fromEntries(body.answers.map((a) => [a.item_id, { result: a.result, note: a.note || '', photos: a.photos || [] }])) });
    outboxDrop(x.client_id);
    if (location.hash === '#/audits/new') router(); else location.hash = '#/audits/new';
  });
  view.prepend(el);
}
window.addEventListener('online', () => { drawOutbox(); syncOutbox(); });
window.addEventListener('offline', drawOutbox);
setInterval(() => { if (navigator.onLine) syncOutbox(); }, 30000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* not on http:// over Wi-Fi: no offline start-up there */ });

// =================================================================== sign-in
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function localStorageDel(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } }
async function showSignin(setup = false) {
  $('#app').hidden = true;
  closeDialog(dlg); closeDialog(cdlg);
  const box = $('#signin');
  box.hidden = false;
  let opts = { teamCode: false, setup };
  try { opts = { ...opts, ...(await (await fetch('/api/auth/options')).json()) }; } catch { /* offline: show the form anyway */ }
  // Username + password. The team code appears only for first-time setup, before any Compliance Head exists.
  const firstSetup = !!opts.teamCode;
  const inputWithIcon = (ic, input, extra = '') => html`<div class="input-icon">${icon(ic)}${input}${extra}</div>`;
  box.innerHTML = part(html`<div class="signin">
    <div class="signin-bg" aria-hidden="true"><span class="glow g1"></span><span class="glow g2"></span><span class="glow g3"></span></div>
    <form class="signin-card" id="signinForm" novalidate>
      <span class="brand"><span class="brand-mark" aria-hidden="true">B</span><span class="brand-text"><b>BOOKENDS</b><small>Compliance</small></span></span>
      <div><h1>${firstSetup ? 'First-time setup' : 'Welcome back'}</h1>
        <p class="muted small" style="margin-top:4px">${firstSetup ? 'Sign in with the team access code, then create the Compliance Head in Settings → Team members.' : 'Sign in to manage food safety, maintenance and licences.'}</p></div>
      ${opts.setup ? html`<div class="banner warn">${icon('key')}<span class="b-body">Sign-in is not set up yet. The administrator sets the team access code once, with <b>npx wrangler secret put ACCESS_CODE</b>.</span></div>` : ''}
      ${firstSetup ? html`
        <div class="field"><label for="siName">Your name</label>${inputWithIcon('person', html`<input class="input" id="siName" name="name" autocomplete="name" required value="${localStorageGet('bk-name') || ''}">`)}</div>
        <div class="field"><label for="siCode">Team access code</label>${inputWithIcon('key', html`<input class="input" id="siCode" name="code" type="password" autocomplete="current-password" required>`)}</div>`
      : html`
        <div class="field"><label for="siUser">Username</label>${inputWithIcon('person', html`<input class="input" id="siUser" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${localStorageGet('bk-username') || ''}">`)}</div>
        <div class="field"><label for="siPass">Password</label>${inputWithIcon('lock', html`<input class="input" id="siPass" name="password" type="password" autocomplete="current-password" required>`,
          html`<button type="button" class="pw-toggle" id="pwToggle" aria-label="Show password" title="Show password">${icon('visibility')}</button>`)}</div>`}
      <div class="error-text" id="siErr" role="alert" hidden></div>
      <button class="btn primary lg block" type="submit">${icon('login')}Sign in</button>
      ${firstSetup ? '' : html`<p class="small muted signin-note">No account yet? Ask the Compliance Head to add you.</p>`}
    </form>
    <p class="signin-foot">Bookends Hospitality · Food safety · Maintenance · Licences</p>
  </div>`);
  $('#pwToggle', box)?.addEventListener('click', (e) => {
    const input = $('#siPass', box);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.innerHTML = part(icon(show ? 'visibility_off' : 'visibility'));
    e.currentTarget.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    e.currentTarget.title = show ? 'Hide password' : 'Show password';
    input.focus();
  });
  $('#signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const btn = $('button[type=submit]', e.currentTarget);
    const err = $('#siErr');
    const body = firstSetup ? { name: fd.get('name'), code: fd.get('code') } : { username: (fd.get('username') || '').trim(), password: fd.get('password') || '' };
    if (!firstSetup && (!body.username || !body.password)) { err.hidden = false; err.textContent = 'Enter your username and password.'; return; }
    btn.disabled = true;
    try {
      let res;
      try { res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
      catch { throw new Error('Could not reach the server. Check the connection and try again.'); }
      const data = await res.json().catch(() => ({}));
      if (!data.setup) $('.banner', box)?.remove(); // the code has been set since this page loaded
      if (res.status === 403 && firstSetup) { showSignin(); return; } // a Compliance Head was created meanwhile
      if (!res.ok) throw new Error(data.error || 'Could not sign in');
      if (firstSetup) localStorageSet('bk-name', data.name); else localStorageSet('bk-username', body.username);
      box.hidden = true; box.innerHTML = '';
      boot();
    } catch (x) { err.hidden = false; err.textContent = x.message; }
    finally { btn.disabled = false; }
  });
  const first = firstSetup ? ($('#siName').value ? $('#siCode') : $('#siName')) : ($('#siUser').value ? $('#siPass') : $('#siUser'));
  first.focus();
}

// =================================================================== router & shell
let on = {};
let cleanups = [];
let navToken = 0;
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
  el.addEventListener('click', (e) => { if (e.target === el && !el.dataset.locked) closeDialog(el); });
  el.addEventListener('cancel', (e) => { if (el.dataset.locked) e.preventDefault(); });
}

function parseHash() {
  const h = location.hash.slice(1) || '/';
  const [pathPart, qs] = h.split('?');
  const [path, anchor] = pathPart.split('#');
  return { path: path || '/', query: new URLSearchParams(qs || ''), anchor };
}
const routes = [
  [/^\/$/, pageFixes, 'dashboard'],
  [/^\/units$/, pageUnits, 'units'],
  [/^\/units\/(\d+)$/, pageUnit, 'units'],
  [/^\/audits$/, pageAudits, 'audits'],
  [/^\/audits\/new$/, pageNewAudit, 'audits'],
  [/^\/audits\/(\d+)$/, pageAudit, 'audits'],
  [/^\/fixes$/, pageFixes, 'dashboard'],  // older links to the fix plan open the dashboard
  [/^\/fixes\/(\d+)$/, pageFix, 'dashboard'],
  [/^\/licences$/, pageLicences, 'licences'],
  [/^\/licences\/(\d+)$/, pageLicences, 'licences'],
  [/^\/reports$/, pageReports, 'reports'],
  [/^\/settings$/, pageSettings, 'settings'],
  [/^\/framework$/, pageFramework, 'settings'],
];
async function router() {
  const { path, query, anchor } = parseHash();
  const token = ++navToken;
  cleanups.forEach((fn) => fn()); cleanups = [];
  on = {};
  closeDialog(cdlg); closeDialog(dlg); closeDialog(sdlg);
  setNavOpen(false);
  const route = routes.find(([re]) => re.test(path));
  if (!route) { mount({ title: 'Not found', body: emptyState({ iconName: 'explore_off', title: 'This page does not exist', text: 'The link may be old. Start again from the dashboard.', action: html`<a class="btn primary" href="#/">Go to dashboard</a>` }) }); return; }
  const [re, page, nav] = route;
  $$('.nav-item').forEach((a) => (a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const quiet = keepScrollOnce;
  view.classList.add('loading');
  const skelTimer = quiet ? null : setTimeout(() => {
    if (token !== navToken) return;
    document.body.classList.remove('has-bottom-bar');
    view.innerHTML = part(skeleton()); view.classList.remove('loading');
  }, 150);
  try {
    await page({ params: path.match(re).slice(1), query, token, anchor });
    if (anchor && token === navToken) {
      const target = document.getElementById(anchor);
      if (target?.tagName === 'DETAILS') target.open = true;
      target?.scrollIntoView({ block: 'start' });
    }
  } catch (err) {
    if (err instanceof SignInNeeded) return;
    if (token === navToken && err.status === 404) {
      // the audit, fix, unit or licence has been removed (or the link is old): say so plainly, it is not a fault
      mount({ title: 'Not found', body: html`${pageHeader({ title: 'Not found' })}<div class="card">${emptyState({ iconName: 'search_off', title: 'This no longer exists', text: `${friendly(err)}. It may have been removed, or the link is out of date.`, action: html`<a class="btn primary" href="#/">Go to dashboard</a>` })}</div>` });
    } else if (token === navToken) {
      mount({ title: 'Could not load', body: html`${pageHeader({ title: 'Could not load this page' })}<div class="card">${emptyState({ iconName: 'cloud_off', tone: 'bad', title: 'Something went wrong', text: friendly(err), action: html`<button class="btn primary" data-click="retry">${icon('refresh')}Try again</button><a class="btn" href="#/">Go to dashboard</a>` })}</div>` });
      on.click = { retry: () => router() };
    }
  } finally {
    clearTimeout(skelTimer);
    if (token === navToken) view.classList.remove('loading');
    if (app.me?.mustChange && !dlg.open) openPasswordDialog({ forced: true });
    if (token === navToken) refreshAlerts();
  }
}
const stale = (token) => token !== navToken;
function rerender() { keepScrollOnce = true; return router(); }
function mount({ title, body }) {
  $('#topTitle').textContent = title;
  document.title = `${title} · Bookends Compliance`;
  view.innerHTML = part(body);
  document.body.classList.toggle('has-bottom-bar', !!$('.bottom-bar', view));
  if (!keepScrollOnce) window.scrollTo(0, 0);
  keepScrollOnce = false;
  drawOutbox();
}
window.addEventListener('hashchange', () => router());
window.addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });

// sidebar: drawer on phones and tablets, collapsible rail on desktop
function setNavOpen(open) {
  $('#app').classList.toggle('nav-open', open);
  $('#menuBtn').setAttribute('aria-expanded', String(open));
}
$('#menuBtn').addEventListener('click', () => setNavOpen(!$('#app').classList.contains('nav-open')));
$('#navScrim').addEventListener('click', () => setNavOpen(false));
$$('.nav-item').forEach((a) => a.addEventListener('click', () => setNavOpen(false)));
function setCollapsed(c) {
  $('#app').classList.toggle('collapsed', c);
  $('#collapseBtn').setAttribute('aria-label', c ? 'Expand sidebar' : 'Collapse sidebar');
  $('#collapseBtn').title = c ? 'Expand sidebar' : 'Collapse sidebar';
}
// Small laptops (below 1280px) start with the icon rail so tables get the room; a choice made with the button always wins.
const narrowLaptop = window.matchMedia('(max-width: 1279px)');
const savedNav = localStorageGet('bk-nav-collapsed');
setCollapsed(savedNav != null ? savedNav === '1' : narrowLaptop.matches);
narrowLaptop.addEventListener('change', (e) => { if (localStorageGet('bk-nav-collapsed') == null) setCollapsed(e.matches); });
$('#collapseBtn').addEventListener('click', () => { const c = !$('#app').classList.contains('collapsed'); setCollapsed(c); localStorageSet('bk-nav-collapsed', c ? '1' : '0'); });
async function signOut({ ask = true } = {}) {
  if (ask) {
    const waiting = outboxMine().length;
    const ok = await confirmDialog({ title: 'Sign out?', text: `Signed in as ${app.me?.name || ''}. Any audit draft stays saved on this device.${waiting ? ` ${R.plural(waiting, 'audit')} not sent yet ${waiting === 1 ? 'stays' : 'stay'} on this phone and ${waiting === 1 ? 'is' : 'are'} sent the next time you sign in here with network.` : ''}`, ok: 'Sign out' });
    if (!ok) return;
  }
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
  if (window.caches) caches.delete('bk-api-v1').catch(() => {}); // the copies kept for working offline are this person's data
  app.me = null;
  $('#outboxBanner')?.remove();
  alertsCache = null;
  $('#alertCount').hidden = true;
  showSignin(false);
}
const ROLE_LABEL = { head: 'Compliance Head', manager: 'Unit Manager', team: 'Team access' };
/** Unit Managers see and work on their own unit only. The server enforces it; the screens just leave out what they cannot use. */
const isManager = () => app.me?.role === 'manager';
/** Change your own password. forced: signed in with a temporary password, so it cannot be skipped (only sign out). */
function openPasswordDialog({ forced = false } = {}) {
  openDialog({
    title: forced ? 'Choose your own password' : 'Change password',
    locked: forced,
    body: html`<div class="form">
      ${forced ? html`<div class="banner info">${icon('key')}<span class="b-body">You signed in with a temporary password from the Compliance Head. Choose your own password to continue.</span></div>` : ''}
      <div class="field"><label for="pwCur">${forced ? 'Temporary password' : 'Current password'}</label><input class="input" id="pwCur" name="current" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="pwNew">New password</label><input class="input" id="pwNew" name="password" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters.</span></div>
      <div class="field"><label for="pwNew2">New password again</label><input class="input" id="pwNew2" name="again" type="password" autocomplete="new-password" required></div>
      <div class="error-text" id="pwErr" hidden></div>
    </div>`,
    actions: forced ? html`<button class="btn" type="button" data-click="leave">Sign out</button><button class="btn primary" value="save">Save password</button>`
      : html`<button class="btn" type="button" data-click="close">Cancel</button><button class="btn primary" value="save">Save password</button>`,
    on: { click: { leave: () => { dlg.dataset.locked = ''; closeDialog(); signOut({ ask: false }); } } },
    onSubmit: async (fd) => {
      const err = $('#pwErr', dlg);
      const show = (m) => { err.hidden = false; err.textContent = m; };
      const current = fd.get('current') || '', password = fd.get('password') || '';
      if (!current) return show(forced ? 'Enter the temporary password you signed in with.' : 'Enter your current password.');
      if (password.length < 8) return show('The new password needs at least 8 characters.');
      if (password !== fd.get('again')) return show('The two new passwords do not match.');
      try { await api('/api/me/password', { method: 'POST', body: { current, password } }); }
      catch (e) { if (!(e instanceof SignInNeeded)) show(friendly(e)); return; }
      app.me.mustChange = false;
      dlg.dataset.locked = '';
      closeDialog();
      toast('Password changed', { success: true });
    },
  });
  // Hide the close (×) button when it must not be skipped.
  if (forced) $('.dlg-head [data-click="close"]', dlg)?.remove();
}
$('#logoutBtn').addEventListener('click', signOut);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setNavOpen(false);
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) && !$('#app').hidden) { e.preventDefault(); openSearch(); }
});

// =================================================================== global search
let searchData = null;
async function loadSearchData() {
  if (searchData && Date.now() - searchData.at < 60000) return searchData;
  const [s, a, f, l] = await Promise.all([api('/api/sites'), api('/api/audits'), api('/api/findings'), api('/api/licences')]);
  searchData = { at: Date.now(), units: s.units, audits: a.audits, findings: f.findings, licences: l.licences };
  return searchData;
}
function openSearch() {
  sdlg.innerHTML = part(html`<div class="dlg-wrap">
    <div class="s-input">${icon('search', 'muted')}<input id="sQ" type="search" placeholder="Search units, audits, fixes, licences…" autocomplete="off" aria-label="Search"><button class="icon-btn" type="button" id="sClose" aria-label="Close search">${icon('close')}</button></div>
    <div class="s-results" id="sRes"><p class="s-hint">Type a unit name, a fix (for example “pest control”), an auditor or a licence.</p></div></div>`);
  sdlg.showModal();
  const input = $('#sQ', sdlg);
  input.focus();
  $('#sClose', sdlg).addEventListener('click', () => closeDialog(sdlg));
  const loading = loadSearchData().catch((e) => { $('#sRes', sdlg).innerHTML = part(html`<p class="s-hint">${friendly(e)}</p>`); return null; });
  const run = async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { $('#sRes', sdlg).innerHTML = part(html`<p class="s-hint">Type a unit name, a fix (for example “pest control”), an auditor or a licence.</p>`); return; }
    const d = await loading;
    if (!d || input.value.trim().toLowerCase() !== q) return;
    const words = q.split(/\s+/);
    const hit = (s) => { const t = s.toLowerCase(); return words.every((w) => t.includes(w)); };
    const units = d.units.filter((u) => hit(`${u.name} ${u.brand || ''} ${u.area || ''} ${u.city} ${unitType(u)}`)).slice(0, 5);
    const audits = d.audits.filter((a) => hit(`${a.site_name} ${a.site_city} ${R.DOMAINS[a.domain].label} audit visit ${a.visit} ${fmt(a.audit_date, true)} ${a.auditor || ''}`)).slice(0, 5);
    const fixes = d.findings.filter((f) => hit(`${f.title} #${f.id} ${f.site_name} ${f.site_city} ${f.item_code || ''} ${f.item_area || ''} ${f.owner || ''}`))
      .sort((a, b) => (a.status === 'closed') - (b.status === 'closed')).slice(0, 8);
    const lics = d.licences.filter((l) => hit(`${l.type} ${l.site_name} ${l.site_city} ${l.number || ''} licence`)).slice(0, 5);
    const item = (href, ic, title, sub) => html`<a class="s-item" href="${href}">${icon(ic)}<span class="s-body"><span class="s-title">${title}</span><span class="s-sub">${sub}</span></span></a>`;
    const group = (label, rows) => (rows.length ? html`<div class="s-group">${label}</div>${rows}` : '');
    const out = html`
      ${group('Units', units.map((u) => item(`#/units/${u.id}`, 'storefront', unitName(u), `${unitType(u)} · ${unitLoc(u)} · ${R.LEVELS[u.status.overall].label}`)))}
      ${group('Audits', audits.map((a) => item(`#/audits/${a.id}`, 'fact_check', `${unitName(a)}: ${R.DOMAINS[a.domain].label}, visit ${a.visit}`, `${fmt(a.audit_date, true)} · ${pct(a.score)}${a.auditor ? ` · ${a.auditor}` : ''}`)))}
      ${group('Fixes', fixes.map((f) => item(`#/fixes/${f.id}`, 'construction', f.title, `${R.PRIORITY[f.priority].short} · ${unitName(f)} · ${isOverdue(f, app.today) ? 'Overdue' : FIX_STATUS[f.status][1]}`)))}
      ${group('Licences', lics.map((l) => item(`#/licences/${l.id}`, 'verified', l.type, `${l.site_name} · ${l.expires_on ? `expires ${fmt(l.expires_on, true)}` : 'no expiry date'}`)))}`;
    $('#sRes', sdlg).innerHTML = part(units.length + audits.length + fixes.length + lics.length ? out : html`<p class="s-hint">Nothing matches “${input.value.trim()}”.</p>`);
  };
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const a = $('.s-item', sdlg); if (a) { e.preventDefault(); location.hash = a.getAttribute('href'); closeDialog(sdlg); } }
    if (e.key === 'ArrowDown') { e.preventDefault(); $('.s-item', sdlg)?.focus(); }
  });
  $('#sRes', sdlg).addEventListener('keydown', (e) => {
    const items = $$('.s-item', sdlg); const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); items[Math.min(i + 1, items.length - 1)].focus(); }
    if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); (i === 0 ? input : items[i - 1]).focus(); }
  });
  $('#sRes', sdlg).addEventListener('click', (e) => { if (e.target.closest('.s-item')) closeDialog(sdlg); });
}
sdlg.addEventListener('click', (e) => { if (e.target === sdlg) closeDialog(sdlg); });
$('#searchBtn').addEventListener('click', openSearch);
$('#searchBtn2').addEventListener('click', openSearch);

// =================================================================== alerts: P1/P2 fixes for everyone, licences for the Compliance Head
// The server decides who gets what (a Unit Manager only ever gets their own unit's fixes, and no licence alerts).
// "Mark all done" (at the bottom of the panel) hides the alerts for this person only; each comes back if it moves from due soon to overdue (or expired).
let alertsCache = null; // { at, list, done }
async function loadAlerts({ force = false } = {}) {
  if (!force && alertsCache && Date.now() - alertsCache.at < 60000) return alertsCache.list;
  const r = await api('/api/alerts');
  alertsCache = { at: Date.now(), list: r.alerts, done: r.done || 0 };
  return r.alerts;
}
const ALERT_GROUPS = [['critical', 'Priority 1 fixes', 'Act within 48 hours', '#/fixes?priority=critical'], ['major', 'Priority 2 fixes', 'Fix within 7 days', '#/fixes?priority=major'], ['licence', 'Licences', 'Expired or expiring within 30 days', '#/licences?status=expiring']];
function alertsBody(list, { undo = null, done = 0 } = {}) {
  const undoBar = undo ? html`<div class="banner good alert-undo">${icon('done_all')}<span class="b-body">${R.plural(undo.length, 'alert')} marked done.</span><button class="btn sm" type="button" data-click="alertUndo">Undo</button></div>` : '';
  const doneNote = done && !undo ? html`<p class="small muted row" style="gap:8px">${R.plural(done, 'alert')} marked done earlier.<button class="btn ghost sm" type="button" data-click="alertRestore">Show them again</button></p>` : '';
  if (!list.length) return html`<div class="stack">${undoBar}${emptyState({ compact: true, iconName: 'notifications_off', tone: 'good', title: 'No alerts', text: 'Nothing due soon or overdue that you have not marked done.' })}${doneNote}</div>`;
  const groups = ALERT_GROUPS.filter(([g]) => list.some((a) => a.group === g));
  return html`<div class="stack">${undoBar}<div class="alert-sum">${groups.map(([g, label]) => { const xs = list.filter((a) => a.group === g); const over = xs.filter((a) => a.overdue).length;
      return html`<button type="button" class="as-item tone-${over ? 'bad' : 'warn'}" data-click="alertJump" data-v="${g}"><b>${xs.length}</b><span>${label}</span><small>${over ? `${over} ${g === 'licence' ? 'expired' : 'overdue'}` : g === 'licence' ? 'expiring soon' : 'due soon'}</small></button>`; })}</div>${ALERT_GROUPS.map(([g, label, sub, all]) => {
    const xs = list.filter((a) => a.group === g);
    if (!xs.length) return '';
    const over = xs.filter((a) => a.overdue).length;
    return html`<section class="alert-group" id="alert-${g}"><div class="ag-head"><span class="ag-title"><b>${label}</b><span class="small muted">${R.plural(xs.length, 'alert')}${over ? ` · ${over} ${g === 'licence' ? 'expired' : 'overdue'}` : ''} · ${sub}</span></span></div>
      <div class="list">${xs.slice(0, 5).map((a) => html`<div class="list-row alert-row"><a class="alert-link" href="#/${a.kind === 'fix' ? 'fixes' : 'licences'}/${a.id}">
        <span class="lead-icon tone-${a.tone}">${icon(a.kind === 'licence' ? (a.overdue ? 'gpp_bad' : 'event_busy') : a.overdue ? 'priority_high' : 'schedule')}</span>
        <span class="lr-body"><span class="lr-title small">${a.title}</span><span class="lr-meta"><span class="${a.overdue ? 't-bad' : ''}">${a.sub}</span></span></span>
        <span class="chev">${icon('chevron_right')}</span></a></div>`)}
        ${xs.length > 5 ? html`<a class="list-row alert-more" href="${all}">See all ${xs.length} ${label.toLowerCase()}${icon('arrow_forward')}</a>` : ''}</div></section>`;
  })}${doneNote}</div>`;
}
function showAlertCount(list) {
  const el = $('#alertCount');
  el.hidden = !list.length;
  el.textContent = list.length > 99 ? '99+' : String(list.length);
  $('#alertBtn').setAttribute('aria-label', list.length ? `Alerts: ${list.length}` : 'Alerts');
}
async function openAlerts() {
  let list = await loadAlerts().catch(() => alertsCache?.list || []);
  let undo = null;
  showAlertCount(list);
  const draw = () => {
    const body = $('.dlg-body', dlg); if (!body) return;
    body.innerHTML = part(alertsBody(list, { undo, done: alertsCache?.done || 0 }));
    $('#alertAll', dlg).hidden = !list.length;
    showAlertCount(list);
  };
  /** Hides these alerts now, saves it, and offers Undo. */
  const markDone = async (keys) => {
    if (!keys.length) return;
    const before = list;
    list = list.filter((a) => !keys.includes(a.key)); undo = keys; draw();
    try { await api('/api/alerts/done', { method: 'POST', body: { keys } }); await loadAlerts({ force: true }); }
    catch (err) { list = before; undo = null; draw(); if (!(err instanceof SignInNeeded)) toast(friendly(err), { error: true }); }
  };
  openDialog({ title: 'Alerts', body: alertsBody(list, { done: alertsCache?.done || 0 }),
    actions: html`<button class="btn" type="button" id="alertAll" data-click="alertDoneAll" ${list.length ? '' : 'hidden'}>${icon('done_all')}Mark all done</button><span class="spacer"></span><button class="btn" type="button" data-click="close">Close</button>`,
    on: { click: {
      alertJump: (el) => $(`#alert-${el.dataset.v}`, dlg)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      alertDoneAll: () => markDone(list.map((a) => a.key)),
      alertUndo: async () => {
        const keys = undo; undo = null;
        try { await api('/api/alerts/done', { method: 'POST', body: { undo: keys } }); list = await loadAlerts({ force: true }); draw(); }
        catch (err) { if (!(err instanceof SignInNeeded)) toast(friendly(err), { error: true }); }
      },
      alertRestore: async () => {
        try { await api('/api/alerts/done', { method: 'POST', body: { undoAll: true } }); list = await loadAlerts({ force: true }); undo = null; draw(); }
        catch (err) { if (!(err instanceof SignInNeeded)) toast(friendly(err), { error: true }); }
      },
    } } });
  dlg.classList.add('alerts-dlg');
  dlg.addEventListener('close', () => dlg.classList.remove('alerts-dlg'), { once: true });
}
/** Refreshes the bell after each page load; pops the alerts up once a day per person when something is overdue or expired. */
async function refreshAlerts() {
  if (!app.me || $('#app').hidden) return;
  const list = await loadAlerts().catch(() => null);
  if (!list) return;
  showAlertCount(list);
  const key = `bk-alerts-shown:${app.me.username || app.me.name}`;
  if (list.some((a) => a.overdue || a.group === 'critical') && localStorageGet(key) !== app.today && !dlg.open && !cdlg.open && !sdlg.open && !app.me.mustChange) {
    localStorageSet(key, app.today);
    openAlerts();
  }
}
$('#alertBtn').addEventListener('click', openAlerts);

// =================================================================== start-audit chooser (used on several pages)
function openStartAudit(units, presetUnit = null) {
  const unitPick = presetUnit ? null : units;
  openDialog({
    title: 'Start an audit',
    body: html`<div class="form">
      ${unitPick ? html`<div class="field"><label for="saUnit">Unit</label><select class="input" id="saUnit"><option value="">Choose a unit…</option>${unitPick.map((s) => html`<option value="${s.id}">${unitName(s)}</option>`)}</select></div>` : ''}
      <div class="choices">
        <button type="button" class="choice" data-click="go" data-v="food">${icon(R.DOMAINS.food.icon)}<span><b>Food safety audit</b><span class="small">FSSAI internal food safety checklist</span></span></button>
        <button type="button" class="choice" data-click="go" data-v="maintenance">${icon(R.DOMAINS.maintenance.icon)}<span><b>Maintenance docket</b><span class="small">Maintenance inspection walk-through</span></span></button>
      </div></div>`,
    actions: html`<button class="btn" type="button" data-click="close">Cancel</button>`,
    on: { click: { go: (el) => {
      const unit = presetUnit || $('#saUnit', dlg)?.value || '';
      closeDialog();
      location.hash = `#/audits/new?${unit ? `unit=${unit}&` : ''}domain=${el.dataset.v}`;
    } } },
  });
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
    actions: html`${u ? html`<button class="btn danger" type="button" data-click="archive">Archive</button><span class="spacer"></span>` : ''}<button class="btn" type="button" data-click="close">Cancel</button><button class="btn primary" value="save">${u ? 'Save changes' : 'Add unit'}</button>`,
    on: { click: { archive: async () => {
      const ok = await confirmDialog({ title: 'Archive this unit?', text: 'It leaves the dashboard. Its audits and fixes are kept.', ok: 'Archive', danger: true });
      if (!ok) return;
      try { await api(`/api/sites/${u.id}`, { method: 'PUT', body: { ...u, active: false } }); }
      catch (e) { if (!(e instanceof SignInNeeded)) toast(friendly(e), { error: true }); return; }
      toast('Unit archived', { success: true }); location.hash = '#/units';
    } } },
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd);
      if (!body.name?.trim()) { $('#uName', dlg).classList.add('invalid'); return; }
      if (u) { await api(`/api/sites/${u.id}`, { method: 'PUT', body }); toast('Unit saved', { success: true }); closeDialog(); rerender(); }
      else { const r = await api('/api/sites', { method: 'POST', body }); toast('Unit added', { success: true }); closeDialog(); location.hash = `#/units/${r.id}`; }
    },
  });
}
const lastAuditOf = (u) => [u.food.visits.at(-1)?.date, u.maintenance.latest?.date].filter(Boolean).sort().at(-1) || null;

/** UnitCard: where one unit stands, at a glance. */
function unitCard(u) {
  const last = lastAuditOf(u);
  return html`<a class="card unit-card" href="#/units/${u.id}">
    <div class="uc-head"><div style="flex:1;min-width:0"><div class="uc-name">${u.name}</div><div class="uc-loc">${unitType(u)} · ${unitLoc(u)}</div></div>${statusBadge(u.status.overall)}</div>
    <div class="uc-metrics">
      <div class="metric"><span class="m-k">Food safety</span><span class="m-v">${scoreDisplay(u.food.latest)}</span></div>
      <div class="metric"><span class="m-k">Maintenance</span><span class="m-v">${u.maintenance.latest ? scoreDisplay(u.maintenance.latest.score) : html`<span class="muted" style="font-weight:500">Not yet</span>`}</span></div>
      <div class="metric"><span class="m-k">Open fixes</span><span class="m-v">${u.open.total}${u.open.p1 ? html` <span class="small t-bad">(${u.open.p1} P1)</span>` : ''}</span></div>
      <div class="metric"><span class="m-k">Last audit</span><span class="m-v" style="font-weight:500">${last ? fmt(last, true) : '—'}</span></div>
    </div>
    <div class="uc-foot"><span>Target ${R.TARGET}%</span><span class="spacer"></span><span class="strong" style="color:var(--primary)">View unit</span>${icon('arrow_forward', 'muted')}</div>
  </a>`;
}

async function pageUnits({ token, query }) {
  if (isManager()) {
    if (app.me.unit) { location.replace(`#/units/${app.me.unit.id}`); return; }
    mount({ title: 'Units', body: html`${pageHeader({ title: 'My unit' })}<div class="card">${emptyState({ iconName: 'storefront', title: 'You are not linked to a unit yet', text: 'Ask the Compliance Head to set your unit in Settings → Team members.' })}</div>` });
    return;
  }
  const d = await api('/api/sites');
  if (stale(token)) return;
  app.today = d.today;
  const state = { q: query.get('q') || '', type: ['restaurant', 'kitchen'].includes(query.get('type')) ? query.get('type') : '', status: query.get('status') || '' };
  const cities = [...new Set(d.units.map((u) => u.city))];
  const rows = () => {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return d.units.filter((u) => (!state.type || u.kind === state.type) && (!state.status || u.status.overall === state.status)
      && words.every((w) => `${u.name} ${u.brand || ''} ${u.area || ''} ${u.city}`.toLowerCase().includes(w)));
  };
  const grid = () => {
    const rs = rows();
    return rs.length ? html`<div class="grid-cards">${rs.map(unitCard)}</div>`
      : html`<div class="card">${emptyState({ iconName: 'search_off', title: 'No units found', text: 'Nothing matches these filters.', action: html`<button class="btn" data-click="clear">Clear filters</button>` })}</div>`;
  };
  const sync = () => {
    const q = new URLSearchParams(Object.entries(state).filter(([, v]) => v));
    history.replaceState(null, '', `#/units${q.toString() ? `?${q}` : ''}`);
    $('#unitGrid').innerHTML = part(grid());
  };
  const n = (k) => d.units.filter((u) => !k || u.kind === k).length;
  mount({
    title: 'Units',
    body: html`
      ${pageHeader({ title: 'Units', sub: `${R.plural(d.units.length, 'unit')} · ${cities.join(' & ')}`, actions: html`<button class="btn primary" data-click="add">${icon('add')}Add unit</button>` })}
      <div class="stack">
        ${d.units.length ? html`<div class="filterbar">
          ${searchBar({ value: state.q, placeholder: 'Search units' })}
          <div class="full">${segmented({ name: 'type', value: state.type, label: 'Type', options: [['', 'All', n('')], ['restaurant', 'Restaurants', n('restaurant')], ['kitchen', 'Central kitchens', n('kitchen')]] })}</div>
          ${selectFilter({ name: 'status', value: state.status, label: 'Status', options: [['', 'Any status'], ...['noncompliance', 'improve', 'satisfactory', 'exemplar', 'none'].map((k) => [k, R.LEVELS[k].label])] })}
        </div>
        <div id="unitGrid">${grid()}</div>`
        : html`<div class="card">${emptyState({ iconName: 'storefront', title: 'No units yet', text: 'Add each outlet and central kitchen, then run the first audit at each.', action: html`<button class="btn primary" data-click="add">${icon('add')}Add unit</button>` })}</div>`}
      </div>`,
  });
  on.click = {
    add: () => openUnitDialog(),
    type: (el) => { state.type = el.dataset.v; $$('[data-click="type"]', view).forEach((b) => b.setAttribute('aria-pressed', String(b === el))); sync(); },
    clear: () => { location.hash = '#/units'; },
  };
  on.input = { q: (el) => { state.q = el.value; sync(); } };
  on.change = { status: (el) => { state.status = el.value; sync(); } };
  if (query.get('add')) { history.replaceState(null, '', '#/units'); openUnitDialog(); }
}

// Licences every unit is expected to hold; shown as "Not added" until recorded.
// (FSSAI, Fire NOC, water test, pest control, medical fitness, FoSTaC: rows 0, 1, 3, 4, 5, 6 of R.LICENCE_TYPES.)
const CORE_LICENCES = [0, 1, 3, 4, 5, 6].map((i) => R.LICENCE_TYPES[i].type);
function licState(l, today = app.today) {
  const left = l.expires_on ? R.daysBetween(today, l.expires_on) : null;
  if (left == null) return { key: 'valid', label: 'No expiry', tone: 'neutral', text: 'No expiry date' };
  if (left < 0) return { key: 'expired', label: 'Expired', tone: l.severity === 'minor' ? 'warn' : 'bad', text: `Expired ${R.plural(-left, 'day')} ago` };
  if (left <= R.LICENCE_WARN_DAYS) return { key: 'expiring', label: 'Expiring soon', tone: 'warn', text: `Expires in ${R.plural(left, 'day')}` };
  if (left <= R.LICENCE_NOTICE_DAYS) return { key: 'valid', label: 'Valid', tone: 'good', text: `Renew soon: ${R.plural(left, 'day')} left` };
  return { key: 'valid', label: 'Valid', tone: 'good', text: `Valid until ${fmt(l.expires_on, true)}` };
}

async function pageUnit({ token, params: [id], query }) {
  const d = await api(`/api/sites/${id}`);
  if (stale(token)) return;
  app.today = d.today;
  const s = d.site, u = d.summary, st = u.status, today = d.today;
  const food = d.audits.food, maint = d.audits.maintenance;
  const TABS = ['overview', 'audits', 'fixes', 'licences', 'photos'];
  let tab = TABS.includes(query.get('tab')) ? query.get('tab') : 'overview';
  const clean = (n) => n.replace(/^[A-C][.—\s-]+/, '').trim();
  const withUnit = (f) => ({ ...f, site_name: s.name, site_city: s.city, site_kind: s.kind, photos: safeList(f.photos) });
  const open = d.findings.filter((f) => R.UNRESOLVED.includes(f.status) || f.status === 'fixed').map(withUnit);
  const unresolved = open.filter((f) => R.UNRESOLVED.includes(f.status));
  const overdue = unresolved.filter((f) => f.due_date < today);
  const closed = d.closedFindings.map(withUnit);
  const allAudits = [...food, ...maint].sort((a, b) => b.audit_date.localeCompare(a.audit_date) || b.id - a.id);
  const lastMaint = maint.at(-1);
  const photos = [...open, ...closed].flatMap((f) => [...f.photos.map((p) => ({ key: p, f, proof: false })), ...(f.evidence_key ? [{ key: f.evidence_key, f, proof: true }] : [])])
    .filter((p) => !/\.pdf$/i.test(p.key));
  const missingLic = CORE_LICENCES.filter((t) => !d.licences.some((l) => l.type === t));

  const foodSections = () => {
    const names = [...new Set(food.flatMap((a) => (d.sections[a.id] || []).map((x) => clean(x.section))))];
    const cell = (a, n) => { const x = (d.sections[a.id] || []).find((y) => clean(y.section) === n); return x ? pct(x.score) : '—'; };
    return html`<div class="table-wrap"><table class="table"><thead><tr><th>Section</th>${food.map((a) => html`<th class="n">Visit ${a.visit} · ${fmt(a.audit_date)}</th>`)}</tr></thead>
      <tbody>${names.map((n) => html`<tr><td>${n}</td>${food.map((a) => html`<td class="n">${cell(a, n)}</td>`)}</tr>`)}
      <tr><td><b>Total</b></td>${food.map((a) => html`<td class="n"><b>${pct(a.score)}</b> <span class="muted">(${R.fmtNum(a.earned)}/${R.fmtNum(a.possible)})</span></td>`)}</tr></tbody></table></div>`;
  };
  const overviewTab = () => {
    const first = food[0], last = food.at(-1);
    return html`<div class="stack-lg">
      <section class="grid-stats" aria-label="Scores">
        ${statCard({ label: 'Food safety score', value: scoreDisplay(u.food.latest), sub: last ? html`${statusBadge(last.band)} <span>Target ${R.TARGET}%</span>` : 'No audit yet', href: last ? `#/audits/${last.id}` : `#/audits/new?unit=${s.id}&domain=food` })}
        ${statCard({ label: 'Maintenance score', value: lastMaint ? scoreDisplay(lastMaint.score) : html`<span class="muted">—</span>`, sub: lastMaint ? html`${statusBadge(lastMaint.band)} <span>Target ${R.TARGET}%</span>` : 'No maintenance docket yet', href: lastMaint ? `#/audits/${lastMaint.id}` : `#/audits/new?unit=${s.id}&domain=maintenance` })}
        ${statCard({ label: 'Open fixes', value: html`${unresolved.length}`, sub: `${u.open.p1} Priority 1${u.open.fixed ? ` · ${u.open.fixed} awaiting verification` : ''}`, click: 'tab', v: 'fixes' })}
        ${statCard({ label: 'Overdue fixes', value: html`${overdue.length}`, tone: overdue.length ? 'bad' : 'good', sub: overdue.length ? 'Past their due date' : 'Nothing overdue', href: `#/fixes?unit=${s.id}&status=overdue` })}
      </section>

      <section class="card">
        <div class="section-head"><h2>Why this status</h2>${statusBadge(st.overall)}<span class="sub">Overall status is the lower of food safety and maintenance (and licences, once recorded).</span></div>
        ${reasonsList(st.reasons, { siteId: s.id, showDomain: true })}
      </section>

      <section class="card stack" id="route-food">
        <div class="section-head" style="margin:0"><h2>Food safety: audit progress</h2></div>
        ${food.length ? html`
          <div class="journey">
            <div class="j-step"><span class="j-k">Visit 1 · ${fmt(first.audit_date)}</span><span class="j-v">${scoreDisplay(first.score)}</span><span class="j-s">${R.bandLabel(first.band)}</span></div>
            <span class="j-arrow">${icon('arrow_forward')}</span>
            <div class="j-step"><span class="j-k">Visit ${food.length > 1 ? `${last.visit} · ${fmt(last.audit_date)}` : 2}</span><span class="j-v">${food.length > 1 ? scoreDisplay(last.score) : html`<span class="muted">—</span>`}</span><span class="j-s">${food.length > 1 ? html`${R.bandLabel(last.band)} ${deltaSpan(u.food.delta, { unit: ' pts' })}` : 'Not done yet'}</span></div>
            <span class="j-arrow">${icon('arrow_forward')}</span>
            <div class="j-step j-goal"><span class="j-k">Target</span><span class="j-v">${R.TARGET}%</span><span class="j-s">${u.food.latest >= R.TARGET ? 'Reached' : `${R.fmtNum(u.food.route.needed)} marks to go`}</span></div>
          </div>
          ${food.length > 1 && first.scheme !== last.scheme ? checklistCaveat(first.scheme, last.scheme, last.visit) : ''}
          ${food.filter((a) => a.flag).map((a) => html`<div class="banner warn">${icon('info')}<span class="b-body"><b>Data note, visit ${a.visit}:</b> ${a.flag}</span></div>`)}
          ${collapse({ title: `Route to ${R.TARGET}%`, sub: routeSummary(u.food.route, 'food'), body: routeList(u.food.route, { domain: 'food', unitId: s.id }), open: query.get('route') === 'food' })}
          ${collapse({ title: 'Score by section, visit by visit', sub: `${R.plural(food.length, 'visit')}`, body: foodSections() })}`
        : emptyState({ compact: true, iconName: 'restaurant', title: 'No food safety audit yet', action: html`<a class="btn primary" href="#/audits/new?unit=${s.id}&domain=food">${icon('add')}Start food safety audit</a>` })}
      </section>

      <section class="card stack" id="route-maintenance">
        <div class="section-head" style="margin:0"><h2>Maintenance</h2>${lastMaint ? html`<span class="spacer"></span><a class="btn ghost sm" href="#/audits/${lastMaint.id}">View docket</a>` : ''}</div>
        ${lastMaint ? html`
          <div class="row" style="gap:12px">${scoreDisplay(lastMaint.score, { size: 'lg' })}${statusBadge(lastMaint.band)}<span class="small muted">Docket, ${fmt(lastMaint.audit_date, true)} · ${R.fmtNum(lastMaint.earned)} of ${R.fmtNum(lastMaint.possible)} points</span></div>
          ${progressBar(lastMaint.score, { target: true })}
          ${collapse({ title: `Route to ${R.TARGET}%`, sub: routeSummary(u.maintenance.route, 'maintenance'), body: routeList(u.maintenance.route, { domain: 'maintenance', unitId: s.id }) })}
          ${collapse({ title: 'Score by category', sub: `${(d.sections[lastMaint.id] || []).length} categories`, body: categoryBars(d.sections[lastMaint.id] || []) })}`
        : emptyState({ compact: true, iconName: 'handyman', title: 'No maintenance docket available', text: 'Walk the unit with the maintenance inspection docket.', action: html`<a class="btn primary" href="#/audits/new?unit=${s.id}&domain=maintenance">${icon('add')}Start maintenance docket</a>` })}
      </section>
    </div>`;
  };
  const auditsTab = () => (allAudits.length ? html`<section class="card flush">${dataTable(
    [{ label: 'Audit', w: 'minmax(0,1.6fr)' }, { label: 'Visit', w: '70px' }, { label: 'Date', w: 'minmax(0,1fr)' }, { label: 'Auditor', w: 'minmax(0,1.2fr)' }, { label: 'Score', w: '90px' }, { label: 'Status', w: 'minmax(0,1.4fr)' }, { label: '', w: '70px' }],
    allAudits.map((a) => dtRow(`#/audits/${a.id}`, [
      { cls: 'main', v: html`<div class="dt-primary">${R.DOMAINS[a.domain].label}</div>${a.source === 'import' || a.flag ? html`<div class="dt-secondary">${a.source === 'import' ? 'From report' : ''}${a.flag ? html`<span class="t-warn">Data note</span>` : ''}</div>` : ''}` },
      { lbl: 'Visit', v: `${a.visit}` }, { lbl: 'Date', v: fmt(a.audit_date, true) }, { lbl: 'Auditor', v: a.auditor || '—' },
      { lbl: 'Score', v: scoreDisplay(a.score) }, { cls: 'aside', v: statusBadge(a.band) }, viewCell(),
    ])))}</section>`
    : html`<div class="card">${emptyState({ iconName: 'fact_check', title: 'No audits yet', action: isManager() ? '' : html`<button class="btn primary" data-click="start">${icon('add')}Start audit</button>` })}</div>`);
  const fixesTab = () => html`<div class="stack">
    <div class="row"><span class="muted small">${R.plural(unresolved.length, 'open fix', 'open fixes')}${u.open.fixed ? ` · ${u.open.fixed} awaiting verification` : ''}${overdue.length ? ` · ${overdue.length} overdue` : ''}</span><span class="spacer"></span><a class="btn sm" href="#/fixes?unit=${s.id}">See all fixes</a></div>
    ${open.length ? html`<section class="card flush">${priorityGroups(open)}</section>` : html`<div class="card">${emptyState({ iconName: 'task_alt', tone: 'good', title: 'No open fixes', text: 'Every gap from the latest audits is closed.' })}</div>`}
    ${closed.length ? collapse({ title: `Recently closed (${closed.length})`, flush: true, body: html`<div class="list">${closed.map((f) => findingCard(f))}</div>` }) : ''}
  </div>`;
  const licRow = (l) => { const ls = licState(l, today); return html`<a class="list-row" href="#/licences/${l.id}"><span class="lead-icon tone-${ls.tone}">${icon('verified')}</span>
    <span class="lr-body"><span class="lr-title">${l.type}</span><span class="lr-meta">${l.number ? html`<span>No. ${l.number}</span>` : ''}<span class="${ls.tone === 'good' || ls.tone === 'neutral' ? '' : `t-${ls.tone}`}">${ls.text}</span>${l.file_key ? html`<span>${icon('attach_file')} scan</span>` : ''}</span></span>
    <span class="lr-trail">${toneBadge(ls.tone, ls.label)}${icon('chevron_right', 'chev')}</span></a>`; };
  const licencesTab = () => html`<div class="stack">
    <div class="row"><span class="muted small">${R.plural(d.licences.length, 'licence')} recorded${missingLic.length ? ` · ${missingLic.length} core licences not added` : ''}</span><span class="spacer"></span><button class="btn primary sm" data-click="addLicence">${icon('add')}Add licence</button></div>
    ${d.licences.length ? html`<section class="card flush"><div class="list">${d.licences.map(licRow)}</div></section>` : ''}
    ${missingLic.length ? html`<section class="card flush"><div class="section-head"><h2>Not added yet</h2><span class="sub">Record each with its expiry date to get 30-day warnings.</span></div><div class="list">${missingLic.map((t) => html`<div class="list-row"><span class="lead-icon tone-neutral">${icon('add_card')}</span><span class="lr-body"><span class="lr-title">${t}</span><span class="lr-meta">Not added</span></span><button class="btn sm" data-click="addLicence" data-type="${t}">Add</button></div>`)}</div></section>` : ''}
    ${!d.licences.length && !missingLic.length ? html`<div class="card">${emptyState({ iconName: 'verified', title: 'No licences added', action: html`<button class="btn primary" data-click="addLicence">${icon('add')}Add licence</button>` })}</div>` : ''}
  </div>`;
  const photosTab = () => (photos.length ? html`<section class="card"><div class="gallery">${photos.map((p) => html`<figure><a href="${fileUrl(p.key)}" target="_blank" rel="noopener"><img src="${fileUrl(p.key)}" alt="${p.proof ? 'Proof of fix' : 'Audit photo'}: ${p.f.title}" loading="lazy"></a>
      <figcaption>${p.proof ? html`<span class="badge tone-good" style="height:20px;font-size:11px;margin-bottom:3px">Proof</span><br>` : ''}<a href="#/fixes/${p.f.id}" class="clamp-2">${p.f.title}</a></figcaption></figure>`)}</div></section>`
    : html`<div class="card">${emptyState({ iconName: 'photo_library', title: 'No photos yet', text: 'Photos taken during audits and proof photos uploaded for fixes appear here.' })}</div>`);
  const tabContent = () => ({ overview: overviewTab, audits: auditsTab, fixes: fixesTab, licences: licencesTab, photos: photosTab })[tab]();
  const tabs = () => tabsBar({ name: 'tab', value: tab, tabs: [['overview', 'Overview'], ['audits', 'Audits', allAudits.length], ['fixes', 'Fixes', open.length], ['licences', 'Licences', d.licences.length], ['photos', 'Photos', photos.length]] });

  mount({
    title: s.name,
    body: html`
      ${pageHeader({ title: s.name, crumb: { href: '#/units', label: 'Units' },
        sub: html`<span>${unitType(s)}</span><span>·</span><span>${unitLoc(s)}</span>${s.manager ? html`<span>·</span><span>${icon('person', 'muted')} ${s.manager}</span>` : ''}${statusBadge(st.overall)}`,
        actions: isManager() ? html`<a class="btn" href="#/reports?unit=${s.id}">${icon('summarize')}View reports</a>`
          : html`<button class="btn primary" data-click="start">${icon('add')}Start audit</button><a class="btn" href="#/reports?unit=${s.id}">${icon('summarize')}View reports</a><button class="btn" data-click="edit">${icon('edit')}Edit unit</button>${app.me?.canManageUsers && !app.me.firstAdminSetup ? html`<button class="btn" data-click="addManager">${icon('person_add')}Add unit manager</button>` : ''}` })}
      <div id="unitTabs">${tabs()}</div>
      <div id="tabBody">${tabContent()}</div>`,
  });
  const setTab = (t) => {
    tab = t;
    const q = new URLSearchParams(query); if (t === 'overview') q.delete('tab'); else q.set('tab', t);
    history.replaceState(null, '', `#/units/${s.id}${q.toString() ? `?${q}` : ''}`);
    $('#unitTabs').innerHTML = part(tabs()); $('#tabBody').innerHTML = part(tabContent());
  };
  on.click = {
    tab: (el) => { setTab(el.dataset.v); if (el.classList.contains('stat')) $('#unitTabs').scrollIntoView({ behavior: 'smooth' }); },
    edit: () => openUnitDialog(s),
    start: () => openStartAudit([], s.id),
    addManager: async () => { const sites = (await api('/api/sites')).units; openPersonDialog(null, { units: sites, preset: { role: 'manager', site_id: s.id }, onDone: () => toast(`Unit manager added for ${s.name}`, { success: true }) }); },
    addLicence: async (el) => { const sites = (await api('/api/sites')).units; openLicenceDialog(null, sites, s.id, el.dataset.type || null); },
  };
}

// =================================================================== page: audits
async function pageAudits({ token, query }) {
  const [d, sites] = await Promise.all([api('/api/audits'), api('/api/sites')]);
  if (stale(token)) return;
  app.today = sites.today;
  const state = { domain: R.AUDIT_DOMAINS.includes(query.get('domain')) ? query.get('domain') : '', unit: query.get('unit') || '', status: query.get('status') || '', from: query.get('from') || '', to: query.get('to') || '', q: query.get('q') || '' };
  const prevOf = (a) => d.audits.find((x) => x.site_id === a.site_id && x.domain === a.domain && x.visit === a.visit - 1);
  const base = () => {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return d.audits.filter((a) => (!state.unit || String(a.site_id) === state.unit) && (!state.status || a.band === state.status)
      && (!state.from || a.audit_date >= state.from) && (!state.to || a.audit_date <= state.to)
      && words.every((w) => `${a.site_name} ${a.site_city} ${a.auditor || ''} ${R.DOMAINS[a.domain].label}`.toLowerCase().includes(w)));
  };
  const rows = () => base().filter((a) => !state.domain || a.domain === state.domain);
  const cols = [{ label: 'Unit', w: 'minmax(0,2fr)' }, { label: 'Audit type', w: 'minmax(0,1.2fr)' }, { label: 'Visit', w: '60px' }, { label: 'Date', w: 'minmax(0,1fr)' },
    { label: 'Score', w: 'minmax(0,1.1fr)' }, { label: 'Status', w: 'minmax(0,1.5fr)' }, { label: '', w: '70px' }];
  const list = () => {
    const rs = rows();
    if (!rs.length) {
      return d.audits.length ? emptyState({ iconName: 'search_off', title: 'No audits found', text: 'Nothing matches these filters.', action: html`<button class="btn" data-click="clear">Clear filters</button>` })
        : emptyState({ iconName: 'fact_check', title: 'No audits yet', text: 'Run the first audit with your phone at the unit.', action: html`<a class="btn primary" href="#/audits/new">${icon('add')}Start audit</a>` });
    }
    return dataTable(cols, rs.map((a) => {
      const p = prevOf(a);
      return dtRow(`#/audits/${a.id}`, [
        { cls: 'main', v: html`<div class="dt-primary">${unitName(a)}</div><div class="dt-secondary"><span>${a.auditor || ''}</span>${R.auditMinutes(a) != null ? html`<span>${icon('schedule', 'muted')} ${R.fmtDuration(R.auditMinutes(a))}</span>` : ''}<span>${R.plural(a.findings_count, 'fix', 'fixes')} raised</span>${a.flag ? html`<span class="t-warn" title="${a.flag}">Data note</span>` : ''}</div>` },
        { lbl: 'Type', v: R.DOMAINS[a.domain].label }, { lbl: 'Visit', v: `${a.visit}` }, { lbl: 'Date', v: fmt(a.audit_date, true) },
        { lbl: 'Score', v: html`${scoreDisplay(a.score)} ${p ? deltaSpan(a.score - p.score) : ''}` },
        { cls: 'aside', v: statusBadge(a.band) }, viewCell(),
      ]);
    }));
  };
  const sync = () => {
    const q = new URLSearchParams(Object.entries(state).filter(([, v]) => v));
    history.replaceState(null, '', `#/audits${q.toString() ? `?${q}` : ''}`);
    $('#domainSeg').innerHTML = part(domainSeg());
    $('#auditList').innerHTML = part(list());
  };
  const domainSeg = () => { const b = base(); return segmented({ name: 'domain', value: state.domain, label: 'Audit type', options: [['', 'All', b.length], ['food', 'Food safety', b.filter((a) => a.domain === 'food').length], ['maintenance', 'Maintenance', b.filter((a) => a.domain === 'maintenance').length]] }); };
  mount({
    title: 'Audits',
    body: html`
      ${pageHeader({ title: 'Audits', sub: `${R.plural(d.audits.length, 'audit')} on record · food safety and maintenance`, actions: isManager() ? '' : html`<button class="btn primary" data-click="start">${icon('add')}Start audit</button>` })}
      <div class="stack">
        <div id="domainSeg">${domainSeg()}</div>
        <div class="filterbar">
          ${searchBar({ value: state.q, placeholder: 'Search unit or auditor' })}
          ${selectFilter({ name: 'unit', value: state.unit, label: 'Unit', options: [['', 'All units'], ...sites.units.map((s) => [s.id, unitName(s)])] })}
          ${selectFilter({ name: 'status', value: state.status, label: 'Status', options: [['', 'Any status'], ...['noncompliance', 'improve', 'satisfactory', 'exemplar'].map((k) => [k, R.LEVELS[k].label])] })}
          <label class="sr-only" for="aFrom">From date</label><input class="date-input" type="date" id="aFrom" data-change="from" value="${state.from}" title="From date">
          <label class="sr-only" for="aTo">To date</label><input class="date-input" type="date" id="aTo" data-change="to" value="${state.to}" title="To date">
        </div>
        <section class="card flush" id="auditList">${list()}</section>
        ${downloadBar({ title: 'Download these audits', text: 'Every audit matching the filters above, as a formatted PDF or an Excel spreadsheet.' })}
      </div>`,
  });
  const describe = () => [state.domain ? R.DOMAINS[state.domain].label : 'Food safety & maintenance',
    state.unit ? unitName(sites.units.find((u) => String(u.id) === state.unit) || { name: 'Unknown unit' }) : 'All units',
    state.status ? R.LEVELS[state.status].label : null,
    state.from || state.to ? `${state.from ? fmt(state.from, true) : 'First audit'} – ${state.to ? fmt(state.to, true) : 'today'}` : null,
    state.q ? `Search “${state.q}”` : null].filter(Boolean).join(' · ');
  /** Downloads the audits that match the current filters. */
  const exportList = async (format) => {
    const rs = rows();
    if (!rs.length) throw new ApiError('No audits match these filters, so there is nothing to download.');
    const doms = R.AUDIT_DOMAINS.filter((dm) => rs.some((a) => a.domain === dm));
    const avg = (dm) => { const xs = rs.filter((a) => a.domain === dm).map((a) => a.score); return xs.length ? R.round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null; };
    const change = (a) => { const p = prevOf(a); return p ? R.round1(a.score - p.score) : null; };
    const tt = timeTotals(rs);
    const base = `bookends-audits-${state.domain || 'all'}${state.unit ? `-${fileSlug(rs[0].site_name)}` : ''}-${app.today}`;
    if (format === 'pdf') {
      const k = await pdfKit({ title: 'Audits', subtitle: describe(), running: `Audits · ${describe()}` });
      k.kpis([
        { label: 'Audits', value: String(rs.length), sub: doms.map((dm) => `${rs.filter((a) => a.domain === dm).length} ${R.DOMAINS[dm].label.toLowerCase()}`).join(' · ') },
        ...doms.map((dm) => ({ label: `${R.DOMAINS[dm].label} average`, value: pct(avg(dm)), tone: toneOf(R.bandFor(avg(dm))), sub: `Target ${R.TARGET}%` })),
        { label: 'Time auditing', value: tt.timed ? R.fmtDuration(tt.total) : '-', sub: timeSub(tt, rs.length) },
        { label: `Below ${R.TARGET}%`, value: String(rs.filter((a) => a.score < R.TARGET).length), tone: rs.some((a) => a.score < R.TARGET) ? 'warn' : 'good', sub: `${rs.filter((a) => a.score < 50).length} below 50%` },
      ]);
      if (doms.includes('food')) k.note(CHECKLIST_NOTE);
      k.section('Audits', 'Newest first · change is against the previous visit');
      k.table(['Date', 'Unit', 'Audit', 'Visit', 'Auditor', 'Time taken', 'Score', 'Change', 'Grade', 'Fixes raised'],
        rs.map((a) => {
          const c = change(a);
          return [fmt(a.audit_date, true), unitName(a), R.DOMAINS[a.domain].label, k.num(a.visit), a.auditor || '-', R.auditMinutes(a) == null ? '-' : R.fmtDuration(R.auditMinutes(a)), k.scoreCell(a.score),
            c == null ? { content: '-', styles: { halign: 'right', textColor: PDF.MUTED } } : { content: R.fmtDelta(c).replace(' pts', ''), styles: { halign: 'right', textColor: c > 0 ? PDF.FG.good : c < 0 ? PDF.FG.bad : PDF.MUTED } },
            k.badge(toneOf(a.band), R.bandLabel(a.band)), k.num(a.findings_count)];
        }),
        { 0: { cellWidth: 19 }, 2: { cellWidth: 19 }, 3: { cellWidth: 10 }, 4: { cellWidth: 19 }, 5: { cellWidth: 16 }, 6: { cellWidth: 14 }, 7: { cellWidth: 13 }, 8: { cellWidth: 26 }, 9: { cellWidth: 13 } });
      k.note(GRADE_KEY, { italic: false });
      return k.save(`${base}.pdf`);
    }
    const x = await xlsxKit();
    const below = rs.filter((a) => a.score < R.TARGET).length, below50 = rs.filter((a) => a.score < 50).length;
    x.summary('Summary', { title: 'Audits', subtitle: describe(), blocks: [
      { heading: 'Showing', rows: [['Filters', describe()]] },
      { heading: 'Key numbers', rows: [['Audits', rs.length], ...doms.map((dm) => [`${R.DOMAINS[dm].label} average score (%)`, n1(avg(dm))]),
        ['Total time auditing', tt.timed ? R.fmtDuration(tt.total) : 'No times recorded'], ['Average time per audit', tt.timed ? R.fmtDuration(tt.avg) : '-'], ['Audits with a recorded time', `${tt.timed} of ${rs.length}`],
        [`Audits below ${R.TARGET}%`, below, { tone: below ? 'warn' : 'good' }], ['Audits below 50%', below50, { tone: below50 ? 'bad' : 'good' }], ['Target score (%)', R.TARGET]] },
      { heading: 'Grade bands', rows: GRADE_ROWS },
      { heading: 'Priorities', rows: PRIORITY_ROWS },
      ...(doms.includes('food') ? [{ heading: 'Note', rows: [['Different checklists', CHECKLIST_NOTE]] }] : []),
    ] });
    x.table('Audits', { title: 'Audits', subtitle: describe(),
      head: ['Date', 'Unit', 'City', 'Unit type', 'Audit', 'Visit', 'Auditor', 'Time', 'Time taken (min)', 'Score (%)', 'Change vs previous visit (pts)', 'Grade', 'Earned', 'Possible', 'Fixes raised', 'Data note'],
      rows: rs.map((a) => [a.audit_date, a.site_name, a.site_city, unitType(a), R.DOMAINS[a.domain].label, a.visit, a.auditor || '', R.auditTimeRange(a), R.auditMinutes(a) ?? '', n1(a.score), n1(change(a)), R.bandLabel(a.band), a.earned, a.possible, a.findings_count, a.flag || '']),
      widths: [13, 26, 12, 16, 14, 7, 16, 20, 10, 10, 13, 20, 9, 9, 9, 44] });
    return x.save(`${base}.xlsx`);
  };
  on.click = {
    domain: (el) => { state.domain = el.dataset.v; sync(); },
    dlNow: (el) => runDownload(el, exportList),
    clear: () => { location.hash = '#/audits'; },
    start: () => openStartAudit(sites.units),
  };
  on.change = Object.fromEntries(['unit', 'status', 'from', 'to'].map((k) => [k, (el) => { state[k] = el.value; sync(); }]));
  on.input = { q: (el) => { state.q = el.value; sync(); } };
}

async function pageAudit({ token, params: [id] }) {
  const d = await api(`/api/audits/${id}`);
  if (stale(token)) return;
  const a = d.audit, scheme = a.scheme, L = R.SCHEMES[scheme].ratings;
  const resp = new Map(d.responses.map((r) => [r.item_id, r]));
  const unitWord = unitWordFor(a.domain);
  let gapsOnly = true;
  const sections = [...new Set(d.items.map((i) => i.section))];
  const findings = d.findings.map((f) => ({ ...f, site_name: a.site_name, site_city: a.site_city, site_kind: a.site_kind }));
  const lineHtml = (i) => {
    const r = resp.get(i.id), f = findings.find((x) => x.item_id === i.id);
    return html`<div class="list-row" style="display:grid;gap:6px">
      <div class="row" style="gap:8px">${ratingChip(scheme, r.result)}<span class="small muted num">${i.code}</span>${star(i.critical)}${i.criticality ? html`<span class="small muted">${i.criticality}</span>` : ''}${i.area && i.area !== i.section ? html`<span class="small muted">${i.area}</span>` : ''}
        <span class="spacer"></span><span class="small num muted">${r.result === 'na' ? 'N/A' : `${R.fmtNum(r.points)} / ${R.fmtNum(i.weight)}`}</span></div>
      <div>${i.text}</div>
      ${r.note ? html`<div class="small" style="white-space:pre-wrap">“${r.note}”</div>` : ''}
      ${r.photos.length ? html`<div class="thumbs">${r.photos.map((p) => html`<a href="${fileUrl(p)}" target="_blank" rel="noopener"><img class="thumb" src="${fileUrl(p)}" alt="Photo for ${i.code}" loading="lazy"></a>`)}</div>` : ''}
      ${f ? html`<div class="small row" style="gap:8px">${prioBadge(f.priority)}<a href="#/fixes/${f.id}">Fix #${f.id}</a>${fixStatusBadge(f)}</div>` : ''}
    </div>`;
  };
  const linesHtml = () => sections.map((sec) => {
    const items = d.items.filter((i) => i.section === sec && (!gapsOnly || ['fail', 'partial'].includes(resp.get(i.id)?.result)));
    if (!items.length) return '';
    const sc = d.sections.find((x) => x.section === sec);
    return html`<div class="dt-group"><h3>${sec}</h3><span class="muted small">${sc?.score == null ? '' : pct(sc.score)}</span></div>${items.map(lineHtml)}`;
  });
  const openF = d.findings.filter((f) => f.status !== 'closed');
  const route = {
    ...d.route, score: a.score, open: openF.length,
    afterP1: R.round1(((a.earned + openF.filter((f) => f.priority === 'critical').reduce((x, f) => x + f.marks, 0)) / a.possible) * 100),
    steps: d.route.steps.map((s) => { const f = d.findings.find((x) => x.id === s.id); const it = d.items.find((i) => i.id === f?.item_id); return { ...s, title: f?.title, kind: f?.kind, code: it?.code, area: it?.area }; }),
  };
  const prev = a.previous;
  const counts = d.counts;
  mount({
    title: `${unitName(a)} · ${R.DOMAINS[a.domain].label}`,
    body: html`
      ${pageHeader({ title: unitName(a), crumb: { href: '#/audits', label: 'Audits' },
        sub: html`<span>${R.DOMAINS[a.domain].label} audit</span><span>·</span><span>Visit ${a.visit} of ${a.visits}</span><span>·</span><span>${fmt(a.audit_date, true)}</span>${R.auditTimeRange(a) ? html`<span>·</span><span>${R.auditTimeRange(a)}</span>` : ''}${statusBadge(a.band)}`,
        actions: html`<a class="btn" href="#/units/${a.site_id}">${icon('storefront')}View unit</a>${findings.some((f) => f.status !== 'closed') ? html`<a class="btn primary" href="#/fixes?unit=${a.site_id}&domain=${a.domain}">${icon('construction')}View fixes</a>` : ''}` })}
      <div class="stack-lg">
        <section class="card stack">
          <div class="section-head" style="margin:0"><h2>Audit summary</h2></div>
          <div class="row" style="gap:16px;align-items:flex-end">
            <div>${scoreDisplay(a.score, { size: 'xl' })}</div>
            <div class="stack" style="gap:4px">${statusBadge(a.band, { lg: true })}<span class="small muted">${R.fmtNum(a.earned)} of ${R.fmtNum(a.possible)} ${unitWord} · target ${R.TARGET}%</span></div>
            <span class="spacer"></span>
            ${prev ? html`<span class="small">Visit ${a.visit - 1}: <b>${pct(prev.score)}</b> ${deltaSpan(a.score - prev.score, { unit: ' pts' })}</span>` : ''}
          </div>
          ${progressBar(a.score, { band: a.band, target: true })}
          <div class="strip">
            ${statCard({ label: L.pass, value: html`${counts.pass}`, tone: 'good' })}
            ${statCard({ label: L.fail, value: html`${counts.fail}`, tone: counts.fail ? 'bad' : '' })}
            ${statCard({ label: L.partial, value: html`${counts.partial}`, tone: counts.partial ? 'warn' : '' })}
            ${statCard({ label: L.na, value: html`${counts.na}` })}
          </div>
          ${counts.criticalFails ? html`<div class="banner bad">${icon('report')}<span class="b-body"><span class="star">★</span> ${R.plural(counts.criticalFails, 'critical line')} rated ${L.fail}. Critical lines count double.</span></div>` : ''}
          ${prev && a.domain === 'food' ? html`<p class="small muted">If the previous visit used a different checklist (the Aug 2026 first visits used the 39-line Schedule 4 readiness checklist), read the change as a direction, not an exact like-for-like measurement.</p>` : ''}
          ${a.flag ? html`<div class="banner warn">${icon('info')}<span class="b-body"><b>Data note:</b> ${a.flag}</span></div>` : ''}
          <div class="facts" style="padding-top:6px;border-top:1px solid var(--border)">
            <div class="fact"><div class="k">Unit</div><div class="v"><a href="#/units/${a.site_id}">${a.site_name}</a></div></div>
            <div class="fact"><div class="k">Auditor</div><div class="v">${a.auditor || '—'}</div></div>
            <div class="fact"><div class="k">Type</div><div class="v">${a.audit_type || '—'}</div></div>
            <div class="fact"><div class="k">Time</div><div class="v">${R.auditTimeRange(a) || '—'}${R.auditMinutes(a) != null ? html`<br><span class="small muted">${R.fmtDuration(R.auditMinutes(a))}</span>` : ''}</div></div>
            <div class="fact"><div class="k">Checklist</div><div class="v small">${a.template_name}</div></div>
          </div>
          <p class="small muted">${R.SCHEMES[scheme].marking} Bands: Exemplar 90%+, Satisfactory 80%+, Needs Improvement 50%+, Non-Compliance below 50%.${a.source === 'import' ? ` Loaded from ${a.source_ref}${a.prepared_by ? `, prepared by ${a.prepared_by}` : ''}.` : ''}</p>
        </section>

        ${a.summary ? html`<section class="card"><div class="section-head"><h2>Auditor’s conclusion</h2></div><div class="prose">${a.summary.split('\n').map((p) => html`<p>${p}</p>`)}</div></section>` : ''}

        <section class="card flush">
          <div class="section-head"><h2>Findings</h2><span class="count">${findings.length}</span><span class="sub">Every gap raised by this audit, by priority. Open one for the full details, evidence and review.</span></div>
          ${findings.length ? priorityGroups(findings)
            : counts.fail + counts.partial ? emptyState({ compact: true, iconName: 'link_off', title: 'No fixes are tracked from this visit', text: `Its ${R.plural(counts.fail + counts.partial, 'gap')} are listed in the full checklist below. Fixes are tracked from the unit’s latest ${R.DOMAINS[a.domain].label.toLowerCase()} visit.`, action: html`<a class="btn" href="#/fixes?unit=${a.site_id}&domain=${a.domain}">See the unit’s fixes</a>` })
              : emptyState({ iconName: 'task_alt', tone: 'good', title: 'No findings', text: 'Every line was compliant or N/A.' })}
        </section>

        ${collapse({ iconName: 'bar_chart', title: `Score by ${a.domain === 'food' ? 'section' : 'category'}`, sub: `${d.sections.length} ${a.domain === 'food' ? 'sections' : 'categories'}`, body: categoryBars(d.sections) })}
        ${collapse({ iconName: 'route', title: `Route to ${R.TARGET}%`, sub: routeSummary(route, a.domain), body: routeList(route, { domain: a.domain, unitId: a.site_id, compact: true }) })}
        ${collapse({ iconName: 'checklist', title: 'Full checklist', sub: `${d.items.length} lines · ${counts.fail + counts.partial} gaps`, flush: true, open: !findings.length && counts.fail + counts.partial > 0, body: html`
          <div class="row" style="padding:14px 24px">${segmented({ name: 'gaps', value: '1', label: 'Show', options: [['1', 'Gaps only'], ['0', `All ${d.items.length} lines`]] })}</div>
          <div class="list" id="lines">${linesHtml()}</div>` })}
        ${downloadBar({ title: 'Download this audit', text: 'The full audit report: summary, conclusion, section scores, findings, route to 80% and every checklist line.' })}
      </div>`,
  });
  /** Downloads this audit in full: summary, conclusion, section scores, findings, route to 80% and every checklist line. */
  const exportAudit = async (format) => {
    const unitLabel = unitName(a);
    const subtitle = `${R.DOMAINS[a.domain].label} audit · Visit ${a.visit} of ${a.visits} · ${fmt(a.audit_date, true)}`;
    const base = `bookends-audit-${fileSlug(unitLabel)}-${a.domain}-visit-${a.visit}-${a.audit_date}`;
    const lineRows = d.items.map((i) => ({ i, r: resp.get(i.id), f: findings.find((x) => x.item_id === i.id) }));
    const ptsText = ({ i, r }) => (r.result === 'na' ? 'N/A' : `${R.fmtNum(r.points)} / ${R.fmtNum(i.weight)}`);
    const pairs = [['Unit', unitLabel], ['Auditor', a.auditor || '-'], ['Audit', `${R.DOMAINS[a.domain].label}, visit ${a.visit} of ${a.visits}`], ['Date', fmt(a.audit_date, true)], ['Time', R.auditTimeRange(a) || '-'], ['Time taken', R.auditMinutes(a) == null ? '-' : R.fmtDuration(R.auditMinutes(a))],
      ['Audit type', a.audit_type || '-'], ['Checklist', a.template_name], [unitWord === 'marks' ? 'Marks' : 'Points', `${R.fmtNum(a.earned)} of ${R.fmtNum(a.possible)}`],
      ['Previous visit', prev ? `${pct(prev.score)} (${R.fmtDelta(a.score - prev.score)})` : 'None'],
      ...(a.source === 'import' ? [['Source', `${a.source_ref}${a.prepared_by ? `, prepared by ${a.prepared_by}` : ''}`]] : [])];
    const sortedFindings = [...findings].sort((x, y) => R.PRIORITY_ORDER.indexOf(x.priority) - R.PRIORITY_ORDER.indexOf(y.priority) || x.id - y.id);
    if (format === 'pdf') {
      const k = await pdfKit({ title: unitLabel, subtitle, running: `${unitLabel} · ${subtitle}` });
      k.kpis([
        { label: `Score (target ${R.TARGET}%)`, value: pct(a.score), tone: toneOf(a.band), sub: R.bandLabel(a.band) },
        { label: L.pass, value: String(counts.pass), tone: 'good', sub: 'lines' },
        { label: L.fail, value: String(counts.fail), tone: counts.fail ? 'bad' : null, sub: 'lines' },
        { label: L.partial, value: String(counts.partial), tone: counts.partial ? 'warn' : null, sub: 'lines' },
        { label: L.na, value: String(counts.na), sub: 'lines' },
      ]);
      k.details(pairs);
      if (counts.criticalFails) k.note(`${R.plural(counts.criticalFails, 'critical line')} (*) rated ${L.fail}. Critical lines count double.`, { tone: 'bad' });
      if (a.flag) k.note(`Data note: ${a.flag}`, { tone: 'warn' });
      if (prev && a.domain === 'food') k.note('If the previous visit used a different checklist (the Aug 2026 first visits used the 39-line Schedule 4 readiness checklist), read the change as a direction, not an exact like-for-like measurement.');
      if (a.summary) { k.section('Auditor’s conclusion'); k.paragraphs(a.summary); }
      k.section(`Score by ${a.domain === 'food' ? 'section' : 'category'}`);
      k.table([a.domain === 'food' ? 'Section' : 'Category', 'Score', 'Grade'],
        d.sections.map((s) => [s.section, k.scoreCell(s.score), s.score == null ? 'N/A' : k.badge(toneOf(R.bandFor(s.score)), R.bandLabel(R.bandFor(s.score)))]), { 1: { cellWidth: 22 }, 2: { cellWidth: 40 } });
      k.section('Findings', R.plural(findings.length, 'fix', 'fixes'));
      if (findings.length) {
        k.table(['#', 'Priority', 'Finding', 'Rating', 'Status', 'Assigned to', 'Due'],
          sortedFindings.map((f) => [k.num(f.id), k.prioCell(f.priority), f.title, k.badge(RESULT_TONE[f.rating] || 'neutral', L[f.rating] || f.rating),
            isOverdue(f) ? { content: 'Overdue', styles: { textColor: PDF.FG.bad, fontStyle: 'bold' } } : FIX_STATUS[f.status][1], f.owner || '-', fmt(f.due_date, true)]),
          { 0: { cellWidth: 10 }, 1: { cellWidth: 14 }, 3: { cellWidth: 22 }, 4: { cellWidth: 25 }, 5: { cellWidth: 24 }, 6: { cellWidth: 21 } });
      } else {
        k.empty(counts.fail + counts.partial ? `No fixes are tracked from this visit. Its ${R.plural(counts.fail + counts.partial, 'gap')} are listed in the checklist below.` : 'No findings: every line was compliant or N/A.');
      }
      if (a.score < R.TARGET && route.steps.length) {
        k.section(`Route to ${R.TARGET}%`, `${R.fmtNum(route.needed)} ${unitWord} short · Priority 1 first`);
        k.table(['Step', 'Fix', 'Priority', 'Wins back', 'Score after'],
          route.steps.map((s, n) => [k.num(n + 1), s.title || '-', k.prioCell(s.priority), `+${R.fmtNum(s.marks)} ${unitWord}`, k.scoreCell(s.after)]),
          { 0: { cellWidth: 12 }, 2: { cellWidth: 16 }, 3: { cellWidth: 26 }, 4: { cellWidth: 22 } });
      }
      k.section('Full checklist', `${d.items.length} lines · * = critical line (counts double)`);
      const body = [];
      for (const sec of sections) {
        const sc = d.sections.find((x) => x.section === sec);
        body.push([{ content: `${sec}${sc?.score == null ? '' : `   ${pct(sc.score)}`}`, colSpan: 5, styles: { fillColor: PDF.HEAD, fontStyle: 'bold', textColor: PDF.INK } }]);
        for (const x of lineRows.filter((l) => l.i.section === sec)) {
          const ph = x.r.photos.length;
          body.push([`${x.i.code}${x.i.critical ? ' *' : ''}`, x.i.text, k.badge(RESULT_TONE[x.r.result], L[x.r.result]), { content: ptsText(x), styles: { halign: 'right' } },
            [x.r.note, ph ? `[${R.plural(ph, 'photo')} in the app]` : '', x.f ? `Fix #${x.f.id}` : ''].filter(Boolean).join('\n') || '-']);
        }
      }
      k.table(['Code', 'Checklist line', 'Rating', 'Points', 'Remark'], body, { 0: { cellWidth: 13 }, 1: { cellWidth: 72 }, 2: { cellWidth: 24 }, 3: { cellWidth: 15 } });
      k.note(`${R.SCHEMES[scheme].marking} ${GRADE_KEY}`, { italic: false });
      return k.save(`${base}.pdf`);
    }
    const x = await xlsxKit();
    x.summary('Summary', { title: `${unitLabel}: ${R.DOMAINS[a.domain].label} audit`, subtitle, blocks: [
      { heading: 'Audit', rows: pairs },
      { heading: 'Result', rows: [['Score (%)', n1(a.score)], ['Grade', R.bandLabel(a.band)], ['Target (%)', R.TARGET],
        [`Short of ${R.TARGET}%`, a.score >= R.TARGET ? 'Target reached' : `${R.fmtNum(route.needed)} ${unitWord}`, { tone: a.score >= R.TARGET ? 'good' : 'warn' }]] },
      { heading: 'Ratings', rows: [...['pass', 'fail', 'partial', 'na'].map((v) => [L[v], counts[v]]), [`Critical lines rated ${L.fail}`, counts.criticalFails, { tone: counts.criticalFails ? 'bad' : 'good' }]] },
      ...(counts.criticalFails || a.flag || (prev && a.domain === 'food') ? [{ heading: 'Notes', rows: [
        ...(counts.criticalFails ? [['Critical lines', `${R.plural(counts.criticalFails, 'critical line')} rated ${L.fail}. Critical lines count double.`, { tone: 'bad' }]] : []),
        ...(a.flag ? [['Data note', a.flag, { tone: 'warn' }]] : []),
        ...(prev && a.domain === 'food' ? [['Different checklists', 'If the previous visit used a different checklist (the Aug 2026 first visits used the 39-line Schedule 4 readiness checklist), read the change as a direction, not an exact like-for-like measurement.']] : []),
      ] }] : []),
      ...(a.summary ? [{ heading: 'Auditor’s conclusion', rows: [['Conclusion', a.summary]] }] : []),
      { heading: 'Marking', rows: [['How lines are marked', R.SCHEMES[scheme].marking]] },
      { heading: 'Grade bands', rows: GRADE_ROWS },
      { heading: 'Priorities', rows: PRIORITY_ROWS },
    ] });
    x.table(a.domain === 'food' ? 'Sections' : 'Categories', { title: `${unitLabel}: score by ${a.domain === 'food' ? 'section' : 'category'}`, subtitle,
      head: [a.domain === 'food' ? 'Section' : 'Category', 'Score (%)', 'Grade'],
      rows: d.sections.map((s) => [s.section, n1(s.score), s.score == null ? 'N/A' : R.bandLabel(R.bandFor(s.score))]),
      widths: [48, 12, 22] });
    x.table('Checklist', { title: `${unitLabel}: full checklist`, subtitle,
      head: ['Section', 'Code', 'Area', 'Critical', 'Checklist line', 'Rating', 'Points', 'Max points', 'Remark', 'Photos', 'Fix #', 'Priority'],
      rows: lineRows.map(({ i, r, f }) => [i.section, i.code, i.area || '', i.critical ? 'Yes' : '', i.text, L[r.result], r.result === 'na' ? '' : r.points, i.weight, r.note || '', r.photos.length || '', f ? f.id : '', f ? R.PRIORITY[f.priority].label : '']),
      widths: [24, 7, 18, 9, 58, 15, 8, 9, 46, 8, 7, 12] });
    x.table('Findings', { title: `${unitLabel}: findings`, subtitle,
      head: ['Fix #', 'Priority', 'Finding', 'Rating', 'Status', 'Assigned to', 'Due date', 'Marks to win back', 'Remark'],
      rows: sortedFindings.map((f) => [f.id, R.PRIORITY[f.priority].label, f.title, L[f.rating] || f.rating, isOverdue(f) ? 'Overdue' : FIX_STATUS[f.status][1], f.owner || '', f.due_date, f.marks, f.detail || '']),
      widths: [7, 12, 58, 14, 22, 18, 13, 10, 46] });
    if (a.score < R.TARGET && route.steps.length) {
      x.table(`Route to ${R.TARGET}%`, { title: `${unitLabel}: route to ${R.TARGET}%`, subtitle: `${subtitle} · ${R.fmtNum(route.needed)} ${unitWord} short · Priority 1 first`,
        head: ['Step', 'Fix', 'Priority', `Wins back (${unitWord})`, 'Score after (%)'],
        rows: route.steps.map((s, n) => [n + 1, s.title || '', R.PRIORITY[s.priority].label, s.marks, n1(s.after)]),
        widths: [7, 58, 12, 12, 12] });
    }
    return x.save(`${base}.xlsx`);
  };
  on.click = {
    dlNow: (el) => runDownload(el, exportAudit),
    gaps: (el) => {
      gapsOnly = el.dataset.v === '1';
      $$('[data-click="gaps"]', view).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === el.dataset.v)));
      $('#lines').innerHTML = part(linesHtml());
    },
  };
}

// =================================================================== page: new audit (the phone flow, one section per step)
const DRAFT_KEY = 'bk-audit-draft:v2';
/** The latest date an audit can have: the server's today, or the phone's when offline and the saved copy is from an earlier day. */
const auditToday = () => (!navigator.onLine && localToday() > app.today ? localToday() : app.today);
const loadDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null; } catch { return null; } };
const saveDraft = (x) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(x)); } catch { /* private mode */ } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

async function pageNewAudit({ token, query }) {
  if (isManager()) {
    mount({ title: 'New audit', body: html`${pageHeader({ title: 'Start an audit', crumb: { href: '#/audits', label: 'Audits' } })}<div class="card">${emptyState({ iconName: 'lock', title: 'Only the Compliance Head runs audits', text: 'You can see your unit’s audits, and work on its fixes on the Dashboard.', action: html`<a class="btn primary" href="#/">${icon('construction')}Go to dashboard</a>` })}</div>` });
    return;
  }
  const [sitesRes, templates] = await Promise.all([api('/api/sites'), getTemplates()]);
  if (stale(token)) return;
  const units = sitesRes.units;
  const fresh = () => ({
    site_id: +query.get('unit') || null, domain: R.AUDIT_DOMAINS.includes(query.get('domain')) ? query.get('domain') : null,
    audit_date: auditToday(), auditor: app.me?.name || '', audit_type: 'Surprise', answers: {}, summary: '', step: 0, client_id: newId(),
  });
  let draft = loadDraft();
  let conflict = null;
  if (draft && !units.some((s) => s.id === draft.site_id)) draft = null;
  if (draft && Object.keys(draft.answers || {}).length && ((query.get('unit') && +query.get('unit') !== draft.site_id) || (query.get('domain') && query.get('domain') !== draft.domain))) { conflict = draft; draft = fresh(); }
  draft = draft || fresh();
  draft.client_id ||= newId(); // drafts saved before audits carried one
  await loadLocalThumbs([...Object.values(draft.answers || {}), ...Object.values(conflict?.answers || {})]);
  if (stale(token)) return;
  const persist = () => saveDraft(draft);
  /** The audit starts when the auditor first moves into the checklist (or rates a line, for drafts saved before times were kept). */
  const markStart = () => { if (!draft.started_at) draft.started_at = new Date().toISOString(); };
  const timeHtml = () => (draft.started_at ? html`<span class="muted">·</span><span class="small muted" title="Recorded automatically">${icon('schedule', 'muted')} Started ${R.fmtClock(draft.started_at)} · ${R.fmtDuration(Math.max(0, Math.round((Date.now() - Date.parse(draft.started_at)) / 60000)))} so far</span>` : '');
  const unit = () => units.find((s) => s.id === draft.site_id);
  const tpl = () => templates.find((t) => t.domain === draft.domain && t.active);
  const lines = () => { const t = tpl(), u = unit(); if (!t || !u) return []; return t.items.filter((i) => i.applies === 'Both' || (u.kind === 'kitchen' ? i.applies === 'CPK' : i.applies === 'Restaurant')); };
  const labels = () => R.SCHEMES[tpl().scheme].ratings;
  const ready = () => !!(draft.site_id && draft.domain && tpl());
  const secs = () => [...new Set(lines().map((i) => i.section))];
  // Steps: 0 = basic details, 1..n = one checklist section each, n+1 = review & submit.
  const stepNames = () => (ready() ? ['Basic details', ...secs(), 'Review & submit'] : ['Basic details']);
  const clampStep = () => { draft.step = Math.max(0, Math.min(stepNames().length - 1, +draft.step || 0)); };
  const isReview = () => ready() && draft.step === stepNames().length - 1;
  const stepOf = (item) => secs().indexOf(item.section) + 1;

  const itemHtml = (i) => {
    const a = draft.answers[i.id] || {};
    const L = labels();
    const prio = a.result === 'fail' || a.result === 'partial' ? R.priorityFor(i, a.result) : null;
    return html`<div class="item${a.result === 'fail' ? ' is-fail' : a.result === 'partial' ? ' is-partial' : ''}" id="item-${i.id}">
      <div class="item-main stack" style="gap:6px">
        <div class="item-head"><span class="code">${i.code}</span>${star(i.critical)}${i.critical ? html`<span>critical</span>` : ''}${i.criticality && !i.critical ? html`<span>${i.criticality}</span>` : ''}${i.area && i.area !== i.section ? html`<span>${i.area}</span>` : ''}<span>· ${R.fmtNum(i.weight)} ${draft.domain === 'food' ? 'marks' : 'pt'}</span></div>
        <div class="text">${i.text}</div>
        ${i.guidance ? html`<div class="guidance">${icon('lightbulb')}<span>${i.guidance}</span></div>` : ''}
      </div>
      <div class="answers" role="group" aria-label="Rating for ${i.code}">
        ${['pass', 'partial', 'fail', 'na'].map((v) => html`<button type="button" data-click="answer" data-id="${i.id}" data-v="${v}" aria-pressed="${a.result === v}">${L[v]}</button>`)}
      </div>
      ${prio ? html`<div class="fail-box">
        <label class="sr-only" for="note-${i.id}">Remark</label>
        <textarea class="input" id="note-${i.id}" data-input="note" data-id="${i.id}" rows="2" placeholder="Remark (required): what exactly did you see?">${a.note || ''}</textarea>
        <div class="photo-row">
          ${(a.photos || []).map((p, n) => html`<span class="photo-wrap"><img class="thumb" src="${photoSrc(p)}" alt="Photo ${n + 1} for ${i.code}${isLocalPhoto(p) ? ' (on this phone, not uploaded yet)' : ''}">${isLocalPhoto(p) ? html`<span class="ph-local" title="Saved on this phone; uploads when the network is back">${icon('cloud_off')}</span>` : ''}<button type="button" class="rm" data-click="rmPhoto" data-id="${i.id}" data-n="${n}" aria-label="Remove photo">${icon('close')}</button></span>`)}
          ${(a.photos || []).length < 4 ? html`<button type="button" class="btn" data-click="photo" data-id="${i.id}">${icon('photo_camera')}${(a.photos || []).length ? 'Add another' : 'Take or add photo'}</button>` : ''}
          <span class="small muted row" style="gap:6px">${prioBadge(prio)} ${R.PRIORITY[prio].response}</span>
        </div>
      </div>` : ''}
    </div>`;
  };
  const stats = () => {
    const ls = lines();
    const answers = Object.fromEntries(Object.entries(draft.answers).filter(([, v]) => v.result).map(([k, v]) => [k, v.result]));
    return { ls, s: R.scoreAudit(ls, answers) };
  };
  const liveHtml = () => {
    const { ls, s } = stats();
    const answered = ls.filter((i) => draft.answers[i.id]?.result).length;
    return html`<b class="num">${answered}/${ls.length}</b><span class="muted">rated</span>
      ${s.possible ? html`<span class="muted">·</span><span>Live score <b class="num">${pct(s.score)}</b></span>${statusBadge(s.band)}` : ''}
      ${s.criticalFails ? html`<span class="small t-bad"><span class="star">★</span> ${R.plural(s.criticalFails, 'critical line')} ${labels().fail}</span>` : ''}
      ${timeHtml()}`;
  };
  const secCount = (items) => {
    const n = items.filter((i) => draft.answers[i.id]?.result).length;
    const g = items.filter((i) => ['fail', 'partial'].includes(draft.answers[i.id]?.result)).length;
    return html`<span class="small muted num">${n}/${items.length} rated</span>${g ? html`<span class="small t-warn">${R.plural(g, 'gap')}</span>` : n === items.length ? html`<span class="small t-good row" style="gap:4px">${icon('check_circle')}Done</span>` : ''}`;
  };
  const refresh = (i) => {
    $(`#item-${i.id}`).outerHTML = part(itemHtml(i));
    const b = $('#liveLine'); if (b) b.innerHTML = part(liveHtml());
    const el = $('#secCount'); if (el) el.innerHTML = part(secCount(lines().filter((x) => x.section === i.section)));
  };

  const detailsStep = () => {
    const t = ready() ? tpl() : null;
    return html`<section class="card form" aria-label="Audit details">
      <div class="section-head" style="margin:0"><h2>Basic details</h2></div>
      <div class="field"><label for="aUnit">Unit</label><select class="input" id="aUnit" data-change="unit"><option value="">Choose a unit…</option>${units.map((s) => html`<option value="${s.id}" ${s.id === draft.site_id ? 'selected' : ''}>${unitName(s)}</option>`)}</select></div>
      <div class="field"><span class="label" id="typeLbl">Audit</span><div class="choices" role="group" aria-labelledby="typeLbl">
        ${R.AUDIT_DOMAINS.map((dom) => html`<button type="button" class="choice" data-click="domain" data-v="${dom}" aria-pressed="${draft.domain === dom}" style="${draft.domain === dom ? 'border-color:var(--primary);background:var(--primary-soft);box-shadow:inset 0 0 0 1px var(--primary)' : ''}">${icon(draft.domain === dom ? 'radio_button_checked' : 'radio_button_unchecked')}${icon(R.DOMAINS[dom].icon)}<span><b>${R.DOMAINS[dom].label}</b><span class="small">${R.DOMAINS[dom].long}</span></span></button>`)}</div></div>
      <div class="form-2">
        <div class="field"><label for="aDate">Date</label><input class="input" type="date" id="aDate" max="${auditToday()}" value="${draft.audit_date}" data-change="date"></div>
        <div class="field"><label for="aBy">Auditor</label><input class="input" id="aBy" value="${draft.auditor}" data-input="auditor" autocomplete="name"></div>
      </div>
      ${t ? html`<div class="banner info">${icon('checklist')}<span class="b-body">${t.name}: ${R.plural(lines().length, 'line')} in ${R.plural(secs().length, 'section')} apply to this ${unit().kind === 'kitchen' ? 'kitchen' : 'restaurant'}. ${R.SCHEMES[t.scheme].marking}</span></div>`
        : html`<p class="small muted">Choose the unit and the audit to begin. Food safety uses the FSSAI internal checklist; maintenance uses the inspection docket.</p>`}
    </section>`;
  };
  const sectionStep = () => {
    const sec = secs()[draft.step - 1];
    const items = lines().filter((i) => i.section === sec);
    return html`<section class="card flush">
      <div class="section-head" style="padding-bottom:12px;border-bottom:1px solid var(--border);margin:0"><h2>${sec}</h2><span class="row" id="secCount">${secCount(items)}</span>
        <span class="spacer"></span><button class="btn ghost sm" data-click="nextUnrated">${icon('arrow_downward')}Next unrated</button></div>
      ${items.map(itemHtml)}
    </section>`;
  };
  const reviewStep = () => {
    const { ls, s } = stats();
    const missing = ls.filter((i) => !draft.answers[i.id]?.result);
    const noNote = ls.filter((i) => ['fail', 'partial'].includes(draft.answers[i.id]?.result) && !draft.answers[i.id]?.note?.trim());
    const L = labels();
    return html`<div class="stack">
      <section class="card stack">
        <div class="section-head" style="margin:0"><h2>Review</h2></div>
        <div class="row" style="gap:14px">${scoreDisplay(s.score, { size: 'xl', band: s.band })}${s.possible ? statusBadge(s.band, { lg: true }) : ''}<span class="small muted">Live score from ${R.plural(s.answered, 'rated line')} · target ${R.TARGET}%</span></div>
        ${progressBar(s.score, { band: s.band, target: true })}
        ${missing.length ? html`<div class="banner warn">${icon('pending_actions')}<span class="b-body">${R.plural(missing.length, 'line')} still to rate.</span><button class="btn sm" data-click="goStep" data-v="${stepOf(missing[0])}">Go to first</button></div>` : ''}
        ${noNote.length ? html`<div class="banner warn">${icon('edit_note')}<span class="b-body">Add a remark to ${R.plural(noNote.length, 'line')} rated ${L.partial} or ${L.fail}.</span><button class="btn sm" data-click="goStep" data-v="${stepOf(noNote[0])}">Go to first</button></div>` : ''}
        ${!missing.length && !noNote.length ? html`<div class="banner good">${icon('check_circle')}<span class="b-body">Every line is rated. Ready to submit.</span></div>` : ''}
      </section>
      <section class="card flush">
        <div class="section-head"><h2>By section</h2></div>
        ${dataTable([{ label: 'Section', w: 'minmax(0,2fr)' }, { label: 'Rated', w: '90px' }, { label: 'Gaps', w: '80px' }, { label: 'Score', w: '90px' }, { label: '', w: '70px' }],
          secs().map((sec, n) => {
            const items = ls.filter((i) => i.section === sec);
            const sc = s.sections.find((x) => x.section === sec);
            const rated = items.filter((i) => draft.answers[i.id]?.result).length;
            const gaps = items.filter((i) => ['fail', 'partial'].includes(draft.answers[i.id]?.result)).length;
            return html`<div class="dt-row clickable" role="row" data-click="goStep" data-v="${n + 1}">
              <div class="dt-cell main" role="cell"><div class="dt-primary">${sec}</div></div>
              <div class="dt-cell kv" role="cell"><span class="lbl">Rated:</span><span class="${rated < items.length ? 't-warn' : ''}">${rated}/${items.length}</span></div>
              <div class="dt-cell kv" role="cell"><span class="lbl">Gaps:</span>${gaps}</div>
              <div class="dt-cell aside" role="cell">${scoreDisplay(sc?.score ?? null)}</div>
              <div class="dt-cell action r" role="cell"><span class="btn sm">Edit</span></div></div>`;
          }))}
      </section>
      <section class="card form" id="submit">
        <div class="field"><label for="aSum">Conclusion <span class="muted">(optional)</span></label><textarea class="input" id="aSum" data-input="summary" placeholder="Overall standing, what to close first, who was present">${draft.summary || ''}</textarea></div>
        <div id="submitErr" class="error-text" hidden></div>
        <p class="small muted">${icon('schedule', 'muted')} ${draft.started_at ? `Started at ${R.fmtClock(draft.started_at)}. The finish time is recorded when you submit.` : 'The finish time is recorded when you submit.'}</p>
        <p class="small muted">${icon('save', 'muted')} Ratings, remarks and photos are saved on this phone as you go, so you can close the page and come back.</p>
        <p class="small muted">${icon('cloud_off', 'muted')} No network? Submit anyway: the audit waits on this phone and is sent by itself when the network is back.</p>
        <div><button class="btn danger sm" type="button" data-click="discard">${icon('delete')}Discard draft</button></div>
      </section>
    </div>`;
  };
  const render = () => {
    clampStep();
    const names = stepNames();
    const total = names.length;
    const step = draft.step;
    const review = isReview();
    mount({
      title: 'New audit',
      body: html`
        ${pageHeader({ compact: step > 0, title: ready() ? `${R.DOMAINS[draft.domain].label} audit` : 'Start an audit', crumb: { href: '#/audits', label: 'Audits' }, sub: ready() ? html`<span>${unitName(unit())}</span><span>·</span><span>${fmt(draft.audit_date, true)}</span>` : 'Walk the unit with your phone' })}
        ${conflict ? html`<div class="banner info" style="margin-bottom:16px">${icon('history')}<span class="b-body">Unfinished ${R.DOMAINS[conflict.domain].label.toLowerCase()} audit for <b>${unitName(units.find((x) => x.id === conflict.site_id))}</b> (${R.plural(Object.keys(conflict.answers).length, 'rating')}).</span><button class="btn sm" data-click="resume">Continue it</button></div>` : ''}
        ${ready() ? html`<div class="stepper-head">
          <div class="sh-line"><span class="sh-step">Step ${step + 1} of ${total}</span><span class="sh-name">${names[step]}</span><span class="spacer"></span>
            <label class="sr-only" for="jump">Jump to step</label><select class="select" id="jump" data-change="jump" style="height:36px;font-size:13px;max-width:200px">${names.map((n, k) => html`<option value="${k}" ${k === step ? 'selected' : ''}>${k + 1}. ${n}</option>`)}</select></div>
          <div class="step-dots" aria-hidden="true">${names.map((_, k) => html`<span class="${k < step ? 'done' : k === step ? 'current' : ''}"></span>`)}</div>
          <div class="sh-line" id="liveLine">${liveHtml()}</div>
        </div>` : ''}
        ${step === 0 ? detailsStep() : review ? reviewStep() : sectionStep()}
        ${bottomBar(html`
          <button class="btn" data-click="prev" ${step === 0 ? 'disabled' : ''}>${icon('arrow_back')}Previous</button>
          <button class="btn" data-click="save">${icon('save')}Save draft</button>
          ${review ? html`<button class="btn primary" data-click="submit">${icon('send')}Submit audit</button>`
            : html`<button class="btn primary" data-click="next" ${ready() ? '' : 'disabled'}>Next${icon('arrow_forward')}</button>`}`,
        ready() ? `Step ${step + 1} of ${total} · ${names[step]}` : '')}`,
    });
  };
  const go = (n) => { draft.step = n; persist(); render(); };
  const flag = (bad) => {
    bad.forEach((i) => $(`#item-${i.id}`)?.classList.add('flagged'));
    const first = $(`#item-${bad[0]?.id}`);
    first?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  on.click = {
    resume: () => { draft = conflict; conflict = null; persist(); render(); },
    domain: async (el) => {
      if (el.dataset.v === draft.domain) return;
      if (Object.keys(draft.answers).length) {
        const ok = await confirmDialog({ title: 'Switch audit?', text: `This clears the ${R.plural(Object.keys(draft.answers).length, 'rating')} given so far.`, ok: 'Switch and clear', danger: true });
        if (!ok) return;
      }
      draft.domain = el.dataset.v; draft.answers = {}; delete draft.started_at; persist(); render();
    },
    answer: (el) => {
      const i = lines().find((x) => x.id === +el.dataset.id);
      draft.answers[i.id] = { ...(draft.answers[i.id] || {}), result: el.dataset.v };
      markStart(); persist(); refresh(i);
      if (el.dataset.v === 'fail' || el.dataset.v === 'partial') $(`#note-${i.id}`)?.focus();
    },
    photo: async (el) => {
      const i = lines().find((x) => x.id === +el.dataset.id);
      const key = await pickAuditPhoto();
      if (!key) return;
      const a = draft.answers[i.id];
      a.photos = [...(a.photos || []), key].slice(0, 4);
      persist(); refresh(i);
    },
    rmPhoto: (el) => {
      const i = lines().find((x) => x.id === +el.dataset.id);
      dropLocalPhotos([{ photos: draft.answers[i.id].photos.splice(+el.dataset.n, 1) }]);
      persist(); refresh(i);
    },
    nextUnrated: () => {
      const sec = secs()[draft.step - 1];
      const here = lines().find((x) => x.section === sec && !draft.answers[x.id]?.result);
      if (here) { const el = $(`#item-${here.id}`); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flagged'); return; }
      const any = lines().find((x) => !draft.answers[x.id]?.result);
      if (any) { go(stepOf(any)); flag([any]); } else go(stepNames().length - 1);
    },
    prev: () => go(draft.step - 1),
    next: () => {
      if (draft.step === 0 && !draft.auditor.trim()) { $('#aBy').classList.add('invalid'); $('#aBy').focus(); toast('Add the auditor’s name to continue.', { error: true }); return; }
      markStart();
      go(draft.step + 1);
    },
    goStep: (el) => go(+el.dataset.v),
    save: () => { persist(); toast('Draft saved on this device', { success: true }); },
    discard: async () => {
      const ok = await confirmDialog({ title: 'Discard this draft?', text: 'All ratings, remarks and photos for this audit are removed from this device.', ok: 'Discard', danger: true });
      if (!ok) return;
      dropLocalPhotos(Object.values(draft.answers)); clearDraft(); draft = fresh(); conflict = null; render();
    },
    submit: async (btn) => {
      const ls = lines();
      const missing = ls.filter((i) => !draft.answers[i.id]?.result);
      const noNote = ls.filter((i) => ['fail', 'partial'].includes(draft.answers[i.id]?.result) && !draft.answers[i.id]?.note?.trim());
      const bad = missing.length ? missing : noNote;
      if (!draft.auditor.trim()) { go(0); $('#aBy').classList.add('invalid'); $('#aBy').focus(); toast('Add the auditor’s name.', { error: true }); return; }
      if (bad.length) {
        toast(missing.length ? `${R.plural(missing.length, 'line')} still to rate.` : `Add a remark to ${R.plural(noNote.length, 'line')} rated ${labels().partial} or ${labels().fail}.`, { error: true });
        go(stepOf(bad[0]));
        flag(bad.filter((i) => i.section === bad[0].section));
        return;
      }
      btn.disabled = true;
      const body = {
        site_id: draft.site_id, domain: draft.domain, audit_date: draft.audit_date, auditor: draft.auditor, audit_type: draft.audit_type, summary: draft.summary, started_at: draft.started_at || null,
        finished_at: new Date().toISOString(), client_id: draft.client_id,
        answers: ls.map((i) => ({ item_id: i.id, result: draft.answers[i.id].result, note: draft.answers[i.id].note || null, photos: [...(draft.answers[i.id].photos || [])] })),
      };
      try {
        // photos taken with no network go up first; the draft keeps each server key as it arrives
        await uploadLocalPhotos(body.answers, () => { body.answers.forEach((a) => { draft.answers[a.item_id].photos = [...a.photos]; }); persist(); });
        const r = await api('/api/audits', { method: 'POST', body });
        clearDraft();
        searchData = null;
        toast(`Audit submitted: ${pct(r.score)}, ${R.bandLabel(r.band)} · ${R.plural(r.created, 'fix', 'fixes')} raised${r.autoClosed ? `, ${r.autoClosed} closed by this visit` : ''}`, { success: true, ms: 7000 });
        location.hash = `#/audits/${r.id}`;
      } catch (e2) {
        if (e2 instanceof SignInNeeded) return;
        if (e2.offline) {
          // no network: keep it on the phone and send it by itself later
          outboxPut({ client_id: draft.client_id, owner: outboxOwner(), queued_at: new Date().toISOString(), unit: unitName(unit()), body });
          clearDraft();
          toast('No network. The audit is saved on this phone and is sent by itself when the network is back.', { ms: 9000 });
          location.hash = '#/audits';
          return;
        }
        const err = $('#submitErr');
        toast(friendly(e2), { error: true }); if (err) { err.hidden = false; err.textContent = friendly(e2); }
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
    jump: (el) => go(+el.value),
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
  ['in_progress', 'In progress', (f) => f.status === 'in_progress'],
  ['overdue', 'Overdue', (f, today) => R.UNRESOLVED.includes(f.status) && f.due_date < today],
  ['fixed', 'Awaiting verification', (f) => f.status === 'fixed'],
  ['closed', 'Closed', (f) => f.status === 'closed'],
  ['all', 'All', () => true],
];
const DUE_FILTERS = [
  ['', 'Any due date', () => true],
  ['overdue', 'Past due date', (f, t) => f.due_date < t],
  ['today', 'Due today', (f, t) => f.due_date === t],
  ['week', 'Due in 7 days', (f, t) => f.due_date >= t && f.due_date <= R.addDays(t, 7)],
  ['month', 'Due in 30 days', (f, t) => f.due_date >= t && f.due_date <= R.addDays(t, 30)],
];
async function pageFixes({ token, query }) {
  const [d, sites] = await Promise.all([api('/api/findings'), api('/api/sites')]);
  if (stale(token)) return;
  app.today = d.today;
  const today = d.today;
  const state = {
    view: query.get('view') === 'problem' ? 'problem' : 'priority',
    status: STATUS_FILTERS.some(([k]) => k === query.get('status')) ? query.get('status') : 'open',
    priority: query.get('priority') || '', unit: query.get('unit') || '', domain: query.get('domain') || '', kind: query.get('kind') || '',
    due: DUE_FILTERS.some(([k]) => k === query.get('due')) ? query.get('due') : '', q: query.get('q') || '',
  };
  const LIMIT = 40;
  const expanded = new Set();
  // base = the filters that do not change the summary numbers (unit, audit, kind, search)
  const base = () => {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return d.findings.filter((f) => (!state.unit || String(f.site_id) === state.unit) && (!state.domain || f.domain === state.domain) && (!state.kind || f.kind === state.kind)
      && words.every((w) => `${f.title} #${f.id} ${f.site_name} ${f.site_city} ${f.item_code || ''} ${f.item_area || ''} ${f.owner || ''}`.toLowerCase().includes(w)));
  };
  const rows = () => {
    const pred = STATUS_FILTERS.find(([k]) => k === state.status)[2];
    const duePred = DUE_FILTERS.find(([k]) => k === state.due)[2];
    return base().filter((f) => pred(f, today) && (!state.priority || f.priority === state.priority) && duePred(f, today));
  };
  const sortFix = (a, b) => R.PRIORITY_ORDER.indexOf(a.priority) - R.PRIORITY_ORDER.indexOf(b.priority) || (a.kind === 'paperwork' ? 0 : 1) - (b.kind === 'paperwork' ? 0 : 1) || b.marks - a.marks || a.due_date.localeCompare(b.due_date);
  const cols = [{ label: 'Fix', w: 'minmax(0,2.6fr)' }, { label: 'Unit', w: 'minmax(0,1.3fr)' }, { label: 'Priority', w: '84px' }, { label: 'Due date', w: 'minmax(0,1.1fr)' },
    { label: 'Status', w: 'minmax(0,1.3fr)' }, { label: 'Assigned to', w: 'minmax(0,1fr)' }, { label: '', w: '64px' }];
  const fixRow = (f) => {
    const due = dueInfo(f);
    return dtRow(`#/fixes/${f.id}`, [
      { cls: 'main', v: html`<div class="dt-primary clamp-2">${f.title}</div><div class="dt-secondary"><span>${R.DOMAINS[f.domain].label}${f.item_area ? ` · ${f.item_area}` : ''}</span>${kindTag(f.kind)}${repeatTag(f)}<span>+${R.fmtNum(f.marks)} ${f.domain === 'food' ? 'marks' : 'pts'}</span></div>` },
      { lbl: 'Unit', v: unitName(f) },
      { lbl: 'Priority', v: prioBadge(f.priority) },
      { lbl: 'Due', v: html`<span class="${due.tone ? `t-${due.tone} strong` : ''}">${f.status === 'closed' || f.status === 'fixed' ? due.text : fmt(f.due_date, true)}</span>${due.tone && f.status !== 'closed' ? html`<div class="xsmall t-${due.tone}">${due.text}</div>` : ''}` },
      { cls: 'aside', v: html`${fixStatusBadge(f, today)}${isOverdue(f, today) && f.status === 'in_progress' ? html`<div class="xsmall muted" style="margin-top:3px">In progress</div>` : ''}` },
      { lbl: 'Assigned', v: f.owner || html`<span class="muted">Unassigned</span>` },
      viewCell(),
    ]);
  };
  const listHtml = () => {
    const rs = rows();
    if (!rs.length) {
      return state.status === 'open' && !state.q && !state.unit && !state.priority && !state.kind && !state.domain && !state.due
        ? emptyState({ iconName: 'task_alt', tone: 'good', title: 'No open fixes', text: 'Every gap has been fixed or closed.' })
        : emptyState({ iconName: 'search_off', title: 'No fixes found', text: 'Nothing matches these filters.', action: html`<button class="btn" data-click="clear">Clear filters</button>` });
    }
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
      return gs.map((g) => html`<details class="group"><summary>${prioBadge(g.priority)}<span class="sum-title"><span class="strong clamp-2">${g.title}</span>
        <span class="small muted">${R.plural(g.list.length, 'fix', 'fixes')} · ${R.plural(new Set(g.list.map((f) => f.site_id)).size, 'unit')} · ${R.DOMAINS[g.domain].label}${g.area ? ` · ${g.area}` : ''} · ${R.fmtNum(g.marks)} ${g.domain === 'food' ? 'marks' : 'pts'}</span></span>${icon('expand_more', 'chev')}</summary>
        <div class="list">${g.list.sort(sortFix).map((f) => findingCard(f, { showUnit: true }))}</div></details>`);
    }
    return dataTable(cols, R.PRIORITY_ORDER.map((p) => {
      const l = rs.filter((f) => f.priority === p).sort(sortFix);
      if (!l.length) return '';
      const shown = expanded.has(p) ? l : l.slice(0, LIMIT);
      const paper = l.filter((f) => f.kind === 'paperwork').length;
      return html`<div class="dt-group">${prioBadge(p)}<h3>${R.PRIORITY[p].label}</h3><span class="muted small">${l.length}${paper ? ` · ${paper} paperwork` : ''}</span><span class="sub">${R.PRIORITY[p].meaning} ${R.PRIORITY[p].response}</span></div>
        ${shown.map(fixRow)}${l.length > shown.length ? html`<button class="dt-more" data-click="more" data-p="${p}">Show all ${l.length}</button>` : ''}`;
    }));
  };
  const stripHtml = () => {
    const b = base(), un = b.filter((f) => R.UNRESOLVED.includes(f.status));
    const is = (status, priority) => state.status === status && state.priority === priority && !state.due;
    return html`
      ${statCard({ label: 'Open', value: html`${un.length}`, click: 'strip', v: 'open:', pressed: is('open', '') })}
      ${statCard({ label: 'Overdue', value: html`${un.filter((f) => f.due_date < today).length}`, tone: un.some((f) => f.due_date < today) ? 'bad' : '', click: 'strip', v: 'overdue:', pressed: is('overdue', '') })}
      ${R.PRIORITY_ORDER.map((p) => statCard({ label: R.PRIORITY[p].label, value: html`${un.filter((f) => f.priority === p).length}`, click: 'strip', v: `open:${p}`, pressed: is('open', p) }))}`;
  };
  const extraFilters = () => [state.due, state.kind, state.domain].filter(Boolean).length;
  let showMore = extraFilters() > 0;
  const moreLabel = () => html`${icon('tune')}${showMore ? 'Fewer filters' : 'More filters'}${extraFilters() ? html` <span class="count">${extraFilters()}</span>` : ''}`;
  const filtersHtml = () => html`
    ${searchBar({ value: state.q, placeholder: 'Search fixes, owners, codes' })}
    ${selectFilter({ name: 'unit', value: state.unit, label: 'Unit', options: [['', 'All units'], ...sites.units.map((s) => [s.id, unitName(s)])] })}
    ${selectFilter({ name: 'priority', value: state.priority, label: 'Priority', options: [['', 'Any priority'], ...R.PRIORITY_ORDER.map((p) => [p, R.PRIORITY[p].label])] })}
    ${selectFilter({ name: 'status', value: state.status, label: 'Status', options: STATUS_FILTERS.map(([k, l]) => [k, l]) })}
    <button type="button" class="btn more-btn" id="moreBtn" data-click="moreFilters" aria-expanded="${showMore}" aria-controls="moreFilters">${moreLabel()}</button>
    <div class="more-filters" id="moreFilters" ${showMore ? '' : 'hidden'}>
      ${selectFilter({ name: 'due', value: state.due, label: 'Due date', options: DUE_FILTERS.map(([k, l]) => [k, l]) })}
      ${selectFilter({ name: 'kind', value: state.kind, label: 'Kind', options: [['', 'Paperwork & on-site'], ['paperwork', 'Paperwork only'], ['physical', 'On-site only']] })}
      ${selectFilter({ name: 'domain', value: state.domain, label: 'Audit', options: [['', 'Food & maintenance'], ...R.AUDIT_DOMAINS.map((x) => [x, R.DOMAINS[x].label])] })}
    </div>`;
  const summaryHtml = () => {
    const rs = rows();
    return html`<b>${R.plural(rs.length, 'fix', 'fixes')}</b> · ${R.PRIORITY_ORDER.map((p) => `${rs.filter((f) => f.priority === p).length} ${R.PRIORITY[p].short}`).join(' · ')} · ${rs.filter((f) => f.kind === 'paperwork').length} paperwork · ${R.fmtNum(R.round1(rs.reduce((s, f) => s + (f.domain === 'food' ? f.marks : 0), 0)))} food safety marks to win back`;
  };
  const sync = ({ filters = true } = {}) => {
    const q = new URLSearchParams(Object.entries(state).filter(([k, v]) => v && !(k === 'status' && v === 'open') && !(k === 'view' && v === 'priority')));
    history.replaceState(null, '', `#/${q.toString() ? `?${q}` : ''}`);
    $('#fixStrip').innerHTML = part(stripHtml());
    if (filters) $$('select[data-change]', $('#fixFilters')).forEach((s) => { s.value = state[s.dataset.change]; });
    $('#viewSeg').innerHTML = part(segmented({ name: 'view', value: state.view, label: 'View', options: [['priority', 'By priority'], ['problem', 'By problem']] }));
    $('#fixSummary').innerHTML = part(summaryHtml());
    $('#fixList').innerHTML = part(listHtml());
    $('#moreBtn').innerHTML = part(moreLabel());
  };
  mount({
    title: 'Dashboard',
    body: html`
      ${pageHeader({ title: 'Dashboard',
        sub: isManager() && app.me.unit ? html`<span>${unitName(app.me.unit)}</span><span>·</span><span>What to fix, in what order. Open a fix to add what was done and proof, then mark it fixed.</span>` : 'What to fix, in what order. Open a fix to update it, add proof, or review it.',
        actions: isManager() ? '' : html`<a class="btn primary" href="#/audits/new">${icon('add')}Start audit</a>` })}
      <div class="stack">
        <section class="strip swipe" id="fixStrip" aria-label="Summary">${stripHtml()}</section>
        <div class="filterbar" id="fixFilters">${filtersHtml()}</div>
        <div class="row"><span id="viewSeg">${segmented({ name: 'view', value: state.view, label: 'View', options: [['priority', 'By priority'], ['problem', 'By problem']] })}</span><span class="spacer"></span><span class="small muted" id="fixSummary">${summaryHtml()}</span></div>
        <section class="card flush" id="fixList">${listHtml()}</section>
        <p class="small muted">Inside each priority: paperwork first (quick to close), then the biggest mark gains. Priority 1: act within 48 hours · Priority 2: 7 days · Priority 3: 30 days. Deadlines for the Aug–Sep reports start from 26 Sep 2026, the day they were loaded.</p>
      </div>`,
  });
  on.click = {
    strip: (el) => { const [st, p] = el.dataset.v.split(':'); state.status = st; state.priority = p || ''; state.due = ''; sync(); },
    view: (el) => { state.view = el.dataset.v; sync({ filters: false }); },
    more: (el) => { expanded.add(el.dataset.p); $('#fixList').innerHTML = part(listHtml()); },
    clear: () => { location.hash = '#/'; },
    moreFilters: (el) => {
      showMore = !showMore;
      $('#moreFilters').hidden = !showMore;
      el.setAttribute('aria-expanded', String(showMore));
      el.innerHTML = part(moreLabel());
    },
  };
  on.change = Object.fromEntries(['priority', 'kind', 'domain', 'unit', 'status', 'due'].map((k) => [k, (el) => { state[k] = el.value; sync({ filters: false }); }]));
  on.input = { q: (el) => { state.q = el.value; sync({ filters: false }); } };
}

async function pageFix({ token, params: [id] }) {
  const d = await api(`/api/findings/${id}`);
  if (stale(token)) return;
  app.today = d.today;
  const f = d.finding;
  const closed = f.status === 'closed';
  let evidence = f.evidence_key;
  const unitWord = unitWordFor(f.domain);
  const due = dueInfo(f);
  // The latest "send back" (rejection) and its reason, from the history the server already keeps.
  const sentBack = f.status === 'open' ? d.history.find((h) => /→ Open/.test(h.detail || '') && /note: /.test(h.detail || '')) : null;
  const sentBackReason = sentBack?.detail.split('note: ').slice(1).join('note: ');
  const evidenceHtml = () => (evidence
    ? html`<a href="${fileUrl(evidence)}" target="_blank" rel="noopener">${/\.pdf$/i.test(evidence) ? html`<span class="btn">${icon('picture_as_pdf')}Open document</span>` : html`<img class="thumb-lg" src="${fileUrl(evidence)}" alt="Proof of the fix">`}</a>${closed ? '' : html`<div><button class="btn danger sm" type="button" data-click="rmEvidence">${icon('delete')}Remove photo</button></div>`}`
    : closed ? html`<p class="muted small">No proof photo was added.</p>` : html`<button class="btn" type="button" data-click="evidence">${icon('photo_camera')}Add proof photo</button><p class="small muted">A photo of the fix makes verification quick.</p>`);
  const head = !isManager();
  const actions = {
    open: html`<button class="btn" data-click="to" data-v="in_progress">Start work</button><button class="btn primary" data-click="to" data-v="fixed">${icon('done')}Mark fixed</button>`,
    in_progress: html`<button class="btn primary" data-click="to" data-v="fixed">${icon('done')}Mark fixed</button>`,
    fixed: head ? html`<button class="btn danger" data-click="reject">${icon('close')}Reject</button><button class="btn success" data-click="approve">${icon('verified')}Approve</button>` : '',
    closed: head ? html`<button class="btn" data-click="reopen">${icon('restart_alt')}Reopen</button>` : '',
  }[f.status];
  mount({
    title: `Fix #${f.id}`,
    body: html`
      ${pageHeader({ title: f.title, long: f.title.length > 70, crumb: { href: '#/', label: 'Dashboard' },
        sub: html`${prioBadge(f.priority)}<span>${R.PRIORITY[f.priority].label}</span>${fixStatusBadge(f)}${repeatTag(f)}${kindTag(f.kind)}${f.scheme ? ratingChip(f.scheme, f.rating) : ''}${star(f.item_critical)}<span class="muted">Fix #${f.id}</span>` })}
      <div class="stack-lg">
        ${sentBack ? html`<div class="banner bad">${icon('undo')}<span class="b-body"><b>Rejected by ${sentBack.actor}, ${ago(sentBack.at)}:</b> “${sentBackReason}”</span></div>` : ''}
        ${f.status === 'fixed' && !head ? html`<div class="banner info">${icon('hourglass_top')}<span class="b-body"><b>Marked fixed.</b> Waiting for the Compliance Head to check it and close it.</span></div>` : ''}
        ${f.status === 'fixed' && head ? html`<section class="card stack" style="border-color:var(--primary)">
          <div class="section-head" style="margin:0"><h2>Review</h2><span class="sub">The unit marked this fixed. Check what was done and the proof, then approve or reject it.</span></div>
          <div class="row"><button class="btn danger" data-click="reject">${icon('close')}Reject</button><button class="btn success" data-click="approve">${icon('verified')}Approve &amp; close</button></div>
        </section>` : ''}

        <section class="card">
          <div class="facts">
            <div class="fact"><div class="k">Unit</div><div class="v"><a href="#/units/${f.site_id}">${unitName(f)}</a></div></div>
            <div class="fact"><div class="k">Priority</div><div class="v">${R.PRIORITY[f.priority].label}<br><span class="small muted">${R.PRIORITY[f.priority].response}</span></div></div>
            <div class="fact"><div class="k">Due date</div><div class="v ${due.tone ? `t-${due.tone}` : ''}">${fmt(f.due_date, true)}<br><span class="small">${due.text}</span></div></div>
            <div class="fact"><div class="k">Assigned to</div><div class="v">${f.owner || html`<span class="muted">Unassigned</span>`}</div></div>
            <div class="fact"><div class="k">Current status</div><div class="v">${R.FINDING_STATUS[f.status].label}</div></div>
            <div class="fact"><div class="k">Found</div><div class="v">${f.audit_id ? html`<a href="#/audits/${f.audit_id}">${fmt(f.audit_date, true)} audit</a>` : fmt(tsDate(f.created_at), true)}${f.item_code ? html` <span class="muted small">(${f.item_code}${f.item_area ? `, ${f.item_area}` : ''})</span>` : ''}</div></div>
            <div class="fact"><div class="k">Wins back</div><div class="v">${R.fmtNum(f.marks)} ${unitWord}${f.possible ? html` <span class="small muted">(+${R.fmtNum(R.round1((f.marks / f.possible) * 100))} pts)</span>` : ''}</div></div>
            <div class="fact"><div class="k">Audit</div><div class="v">${R.DOMAINS[f.domain].label}</div></div>
          </div>
        </section>

        <section class="card stack">
          <div class="section-head" style="margin:0"><h2>Description</h2><span class="sub">What the auditor saw</span></div>
          ${f.detail ? html`<p style="white-space:pre-wrap">${f.detail}</p>` : html`<p class="muted">No remark.</p>`}
          ${f.guidance ? html`<div class="banner">${icon('lightbulb')}<span class="b-body"><b>How to verify:</b> ${f.guidance}</span></div>` : ''}
        </section>

        <section class="card stack">
          <div class="section-head" style="margin:0"><h2>Evidence</h2></div>
          <div class="grid-2">
            <div class="stack" style="gap:8px"><span class="small strong">Photos from the audit</span>
              ${f.photos.length ? html`<div class="thumbs">${f.photos.map((p) => html`<a href="${fileUrl(p)}" target="_blank" rel="noopener"><img class="thumb-lg" style="max-width:220px" src="${fileUrl(p)}" alt="Photo from the audit" loading="lazy"></a>`)}</div>` : html`<p class="small muted">No photo was taken at the audit.</p>`}</div>
            <div class="stack" style="gap:8px"><span class="small strong">Proof of the fix</span><div id="evidence" class="stack" style="gap:8px">${evidenceHtml()}</div></div>
          </div>
        </section>

        <section class="card form" aria-label="Corrective action">
          <div class="section-head" style="margin:0"><h2>Corrective action</h2><span class="sub">${closed ? 'Closed fixes cannot be edited. Reopen it if the problem has come back.' : 'Who fixes it, by when, and what was done.'}</span></div>
          <div class="form-2">
            <div class="field"><label for="fOwner">Assigned to</label><input class="input" id="fOwner" value="${f.owner || ''}" ${closed ? 'disabled' : ''} placeholder="Who will fix it"></div>
            <div class="field"><label for="fDue">Due date</label><input class="input" type="date" id="fDue" value="${f.due_date}" ${closed || !head ? 'disabled' : ''}><span class="hint">${head ? 'Moving a date is recorded in the history.' : 'Only the Compliance Head can move a due date.'}</span></div>
          </div>
          <div class="field"><label for="fRoot">Root cause</label><textarea class="input" id="fRoot" ${closed ? 'disabled' : ''} placeholder="Why did it happen? e.g. nobody owns the pest-control file">${f.root_cause || ''}</textarea></div>
          <div class="field"><label for="fAct">What was done</label><textarea class="input" id="fAct" ${closed ? 'disabled' : ''} placeholder="The fix, and what stops it coming back">${f.action_taken || ''}</textarea></div>
          ${closed ? html`<div class="banner good">${icon('task_alt')}<span class="b-body">Closed ${fmt(tsDate(f.closed_at), true)} by ${f.closed_by}${f.close_note ? html`: “${f.close_note}”` : ''}</span></div>` : html`<div><button class="btn" data-click="save">${icon('save')}Save changes</button></div>`}
          <div id="formErr" class="error-text" hidden></div>
        </section>

        ${collapse({ iconName: 'history', title: 'History', sub: `${R.plural(d.history.length + 1, 'event')}`, body: html`<ul class="timeline">${d.history.map((h) => html`<li><span><b>${h.actor}</b> ${h.detail}<br><span class="small muted">${ago(h.at)}</span></span></li>`)}
          <li><span>Found at the ${f.audit_date ? `${fmt(f.audit_date, true)} audit` : 'audit'}${f.is_repeat ? ' (also failed at the previous visit)' : ''}</span></li></ul>` })}
        ${actions ? bottomBar(actions, html`<span>${R.FINDING_STATUS[f.status].label}</span>`) : ''}
      </div>`,
  });
  const collect = () => ({ owner: $('#fOwner').value, due_date: $('#fDue').value, root_cause: $('#fRoot').value, action_taken: $('#fAct').value, evidence_key: evidence || null });
  const patch = async (extra, msg) => {
    const err = $('#formErr');
    err.hidden = true;
    try { await api(`/api/findings/${f.id}`, { method: 'PATCH', body: { ...collect(), ...extra } }); searchData = null; toast(msg, { success: true }); rerender(); }
    catch (e) { if (e instanceof SignInNeeded) return; err.hidden = false; err.textContent = friendly(e); toast(friendly(e), { error: true }); }
  };
  on.click = {
    save: () => patch({}, 'Changes saved'),
    to: (el) => {
      if (el.dataset.v === 'fixed' && !$('#fAct').value.trim()) {
        $('#fAct').classList.add('invalid'); $('#fAct').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#fAct').focus();
        const err = $('#formErr'); err.hidden = false; err.textContent = 'Describe what was done before marking it fixed. A proof photo makes verification quick.';
        return;
      }
      patch({ status: el.dataset.v }, el.dataset.v === 'fixed' ? 'Marked fixed. The Compliance Head will review it.' : 'Work started');
    },
    approve: async () => {
      const r = await confirmDialog({ title: 'Approve this fix?', text: 'Approve and close it only after checking the fix yourself, on site or from the proof photo.', ok: 'Approve & close', tone: 'success', withNote: { label: 'Closing note' } });
      if (r) patch({ status: 'closed', close_note: r.note || null }, 'Fix approved and closed');
    },
    reject: async () => {
      const r = await confirmDialog({ title: 'Reject this fix', text: 'It goes back to the unit as Open. The reason is recorded in the fix history and shown to the unit.', ok: 'Reject fix', danger: true,
        withNote: { label: 'Rejection reason', required: true, large: true, placeholder: 'What is still missing or not good enough?', requiredText: 'Enter a rejection reason.' } });
      if (r) patch({ status: 'open', note: r.note }, 'Fix rejected and sent back to the unit');
    },
    reopen: async () => {
      const r = await confirmDialog({ title: 'Reopen this fix?', text: 'Use this if the problem has come back.', ok: 'Reopen', withNote: { label: 'Why?', required: true, requiredText: 'Say why it is being reopened.' } });
      if (r) patch({ status: 'open', note: r.note }, 'Fix reopened');
    },
    evidence: async () => { const key = await pickAndUpload().catch(() => null); if (key) { evidence = key; $('#evidence').innerHTML = part(evidenceHtml()); toast('Proof attached. Save, or mark it fixed, to keep it.', { success: true }); } },
    rmEvidence: () => { evidence = null; $('#evidence').innerHTML = part(evidenceHtml()); },
  };
  $('#fAct')?.addEventListener('input', (e) => e.target.classList.remove('invalid'));
}

// =================================================================== page: licences
function openLicenceDialog(l, units, presetUnit = null, presetType = null) {
  const type = l?.type ?? presetType;
  const known = R.LICENCE_TYPES.some((t) => t.type === type);
  let fileKey = l?.file_key || null;
  const fileHtml = () => (fileKey
    ? html`<div class="row"><a class="btn sm" href="${fileUrl(fileKey)}" target="_blank" rel="noopener">${icon('attach_file')}View scan</a><button class="btn danger sm" type="button" data-click="rmFile">Remove</button></div>`
    : html`<button class="btn" type="button" data-click="file">${icon('upload')}Upload scan or photo</button>`);
  openDialog({
    title: l ? 'Edit licence' : 'Add licence',
    body: html`<div class="form">
      <div class="field"><label for="lSite">Unit</label><select class="input" id="lSite" name="site_id" required>${units.map((s) => html`<option value="${s.id}" ${(l?.site_id ?? presetUnit) === s.id ? 'selected' : ''}>${unitName(s)}</option>`)}</select></div>
      <div class="field"><label for="lType">Licence or certificate</label><select class="input" id="lType" name="typeSel" data-change="type">
        ${R.LICENCE_TYPES.map((t) => html`<option value="${t.type}" ${type === t.type ? 'selected' : ''}>${t.type}</option>`)}<option value="__other" ${type && !known ? 'selected' : ''}>Other…</option></select></div>
      <div class="field" id="otherWrap" ${type && !known ? '' : 'hidden'}><label for="lOther">Name</label><input class="input" id="lOther" name="typeOther" value="${type && !known ? type : ''}"></div>
      <div class="form-2">
        <div class="field"><label for="lNum">Number</label><input class="input" id="lNum" name="number" value="${l?.number || ''}"></div>
        <div class="field"><label for="lAuth">Issued by</label><input class="input" id="lAuth" name="authority" value="${l?.authority || ''}"></div>
      </div>
      <div class="form-2">
        <div class="field"><label for="lIss">Issued on</label><input class="input" type="date" id="lIss" name="issued_on" value="${l?.issued_on || ''}"></div>
        <div class="field"><label for="lExp">Expires on</label><input class="input" type="date" id="lExp" name="expires_on" value="${l?.expires_on || ''}"><span class="hint">Leave empty if it never expires.</span></div>
      </div>
      <div class="field"><label for="lSev">If it lapses</label><select class="input" id="lSev" name="severity">${[['critical', 'Critical: the unit is Non-Compliance'], ['major', 'Major: the unit is Non-Compliance'], ['minor', 'Minor: Needs Improvement']].map(([v, t]) => html`<option value="${v}" ${(l?.severity || R.LICENCE_TYPES.find((x) => x.type === type)?.severity || R.LICENCE_TYPES[0].severity) === v ? 'selected' : ''}>${t}</option>`)}</select></div>
      <div class="field"><span class="label">Document</span><div id="lFile">${fileHtml()}</div></div>
      <div class="field"><label for="lNotes">Notes</label><textarea class="input" id="lNotes" name="notes" rows="2">${l?.notes || ''}</textarea></div>
    </div>`,
    actions: html`${l && !isManager() ? html`<button class="btn danger" type="button" data-click="del">Delete</button><span class="spacer"></span>` : ''}<button class="btn" type="button" data-click="close">Cancel</button><button class="btn primary" value="save">Save licence</button>`,
    on: {
      change: { type: (el) => { const t = R.LICENCE_TYPES.find((x) => x.type === el.value); $('#otherWrap', dlg).hidden = el.value !== '__other'; if (t) $('#lSev', dlg).value = t.severity; } },
      click: {
        file: async () => { const k = await pickAndUpload({ accept: 'image/*,application/pdf' }).catch(() => null); if (k) { fileKey = k; $('#lFile', dlg).innerHTML = part(fileHtml()); } },
        rmFile: () => { fileKey = null; $('#lFile', dlg).innerHTML = part(fileHtml()); },
        del: async () => {
          const ok = await confirmDialog({ title: 'Delete this licence?', text: 'It is removed from the register; the deletion is recorded.', ok: 'Delete', danger: true });
          if (!ok) return;
          try { await api(`/api/licences/${l.id}`, { method: 'DELETE' }); }
          catch (e) { if (!(e instanceof SignInNeeded)) toast(friendly(e), { error: true }); return; }
          searchData = null;
          toast('Licence deleted', { success: true }); closeDialog(); if (location.hash.startsWith('#/licences')) location.hash = '#/licences'; else rerender();
        },
      },
    },
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd);
      body.type = body.typeSel === '__other' ? (body.typeOther || '').trim() : body.typeSel;
      if (!body.type) { $('#lOther', dlg).classList.add('invalid'); return; }
      body.file_key = fileKey;
      if (l) await api(`/api/licences/${l.id}`, { method: 'PUT', body }); else await api('/api/licences', { method: 'POST', body });
      searchData = null;
      toast('Licence saved', { success: true }); closeDialog();
      if (location.hash.startsWith('#/licences/')) location.hash = '#/licences'; else rerender();
    },
  });
}
async function pageLicences({ token, params: [openId], query }) {
  const [d, sitesRes] = await Promise.all([api('/api/licences'), api('/api/sites')]);
  if (stale(token)) return;
  app.today = d.today;
  const today = d.today;
  const units = sitesRes.units;
  const kindOf = new Map(units.map((u) => [u.id, u.kind]));
  d.licences.forEach((l) => { l.site_kind = kindOf.get(l.site_id); l.state = licState(l, today); });
  const STATUSES = [['', 'All'], ['expired', 'Expired'], ['expiring', 'Expiring soon'], ['valid', 'Valid'], ['missing', 'Not added']];
  const state = { unit: query.get('unit') || '', status: STATUSES.some(([k]) => k === query.get('status')) ? query.get('status') : '', q: query.get('q') || '' };
  let showAllMissing = false;
  const words = () => state.q.toLowerCase().split(/\s+/).filter(Boolean);
  const recorded = () => d.licences.filter((l) => (!state.unit || String(l.site_id) === state.unit)
    && words().every((w) => `${l.type} ${l.site_name} ${l.site_city} ${l.number || ''}`.toLowerCase().includes(w)));
  const missing = () => units.filter((u) => !state.unit || String(u.id) === state.unit)
    .flatMap((u) => CORE_LICENCES.filter((t) => !d.licences.some((l) => l.site_id === u.id && l.type === t)).map((t) => ({ unit: u, type: t })))
    .filter((m) => words().every((w) => `${m.type} ${m.unit.name} ${m.unit.city}`.toLowerCase().includes(w)));
  const cols = [{ label: 'Licence type', w: 'minmax(0,2.2fr)' }, { label: 'Unit', w: 'minmax(0,1.4fr)' }, { label: 'Expiry date', w: 'minmax(0,1.3fr)' }, { label: 'Status', w: 'minmax(0,1.1fr)' }, { label: '', w: '80px' }];
  const recRow = (l) => dtRow(`#/licences/${l.id}`, [
    { cls: 'main', v: html`<div class="dt-primary">${l.type}</div><div class="dt-secondary">${l.number ? html`<span>No. ${l.number}</span>` : ''}${l.authority ? html`<span>${l.authority}</span>` : ''}${l.file_key ? html`<span>${icon('attach_file')}Scan</span>` : ''}</div>` },
    { lbl: 'Unit', v: unitName({ name: l.site_name, city: l.site_city, kind: l.site_kind }) },
    { lbl: 'Expiry', v: html`${l.expires_on ? fmt(l.expires_on, true) : '—'}<div class="xsmall ${l.state.tone === 'good' || l.state.tone === 'neutral' ? 'muted' : `t-${l.state.tone}`}">${l.state.text}</div>` },
    { cls: 'aside', v: toneBadge(l.state.tone, l.state.label) }, viewCell('Edit'),
  ]);
  const missRow = (m) => dtRow(null, [
    { cls: 'main', v: html`<div class="dt-primary">${m.type}</div>` },
    { lbl: 'Unit', v: unitName(m.unit) },
    { lbl: 'Expiry', v: html`<span class="muted">—</span>` },
    { cls: 'aside', v: toneBadge('neutral', 'Not added') },
    { cls: 'action keep', r: true, v: html`<button class="btn sm" data-click="addFor" data-site="${m.unit.id}" data-type="${m.type}">${icon('add')}Add</button>` },
  ]);
  const listHtml = () => {
    const rec = recorded(), miss = missing();
    const byState = (k) => rec.filter((l) => l.state.key === k);
    if (!units.length) return emptyState({ iconName: 'storefront', title: 'No units yet', text: 'Add units first, then record their licences.', action: html`<a class="btn primary" href="#/units?add=1">Add unit</a>` });
    if (state.status === 'missing') return miss.length ? dataTable(cols, miss.map(missRow)) : emptyState({ iconName: 'verified', tone: 'good', title: 'Nothing missing', text: 'Every core licence is recorded for these units.' });
    if (state.status) {
      const rs = byState(state.status);
      return rs.length ? dataTable(cols, rs.map(recRow)) : emptyState({ iconName: state.status === 'valid' ? 'verified' : 'task_alt', tone: state.status === 'valid' ? '' : 'good', title: `No ${STATUSES.find(([k]) => k === state.status)[1].toLowerCase()} licences`, text: d.licences.length ? '' : 'No licences added yet.', action: html`<button class="btn primary" data-click="add">${icon('add')}Add licence</button>` });
    }
    if (!rec.length && !miss.length) return emptyState({ iconName: 'verified', title: 'No licences added', action: html`<button class="btn primary" data-click="add">${icon('add')}Add licence</button>` });
    const order = { expired: 0, expiring: 1, valid: 2 };
    const sorted = [...rec].sort((a, b) => order[a.state.key] - order[b.state.key] || (a.expires_on || '9999').localeCompare(b.expires_on || '9999'));
    const missShown = showAllMissing ? miss : miss.slice(0, 12);
    return dataTable(cols, html`
      ${rec.length ? html`<div class="dt-group"><h3>Recorded</h3><span class="muted small">${rec.length}</span></div>${sorted.map(recRow)}`
        : html`<div class="dt-group"><h3>No licences added yet</h3><span class="sub">The audits show gaps in FSSAI display, water reports, pest-control records, medical fitness and FoSTaC. Record each with its expiry date and the dashboard warns 30 days ahead.</span></div>`}
      ${miss.length ? html`<div class="dt-group"><h3>Not added</h3><span class="muted small">${miss.length}</span><span class="sub">Core licences every unit should hold.</span></div>${missShown.map(missRow)}${miss.length > missShown.length ? html`<button class="dt-more" data-click="moreMissing">Show all ${miss.length}</button>` : ''}` : ''}`);
  };
  const stripHtml = () => {
    const rec = recorded();
    const n = (k) => rec.filter((l) => l.state.key === k).length;
    return html`${statCard({ label: 'Expired', value: html`${n('expired')}`, tone: n('expired') ? 'bad' : '', click: 'status', v: 'expired', pressed: state.status === 'expired' })}
      ${statCard({ label: 'Expiring soon', value: html`${n('expiring')}`, tone: n('expiring') ? 'warn' : '', click: 'status', v: 'expiring', pressed: state.status === 'expiring' })}
      ${statCard({ label: 'Valid', value: html`${n('valid')}`, tone: n('valid') ? 'good' : '', click: 'status', v: 'valid', pressed: state.status === 'valid' })}
      ${statCard({ label: 'Not added', value: html`${missing().length}`, click: 'status', v: 'missing', pressed: state.status === 'missing' })}`;
  };
  const sync = () => {
    const q = new URLSearchParams(Object.entries(state).filter(([, v]) => v));
    history.replaceState(null, '', `#/licences${q.toString() ? `?${q}` : ''}`);
    $('#licStrip').innerHTML = part(stripHtml());
    $('#licSeg').innerHTML = part(segmented({ name: 'status', value: state.status, label: 'Status', options: STATUSES }));
    $('#licList').innerHTML = part(listHtml());
  };
  mount({
    title: 'Licences',
    body: html`
      ${pageHeader({ title: 'Licences', sub: 'FSSAI, Fire NOC, water test, pest control, medical fitness, FoSTaC and more', actions: html`<button class="btn primary" data-click="add">${icon('add')}Add licence</button>` })}
      <div class="stack">
        <section class="strip" id="licStrip" aria-label="Summary">${stripHtml()}</section>
        <div class="filterbar">
          ${searchBar({ value: state.q, placeholder: 'Search licences' })}
          ${selectFilter({ name: 'unit', value: state.unit, label: 'Unit', options: [['', 'All units'], ...units.map((s) => [s.id, unitName(s)])] })}
        </div>
        <div id="licSeg">${segmented({ name: 'status', value: state.status, label: 'Status', options: STATUSES })}</div>
        <section class="card flush" id="licList">${listHtml()}</section>
        <p class="small muted">Expired critical or major licences make the unit Non-Compliance; expiry within ${R.LICENCE_WARN_DAYS} days makes it Needs Improvement.</p>
      </div>`,
  });
  on.click = {
    add: () => openLicenceDialog(null, units, state.unit ? +state.unit : null),
    addFor: (el) => openLicenceDialog(null, units, +el.dataset.site, el.dataset.type),
    status: (el) => { state.status = el.dataset.v === state.status && el.classList.contains('stat') ? '' : el.dataset.v; sync(); },
    moreMissing: () => { showAllMissing = true; $('#licList').innerHTML = part(listHtml()); },
  };
  on.change = { unit: (el) => { state.unit = el.value; sync(); } };
  on.input = { q: (el) => { state.q = el.value; sync(); } };
  if (openId) {
    const l = d.licences.find((x) => x.id === +openId);
    if (l) { openLicenceDialog(l, units); dlg.addEventListener('close', () => { if (location.hash.startsWith('#/licences/')) history.replaceState(null, '', '#/licences'); }, { once: true }); }
    else toast('That licence no longer exists.', { error: true });
  }
}

/** DownloadBar: PDF and Excel buttons at the end of a page, one tap each. */
const downloadBar = ({ title, text }) => html`<section class="card dl-bar no-print" aria-label="${title}">
  <span class="lead-icon tone-info">${icon('download')}</span>
  <span class="dl-text"><b>${title}</b><span class="small muted">${text}</span></span>
  <span class="dl-actions"><button class="btn" data-click="dlNow" data-v="pdf">${icon('picture_as_pdf')}Download PDF</button><button class="btn" data-click="dlNow" data-v="excel">${icon('table_view')}Download Excel</button></span>
</section>`;
/** Runs a download from a DownloadBar button, showing progress on the button itself. */
async function runDownload(btn, make) {
  const buttons = $$('button', btn.closest('.dl-bar'));
  const was = btn.innerHTML;
  buttons.forEach((b) => { b.disabled = true; });
  btn.innerHTML = part(html`${icon('hourglass_top')}Preparing…`);
  try { toast(`Downloaded ${await make(btn.dataset.v)}`, { success: true }); }
  catch (e) { toast(friendly(e), { error: true }); }
  finally { buttons.forEach((b) => { b.disabled = false; }); btn.innerHTML = was; }
}

// =================================================================== page: reports (PDF or Excel, built in the browser from the existing APIs)
const LIBS = {
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  exceljs: 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
};
const scriptLoads = new Map();
/** Loads a report library once, only when someone generates a report. */
function loadScript(src) {
  if (!scriptLoads.has(src)) {
    scriptLoads.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => { scriptLoads.delete(src); s.remove(); reject(new ApiError('Could not load the report tools. Check the internet connection and try again.')); };
      document.head.appendChild(s);
    }));
  }
  return scriptLoads.get(src);
}
const fileSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// The PDF's built-in font covers Latin-1 plus a few typographic marks; swap the rest for plain equivalents.
const PDF_MAP = { '★': '*', '→': '->', '−': '-', '≥': '>=', '≤': '<=' };
const pdfText = (s) => String(s ?? '').replace(/[^\x00-\xFF‘’“”–—•…€™]/g, (c) => PDF_MAP[c] ?? '');

// Shared look for every downloaded document.
const PDF = {
  NAVY: [0, 36, 156], INK: [18, 22, 43], MUTED: [100, 107, 128], LINE: [222, 226, 233], HEAD: [241, 243, 246],
  FG: { good: [21, 128, 61], warn: [154, 91, 0], bad: [180, 35, 24], neutral: [75, 82, 102] },
  BG: { good: [231, 245, 236], warn: [253, 242, 220], bad: [253, 236, 234], neutral: [238, 240, 244] },
};
const PRIO_TONE = { critical: 'bad', major: 'warn', minor: 'neutral' };
const RESULT_TONE = { pass: 'good', partial: 'warn', fail: 'bad', na: 'neutral' };

/** A branded A4 PDF: header band, title, summary boxes, sections and tables, running header and page numbers. */
async function pdfKit({ title, subtitle, running }) {
  await loadScript(LIBS.jspdf);
  await loadScript(LIBS.autotable);
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;
  const { NAVY, INK, MUTED, LINE, HEAD, FG, BG } = PDF;
  const T = pdfText;
  const by = app.me?.name || '';
  const newPageIf = (room) => { if (y > H - room) { doc.addPage(); y = 24; } };

  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text('BOOKENDS HOSPITALITY', M, 12);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('Food safety & maintenance compliance', M, 18.5);
  doc.text(T(`Generated ${fmt(app.today, true)}`), W - M, 12, { align: 'right' });
  if (by) doc.text(T(`by ${by}`), W - M, 18.5, { align: 'right' });
  let y = 38;
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  const tl = doc.splitTextToSize(T(title), W - 2 * M); doc.text(tl, M, y); y += (tl.length - 1) * 7;
  y += 7; doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...MUTED); doc.text(T(subtitle), M, y);
  y += 8;

  const k = {
    doc, T, FG, BG,
    badge: (tone, text) => ({ content: T(text), styles: { textColor: FG[tone], fillColor: BG[tone], fontStyle: 'bold' } }),
    scoreCell: (s) => (s == null ? { content: '-', styles: { halign: 'right', textColor: MUTED } } : { content: pct(s), styles: { halign: 'right', fontStyle: 'bold', textColor: FG[toneOf(R.bandFor(s))] } }),
    prioCell: (p) => ({ content: R.PRIORITY[p].short, styles: { halign: 'center', fontStyle: 'bold', textColor: FG[PRIO_TONE[p]], fillColor: BG[PRIO_TONE[p]] } }),
    num: (n) => ({ content: n == null ? '-' : String(n), styles: { halign: 'right' } }),
    /** Summary boxes: [{ label, value, sub, tone }] */
    kpis(list) {
      const gap = 3.5, bw = (W - 2 * M - gap * (list.length - 1)) / list.length, bh = 23;
      list.forEach((x, i) => {
        const bx = M + i * (bw + gap);
        doc.setDrawColor(...LINE); doc.setFillColor(255, 255, 255); doc.setLineWidth(0.3); doc.roundedRect(bx, y, bw, bh, 2, 2, 'FD');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(doc.splitTextToSize(T(x.label), bw - 6)[0] || '', bx + 3, y + 5.5);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...(x.tone ? FG[x.tone] : INK)); doc.text(T(x.value), bx + 3, y + 14);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(doc.splitTextToSize(T(x.sub || ''), bw - 6)[0] || '', bx + 3, y + 19.5);
      });
      y += bh + 6;
    },
    /** A short note in small type. tone: null (grey italic) or good / warn / bad (coloured box). */
    note(text, { tone = null, italic = true } = {}) {
      newPageIf(30);
      doc.setFontSize(8);
      if (tone) {
        const lines = doc.splitTextToSize(T(text), W - 2 * M - 8);
        doc.setFillColor(...BG[tone]); doc.roundedRect(M, y - 2, W - 2 * M, lines.length * 3.6 + 5, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...FG[tone]); doc.text(lines, M + 4, y + 2.6);
        y += lines.length * 3.6 + 7;
      } else {
        const lines = doc.splitTextToSize(T(text), W - 2 * M);
        doc.setFont('helvetica', italic ? 'italic' : 'normal'); doc.setTextColor(...MUTED); doc.text(lines, M, y);
        y += lines.length * 3.6 + 4;
      }
    },
    /** Body text, paragraph by paragraph, breaking across pages. */
    paragraphs(text) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      for (const para of String(text).split(/\n+/).filter((p) => p.trim())) {
        for (const line of doc.splitTextToSize(T(para.trim()), W - 2 * M)) { newPageIf(20); doc.text(line, M, y); y += 4.6; }
        y += 2.5;
      }
      y += 4;
    },
    section(name, sub = '') {
      newPageIf(45);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK); doc.text(T(name), M, y);
      if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(T(sub), W - M, y, { align: 'right' }); }
      doc.setDrawColor(...NAVY); doc.setLineWidth(0.5); doc.line(M, y + 2, M + 12, y + 2);
      y += 6;
    },
    empty(text) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text(T(text), M, y + 3); y += 11; },
    table(head, body, columnStyles = {}) {
      doc.autoTable({
        startY: y, head: head ? [head.map(T)] : undefined, body: body.map((row) => row.map((c) => (c && typeof c === 'object' ? { ...c, content: T(c.content) } : T(c)))), theme: 'grid', columnStyles,
        margin: { left: M, right: M, top: 22, bottom: 18 },
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, textColor: INK, lineColor: LINE, lineWidth: 0.15, overflow: 'linebreak', valign: 'middle' },
        headStyles: { fillColor: HEAD, textColor: MUTED, fontStyle: 'bold', fontSize: 7.5 },
        alternateRowStyles: { fillColor: [250, 251, 252] },
      });
      y = doc.lastAutoTable.finalY + 10;
    },
    /** Label / value pairs in two columns, no header. */
    details(pairs) {
      const rows = [];
      for (let i = 0; i < pairs.length; i += 2) {
        const [a, b] = [pairs[i], pairs[i + 1] || ['', '']];
        rows.push([{ content: a[0], styles: { textColor: MUTED, fontStyle: 'bold' } }, a[1], { content: b[0], styles: { textColor: MUTED, fontStyle: 'bold' } }, b[1]]);
      }
      k.table(null, rows, { 0: { cellWidth: 28 }, 2: { cellWidth: 28 } });
    },
    save(name) {
      const pages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        if (i > 1) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...NAVY); doc.text('BOOKENDS HOSPITALITY', M, 12);
          doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED); doc.text(doc.splitTextToSize(T(running), W - 2 * M - 45)[0] || '', W - M, 12, { align: 'right' });
          doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, 15, W - M, 15);
        }
        doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, H - 12, W - M, H - 12);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
        doc.text(T(`Bookends Compliance · generated ${fmt(app.today, true)}`), M, H - 7);
        doc.text(`Page ${i} of ${pages}`, W - M, H - 7, { align: 'right' });
      }
      doc.save(name);
      return name;
    },
  };
  return k;
}
const GRADE_KEY = `Grade bands: Exemplar 90%+ · Satisfactory 80%+ (the target) · Needs Improvement 50–79% · Non-Compliance below 50%. Priority 1: act within 48 hours · Priority 2: 7 days · Priority 3: 30 days.`;
const CHECKLIST_NOTE = 'Visit 1 and visit 2 used different food safety checklists, so read changes between them as a direction, not an exact like-for-like measurement.';

// Excel styling: Bookends blue for titles and headers; colour only for meaning, always with the text.
const XL = {
  NAVY: 'FF00249C', INK: 'FF12162B', MUTED: 'FF646B80', LINE: 'FFDDE1E8', ZEBRA: 'FFF8F9FB', LABEL: 'FFF1F3F6', WHITE: 'FFFFFFFF',
  tone: { good: ['FF15803D', 'FFE7F5EC'], warn: ['FF9A5B00', 'FFFDF2DC'], bad: ['FFB42318', 'FFFDECEA'], neutral: ['FF4B5266', 'FFEEF0F4'], info: ['FF001A73', 'FFE9EDFA'] },
};
// What a cell's text means, for the Grade, Status, Priority and Rating columns.
const XL_TONES = {
  Exemplar: 'good', Satisfactory: 'good', 'Needs Improvement': 'warn', 'Non-Compliance': 'bad', 'Not audited': 'neutral',
  'Priority 1': 'bad', 'Priority 2': 'warn', 'Priority 3': 'neutral',
  Compliant: 'good', OK: 'good', Minor: 'warn', Partial: 'warn', Observation: 'warn', Major: 'bad', 'Non-compliant': 'bad', 'N/A': 'neutral',
  Overdue: 'bad', 'Awaiting verification': 'info', Closed: 'good', Expired: 'bad', 'Expiring soon': 'warn', Valid: 'good', 'No expiry': 'neutral', 'Not added': 'neutral',
};
const XL_TONE_COLS = /^(Grade|Status|Status now|Priority|Rating)$/;
const XL_PCT_COLS = /\(%\)|^Score$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoToDate = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));

/** A formatted Excel workbook: title banner, styled and frozen header, filters, colour-coded cells, print setup. */
async function xlsxKit() {
  await loadScript(LIBS.exceljs);
  const wb = new window.ExcelJS.Workbook();
  wb.creator = 'Bookends Compliance';
  wb.created = new Date();
  const by = app.me?.name || '';
  const thin = { style: 'thin', color: { argb: XL.LINE } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const toneCell = (cell, tone, { center = true } = {}) => {
    const [fg, bg] = XL.tone[tone];
    cell.font = { ...cell.font, bold: true, color: { argb: fg } };
    cell.fill = fill(bg);
    if (center) cell.alignment = { ...cell.alignment, horizontal: 'center' };
  };
  /** Sets a value with the right Excel type and format: real dates, percentages, signed changes. */
  const put = (cell, v, head = '') => {
    if (v == null || v === '') { cell.value = null; return; }
    if (typeof v === 'string' && ISO_DAY.test(v)) { cell.value = isoToDate(v); cell.numFmt = 'dd mmm yyyy'; cell.alignment = { ...cell.alignment, horizontal: 'center' }; return; }
    cell.value = v;
    if (typeof v !== 'number') return;
    cell.alignment = { ...cell.alignment, horizontal: 'right' };
    if (XL_PCT_COLS.test(head)) { cell.numFmt = '0.0"%"'; cell.font = { ...cell.font, bold: true, color: { argb: XL.tone[toneOf(R.bandFor(v))][0] } }; }
    else if (/^Change/.test(head)) { cell.numFmt = '+0.0;-0.0;0.0'; cell.font = { ...cell.font, color: { argb: v > 0 ? XL.tone.good[0] : v < 0 ? XL.tone.bad[0] : XL.MUTED } }; }
  };
  // Excel does not grow rows for wrapped text it did not lay out itself, so size them from the text.
  const fitHeight = (row, cells) => {
    const lines = Math.max(1, ...cells.map(({ text, width }) => String(text ?? '').split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / Math.max(8, width * 1.3))), 0)));
    row.height = Math.max(20, lines * 14 + 6);
  };
  const banner = (ws, cols, title, subtitle) => {
    ws.mergeCells(1, 1, 1, cols);
    const t = ws.getCell(1, 1);
    t.value = title;
    t.font = { bold: true, size: 15, color: { argb: XL.WHITE } };
    t.fill = fill(XL.NAVY);
    t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 32;
    ws.mergeCells(2, 1, 2, cols);
    const s = ws.getCell(2, 1);
    s.value = [subtitle, `Bookends Hospitality · generated ${fmt(app.today, true)}${by ? ` by ${by}` : ''}`].filter(Boolean).join('   ·   ');
    s.font = { italic: true, size: 10, color: { argb: XL.MUTED } };
    s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(2).height = 20;
    ws.getRow(3).height = 8;
  };
  const sheetOpts = (frozenRows) => ({
    views: [{ state: 'frozen', ySplit: frozenRows, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: '&LBookends Compliance&RPage &P of &N' },
  });
  return {
    /** One table per sheet. head: column names; rows: arrays of values; widths: column widths in characters. */
    table(name, { title, subtitle = '', head, rows, widths }) {
      const ws = wb.addWorksheet(name.slice(0, 31), sheetOpts(4));
      const n = head.length;
      ws.columns = widths.map((width) => ({ width }));
      banner(ws, n, title, subtitle);
      const hr = ws.getRow(4);
      head.forEach((h, c) => {
        const cell = hr.getCell(c + 1);
        cell.value = h;
        cell.font = { bold: true, size: 10, color: { argb: XL.WHITE } };
        cell.fill = fill(XL.NAVY);
        cell.border = { top: thin, left: { style: 'thin', color: { argb: 'FF3350B5' } }, right: { style: 'thin', color: { argb: 'FF3350B5' } }, bottom: { style: 'medium', color: { argb: XL.NAVY } } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
      fitHeight(hr, head.map((h, c) => ({ text: h, width: widths[c] })));
      rows.forEach((vals, i) => {
        const row = ws.getRow(5 + i);
        const wrapped = [];
        head.forEach((h, c) => {
          const cell = row.getCell(c + 1);
          const v = vals[c];
          const wrap = widths[c] >= 24;
          cell.font = { size: 10, color: { argb: XL.INK } };
          cell.border = box;
          cell.alignment = { vertical: 'top', wrapText: wrap };
          if (i % 2) cell.fill = fill(XL.ZEBRA);
          put(cell, v, h);
          if (XL_TONE_COLS.test(h) && XL_TONES[v]) toneCell(cell, XL_TONES[v]);
          if ((h === 'Critical' || h === 'Repeat') && v === 'Yes') cell.font = { ...cell.font, bold: true, color: { argb: XL.tone.bad[0] } };
          if (h === 'Days overdue' && typeof v === 'number' && v > 0) cell.font = { ...cell.font, bold: true, color: { argb: XL.tone.bad[0] } };
          if (wrap && typeof v === 'string') wrapped.push({ text: v, width: widths[c] });
        });
        fitHeight(row, wrapped);
      });
      if (!rows.length) {
        ws.mergeCells(5, 1, 5, n);
        const cell = ws.getCell(5, 1);
        cell.value = 'Nothing to show for this selection.';
        cell.font = { italic: true, color: { argb: XL.MUTED } };
        cell.alignment = { horizontal: 'center' };
        ws.getRow(5).height = 24;
      } else {
        ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: n } };
      }
      ws.pageSetup.printTitlesRow = '4:4';
    },
    /** A summary sheet: headed blocks of label / value pairs. A row's third item may set { tone }; numbers whose label has (%) show as percentages. */
    summary(name, { title, subtitle = '', blocks }) {
      const ws = wb.addWorksheet(name.slice(0, 31), sheetOpts(3));
      ws.columns = [{ width: 38 }, { width: 80 }];
      banner(ws, 2, title, subtitle);
      let r = 4;
      for (const b of blocks) {
        ws.mergeCells(r, 1, r, 2);
        const h = ws.getCell(r, 1);
        h.value = b.heading;
        h.font = { bold: true, size: 11, color: { argb: XL.NAVY } };
        h.border = { bottom: { style: 'medium', color: { argb: XL.NAVY } } };
        h.alignment = { vertical: 'bottom' };
        ws.getRow(r).height = 24;
        r += 1;
        for (const [label, value, opts = {}] of b.rows) {
          const row = ws.getRow(r);
          const lc = row.getCell(1), vc = row.getCell(2);
          lc.value = label;
          lc.font = { bold: true, size: 10, color: { argb: XL.INK } };
          lc.fill = fill(XL.LABEL);
          lc.border = box;
          lc.alignment = { vertical: 'top', wrapText: true };
          vc.font = { size: 10, color: { argb: XL.INK } };
          vc.border = box;
          vc.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
          put(vc, value, XL_PCT_COLS.test(label) || opts.pct ? '(%)' : '');
          if (typeof value === 'number') vc.alignment = { ...vc.alignment, horizontal: 'left' };
          if (XL_TONES[label] && opts.labelTone !== false) toneCell(lc, XL_TONES[label], { center: false });
          if (XL_TONES[value]) toneCell(vc, XL_TONES[value], { center: false });
          if (opts.tone) toneCell(vc, opts.tone, { center: false });
          fitHeight(row, [{ text: label, width: 38 }, { text: value, width: 80 }]);
          r += 1;
        }
        r += 1;
      }
    },
    async save(name) {
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      return name;
    },
  };
}
const n1 = (x) => (x == null ? '' : R.round1(x));
/** Time spent on audits that have a recorded time: { timed, total, avg } in minutes. */
const timeTotals = (audits) => {
  const ms = audits.map(R.auditMinutes).filter((m) => m != null);
  const total = ms.reduce((t, m) => t + m, 0);
  return { timed: ms.length, total, avg: ms.length ? Math.round(total / ms.length) : null };
};
const timeSub = (t, of) => (t.timed ? `avg ${R.fmtDuration(t.avg)} per audit${t.timed < of ? ` · ${t.timed} of ${of} timed` : ''}` : 'No times recorded');
const GRADE_ROWS = [['Exemplar', '90% or more'], ['Satisfactory', '80–89%: the target for every unit'], ['Needs Improvement', '50–79%'], ['Non-Compliance', 'Below 50%']];
const PRIORITY_ROWS = [['Priority 1', 'Act within 48 hours'], ['Priority 2', 'Act within 7 days'], ['Priority 3', 'Act within 30 days']];


async function pageReports({ token, query }) {
  const [sites, au, fx, li] = await Promise.all([api('/api/sites'), api('/api/audits'), api('/api/findings'), api('/api/licences')]);
  if (stale(token)) return;
  app.today = sites.today;
  const today = sites.today;
  const units = sites.units;
  const latestAudit = au.audits.map((a) => a.audit_date).sort().at(-1) || today;
  const TYPES = [['food', 'Food safety'], ['maintenance', 'Maintenance'], ['combined', 'Combined']];
  const PERIODS = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom'], ['all', 'All time']];
  const FORMATS = [['pdf', 'PDF'], ['excel', 'Excel']];
  const pick = (k, list, dflt) => (list.some(([v]) => v === query.get(k)) ? query.get(k) : dflt);
  const state = {
    type: pick('type', TYPES, 'combined'), unit: query.get('unit') || '', period: pick('period', PERIODS, 'monthly'), format: pick('format', FORMATS, 'pdf'),
    date: query.get('date') || today, month: query.get('month') || latestAudit.slice(0, 7), from: query.get('from') || R.addDays(today, -30), to: query.get('to') || today,
  };
  const range = () => {
    if (state.period === 'daily') return [state.date, state.date];
    if (state.period === 'weekly') return [R.addDays(state.date, -6), state.date];
    if (state.period === 'monthly') { const [y, m] = state.month.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return [`${state.month}-01`, `${state.month}-${String(last).padStart(2, '0')}`]; }
    if (state.period === 'custom') return [state.from <= state.to ? state.from : state.to, state.from <= state.to ? state.to : state.from];
    return ['0000-01-01', '9999-12-31'];
  };
  const periodInputs = () => ({
    daily: html`<div class="field"><label for="rDate">Day</label><input class="input" type="date" id="rDate" data-change="date" value="${state.date}" max="${today}"></div>`,
    weekly: html`<div class="field"><label for="rDate">Week ending</label><input class="input" type="date" id="rDate" data-change="date" value="${state.date}" max="${today}"><span class="hint">The 7 days up to and including this date.</span></div>`,
    monthly: html`<div class="field"><label for="rMonth">Month</label><input class="input" type="month" id="rMonth" data-change="month" value="${state.month}"></div>`,
    custom: html`<div class="form-2"><div class="field"><label for="rFrom">From</label><input class="input" type="date" id="rFrom" data-change="from" value="${state.from}"></div><div class="field"><label for="rTo">To</label><input class="input" type="date" id="rTo" data-change="to" value="${state.to}"></div></div>`,
    all: html`<p class="small muted">Every audit on record.</p>`,
  })[state.period];

  /** Everything one report contains, computed once and drawn three ways: on screen, as PDF and as Excel. */
  const build = () => {
    const [from, to] = range();
    const domains = state.type === 'combined' ? R.AUDIT_DOMAINS : [state.type];
    const inUnit = (sid) => !state.unit || String(sid) === state.unit;
    const audits = au.audits.filter((a) => inUnit(a.site_id) && domains.includes(a.domain) && a.audit_date >= from && a.audit_date <= to)
      .sort((a, b) => a.audit_date.localeCompare(b.audit_date) || a.id - b.id);
    const scopeFix = fx.findings.filter((f) => inUnit(f.site_id) && domains.includes(f.domain));
    const raised = scopeFix.filter((f) => f.audit_date && f.audit_date >= from && f.audit_date <= to);
    const openNow = scopeFix.filter((f) => R.UNRESOLVED.includes(f.status))
      .sort((a, b) => R.PRIORITY_ORDER.indexOf(a.priority) - R.PRIORITY_ORDER.indexOf(b.priority) || a.due_date.localeCompare(b.due_date));
    const overdueNow = openNow.filter((f) => f.due_date < today);
    const avg = (xs) => (xs.length ? R.round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
    const unitList = units.filter((u) => inUnit(u.id));
    const unit = state.unit ? units.find((u) => String(u.id) === state.unit) : null;
    const unitRows = state.unit ? null : unitList.map((u) => {
      const uo = openNow.filter((f) => f.site_id === u.id);
      return { u, latest: Object.fromEntries(domains.map((dm) => [dm, audits.filter((a) => a.site_id === u.id && a.domain === dm).at(-1) || null])),
        open: uo.length, p1: uo.filter((f) => f.priority === 'critical').length, overdue: uo.filter((f) => f.due_date < today).length };
    });
    const licences = li.licences.filter((l) => inUnit(l.site_id)).map((l) => ({ ...l, st: licState(l, today) }));
    const missing = unitList.map((u) => ({ u, types: CORE_LICENCES.filter((t) => !li.licences.some((l) => l.site_id === u.id && l.type === t)) })).filter((m) => m.types.length);
    const typeLabel = TYPES.find(([k]) => k === state.type)[1];
    const unitLabel = unit ? unitName(unit) : 'All units';
    const periodLabel = state.period === 'all' ? 'All time' : from === to ? fmt(from, true) : `${fmt(from, true)} – ${fmt(to, true)}`;
    return {
      from, to, domains, audits, raised, openNow, overdueNow, unitRows, licences, missing, typeLabel, unitLabel, periodLabel,
      time: timeTotals(audits),
      avgs: Object.fromEntries(domains.map((dm) => [dm, avg(audits.filter((a) => a.domain === dm).map((a) => a.score))])),
      by: app.me?.name || '', allTime: state.period === 'all',
      fileBase: `bookends-${fileSlug(typeLabel)}-report-${fileSlug(unitLabel)}-${state.period === 'all' ? 'all-time' : from === to ? from : `${from}-to-${to}`}`,
    };
  };
  const fixStatusText = (f) => (isOverdue(f, today) ? `Overdue (${R.plural(R.daysBetween(f.due_date, today), 'day')})` : FIX_STATUS[f.status][1]);

  // ---------------------------------------------------------------- on-screen view
  const preview = (r, note = '') => {
    const top = r.openNow.slice(0, state.unit ? 60 : 25);
    return html`<article class="card report-doc" id="reportDoc">
      <div class="rd-head"><div style="flex:1;min-width:0"><div class="small muted strong" style="letter-spacing:.06em">BOOKENDS HOSPITALITY · COMPLIANCE REPORT</div><h2>${r.typeLabel} report: ${r.unitLabel}</h2>
        <div class="small muted">${r.periodLabel} · generated ${fmt(today, true)}${r.by ? ` by ${r.by}` : ''}</div></div></div>
      ${note ? html`<div class="banner good no-print" id="dlNote">${icon('download_done')}<span class="b-body">${note}</span></div>` : ''}
      <div class="grid-stats">
        ${statCard({ label: 'Audits in period', value: html`${r.audits.length}`, sub: r.domains.map((dm) => `${r.audits.filter((a) => a.domain === dm).length} ${R.DOMAINS[dm].label.toLowerCase()}`).join(' · ') })}
        ${r.domains.map((dm) => { const v = r.avgs[dm]; return statCard({ label: `${R.DOMAINS[dm].label} average`, value: v == null ? '—' : pct(v), tone: v == null ? '' : toneOf(R.bandFor(v)), sub: `Target ${R.TARGET}%` }); })}
        ${statCard({ label: 'Time auditing', value: r.time.timed ? R.fmtDuration(r.time.total) : '—', sub: timeSub(r.time, r.audits.length) })}
        ${statCard({ label: 'Fixes raised in period', value: html`${r.raised.length}`, sub: R.PRIORITY_ORDER.map((p) => `${r.raised.filter((f) => f.priority === p).length} ${R.PRIORITY[p].short}`).join(' · ') })}
        ${statCard({ label: 'Open fixes now', value: html`${r.openNow.length}`, tone: r.overdueNow.length ? 'bad' : '', sub: `${r.overdueNow.length} overdue · ${r.openNow.filter((f) => f.priority === 'critical').length} Priority 1` })}
      </div>
      ${state.type !== 'maintenance' ? html`<p class="small muted">Visit 1 and visit 2 used different food safety checklists, so read changes between them as a direction, not an exact like-for-like measurement.</p>` : ''}
      <section><h3>Audits in this period</h3>${r.audits.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Unit</th><th>Audit</th><th class="n">Visit</th><th>Auditor</th><th>Time</th><th class="n">Score</th><th>Grade</th><th class="n">Fixes raised</th></tr></thead>
        <tbody>${r.audits.map((a) => html`<tr><td class="nowrap">${fmt(a.audit_date, true)}</td><td><a href="#/audits/${a.id}">${unitName(a)}</a></td><td>${R.DOMAINS[a.domain].label}</td><td class="n">${a.visit}</td><td>${a.auditor || '—'}</td><td class="nowrap">${R.auditTimeRange(a) || '—'}${R.auditMinutes(a) != null ? html`<br><span class="small muted">${R.fmtDuration(R.auditMinutes(a))}</span>` : ''}</td><td class="n">${scoreDisplay(a.score)}</td><td>${statusBadge(a.band)}</td><td class="n">${a.findings_count}</td></tr>`)}</tbody></table></div>`
        : emptyState({ compact: true, iconName: 'event_busy', title: 'No audits in this period', text: `The most recent audit on record is from ${fmt(latestAudit, true)}. Try a different period, or All time.` })}</section>
      ${r.unitRows ? html`<section><h3>Where each unit stands</h3><div class="table-wrap"><table class="table"><thead><tr><th>Unit</th>${r.domains.map((dm) => html`<th class="n">${R.DOMAINS[dm].label} (latest in period)</th>`)}<th>Status now</th><th class="n">Open fixes</th><th class="n">P1 open</th><th class="n">Overdue</th></tr></thead>
        <tbody>${r.unitRows.map((x) => html`<tr><td><a href="#/units/${x.u.id}">${unitName(x.u)}</a></td>${r.domains.map((dm) => html`<td class="n">${x.latest[dm] ? scoreDisplay(x.latest[dm].score) : html`<span class="muted">—</span>`}</td>`)}<td>${statusBadge(x.u.status.overall)}</td><td class="n">${x.open}</td><td class="n">${x.p1 || '—'}</td><td class="n">${x.overdue || '—'}</td></tr>`)}</tbody></table></div></section>` : ''}
      <section><h3>Open fixes${top.length < r.openNow.length ? ` (most urgent ${top.length} of ${r.openNow.length}; the downloaded file has them all)` : ''}</h3>${top.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Priority</th><th>Fix</th>${state.unit ? '' : html`<th>Unit</th>`}<th>Due</th><th>Status</th><th>Assigned to</th></tr></thead>
        <tbody>${top.map((f) => html`<tr><td>${prioBadge(f.priority)}</td><td><a href="#/fixes/${f.id}">${f.title}</a></td>${state.unit ? '' : html`<td>${unitName(f)}</td>`}<td class="nowrap">${fmt(f.due_date, true)}</td><td>${fixStatusBadge(f, today)}</td><td>${f.owner || '—'}</td></tr>`)}</tbody></table></div>`
        : emptyState({ compact: true, iconName: 'task_alt', tone: 'good', title: 'No open fixes' })}</section>
      ${state.type === 'combined' ? html`<section><h3>Licences</h3>${r.licences.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Licence</th><th>Unit</th><th>Expiry</th><th>Status</th></tr></thead><tbody>${r.licences.map((l) => html`<tr><td>${l.type}</td><td>${l.site_name}</td><td>${l.expires_on ? fmt(l.expires_on, true) : '—'}</td><td>${toneBadge(l.st.tone, l.st.label)}</td></tr>`)}</tbody></table></div>` : html`<p class="small">No licences recorded yet.</p>`}
        ${r.missing.length ? html`<p class="small muted" style="margin-top:8px">${R.plural(r.missing.reduce((n, m) => n + m.types.length, 0), 'core licence')} not added yet, across ${R.plural(r.missing.length, 'unit')}.</p>` : ''}</section>` : ''}
    </article>`;
  };

  // ---------------------------------------------------------------- PDF (A4, branded, page numbers)
  const makePdf = async (r) => {
    const k = await pdfKit({ title: `${r.typeLabel} report`, subtitle: `${r.unitLabel}  ·  ${r.periodLabel}`, running: `${r.typeLabel} report · ${r.unitLabel} · ${r.periodLabel}` });
    const { badge, scoreCell, prioCell, num, FG, T } = k;
    k.kpis([
      { label: 'Audits in period', value: String(r.audits.length), sub: r.domains.map((dm) => `${r.audits.filter((a) => a.domain === dm).length} ${R.DOMAINS[dm].label.toLowerCase()}`).join(' · ') },
      ...r.domains.map((dm) => ({ label: `${R.DOMAINS[dm].label} average`, value: r.avgs[dm] == null ? '-' : pct(r.avgs[dm]), tone: r.avgs[dm] == null ? null : toneOf(R.bandFor(r.avgs[dm])), sub: `Target ${R.TARGET}%` })),
      { label: 'Time auditing', value: r.time.timed ? R.fmtDuration(r.time.total) : '-', sub: timeSub(r.time, r.audits.length) },
      { label: 'Fixes raised', value: String(r.raised.length), sub: R.PRIORITY_ORDER.map((p) => `${r.raised.filter((f) => f.priority === p).length} ${R.PRIORITY[p].short}`).join(' · ') },
      { label: 'Open fixes now', value: String(r.openNow.length), tone: r.overdueNow.length ? 'bad' : null, sub: `${r.overdueNow.length} overdue · ${r.openNow.filter((f) => f.priority === 'critical').length} P1` },
    ]);
    if (state.type !== 'maintenance') k.note(CHECKLIST_NOTE);

    k.section('Audits in this period', R.plural(r.audits.length, 'audit'));
    if (r.audits.length) {
      k.table(['Date', 'Unit', 'Audit', 'Visit', 'Auditor', 'Time taken', 'Score', 'Grade', 'Fixes raised'],
        r.audits.map((a) => [fmt(a.audit_date, true), unitName(a), R.DOMAINS[a.domain].label, num(a.visit), a.auditor || '-', R.auditMinutes(a) == null ? '-' : R.fmtDuration(R.auditMinutes(a)), scoreCell(a.score), badge(toneOf(a.band), R.bandLabel(a.band)), num(a.findings_count)]),
        { 0: { cellWidth: 20 }, 2: { cellWidth: 19 }, 3: { cellWidth: 10 }, 4: { cellWidth: 20 }, 5: { cellWidth: 16 }, 6: { cellWidth: 14 }, 7: { cellWidth: 28 }, 8: { cellWidth: 14 } });
    } else k.empty(`No audits in this period. The most recent audit on record is from ${fmt(latestAudit, true)}.`);

    if (r.unitRows) {
      k.section('Where each unit stands', 'Latest score in the period · status today');
      k.table(['Unit', ...r.domains.map((dm) => R.DOMAINS[dm].label), 'Status now', 'Open fixes', 'P1 open', 'Overdue'],
        r.unitRows.map((x) => [unitName(x.u), ...r.domains.map((dm) => scoreCell(x.latest[dm]?.score ?? null)), badge(toneOf(x.u.status.overall), R.LEVELS[x.u.status.overall].label), num(x.open), num(x.p1), num(x.overdue)]));
    }

    k.section('Open fixes', `${R.plural(r.openNow.length, 'fix', 'fixes')} · Priority 1 first, then by due date`);
    if (r.openNow.length) {
      k.table(['#', 'Priority', 'Fix', ...(state.unit ? [] : ['Unit']), 'Due', 'Status', 'Assigned to'],
        r.openNow.map((f) => [num(f.id), prioCell(f.priority), f.title, ...(state.unit ? [] : [unitName(f)]), fmt(f.due_date, true),
          isOverdue(f, today) ? { content: T(fixStatusText(f)), styles: { textColor: FG.bad, fontStyle: 'bold' } } : fixStatusText(f), f.owner || '-']),
        state.unit ? { 0: { cellWidth: 10 }, 1: { cellWidth: 14 }, 2: { cellWidth: 85 } } : { 0: { cellWidth: 10 }, 1: { cellWidth: 14 }, 2: { cellWidth: 54 }, 3: { cellWidth: 36 }, 4: { cellWidth: 21 }, 5: { cellWidth: 27 } });
    } else k.empty('No open fixes.');

    if (state.type === 'combined') {
      k.section('Licences', `${R.plural(r.licences.length, 'recorded licence')}`);
      if (r.licences.length) k.table(['Licence', 'Unit', 'Number', 'Expires', 'Status'], r.licences.map((l) => [l.type, l.site_name, l.number || '-', l.expires_on ? fmt(l.expires_on, true) : 'No expiry', badge(l.st.tone, l.st.label)]));
      else k.empty('No licences recorded yet.');
      if (r.missing.length) {
        k.section('Core licences not added yet');
        k.table(['Unit', 'Not added'], r.missing.map((m) => [unitName(m.u), m.types.join(', ')]), { 0: { cellWidth: 55 } });
      }
    }
    k.note(GRADE_KEY, { italic: false });
    return k.save(`${r.fileBase}.pdf`);
  };

  // ---------------------------------------------------------------- Excel (one sheet per table, filters on every header)
  const makeExcel = async (r) => {
    const xk = await xlsxKit();
    const sub = `${r.unitLabel} · ${r.periodLabel}`;
    const p1Open = r.openNow.filter((f) => f.priority === 'critical').length;
    xk.summary('Summary', { title: `${r.typeLabel} report`, subtitle: sub, blocks: [
      { heading: 'Report', rows: [['Report', `${r.typeLabel} report`], ['Unit', r.unitLabel], ['Period', r.periodLabel], ...(r.allTime ? [] : [['From', r.from], ['To', r.to]])] },
      { heading: 'Key numbers', rows: [['Audits in period', r.audits.length],
        ['Total time auditing', r.time.timed ? R.fmtDuration(r.time.total) : 'No times recorded'], ['Average time per audit', r.time.timed ? R.fmtDuration(r.time.avg) : '-'], ['Audits with a recorded time', `${r.time.timed} of ${r.audits.length}`],
        ...r.domains.map((dm) => [`${R.DOMAINS[dm].label} average score (%)`, n1(r.avgs[dm])]), ['Target score (%)', R.TARGET],
        ['Fixes raised in period', r.raised.length], ...R.PRIORITY_ORDER.map((p) => [`   of which ${R.PRIORITY[p].label}`, r.raised.filter((f) => f.priority === p).length]),
        ['Open fixes now', r.openNow.length], ['Overdue fixes now', r.overdueNow.length, { tone: r.overdueNow.length ? 'bad' : 'good' }],
        ['Priority 1 fixes open now', p1Open, { tone: p1Open ? 'bad' : 'good' }]] },
      { heading: 'Grade bands', rows: GRADE_ROWS },
      { heading: 'Priorities', rows: PRIORITY_ROWS },
      ...(state.type !== 'maintenance' ? [{ heading: 'Note', rows: [['Different checklists', CHECKLIST_NOTE]] }] : []),
    ] });
    xk.table('Audits', { title: 'Audits in this period', subtitle: sub,
      head: ['Date', 'Unit', 'City', 'Unit type', 'Audit', 'Visit', 'Auditor', 'Time', 'Time taken (min)', 'Score (%)', 'Grade', 'Earned', 'Possible', 'Fixes raised', 'Data note'],
      rows: r.audits.map((a) => [a.audit_date, a.site_name, a.site_city, unitType(a), R.DOMAINS[a.domain].label, a.visit, a.auditor || '', R.auditTimeRange(a), R.auditMinutes(a) ?? '', n1(a.score), R.bandLabel(a.band), a.earned, a.possible, a.findings_count, a.flag || '']),
      widths: [13, 26, 12, 16, 14, 7, 16, 20, 10, 10, 20, 9, 9, 9, 44] });
    if (r.unitRows) {
      xk.table('Units', { title: 'Where each unit stands', subtitle: `${sub} · latest score in the period, status today`,
        head: ['Unit', 'City', 'Unit type', ...r.domains.map((dm) => `${R.DOMAINS[dm].label} latest in period (%)`), 'Status now', 'Open fixes', 'P1 open', 'Overdue'],
        rows: r.unitRows.map((u) => [u.u.name, u.u.city, unitType(u.u), ...r.domains.map((dm) => n1(u.latest[dm]?.score)), R.LEVELS[u.u.status.overall].label, u.open, u.p1, u.overdue]),
        widths: [26, 12, 16, ...r.domains.map(() => 16), 20, 10, 9, 9] });
    }
    xk.table('Open fixes', { title: 'Open fixes', subtitle: `${sub} · Priority 1 first, then by due date`,
      head: ['Fix #', 'Priority', 'Fix', 'Unit', 'City', 'Audit', 'Area', 'Code', 'Kind', 'Found', 'Due date', 'Days overdue', 'Status', 'Assigned to', 'Marks to win back', 'Repeat'],
      rows: r.openNow.map((f) => [f.id, R.PRIORITY[f.priority].label, f.title, f.site_name, f.site_city, R.DOMAINS[f.domain].label, f.item_area || '', f.item_code || '', R.KINDS[f.kind]?.label || f.kind || '',
        f.audit_date || '', f.due_date, f.due_date < today ? R.daysBetween(f.due_date, today) : '', fixStatusText(f).replace(/ \(.*\)$/, ''), f.owner || '', f.marks, f.is_repeat ? 'Yes' : '']),
      widths: [7, 12, 54, 24, 12, 13, 20, 7, 12, 13, 13, 10, 20, 16, 10, 8] });
    if (state.type === 'combined') {
      xk.table('Licences', { title: 'Licences', subtitle: sub,
        head: ['Licence', 'Unit', 'City', 'Number', 'Issued by', 'Issued on', 'Expires on', 'Status', 'Detail'],
        rows: [...r.licences.map((l) => [l.type, l.site_name, l.site_city, l.number || '', l.authority || '', l.issued_on || '', l.expires_on || '', l.st.label, l.st.text]),
          ...r.missing.flatMap((m) => m.types.map((t) => [t, m.u.name, m.u.city, '', '', '', '', 'Not added', '']))],
        widths: [40, 24, 12, 18, 20, 13, 13, 15, 28] });
    }
    return xk.save(`${r.fileBase}.xlsx`);
  };

  // ---------------------------------------------------------------- form
  const genLabel = () => html`${icon(state.format === 'pdf' ? 'picture_as_pdf' : 'table_view')}Generate ${state.format === 'pdf' ? 'PDF' : 'Excel'}`;
  const formHtml = () => html`<section class="card form no-print" aria-label="Generate report">
    <div class="section-head" style="margin:0"><h2>Generate report</h2></div>
    <div class="field"><span class="label">Report type</span>${segmented({ name: 'type', value: state.type, label: 'Report type', options: TYPES, fill: true })}</div>
    <div class="form-2">
      <div class="field"><label for="rUnit">Unit</label><select class="input" id="rUnit" data-change="unit"><option value="">All units</option>${units.map((s) => html`<option value="${s.id}" ${String(s.id) === state.unit ? 'selected' : ''}>${unitName(s)}</option>`)}</select></div>
      <div class="field"><span class="label">Period</span>${segmented({ name: 'period', value: state.period, label: 'Period', options: PERIODS })}</div>
    </div>
    <div id="periodInputs">${periodInputs()}</div>
    <div class="field"><span class="label">Format</span>${segmented({ name: 'format', value: state.format, label: 'Format', options: FORMATS, fill: true })}
      <span class="hint" id="fmtHint">${state.format === 'pdf' ? 'A4 document with summary, colour-coded tables and page numbers. Ready to share or print.' : 'Spreadsheet with one sheet per table (Summary, Audits, Units, Open fixes, Licences) and filters on every column.'}</span></div>
    <div><button class="btn primary lg" data-click="generate" id="genBtn">${genLabel()}</button></div>
  </section>`;
  const sync = (run) => {
    const q = new URLSearchParams(Object.entries(state).filter(([k, v]) => v && (k !== 'date' || ['daily', 'weekly'].includes(state.period)) && (k !== 'month' || state.period === 'monthly') && (!['from', 'to'].includes(k) || state.period === 'custom')));
    if (run) q.set('run', '1');
    history.replaceState(null, '', `#/reports?${q}`);
  };
  mount({
    title: 'Reports',
    body: html`
      ${pageHeader({ title: 'Reports', sub: 'Choose what to include and the format, then generate. The file downloads to this device.' })}
      <div class="stack-lg"><div id="repForm">${formHtml()}</div>
        <div id="report">${query.get('run') ? preview(build()) : html`<div class="card no-print">${emptyState({ iconName: 'summarize', title: 'No report generated yet', text: 'Pick a report type, unit, period and format above, then generate. A preview appears here as well.' })}</div>`}</div></div>`,
  });
  const press = (name, el) => $$(`[data-click="${name}"]`, view).forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
  on.click = {
    type: (el) => { state.type = el.dataset.v; press('type', el); },
    period: (el) => { state.period = el.dataset.v; press('period', el); $('#periodInputs').innerHTML = part(periodInputs()); },
    format: (el) => {
      state.format = el.dataset.v; press('format', el);
      $('#genBtn').innerHTML = part(genLabel());
      $('#fmtHint').textContent = state.format === 'pdf' ? 'A4 document with summary, colour-coded tables and page numbers. Ready to share or print.' : 'Spreadsheet with one sheet per table (Summary, Audits, Units, Open fixes, Licences) and filters on every column.';
    },
    generate: async (btn) => {
      const r = build();
      sync(true);
      btn.disabled = true;
      btn.innerHTML = part(html`${icon('hourglass_top')}Generating…`);
      try {
        const name = state.format === 'pdf' ? await makePdf(r) : await makeExcel(r);
        $('#report').innerHTML = part(preview(r, html`Downloaded <b>${name}</b>. Preview below.`));
        toast(`${state.format === 'pdf' ? 'PDF' : 'Excel file'} downloaded`, { success: true });
      } catch (e) {
        $('#report').innerHTML = part(preview(r));
        toast(friendly(e), { error: true });
      } finally { btn.disabled = false; btn.innerHTML = part(genLabel()); }
    },
  };
  on.change = Object.fromEntries(['unit', 'date', 'month', 'from', 'to'].map((k) => [k, (el) => { state[k] = k === 'unit' ? el.value : el.value || state[k]; }]));
}

// =================================================================== page: settings
/** A username suggested from a name: "Ravi Shah" → "ravi.shah". */
const suggestUsername = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 40);
const USERNAME_OK = /^[a-z0-9._-]{3,40}$/;
const passwordFields = (id, label = 'Password') => html`
  <div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" name="password" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters.</span></div>
  <div class="field"><label for="${id}2">Confirm password</label><input class="input" id="${id}2" name="again" type="password" autocomplete="new-password" required></div>
  <label class="check"><input type="checkbox" data-change="showPw"> Show passwords</label>`;
const showPw = (el) => { $$('input[name="password"], input[name="again"]', dlg).forEach((i) => { i.type = el.checked ? 'text' : 'password'; }); };
/** Checks a new password and its confirmation; returns an error message, or null when they are fine. */
const passwordProblem = (fd) => {
  const p = fd.get('password') || '';
  if (p.length < 8) return 'The password needs at least 8 characters.';
  if (p !== fd.get('again')) return 'The two passwords do not match.';
  return null;
};

/**
 * Add a person (Name, Username, Role (+ Unit), Password, Confirm password), or edit one.
 * The password the Compliance Head sets is the person's password. firstAdmin: creating the first Compliance Head
 * from a team-code session. preset: { role, site_id } for "Add unit manager" on a unit page.
 */
function openPersonDialog(u = null, { firstAdmin = false, onDone, units = [], preset = {} }) {
  const role0 = u?.role || preset.role || 'manager';
  const site0 = u?.site_id ?? preset.site_id ?? '';
  let usernameTouched = false;
  openDialog({
    title: firstAdmin ? 'Create the Compliance Head' : u ? `Edit ${u.name}` : preset.role === 'manager' ? 'Add unit manager' : 'Add a person',
    body: html`<div class="form">
      ${firstAdmin ? html`<div class="banner info">${icon('shield_person')}<span class="b-body">The Compliance Head has full access and adds everyone else.</span></div>` : ''}
      <div class="field"><label for="peName">Name</label><input class="input" id="peName" name="name" required maxlength="80" value="${u?.name || ''}" autocomplete="off" data-input="name"></div>
      ${u ? html`<div class="field"><span class="label">Username</span><span class="mono">${u.username}</span></div>`
        : html`<div class="field"><label for="peUser">Username</label><input class="input mono" id="peUser" name="username" required maxlength="40" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" data-input="username"><span class="hint">They sign in with this. Letters, numbers, dots, _ or -.</span></div>`}
      ${firstAdmin ? '' : html`<div class="field"><label for="peRole">Role</label><select class="input" id="peRole" name="role" data-change="role">
          <option value="manager" ${role0 === 'manager' ? 'selected' : ''}>Unit Manager: their own unit only</option>
          <option value="head" ${role0 === 'head' ? 'selected' : ''}>Compliance Head: full access</option></select></div>
        <div class="field" id="peUnitWrap" ${role0 === 'manager' ? '' : 'hidden'}><label for="peUnit">Unit</label><select class="input" id="peUnit" name="site_id">
          <option value="">Choose the unit…</option>${units.map((x) => html`<option value="${x.id}" ${String(x.id) === String(site0) ? 'selected' : ''}>${unitName(x)}</option>`)}</select></div>`}
      ${u ? html`<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Can sign in <span class="muted small">(untick to disable this account)</span></label>` : passwordFields('pePass')}
      <div class="error-text" id="peErr" hidden></div>
    </div>`,
    actions: html`<button class="btn" type="button" data-click="close">Cancel</button><button class="btn primary" value="save">${u ? 'Save changes' : 'Create'}</button>`,
    on: {
      change: { role: (el) => { $('#peUnitWrap', dlg).hidden = el.value !== 'manager'; }, showPw },
      input: {
        name: (el) => { const f = $('#peUser', dlg); if (f && !usernameTouched) f.value = suggestUsername(el.value); },
        username: () => { usernameTouched = true; },
      },
    },
    onSubmit: async (fd) => {
      const err = $('#peErr', dlg);
      const show = (m) => { err.hidden = false; err.textContent = m; };
      const name = (fd.get('name') || '').trim();
      const role = firstAdmin ? 'head' : fd.get('role');
      const siteId = role === 'manager' ? +fd.get('site_id') || null : null;
      if (!name) return show('Enter their name.');
      if (role === 'manager' && !siteId) { $('#peUnit', dlg).classList.add('invalid'); return show('Choose the unit this manager looks after.'); }
      try {
        if (u) {
          await api(`/api/users/${u.id}`, { method: 'PUT', body: { name, role, site_id: siteId, active: fd.get('active') === 'on' } });
          closeDialog(); toast('Changes saved', { success: true }); onDone?.();
          return;
        }
        const username = (fd.get('username') || '').trim().toLowerCase();
        if (!USERNAME_OK.test(username)) return show('Usernames need 3–40 letters or numbers (dots, _ and - are fine, no spaces).');
        const bad = passwordProblem(fd);
        if (bad) return show(bad);
        await api('/api/users', { method: 'POST', body: { name, username, role, site_id: siteId, password: fd.get('password') } });
        closeDialog();
        toast(`${name} created. They sign in with username “${username}” and the password you set.`, { success: true, ms: 8000 });
        onDone?.();
      } catch (e) { if (!(e instanceof SignInNeeded)) show(friendly(e)); }
    },
  });
}
function openResetDialog(u, onDone) {
  openDialog({
    title: `New password for ${u.name}`,
    body: html`<div class="form"><p class="muted">Set a new password for <b>${u.name}</b> (username <span class="mono">${u.username}</span>) and tell them.</p>
      ${passwordFields('rpPass', 'New password')}
      <div class="error-text" id="rpErr" hidden></div></div>`,
    actions: html`<button class="btn" type="button" data-click="close">Cancel</button><button class="btn primary" value="save">Save password</button>`,
    on: { change: { showPw } },
    onSubmit: async (fd) => {
      const err = $('#rpErr', dlg);
      const bad = passwordProblem(fd);
      if (bad) { err.hidden = false; err.textContent = bad; return; }
      try { await api(`/api/users/${u.id}/password`, { method: 'POST', body: { password: fd.get('password') } }); }
      catch (e) { if (!(e instanceof SignInNeeded)) { err.hidden = false; err.textContent = friendly(e); } return; }
      closeDialog(); toast(`New password saved for ${u.name}`, { success: true }); onDone?.();
    },
  });
}

async function pageSettings({ token }) {
  const me = app.me = await api('/api/me');
  const manage = me.canManageUsers && !me.firstAdminSetup;
  const seeLog = !isManager();
  const [sites, people, log] = await Promise.all([api('/api/sites'), manage ? api('/api/users') : Promise.resolve({ users: [] }), seeLog ? api('/api/activity?limit=300') : Promise.resolve({ activity: [] })]);
  if (stale(token)) return;
  const draft = loadDraft();
  const draftUnit = draft && sites.units.find((u) => u.id === draft.site_id);
  const theme = document.documentElement.dataset.theme || 'system';
  const personRow = (u) => html`<div class="list-row person">
    <span class="avatar">${(u.name || '?').trim()[0]}</span>
    <span class="lr-body"><span class="lr-title">${u.name}${u.username === me.username ? html` <span class="muted small">(you)</span>` : ''}</span>
      <span class="lr-meta"><span class="mono">${u.username}</span>${toneBadge(u.role === 'head' ? 'info' : 'neutral', ROLE_LABEL[u.role])}${u.role === 'manager' ? html`<span>${icon('storefront')} ${u.site_name ? unitName({ name: u.site_name, city: u.site_city, kind: u.site_kind }) : 'No unit set'}</span>` : ''}
        ${!u.active ? toneBadge('neutral', 'Disabled', 'block') : u.must_change ? toneBadge('warn', 'Temporary password') : ''}
        <span>${u.last_login_at ? `Last signed in ${ago(u.last_login_at)}` : 'Never signed in'}</span></span></span>
    <span class="lr-trail"><button class="btn sm" data-click="editPerson" data-id="${u.id}">${icon('edit')}Edit</button><button class="btn sm" data-click="resetPerson" data-id="${u.id}">${icon('key')}New password</button></span>
  </div>`;
  // ---- audit log: who did what, when
  const LOG_TYPES = [['', 'Everything'], ['finding', 'Fixes'], ['audit', 'Audits'], ['licence', 'Licences'], ['site', 'Units'], ['user', 'People']];
  const LOG_ICON = { finding: 'construction', audit: 'fact_check', licence: 'verified', site: 'storefront', user: 'person' };
  const LOG_HREF = { finding: 'fixes', audit: 'audits', licence: 'licences', site: 'units' };
  const logState = { q: '', type: '', shown: 25 };
  const when = (ts) => new Date(ts.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const logRows = () => {
    const words = logState.q.toLowerCase().split(/\s+/).filter(Boolean);
    return log.activity.filter((e) => (!logState.type || e.entity === logState.type)
      && words.every((w) => `${e.actor || ''} ${e.detail || ''} ${e.finding_title || ''} ${e.site_name || ''} ${e.site_city || ''} ${e.action}`.toLowerCase().includes(w)));
  };
  const LOG_TYPE_LABEL = { finding: 'Fix', audit: 'Audit', licence: 'Licence', site: 'Unit', user: 'Person' };
  const logHref = (e) => (LOG_HREF[e.entity] && e.entity_id && !(e.entity === 'licence' && e.action === 'removed') ? `#/${LOG_HREF[e.entity]}/${e.entity_id}` : null);
  const logEntry = (e) => html`<button type="button" class="list-row log-row" data-click="logOpen" data-id="${e.id}"><span class="lead-icon tone-neutral">${icon(LOG_ICON[e.entity] || 'history')}</span>
      <span class="lr-body"><span class="small">${e.finding_title ? html`<b>${e.finding_title}</b>: ` : ''}${e.detail || `${e.entity} ${e.action}`}</span>
        <span class="lr-meta"><span>${icon('person')} ${e.actor || 'System'}</span>${e.site_name ? html`<span>${icon('storefront')} ${unitName({ name: e.site_name, city: e.site_city, kind: e.site_kind })}</span>` : ''}<span title="${when(e.at)}">${when(e.at)} · ${ago(e.at)}</span></span></span>
      <span class="chev">${icon('chevron_right')}</span></button>`;
  /** The linked audit or fix as it stands now, loaded when an entry is opened. */
  const logRecord = async (e) => {
    if (e.entity === 'audit') {
      const { audit: a } = await api(`/api/audits/${e.entity_id}`);
      return html`<div class="facts">
        <div class="fact"><div class="k">Audit</div><div class="v">${R.DOMAINS[a.domain].label}, visit ${a.visit} of ${a.visits}</div></div>
        <div class="fact"><div class="k">Audit date</div><div class="v">${fmt(a.audit_date, true)}</div></div>
        <div class="fact"><div class="k">Score now</div><div class="v">${pct(a.score)} ${statusBadge(a.band)}</div></div>
        <div class="fact"><div class="k">Auditor</div><div class="v">${a.auditor || '—'}</div></div></div>`;
    }
    if (e.entity === 'finding') {
      const { finding: f, history, today } = await api(`/api/findings/${e.entity_id}`);
      const fixStatusText = (x) => (isOverdue(x, today) ? `Overdue (${R.plural(R.daysBetween(x.due_date, today), 'day')})` : FIX_STATUS[x.status][1]);
      return html`<div class="facts">
        <div class="fact"><div class="k">Priority</div><div class="v">${R.PRIORITY[f.priority].label}</div></div>
        <div class="fact"><div class="k">Status now</div><div class="v">${fixStatusText(f)}</div></div>
        <div class="fact"><div class="k">Assigned to</div><div class="v">${f.owner || '—'}</div></div>
        <div class="fact"><div class="k">Due</div><div class="v">${fmt(f.due_date, true)}</div></div></div>
        ${history.length > 1 ? html`<div class="stack" style="gap:6px"><b class="small">Full history of this fix</b>
          <div class="list log-history">${history.map((h) => html`<div class="list-row${h.id === e.id ? ' current' : ''}"><span class="lr-body"><span class="small">${h.detail || h.action}</span>
            <span class="lr-meta"><span>${icon('person')} ${h.actor || 'System'}</span><span>${when(h.at)}</span></span></span></div>`)}</div></div>` : ''}`;
    }
    return '';
  };
  const openLogEntry = (e) => {
    const href = logHref(e);
    const linked = (e.entity === 'audit' || e.entity === 'finding') && e.entity_id;
    openDialog({
      title: e.finding_title || `${LOG_TYPE_LABEL[e.entity] || 'Entry'} ${e.action}`,
      body: html`<div class="stack">
        <p>${e.detail || `${e.entity} ${e.action}`}</p>
        <div class="facts">
          <div class="fact"><div class="k">What</div><div class="v">${LOG_TYPE_LABEL[e.entity] || e.entity} ${e.action}</div></div>
          <div class="fact"><div class="k">By</div><div class="v">${e.actor || 'System'}</div></div>
          <div class="fact"><div class="k">When</div><div class="v">${when(e.at)}<br><span class="small muted">${ago(e.at)}</span></div></div>
          ${e.site_name ? html`<div class="fact"><div class="k">Unit</div><div class="v">${unitName({ name: e.site_name, city: e.site_city, kind: e.site_kind })}</div></div>` : ''}
        </div>
        ${linked ? html`<div id="logRecord" style="padding-top:12px;border-top:1px solid var(--border)"><p class="small muted">Loading the current details…</p></div>` : ''}
      </div>`,
      actions: html`<button class="btn" type="button" data-click="close">Close</button>${href ? html`<a class="btn primary" href="${href}" data-click="close">Open ${(LOG_TYPE_LABEL[e.entity] || '').toLowerCase()}</a>` : ''}`,
    });
    if (linked) {
      logRecord(e).then((body) => { const el = $('#logRecord', dlg); if (el) el.innerHTML = part(body); })
        .catch(() => { const el = $('#logRecord', dlg); if (el) el.innerHTML = part(html`<p class="small muted">This ${(LOG_TYPE_LABEL[e.entity] || 'item').toLowerCase()} is no longer available.</p>`); });
    }
  };
  const logList = () => {
    const rs = logRows();
    if (!rs.length) return emptyState({ compact: true, iconName: 'history', title: log.activity.length ? 'Nothing matches' : 'Nothing recorded yet', text: log.activity.length ? 'Try other words, or Everything.' : 'Audits, fix updates, licence and unit changes and new people appear here.' });
    return html`<div class="list">${rs.slice(0, logState.shown).map(logEntry)}</div>${rs.length > logState.shown ? html`<button class="dt-more" data-click="logMore">Show more (${rs.length - logState.shown} older)</button>` : ''}`;
  };
  const logSection = () => html`<section class="card flush" id="auditLog">
    <div class="section-head"><h2>Audit log</h2><span class="count">${log.activity.length}</span>
      <span class="sub">Who did what, and when: audits, fix updates and reviews, licences, units and people. Only the Compliance Head sees this. Newest first${log.activity.length >= 300 ? ', last 300 entries' : ''}.</span></div>
    <div class="filterbar log-filters">${searchBar({ name: 'logQ', placeholder: 'Search the log: person, unit, fix…' })}${selectFilter({ name: 'logType', value: '', label: 'Type', options: LOG_TYPES })}</div>
    <div id="logList">${logList()}</div>
  </section>`;
  const teamSection = () => {
    if (!me.accountsReady) return '';
    if (me.firstAdminSetup && me.canManageUsers) {
      return html`<section class="card stack"><div class="section-head" style="margin:0"><h2>Team members</h2><span class="sub">Personal accounts: each person signs in with their own username and password.</span></div>
        <div class="banner info">${icon('shield_person')}<span class="b-body">There is no Compliance Head account yet. Create it first; the Compliance Head then adds a Unit Manager for each unit. The team access code keeps working.</span></div>
        <div><button class="btn primary" data-click="firstAdmin">${icon('person_add')}Create the Compliance Head</button></div></section>`;
    }
    if (!manage) {
      return html`<section class="card stack"><div class="section-head" style="margin:0"><h2>Team members</h2></div>
        <p class="small muted">Only the Compliance Head can add people or change accounts.</p></section>`;
    }
    return html`<section class="card flush"><div class="section-head"><h2>Team members</h2><span class="count">${people.users.length}</span><span class="spacer"></span>
        <button class="btn primary sm" data-click="addPerson">${icon('person_add')}Add person</button>
        <span class="sub">Compliance Head: full access. Unit Manager: their own unit only. Each person signs in with their own username and password.</span></div>
      <div class="list">${people.users.map(personRow)}</div></section>`;
  };
  mount({
    title: 'Settings',
    body: html`
      ${pageHeader({ title: 'Settings', sub: 'Your account, team members, this device, units and the compliance rules.' })}
      <div class="stack" style="max-width:860px">
        <section class="card stack">
          <div class="section-head" style="margin:0"><h2>Account</h2></div>
          <div class="row" style="gap:12px"><span class="avatar">${(me.name || '?').trim()[0] || '?'}</span>
            <span style="flex:1;min-width:200px"><b>${me.name}</b> ${toneBadge(me.role === 'head' ? 'info' : 'neutral', ROLE_LABEL[me.role] || 'Team access')}${me.unit ? html` <span class="small muted">${icon('storefront')} ${unitName(me.unit)}</span>` : ''}<br>
              <span class="small muted">${me.username ? `Signed in as ${me.username}.` : 'Signed in with the shared team access code.'} Your name is recorded on every audit and change you make.</span></span>
            ${me.username ? html`<button class="btn" data-click="changePw">${icon('key')}Change password</button>` : ''}
            <button class="btn" data-click="signout">${icon('logout')}Sign out</button></div>
        </section>
        ${teamSection()}
        ${seeLog ? logSection() : ''}
        <section class="card stack">
          <div class="section-head" style="margin:0"><h2>Appearance</h2><span class="sub">Saved on this device.</span></div>
          ${segmented({ name: 'theme', value: theme, label: 'Theme', options: [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']] })}
        </section>
        <section class="card stack">
          <div class="section-head" style="margin:0"><h2>Audit draft on this device</h2><span class="sub">Audits in progress are saved on the phone or computer they were started on.</span></div>
          ${draft && draftUnit && draft.domain ? html`<div class="row"><span style="flex:1">${R.DOMAINS[draft.domain].label} audit for <b>${unitName(draftUnit)}</b> · ${R.plural(Object.values(draft.answers || {}).filter((a) => a.result).length, 'rating')}</span>
            <a class="btn primary" href="#/audits/new">Continue</a><button class="btn danger" data-click="discard">Discard</button></div>`
            : html`<p class="small muted">No unfinished audit on this device.</p>`}
        </section>
        <section class="card stack">
          <div class="section-head" style="margin:0"><h2>Units</h2><span class="sub">${R.plural(sites.units.length, 'active unit')}. Edit or archive a unit from its page.</span></div>
          <div class="row">${isManager() ? html`<a class="btn" href="#/units">${icon('storefront')}Open my unit</a>` : html`<a class="btn" href="#/units">${icon('storefront')}Manage units</a><button class="btn" data-click="addUnit">${icon('add')}Add unit</button>`}</div>
        </section>
        <section class="card stack">
          <div class="section-head" style="margin:0"><h2>Framework &amp; rules</h2><span class="sub">How compliance is measured: grade bands, marking, priorities, roles, escalation and the checklists.</span></div>
          <div><a class="btn" href="#/framework">${icon('menu_book')}Open framework</a></div>
        </section>
      </div>`,
  });
  const person = (el) => people.users.find((u) => u.id === +el.dataset.id);
  on.click = {
    signout: () => signOut(),
    changePw: () => openPasswordDialog(),
    firstAdmin: () => openPersonDialog(null, { firstAdmin: true, onDone: () => { toast('Compliance Head created. Sign out, then sign in with that username to add unit managers.', { success: true, ms: 9000 }); rerender(); } }),
    addPerson: () => openPersonDialog(null, { units: sites.units, onDone: () => rerender() }),
    editPerson: (el) => openPersonDialog(person(el), { units: sites.units, onDone: () => rerender() }),
    resetPerson: (el) => openResetDialog(person(el), () => rerender()),
    addUnit: () => openUnitDialog(),
    logOpen: (el) => { const e = log.activity.find((x) => x.id === +el.dataset.id); if (e) openLogEntry(e); },
    logMore: () => { logState.shown += 50; $('#logList').innerHTML = part(logList()); },
    theme: (el) => {
      const t = el.dataset.v;
      if (t === 'system') { delete document.documentElement.dataset.theme; localStorageDel('bk-theme'); } else { document.documentElement.dataset.theme = t; localStorageSet('bk-theme', t); }
      $$('[data-click="theme"]', view).forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    },
    discard: async () => {
      const ok = await confirmDialog({ title: 'Discard this draft?', text: 'All ratings, remarks and photos for this audit are removed from this device.', ok: 'Discard', danger: true });
      if (!ok) return;
      dropLocalPhotos(Object.values(loadDraft()?.answers || {})); clearDraft(); toast('Draft discarded', { success: true }); rerender();
    },
  };
  on.input = { logQ: (el) => { logState.q = el.value; logState.shown = 25; $('#logList').innerHTML = part(logList()); } };
  on.change = { logType: (el) => { logState.type = el.value; logState.shown = 25; $('#logList').innerHTML = part(logList()); } };
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
      ${secs.map((s) => html`<h3 style="font-size:14px;margin:16px 0 4px">${s}</h3><div class="list">${t.items.filter((i) => i.section === s).map((i) => html`<div class="list-row" style="padding-left:0;padding-right:0;min-height:0;align-items:flex-start">
        <span class="small muted num" style="width:44px;flex:none">${i.code}</span><span class="lr-body"><span class="small">${i.text}</span>${i.area && i.area !== s ? html`<span class="lr-meta">${i.area}${i.applies !== 'Both' ? ` · ${i.applies} only` : ''}</span>` : ''}</span>${star(i.critical)}${i.criticality ? html`<span class="small muted">${i.criticality}</span>` : html`<span class="small muted num">${i.weight}</span>`}</div>`)}</div>`)}`;
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
    title: 'Framework',
    body: html`
      ${pageHeader({ title: 'Framework & rules', crumb: { href: '#/settings', label: 'Settings' }, sub: 'Every unit at 80% (Satisfactory), then 90% (Exemplar). Every gap fixed with proof.' })}
      <div class="stack-lg">
        <p class="muted">These are the marking rules and grade bands used in Vishal Patel’s audit reports. The dashboard scores with the same code this page is built from.</p>
        <section class="stack"><h2 style="font-size:18px">1 · The grade bands</h2>
          <div class="band-demo" role="img" aria-label="Below 50 Non-Compliance, 50 to 79 Needs Improvement, 80 to 89 Satisfactory, 90 and above Exemplar">
            <div class="badge tone-bad" style="border-radius:0;height:auto">Below 50%: Non-Compliance</div><div class="badge tone-warn" style="border-radius:0;height:auto">50–79%: Needs Improvement</div><div class="badge tone-good" style="border-radius:0;height:auto">80–89%</div><div class="badge tone-good" style="border-radius:0;height:auto;filter:saturate(1.4)">90%+</div></div>
          <div class="def-grid four">${['exemplar', 'satisfactory', 'improve', 'noncompliance'].map((k) => html`<div class="card stack" style="gap:8px">${statusBadge(k)}<p class="small">${bandText[k]}</p></div>`)}</div>
          <p class="small muted">A unit gets a band for food safety and for maintenance. Its overall status is the lower of the two, always shown with the reason.</p></section>

        <section class="stack"><h2 style="font-size:18px">2 · Marking</h2>
          <div class="def-grid three">${['fssai2', 'docket', 'fssai1'].map((k) => html`<div class="card stack" style="gap:8px"><b>${R.SCHEMES[k].name}</b><div class="row">${['pass', 'partial', 'fail', 'na'].map((r) => ratingChip(k, r))}</div><p class="small muted">${R.SCHEMES[k].marking}</p>${k === 'fssai1' ? html`<p class="small muted">Used for the first visits in Aug 2026.</p>` : ''}</div>`)}</div></section>

        <section class="stack"><h2 style="font-size:18px">3 · Priorities for fixing</h2>
          <div class="card flush"><div class="table-wrap"><table class="table"><thead><tr><th>Priority</th><th>What it is</th><th>Fix within</th></tr></thead>
            <tbody>${R.PRIORITY_ORDER.map((p) => html`<tr><td class="nowrap">${prioBadge(p)} ${R.PRIORITY[p].label}</td><td>${R.PRIORITY[p].meaning}</td><td class="nowrap">${R.plural(R.PRIORITY[p].fixDays, 'day')}</td></tr>`)}</tbody></table></div></div>
          <p class="small muted">Within a priority: <b>paperwork first</b> (records, certificates, logs: the work is often done but not written down, so it closes in a week or two), then the fixes that win back the most marks.</p></section>

        <section class="stack"><h2 style="font-size:18px">4 · From audit to 80%</h2>
          <div class="steps">${steps.map(([t, s]) => html`<div class="step"><b>${t}</b><span>${s}</span></div>`)}</div>
          <div class="card prose small"><ul>
            <li><b>Route to 80%:</b> for each unit, the shortest ordered list of fixes that lifts the score to ${R.TARGET}%, Priority 1 first.</li>
            <li><b>Fix once:</b> a gap open at three or more units (pest-control records, water reports, FoSTaC) is solved centrally, not outlet by outlet.</li>
            <li>Rating a line Compliant at the next visit closes its fix automatically; still failing marks it a <b>repeat</b>.</li>
            <li>Every change (status, due date, owner, proof) is recorded with who and when.</li>
          </ul></div></section>

        <section class="stack"><h2 style="font-size:18px">5 · Who does what</h2>
          <div class="def-grid">${R.ROLES.map((r) => html`<div class="card stack" style="gap:6px"><b>${r.role}</b><span class="small muted">${r.who}</span><p class="small">${r.owns}</p></div>`)}</div></section>
        <section class="stack"><h2 style="font-size:18px">6 · Escalation</h2>
          <div class="card prose"><ol>${R.ESCALATION.map((e) => html`<li>${e}</li>`)}</ol></div></section>

        <section class="stack"><h2 style="font-size:18px">7 · The checklists</h2>
          <div class="card">
            <div style="margin-bottom:12px">${segmented({ name: 'tab', value: active, label: 'Checklist', options: templates.map((t) => [t.id, t.scheme === 'fssai2' ? 'Food safety' : t.scheme === 'docket' ? 'Maintenance' : 'Food (Aug)']) })}</div>
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
    const initial = (app.me.name || '?').trim()[0] || '?';
    $('#avatar').textContent = initial;
    $('#userName').textContent = app.me.name;
    $('#userRole').textContent = ROLE_LABEL[app.me.role] || 'Team access';
    const unitsNav = $('.nav-item[data-nav="units"]');
    const mine = isManager() && app.me.unit;
    unitsNav.href = mine ? `#/units/${app.me.unit.id}` : '#/units';
    unitsNav.title = mine ? 'My unit' : 'Units';
    $('span:not(.ms)', unitsNav).textContent = mine ? 'My unit' : 'Units';
    $('#signin').hidden = true;
    $('#app').hidden = false;
    router();
    syncOutbox();
    // keep the checklist and the unit list on the phone, so an audit can be started with no network
    if (!isManager()) Promise.all([getTemplates(), api('/api/sites')]).catch(() => {});
  } catch (e) {
    if (e instanceof SignInNeeded) return;
    $('#app').hidden = false;
    mount({ title: 'Offline', body: html`${pageHeader({ title: 'Could not connect' })}<div class="card">${emptyState({ iconName: 'cloud_off', tone: 'bad', title: 'Could not reach the server', text: friendly(e), action: html`<button class="btn primary" data-click="reload">${icon('refresh')}Reload</button>` })}</div>` });
    on.click = { reload: () => location.reload() };
  }
}
boot();
