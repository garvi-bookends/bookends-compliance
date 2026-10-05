// The Bookends compliance framework as code.
// Imported by the Worker (scoring, statuses, fix plans) AND by the browser (Framework page, live score),
// so what the app publishes as "the rules" is exactly what it enforces. Keep this file pure: no DOM, no I/O.
// The marking and the grade bands are the ones used in Vishal Patel's audit reports.

export const ORG = 'Bookends Hospitality';

export const DOMAINS = {
  food: { key: 'food', label: 'Food safety', long: 'FSSAI food safety audit', icon: 'restaurant' },
  maintenance: { key: 'maintenance', label: 'Maintenance', long: 'Maintenance inspection docket', icon: 'handyman' },
  licences: { key: 'licences', label: 'Licences', long: 'Licence & certificate register', icon: 'verified' },
};
export const AUDIT_DOMAINS = ['food', 'maintenance'];

// ---------- marking ----------
// Every line has a weight (the marks for full compliance). A partial rating earns half, a fail earns nothing.
export const POINTS = { pass: 1, partial: 0.5, fail: 0 };
export const SCHEMES = {
  fssai2: {
    name: 'FSSAI internal food safety audit',
    ratings: { pass: 'Compliant', partial: 'Minor', fail: 'Major', na: 'N/A' },
    marking: 'Compliant 2 marks · Minor 1 · Major 0 · N/A left out · ★ critical lines count double (4 · 2 · 0).',
  },
  fssai1: {
    name: 'FSSAI Schedule 4 readiness',
    ratings: { pass: 'Compliant', partial: 'Partial', fail: 'Non-compliant', na: 'N/A' },
    marking: 'Compliant 2 marks · Partial 1 · Non-compliant 0 · ★ critical checkpoints count double.',
  },
  docket: {
    name: 'Maintenance inspection docket',
    ratings: { pass: 'OK', partial: 'Observation', fail: 'Non-compliant', na: 'N/A' },
    marking: 'OK 1 point · Observation 0.5 · Non-compliant 0. Category and overall scores are the share of points available.',
  },
};
export const RESULTS = ['pass', 'partial', 'fail', 'na'];

// ---------- grade bands (Schedule-4 FSO inspection grading) ----------
export const BANDS = [
  { key: 'exemplar', label: 'Exemplar', min: 90 },
  { key: 'satisfactory', label: 'Satisfactory', min: 80 },
  { key: 'improve', label: 'Needs Improvement', min: 50 },
  { key: 'noncompliance', label: 'Non-Compliance', min: 0 },
];
export const TARGET = 80;   // where every unit has to be: Satisfactory
export const STRETCH = 90;  // where the best units go next: Exemplar

// Status levels = the bands, plus "not audited". Worst first by rank.
export const LEVELS = {
  noncompliance: { label: 'Non-Compliance', icon: 'cancel', rank: 4 },
  improve: { label: 'Needs Improvement', icon: 'error', rank: 3 },
  none: { label: 'Not audited', icon: 'help', rank: 2 },
  satisfactory: { label: 'Satisfactory', icon: 'check_circle', rank: 1 },
  exemplar: { label: 'Exemplar', icon: 'workspace_premium', rank: 0 },
};

export const round1 = (x) => Math.round(x * 10) / 10;
export function bandFor(score) {
  if (score == null) return null;
  return BANDS.find((b) => score >= b.min).key;
}
export const bandLabel = (key) => LEVELS[key || 'none'].label;

// ---------- priorities for fixing ----------
export const PRIORITY = {
  critical: {
    label: 'Priority 1', short: 'P1', fixDays: 2,
    meaning: 'A ★ critical line rated Major, or a critical maintenance point non-compliant.',
    response: 'Food safety, life safety or the licence is at risk. Act within 48 hours.',
  },
  major: {
    label: 'Priority 2', short: 'P2', fixDays: 7,
    meaning: 'A normal line rated Major, a ★ critical line only partly met, or a high-risk maintenance point non-compliant.',
    response: 'Fix within 7 days.',
  },
  minor: {
    label: 'Priority 3', short: 'P3', fixDays: 30,
    meaning: 'A minor gap or observation.',
    response: 'Fix within 30 days.',
  },
};
export const PRIORITY_ORDER = ['critical', 'major', 'minor'];

