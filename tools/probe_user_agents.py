"""Probe how a podcast host's ad insertion reacts to the User-Agent.

Usage:  python -I tools/probe_user_agents.py "<enclosure url>" [declared_length_bytes [duration_seconds]]

Sends a 1-byte ranged GET per UA and reads the total size from Content-Range.
A UA whose total equals the feed's declared length is getting the original
(unstitched) file. Ad seconds = (total - declared) / (declared / duration), so pass the
feed's duration; without it the tool assumes 128 kbps CBR ((total - declared) / 16000).
Original run on KFC #1 (2026-10-14): Googlebot +0 s, Apple Podcasts +413 s,
curl/wget/python-requests +1605 s.
"""
import re
import subprocess
import sys

UAS = {
    "empty": "",
    "curl": "curl/8.5.0",
    "chrome-win": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
    "safari-ios": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    "apple-podcasts": "Podcasts/1.1 CFNetwork/1568 Darwin/24.0",
    "spotify": "Spotify/8.9.0 Android/34",
    "overcast": "Overcast/3.0 (+http://overcast.fm/; Apple Podcasts)",
    "pocketcasts": "PocketCasts/1.0 (Pocket Casts Feed Parser; +http://pocketcasts.com/)",
    "antennapod": "AntennaPod/3.5.0",
    "iheart-app": "iHeartRadio/10.0 (Android)",
    "googlebot": "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "bingbot": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "vlc": "VLC/3.0.20 LibVLC/3.0.20",
    "wget": "Wget/1.21.4",
    "python-requests": "python-requests/2.31.0",
    "go-http": "Go-http-client/2.0",
    "okhttp": "okhttp/4.12.0",
    "libsyn": "Libsyn",
}


def total_size(url, ua):
    out = subprocess.run(
        ["curl", "-s", "-L", "-A", ua, "-r", "0-99", "-D", "-", "-o", "/dev/null" if sys.platform != "win32" else "NUL", url],
        capture_output=True, text=True,
    ).stdout
    m = re.findall(r"(?im)^content-range:\s*bytes \d+-\d+/(\d+)", out)
    return int(m[-1]) if m else None


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    url = sys.argv[1]
    declared = int(sys.argv[2]) if len(sys.argv) > 2 else None
    duration = float(sys.argv[3]) if len(sys.argv) > 3 else None
    bytes_per_sec = declared / duration if declared and duration else 16000  # 128 kbps fallback
    for name, ua in UAS.items():
        n = total_size(url, ua)
        extra = ""
        if n is not None and declared:
            extra = "  (%+.0f s vs declared)" % ((n - declared) / bytes_per_sec)
        print("%-16s %s%s" % (name, n, extra))


main()
