import { XMLParser } from 'fast-xml-parser';

export interface ParsedEpisode {
  guid: string;
  title: string;
  pubDate: string | null;
  enclosureUrl: string;
  declaredLength: number | null;
  durationSec: number | null;
}

export interface ParsedFeed {
  title: string;
  episodes: ParsedEpisode[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // keep guids / durations as strings
  isArray: (name) => name === 'item',
});

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return text((v as Record<string, unknown>)['#text']);
  return String(v).trim();
}

// itunes:duration is seconds ("8534") or [HH:]MM:SS
function parseDuration(v: unknown): number | null {
  const s = text(v);
  if (!s) return null;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function parseFeed(xml: string): ParsedFeed {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel;
  if (!channel) throw new Error('not an RSS feed: no <rss><channel>');
  const episodes: ParsedEpisode[] = [];
  for (const item of channel.item ?? []) {
    const enc = item.enclosure;
    const url = enc?.['@_url'];
    if (!url) continue; // no audio, not an episode
    const len = Number(enc['@_length']);
    episodes.push({
      guid: text(item.guid) || url,
      title: text(item.title),
      pubDate: text(item.pubDate) || null,
      enclosureUrl: url,
      declaredLength: Number.isFinite(len) && len > 0 ? len : null,
      durationSec: parseDuration(item['itunes:duration']),
    });
  }
  return { title: text(channel.title), episodes };
}
