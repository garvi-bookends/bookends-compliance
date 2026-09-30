# Bookends Compliance

The compliance dashboard for **Bookends Hospitality Pvt. Ltd.** (Capiche, AIKO, Beshak and the central kitchens in Surat and Ahmedabad).
It turns the Compliance Head's audits into three answers:

1. **Where is each unit?** Food safety (FSSAI) and maintenance scores, visit by visit.
2. **Where does it have to be?** 80% (Satisfactory) for every unit, then 90% (Exemplar).
3. **What do we fix first?** Every gap from the latest audits, ranked Priority 1–3, with the shortest route to 80% for each unit.

**Live:** https://bookends-compliance.capichesecretmenu.workers.dev (sign in with your name and the team access code)
**Status:** in use since 26 Sep 2026, loaded with the Aug–Sep 2026 audits (11 units, 25 audits, 310 open fixes).

> **New here? Read [HANDOVER.md](HANDOVER.md) first.** It lists what you are receiving, the access you need and from whom, and what is still open.

## Documentation

| Document | Read it for |
| --- | --- |
| [HANDOVER.md](HANDOVER.md) | Start here: accounts, access, first-hour checklist, open items, known limits |
| [docs/FRAMEWORK.md](docs/FRAMEWORK.md) | The compliance rules: marking, grade bands, priorities, route to 80%, roles, escalation |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it is built: components, data model, API, sign-in, front end |
| [docs/DATA.md](docs/DATA.md) | Where every number came from, how it was checked, the import pipeline |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Runbooks: deploy, roll back, back up, change the access code, add users, troubleshoot |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why things are the way they are |
| [PROMPT.md](PROMPT.md) | The original brief the first version was built against |

## Quick start (local)

Requires Node.js 20 or later. Python 3.9+ is only needed to re-import reports.

```bash
npm install
cp .dev.vars.example .dev.vars   # pick any local access code in this file
npm run setup:local              # local database + the 275 audit photos
npm run dev                      # http://localhost:8787
```

Sign in with any name and the code from `.dev.vars`. The local copy has the same data as production had on 26 Sep 2026.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local server on http://localhost:8787 |
| `npm test` | 16 tests: the scoring rules, and the imported data checked against the reports' own totals and conclusions |
| `npm run check` | Syntax check + tests |
| `npm run deploy` | Check, then deploy to Cloudflare |
| `npm run db:migrate:remote` | Apply new database migrations to production |
| `npm run backup` | Export the production database to `backups/` |
| `npm run logs` | Stream live logs |
| `npm run import:parse` → `import:prepare` → `import:sql` | Re-run the report import pipeline (see [docs/DATA.md](docs/DATA.md)) |

## What is in this repository

```
public/                  the web app, served as static files
  index.html             page shell: nav rail (desktop) / bottom bar + button (phone)
  app.js                 pages, router, charts, the phone audit flow
  app.css                Material 3 styles; all colours are tokens at the top (Bookends palette)
  rules.js               THE FRAMEWORK AS CODE: marking, bands, priorities, route to 80%. Shared with the server.
src/worker.js            the API (/api/*): sign-in, scoring, statuses, fix plans, uploads
migrations/              database: 0001 schema · 0002 the three checklists · 0003 the Aug–Sep 2026 audits
data/
  checklists.json        the three Bookends checklists (source of migration 0002)
  import-2026-09.json    the 25 imported audits, line by line (source of migration 0003)
  photos/                the 275 photos taken from the reports (uploaded to Workers KV)
source-reports/          the 25 original files: 19 Word audit reports + 6 PDF maintenance dockets
scripts/                 parse-reports.py → prepare-import.py → build-sql.mjs, and upload-photos.mjs
test/                    rules.test.mjs, data.test.mjs
wrangler.jsonc           Cloudflare configuration: account, D1, KV, rate limit, variables
```

## Confidentiality

This repository contains Bookends' internal audit reports, photos taken inside its kitchens, and account identifiers.
It is proprietary to Bookends Hospitality Pvt. Ltd. Keep it in a private repository and share it only with people who work on it.
It contains **no passwords or secrets**: the team access code lives only in Cloudflare (see [docs/OPERATIONS.md](docs/OPERATIONS.md)).
