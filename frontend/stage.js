'use strict';
// Écran 2 : fiche d'étape — profil SVG style ASO, côte par côte, km par km,
// mini-carte (IGN PLANIGNV2 en France / OSM sinon), exports JSON/GPX/PNG/CSV.

const stageId = EF.qs('id');
let FULL = null;
let kmSortKey = 'km';
let kmSortAsc = true;

const decimate = (arr, n) => EFProfile.decimate(arr, n);

function toPayload(full) {
  return {
    stage: full.stage,
    waypoints: full.waypoints,
    climbs: full.climbs,
    kmAnalysis: full.kmAnalysis,
    profile: decimate(full.samples, 900).map((s) => ({
      d: s.dist_m, e: s.ele_smooth_m, r: s.ele_raw_m, lat: s.lat, lon: s.lon,
    })),
  };
}

async function poll() {
  const full = await EF.api(`/api/stages/${stageId}`);
  const st = full.stage;
  if (st.state === 'done') { FULL = full; renderFiche(); loadSimilarStages(); return; }
  if (st.state === 'error') {
    document.getElementById('pg-title').textContent = 'Échec de la génération';
    document.getElementById('pg-detail').textContent = st.error || 'erreur inconnue';
    return;
  }
  if (st.state === 'draft' && !poll.started) {
    // fiche ouverte sur un brouillon : lancer la génération
    poll.started = true;
    await EF.api(`/api/stages/${stageId}/generate`, { method: 'POST' });
  }
  const p = st.progress || {};
  document.getElementById('pg-title').textContent = `Génération : ${st.name}`;
  document.getElementById('pg-detail').textContent = `${p.step || ''} — ${p.detail || ''}`;
  document.getElementById('pg-bar').style.width = (p.percent || 0) + '%';
  setTimeout(poll, 900);
}

function sampleAt(m) {
  const s = FULL.samples;
  let best = s[0];
  for (const p of s) if (Math.abs(p.dist_m - m) < Math.abs(best.dist_m - m)) best = p;
  return best;
}

// Profil ↔ carte synchronisés (backlog #10) : survoler le profil déplace un
// marqueur sur la carte, au point du tracé le plus proche. opts DOIT
// correspondre exactement à l'appel de renderProfileSVG (même width/height)
// pour que le curseur tombe pile sur la silhouette dessinée.
const PROFILE_OPTS = { width: 1080, height: 300 };
function setupProfileMapHover(payload, map) {
  const svg = document.querySelector('#profile-box svg');
  if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const guide = document.createElementNS(NS, 'g');
  guide.setAttribute('id', 'hover-guide');
  guide.style.display = 'none';
  guide.style.pointerEvents = 'none';
  guide.innerHTML =
    '<line id="hg-line" stroke="#1c6dd0" stroke-width="1.4" stroke-dasharray="3 3"/>' +
    '<circle id="hg-dot" r="4.5" fill="#1c6dd0" stroke="#fff" stroke-width="1.5"/>';
  svg.appendChild(guide);
  const line = guide.querySelector('#hg-line');
  const dot = guide.querySelector('#hg-dot');
  const marker = L.circleMarker([0, 0], { radius: 7, color: '#1c6dd0', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false });

  const move = (e) => {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const px = ((e.clientX - rect.left) / rect.width) * vb.width;
    const pt = EFProfile.profileHoverAt(payload, PROFILE_OPTS, px);
    if (!pt || pt.lat == null) return;
    guide.style.display = '';
    line.setAttribute('x1', pt.x); line.setAttribute('x2', pt.x);
    line.setAttribute('y1', pt.yTop); line.setAttribute('y2', pt.yBottom);
    dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.yCurve);
    marker.setLatLng([pt.lat, pt.lon]);
    if (!map.hasLayer(marker)) marker.addTo(map);
  };
  const leave = () => {
    guide.style.display = 'none';
    if (map.hasLayer(marker)) map.removeLayer(marker);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', leave);
  // pointercancel (ex. un balayage tactile repris par le navigateur pour le
  // scroll de page, sans pointerleave) : sans ce filet, le marqueur pourrait
  // rester affiché sur la carte après un survol tactile interrompu.
  svg.addEventListener('pointercancel', leave);
}

