import { strategyFor } from './strategy.ts';

export type Verdict = 'clean' | 'suspected' | 'unknown';

// A 15 s ad at 128 kbps is ~240 KB; an ad-free file measured 86 bytes off the
// feed's declared length. 32 KiB separates the two with a wide margin.
export const TOLERANCE_BYTES = 32 * 1024;

export function verdictFor(upstreamTotal: number | null, declaredLength: number | null): Verdict {
  if (upstreamTotal == null || declaredLength == null) return 'unknown';
  return Math.abs(upstreamTotal - declaredLength) <= TOLERANCE_BYTES ? 'clean' : 'suspected';
}

// "bytes 0-0/142993800" -> 142993800
export function totalFromContentRange(header: string | null): number | null {
  const m = header?.match(/\/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

// Ask upstream for one byte, with the same headers the proxy will use, and read
// the total size the stitcher would serve. `headers` overrides the strategy so
// tests can prove a generic UA is detected as ad-laden.
export async function probeTotalSize(
  url: string,
  headers: Record<string, string> = strategyFor(url).headers,
): Promise<number | null> {
  const res = await fetch(url, {
    headers: { ...headers, Range: 'bytes=0-0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  try {
    if (res.status === 206) return totalFromContentRange(res.headers.get('content-range'));
    if (res.status === 200) return Number(res.headers.get('content-length')) || null;
    return null;
  } finally {
    await res.body?.cancel();
  }
}

export async function checkEpisode(url: string, declaredLength: number | null) {
  const total = await probeTotalSize(url);
  return { verdict: verdictFor(total, declaredLength), upstreamTotal: total, declaredLength };
}
