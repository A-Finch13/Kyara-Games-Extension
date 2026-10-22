// Shared helpers of the background worker, the popup and the userscript: Kyara API, cached data, settings.

export const ORIGIN = 'https://kyara.games';
export const REPO = 'A-Finch13/Kyara-Games-Extension';

export const RARITIES = ['M', 'L', 'E', 'R', 'U', 'C'];
export const RARITY = {
  C: { label: 'Commune', color: '#B5B1BB' },
  U: { label: 'Peu commune', color: '#3FBF7F' },
  R: { label: 'Rare', color: '#4D9BFF' },
  E: { label: 'Épique', color: '#B072FF' },
  L: { label: 'Légendaire', color: '#F5C518' },
  M: { label: 'Mythique', color: '#FF4D2E' }
};

export const DEFAULT_SETTINGS = {
  hideComplete: true,
  hideSmall: false,
  badgeMissing: true,
  badgeDupes: true,
  theirDupes: true,
  lockLastListed: true,
  cardToWiki: true,
  notifyBoosters: true,
  notifyTrades: true,
  notifyMarket: true,
  notifyWish: true,
  notifyFriends: true,
  notifyOther: true,
  notifyUpdated: true,
  pollMinutes: 0.25
};

const CATALOG_TTL = 24 * 3600e3;
const COLLECTION_TTL = 2 * 60e3;

// Picture of a card.
export const cardImg = (id, size = 'sm') => `${ORIGIN}/cards/${size}/${id}.webp`;
// Lower case without accents, to compare names.
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Settings with their defaults.
export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

// Saves some settings.
export async function setSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

// ---------- moving the settings to another device ----------

// Short code of letters and digits holding what lives only on this device: settings as bits, each series as
// its number in the sorted list of the catalog's series, numbers stored as gaps. About 35 characters for 14 series.
const SYNC_FLAGS = [
  'hideComplete', 'hideSmall', 'badgeMissing', 'badgeDupes', 'theirDupes', 'lockLastListed', 'cardToWiki',
  'notifyBoosters', 'notifyTrades', 'notifyMarket', 'notifyWish', 'notifyFriends', 'notifyOther', 'notifyUpdated'
];
const SYNC_POLL = [0.25, 1, 2, 5, 10];
const SYNC_VERSION = 1;
// Crockford's base 32: no I, L, O or U, so nothing to mix up when typing it on a phone.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Series names of the catalog, sorted.
const seriesList = (catalog) => [...new Set(catalog.map((c) => c.s))].sort();

class Bits {
  constructor(text = '') {
    this.bits = [];
    this.pos = 0;
    for (const ch of text) {
      const v = B32.indexOf(ch);
      for (let i = 4; i >= 0; i--) this.bits.push((v >> i) & 1);
    }
  }
  put(value, width) {
    for (let i = width - 1; i >= 0; i--) this.bits.push(Math.floor(value / 2 ** i) % 2);
  }
  take(width) {
    if (this.pos + width > this.bits.length) throw new ApiError(0, 'bad_code');
    let v = 0;
    for (let i = 0; i < width; i++) v = v * 2 + this.bits[this.pos++];
    return v;
  }
  // A sorted list of numbers as gaps, each gap in Rice coding (k low bits, the rest in unary).
  putList(numbers, width) {
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
    this.put(sorted.length, 8);
    if (!sorted.length) return;
    const gaps = sorted.map((n, i) => n - (i ? sorted[i - 1] + 1 : 0));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const k = Math.min(width, Math.max(0, Math.floor(Math.log2(mean + 1))));
    this.put(k, 4);
    for (const g of gaps) {
      const q = Math.floor(g / 2 ** k);
      for (let i = 0; i < q; i++) this.bits.push(1);
      this.bits.push(0);
      this.put(g % 2 ** k, k);
    }
  }
  takeList() {
    const count = this.take(8);
    if (!count) return [];
    const k = this.take(4);
    const out = [];
    let last = -1;
    for (let i = 0; i < count; i++) {
      let q = 0;
      while (this.take(1)) if (++q > 4096) throw new ApiError(0, 'bad_code');
      last += q * 2 ** k + this.take(k) + 1;
      out.push(last);
    }
    return out;
  }
  // 8 bits that change with any bit before: a code typed wrong or cut short is refused.
  check(upto = this.bits.length) {
    let h = 0x5a;
    for (let i = 0; i < upto; i++) h = (h * 33 + this.bits[i] + 1) % 251;
    return h;
  }
  text() {
    while (this.bits.length % 5) this.bits.push(0);
    let out = '';
    for (let i = 0; i < this.bits.length; i += 5) out += B32[this.bits.slice(i, i + 5).reduce((v, b) => v * 2 + b, 0)];
    return out.match(/.{1,4}/g).join('-');
  }
}

