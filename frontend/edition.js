'use strict';
// Parcours d'une édition, village par village (story 41.6, issue #631) :
// itinéraires curés de pipeline/data/stage_itineraries.json, servis par
// GET /api/itineraries[/:annee] en local et par data/ sur le site statique.
// L'écart entre le profil et la reconstitution routée est toujours affiché
// (AGENTS.md règle 12).

const EFEdition = {
  /** km d'un point : « ≈ » quand il n'est pas imprimé sous le nom. */
  kmText(p) {
    if (p.km == null) return '—';
    const v = String(p.km).replace('.', ',');
    return p.km_printed ? v : `≈ ${v}`;
  },

  altText(p) {
    if (p.altitude_m == null) return '—';
    return `${p.altitude_m} m${p.altitude_doubtful ? ' ?' : ''}`;
  },

  kindText(p) {
    if ((p.kind === 'côte' || p.kind === 'col') && p.category) {
      return `${p.kind} (${p.category === 'HC' ? 'HC' : `${p.category}${p.category === '1' ? 're' : 'e'} cat.`})`;
    }
    return p.kind || '—';
  },

  placedText(p) {
    if (p.placed) return 'oui';
    if (p.at_village) return 'au village éponyme';
    return 'non';
  },

  /** Écart profil / reconstitution, en clair ; jamais masqué. */
  checkText(c) {
    if (!c) return 'non contrôlée';
    const d = String(c.delta_pct).replace('.', ',');
    const sign = c.delta_pct > 0 ? '+' : '';
    const part = c.coverage_pct != null ? ` sur ${c.coverage_pct} % de l'étape` : '';
    return `${String(c.routed_km).replace('.', ',')} km routés pour ${String(c.profile_km).replace('.', ',')} km au profil${part} : ` +
      `${sign}${d} % (${c.within ? 'dans' : 'hors'} la tolérance de ±${c.tolerance_pct} %)`;
  },

  deltaText(c) {
    if (!c) return 'non contrôlée';
    return `${c.delta_pct > 0 ? '+' : ''}${String(c.delta_pct).replace('.', ',')} %${c.within ? '' : ' (hors tolérance)'}`;
  },

  /** Lignes droites entre voisins placés : un point non placé coupe la
   * ligne (la route peut y faire un détour inconnu). */
  runs(points) {
    const out = [];
    let cur = [];
    for (const p of points) {
      if (p.placed) cur.push([p.lat, p.lon]);
      else {
        if (cur.length > 1) out.push(cur);
        cur = [];
      }
    }
    if (cur.length > 1) out.push(cur);
    return out;
  },

  /** Profil des altitudes imprimées (km imprimés et mesurés), en SVG. */
  profileSvg(points) {
    const pts = points.filter((p) => p.altitude_m != null && p.km != null);
    if (pts.length < 2) return '<p class="meta-line">Moins de deux altitudes imprimées : pas de profil.</p>';
    const W = 900;
    const H = 220;
    const pad = { l: 44, r: 12, t: 12, b: 28 };
    const kmMax = Math.max(...pts.map((p) => p.km)) || 1;
    const aMin = Math.min(...pts.map((p) => p.altitude_m));
    const aMax = Math.max(...pts.map((p) => p.altitude_m));
    const span = Math.max(aMax - aMin, 100);
    const x = (km) => pad.l + (km / kmMax) * (W - pad.l - pad.r);
    const y = (a) => H - pad.b - ((a - aMin) / span) * (H - pad.t - pad.b);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.km).toFixed(1)},${y(p.altitude_m).toFixed(1)}`).join(' ');
    const dots = pts.map((p) => `<circle cx="${x(p.km).toFixed(1)}" cy="${y(p.altitude_m).toFixed(1)}" r="3" fill="${p.altitude_doubtful ? '#a15818' : '#141414'}">` +
      `<title>${EF.esc(p.label)} — km ${EF.esc(EFEdition.kmText(p))}, ${EF.esc(EFEdition.altText(p))}</title></circle>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Profil des altitudes imprimées, de ${aMin} à ${aMax} m sur ${String(kmMax).replace('.', ',')} km" style="width:100%;height:auto;background:#fff">` +
      `<line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="#ddd5c2"/>` +
      `<text x="${pad.l - 6}" y="${y(aMax) + 4}" text-anchor="end" font-size="11" fill="#6b6b6b">${aMax} m</text>` +
      `<text x="${pad.l - 6}" y="${y(aMin) + 4}" text-anchor="end" font-size="11" fill="#6b6b6b">${aMin} m</text>` +
      `<text x="${W - pad.r}" y="${H - 8}" text-anchor="end" font-size="11" fill="#6b6b6b">${String(kmMax).replace('.', ',')} km</text>` +
      `<path d="${line}" fill="none" stroke="#c0392b" stroke-width="2"/>${dots}</svg>`;
  },
};

if (typeof module !== 'undefined') module.exports = EFEdition;

