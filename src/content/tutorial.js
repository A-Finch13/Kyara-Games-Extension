// Text of the guided tour and of the "Nouveautés" window, shown by content.js.
// Each new version adds its entry at the top of KYX_CHANGES (build.py refuses a version without one).

// Guided tour, one step per feature. Each step can go to a page, open something first and circle an element:
//   page: path to go to; target: CSS selectors of the element to circle (the first visible one);
//   prepare: what to open first ("missing", "albums", "album", "recycle", "menu"); only: "extension", "script" or "android".
// A step whose element can't be found is shown in the middle of the screen.
const KYX_TOUR = [
  {
    id: 'bienvenue',
    title: 'Bienvenue dans Kyara Games',
    text: 'L’extension ajoute à kyara.games de quoi compléter ta collection plus vite. La visite t’emmène sur chaque page et te montre où tout se trouve. Tu peux la quitter à tout moment.'
  },
  {
    id: 'manquantes',
    title: 'Les cartes manquantes, visibles',
    text: 'Les cartes que tu n’as pas s’affichent en gris avec leur nom. Sous chacune : son prix estimé et un bouton « Ordre d’achat » pour la commander au marché.',
    page: '/collection',
    prepare: 'missing',
    target: '.cell:has(.kyx-order), a.slot > .miss[data-kyx-ghost]'
  },
  {
    id: 'puces',
    title: 'Possédées ou manquantes',
    text: 'Ces deux puces filtrent ta collection en un clic. Un clic sur une carte que tu as ouvre directement sa fiche.',
    page: '/collection',
    target: '.chips:has(> .kyx-missing)'
  },
  {
    id: 'recyclage',
    title: 'Recycler au nombre près',
    text: 'Choisis combien de doublons recycler par rareté. Ton dernier exemplaire, les cartes verrouillées et celles en vente ne sont jamais touchés. Rien n’est recyclé tant que tu ne confirmes pas.',
    page: '/collection',
    prepare: 'recycle',
    target: '.kyx-rec, .rec-box'
  },
  {
    id: 'albums',
    title: 'Des albums plus clairs',
    text: 'Masque les séries complètes et celles de moins de 5 persos.',
    page: '/collection',
    prepare: 'albums',
    target: '.al-tools:has(.kyx-toggle)'
  },
  {
    id: 'favoris',
    title: 'Tes œuvres favorites',
    text: 'Touche l’étoile ☆ d’un album pour mettre l’œuvre en favori. Le filtre « ★ Favoris » montre alors ses cartes, ici dans la vue Cartes, ses offres au marché et ses offres d’échange.',
    page: '/collection',
    prepare: 'albums',
    target: 'ul.albums > li:has(.kyx-fav)'
  },
  {
    id: 'verrous',
    title: 'Des verrous plus malins',
    text: 'Dans un album ouvert, « Bloquer sauf doublons » verrouille seulement les cartes que tu as en un exemplaire : tes doublons restent vendables. Et quand un doublon est en vente, ton dernier exemplaire est verrouillé tout seul.',
    page: '/collection',
    prepare: 'album',
    target: '.kyx-smart'
  },
  {
    id: 'marche',
    title: 'Tes favoris au marché',
    text: '« ★ Favoris » n’affiche que les offres de tes œuvres favorites, toutes ou une seule, avec tous les filtres du site. La liste s’actualise toutes les 15 secondes.',
    page: '/marche',
    target: '.kyx-fav-chip'
  },
  {
    id: 'echanges',
    title: 'Échanger sans te tromper',
    text: 'Pendant un échange : badges ×N (doublon) et « Unique » (ton dernier exemplaire) sur tes cartes, « Possédée » ou « Manquante » sur les cartes qu’on te propose, filtres « Ses doublons » et « ★ Favoris » (les cartes de tes œuvres favorites), et à la confirmation la série, le prix de chaque carte et l’écart de valeur entre les deux côtés.'
  },
  {
    id: 'boosters',
    title: 'Le booster le plus rentable',
    text: 'Dans le menu : « Boosters rentables » classe les boosters par prix ou par taux de drop, pour une rareté, un perso ou une carte qui te manque.',
    prepare: 'menu',
    target: '#nav-more .kyx-more, #mobile-nav .kyx-more'
  },
  {
    id: 'amis',
    title: 'Te comparer à tes amis',
    text: 'Le filtre « 友 Amis » affiche le classement de tes amis, avec le même podium que le site.',
    page: '/classement',
    target: '.kyx-friends-tab'
  },
  {
    id: 'missions',
    title: 'Missions plus lisibles',
    text: 'La liste des séries complètes est condensée à la hauteur de la carte Parrainage, avec leur total.',
    page: '/missions',
    target: 'section.kyx-albums'
  },
  {
    id: 'reglages',
    only: 'extension',
    title: 'Réglages et autre appareil',
    text: 'Clique sur l’icône Kyara Games de ton navigateur : onglets Albums, Manquantes, Échange et Réglages. Dans Réglages, active ou coupe chaque fonction et les notifications, et « Autre appareil » te donne un code court pour retrouver tes réglages sur ton téléphone.'
  },
  {
    id: 'reglages',
    only: 'script',
    title: 'Réglages et autre appareil',
    text: 'Ici : active ou coupe chaque fonction, et « Autre appareil » te donne un code court pour retrouver tes réglages et tes favoris sur un autre appareil.',
    prepare: 'menu',
    target: '#nav-more .kyx-settings-entry, #mobile-nav .kyx-settings-entry'
  },
  {
    id: 'notifications',
    only: 'android',
    title: 'Les notifications sur ton téléphone',
    text: 'Dans ces réglages, « Activer les notifications de Kyara » te fait recevoir les notifications du site (boosters pleins, marché, échanges, amis), même site fermé.',
    prepare: 'menu',
    target: '#nav-more .kyx-settings-entry, #mobile-nav .kyx-settings-entry'
  },
  {
    id: 'fin',
    title: 'C’est tout !',
    text: 'Tu retrouves cette visite ici, à tout moment. Après chaque mise à jour, les nouveautés te sont présentées, avec un bouton « Montre-moi ».',
    prepare: 'menu',
    target: '#nav-more .kyx-tuto-entry, #mobile-nav .kyx-tuto-entry'
  }
];

