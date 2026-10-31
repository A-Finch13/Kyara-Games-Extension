// Kyara Games relay (Cloudflare Worker): counts the active installs and adds the subscribers found by the
// extensions to abonnes.json in the repository (a queue checked on kyara.games 44 players at a time, written by
// groups of more than 10), and keeps the profile perks that players without a subscription chose through the
// extension (name colour, banner, title, links…) and which of them use it (their badge).
// Bindings: KV (namespace), GITHUB_TOKEN (secret, Contents read and write on the repository), REPO (variable).

const TIERS = ['nakama', 'senpai', 'sensei', 'daimyo'];
const CHECKS = 44; // players checked per call: a Worker may make 50 requests, the others are kept for GitHub
const COMMIT_AFTER = 10; // abonnes.json is written once more than this many new subscribers are waiting
const DAY = 864e5;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

// ---------- answers ----------

const json = (data, status = 200, more = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS, ...more } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const { pathname } = new URL(req.url);
    try {
      if (req.method === 'POST' && pathname === '/ping') return json(await ping(env, await req.json()));
      if (req.method === 'GET' && pathname === '/stats') return json(await stats(env));
      if (req.method === 'POST' && pathname === '/subscribers') return json(await addSubscribers(env, await req.json()));
      if (req.method === 'GET' && pathname === '/profiles') return json(await profiles(env), 200, { 'cache-control': 'max-age=60' });
      if (req.method === 'POST' && pathname === '/profile') return json(await saveProfile(env, await req.json()));
      if (req.method === 'POST' && pathname === '/member') return json(await saveMember(env, await req.json()));
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 500);
    }
  },

  // Every 5 minutes: checks the next players of the queue.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkQueue(env));
  }
};

// ---------- active installs ----------

