# Revue UI/UX globale et proposition design system (17/10/2026)

Épic 19 (revue UI/UX globale) et Épic 20 (proposition design system) de
`docs/SPRINT-STATUS.md`. Ce document **propose, ne décide pas** — Épic 20
attend explicitement l'arbitrage de l'utilisateur avant toute implémentation
(voir « ce qui n'est pas tranché » en fin de document).

## Méthode

Pas d'opinion visuelle en l'air : chaque constat ci-dessous est mesuré,
soit par grep sur `frontend/style.css` (309 lignes, fichier unique — voir
`docs/DESIGN_SYSTEM.md`), soit par relecture croisée avec l'audit Playwright
applicatif déjà fait (Épic 6 : 7 pages × 2 viewports, aucune régression
fonctionnelle trouvée — cette revue porte sur la cohérence visuelle, pas sur
le fonctionnel, déjà couvert).

## Constat 1 : la palette a des jetons, la mise en page n'en a pas

`docs/DESIGN_SYSTEM.md` documente 11 variables CSS, **toutes des couleurs**
(`--jaune`, `--noir`, `--bord`, etc.), chacune avec un historique de
correctifs de contraste WCAG vérifiés et verrouillés par test
(`test/contrast.test.js`, `test/profileContrast.test.js`). Aucune variable
équivalente n'existe pour l'espacement, le rayon de bordure ou la taille de
police — chaque valeur est tapée en dur à chaque règle. Mesuré par grep sur
`frontend/style.css` :

| Dimension | Valeurs distinctes trouvées | Échantillon |
|---|---|---|
| `border-radius` | 8 | 3px, 5px, 6px, 8px, 10px, 12px, 50%, et deux composés (`6px 6px 0 0`, `0 0 8px 8px`) |
| `font-size` | 17 | de `0.68em` à `1.5em`, sans paliers répétés (0.68, 0.72, 0.75, 0.8, 0.82, 0.85, 0.88, 0.9, 0.92, 0.95, 1.05, 1.1, 1.12, 1.15, 1.3, 1.45, 1.5) |
| `margin`/`padding`/`gap` (px) | 14 | 2, 3, 4, 6, 7, 8, 10, 12, 14, 16, 18, 20, 22, 24 — pas concentrées sur une grille 4/8px, étalées sur presque chaque entier |
| `box-shadow` | 3 recettes différentes | aucune ne partage de variable |

`docs/DESIGN_SYSTEM.md` ne documente que 3 tailles de police comme « la »
typographie (`h1` 1.45em, `h2` 1.12em, `.meta-line` 0.9em) — les 14 autres
valeurs réellement présentes dans le CSS ne sont documentées nulle part.

**Ce que ça n'est pas** : vérifié qu'il ne s'agit pas d'une fausse piste —
le système de bouton (`button, a.btn` + `.secondary`/`.danger`/`.tab`) est
cohérent et bien documenté, l'accessibilité (alt text, aria-label — 26
occurrences réelles, contraste couleur) ne montre aucun trou nouveau au-delà
de ce que l'historique de `DESIGN_SYSTEM.md` a déjà corrigé. Ce n'est donc
pas une interface incohérente à l'usage (l'audit Playwright fonctionnel n'a
rien trouvé, aucune plainte utilisateur rapportée) — c'est une dette
d'outillage : 309 lignes de CSS qui ont grandi fichier-par-fichier,
composant-par-composant, sans jamais se doter d'une échelle partagée.

## Constat 2 : conséquence pratique de l'absence d'échelle

Pas un bug visible aujourd'hui, mais un risque mesurable pour la suite :
sans échelle déclarée, chaque nouveau composant (le prochain écran, le
prochain badge) a autant de chances de reprendre une valeur déjà existante
que d'en inventer une 18ᵉ — rien dans le code ne guide vers la réutilisation.
C'est le même mécanisme de fond que `CAT_COLORS`/`CAT_TEXT`
(`frontend/profile.js`), où **trois révisions successives** ont été
nécessaires avant de trouver une table de couleurs qui tienne (voir
`docs/DESIGN_SYSTEM.md`, section « Couleurs de catégorie de côte ») — faute
d'avoir vérifié l'ensemble de la table en une fois. Un jeton de taille/
espacement déclaré une fois éviterait de refaire cette même expérience par
tâtonnement sur l'espacement ou la typographie.

