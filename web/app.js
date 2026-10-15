import { parseFeed } from './feed.js';
import { WORKER, FEEDS } from './config.js';

const $ = (id) => document.getElementById(id);
const player = $('player');
const LABEL = { clean: 'ad-free', suspected: 'ads suspected', unknown: 'unchecked' };
const SAVE_EVERY_MS = 15000;
const PAGE = 50;

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota: cache only, safe to drop */ }
}

let session = load('adfree.session', null); // { token, user }
let prog = new Map(); // guid -> progress row from the server
let episodes = []; // open show's episodes, newest first
let openFeed = null; // url of the show whose drawer is open
let shown = PAGE;
let current = null; // episode being played
let lastSave = 0;
const verdicts = load('adfree.verdicts', {});

// ---- api ----
class AuthError extends Error {}

async function api(path, { method = 'GET', body, keepalive } = {}) {
  const r = await fetch(WORKER + path, {
    method,
    keepalive,
    headers: { ...(session ? { authorization: `Bearer ${session.token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && session) { signOut(); throw new AuthError('Session expired. Sign in again.'); }
  return r;
}
async function apiJson(path, opts) {
  const r = await api(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
// <audio> cannot send headers, so media requests carry the session token in the URL.
const audioUrl = (ep) => `${WORKER}/audio?${new URLSearchParams({ url: ep.enclosureUrl, len: ep.declaredLength ?? '', token: session.token })}`;

// ---- helpers ----
const say = (t) => { $('msg').textContent = t || ''; };
function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function clock(s) {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

// ---- progress ----
async function refreshProgress() {
  const rows = await apiJson('/progress');
  prog = new Map(rows.map((r) => [r.guid, r]));
  store('adfree.prog.' + session.user, rows);
  renderEpisodes();
  renderResume();
}

function putProgress(ep, row, keepalive) {
  prog.set(ep.guid, row);
  api('/progress', {
    method: 'PUT',
    keepalive,
    body: {
      guid: ep.guid, feed: ep.feed, title: ep.title, enclosureUrl: ep.enclosureUrl, declaredLength: ep.declaredLength,
      position: row.position, duration: row.duration, played: !!row.played,
    },
  }).catch(() => {});
}

function rowFor(ep, position, played) {
  return {
    guid: ep.guid, feed: ep.feed, title: ep.title, enclosure_url: ep.enclosureUrl, declared_length: ep.declaredLength ?? null,
    position, duration: prog.get(ep.guid)?.duration ?? ep.durationSec ?? null, played: played ? 1 : 0, updated: Date.now(),
  };
}

function pushPlayback(ep, { played, keepalive } = {}) {
  if (!session) return;
  const duration = Number.isFinite(player.duration) ? player.duration : prog.get(ep.guid)?.duration ?? ep.durationSec ?? null;
  const row = { ...rowFor(ep, player.currentTime || 0, played ?? prog.get(ep.guid)?.played), duration };
  putProgress(ep, row, keepalive);
}

function setPlayed(ep, played) {
  const position = played ? prog.get(ep.guid)?.position ?? 0 : 0;
  putProgress(ep, rowFor(ep, position, played));
  renderEpisodes();
  renderResume();
}

// ---- rendering ----
function fromRow(r) {
  return { guid: r.guid, feed: r.feed, title: r.title, enclosureUrl: r.enclosure_url, declaredLength: r.declared_length, durationSec: r.duration };
}

function playLabel(guid) {
  const r = prog.get(guid);
  if (r?.played) return 'Replay';
  return r && r.position > 5 ? `Resume ${clock(r.position)}` : 'Play';
}

function renderEpisodes() {
  const list = episodes.slice(0, shown);
  $('eps').innerHTML = list.map((e, i) => {
    const r = prog.get(e.guid);
    const dur = e.durationSec || r?.duration;
    const pct = r?.played ? 100 : r && dur ? Math.min(100, (r.position / dur) * 100) : 0;
    const v = verdicts[e.guid];
    return `<li class="${r?.played ? 'done' : ''}">
      <div class="t"><b>${esc(e.title)}</b>
        <small>${esc(e.pubDate ? new Date(e.pubDate).toLocaleDateString() : '')} ${dur ? clock(dur) : ''}</small>
        ${pct ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>
      ${v ? `<span class="badge ${v}">${LABEL[v]}</span>` : ''}
      <button data-mark="${i}" title="${r?.played ? 'Mark unplayed' : 'Mark played'}">${r?.played ? '↺' : '✓'}</button>
      <button data-play="${i}">${playLabel(e.guid)}</button>
    </li>`;
  }).join('') + (episodes.length > shown ? '<li><button data-more="1">Show more</button></li>' : '');
}

function renderResume() {
  const rows = [...prog.values()].filter((r) => !r.played && r.position > 30).sort((a, b) => b.updated - a.updated).slice(0, 5);
  $('resume').hidden = rows.length === 0;
  $('resumeList').dataset.guids = JSON.stringify(rows.map((r) => r.guid));
  $('resumeList').innerHTML = rows.map((r, i) => `<li>
      <div class="t"><b>${esc(r.title)}</b>
        <small>${esc(FEEDS.find((f) => f.url === r.feed)?.name ?? '')} · ${clock(r.position)}${r.duration ? ' of ' + clock(r.duration) : ''}</small></div>
      <button data-resume="${i}">Resume</button></li>`).join('');
}

// ---- shows ----
function renderGrid() {
  for (const t of $('grid').querySelectorAll('.tile')) t.remove();
  $('grid').insertAdjacentHTML('afterbegin', FEEDS.map((f) => `<button class="tile" role="listitem" data-url="${esc(f.url)}" aria-label="${esc(f.name)}">
    <img src="${esc(f.art)}" alt="" loading="lazy"><span class="label">${esc(f.name)}</span></button>`).join(''));
}

// Put the drawer right after the last tile of the selected tile's row, so rows below get pushed down.
function placeDrawer() {
  const grid = $('grid'), drawer = $('drawer');
  const tiles = [...grid.querySelectorAll('.tile')];
  const sel = tiles.find((t) => t.dataset.url === openFeed);
  if (!sel) { grid.append(drawer); return; }
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const i = tiles.indexOf(sel);
  tiles[Math.min((Math.floor(i / cols) + 1) * cols, tiles.length) - 1].after(drawer);
  drawer.style.setProperty('--cx', `${sel.offsetLeft + sel.offsetWidth / 2}px`);
}

// Open a show's drawer (or close it with null). Other tiles grey out while it is open.
function openShow(url) {
  const drawer = $('drawer');
  const wasOpen = drawer.classList.contains('open');
  openFeed = url;
  $('grid').classList.toggle('open', !!url);
  for (const t of $('grid').querySelectorAll('.tile')) t.classList.toggle('active', t.dataset.url === url);
  if (!url) {
    drawer.classList.remove('open');
    setTimeout(() => { if (!openFeed) placeDrawer(); }, 450); // park it after it has finished closing
    return;
  }
  // Moving to another row: collapse in place, relocate, then open so it slides out from the new tile.
  drawer.classList.remove('open');
  placeDrawer();
  void drawer.offsetHeight;
  drawer.classList.add('open');
  $('drawerTitle').textContent = FEEDS.find((f) => f.url === url).name;
  loadFeed(url);
  $('drawer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- feeds ----
async function loadFeed(url) {
  shown = PAGE;
  const cached = load('adfree.ep.' + url, null);
  episodes = cached ?? [];
  renderEpisodes();
  say(cached ? '' : 'Loading…');
  try {
    const r = await api('/feed?' + new URLSearchParams({ url }));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const parsed = parseFeed(await r.text());
    if (openFeed !== url) return; // switched or closed meanwhile
    episodes = parsed.episodes.map((e) => ({ ...e, feed: url }));
    store('adfree.ep.' + url, episodes.slice(0, 120));
    say('');
    renderEpisodes();
  } catch (err) {
    if (!(err instanceof AuthError)) say(`Feed failed: ${err.message}${cached ? ' (showing saved list)' : ''}`);
  }
}

// A 1-byte ranged GET: the worker reports whether the upstream total matches the feed's length.
async function check(ep) {
  const r = await fetch(audioUrl(ep), { headers: { range: 'bytes=0-0' } });
  await r.body?.cancel();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.headers.get('x-adcheck') || 'unknown';
}

async function play(ep) {
  if (current && current.guid !== ep.guid && player.currentTime) pushPlayback(current, { keepalive: true });
  current = ep;
  say('');
  $('now').innerHTML = '<small>Checking for ads…</small>';
  // Pick up the newest position from any device before starting.
  await refreshProgress().catch(() => {});
  const r = prog.get(ep.guid);
  const start = r && !r.played && r.position > 5 ? r.position : 0;
  try {
    verdicts[ep.guid] = await check(ep);
    store('adfree.verdicts', verdicts);
    renderEpisodes();
    if (verdicts[ep.guid] === 'suspected') say('Loophole may be closed: upstream is serving more audio than the feed declares, so ads are probably in this file.');
  } catch (err) {
    say(`Ad check failed: ${err.message}`);
  }
  player.src = audioUrl(ep);
  player.addEventListener('loadedmetadata', () => { if (start) player.currentTime = start; }, { once: true });
  await player.play().catch(() => {});
  lastSave = Date.now();
  $('now').innerHTML = `<small>${esc(ep.title)}</small>`;
}

player.addEventListener('timeupdate', () => {
  if (!current || !player.currentTime || Date.now() - lastSave < SAVE_EVERY_MS) return;
  lastSave = Date.now();
  pushPlayback(current);
});
player.addEventListener('pause', () => { if (current && !player.ended && player.currentTime) pushPlayback(current, { keepalive: true }); });
player.addEventListener('ended', () => { if (current) { pushPlayback(current, { played: 1 }); renderEpisodes(); renderResume(); } });
player.addEventListener('seeked', () => { if (current && player.currentTime) { lastSave = Date.now(); pushPlayback(current); } });
player.addEventListener('error', () => { if (current) say('Playback failed. Check your connection or sign in again.'); });
document.addEventListener('visibilitychange', () => {
  if (!session) return;
  if (document.hidden) { if (current && player.currentTime) pushPlayback(current, { keepalive: true }); }
  else if (player.paused) refreshProgress().catch(() => {});
});

// ---- clicks ----
$('eps').addEventListener('click', (e) => {
  const d = e.target.dataset ?? {};
  if (d.play !== undefined) play(episodes[Number(d.play)]);
  else if (d.mark !== undefined) { const ep = episodes[Number(d.mark)]; setPlayed(ep, !prog.get(ep.guid)?.played); }
  else if (d.more) { shown += PAGE; renderEpisodes(); }
});
$('resumeList').addEventListener('click', (e) => {
  if (e.target.dataset?.resume === undefined) return;
  const r = prog.get(JSON.parse($('resumeList').dataset.guids)[Number(e.target.dataset.resume)]);
  if (r) play(fromRow(r));
});
$('grid').addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (tile) openShow(tile.dataset.url === openFeed ? null : tile.dataset.url);
});
window.addEventListener('resize', () => { if (openFeed) placeDrawer(); });
$('drawerClose').addEventListener('click', () => openShow(null));

// ---- sign in ----
let registering = false;
function showLogin(on) { $('login').hidden = !on; $('logout').hidden = on; }
function setMode(reg) {
  registering = reg;
  $('loginTitle').textContent = reg ? 'Create account' : 'Sign in';
  $('loginForm').querySelector('button').textContent = reg ? 'Create account' : 'Sign in';
  $('toggle').textContent = reg ? 'I already have an account' : 'Create an account';
  $('invite').hidden = !reg;
  $('invite').required = reg;
  $('pass').autocomplete = reg ? 'new-password' : 'current-password';
}
$('toggle').addEventListener('click', (e) => { e.preventDefault(); setMode(!registering); $('loginMsg').textContent = ''; });
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginMsg').textContent = '';
  try {
    const out = await apiJson(registering ? '/auth/register' : '/auth/login', {
      method: 'POST', body: { user: $('user').value, password: $('pass').value, invite: $('invite').value },
    });
    session = { token: out.token, user: out.user };
    store('adfree.session', session);
    $('pass').value = ''; $('invite').value = '';
    start();
  } catch (err) { $('loginMsg').textContent = err.message; }
});

function signOut() {
  if (current && session && player.currentTime) pushPlayback(current, { keepalive: true });
  player.pause();
  player.removeAttribute('src');
  current = null; session = null; prog = new Map();
  try { localStorage.removeItem('adfree.session'); } catch { /* nothing to clear */ }
  $('who').textContent = '';
  $('now').innerHTML = '<small>Nothing playing</small>';
  renderEpisodes();
  renderResume();
  showLogin(true);
}
$('logout').addEventListener('click', signOut);

function start() {
  showLogin(false);
  $('who').textContent = session.user;
  for (const r of load('adfree.prog.' + session.user, [])) prog.set(r.guid, r);
  renderGrid();
  renderResume();
  refreshProgress().catch((err) => { if (!(err instanceof AuthError)) say(`Could not sync progress: ${err.message}`); });
}

setMode(false);
if (session) start(); else showLogin(true);
