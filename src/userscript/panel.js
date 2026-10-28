// Userscript: settings panel opened from the site's menu ("Plus" on a computer, the menu sheet on a phone),
// and the banners of new versions.
(() => {
  const OPTIONS = [
    ['hideComplete', 'Masquer les séries complètes'],
    ['hideSmall', 'Masquer les séries de moins de 5 persos'],
    ['badgeMissing', 'Badge « Manquante » sur les cartes (hors marché, sauf pendant un échange)'],
    ['badgeDupes', 'Badge « ×N » sur mes doublons, « Unique » sur mes cartes en un seul exemplaire et « Possédée » sur les cartes proposées que j’ai déjà'],
    ['theirDupes', 'Filtre « Ses doublons » activé d’office dans les propositions d’échange'],
    ['lockLastListed', 'Verrouiller le dernier exemplaire d’une carte dont un doublon est en vente'],
    ['cardToWiki', 'Page Collection : un clic sur une carte que j’ai ouvre sa fiche'],
    ['notifyUpdated', 'Afficher les nouveautés après une mise à jour du script']
  ];

  // Settings panel: checkboxes and the code for another device.
  async function openSettings() {
    document.querySelector('.kyx-modal-back')?.remove();
    const settings = await getSettings();
    const back = document.createElement('div');
    back.className = 'kyx-modal-back';
    back.innerHTML = `
      <section class="kyx-modal kyx-settings" role="dialog" aria-modal="true" aria-label="Réglages de Kyara Games">
        <div class="kyx-modal-head"><div><small>Script Kyara Games · ${KYX_VERSION}</small><b class="kyx-modal-name">Réglages</b></div></div>
        <div class="kyx-settings-list"></div>
        <div class="kyx-sync">
          <b>Autre appareil</b>
          <p class="kyx-settings-note">Pour retrouver tes réglages et tes œuvres favorites sur un autre appareil (PC, téléphone, extension ou script) : copie ton code ici, puis colle-le sur l’autre appareil. Les verrous de cartes et les envies sont déjà gardés par Kyara sur ton compte.</p>
          <div class="kyx-order-btns"><button type="button" class="kyx-sync-copy">Copier mon code</button></div>
          <textarea rows="2" placeholder="Tape ou colle ici le code de ton autre appareil (ex. 1A2B-3C4D-…)" spellcheck="false"></textarea>
          <div class="kyx-order-btns"><button type="button" class="kyx-sync-import">Importer ce code</button></div>
          <p class="kyx-settings-note kyx-sync-msg" role="status"></p>
        </div>
        <div class="kyx-sync kyx-push">
          <b>Notifications sur cet appareil</b>
          <p class="kyx-settings-note">Le script ne peut pas envoyer de notifications, mais Kyara a les siennes, qui arrivent même site fermé : boosters gratuits pleins, marché et envies, échanges, amis, compte.</p>
          <div class="kyx-order-btns"><button type="button" class="kyx-push-go">Activer les notifications de Kyara</button></div>
          <p class="kyx-settings-note kyx-push-msg" role="status"></p>
        </div>
        <p class="kyx-settings-note">Les mises à jour du script s’installent toutes seules par ton gestionnaire de scripts.</p>
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
    const area = back.querySelector('.kyx-sync textarea');
    const msg = (t) => (back.querySelector('.kyx-sync-msg').textContent = t);
    back.querySelector('.kyx-sync-copy').addEventListener('click', async () => {
      const code = await exportCode();
      area.value = code;
      area.select();
      const copied = await navigator.clipboard?.writeText(code).then(() => true, () => false);
      msg(copied ? 'Code copié ✔ Colle-le sur ton autre appareil.' : 'Copie le code ci-dessus et colle-le sur ton autre appareil.');
    });
    back.querySelector('.kyx-sync-import').addEventListener('click', async () => {
      try {
        const res = await importCode(area.value);
        const now = await getSettings();
        list.querySelectorAll('input').forEach((box, i) => (box.checked = !!now[OPTIONS[i][0]]));
        msg(`Importé ✔ ${res.favs} œuvre${res.favs > 1 ? 's' : ''} favorite${res.favs > 1 ? 's' : ''}, réglages à jour.`);
      } catch (e) {
        msg(e?.code === 'other_catalog' ? 'Ce code a été fait avec un autre catalogue de cartes : recrée-le sur l’autre appareil, puis réessaie.' : 'Ce code n’est pas reconnu : vérifie qu’il est recopié en entier.');
      }
    });
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    // Opens the site's own push settings: its bell, then "Notifications sur cet appareil" (not on iPhone and iPad).
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    back.querySelector('.kyx-push').hidden = ios;
    back.querySelector('.kyx-push-go').addEventListener('click', () => {
      const bell = document.querySelector('button.bell');
      if (!bell) {
        back.querySelector('.kyx-push-msg').textContent = 'Connecte-toi sur kyara.games, puis touche la cloche 🔔 en haut du site → « Notifications sur cet appareil ».';
        return;
      }
      close();
      if (bell.getAttribute('aria-expanded') !== 'true') bell.click();
      setTimeout(() => {
        const cfg = document.querySelector('button.cfg');
        if (cfg) cfg.click();
      }, 150);
    });
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => e.target === back && close());
    back.querySelector('.kyx-settings-close').addEventListener('click', close);
    document.body.appendChild(back);
  }

  // "Kyara Games" entry at the end of a menu of the site; closer: the button that closes that menu.
  function addEntry(menu, closer) {
    if (!menu || menu.querySelector(':scope > .kyx-settings-entry')) return;
    const model = menu.querySelector(':scope > a:not(.kyx-more):not(.kyx-subs-entry)');
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

  // Asks GitHub for a new version every 15 minutes while kyara.games is open, once for all the open tabs.
  const UPDATE_EVERY = 15 * 60e3;
  async function lookForUpdate(maxAge = UPDATE_EVERY) {
    const { updateCheckedAt } = await chrome.storage.local.get('updateCheckedAt');
    if (Date.now() - (updateCheckedAt ?? 0) >= maxAge) {
      await chrome.storage.local.set({ updateCheckedAt: Date.now() });
      await checkUpdate().catch(() => null);
    }
    offerUpdate();
  }

  // iPhone and iPad: Userscripts updates from its Safari window, which a page cannot open.
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  // "Kyara Games X est disponible" banner with the "Mettre à jour" button.
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
    // Elsewhere, the script of the latest release: Tampermonkey offers to update.
    bar.querySelector('.kyx-update-go').href = IOS ? '#' : `https://github.com/${REPO}/releases/latest/download/kyara-games.user.js`;
    bar.querySelector('.kyx-update-notes').href = `https://github.com/${REPO}/releases/latest`;
    bar.querySelector('.kyx-update-go').addEventListener('click', (e) => {
      const go = bar.querySelector('.kyx-update-go');
      if (IOS) {
        // Userscripts updates the script from its own Safari window: the way there, nothing to download.
        e.preventDefault();
        bar.classList.add('steps');
        bar.querySelector('span').innerHTML = '<b>Pour mettre à jour :</b><ol class="kyx-update-steps"><li>Touche <b>ᴀA</b> (ou la pièce de puzzle) à côté de l’adresse, puis <b>Userscripts</b>.</li><li>En haut, touche l’icône des mises à jour (deux flèches en rond).</li><li>Kyara Games n’est pas dans la liste ? Touche <b>Check Updates</b>.</li><li>Touche <b>Update</b> à côté de Kyara Games, puis recharge cette page.</li></ol>';
        go.remove();
        return;
      }
      bar.querySelector('span').textContent = 'Dernière étape : dans la page qui vient de s’ouvrir, clique sur « Mettre à jour » (ou « Installer »), puis reviens ici et recharge la page.';
      go.remove();
    });
    // Later: asked again in 12 hours.
    bar.querySelector('button').addEventListener('click', () => {
      bar.remove();
      chrome.storage.local.set({ updateLater: { version: update.version, until: Date.now() + 12 * 3600e3 } });
    });
    document.querySelector('.kyx-update-toast:not(.offer)')?.remove();
    document.body.appendChild(bar);
  }

  // List of links of the phone "Plus" sheet (bottom bar nav.mb), while it is open.
  const plusSheet = () => [...document.querySelectorAll('[role="dialog"] > ul')].find((ul) => ul.querySelector(':scope > li > a > .k')) ?? null;

  // "Kyara Games" entry in the "Plus" sheet, like the site's links.
  function addSheetEntry() {
    const list = plusSheet();
    if (!list || list.querySelector(':scope > li > .kyx-settings-entry')) return;
    const model = list.querySelector(':scope > li');
    const link = model?.querySelector(':scope > a');
    const mark = link?.querySelector(':scope > .k');
    if (!mark) return;
    const li = document.createElement('li');
    li.className = model.className;
    const a = document.createElement('a');
    a.className = link.className;
    a.classList.remove('on');
    a.classList.add('kyx-settings-entry');
    a.href = '#';
    const k = mark.cloneNode(false);
    k.textContent = '設';
    a.append(k, ' Kyara Games ');
    a.addEventListener('click', (e) => {
      e.preventDefault();
      list.closest('[role="dialog"]')?.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // closes the sheet, as a tap on its backdrop
      openSettings();
    });
    li.appendChild(a);
    list.insertBefore(li, list.querySelector(':scope > li:has(> .kyx-more), :scope > li:has(> .kyx-tuto-entry)'));
  }

  // Adds the entry to the site's menus.
  const scan = () => {
    addEntry(document.querySelector('#nav-more'), 'button[aria-controls="nav-more"][aria-expanded="true"]');
    addEntry(document.querySelector('#mobile-nav .sheet-grid'), 'button.burger[aria-controls="mobile-nav"]');
    addSheetEntry();
  };
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
  lookForUpdate();
  setInterval(() => lookForUpdate(), 60e3);
  chrome.storage.onChanged.addListener((changes) => ('update' in changes || 'updateLater' in changes) && offerUpdate());
})();
