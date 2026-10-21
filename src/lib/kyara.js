// Shared helpers for the background worker and the popup: Kyara API access, cached data and collection maths.

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
  badgeMissing: true,
  badgeDupes: true,
  theirDupes: true,
  notifyBoosters: true,
  notifyTrades: true,
  notifyMarket: true,
  notifyWish: true,
  notifyFriends: true,
  notifyOther: true,
  pollMinutes: 1
};

const CATALOG_TTL = 24 * 3600e3;
const COLLECTION_TTL = 2 * 60e3;

export const cardImg = (id, size = 'sm') => `${ORIGIN}/cards/${size}/${id}.webp`;
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function setSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
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

export const collectionMap = (items) => new Map(items.map(([id, qty, listable]) => [id, { qty, listable }]));

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

export const unwrapUser = (u) => (u && u.me && typeof u.me === 'object' ? u.me : u);

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

export const asList = (x, ...keys) => {
  if (Array.isArray(x)) return x;
  for (const k of keys) if (Array.isArray(x?.[k])) return x[k];
  return [];
};

// ---------- new versions published on GitHub ----------

const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

// Stores { version, url } when the latest GitHub release is newer than the installed extension, else nothing.
export async function checkUpdate() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new ApiError(res.status, `github_${res.status}`);
  const rel = await res.json();
  const version = String(rel.tag_name ?? '').replace(/^v/, '');
  if (version && newer(version, chrome.runtime.getManifest().version)) {
    const update = { version, url: rel.html_url ?? `https://github.com/${REPO}/releases/latest` };
    await chrome.storage.local.set({ update });
    return update;
  }
  await chrome.storage.local.remove('update');
  return null;
}
