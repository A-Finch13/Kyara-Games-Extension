import {
  RARITIES, RARITY, api, asList, cardImg, collectionMap, getSettings, loadCatalog, loadCollection,
  norm, seriesStats, setSettings, slimMe
} from '../lib/kyara.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n, w) => `${n.toLocaleString('fr-FR')} ${w}${n > 1 ? 's' : ''}`;
const byRarity = (a, b) => RARITIES.indexOf(a.r) - RARITIES.indexOf(b.r) || a.n.localeCompare(b.n);

let settings;
let catalog = [];
let byId = new Map();
let coll = new Map();
let stats = [];

// ---------- tabs ----------

document.querySelectorAll('[role=tab]').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    if (tab.dataset.tab === 'trade') renderTrade();
  })
);

function notice(text) {
  const el = $('#notice');
  el.hidden = !text;
  el.innerHTML = text ?? '';
}

const thumb = (c, extra = '') => `
  <figure class="card" style="--rc:${RARITY[c.r]?.color ?? '#888'}" title="${esc(c.n)} — ${esc(c.s)} · ${RARITY[c.r]?.label ?? ''}">
    <img loading="lazy" src="${cardImg(c.id)}" alt="">${extra}
    <figcaption><b>${esc(c.n)}</b><span>${esc(c.num ?? '')}</span></figcaption>
  </figure>`;

// ---------- header ----------

function renderMe(me) {
  if (!me) return;
  $('#who').textContent = me.pseudo ?? 'Connecté';
  const max = me.freePacksMax ?? 10;
  const full = me.freePacks >= max;
  let next = '';
  if (!full && me.nextFreeAt) {
    const s = Math.max(0, Math.round((Date.parse(me.nextFreeAt) - Date.now()) / 1000));
    next = `<small>+1 dans ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</small>`;
  }
  $('#packs').className = `packs${full ? ' full' : ''}`;
  $('#packs').innerHTML = `<b>${me.freePacks}/${max}</b> boosters${next}`;
}

// ---------- albums ----------

function renderAlbums() {
  const q = norm($('#album-q').value);
  const sort = $('#album-sort').value;
  const done = stats.filter((s) => s.complete).length;
  $('#album-summary').textContent = `${done} / ${stats.length} albums complets · ${coll.size ? [...coll.values()].filter((v) => v.qty > 0).length.toLocaleString('fr-FR') : 0} / ${catalog.length.toLocaleString('fr-FR')} cartes`;
  const list = stats
    .filter((s) => !(settings.hideComplete && s.complete) && !(settings.hideSmall && s.total < 4) && (!q || norm(s.name).includes(q)))
    .sort(
      sort === 'az' ? (a, b) => a.name.localeCompare(b.name)
        : sort === 'pct' ? (a, b) => b.pct - a.pct || a.name.localeCompare(b.name)
        : (a, b) => a.complete - b.complete || (a.total - a.owned) - (b.total - b.owned) || b.pct - a.pct
    );
  $('#albums').innerHTML = list.slice(0, 300).map((s) => `
    <li class="${s.complete ? 'done' : ''}" data-serie="${esc(s.name)}">
      <div class="a-top"><b>${esc(s.name)}</b><span>${s.owned}/${s.total}</span></div>
      <div class="bar"><i style="width:${(s.pct * 100).toFixed(1)}%"></i></div>
      ${s.complete ? '<small>Complet ✔</small>' : `<small>${plural(s.total - s.owned, 'manquante')}</small>`}
    </li>`).join('') || '<li class="empty">Aucun album à afficher.</li>';
}

$('#album-q').addEventListener('input', renderAlbums);
$('#album-sort').addEventListener('change', renderAlbums);
$('#albums').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-serie]');
  if (!li) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return openSite(`/collection?serie=${encodeURIComponent(li.dataset.serie)}`);
  $('#missing-s').value = li.dataset.serie;
  document.querySelector('[data-tab=missing]').click();
  renderMissing();
});

