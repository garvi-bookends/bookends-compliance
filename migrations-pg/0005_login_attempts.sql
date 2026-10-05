-- Sign-in attempts per IP, so someone guessing passwords is slowed to 5 tries a minute (src/platform.js).
-- Old rows are cleared as it goes; nothing else reads this table.
CREATE TABLE login_attempts (
  key text        NOT NULL,
  at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempts ON login_attempts (key, at);
