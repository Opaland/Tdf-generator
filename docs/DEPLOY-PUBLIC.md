# Exposition publique d'ÉtapeForge (comptes email/mot de passe)

Ce document décrit comment rendre ÉtapeForge accessible depuis Internet, avec
un vrai mur d'accès (comptes email/mot de passe), sur un VPS externe (OVH ou
équivalent). Il complète — et ne remplace pas — le mode par défaut (local ou
Synology/Tailscale, [`SYNOLOGY.md`](./SYNOLOGY.md)) qui reste sans compte.
Pas de VPS sous la main ? [`RASPBERRY-PI.md`](./RASPBERRY-PI.md) couvre la
même exposition publique (`ETAPEFORGE_PUBLIC=1` inchangé) depuis un
Raspberry Pi chez soi.

## ⚠️ Modèle de données : à lire avant d'inviter qui que ce soit

**L'authentification est un mur d'accès, pas un cloisonnement multi-utilisateur.**
Toutes les étapes, tours, traces importées et connexions Suunto restent
**partagés entre tous les comptes** — exactement comme en usage local
aujourd'hui, simplement derrière une page de connexion. N'importe quel compte
peut voir, modifier ou supprimer les données créées par n'importe quel autre
compte. L'inscription est libre (n'importe qui avec le lien peut créer un
compte), donc :

- ne partagez le lien public qu'avec des personnes de confiance ;
- gardez à l'esprit qu'un compte malveillant peut tout supprimer — voir la
  sauvegarde SQLite ci-dessous ;
- l'inscription libre consomme aussi les quotas des APIs externes gratuites
  (Nominatim 1 req/s, OSRM public…) partagés par tous les comptes — un afflux
  d'inscriptions peut dégrader la génération pour tout le monde.

Si ce modèle ne convient pas (besoin d'isolation par utilisateur ou
d'inscription fermée), c'est un chantier plus large que celui-ci — voir
l'issue de backlog du dépôt.

## Activer le mur d'accès

Une seule variable d'environnement :

```bash
ETAPEFORGE_PUBLIC=1
```

Effets :
- `/api/*` (sauf `/api/auth/*` et `GET /api/status`) exige une session valide,
  sinon 401 ;
- le frontend redirige automatiquement vers `/login.html` si aucune session
  n'est trouvée ;
- le cookie de session est marqué `Secure` (n'est donc envoyé que sur HTTPS —
  d'où la nécessité du reverse proxy ci-dessous) ;
- `trust proxy` est activé côté Express, pour que le limiteur de tentatives
  login/register utilise la vraie IP du client (via `X-Forwarded-For`) plutôt
  que celle du reverse proxy.

Sans cette variable (mode par défaut, local/Synology), rien ne change :
aucun compte requis, comportement historique inchangé.

## HTTPS via reverse proxy (Caddy, le plus simple)

ÉtapeForge lui-même ne fait que du HTTP nu sur le port 4567 — un reverse
proxy devant lui gère HTTPS. [Caddy](https://caddyserver.com/) obtient et
renouvelle automatiquement un certificat Let's Encrypt, sans configuration
manuelle :

```
# /etc/caddy/Caddyfile
etapeforge.votre-domaine.fr {
    reverse_proxy localhost:4567
}
```

```bash
sudo apt install -y caddy   # ou la méthode d'install de votre distribution
sudo systemctl reload caddy
```

Pointez d'abord un enregistrement DNS A (ou AAAA) de `etapeforge.votre-domaine.fr`
vers l'IP du VPS — Caddy a besoin que le DNS résolve déjà pour obtenir le
certificat.

## Lancer le serveur sur le VPS

Avec le kit Docker existant (`Dockerfile`, `docker-compose.yml`), en ajoutant
la variable d'environnement :

```yaml
# docker-compose.yml (extrait, sur le VPS uniquement — ne pas activer sur
# une install Synology/LAN existante)
services:
  etapeforge:
    environment:
      - PORT=4567
      - ETAPEFORGE_PUBLIC=1
    ports:
      - "127.0.0.1:4567:4567"   # seul Caddy (sur la même machine) y accède
```

Notez le `127.0.0.1:4567:4567` (plutôt que `4567:4567`) : le port n'est
exposé qu'en local sur le VPS, Caddy en local fait le pont vers l'extérieur
en HTTPS — le conteneur Node lui-même ne voit jamais de trafic non chiffré
venant d'Internet.

```bash
git clone https://github.com/Opaland/Tdf-generator
cd Tdf-generator
sudo docker compose up -d --build
```

## Créer le premier compte

Ouvrez `https://etapeforge.votre-domaine.fr/login.html`, onglet
« Créer un compte ». Le premier arrivé n'a pas de statut particulier
(pas de rôle admin) — voir l'avertissement en tête de ce document.

## Sauvegarde

Encore plus importante qu'en usage local, vu le modèle de données partagées :
sauvegardez régulièrement `data/etapeforge.sqlite` (cron + `rsync`/`scp` vers
un stockage distant, ou tout outil de snapshot de votre hébergeur). Voir aussi
l'item de backlog « Sauvegarde automatique de la base SQLite ».

## Dépannage

- **Le cookie de session ne se pose pas / boucle infinie vers `/login.html`** :
  vérifiez que vous accédez bien en HTTPS (le cookie est `Secure`, donc
  invisible en HTTP nu) et que le reverse proxy transmet bien le trafic sans
  le réécrire en HTTP entre lui et le navigateur.
- **429 au login** : le limiteur de tentatives (10 essais / 15 min / IP) a
  été déclenché — attendez, ou vérifiez qu'aucun outil de supervision ne
  martèle `/api/auth/login`.
- **Quotas API épuisés avec plusieurs comptes actifs** : voir `/diag.html`
  (accessible une fois connecté) pour la latence par service.