// ---------- missing ----------

let missingLimit = 90;
function renderMissing() {
  const q = norm($('#missing-q').value);
  const r = $('#missing-r').value;
  const s = $('#missing-s').value;
  const list = catalog
    .filter((c) => (coll.get(c.id)?.qty ?? 0) === 0)
    .filter((c) => (!r || c.r === r) && (!s || c.s === s) && (!q || norm(c.n).includes(q) || norm(c.s).includes(q)))
    .sort(byRarity);
  $('#missing-summary').innerHTML = `${plural(list.length, 'carte manquante')}${s ? ` · <a href="#" data-open="/collection?serie=${encodeURIComponent(s)}">voir l’album ↗</a>` : ''}`;
  $('#missing').innerHTML = list.slice(0, missingLimit).map((c) => thumb(c)).join('') +
    (list.length > missingLimit ? `<button class="more" id="missing-more">Afficher plus (${list.length - missingLimit})</button>` : '');
}

['#missing-q', '#missing-r', '#missing-s'].forEach((id) =>
  $(id).addEventListener(id === '#missing-q' ? 'input' : 'change', () => { missingLimit = 90; renderMissing(); })
);
$('#missing').addEventListener('click', (e) => {
  if (e.target.id === 'missing-more') { missingLimit += 180; renderMissing(); }
});

// ---------- trade ----------

let tradeData = null;

async function loadPartners() {
  const pick = $('#partner-pick');
  const { partner } = await chrome.storage.local.get('partner');
  const options = new Map();
  if (partner?.id) options.set(String(partner.id), `${partner.pseudo ?? 'Dernier échange'} (dernier échange)`);
  try {
    const friends = asList(await api('/me/friends'), 'friends', 'items', 'list');
    for (const f of friends) {
      const u = f.user ?? f.friend ?? f;
      const id = u.id ?? u.userId ?? f.userId;
      if (id != null && !options.has(String(id))) options.set(String(id), `${u.pseudo ?? u.name ?? id} · ami`);
    }
  } catch {}
  pick.innerHTML = '<option value="">Choisir un joueur…</option>' +
    [...options].map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
  if (partner?.id) {
    pick.value = String(partner.id);
    tradeData = partner;
    renderTrade();
  }
}

$('#partner-pick').addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id) return;
  $('#trade').innerHTML = '<p class="hint">Chargement…</p>';
  const [available, owned, profile, shared] = await Promise.allSettled([
    api(`/trades/available/${encodeURIComponent(id)}`),
    api(`/trades/owned/${encodeURIComponent(id)}`),
    api(`/users/${encodeURIComponent(id)}`),
    api(`/me/friends/${encodeURIComponent(id)}/collection`)
  ]);
  const val = (r) => (r.status === 'fulfilled' ? r.value : null);
  const sharedList = Array.isArray(val(shared)) ? val(shared) : null;
  tradeData = {
    id,
    pseudo: val(profile)?.pseudo ?? e.target.selectedOptions[0].textContent.split(' ·')[0],
    tradeable: (Array.isArray(val(available)) ? val(available) : []).map((x) => [x.characterId ?? x.id, x.n ?? 1]),
    owned: sharedList ? sharedList.map((x) => x.id ?? x.characterId) : Array.isArray(val(owned)) ? val(owned) : null,
    spare: sharedList ? sharedList.filter((x) => (x.spare ?? 0) > 0).map((x) => [x.id ?? x.characterId, x.spare]) : undefined
  };
  renderTrade();
});

