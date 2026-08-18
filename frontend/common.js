'use strict';
// Utilitaires partagés du frontend : appels API, barre de navigation, attributions.

const EF = {
  async api(path, opts) {
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

  async initChrome(active) {
    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML =
      `<div class="logo">Étape<span>Forge</span></div>
       <nav>
         <a href="/" data-nav="editeur">Éditeur d'étape</a>
         <a href="/tour.html" data-nav="tour">Carte globale</a>
         <a href="/archives.html" data-nav="archives">Archives 1903→</a>
       </nav>
       <span class="offline-badge" id="offline-badge">mode hors-ligne — données simulées</span>`;
    document.body.prepend(header);
    const link = header.querySelector(`[data-nav="${active}"]`);
    if (link) link.classList.add('active');

    const footer = document.createElement('footer');
    footer.className = 'attrib';
    document.body.appendChild(footer);
    try {
      const st = await EF.api('/api/status');
      footer.textContent = st.attributions;
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
