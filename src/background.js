import { ORIGIN, REPO, api, checkUpdate, getSettings, loadCatalog, loadCollection, slimCollection, slimMe } from './lib/kyara.js';

const ALARM = 'kyara-poll';
const UPDATE_ALARM = 'kyara-update';
const FIREFOX = navigator.userAgent.includes('Firefox');
const ICON = chrome.runtime.getURL('icons/icon128.png');
const MAX_SEEN = 400;

// Notification types sent by the Kyara API, grouped into the categories shown in the settings.
const CATEGORY = {
  trade_offer: 'notifyTrades',
  trade_accepted: 'notifyTrades',
  trade_declined: 'notifyTrades',
  trade_cancelled: 'notifyTrades',
  trade_message: 'notifyTrades',
  offer_accepted: 'notifyTrades',
  sold: 'notifyMarket',
  bought: 'notifyMarket',
  won: 'notifyMarket',
  outbid: 'notifyMarket',
  expired: 'notifyMarket',
  order_filled: 'notifyMarket',
  listing_cancelled: 'notifyMarket',
  wish_listed: 'notifyWish',
  friend_request: 'notifyFriends',
  friend_accepted: 'notifyFriends',
  collection_shared: 'notifyFriends'
};

async function schedule() {
  const { pollMinutes } = await getSettings();
  await chrome.alarms.create(ALARM, { periodInMinutes: Math.max(1, Number(pollMinutes) || 1) });
  if ((await chrome.alarms.get(UPDATE_ALARM))?.periodInMinutes !== 15) await chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 15 });
}

// A new release on GitHub: one notification per version, and a banner in the popup until it is installed.
async function lookForUpdate() {
  if (FIREFOX) return; // in Firefox the extension is only tried out (about:debugging): Firefox users run the userscript
  // The popup asks too each time it opens: GitHub is asked at most every 10 minutes.
  const { updateCheckedAt } = await chrome.storage.local.get('updateCheckedAt');
  if (Date.now() - (updateCheckedAt ?? 0) < 10 * 60e3) return;
  await chrome.storage.local.set({ updateCheckedAt: Date.now() });
  try {
    const update = await checkUpdate();
    if (!update) return;
    const { updateNotified } = await chrome.storage.local.get('updateNotified');
    if (updateNotified === update.version) return;
    await chrome.storage.local.set({ updateNotified: update.version });
    notify('update', {
      title: `Kyara Games ${update.version} est disponible`,
      message: 'Ouvre la popup Kyara Games et clique sur « Mettre à jour ».',
      href: update.url
    });
  } catch {}
}

// A browser never lets an extension rewrite itself: the small updater installed on the computer
// (installer-mises-a-jour.bat) replaces the files, then the extension reloads on its new version.
const UPDATER = 'com.kyara_games.updater';

async function installUpdate() {
  const update = (await chrome.storage.local.get('update')).update ?? (await checkUpdate().catch(() => null));
  if (!update) return { error: 'no_update' };
  let res;
  try {
    res = await chrome.runtime.sendNativeMessage(UPDATER, { action: 'update', version: update.version, url: FIREFOX ? update.xpi : update.zip });
  } catch {
    return { error: 'no_updater', update };
  }
  if (!res?.ok) return { error: res?.error ?? 'failed', detail: res?.detail, update };
  setTimeout(() => chrome.runtime.reload(), 800);
  return { ok: true, version: res.version };
}

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  await chrome.storage.local.remove(['update', 'updateCheckedAt']); // just installed or updated: the banner is stale
  await schedule();
  if (reason === 'update') await refreshSite();
  loadCatalog(reason === 'update').catch(() => {});
  lookForUpdate();
  if (reason === 'update') announceUpdate(previousVersion);
});

// Says that a new version was installed, with a link to what changed.
// Reloading the same version (an unpacked folder) says nothing.
async function announceUpdate(previousVersion) {
  const version = chrome.runtime.getManifest().version;
  if (!previousVersion || previousVersion === version) return;
  if (!(await getSettings()).notifyUpdated) return;
  notify('updated', {
    title: `Kyara Games est passé en ${version}`,
    message: 'Clique pour voir les nouveautés de cette version.',
    href: `https://github.com/${REPO}/releases/tag/v${version}`
  });
}

