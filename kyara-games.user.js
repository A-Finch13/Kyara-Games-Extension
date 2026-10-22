// ==UserScript==
// @name         Kyara Games
// @namespace    https://github.com/A-Finch13/Kyara-Games-Extension
// @version      1.6.3
// @description  Compagnon non officiel pour kyara.games : cartes manquantes en gris avec ordre d'achat, albums complets masqués, doublons pendant les échanges, booster le plus rentable, classement entre amis.
// @author       A-Finch13
// @license      MIT
// @match        https://kyara.games/*
// @icon         https://raw.githubusercontent.com/A-Finch13/Kyara-Games-Extension/main/icons/icon128.png
// @homepageURL  https://github.com/A-Finch13/Kyara-Games-Extension
// @supportURL   https://github.com/A-Finch13/Kyara-Games-Extension/issues
// @updateURL    https://github.com/A-Finch13/Kyara-Games-Extension/releases/latest/download/kyara-games.user.js
// @downloadURL  https://github.com/A-Finch13/Kyara-Games-Extension/releases/latest/download/kyara-games.user.js
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// ==/UserScript==

/*
 * Kyara Games — version script
 *
 * Ce script ajoute à kyara.games les mêmes fonctions que l'extension Kyara Games :
 *  - Collection : cartes manquantes en gris avec leur prix et un bouton « Ordre d'achat », puces « Possédées »
 *    et « Manquantes », séries complètes et petites séries masquées, « Bloquer sauf doublons », fiche en un clic ;
 *  - Échanges : badges ×N (doublon) et « Unique » (dernier exemplaire), filtre « Ses doublons »,
 *    série et prix des cartes à la confirmation ;
 *  - Boosters rentables (menu Plus), filtre « Amis » du classement, séries complètes condensées dans Missions ;
 *  - Réglages : menu Plus → 設 Kyara Games (ou le menu sur téléphone).
 *
 * Il ne communique qu'avec https://kyara.games : ta session reste dans ton navigateur et n'est envoyée nulle part ailleurs.
 * Pas de notifications : un script ne tourne que quand une page kyara.games est ouverte.
 * Si l'extension Kyara Games est aussi installée, le script se met en retrait.
 *
 * Fichier généré par build.py à partir du code de l'extension (https://github.com/A-Finch13/Kyara-Games-Extension) : ne pas le modifier à la main.
 *
 * Parties du script, dans l'ordre :
 *  1. shim.js    — remplace les fonctions propres aux extensions (stockage, messages) ;
 *  2. kyara.js   — accès à l'API de kyara.games, catalogue des cartes et collection ;
 *  3. bridge.js  — fait dans la page le travail du service de fond de l'extension ;
 *  4. inject.js  — lit les réponses que le site reçoit déjà (collection, échanges), sans jamais les modifier ;
 *  5. content.js — tout ce qui s'affiche sur le site ;
 *  6. panel.js   — panneau de réglages dans le menu du site.
 */
(() => {
'use strict';
if (window.__kyaraGamesUserscript) return;
window.__kyaraGamesUserscript = true;
const KYX_VERSION = '1.6.3';

// ---------- 1. src/userscript/shim.js : stockage et messages, à la place des fonctions d'extension ----------
// Userscript version: the few extension APIs the page code uses, rebuilt on top of the page itself.
// Storage lives in the site's localStorage under "kyx:" (kept in memory when it is full);
// messages to the background worker are answered by handle() in bridge.js, in the same page.
const KYX_OWNER = 'userscript';

const chrome = (() => {
  const PREFIX = 'kyx:';
  const memory = new Map();
  const listeners = [];

  const read = (key) => {
    if (memory.has(key)) return memory.get(key);
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw != null) {
        const value = JSON.parse(raw);
        memory.set(key, value);
        return value;
      }
    } catch {}
    return undefined;
  };
  const write = (key, value) => {
    memory.set(key, value);
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {} // full: the value stays for this page
  };
  const drop = (key) => {
    memory.delete(key);
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
  };
  const emit = (changes) => {
    if (!Object.keys(changes).length) return;
    setTimeout(() => listeners.forEach((fn) => {
      try {
        fn(changes, 'local');
      } catch {}
    }));
  };
  const names = (keys) => (typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {}));

  // Another tab of the site changed a value.
  window.addEventListener('storage', (e) => {
    if (!e.key?.startsWith(PREFIX)) return;
    const key = e.key.slice(PREFIX.length);
    memory.delete(key);
    let newValue;
    try {
      newValue = e.newValue == null ? undefined : JSON.parse(e.newValue);
    } catch {}
    emit({ [key]: { newValue } });
  });

  return {
    runtime: {
      id: KYX_OWNER,
      getManifest: () => ({ version: KYX_VERSION }),
      sendMessage: (msg) => handle(msg).catch((e) => ({ error: e?.code ?? String(e) }))
    },
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const key of names(keys)) {
            const value = read(key);
            if (value !== undefined) out[key] = value;
            else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[key] = keys[key];
          }
          return out;
        },
        async set(items) {
          const changes = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: read(key), newValue: value };
            write(key, value);
          }
          emit(changes);
        },
        async remove(keys) {
          const changes = {};
          for (const key of names(keys)) {
            changes[key] = { oldValue: read(key), newValue: undefined };
            drop(key);
          }
          emit(changes);
        }
      },
      onChanged: { addListener: (fn) => listeners.push(fn) }
    }
  };
})();

// ---------- 2. src/lib/kyara.js : API de kyara.games, catalogue et collection ----------
// Shared helpers for the background worker and the popup: Kyara API access, cached data and collection maths.

const ORIGIN = 'https://kyara.games';
const REPO = 'A-Finch13/Kyara-Games-Extension';

const RARITIES = ['M', 'L', 'E', 'R', 'U', 'C'];
const RARITY = {
  C: { label: 'Commune', color: '#B5B1BB' },
  U: { label: 'Peu commune', color: '#3FBF7F' },
  R: { label: 'Rare', color: '#4D9BFF' },
  E: { label: 'Épique', color: '#B072FF' },
  L: { label: 'Légendaire', color: '#F5C518' },
  M: { label: 'Mythique', color: '#FF4D2E' }
};

const DEFAULT_SETTINGS = {
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
  pollMinutes: 1
};

const CATALOG_TTL = 24 * 3600e3;
const COLLECTION_TTL = 2 * 60e3;

