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

## Autres données tierces (appelées à l'exécution, non redistribuées)

Géocodage/routage/altimétrie ne sont pas redistribués par ce dépôt — ils sont
interrogés à l'exécution et mis en cache localement chez l'utilisateur
(`data/etapeforge.sqlite`). Attribution affichée dans l'application et les
exports (voir `ATTRIBUTIONS` dans `backend/exports.js`) :

- © IGN/Géoplateforme (géocodage, altimétrie RGE ALTI, fonds PLANIGNV2)
- © OpenStreetMap contributors
- Routage : OSRM (router.project-osrm.org)
- Altimétrie hors France : opentopodata.org (EU-DEM)
- Géocodage hors France : Nominatim (OpenStreetMap)

## En résumé

| | Licence | Redistribué par ce dépôt ? |
|---|---|---|
| Code (`backend/`, `pipeline/`, `frontend/`, `scripts/`, `test/`) | MIT | Oui |
| `pipeline/data/historic_routes.json`, `pipeline/fixtures/*.html` | CC BY-SA (Wikipédia) | Oui — respecter CC BY-SA pour ce contenu précis |
| Réponses géocodage/routage/altimétrie (mises en cache) | Propriété de chaque fournisseur, voir leurs CGU | Non — appelées à l'exécution, en cache local chez l'utilisateur |