// ---------- alerts ----------
// Priority 1 and 2 fixes alert everyone who can see them; licences alert the Compliance Head only.
// A fix alerts once it is overdue, or when its deadline is this close (P1 has 48 hours, so it alerts a day before; P2 has 7 days, so two days before).
export const ALERT_DAYS = { critical: 1, major: 2 };
/**
 * Everything that needs attention now, most urgent first. Each alert has a key naming it, its date and its stage (soon / over),
 * so one marked done comes back if it becomes overdue or its date is changed.
 * @param findings  open fixes [{ id, priority, status, due_date, title, site_name }]
 * @param licences  [{ id, type, expires_on, site_name }], or null when this person does not get licence alerts
 */
export function alertsFor({ findings, licences, today }) {
  const out = [];
  for (const f of findings) {
    if (!UNRESOLVED.includes(f.status) || !(f.priority in ALERT_DAYS) || !f.due_date) continue;
    const left = daysBetween(today, f.due_date);
    if (left > ALERT_DAYS[f.priority]) continue;
    const when = left < 0 ? `overdue by ${plural(-left, 'day')}` : left === 0 ? 'due today' : left === 1 ? 'due tomorrow' : `due in ${plural(left, 'day')}`;
    out.push({ kind: 'fix', key: `fix:${f.id}:${f.due_date}:${left < 0 ? 'over' : 'soon'}`, group: f.priority, id: f.id, overdue: left < 0, left, tone: left < 0 || f.priority === 'critical' ? 'bad' : 'warn',
      title: f.title, sub: `${PRIORITY[f.priority].short} · ${f.site_name} · ${when}` });
  }
  for (const l of licences || []) {
    if (!l.expires_on) continue;
    const left = daysBetween(today, l.expires_on);
    if (left > LICENCE_WARN_DAYS) continue;
    out.push({ kind: 'licence', key: `licence:${l.id}:${l.expires_on}:${left < 0 ? 'over' : 'soon'}`, group: 'licence', id: l.id, overdue: left < 0, left, tone: left < 0 ? 'bad' : 'warn',
      title: `${l.type}${left < 0 ? ' expired' : ' expiring soon'}`, sub: `${l.site_name} · ${left < 0 ? `expired ${plural(-left, 'day')} ago` : left === 0 ? 'expires today' : `expires in ${plural(left, 'day')}`}` });
  }
  const rank = { critical: 0, major: 1, licence: 2 };
  return out.sort((a, b) => rank[a.group] - rank[b.group] || a.left - b.left || a.id - b.id);
}
export const KINDS = {
  paperwork: { label: 'Paperwork', icon: 'description', hint: 'The work may be happening but there is no record. Quick to close.' },
  physical: { label: 'On-site fix', icon: 'build', hint: 'Needs real work at the site.' },
};

/** Which priority a gap gets, from the line and how it was rated. */
export function priorityFor(item, result) {
  if (result !== 'fail' && result !== 'partial') return null;
  const docket = item.criticality != null && item.criticality !== '';
  if (docket) {
    if (item.criticality === 'Critical') return result === 'fail' ? 'critical' : 'major';
    if (item.criticality === 'High') return result === 'fail' ? 'major' : 'minor';
    return 'minor';
  }
  if (item.critical) return result === 'fail' ? 'critical' : 'major';
  return result === 'fail' ? 'major' : 'minor';
}

// ---------- finding lifecycle ----------
export const FINDING_STATUS = {
  open: { label: 'Open', icon: 'radio_button_unchecked' },
  in_progress: { label: 'In progress', icon: 'pending' },
  fixed: { label: 'Fixed, awaiting verification', icon: 'rule' },
  closed: { label: 'Closed', icon: 'task_alt' },
};
export const UNRESOLVED = ['open', 'in_progress'];