function renderFiche() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('fiche').style.display = 'block';
  const st = FULL.stage;
  document.title = `ÉtapeForge — ${st.name}`;
  document.getElementById('st-name').textContent = st.name;

  const meta = [
    st.date, st.stage_type, st.status,
    `${st.generated_distance_km} km`, `D+ ${st.total_ascent_m} m`,
    FULL.edition ? FULL.edition.name : null,
    FULL.track ? `routage : ${FULL.track.router}` : null,
  ].filter(Boolean).join(' · ');
  document.getElementById('st-meta').textContent = meta;

  // Bandeau reconstruction historique.
  if (st.official_distance_km) {
    const delta = ((st.generated_distance_km - st.official_distance_km) / st.official_distance_km) * 100;
    document.getElementById('st-reconstruction').innerHTML =
      `<div class="reconstruction">Tracé <b>reconstitué sur le réseau routier actuel</b> — ` +
      `distance officielle ${FULL.edition && FULL.edition.year ? FULL.edition.year : ''} : ` +
      `<b>${st.official_distance_km} km</b> / reconstitution : <b>${st.generated_distance_km} km</b> ` +
      `(écart ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} %)</div>`;
  }

  // Profil 2D + profil 3D interactif (rotation à la souris, relief étirable —
  // visualisation inspirée des profils 3D VeloViewer).
  const payload = toPayload(FULL);
  document.getElementById('profile-box').innerHTML = EFProfile.renderProfileSVG(payload, PROFILE_OPTS);
  setup3D(payload);

  // Checks.
  const ul = document.getElementById('checks');
  ul.innerHTML = '';
  const checks = st.checks || { items: [] };
  for (const item of checks.items) {
    const li = document.createElement('li');
    li.className = item.status;
    li.innerHTML = `<span class="st">${item.status === 'ok' ? '✓' : item.status === 'warn' ? '⚠' : '✗'}</span>` +
      `<b>${EF.esc(item.label)}</b> — ${EF.esc(item.detail)}`;
    ul.appendChild(li);
  }
  if (checks.offline) {
    const li = document.createElement('li');
    li.className = 'warn';
    li.innerHTML = `<span class="st">⚠</span><b>Mode hors-ligne</b> — étape générée avec le simulateur (données synthétiques).`;
    ul.appendChild(li);
  }

  // Indice de pénibilité cumulée (backlog #10, section C) : heuristique
  // documentée (pas une reconstruction du score propriétaire VeloViewer) —
  // affichée seulement une fois l'étape générée (climbs/D+ connus).
  const pain = FULL.pain;
  document.getElementById('pain-section').style.display = pain ? 'block' : 'none';
  if (pain) {
    document.getElementById('pain-summary').textContent = `${pain.score} points`;
    const streakText = pain.mountainStreak > 1
      ? ` · ${pain.mountainStreak}ᵉ jour de montagne consécutif de l'édition → fatigue ×${pain.fatigueFactor}`
      : '';
    document.getElementById('pain-detail').textContent =
      `côtes catégorisées : ${pain.climbScore} pts · D+ (${st.total_ascent_m} m) : ${pain.ascentContribution} pts${streakText} ` +
      `— heuristique maison (D+ pondéré par catégorie de côte + fatigue des jours de montagne consécutifs), pas une reconstruction du score VeloViewer.`;
  }

  // Réserves de confiance (backlog #10, section A/D) : affirmations à
  // confiance structurée portées par historic_routes.json pour cette étape
  // précise (ex. altitude non confirmée sur le roadbook) — absent = aucune
  // réserve connue, pas une affirmation « tout est vérifié à 100 % ».
  const CONFIDENCE_ICON = { OK: '✓', UNSURE: '⚠', FIX: '✗' };
  const CONFIDENCE_CLASS = { OK: 'ok', UNSURE: 'warn', FIX: 'fail' };
  const confidence = FULL.confidence || [];
  document.getElementById('confidence-section').style.display = confidence.length ? 'block' : 'none';
  const confList = document.getElementById('confidence-list');
  confList.innerHTML = '';
  for (const c of confidence) {
    const li = document.createElement('li');
    li.className = CONFIDENCE_CLASS[c.status] || 'warn';
    li.innerHTML = `<span class="st">${CONFIDENCE_ICON[c.status] || '⚠'}</span>` +
      `<b>${EF.esc(c.claim)}</b> — confiance ${EF.esc(c.level)}${c.detail ? ` · ${EF.esc(c.detail)}` : ''}`;
    confList.appendChild(li);
  }

  // Côte par côte.
  const climbsBox = document.getElementById('climbs');
  climbsBox.innerHTML = FULL.climbs.length ? '' : '<p class="meta-line">Aucune côte détectée (seuil : ≥ 1,5 km à ≥ 3 %).</p>';
  for (const c of FULL.climbs) {
    const div = document.createElement('div');
    div.className = 'card climb-card';
    // Badge de confiance (backlog #10, section D, "lié à A") : seulement pour
    // un waypoint issu d'une reconstruction historique (source « parcours
    // curé » / « wikipedia ») — une étape éditeur/GPX n'a pas ce concept de
    // sourcing, donc pas de badge dans ce cas (ni faux positif « sourcé »,
    // ni faux négatif « approximatif »).
    const wp = FULL.waypoints.find((w) => w.label === c.name && (w.kind === 'col' || w.kind === 'peak'));
    let sourceBadge = '';
    if (wp && wp.source === 'parcours curé') {
      sourceBadge = '<span class="badge sourced-badge" title="point de passage vérifié (historic_routes.json)">sourcé</span>';
    } else if (wp && wp.source === 'wikipedia') {
      sourceBadge = '<span class="badge partial-badge" title="ville de départ/arrivée Wikipédia, position approximative — pas de point de passage vérifié pour ce col précis">position approximative</span>';
    }
    // Segment approximé (backlog #10, section C, "flag surface non goudonnée") :
    // un col contourné par la route ou difficilement routable est reconstitué
    // par interpolation pied→sommet en ligne droite (pipeline/routing.js) —
    // ça lisse artificiellement la pente réelle sur ce tronçon (une route de
    // montagne irrégulière devient une pente moyenne constante), donc la
    // pente max affichée pour CETTE côte n'est plus fiable si elle chevauche
    // un tel segment. On ne sait toujours pas si c'est un vrai gravel ou
    // juste une route fermée (aucune source de type de surface — voir issue
    // #14), donc le message reste honnête sur ce qu'on sait vraiment.
    const overlapping = EFProfile.climbApproxOverlap(c, FULL.track?.approx_segments);
    const approxBadge = overlapping
      ? `<span class="badge partial-badge" title="${EF.esc(overlapping.reason)} — pente max non fiable sur ce tronçon (interpolation en ligne droite, pas la route réelle)">segment approximé</span>`
      : '';
    div.innerHTML =
      EFProfile.renderClimbSVG({ ...c }, { width: 1040, height: 300 }) +
      `<p class="meta-line">km ${c.start_km} → ${c.end_km} · du pied (${c.start_ele_m} m) au sommet (${c.summit_ele_m} m) · ` +
      `score ${c.score} → catégorie ${c.category}` +
      `${c.irregularity_index != null ? ` · indice d'irrégularité ${c.irregularity_index} (écart-type des pentes par km — un mur peut noyer dans la moyenne)` : ''}` +
      ` · nom : ${EF.esc(c.name_source === 'waypoint' ? 'waypoint' : 'toponyme géocodé inverse')} ${sourceBadge}${approxBadge}</p>`;
    climbsBox.appendChild(div);
  }

  // Faux-plats : longues portions à 1-3 % (sous le seuil de détection des
  // côtes) — ni signalées comme côte, ni distinguées du plat, alors qu'elles
  // usent plus l'organisme que le D+ ne le montre.
  const fauxPlatsSection = document.getElementById('faux-plats-section');
  const fauxPlats = FULL.fauxPlats || [];
  fauxPlatsSection.style.display = fauxPlats.length ? 'block' : 'none';
  const fpList = document.getElementById('faux-plats');
  fpList.innerHTML = '';
  for (const fp of fauxPlats) {
    const li = document.createElement('li');
    li.className = 'fauxplat-item';
    // Cap du tronçon (backlog #10, section C, "exposition au vent") : signale
    // une orientation, pas un vent réel — aucune donnée météo disponible.
    const COMPASS_FULL = { N: 'Nord', NE: 'Nord-Est', E: 'Est', SE: 'Sud-Est', S: 'Sud', SO: 'Sud-Ouest', O: 'Ouest', NO: 'Nord-Ouest' };
    const orientation = fp.compass
      ? ` · cap ${COMPASS_FULL[fp.compass] || fp.compass} (${fp.bearingDeg}°) — exposition potentielle au vent latéral/de face selon le vent du jour`
      : '';
    li.innerHTML = `<span class="badge fauxplat-badge">faux-plat</span> km ${fp.fromKm} → ${fp.toKm} · ${fp.lengthKm.toFixed(1)} km à ${fp.avgGradient.toFixed(1)} % en moyenne${orientation}`;
    fpList.appendChild(li);
  }

  // Descentes (backlog #10) : symétrique des côtes, sans catégorie ASO (qui
  // n'existe pas pour les descentes) — voir pipeline/descents.js.
  const descentsSection = document.getElementById('descents-section');
  const descents = FULL.descents || [];
  descentsSection.style.display = descents.length ? 'block' : 'none';
  const descList = document.getElementById('descents');
  descList.innerHTML = '';
  for (const d of descents) {
    const li = document.createElement('li');
    li.className = 'fauxplat-item';
    const overlapping = EFProfile.climbApproxOverlap(d, FULL.track?.approx_segments);
    const approxBadge = overlapping
      ? ` <span class="badge partial-badge" title="${EF.esc(overlapping.reason)} — pente non fiable sur ce tronçon">segment approximé</span>`
      : '';
    li.innerHTML = `<span class="badge fauxplat-badge">descente</span> ${EF.esc(d.name)} · ` +
      `km ${d.start_km} → ${d.end_km} · ${d.length_km} km à ${d.avg_gradient} % en moyenne ` +
      `(max ${d.max_gradient} %) · du sommet (${d.top_ele_m} m) au bas (${d.bottom_ele_m} m)` +
      `${d.irregularity_index != null ? ` · indice d'irrégularité ${d.irregularity_index}` : ''}${approxBadge}`;
    descList.appendChild(li);
  }

  renderKmTable();

  // Carte.
  const track = FULL.track;
  if (track) {
    const coords = track.geojson.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    const mid = coords[Math.floor(coords.length / 2)];
    const map = L.map('map');
    EF.baseLayerFor(mid[0], mid[1]).addTo(map);
    // Tracé coloré par pente locale (lisible d'un coup d'œil, façon VeloViewer) :
    // halo sombre + segments entre échantillons successifs, teintés par gradient.
    L.polyline(coords, { color: '#3a3a3a', weight: 6, opacity: 0.5 }).addTo(map);
    const segs = decimate(FULL.samples, 700);
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1];
      const b = segs[i];
      const dd = b.dist_m - a.dist_m;
      const g = dd > 0 ? ((b.ele_smooth_m - a.ele_smooth_m) / dd) * 100 : 0;
      const color = g < 1 ? '#3fa34d' : EFProfile.gradStyle(g).color;
      L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color, weight: 4, opacity: 0.95 })
        .bindTooltip(`km ${(b.dist_m / 1000).toFixed(1)} · ${Math.round(b.ele_smooth_m)} m · ${g.toFixed(1)} %`)
        .addTo(map);
    }
    // segments approximés en surimpression
    for (const seg of track.approx_segments || []) {
      const sub = FULL.samples.filter((s) => s.dist_m >= seg.fromM && s.dist_m <= seg.toM).map((s) => [s.lat, s.lon]);
      if (sub.length > 1) L.polyline(sub, { color: '#f08c00', weight: 4, dashArray: '6 6' }).addTo(map).bindTooltip('segment approximé : ' + EF.esc(seg.reason));
    }
    map.fitBounds(coords, { padding: [30, 30] });
    setupProfileMapHover(payload, map);

    const totalM = track.distance_m;
    const icon = (html, cls) => L.divIcon({ html, className: 'ef-marker ' + (cls || ''), iconSize: [26, 26], iconAnchor: [13, 13] });
    // bornes 20/10/5 km
    for (const kmLeft of [20, 10, 5]) {
      const m = totalM - kmLeft * 1000;
      if (m <= 0) continue;
      const s = sampleAt(m);
      L.marker([s.lat, s.lon], { icon: icon(`<div style="background:#fff;border:2px solid #c0392b;border-radius:4px;font-size:10px;font-weight:700;text-align:center;line-height:20px;color:#c0392b">${kmLeft}</div>`) })
        .bindTooltip(`${kmLeft} km de l'arrivée`).addTo(map);
    }
    // flamme rouge
    const fr = sampleAt(totalM - 1000);
    L.marker([fr.lat, fr.lon], { icon: icon('<div style="font-size:20px;line-height:22px">🚩</div>') })
      .bindTooltip('Flamme rouge — dernier kilomètre').addTo(map);
    // damier arrivée
    const fin = sampleAt(totalM);
    L.marker([fin.lat, fin.lon], { icon: icon('<div style="font-size:20px;line-height:22px">🏁</div>') })
      .bindTooltip('Arrivée').addTo(map);
    // départ
    const dep = sampleAt(0);
    L.marker([dep.lat, dep.lon], { icon: icon('<div style="font-size:18px;line-height:22px">🟢</div>') })
      .bindTooltip('Départ').addTo(map);
    // sommets
    for (const c of FULL.climbs) {
      const s = sampleAt(c.end_km * 1000);
      // Trouvé en corrigeant le contraste WCAG des pastilles (backlog #63) :
      // ce marqueur ne lisait pas CAT_TEXT, il forçait "color:#fff" en dur —
      // illisible sur cat.2/3/4 (jusqu'à 1.48:1 sur cat.3, jaune) quel que
      // soit le contraste corrigé dans le reste du fichier, puisque ce point
      // de rendu ne passait jamais par la table.
      const cc = EFProfile.CAT_COLORS[c.category] || '#707070';
      const tc = EFProfile.CAT_TEXT[c.category] || '#fff';
      L.marker([s.lat, s.lon], { icon: icon(`<div style="background:${cc};color:${tc};border-radius:50%;width:22px;height:22px;font-size:10px;font-weight:700;text-align:center;line-height:22px;border:2px solid #fff">${c.category}</div>`) })
        .bindTooltip(`${EF.esc(c.name)} — ${c.summit_ele_m} m`).addTo(map);
    }
  }

  // Exports.
  if (window.EF_STATIC) {
    document.getElementById('exp-json').href = `data/stage-${stageId}.json`;
    document.getElementById('exp-gpx').style.display = 'none';
    document.getElementById('exp-tcx').style.display = 'none';
    document.getElementById('exp-kml').style.display = 'none';
    document.getElementById('exp-roadbook').style.display = 'none';
    document.getElementById('exp-html').style.display = 'none';
    document.getElementById('btn-regen').style.display = 'none';
    document.getElementById('btn-edit').style.display = 'none';
  } else {
    document.getElementById('exp-json').href = `/api/stages/${stageId}/export.json`;
    document.getElementById('exp-gpx').href = `/api/stages/${stageId}/export.gpx`;
    document.getElementById('exp-tcx').href = `/api/stages/${stageId}/export.tcx`;
    document.getElementById('exp-kml').href = `/api/stages/${stageId}/export.kml`;
    document.getElementById('exp-roadbook').href = `/api/stages/${stageId}/roadbook.html`;
    document.getElementById('exp-html').href = `/api/stages/${stageId}/export.html`;
  }
  document.getElementById('exp-png').addEventListener('click', () => {
    const svg = document.querySelector('#profile-box svg');
    if (svg) EF.svgToPng(svg, `profil-etape-${stageId}.png`, 2);
  });
  document.getElementById('btn-edit').href = `/?id=${stageId}`;
  document.getElementById('btn-compare').href = `/compare.html?a=${stageId}`;
  document.getElementById('btn-regen').addEventListener('click', async () => {
    await EF.api(`/api/stages/${stageId}/generate`, { method: 'POST' });
    location.reload();
  });
}

