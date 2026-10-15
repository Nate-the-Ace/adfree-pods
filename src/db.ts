import { DatabaseSync } from 'node:sqlite';
import type { ParsedEpisode } from './feed.ts';

export interface FeedRow {
  id: number;
  url: string;
  title: string;
}
export interface EpisodeRow {
  id: number;
  feed_id: number;
  guid: string;
  title: string;
  pub_date: string | null;
  enclosure_url: string;
  declared_length: number | null;
  duration_sec: number | null;
  verdict: string | null;
  position_sec: number;
}

export function openDb(path = 'data.sqlite'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY,
      feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      guid TEXT NOT NULL,
      title TEXT NOT NULL,
      pub_date TEXT,
      enclosure_url TEXT NOT NULL,
      declared_length INTEGER,
      duration_sec INTEGER,
      verdict TEXT,
      position_sec REAL NOT NULL DEFAULT 0,
      UNIQUE (feed_id, guid)
    );
  `);
  return db;
}

export function upsertFeed(db: DatabaseSync, url: string, title: string): number {
  db.prepare(
    `INSERT INTO feeds (url, title) VALUES (?, ?)
     ON CONFLICT(url) DO UPDATE SET title = excluded.title`,
  ).run(url, title);
  return (db.prepare('SELECT id FROM feeds WHERE url = ?').get(url) as { id: number }).id;
}

export function upsertEpisodes(db: DatabaseSync, feedId: number, eps: ParsedEpisode[]): void {
  // Keep verdict and position on re-poll; refresh the fields the feed owns.
  const stmt = db.prepare(
    `INSERT INTO episodes (feed_id, guid, title, pub_date, enclosure_url, declared_length, duration_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(feed_id, guid) DO UPDATE SET
       title = excluded.title,
       pub_date = excluded.pub_date,
       enclosure_url = excluded.enclosure_url,
       declared_length = excluded.declared_length,
       duration_sec = excluded.duration_sec`,
  );
  for (const e of eps) {
    stmt.run(feedId, e.guid, e.title, e.pubDate, e.enclosureUrl, e.declaredLength, e.durationSec);
  }
}

export const listFeeds = (db: DatabaseSync) =>
  db.prepare('SELECT id, url, title FROM feeds ORDER BY title').all() as unknown as FeedRow[];

export const listEpisodes = (db: DatabaseSync, feedId: number) =>
  db
    .prepare('SELECT * FROM episodes WHERE feed_id = ? ORDER BY id DESC')
    .all(feedId) as unknown as EpisodeRow[];

export const getEpisode = (db: DatabaseSync, id: number) =>
  db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as unknown as EpisodeRow | undefined;

export function setVerdict(db: DatabaseSync, id: number, verdict: string): void {
  db.prepare('UPDATE episodes SET verdict = ? WHERE id = ?').run(verdict, id);
}

export function setPosition(db: DatabaseSync, id: number, sec: number): void {
  db.prepare('UPDATE episodes SET position_sec = ? WHERE id = ?').run(sec, id);
}
