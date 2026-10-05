-- People sign in with a username chosen by the Compliance Head, not an email.
-- The password the Compliance Head sets is the person's password (must_change now defaults to 0).
-- SQLite cannot drop a NOT NULL UNIQUE column in place, so the table is rebuilt; any existing account keeps its email as its username.

CREATE TABLE users_new (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,  -- what they type to sign in: letters, numbers, . _ -
  name          TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'manager',      -- head | manager
  site_id       INTEGER REFERENCES sites(id),             -- the unit a manager looks after (NULL for a Compliance Head)
  password_hash TEXT    NOT NULL,
  must_change   INTEGER NOT NULL DEFAULT 0,              -- 1 = asked to choose a new password at next sign-in
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT,
  last_login_at TEXT
);
INSERT INTO users_new (id, username, name, role, site_id, password_hash, must_change, active, created_at, created_by, last_login_at)
  SELECT id, email, name, role, site_id, password_hash, must_change, active, created_at, created_by, last_login_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