if (typeof document !== 'undefined') {
  let page = null;
  let map = null;

  const stageLabel = (s) => `Étape ${s.key} — ${s.depart || '?'} → ${s.arrivee || '?'}`;

  function setUrl(year, key) {
    const u = new URL(location.href);
    u.searchParams.set('annee', year);
    if (key) u.searchParams.set('etape', key); else u.searchParams.delete('etape');
    history.replaceState(null, '', u);
  }

  function renderStats(p) {
    const checked = p.stages.filter((s) => s.check);
    const pts = p.stages.reduce((n, s) => n + s.points.length, 0);
    const placed = p.stages.reduce((n, s) => n + s.placed, 0);
    const tiles = [
      { v: p.stages.length, l: 'étapes transcrites' },
      { v: `${placed} / ${pts}`, l: 'points placés' },
      { v: `${checked.filter((s) => s.check.within).length} / ${checked.length}`, l: 'étapes contrôlées dans la tolérance' },
    ];
    document.getElementById('edition-stats').innerHTML = tiles
      .map((t) => `<div class="stat"><div class="v">${EF.esc(t.v)}</div><div class="l">${EF.esc(t.l)}</div></div>`).join('');
  }

  function renderStages(p) {
    document.querySelector('#edition-stages tbody').innerHTML = p.stages.map((s) => `<tr>
        <td><button type="button" class="row-toggle" data-key="${EF.esc(s.key)}">${EF.esc(s.key)}</button></td>
        <td>${EF.esc(s.depart || '?')} → ${EF.esc(s.arrivee || '?')}${s.partial ? ' <span class="badge">partielle</span>' : ''}</td>
        <td>${EF.esc(s.distance_km == null ? '—' : String(s.distance_km).replace('.', ','))}</td>
        <td>${s.check ? `${EF.esc(String(s.check.routed_km).replace('.', ','))} km` : '—'}</td>
        <td>${EF.esc(EFEdition.deltaText(s.check))}</td>
        <td>${s.placed} / ${s.points.length}</td>
      </tr>`).join('');
    for (const b of document.querySelectorAll('#edition-stages button[data-key]')) {
      b.addEventListener('click', () => {
        document.getElementById('sel-stage').value = b.dataset.key;
        showStage(b.dataset.key, true);
      });
    }
  }

  function renderMap(s) {
    if (map) map.remove();
    map = L.map('map');
    // Fond OSM par défaut, le plan IGN restant au choix : le plan IGN ne
    // couvre que la France, et EF.inFrance (une boîte englobante) compte
    // Barcelone ou Cologne comme françaises — les étapes à l'étranger
    // restaient en blanc (vu sur 1965/11).
    EF.addBaseLayers(map, 0, 0);
    const layer = L.layerGroup().addTo(map);
    for (const run of EFEdition.runs(s.points)) L.polyline(run, { color: '#c0392b', weight: 3, opacity: 0.8 }).addTo(layer);
    const placed = s.points.filter((p) => p.placed);
    for (const p of placed) {
      L.circleMarker([p.lat, p.lon], { radius: p.kind === 'col' || p.kind === 'côte' ? 6 : 4, color: '#141414', fillColor: p.kind === 'col' || p.kind === 'côte' ? '#ffd320' : '#fff', fillOpacity: 1, weight: 2 })
        .bindTooltip(`${EF.esc(p.label)} — km ${EF.esc(EFEdition.kmText(p))}`)
        .addTo(layer);
    }
    if (placed.length) map.fitBounds(L.latLngBounds(placed.map((p) => [p.lat, p.lon])), { padding: [24, 24] });
    else map.setView([46.6, 2.5], 5);
  }

  function showStage(key, scroll) {
    const s = page.stages.find((x) => x.key === key) || page.stages[0];
    if (!s) return;
    setUrl(page.year, s.key);
    document.getElementById('stage-title').textContent = `${page.year} — ${stageLabel(s)}`;
    const src = s.source_url ? ` Source du profil : <a href="${EF.esc(s.source_url)}" rel="noopener" target="_blank">${EF.esc(new URL(s.source_url).hostname)}</a>.` : '';
    const circuit = s.circuit_km != null ? ` Circuit final à partir du km ${EF.esc(String(s.circuit_km).replace('.', ','))}.` : '';
    document.getElementById('stage-check').innerHTML = `<p><strong>Distance du profil :</strong> ${EF.esc(s.distance_km == null ? '—' : String(s.distance_km).replace('.', ','))} km.` +
      ` <strong>Reconstitution :</strong> ${EF.esc(EFEdition.checkText(s.check))}.${circuit}${src}</p>`;
    document.getElementById('stage-note').textContent = s.note ? `Note de curation : ${s.note}` : '';
    document.getElementById('stage-profile').innerHTML = EFEdition.profileSvg(s.points);
    document.querySelector('#stage-points tbody').innerHTML = s.points.map((p) => `<tr${p.placed ? '' : ' style="color:var(--texte2)"'}>
        <td>${EF.esc(EFEdition.kmText(p))}</td><td>${EF.esc(p.label)}</td><td>${EF.esc(EFEdition.kindText(p))}</td>
        <td>${EF.esc(EFEdition.altText(p))}</td><td>${EF.esc(EFEdition.placedText(p))}</td></tr>`).join('');
    renderMap(s);
    if (scroll) document.getElementById('stage-detail').scrollIntoView({ behavior: 'smooth' });
  }

  async function loadYear(year, key) {
    page = await EF.api(`/api/itineraries/${encodeURIComponent(year)}`);
    const sel = document.getElementById('sel-stage');
    sel.innerHTML = page.stages.map((s) => `<option value="${EF.esc(s.key)}">${EF.esc(stageLabel(s))}</option>`).join('');
    if (key && page.stages.some((s) => s.key === key)) sel.value = key;
    renderStats(page);
    renderStages(page);
    showStage(sel.value, false);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await EF.initChrome('edition');
    const index = await EF.api('/api/itineraries');
    const sel = document.getElementById('sel-year');
    sel.innerHTML = index.map((e) => `<option value="${e.year}">${e.year} — ${e.stages} étapes</option>`).join('');
    const asked = EF.qs('annee');
    const year = index.some((e) => String(e.year) === asked) ? asked : String(index[index.length - 1].year);
    sel.value = year;
    sel.addEventListener('change', () => loadYear(sel.value, null));
    document.getElementById('sel-stage').addEventListener('change', (ev) => showStage(ev.target.value, false));
    await loadYear(year, EF.qs('etape'));
  });
}
