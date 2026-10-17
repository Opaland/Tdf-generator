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
- **`pipeline/fixtures/*.html`** : extraits capturés de pages Wikipédia,
  utilisés uniquement pour les tests hors-ligne (1903, 2025, 2026).
- Toute réutilisation de ces données spécifiques (pas le code qui les lit)
  doit respecter les termes de la licence
  [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/) — attribution
  et partage dans les mêmes conditions.

## Autres données tierces (appelées à l'exécution)

Géocodage/routage/altimétrie ne sont pas versionnés dans ce dépôt — ils sont
interrogés à l'exécution et mis en cache localement chez l'utilisateur
(`data/etapeforge.sqlite`). **Exception** : la démo GitHub Pages
(`.github/workflows/pages.yml` → `scripts/build-site.js`) publie les étapes
générées à la publication (`data/stage-N.json` : tracé routé, waypoints
géocodés, profil altimétrique) — des données dérivées d'OpenStreetMap (ODbL)
et de l'IGN, redistribuées sous ces attributions. Portée exacte des
obligations ODbL pour ces fichiers : à confirmer. Attribution affichée dans l'application et les
exports (voir `ATTRIBUTIONS` dans `backend/exports.js`) :

- © IGN/Géoplateforme (géocodage, altimétrie RGE ALTI, fonds PLANIGNV2)
- © OpenStreetMap contributors
- Routage : BRouter (brouter.de, routeur principal depuis le 31/08/2026), repli OSRM (router.project-osrm.org)
- Altimétrie hors France : opentopodata.org (EU-DEM)
- Géocodage hors France : Nominatim (OpenStreetMap)

## En résumé

| | Licence | Redistribué par ce dépôt ? |
|---|---|---|
| Code (`backend/`, `pipeline/`, `frontend/`, `scripts/`, `test/`) | MIT | Oui |
| `pipeline/data/historic_routes.json`, `pipeline/fixtures/*.html` | CC BY-SA (Wikipédia) | Oui — respecter CC BY-SA pour ce contenu précis |
| Réponses géocodage/routage/altimétrie (mises en cache) | Propriété de chaque fournisseur, voir leurs CGU | Non dans le dépôt (cache local chez l'utilisateur) ; **oui** dans la démo GitHub Pages, pour les étapes pré-générées (voir ci-dessus) |
