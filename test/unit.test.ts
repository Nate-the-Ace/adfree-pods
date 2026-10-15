import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strategyFor, CRAWLER_UA, BROWSER_UA } from '../src/strategy.ts';
import { parseFeed } from '../src/feed.ts';
import { verdictFor, totalFromContentRange, TOLERANCE_BYTES } from '../src/adcheck.ts';

const kfc = readFileSync(new URL('./fixtures/kfc.rss', import.meta.url), 'utf8');

test('strategy: omny/triton/podtrac hosts get the crawler UA', () => {
  for (const u of [
    'https://podtrac.com/pts/redirect.mp3/traffic.omny.fm/d/clips/a/audio.mp3',
    'https://traffic.omny.fm/d/clips/a/audio.mp3',
    'https://iheartmedia.mc.tritondigital.com/X/media/a.mp3',
    'https://www.omnycontent.com/d/playlist/a/podcast.rss',
    'https://traffic.libsyn.com/secure/x/a.mp3',
    'https://rss.libsyn.com/shows/1/destinations/2.xml',
  ]) {
    const s = strategyFor(u);
    assert.equal(s.name, 'crawler-ua', u);
    assert.equal(s.headers['User-Agent'], CRAWLER_UA);
  }
});

test('strategy: other hosts and junk get the default UA; lookalike hosts do not match', () => {
  assert.equal(strategyFor('https://example.com/a.mp3').headers['User-Agent'], BROWSER_UA);
  assert.equal(strategyFor('https://notomny.fm.evil.com/a.mp3').name, 'default');
  assert.equal(strategyFor('https://evilomny.fm/a.mp3').name, 'default');
  assert.equal(strategyFor('not a url').name, 'default');
});

test('feed: parses the saved KFC feed', () => {
  const f = parseFeed(kfc);
  assert.equal(f.title, 'Knowledge Fight Country');
  assert.equal(f.episodes.length, 4);
  const e1 = f.episodes.find((e) => e.title.startsWith('KFC #1'))!;
  assert.equal(e1.declaredLength, 136603236);
  assert.equal(e1.durationSec, 8534);
  // &amp; in the XML must be decoded in the URL
  assert.ok(e1.enclosureUrl.includes('?utm_source=Podcast&in_playlist='), e1.enclosureUrl);
});

test('feed: rejects non-RSS, skips items without audio', () => {
  assert.throws(() => parseFeed('<html></html>'), /not an RSS feed/);
  const f = parseFeed('<rss><channel><title>t</title><item><title>no audio</title></item></channel></rss>');
  assert.equal(f.episodes.length, 0);
});

test('adcheck verdict: matches, ad-sized gaps, missing data', () => {
  assert.equal(verdictFor(136603236, 136603236), 'clean');
  assert.equal(verdictFor(136603236 + 86, 136603236), 'clean'); // observed noise
  assert.equal(verdictFor(136603236 + TOLERANCE_BYTES + 1, 136603236), 'suspected');
  assert.equal(verdictFor(142993800, 136603236), 'suspected'); // the real stitched fetch
  assert.equal(verdictFor(null, 5), 'unknown');
  assert.equal(verdictFor(5, null), 'unknown');
});

test('adcheck: content-range total', () => {
  assert.equal(totalFromContentRange('bytes 0-0/142993800'), 142993800);
  assert.equal(totalFromContentRange('bytes */99'), 99);
  assert.equal(totalFromContentRange(null), null);
});
