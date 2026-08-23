# Déploiement sur Raspberry Pi personnel (alternative gratuite au VPS)

Ce document décrit comment exposer ÉtapeForge sur Internet depuis un
Raspberry Pi chez vous, sans payer de VPS — le mur d'accès
(`ETAPEFORGE_PUBLIC=1`) fonctionne à l'identique de
[`DEPLOY-PUBLIC.md`](./DEPLOY-PUBLIC.md), **lisez-le d'abord** : ce document
ne couvre que ce qui change avec un Raspberry Pi chez soi plutôt qu'un VPS —
le matériel, et surtout la façon de rendre le Pi joignable depuis Internet.

## Le problème spécifique au Raspberry Pi chez soi : le CGNAT

Un VPS a une IP publique dédiée. Une box internet grand public, non. Pire :
beaucoup de fournisseurs (Sosh et d'autres offres low-cost notamment)
utilisent le **CGNAT** (Carrier-Grade NAT) — votre box ne reçoit même pas
une IP publique à elle, elle en partage une avec d'autres abonnés en amont
chez l'opérateur. Dans ce cas, la redirection de port classique (ouvrir le
port 4567 dans la box) **ne fonctionne pas du tout**, quoi que vous
configuriez sur votre propre box : le trafic entrant n'atteint jamais votre
réseau.

**Comment savoir si vous êtes concerné** : comparez l'IP publique affichée
par votre box (interface d'administration) à celle que renvoie un site
comme `https://whatismyip.com` depuis un appareil connecté à cette box. Si
elles diffèrent, ou si votre fournisseur documente explicitement l'usage du
CGNAT sur votre offre, la redirection de port est à exclure — passez
directement à la section Cloudflare Tunnel ci-dessous.

## Solution recommandée : Cloudflare Tunnel

**Pourquoi** : `cloudflared` (l'agent Cloudflare) établit une connexion
**sortante** depuis le Raspberry Pi vers le réseau Cloudflare — aucun port à
ouvrir sur la box, donc **ça fonctionne même derrière un CGNAT**. Cloudflare
route ensuite le trafic HTTPS public vers cette connexion sortante. Gratuit,
pas de carte bancaire requise pour cet usage.

**Prérequis** : un nom de domaine dont les DNS sont gérés par Cloudflare
(le domaine lui-même peut être acheté n'importe où, il suffit de pointer ses
serveurs de noms vers Cloudflare — gratuit). Sans domaine, seul le mode
« quick tunnel » est disponible, qui génère une URL `*.trycloudflare.com`
**éphémère** (change à chaque redémarrage du tunnel) — utilisable pour un
test rapide, pas pour un usage durable partagé avec d'autres personnes.

### 1. Installer cloudflared sur le Raspberry Pi

```bash
# Raspberry Pi OS (Debian) — architecture arm64 (Pi 4/5) ou arm (Pi 3 et antérieurs)
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
```

### 2. Authentifier et créer un tunnel nommé (permanent)

```bash
cloudflared tunnel login          # ouvre un navigateur, choisissez votre domaine Cloudflare
cloudflared tunnel create etapeforge
cloudflared tunnel route dns etapeforge etapeforge.votre-domaine.fr
```

### 3. Router le tunnel vers le conteneur ÉtapeForge

```yaml
# ~/.cloudflared/config.yml
tunnel: etapeforge
credentials-file: /home/pi/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: etapeforge.votre-domaine.fr
    service: http://localhost:4567
  - service: http_status:404   # règle catch-all obligatoire, doit être en dernier
```

### 4. Lancer le tunnel en service permanent

```bash
sudo cloudflared --config /home/pi/.cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
```

Cloudflare gère lui-même le certificat HTTPS public — **pas besoin de
Caddy/reverse proxy local** ici, contrairement au VPS de
`DEPLOY-PUBLIC.md` : le TLS se termine chez Cloudflare, le trafic entre
Cloudflare et le Pi passe par le tunnel chiffré `cloudflared`. Le conteneur
ÉtapeForge tourne exactement comme en local (`docker compose up -d`, port
4567 sur `localhost` uniquement — pas de `0.0.0.0:4567`, le tunnel seul y
accède).

## Alternative : redirection de port + DDNS classique

**Seulement si vous n'êtes pas derrière un CGNAT** (voir le test ci-dessus).
Principe : votre FAI vous donne bien une IP publique (même si elle change
de temps en temps), un service DDNS (No-IP, DuckDNS, Cloudflare DDNS…) la
traduit en un nom de domaine stable, et vous redirigez le port 443 de la box
vers le Raspberry Pi. Plus classique, mais deux inconvénients par rapport
au tunnel : le port est réellement exposé sur Internet (surface d'attaque
plus grande — le pare-feu de la box devient votre seule protection), et
vous devez gérer vous-même le certificat HTTPS (Caddy, comme dans
`DEPLOY-PUBLIC.md`, fonctionne aussi ici). Non détaillé davantage ici : si
ce chemin vous concerne, suivez la section « HTTPS via reverse proxy » de
`DEPLOY-PUBLIC.md` en pointant le DNS vers votre IP dynamique via le
service DDNS choisi plutôt que vers une IP de VPS fixe.

## Spécificités matérielles du Raspberry Pi

- **Carte SD vs SSD USB** : une carte micro-SD s'use avec les écritures
  répétées (logs, base SQLite) — pour un usage durable, préférez un SSD USB
  (Raspberry Pi 4/5 démarrent nativement dessus) ou, a minima, montez
  `data/` sur un support externe plutôt que la carte SD système.
- **Coupures de courant** : contrairement à un VPS avec alimentation
  redondante, une coupure secteur chez vous peut survenir en pleine
  écriture. La sauvegarde automatique intégrée
  (`ETAPEFORGE_BACKUP_*`, voir [`SYNOLOGY.md`](./SYNOLOGY.md#sauvegarde))
  s'applique identiquement ici — activez-la, pointée vers un support
  physiquement distinct du disque système.
- **Puissance suffisante** : un Raspberry Pi 4 (4 Go de RAM minimum) fait
  tourner Node.js + SQLite sans souci pour un usage personnel/petit groupe ;
  un Pi 3 fonctionne mais avec des temps de génération d'étape plus longs.

## Dépannage

- **Le tunnel ne démarre pas** : `sudo systemctl status cloudflared` puis
  `sudo journalctl -u cloudflared -f` — l'erreur la plus fréquente est un
  chemin incorrect vers `credentials-file` dans `config.yml`.
- **`ERR_CONNECTION_REFUSED` malgré un tunnel actif** : vérifiez que le
  conteneur ÉtapeForge écoute bien sur `localhost:4567` sur le Pi
  (`curl http://localhost:4567/api/status` depuis le Pi lui-même).
- Pour tout le reste (comptes, cookies, quotas API), voir la section
  Dépannage de [`DEPLOY-PUBLIC.md`](./DEPLOY-PUBLIC.md#dépannage) — identique,
  le tunnel ne change rien une fois le trafic HTTPS arrivé sur le port 4567
  local.
