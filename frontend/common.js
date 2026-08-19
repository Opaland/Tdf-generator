'use strict';
// Utilitaires partagés du frontend : appels API, barre de navigation, attributions.

const EF = {
  async api(path, opts) {
    if (window.EF_STATIC) return EF.staticApi(path, opts);
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts && opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
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

  stateBadge(state) {
    const labels = { done: 'générée', generating: 'génération…', error: 'erreur', draft: 'brouillon' };
    return `<span class="badge ${state}">${labels[state] || state}</span>`;
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
    const user = await EF.requireAuthOrRedirect();

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
       <span class="offline-badge" id="offline-badge" title="mode hors-ligne — données simulées">mode hors-ligne — données simulées</span>
       ${user ? `<span class="user-badge" title="${EF.esc(user.email)}">${EF.esc(user.email)} · <a href="#" id="logout-link">déconnexion</a></span>` : ''}`;
    document.body.prepend(header);
    const link = header.querySelector(`[data-nav="${active}"]`);
    if (link) link.classList.add('active');
    const toggle = header.querySelector('#nav-toggle');
    toggle.addEventListener('click', () => {
      const open = header.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    const logout = header.querySelector('#logout-link');
    if (logout) logout.addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/login.html';
    });

    const footer = document.createElement('footer');
    footer.className = 'attrib';
    document.body.appendChild(footer);
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
