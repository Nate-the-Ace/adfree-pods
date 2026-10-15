CREATE TABLE IF NOT EXISTS users (
  name TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
  user TEXT NOT NULL,
  guid TEXT NOT NULL,
  feed TEXT NOT NULL,
  title TEXT NOT NULL,
  enclosure_url TEXT NOT NULL,
  declared_length INTEGER,
  position REAL NOT NULL,
  duration REAL,
  played INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL,
  PRIMARY KEY (user, guid)
);
