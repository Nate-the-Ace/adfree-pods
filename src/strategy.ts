// The only place that knows which User-Agent a host needs to serve the
// original (unstitched) audio. See docs/superpowers/specs/ for the measurements.

export const CRAWLER_UA = 'Googlebot/2.1 (+http://www.google.com/bot.html)';
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Hosts whose dynamic ad insertion is skipped for the crawler UA.
// Podtrac is the redirect hop in front of Omny and Libsyn enclosures.
// Libsyn (docs/research/the-know-rogan-experience.md): bots and generic clients get the original file.
// Simplecast, Acast, Audioboom and Megaphone: stitched ads skip the crawler UA too
// (docs/research/shows.md). The tracker hops (pscrb.fm, prfx.byspotify.com, ...) sit in
// front of those enclosures, so they carry the same UA down the redirect chain.
const CLEAN_FETCH_HOSTS = [
  'omny.fm', 'omnycontent.com', 'tritondigital.com', 'podtrac.com', 'libsyn.com',
  'simplecast.com', 'simplecastaudio.com', 'acast.com', 'audioboom.com', 'megaphone.fm',
  'pscrb.fm', 'prfx.byspotify.com', 'claritaspod.com', 'pdst.fm', 'mgln.ai', 'clrtpod.com',
];

export interface FetchStrategy {
  name: 'crawler-ua' | 'default';
  headers: Record<string, string>;
}

export function strategyFor(url: string): FetchStrategy {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { name: 'default', headers: { 'User-Agent': BROWSER_UA } };
  }
  const clean = CLEAN_FETCH_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  return clean
    ? { name: 'crawler-ua', headers: { 'User-Agent': CRAWLER_UA } }
    : { name: 'default', headers: { 'User-Agent': BROWSER_UA } };
}
