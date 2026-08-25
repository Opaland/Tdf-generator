'use strict';
// Rendu SVG des profils, style ASO/letour : silhouette sable lissée, annotations
// obliques des villes/cols à leur km réel, pastilles de catégorie, bande jaune
// kilométrique. Fichier partagé : frontend ET page HTML autonome exportée.
// Expose window.EFProfile (navigateur) — aucune dépendance.

(function (global) {
  // CAT_COLORS[4] (vert, pastille de catégorie de côte) : trois révisions
  // successives, chacune trouvée par une relecture différente.
  //  1. Original #3a9d4f : texte blanc dessus 3.43:1 < 4.5:1, échoue WCAG AA
  //     (trouvaille revue-personas, Sprint 4).
  //  2. Assombri #268038 pour corriger (1) : passe le contraste texte/fond,
  //     mais un assombrissement en ligne droite fait chuter sa luminance à
  //     0.161, quasi identique à celle du rouge cat.1 #d7263d (0.162) — sous
  //     protanopie/deutéranopie (rouge-vert), la teinte ne distingue plus
  //     rien, c'est la luminance qui portait toute l'information restante, et
  //     la resserrer annule ce qu'elle est censée transmettre (trouvaille
  //     relecture adverse, simulation CVD Machado/Oliveira/Fairchild).
  //  3. Éclairci #5cb85c pour corriger (2) (luminance 0.373, écart de +0.212
  //     avec le rouge) — mais cette éclaircie retombe quasi exactement sur la
  //     luminance de l'orange cat.2 #f08c00 (0.373 vs 0.373, écart 0.0005) :
  //     corriger l'écart avec le rouge a fermé l'écart avec l'orange, la
  //     paire cat.2/cat.4 étant elle-même une confusion CVD classique
  //     (trouvaille relecture adverse, ronde suivante — même bogue de
  //     méthode que (2), mesurer une seule paire à la fois plutôt que
  //     l'ensemble de la table).
  // Remplacé par #54d854, choisi par recherche exhaustive sur l'écart
  // MINIMAL de luminance avec les 4 AUTRES catégories simultanément (pas une
  // paire choisie à l'avance) : luminance 0.516, écart minimal +0.144 (vs
  // cat.2 et cat.3, les deux plus proches), +0.355 avec le rouge cat.1,
  // texte #333333 conservé (6.82:1, AA confortable). Verrouillé par
  // test/profileContrast.test.js (écart minimal inter-catégories, pas
  // seulement contraste texte/fond par paire — pour que ce défaut de méthode
  // ne se reproduise pas une 3e fois).
  const CAT_COLORS = { HC: '#111111', 1: '#d7263d', 2: '#f08c00', 3: '#f7d154', 4: '#54d854' };
  // CAT_TEXT[2]/GRAD_COLORS[1] (#f08c00) : texte blanc dessus ne passait pas
  // WCAG AA (2.48:1, sous le seuil 4.5:1 texte normal et même 3:1 grand
  // texte — trouvaille de revue-personas, Sprint 4). #f08c00 reste
  // inchangé (identité visuelle de la catégorie 2/bande 5-8 %), texte
  // assombri comme le fait déjà CAT_TEXT[3] sur le jaune #f7d154 — même
  // motif, pas une nouvelle couleur inventée. Vérifié par calcul :
  // #333333 sur #f08c00 = 5.09:1, #333333 sur #54d854 (cat.4) = 6.82:1.
  const CAT_TEXT = { HC: '#ffffff', 1: '#ffffff', 2: '#333333', 3: '#333333', 4: '#333333' };
  const GRAD_COLORS = [
    { max: 5, color: '#f7d154', text: '#333' },   // < 5 %
    { max: 8, color: '#f08c00', text: '#333' },   // 5–8 %
    { max: 10, color: '#d7263d', text: '#fff' },  // 8–10 %
    { max: Infinity, color: '#1a1a1a', text: '#fff' }, // > 10 %
  ];

  function gradStyle(g) {
    const a = Math.abs(g);
    for (const gc of GRAD_COLORS) if (a < gc.max) return gc;
    return GRAD_COLORS[GRAD_COLORS.length - 1];
  }

  /**
   * Couleur/texte d'une pastille de catégorie de côte — un seul endroit qui
   * connaît CAT_COLORS/CAT_TEXT et leur repli, pour que tout point de rendu
   * (renderProfileSVG, renderClimbSVG, renderRibbon3D, frontend/stage.js sur
   * la carte Leaflet) lise la même table plutôt que d'en recopier l'accès —
   * frontend/stage.js avait sa propre copie avec un texte fixe en dur avant
   * ce commit, voir CHANGELOG/DESIGN_SYSTEM.
   */
  function catStyle(cat) {
    return { color: CAT_COLORS[cat] || '#707070', text: CAT_TEXT[cat] || '#fff' };
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
   * Échelle px ↔ (distance, altitude) partagée par renderProfileSVG et
   * profileHoverAt — un seul endroit qui sait comment le profil est projeté,
   * pour que le curseur de survol tombe exactement sur la silhouette tracée.
   */
  function scaleFor(prof, W, H, mini) {
    const M = mini ? { l: 6, r: 6, t: 8, b: 14 } : { l: 48, r: 24, t: 64, b: 40 };
    const totalM = prof[prof.length - 1].d;
    const eles = prof.map((p) => p.e);
    const eMin = Math.floor(Math.min.apply(null, eles) / 100) * 100;
    const eMax = Math.max(Math.max.apply(null, eles) * 1.05, eMin + 300);
    return {
      M, totalM, eMin, eMax,
      x: (m) => M.l + (m / totalM) * (W - M.l - M.r),
      y: (e) => M.t + (1 - (e - eMin) / (eMax - eMin)) * (H - M.t - M.b),
    };
  }

  /**
   * Profil complet d'une étape.
   * @param data payload { stage, waypoints, climbs, kmAnalysis?:[{km, avg_gradient}], profile:[{d (m), e (lissé), r (brut)}] }
   * @param opts { width, height, mini }
   * @returns markup SVG (string)
   */
  function renderProfileSVG(data, opts) {
    opts = opts || {};
    const W = opts.width || 1000;
    const H = opts.height || 260;
    const mini = !!opts.mini;
    const prof = data.profile || [];
    if (!prof.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"></svg>`;

    const { M, totalM, eMin, eMax, x, y } = scaleFor(prof, W, H, mini);

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

    // Surlignage des sections > 10 % (inspiré Komoot, backlog issue #14) :
    // bande translucide sur toute la hauteur du profil pour chaque km dont
    // la pente moyenne dépasse 10 %, couleur reprise de gradStyle (même
    // code couleur que le profil zoomé d'une côte, renderClimbSVG) — pas de
    // nouvelle légende, la palette est déjà celle du reste de l'app.
    let steepBands = '';
    if (!mini && Array.isArray(data.kmAnalysis)) {
      const top = M.t;
      const base = y(eMin);
      for (const row of data.kmAnalysis) {
        const g = row.avg_gradient != null ? row.avg_gradient : row.avgGradient;
        if (g == null || Math.abs(g) < 10) continue;
        const fromM = (row.km - 1) * 1000;
        const toM = Math.min(row.km * 1000, totalM);
        const x0 = x(fromM);
        const x1 = x(toM);
        steepBands += `<rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(base - top).toFixed(1)}" fill="${gradStyle(g).color}" fill-opacity="0.16"/>`;
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
      const bonusPoints = []; // waypoints avec bonif., y compris ceux absorbés par une côte (arrivée au sommet)
      for (const w of data.waypoints || []) {
        // w.lon == null aussi : sinon `(prof[i].lon - w.lon) ** 2` coerce
        // silencieusement un lon manquant en 0 (arithmétique JS), faussant
        // le point le plus proche retenu plutôt que d'ignorer proprement ce
        // waypoint — même famille que CLAUDE.md règle 10.
        if (w.lat == null || w.lon == null) continue;
        // position le long du profil : point le plus proche géographiquement
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < prof.length; i++) {
          if (prof[i].lat == null) break;
          const d2 = (prof[i].lat - w.lat) ** 2 + (prof[i].lon - w.lon) ** 2;
          if (d2 < bd) { bd = d2; best = i; }
        }
        if (Array.isArray(w.bonus_sec) && w.bonus_sec.length) bonusPoints.push({ m: prof[best].d, bonus_sec: w.bonus_sec });
        const nearClimb = climbs.some((c) => Math.abs(c.end_km * 1000 - prof[best].d) < 1200 && (w.kind === 'col'));
        if (nearClimb) continue; // le sommet sera annoté par la côte
        const isSprint = w.kind === 'sprint';
        const bonusTxt = Array.isArray(w.bonus_sec) && w.bonus_sec.length ? ` — bonif. ${w.bonus_sec.join('/')}″` : '';
        labels.push({
          m: prof[best].d, e: prof[best].e,
          text: `${w.label} (${Math.round(prof[best].e)} m)${bonusTxt}`,
          priority: w.kind === 'start' || w.kind === 'finish' ? 2 : (isSprint ? 2.5 : 1),
          cat: null,
          sprint: isSprint,
        });
      }
      for (const c of climbs) {
        const bp = bonusPoints.find((b) => Math.abs(b.m - c.end_km * 1000) < 1200);
        const bonusTxt = bp ? ` — bonif. ${bp.bonus_sec.join('/')}″` : '';
        labels.push({
          m: c.end_km * 1000,
          e: c.summit_ele_m,
          text: `${c.name} (${c.summit_ele_m} m)${bonusTxt}`,
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
          const { color: cc, text: tc } = catStyle(l.cat);
          ann +=
            `<circle cx="${xx.toFixed(1)}" cy="${(yy - 6).toFixed(1)}" r="8" fill="${cc}" stroke="#fff" stroke-width="1.2"/>` +
            `<text x="${xx.toFixed(1)}" y="${(yy - 2.6).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="bold" fill="${tc}">${esc(l.cat)}</text>`;
        }
        if (l.sprint) {
          ann +=
            `<rect x="${(xx - 9).toFixed(1)}" y="${(yy - 15).toFixed(1)}" width="18" height="11" rx="2" fill="#1c6dd0" stroke="#fff" stroke-width="1.2"/>` +
            `<text x="${xx.toFixed(1)}" y="${(yy - 6.7).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="bold" fill="#fff">SPR</text>`;
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
      grid + silhouette + steepBands + band + ann +
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
    const { color: cc, text: tc } = catStyle(climb.category);
    out +=
      `<circle cx="${M.l + 10}" cy="18" r="11" fill="${cc}" stroke="#fff" stroke-width="1.5"/>` +
      `<text x="${M.l + 10}" y="22" text-anchor="middle" font-size="10.5" font-weight="bold" fill="${tc}">${esc(climb.category)}</text>` +
      `<text x="${M.l + 28}" y="22" font-size="13.5" font-weight="bold" fill="#222">${esc(climb.name)} — ${climb.length_km} km à ${climb.avg_gradient} % (max ${climb.max_gradient} %)</text>`;

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil de ${esc(climb.name)}">` +
      `<rect width="${W}" height="${H}" fill="#faf6ec"/>` + out + `</svg>`
    );
  }

  /**
   * Profil 3D « ruban » (inspiré des visualisations VeloViewer) : le tracé est
   * projeté en perspective oblique, extrudé verticalement selon l'altitude,
   * chaque tranche colorée par la pente locale. Entrée : profile [{d,e,lat,lon}].
   */
  function renderRibbon3D(data, opts) {
    opts = opts || {};
    const W = opts.width || 1040;
    const H = opts.height || 420;
    const rotation = opts.rotation || 0;  // rotation autour de la verticale (drag souris)
    const stretch = opts.stretch || 1;    // étirement vertical de l'altitude
    const prof = (data.profile || []).filter((p) => p.lat != null);
    if (prof.length < 3) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"></svg>`;

    // Coordonnées locales en mètres.
    const lat0 = prof.reduce((a, p) => a + p.lat, 0) / prof.length;
    const lon0 = prof.reduce((a, p) => a + p.lon, 0) / prof.length;
    const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
    const ky = 110540;
    let pts = prof.map((p) => ({
      x: (p.lon - lon0) * kx,
      y: (p.lat - lat0) * ky,
      e: p.e,
      d: p.d,
    }));

    // Orientation : axe principal du tracé à l'horizontale (ACP simplifiée).
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of pts) { sxx += p.x * p.x; sxy += p.x * p.y; syy += p.y * p.y; }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy) + rotation;
    const cos = Math.cos(-theta);
    const sin = Math.sin(-theta);
    pts = pts.map((p) => ({ ...p, x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));

    // Projection oblique : profondeur écrasée + cisaillement.
    const DEPTH = 0.42;   // écrasement de l'axe profondeur
    const SHEAR = 0.35;   // décalage horizontal par profondeur
    const eMin = Math.min.apply(null, pts.map((p) => p.e));
    const eMax = Math.max.apply(null, pts.map((p) => p.e));
    const eleScale = ((H * 0.34) / Math.max(200, eMax - eMin)) * stretch;

    const proj = pts.map((p) => ({
      px: p.x + p.y * SHEAR,
      py: -p.y * DEPTH,
      h: (p.e - eMin) * eleScale,
      depth: p.y,
      d: p.d,
      e: p.e,
    }));
    const minX = Math.min.apply(null, proj.map((p) => p.px));
    const maxX = Math.max.apply(null, proj.map((p) => p.px));
    const minY = Math.min.apply(null, proj.map((p) => p.py));
    const maxY = Math.max.apply(null, proj.map((p) => p.py));
    const pad = 40;
    const scale = Math.min((W - 2 * pad) / (maxX - minX || 1), (H * 0.5 - pad) / (maxY - minY || 1));
    const X = (p) => pad + (p.px - minX) * scale;
    const YBase = (p) => H - pad - (p.py - minY) * scale;

    // Tranches (murs verticaux) triées de l'arrière vers l'avant (peintre).
    const slices = [];
    for (let i = 1; i < proj.length; i++) {
      const a = proj[i - 1];
      const b = proj[i];
      const dd = b.d - a.d;
      const g = dd > 0 ? ((b.e - a.e) / dd) * 100 : 0;
      slices.push({ a, b, g, depth: (a.depth + b.depth) / 2 });
    }
    slices.sort((s, t) => t.depth - s.depth); // fond d'abord

    let walls = '';
    for (const s of slices) {
      const gs = gradStyle(s.g);
      const x0 = X(s.a).toFixed(1);
      const x1 = X(s.b).toFixed(1);
      const y0b = YBase(s.a).toFixed(1);
      const y1b = YBase(s.b).toFixed(1);
      const y0t = (YBase(s.a) - s.a.h).toFixed(1);
      const y1t = (YBase(s.b) - s.b.h).toFixed(1);
      const shade = s.g < 0 ? 0.55 : 0.9; // descentes assombries pour la lecture du relief
      walls +=
        `<path d="M ${x0} ${y0b} L ${x1} ${y1b} L ${x1} ${y1t} L ${x0} ${y0t} Z"` +
        ` fill="${gs.color}" fill-opacity="${shade}" stroke="#ffffff" stroke-width="0.4"/>`;
    }

    // Ligne de sol et ligne de crête.
    let ground = '';
    let ridge = '';
    for (let i = 0; i < proj.length; i++) {
      const p = proj[i];
      const cmd = i === 0 ? 'M' : 'L';
      ground += `${cmd} ${X(p).toFixed(1)} ${YBase(p).toFixed(1)} `;
      ridge += `${cmd} ${X(p).toFixed(1)} ${(YBase(p) - p.h).toFixed(1)} `;
    }

    // Marqueurs départ / arrivée / sommets des côtes.
    let marks = '';
    const at = (m) => {
      let best = proj[0];
      for (const p of proj) if (Math.abs(p.d - m) < Math.abs(best.d - m)) best = p;
      return best;
    };
    const start = proj[0];
    const end = proj[proj.length - 1];
    marks += `<circle cx="${X(start).toFixed(1)}" cy="${(YBase(start) - start.h).toFixed(1)}" r="5" fill="#2e8b57" stroke="#fff" stroke-width="1.5"/>`;
    marks += `<rect x="${(X(end) - 5).toFixed(1)}" y="${(YBase(end) - end.h - 5).toFixed(1)}" width="10" height="10" fill="#111" stroke="#fff" stroke-width="1.5"/>`;
    for (const c of data.climbs || []) {
      const p = at(c.end_km * 1000);
      const { color: cc, text: tc } = catStyle(c.category);
      const yTop = YBase(p) - p.h;
      marks +=
        `<line x1="${X(p).toFixed(1)}" y1="${yTop.toFixed(1)}" x2="${X(p).toFixed(1)}" y2="${(yTop - 16).toFixed(1)}" stroke="#555" stroke-width="1"/>` +
        `<circle cx="${X(p).toFixed(1)}" cy="${(yTop - 24).toFixed(1)}" r="9" fill="${cc}" stroke="#fff" stroke-width="1.5"/>` +
        `<text x="${X(p).toFixed(1)}" y="${(yTop - 20.5).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="bold" fill="${tc}">${esc(c.category)}</text>` +
        (X(p) > W - 170
          ? `<text x="${(X(p) - 12).toFixed(1)}" y="${(yTop - 28).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#333">${esc(c.name)} (${c.summit_ele_m} m)</text>`
          : `<text x="${(X(p) + 12).toFixed(1)}" y="${(yTop - 28).toFixed(1)}" font-size="10.5" fill="#333">${esc(c.name)} (${c.summit_ele_m} m)</text>`);
    }

    // Légende pente.
    let legend = '';
    const items = [['< 5 %', '#f7d154'], ['5–8 %', '#f08c00'], ['8–10 %', '#d7263d'], ['> 10 %', '#1a1a1a']];
    items.forEach(([label, color], i) => {
      legend +=
        `<rect x="${pad + i * 86}" y="14" width="13" height="13" fill="${color}"/>` +
        `<text x="${pad + i * 86 + 18}" y="25" font-size="11" fill="#444">${label}</text>`;
    });

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil 3D de l'étape">` +
      `<rect width="${W}" height="${H}" fill="#faf6ec"/>` +
      legend +
      `<path d="${ground}" fill="none" stroke="#c9bd9c" stroke-width="1" stroke-dasharray="4 4"/>` +
      walls +
      `<path d="${ridge}" fill="none" stroke="#333" stroke-width="1.1"/>` +
      marks +
      `</svg>`
    );
  }

  /**
   * Segment approximé (interpolation pied→sommet en ligne droite,
   * pipeline/routing.js) qui chevauche cette côte, s'il y en a un — backlog
   * issue #10, section C, "flag surface non goudonnée" : l'interpolation
   * lisse artificiellement la pente réelle sur ce tronçon, donc la pente
   * max affichée n'est plus fiable si elle recoupe un tel segment.
   * @param climb {start_km, end_km}
   * @param approxSegments [{fromM, toM, reason}]
   * @returns le segment chevauchant, ou undefined
   */
  function climbApproxOverlap(climb, approxSegments) {
    return (approxSegments || []).find(
      (seg) => climb.start_km * 1000 <= seg.toM && climb.end_km * 1000 >= seg.fromM
    );
  }

  /**
   * Point du profil le plus proche d'une abscisse en coordonnées SVG (mêmes
   * unités que le viewBox de renderProfileSVG) — sert à synchroniser un
   * survol du profil avec un marqueur sur la carte (backlog #10).
   * @param data même payload que renderProfileSVG
   * @param opts { width, height, mini } — DOIT correspondre à l'appel de renderProfileSVG
   * @param pxX abscisse du curseur, en unités du viewBox (pas en pixels écran bruts)
   * @returns { x, yTop, yBottom, yCurve, distM, ele, lat, lon } ou null si profil vide
   */
  function profileHoverAt(data, opts, pxX) {
    opts = opts || {};
    const W = opts.width || 1000;
    const H = opts.height || 260;
    const mini = !!opts.mini;
    const prof = data.profile || [];
    if (!prof.length) return null;
    const sc = scaleFor(prof, W, H, mini);
    const frac = (pxX - sc.M.l) / (W - sc.M.l - sc.M.r);
    const distM = Math.max(0, Math.min(sc.totalM, frac * sc.totalM));
    let best = prof[0];
    for (const p of prof) if (Math.abs(p.d - distM) < Math.abs(best.d - distM)) best = p;
    return {
      x: sc.x(best.d), yTop: sc.M.t, yBottom: sc.y(sc.eMin), yCurve: sc.y(best.e),
      distM: best.d, ele: best.e, lat: best.lat, lon: best.lon,
    };
  }

  /** Décime une liste en gardant ~n points (premier et dernier inclus). */
  function decimate(arr, n) {
    if (arr.length <= n) return arr;
    const out = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
    return out;
  }

  const EFProfile = { renderProfileSVG, renderClimbSVG, renderRibbon3D, decimate, niceStep, CAT_COLORS, CAT_TEXT, gradStyle, catStyle, climbApproxOverlap, profileHoverAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = EFProfile;
  global.EFProfile = EFProfile;
})(typeof window !== 'undefined' ? window : globalThis);
