# ÉtapeForge sur un NAS Synology (Container Manager + Tailscale)

Objectif : l'application complète qui tourne en continu chez vous, accessible
depuis votre téléphone/portable, **sans rien exposer sur Internet** et **sans
donner au conteneur le moindre accès à vos fichiers**.

## Principes de sécurité appliqués

- **Conteneur isolé** : utilisateur non-root, `cap_drop: ALL`,
  `no-new-privileges`, système de fichiers **en lecture seule** — le conteneur
  ne peut écrire que dans **un seul dossier dédié** (`/volume1/docker/etapeforge/data`,
  sa base SQLite). Vos photos, documents et autres partages sont invisibles pour lui.
- **Aucune redirection de port dans la box** : le port 4567 n'est joignable
  qu'en réseau local. De l'extérieur, l'application n'existe pas.
- **Accès distant via Tailscale** : réseau privé chiffré entre vos appareils —
  pas de HTTPS à gérer, pas de mot de passe exposé, jetons Suunto à l'abri.

## Installation (≈ 15 minutes)

### 1. Préparer le dossier de données

Dans **File Station** : créez `docker/etapeforge/data` (vide). C'est le seul
dossier que le conteneur pourra écrire.

### 2. Déployer avec Container Manager

1. Ouvrez **Container Manager** (DSM 7.2+ ; sinon le paquet « Docker ») ;
2. **Projet → Créer** ;
   - Nom : `etapeforge` ;
   - Chemin : un dossier de travail (ex. `docker/etapeforge`) ;
   - Source : **Créer docker-compose.yml** et collez le contenu du
     [`docker-compose.yml`](../docker-compose.yml) du dépôt.
     Deux adaptations possibles :
     - le chemin du volume si votre volume n'est pas `/volume1` ;
     - la ligne `build: .` suppose que le dépôt est cloné dans le dossier du
       projet — le plus simple : `git clone https://github.com/Opaland/Tdf-generator`
       dans `docker/etapeforge` (via SSH, ou en téléversant le zip du dépôt),
       puis pointez le projet Container Manager sur ce dossier ;
3. **Créer** → l'image se construit (quelques minutes la première fois :
   téléchargement de Node et des dépendances), puis le conteneur démarre.

Vérification : depuis un appareil du réseau local,
`http://IP-DU-NAS:4567` → ÉtapeForge. Ouvrez `http://IP-DU-NAS:4567/diag.html`
pour vérifier que le NAS atteint bien les APIs (IGN, BRouter/OSRM, Wikipédia…).

### Variante en ligne de commande (SSH)

```bash
ssh admin@IP-DU-NAS
cd /volume1/docker/etapeforge
git clone https://github.com/Opaland/Tdf-generator .
sudo docker compose up -d --build
```

### 3. Accès distant avec Tailscale

1. **Centre de paquets** → installez **Tailscale** → connectez-le à votre
   compte (gratuit jusqu'à 3 utilisateurs / 100 appareils) ;
2. Installez l'appli Tailscale sur votre téléphone/portable avec le même compte ;
3. Depuis n'importe où : `http://NOM-DU-NAS:4567` (le nom apparaît dans la
   console Tailscale) — le trafic est chiffré de bout en bout, rien ne transite
   par une IP publique.

> N'activez **pas** de redirection du port 4567 dans votre box, et n'exposez
> pas ce port via QuickConnect/portail Synology : par défaut l'application n'a
> pas d'authentification (elle est conçue pour un usage personnel en réseau
> local), Tailscale est votre couche d'accès. Pour une vraie exposition
> publique avec comptes, voir [`DEPLOY-PUBLIC.md`](./DEPLOY-PUBLIC.md) plutôt
> que d'ouvrir ce port directement.

## Mise à jour

```bash
cd /volume1/docker/etapeforge
git pull
sudo docker compose up -d --build
```

(ou « Projet → Action → Nettoyer et reconstruire » dans Container Manager
après un `git pull`).

## Sauvegarde

Toutes les données (étapes, tours, caches, config Suunto) tiennent dans
`docker/etapeforge/data/etapeforge.sqlite`.

**Sauvegarde automatique intégrée** (recommandée) : décommentez le volume
`/backup` et les trois variables `ETAPEFORGE_BACKUP_*` dans
[`docker-compose.yml`](../docker-compose.yml), en pointant le volume vers un
**deuxième volume physique** du NAS si possible — le même disque que `/data`
ne protège de rien en cas de panne disque. Une sauvegarde tourne alors au
démarrage puis toutes les `ETAPEFORGE_BACKUP_INTERVAL_HOURS` heures (24 par
défaut), les `ETAPEFORGE_BACKUP_KEEP` plus récentes sont conservées (7 par
défaut, les plus anciennes purgées automatiquement). C'est une copie
**cohérente** même pendant que l'application écrit (API de sauvegarde native
SQLite, pas une simple copie de fichier) — pas besoin d'arrêter le
conteneur. État visible sur `GET /api/status` (champ `backup` : répertoire,
cadence, nombre de sauvegardes conservées, nom de la plus récente).

**Alternative** : incluez le dossier `docker/etapeforge/data` dans
Hyper Backup, ou copiez le fichier `.sqlite` directement. Dans ce cas,
arrêtez le conteneur le temps de la copie — une copie de fichier brute
pendant que SQLite écrit (mode WAL) n'est pas garantie cohérente, contrairement
à la sauvegarde automatique intégrée ci-dessus.

## Identifiants des connecteurs (Suunto, Strava)

La base SQLite **n'est pas chiffrée**. Ce qui y est stocké est lisible par
quiconque obtient une copie du fichier `etapeforge.sqlite`, ou d'une
sauvegarde automatique (`/backup`). C'est le cas :

