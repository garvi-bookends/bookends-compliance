// The compliance rules in public/rules.js. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../public/rules.js';

test('grade bands match the reports: Exemplar 90+, Satisfactory 80+, Needs Improvement 50+, else Non-Compliance', () => {
  assert.equal(R.bandFor(90), 'exemplar');
  assert.equal(R.bandFor(89.9), 'satisfactory');
  assert.equal(R.bandFor(80), 'satisfactory');
  assert.equal(R.bandFor(79.9), 'improve');
  assert.equal(R.bandFor(50), 'improve');
  assert.equal(R.bandFor(49.9), 'noncompliance');
  assert.equal(R.bandFor(null), null);
});

test('scoring: full marks for a pass, half for a partial, none for a fail; N/A is left out', () => {
  const items = [
    { id: 1, section: 'A', weight: 4, critical: 1 }, // ★ line
    { id: 2, section: 'A', weight: 2, critical: 0 },
    { id: 3, section: 'B', weight: 2, critical: 0 },
    { id: 4, section: 'B', weight: 2, critical: 0 },
  ];
  const s = R.scoreAudit(items, { 1: 'pass', 2: 'partial', 3: 'fail', 4: 'na' });
  assert.equal(s.earned, 5);
  assert.equal(s.possible, 8);
  assert.equal(s.score, 62.5);
  assert.equal(s.band, 'improve');
  assert.equal(s.fails, 1);
  assert.equal(s.partials, 1);
  assert.deepEqual(s.sections.map((x) => [x.section, x.score]), [['A', 83.3], ['B', 0]]);
});

test('scores are rounded to one decimal, as printed in the reports', () => {
  const items = Array.from({ length: 47 }, (_, i) => ({ id: i + 1, section: 'A', weight: 2, critical: 0 }));
  const answers = Object.fromEntries(items.map((it, i) => [it.id, i < 39 ? 'pass' : 'fail'])); // 78/94
  assert.equal(R.scoreAudit(items, answers).score, 83);
  assert.equal(R.round1((85 / 140) * 100), 60.7);
});

test('priorities: food safety lines', () => {
  assert.equal(R.priorityFor({ critical: 1 }, 'fail'), 'critical');
  assert.equal(R.priorityFor({ critical: 1 }, 'partial'), 'major');
  assert.equal(R.priorityFor({ critical: 0 }, 'fail'), 'major');
  assert.equal(R.priorityFor({ critical: 0 }, 'partial'), 'minor');
  assert.equal(R.priorityFor({ critical: 1 }, 'pass'), null);
  assert.equal(R.priorityFor({ critical: 1 }, 'na'), null);
});

test('priorities: maintenance docket points follow their criticality', () => {
  assert.equal(R.priorityFor({ criticality: 'Critical' }, 'fail'), 'critical');
  assert.equal(R.priorityFor({ criticality: 'Critical' }, 'partial'), 'major');
  assert.equal(R.priorityFor({ criticality: 'High' }, 'fail'), 'major');
  assert.equal(R.priorityFor({ criticality: 'High' }, 'partial'), 'minor');
  assert.equal(R.priorityFor({ criticality: 'Medium' }, 'fail'), 'minor');
  assert.equal(R.priorityFor({ criticality: 'Low' }, 'partial'), 'minor');
});

test('shortfall to 80% is counted in whole marks (food) or half points (maintenance)', () => {
  assert.equal(R.shortfall(80, 102, 144), 14);        // AIKO Ambli report: "80% needs 116 marks; the unit has 102, so it is 14 short"
  assert.equal(R.shortfall(80, 85, 140), 27);         // Capiche Vesu report: "it is 27 short"
  assert.equal(R.shortfall(80, 50.5, 65, 0.5), 1.5);  // maintenance docket, half-point steps
  assert.equal(R.shortfall(80, 120, 140), 0);
});

test('route to 80%: Priority 1 first, biggest marks first, stops once the target is reached', () => {
  const gaps = [
    { id: 'a', priority: 'minor', marks: 1 },
    { id: 'b', priority: 'major', marks: 2 },
    { id: 'c', priority: 'critical', marks: 4 },
    { id: 'd', priority: 'critical', marks: 2 },
  ];
  const r = R.routeTo(80, 70, 100, gaps);  // needs 10
  assert.deepEqual(r.steps.map((s) => s.id), ['c', 'd', 'b', 'a']);
  assert.equal(r.reached, false);          // 9 marks available, 10 needed
  const r2 = R.routeTo(80, 74, 100, gaps); // needs 6
  assert.deepEqual(r2.steps.map((s) => s.id), ['c', 'd']);
  assert.equal(r2.reached, true);
  assert.equal(r2.steps.at(-1).after, 80);
});

test('overall status is the worst band among the audited domains; unknown never counts as good', () => {
  assert.equal(R.worst(['satisfactory', 'improve']), 'improve');
  assert.equal(R.worst(['satisfactory', 'none']), 'satisfactory');
  assert.equal(R.worst(['none', 'none']), 'none');
  assert.equal(R.worst(['exemplar', 'noncompliance', 'improve']), 'noncompliance');
});

test('licences: expired critical or major licence is Non-Compliance, expiring within 30 days is Needs Improvement', () => {
  const today = '2026-09-30';
  const lic = (severity, expires_on) => ({ id: 1, type: 'X', severity, expires_on });
  assert.equal(R.licenceStatus({ licences: [lic('critical', '2026-09-01')], today }).level, 'noncompliance');
  assert.equal(R.licenceStatus({ licences: [lic('minor', '2026-09-01')], today }).level, 'improve');
  assert.equal(R.licenceStatus({ licences: [lic('major', '2026-10-15')], today }).level, 'improve');
  assert.equal(R.licenceStatus({ licences: [lic('major', '2027-03-01')], today }).level, 'satisfactory');
  assert.equal(R.licenceStatus({ licences: [], today }).tracked, false);
});

test('dates are calendar dates, not affected by time zones', () => {
  assert.equal(R.addDays('2026-09-26', 2), '2026-09-28');
  assert.equal(R.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(R.daysBetween('2026-09-02', '2026-09-26'), 24);
  assert.equal(R.fmtDate('2026-09-02', true), '2 Sep 2026');
});
