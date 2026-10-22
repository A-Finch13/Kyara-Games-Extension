# Kyara Games — extension navigateur

Compagnon non officiel pour [kyara.games](https://kyara.games) (site et appli installée).

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
| Verrouiller un album sans bloquer ses doublons | Bouton **Bloquer sauf doublons** à côté de « Bloquer l'album » (page **Collection**, un univers choisi) : seules les cartes en un exemplaire sont verrouillées, les doublons restent vendables ; une carte est reverrouillée dès qu'il n'en reste qu'une |
| Badge « Manquante » sur toute carte que tu n'as pas | Partout sur le site : boutique/marché, échanges, profils, wiki… |
| Savoir si la carte que tu donnes est en double | Badge **×N** (doublon) ou **Unique** (ton seul exemplaire) sur tes cartes dans les fenêtres d'échange, confirmation comprise |
| Voir la série et le prix des cartes à la confirmation d'un échange | Sous la rareté, dans la fenêtre « Confirmer l'échange » (nom complet de la série au survol), avec l'écart de valeur entre les deux côtés et s'il est équilibré selon la règle du site |
| Voir les doublons du joueur avec qui tu échanges | Onglet **Échange** de la popup, avec la liste de tes amis |
| Filtrer ses cartes sur ses doublons | Puce **Ses doublons**, active d'office, dans chaque fenêtre « Proposer un échange » (profil, offres du marché, comptoir), onglet **Cartes de …** ; la désactiver est retenu |
| Afficher les cartes possédées ou manquantes de la collection | Puces **Possédées** et **Manquantes** à côté de « Toutes » sur la page Collection (un second clic réaffiche tout), et onglet **Manquantes** de la popup |
| Savoir si les cartes que tu donnes dans un échange en cours sont en double | Badge **×N** ou **Unique** côté « Tu donnes » des échanges en attente, onglet **Échanges** du Marché |
| Sur téléphone | Firefox pour Android : toutes les fonctions, avec une tuile **Boosters rentables** dans le menu mobile du site et la popup en plein écran |
| Savoir qu'une nouvelle version est installée | Notification « Kyara Games est passé en X » juste après chaque mise à jour (Firefox compris, qui met à jour en silence) ; un clic ouvre les nouveautés. Réglable dans la popup |
| Être prévenu d'une nouvelle version | Notification et bandeau vert dans la popup quand une nouvelle release sort sur GitHub (vérifié toutes les 15 min), avec un bouton **Mettre à jour** qui installe la nouvelle version (voir plus bas) |
| Notifications | Boosters gratuits pleins, envies mises en vente au marché, échanges, ventes/achats/enchères, amis, messages de l'équipe |

Le badge de l'icône affiche le nombre de boosters gratuits (vert quand c'est plein, `!` si tu n'es pas connecté).

## Installation (Brave, Chrome, Edge, Opera, Vivaldi)

1. Ouvre `brave://extensions` (ou `chrome://extensions`, `edge://extensions`…).
2. Active le **Mode développeur** (en haut à droite).
3. Clique sur **Charger l'extension non empaquetée** et choisis le dossier `KyaraGames`.
4. Ouvre kyara.games et connecte-toi une fois : l'extension reprend ta session toute seule.

L'appli Kyara installée depuis le navigateur (PWA) utilise le même profil : l'extension y fonctionne aussi.

## Installation sur téléphone (Firefox pour Android)

Toutes les fonctions du PC marchent aussi sur Firefox pour Android : badges, cartes grisées et ordres d'achat, filtres, Boosters rentables (tuile « 得 » dans le menu du site), filtre Amis, Missions, popup (menu ⋮ → Extensions → Kyara Games) et notifications.

1. Installe **Firefox** depuis le Play Store.
2. Ouvre la page de l'extension sur [addons.mozilla.org](https://addons.mozilla.org/) et touche **Ajouter à Firefox**.
3. Ouvre kyara.games et connecte-toi une fois : l'extension reprend ta session toute seule.

Firefox installe ensuite les nouvelles versions tout seul, en arrière-plan (environ une fois par jour), et une notification « Kyara Games est passé en X » le signale. Pour l'avoir tout de suite : rouvrir la page de l'extension sur addons.mozilla.org et la réinstaller (les réglages sont gardés). Seul l'assistant de mise à jour Windows n'existe pas sur téléphone : il n'y en a pas besoin.

## Installation (Firefox 140+)

Fabrique d'abord les paquets : `python build.py` (crée le dossier `dist/`).

**Pour essayer tout de suite** (l'extension reste jusqu'à la fermeture de Firefox) :

1. Ouvre `about:debugging#/runtime/this-firefox`.
2. **Charger un module complémentaire temporaire** → choisis `dist/firefox/manifest.json`.
3. Clique sur l'icône Kyara Games : si elle affiche « Autoriser l'accès », clique dessus puis recharge l'onglet kyara.games.

## Mises à jour en un clic

Un navigateur ne laisse jamais une extension réécrire ses propres fichiers. Pour que le bouton **Mettre à jour** de la popup installe la nouvelle version tout seul, lance **une seule fois** `installer-mises-a-jour.bat` (dans le dossier de l'extension, Windows). Il installe un petit assistant dans `%LOCALAPPDATA%\KyaraGamesUpdater` et le déclare à Brave, Chrome, Edge, Vivaldi, Opera et Firefox.

Au clic sur **Mettre à jour**, l'assistant télécharge la release GitHub et remplace les fichiers du dossier (ou fait `git pull` si le dossier est un clone git), puis l'extension redémarre. Le cache de kyara.games est alors vidé et les onglets du site se rechargent tout seuls (ta session et les notifications du site sont gardées).

- Si tu déplaces le dossier de l'extension, relance `installer-mises-a-jour.bat`.
- Pour retirer l'assistant : `installer-mises-a-jour.bat -Uninstall`.
- Sans l'assistant, le bouton propose de télécharger la mise à jour.

## Fabriquer les paquets

`python build.py` génère dans `dist/` :

- `firefox/` : le dossier à charger dans Firefox ;
- `kyara-games-firefox.xpi` : le paquet Firefox ;
- `kyara-games-chromium.zip` : le paquet pour Brave / Chrome / Edge / Opera (ou pour le Chrome Web Store).

`manifest.json` sert à Brave/Chrome, `manifest.firefox.json` à Firefox : garde le même numéro de version dans les deux.

## Publier une nouvelle version

1. Monte le numéro de version, le même dans `manifest.json` et `manifest.firefox.json` (toujours plus haut que le précédent : addons.mozilla.org refuse un numéro déjà envoyé).
2. `python build.py`.
3. **GitHub** : crée la release `vX.Y.Z` avec `dist/kyara-games-chromium.zip` et `dist/kyara-games-firefox.xpi`. Brave / Chrome / Edge la voient dans les 15 minutes (bouton **Mettre à jour** de la popup).
4. **addons.mozilla.org** : Developer Hub → Kyara Games → **Envoyer une nouvelle version** → `dist/kyara-games-firefox.xpi`. Sans cet envoi, les utilisateurs Firefox (PC et Android) restent sur l'ancienne version. Une fois la version validée, Firefox l'installe tout seul.

Les textes de la fiche addons.mozilla.org sont dans `amo/`.

## Comment ça marche

- La session (`kyara_token`) est lue dans l'onglet kyara.games et n'est envoyée qu'à `https://kyara.games/api`.
- Le catalogue public (`/api/characters`) est mis en cache 24 h ; ta collection (`/api/me/collection`) est rafraîchie après chaque booster, échange ou achat.
- Pendant un échange, l'extension lit les réponses que le site reçoit déjà (`/api/trades/available/…`, `/api/trades/owned/…`) : aucune requête en plus.
- Les notifications sont vérifiées toutes les minutes (réglable) via `/api/me` et `/api/me/notifications`. Au premier lancement, l'historique existant n'est pas rejoué.

## Fichiers

- `manifest.json` : déclaration de l'extension (Manifest V3).
- `src/background.js` : vérifications périodiques, notifications, badge.
- `src/lib/kyara.js` : accès à l'API Kyara et calculs de collection.
- `src/content/inject.js` : relaie au content script les réponses API du site.
- `src/content/content.js` : badges, albums masqués, cartes manquantes grisées et ordres d'achat, filtre « Ses doublons » sur le site.
- `src/popup/` : la fenêtre de l'extension.
- `updater/` et `installer-mises-a-jour.bat` : l'assistant de mise à jour (Windows).
- `amo/` : textes pour la publication sur addons.mozilla.org (fiche, politique de confidentialité, notes pour les relecteurs).

Extension non officielle, non affiliée à Kyara. Si le site change sa structure, certains éléments (masquage des albums) peuvent nécessiter une mise à jour.