function setup3D(payload) {
  const box2d = document.getElementById('profile-box');
  const box3d = document.getElementById('ribbon-box');
  const ctl = document.getElementById('ctl-3d');
  const tab2d = document.getElementById('tab-2d');
  const tab3d = document.getElementById('tab-3d');
  let rotation = 0;
  let stretch = parseFloat(document.getElementById('stretch').value);

  const draw = () => {
    box3d.innerHTML = EFProfile.renderRibbon3D(payload, { width: 1080, height: 440, rotation, stretch });
  };
  const show = (three) => {
    box2d.style.display = three ? 'none' : 'block';
    box3d.style.display = three ? 'block' : 'none';
    ctl.style.display = three ? 'inline' : 'none';
    tab2d.className = three ? 'tab secondary' : 'tab active';
    tab3d.className = three ? 'tab active' : 'tab secondary';
    if (three) draw();
  };
  tab2d.addEventListener('click', () => show(false));
  tab3d.addEventListener('click', () => show(true));
  document.getElementById('stretch').addEventListener('input', (e) => {
    stretch = parseFloat(e.target.value);
    draw();
  });
  let dragging = false;
  let lastX = 0;
  box3d.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; box3d.style.cursor = 'grabbing'; });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    rotation += (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
    draw();
  });
  window.addEventListener('pointerup', () => { dragging = false; box3d.style.cursor = 'grab'; });
}

