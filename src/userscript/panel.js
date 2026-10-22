// Userscript version: there is no popup, so the settings open from the site's own menu
// ("Plus" on a computer, the menu sheet on a phone).
(() => {
  const OPTIONS = [
    ['hideComplete', 'Masquer les séries complètes'],
    ['hideSmall', 'Masquer les séries de moins de 5 persos'],
    ['badgeMissing', 'Badge « Manquante » sur les cartes (hors marché, sauf pendant un échange)'],
    ['badgeDupes', 'Badge « ×N » sur mes doublons et « Unique » sur mes cartes en un seul exemplaire'],
    ['theirDupes', 'Filtre « Ses doublons » activé d’office dans les propositions d’échange'],
    ['lockLastListed', 'Verrouiller le dernier exemplaire d’une carte dont un doublon est en vente'],
    ['cardToWiki', 'Page Collection : un clic sur une carte que j’ai ouvre sa fiche'],
    ['notifyUpdated', 'Bandeau « nouvelle version installée » après une mise à jour du script']
  ];

  async function openSettings() {
    document.querySelector('.kyx-modal-back')?.remove();
    const settings = await getSettings();
    const back = document.createElement('div');
    back.className = 'kyx-modal-back';
    back.innerHTML = `
      <section class="kyx-modal kyx-settings" role="dialog" aria-modal="true" aria-label="Réglages de Kyara Games">
        <div class="kyx-modal-head"><div><small>Script Kyara Games · ${KYX_VERSION}</small><b class="kyx-modal-name">Réglages</b></div></div>
        <div class="kyx-settings-list"></div>
        <p class="kyx-settings-note">Les mises à jour du script s’installent toutes seules par ton gestionnaire de scripts. Les notifications ne sont disponibles qu’avec l’extension.</p>
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
    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => e.target === back && close());
    back.querySelector('.kyx-settings-close').addEventListener('click', close);
    document.body.appendChild(back);
  }

  // A copy of one of the menu's own items, at its end. closer: the button that closes that menu.
  function addEntry(menu, closer) {
    if (!menu || menu.querySelector(':scope > .kyx-settings-entry')) return;
    const model = menu.querySelector(':scope > a:not(.kyx-more)');
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

  // Tampermonkey and Userscripts install new versions silently: say it once, at the first visit after an update.
  // Nothing at the very first install.
  async function announceUpdate() {
    const { lastVersion } = await chrome.storage.local.get('lastVersion');
    if (lastVersion === KYX_VERSION) return;
    await chrome.storage.local.set({ lastVersion: KYX_VERSION });
    if (!lastVersion || !(await getSettings()).notifyUpdated) return;
    const bar = document.createElement('div');
    bar.className = 'kyx-update-toast';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>⬆ Kyara Games est passé en <b>${KYX_VERSION}</b></span>
      <a href="https://github.com/${REPO}/releases/tag/v${KYX_VERSION}" target="_blank" rel="noopener">Voir les nouveautés</a>
      <button type="button" aria-label="Fermer">✕</button>`;
    const close = () => bar.remove();
    bar.querySelector('a').addEventListener('click', close);
    bar.querySelector('button').addEventListener('click', close);
    document.body.appendChild(bar);
  }

  // Tampermonkey checks for new versions on its own schedule (once a day by default): the script also asks GitHub
  // every 15 minutes while kyara.games is open, once for all the open tabs, and offers the update.
  const UPDATE_EVERY = 15 * 60e3;
  async function lookForUpdate() {
    const { updateCheckedAt } = await chrome.storage.local.get('updateCheckedAt');
    if (Date.now() - (updateCheckedAt ?? 0) >= UPDATE_EVERY) {
      await chrome.storage.local.set({ updateCheckedAt: Date.now() });
      await checkUpdate().catch(() => null);
    }
    offerUpdate();
  }

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
    // The script of that release: Tampermonkey (or Userscripts) recognises it and offers to update.
    bar.querySelector('.kyx-update-go').href = `https://github.com/${REPO}/releases/download/v${update.version}/kyara-games.user.js`;
    bar.querySelector('.kyx-update-notes').href = update.url;
    bar.querySelector('.kyx-update-go').addEventListener('click', () => {
      bar.querySelector('span').textContent = 'Confirme la mise à jour dans Tampermonkey, puis recharge cette page.';
      bar.querySelector('.kyx-update-go').remove();
    });
    // Later: asked again in 12 hours.
    bar.querySelector('button').addEventListener('click', () => {
      bar.remove();
      chrome.storage.local.set({ updateLater: { version: update.version, until: Date.now() + 12 * 3600e3 } });
    });
    document.querySelector('.kyx-update-toast:not(.offer)')?.remove();
    document.body.appendChild(bar);
  }

  const scan = () => {
    addEntry(document.querySelector('#nav-more'), 'button[aria-controls="nav-more"][aria-expanded="true"]');
    addEntry(document.querySelector('#mobile-nav .sheet-grid'), 'button.burger[aria-controls="mobile-nav"]');
  };
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
  announceUpdate();
  lookForUpdate();
  setInterval(lookForUpdate, 60e3);
  chrome.storage.onChanged.addListener((changes) => ('update' in changes || 'updateLater' in changes) && offerUpdate());
})();
