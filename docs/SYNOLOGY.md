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
pour vérifier que le NAS atteint bien les APIs (IGN, OSRM, Wikipédia…).

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
> pas ce port via QuickConnect/portail Synology : l'application n'a pas
> d'authentification (elle est conçue pour un usage personnel), Tailscale est
> votre couche d'accès.

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
`docker/etapeforge/data/etapeforge.sqlite` : incluez ce dossier dans
Hyper Backup, ou copiez simplement le fichier (le conteneur peut rester actif,
SQLite est en mode WAL ; pour une copie parfaitement cohérente, arrêtez le
conteneur le temps de la copie).

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