// Notes an install as seen today (one write per install and per day), kept 31 days.
async function ping(env, body) {
  const id = String(body?.install ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return { error: 'bad_install' };
  const key = `u:${id}`;
  const last = Number((await env.KV.getWithMetadata(key)).metadata?.t ?? 0);
  if (Date.now() - last > DAY / 2) await env.KV.put(key, '', { metadata: { t: Date.now(), v: String(body.version ?? '') }, expirationTtl: 31 * 86400 });
  return { ok: true };
}

// Installs seen in the last day, week and month, and by version.
async function stats(env) {
  const now = Date.now();
  const out = { day: 0, week: 0, month: 0, versions: {} };
  let cursor;
  do {
    const page = await env.KV.list({ prefix: 'u:', cursor });
    for (const k of page.keys) {
      const t = Number(k.metadata?.t ?? 0);
      if (now - t <= DAY) out.day++;
      if (now - t <= 7 * DAY) out.week++;
      if (now - t <= 30 * DAY) out.month++;
      const v = k.metadata?.v || '?';
      out.versions[v] = (out.versions[v] ?? 0) + 1;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

// ---------- abonnes.json ----------

const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const toBase64 = (text) => btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''));

// Highest tier of a player from their "membre-…" badges, or null.
const tierOf = (badges) => {
  const ids = new Set((badges ?? []).map((b) => b?.id));
  return [...TIERS].reverse().find((t) => ids.has(`membre-${t}`)) ?? null;
};

// Same content as abonnes.json written by the extension: highest tier first, then by pseudo.
function subsJson(subscribers) {
  const list = Object.values(subscribers).sort((a, b) => TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier) || a.pseudo.localeCompare(b.pseudo, 'fr'));
  const keep = ({ id, pseudo, avatar, color, tier, owned, mythics, seen }) => [id, { id, pseudo, avatar, color, tier, owned, mythics, seen }];
  return JSON.stringify({ updated: new Date().toISOString(), count: list.length, subscribers: Object.fromEntries(list.map(keep)) }, null, 2) + '\n';
}

// Kyara profile of a player, or null.
async function profile(id) {
  const res = await fetch(`https://kyara.games/api/users/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
  return res.ok ? res.json() : null;
}

// Puts the new ids in the queue of players to check, then checks some of them; returns where the queue is.
async function addSubscribers(env, body) {
  const ids = [...new Set((body?.ids ?? []).filter((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)))];
  const { known, waiting, queue } = await subsState(env);
  const seen = new Set(queue);
  const added = ids.filter((id) => !known.has(id) && !waiting[id] && !seen.has(id));
  if (added.length) await env.KV.put('subs-queue', JSON.stringify([...queue, ...added]));
  return { queued: added.length, ...(await checkQueue(env)) };
}

// Ids of abonnes.json, subscribers checked but not written yet, and players still to check.
async function subsState(env) {
  const [known, waiting, queue] = await Promise.all([env.KV.get('subs-known', 'json'), env.KV.get('subs-waiting', 'json'), env.KV.get('subs-queue', 'json')]);
  return { known: new Set(known ?? []), waiting: waiting ?? {}, queue: queue ?? [], fresh: !known };
}

// Checks the next players of the queue on kyara.games (CHECKS at most) and writes abonnes.json once more than
// COMMIT_AFTER subscribers are waiting; returns { left, waiting, written }.
async function checkQueue(env) {
  const { known, waiting, queue, fresh } = await subsState(env);
  if (fresh) await readSubsFile(env, known);
  if (!queue.length) return { left: 0, waiting: Object.keys(waiting).length, written: 0 };
  const batch = queue.splice(0, CHECKS);
  for (const id of batch) {
    if (known.has(id) || waiting[id]) continue;
    const p = await profile(id).catch(() => null);
    const tier = tierOf(p?.badges);
    if (tier) waiting[id] = { id, pseudo: p.pseudo ?? '?', avatar: p.avatar ?? null, color: p.nameColor ?? null, tier, owned: p.owned, mythics: p.mythics, seen: Date.now() };
  }
  let written = 0;
  if (Object.keys(waiting).length > COMMIT_AFTER) {
    written = await writeSubsFile(env, waiting, known);
    if (written >= 0) for (const id of Object.keys(waiting)) delete waiting[id];
  }
  await Promise.all([env.KV.put('subs-queue', JSON.stringify(queue)), env.KV.put('subs-waiting', JSON.stringify(waiting))]);
  return { left: queue.length, waiting: Object.keys(waiting).length, written: Math.max(written, 0) };
}

// Reads the ids of abonnes.json into `known` and keeps them for the next calls.
async function readSubsFile(env, known) {
  const res = await fetch(`https://raw.githubusercontent.com/${env.REPO}/main/abonnes.json`, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) return;
  for (const id of Object.keys((await res.json()).subscribers ?? {})) known.add(id);
  await env.KV.put('subs-known', JSON.stringify([...known]));
}

// Adds the waiting subscribers to abonnes.json in the repository; returns how many were new, or -1 when it failed.
async function writeSubsFile(env, waiting, known) {
  const url = `https://api.github.com/repos/${env.REPO}/contents/abonnes.json`;
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GITHUB_TOKEN}`, 'user-agent': 'kyara-games-relay' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await fetch(`${url}?ref=main`, { headers });
    if (!cur.ok) return -1;
    const file = await cur.json();
    const subs = JSON.parse(fromBase64(file.content)).subscribers ?? {};
    const added = Object.keys(waiting).filter((id) => !subs[id]).length;
    Object.assign(subs, Object.fromEntries(Object.entries(waiting).filter(([id]) => !subs[id])));
    for (const id of Object.keys(subs)) known.add(id);
    if (added) {
      const count = Object.keys(subs).length;
      const res = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ message: `Liste des abonnés : ${count} abonnés`, content: toBase64(subsJson(subs)), sha: file.sha, branch: 'main' })
      });
      if (res.status === 409) continue;
      if (!res.ok) return -1;
    }
    await env.KV.put('subs-known', JSON.stringify([...known]));
    return added;
  }
  return -1;
}

// ---------- profile perks of the players without a subscription ----------

const COLORS = ['sakura', 'ciel', 'jade', 'or', 'braise', 'lavande', 'rubis', 'azur'];
const GRADIENTS = ['aurore', 'sakura', 'ocean', 'braise', 'or', 'prisme'];
const HEX = /^#[0-9a-f]{6}$/i;
const BANNERS = ['sakura', 'vagues', 'montagne', 'nuit', 'aurore', 'foudre'];
const THEMES = ['sakura', 'nuit', 'ocean', 'braise', 'jade', 'or']; // also the showcase backdrops
const LINK_KINDS = ['twitch', 'youtube', 'x', 'tiktok', 'instagram', 'kick'];
const LINKS_MAX = 4;
const TITLE_MAX = 24;
const EXTRA_CARDS = 4;
const CARD_IMAGE = /^https:\/\/(s4\.anilist\.co|kyara\.games)\//;

// Perks of every player who chose some, by Kyara id.
async function profiles(env) {
  return (await env.KV.get('profiles', 'json')) ?? {};
}

// The player behind a Kyara session (their token, never kept), or null.
async function sessionUser(token, device) {
  if (typeof token !== 'string' || !token) return null;
  const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
  if (typeof device === 'string' && device) headers['x-device-id'] = device;
  const res = await fetch('https://kyara.games/api/me', { headers });
  if (!res.ok) return null;
  const me = await res.json();
  return typeof me?.id === 'string' ? me : null;
}

// Ids of the cards a player owns, read with their session.
async function ownedIds(token, device) {
  const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
  if (device) headers['x-device-id'] = device;
  const res = await fetch('https://kyara.games/api/me/collection?lean=1', { headers });
  if (!res.ok) return new Set();
  const list = await res.json();
  return new Set((Array.isArray(list) ? list : list?.items ?? []).filter((x) => (x?.qty ?? 1) > 0).map((x) => Number(x.characterId ?? x.id)));
}

const pick = (v, list) => (list.includes(v) ? v : null);
// A colour of the site, or any colour.
const color = (v) => pick(v, COLORS) ?? (HEX.test(v ?? '') ? v.toLowerCase() : null);
// A gradient of the site, or 2 to 3 colours.
function gradient(v) {
  if (!Array.isArray(v)) return pick(v, GRADIENTS);
  const stops = v.filter((c) => HEX.test(c ?? '')).map((c) => c.toLowerCase()).slice(0, 3);
  return stops.length >= 2 ? stops : null;
}
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) || null : null);

// A card of the showcase with only the fields the site shows.
function cleanCard(c) {
  if (!c || !Number.isInteger(c.id) || typeof c.image !== 'string' || !CARD_IMAGE.test(c.image)) return null;
  return {
    id: c.id,
    name: text(c.name, 80) ?? '?',
    native: text(c.native, 80),
    image: c.image.slice(0, 300),
    favourites: Number(c.favourites) || 0,
    rank: Number(c.rank) || 0,
    rarity: pick(c.rarity, ['C', 'U', 'R', 'E', 'L', 'M']) ?? 'C',
    num: text(c.num, 20),
    series: text(c.series, 120),
    pow: Number(c.pow) || 0,
    aura: Number(c.aura) || 0
  };
}

// Saves the perks of the player whose session is given, after checking they have no subscription; returns { ok }.
async function saveProfile(env, body) {
  const me = await sessionUser(body?.token, body?.device);
  if (!me) return { error: 'session' };
  const pub = await profile(me.id).catch(() => null);
  if (me.membership || tierOf(pub?.badges)) return { error: 'subscriber' };
  const p = body.profile ?? {};
  const links = (Array.isArray(p.links) ? p.links : [])
    .map((l) => ({ kind: pick(l?.kind, LINK_KINDS), handle: text(l?.handle, 40)?.replace(/^@/, '') }))
    .filter((l) => l.kind && l.handle && /^[\w.\-]+$/.test(l.handle))
    .slice(0, LINKS_MAX);
  let best = (Array.isArray(p.best) ? p.best : []).map(cleanCard).filter(Boolean).slice(0, EXTRA_CARDS);
  if (best.length) {
    const owned = await ownedIds(body.token, body.device);
    best = best.filter((c) => owned.has(c.id));
  }
  const rec = {
    nameColor: color(p.nameColor),
    chatColor: color(p.chatColor),
    nameGradient: gradient(p.nameGradient),
    banner: pick(p.banner, BANNERS),
    showcaseBackdrop: pick(p.showcaseBackdrop, THEMES),
    showcaseStyle: pick(p.showcaseStyle, ['aurora']),
    theme: pick(p.theme, THEMES),
    title: text(p.title, TITLE_MAX),
    links,
    best,
    at: Date.now()
  };
  const all = await profiles(env);
  all[me.id] = { ...rec, ext: true };
  await env.KV.put('profiles', JSON.stringify(all));
  return { ok: true, profile: all[me.id] };
}

// Marks the player whose session is given as using the extension (its badge), or unmarks them once subscribed.
async function saveMember(env, body) {
  const me = await sessionUser(body?.token, body?.device);
  if (!me) return { error: 'session' };
  const pub = await profile(me.id).catch(() => null);
  const ext = !(me.membership || tierOf(pub?.badges));
  const all = await profiles(env);
  if (!!all[me.id]?.ext === ext) return { ok: true, ext };
  if (ext) all[me.id] = { ...all[me.id], ext: true, at: Date.now() };
  else if (all[me.id]) all[me.id].ext = false;
  await env.KV.put('profiles', JSON.stringify(all));
  return { ok: true, ext };
}
