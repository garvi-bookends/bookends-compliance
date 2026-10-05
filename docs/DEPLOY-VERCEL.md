# Deploy: Vercel + Supabase + Vercel Blob

How the app runs in production, and how to set it up from nothing.

| Part | Where | Notes |
| --- | --- | --- |
| Website (`public/`) | Vercel, static files | No build step. `vercel.json` → `outputDirectory: public` |
| API (`/api/*`) | Vercel Function `api/index.js`, region `bom1` (Mumbai) | Calls `src/api.js`. `vercel.json` rewrites `/api/<path>` to it |
| Database | Supabase PostgreSQL, region Mumbai | Tables from `migrations-pg/`. Sign-in rate limit (5 a minute per IP) is counted here too |
| Photos and scans | Vercel Blob, **private** store | Only served through `/api/files/…` to people who are signed in |

## Environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production), and in `.env` for local work.

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **Transaction pooler** connection string (port **6543**), with the database password filled in |
| `ACCESS_CODE` | A long random string. Used once to create the first Compliance Head; it also signs session cookies, so changing it signs everyone out |
| `BLOB_READ_WRITE_TOKEN` | Added by Vercel when you connect the Blob store to the project |
| `TZ_OFFSET_MINUTES` | Optional. Default `330` (IST) |

Locally, leave `BLOB_READ_WRITE_TOKEN` out: photos then go to the `.data/files/` folder.

## First-time setup

### 1. Supabase

1. supabase.com → **New project**. Region: **South Asia (Mumbai)**. Set a database password and keep it safe.
2. When it is ready: **Connect** (top of the project page). Copy two strings:
   - **Session pooler** (port 5432): for running the scripts below from your computer.
   - **Transaction pooler** (port 6543): for Vercel.
3. Put the password into both in place of `[YOUR-PASSWORD]`.

### 2. Tables and data

In the project folder (PowerShell). `$env:` lasts only for this terminal window and does not change `.env`.

```powershell
$env:DATABASE_URL = "<Session pooler string>"
npm run db:migrate
```

This creates the tables and loads the three checklists and the 25 imported Aug–Sep 2026 audits. Then copy your current data over it. Pick **one**:

```powershell
# a) the PostgreSQL on this computer (what `npm run dev` has been using)
npm run db:copy -- --from-pg "postgres://postgres:PASSWORD@localhost:5432/bookends_compliance"

# b) the old live Cloudflare site (needs: npx wrangler login, with the Cloudflare account that owns it)
npm run db:copy -- --from-d1-remote
```

`db:copy` empties the Supabase tables first, then copies every row in one transaction. If it fails, nothing changes.

### 3. Vercel project and Blob store

1. vercel.com → **Add New → Project**. Either import the Git repository, or from this folder run `npx vercel` and answer the questions (link to a new project; it finds `vercel.json`, no build settings to change).
2. In the project: **Storage → Create → Blob**. Choose **Private** access, and connect it to the project (all environments). Vercel adds `BLOB_READ_WRITE_TOKEN` itself.
3. **Settings → Environment Variables:** add `DATABASE_URL` (the Transaction pooler string) and `ACCESS_CODE`.

### 4. Photos

Copy the Blob token from Vercel (Storage → your store → `.env.local` tab, or Settings → Environment Variables), then:

```powershell
$env:BLOB_READ_WRITE_TOKEN = "<token>"
npm run photos:copy -- --import            # the 275 imported audit photos (data/photos)
```

Then the photos taken in the app, from the same place you copied the data from in step 2:

```powershell
npm run photos:copy -- --from-local        # a) taken while using the app on this computer (.data/files)
npm run photos:copy -- --from-kv-remote    # b) taken in the old live Cloudflare app (needs: npx wrangler login)
```

Copying is safe to repeat: a file already there is replaced with the same bytes.

### 5. Deploy

```powershell
npm run deploy        # syntax check + tests, then: npx vercel --prod
```

With a Git repository connected, pushing to the main branch deploys too.

Open the address Vercel shows (e.g. `https://bookends-compliance.vercel.app`), sign in, and check: the overview shows the units, an audit opens with its photos, and a new photo uploads.

## Everyday

| Task | How |
| --- | --- |
| Deploy a change | `npm run deploy`, or push to the main branch |
| Roll back | Vercel → Deployments → an older one → **Promote to Production** (code only; data is not rolled back) |
| Logs | Vercel → Project → **Logs** |
| Database change | New file in `migrations-pg/` (never edit an old one), then `$env:DATABASE_URL = "<Session pooler>"; npm run db:migrate`, then deploy |
| Back up the database | Supabase → Database → Backups (daily on paid plans), or `pg_dump "<Session pooler string>" -Fc -f backups/bookends-YYYY-MM-DD.dump` |
| Back up photos | `npx vercel blob list` shows them; they are not in database backups |
| Custom domain | Vercel → Project → Settings → Domains |

## Limits worth knowing

- **Uploads up to 4 MB** (Vercel Functions take request bodies up to 4.5 MB). Phone photos are shrunk to 1600 px JPEG before upload, so this only affects large PDF scans.
- **Function time:** 30 seconds per request (`vercel.json`). Submitting an audit takes well under a second.
- **Supabase free plan** pauses a project after a week with no use and has no daily backups. For real data use the Pro plan.
- **TLS to Supabase** is encrypted, but the certificate chain is not checked (Supabase's chain is not in Node's trust store); see `pgConfig` in `src/db.js`.

## After the move

When the Vercel site is checked and the old Cloudflare data is copied, `wrangler.jsonc`, the `wrangler` dev dependency and the `.wrangler/` folder can be deleted, and the old Worker removed in the Cloudflare dashboard.
