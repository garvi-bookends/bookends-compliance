# Handover: Bookends Compliance

Written 30 Sep 2026 for whoever takes this project over. If a question isn't answered here or in `docs/`, the doc has a gap: please add the answer once you find it.

## 1. What this is, in one paragraph

Bookends Hospitality appointed **Vishal Patel** as Compliance Head. He audits every unit for food safety (an internal FSSAI Schedule 4 checklist) and maintenance (an inspection docket).
This web app holds those audits and shows, for each unit, **where it is** (visit 1 → visit 2), **where it has to be** (80% Satisfactory), and **what to fix first** (a prioritised fix plan and the shortest route to 80%).
He can also run new audits in it on his phone. The first 25 audits (Aug–Sep 2026) were imported from his Word and PDF reports.
It runs on Cloudflare (Worker + D1 database + KV file store) on the free plan.

## 2. What you are receiving

| Item | Where |
| --- | --- |
| The full source code, with its git history | this repository |
| The live app | https://bookends-compliance.capichesecretmenu.workers.dev |
| The 25 original reports it was built from | `source-reports/` |
| The imported data, line by line, and all 275 photos | `data/` |
| A pipeline that rebuilds the imported data from the reports, byte for byte | `scripts/`, explained in [docs/DATA.md](docs/DATA.md) |
| 16 automated tests, including checks against the reports' own totals | `test/`, run with `npm test` |
| Documentation | `README.md`, `docs/` |

**Not included, on purpose: the team access code.** Ask the project owner for it in person or on a separate channel, never in the same message as this package.

## 3. Access you need, and who gives it

| You need | Why | Who gives it | How |
| --- | --- | --- | --- |
| The team access code | To sign in to the live app | Project owner | In person / separate message |
| A seat on the Cloudflare account | To deploy, read logs, query the database | Project owner (the account holder, yashghodke.dome@gmail.com) | Cloudflare dashboard → Manage Account → Members → Invite, role **Administrator** or **Workers Admin**, plus D1 and KV edit |
| *or* a Cloudflare API token instead of a seat | Same, for scripts or CI | Project owner | My Profile → API Tokens → template "Edit Cloudflare Workers", add **D1: Edit**. You then `export CLOUDFLARE_API_TOKEN=…` |
| Answers about the compliance rules | Marking, bands, what counts as a fix | Vishal Patel (Compliance Head) | |

Cloudflare resources this app uses (all in account `d6ca0c92c61defcc94c03ed6bd69a5dd`, "Yashghodke.dome@gmail.com's Account"):

| Resource | Name | ID |
| --- | --- | --- |
| Worker | `bookends-compliance` | served at `bookends-compliance.capichesecretmenu.workers.dev` |
| D1 database (APAC) | `bookends-compliance` | `e76f4c69-650c-4d00-bdb7-c4c1c0710a19` |
| KV namespace (photos, proof, scans) | `bookends-compliance-files` | `66c40c0fbba34765b6d59da85019fb22` |
| Rate limiter (sign-in) | `LOGIN_LIMIT` | namespace `1001`, 5 attempts/min/IP |
| Secret | `ACCESS_CODE` | the team access code |

The same account holds unrelated things (for example a D1 database `bookends-predictor` and a KV namespace `BUGS`). **Don't touch those.**

## 4. Your first hour

1. Unzip or clone the repository. Install Node.js 20+ (`node -v`).
2. `npm install`, then `npm test`. All 16 tests should pass.
3. `cp .dev.vars.example .dev.vars`, pick a local code, then `npm run setup:local` and `npm run dev`. Open http://localhost:8787 and sign in.
4. Read [docs/FRAMEWORK.md](docs/FRAMEWORK.md) (15 minutes). Every number on screen follows from it.
5. Open the live app with the team code and compare it with your local copy. They should match, apart from anything people have changed since 26 Sep.
6. Once you have Cloudflare access: `npx wrangler whoami`, then `npm run logs` to watch live traffic. Deploy nothing until you have read [docs/OPERATIONS.md](docs/OPERATIONS.md).

## 5. Where things stand (30 Sep 2026)

