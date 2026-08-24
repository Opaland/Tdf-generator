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
    body: "Chaque col généré ou reconstitué obtient sa fiche : profil, pente moyenne, catégorie, indice d'irrégularité — avec la source de chaque donnée affichée, jamais masquée.",
    href: '/cols.html',
    cta: 'Voir les cols',
  },
  {
    title: 'Comparateur',
    body: 'Superposez deux étapes (parcours officiel vs. reconstitution, ou deux éditions différentes) pour visualiser les écarts de tracé et de dénivelé.',
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

EF.openTour = function openTour() {
  let step = 0;

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', "Visite guidée d'ÉtapeForge");

  const card = document.createElement('div');
  card.className = 'tour-card';
  overlay.appendChild(card);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  }

  function go(delta) {
    step = Math.max(0, Math.min(EF.TOUR_STEPS.length - 1, step + delta));
    render();
  }

  function render() {
    const s = EF.TOUR_STEPS[step];
    const isLast = step === EF.TOUR_STEPS.length - 1;
    card.innerHTML = `
      <p class="tour-progress">Étape ${step + 1} / ${EF.TOUR_STEPS.length}</p>
      <h2>${EF.esc(s.title)}</h2>
      <p>${EF.esc(s.body)}</p>
      <div class="toolbar tour-actions">
        <button type="button" id="tour-prev" class="secondary" ${step === 0 ? 'disabled' : ''}>◀ Précédent</button>
        <a href="${EF.esc(s.href)}" class="btn secondary" id="tour-goto">${EF.esc(s.cta)} ↗</a>
        <button type="button" id="tour-next">${isLast ? 'Terminer' : 'Suivant ▶'}</button>
        <button type="button" id="tour-close" class="secondary" aria-label="Fermer la visite guidée">✕</button>
      </div>`;
    card.querySelector('#tour-prev').addEventListener('click', () => go(-1));
    card.querySelector('#tour-close').addEventListener('click', close);
    card.querySelector('#tour-next').addEventListener('click', () => (isLast ? close() : go(1)));
  }

  render();
  document.addEventListener('keydown', onKeydown);
  document.body.appendChild(overlay);
  return overlay;
};

// Auto-attache le déclencheur s'il est présent sur la page (aujourd'hui :
// seulement l'accueil, #tour-box dans index.html) — évite de dupliquer ce
// câblage dans editor.js pour un bouton qui n'appartient pas à sa logique.
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-tour');
  if (btn) btn.addEventListener('click', () => EF.openTour());
});