// Étapes similaires (backlog #10, section D) : requête séparée de la fiche
// principale — non essentielle, ne doit jamais bloquer ni casser le reste
// de la page si elle échoue (backend injoignable, mode statique, etc.).
// Fonction pure (pas de DOM) : testée directement côté Node (voir
// test/similarStages.test.js) pour verrouiller l'échappement HTML de s.name
// ET de s.edition_name (un champ libre — nom de tour personnalisé) — les
// deux vecteurs vérifiés manuellement lors de la relecture adverse.
function similarItemHtml(s) {
  const meta = [
    s.edition_name ? `${s.edition_name}${s.edition_year ? ` (${s.edition_year})` : ''}` : null,
    s.total_ascent_m != null ? `D+ ${s.total_ascent_m} m` : null,
    s.max_category ? `côte cat. ${s.max_category}` : null,
    s.max_gradient ? `${s.max_gradient} % max` : null,
  ].filter(Boolean).join(' · ');
  return `<li class="fauxplat-item"><a href="/stage.html?id=${s.id}">${EF.esc(s.name)}</a>${meta ? ` — ${EF.esc(meta)}` : ''}</li>`;
}

async function loadSimilarStages() {
  if (window.EF_STATIC) return;
  const section = document.getElementById('similar-section');
  const list = document.getElementById('similar-list');
  try {
    const { similar } = await EF.api(`/api/stages/${stageId}/similar`);
    if (!similar.length) return;
    list.innerHTML = similar.map(similarItemHtml).join('');
    section.style.display = 'block';
  } catch {
    // Non essentiel : la fiche reste utilisable sans les suggestions.
  }
}

