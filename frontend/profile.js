'use strict';
// Rendu SVG des profils, style ASO/letour : silhouette sable lissée, annotations
// obliques des villes/cols à leur km réel, pastilles de catégorie, bande jaune
// kilométrique. Fichier partagé : frontend ET page HTML autonome exportée.
// Expose window.EFProfile (navigateur) — aucune dépendance.

(function (global) {
  const CAT_COLORS = { HC: '#111111', 1: '#d7263d', 2: '#f08c00', 3: '#f7d154', 4: '#3a9d4f' };
  const CAT_TEXT = { HC: '#ffffff', 1: '#ffffff', 2: '#ffffff', 3: '#333333', 4: '#ffffff' };
  const GRAD_COLORS = [
    { max: 5, color: '#f7d154', text: '#333' },   // < 5 %
    { max: 8, color: '#f08c00', text: '#fff' },   // 5–8 %
    { max: 10, color: '#d7263d', text: '#fff' },  // 8–10 %
    { max: Infinity, color: '#1a1a1a', text: '#fff' }, // > 10 %
  ];

  function gradStyle(g) {
    const a = Math.abs(g);
    for (const gc of GRAD_COLORS) if (a < gc.max) return gc;
    return GRAD_COLORS[GRAD_COLORS.length - 1];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function niceStep(rangeKm) {
    if (rangeKm <= 30) return 5;
    if (rangeKm <= 80) return 10;
    if (rangeKm <= 200) return 25;
    return 50;
  }

  /**
   * Profil complet d'une étape.
   * @param data payload { stage, waypoints, climbs, profile:[{d (m), e (lissé), r (brut)}] }
   * @param opts { width, height, mini }
   * @returns markup SVG (string)
   */
  function renderProfileSVG(data, opts) {
    opts = opts || {};
    const W = opts.width || 1000;
    const H = opts.height || 260;
    const mini = !!opts.mini;
    const M = mini
      ? { l: 6, r: 6, t: 8, b: 14 }
      : { l: 48, r: 24, t: 64, b: 40 };
    const prof = data.profile || [];
    if (!prof.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"></svg>`;

    const totalM = prof[prof.length - 1].d;
    const eles = prof.map((p) => p.e);
    let eMin = Math.min.apply(null, eles);
    let eMax = Math.max.apply(null, eles);
    eMin = Math.floor(eMin / 100) * 100;
    eMax = Math.max(eMax * 1.05, eMin + 300);

    const x = (m) => M.l + (m / totalM) * (W - M.l - M.r);
    const y = (e) => M.t + (1 - (e - eMin) / (eMax - eMin)) * (H - M.t - M.b);

    // Silhouette sable.
    let path = `M ${x(prof[0].d).toFixed(1)} ${y(prof[0].e).toFixed(1)}`;
    for (let i = 1; i < prof.length; i++) path += ` L ${x(prof[i].d).toFixed(1)} ${y(prof[i].e).toFixed(1)}`;
    const silhouette =
      `<path d="${path} L ${x(totalM).toFixed(1)} ${y(eMin)} L ${x(0).toFixed(1)} ${y(eMin)} Z"` +
      ` fill="#ead9b0" stroke="none"/>` +
      `<path d="${path}" fill="none" stroke="#7a5c2e" stroke-width="${mini ? 1.2 : 2}"/>`;

    // Grille altitude.
    let grid = '';
    if (!mini) {
      const step = eMax - eMin > 1500 ? 500 : eMax - eMin > 600 ? 250 : 100;
      for (let e = eMin; e <= eMax; e += step) {
        grid +=
          `<line x1="${M.l}" y1="${y(e).toFixed(1)}" x2="${W - M.r}" y2="${y(e).toFixed(1)}" stroke="#d8cdb4" stroke-width="0.6" stroke-dasharray="3 4"/>` +
          `<text x="${M.l - 6}" y="${(y(e) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#8a7a58">${e}</text>`;
      }
    }

    // Bande jaune kilométrique.
    const bandY = y(eMin);
    const bandH = mini ? 8 : 20;
    let band = `<rect x="${M.l}" y="${bandY}" width="${W - M.l - M.r}" height="${bandH}" fill="#ffd320" stroke="#c9a400" stroke-width="0.5"/>`;
    const stepKm = niceStep(totalM / 1000);
    for (let km = 0; km <= totalM / 1000; km += stepKm) {
      const xx = x(km * 1000);
      band += `<line x1="${xx.toFixed(1)}" y1="${bandY}" x2="${xx.toFixed(1)}" y2="${bandY + bandH}" stroke="#a08300" stroke-width="0.7"/>`;
      if (!mini) band += `<text x="${xx.toFixed(1)}" y="${bandY + bandH + 12}" text-anchor="middle" font-size="10" fill="#555">${km}</text>`;
    }

    // Annotations : départ/arrivée/vias + sommets des côtes (pastille catégorie).
    let ann = '';
    if (!mini) {
      const climbs = data.climbs || [];
      const labels = [];
      for (const w of data.waypoints || []) {
        if (w.lat == null) continue;
        // position le long du profil : point le plus proche géographiquement
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < prof.length; i++) {
          if (prof[i].lat == null) break;
          const d2 = (prof[i].lat - w.lat) ** 2 + (prof[i].lon - w.lon) ** 2;
          if (d2 < bd) { bd = d2; best = i; }
        }
        const nearClimb = climbs.some((c) => Math.abs(c.end_km * 1000 - prof[best].d) < 1200 && (w.kind === 'col'));
        if (nearClimb) continue; // le sommet sera annoté par la côte
        labels.push({
          m: prof[best].d, e: prof[best].e,
          text: `${w.label} (${Math.round(prof[best].e)} m)`,
          priority: w.kind === 'start' || w.kind === 'finish' ? 2 : 1,
          cat: null,
        });
      }
      for (const c of climbs) {
        labels.push({
          m: c.end_km * 1000,
          e: c.summit_ele_m,
          text: `${c.name} (${c.summit_ele_m} m)`,
          priority: 3,
          cat: c.category,
        });
      }
      labels.sort((a, b) => a.m - b.m);
      // anti-collision : priorité aux cols, puis départ/arrivée
      const kept = [];
      for (const l of labels.sort((a, b) => b.priority - a.priority)) {
        if (kept.some((k) => Math.abs(x(k.m) - x(l.m)) < 26 && l.priority < 3)) continue;
        kept.push(l);
      }
      for (const l of kept) {
        const xx = x(l.m);
        const yy = y(l.e);
        ann +=
          `<line x1="${xx.toFixed(1)}" y1="${yy.toFixed(1)}" x2="${xx.toFixed(1)}" y2="${(yy - 10).toFixed(1)}" stroke="#666" stroke-width="0.8"/>` +
          `<text transform="translate(${(xx + 3).toFixed(1)} ${(yy - 13).toFixed(1)}) rotate(-38)" font-size="10.5" fill="#333">${esc(l.text)}</text>`;
        if (l.cat) {
          const cc = CAT_COLORS[l.cat] || '#999';
          const tc = CAT_TEXT[l.cat] || '#fff';
          ann +=
            `<circle cx="${xx.toFixed(1)}" cy="${(yy - 6).toFixed(1)}" r="8" fill="${cc}" stroke="#fff" stroke-width="1.2"/>` +
            `<text x="${xx.toFixed(1)}" y="${(yy - 2.6).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="bold" fill="${tc}">${esc(l.cat)}</text>`;
        }
      }
      // Encart distance / D+
      const st = data.stage || {};
      const dist = st.generated_distance_km != null ? st.generated_distance_km : Math.round(totalM / 100) / 10;
      ann +=
        `<text x="${W - M.r}" y="16" text-anchor="end" font-size="13" font-weight="bold" fill="#222">${dist} km — D+ ${st.total_ascent_m != null ? st.total_ascent_m : '?'} m</text>`;
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil de l'étape">` +
      `<rect x="0" y="0" width="${W}" height="${H}" fill="#faf6ec"/>` +
      grid + silhouette + band + ann +
      `</svg>`
    );
  }

  /**
   * Profil zoomé d'une côte, découpé en blocs de 1 km colorés par pente
   * (jaune < 5 %, orange 5–8 %, rouge 8–10 %, noir > 10 %), % sur chaque bloc —
   * rendu type profil de col ASO.
   */
  function renderClimbSVG(climb, opts) {
    opts = opts || {};
    const W = opts.width || 760;
    const H = opts.height || 300;
    const M = { l: 46, r: 30, t: 46, b: 34 };
    const blocks = climb.km_blocks || [];
    if (!blocks.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"></svg>`;

    const m0 = blocks[0].fromM;
    const m1 = blocks[blocks.length - 1].toM;
    const eMin = Math.floor(Math.min(climb.start_ele_m, blocks[0].ele0) / 50) * 50 - 30;
    const eMax = Math.max(climb.summit_ele_m, blocks[blocks.length - 1].ele1) + 60;

    const x = (m) => M.l + ((m - m0) / (m1 - m0)) * (W - M.l - M.r);
    const y = (e) => M.t + (1 - (e - eMin) / (eMax - eMin)) * (H - M.t - M.b);

    let out = '';
    // Blocs trapézoïdaux.
    for (const b of blocks) {
      const gs = gradStyle(b.gradient);
      const x0 = x(b.fromM);
      const x1 = x(b.toM);
      out +=
        `<path d="M ${x0.toFixed(1)} ${y(b.ele0).toFixed(1)} L ${x1.toFixed(1)} ${y(b.ele1).toFixed(1)}` +
        ` L ${x1.toFixed(1)} ${y(eMin)} L ${x0.toFixed(1)} ${y(eMin)} Z"` +
        ` fill="${gs.color}" stroke="#ffffff" stroke-width="1"/>`;
      // % au centre du bloc
      const cx = (x0 + x1) / 2;
      const cy = (y(b.ele0) + y(b.ele1)) / 2 + (y(eMin) - (y(b.ele0) + y(b.ele1)) / 2) / 2;
      out += `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" font-size="12" font-weight="bold" fill="${gs.text}">${b.gradient.toFixed(1)}%</text>`;
      // altitude aux ruptures de km, le long de la pente
      out += `<text x="${x0.toFixed(1)}" y="${(y(b.ele0) - 5).toFixed(1)}" text-anchor="middle" font-size="9" fill="#555">${b.ele0}</text>`;
    }
    const last = blocks[blocks.length - 1];
    out += `<text x="${x(last.toM).toFixed(1)}" y="${(y(last.ele1) - 8).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="bold" fill="#222">${climb.summit_ele_m} m</text>`;

    // Ligne de crête.
    let ridge = `M ${x(blocks[0].fromM).toFixed(1)} ${y(blocks[0].ele0).toFixed(1)}`;
    for (const b of blocks) ridge += ` L ${x(b.toM).toFixed(1)} ${y(b.ele1).toFixed(1)}`;
    out += `<path d="${ridge}" fill="none" stroke="#333" stroke-width="1.4"/>`;

    // Axe km (0 → longueur).
    for (let i = 0; i <= blocks.length; i++) {
      const m = m0 + i * 1000;
      if (m > m1 + 1) break;
      const xx = x(Math.min(m, m1));
      out +=
        `<line x1="${xx.toFixed(1)}" y1="${y(eMin)}" x2="${xx.toFixed(1)}" y2="${y(eMin) + 5}" stroke="#666"/>` +
        `<text x="${xx.toFixed(1)}" y="${y(eMin) + 17}" text-anchor="middle" font-size="9.5" fill="#555">${i}</text>`;
    }
    out += `<text x="${W - M.r}" y="${H - 4}" text-anchor="end" font-size="10" fill="#777">km depuis le pied de la côte</text>`;

    // Titre avec pastille catégorie.
    const cc = CAT_COLORS[climb.category] || '#999';
    const tc = CAT_TEXT[climb.category] || '#fff';
    out +=
      `<circle cx="${M.l + 10}" cy="18" r="11" fill="${cc}" stroke="#fff" stroke-width="1.5"/>` +
      `<text x="${M.l + 10}" y="22" text-anchor="middle" font-size="10.5" font-weight="bold" fill="${tc}">${esc(climb.category)}</text>` +
      `<text x="${M.l + 28}" y="22" font-size="13.5" font-weight="bold" fill="#222">${esc(climb.name)} — ${climb.length_km} km à ${climb.avg_gradient} % (max ${climb.max_gradient} %)</text>`;

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil de ${esc(climb.name)}">` +
      `<rect width="${W}" height="${H}" fill="#faf6ec"/>` + out + `</svg>`
    );
  }

  const EFProfile = { renderProfileSVG, renderClimbSVG, CAT_COLORS, CAT_TEXT, gradStyle };
  if (typeof module !== 'undefined' && module.exports) module.exports = EFProfile;
  global.EFProfile = EFProfile;
})(typeof window !== 'undefined' ? window : globalThis);
