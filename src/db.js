import pg from 'pg';

// PostgreSQL behind the same small API the app used with D1: prepare(sql).bind(...).first() / .all() / .run(), and
// batch([...]) that runs statements in one transaction. SQL keeps D1's `?` placeholders; they become $1, $2, … here.

// COUNT(*) comes back as bigint and AVG/SUM as numeric, which pg returns as strings; the app expects numbers.
const types = {
  getTypeParser(oid, format) {
    if (oid === 20) return (v) => (v === null ? null : Number(v)); // int8
    if (oid === 1700) return (v) => (v === null ? null : Number(v)); // numeric
    return pg.types.getTypeParser(oid, format);
  },
};

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
/**
 * pg settings for a connection string. Hosted databases (Supabase) need TLS; their certificate chain is not in Node's
 * trust store, so the connection is encrypted without checking the chain. A local database needs no TLS.
 * sslmode is taken out of the string because pg would let it override the ssl setting here.
 */
export function pgConfig(connectionString) {
  const u = new URL(connectionString);
  u.searchParams.delete('sslmode');
  const local = LOCAL_HOSTS.includes(u.hostname);
  return { connectionString: u.toString(), ssl: local ? false : { rejectUnauthorized: false }, types };
}

/** One pool per server instance, shared by its requests. Supabase's transaction pooler (port 6543) suits serverless. */
export const createPool = (connectionString, max = 5) => new pg.Pool({ ...pgConfig(connectionString), max, idleTimeoutMillis: 10000 });

/** `?` → `$n`, leaving question marks inside quoted strings alone. */
function numbered(sql) {
  let n = 0, out = '', quote = null;
  for (const ch of sql) {
    if (quote) { if (ch === quote) quote = null; out += ch; continue; }
    if (ch === "'" || ch === '"') quote = ch;
    out += ch === '?' ? `$${++n}` : ch;
  }
  return out;
}

class Statement {
  constructor(pool, sql, params = []) { this.pool = pool; this.sql = sql; this.text = numbered(sql); this.params = params; }
  bind(...params) { return new Statement(this.pool, this.sql, params); }
  async exec(client = this.pool) {
    const r = await client.query(this.text, this.params.map((p) => (p === undefined ? null : p)));
    return { results: r.rows, meta: { changes: r.rowCount ?? 0 } };
  }
  async first() { return (await this.exec()).results[0] ?? null; }
  all() { return this.exec(); }
  run() { return this.exec(); }
}

/** The D1-style database over a pg Pool. */
export function openDb(pool) {
  return {
    prepare: (sql) => new Statement(pool, sql),
    /** Runs every statement in one transaction, like D1's batch: all of them happen, or none. */
    async batch(stmts) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = [];
        for (const s of stmts) out.push(await s.exec(c));
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
