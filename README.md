# adfree-pods

Single-user podcast aggregator that plays episodes without server-inserted ads. First target: Knowledge Fight Country.

Design: `docs/superpowers/specs/2026-10-14-adfree-podcast-aggregator-design.md`. Remaining work: `docs/superpowers/plans/2026-10-14-adfree-podcast-aggregator.md`.

## Run

Needs Node 24+ (native TypeScript, `node:sqlite`). One dependency.

```
npm install
npm start            # http://127.0.0.1:8787, data in ./data.sqlite
npm test             # unit + local end-to-end
LIVE=1 npm test      # also hits the real KFC host (PowerShell: $env:LIVE=1; npm test)
```

Paste the feed URL into the page:
`https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/79e9a3f8-e7fd-4b7b-ad5c-b4ba0139f9ae/756a2948-13e0-4c8b-ae8f-b4ba0139f9bf/podcast.rss`

## How it avoids the ads

Omny stitches ads into each download, sized by the request's User-Agent. The `Googlebot/2.1` UA gets the original file: exactly the feed's declared `length`. `src/strategy.ts` picks that UA for Omny/Triton/Podtrac hosts; `src/proxy.ts` fetches with it (browsers cannot set a UA) and streams the audio through, with Range support. `src/adcheck.ts` compares the size upstream would serve to the feed's declared length and the UI badges each episode `ad-free` / `ads suspected` / `unchecked`. If Omny closes the loophole, the badge flips and the live tests fail.

## Status (2026-10-14)

Verified: 16/16 tests incl. live; real KFC feed ingested (4 episodes, all `clean`); proxied file byte-identical to a direct crawler-UA download; plays in a browser at the declared 2:22:14 with no pre-roll.

Not verified: seeking by dragging the scrubber in a real browser (Range passthrough is tested at the HTTP level only), resume position across reloads, any non-Omny feed, any machine other than the original one.
