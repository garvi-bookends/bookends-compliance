# Build prompt — Compliance Dashboard

> **Historical document.** This is the brief the first version was built against on 26 Sep 2026, before the real reports arrived.
> The build then moved on in three ways: it scores with the reports' own marking and bands (not the 3/2/1 scheme below); it uses the
> Bookends brand palette (not a "bookish" one); and it stores files in Workers KV, not R2. See [docs/DECISIONS.md](docs/DECISIONS.md)
> for each change and [docs/FRAMEWORK.md](docs/FRAMEWORK.md) for the rules as they stand.

> This is the brief I wrote for myself before building. Everything in this repo was generated against it.
> If the product drifts, fix this file first, then the code.

---

## Role

You are a senior product engineer who has also worked as a **Head of Compliance** for a multi-outlet
food business in India. You think in *risk, evidence and deadlines*, not in features. You build
software that a busy compliance head can read in five seconds and trust in court.

## Context

- The company has appointed **Vishal bhai as Compliance Head**. He owns two audit streams today:
  1. **Food safety audits** (hygiene, storage, temperatures, pest control; FSSAI Schedule 4 aligned)
  2. **Maintenance audits** (fire & life safety, electrical, gas/LPG, refrigeration/HVAC, plumbing, equipment PM)
- Some audits have already been done on paper/Excel. Those files arrive **after** the build and must be
  migrated in without redesigning the data model.
- Hosting: **Cloudflare** (Workers + static assets, D1 for data, R2 for evidence photos, Cloudflare Access for login).

## Goal

Ship a **compliance framework** and a **dashboard that runs it**. Where the framework says what good looks like,
the dashboard shows who meets it, who doesn't, why, and what's due next.

## Non-negotiables

1. **Crystal-clear status.** Every site has one status per domain and one overall:
   `Compliant` · `Needs attention` · `Non-compliant` · `Not audited`.
   Every status shows **the written reason**, never only a colour, e.g.
   "Non-compliant: 1 critical action open (pests seen in dry store, due 24 Sep)".
2. **Rules are explicit and published inside the app** (Framework page): severity definitions, scoring,
   grade bands, SLAs, the status logic and the audit cadence. The code and the published rules share one source (`src/rules.js`).
3. **Every failed checklist item becomes a tracked action (CAPA)** with an owner, a due date set by severity, and an
   evidence photo. Only verification closes it. Passing the same item in a later audit closes it automatically, with a note.
4. **Repeat failures are flagged.** A failure that keeps coming back is a systemic problem, not bad luck.
5. **Licences and certificates** (FSSAI, Fire NOC, pest control, water tests, medical fitness…) are tracked with expiry
   countdowns; an expired critical licence makes the site Non-compliant.
6. **Trail.** Every audit, action change and licence edit is logged with who and when.

## Design brief

- **Minimal, bookish palette ("bookends").** Paper background, ink text, one bookcloth-navy accent. Colour is reserved for
  meaning: green, amber and red appear *only* for status, always paired with an icon and a word. All colours are tokens in one
  block so the brand palette can be swapped in one edit.
- **Material Design 3**: navigation rail on desktop, bottom navigation bar and FAB on mobile, tonal surfaces, M3 shape scale,
  segmented buttons, filter chips, dialogs/bottom sheets, snackbars. Material Symbols icons. Roboto Flex for UI and
  Roboto Serif for headlines (the "book" touch).
- **Mobile-first for auditing** (walk the kitchen with a phone: big Pass / Fail / N/A targets, camera capture, draft autosave),
  **desktop-first for reviewing** (overview matrix, trends).
- Light and dark themes. Accessible contrast (WCAG AA), 48 px touch targets, no horizontal scroll at 360 px.

## Information architecture

| Page | Job to be done |
| --- | --- |
| Overview | "Are we compliant today? If not, what do I do first?" Status headline, KPIs, attention list, site × domain matrix, score trend, audit-plan adherence |
| Sites | Each site's status per domain with reasons, latest audits, open actions, licences |
| Audits | History with filters; audit detail with section scores and failed items; **New audit** checklist flow |
| Actions | The CAPA tracker: Open → In progress → Fixed (awaiting verification) → Closed; overdue first |
| Licences | Register with expiry countdown; expired / ≤30 days / ≤90 days / valid |
| Framework | The published rules and the checklists themselves |

## Framework rules (implement exactly)

- Severity: **Critical** = immediate risk to food safety, life or licence (3 pts, fix ≤ 2 days) ·
  **Major** = systemic lapse likely to cause harm (2 pts, ≤ 7 days) · **Minor** = isolated, low risk (1 pt, ≤ 30 days).
- Score = points earned ÷ points applicable × 100 (N/A excluded).
- Audit grade: ≥ 90 % and no critical fail → Compliant; 75–89 % and no critical fail → Needs attention;
  < 75 % **or any critical fail** → Non-compliant.
- Site status per domain = the **worst** of: latest score band; any open critical action (red); any overdue action (amber);
  audit older than the 30-day cadence (amber); no audit ever (Not audited). Licences: expired critical/major (red),
  expired minor or anything expiring ≤ 30 days (amber). Overall = worst domain.

## Technical constraints

- Cloudflare Worker (ES modules) + static assets, D1 (SQL migrations), R2 (photos). No build step, no frontend framework,
  no runtime CDN dependency except Google Fonts.
- Identity from Cloudflare Access (`Cf-Access-Authenticated-User-Email`); fall back to "local" in dev.
- Migration-ready model: audits can be imported with or without item-level responses (`source = 'import'`).
- Demo data only in local dev and clearly bannered.

## Acceptance criteria

- [ ] At 360 px and at 1440 px, Overview answers "compliant today?" above the fold.
- [ ] An auditor can finish a 40-item audit on a phone with one thumb; a lost connection doesn't lose the draft.
- [ ] Submitting an audit computes score/grade on the server and creates actions with due dates.
- [ ] Every red or amber chip in the app has a sentence explaining it.
- [ ] Rules shown on the Framework page come from the same module the server uses.
- [ ] Deploys with `wrangler deploy`; README covers Access setup and migration.

## Out of scope (v1)

Daily temperature logs, notifications/e-mail digests, multi-tenant roles, offline sync. Tracked for v2.
