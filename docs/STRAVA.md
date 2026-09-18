# Connecter ÉtapeForge à Strava

Deux façons d'importer vos sorties Strava, de la plus simple à la plus confortable.

## Option A — Export GPX (2 minutes, recommandé pour commencer)

Aucune configuration. Sur le site ou l'appli **Strava** :

1. Ouvrez la sortie → menu **⋯** → **Exporter GPX** ;
2. Dans ÉtapeForge → **Mes traces** → glissez le fichier dans la zone de dépôt.

C'est tout : la sortie devient une étape complète (profil, cols détectés et
catégorisés, km par km, exports). Les altitudes du fichier GPX sont utilisées
directement ; en revanche un export GPX Strava ne porte pas d'horodatage par
point, donc les statistiques de vitesse de la sortie n'apparaîtront pas
(seule l'option B, ci-dessous, les calcule).

## Option B — Connexion directe (Strava API)

Le confort en plus : votre liste de sorties s'affiche dans ÉtapeForge, import
en un clic, avec durée et vitesses calculées. La contrainte : **Strava exige
d'enregistrer une « application »** (gratuite) pour accéder à l'API, même pour
vos propres données. C'est une manipulation unique de quelques minutes — pas
de compte séparé ni de clé d'abonnement à souscrire, contrairement à Suunto.

### Étape 1 — Enregistrer votre application

1. Allez sur **https://www.strava.com/settings/api** (connecté avec votre
   compte Strava normal) ;
2. Donnez un nom (ex. `EtapeForge perso`) et une catégorie (peu importe
   laquelle pour un usage personnel) ;
3. **Domaine de callback autorisé** — indiquez `localhost` ;
4. Notez le **Client ID** et le **Client Secret** affichés.

### Étape 2 — Brancher ÉtapeForge

1. `npm start` → http://localhost:4567/traces.html ;
2. Section **Connexion Strava** : collez Client ID et Client Secret →
   **Enregistrer** (tout reste dans votre base locale
   `data/etapeforge.sqlite`, rien ne part ailleurs) ;
3. **Se connecter à Strava** → la page Strava s'ouvre → autorisez l'accès
   (lecture des activités, y compris privées, pour ne pas filtrer
   silencieusement vos sorties marquées « Uniquement moi ») ;
4. Retour automatique sur ÉtapeForge : vos sorties sont listées, bouton
   **Importer** sur chacune.

Alternative sans passer par l'UI : variables d'environnement
`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`.

### En cas de problème

- Chaque erreur (OAuth ou API) est affichée **en clair** dans l'écran
  Mes traces — le message contient le code HTTP et la réponse du serveur ;
- « redirect_uri invalid » → le domaine de callback déclaré chez Strava
  (étape 1) ne couvre pas `localhost` ;
- Une sortie sans tracé GPS (ex. home trainer sans capteur GPS) échoue à
  l'import avec un message explicite plutôt qu'une étape vide.

### Ce qui est déjà testé côté ÉtapeForge

Le connecteur est couvert par un test d'intégration contre un serveur Strava
simulé (échange OAuth avec client_id/client_secret dans le corps de la
requête — pas de Basic auth, contrairement à Suunto — en-tête `Bearer`,
reconstruction du tracé depuis les flux `latlng`/`altitude`/`time`, détection
des côtes et calcul de vitesse sur la trace importée) — voir
`test/strava.test.js` et `test/stravaPointsFromStreams.test.js`. Seul le
comportement du vrai serveur Strava reste à confronter, d'où les messages
d'erreur détaillés.
