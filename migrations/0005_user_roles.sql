-- Two roles: the Compliance Head (everything, and adds people) and the Unit Manager (their own unit only).
-- role: head | manager. site_id: the unit a manager looks after (NULL for a Compliance Head).

ALTER TABLE users ADD COLUMN site_id INTEGER REFERENCES sites(id);
UPDATE users SET role = 'head' WHERE role = 'admin';
UPDATE users SET role = 'manager' WHERE role = 'member';
