-- The seed files insert rows with explicit ids; move each id counter past them so new rows do not collide.
SELECT setval(pg_get_serial_sequence('sites', 'id'), COALESCE((SELECT max(id) FROM sites), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('templates', 'id'), COALESCE((SELECT max(id) FROM templates), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('template_items', 'id'), COALESCE((SELECT max(id) FROM template_items), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('audits', 'id'), COALESCE((SELECT max(id) FROM audits), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('findings', 'id'), COALESCE((SELECT max(id) FROM findings), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('licences', 'id'), COALESCE((SELECT max(id) FROM licences), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('activity', 'id'), COALESCE((SELECT max(id) FROM activity), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT max(id) FROM users), 0) + 1, false);
