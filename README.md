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
| Œuvres favorites | Étoile ☆ sur chaque album de la page **Collection** (et « Mettre en favori » dans la barre de l'album ouvert) ; dans le **Marché**, la puce **★ Favoris** n'affiche que les offres de tes œuvres favorites (tri, prix fixe ou enchères, seulement tes manquantes), actualisées chaque minute et après chaque achat ou vente |
| Verrouiller un album sans bloquer ses doublons | Bouton **Bloquer sauf doublons** à côté de « Bloquer l'album » (page **Collection**, un univers choisi) : seules les cartes en un exemplaire sont verrouillées, les doublons restent vendables ; une carte est reverrouillée dès qu'il n'en reste qu'une |
| Badge « Manquante » sur toute carte que tu n'as pas | Partout sur le site : boutique/marché, échanges, profils, wiki… |
| Savoir si la carte que tu donnes est en double | Badge **×N** (doublon) ou **Unique** (ton seul exemplaire) sur tes cartes dans les fenêtres d'échange, confirmation comprise |
| Voir la série et le prix des cartes à la confirmation d'un échange | Sous la rareté, dans la fenêtre « Confirmer l'échange » (nom complet de la série au survol), avec l'écart de valeur entre les deux côtés et s'il est équilibré selon la règle du site |
| Voir les doublons du joueur avec qui tu échanges | Onglet **Échange** de la popup, avec la liste de tes amis |
| Filtrer ses cartes sur ses doublons | Puce **Ses doublons**, active d'office, dans chaque fenêtre « Proposer un échange » (profil, offres du marché, comptoir), onglet **Cartes de …** ; la désactiver est retenu |
| Afficher les cartes possédées ou manquantes de la collection | Puces **Possédées** et **Manquantes** à côté de « Toutes » sur la page Collection (un second clic réaffiche tout), et onglet **Manquantes** de la popup |
| Savoir si les cartes que tu donnes dans un échange en cours sont en double | Badge **×N** ou **Unique** côté « Tu donnes » des échanges en attente, onglet **Échanges** du Marché |
| Sur téléphone | Version script : Android (Firefox ou Edge avec Tampermonkey) et iPhone / iPad (app Userscripts), toutes les fonctions du site, voir **Installation sur téléphone** |
| Savoir qu'une nouvelle version est installée | Notification « Kyara Games est passé en X » juste après chaque mise à jour ; un clic ouvre les nouveautés. Réglable dans la popup |
| Être prévenu d'une nouvelle version | Notification et bandeau vert dans la popup quand une nouvelle release sort sur GitHub (vérifié toutes les 15 min), avec un bouton **Mettre à jour** qui installe la nouvelle version (voir plus bas) |
| Notifications | Boosters gratuits pleins, envies mises en vente au marché, échanges, ventes/achats/enchères, amis, messages de l'équipe |

Le badge de l'icône affiche le nombre de boosters gratuits (vert quand c'est plein, `!` si tu n'es pas connecté).

## Installation (Brave, Chrome, Edge, Opera, Vivaldi)

1. Ouvre `brave://extensions` (ou `chrome://extensions`, `edge://extensions`…).
2. Active le **Mode développeur** (en haut à droite).
3. Clique sur **Charger l'extension non empaquetée** et choisis le dossier `KyaraGames`.
4. Ouvre kyara.games et connecte-toi une fois : l'extension reprend ta session toute seule.

L'appli Kyara installée depuis le navigateur (PWA) utilise le même profil : l'extension y fonctionne aussi.

## Installation sur téléphone

La page https://a-finch13.github.io/Kyara-Games-Extension/ montre ces étapes avec les bons boutons pour ton appareil.

Sur téléphone, Kyara Games s'installe en version script : toutes les fonctions du site, réglages dans le menu du site (☰ → 設 Kyara Games), mises à jour automatiques. Pas de notifications : un script ne tourne que quand une page kyara.games est ouverte.

Lien du script (pour les étapes ci-dessous) :
**https://github.com/A-Finch13/Kyara-Games-Extension/releases/latest/download/kyara-games.user.js**

(ou la copie gardée dans le dépôt : https://raw.githubusercontent.com/A-Finch13/Kyara-Games-Extension/main/kyara-games.user.js)

### Android

1. Installe **Firefox** (ou **Edge**) depuis le Play Store : Chrome, Brave et Samsung Internet n'acceptent pas Tampermonkey.
2. Ajoute le gestionnaire de scripts **Tampermonkey** (ou **Violentmonkey**) : menu **⋮** → **Extensions**, cherche Tampermonkey et touche **Ajouter**.
3. Ouvre le lien du script ci-dessus dans ce navigateur : Tampermonkey affiche le script, touche **Installer**.
4. Ouvre [kyara.games](https://kyara.games) et connecte-toi une fois : le script reprend ta session tout seul.
5. Les réglages : menu du site (☰) → **設 Kyara Games**.

### iPhone et iPad

Safari n'accepte que les extensions vendues sur l'App Store : sur iPhone et iPad, c'est la version script qui s'utilise, avec l'app gratuite **Userscripts**.

1. Installe **Userscripts** depuis l'App Store (gratuit) et ouvre-la une fois.
2. Active-la dans Safari : **Réglages** → **Apps** → **Safari** → **Extensions** → **Userscripts** → active **Autoriser l'extension**, puis dans **Autorisations**, autorise **kyara.games** (ou tous les sites).
3. Dans **Safari**, ouvre le lien du script ci-dessus.
4. Touche l'icône des extensions dans la barre d'adresse (**ᴀA** ou la pièce de puzzle) → **Userscripts** : le script est détecté, touche **Installer**.
5. Ouvre [kyara.games](https://kyara.games) dans Safari et connecte-toi une fois.
6. Les réglages : menu du site (☰) → **設 Kyara Games**.

Userscripts vérifie les mises à jour du script. Pour forcer la dernière version, rouvre simplement le lien du script et réinstalle-le.

### Sur PC aussi

Le script marche aussi sur PC avec Tampermonkey ou Violentmonkey, si tu préfères un script à l'extension. Si l'extension et le script sont installés tous les deux, le script se met en retrait pour ne rien afficher en double.

## Firefox

Sur Firefox, utilise la version script avec Tampermonkey (voir la [page d'installation](https://a-finch13.github.io/Kyara-Games-Extension/)).

Pour essayer l'extension elle-même dans Firefox (elle reste jusqu'à sa fermeture) : `python build.py`, puis `about:debugging#/runtime/this-firefox` → **Charger un module complémentaire temporaire** → `dist/firefox/manifest.json`.

## Mises à jour en un clic

Un navigateur ne laisse jamais une extension réécrire ses propres fichiers. Pour que le bouton **Mettre à jour** de la popup installe la nouvelle version tout seul, lance **une seule fois** `installer-mises-a-jour.bat` (dans le dossier de l'extension, Windows). Il installe un petit assistant dans `%LOCALAPPDATA%\KyaraGamesUpdater` et le déclare à Brave, Chrome, Edge, Vivaldi, Opera et Firefox.

Au clic sur **Mettre à jour**, l'assistant télécharge la release GitHub et remplace les fichiers du dossier (ou fait `git pull` si le dossier est un clone git), puis l'extension redémarre. Le cache de kyara.games est alors vidé et les onglets du site se rechargent tout seuls (ta session et les notifications du site sont gardées).

- Si tu déplaces le dossier de l'extension, relance `installer-mises-a-jour.bat`.
- Pour retirer l'assistant : `installer-mises-a-jour.bat -Uninstall`.
- Sans l'assistant, le bouton propose de télécharger la mise à jour.

## Fabriquer les paquets

`python build.py` génère dans `dist/` :

- `firefox/` : le dossier pour essayer l'extension dans Firefox (`about:debugging`) ;
- `kyara-games-firefox.xpi` : le même, en paquet ;
- `kyara-games-chromium.zip` : le paquet pour Brave / Chrome / Edge / Opera (ou pour le Chrome Web Store) ;
- `kyara-games.user.js` : la version script (Tampermonkey, Violentmonkey, Userscripts), générée à partir du même code ; une copie est aussi écrite à la racine du dépôt.

`manifest.json` sert à Brave/Chrome, `manifest.firefox.json` à Firefox : garde le même numéro de version dans les deux.

## Publier une nouvelle version

1. Monte le numéro de version, le même dans `manifest.json` et `manifest.firefox.json` (toujours plus haut que le précédent : c'est lui qui déclenche les mises à jour).
2. `python build.py`.
3. **GitHub** : crée la release `vX.Y.Z` avec `dist/kyara-games-chromium.zip` et `dist/kyara-games.user.js`. Brave / Chrome / Edge la voient dans les 15 minutes (bouton **Mettre à jour** de la popup) ; les gestionnaires de scripts récupèrent le script de la dernière release tout seuls.

## Comment ça marche

- La session (`kyara_token`) est lue dans l'onglet kyara.games et n'est envoyée qu'à `https://kyara.games/api`.
- Le catalogue public (`/api/characters`) est mis en cache 24 h ; ta collection (`/api/me/collection`) est rafraîchie après chaque booster, échange ou achat.
- Pendant un échange, l'extension lit les réponses que le site reçoit déjà (`/api/trades/available/…`, `/api/trades/owned/…`) : aucune requête en plus.
- Les notifications sont vérifiées toutes les minutes (réglable) via `/api/me` et `/api/me/notifications`. Au premier lancement, l'historique existant n'est pas rejoué.

## Les scripts

| Fichier | Ce qu'il fait |
| --- | --- |
| `manifest.json` | Déclaration de l'extension pour Brave / Chrome / Edge / Opera (Manifest V3) : nom, version, autorisations, scripts. |
| `manifest.firefox.json` | La même déclaration pour Firefox, pour essayer l'extension dans `about:debugging`. |
| `src/background.js` | Service de fond de l'extension : vérifie régulièrement tes notifications Kyara et les affiche, met à jour le badge de l'icône (boosters gratuits), garde catalogue et collection à jour, cherche les nouvelles versions sur GitHub, lance l'assistant de mise à jour, vide le cache du site après une mise à jour. |
| `src/lib/kyara.js` | Fonctions partagées : appels à l'API de kyara.games avec ta session, catalogue des cartes (gardé 24 h), collection, réglages par défaut, calculs de progression des albums, recherche de nouvelle version. |
| `src/content/inject.js` | S'exécute dans la page du site : lit les réponses que le site reçoit déjà (collection, échanges, profils) et les transmet au reste de l'extension, sans jamais modifier une requête ni une réponse. |
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
