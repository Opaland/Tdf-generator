# Connecter ÉtapeForge à Suunto

Deux façons d'importer vos sorties Suunto, de la plus simple à la plus confortable.

## Option A — Export GPX (2 minutes, recommandé pour commencer)

Aucune configuration. Dans l'**appli Suunto** sur votre téléphone :

1. Ouvrez la sortie → menu **⋯** → **Partager** → format **GPX** ;
2. Envoyez-vous le fichier (mail, AirDrop, Drive…) ;
3. Dans ÉtapeForge → **Mes traces** → glissez le fichier dans la zone de dépôt.

C'est tout : la sortie devient une étape complète (profil, cols détectés et
catégorisés, km par km, exports). Les altitudes du fichier sont utilisées
directement.

## Option B — Connexion directe (Suunto Cloud API)

Le confort en plus : votre liste de sorties s'affiche dans ÉtapeForge, import en
un clic. La contrainte : **Suunto exige d'enregistrer une « application »
développeur** (gratuite) pour accéder à l'API, même pour vos propres données.
C'est une manipulation unique d'environ 10 minutes.

> Votre compte Suunto normal (celui de l'appli) ne suffit pas — le portail
> développeur `apizone.suunto.com` est un compte séparé.

### Étape 1 — Créer le compte développeur

1. Allez sur **https://apizone.suunto.com** ;
2. **Sign up** (email + mot de passe, confirmation par email).

### Étape 2 — Enregistrer votre application

1. Une fois connecté, cherchez la page d'enregistrement d'application
   (menu **Applications** / **Register an app**, ou via la page
   [How to start](https://apizone.suunto.com/how-to-start) qui décrit le
   parcours à jour) ;
2. Donnez un nom (ex. `EtapeForge perso`) ;
3. **URL de redirection** (champ *redirect URI* / *callback URL*) — c'est le
   champ le plus important, copiez exactement :

   ```
   http://localhost:4567/api/suunto/callback
   ```

   (L'écran **Mes traces** d'ÉtapeForge affiche aussi cette URL.)
4. Notez le **Client ID** et le **Client Secret** affichés.

### Étape 3 — Obtenir la clé d'abonnement

Le portail est un « Azure API Management » : les clés d'API s'obtiennent en
souscrivant à un **produit** :

1. Menu **Products** → choisissez l'offre API (gratuite) → **Subscribe** ;
2. Votre clé apparaît dans **Profile** (deux clés, l'une ou l'autre convient).
   C'est la valeur appelée **Ocp-Apim-Subscription-Key**.

### Étape 4 — Brancher ÉtapeForge

1. `npm start` → http://localhost:4567/traces.html ;
2. Section **Connexion Suunto** : collez Client ID, Client Secret et clé
   d'abonnement → **Enregistrer** (tout reste dans votre base locale
   `data/etapeforge.sqlite`, rien ne part ailleurs) ;
3. **Se connecter à Suunto** → la page Suunto s'ouvre → autorisez avec votre
   compte **normal** (celui de l'appli) ;
4. Retour automatique sur ÉtapeForge : vos sorties sont listées, bouton
   **Importer** sur chacune.

Alternative sans passer par l'UI : variables d'environnement
`SUUNTO_CLIENT_ID`, `SUUNTO_CLIENT_SECRET`, `SUUNTO_SUBSCRIPTION_KEY`.

### En cas de problème

- Chaque erreur (OAuth ou API) est affichée **en clair** dans l'écran
  Mes traces — le message contient le code HTTP et la réponse du serveur ;
- « redirect_uri mismatch » → l'URL de redirection déclarée chez Suunto ne
  correspond pas exactement à `http://localhost:4567/api/suunto/callback`
  (port différent ? espace parasite ?) ;
- HTTP 401 sur la liste des sorties → clé d'abonnement manquante ou produit
  non souscrit (étape 3) ;
- Le détail du portail Suunto peut évoluer : la référence à jour est
  https://apizone.suunto.com/how-to-start.

### Ce qui est déjà testé côté ÉtapeForge

Le connecteur est couvert par un test d'intégration contre un serveur Suunto
simulé (échange OAuth avec Basic auth, en-têtes `Bearer` +
`Ocp-Apim-Subscription-Key`, décodage d'un fichier FIT binaire réel, détection
des côtes sur la trace importée) — voir `test/suunto.test.js`. Seul le
comportement du vrai serveur Suunto reste à confronter, d'où les messages
d'erreur détaillés.
