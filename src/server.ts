import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, listFeeds, listEpisodes, getEpisode, setVerdict, setPosition } from './db.ts';
import { refreshFeed } from './poller.ts';
import { checkEpisode } from './adcheck.ts';
import { streamAudio } from './proxy.ts';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export function createApp(dbPath = process.env.DB_PATH ?? 'data.sqlite') {
  const db = openDb(dbPath);

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      let m: RegExpMatchArray | null;

      if (path === '/api/feeds' && req.method === 'GET') return json(res, 200, listFeeds(db));

      if (path === '/api/feeds' && req.method === 'POST') {
        const { url: feedUrl } = await readJson(req);
        if (typeof feedUrl !== 'string' || !/^https?:\/\//.test(feedUrl)) return json(res, 400, { error: 'url required' });
        try {
          return json(res, 200, await refreshFeed(db, feedUrl));
        } catch (err) {
          return json(res, 502, { error: (err as Error).message });
        }
      }

      if ((m = path.match(/^\/api\/feeds\/(\d+)\/episodes$/)) && req.method === 'GET')
        return json(res, 200, listEpisodes(db, Number(m[1])));

      if ((m = path.match(/^\/api\/episodes\/(\d+)\/check$/)) && req.method === 'POST') {
        const ep = getEpisode(db, Number(m[1]));
        if (!ep) return json(res, 404, { error: 'no such episode' });
        try {
          const result = await checkEpisode(ep.enclosure_url, ep.declared_length);
          setVerdict(db, ep.id, result.verdict);
          return json(res, 200, result);
        } catch (err) {
          return json(res, 502, { error: (err as Error).message });
        }
      }

      if ((m = path.match(/^\/api\/episodes\/(\d+)\/progress$/)) && req.method === 'PUT') {
        const { position } = await readJson(req);
        if (typeof position !== 'number' || !(position >= 0)) return json(res, 400, { error: 'position required' });
        setPosition(db, Number(m[1]), position);
        return json(res, 200, { ok: true });
      }

      if ((m = path.match(/^\/audio\/(\d+)$/)) && req.method === 'GET') {
        const ep = getEpisode(db, Number(m[1]));
        if (!ep) return json(res, 404, { error: 'no such episode' });
        return await streamAudio(req, res, ep.enclosure_url, ep.declared_length);
      }

      if (req.method === 'GET') {
        const file = normalize(path === '/' ? '/index.html' : path);
        if (file.includes('..')) return json(res, 400, { error: 'bad path' });
        try {
          const body = await readFile(join(PUBLIC_DIR, file));
          res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
          return void res.end(body);
        } catch {
          return json(res, 404, { error: 'not found' });
        }
      }
      return json(res, 405, { error: 'method not allowed' });
    } catch (err) {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    }
  });
}

// Run directly: `npm start`. Bound to localhost only; there is no auth.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 8787);
  createApp().listen(port, '127.0.0.1', () => console.log(`czm-direct on http://127.0.0.1:${port}`));
}