- des **jetons de connexion** (`access_token`, `refresh_token`) : toujours en
  base, c'est leur seul stockage ;
- des **secrets d'application** (`client_secret`, `subscription_key`)
  **seulement** s'ils ont été saisis dans l'interface. Fournis par variable
  d'environnement, ils ne touchent jamais la base.

Recommandations :

1. Passer les secrets d'application par variables d'environnement dans
   `docker-compose.yml` : `SUUNTO_CLIENT_ID`, `SUUNTO_CLIENT_SECRET`,
   `SUUNTO_SUBSCRIPTION_KEY`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`.
2. Restreindre l'accès au dossier de données et aux sauvegardes **au
   niveau du partage DSM** (droits du dossier partagé, pas de partage
   SMB/AFP ouvert à d'autres comptes). Attention à un `chmod 600`/`700`
   direct : le conteneur tourne sous un utilisateur non-root (uid 10001,
   voir le `Dockerfile`), et retirer ses droits l'empêcherait d'ouvrir sa
   propre base — si vous resserrez les permissions, faites-le pour cet uid
   (`chown -R 10001:10001` sur le dossier), pas contre lui.
3. Vérifier sur `/diag.html`, section « Identifiants des connecteurs ». Un
   secret signalé « base SQLite, en clair » reste en base même une fois la
   variable d'environnement définie (elle est seulement prioritaire).
   L'interface ne propose pas de l'effacer. L'image ne contient pas l'outil
   `sqlite3`, mais le module SQLite de l'application suffit, depuis le
   conteneur en marche (même utilisateur que l'application, donc aucun
   fichier créé avec un autre propriétaire) :

   ```bash
   docker exec etapeforge node -e "require('better-sqlite3')('/data/etapeforge.sqlite').prepare(\"DELETE FROM settings WHERE key IN ('suunto_client_secret','suunto_subscription_key','strava_client_secret')\").run()"
   ```

   (Requête vérifiée sur une base de test avec ce même module ; pas rejouée
   sur un NAS réel.) Les sauvegardes automatiques déjà faites contiennent toujours l'ancienne
   valeur : les purger aussi, ou changer le secret chez le fournisseur.

**Chiffrement au repos** (option B de l'issue #379) : définir
`ETAPEFORGE_SECRET_KEY` (16 caractères au moins, par exemple
`openssl rand -hex 32`). Les secrets et jetons des connecteurs sont alors
chiffrés en base (AES-256-GCM) ; ceux déjà présents en clair sont chiffrés au
démarrage suivant. Ce que ça protège : une copie du fichier `.sqlite` ou
d'une sauvegarde automatique, sans la clé. Ce que ça ne protège pas : un
serveur compromis en marche (la clé est dans son environnement). **Une clé
perdue ou changée rend les secrets illisibles** : les connecteurs
apparaissent alors non configurés, il faut les reconfigurer et reconnecter
les comptes. Les sauvegardes faites avant l'activation restent en clair.

## Notifications

Une génération d'étape tourne en tâche de fond (jusqu'à quelques minutes en
mode réel) — sans notification, un échec (API externe indisponible, col
inroutable…) ne se voit qu'en revenant sur l'application. Décommentez
`ETAPEFORGE_NOTIFY_WEBHOOK_URL` dans
[`docker-compose.yml`](../docker-compose.yml) pour recevoir un webhook à
chaque échec.

Aucune intégration propriétaire figée (pas de bot Telegram à configurer) :
un POST générique, dans l'un des deux formats les plus largement supportés
sans code supplémentaire côté récepteur —

- **Texte brut** (`ETAPEFORGE_NOTIFY_FORMAT=text`) : le message seul dans le
  corps de la requête — le format attendu par
  [ntfy.sh](https://ntfy.sh) (auto-hébergeable, sans compte : `POST
  https://ntfy.sh/mon-etapeforge`, cohérent avec la philosophie 100 % locale
  du projet) et la plupart des webhooks génériques (Home Assistant, n8n…).
- **JSON** (par défaut) : `{text, content, stage_id, stage_name, error,
  timestamp}` — `text` est lu par les webhooks entrants Slack, `content` par
  ceux de Discord (les deux portent le même message ; chaque service ignore
  le champ qu'il ne connaît pas).

Un vrai bot Telegram (API `chat_id`/token) ou un service exigeant un corps
différent nécessite un petit relais côté utilisateur (ex. un webhook
n8n/Home Assistant qui reçoit le POST générique et le retransmet dans le
format attendu) — hors scope de cette intégration minimale. État visible sur
`GET /api/status` (champ `notify`).

## Dépannage

- **Le conteneur ne démarre pas après une mise à jour** : reconstruisez l'image
  (`docker compose up -d --build`) ;
- **Erreur d'écriture** : vérifiez que le dossier `data` du NAS est bien monté
  sur `/data` et accessible en écriture ; en dernier recours, retirez
  `read_only: true` du compose (le conteneur reste non-root et sans capacités) ;
- **Génération impossible** : ouvrez `/diag.html` — si une API est bloquée par
  votre pare-feu sortant, autorisez `data.geopf.fr`, `router.project-osrm.org`,
  `nominatim.openstreetmap.org`, `api.opentopodata.org`, `en.wikipedia.org`,
  `cloudapi.suunto.com` et `cloudapi-oauth.suunto.com` (HTTPS sortant uniquement).
  Pour un NAS pensé pour tourner en continu, voir
  **[CONTINUITE-APIS.md](./CONTINUITE-APIS.md)** — auto-hébergement d'OSRM
  et alerting sur panne d'une API externe, ces services n'ayant aucun SLA.
