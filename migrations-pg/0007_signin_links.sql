-- Personal sign-in links (Settings → Team members → Get link): opening one signs that person straight in.
-- One row per person: a random version; the link is the account id plus an HMAC of it keyed with ACCESS_CODE, so the
-- link itself is never stored. "New link" replaces the version, which cancels the old link.
-- The API also creates this table on first use (CREATE TABLE IF NOT EXISTS), so running this file is optional.
CREATE TABLE IF NOT EXISTS signin_links (
  user_id    integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version    text    NOT NULL,
  created_at text    NOT NULL DEFAULT utc_now(),
  created_by text
);
