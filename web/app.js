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
let userFeeds = []; // this account's private feeds, from the server
let latestAt = load('adfree.latest', {}); // feed url -> ms of its newest episode
// Most recently updated show first; shows with no known date keep their listed order at the end.
const shows = () => [...FEEDS, ...userFeeds]
  .map((f, i) => ({ f, i }))
  .sort((a, b) => (latestAt[b.f.url] ?? -1) - (latestAt[a.f.url] ?? -1) || a.i - b.i)
  .map((x) => x.f);
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
        <small>${esc(shows().find((f) => f.url === r.feed)?.name ?? '')} · ${clock(r.position)}${r.duration ? ' of ' + clock(r.duration) : ''}</small></div>
      <button data-resume="${i}">Resume</button></li>`).join('');
}

// ---- shows ----
function renderGrid() {
  for (const t of $('grid').querySelectorAll('.tile')) t.remove();
  $('grid').insertAdjacentHTML('afterbegin', shows().map((f) => `<button class="tile${f.art ? '' : ' noart'}" role="listitem" data-url="${esc(f.url)}" aria-label="${esc(f.name)}">
    ${f.art ? `<img src="${esc(f.art)}" alt="" loading="lazy">` : ''}<span class="label">${esc(f.name)}${latestAt[f.url] ? `<small>${ago(latestAt[f.url])}</small>` : ''}</span></button>`).join(''));
  if (openFeed) {
    for (const t of $('grid').querySelectorAll('.tile')) t.classList.toggle('active', t.dataset.url === openFeed);
    placeDrawer();
  }
}

function ago(ms) {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString(undefined, d < 300 ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' });
}

// Ask the worker for each show's newest episode date, then re-sort the tiles.
async function refreshLatest() {
  try {
    const urls = shows().map((f) => f.url);
    const got = await apiJson('/latest?' + urls.map((u) => 'url=' + encodeURIComponent(u)).join('&'));
    for (const [u, t] of Object.entries(got)) if (t) latestAt[u] = t;
    store('adfree.latest', latestAt);
    renderGrid();
  } catch (err) {
    if (!(err instanceof AuthError)) console.warn('latest failed', err);
  }
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

// A feed that could not be fetched gets a red outline on its tile.
function markFeed(url, ok) {
  const tile = [...$('grid').querySelectorAll('.tile')].find((t) => t.dataset.url === url);
  tile?.classList.toggle('failed', !ok);
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
  $('drawerTitle').textContent = shows().find((f) => f.url === url).name;
  loadFeed(url);
  $('drawer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- feeds ----
async function loadFeed(url) {
  shown = PAGE;
  const cached = load('adfree.ep.' + url, null);
  episodes = cached ?? [];
  renderEpisodes();
  $('eps').innerHTML = cached ? $('eps').innerHTML : '<li><small>Loading…</small></li>';
  try {
    const r = await api('/feed?' + new URLSearchParams({ url }));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const parsed = parseFeed(await r.text());
    if (openFeed !== url) return; // switched or closed meanwhile
    episodes = parsed.episodes.map((e) => ({ ...e, feed: url }));
    store('adfree.ep.' + url, episodes.slice(0, 120));
    markFeed(url, true);
    renderEpisodes();
  } catch (err) {
    if (err instanceof AuthError) return;
    markFeed(url, false);
    if (!cached) $('eps').innerHTML = '<li><small>This feed could not be loaded.</small></li>';
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
function showLogin(on) { $('login').hidden = !on; $('settingsBtn').hidden = on; }
function setMode(reg) {
  registering = reg;
  $('loginTitle').textContent = reg ? 'Create account' : 'Sign in';
  $('loginForm').querySelector('button').textContent = reg ? 'Create account' : 'Sign in';
  $('toggle').textContent = reg ? 'I already have an account' : 'Create an account';
  $('invite').hidden = !reg;
  $('inviteLabel').hidden = !reg;
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
    session = { token: out.token, user: out.user, admin: !!out.admin };
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

function start() {
  showLogin(false);
  $('who').textContent = session.user;
  for (const r of load('adfree.prog.' + session.user, [])) prog.set(r.guid, r);
  renderGrid();
  renderResume();
  apiJson('/feeds').then((rows) => { userFeeds = rows; renderGrid(); }).catch(() => {}).then(refreshLatest);
  apiJson('/me').then((m) => { session.admin = m.admin; store('adfree.session', session); }).catch(() => {});
  refreshProgress().catch((err) => { if (!(err instanceof AuthError)) say(`Could not sync progress: ${err.message}`); });
}

// ---- settings / admin ----
const when = (ms) => new Date(ms).toLocaleDateString();
const inviteLink = (code) => `${location.origin}${location.pathname}#invite=${code}`;
const flash = (id, text) => { $(id).textContent = text || ''; };
let lastInvite = '';

function openPanel() {
  $('panel').hidden = false;
  $('acctName').textContent = `Signed in as ${session.user}${session.admin ? ' (admin)' : ''}`;
  for (const id of ['pwCur', 'pwNew', 'delPw']) $(id).value = '';
  flash('acctMsg', ''); flash('adminMsg', '');
  $('newInvite').hidden = true;
  $('adminSec').hidden = !session.admin;
  flash('privMsg', '');
  loadPrivate();
  if (session.admin) loadAdmin();
}
function closePanel() { $('panel').hidden = true; }

