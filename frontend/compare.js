'use strict';
// Comparateur : superposition des profils de deux étapes (axes communs,
// distances absolues ou normalisées en %) + tableau de métriques côte à côte.

const COLOR_A = '#c0392b';
const COLOR_B = '#2980b9';

let stages = [];
let cache = {}; // id -> fiche complète
const decimate = (arr, n) => EFProfile.decimate(arr, n);

async function loadFull(id) {
  if (!cache[id]) cache[id] = await EF.api(`/api/stages/${id}`);
  return cache[id];
}

function overlaySVG(fa, fb, axis, alignStart) {
  const W = 1080;
  const H = 320;
  const M = { l: 48, r: 24, t: 30, b: 34 };
  const rawA = decimate(fa.samples, 700);
  const rawB = decimate(fb.samples, 700);
  // Align start (inspiré VeloViewer) : soustrait l'altitude de départ de
  // chaque courbe pour comparer directement les pentes plutôt que
  // l'altitude brute — les deux profils démarrent alors à 0 m, peu importe
  // qu'une étape parte de la mer et l'autre d'un col. baseA/baseB restent à
  // 0 sinon, donc pa/pb valent les échantillons bruts.
  const baseA = alignStart ? rawA[0].ele_smooth_m : 0;
  const baseB = alignStart ? rawB[0].ele_smooth_m : 0;
  const pa = rawA.map((s) => ({ ...s, ele_smooth_m: s.ele_smooth_m - baseA }));
  const pb = rawB.map((s) => ({ ...s, ele_smooth_m: s.ele_smooth_m - baseB }));
  const lenA = pa[pa.length - 1].dist_m;
  const lenB = pb[pb.length - 1].dist_m;
  const maxLen = axis === 'pct' ? 100 : Math.max(lenA, lenB);
  const trueMax = Math.max(...pa.map((s) => s.ele_smooth_m), ...pb.map((s) => s.ele_smooth_m));
  const eMin = Math.floor(Math.min(...pa.map((s) => s.ele_smooth_m), ...pb.map((s) => s.ele_smooth_m)) / 100) * 100;
  // Plancher de 300 m d'amplitude : sans lui, deux étapes plates étireraient le bruit du capteur.
  // En mode aligné, le dénivelé relatif peut être négatif (étape qui descend
  // sous son altitude de départ) — un padding multiplicatif (* 1.08) inverse
  // le sens du padding sur un maximum négatif, d'où un padding additif
  // dérivé de l'amplitude réelle (eMin) au lieu de la valeur brute.
  const eMax = alignStart
    ? Math.max(trueMax + 0.08 * (trueMax - eMin), eMin + 300)
    : Math.max(trueMax * 1.08, eMin + 300);

  const x = (d, len) => M.l + ((axis === 'pct' ? (d / len) * 100 : d) / maxLen) * (W - M.l - M.r);
  const y = (e) => M.t + (1 - (e - eMin) / (eMax - eMin || 1)) * (H - M.t - M.b);

  const path = (pts, len) =>
    pts.map((s, i) => `${i ? 'L' : 'M'} ${x(s.dist_m, len).toFixed(1)} ${y(s.ele_smooth_m).toFixed(1)}`).join(' ');
  const area = (pts, len) =>
    `${path(pts, len)} L ${x(pts[pts.length - 1].dist_m, len).toFixed(1)} ${y(eMin)} L ${x(pts[0].dist_m, len).toFixed(1)} ${y(eMin)} Z`;

  let grid = '';
  const step = eMax - eMin > 1500 ? 500 : eMax - eMin > 600 ? 250 : 100;
  for (let e = eMin; e <= eMax; e += step) {
    grid +=
      `<line x1="${M.l}" y1="${y(e).toFixed(1)}" x2="${W - M.r}" y2="${y(e).toFixed(1)}" stroke="#ddd" stroke-width="0.6" stroke-dasharray="3 4"/>` +
      `<text x="${M.l - 6}" y="${(y(e) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#888">${alignStart && e > 0 ? '+' : ''}${e}</text>`;
  }
  let axisTicks = '';
  const tickStep = axis === 'pct' ? 10 : EFProfile.niceStep(maxLen / 1000) * 1000;
  for (let d = 0; d <= maxLen; d += tickStep) {
    const xx = M.l + (d / maxLen) * (W - M.l - M.r);
    axisTicks +=
      `<line x1="${xx.toFixed(1)}" y1="${y(eMin)}" x2="${xx.toFixed(1)}" y2="${y(eMin) + 5}" stroke="#888"/>` +
      `<text x="${xx.toFixed(1)}" y="${y(eMin) + 17}" text-anchor="middle" font-size="10" fill="#666">${axis === 'pct' ? d + ' %' : d / 1000}</text>`;
  }

  const marker = (f, pts, len, color) =>
    (f.climbs || [])
      .map((c) => {
        const xx = x(c.end_km * 1000, len);
        const s = pts.reduce((a, b) => (Math.abs(b.dist_m - c.end_km * 1000) < Math.abs(a.dist_m - c.end_km * 1000) ? b : a));
        return `<circle cx="${xx.toFixed(1)}" cy="${y(s.ele_smooth_m).toFixed(1)}" r="4" fill="${color}" stroke="#fff" stroke-width="1.2"><title>${EF.esc(c.name)} (cat. ${c.category})</title></circle>`;
      })
      .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#faf6ec"/>
    ${grid}
    <path d="${area(pa, lenA)}" fill="${COLOR_A}" fill-opacity="0.18"/>
    <path d="${area(pb, lenB)}" fill="${COLOR_B}" fill-opacity="0.18"/>
    <path d="${path(pa, lenA)}" fill="none" stroke="${COLOR_A}" stroke-width="2"/>
    <path d="${path(pb, lenB)}" fill="none" stroke="${COLOR_B}" stroke-width="2"/>
    ${marker(fa, pa, lenA, COLOR_A)}${marker(fb, pb, lenB, COLOR_B)}
    ${axisTicks}
    <rect x="${M.l}" y="8" width="12" height="12" fill="${COLOR_A}"/><text x="${M.l + 17}" y="18" font-size="11.5">${EF.esc(fa.stage.name)}</text>
    <rect x="${M.l + 330}" y="8" width="12" height="12" fill="${COLOR_B}"/><text x="${M.l + 347}" y="18" font-size="11.5">${EF.esc(fb.stage.name)}</text>
    ${alignStart ? `<text x="${W - M.r}" y="18" text-anchor="end" font-size="10.5" fill="#666" font-style="italic">altitudes de départ alignées — axe = dénivelé depuis le départ, pas l'altitude réelle</text>` : ''}
  </svg>`;
}

function metricRows(fa, fb) {
  const m = (f) => {
    const climbs = f.climbs || [];
    const km = f.kmAnalysis || [];
    const maxG = km.length ? Math.max(...km.map((r) => r.max_gradient_100m)) : null;
    return {
      'Distance (km)': f.stage.generated_distance_km,
      'D+ (m)': f.stage.total_ascent_m,
      'D+ / km (m)': f.stage.generated_distance_km ? Math.round((f.stage.total_ascent_m / f.stage.generated_distance_km) * 10) / 10 : null,
      'Côtes détectées': climbs.length,
      'Catégorie max': climbs.length ? climbs.reduce((a, c) => (['4','3','2','1','HC'].indexOf(c.category) > ['4','3','2','1','HC'].indexOf(a) ? c.category : a), '4') : '—',
      'Sommet le plus haut (m)': climbs.length ? Math.max(...climbs.map((c) => c.summit_ele_m)) : '—',
      'Pente max (%)': maxG != null ? maxG : '—',
      'Altitude moyenne (m)': f.samples.length ? Math.round(f.samples.reduce((a, s) => a + s.ele_smooth_m, 0) / f.samples.length) : '—',
    };
  };
  const A = m(fa);
  const B = m(fb);
  document.querySelector('#cmp-table thead').innerHTML =
    `<tr><th>Métrique</th><th style="color:${COLOR_A}">${EF.esc(fa.stage.name)}</th><th style="color:${COLOR_B}">${EF.esc(fb.stage.name)}</th></tr>`;
  document.querySelector('#cmp-table tbody').innerHTML = Object.keys(A)
    .map((k) => `<tr><td>${k}</td>` +
      `<td data-label="${EF.esc(fa.stage.name)}">${A[k] ?? '—'}</td>` +
      `<td data-label="${EF.esc(fb.stage.name)}">${B[k] ?? '—'}</td></tr>`)
    .join('');
}

let updateSeq = 0; // ignore les réponses obsolètes quand les sélecteurs changent vite

async function update() {
  const a = document.getElementById('sel-a').value;
  const b = document.getElementById('sel-b').value;
  if (!a || !b) return;
  const seq = ++updateSeq;
  const box = document.getElementById('overlay-box');
  box.innerHTML = '<p class="meta-line">chargement…</p>';
  try {
    const [fa, fb] = await Promise.all([loadFull(a), loadFull(b)]);
    if (seq !== updateSeq) return; // une sélection plus récente a pris la main
    if (!fa.samples.length || !fb.samples.length) {
      box.innerHTML = '<p class="meta-line">Les deux étapes doivent être générées.</p>';
      return;
    }
    box.innerHTML = overlaySVG(fa, fb, document.getElementById('sel-axis').value, document.getElementById('align-start').checked);
    metricRows(fa, fb);
  } catch (err) {
    if (seq === updateSeq) box.innerHTML = `<p class="meta-line">Erreur : ${EF.esc(err.message)}</p>`;
  }
}

// Garde typeof : compare.js est require()-able côté test (overlaySVG est une
// fonction pure, testée directement — voir test/compare.test.js) sans DOM.
if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', async () => {
  await EF.initChrome('compare');
  stages = (await EF.api('/api/stages')).filter((s) => s.state === 'done');
  // Préselection depuis un lien "Comparer" (fiche étape, liste des étapes) —
  // ?a=<id> présélectionne l'étape A, ?b=<id> l'étape B (backlog issue #10,
  // section D : signaler qu'une trace importée peut se comparer à une étape
  // officielle, pas seulement l'inverse).
  const qsA = EF.qs('a');
  const qsB = EF.qs('b');
  const idxOf = (id) => stages.findIndex((s) => String(s.id) === String(id));
  const fill = (sel, defIdx) => {
    const el = document.getElementById(sel);
    el.innerHTML = stages.map((s) => `<option value="${s.id}">${EF.esc(s.name)}</option>`).join('');
    if (stages[defIdx]) el.value = stages[defIdx].id;
  };
  const idxA = qsA && idxOf(qsA) >= 0 ? idxOf(qsA) : 0;
  let idxB = qsB && idxOf(qsB) >= 0 ? idxOf(qsB) : Math.min(1, stages.length - 1);
  if (idxB === idxA) idxB = idxA === 0 ? Math.min(1, stages.length - 1) : 0;
  fill('sel-a', idxA);
  fill('sel-b', idxB);
  for (const id of ['sel-a', 'sel-b', 'sel-axis', 'align-start']) document.getElementById(id).addEventListener('change', update);
  if (stages.length >= 2) update();
});
}

if (typeof module !== 'undefined' && module.exports) module.exports = { overlaySVG, metricRows };