// After an update: the site's caches are emptied and its open tabs reloaded, so pages and the new extension start fresh.
// Only the caches go (HTTP cache and the cache of the site's service worker): session, cookies and the service worker
// itself (the site's push notifications) stay. Firefox can't empty the cache of a single site: the tabs skip it instead.
async function refreshSite() {
  try {
    await chrome.browsingData?.remove({ origins: [ORIGIN] }, { cache: true, cacheStorage: true });
  } catch {}
  const tabs = await chrome.tabs.query({ url: `${ORIGIN}/*` }).catch(() => []);
  for (const tab of tabs) chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => {});
}
chrome.runtime.onStartup.addListener(() => {
  schedule();
  lookForUpdate();
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) poll();
  if (a.name === UPDATE_ALARM) lookForUpdate();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings && changes.settings.oldValue?.pollMinutes !== changes.settings.newValue?.pollMinutes) schedule();
  if (changes.me) updateBadge(changes.me.newValue);
  if (changes.authValid && changes.authValid.newValue === false) updateBadge(null, true);
});

let polling = null;
function poll() {
  return (polling ??= run().finally(() => (polling = null)));
}

async function run() {
  const { auth } = await chrome.storage.local.get('auth');
  if (!auth?.token) return updateBadge(null, true);
  const settings = await getSettings();
  try {
    const me = slimMe(await api('/me'));
    if (me) {
      await chrome.storage.local.set({ me });
      await checkBoosters(me, settings);
    }
    const notifs = await api('/me/notifications?limit=30');
    await checkNotifications(notifs?.items ?? (Array.isArray(notifs) ? notifs : []), settings);
  } catch (e) {
    if (e.status === 401) updateBadge(null, true);
  }
}

async function checkBoosters(me, settings) {
  const max = me.freePacksMax ?? 10;
  const full = me.freePacks >= max;
  const { boosterFull } = await chrome.storage.local.get('boosterFull');
  if (full && !boosterFull && settings.notifyBoosters) {
    notify('boosters', {
      title: 'Boosters pleins !',
      message: `${me.freePacks}/${max} boosters gratuits t’attendent sur Kyara. Ouvre-les avant qu’ils ne se perdent.`,
      href: '/'
    });
  }
  await chrome.storage.local.set({ boosterFull: full });
}

async function checkNotifications(items, settings) {
  const { seenNotifs, notifsReady } = await chrome.storage.local.get(['seenNotifs', 'notifsReady']);
  const seen = new Set(seenNotifs ?? []);
  const fresh = items.filter((n) => n?.id != null && !seen.has(n.id));
  for (const n of fresh) seen.add(n.id);
  await chrome.storage.local.set({ seenNotifs: [...seen].slice(-MAX_SEEN), notifsReady: true });
  // First run: remember what already exists instead of replaying the whole history.
  if (!notifsReady) return;

  const wanted = fresh.filter((n) => !n.read && !n.readAt && settings[CATEGORY[n.type] ?? 'notifyOther']);
  if (wanted.length > 4) {
    return notify('batch', {
      title: `${wanted.length} nouvelles notifications Kyara`,
      message: wanted.slice(0, 4).map((n) => format(n).title).join(' · '),
      href: '/'
    });
  }
  for (const n of wanted) notify(`n-${n.id}`, format(n));
}

const pick = (...v) => v.find((x) => x != null && x !== '');

