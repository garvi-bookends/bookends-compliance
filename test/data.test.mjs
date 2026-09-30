// The imported Aug–Sep 2026 audits, checked against what the reports themselves say. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import * as R from '../public/rules.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const checklists = read('data/checklists.json');
const data = read('data/import-2026-09.json');
const itemsOf = (id) => new Map(checklists.find((t) => t.id === id).items.map((it) => [it.code, it]));

function score(a) {
  const items = itemsOf(a.template);
  const rows = a.responses.map((r, i) => ({ it: { ...items.get(r.code), id: i }, r }));
  return { rows, s: R.scoreAudit(rows.map(({ it }) => it), Object.fromEntries(rows.map(({ it, r }) => [it.id, r.result]))) };
}
const find = (site, domain, visit) => data.audits.find((a) => a.site === site && a.domain === domain && a.visit === visit);
const latest = (site, domain) => data.audits.filter((a) => a.site === site && a.domain === domain).sort((x, y) => x.date.localeCompare(y.date)).at(-1);

test('the import holds 11 units, 25 audits and 1,186 line ratings', () => {
  assert.equal(data.sites.length, 11);
  assert.equal(data.audits.length, 25);
  assert.equal(data.audits.filter((a) => a.domain === 'food').length, 19);
  assert.equal(data.audits.filter((a) => a.domain === 'maintenance').length, 6);
  assert.equal(data.audits.reduce((n, a) => n + a.responses.length, 0), 1186);
});

test('every audit re-scores to the total printed in its report (one documented exception)', () => {
  for (const a of data.audits) {
    const { s } = score(a);
    if (a.site === 'ahd-bakery' && a.visit === 1) {
      // The report prints 45/72; its own lines and its conclusion both give 39/72 (see docs/DATA.md).
      assert.equal(s.earned, 39); assert.equal(s.possible, 72); assert.equal(s.score, 54.2);
      assert.match(a.flag, /45\/72/);
      continue;
    }
    assert.equal(s.earned, a.reported.obtained, `${a.site} ${a.domain} visit ${a.visit}`);
    assert.equal(s.possible, a.reported.available, `${a.site} ${a.domain} visit ${a.visit}`);
    assert.equal(s.score, a.reported.pct, `${a.site} ${a.domain} visit ${a.visit}`);
  }
});

test('visit 1 → visit 2 for the eight re-audited units', () => {
  const expected = {
    'capiche-vesu': [41.5, 60.7], 'capiche-ambli': [55.3, 73.0], 'aiko-ambli': [60.6, 70.8], 'capiche-university': [63.8, 72.3],
    'capiche-piplod': [64.9, 72.2], 'ahd-hot-kitchen': [59.2, 64.5], 'ahd-bakery': [54.2, 62.1], 'aiko-pal': [62.8, 62.0],
  };
  for (const [site, [v1, v2]] of Object.entries(expected)) {
    assert.equal(score(find(site, 'food', 1)).s.score, v1, `${site} visit 1`);
    assert.equal(score(find(site, 'food', 2)).s.score, v2, `${site} visit 2`);
  }
});

test('route to 80% reproduces the conclusions written in the reports', () => {
  const check = (site, needed, afterP1) => {
    const a = latest(site, 'food');
    const { rows, s } = score(a);
    const p1 = rows.filter(({ it, r }) => R.priorityFor(it, r.result) === 'critical').reduce((n, { it, r }) => n + it.weight - it.weight * R.POINTS[r.result], 0);
    assert.equal(R.shortfall(R.TARGET, s.earned, s.possible), needed, `${site} shortfall`);
    assert.equal(R.round1(((s.earned + p1) / s.possible) * 100), afterP1, `${site} after Priority 1`);
  };
  check('capiche-vesu', 27, 83.6); // "Closing those 8 alone takes the score to 117/140 (83.6%) ... it is 27 short"
  check('aiko-ambli', 14, 90.3);   // "Closing those 7 alone takes the score to 130/144 (90.3%) ... it is 14 short"
});

test('the open fix list is built from each unit’s latest visit: 310 fixes, 117 Priority 1, 128 paperwork', () => {
  const counts = { critical: 0, major: 0, minor: 0, paperwork: 0 };
  const keys = new Set(data.audits.map((a) => `${a.site}:${a.domain}`));
  for (const k of keys) {
    const [site, domain] = k.split(':');
    const { rows } = score(latest(site, domain));
    for (const { it, r } of rows) {
      const p = R.priorityFor(it, r.result);
      if (!p) continue;
      counts[p] += 1;
      if (it.kind === 'paperwork') counts.paperwork += 1;
    }
  }
  assert.deepEqual(counts, { critical: 117, major: 120, minor: 73, paperwork: 128 });
});

test('photos: 275 unique photos, each used by at least one line (305 references), none missing', () => {
  const keys = data.audits.flatMap((a) => a.responses.flatMap((r) => r.photos));
  const unique = new Set(keys);
  assert.equal(keys.length, 305); // some photos back more than one line
  assert.equal(unique.size, 275);
  for (const k of unique) assert.ok(existsSync(new URL(`../data/photos/${k.split('/').pop()}`, import.meta.url)), k);
  const files = readdirSync(new URL('../data/photos/', import.meta.url));
  assert.deepEqual(files.filter((f) => !unique.has(`evidence/import/${f}`)), []);
});
