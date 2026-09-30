import * as R from '../public/rules.js';

// ================================================================= plumbing
class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const bad = (msg) => { throw new HttpError(400, msg); };
const notFound = (what) => { throw new HttpError(404, `${what} not found`); };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s) => typeof s === 'string' && ISO_DATE.test(s);
const str = (v, max = 2000) => (v == null || v === '' ? null : String(v).trim().slice(0, max) || null);
const parseList = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Business "today" in the configured timezone (IST by default). */
function todayFor(env) {
  const offset = Number(env.TZ_OFFSET_MINUTES ?? 330);
  return new Date(Date.now() + offset * 60000).toISOString().slice(0, 10);
}

async function readJson(request) {
  let body;
  try { body = await request.json(); } catch { bad('Request body must be JSON'); }
  if (!body || typeof body !== 'object') bad('Request body must be a JSON object');
  return body;
}

function log(env, { actor, site_id = null, entity, entity_id = null, action, detail = null }) {
  return env.DB.prepare('INSERT INTO activity (actor, site_id, entity, entity_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(actor, site_id, entity, entity_id, action, detail);
}

// ================================================================= sign-in
// One shared access code (a Worker secret) plus the person's name. The session cookie is signed with the code,
// so changing the code signs everyone out. Cloudflare Access can replace this later without code changes elsewhere.
const COOKIE = 'bk_session';
const SESSION_DAYS = 30;
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}
async function readSession(request, env) {
  if (!env.ACCESS_CODE) return null;
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig || sig !== await hmac(env.ACCESS_CODE, payload)) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}
async function login({ env, request }) {
  if (!env.ACCESS_CODE) throw new HttpError(503, 'Sign-in is not set up yet. Set the ACCESS_CODE secret (see README).', { setup: true });
  if (env.LOGIN_LIMIT) {
    const { success } = await env.LOGIN_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
    if (!success) throw new HttpError(429, 'Too many sign-in attempts. Wait a minute, then try again.');
  }
  const body = await readJson(request);
  const name = str(body.name, 60);
  if (!name) bad('Enter your name');
  if (!(await sameSecret(String(body.code || ''), env.ACCESS_CODE))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    throw new HttpError(401, 'That access code is not right');
  }
  const payload = b64url(enc.encode(JSON.stringify({ name, exp: Date.now() + SESSION_DAYS * 864e5 })));
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json({ name }, 200, { 'set-cookie': `${COOKIE}=${payload}.${await hmac(env.ACCESS_CODE, payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}` });
}
function logout({ request }) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` });
}

// ================================================================= shared state
/** Everything the status rules need, in one round trip. Volumes are small (units × visits). */
async function loadState(env) {
  const [sites, audits, findings, licences] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM sites WHERE active = 1 ORDER BY city, name'),
    env.DB.prepare(`SELECT a.id, a.site_id, a.domain, a.audit_date, a.score, a.earned, a.possible, a.band, a.auditor, a.source, a.flag, t.scheme
      FROM audits a JOIN templates t ON t.id = a.template_id ORDER BY a.audit_date, a.id`),
    env.DB.prepare(`SELECT f.*, i.code AS item_code, i.area AS item_area, i.critical AS item_critical FROM findings f
      LEFT JOIN template_items i ON i.id = f.item_id WHERE f.status != 'closed' ORDER BY f.due_date`),
    env.DB.prepare('SELECT * FROM licences ORDER BY expires_on IS NULL, expires_on'),
  ]);
  const byUnit = new Map(); // site -> domain -> audits oldest first, with visit numbers
  for (const a of audits.results) {
    if (!byUnit.has(a.site_id)) byUnit.set(a.site_id, { food: [], maintenance: [] });
    const list = byUnit.get(a.site_id)[a.domain];
    list.push({ ...a, visit: list.length + 1 });
  }
  return { sites: sites.results, audits: audits.results, findings: findings.results, licences: licences.results, byUnit };
}
const unitAudits = (state, siteId) => state.byUnit.get(siteId) || { food: [], maintenance: [] };

function statusOf(state, siteId, today) {
  return R.siteStatus({
    auditsByDomain: unitAudits(state, siteId),
    findings: state.findings.filter((f) => f.site_id === siteId),
    licences: state.licences.filter((l) => l.site_id === siteId),
    today,
  });
}

/** Where the unit is, and the shortest list of fixes that gets it to 80%. */
function routeFor(latest, findings) {
  if (!latest) return null;
  const step = R.stepFor(latest.domain);
  const gaps = findings.filter((f) => f.audit_id === latest.id && R.UNRESOLVED.includes(f.status))
    .map((f) => ({ id: f.id, priority: f.priority, marks: f.marks, title: f.title, kind: f.kind, code: f.item_code, area: f.item_area }));
  const credited = findings.filter((f) => f.audit_id === latest.id && f.status === 'fixed').reduce((s, f) => s + f.marks, 0);
  const route = R.routeTo(R.TARGET, latest.earned, latest.possible, gaps, step);
  const p1Marks = gaps.filter((g) => g.priority === 'critical').reduce((s, g) => s + g.marks, 0);
  return {
    audit_id: latest.id, score: latest.score, earned: latest.earned, possible: latest.possible,
    needed: route.needed, reached: route.reached, steps: route.steps, open: gaps.length,
    afterP1: R.round1(((latest.earned + p1Marks) / latest.possible) * 100),
    pending: credited ? R.round1(((latest.earned + credited) / latest.possible) * 100) : null,
  };
}

function unitSummary(state, s, today) {
  const a = unitAudits(state, s.id);
  const findings = state.findings.filter((f) => f.site_id === s.id);
  const food = a.food, maint = a.maintenance;
  const first = food[0] || null, last = food.at(-1) || null;
  return {
    id: s.id, name: s.name, brand: s.brand, area: s.area, city: s.city, kind: s.kind,
    status: statusOf(state, s.id, today),
    food: {
      visits: food.map((x) => ({ id: x.id, visit: x.visit, date: x.audit_date, score: x.score, band: x.band, flag: x.flag })),
      first: first && first.score, latest: last && last.score, delta: first && last && food.length > 1 ? R.round1(last.score - first.score) : null,
      route: routeFor(last, findings.filter((f) => f.domain === 'food')),
    },
    maintenance: {
      latest: maint.at(-1) ? { id: maint.at(-1).id, date: maint.at(-1).audit_date, score: maint.at(-1).score, band: maint.at(-1).band } : null,
      route: routeFor(maint.at(-1), findings.filter((f) => f.domain === 'maintenance')),
    },
    open: {
      p1: findings.filter((f) => R.UNRESOLVED.includes(f.status) && f.priority === 'critical').length,
      total: findings.filter((f) => R.UNRESOLVED.includes(f.status)).length,
      fixed: findings.filter((f) => f.status === 'fixed').length,
    },
  };
}

/** The same problem open at several units: fix it once, centrally. */
function sharedProblems(state, units) {
  const groups = new Map();
  for (const f of state.findings) {
    if (!R.UNRESOLVED.includes(f.status) || !f.item_id) continue;
    const key = `${f.domain}:${f.item_area || ''}:${f.title}`;
    if (!groups.has(key)) groups.set(key, { key, domain: f.domain, area: f.item_area, title: f.title, code: f.item_code, kind: f.kind, priority: f.priority, marks: 0, units: [] });
    const g = groups.get(key);
    if (R.PRIORITY_ORDER.indexOf(f.priority) < R.PRIORITY_ORDER.indexOf(g.priority)) g.priority = f.priority;
    g.marks += f.marks;
    const u = units.find((x) => x.id === f.site_id);
    g.units.push({ site_id: f.site_id, name: u ? `${u.name}${u.kind === 'kitchen' ? `, ${u.city}` : ''}` : '', finding_id: f.id });
  }
  return [...groups.values()].sort((a, b) =>
    R.PRIORITY_ORDER.indexOf(a.priority) - R.PRIORITY_ORDER.indexOf(b.priority) || b.units.length - a.units.length || b.marks - a.marks);
}

// ================================================================= overview
async function overview({ env }) {
  const today = todayFor(env);
  const state = await loadState(env);
  const units = state.sites.map((s) => unitSummary(state, s, today));
  const avg = (xs) => (xs.length ? R.round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const twoVisits = units.filter((u) => u.food.visits.length > 1);
  const counts = Object.fromEntries(Object.keys(R.LEVELS).map((k) => [k, 0]));
  for (const u of units) counts[u.status.domains.food.level] += 1;
  const open = state.findings.filter((f) => R.UNRESOLVED.includes(f.status));
  const activity = await env.DB.prepare(`SELECT a.*, s.name AS site_name, s.city AS site_city, f.title AS finding_title FROM activity a
      LEFT JOIN sites s ON s.id = a.site_id LEFT JOIN findings f ON a.entity = 'finding' AND f.id = a.entity_id
      ORDER BY a.at DESC, a.id DESC LIMIT 8`).all();
  return json({
    today,
    units,
    counts,
    kpis: {
      food: {
        latestAvg: avg(units.map((u) => u.food.latest).filter((x) => x != null)),
        firstAvg: avg(twoVisits.map((u) => u.food.first)),
        secondAvg: avg(twoVisits.map((u) => u.food.latest)),
        compared: twoVisits.length,
        improved: twoVisits.filter((u) => u.food.delta > 0).length,
        atTarget: units.filter((u) => u.food.latest >= R.TARGET).length,
        audited: units.filter((u) => u.food.latest != null).length,
      },
      maintenance: {
        avg: avg(units.map((u) => u.maintenance.latest?.score).filter((x) => x != null)),
        audited: units.filter((u) => u.maintenance.latest).length,
        atTarget: units.filter((u) => u.maintenance.latest?.score >= R.TARGET).length,
      },
      fixes: {
        open: open.length,
        p1: open.filter((f) => f.priority === 'critical').length,
        p2: open.filter((f) => f.priority === 'major').length,
        p3: open.filter((f) => f.priority === 'minor').length,
        paperwork: open.filter((f) => f.kind === 'paperwork').length,
        overdue: open.filter((f) => f.due_date < today).length,
        awaiting: state.findings.filter((f) => f.status === 'fixed').length,
      },
    },
    shared: sharedProblems(state, units).filter((g) => g.units.length >= 3).slice(0, 12),
    activity: activity.results,
  });
}

// ================================================================= sites
const SITE_KINDS = ['restaurant', 'kitchen'];
function siteInput(body) {
  const name = str(body.name, 120);
  if (!name) bad('Unit name is required');
  return [name, str(body.brand, 60), str(body.area, 80), str(body.city, 80), SITE_KINDS.includes(body.kind) ? body.kind : 'restaurant',
    str(body.manager, 120), str(body.manager_phone, 30)];
}
async function listSites({ env }) {
  const today = todayFor(env);
  const state = await loadState(env);
  return json({ today, units: state.sites.map((s) => ({ ...s, ...unitSummary(state, s, today) })) });
}
async function createSite({ env, request, actor }) {
  const v = siteInput(await readJson(request));
  const row = await env.DB.prepare('INSERT INTO sites (name, brand, area, city, kind, manager, manager_phone) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id').bind(...v).first();
  await log(env, { actor, site_id: row.id, entity: 'site', entity_id: row.id, action: 'created', detail: `Unit added: ${v[0]}` }).run();
  return json({ id: row.id }, 201);
}
async function updateSite({ env, request, actor, params: [id] }) {
  const body = await readJson(request);
  const v = siteInput(body);
  const active = body.active === false || body.active === 0 ? 0 : 1;
  const res = await env.DB.prepare('UPDATE sites SET name = ?, brand = ?, area = ?, city = ?, kind = ?, manager = ?, manager_phone = ?, active = ? WHERE id = ?').bind(...v, active, id).run();
  if (!res.meta.changes) notFound('Unit');
  await log(env, { actor, site_id: +id, entity: 'site', entity_id: +id, action: active ? 'updated' : 'archived', detail: `${active ? 'Unit details updated' : 'Unit archived'}: ${v[0]}` }).run();
  return json({ ok: true });
}

async function sectionScores(env, auditIds) {
  if (!auditIds.length) return {};
  const rows = await env.DB.prepare(`SELECT r.audit_id, r.result, i.id, i.section, i.weight, i.critical FROM audit_responses r
    JOIN template_items i ON i.id = r.item_id WHERE r.audit_id IN (${auditIds.map(() => '?').join(',')}) ORDER BY i.sort`).bind(...auditIds).all();
  const out = {};
  for (const id of auditIds) {
    const mine = rows.results.filter((r) => r.audit_id === id);
    out[id] = R.scoreAudit(mine, Object.fromEntries(mine.map((r) => [r.id, r.result]))).sections;
  }
  return out;
}

async function getSite({ env, params: [id] }) {
  const today = todayFor(env);
  const site = await env.DB.prepare('SELECT * FROM sites WHERE id = ?').bind(id).first();
  if (!site) notFound('Unit');
  const state = await loadState(env);
  const a = unitAudits(state, site.id);
  const closed = await env.DB.prepare(`SELECT f.*, i.code AS item_code, i.area AS item_area FROM findings f LEFT JOIN template_items i ON i.id = f.item_id
    WHERE f.site_id = ? AND f.status = 'closed' ORDER BY f.closed_at DESC LIMIT 30`).bind(id).all();
  const allAudits = [...a.food, ...a.maintenance];
  return json({
    today, site,
    summary: unitSummary(state, site, today),
    audits: { food: a.food, maintenance: a.maintenance },
    sections: await sectionScores(env, allAudits.map((x) => x.id)),
    findings: state.findings.filter((f) => f.site_id === site.id),
    closedFindings: closed.results,
    licences: state.licences.filter((l) => l.site_id === site.id),
  });
}

// ================================================================= templates & audits
async function templateWithItems(env, t) {
  const items = await env.DB.prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort').bind(t.id).all();
  return { ...t, items: items.results };
}
async function activeTemplate(env, domain) {
  const t = await env.DB.prepare('SELECT * FROM templates WHERE domain = ? AND active = 1 ORDER BY version DESC LIMIT 1').bind(domain).first();
  if (!t) notFound('Checklist');
  return templateWithItems(env, t);
}
async function listTemplates({ env }) {
  const all = await env.DB.prepare('SELECT * FROM templates ORDER BY domain, active DESC, version DESC').all();
  return json({ templates: await Promise.all(all.results.map((t) => templateWithItems(env, t))) });
}
/** Lines a unit is audited on: restaurant-only lines are skipped at kitchens and kitchen (CPK) lines at restaurants. */
const appliesTo = (item, kind) => item.applies === 'Both' || (kind === 'kitchen' ? item.applies === 'CPK' : item.applies === 'Restaurant');

async function listAudits({ env, url }) {
  const state = await loadState(env);
  const site = url.searchParams.get('site'), domain = url.searchParams.get('domain');
  const names = new Map(state.sites.map((s) => [s.id, s]));
  const counts = await env.DB.prepare('SELECT audit_id, COUNT(*) AS n FROM findings WHERE audit_id IS NOT NULL GROUP BY audit_id').all();
  const nFind = new Map(counts.results.map((r) => [r.audit_id, r.n]));
  const rows = [];
  for (const [sid, d] of state.byUnit) {
    if (site && +site !== sid) continue;
    for (const dom of R.AUDIT_DOMAINS) {
      if (R.AUDIT_DOMAINS.includes(domain) && dom !== domain) continue;
      for (const x of d[dom]) {
        const s = names.get(sid);
        if (!s) continue;
        rows.push({ ...x, site_name: s.name, site_city: s.city, site_kind: s.kind, visits: d[dom].length, findings_count: nFind.get(x.id) || 0 });
      }
    }
  }
  rows.sort((a, b) => b.audit_date.localeCompare(a.audit_date) || b.id - a.id);
  return json({ audits: rows });
}

async function getAudit({ env, params: [id] }) {
  const audit = await env.DB.prepare(`SELECT a.*, s.name AS site_name, s.city AS site_city, s.kind AS site_kind, t.scheme, t.name AS template_name
    FROM audits a JOIN sites s ON s.id = a.site_id JOIN templates t ON t.id = a.template_id WHERE a.id = ?`).bind(id).first();
  if (!audit) notFound('Audit');
  const [items, responses, findings, siblings] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort').bind(audit.template_id),
    env.DB.prepare('SELECT * FROM audit_responses WHERE audit_id = ?').bind(id),
    env.DB.prepare('SELECT * FROM findings WHERE audit_id = ? ORDER BY id').bind(id),
    env.DB.prepare('SELECT id, audit_date, score FROM audits WHERE site_id = ? AND domain = ? ORDER BY audit_date, id').bind(audit.site_id, audit.domain),
  ]);
  const answered = new Map(responses.results.map((r) => [r.item_id, r]));
  const used = items.results.filter((i) => answered.has(i.id));
  const scored = R.scoreAudit(used, Object.fromEntries(responses.results.map((r) => [r.item_id, r.result])));
  const visit = siblings.results.findIndex((x) => x.id === +id) + 1;
  const prev = visit > 1 ? siblings.results[visit - 2] : null;
  const gaps = findings.results.filter((f) => f.status !== 'closed').map((f) => ({ id: f.id, priority: f.priority, marks: f.marks }));
  const na = responses.results.filter((r) => r.result === 'na').length;
  return json({
    audit: { ...audit, visit, visits: siblings.results.length, previous: prev },
    items: used, responses: responses.results.map((r) => ({ ...r, photos: parseList(r.photos) })),
    findings: findings.results.map((f) => ({ ...f, photos: parseList(f.photos) })), sections: scored.sections,
    route: R.routeTo(R.TARGET, audit.earned, audit.possible, gaps, R.stepFor(audit.domain)),
    counts: { pass: scored.answered - scored.fails - scored.partials - na, partial: scored.partials, fail: scored.fails, na, criticalFails: scored.criticalFails },
  });
}

async function createAudit({ env, request, actor }) {
  const today = todayFor(env);
  const body = await readJson(request);
  const domain = body.domain;
  if (!R.AUDIT_DOMAINS.includes(domain)) bad('Audit type must be food or maintenance');
  if (!isDate(body.audit_date)) bad('Audit date is required');
  if (body.audit_date > today) bad('Audit date cannot be in the future');
  const site = await env.DB.prepare('SELECT * FROM sites WHERE id = ? AND active = 1').bind(Number(body.site_id) || 0).first();
  if (!site) notFound('Unit');

  const template = await activeTemplate(env, domain);
  const labels = R.SCHEMES[template.scheme].ratings;
  const lines = template.items.filter((i) => appliesTo(i, site.kind));
  const answers = {}, notes = {}, photos = {};
  for (const a of Array.isArray(body.answers) ? body.answers : []) {
    if (!R.RESULTS.includes(a.result)) continue;
    answers[a.item_id] = a.result;
    notes[a.item_id] = str(a.note, 1000);
    photos[a.item_id] = (Array.isArray(a.photos) ? a.photos : []).filter((k) => typeof k === 'string' && k.startsWith('evidence/')).slice(0, 4);
  }
  const missing = lines.filter((i) => !answers[i.id]);
  if (missing.length) bad(`${R.plural(missing.length, 'line')} not rated (first: ${missing[0].code})`);
  const noRemark = lines.filter((i) => (answers[i.id] === 'fail' || answers[i.id] === 'partial') && !notes[i.id]);
  if (noRemark.length) bad(`Every ${labels.partial} or ${labels.fail} needs a remark (first: ${noRemark[0].code})`);

  const scored = R.scoreAudit(lines, answers);
  const audit = await env.DB.prepare(
    `INSERT INTO audits (site_id, template_id, domain, audit_date, auditor, prepared_by, audit_type, score, earned, possible, band, summary, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(site.id, template.id, domain, body.audit_date, str(body.auditor, 120) || actor, actor, str(body.audit_type, 60) || 'Surprise',
    scored.score, scored.earned, scored.possible, scored.band, str(body.summary, 4000), actor).first();

  // Repeat detection and auto-verification only when this is the unit's newest audit in the domain.
  const [prevAudit, unresolved] = await env.DB.batch([
    env.DB.prepare('SELECT id, audit_date FROM audits WHERE site_id = ? AND domain = ? AND id != ? ORDER BY audit_date DESC, id DESC LIMIT 1').bind(site.id, domain, audit.id),
    env.DB.prepare("SELECT * FROM findings WHERE site_id = ? AND domain = ? AND status != 'closed' AND item_id IS NOT NULL").bind(site.id, domain),
  ]);
  const prev = prevAudit.results[0];
  const isNewest = !prev || prev.audit_date <= body.audit_date;
  const prevGaps = new Set();
  if (prev) {
    const r = await env.DB.prepare("SELECT item_id FROM audit_responses WHERE audit_id = ? AND result IN ('fail', 'partial')").bind(prev.id).all();
    r.results.forEach((x) => prevGaps.add(x.item_id));
  }
  const openByItem = new Map(unresolved.results.map((f) => [f.item_id, f]));

  const stmts = [];
  let created = 0, repeats = 0, autoClosed = 0;
  for (const item of lines) {
    const result = answers[item.id];
    const pts = result === 'na' ? null : item.weight * R.POINTS[result];
    stmts.push(env.DB.prepare('INSERT INTO audit_responses (audit_id, item_id, result, points, note, photos) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(audit.id, item.id, result, pts, notes[item.id], photos[item.id].length ? JSON.stringify(photos[item.id]) : null));
    const existing = openByItem.get(item.id);
    const priority = R.priorityFor(item, result);
    if (existing && isNewest) {
      // The previous record is settled by this visit: verified if the line now passes, carried forward if not.
      if (result === 'pass') autoClosed += 1;
      const why = result === 'pass' ? `Verified: rated ${labels.pass}` : result === 'na' ? 'Closed: line rated N/A' : `Carried forward: still ${labels[result]}`;
      stmts.push(env.DB.prepare("UPDATE findings SET status = 'closed', closed_at = datetime('now'), closed_by = ?, close_note = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(actor, `${why} in audit #${audit.id} on ${R.fmtDate(body.audit_date, true)}`, existing.id));
    }
    if (!priority) continue;
    const isRepeat = isNewest && (prevGaps.has(item.id) || !!existing) ? 1 : 0;
    repeats += isRepeat; created += 1;
    stmts.push(env.DB.prepare(
      `INSERT INTO findings (site_id, audit_id, item_id, domain, title, detail, priority, rating, marks, kind, due_date, owner, photos, is_repeat)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(site.id, audit.id, item.id, domain, item.text, notes[item.id], priority, result, item.weight - pts, item.kind,
      R.addDays(body.audit_date, R.PRIORITY[priority].fixDays), existing?.owner || site.manager || null,
      photos[item.id].length ? JSON.stringify(photos[item.id]) : null, isRepeat));
  }
  stmts.push(log(env, { actor, site_id: site.id, entity: 'audit', entity_id: audit.id, action: 'submitted',
    detail: `${R.DOMAINS[domain].label} audit: ${R.fmtPct(scored.score)}, ${R.bandLabel(scored.band)}; ${R.plural(created, 'fix', 'fixes')} raised` }));
  await env.DB.batch(stmts);
  return json({ id: audit.id, score: scored.score, band: scored.band, created, repeats, autoClosed }, 201);
}

// ================================================================= findings (fix plan)
const FINDING_SELECT = `SELECT f.*, s.name AS site_name, s.city AS site_city, s.kind AS site_kind, i.code AS item_code, i.area AS item_area,
  i.guidance, i.critical AS item_critical, i.criticality, a.audit_date FROM findings f JOIN sites s ON s.id = f.site_id
  LEFT JOIN template_items i ON i.id = f.item_id LEFT JOIN audits a ON a.id = f.audit_id`;

async function listFindings({ env }) {
  const rows = await env.DB.prepare(`${FINDING_SELECT} WHERE s.active = 1 ORDER BY CASE f.status WHEN 'closed' THEN 1 ELSE 0 END, f.due_date LIMIT 3000`).all();
  return json({ today: todayFor(env), findings: rows.results.map((f) => ({ ...f, photos: parseList(f.photos) })) });
}

async function getFinding({ env, params: [id] }) {
  const f = await env.DB.prepare(`${FINDING_SELECT} WHERE f.id = ?`).bind(id).first();
  if (!f) notFound('Fix');
  const [history, audit] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM activity WHERE entity = 'finding' AND entity_id = ? ORDER BY id DESC").bind(id),
    env.DB.prepare('SELECT a.possible, t.scheme FROM audits a JOIN templates t ON t.id = a.template_id WHERE a.id = ?').bind(f.audit_id ?? -1),
  ]);
  const meta = audit.results[0] || {};
  return json({ today: todayFor(env), finding: { ...f, photos: parseList(f.photos), possible: meta.possible, scheme: meta.scheme }, history: history.results });
}

async function updateFinding({ env, request, actor, params: [id] }) {
  const f = await env.DB.prepare('SELECT * FROM findings WHERE id = ?').bind(id).first();
  if (!f) notFound('Fix');
  const body = await readJson(request);
  const next = {
    owner: body.owner !== undefined ? str(body.owner, 120) : f.owner,
    root_cause: body.root_cause !== undefined ? str(body.root_cause) : f.root_cause,
    action_taken: body.action_taken !== undefined ? str(body.action_taken) : f.action_taken,
    evidence_key: body.evidence_key !== undefined ? (typeof body.evidence_key === 'string' && body.evidence_key.startsWith('evidence/') ? body.evidence_key : null) : f.evidence_key,
    due_date: body.due_date !== undefined ? body.due_date : f.due_date,
    status: body.status || f.status,
    close_note: body.close_note !== undefined ? str(body.close_note) : f.close_note,
  };
  if (!R.FINDING_STATUS[next.status]) bad('Unknown status');
  if (!isDate(next.due_date)) bad('Due date must be a date');
  if (next.status === 'fixed' && !next.action_taken) bad('Describe what was done before marking it fixed');
  if (next.status === 'closed' && f.status !== 'closed' && !next.action_taken && !next.close_note) bad('Add what was done, or a closing note, before closing');

  let fixedAt = f.fixed_at, closedAt = f.closed_at, closedBy = f.closed_by;
  if (R.UNRESOLVED.includes(next.status)) { fixedAt = null; closedAt = null; closedBy = null; }
  if (next.status === 'closed' && f.status !== 'closed') closedBy = actor;

  const changes = [];
  if (next.status !== f.status) changes.push(`status ${R.FINDING_STATUS[f.status].label} → ${R.FINDING_STATUS[next.status].label}`);
  if (next.due_date !== f.due_date) changes.push(`due date ${R.fmtDate(f.due_date, true)} → ${R.fmtDate(next.due_date, true)}`);
  if (next.owner !== f.owner) changes.push(`owner → ${next.owner || 'nobody'}`);
  if (next.evidence_key !== f.evidence_key && next.evidence_key) changes.push('proof photo added');
  if (next.root_cause !== f.root_cause) changes.push('root cause updated');
  if (next.action_taken !== f.action_taken) changes.push('action updated');
  const note = str(body.note, 500);

  const becameFixed = next.status === 'fixed' && f.status !== 'fixed';
  const becameClosed = next.status === 'closed' && f.status !== 'closed';
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE findings SET owner = ?, root_cause = ?, action_taken = ?, evidence_key = ?, due_date = ?, status = ?, close_note = ?,
         fixed_at = CASE WHEN ? THEN datetime('now') ELSE ? END,
         closed_at = CASE WHEN ? THEN datetime('now') ELSE ? END,
         closed_by = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(next.owner, next.root_cause, next.action_taken, next.evidence_key, next.due_date, next.status, next.close_note,
      becameFixed || (becameClosed && !f.fixed_at) ? 1 : 0, fixedAt, becameClosed ? 1 : 0, closedAt, closedBy, id),
    log(env, { actor, site_id: f.site_id, entity: 'finding', entity_id: f.id, action: 'updated',
      detail: [changes.join('; ') || 'no change', note && `note: ${note}`].filter(Boolean).join(' · ') }),
  ]);
  return json({ ok: true });
}

// ================================================================= licences
function licenceInput(body) {
  const type = str(body.type, 120);
  if (!type) bad('Licence type is required');
  if (!Number.isInteger(+body.site_id)) bad('Unit is required');
  for (const k of ['issued_on', 'expires_on']) if (body[k] && !isDate(body[k])) bad(`${k} must be a date`);
  const severity = ['critical', 'major', 'minor'].includes(body.severity) ? body.severity : (R.LICENCE_TYPES.find((t) => t.type === type)?.severity || 'major');
  return [+body.site_id, type, str(body.number, 80), str(body.authority, 120), body.issued_on || null, body.expires_on || null, severity,
    typeof body.file_key === 'string' && body.file_key.startsWith('evidence/') ? body.file_key : null, str(body.notes)];
}
async function listLicences({ env }) {
  const rows = await env.DB.prepare('SELECT l.*, s.name AS site_name, s.city AS site_city FROM licences l JOIN sites s ON s.id = l.site_id WHERE s.active = 1 ORDER BY l.expires_on IS NULL, l.expires_on').all();
  return json({ today: todayFor(env), licences: rows.results });
}
async function createLicence({ env, request, actor }) {
  const v = licenceInput(await readJson(request));
  const row = await env.DB.prepare('INSERT INTO licences (site_id, type, number, authority, issued_on, expires_on, severity, file_key, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id').bind(...v).first();
  await log(env, { actor, site_id: v[0], entity: 'licence', entity_id: row.id, action: 'added', detail: `Licence added: ${v[1]}${v[5] ? `, expires ${R.fmtDate(v[5], true)}` : ''}` }).run();
  return json({ id: row.id }, 201);
}
async function updateLicence({ env, request, actor, params: [id] }) {
  const v = licenceInput(await readJson(request));
  const res = await env.DB.prepare("UPDATE licences SET site_id = ?, type = ?, number = ?, authority = ?, issued_on = ?, expires_on = ?, severity = ?, file_key = ?, notes = ?, updated_at = datetime('now') WHERE id = ?").bind(...v, id).run();
  if (!res.meta.changes) notFound('Licence');
  await log(env, { actor, site_id: v[0], entity: 'licence', entity_id: +id, action: 'updated', detail: `Licence updated: ${v[1]}${v[5] ? `, expires ${R.fmtDate(v[5], true)}` : ''}` }).run();
  return json({ ok: true });
}
async function deleteLicence({ env, actor, params: [id] }) {
  const l = await env.DB.prepare('SELECT * FROM licences WHERE id = ?').bind(id).first();
  if (!l) notFound('Licence');
  await env.DB.batch([env.DB.prepare('DELETE FROM licences WHERE id = ?').bind(id),
    log(env, { actor, site_id: l.site_id, entity: 'licence', entity_id: l.id, action: 'removed', detail: `Licence removed: ${l.type}` })]);
  return json({ ok: true });
}

// ================================================================= files (audit photos, proof of fixes, licence scans) in Workers KV
const UPLOAD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_UPLOAD = 8 * 1024 * 1024;
const FILE_KEY = /^evidence\/(\d{4}-\d{2}\/[0-9a-f-]{36}|import\/[0-9a-f]{16})\.(jpg|jpeg|png|webp|pdf)$/;
const TYPE_OF = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

async function upload({ env, request, actor }) {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  const ext = UPLOAD_TYPES[type];
  if (!ext) bad('Upload a JPEG, PNG, WebP or PDF');
  const body = await request.arrayBuffer();
  if (!body.byteLength) bad('Empty file');
  if (body.byteLength > MAX_UPLOAD) bad('File is larger than 8 MB');
  const key = `evidence/${todayFor(env).slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  await env.FILES.put(key, body, { metadata: { type, by: actor } });
  return json({ key, url: `/api/files/${key}` }, 201);
}
async function getFile({ env, params: [key] }) {
  if (!FILE_KEY.test(key)) notFound('File');
  const { value, metadata } = await env.FILES.getWithMetadata(key, { type: 'arrayBuffer', cacheTtl: 3600 });
  if (!value) notFound('File');
  return new Response(value, { headers: { 'content-type': metadata?.type || TYPE_OF[key.split('.').pop()], 'cache-control': 'private, max-age=31536000, immutable' } });
}

async function me({ env, actor }) {
  return json({ name: actor, today: todayFor(env) });
}
async function listActivity({ env, url }) {
  const site = url.searchParams.get('site');
  const rows = await env.DB.prepare(`SELECT a.*, s.name AS site_name FROM activity a LEFT JOIN sites s ON s.id = a.site_id ${site ? 'WHERE a.site_id = ?' : ''} ORDER BY a.at DESC, a.id DESC LIMIT 100`)
    .bind(...(site ? [+site] : [])).all();
  return json({ activity: rows.results });
}

// ================================================================= router
const PUBLIC = [
  ['POST', /^\/api\/auth\/login$/, login],
  ['POST', /^\/api\/auth\/logout$/, logout],
];
const routes = [
  ['GET', /^\/api\/me$/, me],
  ['GET', /^\/api\/overview$/, overview],
  ['GET', /^\/api\/sites$/, listSites],
  ['POST', /^\/api\/sites$/, createSite],
  ['GET', /^\/api\/sites\/(\d+)$/, getSite],
  ['PUT', /^\/api\/sites\/(\d+)$/, updateSite],
  ['GET', /^\/api\/templates$/, listTemplates],
  ['GET', /^\/api\/audits$/, listAudits],
  ['POST', /^\/api\/audits$/, createAudit],
  ['GET', /^\/api\/audits\/(\d+)$/, getAudit],
  ['GET', /^\/api\/findings$/, listFindings],
  ['GET', /^\/api\/findings\/(\d+)$/, getFinding],
  ['PATCH', /^\/api\/findings\/(\d+)$/, updateFinding],
  ['GET', /^\/api\/licences$/, listLicences],
  ['POST', /^\/api\/licences$/, createLicence],
  ['PUT', /^\/api\/licences\/(\d+)$/, updateLicence],
  ['DELETE', /^\/api\/licences\/(\d+)$/, deleteLicence],
  ['POST', /^\/api\/uploads$/, upload],
  ['GET', /^\/api\/files\/(.+)$/, getFile],
  ['GET', /^\/api\/activity$/, listActivity],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    // Browsers always send Origin on cross-site writes; refuse them.
    const origin = request.headers.get('origin');
    if (request.method !== 'GET' && origin && origin !== url.origin) return json({ error: 'Cross-origin request refused' }, 403);
    const run = async (handler, params, actor) => {
      try {
        return await handler({ env, request, url, actor, params });
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
        console.error(err);
        return json({ error: 'Something went wrong on the server' }, 500);
      }
    };
    for (const [method, pattern, handler] of PUBLIC) {
      const m = url.pathname.match(pattern);
      if (m && method === request.method) return run(handler, m.slice(1), null);
    }
    // Only trust the Cloudflare Access e-mail header once Access really sits in front (TRUST_ACCESS = "1");
    // without Access anyone could send that header. Otherwise the signed session cookie identifies people.
    const accessEmail = env.TRUST_ACCESS === '1' ? request.headers.get('cf-access-authenticated-user-email') : null;
    const session = accessEmail ? { name: accessEmail } : await readSession(request, env);
    if (!session) return json({ error: 'Please sign in', signin: true, setup: !env.ACCESS_CODE }, 401);
    for (const [method, pattern, handler] of routes) {
      const m = url.pathname.match(pattern);
      if (m && method === request.method) return run(handler, m.slice(1), session.name);
    }
    return json({ error: 'Not found' }, 404);
  },
};