function format(n) {
  const d = n.data ?? {};
  const name = pick(d.name, d.characterName, d.character?.name) ?? 'une carte';
  const amount = pick(d.price, d.amount, d.finalPrice);
  const price = amount != null ? ` · ${Number(amount).toLocaleString('fr-FR')} ◆` : '';
  const who = pick(d.pseudo, d.fromPseudo, d.by, typeof d.from === 'string' ? d.from : d.from?.pseudo);
  const listing = pick(d.listingId, d.refId);
  const market = listing ? `/marche?annonce=${encodeURIComponent(listing)}` : '/marche?onglet=ventes';
  const trades = '/marche?onglet=echanges';
  switch (n.type) {
    case 'outbid': return { title: 'Enchère dépassée', message: `Quelqu’un a surenchéri sur ${name}${price}.`, href: market };
    case 'won': return { title: 'Enchère gagnée !', message: `${name}${price} rejoint ta collection.`, href: '/collection' };
    case 'sold': return { title: 'Carte vendue', message: `${name} vendue${price}.`, href: '/marche?onglet=ventes' };
    case 'bought': return { title: 'Achat réussi', message: `${name}${price}.`, href: '/collection' };
    case 'expired': return { title: 'Annonce expirée', message: `${name} n’a pas trouvé preneur.`, href: '/marche?onglet=ventes' };
    case 'order_filled': return { title: 'Ordre d’achat exécuté', message: `${name}${price}.`, href: '/marche?onglet=ordres' };
    case 'listing_cancelled': return { title: 'Annonce annulée', message: name, href: '/marche?onglet=ventes' };
    case 'wish_listed': return { title: 'Une de tes envies est en vente', message: `${name}${price}${who ? ` · par ${who}` : ''}`, href: market };
    case 'trade_offer': return { title: 'Nouvelle proposition d’échange', message: who ? `${who} te propose un échange.` : 'Un joueur te propose un échange.', href: trades };
    case 'trade_accepted': return { title: 'Échange accepté', message: who ? `${who} a accepté ton échange.` : 'Ton échange a été accepté.', href: trades };
    case 'trade_declined': return { title: 'Échange refusé', message: who ? `${who} a refusé ton échange.` : 'Ton échange a été refusé.', href: trades };
    case 'trade_cancelled': return { title: 'Échange annulé', message: who ? `${who} a annulé sa proposition.` : 'Une proposition a été annulée.', href: trades };
    case 'trade_message': return { title: 'Message d’échange', message: who ? `${who} t’a écrit.` : 'Nouveau message sur un échange.', href: trades };
    case 'offer_accepted': return { title: 'Offre acceptée', message: who ? `${who} a accepté ton offre.` : 'Ton offre a été acceptée.', href: trades };
    case 'friend_request': return { title: 'Demande d’ami', message: `${who ?? 'Un joueur'} veut devenir ton ami.`, href: '/amis' };
    case 'friend_accepted': return { title: 'Nouvel ami', message: `${who ?? 'Un joueur'} a accepté ta demande.`, href: '/amis' };
    case 'collection_shared': return { title: 'Collection partagée', message: `${who ?? 'Un ami'} partage sa collection avec toi.`, href: '/amis' };
    case 'team_message': return { title: 'Message de l’équipe', message: pick(d.text, d.title, d.message) ?? 'Nouveau message de l’équipe Kyara.', href: '/' };
    case 'admin_gift': return { title: 'Cadeau de l’équipe Kyara', message: pick(d.reason, d.label) ?? 'Un cadeau t’attend.', href: '/' };
    case 'referral_credited': return { title: 'Parrainage validé', message: who ? `${who} a rejoint Kyara grâce à toi.` : 'Un parrainage a été validé.', href: '/parrainage' };
    case 'membership': return { title: 'Abonnement', message: 'Ton abonnement a été mis à jour.', href: '/soutien' };
    case 'feedback_reply':
    case 'bug_fixed': return { title: 'Avis et bugs', message: 'Ouvre « Avis et bugs » pour lire la réponse.', href: '/avis' };
    case 'heritage_comp': return { title: 'Cartes Héritage', message: 'Des cartes Héritage ont été ajoutées à ta collection.', href: '/collection' };
    case 'launch_tier': return { title: 'Palier débloqué !', message: pick(d.label) ?? 'Un nouveau palier est débloqué.', href: '/parrainage' };
    default: return { title: 'Notification Kyara', message: pick(d.text, d.message, d.name) ?? 'Nouvelle activité sur ton compte.', href: '/' };
  }
}

