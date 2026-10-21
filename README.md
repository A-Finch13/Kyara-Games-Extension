# Kyara Games — extension navigateur

Compagnon non officiel pour [kyara.games](https://kyara.games) (site et appli installée).

## Fonctions

| Fonction | Où |
| --- | --- |
| Masquer les albums déjà complétés | Page **Collection** du site (bouton en bas à gauche pour les réafficher) et onglet **Albums** de la popup |
| Masquer les séries de moins de 4 personnages | Bouton à côté de « Masquer les complets » sur la page **Collection**, et case dans l'onglet **Albums** de la popup |
| Voir les cartes manquantes au lieu d'un « ? » | Page **Collection** : la carte s'affiche en gris, avec son nom, son numéro et sa rareté en dessous |
| Placer un ordre d'achat sur une carte manquante | Page **Collection** : bouton **Ordre d'achat** sous chaque carte grise, avec son prix estimé ; prix et quantité réglables, minimum, prix en vente et médiane affichés |
| Badge « Manquante » sur toute carte que tu n'as pas | Partout sur le site : boutique/marché, échanges, profils, wiki… |
| Savoir si la carte que tu donnes est en double | Badge **×N** (doublon) ou **Unique** (ton seul exemplaire) sur tes cartes dans les fenêtres d'échange, confirmation comprise |
| Voir la série et le prix des cartes à la confirmation d'un échange | Sous la rareté, dans la fenêtre « Confirmer l'échange » (nom complet de la série au survol), avec l'écart de valeur entre les deux côtés et s'il est équilibré selon la règle du site |
| Voir les doublons du joueur avec qui tu échanges | Onglet **Échange** de la popup, avec la liste de tes amis |
| Filtrer ses cartes sur ses doublons | Puce **Ses doublons**, active d'office, dans chaque fenêtre « Proposer un échange » (profil, offres du marché, comptoir), onglet **Cartes de …** ; la désactiver est retenu |
| Afficher les cartes manquantes de la collection | Puce **Manquantes** à côté des raretés sur la page Collection, et onglet **Manquantes** de la popup |
| Savoir si les cartes que tu donnes dans un échange en cours sont en double | Badge **×N** ou **Unique** côté « Tu donnes » des échanges en attente, onglet **Échanges** du Marché |
| Être prévenu d'une nouvelle version | Notification et bandeau vert dans la popup quand une nouvelle release sort sur GitHub (vérifié toutes les 15 min), avec un bouton **Mettre à jour** qui installe la nouvelle version (voir plus bas) |
| Notifications | Boosters gratuits pleins, envies mises en vente au marché, échanges, ventes/achats/enchères, amis, messages de l'équipe |

Le badge de l'icône affiche le nombre de boosters gratuits (vert quand c'est plein, `!` si tu n'es pas connecté).

## Installation (Brave, Chrome, Edge, Opera, Vivaldi)

1. Ouvre `brave://extensions` (ou `chrome://extensions`, `edge://extensions`…).
2. Active le **Mode développeur** (en haut à droite).
3. Clique sur **Charger l'extension non empaquetée** et choisis le dossier `KyaraGames`.
4. Ouvre kyara.games et connecte-toi une fois : l'extension reprend ta session toute seule.

L'appli Kyara installée depuis le navigateur (PWA) utilise le même profil : l'extension y fonctionne aussi.

## Installation (Firefox 128+)

Fabrique d'abord les paquets : `python build.py` (crée le dossier `dist/`).

**Pour essayer tout de suite** (l'extension reste jusqu'à la fermeture de Firefox) :

1. Ouvre `about:debugging#/runtime/this-firefox`.
2. **Charger un module complémentaire temporaire** → choisis `dist/firefox/manifest.json`.
3. Clique sur l'icône Kyara Games : si elle affiche « Autoriser l'accès », clique dessus puis recharge l'onglet kyara.games.

**Pour l'installer pour de bon**, Firefox exige une signature de Mozilla (gratuite) :

1. Crée un compte sur [addons.mozilla.org](https://addons.mozilla.org/developers/).
2. **Soumettre un module** → choisis « Sur votre propre site » (non listé) → envoie `dist/kyara-games-firefox.xpi`.
3. La signature est automatique (quelques minutes). Télécharge le `.xpi` signé et ouvre-le dans Firefox.

(Firefox Developer Edition et Nightly acceptent aussi le `.xpi` non signé si `xpinstall.signatures.required` est mis à `false` dans `about:config`.)

## Mises à jour en un clic

Un navigateur ne laisse jamais une extension réécrire ses propres fichiers. Pour que le bouton **Mettre à jour** de la popup installe la nouvelle version tout seul, lance **une seule fois** `installer-mises-a-jour.bat` (dans le dossier de l'extension, Windows). Il installe un petit assistant dans `%LOCALAPPDATA%\KyaraGamesUpdater` et le déclare à Brave, Chrome, Edge, Vivaldi, Opera et Firefox.

Au clic sur **Mettre à jour**, l'assistant télécharge la release GitHub et remplace les fichiers du dossier (ou fait `git pull` si le dossier est un clone git), puis l'extension redémarre. Recharge ensuite l'onglet kyara.games.

- Si tu déplaces le dossier de l'extension, relance `installer-mises-a-jour.bat`.
- Pour retirer l'assistant : `installer-mises-a-jour.bat -Uninstall`.
- Sans l'assistant, le bouton propose de télécharger la mise à jour.

## Fabriquer les paquets

`python build.py` génère dans `dist/` :

- `firefox/` : le dossier à charger dans Firefox ;
- `kyara-games-firefox.xpi` : le paquet Firefox à signer ;
- `kyara-games-chromium.zip` : le paquet pour Brave / Chrome / Edge / Opera (ou pour le Chrome Web Store).

`manifest.json` sert à Brave/Chrome, `manifest.firefox.json` à Firefox : garde le même numéro de version dans les deux.

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

Extension non officielle, non affiliée à Kyara. Si le site change sa structure, certains éléments (masquage des albums) peuvent nécessiter une mise à jour.