// A few bits of the series list, so that a code made with another version of the catalog is noticed.
const catalogCheck = (list) => list.reduce((h, name) => (h * 31 + name.length + name.charCodeAt(0)) % 256, list.length % 256);

// A code to type or paste on another device (extension or script): settings, favourite series, "Bloquer sauf doublons" albums.
export async function exportCode() {
  const list = seriesList(await loadCatalog());
  const index = new Map(list.map((name, i) => [name, i]));
  const width = Math.max(1, Math.ceil(Math.log2(list.length + 1)));
  const { settings: saved, favSeries = [], smartLock = [], marketFav } = await chrome.storage.local.get(['settings', 'favSeries', 'smartLock', 'marketFav']);
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  const bits = new Bits();
  bits.put(SYNC_VERSION, 4);
  bits.put(catalogCheck(list), 8);
  for (const key of SYNC_FLAGS) bits.put(settings[key] ? 1 : 0, 1);
  bits.put(marketFav ? 1 : 0, 1);
  bits.put(Math.max(0, SYNC_POLL.indexOf(Number(settings.pollMinutes))), 3);
  bits.putList(favSeries.filter((n) => index.has(n)).map((n) => index.get(n)), width);
  bits.putList(smartLock.filter((n) => index.has(n)).map((n) => index.get(n)), width);
  bits.put(bits.check(), 8);
  return bits.text();
}

// Replaces this device's settings and favourites by the ones of the code. Returns what was brought in.
export async function importCode(code) {
  const text = String(code).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!text || [...text].some((ch) => !B32.includes(ch))) throw new ApiError(0, 'bad_code');
  const read = (list) => {
    const bits = new Bits(text);
    if (bits.take(4) !== SYNC_VERSION) throw new ApiError(0, 'bad_code');
    const catalogBits = bits.take(8);
    const flags = Object.fromEntries(SYNC_FLAGS.map((key) => [key, !!bits.take(1)]));
    const marketFav = !!bits.take(1);
    flags.pollMinutes = SYNC_POLL[bits.take(3)] ?? 0.25;
    const names = (numbers) => numbers.map((i) => list[i]).filter(Boolean);
    const fav = bits.takeList();
    const locked = bits.takeList();
    if (bits.take(8) !== bits.check(bits.pos - 8)) throw new ApiError(0, 'bad_code');
    if (catalogBits !== catalogCheck(list)) throw new ApiError(0, 'other_catalog');
    return { flags, marketFav, favSeries: names(fav), smartLock: names(locked) };
  };
  let data;
  try {
    data = read(seriesList(await loadCatalog()));
  } catch (e) {
    if (e?.code !== 'other_catalog') throw e;
    data = read(seriesList(await loadCatalog(true)));
  }
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    settings: { ...settings, ...data.flags },
    favSeries: data.favSeries,
    smartLock: data.smartLock,
    marketFav: data.marketFav
  });
  return { favs: data.favSeries.length, locks: data.smartLock.length };
}

export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// Same request shape as the site itself: Bearer token plus the device id it generated.
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { accept: 'application/json' };
  if (auth) {
    const { auth: a } = await chrome.storage.local.get('auth');
    if (!a?.token) throw new ApiError(401, 'no_token');
    headers.authorization = `Bearer ${a.token}`;
    if (a.device) headers['x-device-id'] = a.device;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${ORIGIN}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && auth) await chrome.storage.local.set({ authValid: false });
    throw new ApiError(res.status, data?.error ?? `http_${res.status}`);
  }
  if (auth) await chrome.storage.local.set({ authValid: true });
  return data;
}