// chrome.notifications keeps only the id, so the link is remembered per notification.
const links = new Map();
function notify(id, { title, message, href }) {
  const nid = `${id}-${Date.now()}`;
  links.set(nid, href);
  // The worker can be unloaded before the click: keep a copy that survives it.
  chrome.storage.session?.set({ [`link:${nid}`]: href }).catch(() => {});
  chrome.notifications.create(nid, { type: 'basic', iconUrl: ICON, title, message: message || ' ' });
}

chrome.notifications.onClicked.addListener(async (nid) => {
  let href = links.get(nid);
  if (!href && chrome.storage.session) href = (await chrome.storage.session.get(`link:${nid}`))[`link:${nid}`];
  openSite(href ?? '/');
  chrome.notifications.clear(nid);
});

async function openSite(href) {
  const url = new URL(href, ORIGIN).href;
  if (!url.startsWith(`${ORIGIN}/`)) return void (await chrome.tabs.create({ url })); // GitHub release page
  const [tab] = await chrome.tabs.query({ url: `${ORIGIN}/*` });
  if (tab) {
    await chrome.tabs.update(tab.id, { url, active: true });
    await chrome.windows?.update(tab.windowId, { focused: true }).catch(() => {}); // no windows on Android
  } else {
    await chrome.tabs.create({ url });
  }
}

function updateBadge(me, loggedOut = false) {
  if (loggedOut || !me) {
    chrome.action.setBadgeText({ text: loggedOut ? '!' : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#6b6875' });
    chrome.action.setTitle({ title: loggedOut ? 'Kyara Games — ouvre kyara.games pour te connecter' : 'Kyara Games' });
    return;
  }
  const max = me.freePacksMax ?? 10;
  const full = me.freePacks >= max;
  chrome.action.setBadgeText({ text: String(me.freePacks ?? '') });
  chrome.action.setBadgeBackgroundColor({ color: full ? '#3FBF7F' : '#FF4D2E' });
  chrome.action.setTitle({ title: `Kyara Games — ${me.freePacks}/${max} boosters gratuits` });
}

// Debounced refresh after the site changed the collection (booster opened, trade accepted, sale…).
let refreshTimer = null;
function refreshCollectionSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => loadCollection(true).catch(() => {}), 2500);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg).then(reply, (e) => reply({ error: e?.code ?? String(e) }));
  return true;
});

async function handle(msg) {
  switch (msg?.type) {
    case 'auth': {
      const { auth } = await chrome.storage.local.get('auth');
      if (auth?.token === msg.token && auth?.device === msg.device) return { ok: true };
      await chrome.storage.local.set({ auth: { token: msg.token, device: msg.device, at: Date.now() }, authValid: true });
      if (auth?.token && auth.token !== msg.token) await chrome.storage.local.remove(['collection', 'me', 'seenNotifs', 'notifsReady', 'boosterFull']);
      poll();
      loadCollection(true).catch(() => {});
      return { ok: true };
    }
    case 'collection':
      await chrome.storage.local.set({ collection: { at: Date.now(), items: slimCollection(msg.items) } });
      return { ok: true };
    case 'collection-stale':
      refreshCollectionSoon();
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
    case 'refresh':
      await Promise.allSettled([loadCatalog(), loadCollection(true), poll()]);
      return { ok: true };
    case 'prices':
      // The site's fair price of each card, as shown in its trade composer: { [id]: chakra }.
      return (await api(`/fair-play/prices?ids=${msg.ids.slice(0, 200).join(',')}`)) ?? {};
    case 'install-update':
      return installUpdate();
    case 'check-update':
      await lookForUpdate();
      return { ok: true };
    case 'ensure-data':
      await Promise.allSettled([loadCatalog(), loadCollection()]);
      return { ok: true };
    case 'test-notification':
      notify('test', { title: 'Kyara Games', message: 'Les notifications fonctionnent ✔', href: '/' });
      return { ok: true };
    case 'open':
      await openSite(msg.href ?? '/');
      return { ok: true };
    default:
      return { error: 'unknown_message' };
  }
}

schedule();
