// Runs in the page: forwards to content.js the Kyara API answers the extension needs.
// The only request it changes is the search of the market's trade offers while "★ Favoris" is on.
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

  // Answers that show other players (market, auctions, trades, chat, rankings, profiles), read for the "Mur de la Honte" page.
  const PLAYERS = /^\/(market\/(listings|chat|buy-orders)|trades\/|eveil\/market|me\/(trades|market|friends)|leaderboard\/|feed$|users\/[^/]+$|membership\/wall)/;

  const original = window.fetch;

  // Players found in an answer: id, pseudo, avatar, name colour, badges when the answer has them, and stats.
  function players(body) {
    const out = new Map();
    let left = 20000;
    const walk = (v, depth) => {
      if (!v || typeof v !== 'object' || depth > 6 || --left < 0) return;
      if (Array.isArray(v)) return void v.forEach((x) => walk(x, depth + 1));
      const id = v.userId ?? v.id;
      if (typeof v.pseudo === 'string' && typeof id === 'string' && !out.has(id)) {
        const p = { id, pseudo: v.pseudo, avatar: v.avatar ?? null, nameColor: v.nameColor ?? null };
        if (Array.isArray(v.badges)) p.badges = v.badges.map((b) => ({ id: b?.id }));
        for (const k of ['owned', 'mythics', 'points']) if (typeof v[k] === 'number') p[k] = v[k];
        out.set(id, p);
      }
      for (const k in v) walk(v[k], depth + 1);
    };
    walk(body, 0);
    return [...out.values()];
  }

  // ---------- "★ Favoris" of the market's trade offers ----------

  const OFFERS = '/api/trades/offers/search';
  const MAX_IDS = 400; // the server refuses more ids in one search
  // JSON answer made by the extension.
  const answer = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  // The site's offer search narrowed to the favourite cards (data-kyx-board-ids, set by content.js), 50 offers a page.
  async function favOffers(url, input, init) {
    const fav = document.documentElement.dataset.kyxBoardIds;
    if (!fav || url.origin !== location.origin || url.pathname !== OFFERS || url.searchParams.get('pageSize') !== '20') return null;
    let ids = fav.split(',');
    const typed = url.searchParams.get('ids');
    if (typed) {
      const keep = new Set(typed.split(','));
      ids = ids.filter((id) => keep.has(id));
    }
    if (!ids.length) return answer({ items: [], total: 0, more: false });
    const parts = [];
    for (let i = 0; i < ids.length; i += MAX_IDS) parts.push(ids.slice(i, i + MAX_IDS));
    const pages = await Promise.all(
      parts.map(async (part) => {
        const u = new URL(url);
        u.searchParams.set('ids', part.join(','));
        u.searchParams.set('pageSize', '50');
        const res = await original.call(window, new Request(u.toString(), input instanceof Request ? input : init ?? {}));
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
    );
    if (pages.length === 1) return answer(pages[0]);
    // Several searches: one page of each, newest first, without the offers found twice.
    const seen = new Set();
    const items = pages
      .flatMap((p) => p.items ?? [])
      .filter((o) => !seen.has(o.id) && seen.add(o.id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return answer({ items, total: pages.reduce((n, p) => n + (p.total ?? 0), 0), more: pages.some((p) => p.more) });
  }

  // ---------- subscriber perks for the players without a subscription ----------

  const RELAY = 'https://kyara-games-relay.finch-arhold-git.workers.dev'; // same relay as src/lib/kyara.js
  const PERKS = ['name-color', 'name-gradient', 'chat-color', 'custom-title', 'profile-banner', 'profile-links', 'profile-theme', 'showcase-backdrop', 'showcase-animated', 'showcase-plus2', 'saved-filters', 'wishlist-plus'];
  const COLORS = { sakura: '#ff7eb6', ciel: '#5cb8ff', jade: '#3fcf9b', or: '#e9b93c', braise: '#ff7a45', lavande: '#a98bff', rubis: '#ff4d6d', azur: '#38d6e0' };
  const THEMES = ['sakura', 'nuit', 'ocean', 'braise', 'jade', 'or'];
  const MEMBER = {
    colors: COLORS,
    gradients: ['aurore', 'sakura', 'ocean', 'braise', 'or', 'prisme', 'perso'],
    banners: ['sakura', 'vagues', 'montagne', 'nuit', 'aurore', 'foudre'],
    backdrops: THEMES,
    themes: THEMES,
    linkKinds: ['twitch', 'youtube', 'x', 'tiktok', 'instagram', 'kick'],
    linksMax: 4,
    customTitleMax: 24,
    cardBacks: [],
    openingEffects: []
  };
  const PERK_FIELDS = ['nameColor', 'chatColor', 'nameGradient', 'banner', 'showcaseBackdrop', 'theme', 'links', 'customTitle'];
  const SITE_SHOWCASE = 8; // cards the server keeps in the showcase; the others are kept by the relay
  const SITE_WISHES = 200; // wishes the server keeps; the others are kept on this device
  const WISHES = 500;
  const PERKS_KEEP = 10 * 60e3; // the players' perks are read from the relay every 10 minutes

  let me = null; // logged-in player: { id, sub, title }
  let perks = {}; // perks chosen by the players, by Kyara id, read from the relay
  const pseudos = {}; // pseudo of those players, by Kyara id, seen in the site's answers
  let perksAt = 0;
  let perksLoad = null;

  const HEX = /^#[0-9a-f]{6}$/i;
  // Badge of the players without a subscription who use the extension, seen only by players without one either.
  const EXT_BADGE = { id: 'kyx-extension', label: 'Kyara Games', description: 'Joue avec l’extension Kyara Games', kanji: '拡', frame: false };
  const EXT_COLOR = '#ff8a3d'; // colour of the badge, for the players who chose no name colour
  const MEMBER_EVERY = 24 * 3600e3; // the relay is told once a day that the player uses the extension
  const DEFAULT_GRADIENT = ['#ff4d6d', '#ffd166', '#38d6e0'];

  let gradients = null; // the site's table of name gradients, found among its modules
  let gradientsFind = null;
  const customGradients = new Map(); // key in that table -> colours

  const isSub = () => !!(me?.sub || document.documentElement.dataset.kyxSub);
  const union = (a, b) => [...new Set([...(a ?? []), ...b])];
  const fail = (error, status = 502) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });

  // Reads (no value) or writes a JSON value of the site's localStorage.
  function local(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? 'null');
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      return null;
    }
  }
  const extraWishes = () => (me ? local(`kyx-wishes:${me.id}`) ?? [] : []);
  const withExtraWishes = (list) => union(list, extraWishes());

  // Perks from the relay, kept 10 minutes on this device (tried again after 5 minutes when the relay fails); waits for them 1.5 s at most.
  function loadPerks() {
    if (!perksAt) {
      const saved = local('kyx-perks');
      if (saved?.data && Date.now() - saved.at < PERKS_KEEP) {
        perks = saved.data;
        perksAt = saved.at;
        findGradients().then(shareNames);
      }
    }
    if (!perksLoad && Date.now() - perksAt > PERKS_KEEP) {
      perksAt = Date.now();
      perksLoad = original
        .call(window, `${RELAY}/profiles`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && typeof data === 'object') {
            perks = data;
            local('kyx-perks', { at: perksAt, data });
            findGradients().then(shareNames);
          } else perksAt -= PERKS_KEEP - 5 * 60e3;
        })
        .catch(() => (perksAt -= PERKS_KEEP - 5 * 60e3))
        .finally(() => (perksLoad = null));
    }
    return Promise.race([perksLoad, new Promise((r) => setTimeout(r, 1500))]);
  }

  // Hex colour of a name colour chosen through the extension (a colour of the site or any colour), or null.
  const colorOf = (c) => COLORS[c] ?? (HEX.test(c ?? '') ? c : null);

  // Key of a name gradient for the site: its own key, or a key added to its table for colours chosen freely.
  function gradientOf(g) {
    if (typeof g === 'string') return g;
    if (!Array.isArray(g) || !g.length) return null;
    const key = `kyx:${g.join(',')}`;
    addGradient(key, g);
    return key;
  }

  // Adds a gradient to the site's table (now, or as soon as the table is found).
  function addGradient(key, colors) {
    customGradients.set(key, colors);
    if (gradients) gradients[key] = { fr: 'Perso', en: 'Custom', stops: [...colors, colors[0]], speed: 6 };
  }

  // Finds the site's table of name gradients among the modules already loaded (its file name changes with each version).
  function findGradients() {
    if (gradients) return Promise.resolve();
    gradientsFind ??= (async () => {
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(`${location.origin}/_app/immutable/`) && u.endsWith('.js'));
      const known = local('kyx-gradients-module');
      if (known) urls.unshift(known);
      for (const url of new Set(urls)) {
        const mod = await import(url).catch(() => null);
        const table = Object.values(mod ?? {}).find((v) => v && typeof v === 'object' && v.prisme?.stops && v.aurore?.stops);
        if (!table) continue;
        gradients = table;
        local('kyx-gradients-module', url);
        for (const [key, colors] of customGradients) addGradient(key, colors);
        return;
      }
    })()
      .catch(() => {})
      .finally(() => (gradientsFind = null));
    return Promise.race([gradientsFind, new Promise((r) => setTimeout(r, 1500))]);
  }

  // Hands content.js the name colour or gradient of the other players (the market's sellers), and the colour of
  // every player who uses the extension (their chat messages).
  function shareNames() {
    const names = {};
    const members = {};
    for (const [id, r] of Object.entries(perks)) {
      if (r?.ext) members[id] = colorOf(r.nameColor) ?? (Array.isArray(r.nameGradient) ? r.nameGradient[0] : gradients?.[r.nameGradient]?.stops?.[0]) ?? EXT_COLOR;
      if (id === me?.id || !r) continue;
      const stops = Array.isArray(r.nameGradient) ? r.nameGradient : gradients?.[r.nameGradient]?.stops?.slice(0, -1);
      const color = colorOf(r.nameColor);
      if (stops?.length || color) names[id] = { ...(stops?.length ? { gradient: stops } : { color }), pseudo: pseudos[id] ?? null };
    }
    window.postMessage({ __kyaraGames: 1, kind: 'names', names, members }, location.origin);
  }

  // Remembers who is logged in, from the site's own answer.
  function learnMe(u) {
    if (typeof u?.id !== 'string') return;
    const known = me?.id === u.id;
    me = { title: known ? me.title : null, id: u.id, sub: !!(u.membership?.tier || u.membership?.perks?.length) };
    if (!known && perksAt) shareNames();
    if (!me.sub) tellMember();
  }

  // Tells the relay once a day that the logged-in player uses the extension (their badge), with their session.
  function tellMember() {
    const key = `kyx-member:${me.id}`;
    if (Date.now() - (local(key) ?? 0) < MEMBER_EVERY) return;
    local(key, Date.now());
    const { token, device } = sessionOf('', {});
    if (!token) return;
    original
      .call(window, `${RELAY}/member`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ token, device }) })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.ok) return local(key, 0);
        perks[me.id] = { ...perks[me.id], ext: data.ext };
        shareNames();
      })
      .catch(() => local(key, 0));
  }

  // True for a player without a subscription, from their badges.
  const freePlayer = (p) => !(p.badges ?? []).some((b) => /^membre-/.test(b?.id ?? ''));

  // The extension's badge and the entrance of the chat messages for a player who uses it.
  function markMember(v, r) {
    if (!r?.ext || !Array.isArray(v.badges) || !freePlayer(v)) return;
    if (!v.badges.some((b) => b?.id === EXT_BADGE.id)) v.badges.push({ ...EXT_BADGE });
    v.entrance = true;
  }

  // The logged-in player as the site sees them: with the perks and their saved market searches.
  function patchUser(u) {
    if (!u || isSub()) return;
    u.membership = { name: 'Kyara Games', ...u.membership, perks: union(u.membership?.perks, PERKS) };
    if (!u.savedFilters?.length) u.savedFilters = local(`kyx-filters:${u.id}`) ?? [];
  }

  // The "Personnaliser" window's data: the member tab and the perks chosen before.
  function patchPrestige(b) {
    if (!b || !me || isSub()) return;
    const mine = perks[me.id] ?? {};
    me.title = b.title ?? null;
    const custom = !COLORS[mine.nameColor] && colorOf(mine.nameColor);
    const customChat = !COLORS[mine.chatColor] && colorOf(mine.chatColor);
    const ownGradient = Array.isArray(mine.nameGradient) ? mine.nameGradient : null;
    addGradient('perso', ownGradient ?? DEFAULT_GRADIENT);
    Object.assign(document.documentElement.dataset, { kyxPerks: '1', kyxNameColor: custom || '', kyxChatColor: customChat || '', kyxNameGradient: (ownGradient ?? DEFAULT_GRADIENT).join(',') });
    b.member = { ...MEMBER, ...b.member, colors: { ...COLORS, perso: custom || '#ffffff' }, perks: union(b.member?.perks, PERKS) };
    b.settings = {
      ...b.settings,
      nameColor: custom ? 'perso' : mine.nameColor ?? null,
      nameGradient: ownGradient ? 'perso' : mine.nameGradient ?? null,
      chatColor: customChat ? 'perso' : mine.chatColor ?? null,
      showcaseStyle: mine.showcaseStyle ?? b.settings?.showcaseStyle,
      banner: mine.banner ?? null,
      showcaseBackdrop: mine.showcaseBackdrop ?? null,
      theme: mine.theme ?? null,
      links: mine.links ?? [],
      customTitle: mine.title ?? b.settings?.customTitle ?? null
    };
    if (mine.title) b.title = 'custom';
  }

  // A player's profile with the perks they chose through the extension.
  function patchProfile(p, id) {
    const r = perks[id];
    if (!p || !r || isSub()) return;
    markMember(p, r);
    p.nameColor ||= colorOf(r.nameColor) ?? (Array.isArray(r.nameGradient) ? r.nameGradient[0] : null);
    p.nameGradient ||= gradientOf(r.nameGradient);
    p.banner ||= r.banner ?? null;
    p.showcaseBackdrop ||= r.showcaseBackdrop ?? null;
    p.theme ||= r.theme ?? null;
    if (r.showcaseStyle) p.showcaseStyle = r.showcaseStyle;
    if (!p.links?.length && r.links?.length) p.links = r.links;
    if (r.title && p.titleId !== 'custom') Object.assign(p, { title: r.title, titleId: 'custom' });
    if (r.best?.length && Array.isArray(p.best)) {
      const have = new Set(p.best.map((c) => c?.id));
      p.best.push(...r.best.filter((c) => !have.has(c.id)));
    }
  }

  // Name colours chosen through the extension, in any list of players (rankings, market, chat…).
  function colorNames(body) {
    let left = 20000;
    let met = false;
    const walk = (v, depth) => {
      if (!v || typeof v !== 'object' || depth > 6 || --left < 0) return;
      if (Array.isArray(v)) return void v.forEach((x) => walk(x, depth + 1));
      const id = v.userId ?? v.id;
      const r = typeof v.pseudo === 'string' && perks[id];
      if (r) {
        if (pseudos[id] !== v.pseudo) met = pseudos[id] = v.pseudo;
        if ('nameColor' in v && !v.nameColor) v.nameColor = colorOf(r.nameColor) ?? (Array.isArray(r.nameGradient) ? r.nameGradient[0] : null);
        if (!v.nameGradient && r.nameGradient) v.nameGradient = gradientOf(r.nameGradient);
        if (!v.chatColor && colorOf(r.chatColor)) v.chatColor = colorOf(r.chatColor);
        markMember(v, r);
      }
      for (const k in v) walk(v[k], depth + 1);
    };
    walk(body, 0);
    if (met) shareNames();
  }

  // Answer of the site completed with the perks, or the same answer.
  async function perkRead(path, method, res) {
    if (!res.ok) return res;
    let fix = null;
    if (method === 'GET' && (path === '/me/prestige' || path.startsWith('/users/') || PLAYERS.test(path))) await findGradients();
    if (method === 'GET' && path === '/me') fix = (b) => (learnMe(b), patchUser(b), b);
    else if (method === 'GET' && path === '/me/bootstrap')
      fix = (b) => {
        learnMe(b?.me);
        patchUser(b?.me);
        if (Array.isArray(b?.wishlist) && !isSub()) b.wishlist = withExtraWishes(b.wishlist);
        return b;
      };
    else if (/^\/me\/wishlist(\/\d+)?$/.test(path)) fix = (b) => (Array.isArray(b) && !isSub() ? withExtraWishes(b) : b);
    else if (method === 'GET' && path === '/me/prestige') {
      await loadPerks();
      fix = (b) => (patchPrestige(b), b);
    } else if (method === 'GET' && /^\/users\/[^/]+$/.test(path)) {
      await loadPerks();
      const id = decodeURIComponent(path.slice(7));
      fix = (b) => (patchProfile(b, id), b);
    } else if ((method === 'GET' && PLAYERS.test(path)) || (method === 'POST' && path === '/market/chat')) {
      await loadPerks();
      if (!isSub() && Object.values(perks).some((r) => r?.nameColor || r?.nameGradient || r?.chatColor || r?.ext)) fix = (b) => (colorNames(b), b);
    }
    if (!fix) return res;
    const body = await res.clone().json().catch(() => undefined);
    if (body === undefined) return res;
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(JSON.stringify(fix(body)), { status: res.status, statusText: res.statusText, headers });
  }

  // Session of the site's request (token and device id).
  function sessionOf(input, init) {
    const h = new Headers(input instanceof Request ? input.headers : init?.headers);
    let token = h.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    let device = h.get('x-device-id');
    try {
      token ||= localStorage.getItem('kyara_token');
      device ||= localStorage.getItem('kyara_device');
    } catch {}
    return { token, device, headers: h };
  }

  // Saves the player's perks on the relay; returns an error code or null.
  async function savePerks(patch, session) {
    const next = { ...perks[me.id], ...patch };
    const profile = { nameColor: next.nameColor, chatColor: next.chatColor, nameGradient: next.nameGradient, banner: next.banner, showcaseBackdrop: next.showcaseBackdrop, showcaseStyle: next.showcaseStyle, theme: next.theme, links: next.links, title: next.title, best: next.best };
    try {
      const res = await original.call(window, `${RELAY}/profile`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ token: session.token, device: session.device, profile })
      });
      const data = await res.json();
      if (!res.ok || data?.error) return data?.error ?? `relay_${res.status}`;
      if (data.profile) perks[me.id] = data.profile;
      else delete perks[me.id];
      local('kyx-perks', { at: perksAt, data: perks });
      return null;
    } catch {
      return 'relay';
    }
  }

  // Same request with another JSON body.
  const resend = (input, init, body) =>
    input instanceof Request ? original.call(window, new Request(input, { body: JSON.stringify(body) })) : original.call(window, input, { ...init, body: JSON.stringify(body) });

  // The site's wishlist, read with the session of a request.
  const siteWishes = (session) =>
    original
      .call(window, '/api/me/wishlist', { headers: session.headers })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);

  // Writes of the site that touch a perk: the perks go to the relay or this device, the rest to the server.
  async function perkWrite(url, method, input, init) {
    if (url.origin !== location.origin) return null;
    const path = url.pathname.slice(4);
    const session = sessionOf(input, init);
    const readBody = async () => JSON.parse(input instanceof Request ? await input.clone().text() : String(init?.body ?? '{}'));

    // Nobody leaves the site's supporters wall from here: the choice is never sent.
    if (method === 'PATCH' && path === '/me/profile' && (!me || isSub())) {
      const body = await readBody();
      if (!('hideFromWall' in body)) return null;
      delete body.hideFromWall;
      return resend(input, init, body);
    }
    if (!me || isSub()) return null;

    if (method === 'PATCH' && path === '/me/profile') {
      const body = await readBody();
      delete body.hideFromWall;
      const chosen = {};
      for (const k of PERK_FIELDS) if (k in body) chosen[k] = body[k];
      if ('savedFilters' in body) local(`kyx-filters:${me.id}`, body.savedFilters ?? []);
      for (const k of [...PERK_FIELDS, 'savedFilters']) delete body[k];
      if ('showcaseStyle' in body) {
        chosen.showcaseStyle = body.showcaseStyle === 'aurora' ? 'aurora' : null;
        if (chosen.showcaseStyle) delete body.showcaseStyle;
      }
      const picked = document.documentElement.dataset;
      if (chosen.nameColor === 'perso') chosen.nameColor = HEX.test(picked.kyxNameColor ?? '') ? picked.kyxNameColor : null;
      if (chosen.chatColor === 'perso') chosen.chatColor = HEX.test(picked.kyxChatColor ?? '') ? picked.kyxChatColor : null;
      if (chosen.nameGradient === 'perso') chosen.nameGradient = (picked.kyxNameGradient ?? '').split(',').filter((c) => HEX.test(c));
      if ('customTitle' in chosen) {
        chosen.title = body.title === 'custom' ? chosen.customTitle : null;
        delete chosen.customTitle;
      }
      if (body.title === 'custom') body.title = me.title === 'custom' ? null : me.title;
      if (Object.keys(chosen).length) {
        const err = await savePerks(chosen, session);
        if (err) return fail(err === 'subscriber' ? 'forbidden' : 'relay');
      }
      return Object.keys(body).length ? resend(input, init, body) : answer({ ok: true });
    }

    if (method === 'PUT' && path === '/me/showcase') {
      const body = await readBody();
      if (!Array.isArray(body?.ids)) return null;
      const extra = body.ids.slice(SITE_SHOWCASE).map(Number);
      if (!extra.length && !perks[me.id]?.best?.length) return null;
      let best = [];
      if (extra.length) {
        const cards = await original.call(window, '/api/characters').then((r) => r.json());
        const byId = new Map(cards.map((c) => [Number(c.id), c]));
        best = extra.map((id) => byId.get(id)).filter(Boolean);
      }
      const err = await savePerks({ best }, session);
      if (err) return fail('relay');
      return resend(input, init, { ...body, ids: body.ids.slice(0, SITE_SHOWCASE) });
    }

    const wish = path.match(/^\/me\/wishlist\/(\d+)$/);
    if (wish && (method === 'PUT' || method === 'DELETE')) {
      const id = Number(wish[1]);
      const key = `kyx-wishes:${me.id}`;
      const extras = extraWishes();
      if (method === 'DELETE' && extras.includes(id)) {
        local(key, extras.filter((x) => x !== id));
        return answer(withExtraWishes(await siteWishes(session)));
      }
      if (method === 'PUT') {
        const res = await original.call(window, input, init);
        if (res.ok || extras.length >= WISHES - SITE_WISHES) return res;
        const err = await res.clone().json().catch(() => null);
        if (err?.error !== 'wishlist_full' && err?.code !== 'wishlist_full') return res;
        local(key, union(extras, [id]));
        return answer(withExtraWishes(await siteWishes(session)));
      }
    }
    return null;
  }

  // Chat messages that arrive live: the authors get the colours they chose through the extension.
  const NativeEventSource = window.EventSource;
  if (NativeEventSource) {
    const listen = NativeEventSource.prototype.addEventListener;
    NativeEventSource.prototype.addEventListener = function (type, listener, options) {
      if (type !== 'chat' || typeof listener !== 'function') return listen.call(this, type, listener, options);
      return listen.call(
        this,
        type,
        function (e) {
          try {
            if (!isSub() && Object.keys(perks).length) {
              const body = JSON.parse(e.data);
              colorNames(body);
              e = new MessageEvent(e.type, { data: JSON.stringify(body), origin: e.origin, lastEventId: e.lastEventId });
            }
          } catch {}
          return listener.call(this, e);
        },
        options
      );
    };
  }

  window.fetch = async function (input, init) {
    let res = null;
    let url = null;
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    try {
      url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
      res = (await favOffers(url, input, init)) ?? (url.pathname.startsWith('/api/') && method !== 'GET' ? await perkWrite(url, method, input, init) : null);
    } catch {
      res = null;
    }
    if (!res) res = await original.apply(this, arguments);
    try {
      if (!url || url.origin !== location.origin || !url.pathname.startsWith('/api/') || !res.ok) return res;
      const path = url.pathname.slice(4);
      res = await perkRead(path, method, res).catch(() => res);
      if (method === 'GET' && PLAYERS.test(path)) {
        res.clone().json().then(
          (body) => {
            const list = players(body);
            if (list.length) window.postMessage({ __kyaraGames: 1, kind: 'players', path, query: url.search, list }, location.origin);
          },
          () => {}
        );
      }
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
