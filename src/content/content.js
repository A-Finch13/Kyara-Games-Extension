// Kyara Games on kyara.games: card badges, completed and small albums hidden, missing cards greyed out, "Manquantes" chip on Collection and the "Ses doublons" filter in the trade composer.
(() => {
  const DEFAULTS = {
    hideComplete: true,
    hideSmall: false,
    badgeMissing: true,
    badgeDupes: true,
    theirDupes: true
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
    if (kind === 'write') return void send({ type: 'collection-stale' });
    let m;
    if (path === '/me/collection') send({ type: 'collection', items: body });
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
    if (!host || img.classList.contains('kyx-ghost')) return; // greyed out missing card: no badge needed
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

  // Series with fewer than 4 characters in the whole catalog.
  const SMALL = 4;
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
    toggleButton(tools, views, 'hideComplete', settings.hideComplete ? `✔ ${done} complet${s(done)} masqué${s(done)}` : 'Masquer les complets');
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
    if (location.pathname !== '/collection') return;
    for (const miss of document.querySelectorAll('a.slot > .miss')) {
      const id = Number(miss.parentElement.getAttribute('href')?.match(/\/wiki\/(\d+)/)?.[1]);
      if (!id) continue;
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
    send({ type: 'prices', ids: wanted }).then((res) => {
      for (const id of wanted) {
        pricing.delete(id);
        const v = Number(res?.[id]);
        prices.set(id, res && !res.error && Number.isFinite(v) ? v : null);
      }
      scanConfirm();
    });
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
  function scanCollectionChips() {
    if (location.pathname !== '/collection') return;
    for (const select of document.querySelectorAll('select')) {
      if (!select.querySelector('option[value="missing"]')) continue;
      const chips = select.closest('.row2')?.querySelector('.chips');
      if (!chips) continue;
      let btn = chips.querySelector(':scope > .kyx-missing');
      const first = chips.querySelector(':scope > button:not(.kyx-missing)');
      if (!btn && first) {
        // A copy of the site's "Toutes" chip (same dot and style), placed right after it.
        btn = first.cloneNode(true);
        btn.classList.add('kyx-missing');
        btn.lastChild.textContent = ' Manquantes';
        btn.addEventListener('click', () => {
          select.value = select.value === 'missing' ? 'all' : 'missing';
          select.dispatchEvent(new Event('change', { bubbles: true }));
          scanCollectionChips();
        });
        first.after(btn);
      }
      if (!btn) continue;
      if (!select.dataset.kyxWatched) {
        select.dataset.kyxWatched = '1';
        select.addEventListener('change', () => scanCollectionChips());
      }
      const on = select.value === 'missing';
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
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
    scanConfirm();
  }

  function refreshAll() {
    if (stopped) return;
    scanBadges(document);
    scanAlbums();
    scanComposer();
    scanCollectionChips();
    scanMissing();
    scanConfirm();
  }

  let stopped = false;
  function shutdown() {
    if (stopped) return;
    stopped = true;
    clearInterval(ticker);
    observer.disconnect();
    document.querySelectorAll('.kyx-badge, .kyx-toggle, .kyx-only, .kyx-missing, .kyx-series, .kyx-price, .kyx-balance, .kyx-ghost, .kyx-ghost-name').forEach((el) => el.remove());
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
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      autoMore = 0;
      scanBadges(document); // badge rules depend on the page
    }
  }, 1000);

  (async () => {
    applyStorage(await chrome.storage.local.get(['settings', 'collection', 'catalog', 'partner']));
    if (partner && Date.now() - (partner.at ?? 0) > 30 * 60e3) partner = null;
    document.querySelectorAll('#kyx-root').forEach((el) => el.remove()); // left by older versions
    syncAuth();
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    refreshAll();
    if (!catalog || !coll) send({ type: 'ensure-data' });
  })();
})();
