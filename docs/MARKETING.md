# Stratégie de positionnement / mise en avant — ÉtapeForge (17/10/2026)

Épic 21 de `docs/SPRINT-STATUS.md`, demandé le 16/10. Ce document **propose
une synthèse, ne publie rien** : aucune diffusion (réseaux sociaux, forums,
Show HN, Reddit, etc.) sans validation explicite de l'utilisateur. Rien
ci-dessous n'a été posté où que ce soit.

## Le point de départ : une vraie tension, pas à masquer

La demande initiale (« rendre l'appli sexy ») entre en tension directe avec
le positionnement déjà écrit dans `docs/BRIEF.md` : 100 % local, aucun
compte, pas de dépendance cloud, **pas un produit commercial**. Une
stratégie marketing qui chercherait à paraître plus "vendeuse" en estompant
ça irait contre ce que le projet est réellement — et un visiteur qui
cliquerait en espérant un SaaS hébergé découvrirait l'inverse à l'install,
ce qui coûte plus cher en confiance que ça n'en gagne en clics.

**Parti pris de ce document** : ne pas résoudre la tension en gommant la
contrainte, mais en choisissant l'angle où elle devient un avantage plutôt
qu'un frein — voir « 21.1 » ci-dessous.

## 21.1 — Angle de positionnement

Pas « une appli sexy comme les autres », mais **une reconstruction fidèle,
vérifiable, qu'on garde chez soi** :

- **Fidèle** : pas un tracé à la main sur une carte — un pipeline qui
  géocode, route et échantillonne l'altimétrie *réelle* du réseau routier
  d'aujourd'hui, à partir d'une simple liste de lieux (le vrai
  différenciateur déjà identifié dans `BRIEF.md` face à la-flamme-rouge.eu,
  l'éditeur manuel le plus proche).
- **Vérifiable** : l'écart entre distance officielle et distance
  reconstituée **s'affiche toujours**, jamais masqué pour paraître plus
  précis que la donnée ne l'est (CLAUDE.md, règle 12) — à l'inverse d'une
  appli qui donnerait un chiffre unique sans dire d'où il vient.
- **Qu'on garde chez soi** : zéro compte, zéro cloud, la base de données
  reste sur la machine de l'utilisateur. Pas un défaut technique à excuser
  — l'argument pour qui a déjà vu un service fermer et emporter ses
  données avec lui.

Ce n'est pas un positionnement "grand public" — c'est un positionnement
**niche assumée** : les passionnés d'histoire du Tour et les
auto-hébergeurs qui *savent* ce qu'ils cherchent (voir `docs/PERSONAS.md`,
déjà écrit : Camille l'historienne, Yannick le Synology, Sophie le VPS).
Une appli plus "sexy" au sens générique (palette vive, animations,
onboarding marketing) viserait un public que ce positionnement n'attire pas
de toute façon — mieux vaut être la meilleure réponse à une question précise
que l'une des nombreuses réponses à une question vague.

## 21.2 — Captures d'écran

**8 captures desktop (1440px) existent déjà** (`docs/captures/`, prises le
15/10, déjà intégrées au README : éditeur, fiche d'étape, carte globale,
archives, profil 3D, catalogue de cols, comparateur, traces). Pas besoin
d'en reproduire.

**Ce qui manque réellement**, vérifié par absence plutôt que supposé :

- **Mobile/responsive** : l'audit Playwright (Epic 6) a capturé les 8 écrans
  à 375px mais ces captures vivaient dans un répertoire temporaire de
  session, jamais commitées — à refaire et committer si une page de
  présentation doit montrer l'usage mobile/PWA (installabilité).
- **Le pipeline en action**, pas seulement son résultat : les 8 captures
  actuelles montrent toutes un écran *fini*. Rien ne montre visuellement le
  vrai différenciateur (« une liste de lieux entre, un tracé routé +
  profil + côtes catégorisées sort ») — un GIF court (saisie → génération →
  fiche, 10-15s) illustrerait l'angle 21.1 mieux qu'une capture statique de
  plus. Pas fait aujourd'hui, mais identifié comme le seul visuel qui
  manque vraiment à l'argumentaire.

## 21.3 — Texte de présentation court

Deux variantes, deux usages distincts — pas la même sur un README technique
(qui vise un développeur) et sur un texte de présentation public (qui vise
quelqu'un qui ne sait pas encore ce qu'est un pipeline de géocodage) :

> **Pour un public technique (déjà la logique du README actuel)** : « Donnez
> une liste de lieux et de cols, ÉtapeForge géocode, route et échantillonne
> l'altimétrie réelle du réseau routier actuel pour reconstituer l'étape —
> avec l'écart affiché entre distance officielle et reconstitution, jamais
> masqué. 100 % local, aucun compte. »

> **Pour un public non technique (nouveau, à valider)** : « Et si on pouvait
> *voir* le parcours du premier Tour de France de 1903, avec les vraies
> routes d'aujourd'hui et les vrais cols ? ÉtapeForge reconstitue n'importe
> quelle étape historique du Tour — d'hier ou imaginée — à partir d'une
> simple liste de villes. Tout tourne chez vous, sans compte ni service en
> ligne. »

La seconde variante est un projet de texte, pas un texte validé — à ajuster
avec l'utilisateur avant tout usage (y compris une simple bio GitHub ou un
site de démo).

## 21.4 — Avant toute publication

Rien de ce qui précède n'autorise une diffusion. Si l'utilisateur valide un
angle/texte/visuel ci-dessus pour un usage précis (README, page de démo,
post sur un forum, réseau social), le lister explicitement avant d'agir —
chaque canal a ses propres règles (ex. Show HN tolère mal un ton
publicitaire) qui n'ont pas été évaluées ici.

## Ce qui reste hors scope ici

- Le changement de design system (Épic 20, `docs/UI-UX-REVIEW.md`) reste un
  chantier distinct. Observation utile en le reliant à ce document : une
  bonne partie de l'effet "sexy" recherché vient davantage du contenu des
  captures (un vrai tracé de montagne spectaculaire plutôt qu'une étape de
  plaine quelconque en démo) que d'une refonte visuelle — à vérifier avant
  d'investir dans l'Option C de l'Épic 20 pour cette seule raison.
- Un nom de domaine, une page de démo hébergée publiquement, ou tout coût
  récurrent : décisions produit distinctes, pas aborder ici sans demande
  explicite.