function renderKmTable() {
  const rows = [...FULL.kmAnalysis].sort((a, b) => {
    const va = a[kmSortKey];
    const vb = b[kmSortKey];
    return kmSortAsc ? va - vb : vb - va;
  });
  const tbody = document.querySelector('#kmtable tbody');
  tbody.innerHTML = rows
    .map(
      (r) =>
        `<tr><td>${r.km}</td><td>${r.ele_end_m}</td><td>${r.avg_gradient.toFixed(1)}</td>` +
        `<td>${r.max_gradient_100m.toFixed(1)}</td><td>${r.ascent_m}</td><td>${r.cum_ascent_m}</td></tr>`
    )
    .join('');
}

// Garde typeof : similarItemHtml est une fonction pure, testée directement
// (voir test/similarStages.test.js) sans DOM — même schéma que
// profile.js/compare.js/editor.js.
if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('editeur');
  if (!stageId) { location.href = '/'; return; }
  document.querySelectorAll('#kmtable th').forEach((th) =>
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (kmSortKey === k) kmSortAsc = !kmSortAsc;
      else { kmSortKey = k; kmSortAsc = true; }
      renderKmTable();
    })
  );
  document.getElementById('exp-csv').addEventListener('click', () => {
    const head = 'km;alt_fin_m;pente_moy_pct;pente_max_pct;d_plus_km_m;d_plus_cumule_m';
    const lines = FULL.kmAnalysis.map((r) =>
      [r.km, r.ele_end_m, r.avg_gradient, r.max_gradient_100m, r.ascent_m, r.cum_ascent_m].join(';')
    );
    EF.downloadText(`etape-${stageId}-km-par-km.csv`, [head, ...lines].join('\n'), 'text/csv');
  });
  poll();
});
}

if (typeof module !== 'undefined' && module.exports) module.exports = { similarItemHtml };