export const LICENCE_WARN_DAYS = 30;
export const LICENCE_NOTICE_DAYS = 90;
export const AUDIT_CADENCE_DAYS = 30;
export const LICENCE_TYPES = [
  { type: 'FSSAI licence / registration', severity: 'critical', cadence: 'Licence term (1–5 years)' },
  { type: 'Fire NOC', severity: 'critical', cadence: 'As issued by the fire department' },
  { type: 'Fire extinguisher refill', severity: 'critical', cadence: 'Yearly' },
  { type: 'Water potability test report (IS 10500)', severity: 'critical', cadence: 'Every 6 months' },
  { type: 'Pest control contract & service record', severity: 'major', cadence: 'Yearly contract, monthly service' },
  { type: 'Food handlers’ medical fitness', severity: 'major', cadence: 'Yearly' },
  { type: 'FoSTaC supervisor certificate', severity: 'major', cadence: 'Every 2 years' },
  { type: 'Trade / shop licence', severity: 'major', cadence: 'Yearly' },
  { type: 'Electrical installation & load sanction', severity: 'major', cadence: 'As issued' },
  { type: 'Fire-suppression system service', severity: 'major', cadence: 'Every 6 months' },
  { type: 'Liquor licence', severity: 'critical', cadence: 'Yearly, if applicable' },
  { type: 'Legal Metrology (weighing scale) stamping', severity: 'minor', cadence: 'Yearly' },
  { type: 'DG set pollution consent', severity: 'minor', cadence: 'As issued, if applicable' },
];

export const ROLES = [
  { role: 'Compliance Head', who: 'Vishal Patel', owns: 'Owns this framework. Runs the food safety and maintenance audits, verifies every fix, closes actions, keeps the licence register, and reports progress to the founders.' },
  { role: 'Outlet / kitchen manager', who: 'One per unit', owns: 'Owns the fix plan for the unit: closes paperwork gaps first, then on-site fixes, and uploads proof before the due date.' },
  { role: 'Maintenance lead / vendors', who: 'In-house or AMC', owns: 'Fixes maintenance docket points and keeps preventive-maintenance and safety-training records.' },
  { role: 'Founders / management', who: 'Monthly review', owns: 'Review progress towards 80%, clear problems that repeat across outlets (one vendor, one contract), and step in on anything escalated.' },
];

export const ESCALATION = [
  'Priority 1 open for more than 48 hours: the Compliance Head calls the unit manager and informs the founders the same day.',
  'The same problem open at three or more outlets: fixed once, centrally (one pest-control contract, one water-testing lab, one FoSTaC batch), not outlet by outlet.',
  'A unit below 50% (Non-Compliance): re-audit within 3 weeks of the fixes being reported closed.',
  'Any unit below 80% (Satisfactory): next audit within 30 days. The route-to-80% list is the agenda.',
];

// ---------- dates (ISO 'YYYY-MM-DD'; calendar arithmetic in UTC to avoid DST/offset drift) ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export function addDays(iso, n) {
  return new Date(toUTC(iso) + n * 86400000).toISOString().slice(0, 10);
}
/** Whole days from a to b (positive when b is later). */
export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}
export function fmtDate(iso, withYear = false) {
  if (!iso) return '—';
  const d = `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
  return withYear ? `${d} ${iso.slice(0, 4)}` : d;
}
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const fmtNum = (x) => (x == null ? '—' : Number.isInteger(x) ? String(x) : String(round1(x)));
export const fmtPct = (x) => (x == null ? '—' : `${round1(x).toFixed(1)}%`);
export function fmtDelta(d) {
  if (d == null) return '—';
  const v = round1(d);
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)} pts`;
}