function renderTrade() {
  const el = $('#trade');
  if (!tradeData) return void (el.innerHTML = '');
  const card = ([id, k]) => ({ ...(byId.get(id) ?? { id, n: `#${id}`, s: '', r: 'C' }), k });
  const theirs = (tradeData.spare ?? tradeData.tradeable ?? []).map(card).sort(byRarity);
  const label = tradeData.spare ? 'Ses doublons' : 'Ses cartes échangeables';
  const needed = theirs.filter((c) => (coll.get(c.id)?.qty ?? 0) === 0);
  const owned = tradeData.owned ? new Set(tradeData.owned) : null;
  const mine = [...coll.entries()]
    .filter(([, v]) => v.qty > 1 && (v.listable ?? v.qty - 1) > 0)
    .map(([id, v]) => card([id, Math.min(v.listable ?? v.qty - 1, v.qty - 1)]))
    .filter((c) => !owned || !owned.has(c.id))
    .sort(byRarity);
  const block = (title, list, hint = '') => `
    <details open><summary>${title} <span class="n">${list.length}</span></summary>
      ${hint ? `<p class="hint">${hint}</p>` : ''}
      <div class="grid">${list.slice(0, 120).map((c) => thumb(c, c.k > 1 ? `<i class="q">×${c.k}</i>` : '')).join('') || '<p class="hint">Aucune.</p>'}</div>
    </details>`;
  el.innerHTML = `<h2>Avec ${esc(tradeData.pseudo ?? 'ce joueur')}</h2>` +
    block('Il a, il te manque', needed, `${label} que tu n’as pas encore.`) +
    block(label, theirs) +
    block('Tes doublons qui lui manquent', mine, owned ? '' : 'Sa collection n’est pas visible : tous tes doublons sont listés.');
}

// ---------- settings ----------

function bindSettings() {
  document.querySelectorAll('[data-setting]').forEach((input) => {
    const key = input.dataset.setting;
    if (input.type === 'checkbox') input.checked = !!settings[key];
    else input.value = String(settings[key]);
    input.addEventListener('change', async () => {
      const value = input.type === 'checkbox' ? input.checked : Number(input.value);
      settings = await setSettings({ [key]: value });
      document.querySelectorAll(`[data-setting="${key}"]`).forEach((other) => other !== input && other.type === 'checkbox' && (other.checked = value));
      if (key === 'hideComplete' || key === 'hideSmall') renderAlbums();
    });
  });
}

$('#test').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'test-notification' }));
$('#refresh').addEventListener('click', async (e) => {
  e.target.disabled = true;
  await chrome.runtime.sendMessage({ type: 'refresh' });
  await loadData(true);
  e.target.disabled = false;
});

function openSite(href) {
  chrome.runtime.sendMessage({ type: 'open', href });
  window.close();
}
$('#open-site').addEventListener('click', (e) => { e.preventDefault(); openSite('/'); });
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-open]');
  if (a) { e.preventDefault(); openSite(a.dataset.open); }
});

// ---------- boot ----------

// Firefox can install the extension without access to kyara.games: it has to be granted from a click.
const SITE = { origins: ['https://kyara.games/*'] };
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#grant')) return;
  e.preventDefault();
  if (await chrome.permissions.request(SITE)) loadData(true);
});

async function loadData(force = false) {
  if (!(await chrome.permissions.contains(SITE))) {
    return notice('L’extension n’a pas encore accès à kyara.games. <a href="#" id="grant">Autoriser l’accès</a>, puis recharge l’onglet du site.');
  }
  const { auth, authValid, me } = await chrome.storage.local.get(['auth', 'authValid', 'me']);
  renderMe(me);
  try {
    catalog = await loadCatalog(force);
  } catch {
    return notice('Impossible de charger le catalogue Kyara. Vérifie ta connexion.');
  }
  byId = new Map(catalog.map((c) => [c.id, c]));
  if (!auth?.token || authValid === false) {
    notice(`Ouvre <a href="#" data-open="/">kyara.games</a> et connecte-toi : l’extension récupère ta session automatiquement.`);
  } else {
    notice(null);
  }
  try {
    coll = collectionMap(await loadCollection(force));
  } catch {
    coll = new Map();
  }
  stats = seriesStats(catalog, coll);

  const series = [...new Set(catalog.map((c) => c.s))].sort((a, b) => a.localeCompare(b));
  const keep = $('#missing-s').value;
  $('#missing-s').innerHTML = '<option value="">Tous les albums</option>' +
    series.map((s) => {
      const st = stats.find((x) => x.name === s);
      return `<option value="${esc(s)}">${esc(s)} (${st.total - st.owned})</option>`;
    }).join('');
  $('#missing-s').value = keep;
  renderAlbums();
  renderMissing();
  renderTrade();

  if (auth?.token) {
    api('/me').then((u) => {
      const m = slimMe(u);
      if (!m) return;
      chrome.storage.local.set({ me: m });
      renderMe(m);
    }).catch(() => {});
  }
}

