const $ = (id) => document.getElementById(id);
const player = $('player');
let current = null; // episode being played
let lastSave = 0;

const LABEL = { clean: 'ad-free', suspected: 'ads suspected', unknown: 'unchecked' };

function fmtDur(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

async function api(path, init) {
  const r = await fetch(path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

function say(text) { $('msg').textContent = text || ''; }

async function loadFeeds(selectId) {
  const feeds = await api('/api/feeds');
  $('feeds').innerHTML = feeds.map((f) => `<option value="${f.id}">${esc(f.title || f.url)}</option>`).join('');
  $('feeds').hidden = feeds.length === 0;
  if (selectId) $('feeds').value = String(selectId);
  if (feeds.length) await loadEpisodes();
  else $('eps').innerHTML = '';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

async function loadEpisodes() {
  const eps = await api(`/api/feeds/${$('feeds').value}/episodes`);
  $('eps').innerHTML = eps.map((e) => `
    <li data-id="${e.id}">
      <div class="t"><b>${esc(e.title)}</b>
        <small>${esc(e.pub_date ? new Date(e.pub_date).toLocaleDateString() : '')} ${fmtDur(e.duration_sec)}</small></div>
      <span class="badge ${e.verdict || 'unknown'}">${LABEL[e.verdict || 'unknown']}</span>
      <button data-play="${e.id}">Play</button>
    </li>`).join('');
  window.__eps = Object.fromEntries(eps.map((e) => [e.id, e]));
}

async function play(id) {
  const ep = window.__eps[id];
  say('');
  current = ep;
  $('now').innerHTML = `<small>Checking for ads…</small>`;
  try {
    const check = await api(`/api/episodes/${id}/check`, { method: 'POST' });
    ep.verdict = check.verdict;
    const li = document.querySelector(`li[data-id="${id}"] .badge`);
    li.className = `badge ${check.verdict}`;
    li.textContent = LABEL[check.verdict];
    if (check.verdict === 'suspected') {
      say('Warning: upstream is serving more audio than the feed declares, so ads are probably in this file.');
    }
  } catch (err) {
    say(`Ad check failed: ${err.message}`);
  }
  player.src = `/audio/${id}`;
  player.addEventListener('loadedmetadata', () => { if (ep.position_sec > 5) player.currentTime = ep.position_sec; }, { once: true });
  await player.play().catch(() => {});
  $('now').innerHTML = `<small>${esc(ep.title)}</small>`;
}

function savePosition(force) {
  if (!current || !player.currentTime) return;
  const now = Date.now();
  if (!force && now - lastSave < 5000) return;
  lastSave = now;
  current.position_sec = player.currentTime;
  fetch(`/api/episodes/${current.id}/progress`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ position: player.currentTime }), keepalive: true,
  });
}

player.addEventListener('timeupdate', () => savePosition(false));
player.addEventListener('pause', () => savePosition(true));
player.addEventListener('error', () => say('Playback failed. Is the feed host reachable?'));

$('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  say('Adding…');
  try {
    const { feedId } = await api('/api/feeds', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: $('feedUrl').value }),
    });
    $('feedUrl').value = '';
    say('');
    await loadFeeds(feedId);
  } catch (err) { say(err.message); }
});
$('feeds').addEventListener('change', loadEpisodes);
$('eps').addEventListener('click', (e) => {
  const id = e.target.dataset?.play;
  if (id) play(Number(id));
});

loadFeeds().catch((err) => say(err.message));
