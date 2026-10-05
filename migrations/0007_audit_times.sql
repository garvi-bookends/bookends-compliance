-- When an audit was actually carried out. started_at is set when the auditor begins the checklist,
-- finished_at when they submit it; both are UTC timestamps ('YYYY-MM-DDTHH:MM:SSZ').
-- Imported audits keep their written time_range ('10:30AM to 01:30PM') and leave these empty.
ALTER TABLE audits ADD COLUMN started_at TEXT;
ALTER TABLE audits ADD COLUMN finished_at TEXT;
