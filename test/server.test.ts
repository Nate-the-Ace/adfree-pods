import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.ts';

// End to end against local fakes: a feed server, an audio server, and the app.
const AUDIO = Buffer.alloc(100_000, 7);
const seenUA: string[] = [];
let audioSrv: Server, feedSrv: Server, app: Server;
let appBase = '', feedUrl = '';

const listen = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

before(async () => {
  audioSrv = createServer((req, res) => {
    seenUA.push(String(req.headers['user-agent']));
    const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : AUDIO.length - 1;
      res.writeHead(206, { 'content-type': 'audio/mpeg', 'content-range': `bytes ${a}-${b}/${AUDIO.length}`, 'content-length': b - a + 1 });
      return void res.end(AUDIO.subarray(a, b + 1));
    }
    res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': AUDIO.length });
    res.end(AUDIO);
  });
  const ap = await listen(audioSrv);
  feedSrv = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    res.end(`<rss><channel><title>Fake Show</title>
      <item><title>clean</title><guid>g1</guid><enclosure url="http://127.0.0.1:${ap}/a.mp3" length="${AUDIO.length}" type="audio/mpeg"/></item>
      <item><title>laden</title><guid>g2</guid><enclosure url="http://127.0.0.1:${ap}/b.mp3" length="${AUDIO.length - 50000}" type="audio/mpeg"/></item>
    </channel></rss>`);
  });
  feedUrl = `http://127.0.0.1:${await listen(feedSrv)}/feed.rss`;
  app = createApp(':memory:');
  appBase = `http://127.0.0.1:${await listen(app)}`;
});
after(() => [audioSrv, feedSrv, app].forEach((s) => s.close()));

const api = (path: string, init?: RequestInit) => fetch(appBase + path, init);

test('add feed, list episodes, re-add is idempotent', async () => {
  const add = await api('/api/feeds', { method: 'POST', body: JSON.stringify({ url: feedUrl }) });
  assert.equal(add.status, 200);
  assert.equal((await add.json() as any).episodes, 2);
  await api('/api/feeds', { method: 'POST', body: JSON.stringify({ url: feedUrl }) });
  const feeds = (await (await api('/api/feeds')).json()) as any[];
  assert.equal(feeds.length, 1);
  const eps = (await (await api(`/api/feeds/${feeds[0].id}/episodes`)).json()) as any[];
  assert.equal(eps.length, 2);
});

test('bad feed url is a 400, unreachable feed is a 502', async () => {
  assert.equal((await api('/api/feeds', { method: 'POST', body: JSON.stringify({ url: 'nope' }) })).status, 400);
  assert.equal((await api('/api/feeds', { method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:1/x' }) })).status, 502);
});

test('proxy streams full audio and flags a matching length as clean', async () => {
  const r = await api('/audio/1');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-adcheck'), 'clean');
  assert.equal((await r.arrayBuffer()).byteLength, AUDIO.length);
});

test('proxy passes Range through (seeking) and keeps the verdict', async () => {
  const r = await api('/audio/1', { headers: { Range: 'bytes=100-199' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), `bytes 100-199/${AUDIO.length}`);
  assert.equal(r.headers.get('x-adcheck'), 'clean');
  assert.equal((await r.arrayBuffer()).byteLength, 100);
});

test('proxy flags upstream larger than declared as suspected', async () => {
  const r = await api('/audio/2');
  assert.equal(r.headers.get('x-adcheck'), 'suspected');
  await r.arrayBuffer();
});

test('check endpoint stores the verdict', async () => {
  const ok = (await (await api('/api/episodes/1/check', { method: 'POST' })).json()) as any;
  assert.equal(ok.verdict, 'clean');
  const bad = (await (await api('/api/episodes/2/check', { method: 'POST' })).json()) as any;
  assert.equal(bad.verdict, 'suspected');
  assert.equal((await api('/api/episodes/99/check', { method: 'POST' })).status, 404);
});

test('progress is saved and validated', async () => {
  const put = (position: unknown) =>
    api('/api/episodes/1/progress', { method: 'PUT', body: JSON.stringify({ position }) });
  assert.equal((await put(42.5)).status, 200);
  assert.equal((await put(-1)).status, 400);
  const eps = (await (await api('/api/feeds/1/episodes')).json()) as any[];
  assert.equal(eps.find((e) => e.id === 1).position_sec, 42.5);
});

test('unknown audio id is 404; path traversal is refused', async () => {
  assert.equal((await api('/audio/999')).status, 404);
  const r = await fetch(appBase + '/%2e%2e/package.json');
  assert.notEqual(r.status, 200);
});
