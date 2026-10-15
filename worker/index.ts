// Cloudflare Worker: the server half of the standalone page. Browsers cannot
// set a User-Agent or read cross-origin feeds, so this does both. Stores nothing.
import { strategyFor } from '../src/strategy.ts';
import { verdictFor, totalFromContentRange } from '../src/adcheck.ts';

interface Env {
  ACCESS_KEY: string; // secret: `wrangler secret put ACCESS_KEY`
  ALLOWED_ORIGINS: string; // comma-separated, from wrangler.toml
}

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
const EXPOSE = 'content-length, content-range, accept-ranges, x-adcheck, x-upstream-total, x-strategy';

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok
    ? {
        'access-control-allow-origin': origin,
        'access-control-expose-headers': EXPOSE,
        'access-control-allow-headers': 'range',
        vary: 'origin',
      }
    : {};
}

function fail(status: number, error: string, extra: Record<string, string>): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const c = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...c, 'access-control-max-age': '86400' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'method not allowed', c);

    const url = new URL(req.url);
    if (!env.ACCESS_KEY || url.searchParams.get('key') !== env.ACCESS_KEY) return fail(401, 'bad key', c);

    const target = url.searchParams.get('url') ?? '';
    if (!/^https?:\/\//.test(target)) return fail(400, 'url required', c);
    const strategy = strategyFor(target);

    if (url.pathname === '/feed') {
      let up: Response;
      try {
        up = await fetch(target, {
          headers: { ...strategy.headers, accept: 'application/rss+xml, application/xml, text/xml' },
          redirect: 'follow',
        });
      } catch (err) {
        return fail(502, `upstream unreachable: ${(err as Error).message}`, c);
      }
      if (!up.ok) return fail(502, `feed fetch failed: HTTP ${up.status}`, c);
      return new Response(up.body, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8', ...c } });
    }

    if (url.pathname === '/audio') {
      const headers: Record<string, string> = { ...strategy.headers };
      const range = req.headers.get('range');
      if (range) headers.range = range;
      let up: Response;
      try {
        up = await fetch(target, { headers, redirect: 'follow' });
      } catch (err) {
        return fail(502, `upstream unreachable: ${(err as Error).message}`, c);
      }
      if (!up.ok) return fail(502, `upstream HTTP ${up.status}`, c);

      const out = new Headers(c);
      for (const h of PASS) {
        const v = up.headers.get(h);
        if (v) out.set(h, v);
      }
      const total =
        up.status === 206 ? totalFromContentRange(up.headers.get('content-range')) : Number(up.headers.get('content-length')) || null;
      const declared = Number(url.searchParams.get('len')) || null;
      out.set('x-adcheck', verdictFor(total, declared));
      out.set('x-upstream-total', String(total ?? ''));
      out.set('x-strategy', strategy.name);
      return new Response(req.method === 'HEAD' ? null : up.body, { status: up.status, headers: out });
    }

    return fail(404, 'not found', c);
  },
};
