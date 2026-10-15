-- For databases created before invites/admin existed (schema.sql already has these).
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
);
