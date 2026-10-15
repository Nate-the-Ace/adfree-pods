# Handoff: adfree-pods

Written 2026-10-15 for continuing on another machine / another Claude account. Everything needed is in this folder; nothing depends on the machine it was built on.

## What this is

A single-user web app that aggregates podcast RSS feeds and plays episodes **without server-inserted ads**. First target: **Knowledge Fight Country** (Dan Friesen; Cool Zone Media / iHeart, hosted on Omny). It must eventually work for any podcast, but KFC comes first.

Feed URL:
`https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/79e9a3f8-e7fd-4b7b-ad5c-b4ba0139f9ae/756a2948-13e0-4c8b-ae8f-b4ba0139f9bf/podcast.rss`

## Get running (5 minutes)

Needs **Node 24+** (native TypeScript, built-in `node:sqlite`). One dependency.

```
npm install
npm test                  # 14 pass, 2 skipped (the live ones)
LIVE=1 npm test           # all 16; hits the real KFC host. PowerShell: $env:LIVE=1; npm test
npm start                 # http://127.0.0.1:8787, paste the feed URL above
```

## The key finding (why this works)

Omny/Triton stitches ads into each download **per request, sized by the User-Agent**. Measured on KFC #1 ("The Lies of Math"), 2026-10-14:

| User-Agent | Served size vs feed's declared length |
|---|---|
| `Googlebot/2.1 (+http://www.google.com/bot.html)` | **+0 s, identical to the feed's `length`** |
| Apple Podcasts / AntennaPod / Spotify / iHeart app | +410 to +490 s |
| Chrome, Safari iOS, Overcast, Castbox, ffmpeg | +700 to +1100 s |
| curl, wget, python-requests, Podtrac, Pocket Casts, mpv | +1595 to +1607 s |

- A HEAD request lies: it reports the unstitched size. Only a real GET (or a ranged GET reading `Content-Range`) shows the stitched size.
- Frame-level diff (all frames 128 kbps CBR 44.1 kHz, so there are no encoder seams to detect) of the Googlebot file vs a stitched file: the stitched one differs only by a **160 s pre-roll (0:00 to 2:40)** and a **239 s mid-roll** (36:05 to 40:04 in the stitched file). 399 s total, which accounts for every extra second. The Googlebot file is the original show.
- Redirect chain: `podtrac.com/pts/redirect.mp3` -> `traffic.omny.fm/d/clips/...` -> `iheartmedia.mc.tritondigital.com/OMNY_KNOWLEDGEFIGHT_PODCAST_P/.../audio/direct/t<publish-timestamp>/<name>.mp3`.
- Omny's documented model: publisher flags ad markers; ads are stitched at download/stream time and targeted by geo/device/app; an unfilled slot just plays on (that is the documented reason ads sometimes "fail to inject"). Source: Triton help, "Advertising on podcasts in Omny Studio" (help.tritondigital.com).
- KFC has **no host-read ads** (user's statement), so the unstitched file is fully ad-free.

## How the code is organized

| File | Job |
|---|---|
| `src/strategy.ts` | `strategyFor(url)`: crawler UA for omny.fm / omnycontent.com / tritondigital.com / podtrac.com, browser UA otherwise. **The only place that knows about the loophole.** |
| `src/feed.ts` | RSS to `{title, episodes[]}` (pure) |
| `src/db.ts` | SQLite via `node:sqlite`; re-polling keeps verdicts and resume positions |
| `src/poller.ts` | fetch + parse + upsert; parse failure throws before any write |
| `src/adcheck.ts` | 1-byte ranged probe -> upstream total -> `clean` / `suspected` / `unknown` (tolerance 32 KiB) |
| `src/proxy.ts` | `GET /audio/:id`: streams upstream with the strategy UA, Range passthrough, `X-Adcheck` header. Browsers cannot set a User-Agent, which is why a proxy exists. Stores nothing. |
| `src/server.ts` | HTTP routes + static files; binds 127.0.0.1, **no auth** |
| `public/` | vanilla HTML/JS: add feed, episode list, player, ad badge, resume position |
| `tools/probe_user_agents.py` | the UA experiment, reusable on any host |
| `tools/frame_diff.py` | frame-level diff of two downloads to locate inserted ads |
| `test/` | unit tests, local end-to-end tests with fake servers, live tests |

The ad check is the safety net: if the loophole ever closes, upstream totals stop matching the feed's declared `length`, the badge flips to `ads suspected`, and the live tests fail.

## Status

Verified (2026-10-14):
- 16/16 tests, including both live tests.
- Real KFC feed ingested: 4 episodes, all `clean`.
- Full KFC #1 through the proxy is byte-identical (same MD5) to a direct Googlebot download.
- Ranged request through the proxy returns `206` with the right `Content-Range`.
- In a browser, KFC #1 loads at 8534 s (2:22:14) and plays from the start, no pre-roll.

**Not verified:**
- Dragging the scrubber in a real browser (Range passthrough is tested at HTTP level only).
- Resume position across a page reload.
- Any non-Omny feed.
- Any machine or IP other than the original one (Omny could verify Googlebot by IP range; it did not from that machine).

## Decisions already made (do not re-ask)

- Strip at playback, server side, so the user never hears ads. (Not skip markers.)
- Focus on KFC; generalize later.
- Use the ad-free `Googlebot` User-Agent. If that stops working, "we'll work on something."
- Single user, localhost, no auth.
- **Ad companies' terms of service are not a concern.** Do not add ToS or ethics caveats. Technical fragility notes are fine.

## What to do next

The task list with acceptance criteria is in `docs/superpowers/plans/2026-10-14-adfree-podcast-aggregator.md` (Tasks 7 to 12). In priority order:

1. **Seeking and resume in a real browser** (Task 7). Drag the scrubber to 1:00:00; confirm a `206` in the Network tab; reload and confirm resume within 5 s.
2. **Scheduled feed refresh** (Task 8) so new episodes appear on their own.
3. **Loud warning if the loophole closes** (Task 9): say "loophole may be closed", not just "ads suspected".
4. Only if needed: **fallback detector** (Task 10) for shows without the loophole. Plan: fetch an episode several times with different UAs; frames not common to all fetches are ads (done by hand with `tools/frame_diff.py`). Ads identical across fetches need transcription (Whisper) plus classification. ffmpeg was not installed on the original machine.
5. Other feeds (Task 11): measure each host with `tools/probe_user_agents.py`; do not assume the crawler UA works elsewhere.

## Gotchas learned

- `node --test test/` fails on Node 24; the script uses the glob `"test/*.test.ts"`.
- Node strips TypeScript types natively: imports need the `.ts` extension, no enums, no parameter properties.
- The feed lists `length` honestly for Omny; the ad check relies on that. A host that lies about `length` makes the check return `unknown`/wrong.
- The "Introducing KFC" episode's real GET was 86 bytes smaller than its declared length (server rewrites something per request). The 32 KiB tolerance exists because of this; a 15 s ad is about 240 KB.
- `test/fixtures/kfc.rss` is a saved copy of the feed (4 episodes). Refresh it if the show's structure changes.

## Start prompt for a new Claude session

> Read HANDOFF.md and CLAUDE.md in this folder, then continue from "What to do next". Run `npm install && npm test` first to confirm the baseline. Skip brainstorming for the listed tasks; the design is already approved.
