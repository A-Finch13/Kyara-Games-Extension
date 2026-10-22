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
    ['cardToWiki', 'Page Collection : un clic sur une carte que j’ai ouvre sa fiche']
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

  const scan = () => {
    addEntry(document.querySelector('#nav-more'), 'button[aria-controls="nav-more"][aria-expanded="true"]');
    addEntry(document.querySelector('#mobile-nav .sheet-grid'), 'button.burger[aria-controls="mobile-nav"]');
  };
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
