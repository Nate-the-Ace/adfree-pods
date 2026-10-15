"""Survey how podcast hosts deliver ads: does the served audio size depend on who asks?

Usage:
  python -I tools/survey.py shows.txt [--eps 3] [--edge http://localhost:8799] [--json out.json]

shows.txt: one `Name | feed url` per line.

For each show it reads the feed, takes episodes spread across the back catalogue,
follows the enclosure redirect chain, and sends a 1-byte ranged GET per User-Agent.
A UA whose total size equals the feed's declared `length` is getting the original
file; extra bytes / (declared bytes / duration) is the ad time stitched in for it.

--edge routes the probes through a throwaway Cloudflare Worker (see
docs/research/README.md step 6) so the host sees a datacenter IP instead of this one.
"""
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import html

UAS = {
    "googlebot": "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "curl": "curl/8.5.0",
    "chrome": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
    "safari-ios": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    "apple": "Podcasts/1.1 CFNetwork/1568 Darwin/24.0",
    "spotify": "Spotify/8.9.0 Android/34",
    "overcast": "Overcast/3.0 (+http://overcast.fm/; Apple Podcasts)",
    "antennapod": "AntennaPod/3.5.0",
}
BROWSER = UAS["chrome"]


def curl_head(url, ua, rng="0-99"):
    return subprocess.run(
        ["curl", "-s", "-L", "--max-time", "40", "-A", ua, "-r", rng, "-D", "-", "-o", "/dev/null", url],
        capture_output=True, text=True,
    ).stdout.replace("\r", "")


def total_size(url, ua, edge=None):
    if edge:
        q = urllib.parse.urlencode({"url": url, "ua": ua})
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(f"{edge}/?{q}", headers={"User-Agent": BROWSER}), timeout=60))  # Cloudflare 403s the default Python UA
        except Exception:
            return None
        m = re.search(r"/(\d+)$", d.get("range") or "")
        return int(m.group(1)) if m else None
    m = re.findall(r"(?im)^content-range:\s*bytes \d+-\d+/(\d+)", curl_head(url, ua))
    return int(m[-1]) if m else None


def chain(url):
    """Hosts the enclosure passes through, plus hints from the final response."""
    out = curl_head(url, BROWSER)
    hosts = [urllib.parse.urlparse(url).hostname]
    for loc in re.findall(r"(?im)^location:\s*(\S+)", out):
        h = urllib.parse.urlparse(loc).hostname
        if h and h != hosts[-1]:
            hosts.append(h)
    hints = re.findall(r"(?im)^(server|via|x-[a-z-]*(?:host|server|cache|amz|served)[a-z-]*):\s*(.+)$", out)
    return hosts, hints[-4:]


def duration(s):
    try:
        sec = 0
        for p in s.strip().split(":"):
            sec = sec * 60 + float(p)
        return sec or None
    except ValueError:
        return None


def feed_items(feed):
    req = urllib.request.Request(feed, headers={"User-Agent": BROWSER})
    xml = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    items = []
    for it in xml.split("<item")[1:]:
        enc = re.search(r"<enclosure[^>]*>", it)
        if not enc:
            continue
        e = enc.group(0)
        url = re.search(r'url="([^"]+)"', e)
        ln = re.search(r'length="(\d+)"', e)
        d = re.search(r"<itunes:duration>\s*([^<\s]+)", it)
        t = re.search(r"<title>(?:<!\[CDATA\[)?([^<\]]*)", it)
        items.append({
            "title": html.unescape(t.group(1).strip()) if t else "",
            "url": html.unescape(url.group(1)) if url else None,
            "length": int(ln.group(1)) if ln else None,
            "duration": duration(d.group(1)) if d else None,
        })
    markers = len(re.findall(r"ad-marker|<[a-z]+:ad[ >]|adswizz|ad_break|adbreak", xml, re.I))
    gen = re.search(r"<generator>([^<]*)", xml)
    return items, {"generator": gen.group(1) if gen else None, "feed_ad_hints": markers, "items": len(items)}


def pick(items, n):
    items = [i for i in items if i["url"]]
    if len(items) <= n:
        return items
    return [items[round(k * (len(items) - 1) / (n - 1))] for k in range(n)] if n > 1 else items[:1]


def survey(name, feed, n, edge):
    rec = {"show": name, "feed": feed}
    try:
        items, meta = feed_items(feed)
    except Exception as exc:
        rec["error"] = f"feed: {exc}"
        return rec
    rec.update(meta)
    if not items:
        rec["error"] = "no episodes"
        return rec
    rec["hosts"], rec["hints"] = chain(items[0]["url"])
    rec["episodes"] = []
    for ep in pick(items, n):
        row = {"title": ep["title"][:50], "declared": ep["length"], "duration": ep["duration"], "sizes": {}}
        bps = ep["length"] / ep["duration"] if ep["length"] and ep["duration"] else None
        row["kbps"] = round(bps * 8 / 1000) if bps else None
        for ua_name, ua in UAS.items():
            t = total_size(ep["url"], ua, edge)
            row["sizes"][ua_name] = t
            if t and ep["length"] and bps:
                row.setdefault("extra_s", {})[ua_name] = round((t - ep["length"]) / bps)
        rec["episodes"].append(row)
    return rec


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    path = args[0]
    n = int(args[args.index("--eps") + 1]) if "--eps" in args else 3
    edge = args[args.index("--edge") + 1] if "--edge" in args else None
    out = args[args.index("--json") + 1] if "--json" in args else None
    results = []
    for line in open(path):
        if "|" not in line:
            continue
        name, feed = [p.strip() for p in line.split("|", 1)]
        rec = survey(name, feed, n, edge)
        results.append(rec)
        print(f"\n{name}  [{' > '.join(rec.get('hosts', []))}]  {rec.get('generator') or ''}  feed ad hints: {rec.get('feed_ad_hints')}")
        if "error" in rec:
            print("  ERROR", rec["error"])
        for ep in rec.get("episodes", []):
            print(f"  {ep['title']!r} {ep['kbps']} kbps declared={ep['declared']}")
            print("    extra s:", ep.get("extra_s") or ep["sizes"])
        sys.stdout.flush()
    if out:
        json.dump(results, open(out, "w"), indent=1)


main()
