// Kyara Games: everything the extension adds to the pages of kyara.games.
// Also built into the userscript (build.py), which defines KYX_OWNER and stand-ins for the extension APIs.
(() => {
  // Only one copy runs per tab when both the extension and the userscript are installed.
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

  // Lower case without accents, to compare names.
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  // False once the extension was reloaded or updated: this copy then cleans up and stops.
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  // Message to the background worker (null once the extension is gone).
  const send = (msg) => {
    if (!alive()) return shutdown(), Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };
  // Copies owned of a card.
  const qty = (id) => coll?.get(id)?.qty ?? 0;

  // ---------- data ----------

  // Takes in values read from the extension's storage.
  function applyStorage({ settings: s, collection, catalog: cat, partner: p }) {
    if (s !== undefined) settings = { ...DEFAULTS, ...s };
    if (collection !== undefined) coll = collection?.items ? new Map(collection.items.map(([id, q, l]) => [id, { qty: q, listable: l }])) : null;
    if (cat !== undefined) catalog = cat?.list ? new Map(cat.list.map((c) => [c.id, c])) : null;
    if (p !== undefined) partner = p;
    series = null;
  }

  // Total and owned cards of each series.
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
    if ('marketFav' in changes) marketFav = !!changes.marketFav.newValue;
    if ('tradeFav' in changes) tradeFav = !!changes.tradeFav.newValue;
    if ('collectionFav' in changes) collectionFav = !!changes.collectionFav.newValue;
    if ('boardFav' in changes) boardFav = !!changes.boardFav.newValue;
    if ('favSeries' in changes || 'marketFav' in changes) {
      if ('favSeries' in changes) favSeries = new Set(changes.favSeries.newValue ?? []);
      marketShown = '';
      scanFavStars();
      scanMarket();
    }
    if ('favSeries' in changes || 'tradeFav' in changes) scanComposer();
    if ('favSeries' in changes || 'collectionFav' in changes) scanCollectionChips();
    if ('favSeries' in changes || 'boardFav' in changes) scanTradeBoard();
    if ('subscribers' in changes) refreshSubs?.(changes.subscribers.newValue);
    if ('subsExport' in changes) showExport?.(changes.subsExport.newValue);
    for (const k of ['settings', 'collection', 'catalog', 'partner']) if (k in changes) picked[k] = changes[k].newValue;
    if (!Object.keys(picked).length) return;
    applyStorage(picked);
    refreshAll();
  });

  // Hands the site's session (kyara_token in its localStorage) to the extension.
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
    if (e.origin !== location.origin || e.data?.__kyaraGames !== 1) return;
    const { kind, path, body } = e.data;
    if (kind === 'names') {
      marketNames = e.data.names ?? {};
      chatMembers = e.data.members ?? {};
      document.querySelectorAll('[data-kyx-msg]').forEach((el) => delete el.dataset.kyxMsg);
      document.querySelectorAll('[data-kyx-name]').forEach((el) => (el.dataset.kyxName = ''));
      return void scanMarketNames();
    }
    if (kind === 'players') return void send({ type: 'subs-players', list: e.data.list, where: playersWhere(path, e.data.query) });
    if (kind === 'write') {
      if (/^\/market\//.test(path)) setTimeout(refreshFavMarket, 1500);
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
  // Remembers what is known of the trade partner.
  async function setPartner(id, patch) {
    if (pendingNames.has(id)) patch.pseudo ??= pendingNames.get(id);
    const next = await send({ type: 'partner', partner: { id, ...patch } });
    if (next && !next.error) {
      partner = next;
      scanComposer();
    }
  }

  // ---------- badges on every card image ----------

  // True for a card inside the trade composer (the dialog or form with "Tu donnes" and "Tu reçois").
  const composers = new WeakSet();
  function inComposer(img) {
    const dialog = img.closest('[role="dialog"]') ?? img.closest('form:has(.shelf)');
    if (!dialog) return false;
    if (composers.has(dialog)) return true;
    const text = dialog.textContent;
    if (text.includes('Tu donnes') && text.includes('Tu reçois')) {
      composers.add(dialog);
      return true;
    }
    return false;
  }

  // Side of a card in a trade to answer ("Mon activité", or a pending trade of "Mes échanges"): 'give', 'get' or null.
  function pendingTradeSide(img) {
    const tray = !img.closest('form') && img.closest('section:has(> ul.slots)');
    if (tray) {
      const title = tray.querySelector(':scope > header h3')?.textContent ?? '';
      if (/donnes/i.test(title)) return 'give';
      if (/re[çc]ois/i.test(title)) return 'get';
    }
    const item = img.closest('li.trade');
    if (!item?.querySelector('.st-pending')) return null;
    for (let el = img.parentElement; el && el !== item; el = el.parentElement) {
      const text = el.textContent;
      const give = text.includes('Tu donnes');
      const get = text.includes('Tu reçois');
      if (give && get) return null;
      if (give) return 'give';
      if (get) return 'get';
    }
    return null;
  }

  // Badges a card gets where it is shown: missing, duplicate (×N), single copy (Unique), owned (received side).
  function badgeScope(img) {
    const side = pendingTradeSide(img);
    if (side === 'give') return { missing: false, dupes: settings.badgeDupes, single: settings.badgeDupes };
    if (side === 'get') return { missing: settings.badgeMissing, owned: settings.badgeDupes };
    const trade = inComposer(img);
    const path = location.pathname;
    if (path.startsWith('/marche') && !trade) return { missing: false, dupes: false, single: false };
    return { missing: settings.badgeMissing, dupes: settings.badgeDupes && (trade || path === '/collection'), single: settings.badgeDupes && trade };
  }

  const MIN_SIZE = 48; // avatars and tiny chips stay clean
  // Puts the right badge on a card picture, or removes it.
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
      } else if (q > 0 && scope.owned) {
        kind = 'owned';
        text = q > 1 ? `Possédée ×${q}` : 'Possédée';
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

  // Badges every card picture of an element.
  function scanBadges(root = document) {
    if (root.nodeType !== 1 && root !== document) return;
    if (root.tagName === 'IMG') return tag(root);
    root.querySelectorAll?.('img[src*="/cards/"]').forEach(tag);
  }

  // ---------- completed albums ----------

  // "owned/total" of an album tile.
  const albumCount = (li) => (li.querySelector('.a-meta')?.textContent ?? '').replace(/[\s  ]/g, '').match(/(\d+)\/(\d+)/);

  // True for a completed album tile.
  function albumComplete(li) {
    const m = albumCount(li);
    if (m) return Number(m[1]) >= Number(m[2]);
    const bar = li.querySelector('.bar > span');
    if (bar && /^100(\.0+)?%$/.test(bar.style.width)) return true;
    const s = seriesIndex()?.get(norm(li.querySelector('.a-name')?.textContent));
    return s ? s.owned >= s.total : false;
  }

  // True for a series with fewer than 5 characters in the catalog.
  const SMALL = 5;
  function albumSmall(li) {
    const m = albumCount(li);
    if (m) return Number(m[2]) < SMALL;
    const s = seriesIndex()?.get(norm(li.querySelector('.a-name')?.textContent));
    return s ? s.total < SMALL : false;
  }

  const PAGE = 60; // the site renders albums 60 at a time behind an "Afficher plus" button
  let autoMore = 0;

  // Hides the completed and small series of the Collection album list.
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
    // Loads the site's next albums until a full page of visible ones shows.
    const more = list.nextElementSibling?.matches('button') ? list.nextElementSibling : list.nextElementSibling?.querySelector('button');
    if (filtering && visible < PAGE && more && autoMore < 40) {
      autoMore++;
      more.click();
    } else if (!more || visible >= PAGE) {
      autoMore = 0;
    }
  }

  // The two toggles (complete series, small series) in the site's album toolbar.
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

  // One toggle of the album toolbar.
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

  // Each missing card of the Collection grid shown greyed out with its name, instead of the site's "?".
  function scanMissing() {
    // Removes the buy order row of a card that is no longer missing.
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

  // Row under each missing card: its fair price and a button opening the buy order form.
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

  // Calls the Kyara API from the page with the site's session, device id and anti-bot pass.
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

  // Buy order row under one missing card.
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

  // Buy order dialog: price and quantity, with the minimum, lowest offer, median and best order.
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

  // A click on an owned card of the Collection grid opens its wiki page instead of the site's window.
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
      link.click();
      link.remove();
    },
    true
  );

  // ---------- favourite series (œuvres) and the "★ Favoris" filter of the market ----------

  // True for an element laid out on the page (not display: none, nor inside a hidden parent).
  const onScreen = (el) => !!el && el.getClientRects().length > 0;

  // Text made safe for HTML.
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // A star on each album of Collection marks a series as a favourite; the market's "★ Favoris" chip shows their offers.
  let favSeries = new Set();
  let marketFav = false;
  let tradeFav = false; // "★ Favoris" of the trade composer
  let collectionFav = false; // "★ Favoris" of the Collection cards
  let boardFav = false; // "★ Favoris" of the market's trade offers
  let marketShown = '';

  // Adds or removes a favourite series.
  async function toggleFav(name) {
    if (!alive()) return shutdown();
    const next = new Set(favSeries);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    favSeries = new Set([...next].sort((a, b) => a.localeCompare(b, 'fr')));
    marketShown = '';
    scanFavStars();
    scanMarket();
    await chrome.storage.local.set({ favSeries: [...favSeries] });
  }

  // Star button of an album (inline: in the album bar).
  function favButton(inline) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = inline ? 'kyx-fav inline' : 'kyx-fav';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFav(btn.dataset.series);
    });
    return btn;
  }

  // Shows whether the series is a favourite.
  function setStar(star, name, inline) {
    const on = favSeries.has(name);
    star.dataset.series = name;
    const text = inline ? (on ? '★ Favori' : '☆ Mettre en favori') : on ? '★' : '☆';
    if (star.textContent !== text) star.textContent = text;
    star.setAttribute('aria-pressed', String(on));
    const title = on ? `Retirer ${name} des favoris` : `Mettre ${name} en favori (filtres « Favoris » de la Collection et du Marché)`;
    if (star.title !== title) {
      star.title = title;
      star.setAttribute('aria-label', title);
    }
  }

  // Stars on the album tiles and in the bar of the open album.
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
  let favOnly = null; // a single favourite series, or all of them

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

  // Current values of the site's market filters, applied to the favourites too.
  const marketFilters = () => (location.pathname === '/marche' ? document.querySelector('#mq')?.closest('.filters') : null);
  // The site's sort select, and the label of its "Univers" select, in a row of market filters.
  const sortSelect = (row) => row?.querySelector('select option[value="price_asc"]')?.parentElement ?? null;
  const universeLabel = (row) =>
    [...(row?.querySelectorAll(':scope > label:not(.kyx-fav-pick)') ?? [])].find((l) => {
      const sel = l.querySelector(':scope > select');
      return sel && sel !== sortSelect(row);
    }) ?? null;
  // The row with "Univers", sort, prices and pills: in the filter bar on a computer, in the "Filtres" sheet on a phone (while open).
  // (A phone keeps a hidden copy in the bar: the row on screen comes first.)
  function marketRow(filters) {
    const rows = [filters?.querySelector('.row2'), ...document.querySelectorAll('[role="dialog"] .row2')].filter((row) => sortSelect(row));
    return rows.find(onScreen) ?? rows[0] ?? null;
  }

  // Values of that row, kept for when the phone sheet is closed.
  let rowValues = { sort: 'ending', min: '', max: '', missing: false, wished: false };
  // The site's filters as request parameters.
  function siteFilters(filters) {
    const row = marketRow(filters);
    if (row) {
      const price = [...row.querySelectorAll('label.price input')];
      const amount = (input) => (input && input.value !== '' && Number(input.value) >= 0 ? String(Math.round(Number(input.value))) : '');
      const pill = (re) => [...row.querySelectorAll('button.pill')].find((b) => re.test(b.textContent))?.getAttribute('aria-pressed') === 'true';
      rowValues = { sort: sortSelect(row)?.value || 'ending', min: amount(price[0]), max: amount(price[1]), missing: pill(/n.ai pas/i), wished: pill(/cherche/i) };
    }
    return {
      q: filters?.querySelector('#mq')?.value.trim() ?? '',
      rarity: siteRarity(filters?.querySelector('.chips')),
      ...rowValues,
      type: new URLSearchParams(location.search).get('onglet') === 'encheres' ? 'auction' : 'fixed'
    };
  }

  // Asks the favourites again a moment after a filter of the site changes.
  let marketTimer = 0;
  function marketLater(ms) {
    if (!marketFav) return;
    clearTimeout(marketTimer);
    marketTimer = setTimeout(() => {
      const view = document.querySelector('.kyx-favmarket');
      if (view?.kyxState) loadFavOffers(view, true);
    }, ms);
  }
  // Watches the site's filters in an element (the filter bar, or the phone "Filtres" sheet).
  function watchMarket(el) {
    if (!el || el.dataset.kyxWatch) return;
    el.dataset.kyxWatch = '1';
    const ours = (e) => e.target.closest?.('.kyx-fav-pick, .kyx-chip');
    el.addEventListener('input', (e) => ours(e) || marketLater(500));
    el.addEventListener('change', (e) => ours(e) || marketLater(150));
    el.addEventListener('click', (e) => ours(e) || !e.target.closest('button') || marketLater(150));
  }

  // "★ Favoris" chip of the market and the favourites view.
  function scanMarket() {
    const filters = marketFilters();
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
    // Asks the favourites again when a filter of the site changes, in the bar or in the phone sheet.
    watchMarket(filters);
    const row = marketRow(filters);
    if (row && !filters.contains(row)) {
      watchMarket(row.parentElement);
      siteFilters(filters); // keeps the sheet's values for when it closes
    }
    const universe = universeLabel(row);
    if (universe) {
      if (marketFav && universe.dataset.kyxHidden !== '1') universe.dataset.kyxHidden = '1';
      else if (!marketFav && universe.dataset.kyxHidden) delete universe.dataset.kyxHidden;
    }
    favPicker(row, universe);
    // Hides the site's offers while the favourites are shown.
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
      view.kyxState = {};
      filters.after(view);
    }
    // Shows the favourites again when they, the finished albums or the tab (buy, auctions) change.
    const key = `${openFavourites().join('|')}#${siteFilters(filters).type}`;
    if (marketShown === key && view.childElementCount) return;
    marketShown = key;
    renderFavMarket(view);
  }

  // Favourite series still to complete: the market looks for nothing in a finished album (all of them while the collection is unknown).
  function openFavourites() {
    const index = seriesIndex();
    if (!index) return [...favSeries];
    return [...favSeries].filter((name) => {
      const s = index.get(norm(name));
      return !s || s.owned < s.total;
    });
  }

  // "★ Favoris" list in the site's filter row (or phone sheet), where its "Univers" list was: all favourites still to complete or a single one.
  function favPicker(row, universe) {
    let pick = row?.querySelector(':scope > .kyx-fav-pick');
    if (!marketFav || !row) return void pick?.remove();
    const names = openFavourites();
    if (favOnly && !names.includes(favOnly)) favOnly = null;
    if (!pick) {
      pick = document.createElement('label');
      pick.className = `kyx-fav-pick ${universe?.className ?? ''}`;
      pick.innerHTML = `★ Favoris <select class="${esc(universe?.querySelector('select')?.className ?? '')}"></select>
        <button type="button" class="kyx-fav-del" hidden>Retirer des favoris</button>`;
      const select = pick.querySelector('select');
      const del = pick.querySelector('.kyx-fav-del');
      select.addEventListener('change', () => {
        favOnly = select.value || null;
        del.hidden = !favOnly;
        const view = document.querySelector('.kyx-favmarket');
        if (view?.kyxState) loadFavOffers(view, true);
      });
      del.addEventListener('click', (e) => {
        e.preventDefault();
        const name = favOnly;
        favOnly = null;
        if (name) toggleFav(name);
      });
      if (universe) universe.before(pick);
      else row.prepend(pick);
    }
    const select = pick.querySelector('select');
    const done = favSeries.size - names.length;
    const key = `${names.join('|')}#${done}`;
    if (pick.dataset.key !== key) {
      pick.dataset.key = key;
      select.innerHTML = '';
      const hidden = done ? ` · ${done} complète${done > 1 ? 's' : ''} masquée${done > 1 ? 's' : ''}` : '';
      select.add(new Option(`Toutes mes favorites (${names.length}${hidden})`, ''));
      for (const name of names) select.add(new Option(name, name));
      pick.title = done ? 'Les œuvres favorites dont tu as tous les persos ne sont pas cherchées.' : '';
    }
    select.value = favOnly ?? '';
    pick.querySelector('.kyx-fav-del').hidden = !favOnly;
  }

  // Favourites view: status line, offers, "Voir plus d'offres".
  function renderFavMarket(view) {
    if (!favSeries.size) {
      view.innerHTML = '<p class="kyx-fm-note">Aucune œuvre en favori pour l’instant. Sur la page <a href="/collection">Collection</a>, onglet Albums, touche l’étoile ☆ d’un album pour l’ajouter.</p>';
      return;
    }
    view.innerHTML = `
      <div class="kyx-fm-status"><p class="kyx-fm-note" role="status"></p><button type="button" class="kyx-fm-refresh">↻ Actualiser</button></div>
      <ul class="kyx-fm-grid"></ul>
      <button type="button" class="kyx-fm-more" hidden>Voir plus d’offres</button>`;
    view.querySelector('.kyx-fm-more').addEventListener('click', () => loadFavOffers(view, false));
    view.querySelector('.kyx-fm-refresh').addEventListener('click', () => loadFavOffers(view, 'refresh'));
    loadFavOffers(view, true);
  }

  // Refreshes the favourites every 15 seconds while shown, and when coming back to the tab.
  const FAV_REFRESH = 15e3;
  // Asks the shown offers again.
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

  // Offers of the favourite series (one request each), merged in the order the site uses.
  async function loadFavOffers(view, mode) {
    const st = view.kyxState;
    const run = (view.kyxRun = (view.kyxRun ?? 0) + 1);
    const f = siteFilters(marketFilters());
    const names = favOnly ? [favOnly] : openFavourites().slice(0, 30);
    const refresh = mode === 'refresh' && st.page > 0;
    if (mode === true || (mode === 'refresh' && !refresh)) {
      st.page = 0;
      st.offers = [];
      st.more = false;
      view.querySelector('.kyx-fm-grid').innerHTML = '';
    }
    const page = refresh ? 1 : st.page + 1;
    const size = refresh ? 24 * st.page : 24;
    const note = view.querySelector('.kyx-fm-note');
    const more = view.querySelector('.kyx-fm-more');
    if (!note) return;
    if (!names.length) {
      more.hidden = true;
      view.querySelector('.kyx-fm-grid').innerHTML = '';
      note.textContent = 'Tu as tous les persos de tes œuvres favorites : rien à chercher. Ajoute d’autres œuvres avec l’étoile ☆ des albums, page Collection.';
      return;
    }
    if (!refresh) note.textContent = 'Chargement des offres…';
    more.hidden = true;
    const answers = await Promise.all(
      names.map((series) => {
        const q = new URLSearchParams({ type: f.type, sort: f.sort, series, page: String(page), pageSize: String(size) });
        if (f.q) q.set('q', f.q);
        if (f.rarity) q.set('rarity', f.rarity);
        if (f.min) q.set('minPrice', f.min);
        if (f.max) q.set('maxPrice', f.max);
        if (f.missing) q.set('missing', '1');
        if (f.wished) q.set('wished', '1');
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
    }[f.sort] ?? ((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
    st.offers.sort(by);
    const total = answers.reduce((n, a) => n + (a?.total ?? 0), 0);
    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const scope = [
      favOnly ?? `${names.length} œuvre${names.length > 1 ? 's' : ''} en favori`,
      f.type === 'auction' ? 'enchères' : null,
      f.rarity ? RARITY_LABEL[f.rarity] : null
    ]
      .filter(Boolean)
      .join(' · ');
    note.textContent = st.offers.length
      ? `${num(st.offers.length)} offre${st.offers.length > 1 ? 's' : ''} affichée${st.offers.length > 1 ? 's' : ''} sur ${num(total)} · ${scope} · à jour à ${time}, actualisé toutes les 15 s.`
      : `Aucune offre en ce moment · ${scope} · vérifié à ${time}.`;
    more.hidden = !st.more;
    renderFavOffers(view);
  }

  // One tile per offer, opening the site's own offer window.
  function renderFavOffers(view) {
    const grid = view.querySelector('.kyx-fm-grid');
    grid.innerHTML = '';
    for (const o of view.kyxState.offers) {
      const c = o.character ?? {};
      const url = new URL(location.href);
      url.searchParams.set('annonce', o.id);
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

  // ---------- recycling: how many duplicates per rarity ----------

  // How many duplicates to recycle per rarity, inside the site's recycling box.
  const RECYCLE_VALUE = { C: 1, U: 1, R: 3, E: 10, L: 40, M: 150 };
  // Copies of a card that can be recycled: never the last one, nor locked or on sale.
  const spare = (x) => (x && !x.pinned ? Math.max(0, (x.qty ?? 0) - (x.locked ?? 0) - 1) : 0);

  // Recyclable cards by rarity, the most spare copies first.
  async function recyclePlan() {
    const items = collectionItems(await siteApi('/me/collection?lean=1'));
    const by = {};
    for (const x of items) {
      const r = catalog?.get(x.characterId ?? x.id)?.r;
      const n = spare(x);
      if (!r || !n) continue;
      (by[r] ??= []).push({ id: x.characterId ?? x.id, n });
    }
    for (const r in by) by[r].sort((a, b) => b.n - a.n);
    return by;
  }

  // Adds the block to the site's recycling box.
  function scanRecycle() {
    const box = location.pathname === '/collection' ? document.querySelector('.rec-box') : null;
    if (!box || box.querySelector(':scope > .kyx-rec') || !catalog) return;
    const block = document.createElement('div');
    block.className = 'kyx-rec';
    block.innerHTML = '<p class="kyx-rec-t">Ou choisis combien de doublons recycler par rareté :</p><p class="kyx-rec-msg">Chargement de tes doublons…</p>';
    const actions = box.querySelector(':scope > .rec-a');
    if (actions) actions.before(block);
    else box.appendChild(block);
    recyclePlan().then(
      (plan) => block.isConnected && renderRecycle(block, plan),
      () => (block.querySelector('.kyx-rec-msg').textContent = 'Impossible de charger tes doublons.')
    );
  }

  // One field per rarity; recycles the chosen numbers card by card after a confirmation.
  function renderRecycle(block, plan) {
    const order = ['C', 'U', 'R', 'E', 'L', 'M'].filter((r) => plan[r]?.length);
    if (!order.length) return void (block.querySelector('.kyx-rec-msg').textContent = 'Aucun doublon à recycler.');
    const max = (r) => plan[r].reduce((n, c) => n + c.n, 0);
    block.innerHTML = `
      <p class="kyx-rec-t">Ou choisis combien de doublons recycler par rareté :</p>
      <div class="kyx-rec-grid">${order
        .map(
          (r) => `<label style="--r:${RARITY_COLOR[r]}"><b>${RARITY_LABEL[r]}</b>
            <input type="number" min="0" max="${max(r)}" step="1" value="0" data-r="${r}" inputmode="numeric" />
            <small>sur ${num(max(r))} · +${RECYCLE_VALUE[r]} ◆ l’un</small></label>`
        )
        .join('')}</div>
      <div class="kyx-rec-btns">
        <button type="button" class="kyx-rec-all">Tout</button>
        <button type="button" class="kyx-rec-none">Rien</button>
        <button type="button" class="kyx-rec-go" disabled>Recycler</button>
      </div>
      <p class="kyx-rec-msg" role="status"></p>`;
    const inputs = [...block.querySelectorAll('input[data-r]')];
    const go = block.querySelector('.kyx-rec-go');
    const msg = (t, kind = '') => {
      block.querySelector('.kyx-rec-msg').textContent = t;
      block.querySelector('.kyx-rec-msg').dataset.kind = kind;
    };
    const wanted = () => Object.fromEntries(inputs.map((i) => [i.dataset.r, Math.max(0, Math.min(max(i.dataset.r), Math.floor(Number(i.value) || 0)))]));
    let confirm = false;
    const update = () => {
      confirm = false;
      const w = wanted();
      const count = Object.values(w).reduce((a, b) => a + b, 0);
      const gain = Object.entries(w).reduce((a, [r, n]) => a + n * RECYCLE_VALUE[r], 0);
      go.disabled = !count;
      go.textContent = count ? `Recycler ${num(count)} doublon${count > 1 ? 's' : ''} · +${num(gain)} ◆` : 'Recycler';
      msg('');
    };
    inputs.forEach((i) => i.addEventListener('input', update));
    block.querySelector('.kyx-rec-all').addEventListener('click', () => (inputs.forEach((i) => (i.value = i.max)), update()));
    block.querySelector('.kyx-rec-none').addEventListener('click', () => (inputs.forEach((i) => (i.value = 0)), update()));
    go.addEventListener('click', async () => {
      const w = wanted();
      // A second click confirms, with a warning for the rare ones.
      if (!confirm) {
        confirm = true;
        const rare = ['L', 'M'].filter((r) => w[r]).map((r) => `${w[r]} ${RARITY_LABEL[r]}${w[r] > 1 ? 's' : ''}`);
        go.textContent = 'Confirmer le recyclage';
        msg(`${rare.length ? `⚠ Dont ${rare.join(' et ')}. ` : ''}Tu gardes toujours au moins 1 exemplaire de chaque carte. Clique à nouveau pour confirmer.`, rare.length ? 'warn' : '');
        return;
      }
      const jobs = [];
      for (const [r, n] of Object.entries(w)) {
        let left = n;
        for (const c of plan[r] ?? []) {
          if (left <= 0) break;
          const k = Math.min(c.n, left);
          jobs.push([c.id, k]);
          left -= k;
        }
      }
      const total = jobs.reduce((a, [, k]) => a + k, 0);
      block.querySelectorAll('button, input').forEach((el) => (el.disabled = true));
      let done = 0;
      let failed = false;
      for (const [id, k] of jobs) {
        msg(`Recyclage… ${num(done)}/${num(total)}`);
        try {
          await siteApi(`/me/collection/${id}/recycle`, { method: 'POST', body: { qty: k } });
        } catch (e) {
          if (e?.code === 'rate_limited') {
            await wait(3000);
            try {
              await siteApi(`/me/collection/${id}/recycle`, { method: 'POST', body: { qty: k } });
            } catch {
              failed = true;
              break;
            }
          } else {
            failed = true;
            break;
          }
        }
        done += k;
        await wait(120);
      }
      msg(failed ? `Arrêté en route : ${num(done)} doublon${done > 1 ? 's' : ''} recyclé${done > 1 ? 's' : ''}. La page va se recharger.` : `${num(done)} doublon${done > 1 ? 's' : ''} recyclé${done > 1 ? 's' : ''} ✔ La page va se recharger.`, failed ? 'err' : 'ok');
      setTimeout(() => location.reload(), 1800);
    });
    update();
  }

  // ---------- "Bloquer sauf doublons" in the album bar ----------

  // "Bloquer sauf doublons": in a series, only the cards held once are locked, as the collection changes.
  let smartLock = new Set(); // series names
  let pinning = false;
  // Pause.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Items of a /me/collection answer.
  const collectionItems = (body) => (Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : []);

  // Copies not on sale nor in a trade.
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

  // Locks a card whose duplicate is on sale when a single free copy is left.
  function listedPlan(items) {
    const changes = [];
    for (const x of items) {
      const onSale = x.escrow ? !!x.escrow.listings : (x.locked ?? 0) > 0;
      if (!x.pinned && onSale && (x.locked ?? 0) > 0 && freeCopies(x) === 1) changes.push([x.characterId ?? x.id, true]);
    }
    return changes;
  }

  // Locks or unlocks cards one by one.
  async function applyPins(changes) {
    for (const [id, pinned] of changes) {
      await siteApi(`/me/collection/${id}/pin`, { method: 'POST', body: { pinned } });
      await wait(150);
    }
  }

  // Applies those locks each time the site reloads the collection.
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

  // Turns the mode on or off for a series.
  async function setSmart(series, on) {
    if (on) smartLock.add(series);
    else smartLock.delete(series);
    if (!alive()) return shutdown();
    await chrome.storage.local.set({ smartLock: [...smartLock] });
  }

  // Message under the album bar.
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

  // Click on "Bloquer sauf doublons": locks the cards of the series held once.
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
      location.reload();
    } catch (e) {
      const code = e?.code ?? String(e);
      barMsg(bar, ORDER_ERRORS[code] ?? `Échec (${code}).`, true);
      btn.disabled = false;
      scanAlbumBar();
    } finally {
      pinning = false;
    }
  }

  // "Bloquer sauf doublons" button in the bar of the open album.
  function scanAlbumBar() {
    const bar = location.pathname === '/collection' ? document.querySelector('.album-bar') : null;
    const series = bar?.querySelector(':scope > b')?.textContent.trim();
    if (!series) return;
    const siteBtn = [...bar.querySelectorAll(':scope > button:not(.kyx-smart)')].find((b) => /loquer l.album/i.test(b.textContent));
    // The site's "Bloquer / Débloquer l'album" button stops this mode for the series.
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

  // Keeps the "Séries complètes" card to the height of the referral card, with the total in its title.
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

  // Number in French format.
  const num = (n, digits = 0) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: digits });

  // Main value, unit and side value of each tab of the ranking.
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

  // One player's row of a ranking, kept 5 minutes.
  async function ladderRow(by, id) {
    const key = `${by}|${id}`;
    const hit = ladderCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60e3) return hit.row;
    const res = await siteApi(`/leaderboard/ladder?by=${by}&me=${encodeURIComponent(id)}`, { auth: false }).catch(() => null);
    const row = res?.me ?? null;
    ladderCache.set(key, { at: Date.now(), row });
    return row;
  }

  // Ids of the user's friends.
  async function friendIds() {
    const res = await siteApi('/me/friends');
    const list = Array.isArray(res) ? res : res?.friends ?? res?.items ?? [];
    return list.map((f) => (f.user ?? f.friend ?? f).id ?? f.userId).filter((id) => id != null);
  }

  // "Amis" button among the ranking tabs, and the friends ranking.
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
    // Hides the site's podium and lists while the filter is on.
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

  // Style class (svelte-xxxx) of an element of the site, read from the page.
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

  // Same as the site's badges next to a pseudo.
  const badgesHtml = (row, n, sc) =>
    (row.badges ?? [])
      .slice(0, n)
      .map((b) => `<span class="bd ${b.frame === 'gold' && !String(b.id).startsWith('membre-') ? 'gold' : ''} ${b.frame === 'staff' ? 'staff' : ''} ${sc}" title="${esc(b.label)}">${esc(b.kanji)}</span>`)
      .join('');

  // Friends ranking: podium then list, in the site's markup.
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

  // ---------- pages of the extension, in the site's "Plus" menu ----------

  const BOOSTERS_HASH = '#boosters-rentables';
  const SUBS_HASH = '#kyx-abonnes';

  // Pages shown in place of the site's content: address, view name, menu entry (class, kanji, title, hint).
  const VIEWS = [
    { hash: BOOSTERS_HASH, view: 'boosters', cls: 'kyx-more', kanji: '得', title: 'Boosters rentables', hint: 'Le meilleur booster pour une carte', open: () => openBoosters() },
    { hash: SUBS_HASH, view: 'abonnes', cls: 'kyx-subs-entry', kanji: '恥', title: 'Mur de la Honte', hint: 'Les abos du site', open: () => openSubscribers() }
  ];
  const VIEW_ENTRIES = VIEWS.map((v) => `.${v.cls}`).join(', ');
  // True while the page of v is shown.
  const viewOpen = (v) => document.documentElement.dataset.kyxView === v.view;

  // Entries of the pages at the end of the site's "Plus" menu, before "Tutoriel".
  function scanMoreMenu() {
    const menu = document.querySelector('#nav-more');
    if (!menu) return;
    // Marks the entry of the open page as the current one.
    if (VIEWS.some(viewOpen)) menu.querySelectorAll(`:scope > a.on:not(${VIEW_ENTRIES})`).forEach((a) => a.classList.remove('on'));
    const model = menu.querySelector(':scope > a');
    for (const v of VIEWS) {
      let item = menu.querySelector(`:scope > .${v.cls}`);
      if (!item) {
        if (!model?.querySelector('.dk') || !model.querySelector('.dt b') || model.matches(VIEW_ENTRIES)) return;
        item = model.cloneNode(true);
        item.classList.add(v.cls);
        item.removeAttribute('aria-current');
        item.href = v.hash;
        item.querySelector('.dk').textContent = v.kanji;
        item.querySelector('.dt b').textContent = v.title;
        const hint = item.querySelector('.dt small');
        if (hint) hint.textContent = v.hint;
        [...item.children].forEach((el) => el.matches('.dk, .dt') || el.remove());
        item.addEventListener('click', (e) => {
          e.preventDefault();
          document.querySelector('button[aria-controls="nav-more"][aria-expanded="true"]')?.click(); // close the menu
          v.open();
        });
        menu.insertBefore(item, menu.querySelector(':scope > .kyx-tuto-entry'));
      }
      item.classList.toggle('on', viewOpen(v));
    }
  }

  // ---------- the phone "Plus" sheet of the site's bottom bar ----------

  // List of links of the "Plus" sheet (bottom bar nav.mb), while it is open.
  const plusSheet = () => [...document.querySelectorAll('[role="dialog"] > ul')].find((ul) => ul.querySelector(':scope > li > a > .k')) ?? null;
  // Closes the sheet, as a tap on its dark backdrop does.
  const closePlusSheet = () => plusSheet()?.closest('[role="dialog"]')?.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  // Adds a link to the sheet, like the site's: kanji, label, action.
  function addSheetEntry(cls, kanji, label, act) {
    const list = plusSheet();
    if (!list || list.querySelector(`:scope > li > .${cls}`)) return null;
    const model = list.querySelector(':scope > li');
    const link = model?.querySelector(':scope > a');
    const mark = link?.querySelector(':scope > .k');
    if (!mark) return null;
    const li = document.createElement('li');
    li.className = model.className;
    const a = document.createElement('a');
    a.className = link.className;
    a.classList.remove('on');
    a.classList.add(cls);
    a.href = '#';
    const k = mark.cloneNode(false);
    k.textContent = kanji;
    a.append(k, ` ${label} `);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      closePlusSheet();
      act();
    });
    li.appendChild(a);
    list.appendChild(li);
    return a;
  }

  // The same entries in the site's phone menus: the older #mobile-nav grid and the "Plus" sheet of the bottom bar.
  function scanMobileNav() {
    const open = VIEWS.some(viewOpen);
    for (const v of VIEWS) {
      const link = plusSheet()?.querySelector(`:scope > li > .${v.cls}`) ?? addSheetEntry(v.cls, v.kanji, v.title, v.open);
      link?.classList.toggle('on', viewOpen(v));
    }
    if (open) plusSheet()?.querySelectorAll(`:scope > li > a.on:not(${VIEW_ENTRIES})`).forEach((a) => a.classList.remove('on'));
    scanMobileGrid(open);
  }

  // Entries of the #mobile-nav grid.
  function scanMobileGrid(open) {
    const grid = document.querySelector('#mobile-nav .sheet-grid');
    if (!grid) return;
    if (open) grid.querySelectorAll(`:scope > a.on:not(${VIEW_ENTRIES})`).forEach((a) => a.classList.remove('on'));
    const model = grid.querySelector(':scope > a');
    for (const v of VIEWS) {
      let tile = grid.querySelector(`:scope > .${v.cls}`);
      if (!tile) {
        if (!model?.querySelector('.tk') || !model.querySelector('.tl') || model.matches(VIEW_ENTRIES)) return;
        tile = model.cloneNode(true);
        tile.classList.add(v.cls);
        tile.removeAttribute('aria-current');
        tile.href = v.hash;
        tile.querySelector('.tk').textContent = v.kanji;
        tile.querySelector('.tl').textContent = v.title;
        [...tile.children].forEach((el) => el.matches('.tk, .tl') || el.remove());
        tile.addEventListener('click', (e) => {
          e.preventDefault();
          document.querySelector('button.burger[aria-controls="mobile-nav"]')?.click(); // close the sheet
          v.open();
        });
        grid.insertBefore(tile, grid.querySelector(':scope > .kyx-tuto-entry'));
      }
      tile.classList.toggle('on', viewOpen(v));
    }
  }

  let packsCache = null;
  const dropCache = new Map(); // id -> { packId: chance per booster }

  // Boosters on sale right now (not the reward-only ones), kept until midnight.
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

  // Chance of each character per booster, asked 4 at a time and cached.
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
  // "N boosters".
  const boosters = (n) => `${num(n)} booster${n >= 2 ? 's' : ''}`;

  // Ranking criterion, "price" or "drop", remembered in this browser.
  let rankBy = 'price';
  try {
    if (localStorage.getItem('kyx-rank-by') === 'drop') rankBy = 'drop';
  } catch {}

  // Shows the boosters ranked by price or by drop rate.
  // rows: [{ pack, hits: wanted cards per booster on average, chance: chance of at least one per booster }].
  // what: what is looked for, as in "pour avoir {what}".
  function renderPacks(page, rows, what) {
    page.kyxLast = [rows, what];
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
      // Bar: share of the best drop rate, or of the cheapest paid booster's cost.
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
      li.querySelector('a').addEventListener('click', closeView);
      list.appendChild(li);
    });
  }

  // Leaves the open page of the extension.
  function closeView() {
    document.querySelector('.kyx-view')?.remove();
    const main = document.querySelector('main#contenu');
    if (main?.dataset.kyxHidden) delete main.dataset.kyxHidden;
    delete document.documentElement.dataset.kyxView;
    refreshBoosters = null;
    refreshSubs = null;
    showExport = null;
  }

  // The "Pack du jour" changes at midnight, French time: rankings are computed again then.
  const parisDay = () => new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
  let boostersDay = parisDay();
  let refreshBoosters = null; // computes the ranking on screen again

  // After midnight (Paris), forgets the boosters and chances and ranks again.
  function checkBoostersDay() {
    const day = parisDay();
    if (day === boostersDay) return;
    boostersDay = day;
    packsCache = null;
    dropCache.clear();
    refreshBoosters?.();
  }

  // Opens the page of the address, or closes the open one.
  function onViewHash() {
    const v = VIEWS.find((x) => x.hash === location.hash);
    if (document.querySelector('.kyx-view') && !(v && viewOpen(v))) closeView();
    v?.open();
  }

  // Shows a page in place of the site's content; null when it is already shown or the address changes first.
  function mountView(hash, view, html) {
    if (!alive()) return void shutdown();
    if (location.hash !== hash) return void (location.hash = hash);
    const main = document.querySelector('main#contenu');
    if (!main || document.querySelector('.kyx-view')) return null;
    document.querySelector('.kyx-modal-back')?.remove();
    const page = document.createElement('section');
    page.className = 'kyx-view kyx-page wrap';
    page.setAttribute('aria-labelledby', 'kyx-view-t');
    page.innerHTML = html;
    main.dataset.kyxHidden = '1';
    main.after(page);
    document.documentElement.dataset.kyxView = view; // "Plus" underlined in the site's header
    window.scrollTo(0, 0);
    page.querySelector('.kyx-page-close').addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '')));
    return page;
  }

  // Builds the page: modes (rarity, character, series), search and ranking.
  function openBoosters() {
    const page = mountView(
      BOOSTERS_HASH,
      'boosters',
      `
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
        <p class="kyx-page-foot">Comment c’est calculé : avec les taux publiés par le site, on compte combien de boosters il faut ouvrir en moyenne pour tomber une fois sur ce que tu cherches, puis combien de chakra ça représente (nombre de boosters × prix du booster). Classé par <b>prix</b>, la barre compare au meilleur achat : 50 % veut dire deux fois plus cher pour le même résultat. Classé par <b>taux de drop</b>, elle compare au meilleur taux : 50 % veut dire deux fois moins de chances à chaque booster, quel que soit son prix. Ce sont des moyennes, la chance peut faire mieux ou pire. Cliquer sur un booster ouvre sa page, rien n’est acheté.</p>`
    );
    if (!page) return;
    const query = page.querySelector('.kyx-page-query');
    const note = (text) => (page.querySelector('.kyx-page-note').textContent = text);
    let run = 0; // answers of an older search are dropped

    // Ranking for one character.
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

    // Ranking for one rarity.
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

    // Ranking for the cards (or the missing cards) of a series.
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
      // Closes the suggestions on a click elsewhere.
      page.addEventListener('click', (e) => e.target.closest('.kyx-search-wrap') || (suggest.hidden = true));
      input.focus();
      if (!catalog) note('Catalogue pas encore chargé, réessaie dans un instant.');
      return input;
    }

    // Switches between rarity, character and series.
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
    forRarity('M');
  }

  // ---------- "Mur de la Honte" page: the players who have a subscription ----------

  // Subscription tiers from the cheapest, replaced by the site's offer once loaded.
  let subTiers = [
    { id: 'nakama', name: 'Nakama', kanji: '仲間', price: 4.99 },
    { id: 'senpai', name: 'Senpai', kanji: '先輩', price: 9.99 },
    { id: 'sensei', name: 'Sensei', kanji: '師', price: 16.99 },
    { id: 'daimyo', name: 'Daimyō', kanji: '大名', price: 24.99 }
  ];
  const SUBS_EXPORTERS = ['e431c603-0a94-40d2-b45e-2fec48015a6e']; // Kyara ids of the accounts that see the "Exporter" button
  let refreshSubs = null; // shows the saved subscribers again while the page is open
  let showExport = null; // shows a step of the export to GitHub
  let subsTier = 'all';

  // "24,99 €".
  const euros = (n) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  // Tiers and prices of the site's offer.
  async function loadSubTiers() {
    const offer = await siteApi('/membership', { auth: false }).catch(() => null);
    const list = (offer?.tiers ?? [])
      .map((t) => ({ id: t.id, name: t.name, kanji: t.kanji, price: parseFloat(String(t.priceLabel ?? '').replace(',', '.')) || 0 }))
      .filter((t) => t.id);
    if (list.length) subTiers = list;
  }

  // Shows the figures and the list of the saved subscribers.
  function renderSubscribers(page, known) {
    const all = Object.values(known);
    const rank = new Map(subTiers.map((t, i) => [t.id, i]));
    const tierInfo = (id) => subTiers.find((t) => t.id === id) ?? { id, name: id, kanji: '援', price: 0 };
    const avg = (list, k) => {
      const v = list.map((s) => s[k]).filter((n) => Number.isFinite(n));
      return v.length ? num(v.reduce((a, b) => a + b, 0) / v.length) : '–';
    };

    const monthly = all.reduce((sum, s) => sum + tierInfo(s.tier).price, 0);
    page.querySelector('.kyx-s-figures').innerHTML = `
      <div class="kyx-s-fig"><b>${num(all.length)}</b><small>abonnés repérés</small></div>
      <div class="kyx-s-fig"><b>≈ ${euros(monthly)}</b><small>par mois, au prix affiché</small></div>
      ${[...subTiers]
        .reverse()
        .map((t) => {
          const list = all.filter((s) => s.tier === t.id);
          return `<div class="kyx-s-fig" data-tier="${esc(t.id)}"><b>${num(list.length)}</b><small>${esc(t.kanji)} ${esc(t.name)} · ${all.length ? num((list.length / all.length) * 100) : 0} %</small><small>moy. ${avg(list, 'owned')} cartes · ${avg(list, 'mythics')} mythiques</small></div>`;
        })
        .join('')}`;

    page.querySelectorAll('.kyx-s-tiers [data-tier]').forEach((b) => {
      const n = b.dataset.tier === 'all' ? all.length : all.filter((s) => s.tier === b.dataset.tier).length;
      b.querySelector('small').textContent = num(n);
      b.setAttribute('aria-pressed', String(b.dataset.tier === subsTier));
    });

    // List filtered by tier and pseudo, highest tier first.
    const q = norm(page.querySelector('.kyx-search input').value);
    const shown = all.filter((s) => (subsTier === 'all' || s.tier === subsTier) && (!q || norm(s.pseudo).includes(q)));
    shown.sort((a, b) => (rank.get(b.tier) ?? -1) - (rank.get(a.tier) ?? -1) || (b.owned ?? -1) - (a.owned ?? -1));
    const list = page.querySelector('.kyx-s-list');
    list.innerHTML = '';
    if (!shown.length) {
      list.innerHTML = `<li class="kyx-b-empty">${all.length ? 'Personne ne correspond.' : 'Aucun abonné repéré pour l’instant.'}</li>`;
      return;
    }
    // One badge per subscriber: profile picture and pseudo, edged with the tier's colour.
    for (const s of shown) {
      const li = document.createElement('li');
      li.innerHTML = `<a data-tier="${esc(s.tier)}"><span class="kyx-s-av"></span><b></b></a>`;
      const a = li.querySelector('a');
      a.href = `/profil/${encodeURIComponent(s.id)}`;
      a.title = tierInfo(s.tier).name;
      a.addEventListener('click', closeView);
      const av = li.querySelector('.kyx-s-av');
      if (s.avatar) av.appendChild(Object.assign(document.createElement('img'), { alt: '', referrerPolicy: 'no-referrer', loading: 'lazy', src: s.avatar }));
      else av.textContent = s.pseudo.slice(0, 1).toUpperCase();
      const name = li.querySelector('b');
      name.textContent = s.pseudo;
      if (s.color) name.style.color = s.color;
      list.appendChild(li);
    }
  }

  // Window listing the players without a subscription who use the extension, as badges like the wall's, with a search.
  async function openMembers() {
    document.querySelector('.kyx-modal-back')?.remove();
    const back = document.createElement('div');
    back.className = 'kyx-modal-back';
    back.innerHTML = `
      <div class="kyx-modal kyx-members" role="dialog" aria-modal="true" aria-label="Joueurs avec l’extension">
        <div class="kyx-members-head"><b>Joueurs avec l’extension</b><span class="kyx-members-count"></span><button type="button" class="kyx-members-close" aria-label="Fermer">✕</button></div>
        <label class="kyx-search"><input type="search" placeholder="Chercher un joueur…" autocomplete="off" /></label>
        <p class="kyx-members-note" role="status">Chargement…</p>
        <ol class="kyx-s-list"></ol>
      </div>`;
    document.body.appendChild(back);
    const onKey = (e) => e.key === 'Escape' && close();
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey);
    };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => e.target === back && close());
    back.querySelector('.kyx-members-close').addEventListener('click', close);
    const members = await send({ type: 'relay-members' });
    const note = back.querySelector('.kyx-members-note');
    if (!Array.isArray(members)) return void (note.textContent = 'Le relais ne répond pas, réessaie plus tard.');
    const sort = () => members.sort((a, b) => (a.pseudo === '?') - (b.pseudo === '?') || a.pseudo.localeCompare(b.pseudo, 'fr'));
    sort();
    back.querySelector('.kyx-members-count').textContent = num(members.length);
    const list = back.querySelector('.kyx-s-list');
    const input = back.querySelector('input');
    const draw = () => {
      const q = norm(input.value);
      const shown = members.filter((m) => !q || norm(m.pseudo).includes(q));
      note.textContent = shown.length ? '' : members.length ? 'Aucun joueur ne correspond.' : 'Personne pour l’instant.';
      list.replaceChildren();
      for (const m of shown) {
        const li = document.createElement('li');
        li.innerHTML = '<a data-tier="ext"><span class="kyx-s-av"></span><b></b></a>';
        const a = li.querySelector('a');
        a.href = `/profil/${encodeURIComponent(m.id)}`;
        a.addEventListener('click', () => (close(), closeView()));
        const av = li.querySelector('.kyx-s-av');
        if (m.avatar) av.appendChild(Object.assign(document.createElement('img'), { alt: '', referrerPolicy: 'no-referrer', loading: 'lazy', src: m.avatar }));
        else av.textContent = m.pseudo.slice(0, 1).toUpperCase();
        const name = li.querySelector('b');
        name.textContent = m.pseudo;
        if (m.color) name.style.color = m.color;
        list.appendChild(li);
      }
    };
    input.addEventListener('input', draw);
    draw();
    input.focus();

    // Players the relay knows without their pseudo: read from their public profile, 4 at a time.
    const unnamed = members.filter((m) => m.pseudo === '?' || !m.avatar);
    let redraw = 0;
    const next = async () => {
      for (let m; back.isConnected && (m = unnamed.shift()); ) {
        const p = await siteApi(`/users/${encodeURIComponent(m.id)}`, { auth: false }).catch(() => null);
        if (!p) continue;
        m.pseudo = p.pseudo ?? m.pseudo;
        m.avatar = p.avatar ?? m.avatar;
        m.color ??= p.nameColor ?? null;
        clearTimeout(redraw);
        redraw = setTimeout(() => back.isConnected && (sort(), draw()), 150);
      }
    };
    await Promise.all([next(), next(), next(), next()]);
  }

  // Updates abonnes.json in the repository with a GitHub token (asked once), or downloads the file without one.
  async function exportSubscribers(btn, progress) {
    let { githubToken: token } = await chrome.storage.local.get('githubToken');
    if (!token) {
      token = prompt('Jeton GitHub pour mettre à jour abonnes.json dans le dépôt.\nLaisse vide pour seulement télécharger le fichier.')?.trim();
      if (token === undefined) return;
      if (token) await chrome.storage.local.set({ githubToken: token });
    }
    if (!token) {
      const { subscribers = {} } = await chrome.storage.local.get('subscribers');
      const text = JSON.stringify({ updated: new Date().toISOString(), count: Object.keys(subscribers).length, subscribers }, null, 2);
      const a = Object.assign(document.createElement('a'), { download: 'abonnes.json', href: URL.createObjectURL(new Blob([text], { type: 'application/json' })) });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    btn.disabled = true;
    progress(0, 4, 'Préparation de l’export…');
    const res = await send({ type: 'subs-export', token });
    btn.disabled = false;
    if (res?.error === 'github_token') {
      await chrome.storage.local.remove('githubToken');
      return progress(4, 4, '✖ Jeton GitHub refusé : il sera redemandé au prochain export.');
    }
    if (!res || res.error) return progress(4, 4, `✖ abonnes.json n’a pas pu être mis à jour${res?.error ? ` (${res.error})` : ''}.`);
    progress(4, 4, res.added ? `✔ abonnes.json mis à jour : ${res.added} nouveaux abonnés, ${res.count} en tout.` : `✔ abonnes.json contient déjà tous tes abonnés (${res.count}).`);
  }

  // Tier of the logged-in player's subscription (null without one), read from their profile at most once an hour;
  // the page is closed to subscribers.
  async function myTier() {
    const { me, meSub } = await chrome.storage.local.get(['me', 'meSub']).catch(() => ({}));
    if (!me?.id) return null;
    let tier = meSub?.id === me.id ? meSub.tier : null;
    if (meSub?.id !== me.id || Date.now() - meSub.at > 3600e3) {
      const p = await siteApi(`/users/${encodeURIComponent(me.id)}`, { auth: false }).catch(() => null);
      if (p) {
        const ids = new Set((p.badges ?? []).map((b) => b?.id));
        tier = [...subTiers].reverse().find((t) => ids.has(`membre-${t.id}`))?.id ?? null;
        await chrome.storage.local.set({ meSub: { id: me.id, tier, at: Date.now() } });
      }
    }
    if (tier) document.documentElement.dataset.kyxSub = tier;
    else delete document.documentElement.dataset.kyxSub;
    return tier;
  }

  // Builds the page and reads the site's lists again.
  async function openSubscribers() {
    const page = mountView(
      SUBS_HASH,
      'abonnes',
      `
        <header class="kyx-page-head">
          <div><small>Mur de la Honte · 恥</small><h1 id="kyx-view-t">Mur de la Honte</h1>
          <p>Les joueurs abonnés (Nakama, Senpai, Sensei ou Daimyō), repérés grâce à leur badge.</p></div>
          <button type="button" class="kyx-page-close">← Retour</button>
        </header>
        <div class="kyx-s-figures"></div>
        <p class="kyx-page-note" role="status"></p>
        <div class="kyx-s-progress" hidden><span class="kyx-b-bar"><span><i></i></span><small></small></span></div>
        <div class="kyx-seg kyx-s-tiers" role="group" aria-label="Palier"></div>
        <div class="kyx-search-wrap">
          <label class="kyx-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path></svg>
            <input type="search" autocomplete="off" spellcheck="false" placeholder="Rechercher un joueur…" aria-label="Rechercher un joueur" />
          </label>
        </div>
        <ol class="kyx-s-list"></ol>`
    );
    if (!page) return;
    if (await myTier()) {
      page.querySelectorAll(':scope > :not(.kyx-page-head)').forEach((el) => el.remove());
      page.querySelector('.kyx-page-head p').textContent = 'Le Mur de la Honte est réservé aux joueurs sans abonnement.';
      return;
    }
    const note = (text) => (page.querySelector('.kyx-page-note').textContent = text);
    let { subscribers: known = {}, me } = await chrome.storage.local.get(['subscribers', 'me']).catch(() => ({}));
    await loadSubTiers();
    if (!page.isConnected) return;
    page.querySelector('.kyx-s-tiers').innerHTML = `<button type="button" data-tier="all" aria-pressed="false">Tous <small></small></button>${[...subTiers]
      .reverse()
      .map((t) => `<button type="button" data-tier="${esc(t.id)}" aria-pressed="false">${esc(t.kanji)} ${esc(t.name)} <small></small></button>`)
      .join('')}<button type="button" class="kyx-s-again">↻ Actualiser</button>${SUBS_EXPORTERS.includes(me?.id) ? '<button type="button" class="kyx-s-export">⇪ Exporter</button>' : ''}`;
    const draw = () => page.isConnected && renderSubscribers(page, known);
    refreshSubs = (next) => ((known = next ?? known), draw());
    page.querySelectorAll('.kyx-s-tiers [data-tier]').forEach((b) => b.addEventListener('click', () => ((subsTier = b.dataset.tier), draw())));
    page.querySelector('.kyx-search input').addEventListener('input', draw);
    page.querySelector('.kyx-s-export')?.addEventListener('click', (e) => exportSubscribers(e.currentTarget, progress));
    if (SUBS_EXPORTERS.includes(me?.id)) {
      send({ type: 'relay-stats' }).then((s) => {
        if (!s?.month || !page.isConnected) return;
        const line = Object.assign(document.createElement('p'), { className: 'kyx-s-users' });
        line.textContent = `Extension utilisée par ${num(s.day)} personnes aujourd’hui · ${num(s.week)} cette semaine · ${num(s.month)} ce mois-ci `;
        const who = Object.assign(document.createElement('button'), { type: 'button', className: 'kyx-s-who', textContent: '👥 Voir qui' });
        who.addEventListener('click', openMembers);
        line.appendChild(who);
        page.querySelector('.kyx-page-note').before(line);
      });
    }
    // Bar and text of the export to GitHub; hidden again a few seconds after the last step.
    let progressHide = 0;
    const progress = (n, of, text) => {
      const box = page.querySelector('.kyx-s-progress');
      box.hidden = false;
      box.querySelector('i').style.width = `${Math.round((n / of) * 100)}%`;
      box.querySelector('small').textContent = `${n}/${of} · ${text}`;
      clearTimeout(progressHide);
      if (n >= of) progressHide = setTimeout(() => (box.hidden = true), 8000);
    };
    showExport = (s) => s && s.step < s.of && progress(s.step, s.of, s.text);
    draw();

    // Reads the site's lists again and saves what was found.
    const again = page.querySelector('.kyx-s-again');
    const scan = async () => {
      again.disabled = true;
      note('Recherche des abonnés…');
      await send({ type: 'subs-scan' });
      again.disabled = false;
      note('Listes du site relues à l’instant.');
    };
    again.addEventListener('click', scan);
    scan();
  }

  // ---------- players met while browsing, handed to the background worker for the "Mur de la Honte" page ----------

  // Where players were met, from the address of the answer that showed them.
  function playersWhere(path, query = '') {
    if (path.startsWith('/market/chat')) return 'Chat du marché';
    if (path.startsWith('/market/listings')) return /type=auction/.test(query) ? 'Enchères' : 'Ventes du marché';
    if (path.startsWith('/market/buy-orders')) return 'Ordres d’achat';
    if (path.startsWith('/eveil/market')) return 'Marché Éveil';
    if (/^\/(trades|me\/trades)/.test(path)) return 'Échanges';
    if (path.startsWith('/me/market')) return 'Mes ventes';
    if (path.startsWith('/me/friends')) return 'Amis';
    if (path.startsWith('/leaderboard')) return 'Classement';
    if (path.startsWith('/users/')) return 'Profil';
    if (path === '/feed') return 'Derniers tirages';
    if (path.startsWith('/membership/wall')) return 'Mur des soutiens';
    return 'Kyara';
  }

  // ---------- any name colour and gradient in the site's "Personnaliser" window ----------

  const NAME_COLORS = 8; // colours of the site in the row, before the "perso" swatch added by inject.js
  const NAME_GRADIENTS = 6;

  // Name preview at the top of the window.
  const namePreview = (from) => [...(from.closest('[role="dialog"]') ?? document).querySelectorAll('.nm')].find((el) => !el.closest('button'));

  // CSS gradient of a name, looping like the site's.
  const nameGradient = (colors) => `linear-gradient(90deg, ${[...colors, colors[0]].join(', ')})`;

  // Colour pickers on the last swatch of the name colours and the last tile of the gradients ("perso", added by
  // inject.js); inject.js reads the colours chosen when the window is saved.
  function scanNamePickers() {
    const root = document.documentElement;
    if (!root.dataset.kyxPerks || root.dataset.kyxSub) return;

    // Rows of colours: the name first, then the chat messages.
    const rows = [...new Set([...document.querySelectorAll('button.sw')].map((b) => b.parentElement))].filter((p) => p.querySelectorAll(':scope > button.sw').length === NAME_COLORS + 2);
    rows.slice(0, 2).forEach((row, i) => {
      const swatch = row.querySelector(':scope > button.sw:last-of-type');
      if (!swatch || row.querySelector('.kyx-pick')) return;
      const key = i ? 'kyxChatColor' : 'kyxNameColor';
      const pick = Object.assign(document.createElement('label'), { className: 'kyx-pick', title: 'Choisir la couleur' });
      pick.innerHTML = `<input type="color" value="${root.dataset[key] || '#ffffff'}"><span>Choisir…</span>`;
      const input = pick.querySelector('input');
      swatch.title = 'Couleur au choix';
      swatch.classList.toggle('kyx-sw-any', !root.dataset[key]);
      if (root.dataset[key]) swatch.style.setProperty('--sw', root.dataset[key]);
      input.addEventListener('input', () => {
        root.dataset[key] = input.value;
        swatch.classList.remove('kyx-sw-any');
        swatch.style.setProperty('--sw', input.value);
        if (swatch.getAttribute('aria-checked') !== 'true') swatch.click();
        const nm = !i && namePreview(swatch);
        if (nm) nm.style.color = input.value;
      });
      swatch.after(pick);
    });

    const tiles = [...document.querySelectorAll('button:has(.nm)')];
    const grid = tiles.map((b) => b.parentElement).find((p) => p.querySelectorAll(':scope > button:has(.nm)').length === NAME_GRADIENTS + 2);
    const tile = grid?.querySelector(':scope > button:has(.nm):last-of-type');
    if (tile && !grid.nextElementSibling?.classList.contains('kyx-grad-pick')) {
      const colors = (root.dataset.kyxNameGradient || '#ff4d6d,#ffd166,#38d6e0').split(',');
      const box = Object.assign(document.createElement('div'), { className: 'kyx-grad-pick' });
      box.innerHTML = '<span>Dégradé perso</span>' + colors.map((c) => `<input type="color" value="${c}">`).join('');
      const label = [...tile.querySelectorAll('*')].find((el) => !el.children.length && !el.closest('.nm'));
      if (label) label.textContent = 'Perso';
      box.addEventListener('input', () => {
        const picked = [...box.querySelectorAll('input')].map((i) => i.value);
        root.dataset.kyxNameGradient = picked.join(',');
        if (tile.getAttribute('aria-pressed') !== 'true' && tile.getAttribute('aria-checked') !== 'true') tile.click();
        for (const nm of [tile.querySelector('.nm'), namePreview(tile)]) nm?.style.setProperty('--g', nameGradient(picked));
      });
      grid.after(box);
    }
  }

  // ---------- no "Mur des soutiens" choice in the "Personnaliser" window ----------

  // Hides the block of the window that shows or hides the player on the site's supporters wall.
  function scanWallOption() {
    const swatch = document.querySelector('button.sw');
    if (!swatch) return;
    const panel = swatch.closest('[role="dialog"], dialog') ?? document;
    for (const el of panel.querySelectorAll('h2, h3, h4')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
      if (!/^(Mur des soutiens|Supporters wall)$/i.test(own)) continue;
      let block = el.parentElement;
      while (block && block !== document.body && !block.querySelector('button')) block = block.parentElement;
      if (block && block !== document.body) block.dataset.kyxHidden = '';
    }
  }

  // ---------- name colours of the market's sellers ----------

  let marketNames = {}; // name colour or gradient chosen by the other players through the extension, by Kyara id

  // Colours the links to the profile of the players who chose a name colour or gradient, on the market's pages.
  function scanMarketNames() {
    if (!location.pathname.startsWith('/marche') || document.documentElement.dataset.kyxSub) return;
    for (const a of document.querySelectorAll('a[href^="/profil/"]')) {
      const id = decodeURIComponent(a.getAttribute('href').slice(8).split(/[?#/]/)[0]);
      if (a.dataset.kyxName === id || a.matches('.nm') || a.querySelector('.nm, img') || a.textContent.trim().length < 2) continue;
      paintName(a, id, marketNames[id]);
    }
    // Sellers written without a link, under the price of each offer.
    const byPseudo = new Map(Object.values(marketNames).filter((n) => n.pseudo).map((n) => [n.pseudo, n]));
    for (const el of document.querySelectorAll('main span.mono')) {
      const text = el.textContent.trim();
      if (el.children.length || el.dataset.kyxName === text || (!byPseudo.has(text) && el.dataset.kyxName === undefined)) continue;
      paintName(el, text, byPseudo.get(text));
    }
  }

  // Gives an element the name colour or gradient of a player (none: the site's own look again).
  function paintName(el, key, name) {
    el.dataset.kyxName = key;
    el.classList.toggle('kyx-grad-name', !!name?.gradient);
    el.style.setProperty('--kyx-g', name?.gradient ? `linear-gradient(90deg, ${[...name.gradient, name.gradient[0]].join(', ')})` : '');
    el.style.color = name?.color ?? '';
  }

  // ---------- chat messages of the players who use the extension ----------

  let chatMembers = {}; // colour of each player who uses the extension, by Kyara id

  // Their messages keep a background of their colour, the size of the message (a message without the name
  // belongs to the author of the one before).
  function scanChatMessages() {
    if (document.documentElement.dataset.kyxSub) return;
    let author = null;
    for (const msg of document.querySelectorAll('.msg:has(a.nm[href^="/profil/"]), .msg.compact')) {
      const link = msg.querySelector('a.nm[href^="/profil/"]');
      if (link) author = decodeURIComponent(link.getAttribute('href').slice(8));
      const id = author;
      if (!id || msg.dataset.kyxMsg === id) continue;
      msg.dataset.kyxMsg = id;
      msg.classList.toggle('kyx-msg', !!chatMembers[id]);
      msg.style.setProperty('--kyx-ink', chatMembers[id] ?? '');
    }
  }

  // ---------- guided tour and what's new ----------

  const TUTO_HASH = '#kyx-tutoriel';
  const NEWS_HASH = '#kyx-nouveautes';
  const phone = () => innerWidth <= 640;

  // True when version a is newer than version b.
  const versionNewer = (a, b) => {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };

  // Follows a link of the site through its own navigation.
  function goTo(href) {
    const view = VIEWS.find((v) => href.includes(v.hash));
    if (view) return view.open();
    const link = Object.assign(document.createElement('a'), { href });
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // The tour steps for this device: extension or script, Android or not.
  function tourSteps() {
    const android = /Android/i.test(navigator.userAgent);
    const kind = owner === 'userscript' ? 'script' : owner;
    return KYX_TOUR.filter((t) => !t.only || t.only === kind || (t.only === 'android' && android && kind === 'script'));
  }

  // First visible element of a list of selectors.
  function visibleTarget(selectors) {
    if (!selectors) return null;
    for (const sel of selectors.split(',')) {
      let list = [];
      try {
        list = document.querySelectorAll(sel.trim());
      } catch {} // a selector the browser doesn't know
      for (const el of list) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    }
    return null;
  }

  // Waits for an element while the page is still changing: gives up once it has settled without it, or after max ms.
  async function waitTarget(selectors, max = 2500) {
    const start = Date.now();
    for (;;) {
      const el = visibleTarget(selectors);
      if (el || !selectors) return el;
      const now = Date.now();
      if (now - start > max || (now - start > 300 && now - lastMutation > 400)) return null;
      await wait(60);
    }
  }

  // Waits for the site to show the page of a path (its own navigation), at most max ms.
  async function waitPath(path, max = 2500) {
    const start = Date.now();
    while (location.pathname !== path && Date.now() - start < max) await wait(40);
  }

  // A button of the page by its text (not one of ours).
  const siteButton = (re, root = document) =>
    [...root.querySelectorAll('main button, header button')].find((b) => re.test(b.textContent) && !b.closest('[class*="kyx-"]'));

  // Opens what a step needs; returns what puts it back as it was.
  async function prepareStep(what) {
    if (what === 'album') {
      // The first album loaded on Collection, opened so that its bar (and "Bloquer sauf doublons") shows.
      if (document.querySelector('.album-bar')) return null;
      siteButton(/^\s*Albums\s*$/)?.click();
      const album = await waitTarget('ul.albums > li button.album', 3000);
      album?.click();
      return null;
    }
    if (what === 'missing') {
      const chip = document.querySelector('.kyx-missing');
      if (chip && !chip.classList.contains('on')) {
        chip.click();
        return () => chip.isConnected && chip.classList.contains('on') && chip.click();
      }
    } else if (what === 'albums') {
      const btn = siteButton(/^\s*Albums\s*$/);
      if (btn && !document.querySelector('ul.albums')) btn.click();
    } else if (what === 'recycle') {
      if (!document.querySelector('.rec-box')) {
        siteButton(/Recycler les doublons/)?.click(); // only opens the site's box: nothing is recycled
        return () => document.querySelector('.rec-box .rec-a button:last-child')?.click();
      }
    } else if (what === 'menu') {
      // Phone bottom bar: its "Plus" button opens the sheet.
      const plus = [...document.querySelectorAll('nav.mb > button:not(.open)')].find((b) => b.getBoundingClientRect().width > 0);
      if (plus) {
        if (!plusSheet()) plus.click();
        return () => plusSheet() && closePlusSheet();
      }
      const burger = document.querySelector('button.burger[aria-controls="mobile-nav"]');
      const more = document.querySelector('button[aria-controls="nav-more"]');
      const toggler = burger && burger.getBoundingClientRect().width > 0 ? burger : more;
      if (toggler && toggler.getAttribute('aria-expanded') !== 'true' && !(toggler === burger && document.querySelector('#mobile-nav'))) {
        toggler.click();
        return () => (toggler.getAttribute('aria-expanded') === 'true' || (toggler === burger && document.querySelector('#mobile-nav'))) && toggler.click();
      }
    }
    return null;
  }

  // Guided tour: each step goes to its page, opens what it needs and circles the element, with a bubble beside it
  // (at the bottom of the screen on a phone). Without the element, the bubble is shown in the middle.
  let tour = null;
  async function startTour(at = 0) {
    if (typeof KYX_TOUR === 'undefined') return;
    endTour();
    document.querySelector('.kyx-tuto-back')?.remove();
    const steps = tourSteps();
    const index = typeof at === 'string' ? Math.max(0, steps.findIndex((t) => t.id === at)) : at;
    const spot = Object.assign(document.createElement('div'), { className: 'kyx-spot' });
    const bubble = Object.assign(document.createElement('section'), { className: 'kyx-bubble' });
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-live', 'polite');
    document.body.append(spot, bubble);
    const onKey = (e) => {
      if (e.key === 'Escape') endTour();
      else if (e.key === 'ArrowRight') showStep(tour.index + 1);
      else if (e.key === 'ArrowLeft') showStep(tour.index - 1);
    };
    document.addEventListener('keydown', onKey, true);
    bubble.dataset.state = 'center';
    tour = { steps, index: 0, spot, bubble, target: null, undo: null, run: 0, onKey };
    const follow = () => {
      if (!tour) return;
      placeTour();
      (window.requestAnimationFrame ?? ((f) => setTimeout(f, 50)))(follow);
    };
    follow();
    showStep(index);
  }

  function endTour() {
    if (!tour) return;
    tour.undo?.();
    tour.spot.remove();
    tour.bubble.remove();
    document.removeEventListener('keydown', tour.onKey, true);
    tour = null;
    if (location.hash === TUTO_HASH) history.replaceState(history.state, '', location.pathname + location.search);
  }

  async function showStep(i) {
    if (!tour) return;
    const { steps } = tour;
    const index = Math.max(0, Math.min(steps.length - 1, i));
    const step = steps[index];
    const run = ++tour.run;
    tour.undo?.();
    tour.undo = null;
    tour.index = index;
    tour.target = null;
    renderBubble(step, index, steps.length, true); // the new step at once, while its page and element load
    const path = step.page?.split('?')[0];
    if (path && location.pathname !== path) {
      goTo(step.page);
      await waitPath(path);
    }
    await wait(0); // after the click on "Suivant", which the site would take as a click outside its menu
    if (!tour || run !== tour.run) return;
    tour.undo = step.prepare ? await prepareStep(step.prepare) : null;
    if (!tour || run !== tour.run) return;
    const target = await waitTarget(step.target);
    if (!tour || run !== tour.run) return;
    tour.target = target;
    if (target) revealTarget(target);
    renderBubble(step, index, steps.length);
  }

  // Scrolls the element (in its menu or in the page) into the free space: below the site's header, above the bubble
  // on a phone, in the middle of the screen on a computer.
  function revealTarget(target) {
    // A sticky header hides while scrolling down and comes back on the way up: its full height is kept free.
    const head = document.querySelector('header');
    const header = head && /sticky|fixed/.test(getComputedStyle(head).position) ? head.offsetHeight : head?.getBoundingClientRect().bottom ?? 0;
    revealSideways(target);
    const r = target.getBoundingClientRect();
    const top = Math.max(0, header) + 12;
    const bottom = phone() ? innerHeight - Math.min(tour.bubble.offsetHeight, innerHeight * 0.45) - 24 : innerHeight - 12;
    const shift = phone() || r.height > bottom - top ? r.top - top : r.top + r.height / 2 - (top + bottom) / 2;
    if (r.top >= top && r.bottom <= bottom && (phone() || Math.abs(shift) < 120)) return;
    let box = target.parentElement;
    while (box && box !== document.body && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    (box && box !== document.body ? box : window).scrollBy({ top: shift, behavior: reduce ? 'auto' : 'smooth' });
  }

  // In a row that scrolls sideways (tabs, chips on a phone), brings the element to the middle of the row.
  function revealSideways(target) {
    const r = target.getBoundingClientRect();
    if (r.left >= 8 && r.right <= innerWidth - 8) return;
    let box = target.parentElement;
    while (box && box !== document.body && !(box.scrollWidth > box.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(box).overflowX))) box = box.parentElement;
    if (!box || box === document.body) return;
    const b = box.getBoundingClientRect();
    box.scrollBy({ left: r.left + r.width / 2 - (b.left + b.width / 2), behavior: 'auto' });
  }

  function renderBubble(step, index, count, loading = false) {
    const b = tour.bubble;
    const last = index === count - 1;
    if (loading) b.dataset.busy = '1';
    else {
      delete b.dataset.busy;
      b.dataset.state = tour.target ? 'pointing' : 'center';
    }
    if (!b.dataset.state) b.dataset.state = 'center';
    b.innerHTML = `
      <header><small>学 Tutoriel · ${index + 1}/${count}</small><button type="button" class="kyx-b-x" aria-label="Quitter la visite">✕</button></header>
      <h2></h2>
      <p class="kyx-b-text"></p>
      <p class="kyx-b-miss" hidden>Cet élément n’est pas visible ici pour le moment (page pas encore chargée, rien à afficher, ou pas connecté).</p>
      <div class="kyx-b-btns">
        <button type="button" class="kyx-b-skip">${index ? 'Quitter' : 'Plus tard'}</button>
        <span></span>
        <button type="button" class="kyx-b-prev"${index ? '' : ' hidden'}>Précédent</button>
        <button type="button" class="kyx-b-next">${index ? (last ? 'Terminer' : 'Suivant') : 'Commencer la visite'}</button>
      </div>`;
    b.querySelector('h2').textContent = step.title;
    b.querySelector('.kyx-b-text').textContent = step.text;
    b.querySelector('.kyx-b-miss').hidden = loading || !step.target || !!tour.target;
    tour.spot.classList.toggle('kyx-spot-in', !!tour.target && !loading);
    b.querySelector('.kyx-b-x').addEventListener('click', endTour);
    b.querySelector('.kyx-b-skip').addEventListener('click', endTour);
    b.querySelector('.kyx-b-prev').addEventListener('click', () => showStep(index - 1));
    b.querySelector('.kyx-b-next').addEventListener('click', () => (last ? endTour() : showStep(index + 1)));
    placeTour();
    b.querySelector('.kyx-b-next').focus({ preventScroll: true });
  }

  // Keeps the circle on the element and the bubble beside it, as the page scrolls or resizes.
  function placeTour() {
    const { spot, bubble, target } = tour;
    const r = target?.isConnected ? target.getBoundingClientRect() : null;
    if (!r || !r.width) {
      spot.dataset.on = '';
      if (bubble.dataset.busy) return; // keeps its place while the next step loads
      if (bubble.dataset.state === 'pointing') bubble.dataset.state = 'center';
      bubble.style.left = bubble.style.top = bubble.style.maxHeight = '';
      return;
    }
    const pad = 6;
    spot.dataset.on = '1';
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    if (phone()) {
      // Full width, below or above the element, never on it: the side with room for the whole bubble,
      // else the larger side, the bubble then scrolling inside.
      const gap = 10;
      const below = innerHeight - (r.bottom + pad) - gap - 8;
      const above = r.top - pad - gap - 8;
      bubble.style.left = '';
      bubble.style.maxHeight = '';
      let bh = bubble.offsetHeight;
      let top;
      if (bh <= below) top = r.bottom + pad + gap;
      else if (bh <= above) top = r.top - pad - gap - bh;
      else {
        const down = below >= above;
        const room = Math.max(110, down ? below : above);
        bubble.style.maxHeight = `${room}px`;
        bh = Math.min(bh, room);
        top = down ? innerHeight - 8 - bh : 8;
      }
      bubble.style.top = `${Math.round(top)}px`;
      return;
    }
    // Below the element, else above, else beside it (right or left): never on it.
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const gap = 14;
    const clampTop = (t) => Math.max(8, Math.min(innerHeight - bh - 8, t));
    let top;
    let left = Math.max(8, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2));
    if (r.bottom + pad + gap + bh <= innerHeight - 8) top = r.bottom + pad + gap;
    else if (r.top - pad - gap - bh >= 8) top = r.top - pad - gap - bh;
    else {
      top = clampTop(r.top + r.height / 2 - bh / 2);
      if (r.right + pad + gap + bw <= innerWidth - 8) left = r.right + pad + gap;
      else if (r.left - pad - gap - bw >= 8) left = r.left - pad - gap - bw;
      else top = innerHeight - bh - 8; // no free side: at the bottom of the screen
    }
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }

  // "Nouveautés" window: what's new since a version (or in every version), with "Montre-moi" for each new feature.
  function openNews(since = null) {
    if (typeof KYX_CHANGES === 'undefined') return;
    endTour();
    document.querySelector('.kyx-tuto-back')?.remove();
    const back = document.createElement('div');
    back.className = 'kyx-modal-back kyx-tuto-back';
    back.innerHTML = '<section class="kyx-modal kyx-tuto" role="dialog" aria-modal="true" aria-label="Nouveautés de Kyara Games"></section>';
    const box = back.firstElementChild;
    const ids = new Set(tourSteps().map((t) => t.id));
    const list = KYX_CHANGES.filter((c) => !since || versionNewer(c.version, since));
    box.innerHTML = `
      <header class="kyx-tuto-head"><small>Kyara Games ${esc(chrome.runtime.getManifest().version)}</small><button type="button" class="kyx-tuto-x" aria-label="Fermer">✕</button></header>
      <h2>${since ? 'Nouveautés depuis ta dernière visite' : 'Nouveautés de chaque version'}</h2>
      <div class="kyx-tuto-news"></div>
      <div class="kyx-tuto-btns"><button type="button" class="kyx-tuto-tour">Visite guidée</button><span></span><button type="button" class="kyx-tuto-next">Fermer</button></div>`;
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      if (location.hash === NEWS_HASH) history.replaceState(history.state, '', location.pathname + location.search);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    const host = box.querySelector('.kyx-tuto-news');
    for (const c of list.length ? list : KYX_CHANGES.slice(0, 1)) {
      const part = document.createElement('section');
      part.innerHTML = '<h3></h3><ul></ul>';
      part.querySelector('h3').textContent = `Version ${c.version}`;
      for (const item of c.items) {
        const [text, id] = Array.isArray(item) ? item : [item, null];
        const li = document.createElement('li');
        li.append(text);
        if (id && ids.has(id)) {
          const show = Object.assign(document.createElement('button'), { type: 'button', className: 'kyx-tuto-show', textContent: 'Montre-moi' });
          show.addEventListener('click', () => (close(), startTour(id)));
          li.append(' ', show);
        }
        part.querySelector('ul').appendChild(li);
      }
      host.appendChild(part);
    }
    box.querySelector('.kyx-tuto-tour').addEventListener('click', () => (close(), startTour(0)));
    box.querySelector('.kyx-tuto-next').addEventListener('click', close);
    box.querySelector('.kyx-tuto-x').addEventListener('click', close);
    back.addEventListener('click', (e) => e.target === back && close());
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
  }

  // Once per version: the tour the first time, then what's new after each update ("notifyUpdated" setting).
  async function showTutorialOnce() {
    if (location.hash === TUTO_HASH || location.hash === NEWS_HASH) return;
    const version = chrome.runtime.getManifest().version;
    const { seenVersion } = await chrome.storage.local.get('seenVersion');
    if (seenVersion === version) return;
    await chrome.storage.local.set({ seenVersion: version });
    if (!seenVersion) startTour(0);
    else if (settings.notifyUpdated !== false && versionNewer(version, seenVersion)) openNews(seenVersion);
  }

  // Opens the tour or what's new from the address (#kyx-tutoriel, #kyx-nouveautes), used by the popup and the notifications.
  function onTutorialHash() {
    if (location.hash === TUTO_HASH && !tour) startTour(0);
    else if (location.hash === NEWS_HASH && !document.querySelector('.kyx-tuto-back')) openNews();
  }

  // "学 Tutoriel" entry in the site's menus ("Plus" on a computer, the menu sheet on a phone).
  function scanTutoMenu() {
    const add = (menu, kanjiSel, titleSel, closer) => {
      if (!menu || menu.querySelector(':scope > .kyx-tuto-entry')) return;
      const model = menu.querySelector(':scope > a:not(.kyx-more):not(.kyx-subs-entry):not(.kyx-settings-entry)');
      if (!model?.querySelector(kanjiSel) || !model.querySelector(titleSel)) return;
      const item = model.cloneNode(true);
      item.classList.remove('on');
      item.classList.add('kyx-tuto-entry');
      item.removeAttribute('aria-current');
      item.href = TUTO_HASH;
      item.querySelector(kanjiSel).textContent = '学';
      item.querySelector(titleSel).textContent = 'Tutoriel';
      const hint = item.querySelector('.dt small');
      if (hint) hint.textContent = 'Visite guidée de Kyara Games';
      [...item.children].forEach((el) => el.matches(`${kanjiSel}, .dt, .tl`) || el.remove());
      item.addEventListener('click', (e) => {
        e.preventDefault();
        if (tour) return; // already in the tour (its last step circles this entry)
        document.querySelector(closer)?.click();
        startTour(0);
      });
      menu.appendChild(item);
    };
    add(document.querySelector('#nav-more'), '.dk', '.dt b', 'button[aria-controls="nav-more"][aria-expanded="true"]');
    add(document.querySelector('#mobile-nav .sheet-grid'), '.tk', '.tl', 'button.burger[aria-controls="mobile-nav"]');
    addSheetEntry('kyx-tuto-entry', '学', 'Tutoriel', () => tour || startTour(0));
  }

  // ---------- series and price under each card of the trade confirmation ----------

  // Series and fair price under each card of "Confirmer l'échange", and the value gap between both sides.
  const prices = new Map(); // id -> fair price in chakra, null when unknown
  const pricing = new Set();
  // "1 234 ◆".
  const chakra = (n) => `${Math.round(n).toLocaleString('fr-FR')} ◆`;

  // Fair prices of the cards, asked 200 at a time.
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

  // One line under a card of the confirmation, removed when text is null.
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

  // Fills the trade confirmation.
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


  // ---------- "Possédées" and "Manquantes" chips on the Collection page ----------

  // They drive the site's "Cartes" select (all / owned / missing…), right after its "Toutes" chip.
  const CARD_CHIPS = [
    { value: 'owned', label: 'Possédées', cls: 'kyx-owned' },
    { value: 'missing', label: 'Manquantes', cls: 'kyx-missing' }
  ];

  // Adds and updates the two chips.
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
      favChip(chips, first, after);
      if (!select.dataset.kyxWatched) {
        select.dataset.kyxWatched = '1';
        select.addEventListener('change', () => {
          collectionMore = 0;
          scanCollectionChips();
        });
      }
    }
    scanCollectionFav();
  }

  // "★ Favoris" chip after "Manquantes": only the cards of the favourite series; remembered.
  function favChip(chips, first, after) {
    let btn = chips.querySelector(':scope > .kyx-favcoll');
    if (!btn) {
      btn = first.cloneNode(true);
      btn.classList.remove('on');
      btn.classList.add('kyx-chip', 'kyx-favcoll');
      btn.innerHTML = '<span class="kyx-star" aria-hidden="true">★</span> Favoris';
      btn.addEventListener('click', () => {
        if (!alive()) return shutdown();
        if (!favSeries.size) return;
        collectionMore = 0;
        collectionFav = !collectionFav;
        scanCollectionChips();
        chrome.storage.local.set({ collectionFav });
      });
      after.after(btn);
    }
    const on = collectionFav && favSeries.size > 0;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.disabled = !favSeries.size;
    const n = favSeries.size;
    const title = n
      ? `Seulement les cartes de tes ${n} œuvre${n > 1 ? 's' : ''} favorite${n > 1 ? 's' : ''}`
      : 'Aucune œuvre en favori : mets-en avec l’étoile ☆ des albums';
    if (btn.title !== title) btn.title = title;
  }

  // The site's "Univers" select of the Collection: in the filter row, or in the phone "Filtres" sheet (the one on screen first).
  function collectionUniverse() {
    const selects = [...document.querySelectorAll('label > select')].filter((s) => s.querySelector(':scope > option[value="Tous"]') && !s.closest('.kyx-coll-pick'));
    // One hidden by us counts as on screen when our list beside it is.
    const shown = (s) => onScreen(s) || (s.parentElement.dataset.kyxUni === '1' && onScreen(s.parentElement.previousElementSibling));
    return selects.find(shown) ?? selects[0] ?? null;
  }

  // While "★ Favoris" is on: a list of the favourite series in place of "Univers"; choosing one sets the site's "Univers".
  function collectionPicker(on) {
    const site = on ? collectionUniverse() : null;
    const label = site?.parentElement;
    document.querySelectorAll('[data-kyx-uni]').forEach((l) => {
      if (l === label) return;
      delete l.dataset.kyxUni;
      delete l.dataset.kyxHidden;
    });
    let pick = document.querySelector('.kyx-coll-pick');
    if (!label) return void pick?.remove();
    if (pick && pick.nextElementSibling !== label) pick.remove();
    if (!pick?.isConnected) {
      pick = label.cloneNode(false);
      pick.classList.add('kyx-coll-pick');
      pick.innerHTML = `<span>★ Favoris</span> <select class="${esc(site.className)}"></select>`;
      pick.querySelector('select').addEventListener('change', (e) => {
        collectionMore = 0;
        site.value = e.target.value || 'Tous';
        site.dispatchEvent(new Event('change', { bubbles: true }));
      });
      label.before(pick);
    }
    label.dataset.kyxUni = '1';
    if (label.dataset.kyxHidden !== '1') label.dataset.kyxHidden = '1';
    // A series outside the favourites would show nothing: back to all of them.
    if (site.value !== 'Tous' && !favSeries.has(site.value)) {
      site.value = 'Tous';
      site.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const select = pick.querySelector('select');
    const names = [...favSeries];
    const key = names.join('|');
    if (select.dataset.key !== key) {
      select.dataset.key = key;
      select.innerHTML = '';
      select.add(new Option(`Toutes mes favorites (${names.length})`, ''));
      for (const name of names) select.add(new Option(name, name));
    }
    const value = site.value === 'Tous' ? '' : site.value;
    if (select.value !== value) select.value = value;
  }

  let collectionMore = 0;
  // Hides the Collection cards outside the favourite series, and loads more until a full page shows.
  function scanCollectionFav() {
    if (location.pathname !== '/collection') return;
    const on = collectionFav && favSeries.size > 0;
    collectionPicker(on);
    const grids = new Set();
    for (const slot of document.querySelectorAll('a.slot')) {
      const cell = slot.parentElement;
      if (!cell) continue;
      if (cell.parentElement) grids.add(cell.parentElement);
      const id = Number(slot.getAttribute('href')?.match(/\/wiki\/(\d+)/)?.[1]);
      const series = id ? catalog?.get(id)?.s : null;
      const hide = on && !!series && !favSeries.has(series);
      if (hide) {
        if (cell.dataset.kyxHidden !== '1') cell.dataset.kyxHidden = '1';
      } else if (cell.dataset.kyxHidden) delete cell.dataset.kyxHidden;
    }
    for (const grid of grids) {
      const visible = [...grid.children].filter((c) => c.querySelector(':scope > a.slot') && c.dataset.kyxHidden !== '1').length;
      const near = [grid.nextElementSibling, ...(grid.nextElementSibling?.querySelectorAll('button') ?? []), ...(grid.parentElement?.querySelectorAll(':scope > button') ?? [])];
      const more = near.find((b) => b?.matches?.('button') && /afficher plus|voir plus/i.test(b.textContent));
      if (on && visible < PAGE && more && collectionMore < 40) {
        collectionMore++;
        more.click();
      } else if (!more || visible >= PAGE) {
        collectionMore = 0;
      }
    }
  }

  // ---------- "★ Favoris" filter of the market's trade offers ----------

  const BOARD_PAGE = 20;
  let boardMore = 0;
  let boardReload = 0; // when the site was asked for the list again
  let boardAsked = -1; // offers listed when "Voir plus d'offres" was last clicked
  // "★ Favoris" pill of the "Échanges" tab: only the offers giving a card of a favourite series; remembered.
  function scanTradeBoard() {
    const board = location.pathname.startsWith('/marche') ? document.querySelector('section.board') : null;
    const filters = board?.querySelector(':scope > .filters');
    // The site's pills, in their own row (.pills) or right in the filters.
    const pills = [...(filters?.querySelectorAll(':scope > button.pill:not(.kyx-chip), :scope > .pills > button.pill:not(.kyx-chip)') ?? [])];
    if (!pills.some((b) => /peux accepter/i.test(b.textContent))) {
      boardMore = 0;
      return void boardIds('');
    }
    let btn = filters.querySelector('.kyx-favboard');
    if (!btn) {
      btn = pills[0].cloneNode(false);
      btn.classList.remove('on');
      btn.classList.add('kyx-chip', 'kyx-favboard');
      btn.innerHTML = '<span class="kyx-star" aria-hidden="true">★</span> Favoris';
      btn.addEventListener('click', () => {
        if (!alive()) return shutdown();
        if (!favSeries.size) return;
        boardMore = 0;
        boardFav = !boardFav;
        scanTradeBoard();
        chrome.storage.local.set({ boardFav });
      });
      // Before "Mes offres", the last pill.
      const mine = pills.find((b) => /mes offres/i.test(b.textContent));
      pills[0].parentElement.insertBefore(btn, mine ?? null);
    }
    const open = new Set(openFavourites());
    const on = boardFav && open.size > 0 && !!catalog;
    // The page's offer search asks the server for the favourite cards only (inject.js); the list is asked again when that changes.
    if (boardIds(on ? favIds() : '')) {
      boardMore = 0;
      boardReload = Date.now();
      boardAsked = -1;
      const pill = pills.find((b) => /cherche/i.test(b.textContent)) ?? pills[0];
      pill.click();
      pill.click();
    }
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.disabled = !open.size;
    const n = open.size;
    const done = favSeries.size - n;
    const title = n
      ? `Seulement les offres qui donnent une carte de tes ${n} œuvre${n > 1 ? 's' : ''} favorite${n > 1 ? 's' : ''}${done ? ` (${done} complète${done > 1 ? 's' : ''} non cherchée${done > 1 ? 's' : ''})` : ''}`
      : favSeries.size
        ? 'Tu as tous les persos de tes œuvres favorites : rien à chercher'
        : 'Aucune œuvre en favori : mets-en avec l’étoile ☆ des albums, page Collection';
    if (btn.title !== title) btn.title = title;

    const list = board.querySelector('ul.offers');
    if (!list) return;
    let visible = 0;
    for (const li of list.children) {
      const m = CARD_SRC.exec(li.querySelector('.give img')?.getAttribute('src') || '');
      const series = m ? catalog?.get(Number(m[1]))?.s : null;
      if (on && !!series && !open.has(series)) {
        if (li.dataset.kyxHidden !== '1') li.dataset.kyxHidden = '1';
      } else {
        visible++;
        if (li.dataset.kyxHidden) delete li.dataset.kyxHidden;
      }
    }
    // Loads the site's next offers until a full page of matching ones shows.
    const more = board.querySelector('button.more');
    // Not while the new list is on its way (the site asks for it 300 ms after a filter changes).
    if (Date.now() - boardReload < 1500) return void setTimeout(scanTradeBoard, 1600);
    if (on && visible < BOARD_PAGE && more && boardMore < 40) {
      // One click at a time: the next one once the site added the offers it asked for.
      if (list.children.length === boardAsked) return;
      boardAsked = list.children.length;
      boardMore++;
      more.click();
    } else if (!more || visible >= BOARD_PAGE) {
      boardMore = 0;
    }
  }

  // Ids of the cards of the favourite series still to complete, comma separated.
  function favIds() {
    const open = new Set(openFavourites());
    return [...(catalog?.values() ?? [])].filter((c) => open.has(c.s)).map((c) => c.id).join(',');
  }

  // Hands the favourite cards to inject.js; true when they changed.
  function boardIds(ids) {
    const root = document.documentElement;
    if ((root.dataset.kyxBoardIds ?? '') === ids) return false;
    if (ids) root.dataset.kyxBoardIds = ids;
    else delete root.dataset.kyxBoardIds;
    return true;
  }

  // ---------- "Ses doublons" filter in the trade composer ----------

  // Keeps only the cards the partner holds twice or more; on by default, turning it off is remembered.
  // Next to it, "★ Favoris" keeps the cards of the favourite series, on both tabs.
  let composerMore = 0;
  const partnerCopies = new Map(); // id -> most copies of the card the partner had to trade, read from the shelf ("×N dispo")

  // True when the partner holds the card twice or more, null when unknown.
  let dupeIndex = { of: null, spare: null, tradeable: null };
  function theirDupe(id) {
    if (dupeIndex.of !== partner) {
      dupeIndex = { of: partner, spare: partner?.spare && new Map(partner.spare), tradeable: partner?.tradeable && new Map(partner.tradeable) };
    }
    if (dupeIndex.spare) return (dupeIndex.spare.get(id) ?? 0) > 0;
    const n = dupeIndex.tradeable?.get(id);
    return n == null ? null : n >= 2;
  }

  // The chip, and the shelf of the trade composer filtered on it.
  function scanComposer() {
    // Shelf of the trade composer, wherever it opens (a form, unlike the market's "Proposer une carte" dialog).
    const shelf = [...document.querySelectorAll('form .shelf')].find((el) => el.querySelectorAll(':scope > .tabs [role="tab"]').length === 2);
    const chips = shelf?.querySelector('.filters .chips');
    if (!chips) {
      composerMore = 0;
      partnerCopies.clear();
      return;
    }
    const tabs = shelf.querySelectorAll('.tabs [role="tab"]');
    const theirs = tabs[1]?.getAttribute('aria-selected') === 'true';
    const dupes = theirs && settings.theirDupes;
    const favs = tradeFav && favSeries.size > 0;
    const active = dupes || favs;
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
    btn.classList.toggle('on', dupes);
    btn.setAttribute('aria-pressed', String(dupes));

    // "★ Favoris": only the cards of the favourite series, on both sides of the trade; remembered.
    let fav = chips.querySelector(':scope > .kyx-favtrade');
    if (!fav) {
      fav = btn.cloneNode(false);
      fav.classList.remove('kyx-only', 'on');
      fav.classList.add('kyx-favtrade');
      fav.textContent = '★ Favoris';
      delete fav.dataset.kyxHidden;
      fav.addEventListener('click', () => {
        if (!alive()) return shutdown();
        if (!favSeries.size) return;
        composerMore = 0;
        tradeFav = !tradeFav;
        scanComposer();
        chrome.storage.local.set({ tradeFav });
      });
      btn.after(fav);
    }
    fav.classList.toggle('on', favs);
    fav.setAttribute('aria-pressed', String(favs));
    fav.disabled = !favSeries.size;
    fav.title = favSeries.size
      ? `Seulement les cartes de tes ${favSeries.size} œuvre${favSeries.size > 1 ? 's' : ''} favorite${favSeries.size > 1 ? 's' : ''}`
      : 'Aucune œuvre en favori : mets-en avec l’étoile ☆ des albums, page Collection';

    const grid = shelf.querySelector('ul.grid');
    if (!grid) return;
    let visible = 0;
    for (const li of grid.children) {
      const m = CARD_SRC.exec(li.querySelector('img')?.getAttribute('src') || '');
      const id = m ? Number(m[1]) : null;
      const series = id ? catalog?.get(id)?.s : null;
      const copies = Number(/(\d+)/.exec(li.querySelector('.have')?.textContent ?? '')?.[1]);
      if (theirs && id && copies) partnerCopies.set(id, Math.max(partnerCopies.get(id) ?? 0, copies));
      const twice = partnerCopies.has(id) ? partnerCopies.get(id) >= 2 : theirDupe(id);
      const hide = !!id && ((dupes && twice === false) || (favs && !!series && !favSeries.has(series)));
      if (hide) {
        if (li.dataset.kyxHidden !== '1') li.dataset.kyxHidden = '1';
      } else {
        visible++;
        if (li.dataset.kyxHidden) delete li.dataset.kyxHidden;
      }
    }
    // Loads the site's next cards until a full page of matching cards shows.
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
  let lastMutation = Date.now(); // when the page last changed (the tour waits for it to settle)
  const observer = new MutationObserver((records) => {
    lastMutation = Date.now();
    for (const r of records) {
      if (r.type === 'attributes') queued.add(r.target);
      else r.addedNodes.forEach((n) => n.nodeType === 1 && queued.add(n));
    }
    if (!frame) frame = requestAnimationFrame(flush);
  });

  // Scans what changed in the page since the last frame.
  function flush() {
    if (stopped) return;
    frame = 0;
    const nodes = queued;
    queued = new Set();
    for (const n of nodes) if (n.isConnected) scanBadges(n);
    scanAlbums();
    scanComposer();
    scanCollectionChips();
    scanTradeBoard();
    scanMissing();
    scanAlbumBar();
    scanMissions();
    scanMoreMenu();
    scanLadder();
    scanMobileNav();
    scanFavStars();
    scanMarket();
    scanRecycle();
    scanTutoMenu();
    scanConfirm();
    scanNamePickers();
    scanWallOption();
    scanMarketNames();
    scanChatMessages();
  }

  // Scans the whole page again.
  function refreshAll() {
    if (stopped) return;
    scanBadges(document);
    scanAlbums();
    scanComposer();
    scanCollectionChips();
    scanTradeBoard();
    scanMissing();
    scanAlbumBar();
    scanMissions();
    scanMoreMenu();
    scanLadder();
    scanMobileNav();
    scanFavStars();
    scanMarket();
    scanRecycle();
    scanTutoMenu();
    scanConfirm();
  }

  let stopped = false;
  // Removes everything the extension added and stops.
  function shutdown() {
    if (stopped) return;
    stopped = true;
    if (document.documentElement.dataset.kyxOwner === owner) delete document.documentElement.dataset.kyxOwner;
    clearInterval(ticker);
    observer.disconnect();
    document.querySelectorAll('.kyx-badge, .kyx-toggle, .kyx-only, .kyx-favtrade, .kyx-chip, .kyx-series, .kyx-price, .kyx-balance, .kyx-ghost, .kyx-ghost-name, .kyx-order, .kyx-modal-back, .kyx-smart, .kyx-smart-msg, .kyx-count, .kyx-more, .kyx-subs-entry, .kyx-view, .kyx-friends, .kyx-friends-tab, .kyx-fav, .kyx-favmarket, .kyx-fav-pick, .kyx-coll-pick, .kyx-rec, .kyx-tuto-back, .kyx-tuto-entry, .kyx-spot, .kyx-bubble, .kyx-pick, .kyx-grad-pick').forEach((el) => el.remove());
    delete document.documentElement.dataset.kyxView;
    delete document.documentElement.dataset.kyxBoardIds;
    document.querySelectorAll('[data-kyx-hidden], [data-kyx-pos], [data-kyx-watched], [data-kyx-ghost]').forEach((el) => {
      delete el.dataset.kyxHidden;
      delete el.dataset.kyxPos;
      delete el.dataset.kyxWatched;
      delete el.dataset.kyxGhost;
    });
  }

  let lastPath = location.pathname;
  let lastPage = location.pathname + location.search; // a market tab counts as a page
  let lastSubsTry = 0;
  const ticker = setInterval(() => {
    if (!alive()) return shutdown();
    syncAuth();
    if (document.querySelector('.kyx-view') && !VIEWS.some((v) => v.hash === location.hash && viewOpen(v))) closeView(); // left through a link of the site
    checkBoostersDay();
    if (Date.now() - lastSubsTry > 30e3) {
      lastSubsTry = Date.now();
      send({ type: 'subs-auto' });
    }
    if (location.pathname + location.search !== lastPage) {
      lastPage = location.pathname + location.search;
      send({ type: 'subs-auto', pageChanged: true });
    }
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      autoMore = 0;
      scanBadges(document); // badge rules depend on the page
    }
  }, 1000);

  (async () => {
    const stored = await chrome.storage.local.get(['settings', 'collection', 'catalog', 'partner', 'smartLock', 'favSeries', 'marketFav', 'tradeFav', 'collectionFav', 'boardFav']);
    applyStorage(stored);
    smartLock = new Set(stored.smartLock ?? []);
    favSeries = new Set(stored.favSeries ?? []);
    marketFav = !!stored.marketFav;
    tradeFav = !!stored.tradeFav;
    collectionFav = !!stored.collectionFav;
    boardFav = !!stored.boardFav;
    if (partner && Date.now() - (partner.at ?? 0) > 30 * 60e3) partner = null;
    document.querySelectorAll('#kyx-root').forEach((el) => el.remove()); // left by older versions
    window.addEventListener('hashchange', onViewHash);
    window.addEventListener('hashchange', onTutorialHash);
    syncAuth();
    myTier();
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    refreshAll();
    onTutorialHash();
    showTutorialOnce();
    const view = VIEWS.find((v) => v.hash === location.hash);
    if (view) {
      if (!catalog) await chrome.storage.local.get('catalog').then(applyStorage);
      view.open();
    }
    if (!catalog || !coll) send({ type: 'ensure-data' });
  })();
})();