- **In use:** 11 units (7 restaurants, 4 central kitchens) in Surat and Ahmedabad.
- **Food safety:** 8 units audited twice. Their average rose from 57.8% to 67.2%, and 7 of 8 improved. No unit is at 80% yet. Overall average of the latest visits: 64.1%.
- **Maintenance:** 6 restaurants audited once. Average 75.7%; only Capiche Piplod is at 80%+ (83.1%).
- **Fix plan:** 310 open fixes: 117 Priority 1, 120 Priority 2, 73 Priority 3; 128 of them are paperwork.
  Deadlines were counted from the import date (26 Sep), so every Priority 1 fix passed its deadline on 28 Sep and now shows as overdue until someone updates it. That is the policy working, not a bug.
- **Sign-in:** team access code set on 26 Sep and changed once by the owner. Sessions last 30 days.

## 6. Open items that need a person, not code

| # | Item | Owner | Where it shows |
| --- | --- | --- | --- |
| 1 | Confirm the **Central Bakery Kitchen, Ahmedabad, visit 1** score: the report prints 62.5%, but its lines and its conclusion give 54.2% (used) | Vishal Patel | Data note on that audit |
| 2 | Confirm **Beshak Dumas line 37**: the table says Compliant, the report total counts it as Major (used) | Vishal Patel | Data note on that audit |
| 3 | Confirm the **dates of both Central Hot Kitchen visit-1 reports** (none written; 20 Aug assumed) | Vishal Patel | Data note on those audits |
| 4 | Send the wording of **FSSAI checklist lines 31, 37 and 50**. They were N/A in every report, so they aren't in the app | Vishal Patel | Framework → checklists |
| 5 | Fill the **licence register**: FSSAI, Fire NOC, water test, pest control, medical fitness, FoSTaC… with expiry dates. It is empty because no report had dates | Vishal Patel / unit managers | Licences page |
| 6 | Add **unit manager names and phones**. New fixes are assigned to the unit manager automatically | Owner | Units → Edit |
| 7 | **Maintenance dockets** for Beshak Dumas and the four central kitchens (none yet) | Vishal Patel | Units page shows "not yet" |
| 8 | Decide on **per-person logins** (Cloudflare Access) instead of one shared code | Owner | [docs/OPERATIONS.md](docs/OPERATIONS.md#per-person-logins-cloudflare-access) |
| 9 | Optional: a **custom domain** (e.g. `compliance.<company domain>`) | Owner | [docs/OPERATIONS.md](docs/OPERATIONS.md#custom-domain) |

## 7. Known limitations (by design, for now)

- **One shared access code.** Everyone who signs in can do everything, and names are self-declared. Cloudflare Access fixes both (item 8).
- **No notifications.** Nothing is e-mailed or sent to WhatsApp; people have to open the app.
- **Visit 1 and visit 2 used different checklists** (39 checkpoints / 94 marks vs ~51 lines / ~140 marks). The change between them is a direction, not an exact measure. The app says so beside the chart.
- **Offline:** an audit in progress is saved on the phone, but submitting needs a connection.
- **Photos live in Workers KV, not R2.** R2 needs a payment method on the account. KV's free plan allows 1,000 writes a day (plenty), with files up to 8 MB each (the app's own cap).
- **Backups are manual:** `npm run backup`, plus D1 Time Travel (7 days on the free plan).
- **Free-plan CPU limit:** 10 ms per request. Plenty today. If the data grows by 50× and pages start failing, move to Workers Paid ($5/month).
- **Fonts and icons load from Google Fonts.** Without internet access to Google, the app falls back to system fonts and the icon names show as text.

## 8. Where to go next (ideas, not commitments)

Weekly progress e-mail to the founders · WhatsApp reminders for overdue Priority 1 fixes · manager logins limited to their own unit · PDF export in the Bookends docket style · licence expiry reminders · daily temperature logs · offline sync.

## 9. People

| Person | Role in this project |
| --- | --- |
| Project owner (yashghodke.dome@gmail.com) | Commissioned the app; holds the Cloudflare account; sets the access code |
| Vishal Patel | Compliance Head: conducts the audits, owns the rules, verifies fixes |
| Nikil Malviya (spelt Malaviya in some reports) | Prepared the Word reports from Vishal's audits |
