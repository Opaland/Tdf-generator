'use strict';
// Visite guidée (Sprint 8) : présentation du projet prévue sous ~1 semaine,
// un public qui découvre l'app en démo doit voir les fonctionnalités clés
// sans que le présentateur ait à naviguer à l'aveugle. Volontairement PAS un
// onboarding forcé au premier chargement (pas de cookie/localStorage pour le
// masquer, pas d'auto-ouverture) : un simple bouton sur l'accueil, déclenché
// quand le présentateur le décide — cohérent avec le reste de l'app qui ne
// force jamais rien à l'utilisateur (voir EF.confirmClick, même logique
// d'action explicite plutôt que d'interruption imposée).

// Données pures, testées telles quelles par test/onboarding.test.js (hrefs
// vérifiés contre les fichiers réels de frontend/, pas recopiés à la main).
EF.TOUR_STEPS = [
  {
    title: 'Reconstruction historique',
    body: "Rejouez n'importe quelle étape du Tour depuis 1903 sur le réseau routier actuel : villes d'époque géocodées, routage, altimétrie et détection des côtes, à partir de sources vérifiées.",
    href: '/archives.html',
    cta: 'Voir les archives',
  },
  {
    title: 'Fiche côte par côte',
    body: "Le tableau des cols recense chaque côte détectée : altitude au sommet, longueur, pente moyenne et maximale, catégorie (approximation façon ASO) et un score longueur × pente — cliquez une ligne pour déplier son profil.",
    href: '/cols.html',
    cta: 'Voir les cols',
  },
  {
    title: 'Comparateur',
    body: 'Superposez deux étapes (parcours officiel vs. reconstitution, ou deux étapes prises dans des éditions différentes) pour visualiser les écarts de tracé et de dénivelé.',
    href: '/compare.html',
    cta: 'Ouvrir le comparateur',
  },
  {
    title: 'Bilan de mes traces',
    body: 'Importez vos propres sorties (GPX, Suunto) et comparez-les aux étapes officielles pour voir où vous en êtes face au parcours réel.',
    href: '/traces.html',
    cta: 'Voir mes traces',
  },
];

// État module-level plutôt que par-instance : sans lui, un clic suivi d'un
// Entrée sur le bouton déclencheur (qui garde le focus DOM tant que rien ne
// le déplace) rouvrait une deuxième modale empilée, avec un deuxième
// listener keydown — trouvaille de relecture adverse. openTour() est donc
// idempotent : un appel pendant qu'une visite est déjà ouverte replace juste
// le focus dessus au lieu d'en créer une seconde.
let activeOverlay = null;

EF.openTour = function openTour() {
  if (activeOverlay) {
    activeOverlay.querySelector('.tour-card').focus();
    return activeOverlay;
  }

  let step = 0;
  const invoker = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', "Visite guidée d'ÉtapeForge");

  const card = document.createElement('div');
  card.className = 'tour-card';
  card.tabIndex = -1; // cible de focus programmatique, jamais dans l'ordre de tabulation
  overlay.appendChild(card);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
    activeOverlay = null;
    // Rend le focus à ce qui l'avait avant l'ouverture (le bouton
    // déclencheur, typiquement) plutôt que de le laisser retomber sur <body>.
    if (invoker && typeof invoker.focus === 'function') invoker.focus();
  }

  // Piège à focus : aria-modal="true" annonce au lecteur d'écran que le
  // reste de la page est inerte, mais rien ne l'impose par défaut — Tab
  // sortait de la modale vers le formulaire masqué derrière (trouvaille de
  // relecture adverse). On boucle Tab/Shift+Tab sur les éléments focusables
  // de la carte plutôt que de les laisser s'échapper.
  function trapTab(e) {
    const focusables = [...card.querySelectorAll('button, a[href]')];
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Tab') trapTab(e);
  }

  function go(delta) {
    step = Math.max(0, Math.min(EF.TOUR_STEPS.length - 1, step + delta));
    render();
  }

  function render() {
    const s = EF.TOUR_STEPS[step];
    const isLast = step === EF.TOUR_STEPS.length - 1;
    // Le bouton de fermeture est isolé du reste des actions (coin
    // supérieur droit de la carte, positionnement CSS) plutôt que rangé
    // avec Précédent/Suivant dans .tour-actions : à 4 boutons dans une
    // largeur de carte fixe (480px), le dernier bordait seul sur une
    // deuxième ligne — trouvaille de revue-personas (persona développeur,
    // capture d'écran à l'appui) — et un public non technique cherche
    // instinctivement le ✕ en haut à droite, pas mêlé à la navigation
    // (persona cycliste amateur).
    card.innerHTML = `
      <button type="button" id="tour-close" class="tour-close-btn" aria-label="Fermer la visite guidée">✕</button>
      <p class="tour-progress">Étape ${step + 1} / ${EF.TOUR_STEPS.length}</p>
      <h2>${EF.esc(s.title)}</h2>
      <p>${EF.esc(s.body)}</p>
      <div class="toolbar tour-actions">
        <button type="button" id="tour-prev" class="secondary" ${step === 0 ? 'disabled' : ''}>◀ Précédent</button>
        <a href="${EF.esc(s.href)}" class="btn secondary" id="tour-goto">${EF.esc(s.cta)} ↗</a>
        <button type="button" id="tour-next">${isLast ? 'Terminer' : 'Suivant ▶'}</button>
      </div>`;
    card.querySelector('#tour-prev').addEventListener('click', () => go(-1));
    card.querySelector('#tour-close').addEventListener('click', close);
    card.querySelector('#tour-next').addEventListener('click', () => (isLast ? close() : go(1)));
  }

  render();
  document.addEventListener('keydown', onKeydown);
  // Clic sur le fond sombre (pas sur la carte elle-même) : réflexe naturel
  // pour sortir d'une modale même sans connaître Escape — trouvaille de
  // revue-personas (persona cycliste amateur, reproduit en direct).
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.body.appendChild(overlay);
  activeOverlay = overlay;
  card.focus();
  return overlay;
};

// Auto-attache le déclencheur s'il est présent sur la page (aujourd'hui :
// seulement l'accueil, #tour-box dans index.html) — évite de dupliquer ce
// câblage dans editor.js pour un bouton qui n'appartient pas à sa logique.
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-tour');
  if (btn) btn.addEventListener('click', () => EF.openTour());
});
