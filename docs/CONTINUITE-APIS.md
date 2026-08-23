# Plan de continuité pour la dépendance aux APIs publiques

ÉtapeForge s'appuie sur plusieurs services publics gratuits, **sans SLA** :

| Service | Usage | Hôte |
|---|---|---|
| IGN Géoplateforme | géocodage + altimétrie (France) | `data.geopf.fr` |
| OSRM public (projet OSRM) | routage sur route (partout) | `router.project-osrm.org` |
| Nominatim (OpenStreetMap) | géocodage (hors France) | `nominatim.openstreetmap.org` |
| opentopodata (EU-DEM) | altimétrie (hors France) | `api.opentopodata.org` |
| Wikipédia | listes d'étapes historiques (mode archives) | `en.wikipedia.org` |

Aucun de ces services n'offre de garantie de disponibilité — panne, rate
limit resserré, ou blocage du user-agent peuvent survenir sans préavis. Ce
document couvre deux choses : **ce qui protège déjà l'application** contre
ces pannes, et **comment aller plus loin** (auto-hébergement, alerting)
pour un kit pensé pour tourner en continu (Synology, Raspberry Pi).

## Ce qui existe déjà

- **Cache SQLite avec TTL** (`pipeline/cache.js`) : chaque réponse de
  géocodage/altimétrie est mise en cache 180 jours par défaut
  (`ETAPEFORGE_CACHE_TTL_DAYS`) — une étape déjà générée une fois ne
  redemande rien tant que le cache est valide, même si le service externe
  tombe ensuite.
- **Retry avec backoff exponentiel** (`pipeline/http.js`) : 3 tentatives
  par requête sur une erreur réseau/5xx (pas sur un 4xx, qui n'a aucune
  chance de réussir en retentant).
- **Bascule automatique en mode hors-ligne** (`ETAPEFORGE_AUTO_OFFLINE=1`) :
  si un service reste injoignable, le pipeline peut basculer sur le
  simulateur (`pipeline/simulator.js`, données synthétiques) plutôt que de
  faire échouer toute génération — au prix d'un tracé approximatif, visible
  comme tel (bandeau « mode hors-ligne » sur la fiche d'étape).
- **Notification d'échec de génération** (`backend/notify.js`, voir
  [`SYNOLOGY.md`](./SYNOLOGY.md#notifications)) : un webhook générique
  prévient quand une génération échoue en tâche de fond.
- **Diagnostic à la demande** (`GET /api/diagnostic`, page `/diag.html`) :
  sonde chaque service en une requête, avec latence et statut — le point de
  départ pour tout dépannage ou alerting externe (voir plus bas).

## Auto-hébergement d'OSRM

Le routage est le seul des cinq services ci-dessus pour lequel
l'auto-hébergement est aujourd'hui câblé dans le code : `pipeline/routing.js`
lit l'URL de base depuis `ETAPEFORGE_OSRM` (repli sur le service public si
absente). Auto-héberger le géocodage/l'altimétrie IGN ou Nominatim/opentopodata
n'est **pas** pris en charge actuellement — hors scope de ce document, à
traiter séparément si le besoin se confirme.

### Docker (extrait France, profil vélo)

Setup standard du projet OSRM, condensé pour ÉtapeForge — un extrait
national suffit largement (le Tour ne sort quasiment jamais de France) et
tient sur un NAS/Raspberry Pi modeste :

```bash
mkdir -p osrm-data && cd osrm-data
# Extrait France (~4 Go compressé, mis à jour régulièrement par Geofabrik)
curl -L -o france.osm.pbf https://download.geofabrik.de/europe/france-latest.osm.pbf

# Profil "bicycle" plus proche d'une étape de Tour que "car" (défaut public) —
# adapter selon ce qui se rapproche le plus du réseau réellement emprunté.
docker run -t -v "${PWD}:/data" osrm/osrm-backend osrm-extract -p /opt/bicycle.lua /data/france.osm.pbf
docker run -t -v "${PWD}:/data" osrm/osrm-backend osrm-partition /data/france.osrm
docker run -t -v "${PWD}:/data" osrm/osrm-backend osrm-customize /data/france.osrm

# Sert l'API de routage sur le port 5000
docker run -d --name osrm --restart unless-stopped \
  -p 5000:5000 -v "${PWD}:/data" \
  osrm/osrm-backend osrm-routed --algorithm mld /data/france.osrm
```

Puis, dans `docker-compose.yml` d'ÉtapeForge (ou l'environnement du
conteneur) :

