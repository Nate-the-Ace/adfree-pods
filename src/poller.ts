import type { DatabaseSync } from 'node:sqlite';
import { parseFeed } from './feed.ts';
import { strategyFor } from './strategy.ts';
import { upsertEpisodes, upsertFeed } from './db.ts';

export async function refreshFeed(db: DatabaseSync, url: string): Promise<{ feedId: number; episodes: number }> {
  const res = await fetch(url, {
    headers: { ...strategyFor(url).headers, Accept: 'application/rss+xml, application/xml, text/xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`feed fetch failed: HTTP ${res.status}`);
  // A parse failure throws before any write, so previous episodes are kept.
  const feed = parseFeed(await res.text());
  const feedId = upsertFeed(db, url, feed.title);
  upsertEpisodes(db, feedId, feed.episodes);
  return { feedId, episodes: feed.episodes.length };
}
