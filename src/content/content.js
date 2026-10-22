// Kyara Games on kyara.games: card badges, completed and small albums hidden, missing cards greyed out with a buy order,
// "Bloquer sauf doublons", last copy of a card on sale locked, compact completed series on Missions, "Boosters rentables" page,
// "Amis" filter on the Classement page, "Manquantes" chip on Collection and the "Ses doublons" filter in the trade composer.
(() => {
  const DEFAULTS = {
    hideComplete: true,
    hideSmall: false,
    badgeMissing: true,
    badgeDupes: true,
    theirDupes: true,
    lockLastListed: true
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
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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

  const pct = (p) => `${num(p * 100, p < 0.1 ? 1 : 0)} %`;
  const boosters = (n) => `${num(n)} booster${n >= 2 ? 's' : ''}`;

  // rows: [{ pack, hits: wanted cards per booster on average, chance: chance of at least one per booster }],
  // ranked from the most to the least profitable: free boosters first, then the fewest chakra per wanted card.
  // what: what is looked for, as in "pour avoir {what}".
  function renderPacks(page, rows, what) {
    const list = page.querySelector('.kyx-b-list');
    const summary = page.querySelector('.kyx-b-summary');
    rows = rows.filter((r) => r.hits > 0).map((r) => ({ ...r, cost: r.pack.chakraPrice > 0 ? r.pack.chakraPrice / r.hits : 0 }));
    rows.sort((a, b) => a.cost - b.cost || b.hits - a.hits);
    list.innerHTML = '';
    summary.innerHTML = '';
    if (!rows.length) {
      list.innerHTML = '<li class="kyx-b-empty">Aucun booster en vente ne contient ça en ce moment.</li>';
      return;
    }
    // How many boosters to open on average for one wanted card, said plainly.
    const needed = (r) => (r.hits >= 1 ? `≈ ${num(r.hits, 1)} par booster en moyenne` : `≈ ${boosters(Math.max(1, Math.round(1 / r.hits)))} à ouvrir en moyenne`);
    const free = rows.find((r) => !r.cost);
    const paid = rows.filter((r) => r.cost);
    const best = paid[0];
    const lines = [];
    if (best) lines.push(`<b>Meilleur achat :</b> <span class="kyx-b-n"></span> · ${needed(best)} pour avoir ${what}, soit ≈ ${chakra(best.cost)} au total.`);
    if (free) lines.push(`<b>Gratuit :</b> <span class="kyx-b-n"></span> · ${needed(free)}.`);
    if (paid.length > 1) {
      const worst = paid[paid.length - 1];
      lines.push(`<b>À éviter :</b> <span class="kyx-b-n"></span> · ≈ ${chakra(worst.cost)}, ${num(worst.cost / best.cost, 1)} fois plus cher que le meilleur achat.`);
    }
    summary.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
    const names = summary.querySelectorAll('.kyx-b-n');
    [best, free, paid.length > 1 ? paid[paid.length - 1] : null].filter(Boolean).forEach((r, i) => (names[i].textContent = r.pack.name));

    rows.forEach((r, i) => {
      const li = document.createElement('li');
      const p = r.pack;
      const price = p.chakraPrice > 0 ? `${chakra(p.chakraPrice)} le booster` : 'booster gratuit';
      const freeOk = p.usesFreePacks ? '<span class="kyx-b-tag">accepte tes boosters gratuits</span>' : '';
      const label = i === 0 ? 'Le plus rentable' : i === rows.length - 1 && rows.length > 2 ? 'Le moins rentable' : '';
      // Profitability against the best paid booster (a free booster has no chakra cost to compare).
      const score = r.cost ? Math.round((best.cost / r.cost) * 100) : null;
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
          <span class="kyx-b-num">${r.cost ? `<b>≈ ${chakra(r.cost)}</b><small>dépensés en moyenne</small>` : `<b class="kyx-b-free">Gratuit</b><small>aucun chakra</small>`}</span>
          ${score != null ? `<span class="kyx-b-bar"><span><i style="width:${Math.max(2, Math.min(100, score))}%"></i></span><small>${score >= 100 ? 'Rentabilité 100 % (la référence)' : `Rentabilité ${score} % du meilleur achat`}</small></span>` : ''}
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
        <div class="kyx-b-summary"></div>
        <ol class="kyx-b-list"></ol>
        <p class="kyx-page-foot">Comment c’est calculé : avec les taux publiés par le site, on compte combien de boosters il faut ouvrir en moyenne pour tomber une fois sur ce que tu cherches, puis combien de chakra ça représente (nombre de boosters × prix du booster). La rentabilité compare chaque booster au meilleur achat : 50 % veut dire qu’il coûte deux fois plus cher pour le même résultat. Ce sont des moyennes, la chance peut faire mieux ou pire. Cliquer sur un booster ouvre sa page, rien n’est acheté.</p>`;
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
    scanAlbumBar();
    scanMissions();
    scanMoreMenu();
    scanLadder();
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
    scanConfirm();
  }

  let stopped = false;
  function shutdown() {
    if (stopped) return;
    stopped = true;
    clearInterval(ticker);
    observer.disconnect();
    document.querySelectorAll('.kyx-badge, .kyx-toggle, .kyx-only, .kyx-missing, .kyx-series, .kyx-price, .kyx-balance, .kyx-ghost, .kyx-ghost-name, .kyx-order, .kyx-modal-back, .kyx-smart, .kyx-smart-msg, .kyx-count, .kyx-more, .kyx-view, .kyx-friends, .kyx-friends-tab').forEach((el) => el.remove());
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
    const stored = await chrome.storage.local.get(['settings', 'collection', 'catalog', 'partner', 'smartLock']);
    applyStorage(stored);
    smartLock = new Set(stored.smartLock ?? []);
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
