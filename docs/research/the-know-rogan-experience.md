# The Know Rogan Experience

Researched 2026-10-15. Producer: Cross Pond Productions. 92 episodes. Not Joe Rogan's own show (that is Megaphone-hosted: `feeds.megaphone.fm/GLT1412515089`, a candidate for the next entry here).

- Feed: `https://rss.libsyn.com/shows/561260/destinations/4849865.xml` (`<generator>Libsyn RSSgen 1.0</generator>`)
- Enclosure chain: `dts.podtrac.com/redirect.mp3` (Podtrac) -> `traffic.libsyn.com` -> `delivery-edge.libsyn.com/shows/561260/items/<id>/<file>.mp3`. Final hop: `206`, `accept-ranges: bytes`, `cache-control: private, max-age=3600`.

## How the ads work

**Dynamic insertion, confirmed.** The same episode file is a different size depending on who asks. Episode "Milo Yiannopoulos" (declared 153,880,566 bytes, 1:46:35, about 193 kbps):

| User-Agent (home IP) | Served bytes | Extra vs declared |
|---|---|---|
| Googlebot, bingbot, curl, wget, python-requests, Go-http-client, okhttp, AdsBot-Google, Mediapartners-Google | 153,880,566 | **+0 s (original)** |
| Pocket Casts | 156,211,513 | +67 s |
| "Libsyn" | 156,049,136 | +54 s |
| Overcast | 159,531,774 | +149 s |
| VLC | 159,472,934 | +196 s |
| Spotify | 160,760,037 | +286 s |
| Apple Podcasts | 160,896,619 | +292 s |
| Chrome (Windows) | 162,553,705 | +360 s |
| Safari iOS | 163,302,852 | +392 s |

Empty User-Agent: request rejected. Ad length is stable for a given UA on repeated requests (4 of 4 identical), but differs between UAs and between episodes (Chrome: +360 s on the newest episode, +67 s, +199 s, +59 s, +97 s, +96 s, 0 s, +60 s down the back catalogue), so the fill varies by slot inventory, not a fixed length.

**The publisher marks the slots in the feed.** Each item carries `<libsyn:ad-markers>`: a `pre` slot (count 3), one or two `mid` slots (count 1 to 5) at a timestamp in seconds into the original audio, and a `post` slot (count 3). Newest episodes have pre + 2 mid + post. "Count" looks like the number of ads the slot may hold; an unfilled slot just plays on, which would explain why the added time is well under the maximum.

## Can we avoid them?

Yes, two independent ways, both measured:

1. **User-Agent.** A bot or generic-client User-Agent (Googlebot is already our crawler UA) gets the original file, identical to the declared length. Checked on 8 episodes from newest to oldest: all 0 s.
2. **Source IP.** From a Cloudflare edge (ATL) a throwaway Worker got the original for *every* UA including Chrome, Apple Podcasts, Spotify and "Libsyn". Libsyn appears not to stitch for datacenter traffic. So the deployed Worker already receives ad-free audio from Libsyn even without the UA rule.

What this does not remove: any host-read sponsor spots recorded into the show. The size check cannot see those. Not yet checked by listening or transcribing.

## Fragility and unknowns

- Both avoidance paths rest on Libsyn's bot handling, which it can change. The existing ad check (served size vs declared `length`) will flag it: size grows, badge flips to "ads suspected".
- IP behaviour is one data point from one colo (ATL). Retest from the live Worker and from other regions.
- The mid-roll timestamps could be used to locate inserted audio with `tools/frame_diff.py` (CBR frames). Not done; the 192 kbps and 128 kbps mix across episodes means each file needs its own bitrate.
- Not measured: listening-experience effects (how jarring the breaks are). With the original file there are no stitches to hear; the experience question only matters if we ever have to fall back to ad skipping.

## Wired into this repo (branch `research/distributors`)

- `libsyn.com` added to the crawler-UA host list in `src/strategy.ts`, with a unit test.
- Show added to `web/config.js` (not on `main` until merged).
- `tools/probe_user_agents.py` takes the episode duration so ad seconds use the file's real bitrate, and probes more client UAs.
