# The compliance framework

These are the rules the app applies. They come from Vishal Patel's audit reports (marking, grade bands) plus the fix-planning rules agreed for the dashboard.
In code they live in one file, [`public/rules.js`](../public/rules.js). The server scores with it and the in-app Framework page is drawn from it.
**Change a rule there, and this document, together.** `npm test` checks the rules against the reports.

## 1. What is audited

| Audit | Checklist | Scale | Cadence |
| --- | --- | --- | --- |
| **Food safety** | FSSAI internal food safety audit, 60 lines in 3 sections (A Service Area, B Kitchen Area, C Whole Premises & Documentation). 57 are in the app; lines 31, 37 and 50 are still to be added. 23 lines are ★ critical | Compliant / Minor / Major / N/A | Every unit, every 30 days |
| **Maintenance** | Inspection docket, 65 check points in 16 categories (statutory documents, electrical, HVAC, fire & life safety…). Each point is Critical, High, Medium or Low | OK / Observation / Non-compliant / N/A | Every unit, every 30 days |
| *Food safety, first round only* | FSSAI Schedule 4 & FDCA readiness, 39 checkpoints (S1–S15 service, K1–K24 kitchen), 8 ★ critical | Compliant / Partial / Non-compliant | Used Aug 2026, kept for history |

Lines apply by unit type: **Restaurant** lines only at restaurants, **CPK** lines only at central kitchens, **Both** everywhere.
Anything that doesn't apply on the day is rated N/A and left out of the score.

## 2. Marking

| Rating | Food safety line | ★ critical food safety line | Maintenance point |
| --- | --- | --- | --- |
| Compliant / OK | 2 marks | 4 marks | 1 point |
| Minor / Partial / Observation | 1 | 2 | 0.5 |
| Major / Non-compliant | 0 | 0 | 0 |
| N/A | left out | left out | left out |

**Score = marks earned ÷ marks possible × 100**, rounded to one decimal, as the reports print it.
Every Minor or Major needs a remark saying exactly what was seen; photos are optional (up to 4 per line).

## 3. Grade bands

| Band | Score | Meaning |
| --- | --- | --- |
| **Exemplar** | 90% or more | Where the best units go next |
| **Satisfactory** | 80–89.9% | **The target for every unit** |
| **Needs Improvement** | 50–79.9% | Working, with gaps a regulator would write up |
| **Non-Compliance** | below 50% | Re-audit within 3 weeks of the fixes being closed |

Colours follow the Bookends dockets: blue for 80% and above, gold for 50–79%, red below 50%. They always appear with the band's name and an icon, never as colour alone.

## 4. Status of a unit

- Each audit type gets the **band of its latest audit**.
- **Overall = the lower of food safety and maintenance.** An audit type never done doesn't pull the overall down, but it is listed as a reason ("No maintenance audit yet").
- **Licences** count only once a unit has at least one on record. An expired critical or major licence makes the unit Non-Compliance; an expired minor one, or any licence expiring within 30 days, makes it Needs Improvement. Within 90 days it shows as "renew soon".
- Every status carries its reasons in words: the latest visit and score, marks short of 80%, Priority 1 fixes open, fixes overdue, and next visit due (more than 30 days since the last).

## 5. From gaps to fixes

Every line rated Minor/Major (or Observation/Non-compliant) at a unit's **latest** visit is a fix. Older visits are history.

| Priority | Which gaps | Fix within |
| --- | --- | --- |
| **P1** | A ★ critical food safety line rated Major · a Critical maintenance point Non-compliant | **2 days** (act within 48 hours) |
| **P2** | A normal food safety line rated Major · a ★ line rated Minor · a Critical maintenance point with an Observation · a High point Non-compliant | **7 days** |
| **P3** | A normal food safety line rated Minor · a High point with an Observation · any Medium or Low point | **30 days** |

- Deadlines count from the audit date. For the imported Aug–Sep reports they count from **26 Sep 2026**, the day they were loaded.
- Each fix knows how many **marks it wins back** (for example +4 marks, or +2.9 points on that unit's score).
- **Paperwork vs on-site.** Paperwork fixes are records, certificates, logs and notices, where the work is often done but not written down, so they close in a week or two. Food safety areas counted as paperwork: menu information, complaints, receiving, stock rotation, FSSAI licence, display, water, cleaning system, pest control, medical fitness, FoSTaC, training, records, regulator follow-up. For maintenance: statutory documents, PM records / safety training.
- **Order inside a priority:** paperwork first, then the biggest mark gain.

## 6. Route to 80%

For every unit, the app lists the shortest ordered set of fixes that lifts its latest score to 80%: Priority 1 first, then the biggest marks. It shows the score after each one.

- The shortfall is counted the way the reports count it, in whole marks for food safety and half points for maintenance. Example: AIKO Ambli, 102/144, needs 116 marks for 80%, so it is **14 short**.
- It also shows **"Priority 1 alone takes it to X%"**. For Capiche Vesu that is 83.6%, the same figure its report gives.
- Fixes marked fixed but not yet verified don't raise the score. The app shows what the score will be once they are verified at the next visit.

## 7. Fix once, for every unit

A gap open at **3 or more units** is listed under "Fix once, for every unit". It should be solved centrally, not outlet by outlet: one pest-control contract, one NABL lab for water tests, one FoSTaC training batch, one labelling system.
On 26 Sep 2026 the top ones were expired or undated stock, water potability reports, FoSTaC supervisors, records, cold-chain logs and pest-control records.

## 8. Life of a fix

```
Open ──► In progress ──► Fixed, awaiting verification ──► Closed
  ▲                              │
  └──────── sent back ◄──────────┘            (Closed ──► reopened, with a reason)
```

- **Mark fixed** needs "what was done". A proof photo is strongly advised.
- **Verify & close** is for the Compliance Head, after checking on site or from the photo. **Send back** and **Reopen** need a written reason.
- **The next audit settles open fixes automatically.** If the line is rated Compliant, the fix closes as verified. If it is still failing, the old fix closes as "carried forward" and a new one is raised and marked **Repeat**. If it is rated N/A, the fix closes.
- Every change is recorded with who and when: status, owner, due date, root cause, action, proof.

## 9. Roles

| Role | Owns |
| --- | --- |
| **Compliance Head** (Vishal Patel) | This framework; runs food safety and maintenance audits; verifies every fix; closes fixes; keeps the licence register; reports progress to the founders |
| **Outlet / kitchen manager** | The unit's fix plan: paperwork first, then on-site fixes; proof uploaded before the due date |
| **Maintenance lead / vendors** | Maintenance docket points; preventive-maintenance and safety-training records |
| **Founders / management** | Monthly review of progress to 80%; clearing problems shared across units; escalations |

## 10. Escalation

1. Priority 1 open for more than 48 hours: the Compliance Head calls the unit manager and informs the founders the same day.
2. The same problem open at three or more units: fixed once, centrally, not unit by unit.
3. A unit below 50% (Non-Compliance): re-audit within 3 weeks of its fixes being reported closed.
4. Any unit below 80% (Satisfactory): next audit within 30 days, with its route-to-80% list as the agenda.