// ---------- audit time ----------
// App audits record started_at / finished_at (UTC); imported ones carry a written range such as '10:30AM to 01:30PM'.
export const TZ_OFFSET_MINUTES = 330; // India
/** '10:30 am' for a UTC timestamp, in India time. */
export function fmtClock(ts, offset = TZ_OFFSET_MINUTES) {
  const d = new Date(Date.parse(ts) + offset * 60000);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
const clockMinutes = (t) => {
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m?\.?\s*$/i.exec(t);
  if (!m || +m[1] > 12 || +(m[2] || 0) > 59) return null;
  return ((+m[1] % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + +(m[2] || 0);
};
/** Minutes in a written range like '10:30AM to 01:30PM' (or '10:30 am - 1:30 pm'); null if it cannot be read. */
export function rangeMinutes(range) {
  const parts = String(range || '').split(/\s*(?:to|–|—|-)\s*/i);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map(clockMinutes);
  if (a == null || b == null) return null;
  return b >= a ? b - a : b + 1440 - a;
}
/** How long an audit took, in minutes, or null when no time was recorded. */
export function auditMinutes(a) {
  if (a.started_at && a.finished_at) {
    const m = Math.round((Date.parse(a.finished_at) - Date.parse(a.started_at)) / 60000);
    return Number.isFinite(m) && m >= 0 ? m : null;
  }
  return rangeMinutes(a.time_range);
}
/** '10:30 am – 1:30 pm', or the written range for imported audits, or '' when unknown. */
export function auditTimeRange(a) {
  if (a.started_at && a.finished_at) return `${fmtClock(a.started_at)} – ${fmtClock(a.finished_at)}`;
  if (a.time_range) return String(a.time_range).replace(/\s*to\s*/i, ' – ');
  return a.finished_at ? `Submitted ${fmtClock(a.finished_at)}` : '';
}
/** '45 min', '2 h 15 min', or '—'. */
export function fmtDuration(m) {
  if (m == null) return '—';
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
}

// ---------- scoring ----------
/**
 * @param items   [{ id, section, weight, critical }]
 * @param answers { [itemId]: 'pass' | 'partial' | 'fail' | 'na' }   (unanswered items are ignored)
 */
export function scoreAudit(items, answers) {
  let earned = 0, possible = 0, criticalFails = 0, fails = 0, partials = 0, answered = 0;
  const sections = new Map();
  for (const item of items) {
    const result = answers[item.id];
    if (!result) continue;
    answered += 1;
    if (!sections.has(item.section)) sections.set(item.section, { section: item.section, earned: 0, possible: 0, fails: 0, partials: 0 });
    const sec = sections.get(item.section);
    if (result === 'na') continue;
    const w = item.weight;
    const got = w * POINTS[result];
    possible += w; earned += got; sec.possible += w; sec.earned += got;
    if (result === 'fail') { fails += 1; sec.fails += 1; if (item.critical) criticalFails += 1; }
    if (result === 'partial') { partials += 1; sec.partials += 1; }
  }
  const pct = (e, p) => (p ? round1((e / p) * 100) : null);
  const score = pct(earned, possible);
  return {
    earned, possible, score, band: bandFor(score), criticalFails, fails, partials, answered,
    sections: [...sections.values()].map((s) => ({ ...s, score: pct(s.earned, s.possible), band: bandFor(pct(s.earned, s.possible)) })),
  };
}

/** Marks still needed to reach a target, rounded up to whole marks (food) or half points (maintenance), as the reports count them. */
export function shortfall(target, earned, possible, step = 1) {
  return Math.max(0, Math.ceil(((target / 100) * possible - earned) / step - 1e-9) * step);
}
export const stepFor = (domain) => (domain === 'maintenance' ? 0.5 : 1);

/**
 * The shortest route from where a unit is to where it has to be.
 * @param gaps [{ id, priority, marks }]  marks = marks recovered if the gap is closed
 * Fixes are taken in priority order, biggest marks first within a priority.
 */
export function routeTo(target, earned, possible, gaps, step = 1) {
  const needed = shortfall(target, earned, possible, step);
  const ordered = [...gaps].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || b.marks - a.marks);
  const steps = [];
  let got = 0;
  for (const g of ordered) {
    if (got >= needed - 1e-9) break;
    got += g.marks;
    steps.push({ ...g, after: round1(((earned + got) / possible) * 100) });
  }
  return { needed: round1(needed), reached: got >= needed - 1e-9, steps, allP1: gaps.filter((g) => g.priority === 'critical') };
}

// ---------- statuses ----------
export function worst(levels) {
  const audited = levels.filter((l) => l && l !== 'none');
  if (!audited.length) return 'none';
  return audited.reduce((w, l) => (LEVELS[l].rank > LEVELS[w].rank ? l : w));
}

/**
 * Status of one audit domain at one unit: the band of the latest audit, with the reasons written out.
 * @param audits   this unit's audits in this domain, oldest first: [{ id, audit_date, score, earned, possible }]
 * @param findings this unit's unresolved or fixed findings in this domain
 */
export function domainStatus({ domain, audits, findings, today }) {
  const label = DOMAINS[domain].label.toLowerCase();
  const latest = audits.at(-1) || null;
  const prev = audits.length > 1 ? audits.at(-2) : null;
  const reasons = [];
  if (!latest) {
    return { level: 'none', latest: null, previous: null, reasons: [{ tone: 'none', text: `No ${label} audit yet` }] };
  }
  const band = bandFor(latest.score) || 'none';
  const visitNo = audits.length;
  reasons.push({
    tone: band, kind: 'audit', id: latest.id,
    text: `Visit ${visitNo} on ${fmtDate(latest.audit_date)}: ${fmtPct(latest.score)}, ${bandLabel(band)}` + (prev ? ` (visit ${visitNo - 1}: ${fmtPct(prev.score)})` : ''),
  });
  if (latest.score < TARGET) {
    const short = shortfall(TARGET, latest.earned, latest.possible, stepFor(domain));
    reasons.push({ tone: 'improve', kind: 'route', text: `${fmtNum(short)} ${domain === 'food' ? 'marks' : 'points'} short of ${TARGET}% (Satisfactory)` });
  }
  const open = findings.filter((f) => UNRESOLVED.includes(f.status));
  const p1 = open.filter((f) => f.priority === 'critical');
  if (p1.length) reasons.push({ tone: 'noncompliance', kind: 'findings', filter: 'p1', text: `${plural(p1.length, 'Priority 1 fix', 'Priority 1 fixes')} open` });
  const overdue = open.filter((f) => f.due_date < today);
  if (overdue.length) reasons.push({ tone: 'improve', kind: 'findings', filter: 'overdue', text: `${plural(overdue.length, 'fix', 'fixes')} overdue` });
  const age = daysBetween(latest.audit_date, today);
  if (age > AUDIT_CADENCE_DAYS) reasons.push({ tone: 'improve', kind: 'audit-due', text: `Next visit due: last one was ${age} days ago` });
  return { level: band, latest, previous: prev, reasons };
}

export function licenceStatus({ licences, today }) {
  if (!licences.length) return { level: 'none', tracked: false, reasons: [{ tone: 'none', text: 'No licences recorded yet' }] };
  const reasons = [];
  let level = 'satisfactory';
  for (const l of licences) {
    if (!l.expires_on) continue;
    const left = daysBetween(today, l.expires_on);
    if (left < 0) {
      const lv = l.severity === 'minor' ? 'improve' : 'noncompliance';
      reasons.push({ tone: lv, kind: 'licence', id: l.id, text: `${l.type} expired ${plural(-left, 'day')} ago` });
      if (LEVELS[lv].rank > LEVELS[level].rank) level = lv;
    } else if (left <= LICENCE_WARN_DAYS) {
      reasons.push({ tone: 'improve', kind: 'licence', id: l.id, text: `${l.type} expires in ${plural(left, 'day')}` });
      if (LEVELS.improve.rank > LEVELS[level].rank) level = 'improve';
    }
  }
  if (!reasons.length) reasons.push({ tone: 'satisfactory', text: `All ${plural(licences.length, 'licence')} valid` });
  return { level, tracked: true, reasons };
}

/** Overall = the worst band among the domains that have been audited (licences count once any are recorded). */
export function siteStatus({ auditsByDomain, findings, licences, today }) {
  const domains = {};
  for (const d of AUDIT_DOMAINS) {
    domains[d] = domainStatus({ domain: d, audits: auditsByDomain[d] || [], findings: findings.filter((f) => f.domain === d), today });
  }
  domains.licences = licenceStatus({ licences, today });
  const counted = [domains.food.level, domains.maintenance.level, domains.licences.tracked ? domains.licences.level : null];
  const overall = worst(counted.filter(Boolean));
  const reasons = Object.entries(domains).flatMap(([domain, s]) =>
    (domain === 'licences' && !s.tracked ? [] : s.reasons).map((r) => ({ ...r, domain })));
  return { overall, domains, reasons };
}