const cardImg = (id, size = 'sm') => `${ORIGIN}/cards/${size}/${id}.webp`;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function setSettings(patch) {
  const settings = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// Same request shape as the site itself: Bearer token plus the device id it generated.
async function api(path, { method = 'GET', body, auth = true } = {}) {
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
async function loadCatalog(force = false) {
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
function slimCollection(items) {
  return (Array.isArray(items) ? items : [])
    .filter((x) => x && (x.characterId ?? x.id) != null)
    .map((x) => [x.characterId ?? x.id, x.qty ?? 0, x.listable ?? Math.max(0, (x.qty ?? 0) - 1)]);
}

async function loadCollection(force = false) {
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

const collectionMap = (items) => new Map(items.map(([id, qty, listable]) => [id, { qty, listable }]));

function seriesStats(catalog, coll) {
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

const unwrapUser = (u) => (u && u.me && typeof u.me === 'object' ? u.me : u);

function slimMe(u) {
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

const asList = (x, ...keys) => {
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

// Stores { version, url, zip, xpi } when the latest GitHub release is newer than the installed extension, else nothing.
async function checkUpdate() {
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

// ---------- 3. src/userscript/bridge.js : le travail du service de fond, dans la page ----------
// Userscript version: what the extension's background worker answers to the page code, done in the page.
// No notifications here: a userscript only runs while a kyara.games page is open.
let refreshTimer = 0;

// The page code hands the session over a moment after it starts: until then, read it from the site directly.
async function ensureAuth() {
  if ((await chrome.storage.local.get('auth')).auth?.token) return;
  try {
    const token = localStorage.getItem('kyara_token');
    if (token) await chrome.storage.local.set({ auth: { token, device: localStorage.getItem('kyara_device'), at: Date.now() } });
  } catch {}
}

async function handle(msg) {
  if (msg?.type !== 'auth') await ensureAuth();
  switch (msg?.type) {
    case 'auth': {
      const { auth } = await chrome.storage.local.get('auth');
      if (auth?.token === msg.token && auth?.device === msg.device) return { ok: true };
      await chrome.storage.local.set({ auth: { token: msg.token, device: msg.device, at: Date.now() }, authValid: true });
      if (auth?.token && auth.token !== msg.token) await chrome.storage.local.remove(['collection', 'me']);
      loadCollection(true).catch(() => {});
      return { ok: true };
    }
    case 'collection':
      await chrome.storage.local.set({ collection: { at: Date.now(), items: slimCollection(msg.items) } });
      return { ok: true };
    case 'collection-stale':
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => loadCollection(true).catch(() => {}), 2500);
      return { ok: true };
    case 'me': {
      const me = slimMe(msg.user);
      if (me) await chrome.storage.local.set({ me });
      return { ok: true };
    }
    case 'partner': {
      const { partner } = await chrome.storage.local.get('partner');
      const base = partner?.id === msg.partner.id ? partner : { id: msg.partner.id };
      const next = { ...base, ...msg.partner, at: Date.now() };
      await chrome.storage.local.set({ partner: next });
      return next;
    }
    case 'prices':
      // The site's fair price of each card, as shown in its trade composer: { [id]: chakra }.
      return (await api(`/fair-play/prices?ids=${msg.ids.slice(0, 200).join(',')}`)) ?? {};
    case 'ensure-data':
    case 'refresh':
      await Promise.allSettled([loadCatalog(), loadCollection(msg.type === 'refresh')]);
      return { ok: true };
    default:
      return { error: 'unknown_message' };
  }
}

// ---------- 4. src/content/inject.js : lit les réponses que le site reçoit déjà ----------
// Runs in the page itself: forwards the Kyara API answers the extension cares about to content.js.
// Nothing is sent anywhere else and no request is changed.
(() => {
  if (window.__kyaraGamesHook) return;
  window.__kyaraGamesHook = true;

  const READ = [
    /^\/me$/,
    /^\/me\/bootstrap$/,
    /^\/me\/collection$/,
    /^\/me\/friends\/[^/]+\/collection$/,
    /^\/trades\/available\/[^/]+$/,
    /^\/trades\/owned\/[^/]+$/,
    /^\/users\/[^/]+$/
  ];
  // Writes after which the collection is no longer what the extension has cached.
  const WRITE = /^\/(packs\/[^/]+\/open(-many)?|trades(\/.*)?|market\/.*|me\/collection\/.*|me\/progress\/claim|me\/alt\/settle)$/;

  const original = window.fetch;
  window.fetch = async function (input, init) {
    const res = await original.apply(this, arguments);
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || !res.ok) return res;
      const path = url.pathname.slice(4);
      const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method === 'GET' && READ.some((r) => r.test(path))) {
        res.clone().json().then(
          (body) => window.postMessage({ __kyaraGames: 1, kind: 'read', path, body }, location.origin),
          () => {}
        );
      } else if (method !== 'GET' && WRITE.test(path)) {
        window.postMessage({ __kyaraGames: 1, kind: 'write', path }, location.origin);
      }
    } catch {}
    return res;
  };
})();

const start = () => {
  const style = document.createElement('style');
  style.id = 'kyx-style';
  style.textContent = `/* Injected into kyara.games pages. */

/* Trade helper panel of older versions: a copy of the old script left running in an open tab must not show it. */
#kyx-root {
  display: none !important;
}
[data-kyx-pos="1"] {
  position: relative;
}

[data-kyx-hidden="1"] {
  display: none !important;
}

.kyx-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 4;
  padding: 2px 6px;
  border-radius: 6px;
  font: 700 10px/1.3 system-ui, sans-serif;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  pointer-events: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
}

.kyx-badge[data-kind="missing"] {
  background: #3fbf7f;
  color: #08130d;
}

.kyx-badge[data-kind="dupe"] {
  background: #ff4d2e;
  color: #fff;
}

.kyx-badge[data-kind="single"] {
  background: #f5c518;
  color: #1a1400;
}

/* Trade confirmation: the card block starts with its "Tu donnes" / "Tu reçois" label, keep the badge on the picture */
.cf-s > .kyx-badge {
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
}

/* Fair price of each card and gap between both sides, in the trade confirmation */
.kyx-price {
  font-weight: 700;
}

.kyx-balance {
  margin: 10px 0 0;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
}

.kyx-balance[data-kind="fair"] {
  color: #3fbf7f;
}

.kyx-balance[data-kind="win"] {
  color: #4d9bff;
}

.kyx-balance[data-kind="loss"] {
  color: #ff4d2e;
}

/* Series under the rarity in the trade confirmation */
.kyx-series {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* "Masquer les complets" toggle, inside the site's album toolbar */
.kyx-toggle {
  margin-left: auto;
  margin-right: 10px;
  padding: 7px 14px;
  border: 1px solid #2c2934;
  border-radius: 999px;
  background: transparent;
  color: #c9c4d0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.kyx-toggle:hover {
  border-color: #ff4d2e;
  color: #fff;
}

.kyx-toggle[aria-pressed="true"] {
  background: #3fbf7f;
  border-color: #3fbf7f;
  color: #08130d;
}

/* Two toggles side by side: only the first one pushes the group to the right */
.kyx-toggle + .kyx-toggle {
  margin-left: 0;
}

/* Missing cards on Collection: the card itself, greyed out, instead of the site's "?" box; name, number and rarity below */
.miss[data-kyx-ghost] {
  aspect-ratio: auto;
  justify-content: flex-start;
  gap: 2px;
  padding: 0;
  border: 0;
  background: none;
}

.miss[data-kyx-ghost] > .q {
  display: none;
}

.kyx-ghost {
  display: block;
  width: 100%;
  aspect-ratio: 5 / 7;
  margin-bottom: 4px;
  border-radius: 14px;
  object-fit: cover;
  background: #111015;
  filter: grayscale(1) brightness(0.55);
  opacity: 0.8;
  transition: filter 0.18s, opacity 0.18s;
}

a.slot:hover .kyx-ghost {
  filter: grayscale(1) brightness(0.8);
  opacity: 1;
}

.kyx-ghost-name {
  max-width: 100%;
  overflow: hidden;
  color: #c9c4d0;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Buy order row under each missing card, like the site's "≈ price · Vendre" row of owned cards */
.kyx-order {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  min-height: 28px;
}

.kyx-order-med {
  overflow: hidden;
  color: var(--fg2, #a9a4b0);
  font-family: var(--mono, monospace);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kyx-order button,
.kyx-modal button {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--line3, #3a3642);
  border-radius: 999px;
  background: transparent;
  color: var(--fg, #fff);
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.kyx-order .kyx-order-open {
  margin-left: auto;
}

.kyx-order button:hover:not(:disabled),
.kyx-modal button:hover:not(:disabled) {
  border-color: var(--acc, #f5c518);
  color: var(--acc2, #ffd84a);
}

.kyx-order button:disabled,
.kyx-modal button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Buy order pop-up */
.kyx-modal-back {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(5, 4, 8, 0.72);
  backdrop-filter: blur(3px);
}

.kyx-order-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(520px, 100%);
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 26px;
  border: 1px solid var(--line3, #3a3642);
  border-radius: 18px;
  background: var(--panel, #16141b);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  color: var(--fg, #fff);
}

.kyx-modal-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.kyx-modal-head {
  gap: 16px;
}

.kyx-modal-head img {
  width: 110px;
  aspect-ratio: 5 / 7;
  border-radius: 8px;
  object-fit: cover;
  flex: none;
}

.kyx-modal-head div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.kyx-modal-head small {
  color: var(--fg2, #a9a4b0);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.kyx-modal-name {
  font-size: 22px;
}

.kyx-modal-sub {
  color: var(--fg2, #a9a4b0);
  font-size: 14px;
}

.kyx-modal .kyx-order-facts,
.kyx-modal .kyx-order-msg {
  font-size: 14px;
}

.kyx-modal .kyx-order-fields label {
  gap: 4px;
  font-size: 13px;
}

.kyx-modal .kyx-order-fields label:last-child {
  width: 96px;
}

.kyx-modal .kyx-order-fields input {
  height: 46px;
  font-size: 16px;
}

.kyx-modal button {
  height: 40px;
  padding: 0 18px;
  font-size: 14px;
}

/* "Bloquer sauf doublons" in the album bar */
.kyx-smart[aria-pressed="true"] {
  border-color: #3fbf7f;
  color: #3fbf7f;
}

.kyx-smart-msg {
  flex-basis: 100%;
  font-size: 13px;
  color: #3fbf7f;
}

.kyx-smart-msg[data-kind="err"] {
  color: #ff4d2e;
}

.kyx-order-facts,
.kyx-order-msg {
  margin: 0;
  color: var(--fg2, #a9a4b0);
  font-size: 12px;
  line-height: 1.35;
}

.kyx-order-msg:empty {
  display: none;
}

.kyx-order-msg[data-kind="ok"] {
  color: #3fbf7f;
}

.kyx-order-msg[data-kind="err"] {
  color: #ff4d2e;
}

.kyx-order-msg a {
  color: inherit;
  text-decoration: underline;
}

.kyx-order-fields {
  display: flex;
  gap: 6px;
}

.kyx-order-fields label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  color: var(--fg2, #a9a4b0);
  font-size: 11px;
}

.kyx-order-fields label:first-child {
  flex: 1;
}

.kyx-order-fields label:last-child {
  width: 70px;
}

.kyx-order-fields input {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--line3, #3a3642);
  border-radius: 8px;
  background: #0b0a0e;
  color: var(--fg, #fff);
  font: 600 13px var(--mono, monospace);
}

.kyx-order-btns {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.kyx-modal .kyx-order-go:not(:disabled) {
  border-color: var(--acc, #f5c518);
  background: var(--acc, #f5c518);
  color: var(--bg, #0b0a0e);
}

.kyx-modal .kyx-order-go:hover:not(:disabled) {
  color: var(--bg, #0b0a0e);
  background: var(--acc2, #ffd84a);
}

/* Missions: completed series kept to the height of the referral card */
.kyx-albums {
  overflow: hidden;
}

.kyx-albums ul.quests {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.kyx-albums ul.quests > li:not(.claimed) {
  order: -1;
}

.kyx-count {
  margin-left: 8px;
  color: var(--mut, #8a8592);
  font-family: var(--mono, monospace);
  font-size: 0.6em;
  font-weight: 600;
  vertical-align: middle;
}

/* "Boosters rentables" page, in place of the site's content */
.kyx-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 70vh;
  padding-top: 36px;
  padding-bottom: 60px;
  color: var(--fg, #fff);
}

.kyx-page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.kyx-page-head small {
  color: var(--fg2, #a9a4b0);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.kyx-page-head h1 {
  margin: 6px 0 0;
  font-family: var(--disp, inherit);
  font-size: clamp(28px, 5vw, 44px);
  line-height: 1.1;
}

.kyx-page-head p {
  margin: 8px 0 0;
  color: var(--fg2, #a9a4b0);
  font-size: 15px;
}

.kyx-page button {
  border: 1px solid var(--line3, #3a3642);
  border-radius: 999px;
  background: transparent;
  color: var(--fg, #fff);
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.kyx-page button:hover {
  border-color: var(--acc, #ff4d2e);
}

.kyx-page button[aria-pressed="true"] {
  border-color: var(--acc, #ff4d2e);
  background: var(--acc, #ff4d2e);
  color: var(--bg, #0b0a0e);
}

.kyx-page-close {
  height: 38px;
  padding: 0 16px;
  flex: none;
}

.kyx-seg,
.kyx-b-rar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.kyx-seg button,
.kyx-b-rar button {
  height: 34px;
  padding: 0 14px;
}

/* Search field of the Collection page; suggestions below it, as wide as the field */
.kyx-search-wrap {
  position: relative;
  max-width: 640px;
}

.kyx-search {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 14px;
  border: 1px solid var(--line2, #2a2731);
  border-radius: 10px;
  background: var(--panel2, #121117);
  color: var(--mut, #8a8592);
  cursor: text;
}

.kyx-search:focus-within {
  border-color: var(--cyan, #4dd8e6);
}

.kyx-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--fg, #fff);
  font: inherit;
  font-size: 14px;
}

.kyx-page .kyx-b-suggest {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 5;
  max-height: 420px;
  overflow-y: auto;
  margin: 0;
  padding: 6px;
  border: 1px solid var(--line2, #2a2731);
  border-radius: 12px;
  background: var(--panel2, #121117);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
}

.kyx-page .kyx-b-suggest[hidden] {
  display: none;
}

.kyx-b-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  color: var(--fg2, #a9a4b0);
  font-size: 13px;
}

.kyx-b-suggest {
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
}

.kyx-page .kyx-b-suggest button {
  display: flex;
  height: auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  text-align: left;
  font-weight: 600;
}

.kyx-page .kyx-b-suggest button:hover,
.kyx-page .kyx-b-suggest button:focus-visible {
  background: var(--raise, #1f1d25);
}

.kyx-b-suggest img {
  width: 30px;
  aspect-ratio: 5 / 7;
  border-radius: 4px;
  object-fit: cover;
}

.kyx-b-suggest span,
.kyx-b-main,
.kyx-b-num {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.kyx-b-suggest small,
.kyx-b-main small,
.kyx-b-num small {
  overflow: hidden;
  color: var(--fg2, #a9a4b0);
  font-size: 12px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kyx-page-note,
.kyx-page-foot {
  margin: 0;
  color: var(--fg2, #a9a4b0);
  font-size: 13px;
}

.kyx-page-note:empty {
  display: none;
}

.kyx-page-foot {
  font-size: 11px;
}

.kyx-b-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.kyx-b-list a {
  display: grid;
  grid-template-columns: 26px 40px 1fr auto;
  align-items: center;
  gap: 6px 12px;
  padding: 14px 16px;
  border: 1px solid var(--line, #26232d);
  border-radius: 14px;
  background: var(--panel, #16141b);
  color: inherit;
  text-decoration: none;
}

.kyx-b-bar {
  grid-column: 3 / -1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.kyx-b-bar > span {
  flex: 1;
  height: 6px;
  overflow: hidden;
  border-radius: 6px;
  background: var(--line2, #2a2731);
}

.kyx-b-bar small {
  flex: none;
  color: var(--fg2, #a9a4b0);
  font-size: 12px;
}

.kyx-b-bar i {
  display: block;
  height: 100%;
  border-radius: 6px;
  background: linear-gradient(90deg, #3fbf7f, #f5c518);
}

.kyx-b-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.kyx-b-title b {
  font-size: 16px;
}

.kyx-b-price {
  color: var(--fg2, #a9a4b0);
  font-size: 12px;
}

.kyx-b-line {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 600;
}

.kyx-b-main small {
  white-space: normal;
}

.kyx-b-free {
  color: #3fbf7f;
}

.kyx-b-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid #3fbf7f;
  border-radius: 14px;
  background: rgba(63, 191, 127, 0.08);
  font-size: 14px;
}

.kyx-b-summary:empty {
  display: none;
}

.kyx-b-summary p {
  margin: 0;
}

.kyx-b-label {
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(63, 191, 127, 0.15);
  color: #3fbf7f;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.kyx-b-list li:last-child .kyx-b-label {
  background: rgba(255, 77, 46, 0.15);
  color: #ff4d2e;
}

.kyx-b-list a:hover {
  border-color: var(--acc, #ff4d2e);
}

.kyx-b-list li:first-child a {
  border-color: #3fbf7f;
}

.kyx-b-rank {
  color: var(--fg2, #a9a4b0);
  font-family: var(--mono, monospace);
  font-size: 12px;
}

.kyx-b-kanji {
  font-size: 28px;
  font-weight: 900;
  text-align: center;
}

.kyx-b-num {
  align-items: flex-end;
  text-align: right;
}

.kyx-b-tag {
  align-self: flex-start;
  margin-top: 3px;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(63, 191, 127, 0.15);
  color: #3fbf7f;
  font-size: 10px;
  font-weight: 700;
}

.kyx-b-empty {
  color: var(--fg2, #a9a4b0);
  font-size: 13px;
}

/* "Plus" underlined in the site's header while the "Boosters rentables" page is open */
html[data-kyx-view] .hdr .navlink.on:not([aria-controls="nav-more"])::after {
  transform: scaleX(0) !important;
}

html[data-kyx-view] .hdr .navlink.on:not([aria-controls="nav-more"]) {
  color: var(--fg2) !important;
}

html[data-kyx-view] .hdr .navlink[aria-controls="nav-more"] {
  color: var(--fg) !important;
}

html[data-kyx-view] .hdr .navlink[aria-controls="nav-more"]::after {
  transform: scaleX(1) !important;
}

/* "Amis" filter of the Classement page */
.kyx-friends-tab {
  margin-left: 10px;
}

.kyx-friends-note {
  margin: 24px 0 60px;
  color: var(--fg2, #a9a4b0);
  font-size: 14px;
}

.kyx-friends-note a {
  color: var(--fg, #fff);
}

/* "Classer par : Prix | Taux de drop" */
.kyx-b-sort {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.kyx-b-sort > span {
  margin-right: 4px;
  color: var(--fg2, #a9a4b0);
  font-size: 13px;
  font-weight: 700;
}

.kyx-page .kyx-b-sort button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 7px 16px;
  border-radius: 12px;
  text-align: left;
}

.kyx-page .kyx-b-sort button small {
  font-size: 11px;
  font-weight: 500;
  opacity: 0.8;
}

/* ---------- phones (Firefox for Android) and narrow windows ---------- */
@media (max-width: 640px) {
  .kyx-toggle {
    margin: 0 6px 6px 0;
    padding: 6px 11px;
    font-size: 12px;
    white-space: normal;
    text-align: left;
  }

  .kyx-order button {
    padding: 0 8px;
    font-size: 11px;
  }

  .kyx-order-form {
    padding: 18px;
  }

  .kyx-modal-head img {
    width: 76px;
  }

  .kyx-modal-name {
    font-size: 18px;
  }

  .kyx-page {
    padding-top: 20px;
  }

  .kyx-page-head {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .kyx-page-close {
    align-self: flex-start;
  }

  .kyx-seg button,
  .kyx-b-rar button {
    flex: 1 1 auto;
  }

  .kyx-page .kyx-b-sort button {
    flex: 1 1 0;
    min-width: 0;
  }

  .kyx-b-sort > span {
    flex-basis: 100%;
  }

  .kyx-b-list a {
    grid-template-columns: 20px 30px 1fr;
    gap: 6px 10px;
    padding: 12px;
  }

  .kyx-b-kanji {
    font-size: 22px;
  }

  .kyx-b-num {
    grid-column: 3;
    align-items: flex-start;
    text-align: left;
  }

  .kyx-b-bar {
    grid-column: 1 / -1;
    flex-wrap: wrap;
    gap: 4px;
  }

  .kyx-b-bar > span {
    flex-basis: 100%;
  }

  .kyx-b-summary {
    padding: 12px;
    font-size: 13px;
  }

  .kyx-friends-tab {
    margin-left: 0;
  }

  .kyx-count {
    display: block;
    margin: 4px 0 0;
    font-size: 0.55em;
  }
}

/* Userscript version: settings panel opened from the site's menu */
.kyx-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(520px, 100%);
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--line3, #3a3642);
  border-radius: 18px;
  background: var(--panel, #16141b);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  color: var(--fg, #fff);
}

.kyx-settings-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kyx-settings-list label {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 14px;
  line-height: 1.35;
  cursor: pointer;
}

.kyx-settings-list input {
  width: 18px;
  height: 18px;
  margin: 1px 0 0;
  flex: none;
  accent-color: var(--acc, #ff4d2e);
}

.kyx-settings-note {
  margin: 0;
  color: var(--fg2, #a9a4b0);
  font-size: 12px;
}

/* Favourite series: star on the album tiles and in the album bar of Collection */
.kyx-fav {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(14, 13, 18, 0.7);
  color: var(--fg2, #a9a4b0);
  font-size: 18px;
  line-height: 30px;
  cursor: pointer;
}

.kyx-fav:hover,
.kyx-fav[aria-pressed="true"] {
  color: #f5c518;
}

.kyx-fav.inline {
  position: static;
  width: auto;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--line3, #3a3642);
  border-radius: 999px;
  background: transparent;
  font-size: 13px;
  font-weight: 700;
  line-height: 30px;
}

.kyx-fav.inline[aria-pressed="true"] {
  border-color: #f5c518;
}

/* Market: offers of the favourite series */
.kyx-favmarket {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
}

.kyx-fm-favs,
.kyx-fm-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.kyx-fm-fav {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px 2px 2px;
  border: 1px solid var(--line3, #3a3642);
  border-radius: 999px;
  color: var(--fg, #fff);
  font-size: 13px;
  font-weight: 700;
}

.kyx-fm-fav.all {
  padding-right: 2px;
}

.kyx-fm-fav[aria-pressed="true"] {
  border-color: #f5c518;
  background: rgba(245, 197, 24, 0.14);
}

.kyx-fm-fav .kyx-fm-pick {
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.kyx-fm-fav .kyx-fm-pick:hover {
  color: #f5c518;
}

.kyx-fm-fav .kyx-fm-del {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--fg2, #a9a4b0);
  font-size: 15px;
  cursor: pointer;
}

.kyx-fm-fav .kyx-fm-del:hover {
  color: var(--fg, #fff);
  background: var(--raise, #1f1d25);
}

.kyx-fm-tools select {
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--line2, #2a2731);
  border-radius: 10px;
  background: var(--panel2, #121117);
  color: var(--fg, #fff);
  font: inherit;
  font-size: 14px;
}

.kyx-fm-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--fg2, #a9a4b0);
  font-size: 14px;
}

.kyx-fm-note {
  margin: 0;
  color: var(--fg2, #a9a4b0);
  font-size: 14px;
}

.kyx-fm-note a {
  color: var(--fg, #fff);
}

.kyx-fm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.kyx-fm-tile {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--line, #26232d);
  border-radius: 14px;
  background: var(--panel, #16141b);
  color: inherit;
  text-decoration: none;
}

.kyx-fm-tile:hover {
  border-color: var(--acc, #ff4d2e);
}

.kyx-fm-tile img {
  width: 64px;
  aspect-ratio: 5 / 7;
  flex: none;
  border-radius: 8px;
  object-fit: cover;
}

.kyx-fm-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.kyx-fm-info b,
.kyx-fm-info small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kyx-fm-sub {
  color: var(--r, var(--fg2, #a9a4b0));
  font-size: 12px;
  font-weight: 600;
}

.kyx-fm-price {
  font-size: 16px;
  font-weight: 800;
}

.kyx-fm-meta {
  color: var(--fg2, #a9a4b0);
  font-size: 12px;
}

.kyx-fm-more {
  align-self: center;
  height: 40px;
  padding: 0 18px;
  border: 1px solid var(--line3, #3a3642);
  border-radius: 999px;
  background: transparent;
  color: var(--fg, #fff);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.kyx-fm-more:hover {
  border-color: var(--acc, #ff4d2e);
}

.kyx-fm-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.kyx-fm-refresh {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--line3, #3a3642);
  border-radius: 999px;
  background: transparent;
  color: var(--fg, #fff);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.kyx-fm-refresh:hover {
  border-color: var(--acc, #ff4d2e);
}

/* Userscript version: "new version installed" banner, at the first visit after an update */
.kyx-update-toast {
  position: fixed;
  left: 50%;
  bottom: 18px;
  z-index: 2147483000;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  max-width: calc(100% - 24px);
  padding: 12px 14px 12px 18px;
  border: 1px solid #3fbf7f;
  border-radius: 14px;
  background: var(--panel, #16141b);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
  color: var(--fg, #fff);
  font-size: 14px;
  transform: translateX(-50%);
}

.kyx-update-toast a {
  color: #3fbf7f;
  font-weight: 700;
}

.kyx-update-toast button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--fg2, #a9a4b0);
  font-size: 14px;
  cursor: pointer;
}

.kyx-update-toast button:hover {
  background: var(--raise, #1f1d25);
  color: var(--fg, #fff);
}
`;
  document.head.appendChild(style);
  // ---------- 5. src/content/content.js : tout ce qui s'affiche sur le site ----------
// Kyara Games on kyara.games: card badges, completed and small albums hidden, missing cards greyed out with a buy order,
// "Bloquer sauf doublons", last copy of a card on sale locked, compact completed series on Missions, "Boosters rentables" page,
// "Amis" filter on the Classement page, "Possédées" and "Manquantes" chips on Collection and the "Ses doublons" filter in the trade composer.
// Also built into the userscript version (build.py), where KYX_OWNER and a stand-in for the extension APIs are defined.
(() => {
  // A single copy per tab when both the extension and the userscript are installed: the first one to start.
  const owner = typeof KYX_OWNER === 'string' ? KYX_OWNER : 'extension';
  if (document.documentElement.dataset.kyxOwner && document.documentElement.dataset.kyxOwner !== owner) return;
  document.documentElement.dataset.kyxOwner = owner;

  const DEFAULTS = {
    hideComplete: true,
    hideSmall: false,
    badgeMissing: true,
    badgeDupes: true,
    theirDupes: true,
    lockLastListed: true,
    cardToWiki: true
  };
  const CARD_SRC = /\/cards\/[a-z0-9]+\/(\d+)\.webp/i;

  let settings = { ...DEFAULTS };
  let coll = null; // Map id -> { qty, listable }
  let catalog = null; // Map id -> { id, n, s, r, num }
  let series = null; // Map normalized series name -> { total, owned }
  let partner = null;

  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  // After the extension is reloaded or updated, this copy keeps running in already open tabs
  // but can no longer reach the extension: it then cleans up and stops.
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  const send = (msg) => {
    if (!alive()) return shutdown(), Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };
  const qty = (id) => coll?.get(id)?.qty ?? 0;

  // ---------- data ----------

  function applyStorage({ settings: s, collection, catalog: cat, partner: p }) {
    if (s !== undefined) settings = { ...DEFAULTS, ...s };
    if (collection !== undefined) coll = collection?.items ? new Map(collection.items.map(([id, q, l]) => [id, { qty: q, listable: l }])) : null;
    if (cat !== undefined) catalog = cat?.list ? new Map(cat.list.map((c) => [c.id, c])) : null;
    if (p !== undefined) partner = p;
    series = null;
  }

  function seriesIndex() {
    if (series || !catalog || !coll) return series;
    series = new Map();
    for (const c of catalog.values()) {
      const k = norm(c.s);
      const s = series.get(k) ?? { total: 0, owned: 0 };
      s.total++;
      if (qty(c.id) > 0) s.owned++;
      series.set(k, s);
    }
    return series;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const picked = {};
    if ('smartLock' in changes) smartLock = new Set(changes.smartLock.newValue ?? []);
    if ('favSeries' in changes) {
      favSeries = new Set(changes.favSeries.newValue ?? []);
      marketShown = '';
      scanFavStars();
      scanMarket();
    }
    for (const k of ['settings', 'collection', 'catalog', 'partner']) if (k in changes) picked[k] = changes[k].newValue;
    if (!Object.keys(picked).length) return;
    applyStorage(picked);
    refreshAll();
  });

  // The site keeps its session in localStorage: hand it to the extension so it can poll for notifications.
  let lastAuth = '';
  function syncAuth() {
    let token = null;
    let device = null;
    try {
      token = localStorage.getItem('kyara_token');
      device = localStorage.getItem('kyara_device');
    } catch {}
    const key = `${token}|${device}`;
    if (!token || key === lastAuth) return;
    lastAuth = key;
    send({ type: 'auth', token, device });
  }

  // ---------- answers forwarded by inject.js ----------

  window.addEventListener('message', (e) => {
    // No e.source check: Firefox hands content scripts a wrapped window that never equals e.source.
    if (e.origin !== location.origin || e.data?.__kyaraGames !== 1) return;
    const { kind, path, body } = e.data;
    if (kind === 'write') {
      if (/^\/market\//.test(path)) setTimeout(refreshFavMarket, 1500); // offers just changed
      return void send({ type: 'collection-stale' });
    }
    let m;
    if (path === '/me/collection') {
      send({ type: 'collection', items: body });
      keepSmartLocks(body);
    }
    else if (path === '/me') send({ type: 'me', user: body });
    else if (path === '/me/bootstrap' && body?.me) send({ type: 'me', user: body.me });
    else if ((m = path.match(/^\/trades\/available\/([^/]+)$/))) {
      const list = Array.isArray(body) ? body : [];
      setPartner(decodeURIComponent(m[1]), { tradeable: list.map((x) => [x.characterId ?? x.id, x.n ?? x.qty ?? 1]) });
    } else if ((m = path.match(/^\/trades\/owned\/([^/]+)$/))) {
      setPartner(decodeURIComponent(m[1]), { owned: Array.isArray(body) ? body : null });
    } else if ((m = path.match(/^\/me\/friends\/([^/]+)\/collection$/))) {
      const list = Array.isArray(body) ? body : [];
      setPartner(decodeURIComponent(m[1]), {
        spare: list.filter((x) => (x.spare ?? 0) > 0).map((x) => [x.id ?? x.characterId, x.spare]),
        owned: list.map((x) => x.id ?? x.characterId)
      });
    } else if ((m = path.match(/^\/users\/([^/]+)$/)) && body?.pseudo) {
      const id = decodeURIComponent(m[1]);
      if (partner?.id === id || pendingNames.has(id)) setPartner(id, { pseudo: body.pseudo });
      else pendingNames.set(id, body.pseudo);
    }
  });

  const pendingNames = new Map();
  async function setPartner(id, patch) {
    if (pendingNames.has(id)) patch.pseudo ??= pendingNames.get(id);
    const next = await send({ type: 'partner', partner: { id, ...patch } });
    if (next && !next.error) {
      partner = next;
      scanComposer();
    }
  }

  // ---------- badges on every card image ----------

  // The trade composer is a dialog holding both sides of the deal ("Tu donnes" / "Tu reçois").
  const composers = new WeakSet();
  function inComposer(img) {
    const dialog = img.closest('[role="dialog"]');
    if (!dialog) return false;
    if (composers.has(dialog)) return true;
    const text = dialog.textContent;
    if (text.includes('Tu donnes') && text.includes('Tu reçois')) {
      composers.add(dialog);
      return true;
    }
    return false;
  }

  // "Mes échanges": a card on the "Tu donnes" side of a trade still waiting for an answer (status pill .st-pending).
  function givenInPendingTrade(img) {
    const item = img.closest('li.trade');
    if (!item?.querySelector('.st-pending')) return false;
    for (let el = img.parentElement; el && el !== item; el = el.parentElement) {
      const text = el.textContent;
      const give = text.includes('Tu donnes');
      const get = text.includes('Tu reçois');
      if (give || get) return give && !get;
    }
    return false;
  }

  // Where each badge is wanted: the market only inside the trade composer; duplicates on Collection and in trades,
  // and in trades also the cards held only once, so giving away a last copy is never a surprise.
  function badgeScope(img) {
    if (givenInPendingTrade(img)) return { missing: false, dupes: settings.badgeDupes, single: settings.badgeDupes };
    const trade = inComposer(img);
    const path = location.pathname;
    if (path.startsWith('/marche') && !trade) return { missing: false, dupes: false, single: false };
    return { missing: settings.badgeMissing, dupes: settings.badgeDupes && (trade || path === '/collection'), single: settings.badgeDupes && trade };
  }

  const MIN_SIZE = 48; // avatars and tiny chips stay clean
  function tag(img) {
    const m = CARD_SRC.exec(img.getAttribute('src') || '');
    const host = img.parentElement;
    if (!host || img.classList.contains('kyx-ghost') || img.closest('.kyx-modal')) return; // our own pictures: no badge
    let badge = host.querySelector(':scope > .kyx-badge');
    const id = m ? Number(m[1]) : null;
    let kind = null;
    let text = '';
    if (id && coll) {
      const width = img.getBoundingClientRect().width;
      if (!width && !img.complete) return void img.addEventListener('load', () => tag(img), { once: true });
      const scope = width >= MIN_SIZE ? badgeScope(img) : {};
      const q = qty(id);
      if (q === 0 && scope.missing) {
        kind = 'missing';
        text = 'Manquante';
      } else if (q > 1 && scope.dupes) {
        kind = 'dupe';
        text = `×${q}`;
      } else if (q === 1 && scope.single) {
        kind = 'single';
        text = 'Unique';
      }
    }
    if (!kind) return void badge?.remove();
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'kyx-badge';
      badge.setAttribute('aria-hidden', 'true');
      if (getComputedStyle(host).position === 'static') host.dataset.kyxPos = '1';
      host.appendChild(badge);
    }
    badge.dataset.kind = kind;
    badge.textContent = text;
  }

  function scanBadges(root = document) {
    if (root.nodeType !== 1 && root !== document) return;
    if (root.tagName === 'IMG') return tag(root);
    root.querySelectorAll?.('img[src*="/cards/"]').forEach(tag);
  }

  // ---------- completed albums ----------

  const albumCount = (li) => (li.querySelector('.a-meta')?.textContent ?? '').replace(/[\s  ]/g, '').match(/(\d+)\/(\d+)/);

  function albumComplete(li) {
    const m = albumCount(li);
    if (m) return Number(m[1]) >= Number(m[2]);
    const bar = li.querySelector('.bar > span');
    if (bar && /^100(\.0+)?%$/.test(bar.style.width)) return true;
    const s = seriesIndex()?.get(norm(li.querySelector('.a-name')?.textContent));
    return s ? s.owned >= s.total : false;
  }

  // Series with fewer than 5 characters in the whole catalog.
  const SMALL = 5;
  function albumSmall(li) {
    const m = albumCount(li);
    if (m) return Number(m[2]) < SMALL;
    const s = seriesIndex()?.get(norm(li.querySelector('.a-name')?.textContent));
    return s ? s.total < SMALL : false;
  }

  const PAGE = 60; // the site renders albums 60 at a time behind an "Afficher plus" button
  let autoMore = 0;

  function scanAlbums() {
    const list = location.pathname === '/collection' ? document.querySelector('ul.albums') : null;
    if (!list) return;
    const filtering = settings.hideComplete || settings.hideSmall;
    let hidden = 0;
    let visible = 0;
    for (const li of list.children) {
      const done = settings.hideComplete && albumComplete(li);
      if (done) hidden++;
      if (done || (settings.hideSmall && albumSmall(li))) {
        if (li.dataset.kyxHidden !== '1') li.dataset.kyxHidden = '1';
      } else {
        visible++;
        if (li.dataset.kyxHidden) delete li.dataset.kyxHidden;
      }
    }
    albumToggle(list, hidden);
    // Hidden albums still use up the site's page: load the next ones until a full page of unfinished albums shows.
    const more = list.nextElementSibling?.matches('button') ? list.nextElementSibling : list.nextElementSibling?.querySelector('button');
    if (filtering && visible < PAGE && more && autoMore < 40) {
      autoMore++;
      more.click();
    } else if (!more || visible >= PAGE) {
      autoMore = 0;
    }
  }

  // Toggles placed in the site's own toolbar, left of the "Trier" group.
  function albumToggle(list, hidden) {
    const tools = list.parentElement?.querySelector('.al-tools');
    const views = tools?.querySelector('.views');
    if (!views) return;
    const index = seriesIndex();
    const done = index ? [...index.values()].filter((s) => s.owned >= s.total).length : hidden;
    const small = index ? [...index.values()].filter((s) => s.total < SMALL).length : 0;
    const s = (n) => (n > 1 ? 's' : '');
    toggleButton(tools, views, 'hideComplete', settings.hideComplete ? `✔ ${done} série${s(done)} complète${s(done)} masquée${s(done)}` : 'Masquer les séries complètes');
    toggleButton(
      tools,
      views,
      'hideSmall',
      settings.hideSmall ? `✔ ${small} série${s(small)} de moins de ${SMALL} persos masquée${s(small)}` : `Masquer les séries de moins de ${SMALL} persos`
    );
  }

  function toggleButton(tools, views, key, label) {
    let btn = tools.querySelector(`:scope > .kyx-toggle[data-key="${key}"]`);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kyx-toggle';
      btn.dataset.key = key;
      btn.addEventListener('click', () => {
        if (!alive()) return shutdown();
        autoMore = 0;
        chrome.storage.local.get('settings').then(({ settings: s }) =>
          chrome.storage.local.set({ settings: { ...s, [key]: !settings[key] } })
        );
      });
      tools.insertBefore(btn, views);
    }
    if (btn.textContent !== label) btn.textContent = label;
    btn.setAttribute('aria-pressed', String(settings[key]));
  }

  // ---------- missing cards of the Collection grid ----------

  // The site draws a card you don't own as a dashed box with a "?": show the card itself, greyed out,
  // with its name above the site's number and rarity. Everything goes inside the site's box, so it leaves with it.
  function scanMissing() {
    // A card just bought leaves its "?" box: its buy order row goes too.
    document.querySelectorAll('.kyx-order').forEach((row) => {
      if (!row.parentElement?.querySelector(':scope > a.slot > .miss')) row.remove();
    });
    if (location.pathname !== '/collection') return;
    const ids = [];
    for (const miss of document.querySelectorAll('a.slot > .miss')) {
      const id = Number(miss.parentElement.getAttribute('href')?.match(/\/wiki\/(\d+)/)?.[1]);
      if (!id) continue;
      ids.push(id);
      orderRow(miss.parentElement, id);
      const name = catalog?.get(id)?.n ?? '';
      if (miss.dataset.kyxGhost === `${id}|${name}`) continue;
      miss.dataset.kyxGhost = `${id}|${name}`;
      let img = miss.querySelector(':scope > .kyx-ghost');
      if (!img) {
        img = document.createElement('img');
        img.className = 'kyx-ghost';
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        miss.prepend(img);
      }
      img.src = `/cards/sm/${id}.webp`;
      let label = miss.querySelector(':scope > .kyx-ghost-name');
      if (!label) {
        label = document.createElement('span');
        label.className = 'kyx-ghost-name';
        img.after(label);
      }
      label.textContent = name;
      label.title = name;
    }
    loadPrices(ids);
  }

  // ---------- buy order under each missing card ----------

  // Like the "≈ price · Vendre" row of owned cards: the fair price and a button opening a small buy order form,
  // the same one as on the card's wiki page (lowest price of the rarity or fair-play bound, 1 to 10 copies).
  const MIN_PRICE = { C: 1, U: 1, R: 3, E: 10, L: 40, M: 150 };
  const RARITY_LABEL = { C: 'Commune', U: 'Peu commune', R: 'Rare', E: 'Épique', L: 'Légendaire', M: 'Mythique' };
  const ORDER_ERRORS = {
    chakra: 'Pas assez de chakra.',
    invalid_price: 'Prix invalide.',
    too_many_orders: 'Tu as atteint le nombre maximum d’ordres d’achat.',
    market_locked: 'Le marché ne t’est pas encore ouvert.',
    rate_limited: 'Trop d’actions d’un coup, patiente quelques secondes.',
    pass_required: 'Le site demande une vérification : place cet ordre depuis la fiche de la carte.',
    no_token: 'Connecte-toi sur le site.',
    network: 'Serveur injoignable.'
  };

  // Same request as the site's own: session, device and anti-bot pass it keeps in localStorage, sent from the page.
  async function siteApi(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { accept: 'application/json' };
    try {
      const token = localStorage.getItem('kyara_token');
      const device = localStorage.getItem('kyara_device');
      const pass = JSON.parse(localStorage.getItem('kyara_pass') ?? 'null');
      if (token) headers.authorization = `Bearer ${token}`;
      if (device) headers['x-device-id'] = device;
      if (pass?.pass && pass.expiresAt > Date.now()) headers['x-pass'] = pass.pass;
    } catch {}
    if (auth && !headers.authorization) throw Object.assign(new Error('no_token'), { code: 'no_token' });
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      // Firefox: content.fetch sends the request as the page itself, like Chrome's fetch does here.
      const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
      const url = `${location.origin}/api${path}`;
      res = await (typeof content !== 'undefined' && content?.fetch ? content.fetch(url, init) : fetch(url, init));
    } catch {
      throw Object.assign(new Error('network'), { code: 'network' });
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const code = data?.error ?? `http_${res.status}`;
      throw Object.assign(new Error(code), { code });
    }
    return data;
  }

  function orderRow(slot, id) {
    const cell = slot.parentElement;
    if (!cell) return;
    let row = cell.querySelector(':scope > .kyx-order');
    if (!row) {
      row = document.createElement('div');
      row.className = 'kyx-order';
      row.innerHTML = '<span class="kyx-order-med"></span><button type="button" class="kyx-order-open">Ordre d’achat</button>';
      row.querySelector('.kyx-order-open').addEventListener('click', () => toggleOrderForm(row));
      slot.after(row);
    }
    row.dataset.id = id;
    const price = prices.get(id);
    const text = price != null ? `≈ ${chakra(price)}` : '';
    const med = row.querySelector('.kyx-order-med');
    if (med.textContent !== text) med.textContent = text;
  }

  // The form opens in a pop-up over the page, with the card, like the site's own dialogs.
  function toggleOrderForm(row) {
    if (!alive()) return shutdown();
    document.querySelector('.kyx-modal-back')?.remove();
    const id = Number(row.dataset.id);
    const card = catalog?.get(id);
    const back = document.createElement('div');
    back.className = 'kyx-modal-back';
    back.innerHTML = `
      <form class="kyx-modal kyx-order-form" role="dialog" aria-modal="true" aria-label="Ordre d’achat">
      <div class="kyx-modal-head">
        <img src="/cards/sm/${id}.webp" alt="" referrerpolicy="no-referrer" />
        <div><small>Ordre d’achat</small><b class="kyx-modal-name"></b><span class="kyx-modal-sub"></span></div>
      </div>
      <p class="kyx-order-facts">Chargement…</p>
      <div class="kyx-order-fields">
        <label>Prix (◆)<input name="price" type="number" step="1" inputmode="numeric" required /></label>
        <label>Qté<input name="qty" type="number" min="1" max="10" step="1" value="1" inputmode="numeric" required /></label>
      </div>
      <p class="kyx-order-msg" role="status"></p>
      <div class="kyx-order-btns">
        <button type="button" class="kyx-order-cancel">Annuler</button>
        <button type="submit" class="kyx-order-go" disabled>Placer</button>
      </div>
      </form>`;
    document.body.appendChild(back);
    const form = back.firstElementChild;
    const $ = (s) => form.querySelector(s);
    $('.kyx-modal-name').textContent = card?.n ?? `Carte n° ${id}`;
    $('.kyx-modal-sub').textContent = [card?.s, RARITY_LABEL[card?.r]].filter(Boolean).join(' · ');
    const onKey = (e) => e.key === 'Escape' && close();
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => e.target === back && close());
    const price = $('[name="price"]');
    const qty = $('[name="qty"]');
    const go = $('.kyx-order-go');
    const msg = (text, kind = '') => {
      $('.kyx-order-msg').textContent = text;
      $('.kyx-order-msg').dataset.kind = kind;
    };
    let min = MIN_PRICE[card?.r] ?? 1;
    const update = () => {
      const p = Number(price.value);
      const q = Number(qty.value);
      const ok = Number.isInteger(p) && p >= min && Number.isInteger(q) && q >= 1 && q <= 10;
      go.disabled = !ok || form.dataset.busy === '1';
      go.textContent = ok ? `Placer · ${chakra(p * q)}` : 'Placer';
    };
    price.addEventListener('input', update);
    qty.addEventListener('input', update);
    $('.kyx-order-cancel').addEventListener('click', close);

    Promise.allSettled([
      siteApi(`/fair-play/bounds/${id}`),
      siteApi(`/market/buy-orders?characterId=${id}`),
      siteApi(`/market/prices/${id}`),
      siteApi(`/market/listings?characterId=${id}&type=fixed&sort=price_asc&pageSize=1`)
    ]).then(([bounds, book, stats, listings]) => {
      if (!form.isConnected) return;
      const val = (r) => (r.status === 'fulfilled' ? r.value : null);
      min = Math.max(min, Number(val(bounds)?.min) || 0);
      const best = (Array.isArray(val(book)) ? val(book) : val(book)?.items ?? [])[0]?.price ?? null;
      const median = val(stats)?.median7d ?? val(stats)?.median30d ?? null;
      const lowest = val(listings)?.items?.[0]?.price ?? null;
      const facts = [`Min ${chakra(min)}`];
      if (lowest != null) facts.push(`en vente dès ${chakra(lowest)}`);
      if (median != null) facts.push(`médiane 7 j ${chakra(median)}`);
      if (best != null) facts.push(`meilleur ordre ${chakra(best)}`);
      $('.kyx-order-facts').textContent = facts.join(' · ');
      price.min = String(min);
      if (!price.value) price.value = String(Math.max(min, Math.round(best ?? median ?? min)));
      update();
      price.focus();
      price.select();
      if (val(bounds) == null && bounds.reason?.code === 'no_token') msg(ORDER_ERRORS.no_token, 'err');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      form.dataset.busy = '1';
      update();
      msg('Envoi…');
      try {
        const res = await siteApi('/market/buy-orders', { method: 'POST', body: { characterId: id, price: Number(price.value), qty: Number(qty.value) } });
        if (res?.user) send({ type: 'me', user: res.user });
        const filled = res?.order?.filled ?? 0;
        if (filled > 0) send({ type: 'collection-stale' });
        msg(
          filled > 0
            ? `Achetée tout de suite (${filled}) ✔`
            : `Ordre placé ✔ ${chakra(Number(price.value) * Number(qty.value))} bloqués jusqu’à exécution ou annulation (30 j max).`,
          'ok'
        );
        price.disabled = qty.disabled = true;
        go.hidden = true;
        $('.kyx-order-cancel').textContent = 'Fermer';
      } catch (err) {
        const code = err?.code ?? String(err);
        msg(ORDER_ERRORS[code] ?? `Échec (${code}).`, 'err');
        if (code === 'pass_required') {
          const link = document.createElement('a');
          link.href = `/wiki/${id}`;
          link.textContent = ' Ouvrir la fiche';
          $('.kyx-order-msg').appendChild(link);
        }
        delete form.dataset.busy;
        update();
      }
    });
  }

  // ---------- an owned card of the Collection grid opens its wiki page ----------

  // The site opens a window when an owned card is clicked; its link already leads to the card's wiki page.
  // The click is stopped before the site sees it and the same link is followed through the site's own navigation.
  window.addEventListener(
    'click',
    (e) => {
      if (stopped || !settings.cardToWiki || location.pathname !== '/collection') return;
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const slot = e.target.closest?.('a.slot');
      const href = slot?.getAttribute('href');
      if (!href?.startsWith('/wiki/') || slot.querySelector(':scope > .miss')) return;
      e.preventDefault();
      e.stopPropagation();
      const link = Object.assign(document.createElement('a'), { href });
      link.hidden = true;
      document.body.appendChild(link);
      link.click(); // handled by the site's router like any other link
      link.remove();
    },
    true
  );

  // ---------- favourite series (œuvres) and the "★ Favoris" filter of the market ----------

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // A star on each album of Collection (and in the bar of the open album) marks a series as a favourite.
  // In the market, the "★ Favoris" chip lists the offers of those series only: the market is asked for each
  // of them and the offers are gathered in one list, shown instead of the site's own.
  let favSeries = new Set();
  let marketFav = false;
  let marketShown = '';

  async function toggleFav(name) {
    if (!alive()) return shutdown();
    const next = new Set(favSeries);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    // Taken into account at once, so that several stars touched in a row all count.
    favSeries = new Set([...next].sort((a, b) => a.localeCompare(b, 'fr')));
    marketShown = '';
    scanFavStars();
    scanMarket();
    await chrome.storage.local.set({ favSeries: [...favSeries] });
  }

  function favButton(inline) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = inline ? 'kyx-fav inline' : 'kyx-fav';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // the album tile itself opens the album
      toggleFav(btn.dataset.series);
    });
    return btn;
  }

  function setStar(star, name, inline) {
    const on = favSeries.has(name);
    star.dataset.series = name;
    const text = inline ? (on ? '★ Favori' : '☆ Mettre en favori') : on ? '★' : '☆';
    if (star.textContent !== text) star.textContent = text;
    star.setAttribute('aria-pressed', String(on));
    const title = on ? `Retirer ${name} des favoris` : `Mettre ${name} en favori (filtre « Favoris » du Marché)`;
    if (star.title !== title) {
      star.title = title;
      star.setAttribute('aria-label', title);
    }
  }

  function scanFavStars() {
    if (location.pathname !== '/collection') return;
    for (const li of document.querySelectorAll('ul.albums > li')) {
      const name = li.querySelector('.a-name')?.textContent.trim();
      if (!name) continue;
      let star = li.querySelector(':scope > .kyx-fav');
      if (!star) {
        star = favButton(false);
        li.dataset.kyxPos = '1';
        li.appendChild(star);
      }
      setStar(star, name, false);
    }
    const bar = document.querySelector('.album-bar');
    const title = bar?.querySelector(':scope > b');
    const series = title?.textContent.trim();
    if (!series) return;
    let star = bar.querySelector(':scope > .kyx-fav');
    if (!star) {
      star = favButton(true);
      title.after(star);
    }
    setStar(star, series, true);
  }

  const RARITY_COLOR = { C: '#B5B1BB', U: '#3FBF7F', R: '#4D9BFF', E: '#B072FF', L: '#F5C518', M: '#FF4D2E' };
  const MARKET_SORTS = [
    ['price_asc', 'Prix croissant'],
    ['price_desc', 'Prix décroissant'],
    ['ending', 'Fin proche'],
    ['newest', 'Plus récentes']
  ];

  function scanMarket() {
    const filters = location.pathname === '/marche' ? document.querySelector('#mq')?.closest('.filters') : null;
    const chips = filters?.querySelector('.chips');
    if (!chips) return void (marketShown = '');
    let btn = chips.querySelector(':scope > .kyx-fav-chip');
    if (!btn) {
      const first = chips.querySelector(':scope > button');
      if (!first) return;
      // A copy of the site's "Toutes" chip, right after it.
      btn = first.cloneNode(true);
      btn.classList.remove('on');
      btn.classList.add('kyx-chip', 'kyx-fav-chip');
      btn.textContent = '★ Favoris';
      btn.title = 'Seulement les offres de tes œuvres favorites';
      btn.addEventListener('click', () => {
        if (!alive()) return shutdown();
        marketFav = !marketFav;
        marketShown = '';
        chrome.storage.local.set({ marketFav });
        scanMarket();
      });
      first.after(btn);
    }
    btn.classList.toggle('on', marketFav);
    btn.setAttribute('aria-pressed', String(marketFav));
    // The site's rarity chips ("Toutes", "Commune"…) filter the favourites as well.
    if (!chips.dataset.kyxRarity) {
      chips.dataset.kyxRarity = '1';
      chips.addEventListener('click', (e) => {
        if (!marketFav || !e.target.closest('button') || e.target.closest('.kyx-chip')) return;
        setTimeout(() => {
          const view = document.querySelector('.kyx-favmarket');
          if (!view?.kyxState) return;
          const rarity = siteRarity(chips);
          if (rarity === view.kyxState.rarity) return;
          view.kyxState.rarity = rarity;
          renderFavMarket(view);
        }, 60);
      });
    }
    // The site's offers (all that follows its filters) make way for the favourites while the chip is on.
    let view = filters.parentElement.querySelector(':scope > .kyx-favmarket');
    for (let el = filters.nextElementSibling; el; el = el.nextElementSibling) {
      if (el === view) continue;
      if (marketFav && el.dataset.kyxHidden !== '1') el.dataset.kyxHidden = '1';
      else if (!marketFav && el.dataset.kyxHidden) delete el.dataset.kyxHidden;
    }
    if (!marketFav) {
      view?.remove();
      marketShown = '';
      return;
    }
    if (!view) {
      view = document.createElement('section');
      view.className = 'kyx-favmarket';
      view.kyxState = { type: 'fixed', sort: 'price_asc', missing: false, only: null, rarity: '' };
      filters.after(view);
    }
    const key = [...favSeries].join('|');
    if (marketShown === key && view.childElementCount) return;
    marketShown = key;
    renderFavMarket(view);
  }

  // Rarity of the site's chip that is on ('' for "Toutes" or none).
  const RARITY_BY_LABEL = Object.fromEntries(Object.entries(RARITY_LABEL).map(([k, v]) => [norm(v), k]));
  function siteRarity(chips) {
    const on = [...(chips?.querySelectorAll(':scope > button.on:not(.kyx-chip)') ?? [])];
    for (const b of on) {
      const r = RARITY_BY_LABEL[norm(b.textContent)];
      if (r) return r;
    }
    return '';
  }

  function renderFavMarket(view) {
    const st = view.kyxState;
    const names = [...favSeries];
    if (st.only && !favSeries.has(st.only)) st.only = null;
    st.rarity = siteRarity(document.querySelector('#mq')?.closest('.filters')?.querySelector('.chips')) || st.rarity;
    if (!names.length) {
      view.innerHTML = '<p class="kyx-fm-note">Aucune œuvre en favori pour l’instant. Sur la page <a href="/collection">Collection</a>, onglet Albums, touche l’étoile ☆ d’un album pour l’ajouter.</p>';
      return;
    }
    view.innerHTML = `
      <div class="kyx-fm-favs"></div>
      <div class="kyx-fm-tools">
        <select class="kyx-fm-type" aria-label="Type d’offre"><option value="fixed">Prix fixe</option><option value="auction">Enchères</option></select>
        <select class="kyx-fm-sort" aria-label="Trier">${MARKET_SORTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
        <label class="kyx-fm-check"><input type="checkbox" /> Seulement mes manquantes</label>
      </div>
      <div class="kyx-fm-status"><p class="kyx-fm-note" role="status"></p><button type="button" class="kyx-fm-refresh">↻ Actualiser</button></div>
      <ul class="kyx-fm-grid"></ul>
      <button type="button" class="kyx-fm-more" hidden>Voir plus d’offres</button>`;
    // Choose the series to show: all the favourites, or a single one (× takes it out of the favourites).
    const favs = view.querySelector('.kyx-fm-favs');
    const pick = (only) => {
      st.only = only;
      favs.querySelectorAll('.kyx-fm-fav').forEach((c) => c.setAttribute('aria-pressed', String((c.dataset.series || null) === only)));
      loadFavOffers(view, true);
    };
    const all = document.createElement('span');
    all.className = 'kyx-fm-fav all';
    all.dataset.series = '';
    all.innerHTML = `<button type="button" class="kyx-fm-pick">★ Toutes mes favorites (${names.length})</button>`;
    all.querySelector('button').addEventListener('click', () => pick(null));
    favs.appendChild(all);
    for (const name of names) {
      const chip = document.createElement('span');
      chip.className = 'kyx-fm-fav';
      chip.dataset.series = name;
      chip.innerHTML = '<button type="button" class="kyx-fm-pick"></button><button type="button" class="kyx-fm-del">×</button>';
      chip.querySelector('.kyx-fm-pick').textContent = name;
      chip.querySelector('.kyx-fm-pick').title = `Afficher seulement ${name}`;
      chip.querySelector('.kyx-fm-pick').addEventListener('click', () => pick(st.only === name ? null : name));
      chip.querySelector('.kyx-fm-del').title = `Retirer ${name} des favoris`;
      chip.querySelector('.kyx-fm-del').addEventListener('click', () => toggleFav(name));
      favs.appendChild(chip);
    }
    favs.querySelectorAll('.kyx-fm-fav').forEach((c) => c.setAttribute('aria-pressed', String((c.dataset.series || null) === st.only)));
    const type = view.querySelector('.kyx-fm-type');
    const sort = view.querySelector('.kyx-fm-sort');
    const missing = view.querySelector('.kyx-fm-check input');
    type.value = st.type;
    sort.value = st.sort;
    missing.checked = st.missing;
    const reload = () => {
      Object.assign(st, { type: type.value, sort: sort.value, missing: missing.checked });
      loadFavOffers(view, true);
    };
    type.addEventListener('change', reload);
    sort.addEventListener('change', reload);
    missing.addEventListener('change', reload);
    view.querySelector('.kyx-fm-more').addEventListener('click', () => loadFavOffers(view, false));
    view.querySelector('.kyx-fm-refresh').addEventListener('click', () => loadFavOffers(view, 'refresh'));
    loadFavOffers(view, true);
  }

  // The market changes all the time (offers sold, new ones, bids): the list is asked again every 15 seconds
  // while it is on screen, when coming back to the tab and after a purchase or a sale.
  const FAV_REFRESH = 15e3;
  function refreshFavMarket() {
    const view = document.querySelector('.kyx-favmarket');
    if (view?.kyxState?.offers && !document.hidden) loadFavOffers(view, 'refresh');
  }
  setInterval(() => {
    const view = document.querySelector('.kyx-favmarket');
    if (view?.kyxLoadedAt && Date.now() - view.kyxLoadedAt >= FAV_REFRESH) refreshFavMarket();
  }, 3e3);
  document.addEventListener('visibilitychange', () => {
    const view = document.querySelector('.kyx-favmarket');
    if (!document.hidden && view?.kyxLoadedAt && Date.now() - view.kyxLoadedAt >= 5e3) refreshFavMarket();
  });

  // One request per favourite series (24 offers each), merged and sorted like the site would.
  async function loadFavOffers(view, mode) {
    const st = view.kyxState;
    const run = (view.kyxRun = (view.kyxRun ?? 0) + 1);
    const names = st.only ? [st.only] : [...favSeries].slice(0, 30);
    const refresh = mode === 'refresh' && st.page > 0;
    if (mode === true || (mode === 'refresh' && !refresh)) {
      st.page = 0;
      st.offers = [];
      st.more = false;
      view.querySelector('.kyx-fm-grid').innerHTML = '';
    }
    // A refresh asks again for every page already shown, all at once.
    const page = refresh ? 1 : st.page + 1;
    const size = refresh ? 24 * st.page : 24;
    const note = view.querySelector('.kyx-fm-note');
    const more = view.querySelector('.kyx-fm-more');
    if (!refresh) note.textContent = 'Chargement des offres…';
    more.hidden = true;
    const answers = await Promise.all(
      names.map((series) => {
        const q = new URLSearchParams({ type: st.type, sort: st.sort, series, page: String(page), pageSize: String(size) });
        if (st.missing) q.set('missing', '1');
        if (st.rarity) q.set('rarity', st.rarity);
        return siteApi(`/market/listings?${q}`, { auth: false }).catch(() => null);
      })
    );
    if (run !== view.kyxRun || !view.isConnected) return;
    if (refresh) st.offers = [];
    else st.page = page;
    st.more = answers.some((a) => a && (a.total ?? 0) > st.page * 24);
    view.kyxLoadedAt = Date.now();
    const seen = new Set(st.offers.map((o) => o.id));
    for (const a of answers) for (const o of a?.items ?? []) if (!seen.has(o.id)) st.offers.push(o);
    const price = (o) => o.currentBid ?? o.price ?? 0;
    const by = {
      price_asc: (a, b) => price(a) - price(b),
      price_desc: (a, b) => price(b) - price(a),
      ending: (a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt),
      newest: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    }[st.sort];
    st.offers.sort(by);
    const total = answers.reduce((n, a) => n + (a?.total ?? 0), 0);
    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const scope = `${st.only ?? `${names.length} œuvre${names.length > 1 ? 's' : ''} en favori`}${st.rarity ? ` · ${RARITY_LABEL[st.rarity]}` : ''}`;
    note.textContent = st.offers.length
      ? `${num(st.offers.length)} offre${st.offers.length > 1 ? 's' : ''} affichée${st.offers.length > 1 ? 's' : ''} sur ${num(total)} · ${scope} · à jour à ${time}, actualisé toutes les 15 s.`
      : `Aucune offre en ce moment · ${scope} · vérifié à ${time}.`;
    more.hidden = !st.more;
    renderFavOffers(view);
  }

  function renderFavOffers(view) {
    const grid = view.querySelector('.kyx-fm-grid');
    grid.innerHTML = '';
    for (const o of view.kyxState.offers) {
      const c = o.character ?? {};
      const url = new URL(location.href);
      url.searchParams.set('annonce', o.id); // the site's own way to open an offer
      const li = document.createElement('li');
      li.innerHTML = `
        <a class="kyx-fm-tile" href="${esc(url.pathname + url.search)}">
          <img alt="" loading="lazy" referrerpolicy="no-referrer" />
          <span class="kyx-fm-info">
            <b></b>
            <small class="kyx-fm-sub"></small>
            <span class="kyx-fm-price"></span>
            <small class="kyx-fm-meta"></small>
          </span>
        </a>`;
      li.querySelector('img').src = `/cards/sm/${c.id}.webp`;
      li.querySelector('b').textContent = c.name ?? '?';
      const sub = li.querySelector('.kyx-fm-sub');
      sub.textContent = `${c.series ?? ''} · ${RARITY_LABEL[c.rarity] ?? c.rarity ?? ''}`;
      sub.style.setProperty('--r', RARITY_COLOR[c.rarity] ?? 'inherit');
      const value = o.currentBid ?? o.price;
      li.querySelector('.kyx-fm-price').textContent = `${chakra(value ?? 0)}${o.type === 'auction' ? ` · ${o.bidCount ?? 0} enchère${o.bidCount > 1 ? 's' : ''}` : ''}`;
      const median = o.prices?.median7d;
      li.querySelector('.kyx-fm-meta').textContent = [
        median != null ? `médiane 7 j ${chakra(median)}` : null,
        o.seller?.pseudo ? `par ${o.seller.pseudo}` : null,
        coll ? (qty(c.id) ? `tu l’as ×${qty(c.id)}` : 'te manque') : null
      ]
        .filter(Boolean)
        .join(' · ');
      grid.appendChild(li);
    }
  }

  // ---------- "Bloquer sauf doublons" in the album bar ----------

  // The site locks a card with all its copies, so the duplicates of a locked album can't be sold.
  // This mode locks only the cards held once and leaves the others free: their duplicates can go to the market
  // (the site never sells a last copy), and a card is locked again as soon as a single copy is left.
  let smartLock = new Set(); // series names
  let pinning = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const collectionItems = (body) => (Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : []);

  // Copies not on sale nor in a trade (those are held apart by the site and stay out of the lock).
  const freeCopies = (x) => (x.qty ?? 0) - (x.locked ?? 0);

  // [id, pinned] changes so that, in this series, exactly the cards with a single free copy are locked.
  function lockPlan(series, items) {
    const ids = new Set([...(catalog?.values() ?? [])].filter((c) => norm(c.s) === norm(series)).map((c) => c.id));
    const changes = [];
    for (const x of items) {
      const id = x.characterId ?? x.id;
      if (!ids.has(id) || !(x.qty > 0)) continue;
      const want = freeCopies(x) <= 1;
      if (!!x.pinned !== want) changes.push([id, want]);
    }
    return changes;
  }

  // A duplicate put on sale leaves a single copy: lock it, so it can't go in a trade or a second sale by mistake.
  function listedPlan(items) {
    const changes = [];
    for (const x of items) {
      const onSale = x.escrow ? !!x.escrow.listings : (x.locked ?? 0) > 0;
      if (!x.pinned && onSale && (x.locked ?? 0) > 0 && freeCopies(x) === 1) changes.push([x.characterId ?? x.id, true]);
    }
    return changes;
  }

  async function applyPins(changes) {
    for (const [id, pinned] of changes) {
      await siteApi(`/me/collection/${id}/pin`, { method: 'POST', body: { pinned } });
      await wait(150);
    }
  }

  // Each time the site reloads the collection: lock the cards that went down to one copy, free the new duplicates.
  async function keepSmartLocks(body) {
    if (pinning) return;
    const items = collectionItems(body);
    const changes = catalog ? [...smartLock].flatMap((series) => lockPlan(series, items)) : [];
    if (settings.lockLastListed) {
      for (const change of listedPlan(items)) if (!changes.some(([id]) => id === change[0])) changes.push(change);
    }
    if (!changes.length) return;
    pinning = true;
    try {
      await applyPins(changes);
    } catch {
    } finally {
      pinning = false;
    }
  }

  async function setSmart(series, on) {
    if (on) smartLock.add(series);
    else smartLock.delete(series);
    if (!alive()) return shutdown();
    await chrome.storage.local.set({ smartLock: [...smartLock] });
  }

  function barMsg(bar, text, err = false) {
    let el = bar.querySelector(':scope > .kyx-smart-msg');
    if (!el) {
      el = document.createElement('span');
      el.className = 'kyx-smart-msg';
      bar.appendChild(el);
    }
    el.textContent = text;
    el.dataset.kind = err ? 'err' : 'ok';
  }

  async function smartClick(bar, btn) {
    if (!alive()) return shutdown();
    const series = bar.querySelector(':scope > b')?.textContent.trim();
    if (!series) return;
    if (smartLock.has(series)) {
      await setSmart(series, false);
      scanAlbumBar();
      return barMsg(bar, 'Mode arrêté : les verrous restent tels quels. « Bloquer l’album » verrouille tout.');
    }
    if (!catalog) return barMsg(bar, 'Catalogue pas encore chargé, réessaie dans un instant.', true);
    btn.disabled = true;
    btn.textContent = 'Verrouillage…';
    pinning = true;
    try {
      const changes = lockPlan(series, collectionItems(await siteApi('/me/collection?lean=1')));
      await setSmart(series, true);
      await applyPins(changes);
      location.reload(); // the site keeps its own copy of the locks: show the new ones
    } catch (e) {
      const code = e?.code ?? String(e);
      barMsg(bar, ORDER_ERRORS[code] ?? `Échec (${code}).`, true);
      btn.disabled = false;
      scanAlbumBar();
    } finally {
      pinning = false;
    }
  }

  function scanAlbumBar() {
    const bar = location.pathname === '/collection' ? document.querySelector('.album-bar') : null;
    const series = bar?.querySelector(':scope > b')?.textContent.trim();
    if (!series) return;
    const siteBtn = [...bar.querySelectorAll(':scope > button:not(.kyx-smart)')].find((b) => /loquer l.album/i.test(b.textContent));
    // The site's own "Bloquer / Débloquer l'album" takes over: this mode stops for the series.
    if (siteBtn && !siteBtn.dataset.kyxWatched) {
      siteBtn.dataset.kyxWatched = '1';
      siteBtn.addEventListener('click', () => {
        const name = bar.querySelector(':scope > b')?.textContent.trim();
        if (name && smartLock.has(name)) setSmart(name, false).then(scanAlbumBar);
      });
    }
    let btn = bar.querySelector(':scope > .kyx-smart');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `kyx-smart ${siteBtn?.className ?? 'btn btn-ghost btn-sm'}`;
      btn.addEventListener('click', () => smartClick(bar, btn));
      (siteBtn ?? bar.querySelector(':scope > span') ?? bar.lastElementChild).after(btn);
    }
    if (btn.disabled) return;
    const on = smartLock.has(series);
    const label = on ? '✔ Doublons libres' : '🔒 Bloquer sauf doublons';
    if (btn.textContent !== label) btn.textContent = label;
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on
      ? 'Les cartes en un seul exemplaire sont verrouillées, les doublons restent vendables. Clique pour arrêter ce mode.'
      : 'Verrouille les cartes que tu as en un seul exemplaire et laisse les doublons vendables au marché.';
  }

  // ---------- Missions: completed series next to the referral card ----------

  // The "Séries complètes" card lists every completed series: kept to the height of the referral card beside it
  // (scrolling inside), series still to claim first, and the total in its title.
  function scanMissions() {
    if (location.pathname !== '/missions') return;
    const card = document.querySelector('section[aria-labelledby="albums-t"]');
    const list = card?.querySelector('ul.quests');
    const title = card?.querySelector('#albums-t');
    if (!list || !title) return;
    card.classList.add('kyx-albums');
    const total = list.children.length;
    const toClaim = [...list.children].filter((li) => !li.classList.contains('claimed')).length;
    let count = title.querySelector(':scope > .kyx-count');
    if (!count) {
      count = document.createElement('span');
      count.className = 'kyx-count';
      title.appendChild(count);
    }
    const text = `${total.toLocaleString('fr-FR')}${toClaim ? ` · ${toClaim} à réclamer` : ''}`;
    if (count.textContent !== text) count.textContent = text;
    const ref = document.querySelector('section[aria-labelledby="ref-t"]');
    const height = ref && ref.offsetTop === card.offsetTop ? ref.offsetHeight : 0;
    const max = height > 150 ? `${height}px` : '320px';
    if (card.style.maxHeight !== max) card.style.maxHeight = max;
  }

  // ---------- "Amis" filter on the Classement page ----------

  const num = (n, digits = 0) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: digits });

  // The ranking of the chosen tab (collection, prestige, mythiques…) among your friends and you,
  // with each one's place in the general ranking. Shown instead of the general podium and list.
  const plural = (n, one, many) => (Math.abs(n) < 2 ? one : many);
  const LADDER = {
    collection: { main: (r) => r.owned, unit: (n) => plural(n, 'carte', 'cartes'), side: (r) => `${num(r.mythics ?? 0)} ${plural(r.mythics ?? 0, 'mythique', 'mythiques')}` },
    prestige: { main: (r) => r.points, unit: () => 'points', side: (r) => `${num(r.owned ?? 0)} cartes` },
    mythics: { main: (r) => r.mythics, unit: (n) => plural(n, 'mythique', 'mythiques'), side: (r) => `${num(r.points ?? 0)} pts` },
    series: { main: (r) => r.series, unit: (n) => plural(n, 'série', 'séries'), side: (r) => `${num(r.owned ?? 0)} cartes` },
    achievements: { main: (r) => r.achievements, unit: () => 'succès', side: (r) => `${num(r.points ?? 0)} pts` }
  };
  const ladderCache = new Map(); // `${by}|${id}` -> { at, row }
  let friendsOnly = false;
  let friendsShown = '';

  async function ladderRow(by, id) {
    const key = `${by}|${id}`;
    const hit = ladderCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60e3) return hit.row;
    const res = await siteApi(`/leaderboard/ladder?by=${by}&me=${encodeURIComponent(id)}`, { auth: false }).catch(() => null);
    const row = res?.me ?? null;
    ladderCache.set(key, { at: Date.now(), row });
    return row;
  }

  async function friendIds() {
    const res = await siteApi('/me/friends');
    const list = Array.isArray(res) ? res : res?.friends ?? res?.items ?? [];
    return list.map((f) => (f.user ?? f.friend ?? f).id ?? f.userId).filter((id) => id != null);
  }

  function scanLadder() {
    const head = location.pathname === '/classement' ? document.querySelector('main#contenu section.head') : null;
    const tabs = head?.querySelector('.tabs[role="tablist"]');
    if (!tabs) return void (friendsShown = '');
    let btn = tabs.querySelector(':scope > .kyx-friends-tab');
    if (!btn) {
      const model = tabs.querySelector(':scope > button[role="tab"]');
      if (!model) return;
      btn = model.cloneNode(true);
      btn.classList.add('kyx-friends-tab');
      btn.classList.remove('on');
      btn.removeAttribute('role');
      btn.removeAttribute('aria-selected');
      btn.querySelector('.tk').textContent = '友';
      btn.lastChild.textContent = ' Amis';
      btn.title = 'Seulement tes amis et toi';
      btn.addEventListener('click', () => {
        friendsOnly = !friendsOnly;
        friendsShown = '';
        scanLadder();
      });
      tabs.appendChild(btn);
    }
    btn.classList.toggle('on', friendsOnly);
    btn.setAttribute('aria-pressed', String(friendsOnly));
    const by = LADDER[new URLSearchParams(location.search).get('par')] ? new URLSearchParams(location.search).get('par') : 'collection';
    // The site's podium and lists sit after the head: hidden while the filter is on.
    for (const el of head.parentElement.children) {
      if (el === head || el.classList.contains('kyx-friends')) continue;
      if (friendsOnly && el.dataset.kyxHidden !== '1') el.dataset.kyxHidden = '1';
      else if (!friendsOnly && el.dataset.kyxHidden) delete el.dataset.kyxHidden;
    }
    let board = head.parentElement.querySelector(':scope > .kyx-friends');
    if (!friendsOnly) return void board?.remove();
    if (!board) {
      board = document.createElement('section');
      board.className = 'kyx-friends wrap body';
      head.after(board);
    }
    if (friendsShown === by) return;
    friendsShown = by;
    renderFriends(board, by);
  }

  // The site's own markup for the podium and the list, so the friends ranking looks like the other tabs.
  // Its style classes (svelte-xxxx) change with each version of the site: read from what is on the page.
  function siteScope(selector, fallback) {
    const el = document.querySelector(selector);
    return [...(el?.classList ?? [])].find((c) => c.startsWith('svelte-')) ?? fallback;
  }

  const AVATAR_COLORS = ['#FF4D2E', '#4D9BFF', '#3FBF7F', '#B072FF', '#F5C518', '#4DD6FF'];
  const FRAME_ANIM = { staff: 'spin', 'r-legende': 'spin', 'x-pantheon': 'spin', 'r-virtuose': 'sheen', gold: 'glint', mecene: 'sheen', daimyo: 'spin', 'r-maitre': 'twinkle', 'e-lancement': 'bloom', 'e-guilde': 'spin' };
  const FRAME_ORN = {
    gold: { gems: [0] }, mecene: { stars: [-48, 48], plaque: '援' }, soutien: { plaque: '援' }, daimyo: { stars: [-52, 0, 52], plaque: '大名' },
    'r-collectionneur': { gems: [0] }, 'r-expert': { gems: [0, 120, 240] }, 'r-maitre': { gems: [0], plaque: '名人' },
    'r-virtuose': { stars: [-50, 50], plaque: '達人' }, 'r-legende': { stars: [-55, 0, 55], plaque: '伝説' }, 'x-mythique': { gems: [0] },
    'x-pantheon': { stars: [-40, 40], plaque: '神' }, 'x-albums': { plaque: '集' }, 'x-encyclopedie': { plaque: '典' }, 'x-negoce': { plaque: '商' },
    'e-lancement': { petals: [35, 62, -50] }, 'e-guilde': { stars: [-45, 45], plaque: '団' }, staff: { plaque: '匠' }
  };

  // Same as the site's avatar: picture (or initial) in its frame, with the frame's stars, gems and plaque.
  function avatarHtml(row, size, sc) {
    const frame = row.frame === true ? 'gold' : typeof row.frame === 'string' ? row.frame : null;
    const anim = frame && size >= 64 ? FRAME_ANIM[frame] : null;
    const orn = frame && size >= 40 ? FRAME_ORN[frame] : null;
    const color = AVATAR_COLORS[[...String(row.pseudo ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
    const pic = row.avatar
      ? `<img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="${sc}" src="${esc(row.avatar)}"/>`
      : `<span aria-hidden="true" class="${sc}">${esc(row.pseudo ? row.pseudo[0].toUpperCase() : 'キ')}</span>`;
    let extra = '';
    if (orn) {
      extra += (orn.gems ?? []).map((a) => `<i class="orn gem ${sc}" aria-hidden="true" style="--a:${a}deg"></i>`).join('');
      extra += (orn.stars ?? []).map((a) => `<i class="orn star ${sc}" aria-hidden="true" style="--a:${a}deg">✦</i>`).join('');
      if (orn.plaque) extra += `<i class="orn plaque ${sc}" aria-hidden="true" style="--a:180deg">${orn.plaque}</i>`;
    }
    const cls = ['afr', frame ? `f-${frame}` : '', sc, frame ? 'framed' : '', anim ?? ''].filter(Boolean).join(' ');
    return `<span class="${cls}" style="width:${size}px;height:${size}px;--rw:${Math.max(3, Math.round(size / 15))}px;--sz:${size}px"><span class="av ${sc}" style="--c:${color};font-size:${Math.round(size * 0.4)}px">${pic}</span>${extra}</span>`;
  }

  // Same as the site's rank badge (達人 Virtuose…).
  function rankHtml(rank, size, label, sc) {
    if (!rank) return '';
    const small = label !== 'none' ? ` <small class="${sc}">${esc(rank.label)}</small>` : '';
    return `<span class="rs r-${esc(rank.id)} ${size} l-${label} ${sc}" title="Rang ${esc(rank.label)}"><b class="${sc}"><span class="k ${sc}">${esc(rank.kanji)}</span></b>${small}</span>`;
  }

  const badgesHtml = (row, n, sc) =>
    (row.badges ?? [])
      .slice(0, n)
      .map((b) => `<span class="bd ${b.frame === 'gold' && !String(b.id).startsWith('membre-') ? 'gold' : ''} ${b.frame === 'staff' ? 'staff' : ''} ${sc}" title="${esc(b.label)}">${esc(b.kanji)}</span>`)
      .join('');

  async function renderFriends(board, by) {
    const def = LADDER[by];
    board.innerHTML = '<p class="kyx-friends-note">Chargement du classement de tes amis…</p>';
    let ids;
    try {
      ids = await friendIds();
    } catch (e) {
      board.innerHTML = `<p class="kyx-friends-note">${e?.code === 'no_token' ? 'Connecte-toi pour voir tes amis.' : 'Impossible de charger tes amis.'}</p>`;
      return;
    }
    const { me } = await chrome.storage.local.get('me').catch(() => ({}));
    if (me?.id && !ids.includes(me.id)) ids.push(me.id);
    const rows = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (next < ids.length) {
          const row = await ladderRow(by, ids[next++]);
          if (row) rows.push(row);
        }
      })
    );
    if (friendsShown !== by || !board.isConnected) return;
    rows.sort((a, b) => (def.main(b) ?? 0) - (def.main(a) ?? 0) || (a.pos ?? 0) - (b.pos ?? 0));
    if (rows.length <= (me?.id ? 1 : 0)) {
      board.innerHTML = '<p class="kyx-friends-note">Tu n’as pas encore d’amis sur Kyara. Ajoute-en depuis la page <a href="/amis">Amis</a>.</p>';
      return;
    }

    const sc = siteScope('main#contenu section.head', 'svelte-1s7sfmg');
    const av = siteScope('main#contenu .afr', 'svelte-112qgxv');
    const rk = siteScope('main#contenu .rs', 'svelte-1dk01od');
    const small = matchMedia('(max-width: 520px)').matches;
    const total = catalog?.size ?? 0;
    const value = (r) => num(def.main(r) ?? 0);
    const unit = (r) => def.unit(def.main(r) ?? 0);
    const isMe = (r) => r.id === me?.id;
    const general = (r) => `#${num(r.pos ?? 0)} au général`;
    const MEDALS = ['#F5C518', '#C9C5CE', '#D08A4E'];

    // Podium: 2nd, 1st, 3rd, like the site.
    const podium = [1, 0, 2]
      .filter((i) => rows[i])
      .map((i) => {
        const r = rows[i];
        const size = i === 0 ? (small ? 76 : 112) : small ? 60 : 84;
        const title = `<span class="pod-title ${sc}">${esc(r.title ? `${r.title} · ${general(r)}` : general(r))}</span>`;
        const badges = r.badges?.length ? `<span class="bdg ${sc}">${badgesHtml(r, 4, sc)}</span>` : '';
        return `<li class="pod p${i + 1} ${isMe(r) ? 'me' : ''} ${sc}" style="--medal:${MEDALS[i]}">
          <a class="pod-who ${sc}" href="/profil/${encodeURIComponent(r.id)}">${avatarHtml(r, size, av)} <span class="pod-name ${sc}"${r.nameColor ? ` style="color:${esc(r.nameColor)}"` : ''}>${esc(r.pseudo)}</span> ${title}</a>
          <span class="pod-rank ${sc}">${rankHtml(r.rank, 'md', 'side', rk)}</span> ${badges}
          <span class="plinth ${sc}"><span class="pos ${sc}">${i + 1}</span> <span class="pv ${sc}">${value(r)}</span> <span class="pk ${sc}">${unit(r)}</span></span>
        </li>`;
      })
      .join('');

    const list = rows
      .slice(3)
      .map((r, j) => {
        const pct = total && r.owned != null ? Math.min(100, (r.owned / total) * 100) : 0;
        return `<li class="${isMe(r) ? 'me' : ''} ${sc}">
          <span class="rank mono ${sc}">${j + 4}</span> ${avatarHtml(r, 44, av)}
          <span class="who ${sc}"><span class="line ${sc}"><a class="${sc}" href="/profil/${encodeURIComponent(r.id)}"${r.nameColor ? ` style="color:${esc(r.nameColor)}"` : ''}>${esc(r.pseudo)}</a> ${isMe(r) ? `<span class="you ${sc}">toi</span>` : ''} ${badgesHtml(r, 3, sc)}</span>
          <span class="sub ${sc}"><span class="ttl ${sc}">${esc(r.title ? `${r.title} · ${general(r)}` : general(r))}</span> <span class="bar ${sc}" title="${Math.round(pct)} % du catalogue"><i class="${sc}" style="width:${pct}%"></i></span></span></span>
          <span class="row-rank ${sc}">${rankHtml(r.rank, 'sm', 'below', rk)}</span>
          <span class="stat ${sc}"><span class="v ${sc}">${value(r)}</span> <span class="k ${sc}">${unit(r)}</span></span>
          <span class="stat side ${sc}">${esc(def.side(r))}</span>
        </li>`;
      })
      .join('');

    board.className = `kyx-friends wrap body ${sc}`;
    board.innerHTML = `
      <ol class="podium ${sc}" aria-label="Podium de tes amis">${podium}</ol>
      ${list ? `<ol class="board ${sc}" start="4">${list}</ol>` : ''}
      <p class="foot mono ${sc}">${rows.length} joueurs · tes amis et toi · « au général » = place au classement de tous les joueurs</p>`;
  }

  // ---------- "Boosters rentables" page, in the site's "Plus" menu ----------

  // A copy of the menu's own items, after them.
  function scanMoreMenu() {
    const menu = document.querySelector('#nav-more');
    const open = !!document.querySelector('.kyx-view');
    // While the page is open the site's own item of the current page is not the one shown.
    menu?.querySelectorAll(':scope > a.on:not(.kyx-more)').forEach((a) => open && a.classList.remove('on'));
    const mine = menu?.querySelector(':scope > .kyx-more');
    if (mine) return void mine.classList.toggle('on', open);
    if (!menu) return;
    const model = menu.querySelector(':scope > a');
    if (!model?.querySelector('.dk') || !model.querySelector('.dt b')) return;
    const item = model.cloneNode(true);
    item.classList.add('kyx-more');
    item.classList.toggle('on', open);
    item.removeAttribute('aria-current');
    item.href = '#boosters-rentables';
    item.querySelector('.dk').textContent = '得';
    item.querySelector('.dt b').textContent = 'Boosters rentables';
    const hint = item.querySelector('.dt small');
    if (hint) hint.textContent = 'Le meilleur booster pour une carte';
    [...item.children].forEach((el) => el.matches('.dk, .dt') || el.remove()); // the model's badges
    item.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelector('button[aria-controls="nav-more"][aria-expanded="true"]')?.click(); // close the menu
      openBoosters();
    });
    menu.appendChild(item);
  }

  // On a phone the site's menu is a sheet of tiles (#mobile-nav): the same entry goes there.
  function scanMobileNav() {
    const grid = document.querySelector('#mobile-nav .sheet-grid');
    if (!grid) return;
    const open = !!document.querySelector('.kyx-view');
    grid.querySelectorAll(':scope > a.on:not(.kyx-more)').forEach((a) => open && a.classList.remove('on'));
    let tile = grid.querySelector(':scope > .kyx-more');
    if (!tile) {
      const model = grid.querySelector(':scope > a');
      if (!model?.querySelector('.tk') || !model.querySelector('.tl')) return;
      tile = model.cloneNode(true);
      tile.classList.add('kyx-more');
      tile.removeAttribute('aria-current');
      tile.href = '#boosters-rentables';
      tile.querySelector('.tk').textContent = '得';
      tile.querySelector('.tl').textContent = 'Boosters rentables';
      [...tile.children].forEach((el) => el.matches('.tk, .tl') || el.remove()); // the model's counters
      tile.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector('button.burger[aria-controls="mobile-nav"]')?.click(); // close the sheet
        openBoosters();
      });
      grid.appendChild(tile);
    }
    tile.classList.toggle('on', open);
  }

  let packsCache = null;
  const dropCache = new Map(); // id -> { packId: chance per booster }

  // Boosters on sale right now (not the ones only given as rewards).
  async function loadPacks() {
    checkBoostersDay();
    if (packsCache) return packsCache;
    const now = Date.now();
    const list = await siteApi('/packs', { auth: false });
    packsCache = (Array.isArray(list) ? list : []).filter(
      (p) => !p.grantOnly && (!p.schedule?.start || Date.parse(p.schedule.start) <= now) && (!p.schedule?.end || now < Date.parse(p.schedule.end))
    );
    return packsCache;
  }

  async function dropChances(ids, progress) {
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        if (!dropCache.has(id)) {
          try {
            dropCache.set(id, (await siteApi(`/characters/${id}`, { auth: false }))?.dropChance ?? {});
          } catch {
            dropCache.set(id, {});
          }
        }
        progress?.(++done, ids.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    return ids.map((id) => dropCache.get(id) ?? {});
  }

  // Chance per booster, precise even when tiny: "8,5 %", "0,031 % (1 chance sur 3 298)".
  const pct = (p) => {
    if (!(p > 0)) return '0 %';
    const percent = (p * 100).toLocaleString('fr-FR', p >= 0.1 ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: 2 });
    return p >= 0.01 ? `${percent} %` : `${percent} % (1 chance sur ${num(Math.round(1 / p))})`;
  };
  const boosters = (n) => `${num(n)} booster${n >= 2 ? 's' : ''}`;

  // How the boosters are ranked: by price (fewest chakra spent on average, free boosters first)
  // or by drop rate (best chance at each booster, whatever it costs). Remembered in this browser.
  let rankBy = 'price';
  try {
    if (localStorage.getItem('kyx-rank-by') === 'drop') rankBy = 'drop';
  } catch {}

  // rows: [{ pack, hits: wanted cards per booster on average, chance: chance of at least one per booster }].
  // what: what is looked for, as in "pour avoir {what}".
  function renderPacks(page, rows, what) {
    page.kyxLast = [rows, what]; // ranked again without new requests when the criterion changes
    const list = page.querySelector('.kyx-b-list');
    const summary = page.querySelector('.kyx-b-summary');
    const byDrop = rankBy === 'drop';
    page.querySelectorAll('.kyx-b-sort [data-by]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.by === rankBy)));
    rows = rows.filter((r) => r.hits > 0).map((r) => ({ ...r, cost: r.pack.chakraPrice > 0 ? r.pack.chakraPrice / r.hits : 0 }));
    rows.sort(byDrop ? (a, b) => b.hits - a.hits || a.cost - b.cost : (a, b) => a.cost - b.cost || b.hits - a.hits);
    list.innerHTML = '';
    summary.innerHTML = '';
    if (!rows.length) {
      list.innerHTML = '<li class="kyx-b-empty">Aucun booster en vente ne contient ça en ce moment.</li>';
      return;
    }
    // How many boosters to open on average for one wanted card, said plainly.
    const needed = (r) => (r.hits >= 1 ? `≈ ${num(r.hits, 1)} par booster en moyenne` : `≈ ${boosters(Math.max(1, Math.round(1 / r.hits)))} à ouvrir en moyenne`);
    const spent = (r) => (r.cost ? `≈ ${chakra(r.cost)} en moyenne` : 'gratuit');
    const free = rows.find((r) => !r.cost);
    const paid = rows.filter((r) => r.cost);
    const cheapest = [...paid].sort((a, b) => a.cost - b.cost)[0];
    const top = rows[0];
    const last = rows.length > 1 ? rows[rows.length - 1] : null;

    // Summary: [label, row, text after the name]
    const lines = byDrop
      ? [
          ['Meilleur taux', top, ` · ${pct(Math.min(top.chance, 1))} de chance à chaque booster, ${needed(top)} pour avoir ${what} (${spent(top)}).`],
          cheapest && cheapest !== top ? ['Le moins cher', cheapest, ` · ${spent(cheapest)}, mais ${needed(cheapest)}.`] : null,
          last ? ['Pire taux', last, ` · ${num(top.hits / last.hits, 1)} fois moins de chances que le meilleur taux.`] : null
        ]
      : [
          cheapest ? ['Meilleur achat', cheapest, ` · ${needed(cheapest)} pour avoir ${what}, soit ≈ ${chakra(cheapest.cost)} au total.`] : null,
          free ? ['Gratuit', free, ` · ${needed(free)}.`] : null,
          paid.length > 1 ? ['À éviter', paid[paid.length - 1], ` · ≈ ${chakra(paid[paid.length - 1].cost)}, ${num(paid[paid.length - 1].cost / cheapest.cost, 1)} fois plus cher que le meilleur achat.`] : null
        ];
    for (const line of lines.filter(Boolean)) {
      const el = document.createElement('p');
      el.innerHTML = `<b></b> <span class="kyx-b-n"></span>${line[2]}`;
      el.querySelector('b').textContent = `${line[0]} :`;
      el.querySelector('.kyx-b-n').textContent = line[1].pack.name;
      summary.appendChild(el);
    }

    rows.forEach((r, i) => {
      const li = document.createElement('li');
      const p = r.pack;
      const price = p.chakraPrice > 0 ? `${chakra(p.chakraPrice)} le booster` : 'booster gratuit';
      const freeOk = p.usesFreePacks ? '<span class="kyx-b-tag">accepte tes boosters gratuits</span>' : '';
      const first = byDrop ? 'Meilleur taux' : 'Le plus rentable';
      const worst = byDrop ? 'Pire taux' : 'Le moins rentable';
      const label = i === 0 ? first : i === rows.length - 1 && rows.length > 2 ? worst : '';
      // The bar compares with the best of the list: drop rate against the best rate,
      // price against the cheapest paid booster (a free booster has no chakra cost to compare).
      const score = byDrop ? Math.round((r.hits / top.hits) * 100) : r.cost ? Math.round((cheapest.cost / r.cost) * 100) : null;
      const barText = byDrop
        ? score >= 100 ? 'Taux 100 % (la référence)' : `Taux ${score} % du meilleur`
        : score >= 100 ? 'Prix 100 % (la référence)' : `Rentabilité prix ${score} % du meilleur achat`;
      const right = byDrop
        ? `<b>${r.hits >= 1 ? `${num(r.hits, 1)} / booster` : `1 sur ${num(Math.round(1 / r.hits))}`}</b><small>${r.cost ? `≈ ${chakra(r.cost)} en moyenne` : 'gratuit'}</small>`
        : r.cost ? `<b>≈ ${chakra(r.cost)}</b><small>dépensés en moyenne</small>` : `<b class="kyx-b-free">Gratuit</b><small>aucun chakra</small>`;
      li.innerHTML = `
        <a href="/ouvrir/${encodeURIComponent(p.id)}">
          <span class="kyx-b-rank">${i + 1}</span>
          <span class="kyx-b-kanji"></span>
          <span class="kyx-b-main">
            <span class="kyx-b-title"><b></b><span class="kyx-b-price">${price}</span>${label ? `<span class="kyx-b-label">${label}</span>` : ''}</span>
            <span class="kyx-b-line">${needed(r)} pour avoir ${what}</span>
            <small>${pct(Math.min(r.chance, 1))} de chance à chaque booster${p.sub ? ` · <span class="kyx-b-sub"></span>` : ''}</small>
            ${freeOk}
          </span>
          <span class="kyx-b-num">${right}</span>
          ${score != null ? `<span class="kyx-b-bar"><span><i style="width:${Math.max(2, Math.min(100, score))}%"></i></span><small>${barText}</small></span>` : ''}
        </a>`;
      li.querySelector('.kyx-b-kanji').textContent = p.kanji ?? '';
      li.querySelector('.kyx-b-kanji').style.color = p.color ?? '';
      li.querySelector('.kyx-b-title b').textContent = p.name;
      const sub = li.querySelector('.kyx-b-sub');
      if (sub) sub.textContent = p.sub;
      li.querySelector('a').addEventListener('click', closeBoosters);
      list.appendChild(li);
    });
  }

  // A page of its own: it takes the place of the site's content (header and menu stay) at …#boosters-rentables,
  // so the back button and a reload work; following any link of the site leaves it.
  const BOOSTERS_HASH = '#boosters-rentables';

  function closeBoosters() {
    document.querySelector('.kyx-view')?.remove();
    const main = document.querySelector('main#contenu');
    if (main?.dataset.kyxHidden) delete main.dataset.kyxHidden;
    delete document.documentElement.dataset.kyxView;
    refreshBoosters = null;
  }

  // The "Pack du jour" changes at midnight, French time: rankings are computed again then.
  const parisDay = () => new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
  let boostersDay = parisDay();
  let refreshBoosters = null; // computes the ranking on screen again

  function checkBoostersDay() {
    const day = parisDay();
    if (day === boostersDay) return;
    boostersDay = day;
    packsCache = null;
    dropCache.clear();
    refreshBoosters?.();
  }

  function onBoostersHash() {
    if (location.hash === BOOSTERS_HASH) openBoosters();
    else closeBoosters();
  }

  function openBoosters() {
    if (!alive()) return shutdown();
    if (location.hash !== BOOSTERS_HASH) return void (location.hash = BOOSTERS_HASH); // comes back through hashchange
    const main = document.querySelector('main#contenu');
    if (!main || document.querySelector('.kyx-view')) return;
    document.querySelector('.kyx-modal-back')?.remove();
    const page = document.createElement('section');
    page.className = 'kyx-view kyx-page wrap';
    page.setAttribute('aria-labelledby', 'kyx-view-t');
    page.innerHTML = `
        <header class="kyx-page-head">
          <div><small>Boosters rentables · 得</small><h1 id="kyx-view-t">Quel booster ouvrir ?</h1>
          <p>Les boosters en vente classés du plus rentable au moins rentable pour obtenir ce que tu cherches.</p></div>
          <button type="button" class="kyx-page-close">← Retour</button>
        </header>
        <div class="kyx-seg" role="group">
          <button type="button" data-mode="rar" aria-pressed="false">Une rareté</button>
          <button type="button" data-mode="char" aria-pressed="false">Un personnage</button>
          <button type="button" data-mode="series" aria-pressed="false">Un univers</button>
        </div>
        <div class="kyx-page-query"></div>
        <p class="kyx-page-note" role="status"></p>
        <div class="kyx-b-sort" role="group" aria-label="Classer les boosters">
          <span>Classer par</span>
          <button type="button" data-by="price" aria-pressed="false"><b>Prix</b><small>le moins de chakra dépensé</small></button>
          <button type="button" data-by="drop" aria-pressed="false"><b>Taux de drop</b><small>la meilleure chance par booster</small></button>
        </div>
        <div class="kyx-b-summary"></div>
        <ol class="kyx-b-list"></ol>
        <p class="kyx-page-foot">Comment c’est calculé : avec les taux publiés par le site, on compte combien de boosters il faut ouvrir en moyenne pour tomber une fois sur ce que tu cherches, puis combien de chakra ça représente (nombre de boosters × prix du booster). Classé par <b>prix</b>, la barre compare au meilleur achat : 50 % veut dire deux fois plus cher pour le même résultat. Classé par <b>taux de drop</b>, elle compare au meilleur taux : 50 % veut dire deux fois moins de chances à chaque booster, quel que soit son prix. Ce sont des moyennes, la chance peut faire mieux ou pire. Cliquer sur un booster ouvre sa page, rien n’est acheté.</p>`;
    main.dataset.kyxHidden = '1';
    main.after(page);
    document.documentElement.dataset.kyxView = 'boosters'; // "Plus" underlined in the site's header
    window.scrollTo(0, 0);
    const query = page.querySelector('.kyx-page-query');
    const note = (text) => (page.querySelector('.kyx-page-note').textContent = text);
    page.querySelector('.kyx-page-close').addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '')));
    let run = 0; // answers of an older search are dropped

    async function forCharacter(card) {
      const mine = ++run;
      refreshBoosters = () => forCharacter(card);
      query.querySelector('input').value = card.n;
      query.querySelector('.kyx-b-suggest').innerHTML = '';
      note('Calcul…');
      const [packs, [drops], listing] = await Promise.all([
        loadPacks(),
        dropChances([card.id]),
        siteApi(`/market/listings?characterId=${card.id}&type=fixed&sort=price_asc&pageSize=1`, { auth: false }).catch(() => null)
      ]);
      if (mine !== run) return;
      const owned = qty(card.id);
      const market = listing?.items?.[0]?.price;
      note(
        [`${card.n} · ${card.s} · ${RARITY_LABEL[card.r] ?? card.r}`, owned ? `tu l’as déjà ×${owned}` : null, market != null ? `au marché dès ${chakra(market)}` : null]
          .filter(Boolean)
          .join(' · ')
      );
      renderPacks(
        page,
        packs.map((pack) => {
          const hits = Number(drops[pack.id]) || 0;
          return { pack, hits, chance: hits };
        }),
        card.n
      );
    }

    async function forRarity(r) {
      const mine = ++run;
      refreshBoosters = () => forRarity(r);
      query.querySelectorAll('[data-r]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.r === r)));
      note('Calcul…');
      const packs = await loadPacks();
      if (mine !== run) return;
      note(`Pour n’importe quelle carte ${RARITY_LABEL[r]} (même une que tu as déjà).`);
      renderPacks(
        page,
        packs.map((pack) => {
          const per = pack.rates?.perBooster?.[r];
          return { pack, hits: Number(per?.expected) || 0, chance: (Number(per?.atLeastOnePct) || 0) / 100 };
        }),
        `une ${RARITY_LABEL[r]}`
      );
    }

    async function forSeries(name, onlyMissing) {
      const mine = ++run;
      refreshBoosters = () => forSeries(name, onlyMissing);
      const cards = [...(catalog?.values() ?? [])].filter((c) => norm(c.s) === norm(name));
      const wanted = onlyMissing ? cards.filter((c) => qty(c.id) === 0) : cards;
      if (!cards.length) return note('Univers inconnu.');
      if (!wanted.length) {
        page.querySelector('.kyx-b-list').innerHTML = '';
        page.querySelector('.kyx-b-summary').innerHTML = '';
        return note(`Tu as déjà toutes les cartes de ${name} ✔`);
      }
      const ids = wanted.slice(0, 150).map((c) => c.id);
      const [packs, drops] = await Promise.all([loadPacks(), dropChances(ids, (n, t) => mine === run && note(`Calcul… ${n}/${t} persos`))]);
      if (mine !== run) return;
      note(`${name} : ${wanted.length} carte${wanted.length > 1 ? 's' : ''} ${onlyMissing ? 'qui te manquent' : 'au total'}${wanted.length > ids.length ? ` (les ${ids.length} premières comptées)` : ''}.`);
      renderPacks(
        page,
        packs.map((pack) => {
          const hits = drops.reduce((sum, d) => sum + (Number(d[pack.id]) || 0), 0);
          const chance = 1 - drops.reduce((none, d) => none * (1 - (Number(d[pack.id]) || 0)), 1);
          return { pack, hits, chance };
        }),
        `une carte ${onlyMissing ? 'qui te manque ' : ''}de ${name}`
      );
    }

    // A search field like the one of the Collection page; its suggestions open below it, as wide as the field.
    // items(q) -> [{ img?, title, sub, pick }]
    function searchField(placeholder, items) {
      query.insertAdjacentHTML(
        'afterbegin',
        `<div class="kyx-search-wrap">
          <label class="kyx-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>
            <input type="search" autocomplete="off" spellcheck="false" />
          </label>
          <ul class="kyx-b-suggest" hidden></ul>
        </div>`
      );
      const input = query.querySelector('.kyx-search input');
      const suggest = query.querySelector('.kyx-b-suggest');
      input.placeholder = placeholder;
      input.setAttribute('aria-label', placeholder);
      const show = () => {
        const q = norm(input.value);
        suggest.innerHTML = '';
        const found = q.length >= 2 && catalog ? items(q) : [];
        suggest.hidden = !found.length;
        for (const it of found) {
          const li = document.createElement('li');
          li.innerHTML = '<button type="button"><span><b></b><small></small></span></button>';
          if (it.img) {
            const img = Object.assign(document.createElement('img'), { alt: '', referrerPolicy: 'no-referrer', src: it.img });
            li.querySelector('button').prepend(img);
          }
          li.querySelector('b').textContent = it.title;
          li.querySelector('small').textContent = it.sub;
          li.querySelector('button').addEventListener('click', () => {
            input.value = it.title;
            suggest.hidden = true;
            it.pick();
          });
          suggest.appendChild(li);
        }
      };
      input.addEventListener('input', show);
      input.addEventListener('focus', show);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') suggest.querySelector('button')?.click();
        if (e.key === 'Escape') suggest.hidden = true;
      });
      // Closes when clicking elsewhere on the page.
      page.addEventListener('click', (e) => e.target.closest('.kyx-search-wrap') || (suggest.hidden = true));
      input.focus();
      if (!catalog) note('Catalogue pas encore chargé, réessaie dans un instant.');
      return input;
    }

    function mode(m) {
      run++;
      refreshBoosters = null;
      page.querySelectorAll('.kyx-seg [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
      page.querySelector('.kyx-b-list').innerHTML = '';
      page.querySelector('.kyx-b-summary').innerHTML = '';
      page.kyxLast = null;
      query.innerHTML = '';
      note('');
      if (m === 'char') {
        searchField('Rechercher un perso ou un univers…', (q) =>
          [...catalog.values()]
            .filter((c) => norm(c.n).includes(q) || norm(c.s).includes(q))
            .slice(0, 10)
            .map((c) => ({
              img: `/cards/sm/${c.id}.webp`,
              title: c.n,
              sub: `${c.s} · ${RARITY_LABEL[c.r] ?? c.r}${qty(c.id) ? ` · tu l’as ×${qty(c.id)}` : ' · te manque'}`,
              pick: () => forCharacter(c)
            }))
        );
      } else if (m === 'rar') {
        query.innerHTML = `<div class="kyx-b-rar">${['C', 'U', 'R', 'E', 'L', 'M'].map((r) => `<button type="button" data-r="${r}" aria-pressed="false">${RARITY_LABEL[r]}</button>`).join('')}</div>`;
        query.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => forRarity(b.dataset.r)));
      } else {
        const index = seriesIndex();
        const names = [...new Set([...(catalog?.values() ?? [])].map((c) => c.s))].sort((a, b) => a.localeCompare(b, 'fr'));
        query.innerHTML = '<label class="kyx-b-check"><input type="checkbox" checked /> Seulement les cartes qui me manquent</label>';
        const missing = query.querySelector('input[type="checkbox"]');
        let picked = null;
        searchField('Rechercher un univers…', (q) =>
          names
            .filter((n) => norm(n).includes(q))
            .slice(0, 10)
            .map((n) => {
              const s = index?.get(norm(n));
              return {
                title: n,
                sub: s ? `${s.owned}/${s.total} cartes${s.owned >= s.total ? ' · complet ✔' : ` · ${s.total - s.owned} te manquent`}` : '',
                pick: () => forSeries((picked = n), missing.checked)
              };
            })
        );
        missing.addEventListener('change', () => picked && forSeries(picked, missing.checked));
      }
    }
    page.querySelectorAll('.kyx-seg [data-mode]').forEach((b) => b.addEventListener('click', () => mode(b.dataset.mode)));
    page.querySelectorAll('.kyx-b-sort [data-by]').forEach((b) =>
      b.addEventListener('click', () => {
        rankBy = b.dataset.by;
        try {
          localStorage.setItem('kyx-rank-by', rankBy);
        } catch {}
        if (page.kyxLast) renderPacks(page, ...page.kyxLast);
        else page.querySelectorAll('.kyx-b-sort [data-by]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      })
    );
    page.querySelectorAll('.kyx-b-sort [data-by]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.by === rankBy)));
    mode('rar');
    forRarity('M'); // a ranking right away
  }

  // ---------- series and price under each card of the trade confirmation ----------

  // "Confirmer l'échange" only shows name and rarity: add the series (cut short, full name on hover),
  // the site's fair price of each card and the gap between both sides.
  const prices = new Map(); // id -> fair price in chakra, null when unknown
  const pricing = new Set();
  const chakra = (n) => `${Math.round(n).toLocaleString('fr-FR')} ◆`;

  function loadPrices(ids) {
    const wanted = ids.filter((id) => !prices.has(id) && !pricing.has(id));
    if (!wanted.length) return;
    wanted.forEach((id) => pricing.add(id));
    for (let i = 0; i < wanted.length; i += 200) {
      const batch = wanted.slice(i, i + 200); // the background asks for 200 at most
      send({ type: 'prices', ids: batch }).then((res) => {
        for (const id of batch) {
          pricing.delete(id);
          const v = Number(res?.[id]);
          prices.set(id, res && !res.error && Number.isFinite(v) ? v : null);
        }
        scanConfirm();
        scanMissing();
      });
    }
  }

  function line(side, cls, text, title) {
    let el = side.querySelector(`:scope > .${cls}`);
    if (text == null) return void el?.remove();
    if (!el) {
      el = document.createElement('span');
      el.className = `${cls} mut small`;
      side.appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
    if (title && el.title !== title) el.title = title;
  }

  function scanConfirm() {
    const sides = [...document.querySelectorAll('[role="dialog"] .cf-s')];
    if (!sides.length) return;
    const ids = [];
    let give = 0;
    let get = 0;
    let known = true;
    for (const side of sides) {
      const m = CARD_SRC.exec(side.querySelector('img')?.getAttribute('src') || '');
      const id = m ? Number(m[1]) : null;
      if (id) ids.push(id);
      const series = id ? catalog?.get(id)?.s : null;
      line(side, 'kyx-series', series, series);
      const price = id ? prices.get(id) : null;
      line(side, 'kyx-price', price != null ? chakra(price) : null);
      if (price == null) known = false;
      else if (/donnes/i.test(side.querySelector('.sk')?.textContent ?? '')) give += price;
      else get += price;
    }
    loadPrices(ids);
    balance(sides[0].parentElement, known && sides.length > 1 ? { give, get } : null);
  }

  // Same rule as the site: balanced while one side is worth at most twice the other (or the gap is under 100).
  function balance(host, sum) {
    let el = host?.parentElement?.querySelector(':scope > .kyx-balance');
    if (!sum) return void el?.remove();
    if (!el) {
      el = document.createElement('p');
      el.className = 'kyx-balance';
      host.after(el);
    }
    const gap = sum.get - sum.give;
    const hi = Math.max(sum.give, sum.get);
    const lo = Math.min(sum.give, sum.get);
    const fair = hi - lo < 100 || hi <= 2 * lo;
    const kind = fair ? 'fair' : gap > 0 ? 'win' : 'loss';
    const text =
      gap === 0
        ? 'Même valeur des deux côtés · échange équilibré'
        : `${gap > 0 ? '+' : '−'}${chakra(Math.abs(gap))} ${gap > 0 ? 'en ta faveur' : 'en sa faveur'} · ${fair ? 'échange équilibré' : 'déséquilibré'}`;
    if (el.textContent !== text) el.textContent = text;
    el.dataset.kind = kind;
  }

  // ---------- "Manquantes" chip on the Collection page ----------

  // The site's card filter (all / owned / missing / dupes…) sits in a select: this chip, next to the rarity chips, drives it.
  // "Possédées" and "Manquantes", in this order right after the site's "Toutes" chip.
  const CARD_CHIPS = [
    { value: 'owned', label: 'Possédées', cls: 'kyx-owned' },
    { value: 'missing', label: 'Manquantes', cls: 'kyx-missing' }
  ];

  function scanCollectionChips() {
    if (location.pathname !== '/collection') return;
    for (const select of document.querySelectorAll('select')) {
      if (!select.querySelector('option[value="missing"]')) continue;
      const chips = select.closest('.row2')?.querySelector('.chips');
      const first = chips?.querySelector(':scope > button:not(.kyx-chip)');
      if (!first) continue;
      let after = first;
      for (const chip of CARD_CHIPS) {
        if (!select.querySelector(`option[value="${chip.value}"]`)) continue;
        let btn = chips.querySelector(`:scope > .${chip.cls}`);
        if (!btn) {
          // A copy of the site's "Toutes" chip (same dot and style); clicking it again shows every card.
          btn = first.cloneNode(true);
          btn.classList.remove('on');
          btn.classList.add('kyx-chip', chip.cls);
          btn.lastChild.textContent = ` ${chip.label}`;
          btn.addEventListener('click', () => {
            select.value = select.value === chip.value ? 'all' : chip.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            scanCollectionChips();
          });
          after.after(btn);
        }
        after = btn;
        const on = select.value === chip.value;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', String(on));
      }
      if (!select.dataset.kyxWatched) {
        select.dataset.kyxWatched = '1';
        select.addEventListener('change', () => scanCollectionChips());
      }
    }
  }

  // ---------- "Ses doublons" filter in the trade composer ----------

  // The site only offers "Je l'ai" / "Il me manque" on the partner's tab: this chip keeps the cards they hold twice or more.
  // On by default in every trade composer (profile, market offer, comptoir); turning it off is remembered.
  let composerMore = 0;

  // Their spare copies when they share their collection, else the copies the trade API lets us ask for (the last one included).
  let dupeIndex = { of: null, spare: null, tradeable: null };
  function theirDupe(id) {
    if (dupeIndex.of !== partner) {
      dupeIndex = { of: partner, spare: partner?.spare && new Map(partner.spare), tradeable: partner?.tradeable && new Map(partner.tradeable) };
    }
    if (dupeIndex.spare) return (dupeIndex.spare.get(id) ?? 0) > 0;
    const n = dupeIndex.tradeable?.get(id);
    return n == null ? null : n >= 2;
  }

  function scanComposer() {
    // The trade composer is a form; the market's "Proposer une carte" dialog has the same shelf but is not.
    const shelf = document.querySelector('[role="dialog"] form .shelf');
    const chips = shelf?.querySelector('.filters .chips');
    if (!chips) {
      composerMore = 0;
      return;
    }
    const tabs = shelf.querySelectorAll('.tabs [role="tab"]');
    const theirs = tabs[1]?.getAttribute('aria-selected') === 'true';
    const active = theirs && settings.theirDupes;
    let btn = chips.querySelector(':scope > .kyx-only');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      // The site's own chip classes, so it looks like its neighbours.
      const scope = [...(chips.querySelector('.only')?.classList ?? [])].find((c) => c.startsWith('svelte-')) ?? 'svelte-adlc8v';
      btn.className = `kyx-only only ${scope}`;
      btn.textContent = 'Ses doublons';
      btn.addEventListener('click', () => {
        if (!alive()) return shutdown();
        composerMore = 0;
        settings = { ...settings, theirDupes: !settings.theirDupes };
        scanComposer();
        chrome.storage.local.get('settings').then(({ settings: s }) =>
          chrome.storage.local.set({ settings: { ...s, theirDupes: settings.theirDupes } })
        );
      });
      // Right after the site's own chips, before "Toutes" and the rarity letters.
      const all = [...chips.children].find((el) => el.tagName === 'BUTTON' && !el.classList.contains('only'));
      chips.insertBefore(btn, all ?? null);
    }
    if (theirs) delete btn.dataset.kyxHidden;
    else btn.dataset.kyxHidden = '1';
    btn.classList.toggle('on', active);
    btn.setAttribute('aria-pressed', String(active));

    const grid = shelf.querySelector('ul.grid');
    if (!grid) return;
    let visible = 0;
    for (const li of grid.children) {
      const m = CARD_SRC.exec(li.querySelector('img')?.getAttribute('src') || '');
      const hide = active && !!m && theirDupe(Number(m[1])) === false;
      if (hide) {
        if (li.dataset.kyxHidden !== '1') li.dataset.kyxHidden = '1';
      } else {
        visible++;
        if (li.dataset.kyxHidden) delete li.dataset.kyxHidden;
      }
    }
    // Hidden tiles still use up the site's page of 60: load more until a full page of duplicates shows.
    const more = grid.parentElement?.querySelector(':scope > button.more');
    if (active && visible < PAGE && more && composerMore < 40) {
      composerMore++;
      more.click();
    } else if (!more || visible >= PAGE) {
      composerMore = 0;
    }
  }

  // ---------- refresh loop ----------

  let queued = new Set();
  let frame = 0;
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') queued.add(r.target);
      else r.addedNodes.forEach((n) => n.nodeType === 1 && queued.add(n));
    }
    if (!frame) frame = requestAnimationFrame(flush);
  });

  function flush() {
    if (stopped) return;
    frame = 0;
    const nodes = queued;
    queued = new Set();
    for (const n of nodes) if (n.isConnected) scanBadges(n);
    scanAlbums();
    scanComposer();
    scanCollectionChips();
    scanMissing();
    scanAlbumBar();
    scanMissions();
    scanMoreMenu();
    scanLadder();
    scanMobileNav();
    scanFavStars();
    scanMarket();
    scanConfirm();
  }

  function refreshAll() {
    if (stopped) return;
    scanBadges(document);
    scanAlbums();
    scanComposer();
    scanCollectionChips();
    scanMissing();
    scanAlbumBar();
    scanMissions();
    scanMoreMenu();
    scanLadder();
    scanMobileNav();
    scanFavStars();
    scanMarket();
    scanConfirm();
  }

  let stopped = false;
  function shutdown() {
    if (stopped) return;
    stopped = true;
    if (document.documentElement.dataset.kyxOwner === owner) delete document.documentElement.dataset.kyxOwner;
    clearInterval(ticker);
    observer.disconnect();
    document.querySelectorAll('.kyx-badge, .kyx-toggle, .kyx-only, .kyx-chip, .kyx-series, .kyx-price, .kyx-balance, .kyx-ghost, .kyx-ghost-name, .kyx-order, .kyx-modal-back, .kyx-smart, .kyx-smart-msg, .kyx-count, .kyx-more, .kyx-view, .kyx-friends, .kyx-friends-tab, .kyx-fav, .kyx-favmarket').forEach((el) => el.remove());
    delete document.documentElement.dataset.kyxView;
    document.querySelectorAll('[data-kyx-hidden], [data-kyx-pos], [data-kyx-watched], [data-kyx-ghost]').forEach((el) => {
      delete el.dataset.kyxHidden;
      delete el.dataset.kyxPos;
      delete el.dataset.kyxWatched;
      delete el.dataset.kyxGhost;
    });
  }

  let lastPath = location.pathname;
  const ticker = setInterval(() => {
    if (!alive()) return shutdown();
    syncAuth();
    if (location.hash !== BOOSTERS_HASH && document.querySelector('.kyx-view')) closeBoosters(); // left through a link of the site
    checkBoostersDay();
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      autoMore = 0;
      scanBadges(document); // badge rules depend on the page
    }
  }, 1000);

  (async () => {
    const stored = await chrome.storage.local.get(['settings', 'collection', 'catalog', 'partner', 'smartLock', 'favSeries', 'marketFav']);
    applyStorage(stored);
    smartLock = new Set(stored.smartLock ?? []);
    favSeries = new Set(stored.favSeries ?? []);
    marketFav = !!stored.marketFav;
    if (partner && Date.now() - (partner.at ?? 0) > 30 * 60e3) partner = null;
    document.querySelectorAll('#kyx-root').forEach((el) => el.remove()); // left by older versions
    window.addEventListener('hashchange', onBoostersHash);
    syncAuth();
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    refreshAll();
    if (location.hash === BOOSTERS_HASH) {
      if (!catalog) await chrome.storage.local.get('catalog').then(applyStorage);
      openBoosters();
    }
    if (!catalog || !coll) send({ type: 'ensure-data' });
  })();
})();

  // ---------- 6. src/userscript/panel.js : panneau de réglages ----------
  if (document.documentElement.dataset.kyxOwner === KYX_OWNER) {
// Userscript version: there is no popup, so the settings open from the site's own menu
// ("Plus" on a computer, the menu sheet on a phone).
(() => {
  const OPTIONS = [
    ['hideComplete', 'Masquer les séries complètes'],
    ['hideSmall', 'Masquer les séries de moins de 5 persos'],
    ['badgeMissing', 'Badge « Manquante » sur les cartes (hors marché, sauf pendant un échange)'],
    ['badgeDupes', 'Badge « ×N » sur mes doublons et « Unique » sur mes cartes en un seul exemplaire'],
    ['theirDupes', 'Filtre « Ses doublons » activé d’office dans les propositions d’échange'],
    ['lockLastListed', 'Verrouiller le dernier exemplaire d’une carte dont un doublon est en vente'],
    ['cardToWiki', 'Page Collection : un clic sur une carte que j’ai ouvre sa fiche'],
    ['notifyUpdated', 'Bandeau « nouvelle version installée » après une mise à jour du script']
  ];

  async function openSettings() {
    document.querySelector('.kyx-modal-back')?.remove();
    const settings = await getSettings();
    const back = document.createElement('div');
    back.className = 'kyx-modal-back';
    back.innerHTML = `
      <section class="kyx-modal kyx-settings" role="dialog" aria-modal="true" aria-label="Réglages de Kyara Games">
        <div class="kyx-modal-head"><div><small>Script Kyara Games · ${KYX_VERSION}</small><b class="kyx-modal-name">Réglages</b></div></div>
        <div class="kyx-settings-list"></div>
        <p class="kyx-settings-note">Les mises à jour du script s’installent toutes seules par ton gestionnaire de scripts. Les notifications ne sont disponibles qu’avec l’extension.</p>
        <div class="kyx-order-btns"><button type="button" class="kyx-settings-close">Fermer</button></div>
      </section>`;
    const list = back.querySelector('.kyx-settings-list');
    for (const [key, text] of OPTIONS) {
      const label = document.createElement('label');
      label.innerHTML = '<input type="checkbox" /> <span></span>';
      label.querySelector('span').textContent = text;
      const box = label.querySelector('input');
      box.checked = !!settings[key];
      box.addEventListener('change', () => setSettings({ [key]: box.checked }));
      list.appendChild(label);
    }
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => e.target === back && close());
    back.querySelector('.kyx-settings-close').addEventListener('click', close);
    document.body.appendChild(back);
  }

  // A copy of one of the menu's own items, at its end. closer: the button that closes that menu.
  function addEntry(menu, closer) {
    if (!menu || menu.querySelector(':scope > .kyx-settings-entry')) return;
    const model = menu.querySelector(':scope > a:not(.kyx-more)');
    const kanji = model?.querySelector('.dk, .tk');
    const title = model?.querySelector('.dt b, .tl');
    if (!kanji || !title) return;
    const entry = model.cloneNode(true);
    entry.classList.remove('on');
    entry.classList.add('kyx-settings-entry');
    entry.removeAttribute('aria-current');
    entry.href = '#';
    entry.querySelector('.dk, .tk').textContent = '設';
    entry.querySelector('.dt b, .tl').textContent = 'Kyara Games';
    const hint = entry.querySelector('.dt small');
    if (hint) hint.textContent = 'Réglages du script';
    [...entry.children].forEach((el) => el.matches('.dk, .dt, .tk, .tl') || el.remove());
    entry.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelector(closer)?.click();
      openSettings();
    });
    menu.appendChild(entry);
  }

  // Tampermonkey and Userscripts install new versions silently: say it once, at the first visit after an update.
  // Nothing at the very first install.
  async function announceUpdate() {
    const { lastVersion } = await chrome.storage.local.get('lastVersion');
    if (lastVersion === KYX_VERSION) return;
    await chrome.storage.local.set({ lastVersion: KYX_VERSION });
    if (!lastVersion || !(await getSettings()).notifyUpdated) return;
    const bar = document.createElement('div');
    bar.className = 'kyx-update-toast';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>⬆ Kyara Games est passé en <b>${KYX_VERSION}</b></span>
      <a href="https://github.com/${REPO}/releases/tag/v${KYX_VERSION}" target="_blank" rel="noopener">Voir les nouveautés</a>
      <button type="button" aria-label="Fermer">✕</button>`;
    const close = () => bar.remove();
    bar.querySelector('a').addEventListener('click', close);
    bar.querySelector('button').addEventListener('click', close);
    document.body.appendChild(bar);
  }

  // Tampermonkey checks for new versions on its own schedule (once a day by default): the script also asks GitHub
  // every 15 minutes while kyara.games is open, once for all the open tabs, and offers the update.
  const UPDATE_EVERY = 15 * 60e3;
  async function lookForUpdate(maxAge = UPDATE_EVERY) {
    const { updateCheckedAt } = await chrome.storage.local.get('updateCheckedAt');
    if (Date.now() - (updateCheckedAt ?? 0) >= maxAge) {
      await chrome.storage.local.set({ updateCheckedAt: Date.now() });
      await checkUpdate().catch(() => null);
    }
    offerUpdate();
  }

  async function offerUpdate() {
    const { update, updateLater } = await chrome.storage.local.get(['update', 'updateLater']);
    const shown = document.querySelector('.kyx-update-toast.offer');
    if (!update?.version || !newer(update.version, KYX_VERSION)) return void shown?.remove();
    if (updateLater?.version === update.version && Date.now() < updateLater.until) return void shown?.remove();
    if (shown?.dataset.version === update.version) return;
    shown?.remove();
    const bar = document.createElement('div');
    bar.className = 'kyx-update-toast offer';
    bar.dataset.version = update.version;
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>⬆ Kyara Games <b></b> est disponible</span>
      <a class="kyx-update-go" target="_blank" rel="noopener">Mettre à jour</a>
      <a class="kyx-update-notes" target="_blank" rel="noopener">Nouveautés</a>
      <button type="button" aria-label="Plus tard" title="Plus tard">✕</button>`;
    bar.querySelector('b').textContent = update.version;
    // The script of the latest release (never an in-between one): Tampermonkey (or Userscripts) recognises it and offers to update.
    bar.querySelector('.kyx-update-go').href = `https://github.com/${REPO}/releases/latest/download/kyara-games.user.js`;
    bar.querySelector('.kyx-update-notes').href = `https://github.com/${REPO}/releases/latest`;
    bar.querySelector('.kyx-update-go').addEventListener('click', () => {
      bar.querySelector('span').textContent = 'Confirme la mise à jour dans Tampermonkey, puis recharge cette page.';
      bar.querySelector('.kyx-update-go').remove();
    });
    // Later: asked again in 12 hours.
    bar.querySelector('button').addEventListener('click', () => {
      bar.remove();
      chrome.storage.local.set({ updateLater: { version: update.version, until: Date.now() + 12 * 3600e3 } });
    });
    document.querySelector('.kyx-update-toast:not(.offer)')?.remove();
    document.body.appendChild(bar);
  }

  const scan = () => {
    addEntry(document.querySelector('#nav-more'), 'button[aria-controls="nav-more"][aria-expanded="true"]');
    addEntry(document.querySelector('#mobile-nav .sheet-grid'), 'button.burger[aria-controls="mobile-nav"]');
  };
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
  announceUpdate();
  lookForUpdate();
  setInterval(() => lookForUpdate(), 60e3);
  chrome.storage.onChanged.addListener((changes) => ('update' in changes || 'updateLater' in changes) && offerUpdate());
})();

  }
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
})();
