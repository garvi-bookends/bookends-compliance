-- Bookends compliance: core schema
-- Dates are ISO 'YYYY-MM-DD' (local business date); timestamps are UTC 'YYYY-MM-DD HH:MM:SS'.

CREATE TABLE sites (
  id            INTEGER PRIMARY KEY,
  key           TEXT UNIQUE,                          -- stable slug used by imports
  name          TEXT    NOT NULL,
  brand         TEXT,
  area          TEXT,
  city          TEXT,
  kind          TEXT    NOT NULL DEFAULT 'restaurant', -- restaurant | kitchen
  manager       TEXT,
  manager_phone TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A checklist. Items are never edited in place: a changed checklist is a new template.
CREATE TABLE templates (
  id             INTEGER PRIMARY KEY,
  domain         TEXT    NOT NULL CHECK (domain IN ('food', 'maintenance')),
  scheme         TEXT    NOT NULL,                     -- fssai1 | fssai2 | docket (rating labels, see rules.js)
  name           TEXT    NOT NULL,
  description    TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  frequency_days INTEGER NOT NULL DEFAULT 30,
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE template_items (
  id          INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  code        TEXT    NOT NULL,                        -- L16 (ref 16) · K19 · M35
  section     TEXT    NOT NULL,
  area        TEXT,
  applies     TEXT    NOT NULL DEFAULT 'Both',         -- Restaurant | CPK | Both
  text        TEXT    NOT NULL,
  guidance    TEXT,                                    -- "How to verify"
  critical    INTEGER NOT NULL DEFAULT 0,              -- ★
  criticality TEXT,                                    -- maintenance docket: Critical | High | Medium | Low
  weight      REAL    NOT NULL,                        -- marks for full compliance
  kind        TEXT    NOT NULL DEFAULT 'physical',     -- paperwork | physical
  sort        INTEGER NOT NULL
);
CREATE INDEX idx_items_template ON template_items(template_id, sort);

CREATE TABLE audits (
  id           INTEGER PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES sites(id),
  template_id  INTEGER NOT NULL REFERENCES templates(id),
  domain       TEXT    NOT NULL CHECK (domain IN ('food', 'maintenance')),
  audit_date   TEXT    NOT NULL,
  auditor      TEXT,
  prepared_by  TEXT,
  audit_type   TEXT,
  time_range   TEXT,
  score        REAL,                                   -- 0..100, one decimal
  earned       REAL,
  possible     REAL,
  band         TEXT CHECK (band IN ('exemplar', 'satisfactory', 'improve', 'noncompliance')),
  summary      TEXT,
  source       TEXT    NOT NULL DEFAULT 'app',         -- app | import
  source_ref   TEXT,                                   -- original file name for imports
  flag         TEXT,                                   -- data-quality note for the Compliance Head to confirm
  created_by   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audits_site ON audits(site_id, domain, audit_date);

CREATE TABLE audit_responses (
  audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  item_id  INTEGER NOT NULL REFERENCES template_items(id),
  result   TEXT    NOT NULL CHECK (result IN ('pass', 'partial', 'fail', 'na')),
  points   REAL,
  note     TEXT,
  photos   TEXT,                                       -- JSON array of storage keys
  PRIMARY KEY (audit_id, item_id)
);

-- A gap to close: from a Minor/Major/Observation/NC rating, with its corrective action (CAPA).
CREATE TABLE findings (
  id           INTEGER PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES sites(id),
  audit_id     INTEGER REFERENCES audits(id),
  item_id      INTEGER REFERENCES template_items(id),
  domain       TEXT    NOT NULL CHECK (domain IN ('food', 'maintenance')),
  title        TEXT    NOT NULL,
  detail       TEXT,
  priority     TEXT    NOT NULL CHECK (priority IN ('critical', 'major', 'minor')),
  rating       TEXT    NOT NULL DEFAULT 'fail' CHECK (rating IN ('fail', 'partial')),
  marks        REAL    NOT NULL DEFAULT 0,             -- marks recovered when closed
  kind         TEXT    NOT NULL DEFAULT 'physical',
  status       TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'fixed', 'closed')),
  owner        TEXT,
  due_date     TEXT    NOT NULL,
  root_cause   TEXT,
  action_taken TEXT,
  photos       TEXT,                                   -- JSON: what the auditor saw
  evidence_key TEXT,                                   -- proof of the fix
  is_repeat    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  fixed_at     TEXT,
  closed_at    TEXT,
  closed_by    TEXT,
  close_note   TEXT
);
CREATE INDEX idx_findings_status ON findings(status, site_id);
CREATE INDEX idx_findings_item ON findings(site_id, item_id, status);

CREATE TABLE licences (
  id         INTEGER PRIMARY KEY,
  site_id    INTEGER NOT NULL REFERENCES sites(id),
  type       TEXT    NOT NULL,
  number     TEXT,
  authority  TEXT,
  issued_on  TEXT,
  expires_on TEXT,
  severity   TEXT    NOT NULL DEFAULT 'major' CHECK (severity IN ('critical', 'major', 'minor')),
  file_key   TEXT,
  notes      TEXT,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_licences_site ON licences(site_id, expires_on);

-- Who did what, when. Append-only.
CREATE TABLE activity (
  id        INTEGER PRIMARY KEY,
  at        TEXT    NOT NULL DEFAULT (datetime('now')),
  actor     TEXT,
  site_id   INTEGER,
  entity    TEXT    NOT NULL,
  entity_id INTEGER,
  action    TEXT    NOT NULL,
  detail    TEXT
);
CREATE INDEX idx_activity_at ON activity(at);
