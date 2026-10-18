# NOTICE — licences des données

Le **code source** de ce dépôt est sous licence MIT (voir [`LICENSE`](./LICENSE)).

Cette licence MIT couvre le code : elle **ne s'applique pas** aux données
tierces qu'il embarque ou récupère, dont certaines restent sous leur propre
licence, distincte du code qui les traite.

## Données sous CC BY-SA (Wikipédia)

- **`pipeline/data/historic_routes.json`** : contient des points de passage
  (villes, cols, altitudes) reconstitués à partir des articles Wikipédia
  « *année* Tour de France » (CC BY-SA), recoupés avec des sources tierces
  citées dans le champ `notes` de chaque édition.
- **`pipeline/data/stage_towns.json`** : villes de départ et d'arrivée de
  chaque étape de chaque édition, extraites des articles Wikipédia anglais
  « *année* Tour de France » (CC BY-SA), avec des **coordonnées** issues de
  l'IGN/Géoplateforme (index des communes) et de Nominatim / OpenStreetMap
  (© OpenStreetMap contributors, ODbL) — construit par
  `scripts/build-stage-towns.js`, sert la recherche par lieu.
- **`pipeline/data/stage_itineraries.json`** : villes et côtes traversées
  par une étape, avec leur kilomètre, **transcrites à la main** depuis les
  profils d'étapes publiés par le Dico du Tour (ledicodutour.com), chaque
  étape citant l'URL de son profil. Seuls des faits (noms de lieux,
  kilomètres) sont repris, jamais les images. Coordonnées : IGN/Géoplateforme
  et Nominatim / OpenStreetMap (ODbL), ajoutées par
  `scripts/geocode-itineraries.js`.
- **`pipeline/fixtures/*.html`** : extraits capturés de pages Wikipédia,
  utilisés uniquement pour les tests hors-ligne (1903, 2025, 2026).
- Toute réutilisation de ces données spécifiques (pas le code qui les lit)
  doit respecter les termes de la licence
  [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/) — attribution
  et partage dans les mêmes conditions.

## Autres données tierces (appelées à l'exécution)

Géocodage/routage/altimétrie ne sont pas versionnés dans ce dépôt — ils sont
interrogés à l'exécution et mis en cache localement chez l'utilisateur
(`data/etapeforge.sqlite`). Attribution affichée dans l'application et les
exports (voir `ATTRIBUTIONS` dans `backend/exports.js`) :

- © IGN/Géoplateforme (géocodage, altimétrie RGE ALTI, fonds PLANIGNV2)
- © OpenStreetMap contributors
- Routage : BRouter (brouter.de, routeur principal depuis le 31/08/2026), repli OSRM (router.project-osrm.org)
- Altimétrie hors France : opentopodata.org (EU-DEM)
- Géocodage hors France : Nominatim (OpenStreetMap)

**Exception — démo GitHub Pages** : `.github/workflows/pages.yml` →
`scripts/build-site.js` publie les étapes pré-générées (`data/stage-N.json` :
tracé, waypoints géocodés, profil altimétrique). Quand les APIs réelles sont
joignables à la publication, ce sont des données dérivées d'OpenStreetMap
(ODbL) et de l'IGN, redistribuées sous les attributions ci-dessus ; sinon
`pages.yml` retombe sur le simulateur hors-ligne et les tracés publiés sont
synthétiques (bandeau de la démo, `st.offline`). Le routeur effectif est
enregistré par étape (`tracks.router`) : les étapes restaurées depuis le
cache CI peuvent précéder la migration BRouter. Portée exacte des
obligations ODbL pour ces fichiers : à confirmer.

## En résumé

| | Licence | Redistribué par ce dépôt ? |
|---|---|---|
| Code (`backend/`, `pipeline/`, `frontend/`, `scripts/`, `test/`) | MIT | Oui |
| `pipeline/data/historic_routes.json`, `pipeline/fixtures/*.html` | CC BY-SA (Wikipédia) | Oui — respecter CC BY-SA pour ce contenu précis |
| `pipeline/data/stage_towns.json` | CC BY-SA (Wikipédia) pour les villes et étapes ; coordonnées © IGN/Géoplateforme et © OpenStreetMap contributors (ODbL) | Oui — respecter CC BY-SA et l'attribution ODbL ; portée exacte des obligations ODbL pour ces coordonnées : à confirmer |
| `pipeline/data/stage_itineraries.json` | Faits (lieux, km) transcrits des profils du Dico du Tour, source citée par étape ; coordonnées © IGN/Géoplateforme et © OpenStreetMap contributors (ODbL) | Oui pour les faits cités ; statut d'une compilation de faits tirée d'un site tiers : à confirmer — attribution ODbL pour les coordonnées |
| Réponses géocodage/routage/altimétrie (mises en cache) | Propriété de chaque fournisseur, voir leurs CGU | Non dans le dépôt (cache local chez l'utilisateur) ; **oui** dans la démo GitHub Pages quand elle est générée en ligne (voir ci-dessus) |
