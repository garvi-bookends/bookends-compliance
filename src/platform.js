import { createPool, openDb } from './db.js';
import { filesFromEnv } from './files.js';

// Builds the `env` that src/api.js works with, from environment variables. Shared by the Vercel Function (api/index.js)
// and the local server (scripts/dev-server.mjs). Created once per server instance and reused by its requests.

/** At most `limit` sign-in attempts per IP per `seconds`, counted in PostgreSQL so every server instance agrees. */
function loginLimit(pool, limit = 5, seconds = 60) {
  return {
    async limit({ key }) {
      const { rows } = await pool.query(
        `WITH added AS (INSERT INTO login_attempts (key) VALUES ($1))
         SELECT count(*)::int AS n FROM login_attempts WHERE key = $1 AND at > now() - make_interval(secs => $2)`, [key, seconds]);
      if (Math.random() < 0.02) pool.query("DELETE FROM login_attempts WHERE at < now() - interval '1 day'").catch(() => {});
      return { success: rows[0].n < limit };
    },
  };
}

let cached = null;
export function appEnv(e = process.env) {
  if (cached) return cached;
  // DATABASE_URL if set; otherwise POSTGRES_URL, which the Supabase integration adds on Vercel (its pooled connection).
  const url = e.DATABASE_URL || e.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL (or POSTGRES_URL) is not set');
  const pool = createPool(url);
  cached = {
    ACCESS_CODE: e.ACCESS_CODE,
    TZ_OFFSET_MINUTES: e.TZ_OFFSET_MINUTES || '330', // business-day boundary; 330 = IST (UTC+5:30)
    DB: openDb(pool),
    FILES: filesFromEnv(e),
    LOGIN_LIMIT: loginLimit(pool),
  };
  return cached;
}
