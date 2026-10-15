import { parseFeed } from './feed.js';

const $ = (id) => document.getElementById(id);
const player = $('player');
const LABEL = { clean: 'ad-free', suspected: 'ads suspected', unknown: 'unchecked' };
let current = null; // { feed, ep }
let lastSave = 0;

// ---- storage: everything lives in this browser ----
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
const save = (key, v) => localStorage.setItem(key, JSON.stringify(v));
let cfg = load('adfree.cfg', { worker: '', key: '' });
let feeds = load('adfree.feeds', []); // [{url, title, episodes: [{..., verdict, position}]}]
const persist = () => save('adfree.feeds', feeds);

// Open the page once with #worker=...&key=... to configure a phone without typing.
{
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('worker') && h.get('key')) {
    cfg = { worker: h.get('worker').replace(/\/$/, ''), key: h.get('key') };
    save('adfree.cfg', cfg);
    history.replaceState(null, '', location.pathname);
  }
}

// ---- worker calls ----
const wurl = (path, params) => `${cfg.worker}${path}?${new URLSearchParams({ ...params, key: cfg.key })}`;
const audioUrl = (ep) => wurl('/audio', { url: ep.enclosureUrl, len: ep.declaredLength ?? '' });

async function fetchFeed(url) {
  if (!cfg.worker) throw new Error('Set the Worker URL and access key in Settings first.');
  const r = await fetch(wurl('/feed', { url }));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return parseFeed(await r.text());
}

async function addOrRefresh(url) {
  const parsed = await fetchFeed(url); // throws before any write: old episodes kept
  let feed = feeds.find((f) => f.url === url);
  if (!feed) feeds.push((feed = { url, title: '', episodes: [] }));
  feed.title = parsed.title;
  const old = new Map(feed.episodes.map((e) => [e.guid, e]));
  feed.episodes = parsed.episodes.map((e) => ({ ...e, verdict: old.get(e.guid)?.verdict ?? null, position: old.get(e.guid)?.position ?? 0 }));
  persist();
  return feed;
}

// A 1-byte ranged GET: the worker reports whether the upstream total matches the feed's length.
async function check(ep) {
  const r = await fetch(audioUrl(ep), { headers: { range: 'bytes=0-0' } });
  await r.body?.cancel();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.headers.get('x-adcheck') || 'unknown';
}

// ---- ui ----
const fmtDur = (s) => (s ? (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`) : '');
const say = (t) => { $('msg').textContent = t || ''; };
function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

function render(selectUrl) {
  $('feeds').innerHTML = feeds.map((f) => `<option value="${esc(f.url)}">${esc(f.title || f.url)}</option>`).join('');
  $('feeds').hidden = feeds.length === 0;
  if (selectUrl) $('feeds').value = selectUrl;
  renderEpisodes();
}

function currentFeed() { return feeds.find((f) => f.url === $('feeds').value); }

function renderEpisodes() {
  const feed = currentFeed();
  $('eps').innerHTML = (feed?.episodes ?? []).map((e, i) => `
    <li>
      <div class="t"><b>${esc(e.title)}</b>
        <small>${esc(e.pubDate ? new Date(e.pubDate).toLocaleDateString() : '')} ${fmtDur(e.durationSec)}</small></div>
      <span class="badge ${e.verdict || 'unknown'}">${LABEL[e.verdict || 'unknown']}</span>
      <button data-play="${i}">Play</button>
    </li>`).join('');
}

async function play(i) {
  const feed = currentFeed();
  const ep = feed.episodes[i];
  current = { feed, ep };
  say('');
  $('now').innerHTML = '<small>Checking for ads…</small>';
  try {
    ep.verdict = await check(ep);
    persist();
    renderEpisodes();
    if (ep.verdict === 'suspected') say('Loophole may be closed: upstream is serving more audio than the feed declares, so ads are probably in this file.');
  } catch (err) {
    say(`Ad check failed: ${err.message}`);
  }
  player.src = audioUrl(ep);
  player.addEventListener('loadedmetadata', () => { if (ep.position > 5) player.currentTime = ep.position; }, { once: true });
  await player.play().catch(() => {});
  $('now').innerHTML = `<small>${esc(ep.title)}</small>`;
}

function savePosition(force) {
  if (!current || !player.currentTime) return;
  const now = Date.now();
  if (!force && now - lastSave < 5000) return;
  lastSave = now;
  current.ep.position = player.currentTime;
  persist();
}

player.addEventListener('timeupdate', () => savePosition(false));
player.addEventListener('pause', () => savePosition(true));
player.addEventListener('error', () => say('Playback failed. Is the worker reachable and the key right?'));

$('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  say('Adding…');
  try {
    const feed = await addOrRefresh($('feedUrl').value);
    $('feedUrl').value = '';
    say('');
    render(feed.url);
  } catch (err) { say(err.message); }
});
$('cfg').addEventListener('submit', (e) => {
  e.preventDefault();
  cfg = { worker: $('workerUrl').value.trim().replace(/\/$/, ''), key: $('accessKey').value };
  save('adfree.cfg', cfg);
  say('Saved.');
});
$('feeds').addEventListener('change', renderEpisodes);
$('eps').addEventListener('click', (e) => {
  const i = e.target.dataset?.play;
  if (i !== undefined) play(Number(i));
});

$('workerUrl').value = cfg.worker;
$('accessKey').value = cfg.key;
$('settings').open = !cfg.worker;
render();
