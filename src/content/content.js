// Kyara Games on kyara.games: card badges, completed albums hidden "Manquantes" chip on Collection and the "Ses doublons" filter in the trade composer.
(() => {
  const DEFAULTS = {
    hideComplete: true,
    badgeMissing: true,
    badgeDupes: true
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

  // Where each badge is wanted: the market only inside the trade composer; duplicates on Collection and in trades,
  // and in trades also the cards held only once, so giving away a last copy is never a surprise.
  function badgeScope(img) {
    const trade = inComposer(img);
    const path = location.pathname;
    if (path.startsWith('/marche') && !trade) return { missing: false, dupes: false, single: false };
    return { missing: settings.badgeMissing, dupes: settings.badgeDupes && (trade || path === '/collection'), single: settings.badgeDupes && trade };
  }

  const MIN_SIZE = 48; // avatars and tiny chips stay clean
  function tag(img) {
    const m = CARD_SRC.exec(img.getAttribute('src') || '');
    const host = img.parentElement;
    if (!host) return;
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

  function albumComplete(li) {
    const meta = li.querySelector('.a-meta')?.textContent ?? '';
    const m = meta.replace(/[\s  ]/g, '').match(/(\d+)\/(\d+)/);
    if (m) return Number(m[1]) >= Number(m[2]);
    const bar = li.querySelector('.bar > span');
    if (bar && /^100(\.0+)?%$/.test(bar.style.width)) return true;
    const s = seriesIndex()?.get(norm(li.querySelector('.a-name')?.textContent));
    return s ? s.owned >= s.total : false;
  }

  const PAGE = 60; // the site renders albums 60 at a time behind an "Afficher plus" button
  let autoMore = 0;

  function scanAlbums() {
    const list = location.pathname === '/collection' ? document.querySelector('ul.albums') : null;
    if (!list) return;
    let hidden = 0;
    let visible = 0;
    for (const li of list.children) {
      const hide = settings.hideComplete && albumComplete(li);
      if (hide) {
        hidden++;
        if (li.dataset.kyxHidden !== '1') li.dataset.kyxHidden = '1';
      } else {
        visible++;
        if (li.dataset.kyxHidden) delete li.dataset.kyxHidden;
      }
    }
    albumToggle(list, hidden);
    // Hidden albums still use up the site's page: load the next ones until a full page of unfinished albums shows.
    const more = list.nextElementSibling?.matches('button') ? list.nextElementSibling : list.nextElementSibling?.querySelector('button');
    if (settings.hideComplete && visible < PAGE && more && autoMore < 40) {
      autoMore++;
      more.click();
    } else if (!more || visible >= PAGE) {
      autoMore = 0;
    }
  }

  // Toggle placed in the site's own toolbar, left of the "Trier" group.
  function albumToggle(list, hidden) {
    const tools = list.parentElement?.querySelector('.al-tools');
    const views = tools?.querySelector('.views');
    if (!views) return;
    let btn = tools.querySelector(':scope > .kyx-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kyx-toggle';
      btn.addEventListener('click', () => {
        if (!alive()) return shutdown();
        autoMore = 0;
        chrome.storage.local.get('settings').then(({ settings: s }) =>
          chrome.storage.local.set({ settings: { ...s, hideComplete: !settings.hideComplete } })
        );
      });
      tools.insertBefore(btn, views);
    }
    const index = seriesIndex();
    const done = index ? [...index.values()].filter((s) => s.owned >= s.total).length : hidden;
    const label = settings.hideComplete ? `✔ ${done} complet${done > 1 ? 's' : ''} masqué${done > 1 ? 's' : ''}` : 'Masquer les complets';
    if (btn.textContent !== label) btn.textContent = label;
    btn.setAttribute('aria-pressed', String(settings.hideComplete));
  }

  // ---------- series under each card of the trade confirmation ----------

  // "Confirmer l'échange" only shows name and rarity: add the series, cut short when it is long (full name on hover).
  function scanConfirm() {
    if (!catalog) return;
    for (const side of document.querySelectorAll('[role="dialog"] .cf-s')) {
      const m = CARD_SRC.exec(side.querySelector('img')?.getAttribute('src') || '');
      const name = m ? catalog.get(Number(m[1]))?.s : null;
      let el = side.querySelector(':scope > .kyx-series');
      if (!name) {
        el?.remove();
        continue;
      }
      if (!el) {
        el = document.createElement('span');
        el.className = 'kyx-series mut small';
        side.appendChild(el);
      }
      if (el.textContent !== name) {
        el.textContent = name;
        el.title = name;
      }
    }
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
  let theirDupes = false;
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
    const shelf = document.querySelector('[role="dialog"] .shelf');
    const chips = shelf?.querySelector('.filters .chips');
    if (!chips) {
      theirDupes = false;
      composerMore = 0;
      return;
    }
    const tabs = shelf.querySelectorAll('.tabs [role="tab"]');
    const theirs = tabs[1]?.getAttribute('aria-selected') === 'true';
    const active = theirs && theirDupes;
    let btn = chips.querySelector(':scope > .kyx-only');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      // The site's own chip classes, so it looks like its neighbours.
      btn.className = 'kyx-only only svelte-adlc8v';
      btn.textContent = 'Ses doublons';
      btn.addEventListener('click', () => {
        theirDupes = !theirDupes;
        composerMore = 0;
        scanComposer();
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
    scanConfirm();
  }

  function refreshAll() {
    if (stopped) return;
    scanBadges(document);
    scanAlbums();
    scanComposer();
    scanCollectionChips();
    scanConfirm();
  }

  let stopped = false;
  function shutdown() {
    if (stopped) return;
    stopped = true;
    clearInterval(ticker);
    observer.disconnect();
    document.querySelectorAll('.kyx-badge, .kyx-toggle, .kyx-only, .kyx-missing, .kyx-series').forEach((el) => el.remove());
    document.querySelectorAll('[data-kyx-hidden], [data-kyx-pos], [data-kyx-watched]').forEach((el) => {
      delete el.dataset.kyxHidden;
      delete el.dataset.kyxPos;
      delete el.dataset.kyxWatched;
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
