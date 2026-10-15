# Podcast ad-delivery research

Goal: understand how each podcast distributor delivers ads, how much they change the listening experience, and whether the original (ad-free) audio can be fetched. One file per show; this page is the comparison.

## Method (repeatable)

1. Find the feed: `curl "https://itunes.apple.com/search?media=podcast&term=<name>"` and read `feedUrl`.
2. Read the feed for declared enclosure `length`, `itunes:duration`, hosting hints (`<generator>`, enclosure host, `libsyn:`/`omny:` tags) and any publisher ad markers.
3. Follow the enclosure redirect chain with `curl -sIL`.
4. Measure: `python -I tools/probe_user_agents.py "<enclosure>" <declared_bytes> <duration_s>`. A user agent whose served size equals the declared length gets the original. Extra bytes divided by the file's real bytes/second is the ad time. HEAD lies; the tool uses a ranged GET.
5. Repeat the same request several times (is it stable or random?) and across episodes (old and new).
6. Repeat from a datacenter IP (a throwaway `wrangler dev --remote` Worker) because some hosts treat datacenter traffic differently from home traffic.
7. Never assume a trick works on a new host. Measure it.

## Comparison

| | Omny / Triton (Cool Zone) | Libsyn (Know Rogan Experience) |
|---|---|---|
| Insertion | Dynamic, stitched per request | Dynamic, stitched per request |
| Publisher markers in feed | none visible | `libsyn:ad-marker` pre / mid / post with timestamps |
| Original file served to | `Googlebot` UA only | `Googlebot`, `bingbot`, curl, wget, python-requests, Go, okhttp and other non-listener UAs; **every UA from a Cloudflare datacenter IP** |
| Ads served to | everyone else, +400 to +1600 s | browsers and podcast apps from a home IP, +50 to +390 s |
| Ad time stable per UA? | yes | yes (same UA, same size, repeated) |
| Fetch strategy in this repo | crawler UA | crawler UA (and the Worker already gets the original without it) |