// What's new in each version, the latest first. An item can be [text, id of the tour step that shows it].
const KYX_CHANGES = [
  {
    version: '1.7.4',
    items: ['iPhone et iPad : le bouton « Mettre à jour » du bandeau montre le chemin vers les mises à jour de Userscripts (ᴀA → Userscripts → mises à jour → Update), sans rien télécharger.']
  },
  {
    version: '1.7.3',
    items: [
      ['Échanges en attente : les cartes que tu reçois indiquent si tu les as déjà (« Possédée », « Possédée ×N ») ou non (« Manquante »).', 'echanges'],
      ['Collection, vue Cartes : filtre « ★ Favoris » pour ne voir que les cartes de tes œuvres favorites.', 'favoris'],
      'Marché, onglet Échanges : filtre « ★ Favoris » pour ne voir que les offres qui donnent une carte de tes œuvres favorites.',
      'Installation et mises à jour expliquées pas à pas, plus simplement, sur la page d’installation et dans les messages de mise à jour.'
    ]
  },
  {
    version: '1.7.2',
    items: [['Visite guidée : la bulle d’explication ne cache plus jamais l’élément entouré, sur téléphone comme sur PC (elle se place dessous, dessus ou à côté).', 'manquantes']]
  },
  {
    version: '1.7.1',
    items: [
      ['Visite guidée de l’extension sur le site (menu Plus → 学 Tutoriel), et ce récapitulatif des nouveautés après chaque mise à jour.', 'fin'],
      'Fenêtre de l’extension plus large et plus lisible : albums sur deux colonnes, noms et compteurs toujours visibles.',
      ['Script sur Android : Réglages → « Activer les notifications de Kyara » pour recevoir les notifications du site, même site fermé.', 'notifications'],
      'Sur téléphone, le tutoriel et les bandeaux de mise à jour s’adaptent à la largeur de l’écran.',
      ['Échanges : filtre « ★ Favoris » pour ne voir que les cartes de tes œuvres favorites, de ton côté comme de celui de l’autre joueur.', 'echanges']
    ]
  },
  {
    version: '1.7.0',
    items: [
      'Code court pour retrouver tes réglages et tes œuvres favorites sur un autre appareil (Réglages → Autre appareil).',
      ['Marché : liste ★ Favoris à la place de « Univers », avec tous les filtres du site.', 'marche'],
      ['Collection : choisis combien de doublons recycler par rareté.', 'recyclage'],
      'Notifications vérifiées toutes les 15 secondes (extension).'
    ]
  },
  {
    version: '1.6.3',
    items: ['Mises à jour : toujours vers la version la plus récente.']
  },
  {
    version: '1.6.2',
    items: ['Script : une nouvelle version est proposée dans les 15 minutes, avec un bouton « Mettre à jour ».']
  },
  {
    version: '1.6.1',
    items: [
      'Marché → ★ Favoris : choix d’une seule œuvre, filtres de rareté, actualisation toutes les 15 secondes.',
      'iPhone : comment garder une icône sur l’écran d’accueil qui marche avec Kyara Games.'
    ]
  },
  {
    version: '1.6.0',
    items: [['Œuvres favorites (étoile sur les albums) et puce « ★ Favoris » au Marché.', 'favoris']]
  },
  {
    version: '1.5.1',
    items: ['Version script pour Tampermonkey, Violentmonkey et Userscripts (iPhone, Android), avec une page d’installation guidée.']
  },
  {
    version: '1.5.0',
    items: ['Affichage adapté aux téléphones.']
  },
  {
    version: '1.4.2',
    items: ['Boosters rentables : classement par prix ou par taux de drop.']
  },
  {
    version: '1.4.1',
    items: ['Chances précises des boosters, puce « Possédées », fiche d’une carte en un clic.']
  },
  {
    version: '1.4.0',
    items: [
      ['Page « Boosters rentables » (menu Plus).', 'boosters'],
      ['Classement : filtre « Amis ».', 'amis'],
      ['Missions : séries complètes condensées.', 'missions'],
      'Dernier exemplaire verrouillé quand un doublon est en vente.'
    ]
  },
  {
    version: '1.3.0',
    items: [
      ['Cartes manquantes en gris avec un bouton « Ordre d’achat ».', 'manquantes'],
      'Masquer les séries de moins de 5 persos.',
      '« Bloquer sauf doublons » dans les albums.'
    ]
  }
];
