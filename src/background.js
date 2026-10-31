import { ORIGIN, REPO, api, checkUpdate, newer, getSettings, setSettings, loadCatalog, loadCollection, slimCollection, slimMe, runSubsScan, autoSubsScan, meetPlayers, exportSubs, relayStats } from './lib/kyara.js';

const ALARM = 'kyara-poll';
const UPDATE_ALARM = 'kyara-update';
const SUBS_ALARM = 'kyara-subs';
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

// Alarms: notifications at the interval of the settings (15 seconds by default), new versions every 15 minutes,
// subscribers of the site every minute, even with no kyara.games tab open.
// An alarm can't repeat faster than every 30 seconds: below that, a second check runs in between (onAlarm).
const pollEvery = (settings) => Math.max(0.25, Number(settings.pollMinutes) || 0.25);
async function schedule() {
  const every = pollEvery(await getSettings());
  await chrome.alarms.create(ALARM, { periodInMinutes: Math.max(0.5, every) });
  if ((await chrome.alarms.get(UPDATE_ALARM))?.periodInMinutes !== 15) await chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 15 });
  if (!(await chrome.alarms.get(SUBS_ALARM))) await chrome.alarms.create(SUBS_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}

// Looks for a newer release on GitHub (always the latest one) and notifies it once per version.
async function lookForUpdate(maxAge = 10 * 60e3) {
  if (FIREFOX) return; // Firefox users run the userscript
  // The alarm asks every 15 minutes; the popup asks each time it opens, for an answer a minute old at most.
  const { updateCheckedAt } = await chrome.storage.local.get('updateCheckedAt');
  if (Date.now() - (updateCheckedAt ?? 0) < maxAge) return;
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
      href: `https://github.com/${REPO}/releases/latest`
    });
  } catch {}
}

// "Mettre à jour": the updater installed on the computer (installer-mises-a-jour.bat) replaces the files,
// then the extension reloads.
const UPDATER = 'com.kyara_games.updater';

async function installUpdate() {
  // Ask GitHub again: a newer release may have come out since the banner was shown.
  const update = (await checkUpdate().catch(() => null)) ?? (await chrome.storage.local.get('update')).update;
  if (!update) return { error: 'no_update' };
  let res;
  try {
    res = await chrome.runtime.sendNativeMessage(UPDATER, { action: 'update', version: update.version, url: FIREFOX ? update.xpi : update.zip });
  } catch {
    return { error: 'no_updater', update };
  }
  // A folder already newer than the version asked for is a success too.
  if (res?.error === 'version_mismatch' && res.detail && !newer(update.version, res.detail)) res = { ok: true, version: res.detail };
  if (!res?.ok) return { error: res?.error ?? 'failed', detail: res?.detail, update };
  setTimeout(() => chrome.runtime.reload(), 800);
  return { ok: true, version: res.version, update };
}

chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  await chrome.storage.local.remove(['update', 'updateCheckedAt']); // just installed or updated: the banner is stale
  await schedule();
  if (reason === 'update') await refreshSite();
  loadCatalog(reason === 'update').catch(() => {});
  lookForUpdate();
  if (reason === 'update') announceUpdate(previousVersion);
  if (reason === 'update' && previousVersion && newer('1.7.0', previousVersion)) {
    const settings = await getSettings();
    if (Number(settings.pollMinutes) === 1) await setSettings({ pollMinutes: 0.25 });
  }
});

// Says that a new version was installed, with a link to what changed.
async function announceUpdate(previousVersion) {
  const version = chrome.runtime.getManifest().version;
  if (!previousVersion || previousVersion === version) return;
  if (!(await getSettings()).notifyUpdated) return;
  notify('updated', {
    title: `Kyara Games est passé en ${version}`,
    message: 'Clique pour voir les nouveautés de cette version.',
    href: '/#kyx-nouveautes'
  });
}

// After an update: empties the caches of kyara.games and reloads its tabs (session and push notifications stay).
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
// Checks the account at each alarm, and once more in between when the interval is under 30 seconds.
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === UPDATE_ALARM) lookForUpdate();
  if (a.name === SUBS_ALARM) autoSubsScan();
  if (a.name !== ALARM) return;
  poll();
  const every = pollEvery(await getSettings());
  if (every < 0.5) setTimeout(poll, every * 60e3);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings && changes.settings.oldValue?.pollMinutes !== changes.settings.newValue?.pollMinutes) schedule();
  if (changes.me) updateBadge(changes.me.newValue);
  if (changes.authValid && changes.authValid.newValue === false) updateBadge(null, true);
});

let polling = null;
// Runs a check, never two at once.
function poll() {
  return (polling ??= run().finally(() => (polling = null)));
}

// Free boosters and new notifications of the account.
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

// Notifies once when the free boosters are full.
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

// Notifies the account's new notifications, by category chosen in the settings.
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

// First value that is set.
const pick = (...v) => v.find((x) => x != null && x !== '');

// Title, text and link of a Kyara notification.
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

// Shows a notification; its link is remembered for the click.
const links = new Map();
function notify(id, { title, message, href }) {
  const nid = `${id}-${Date.now()}`;
  links.set(nid, href);
  // Also kept in session storage, in case the worker is unloaded before the click.
  chrome.storage.session?.set({ [`link:${nid}`]: href }).catch(() => {});
  chrome.notifications.create(nid, { type: 'basic', iconUrl: ICON, title, message: message || ' ' });
}

chrome.notifications.onClicked.addListener(async (nid) => {
  let href = links.get(nid);
  if (!href && chrome.storage.session) href = (await chrome.storage.session.get(`link:${nid}`))[`link:${nid}`];
  openSite(href ?? '/');
  chrome.notifications.clear(nid);
});

// Opens a page of kyara.games in its tab (or a new one).
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

// Free boosters on the extension's icon, "!" when logged out.
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

// Answers the messages of the content script and the popup.
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
    case 'subs-scan':
      await runSubsScan();
      return { ok: true };
    case 'subs-auto':
      autoSubsScan(msg.pageChanged);
      return { ok: true };
    case 'subs-export':
      return exportSubs(msg.token);
    case 'relay-stats':
      return relayStats();
    case 'subs-players':
      meetPlayers(msg.list, msg.where);
      return { ok: true };
    case 'install-update':
      return installUpdate();
    case 'check-update':
      await lookForUpdate(60e3);
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
