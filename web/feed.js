// Browser port of src/feed.ts: RSS text to {title, episodes[]}.
function textOf(el) {
  return el ? el.textContent.trim() : '';
}

// itunes:duration is seconds ("8534") or [HH:]MM:SS
function parseDuration(s) {
  if (!s) return null;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const channel = doc.querySelector('rss > channel');
  if (!channel) throw new Error('not an RSS feed: no <rss><channel>');
  const episodes = [];
  for (const item of channel.querySelectorAll(':scope > item')) {
    const enc = item.querySelector('enclosure');
    const url = enc?.getAttribute('url');
    if (!url) continue; // no audio, not an episode
    const len = Number(enc.getAttribute('length'));
    const dur = [...item.children].find((c) => c.localName === 'duration');
    episodes.push({
      guid: textOf(item.querySelector('guid')) || url,
      title: textOf(item.querySelector('title')),
      pubDate: textOf(item.querySelector('pubDate')) || null,
      enclosureUrl: url,
      declaredLength: Number.isFinite(len) && len > 0 ? len : null,
      durationSec: parseDuration(textOf(dur)),
    });
  }
  return { title: textOf(channel.querySelector(':scope > title')), episodes };
}
