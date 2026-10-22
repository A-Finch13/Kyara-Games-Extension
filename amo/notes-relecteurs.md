# Notes pour les relecteurs

Kyara Games est une extension non officielle pour le jeu de collection de cartes https://kyara.games. Son interface est en français, comme le site.

**Pas d'étape de construction.** Le paquet contient le code tel qu'il est écrit (JavaScript simple, ni minifié ni assemblé).

**Réseau.** L'extension ne communique qu'avec `https://kyara.games` (son API publique et la session de l'utilisateur). Aucune statistique, aucun code chargé à distance, aucun tiers. La vérification des nouvelles versions sur GitHub, utilisée par la version Chromium, est désactivée sur Firefox (`src/background.js`, fonction `lookForUpdate`).

**Autorisations**
- `storage`, `unlimitedStorage` : réglages, copie du catalogue public des cartes (environ 1,7 Mo) et de la collection de l'utilisateur.
- `alarms`, `notifications` : vérification régulière des notifications de l'utilisateur sur kyara.games (boosters gratuits, échanges, marché, amis).
- `tabs` : ouvrir ou afficher un onglet kyara.games quand on clique sur une notification, et recharger une fois les onglets kyara.games après une mise à jour.
- Accès à `https://kyara.games/*` : scripts de contenu et appels à l'API.

**Scripts de contenu**
- `src/content/inject.js` s'exécute dans la page (`world: MAIN`). Il enveloppe `window.fetch` pour transmettre au script de contenu, avec `window.postMessage` limité à l'origine de la page, les réponses que le site reçoit déjà (collection, échanges, profils). Il ne modifie jamais une requête ni une réponse.
- `src/content/content.js` ajoute l'interface (badges, filtres, fenêtre d'ordre d'achat, page « Boosters rentables », classement entre amis). Les valeurs venant du site sont échappées avant d'être insérées dans la page.

**Session.** Le site garde son jeton de session dans `localStorage` (`kyara_token`). L'extension le lit pour appeler la même API que le site au nom de l'utilisateur ; il n'est envoyé qu'à `https://kyara.games/api`.

**Pour tester.** Il faut un compte kyara.games (connexion par Discord). Après une première connexion, ouvrir https://kyara.games/collection : les cartes manquantes apparaissent en gris avec un bouton « Ordre d'achat », et le menu « Plus » (ou le menu mobile) contient une entrée « Boosters rentables ».