async function loadAdmin() {
  try {
    const [invites, users] = await Promise.all([apiJson('/admin/invites'), apiJson('/admin/users')]);
    $('inviteList').innerHTML = invites.map((i) => {
      const active = !i.used_by && !i.revoked && i.expires > Date.now();
      const state = i.used_by ? `used by ${esc(i.used_by)}` : i.revoked ? 'revoked' : i.expires <= Date.now() ? 'expired' : `expires ${when(i.expires)}`;
      return `<li><div class="t"><b>${esc(i.code)}</b><small>${esc(i.note || 'no note')} · ${state}</small></div>
        ${active ? `<button data-copy="${esc(i.code)}">Copy link</button><button data-revoke="${esc(i.code)}">Revoke</button>` : ''}</li>`;
    }).join('') || '<li><small>No invites yet.</small></li>';
    $('userList').innerHTML = users.map((u) => `<li><div class="t"><b>${esc(u.name)}${u.admin ? ' · admin' : ''}</b>
        <small>joined ${when(u.created)} · ${u.last_active ? 'last active ' + when(u.last_active) : 'no listening yet'} · ${u.episodes} episodes</small></div>
        ${u.name === session.user ? '' : `<button data-remove="${esc(u.name)}">Remove</button>`}</li>`).join('');
  } catch (err) { flash('adminMsg', err.message); }
}

async function loadPrivate() {
  try {
    userFeeds = await apiJson('/feeds');
    refreshLatest();
    $('privList').innerHTML = userFeeds.map((f) => `<li><div class="t"><b>${esc(f.name)}</b></div><button data-rmfeed="${f.id}">Remove</button></li>`).join('')
      || '<li><small>None yet.</small></li>';
    renderGrid();
  } catch (err) { flash('privMsg', err.message); }
}
$('privForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  flash('privMsg', 'Checking feed…');
  try {
    await apiJson('/feeds', { method: 'POST', body: { url: $('privUrl').value, name: $('privName').value } });
    $('privUrl').value = ''; $('privName').value = '';
    flash('privMsg', 'Added.');
    loadPrivate();
  } catch (err) { flash('privMsg', err.message); }
});
$('privList').addEventListener('click', async (e) => {
  const id = e.target.dataset?.rmfeed;
  if (!id || !confirm('Remove this private feed? Your listening progress is kept.')) return;
  try {
    const f = userFeeds.find((x) => String(x.id) === id);
    await apiJson('/feeds?id=' + id, { method: 'DELETE' });
    if (f && openFeed === f.url) openShow(null);
    loadPrivate();
  } catch (err) { flash('privMsg', err.message); }
});

$('settingsBtn').addEventListener('click', openPanel);
$('panelClose').addEventListener('click', closePanel);
$('panel').addEventListener('click', (e) => { if (e.target === $('panel')) closePanel(); });
$('signOut').addEventListener('click', () => { closePanel(); signOut(); });
$('signOutAll').addEventListener('click', async () => {
  try { await apiJson('/account/signout-all', { method: 'POST', body: {} }); } catch { /* signing out locally regardless */ }
  closePanel(); signOut();
});
$('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiJson('/account/password', { method: 'POST', body: { current: $('pwCur').value, next: $('pwNew').value } });
    $('pwCur').value = ''; $('pwNew').value = '';
    flash('acctMsg', 'Password changed. Other devices were signed out.');
  } catch (err) { flash('acctMsg', err.message); }
});
$('delForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!confirm('Delete your account and all listening progress? This cannot be undone.')) return;
  try {
    await apiJson('/account/delete', { method: 'POST', body: { password: $('delPw').value } });
    closePanel(); signOut();
  } catch (err) { flash('acctMsg', err.message); }
});
$('inviteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const out = await apiJson('/admin/invites', { method: 'POST', body: { note: $('inviteNote').value, days: Number($('inviteDays').value) } });
    lastInvite = out.code;
    $('newCode').textContent = out.code;
    $('newInvite').hidden = false;
    $('inviteNote').value = '';
    flash('adminMsg', '');
    loadAdmin();
  } catch (err) { flash('adminMsg', err.message); }
});
async function copy(text, id) {
  try { await navigator.clipboard.writeText(text); flash(id, 'Link copied.'); } catch { flash(id, text); }
}
$('copyLink').addEventListener('click', () => copy(inviteLink(lastInvite), 'adminMsg'));
$('adminSec').addEventListener('click', async (e) => {
  const d = e.target.dataset ?? {};
  try {
    if (d.copy) copy(inviteLink(d.copy), 'adminMsg');
    else if (d.revoke && confirm('Revoke this invite? The link will stop working.')) { await apiJson('/admin/invites?code=' + encodeURIComponent(d.revoke), { method: 'DELETE' }); loadAdmin(); }
    else if (d.remove && confirm(`Remove ${d.remove} and their listening progress?`)) {
      await apiJson('/admin/users?name=' + encodeURIComponent(d.remove), { method: 'DELETE' }); loadAdmin();
    }
  } catch (err) { flash('adminMsg', err.message); }
});

// An invite link (#invite=CODE) opens straight to account creation.
setMode(false);
{
  const code = new URLSearchParams(location.hash.slice(1)).get('invite');
  if (code && !session) {
    setMode(true);
    $('invite').value = code;
    history.replaceState(null, '', location.pathname);
  }
}

if (session) start(); else showLogin(true);
