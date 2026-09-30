# Operations

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

Changes to the database schema or data go in a **new** file in `migrations/` (`0004_…sql`), never in an old one. Apply them before deploying code that needs them:

```bash
npx wrangler d1 migrations list bookends-compliance --remote   # what has run
npm run db:migrate:remote
```

## Roll back

```bash
npx wrangler deployments list        # recent deployments and their version IDs
npx wrangler rollback <version-id>   # back to an earlier version of the code
```

A rollback restores code, not data. For data, see Backups.

## Backups and restore

```bash
npm run backup    # full SQL export of production → backups/bookends-compliance-YYYY-MM-DD.sql (git-ignored)
```

- Make one before any data migration, and keep a copy somewhere other than this laptop.
- **D1 Time Travel** can restore the database to any minute in the last 7 days (free plan):
  ```bash
  npx wrangler d1 time-travel info bookends-compliance
  npx wrangler d1 time-travel restore bookends-compliance --timestamp=2026-09-30T10:00:00+05:30
  ```
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
2. Write a new migration inserting the template and its items (the insert part of `scripts/build-sql.mjs` shows the shape), plus `UPDATE templates SET active = 0 WHERE id = …` for the old one.
3. `npm run db:migrate:remote`. New audits use the new checklist; old audits keep theirs.

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
