import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { strategyFor } from './strategy.ts';
import { verdictFor, totalFromContentRange } from './adcheck.ts';

// Headers worth forwarding so seeking and caching behave.
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

// Streams upstream audio with the strategy headers; browsers cannot set a
// User-Agent themselves, which is why this exists. Stores nothing.
export async function streamAudio(
  req: IncomingMessage,
  res: ServerResponse,
  enclosureUrl: string,
  declaredLength: number | null,
): Promise<void> {
  const headers: Record<string, string> = { ...strategyFor(enclosureUrl).headers };
  if (typeof req.headers.range === 'string') headers.Range = req.headers.range;

  const ac = new AbortController();
  res.on('close', () => ac.abort()); // listener left: stop pulling from upstream

  let up: Response;
  try {
    up = await fetch(enclosureUrl, { headers, redirect: 'follow', signal: ac.signal });
  } catch (err) {
    if (ac.signal.aborted) return;
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `upstream unreachable: ${(err as Error).message}` }));
    return;
  }
  if (!up.ok || !up.body) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `upstream HTTP ${up.status}` }));
    await up.body?.cancel();
    return;
  }

  const out: Record<string, string> = {};
  for (const h of PASS) {
    const v = up.headers.get(h);
    if (v) out[h] = v;
  }
  const total =
    up.status === 206
      ? totalFromContentRange(up.headers.get('content-range'))
      : Number(up.headers.get('content-length')) || null;
  out['x-adcheck'] = verdictFor(total, declaredLength);
  res.writeHead(up.status, out);
  Readable.fromWeb(up.body as import('node:stream/web').ReadableStream).pipe(res);
}