// ---------- new version ----------

const FIREFOX = navigator.userAgent.includes('Firefox');
let shownUpdate = null;

function renderUpdate(update) {
  $('#update').hidden = !update;
  if (!update || update.version === shownUpdate?.version) return;
  shownUpdate = update;
  $('#update-text').textContent = `⬆ Kyara Games ${update.version} est disponible`;
  $('#update-go').disabled = false;
  $('#update-go').textContent = 'Mettre à jour';
  $('#update-help').hidden = true;
}

function updateHelp(html) {
  $('#update-help').innerHTML = html;
  $('#update-help').hidden = false;
}

// The updater installed on the computer replaces the files, then the extension reloads itself (the popup closes).
$('#update-go').addEventListener('click', async () => {
  const btn = $('#update-go');
  btn.disabled = true;
  btn.textContent = 'Mise à jour…';
  const res = await chrome.runtime.sendMessage({ type: 'install-update' }).catch(() => null);
  if (res?.ok) {
    btn.textContent = 'Installée ✔';
    updateHelp(`Version ${esc(res.version)} installée, l’extension redémarre. Recharge ensuite l’onglet kyara.games.`);
    return;
  }
  btn.disabled = false;
  btn.textContent = 'Réessayer';
  const update = res?.update ?? shownUpdate;
  const file = (FIREFOX ? update?.xpi : update?.zip) ?? update?.url ?? '';
  const download = `<a href="#" data-open="${esc(file)}">télécharger la mise à jour</a>`;
  if (res?.error === 'no_updater' || res?.error === 'unknown_extension') {
    updateHelp(
      FIREFOX
        ? `Firefox installe lui-même un module signé : ${download}. Pour un module chargé depuis un dossier, lance une fois <b>installer-mises-a-jour.bat</b> dans ce dossier.`
        : `Première fois : lance <b>installer-mises-a-jour.bat</b> dans le dossier de l’extension (une seule fois), puis réessaie. Sinon, ${download}.`
    );
  } else {
    const detail = res?.detail ? ` (${esc(String(res.detail).slice(0, 200))})` : '';
    updateHelp(`La mise à jour a échoué : ${esc(res?.error ?? 'pas de réponse')}${detail}. Tu peux ${download}.`);
  }
});

$('#update-help').addEventListener('click', (e) => {
  const link = e.target.closest('[data-open]');
  if (!link) return;
  e.preventDefault();
  if (link.dataset.open) chrome.tabs.create({ url: link.dataset.open });
});

(async () => {
  settings = await getSettings();
  $('#missing-r').innerHTML += RARITIES.map((r) => `<option value="${r}">${RARITY[r].label}</option>`).join('');
  bindSettings();
  await loadData();
  loadPartners();
  renderUpdate((await chrome.storage.local.get('update')).update);
  chrome.runtime.sendMessage({ type: 'check-update' }).then(async () => renderUpdate((await chrome.storage.local.get('update')).update)).catch(() => {});
  setInterval(async () => renderMe((await chrome.storage.local.get('me')).me), 1000);
})();
