# Adfree podcast aggregator implementation plan

> **For agentic workers:** use superpowers-extended-cc:executing-plans or subagent-driven-development. Tasks 1-6 are done; start at Task 7.

**Goal:** single-user web app that aggregates podcast feeds and plays them without server-inserted ads, starting with Knowledge Fight Country.

**Architecture:** Node 24 service (native TS, `node:sqlite`, `node:http`) with a UA-strategy layer, an audio proxy that streams upstream with the right User-Agent, and a size-based ad check as the safety net. Vanilla static UI. See the spec for measurements.

**Tech Stack:** Node 24, TypeScript (type stripping, no build), `fast-xml-parser`, `node:test`.

**User decisions (already made):**
- "strip at playback, i don't want to hear it"
- Focus on KFC; "eventually support any given podcast"
- "Build it with the adfree useragent and we'll work on something if that ever changes"
- Dan Friesen does not read ads, so no host-read ads in KFC
- Localhost, single user (design accepted)
- Ad companies' terms are not a concern; do not raise them
- Moving to personal repo and personal Claude to continue

---

## Done

### Task 1: Strategy layer, `src/strategy.ts`, `test/unit.test.ts`
`strategyFor(url)`: crawler UA for omny.fm / omnycontent.com / tritondigital.com / podtrac.com (exact or subdomain match, lookalikes rejected), browser UA otherwise. **Verify:** `npm test`.

### Task 2: Feed parser, `src/feed.ts`
RSS -> `{title, episodes[]}`; decodes `&amp;`, skips items with no enclosure, rejects non-RSS. Fixture: `test/fixtures/kfc.rss`.

### Task 3: Store and poller, `src/db.ts`, `src/poller.ts`
Feeds/episodes in SQLite; re-poll keeps verdict and resume position. A parse failure throws before any write.

### Task 4: Ad check, `src/adcheck.ts`
1-byte ranged probe -> total size -> verdict (tolerance 32 KiB). Live test proves the crawler UA is clean and a browser UA is `suspected`.

### Task 5: Audio proxy and server, `src/proxy.ts`, `src/server.ts`, `test/server.test.ts`
`GET /audio/:id` streams with Range passthrough and an `X-Adcheck` header; aborts upstream when the listener leaves. Local fakes test it end to end.

### Task 6: UI, `public/`
Add feed, episode list, player, ad badge, resume position. Verified in the in-app browser: plays at 8534 s.

## Remaining (for home)

### Task 7: Verify seeking and resume in a real browser
**Files:** none, then fix `src/proxy.ts` if needed.
**Acceptance:** drag the scrubber to 1:00:00 on KFC #1 and it plays from there without re-downloading from zero; reload the page and it resumes within 5 s of where you left.
**Check:** the Network tab shows `206` with `Content-Range`. If Omny returns `200` to a Range request the proxy would hand the browser a non-seekable stream; handle by honouring only 206 and reporting.

### Task 8: Scheduled feed refresh
**Files:** modify `src/server.ts` (a `setInterval` calling `refreshFeed` for each feed, say hourly, errors logged not thrown), test with a fake feed whose item list grows.
**Acceptance:** a new episode appears without clicking Add again.

### Task 9: Surface a closed loophole loudly
**Files:** `src/server.ts`, `public/app.js`.
**Acceptance:** when `/audio/:id` or the check returns `suspected` for a host that has a clean-fetch strategy, the UI says "loophole may be closed", not just "ads suspected". Today a mismatch only shows the generic warning.

### Task 10: Fallback detector (only if the loophole closes, or for non-Omny shows)
Design is in the spec ("Out of scope"). Findings that matter:
- Ads are inserted per request, so two fetches differ only in ad slots; diffing frames across fetches finds variable ads (done by hand with `difflib` over MD5 of each MP3 frame; all frames were 128 kbps / 44.1 kHz, so there were no encoder seams).
- Ads identical across fetches need audio classification: transcribe (Whisper) and classify segments. ffmpeg was not installed on the original machine.
- Strip by cutting the detected ranges and serving the result; cache per episode.
Do not build this before it is needed.

### Task 11: Other feeds
Add a strategy per host as measured (do not assume the crawler UA works elsewhere). The ad check works on any host that reports a declared `length` honestly.

### Task 12: Optional
Replace the vanilla UI with React/Vite if wanted; public hosting needs auth first (the app currently binds 127.0.0.1 with none).

## Risks to remember
The rule can change at any time and was only tested from one IP.
