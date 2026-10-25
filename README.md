# Kyara Games — extension navigateur

Compagnon non officiel pour [kyara.games](https://kyara.games) (site et appli installée).

**Installation guidée (PC, Android, iPhone) : https://a-finch13.github.io/Kyara-Games-Extension/**

## Fonctions

| Fonction | Où |
| --- | --- |
| Masquer les albums déjà complétés | Page **Collection** du site (bouton en bas à gauche pour les réafficher) et onglet **Albums** de la popup |
| Masquer les séries de moins de 5 personnages | Bouton à côté de « Masquer les complets » sur la page **Collection**, et case dans l'onglet **Albums** de la popup |
| Voir les cartes manquantes au lieu d'un « ? » | Page **Collection** : la carte s'affiche en gris, avec son nom, son numéro et sa rareté en dessous |
| Placer un ordre d'achat sur une carte manquante | Page **Collection** : bouton **Ordre d'achat** sous chaque carte grise, avec son prix estimé ; il ouvre une fenêtre avec prix et quantité réglables, minimum, prix en vente et médiane |
| Verrouiller le dernier exemplaire d'une carte mise en vente | Automatique : quand un doublon est en vente et qu'il ne te reste qu'un exemplaire libre, la carte est verrouillée (réglable dans la popup) |
| Séries complètes condensées | Page **Missions** : la liste garde la hauteur de la carte « Parrainage », les séries à réclamer en premier, et le total dans le titre |
| Trouver le booster le plus rentable | Menu **Plus** → **Boosters rentables** : une page du site (recalculée à minuit, heure de Paris, pour le Pack du jour) qui classe les boosters en vente par prix (le moins de chakra dépensé) ou par taux de drop (la meilleure chance par booster) (coût moyen en chakra) pour une rareté, un personnage ou un univers (cartes manquantes), avec un lien vers chacun |
| Se comparer à ses amis | Page **Classement** : filtre **友 Amis** à côté des onglets ; le classement de l'onglet choisi parmi tes amis et toi, avec la place de chacun au classement général |
| Ouvrir la fiche d'une carte en un clic | Page **Collection** : un clic sur une carte que tu as ouvre directement sa fiche (réglable dans la popup ; Ctrl+clic garde la fenêtre du site) |
| Œuvres favorites | Étoile ☆ sur chaque album de la page **Collection** (et « Mettre en favori » dans la barre de l'album ouvert) ; dans le **Marché**, la puce **★ Favoris** n'affiche que les offres de tes œuvres favorites ; la liste **★ Favoris** (à la place de « Univers ») choisit toutes les œuvres ou une seule, sans les œuvres dont tu as déjà tous les persos, et tous les autres filtres du site s'appliquent (recherche, rareté, tri, prix, « Que je n'ai pas », « Que je cherche », onglet Enchères) ; actualisées toutes les 15 secondes et après chaque achat ou vente |
| Retrouver ses réglages sur un autre appareil | Réglages (popup de l'extension, ou menu du site → 設 Kyara Games pour le script) → **Autre appareil** : « Copier mon code » sur le premier appareil (un code court de lettres et de chiffres, par exemple `1A2B-3C4D-…`, environ 35 caractères avec une quinzaine d'œuvres favorites), « Importer ce code » sur l'autre. Réglages, œuvres favorites et albums « Bloquer sauf doublons » ; verrous et envies sont déjà gardés par Kyara sur le compte |
| Recycler une partie de ses doublons | Page **Collection**, bouton « Recycler les doublons » du site : en plus des raretés à cocher, choisis **combien** de doublons recycler par rareté (les cartes avec le plus d'exemplaires en trop d'abord ; jamais le dernier exemplaire, ni les cartes verrouillées ou en vente) |
| Tutoriel et nouveautés | Menu **Plus** → **学 Tutoriel** (ou la popup) : le tour de tout ce que l'extension ajoute. Au premier lancement le tutoriel s'ouvre tout seul ; après chaque mise à jour, une fenêtre récapitule les nouveautés depuis ta dernière version |
| Verrouiller un album sans bloquer ses doublons | Bouton **Bloquer sauf doublons** à côté de « Bloquer l'album » (page **Collection**, un univers choisi) : seules les cartes en un exemplaire sont verrouillées, les doublons restent vendables ; une carte est reverrouillée dès qu'il n'en reste qu'une |
| Badge « Manquante » sur toute carte que tu n'as pas | Partout sur le site : boutique/marché, échanges, profils, wiki… |
| Savoir si la carte que tu donnes est en double | Badge **×N** (doublon) ou **Unique** (ton seul exemplaire) sur tes cartes dans les fenêtres d'échange, confirmation comprise |
| Voir la série et le prix des cartes à la confirmation d'un échange | Sous la rareté, dans la fenêtre « Confirmer l'échange » (nom complet de la série au survol), avec l'écart de valeur entre les deux côtés et s'il est équilibré selon la règle du site |
| Voir les doublons du joueur avec qui tu échanges | Onglet **Échange** de la popup, avec la liste de tes amis |
| Filtrer ses cartes sur ses doublons | Puce **Ses doublons**, active d'office, dans chaque fenêtre « Proposer un échange » (profil, offres du marché, comptoir), onglet **Cartes de …** ; la désactiver est retenu |
| Filtrer un échange sur ses œuvres favorites | Puce **★ Favoris** à côté de « Ses doublons », dans les deux onglets de la fenêtre d'échange : seulement les cartes de tes œuvres favorites ; retenu |
| Voir les offres d'échange de ses œuvres favorites | Puce **★ Favoris** dans le **Marché**, onglet **Échanges** : seulement les offres qui donnent une carte de tes œuvres favorites, recherchées directement sur le serveur ; se combine avec les autres puces du site ; retenu |
| Voir seulement les cartes de ses œuvres favorites | Puce **★ Favoris** après « Manquantes » sur la page **Collection**, vue Cartes : la liste « Univers » devient la liste de tes œuvres favorites (toutes ou une seule), aussi dans le panneau « Filtres » du téléphone ; retenu |
| Savoir si on a déjà les cartes qu'on reçoit | Badge **Manquante**, **Possédée** ou **Possédée ×N** côté « Tu reçois » des échanges en attente, onglet **Échanges** du Marché |
| Afficher les cartes possédées ou manquantes de la collection | Puces **Possédées** et **Manquantes** à côté de « Toutes » sur la page Collection (un second clic réaffiche tout), et onglet **Manquantes** de la popup |
| Savoir si les cartes que tu donnes dans un échange en cours sont en double | Badge **×N** ou **Unique** côté « Tu donnes » des échanges en attente, onglet **Échanges** du Marché |
| Sur téléphone | Version script : Android (Firefox ou Edge avec Tampermonkey) et iPhone / iPad (app Userscripts), toutes les fonctions du site, voir **Installer sur téléphone** |
| Être prévenu d'une nouvelle version du script | Le script vérifie toutes les 15 minutes (site ouvert) et affiche un bandeau **Mettre à jour** ; « ✕ » le repousse de 12 h. Même si plusieurs versions sont sorties entre-temps, c'est toujours la plus récente qui est proposée et installée |
| Savoir qu'une nouvelle version est installée | Extension : notification « Kyara Games est passé en X » juste après chaque mise à jour. Script : bandeau dans le site à la première visite après la mise à jour. Un clic ouvre les nouveautés ; réglable dans la popup ou le panneau de réglages |
| Être prévenu d'une nouvelle version | Notification et bandeau vert dans la popup quand une nouvelle release sort sur GitHub (vérifié toutes les 15 min), avec un bouton **Mettre à jour** qui installe la nouvelle version (voir plus bas) |
| Notifications | Boosters gratuits pleins, envies mises en vente au marché, échanges, ventes/achats/enchères, amis, messages de l'équipe |

Le badge de l'icône affiche le nombre de boosters gratuits (vert quand c'est plein, `!` si tu n'es pas connecté).

## Le plus simple : la page d'installation

**👉 https://a-finch13.github.io/Kyara-Games-Extension/**

Elle montre les étapes pour ton appareil (PC, Android, iPhone), avec les bons boutons. C'est la version **script** : 2 minutes, et les mises à jour se font presque toutes seules.

Les explications ci-dessous sont les mêmes, en texte.

## Installer l'extension complète sur PC

L'extension complète ajoute les **notifications** (boosters gratuits pleins, échanges, ventes…) et une **fenêtre** avec tes albums. Elle marche sur Brave, Chrome, Edge, Opera et Vivaldi. Elle demande 5 minutes.

1. Télécharge le fichier **[kyara-games-chromium.zip](https://github.com/A-Finch13/Kyara-Games-Extension/releases/latest/download/kyara-games-chromium.zip)**.
2. Fais un clic droit sur le fichier téléchargé → **Extraire tout…** → **Extraire**. Tu obtiens un dossier.
3. Range ce dossier dans un endroit où il restera, par exemple **Documents**. **Ne le supprime pas** : l'extension en a besoin pour marcher.
4. Dans la barre d'adresse du navigateur, tape `chrome://extensions` (sur Edge : `edge://extensions`) et appuie sur **Entrée**.
5. Active l'interrupteur **Mode développeur**, en haut à droite.
6. Clique sur **Charger l'extension non empaquetée** et choisis le dossier de l'étape 3.
7. Ouvre [kyara.games](https://kyara.games) et connecte-toi. L'extension démarre toute seule.

**Ça marche ?** L’icône de Kyara Games apparaît en haut à droite du navigateur (elle peut être cachée derrière la pièce de puzzle 🧩 : clique sur l'épingle pour la garder visible).

L'appli Kyara installée depuis le navigateur utilise le même profil : l'extension y marche aussi.

### Mettre à jour l'extension

**À faire une seule fois** pour que les mises à jour s'installent en un clic (Windows) :

1. Ouvre le dossier de l'extension.
2. Double-clique sur **installer-mises-a-jour.bat**.
3. Une fenêtre noire s'ouvre et se termine par « Appuyez sur une touche » : appuie sur une touche.

Ensuite, à chaque nouvelle version :

1. Une notification et un bandeau vert dans la fenêtre de l'extension annoncent la nouvelle version.
2. Clique sur l’icône de Kyara Games, puis sur **Mettre à jour**.
3. C'est tout : l'extension redémarre et les onglets kyara.games se rechargent tout seuls.

**Sans l'étape « une seule fois »**, le bouton **Mettre à jour** propose de télécharger la nouvelle version. Dans ce cas :

1. Télécharge le fichier proposé et décompresse-le (clic droit → **Extraire tout…**).
2. Copie tout son contenu **dans le dossier de l'extension**, en remplaçant les anciens fichiers.
3. Va dans `chrome://extensions` et clique sur la flèche ⟳ de Kyara Games.

Si tu déplaces le dossier de l'extension, relance **installer-mises-a-jour.bat**. Pour retirer l'assistant de mise à jour : `installer-mises-a-jour.bat -Uninstall`.

## Installer sur téléphone

Sur téléphone, Kyara Games s'installe en version **script**. Elle a toutes les fonctions sur le site ; les réglages sont dans le menu du site : bouton **他 Plus** de la barre du bas → **設 Kyara Games** (ou ☰ → 設 Kyara Games sur l'ancienne version du site).

Lien du script (pour les étapes ci-dessous) :
**https://github.com/A-Finch13/Kyara-Games-Extension/releases/latest/download/kyara-games.user.js**

### Android

1. Installe **Firefox** depuis le Play Store. Chrome, Brave et Samsung Internet ne peuvent pas faire marcher Kyara Games.
2. Dans Firefox, ouvre la page de [Tampermonkey](https://addons.mozilla.org/android/addon/tampermonkey/) et touche **Ajouter à Firefox**, puis **Ajouter**.
3. Dans Firefox, ouvre le lien du script ci-dessus. Une page Tampermonkey s'ouvre : touche **Installer**.
4. Ouvre [kyara.games](https://kyara.games) dans Firefox et connecte-toi.

**Ça marche ?** Le bouton **他 Plus** de la barre du bas (ou le menu ☰) contient **設 Kyara Games**.

**Notifications** (facultatif) : bouton **他 Plus** de la barre du bas → **設 Kyara Games** → **Activer les notifications de Kyara**. Elles arrivent même site fermé.

### iPhone et iPad

Kyara Games marche seulement dans **Safari**, avec l'app gratuite **Userscripts**.

1. Installe **Userscripts** depuis l'App Store et ouvre-la une fois.
2. Ouvre l'app **Réglages** → **Apps** → **Safari** → **Extensions** → **Userscripts**. Active **Autoriser l'extension**, puis dans **Autorisations**, autorise **kyara.games**.
3. Dans **Safari**, ouvre le lien du script ci-dessus. Une page pleine de texte s'ouvre : c'est normal.
4. Touche l'icône **ᴀA** (ou la pièce de puzzle) à côté de l'adresse → **Userscripts** → **Installer**.
5. Ouvre [kyara.games](https://kyara.games) dans Safari et connecte-toi.

**Ça marche ?** Le bouton **他 Plus** de la barre du bas (ou le menu ☰) contient **設 Kyara Games**. Sur iPhone et iPad, il n'y a pas de notifications.

**Icône sur l'écran d'accueil** : une icône ajoutée en « app web » ouvre le site **sans** Kyara Games. Pour une icône qui marche : dans Safari, sur kyara.games, **Partager** → **Sur l'écran d'accueil** → **désactive « Ouvrir en tant qu'app web »** → **Ajouter**. Si l'option n'existe pas, ajoute plutôt kyara.games aux Favoris de Safari.

### Sur PC aussi

Le script marche aussi sur PC avec Tampermonkey, si tu préfères un script à l'extension (voir la [page d'installation](https://a-finch13.github.io/Kyara-Games-Extension/)). Si l'extension et le script sont installés tous les deux, le script se met en retrait pour ne rien afficher en double.

## Mettre à jour le script

Tu n'as presque rien à faire :

1. Quand une nouvelle version sort, un bandeau **« Kyara Games … est disponible »** apparaît sur kyara.games (au plus tard 15 minutes après la sortie, site ouvert).
2. Clique sur **Mettre à jour** dans ce bandeau.
3. Une page s'ouvre :
   - avec **Tampermonkey** (PC, Android), clique sur **Mettre à jour** ;
   - avec **Userscripts** (iPhone, iPad), le bandeau montre le chemin : **ᴀA** → **Userscripts** → icône des mises à jour (deux flèches en rond) → **Check Updates** si Kyara Games n'est pas listé → **Update**. Rien à télécharger : Userscripts met le script à jour lui-même. Pas besoin d'attendre le bandeau, ce chemin marche à tout moment.
4. Reviens sur kyara.games et recharge la page. Une fenêtre te montre les nouveautés : c'est fini.

Le « ✕ » du bandeau le cache pendant 12 heures. Tampermonkey installe aussi la nouvelle version tout seul, environ une fois par jour. Pour qu'il vérifie plus souvent : tableau de bord de Tampermonkey → **Paramètres** (mode **Avancé**) → **Mises à jour des scripts** → **Vérifier toutes les…** → la valeur la plus courte.

Après une mise à jour, un bandeau « Kyara Games est passé en X » le confirme à la visite suivante. Il se désactive dans les réglages (menu du site → 設 Kyara Games).

## Firefox

Sur Firefox, utilise la version script avec Tampermonkey (voir la [page d'installation](https://a-finch13.github.io/Kyara-Games-Extension/)).

Pour essayer l'extension elle-même dans Firefox (elle reste jusqu'à sa fermeture) : `python build.py`, puis `about:debugging#/runtime/this-firefox` → **Charger un module complémentaire temporaire** → `dist/firefox/manifest.json`.

## Comment marche la mise à jour en un clic

Un navigateur ne laisse jamais une extension réécrire ses propres fichiers. `installer-mises-a-jour.bat` installe donc un petit assistant dans `%LOCALAPPDATA%\KyaraGamesUpdater` et le déclare à Brave, Chrome, Edge, Vivaldi, Opera et Firefox.

Au clic sur **Mettre à jour**, l'assistant télécharge la release GitHub et remplace les fichiers du dossier (ou fait `git pull` si le dossier est un clone git), puis l'extension redémarre. Le cache de kyara.games est alors vidé et les onglets du site se rechargent tout seuls (ta session et les notifications du site sont gardées).

## Fabriquer les paquets

`python build.py` génère dans `dist/` :

- `firefox/` : le dossier pour essayer l'extension dans Firefox (`about:debugging`) ;
- `kyara-games-firefox.xpi` : le même, en paquet ;
- `kyara-games-chromium.zip` : le paquet pour Brave / Chrome / Edge / Opera (ou pour le Chrome Web Store) ;
- `kyara-games.user.js` : la version script (Tampermonkey, Violentmonkey, Userscripts), générée à partir du même code ; une copie est aussi écrite à la racine du dépôt.

`manifest.json` sert à Brave/Chrome, `manifest.firefox.json` à Firefox : garde le même numéro de version dans les deux.

## Comment ça marche

- La session (`kyara_token`) est lue dans l'onglet kyara.games et n'est envoyée qu'à `https://kyara.games/api`.
- Le catalogue public (`/api/characters`) est mis en cache 24 h ; ta collection (`/api/me/collection`) est rafraîchie après chaque booster, échange ou achat.
- Pendant un échange, l'extension lit les réponses que le site reçoit déjà (`/api/trades/available/…`, `/api/trades/owned/…`) : aucune requête en plus.
- Avec **★ Favoris** dans l'onglet Échanges du Marché, la recherche d'offres du site (`/api/trades/offers/search`) demande au serveur les seules cartes de tes œuvres favorites (400 cartes par requête au plus, plusieurs requêtes si besoin), 50 offres à la fois au lieu de 20.
- Les notifications sont vérifiées toutes les 15 secondes (réglable : 15 s, 1, 2, 5 ou 10 min) via `/api/me` et `/api/me/notifications`. Au premier lancement, l'historique existant n'est pas rejoué.

## Les scripts

| Fichier | Ce qu'il fait |
| --- | --- |
| `manifest.json` | Déclaration de l'extension pour Brave / Chrome / Edge / Opera (Manifest V3) : nom, version, autorisations, scripts. |
| `manifest.firefox.json` | La même déclaration pour Firefox, pour essayer l'extension dans `about:debugging`. |
| `src/background.js` | Service de fond de l'extension : vérifie régulièrement tes notifications Kyara et les affiche, met à jour le badge de l'icône (boosters gratuits), garde catalogue et collection à jour, cherche les nouvelles versions sur GitHub, lance l'assistant de mise à jour, vide le cache du site après une mise à jour. |
| `src/lib/kyara.js` | Fonctions partagées : appels à l'API de kyara.games avec ta session, catalogue des cartes (gardé 24 h), collection, réglages par défaut, calculs de progression des albums, recherche de nouvelle version. |
| `src/content/inject.js` | S'exécute dans la page du site : lit les réponses que le site reçoit déjà (collection, échanges, profils) et les transmet au reste de l'extension. La seule requête qu'il change est la recherche d'offres d'échange du Marché, quand **★ Favoris** est actif. |
| `src/content/tutorial.js` | Les textes du tutoriel (`KYX_TOUR`, une étape par fonction) et des nouveautés de chaque version (`KYX_CHANGES`). |
| `src/content/content.js` | Tout ce qui s'affiche sur le site : badges, cartes manquantes grisées et ordres d'achat, puces et filtres, albums masqués, verrouillages, Boosters rentables, filtre Amis, Missions, fenêtre de confirmation d'échange. |
| `src/content/content.css` | Le style de tout ce qu'ajoute `content.js`, y compris pour les petits écrans. |
| `src/popup/` | La popup de l'extension (`popup.html`, `popup.js`, `popup.css`) : albums, cartes manquantes, doublons d'un joueur, réglages, bouton **Mettre à jour**. |
| `src/userscript/shim.js` | Version script : remplace le stockage et les messages des extensions par la mémoire du site. |
| `src/userscript/bridge.js` | Version script : fait dans la page le travail du service de fond (session, collection, prix). |
| `src/userscript/panel.js` | Version script : panneau de réglages ouvert depuis le menu du site, à la place de la popup. |
| `kyara-games.user.js` | La version script complète, prête à installer (Tampermonkey, Violentmonkey, Userscripts). Générée par `build.py` à partir des fichiers ci-dessus : ne pas la modifier à la main. |
| `build.py` | Fabrique les paquets dans `dist/` (Brave/Chrome, Firefox) et la version script. |
| `installer-mises-a-jour.bat` | Windows : lance l'installation de l'assistant de mise à jour (une seule fois). |
| `updater/install.ps1` | Windows : installe l'assistant dans `%LOCALAPPDATA%\KyaraGamesUpdater`, retrouve l'identifiant de l'extension dans Brave/Chrome/Edge et le déclare aux navigateurs ; `-Uninstall` le retire. |
| `updater/host.ps1` | Windows : l'assistant lui-même, lancé par le navigateur au clic sur **Mettre à jour** : télécharge la release GitHub et remplace les fichiers (ou fait `git pull`), puis vérifie la version installée. |
| `docs/index.html` | La page d'installation guidée (https://a-finch13.github.io/Kyara-Games-Extension/), publiée par GitHub Pages : Tampermonkey, autorisation des scripts, installation du script, pour PC, Android et iPhone. |

Extension non officielle, non affiliée à Kyara. Si le site change sa structure, certains éléments (masquage des albums) peuvent nécessiter une mise à jour.
