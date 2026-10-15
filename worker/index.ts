// Cloudflare Worker: the server half of the standalone page. Browsers cannot
// set a User-Agent or read cross-origin feeds, so this proxies both. It stores
// accounts, sessions, invites and listening progress (D1), never audio.
import { strategyFor } from '../src/strategy.ts';
import { verdictFor, totalFromContentRange } from '../src/adcheck.ts';

interface Env {
  ACCESS_KEY: string; // secret: bootstrap code, only accepted while no account exists yet
  ALLOWED_ORIGINS: string;
  DB: D1Database;
}

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
const EXPOSE = 'content-length, content-range, accept-ranges, x-adcheck, x-upstream-total, x-strategy';
const SESSION_DAYS = 90;
const INVITE_DAYS = 7;
const PBKDF2_ITERATIONS = 100_000; // the Workers runtime maximum
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

type Cors = Record<string, string>;
interface User {
  name: string;
  admin: boolean;
  token: string;
}

function cors(req: Request, env: Env): Cors {
  const origin = req.headers.get('origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok
    ? {
        'access-control-allow-origin': origin,
        'access-control-expose-headers': EXPOSE,
        'access-control-allow-headers': 'range, content-type, authorization',
        'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
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

// XXXX-XXXX-XXXX from unambiguous characters.
function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-');
}
const normalizeCode = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const prettyCode = (n: string) => `${n.slice(0, 4)}-${n.slice(4, 8)}-${n.slice(8, 12)}`;

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
async function userFor(req: Request, url: URL, env: Env): Promise<User | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const token = bearer || url.searchParams.get('token');
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.name AS name, u.is_admin AS admin FROM sessions s JOIN users u ON u.name = s.user WHERE s.token = ? AND s.expires > ?',
  )
    .bind(token, Date.now())
    .first<{ name: string; admin: number }>();
  return row ? { name: row.name, admin: !!row.admin, token } : null;
}

async function auth(req: Request, url: URL, env: Env, c: Cors): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' }, c);
  const body = await readBody(req);
  const name = String(body.user ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!/^[a-z0-9_.-]{3,32}$/.test(name)) return json(400, { error: 'username: 3-32 letters, digits, . _ -' }, c);
  if (password.length < 8) return json(400, { error: 'password must be at least 8 characters' }, c);

  if (url.pathname === '/auth/register') {
    const count = (await env.DB.prepare('SELECT count(*) AS n FROM users').first<{ n: number }>())?.n ?? 0;
    const given = String(body.invite ?? '');
    let inviteCode: string | null = null;
    if (count === 0) {
      // The very first account is the admin and signs up with the bootstrap secret.
      if (!env.ACCESS_KEY || !sameString(given, env.ACCESS_KEY)) return json(403, { error: 'wrong invite code' }, c);
    } else {
      inviteCode = normalizeCode(given);
      const inv = await env.DB.prepare('SELECT 1 AS ok FROM invites WHERE code = ? AND used_by IS NULL AND revoked = 0 AND expires > ?')
        .bind(inviteCode, Date.now())
        .first();
      if (!inv) return json(403, { error: 'invite code is invalid, used, or expired' }, c);
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt);
    try {
      await env.DB.prepare('INSERT INTO users (name, salt, hash, created, is_admin) VALUES (?, ?, ?, ?, ?)')
        .bind(name, hex(salt), hash, Date.now(), count === 0 ? 1 : 0)
        .run();
    } catch {
      return json(409, { error: 'username taken' }, c);
    }
    if (inviteCode) {
      // Single use: if someone else consumed it between the check and now, back out.
      const used = await env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL AND revoked = 0')
        .bind(name, Date.now(), inviteCode)
        .run();
      if (!used.meta.changes) {
        await env.DB.prepare('DELETE FROM users WHERE name = ?').bind(name).run();
        return json(403, { error: 'invite code is invalid, used, or expired' }, c);
      }
    }
    return json(200, { token: await newSession(env, name), user: name, admin: count === 0 }, c);
  }

  const row = await env.DB.prepare('SELECT salt, hash, is_admin FROM users WHERE name = ?').bind(name).first<{ salt: string; hash: string; is_admin: number }>();
  // Hash even for an unknown user so timing does not reveal which usernames exist.
  const hash = await hashPassword(password, row ? unhex(row.salt) : new Uint8Array(16));
  if (!row || !sameString(hash, row.hash)) return json(401, { error: 'wrong username or password' }, c);
  return json(200, { token: await newSession(env, name), user: name, admin: !!row.is_admin }, c);
}

