# Design system — ÉtapeForge

Couleurs, espacement, composants — et pourquoi certaines duplications ne
doivent pas être « corrigées ». Tout vit dans `frontend/style.css` (un seul
fichier, ~200 lignes) et `frontend/common.js` (namespace `EF`) ; pas de
bibliothèque de composants, cohérent avec l'absence de framework frontend
(voir `BRIEF.md`, « ce qu'on ne fera pas »).

## Palette (`:root` dans `style.css`)

| Variable | Valeur | Usage |
|---|---|---|
| `--jaune` | `#ffd320` | Couleur de marque (maillot jaune) — logo, onglet actif, boutons primaires |
| `--noir` | `#141414` | Fond de la barre de nav, texte sur bouton primaire |
| `--sable` | `#ead9b0` | Fond des en-têtes de tableau, survol de suggestion |
| `--fond` | `#faf7f0` | Fond de page |
| `--carte` | `#ffffff` | Fond des cartes (`.card`) |
| `--bord` | `#ddd5c2` | Bordures |
| `--texte` | `#222` | Texte principal |
| `--texte2` | `#6b6b6b` | Texte secondaire (`.meta-line`, libellés) |
| `--ok` | `#27764a` | Statut positif (checks, badge « générée ») |
| `--warn` | `#a15818` | Statut d'avertissement (checks, badge « génération… ») |
| `--fail` | `#b01c2f` | Statut d'échec |

**`--ok`, `--warn` et `--fail` ont été assombris** (contraste WCAG AA
insuffisant trouvé lors de l'audit UI/UX puis verrouillé par
`test/contrast.test.js`, [#18](https://github.com/Opaland/Tdf-generator/issues/18)) :

- `--warn` : `#e67e22` → `#a15818` (PR #24) — 2.85:1 → **5.35:1** sur blanc,
  2.53:1 → **4.75:1** sur le fond du badge « génération… » (`#fdf0d8`).
- `--ok` : `#2e8b57` → `#27764a` (PR #24) — 4.25:1 → **5.56:1** sur blanc, →
  **4.60:1** sur le fond du badge « générée » (`#d9efe1`).
- `--fail` : `#d7263d` → `#b01c2f` (PR #87, trouvé en écrivant
  `test/contrast.test.js` — jamais mesuré lors du correctif de #18 à
  l'époque, qui ne portait que sur `--ok`/`--warn`) — 3.87:1 → **5.36:1** sur
  le fond du badge d'erreur (`#fbdcdc`), → **6.88:1** sur blanc.

**Ne pas revenir aux teintes plus vives sans faire passer
`npm test -- test/contrast.test.js`** (ou recalculer les ratios à la main —
la formule WCAG 2.1, luminance relative sRGB, est simple à rejouer) avant
toute retouche de palette.

## Couleurs de catégorie de côte (`frontend/profile.js`, `CAT_COLORS`/`CAT_TEXT`/`GRAD_COLORS`)

Deuxième famille de couleurs sensible au contraste WCAG, distincte de la
palette `:root` ci-dessus (fichier différent, pas des variables CSS) — sans
historique documenté ici jusqu'à ce que ça devienne l'occasion manquée
identifiée par une revue-personas (backlog #63) : le motif « toute retouche
de contraste documentée avec ses ratios » établi ci-dessus ne s'étendait pas
à cette table.

| Catégorie | Fond | Texte | Usage |
|---|---|---|---|
| HC | `#111111` | `#ffffff` | Pastille, bande de pente |
| 1 | `#d7263d` | `#ffffff` | Pastille |
| 2 | `#f08c00` | `#333333` | Pastille, bande de pente 5–8 % |
| 3 | `#f7d154` | `#333333` | Pastille, bande de pente < 5 % |
| 4 | `#5cb85c` | `#333333` | Pastille |

**Historique** (verrouillé par `test/profileContrast.test.js`) :

- `CAT_TEXT['2']` : texte `#ffffff` → `#333333` sur `#f08c00` inchangé —
  2.48:1 → **5.09:1** (backlog #63, trouvaille de revue-personas sur PR #87).
- `CAT_COLORS['4']` : d'abord assombri `#3a9d4f` → `#268038` pour corriger
  le même défaut sur le vert (3.43:1 → 4.97:1 avec texte blanc conservé) —
  puis **cette première correction annulée** : elle avait fait chuter la
  luminance du vert à 0.161, quasi identique à celle du rouge cat.1
  `#d7263d` (0.162), rendant les deux quasi indistinguables sous
  protanopie/deutéranopie (rouge-vert) — trouvaille de relecture adverse
  (simulation CVD Machado/Oliveira/Fairchild). Remplacé par une **éclaircie**
  `#5cb85c` (luminance 0.373, écart de +0.212 avec le rouge — plus large que
  l'écart original de +0.094) avec texte `#333333` (7.43:1) plutôt que blanc.
- Repli catégorie inconnue (`CAT_COLORS[cat] || '#999'`, mort en pratique —
  `categorize()` dans `pipeline/climbs.js` ne renvoie jamais que HC/1/2/3/4)
  assombri `#999999` → `#707070` par cohérence (2.85:1 → 4.95:1 avec texte
  blanc), pour ne pas laisser un piège prêt à s'activer si une nouvelle
  catégorie apparaissait un jour.
- `frontend/stage.js` avait sa propre copie du rendu du marqueur de sommet
  de côte sur la carte, avec un `color:#fff` **en dur** — ne lisait jamais
  `CAT_TEXT`, donc aucun des correctifs ci-dessus ne s'y appliquait (jusqu'à
  1.48:1 sur la catégorie 3, jaune). Corrigé pour lire `EFProfile.CAT_TEXT`
  comme tous les autres points de rendu.

**Un changement de couleur de catégorie qui touche au vert ou au rouge doit
vérifier l'écart de luminance entre les deux** (pas seulement le contraste
texte/fond isolé) — l'assombrissement initial de cat.4 ci-dessus l'a appris
à ses dépens : corriger un contraste WCAG peut en briser un autre
(distinguabilité sous daltonisme rouge-vert) si on ne regarde que la paire
qu'on corrige.

## Typographie

Pile système uniquement (`"Segoe UI", system-ui, -apple-system, sans-serif`)
— **pas de police distante**, même raisonnement que Rando-generator : l'app
promet que tout reste local, charger une webfont contredirait ça pour un
gain cosmétique marginal.

- `h1` : 1.45em — titre de page, un seul par écran.
- `h2` : 1.12em, soulignement jaune (`border-bottom: 2px solid var(--jaune)`)
  — titres de section.
- `.meta-line` : 0.9em, `--texte2` — texte secondaire, toujours en dessous
  d'un titre ou d'un champ, jamais seul.

## Composants

- **`.card`** : conteneur blanc, bord `--bord`, rayon 10px — unité de base de
  toute mise en page. `style="overflow-x:auto"` inline sur toute carte
  contenant un tableau qui peut dépasser en largeur (cols, comparateur,
  éditeur) — voir « Trois points de rupture mobile » plus bas pour pourquoi
  ce n'est pas toujours suffisant seul.
- **`button` / `a.btn`** : fond `--noir`, texte `--jaune` par défaut ;
  `.secondary` (gris clair) pour une action non destructrice secondaire ;
  `.danger` (fond `--fail`) réservé aux actions qui suppriment des données
  persistées — jamais pour une action réversible avant sauvegarde (le bouton
  ✕ qui retire un waypoint du formulaire, avant génération, reste sans
  confirmation : rien n'est encore perdu).
- **`.badge`** : pastille de statut (`.done`, `.generating`, `.error`,
  `.draft`) — toujours accompagnée d'un texte (« générée », « génération… »),
  jamais de la couleur seule comme unique porteur de sens.
- **Confirmation de suppression** : `EF.confirmClick(btn, { onConfirm })`
  (`common.js`) — double-clic armé 3 secondes, jamais de `confirm()` natif
  (PR #24, factorisé en helper réutilisable dans la session suivante). Voir
  `editor.js` pour l'usage de référence.
- **Tableaux** : trois classes selon le contexte — `table.kmtable` (analyse
  km par km, en-têtes triables), `table.stats` (cols, comparateur, sticky
  header), `table.stage-list` (liste d'étapes). Toutes bénéficient d'un
  survol de ligne (`#f6f1e4`) pour la lisibilité, pas d'une couleur par
  colonne.
- **`.note`** (fond `#fdf6dd`) et **`.reconstruction`** (fond `#eef3fb`) :
  deux encarts informatifs visuellement distincts par intention — `.note`
  pour un avertissement/contexte général, `.reconstruction` spécifiquement
  pour l'écart distance officielle/reconstituée. Ne pas fusionner : la
  distinction de couleur aide à distinguer « lis ceci » de « donnée
  spécifique affichée ici ».

## Trois points de rupture mobile, et pourquoi ils diffèrent

Trouvés et corrigés un par un en PR #24 (audit UI/UX, [#16](https://github.com/Opaland/Tdf-generator/issues/16)/[#17](https://github.com/Opaland/Tdf-generator/issues/17)) —
**pas un seul breakpoint global**, parce que chacun répond à un contenu qui
déborde à une largeur différente :

- **720px** : la nav (`header.topbar`) bascule en menu ☰. Six liens + logo +
  badge ne tiennent pas en dessous, et c'était le cas sur les 8 écrans sans
  exception avant correctif.
- **640px** : le tableau de comparaison (`#cmp-table`, 3 colonnes) passe de
  colonnes à blocs empilés par métrique. Plus étroit que 720px parce qu'un
  tableau à 3 colonnes tolère un peu plus de compression qu'une nav à 6
  liens avant de devenir illisible.
- **600px** : la ligne de waypoint (idx + champ + select + coordonnées + 3
  boutons, `.wp-list li`) passe sur plusieurs lignes. Le plus étroit des
  trois parce que c'est la ligne la plus dense (~366px de contenu à taille
  fixe avant même le champ texte).

**Ne pas les unifier en un seul breakpoint « mobile ».** Chaque valeur a été
mesurée contre le contenu réel qui déborde, pas choisie par convention — les
regrouper romprait la logique qui les a produites, sans gain réel (aucun des
trois composants ne partage de conteneur commun qui bénéficierait d'un seul
point de bascule).

## Une duplication couleur qui reste volontaire : `EF.typeColors`

`common.js` définit `EF.typeColors` (plaine `#2e8b57`, accidentée `#e67e22`,
montagne `#c0392b`, clm `#2980b9`, clm par équipes `#8e44ad`) — des valeurs
hexadécimales dupliquées en JavaScript plutôt que lues depuis les variables
CSS. **Ce n'est pas un oubli** : ces couleurs habillent des tracés Leaflet
(`L.polyline({ color: ... })`) et des SVG de profil, rendus en canvas/SVG où
CSS ne peut pas s'appliquer directement — il faudrait lire
`getComputedStyle()` à l'exécution pour extraire une variable CSS en JS,
complexité inutile pour des valeurs qui ne changent jamais dynamiquement.

**Piège à ne pas retomber dedans** : `accidentée` vaut `#e67e22` — exactement
l'**ancienne** valeur de `--warn` avant son assombrissement en PR #24 (voir
plus haut). Coïncidence, pas un lien réel entre les deux : `--warn` est un
statut (checks, badges), `accidentée` est un type d'étape sur la carte/les
légendes. Les recolorer ensemble un jour parce qu'elles se ressemblaient
serait une erreur — ce sont deux systèmes de couleur indépendants qui
partagent une teinte par hasard.
