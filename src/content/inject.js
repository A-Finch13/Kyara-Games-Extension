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

  window.fetch = async function (input, init) {
    let res = null;
    try {
      const target = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
      res = await favOffers(target, input, init);
    } catch {
      res = null;
    }
    if (!res) res = await original.apply(this, arguments);
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || !res.ok) return res;
      const path = url.pathname.slice(4);
      const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
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