async function verifyPassword(env: Env, name: string, password: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT salt, hash FROM users WHERE name = ?').bind(name).first<{ salt: string; hash: string }>();
  if (!row) return false;
  return sameString(await hashPassword(password, unhex(row.salt)), row.hash);
}

async function removeUser(env: Env, name: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM progress WHERE user = ?').bind(name),
    env.DB.prepare('DELETE FROM sessions WHERE user = ?').bind(name),
    env.DB.prepare('DELETE FROM users WHERE name = ?').bind(name),
  ]);
}

// Signed-in account actions: change password, sign out everywhere, delete account.
async function account(req: Request, url: URL, env: Env, me: User, c: Cors): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' }, c);
  const b = await readBody(req);

  if (url.pathname === '/account/password') {
    const next = String(b.next ?? '');
    if (next.length < 8) return json(400, { error: 'new password must be at least 8 characters' }, c);
    if (!(await verifyPassword(env, me.name, String(b.current ?? '')))) return json(403, { error: 'current password is wrong' }, c);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET salt = ?, hash = ? WHERE name = ?').bind(hex(salt), await hashPassword(next, salt), me.name),
      env.DB.prepare('DELETE FROM sessions WHERE user = ? AND token != ?').bind(me.name, me.token), // sign other devices out
    ]);
    return json(200, { ok: true }, c);
  }
  if (url.pathname === '/account/signout-all') {
    await env.DB.prepare('DELETE FROM sessions WHERE user = ?').bind(me.name).run();
    return json(200, { ok: true }, c);
  }
  if (url.pathname === '/account/delete') {
    if (!(await verifyPassword(env, me.name, String(b.password ?? '')))) return json(403, { error: 'password is wrong' }, c);
    if (me.admin) {
      const others = await env.DB.prepare('SELECT count(*) AS n FROM users WHERE is_admin = 1 AND name != ?').bind(me.name).first<{ n: number }>();
      if (!others?.n) return json(409, { error: 'you are the only admin; remove the other accounts first' }, c);
    }
    await removeUser(env, me.name);
    return json(200, { ok: true }, c);
  }
  return json(404, { error: 'not found' }, c);
}

async function admin(req: Request, url: URL, env: Env, me: User, c: Cors): Promise<Response> {
  if (!me.admin) return json(403, { error: 'admin only' }, c);

  if (url.pathname === '/admin/invites') {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT code, note, created, expires, used_by, used_at, revoked FROM invites ORDER BY created DESC LIMIT 200').all<any>();
      return json(200, results.map((r) => ({ ...r, code: prettyCode(r.code) })), c);
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const days = Math.min(Math.max(Number(b.days) || INVITE_DAYS, 1), 90);
      const code = newInviteCode();
      const now = Date.now();
      await env.DB.prepare('INSERT INTO invites (code, note, created, expires) VALUES (?, ?, ?, ?)')
        .bind(normalizeCode(code), String(b.note ?? '').slice(0, 80), now, now + days * 86_400_000)
        .run();
      return json(200, { code, expires: now + days * 86_400_000 }, c);
    }
    if (req.method === 'DELETE') {
      await env.DB.prepare('UPDATE invites SET revoked = 1 WHERE code = ? AND used_by IS NULL').bind(normalizeCode(url.searchParams.get('code'))).run();
      return json(200, { ok: true }, c);
    }
  }

  if (url.pathname === '/admin/users') {
    if (req.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT u.name, u.created, u.is_admin AS admin,
                (SELECT max(updated) FROM progress p WHERE p.user = u.name) AS last_active,
                (SELECT count(*) FROM progress p WHERE p.user = u.name) AS episodes
         FROM users u ORDER BY u.created`,
      ).all<any>();
      return json(200, results, c);
    }
    if (req.method === 'DELETE') {
      const name = String(url.searchParams.get('name') ?? '');
      if (name === me.name) return json(400, { error: 'use Delete account in your own settings' }, c);
      await removeUser(env, name);
      return json(200, { ok: true }, c);
    }
  }
  return json(404, { error: 'not found' }, c);
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

    const me = await userFor(req, url, env);
    if (!me) return json(401, { error: 'not signed in' }, c);

    if (url.pathname === '/me') return json(200, { user: me.name, admin: me.admin }, c);
    if (url.pathname === '/progress') return progress(req, env, me.name, c);
    if (url.pathname.startsWith('/account/')) return account(req, url, env, me, c);
    if (url.pathname.startsWith('/admin/')) return admin(req, url, env, me, c);

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