## Ce qui n'a PAS été trouvé (et vaut d'être dit)

- Aucune régression fonctionnelle (déjà couvert par l'audit Playwright,
  Épic 6/7).
- Aucun nouveau trou d'accessibilité (contraste déjà gravé dans des tests
  dédiés ; alt text et aria-label présents où attendu).
- Aucune incohérence de navigation entre les 8 écrans (nav partagée,
  breakpoints mobiles documentés et justifiés individuellement — voir
  `docs/DESIGN_SYSTEM.md`, « Trois points de rupture mobile »).
- Le système de bouton et les composants documentés (`.card`, `.badge`,
  `.note`/`.reconstruction`) sont appliqués de façon cohérente.

Autrement dit : **l'interface n'est pas cassée ni franchement
incohérente à l'usage** — le problème trouvé est un problème d'outillage
(pas d'échelle déclarée), pas un problème d'expérience utilisateur urgent.

## Proposition : 3 options pour Épic 20 (design system)

### Option A — Ne rien changer

- **Coût** : nul.
- **Pour** : zéro risque de régression visuelle, zéro effort.
- **Contre** : la dette décrite ci-dessus continue de grossir à chaque
  nouvel écran/composant ; aucune garantie que la 18ᵉ taille de police
  choisie "au pif" reste cohérente avec les 17 existantes.

### Option B — Tokeniser l'existant, sans rien redessiner (recommandée)

Ajouter des variables CSS pour l'espacement (échelle 4/8/12/16/24px),
le rayon (2-3 valeurs max : `--radius-sm`/`--radius-md`) et la typographie
(échelle à 5-6 paliers), puis remplacer les valeurs en dur une par une par
ces jetons — **sans changer une seule couleur, composant ou mise en page
visible**. Aucune nouvelle dépendance (reste dans `style.css`, cohérent
avec `docs/BRIEF.md` : pas de framework frontend).

- **Coût** : faible-moyen — une passe de retouche sur 309 lignes de CSS,
  vérifiable visuellement écran par écran (même protocole que `/porte` :
  captures avant/après desktop 1440px + mobile 375px). Pas de risque
  fonctionnel (aucun JS touché).
- **Pour** : ferme la dette décrite ci-dessus, rend la prochaine addition
  de composant plus sûre, coût proportionné au problème réel trouvé (pas
  de problème grave = pas de chantier lourd).
- **Contre** : effort réel non nul pour un gain invisible à l'utilisateur
  final (c'est un investissement de maintenabilité, pas une amélioration
  visuelle perceptible).

### Option C — Refonte visuelle (nouveau design system/librairie)

Changer l'apparence (palette, composants, éventuellement une librairie UI)
pour viser un rendu plus "moderne"/"sexy" — ce que la question initiale de
l'utilisateur semblait envisager.

- **Coût** : élevé — risque de régression sur 8 écrans + fiche d'étape,
  nécessite de refaire les tests de contraste WCAG déjà verrouillés pour
  toute nouvelle palette, et si une librairie de composants est envisagée,
  **contredit `docs/BRIEF.md`** (« pas de framework frontend ») sans
  justification trouvée par cette revue — aucun problème d'usage réel ne le
  justifie aujourd'hui (voir « ce qui n'a pas été trouvé » ci-dessus).
- **Pour** : seul choix qui changerait vraiment l'impression visuelle
  ("sexy"), pertinent **si** l'objectif est marketing/perception plutôt que
  cohérence technique — à mettre en regard de la stratégie de
  positionnement (chantier séparé, voir Épic 21) plutôt que décidé ici en
  vase clos.
- **Contre** : chantier disproportionné par rapport au seul problème
  concret trouvé par cette revue (absence d'échelle, pas une interface
  dégradée) ; risque réel de régresser l'accessibilité déjà durement acquise
  si refait vite.

## Ce qui n'est pas tranché ici

Cette revue recommande l'Option B (proportionnée au problème réel trouvé)
mais **ne la met pas en œuvre** : le choix entre A/B/C — et en particulier
si l'objectif derrière "rendre l'appli sexy" est en fait un objectif
marketing/perception (Option C, à coordonner avec Épic 21) plutôt qu'un
problème de cohérence technique (Option B) — appartient à l'utilisateur.
