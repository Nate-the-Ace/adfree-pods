"""Find where two downloads of the same episode differ, frame by frame.

Usage:  python -I tools/frame_diff.py clean.mp3 stitched.mp3

Walks MPEG-1 Layer III frames (128 kbps / 44.1 kHz assumed, as KFC is), hashes
each frame, and aligns the two sequences. Every non-equal block is audio that
exists in one file only: an inserted ad (or a different ad in the other file).
Compare a crawler-UA download (clean) against a normal-UA download (stitched)
to see exactly where ads were inserted. Takes ~1 minute for a 2.5 h episode.
"""
import difflib
import hashlib
import sys

BR = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
SAMPLE_RATE = 44100
FRAME_SECONDS = 1152 / SAMPLE_RATE


def frames(path):
    d = open(path, "rb").read()
    tag = (d[6] << 21) | (d[7] << 14) | (d[8] << 7) | d[9]  # ID3v2 syncsafe size
    i, out = 10 + tag, []
    while i + 4 <= len(d):
        if d[i] != 0xFF or (d[i + 1] & 0xE0) != 0xE0:
            i += 1
            continue
        b2 = d[i + 2]
        br = BR[(b2 >> 4) & 15]
        if not br:
            i += 1
            continue
        length = 144000 * br // SAMPLE_RATE + ((b2 >> 1) & 1)
        out.append(hashlib.md5(d[i:i + length]).digest()[:6])
        i += length
    return out


def stamp(n):
    s = n * FRAME_SECONDS
    return "%d:%02d:%02d" % (s // 3600, s % 3600 // 60, s % 60)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    a, b = frames(sys.argv[1]), frames(sys.argv[2])
    print("A: %d frames (%.0f s)   B: %d frames (%.0f s)" % (len(a), len(a) * FRAME_SECONDS, len(b), len(b) * FRAME_SECONDS))
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "equal":
            print("%-8s A %s-%s (%.0f s) | B %s-%s (%.0f s)" % (
                tag, stamp(i1), stamp(i2), (i2 - i1) * FRAME_SECONDS, stamp(j1), stamp(j2), (j2 - j1) * FRAME_SECONDS))


main()
