'use strict';
// Utilitaires partagés du frontend : appels API, barre de navigation, attributions.

const EF = {
  // Délai par défaut avant abandon d'un appel qui ne répond pas — sans lui,
  // un serveur planté/injoignable en cours de requête laissait l'appelant
  // en attente indéfiniment (bouton bloqué sur « … », aucune erreur jamais
  // affichée). Dépassable par appel (`timeoutMs`) pour les routes qui font
  // elles-mêmes un aller-retour réseau externe plus long (import d'édition,
  // import par lien) — voir leurs appels dans archives.js/traces.js.
  DEFAULT_TIMEOUT_MS: 20000,

  async api(path, opts) {
    if (window.EF_STATIC) return EF.staticApi(path, opts);
    const { timeoutMs = EF.DEFAULT_TIMEOUT_MS, ...fetchOpts } = opts || {};
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...fetchOpts,
        body: fetchOpts.body != null ? JSON.stringify(fetchOpts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Le serveur ne répond pas (délai de ${Math.round(timeoutMs / 1000)} s dépassé)`, { cause: err });
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* texte brut */ }
      throw new Error(msg);
    }
    return res.json();
  },

  // Mode « démo statique » (GitHub Pages) : les lectures sont servies par des
  // fichiers JSON pré-générés dans data/ ; toute écriture est refusée.
  STATIC_MSG:
    'Démo statique (GitHub Pages) en lecture seule — pour créer et générer vos ' +
    'propres étapes : git clone puis « npm install && npm run demo && npm start ».',
  async staticApi(path, opts) {
    if (opts && opts.method && opts.method.toUpperCase() !== 'GET') {
      throw new Error(EF.STATIC_MSG);
    }
    const p = String(path).replace(/^\//, '').split('?')[0];
    let m;
    let file = null;
    if (p === 'api/status') file = 'data/status.json';
    else if (p === 'api/stages') file = 'data/stages.json';
    else if ((m = p.match(/^api\/stages\/(\d+)(\/export\.json)?$/))) file = `data/stage-${m[1]}.json`;
    else if (p === 'api/editions') file = 'data/editions.json';
    else if ((m = p.match(/^api\/editions\/(\d+)\/mapdata$/))) file = `data/mapdata-${m[1]}.json`;
    else if ((m = p.match(/^api\/editions\/(\d+)$/))) file = `data/edition-${m[1]}.json`;
    else if (p === 'api/climbs') file = 'data/climbs.json';
    if (!file) throw new Error(EF.STATIC_MSG);
    const res = await fetch(file);
    if (!res.ok) throw new Error(`Donnée statique manquante (${file})`);
    return res.json();
  },

  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  qs(name) {
    return new URLSearchParams(location.search).get(name);
  },

  typeColors: {
    plaine: '#2e8b57',
    'accidentée': '#e67e22',
    montagne: '#c0392b',
    clm: '#2980b9',
    'clm par équipes': '#8e44ad',
  },
  typeColor(t) { return EF.typeColors[t] || '#555'; },

  // checks (optionnel) : bloc d'audits qualité de l'étape (stages.checks).
  // Une étape à l'état "done" dont au moins un audit est en échec
  // (checks.ok === false — ex. distance reconstituée à -100 % de
  // l'officielle) affichait pourtant le même badge vert "générée" qu'une
  // étape saine, dans le tableau de l'éditeur ET dans Archives : rien ne
  // distinguait visuellement "généré avec succès" de "généré mais
  // fondamentalement cassé" sans ouvrir chaque fiche individuellement
  // (trouvaille de revue-personas, persona chef de projet). checks.ok
  // (pipeline/checks.js) ignore volontairement les simples 'warn' (déjà des
  // tolérances acceptées ailleurs dans l'appli, ex. segments approximés) —
  // seul un vrai 'fail' change le badge, pas n'importe quelle réserve.
  stateBadge(state, checks) {
    const labels = { done: 'générée', generating: 'génération…', error: 'erreur', draft: 'brouillon' };
    if (state === 'done' && checks && checks.ok === false) {
      return `<span class="badge done-checkfail" title="au moins un audit qualité en échec — voir la fiche étape">générée ⚠</span>`;
    }
    return `<span class="badge ${state}">${labels[state] || state}</span>`;
  },

  // Écart en % entre distance reconstituée et distance officielle (fiche
  // étape, archives, carte globale) — même formule réécrite indépendamment
  // dans 4 endroits (trouvaille de sprint dédié). null si l'une des deux
  // valeurs manque (rien à comparer), jamais NaN.
  distanceDelta(officialKm, generatedKm) {
    if (!officialKm || !generatedKm) return null;
    return ((generatedKm - officialKm) / officialKm) * 100;
  },
  // "+X.X %" / "-X.X %" — même gabarit d'affichage répété à chaque site
  // qui utilise distanceDelta().
  formatDelta(delta) {
    return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} %`;
  },

  // Fonds de carte : IGN PLANIGNV2 (WMTS Géoplateforme) en France, OSM sinon.
  ignLayer() {
    return L.tileLayer(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
        '&LAYER=PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png' +
        '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      { attribution: '© IGN/Géoplateforme', maxZoom: 18 }
    );
  },
  osmLayer() {
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    });
  },
  inFrance(lat, lon) {
    return lat >= 41 && lat <= 51.5 && lon >= -5.5 && lon <= 10;
  },
  baseLayerFor(lat, lon) {
    return EF.inFrance(lat, lon) ? EF.ignLayer() : EF.osmLayer();
  },

  // Redirige vers /login.html si le serveur exige un compte (ETAPEFORGE_PUBLIC=1)
  // et qu'aucune session valide n'est présente. Retourne l'utilisateur connecté
  // (ou null si l'auth n'est pas activée).
  async requireAuthOrRedirect() {
    if (window.EF_STATIC) return null; // démo GitHub Pages : jamais de mur d'accès
    let status;
    try { status = await (await fetch('/api/status')).json(); } catch { return null; }
    if (!status.authRequired) return null;
    const res = await fetch('/api/auth/me');
    if (res.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      return new Promise(() => {}); // ne résout jamais : la redirection est en cours
    }
    return res.json();
  },

  async initChrome(active) {
    // La nav ne dépend d'aucun appel réseau (les liens sont statiques) — on
    // la construit et l'insère en tout premier, avant tout `await`, pour
    // qu'elle s'affiche sans attendre la vérification d'auth ni le statut
    // hors-ligne. Avant ce découplage, chaque page passait par 1-2
    // aller-retours réseau (statut, puis éventuellement session) avant que
    // la moindre nav apparaisse — un flash « page sans en-tête » à chaque
    // chargement, plus visible sur un lien lent (issue #21).
    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML =
      `<div class="logo">Étape<span>Forge</span></div>
       <button class="nav-toggle" id="nav-toggle" type="button" aria-label="Menu" aria-expanded="false">☰</button>
       <nav>
         <a href="/" data-nav="editeur">Éditeur d'étape</a>
         <a href="/tour.html" data-nav="tour">Carte globale</a>
         <a href="/cols.html" data-nav="cols">Cols</a>
         <a href="/compare.html" data-nav="compare">Comparer</a>
         <a href="/traces.html" data-nav="traces">Mes traces</a>
         <a href="/archives.html" data-nav="archives">Archives 1903→</a>
       </nav>
       <span class="offline-badge" id="offline-badge" title="mode hors-ligne — données simulées">mode hors-ligne — données simulées</span>`;
    document.body.prepend(header);
    const link = header.querySelector(`[data-nav="${active}"]`);
    if (link) link.classList.add('active');
    const toggle = header.querySelector('#nav-toggle');
    toggle.addEventListener('click', () => {
      const open = header.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    const footer = document.createElement('footer');
    footer.className = 'attrib';
    document.body.appendChild(footer);

    // Dynamique (dépend d'un appel réseau) : ajouté après coup, sans bloquer
    // l'affichage de la nav ci-dessus.
    const user = await EF.requireAuthOrRedirect();
    if (user) {
      const badge = document.createElement('span');
      badge.className = 'user-badge';
      badge.title = user.email;
      badge.innerHTML = `${EF.esc(user.email)} · <a href="#" id="logout-link">déconnexion</a>`;
      header.appendChild(badge);
      badge.querySelector('#logout-link').addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST' });
        location.href = '/login.html';
      });
    }

    try {
      const st = await EF.api('/api/status');
      if (window.EF_STATIC) {
        const note = document.createElement('div');
        note.className = 'note';
        note.style.margin = '10px 20px';
        note.innerHTML =
          `🌐 <b>Démo interactive statique</b> (GitHub Pages${st.offline
            ? ', données simulées hors-ligne'
            : ' — tracés réels OSRM/OpenStreetMap, altimétrie réelle IGN, pré-générés à la publication'}). ` +
          `La création et la génération d'étapes nécessitent la version locale : ` +
          `<code>git clone https://github.com/Opaland/Tdf-generator && npm install && npm run demo && npm start</code>`;
        header.after(note);
      }
      footer.innerHTML = window.EF_STATIC
        ? `${EF.esc(st.attributions)} · <a href="https://github.com/Opaland/Tdf-generator">code source (MIT)</a>`
        : `${EF.esc(st.attributions)} · <a href="/diag.html">diagnostic APIs</a>`;
      if (st.offline) document.getElementById('offline-badge').style.display = 'inline-block';
      EF.status = st;
    } catch {
      footer.textContent = 'ÉtapeForge';
    }
  },

  /**
   * Confirmation par double-clic sur un bouton, plutôt qu'un confirm() natif
   * non stylable et incohérent avec le reste de l'app (voir PR #24). Premier
   * clic : arme le bouton (texte + titre de confirmation) pendant `armedMs`,
   * revient à l'état initial si rien ne se passe. Second clic dans ce délai :
   * exécute `onConfirm`. Retourne un gestionnaire prêt pour addEventListener.
   */
  confirmClick(btn, { confirmText = 'confirmer ?', confirmTitle = 'Cliquer à nouveau pour confirmer', confirmAriaLabel, armedMs = 3000, onConfirm }) {
    const originalText = btn.textContent;
    const originalTitle = btn.title;
    // aria-label prime sur title dans le calcul du nom accessible : si le
    // bouton a un aria-label, la seule bascule de title/textContent laisse
    // un lecteur d'écran annoncer l'ancien libellé (« Supprimer l'étape X »)
    // pendant l'état armé — trouvaille de la vérification manuelle en
    // ajoutant l'aria-label sur les boutons-icônes (issue #20).
    const hasAriaLabel = btn.hasAttribute('aria-label');
    const originalAriaLabel = btn.getAttribute('aria-label');
    return async () => {
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = confirmText;
        btn.title = confirmTitle;
        if (hasAriaLabel) btn.setAttribute('aria-label', confirmAriaLabel || confirmTitle);
        clearTimeout(Number(btn.dataset.timer) || 0);
        btn.dataset.timer = setTimeout(() => {
          btn.dataset.armed = '0';
          btn.textContent = originalText;
          btn.title = originalTitle;
          if (hasAriaLabel) btn.setAttribute('aria-label', originalAriaLabel);
        }, armedMs);
        return;
      }
      clearTimeout(Number(btn.dataset.timer) || 0);
      btn.dataset.armed = '0';
      await onConfirm();
    };
  },

  downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  /** Export PNG d'un élément SVG (rendu → canvas → téléchargement). */
  svgToPng(svgEl, filename, scale) {
    const xml = new XMLSerializer().serializeToString(svgEl);
    const vb = svgEl.viewBox.baseVal;
    const w = (vb && vb.width) || svgEl.clientWidth || 1000;
    const h = (vb && vb.height) || svgEl.clientHeight || 300;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const k = scale || 2;
      canvas.width = w * k;
      canvas.height = h * k;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#faf6ec';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.src = url;
  },
};

// EF require()-able côté test (stateBadge, testé directement — voir
// test/stateBadgeCheckFail.test.js) grâce à la garde `typeof module`, même
// schéma que stage.js/compare.js/editor.js/archives.js. Aucune référence à
// document/window en dehors des méthodes elles-mêmes (appelées à la
// demande, jamais au chargement du module) : sûr à charger tel quel côté
// navigateur comme côté Node.
if (typeof module !== 'undefined' && module.exports) module.exports = EF;
