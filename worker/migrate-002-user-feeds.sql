-- For databases created before private feeds existed (schema.sql already has this).
CREATE TABLE IF NOT EXISTS user_feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  art TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);
