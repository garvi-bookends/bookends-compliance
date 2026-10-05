# Operations

> **Hosting has moved to Vercel + Supabase + Vercel Blob** (Oct 2026). Deploy, roll back, logs, backups and database changes are now in [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md).
> The Cloudflare commands below (`wrangler …`) only apply to the old site until it is switched off. The parts about using the app (team members, offline audits, checklists, rules) still apply.

Run every command **from the repository folder**. Wrangler reads `wrangler.jsonc` from the current folder: that's how it knows the Worker name and account.
From anywhere else, add `--name bookends-compliance` (see Troubleshooting).

## Before anything: get Cloudflare access

You need either a seat on the Cloudflare account (ask the owner to invite you; see [HANDOVER.md](../HANDOVER.md#3-access-you-need-and-who-gives-it)) or an API token.

```bash
npx wrangler login          # with a seat: opens the browser once
npx wrangler whoami         # should list account d6ca0c92c61defcc94c03ed6bd69a5dd
```

With a token instead: `export CLOUDFLARE_API_TOKEN=<token>`. The account ID is already in `wrangler.jsonc`.

## Deploy

```bash
npm run deploy              # syntax check + 16 tests, then wrangler deploy
```

Then open https://bookends-compliance.capichesecretmenu.workers.dev and hard-reload (Cmd/Ctrl+Shift+R). Static files are served with `max-age=0`, so users get the new version on their next page load.

Changes to the database schema or data go in a **new** file in `migrations-pg/` (`0005_…sql`), never in an old one. Apply them before deploying code that needs them:

```bash
npm run db:migrate          # applies the new files; the schema_migrations table lists what has run
```

## PostgreSQL

The app keeps its data in PostgreSQL (database `bookends_compliance`). The Worker reaches it through **Hyperdrive** (binding `HYPERDRIVE` in `wrangler.jsonc`); `src/db.js` gives the code the same `prepare/bind/first/all/run/batch` calls it used with D1, and `batch` runs in one transaction.

- **Connection details** live in `.env` (git-ignored; copy `.env.example`): `DATABASE_URL` for the scripts, `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` for `npm run dev`. Never put the password in `wrangler.jsonc`.
- **Schema:** `migrations-pg/0001_schema.sql`. Timestamps stay UTC `'YYYY-MM-DD HH:MM:SS'` text (`utc_now()`) and flags stay 0/1, as on D1, so the front end did not change. `migrations/` holds the old D1 migrations; `npm run import:sql` writes the seed files to both folders.
- **Production:** Cloudflare's servers must reach the database over the internet; `localhost` on an office PC is not reachable from there. Put PostgreSQL on a host with a public address (or behind a Cloudflare Tunnel), then:
  ```bash
  npx wrangler hyperdrive create bookends-compliance --connection-string="postgres://USER:PASSWORD@HOST:5432/bookends_compliance"
  ```
  Put the id it prints in `wrangler.jsonc` (`hyperdrive[0].id`, now a placeholder), run `npm run db:migrate` against that database, copy the live data across (`npm run db:copy-from-d1 -- --remote`), then `npm run deploy`.
- **Moving data from D1:** `npm run db:copy-from-d1 -- --remote` (live D1, needs `npx wrangler login`) or `-- --local`. It empties the PostgreSQL tables first and copies every row in one transaction; if anything fails, nothing changes.

## Audits with no network

An auditor can carry on and finish an audit with no signal:

- Ratings, remarks and the date are saved on the phone as they go (as before). A photo taken with no network is kept on the phone, shown with a small cloud-off mark, and uploaded later.
- **Submit with no network** puts the audit in an outbox on the phone. A strip at the top of every page says it is waiting, and an **Offline** chip shows in the top bar. When the network is back, the app sends it by itself: right away, and then every 30 seconds. **Send now** forces a try. The finish time recorded is when Submit was pressed.
- Each audit carries an id made on the phone (`client_id`). If the server saved it but the phone never heard back, the resend gets the same audit, never a second copy.
- If the server turns a waiting audit down (for example, a unit was made inactive), the strip shows the reason with **Open to fix** (back into the form, with every rating and photo) or **Delete**.
- After a first visit online, the app also opens with no network, served from copies kept on the phone (`public/sw.js`; network first, so a deploy shows straight away). This needs https (production) or `localhost`; it does not work on the `http://<ip>:8787` Wi-Fi address. Signing out deletes the saved data copies. Audits still waiting stay on the phone and are sent when the same person signs in there again.

## Team members (personal accounts)

- **First time:** sign in with the team code → Settings → **Create the Compliance Head**: name, username, password (twice), Create. Then sign out and sign in with that username. From then on only the Compliance Head adds people.
- **Add a unit manager:** on the unit's page, **Add unit manager** (role and unit already filled in), or Settings → Team members → **Add person**: Name, Username (suggested from the name), Role, Unit, Password, Confirm password, **Create**. Tell them their username and password; they can change the password in Settings. To move someone to another unit, **Edit** them and pick the new unit; it applies at once.
- **Forgotten password:** the Compliance Head uses **New password** next to the person, types it twice and tells them.
- **Someone leaves:** **Edit** → untick "Can sign in". They are signed out at once; their past audits and changes stay under their name.
- **Locked out of every Compliance Head account:** the team code no longer works once a Compliance Head exists, so a developer promotes someone directly: run `UPDATE users SET role = 'head', site_id = NULL, active = 1 WHERE username = 'their.username';` in the `bookends_compliance` database (psql or pgAdmin).
- **The team code is for first-time setup only.** It works until the first Compliance Head exists, then it is refused and the sign-in page shows only username + password.
- Keep the `ACCESS_CODE` secret set: it also signs everyone's session cookie, so changing it signs **everyone** out.

## Roll back

```bash
npx wrangler deployments list        # recent deployments and their version IDs
npx wrangler rollback <version-id>   # back to an earlier version of the code
```

A rollback restores code, not data. For data, see Backups.

## Backups and restore

```bash
pg_dump -U postgres -Fc -f backups/bookends-compliance-YYYY-MM-DD.dump bookends_compliance   # backups/ is git-ignored
pg_restore -U postgres -d bookends_compliance --clean backups/bookends-compliance-YYYY-MM-DD.dump
```

- `pg_dump` comes with PostgreSQL (on Windows in `C:/Program Files/PostgreSQL/18/bin`). pgAdmin's Backup/Restore does the same.
- Make one before any data migration, and keep a copy somewhere other than this machine.
- **Photos.** Imported audit photos are also in `data/photos/` (`npm run photos:remote` re-uploads them). Photos taken in the app live only in KV. To list or copy them:
  ```bash
  npx wrangler kv key list --binding FILES --remote --prefix evidence/2026-
  npx wrangler kv key get --binding FILES --remote "evidence/2026-10/<uuid>.jpg" > photo.jpg
  ```

## Look at the data

```bash
npx wrangler d1 execute bookends-compliance --remote --command "SELECT name, city FROM sites"
npx wrangler d1 execute bookends-compliance --remote --command "SELECT priority, COUNT(*) FROM findings WHERE status IN ('open','in_progress') GROUP BY priority"
```

Add `--local` instead of `--remote` for your local copy. Treat `--remote` writes like surgery: back up first.

## Logs

```bash
npm run logs      # live stream (wrangler tail)
```

Logs are also in the Cloudflare dashboard: Workers & Pages → `bookends-compliance` → Logs (observability is on).

## The team access code

**Change it** (this signs everyone out; share the new code on a separate channel):

```bash
npx wrangler secret put ACCESS_CODE --name bookends-compliance
```

Type the code at the prompt, choosing 10+ characters. Wrangler never shows it again, and there is no way to read the current code back, only to replace it.

- **Someone forgot the code:** tell them again. Nothing is stored per person.
- **Someone left the team:** change the code.

### Per-person logins (Cloudflare Access)

This is optional, and the recommended next step once more than a handful of people use the app. It is free for up to 50 users.

1. Cloudflare dashboard → Zero Trust (the first visit sets up a team name) → Access → Applications → Add → **Self-hosted**.
2. Domain: `bookends-compliance.capichesecretmenu.workers.dev` (or the custom domain). Policy: **Allow**, "Emails", listing each person. Login method: one-time PIN.
3. In `wrangler.jsonc` set `"TRUST_ACCESS": "1"`, then `npm run deploy`. The app then records each person's e-mail instead of a typed name.
   The shared-code screen still works as a fallback; to require Access only, remove the `ACCESS_CODE` secret: `npx wrangler secret delete ACCESS_CODE --name bookends-compliance`.
4. Also protect preview URLs in the Worker's settings (Settings → Domains & Routes), or turn them off.

## Custom domain

The domain must be on the same Cloudflare account. Workers & Pages → `bookends-compliance` → Settings → Domains & Routes → Add → Custom domain, e.g. `compliance.<company domain>`.
Nothing in the code changes. If Access is on, add the new domain to the Access application too.

## Everyday admin in the app

These don't need a developer:

| Task | Where |
| --- | --- |
| Add, rename or archive a unit; set its manager | Units → unit → Edit, or Units → Add unit |
| Record a licence and its expiry, attach the scan | Licences → Add licence, or on the unit page |
| Run an audit | "New audit" (phone-friendly; drafts survive closing the page) |
| Update, verify, send back or reopen a fix | Fix plan → the fix |

## Changing a checklist

Never edit `template_items` rows that past audits used. Instead:

1. Add the new checklist to `data/checklists.json` with a **new id** (4, 5…), `active: 1`, and set the old one to `active: 0`.
2. Write a new migration in `migrations-pg/` inserting the template and its items (the insert part of `scripts/build-sql.mjs` shows the shape), plus `UPDATE templates SET active = 0 WHERE id = …` for the old one.
3. `npm run db:migrate`. New audits use the new checklist; old audits keep theirs.

## Changing the rules

The marking, bands, priorities, deadlines and target all live in `public/rules.js`. Change them there, update `docs/FRAMEWORK.md`, run `npm test` (adjust the tests if the change is intended), then deploy.
Stored audit scores don't change retroactively; statuses, routes and priorities are recomputed on every request.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Required Worker name missing` | Wrangler was run outside the repository folder | `cd` into the repository, or add `--name bookends-compliance` |
| Sign-in page says "Sign-in is not set up yet" | No `ACCESS_CODE` secret, or the page loaded before it was set | Set the secret (above), then reload the page |
| "Too many sign-in attempts" | 5 attempts in a minute from one connection | Wait a minute. Everyone in the same office shares one IP |
| Everyone was suddenly signed out | The access code was changed | Expected. Sign in with the new code |
| `Please enable R2 through the Cloudflare Dashboard [code: 10042]` | Something tried to use R2 | This app doesn't use R2; files are in KV. Check you're on the current code |
| `Authentication error [code: 10000]` from `wrangler d1 …` | Transient token issue | Run it again; if it persists, `npx wrangler login` |
| Icons show as words ("restaurant", "handyman") | Google Fonts blocked or offline | Needs internet access to fonts.googleapis.com |
| A new deploy doesn't show | The browser has the old page | Hard reload (Cmd/Ctrl+Shift+R) |
| Photo upload fails with "larger than 8 MB" | The app's cap per file | Phones shrink photos automatically; PDFs must be under 8 MB |
| Requests fail with a CPU-limit error in the logs | The free plan's 10 ms CPU per request | Move to Workers Paid ($5/month); no code change |

## Free-plan limits (current usage is far below all of them)

| Service | Limit |
| --- | --- |
| Workers | 100,000 requests/day, 10 ms CPU per request |
| D1 | 5 GB storage, 5 million rows read and 100,000 rows written per day, Time Travel 7 days |
| KV | 1 GB storage, 100,000 reads and 1,000 writes per day (each photo upload is a write) |
| Rate limiting | Included |
