# Regular listens: how each show delivers ads

Surveyed 2026-10-15 with `tools/survey.py` (3 episodes per show spread across the back catalogue, 8 User-Agents, 1-byte ranged GETs), once from a home IP and, for the shows that showed differences, again through a Cloudflare edge Worker (datacenter IP). "Clean" = served size equals the declared length (or, where the feed declares none, the smallest size any UA got). Seconds are extra audio relative to that, at the file's own bitrate (declared bytes / duration).

Scope: stitched-in ads only. Host-read sponsor spots are part of the recording and are out of scope (see README).

| Show | Host | Stitched ads? | Who gets the original | Datacenter IP (Cloudflare) | Notes |
|---|---|---|---|---|---|
| The Know Rogan Experience | Libsyn | yes, +60 to +390 s | bots and generic clients | **original for every UA** | feed lists ad markers; see its own file |
| Let's Talk to Lucy | Libsyn | yes, +30 to +210 s | Googlebot, curl | **original for every UA** | same behaviour as Know Rogan |
| Show Me State of Mind | Libsyn | none seen | everyone | n/a | all 3 episodes identical for every UA |
| Dan Carlin's Hardcore History | Libsyn (via Podtrac) | none seen | everyone | n/a | one episode is 200 s off its declared length for every UA: stale feed length, not ads |
| Sawbones | Simplecast ("injected" CDN host) | newest episode only, +78 s | Googlebot, curl | still stitched for other UAs, so the UA trick is what works | older episodes unstitched for everyone |
| My Brother, My Brother and Me | Simplecast | newest episode only, +77 s | Googlebot, curl | same as Sawbones | same |
| 'Til Death Do Us Blart | Acast | yes, up to about +140 s | Googlebot, curl (smallest) | same ordering from the edge | feed `length` is far above the served size (1000+ s), so the size check cannot be used; compare UAs instead |
| I Never Liked You | Megaphone | small (+33 to +67 s) on some episodes | Googlebot, Chrome, Safari | none at all from the edge | feed declares `length` 0, so the size check reads "unknown" |
| QAA | SoundCloud | none (static files) | everyone | n/a | public feed also lists Premium episodes |
| Lions Led by Donkeys | SoundCloud | none (static files) | everyone | n/a | |
| Galactic Book Club | Anchor / Spotify | none (static files) | everyone | n/a | |
| The Caving Podcast (Matt Pelsor) | Podomatic | none (static files) | everyone | n/a | all 8 UAs identical on 3 episodes; the constant +15 s is a stale feed length. Ads are host-read only, out of scope |
| The Scathing Atheist | Audioboom | yes, +150 to +210 s | Googlebot | UA still matters; partial from the edge | owner has Patreon feeds for the Puzzle in a Thunderstorm shows, which are ad-free; use those as private feeds |

## Redirect chains (who sits in front of the audio)

Most feeds route through download-measurement hops before the audio host: Podtrac (`podtrac.com`), Podscribe (`pscrb.fm`), Spotify (`prfx.byspotify.com`), Podsights (`pdst.fm`), Magellan AI (`mgln.ai`), Claritas (`claritaspod.com`), Chartable-style (`clrtpod.com`). The User-Agent is sent down the whole chain, so the crawler UA applies to every hop; these hosts are on the crawler-UA list in `src/strategy.ts`.

## What changed in the code

- `src/strategy.ts` crawler-UA host list now covers Simplecast, Acast, Audioboom, Megaphone and the measurement hops, each backed by the numbers above.
- Shows added to `web/config.js` (this branch only): everything in the table except The Scathing Atheist (to be added as a private feed).

## Not resolved

- Screenshot tiles now all identified: the "Kirk Cameron's Saving Christmas" tile is God Awful Movies (a Patreon feed, to be added as a private feed in Settings, as with the other Puzzle in a Thunderstorm shows), and the black-and-white tile is The Caving Podcast.
- Megaphone and Audioboom declare no `length`, so the app's ad badge will say "unchecked" for them. A fallback that compares sizes across UAs is possible but not built.
- One home IP and one edge location per host; re-measure before relying on any row.
