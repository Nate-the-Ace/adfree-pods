# Ad-free podcast aggregator: design

Date: 2026-10-14. Status: design approved in conversation; core implemented (see plan).

## Goal

A single-user web app that aggregates podcast RSS feeds and plays episodes without server-inserted (dynamic) ads. First target: Knowledge Fight Country (Omny/iHeart). Must generalize to other feeds later.

## Findings that drive the design

Measured on the KFC feed (`omnycontent.com/d/playlist/e73c998e-.../podcast.rss`) on 2026-10-14:

- Enclosure chain: `podtrac.com/pts/redirect.mp3` -> `traffic.omny.fm/d/clips/...` -> `iheartmedia.mc.tritondigital.com/OMNY_KNOWLEDGEFIGHT_PODCAST_P/.../audio/direct/t<publish-ts>/<name>.mp3`.
- A HEAD request reports the feed's declared `length` (the unstitched file). A real GET returns a **stitched** file, per request, whose size depends on the **User-Agent**:
  - generic clients (curl, wget, python-requests): +1605 s of audio
  - Apple Podcasts / AntennaPod / Spotify / iHeart app: +410..490 s
  - `Googlebot/2.1 (+http://www.google.com/bot.html)`: +0 s (exactly the feed's declared length)
- Frame-level diff (128 kbps CBR, 44.1 kHz, all frames identical format, so no encoder seams to detect) of the Googlebot file against a stitched file: the stitched file differs only by a 160 s pre-roll (0:00-2:40) and a 239 s mid-roll. Nothing else was added. The Googlebot file is the original show.
- The show has no host-read ads (per the user), so the unstitched file is ad-free.
- Omny doc: ads are inserted at publisher-defined ad markers at download/stream time, targeted by geo/device/app; unfilled slots just play on. Source: Triton help, "Advertising on podcasts in Omny Studio".

## Architecture

Node 24 + TypeScript (native type stripping, no build step), `node:sqlite`, `node:http`, one runtime dependency (`fast-xml-parser`). Vanilla HTML/JS UI served as static files. Single user, localhost, no auth.

Units:

| Unit | File | Responsibility |
|------|------|----------------|
| Strategy | `src/strategy.ts` | `strategyFor(url)` -> request headers per host. Omny/Triton hosts get the crawler UA, everything else a normal browser UA. The only place that knows about the loophole. |
| Feed parser | `src/feed.ts` | RSS XML -> `{title, episodes[]}`. Pure. |
| Store | `src/db.ts` | SQLite schema + queries (feeds, episodes, progress). |
| Poller | `src/poller.ts` | Fetch feed (with strategy), parse, upsert episodes. |
| Ad check | `src/adcheck.ts` | Probe upstream total size with a 1-byte ranged GET, compare to declared length, return `clean` / `suspected` / `unknown`. Pure verdict function plus a probe. |
| Audio proxy | `src/proxy.ts` | `GET /audio/:id`: fetch upstream with strategy headers, pass `Range` through, stream back. Stores nothing. Adds `X-Adcheck` header. |
| Server | `src/server.ts` | HTTP routes + static files. |
| UI | `public/` | Add feed, episode list, player, resume position, clean/suspected badge. |

## Data flow

Poller -> SQLite. UI asks for an episode -> server runs the ad check -> proxy streams audio with strategy headers -> player. If the check says `suspected`, the UI shows a warning badge instead of silently playing ads.

## The ad check is the safety net

The loophole can close at any time (Omny could verify Googlebot by IP). The check compares what upstream will serve to the feed's declared `length`. Tolerance is 32 KiB (a 15 s ad at 128 kbps is 240 KB; observed GET-vs-declared noise on an ad-free file was 86 bytes). Mismatch -> `suspected`.

## Error handling

- Upstream non-2xx or timeout: 502 from the proxy with a JSON message; the UI shows it.
- Feed parse failure: logged, previous episodes retained.
- Missing declared length: verdict `unknown`, UI shows a neutral badge.

## Testing

Unit: feed parsing against a saved KFC fixture, strategy picker, ad-check verdict. Live (`LIVE=1`): the Googlebot-strategy probe of a real KFC episode must equal its declared length, and a generic UA must not (proves the check can detect ads).

## Known risks

- Rule can change without notice; the ad check exists to surface that.
- Only tested from one IP.

## Out of scope for now

Audio-based ad detection (transcribe + classify; the fallback for shows where the loophole does not exist or that have host reads), transcoding, accounts, multi-user, public hosting.
