-- Alerts a person has marked done, so they stop showing in that person's bell (other people still see theirs).
-- alert_key names the alert, its date and its stage, e.g. 'fix:12:2026-10-03:soon' or 'licence:3:2026-10-20:soon':
-- an alert marked done while "due soon" comes back once it is overdue (or expired), or if its due or expiry date changes.
CREATE TABLE alert_dismissals (
  user_key  TEXT NOT NULL,   -- 'u:<user id>', or 'n:<name>' for a team-code session
  alert_key TEXT NOT NULL,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_key, alert_key)
);
