-- Personal accounts, added by an admin (Settings → Team members). The shared team access code keeps working alongside them.
-- Passwords are never stored: password_hash is 'pbkdf2$<iterations>$<salt>$<hash>' (PBKDF2-SHA256, base64url).

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'member',   -- admin | member
  password_hash TEXT    NOT NULL,
  must_change   INTEGER NOT NULL DEFAULT 1,          -- 1 = signed in with a temporary password; asked to choose their own
  active        INTEGER NOT NULL DEFAULT 1,          -- 0 = disabled: cannot sign in, open sessions stop working
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT,
  last_login_at TEXT
);
