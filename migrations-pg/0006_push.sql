-- Phone and computer notifications (Web Push) for alerts: Settings → Notifications.
-- One row per browser that switched notifications on, belonging to the person signed in there.
CREATE TABLE push_subscriptions (
  endpoint   text        PRIMARY KEY,                    -- the browser's push address
  user_id    integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     text        NOT NULL,
  auth       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);

-- Which alerts each person has already been sent, so the daily send only pops up what is new
-- (an alert's key changes when it goes from due soon to overdue, so it pops up once more then).
CREATE TABLE push_sent (
  user_id   integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_key text        NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, alert_key)
);
