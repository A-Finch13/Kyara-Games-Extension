"""Builds the browser packages into dist/.

    python build.py

dist/firefox/                      folder to load in about:debugging
dist/kyara-games-firefox.xpi       package for Firefox (to try it; Firefox users install the userscript)
dist/kyara-games-chromium.zip      package for Brave / Chrome / Edge / Opera
dist/kyara-games.user.js           userscript for Tampermonkey / Violentmonkey / Userscripts (phones, iPhone)
kyara-games.user.js                the same userscript, kept in the repository
"""
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
SHARED = ['src', 'icons', 'updater', 'installer-mises-a-jour.bat', 'README.md']


# The Windows updater only serves Brave / Chrome / Edge: not in the Firefox package.
CHROMIUM_ONLY = {'updater', 'installer-mises-a-jour.bat'}


def files(firefox=False):
    for name in SHARED:
        if firefox and name in CHROMIUM_ONLY:
            continue
        p = ROOT / name
        if p.is_file():
            yield p
        else:
            yield from (f for f in sorted(p.rglob('*')) if f.is_file() and 'userscript' not in f.parts)


def package(out, manifest, firefox=False):
    # Entries always use forward slashes: Firefox rejects archives made with Windows separators.
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', manifest)
        for f in files(firefox):
            z.write(f, f.relative_to(ROOT).as_posix())


REPO = 'A-Finch13/Kyara-Games-Extension'


def userscript(version):
    """The same page code as the extension, with a stand-in for the extension APIs (src/userscript/)."""
    src = ROOT / 'src'
    read = lambda p: (src / p).read_text(encoding='utf-8').replace('\r\n', '\n')
    lib = read('lib/kyara.js').replace('export const ', 'const ').replace('export async function ', 'async function ') \
        .replace('export function ', 'function ').replace('export class ', 'class ')
    if 'export ' in lib:
        raise SystemExit('kyara.js : un export n’est pas pris en charge par le script')
    css = read('content/content.css').replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
    latest = f'https://github.com/{REPO}/releases/latest/download/kyara-games.user.js'
    header = f"""// ==UserScript==
// @name         Kyara Games
// @namespace    https://github.com/{REPO}
// @version      {version}
// @description  Compagnon non officiel pour kyara.games : cartes manquantes en gris avec ordre d'achat, albums complets masqués, doublons pendant les échanges, booster le plus rentable, classement entre amis.
// @author       A-Finch13
// @license      MIT
// @match        https://kyara.games/*
// @icon         https://raw.githubusercontent.com/{REPO}/main/icons/icon128.png
// @homepageURL  https://github.com/{REPO}
// @supportURL   https://github.com/{REPO}/issues
// @updateURL    {latest}
// @downloadURL  {latest}
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// ==/UserScript==

/*
 * Kyara Games — version script
 *
 * Ce script ajoute à kyara.games les mêmes fonctions que l'extension Kyara Games :
 *  - Collection : cartes manquantes en gris avec leur prix et un bouton « Ordre d'achat », puces « Possédées »
 *    et « Manquantes », séries complètes et petites séries masquées, « Bloquer sauf doublons », fiche en un clic ;
 *  - Échanges : badges ×N (doublon) et « Unique » (dernier exemplaire), filtre « Ses doublons »,
 *    série et prix des cartes à la confirmation ;
 *  - Boosters rentables (menu Plus), filtre « Amis » du classement, séries complètes condensées dans Missions ;
 *  - Réglages : menu Plus → 設 Kyara Games (ou le menu sur téléphone).
 *
 * Il ne communique qu'avec https://kyara.games : ta session reste dans ton navigateur et n'est envoyée nulle part ailleurs.
 * Pas de notifications : un script ne tourne que quand une page kyara.games est ouverte.
 * Si l'extension Kyara Games est aussi installée, le script se met en retrait.
 *
 * Fichier généré par build.py à partir du code de l'extension (https://github.com/{REPO}) : ne pas le modifier à la main.
 *
 * Parties du script, dans l'ordre :
 *  1. shim.js    — remplace les fonctions propres aux extensions (stockage, messages) ;
 *  2. kyara.js   — accès à l'API de kyara.games, catalogue des cartes et collection ;
 *  3. bridge.js  — fait dans la page le travail du service de fond de l'extension ;
 *  4. inject.js  — lit les réponses que le site reçoit déjà (collection, échanges), et resserre la recherche d’offres d’échange sur les œuvres favorites quand « ★ Favoris » est actif ;
 *  5. tutorial.js et content.js — textes du tutoriel et des nouveautés, puis tout ce qui s'affiche sur le site ;
 *  6. panel.js   — panneau de réglages dans le menu du site.
 */
"""
    body = f"""(() => {{
'use strict';
if (window.__kyaraGamesUserscript) return;
window.__kyaraGamesUserscript = true;
const KYX_VERSION = '{version}';

// ---------- 1. src/userscript/shim.js : stockage et messages, à la place des fonctions d'extension ----------
{read('userscript/shim.js')}
// ---------- 2. src/lib/kyara.js : API de kyara.games, catalogue et collection ----------
{lib}
// ---------- 3. src/userscript/bridge.js : le travail du service de fond, dans la page ----------
{read('userscript/bridge.js')}
// ---------- 4. src/content/inject.js : lit les réponses que le site reçoit déjà ----------
{read('content/inject.js')}
const start = () => {{
  const style = document.createElement('style');
  style.id = 'kyx-style';
  style.textContent = `{css}`;
  document.head.appendChild(style);
  // ---------- 5. src/content/tutorial.js et content.js : tutoriel, puis tout ce qui s'affiche sur le site ----------
{read('content/tutorial.js')}
{read('content/content.js')}
  // ---------- 6. src/userscript/panel.js : panneau de réglages ----------
  if (document.documentElement.dataset.kyxOwner === KYX_OWNER) {{
{read('userscript/panel.js')}
  }}
}};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {{ once: true }});
else start();
}})();
"""
    return header + body


def main():
    shutil.rmtree(DIST, ignore_errors=True)
    DIST.mkdir()

    firefox = (ROOT / 'manifest.firefox.json').read_text(encoding='utf-8')
    chromium = (ROOT / 'manifest.json').read_text(encoding='utf-8')
    version = json.loads(chromium)['version']
    if json.loads(firefox)['version'] != version:
        raise SystemExit('manifest.json et manifest.firefox.json n’ont pas la même version')
    changes = (ROOT / 'src' / 'content' / 'tutorial.js').read_text(encoding='utf-8')
    if f"version: '{version}'" not in changes:
        raise SystemExit(f'Ajoute les nouveautés de la version {version} en tête de KYX_CHANGES (src/content/tutorial.js)')

    folder = DIST / 'firefox'
    for f in files(firefox=True):
        dest = folder / f.relative_to(ROOT)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dest)
    (folder / 'manifest.json').write_text(firefox, encoding='utf-8')

    package(DIST / 'kyara-games-firefox.xpi', firefox, firefox=True)
    package(DIST / 'kyara-games-chromium.zip', chromium)
    script = userscript(version)
    (DIST / 'kyara-games.user.js').write_text(script, encoding='utf-8', newline='\n')
    (ROOT / 'kyara-games.user.js').write_text(script, encoding='utf-8', newline='\n')  # kept in the repository
    print(f'Kyara Games {version} -> {DIST}')


if __name__ == '__main__':
    main()
