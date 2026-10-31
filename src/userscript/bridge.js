// Userscript: the background worker's answers to the page code, done in the page.
let refreshTimer = 0;

// Reads the session from the site until the page code hands it over.
async function ensureAuth() {
  if ((await chrome.storage.local.get('auth')).auth?.token) return;
  try {
    const token = localStorage.getItem('kyara_token');
    if (token) await chrome.storage.local.set({ auth: { token, device: localStorage.getItem('kyara_device'), at: Date.now() } });
  } catch {}
}

// Answers the messages of the page code.
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
    case 'ensure-data':
    case 'refresh':
      await Promise.allSettled([loadCatalog(), loadCollection(msg.type === 'refresh')]);
      return { ok: true };
    default:
      return { error: 'unknown_message' };
  }
}
