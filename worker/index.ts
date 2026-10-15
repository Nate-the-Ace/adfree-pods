// Cloudflare Worker: the server half of the standalone page. Browsers cannot
// set a User-Agent or read cross-origin feeds, so this proxies both. It stores
// accounts, sessions and listening progress (D1), never audio.
import { strategyFor } from '../src/strategy.ts';
import { verdictFor, totalFromContentRange } from '../src/adcheck.ts';

interface Env {
  ACCESS_KEY: string; // secret: the invite code needed to register
  ALLOWED_ORIGINS: string;
  DB: D1Database;
}

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
const EXPOSE = 'content-length, content-range, accept-ranges, x-adcheck, x-upstream-total, x-strategy';
const SESSION_DAYS = 90;
const PBKDF2_ITERATIONS = 100_000; // the Workers runtime maximum

type Cors = Record<string, string>;

function cors(req: Request, env: Env): Cors {
  const origin = req.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok
    ? {
        'access-control-allow-origin': origin,
        'access-control-expose-headers': EXPOSE,
        'access-control-allow-headers': 'range, content-type, authorization',
        'access-control-allow-methods': 'GET, HEAD, POST, PUT, OPTIONS',
        vary: 'origin',
      }
    : {};
}

function json(status: number, body: unknown, c: Cors): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...c } });
}

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function readBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function newSession(env: Env, user: string): Promise<string> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token, user, expires) VALUES (?, ?, ?)').bind(token, user, now + SESSION_DAYS * 86_400_000),
  ]);
  return token;
}

// Bearer header for API calls; ?token= for <audio>, which cannot send headers.
async function userFor(req: Request, url: URL, env: Env): Promise<string | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const token = bearer || url.searchParams.get('token');
  if (!token) return null;
  const row = await env.DB.prepare('SELECT user FROM sessions WHERE token = ? AND expires > ?').bind(token, Date.now()).first<{ user: string }>();
  return row?.user ?? null;
}

async function auth(req: Request, url: URL, env: Env, c: Cors): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' }, c);
  const body = await readBody(req);
  const name = String(body.user ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!/^[a-z0-9_.-]{3,32}$/.test(name)) return json(400, { error: 'username: 3-32 letters, digits, . _ -' }, c);
  if (password.length < 8) return json(400, { error: 'password must be at least 8 characters' }, c);

  if (url.pathname === '/auth/register') {
    if (!env.ACCESS_KEY || !sameString(String(body.invite ?? ''), env.ACCESS_KEY)) return json(403, { error: 'wrong invite code' }, c);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt);
    try {
      await env.DB.prepare('INSERT INTO users (name, salt, hash, created) VALUES (?, ?, ?, ?)').bind(name, hex(salt), hash, Date.now()).run();
    } catch {
      return json(409, { error: 'username taken' }, c);
    }
    return json(200, { token: await newSession(env, name), user: name }, c);
  }

  const row = await env.DB.prepare('SELECT salt, hash FROM users WHERE name = ?').bind(name).first<{ salt: string; hash: string }>();
  // Hash even for an unknown user so timing does not reveal which usernames exist.
  const hash = await hashPassword(password, row ? unhex(row.salt) : new Uint8Array(16));
  if (!row || !sameString(hash, row.hash)) return json(401, { error: 'wrong username or password' }, c);
  return json(200, { token: await newSession(env, name), user: name }, c);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

async function progress(req: Request, env: Env, user: string, c: Cors): Promise<Response> {
  if (req.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT guid, feed, title, enclosure_url, declared_length, position, duration, played, updated FROM progress WHERE user = ? ORDER BY updated DESC LIMIT 5000',
    )
      .bind(user)
      .all();
    return json(200, results, c);
  }
  if (req.method === 'PUT') {
    const b = await readBody(req);
    const position = num(b.position);
    if (typeof b.guid !== 'string' || !b.guid || b.guid.length > 600 || position === null) return json(400, { error: 'guid and position required' }, c);
    await env.DB.prepare(
      `INSERT INTO progress (user, guid, feed, title, enclosure_url, declared_length, position, duration, played, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user, guid) DO UPDATE SET
         feed = excluded.feed, title = excluded.title, enclosure_url = excluded.enclosure_url,
         declared_length = excluded.declared_length, position = excluded.position,
         duration = excluded.duration, played = excluded.played, updated = excluded.updated`,
    )
      .bind(user, b.guid, String(b.feed ?? '').slice(0, 600), String(b.title ?? '').slice(0, 300), String(b.enclosureUrl ?? '').slice(0, 2000), num(b.declaredLength), position, num(b.duration), b.played ? 1 : 0, Date.now())
      .run();
    return json(200, { ok: true }, c);
  }
  return json(405, { error: 'method not allowed' }, c);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const c = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...c, 'access-control-max-age': '86400' } });

    const url = new URL(req.url);
    if (url.pathname.startsWith('/auth/')) return auth(req, url, env, c);

    const user = await userFor(req, url, env);
    if (!user) return json(401, { error: 'not signed in' }, c);

    if (url.pathname === '/me') return json(200, { user }, c);
    if (url.pathname === '/progress') return progress(req, env, user, c);

    if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'method not allowed' }, c);
    const target = url.searchParams.get('url') ?? '';
    if (!/^https?:\/\//.test(target)) return json(400, { error: 'url required' }, c);
    const strategy = strategyFor(target);

    if (url.pathname === '/feed') {
      let up: Response;
      try {
        up = await fetch(target, {
          headers: { ...strategy.headers, accept: 'application/rss+xml, application/xml, text/xml' },
          redirect: 'follow',
        });
      } catch (err) {
        return json(502, { error: `upstream unreachable: ${(err as Error).message}` }, c);
      }
      if (!up.ok) return json(502, { error: `feed fetch failed: HTTP ${up.status}` }, c);
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
        return json(502, { error: `upstream unreachable: ${(err as Error).message}` }, c);
      }
      if (!up.ok) return json(502, { error: `upstream HTTP ${up.status}` }, c);

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

    return json(404, { error: 'not found' }, c);
  },
};