```yaml
environment:
  - ETAPEFORGE_OSRM=http://osrm:5000   # ou l'IP/port de l'instance ci-dessus
```

**Coût réel** : l'extraction/partition/customize prend de quelques minutes
(Raspberry Pi 4) à quelques secondes (NAS avec plus de RAM) pour un extrait
France, et se refait à chaque mise à jour de l'extrait OSM — pas un
processus continu, juste une préparation ponctuelle (à rejouer, disons,
trimestriellement pour rester à jour du réseau routier).

`GET /api/diagnostic` sonde automatiquement l'URL réellement configurée
(`ETAPEFORGE_OSRM` si définie) — pas systématiquement le service public —
donc le diagnostic reste représentatif une fois l'auto-hébergement en place.

## Stratégie d'alerting pour un kit pensé pour tourner en continu

`GET /api/diagnostic` est un point de sonde **à la demande**, pas un
mécanisme qui pousse une alerte tout seul. Pour un usage Synology/Raspberry
Pi laissé en continu, deux options simples, sans nouvelle dépendance :

### Option A — Tâche planifiée DSM (Synology)

**Panneau de configuration → Planificateur de tâches → Créer → Tâche
planifiée → Script défini par l'utilisateur**, exécuté par exemple toutes
les 6 heures :

```bash
#!/bin/bash
RESULT=$(curl -s --max-time 15 http://localhost:4567/api/diagnostic)
ALL_OK=$(echo "$RESULT" | grep -o '"allOk":[a-z]*' | cut -d: -f2)
if [ "$ALL_OK" != "true" ]; then
  # Réutilise le même webhook générique que les notifications d'échec de
  # génération (voir SYNOLOGY.md#notifications) — un seul mécanisme
  # d'alerting à configurer, pas deux.
  curl -s -X POST "$ETAPEFORGE_NOTIFY_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"ÉtapeForge — au moins une API externe est en échec : $RESULT\"}"
fi
```

(Remplacer `$ETAPEFORGE_NOTIFY_WEBHOOK_URL` par l'URL réelle, ou la lire
depuis le même fichier d'environnement que `docker-compose.yml`.)

### Option B — Notification native DSM

Plus simple, moins précis : DSM peut envoyer une notification native (email,
push DSM) si le script planifié ci-dessus se termine en erreur — cocher
« M'avertir en cas d'erreur d'exécution » sur la tâche, et faire sortir le
script avec un code non-nul quand `allOk` n'est pas `true`
(`[ "$ALL_OK" = "true" ] || exit 1` à la fin du script). Pas besoin de
webhook du tout dans ce cas, seulement du système de notification DSM déjà
configuré par ailleurs (email du compte admin, appli DSM finder…).

## Limites assumées

- Un extrait OSRM auto-hébergé vieillit entre deux mises à jour manuelles —
  un nouveau tronçon routier récent n'y apparaîtra pas avant la prochaine
  extraction. Le service public, lui, est à jour en continu (mais sans SLA).
- Ce document ne couvre **pas** l'auto-hébergement du géocodage ou de
  l'altimétrie (Nominatim, opentopodata, IGN) — seule la partie routage a un
  point d'extension déjà câblé dans le code à ce jour.
- L'alerting proposé détecte une panne **existante**, pas une dégradation
  progressive (latence en hausse, rate-limit resserré) — `GET /api/quota`
  (tableau de bord de consommation) reste le bon endroit pour surveiller ça
  manuellement en cas de doute.
