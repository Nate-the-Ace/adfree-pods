import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed } from '../src/feed.ts';
import { probeTotalSize, verdictFor } from '../src/adcheck.ts';
import { BROWSER_UA } from '../src/strategy.ts';

// Network test against the real KFC episode. Run: LIVE=1 npm test
// (PowerShell: $env:LIVE=1; npm test). Fails if Omny closes the loophole.
const live = process.env.LIVE ? test : test.skip;

const kfc = parseFeed(readFileSync(new URL('./fixtures/kfc.rss', import.meta.url), 'utf8'));
const ep = kfc.episodes.find((e) => e.title.startsWith('KFC #1'))!;

live('live: strategy fetch of KFC #1 is exactly the declared length (no ads)', async () => {
  const total = await probeTotalSize(ep.enclosureUrl);
  assert.equal(verdictFor(total, ep.declaredLength), 'clean', `served ${total}, declared ${ep.declaredLength}`);
});

live('live: a normal browser UA gets ads, so the check can detect them', async () => {
  const total = await probeTotalSize(ep.enclosureUrl, { 'User-Agent': BROWSER_UA });
  assert.equal(verdictFor(total, ep.declaredLength), 'suspected', `served ${total}, declared ${ep.declaredLength}`);
});
