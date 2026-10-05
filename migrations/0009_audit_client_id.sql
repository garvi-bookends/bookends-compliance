-- An audit submitted from a phone carries an id made on that phone. If the network drops after the server saved it
-- but before the phone heard back, the phone sends it again; the id lets the server recognise it instead of saving it twice.
ALTER TABLE audits ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS audits_client_id ON audits (client_id) WHERE client_id IS NOT NULL;