// The public catalog is ~1.7 MB: kept slim and refreshed once a day.
export async function loadCatalog(force = false) {
  const { catalog } = await chrome.storage.local.get('catalog');
  if (!force && catalog?.list?.length && Date.now() - catalog.at < CATALOG_TTL) return catalog.list;
  try {
    const raw = await api('/characters', { auth: false });
    const list = raw.map((c) => ({ id: c.id, n: c.name, s: c.series, r: c.rarity, num: c.num }));
    await chrome.storage.local.set({ catalog: { at: Date.now(), list } });
    return list;
  } catch (e) {
    if (catalog?.list?.length) return catalog.list;
    throw e;
  }
}

// Collection items are stored as [characterId, qty, listable].
export function slimCollection(items) {
  return (Array.isArray(items) ? items : [])
    .filter((x) => x && (x.characterId ?? x.id) != null)
    .map((x) => [x.characterId ?? x.id, x.qty ?? 0, x.listable ?? Math.max(0, (x.qty ?? 0) - 1)]);
}

// The user's collection, cached 2 minutes.
export async function loadCollection(force = false) {
  const { collection } = await chrome.storage.local.get('collection');
  if (!force && collection?.items && Date.now() - collection.at < COLLECTION_TTL) return collection.items;
  try {
    const items = slimCollection(await api('/me/collection?lean=1'));
    await chrome.storage.local.set({ collection: { at: Date.now(), items } });
    return items;
  } catch (e) {
    if (collection?.items) return collection.items;
    throw e;
  }
}

// Collection as a Map id -> { qty, listable }.
export const collectionMap = (items) => new Map(items.map(([id, qty, listable]) => [id, { qty, listable }]));

// Progress of each series.
export function seriesStats(catalog, coll) {
  const by = new Map();
  for (const c of catalog) {
    let s = by.get(c.s);
    if (!s) by.set(c.s, (s = { name: c.s, total: 0, owned: 0, missing: [] }));
    s.total++;
    if ((coll.get(c.id)?.qty ?? 0) > 0) s.owned++;
    else s.missing.push(c);
  }
  return [...by.values()].map((s) => ({ ...s, complete: s.owned >= s.total, pct: s.total ? s.owned / s.total : 0 }));
}

// The user out of a /me or /me/bootstrap answer.
export const unwrapUser = (u) => (u && u.me && typeof u.me === 'object' ? u.me : u);

// What is kept of the user: pseudo, free boosters, chakra.
export function slimMe(u) {
  u = unwrapUser(u);
  if (!u || typeof u !== 'object') return null;
  return {
    id: u.id ?? null,
    pseudo: u.pseudo ?? u.discord?.username ?? null,
    freePacks: u.freePacks ?? 0,
    freePacksMax: u.freePacksMax ?? null,
    nextFreeAt: u.nextFreeAt ?? null,
    bonusPacks: u.bonusPacks ?? 0,
    chakra: u.chakra ?? null,
    at: Date.now()
  };
}

// The list inside an answer, whatever its shape.
export const asList = (x, ...keys) => {
  if (Array.isArray(x)) return x;
  for (const k of keys) if (Array.isArray(x?.[k])) return x[k];
  return [];
};

// ---------- new versions published on GitHub ----------

// True when version a is newer than version b.
export const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

// Stores { version, url, zip, xpi } when the latest GitHub release is newer than this version, else nothing.
export async function checkUpdate() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new ApiError(res.status, `github_${res.status}`);
  const rel = await res.json();
  const version = String(rel.tag_name ?? '').replace(/^v/, '');
  if (version && newer(version, chrome.runtime.getManifest().version)) {
    const asset = (name) => rel.assets?.find((a) => a.name === name)?.browser_download_url ?? null;
    const update = {
      version,
      url: rel.html_url ?? `https://github.com/${REPO}/releases/latest`,
      zip: asset('kyara-games-chromium.zip'),
      xpi: asset('kyara-games-firefox.xpi')
    };
    await chrome.storage.local.set({ update });
    return update;
  }
  await chrome.storage.local.remove('update');
  return null;
}
