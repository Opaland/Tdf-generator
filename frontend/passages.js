'use strict';
// « Le Tour est-il passé chez moi ? » sur le site statique (story 41.7,
// issue #633) : recherche dans l'index des lieux de passage des itinéraires
// curés (GET /api/passages, data/passages.json), par nom ou autour de la
// position de l'appareil. Tout le calcul se fait dans le navigateur : la
// position n'est envoyée nulle part.

const EFPassages = {
  MAX_ROWS: 500,

  /** Minuscules sans accents ni ponctuation, pour comparer des noms. */
  fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  },

  /** Distance en km (haversine). */
  km(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  },

  /** Lieux dont le nom contient la recherche (mots entiers en tête) :
   * nom identique d'abord, puis commençant par la recherche, puis le reste. */
  byName(places, q) {
    const f = EFPassages.fold(q);
    if (f.length < 2) return [];
    const scored = [];
    for (const p of places) {
      const n = EFPassages.fold(p[0]);
      const i = ` ${n} `.indexOf(` ${f}`);
      if (i < 0) continue;
      scored.push({ place: p, rank: n === f ? 0 : i === 0 ? 1 : 2, distance: null });
    }
    return scored.sort((a, b) => a.rank - b.rank || a.place[0].localeCompare(b.place[0], 'fr'));
  },

  /** Lieux à moins de `radiusKm` du point, du plus proche au plus loin. */
  near(places, lat, lon, radiusKm) {
    const out = [];
    for (const p of places) {
      const d = EFPassages.km(lat, lon, p[1], p[2]);
      if (d <= radiusKm) out.push({ place: p, distance: d });
    }
    return out.sort((a, b) => a.distance - b.distance);
  },

  /** Une ligne par passage, dans l'ordre des lieux puis des années. */
  rows(matches) {
    const out = [];
    for (const m of matches) {
      const [label, , , kind, passages] = m.place;
      for (const [year, stage, km, printed] of [...passages].sort((a, b) => a[0] - b[0])) {
        out.push({ label, kind, distance: m.distance, year, stage, km, printed: !!printed });
      }
    }
    return out;
  },

  rowHtml(r) {
    const dist = r.distance == null ? '—' : `${String(Math.round(r.distance * 10) / 10).replace('.', ',')} km`;
    const km = `${r.printed ? '' : '≈ '}${String(r.km).replace('.', ',')}`;
    const href = `/edition.html?annee=${encodeURIComponent(r.year)}&etape=${encodeURIComponent(r.stage)}`;
    return `<tr><td>${EF.esc(r.label)}${r.kind && r.kind !== 'ville' ? ` <span class="meta-line">(${EF.esc(r.kind)})</span>` : ''}</td>` +
      `<td>${EF.esc(dist)}</td><td>${EF.esc(r.year)}</td>` +
      `<td><a href="${EF.esc(href)}">Étape ${EF.esc(r.stage)}</a></td><td>${EF.esc(km)}</td></tr>`;
  },
};

if (typeof module !== 'undefined') module.exports = EFPassages;

if (typeof document !== 'undefined') {
  let index = null;

  const status = (t) => { document.getElementById('passages-status').textContent = t; };

  function show(matches, what) {
    const rows = EFPassages.rows(matches);
    const shown = rows.slice(0, EFPassages.MAX_ROWS);
    document.querySelector('#passages-table tbody').innerHTML = shown.map(EFPassages.rowHtml).join('');
    if (!rows.length) {
      status(`Aucun passage trouvé ${what} dans les étapes curées — ce n'est pas la preuve qu'aucun Tour n'y est passé.`);
    } else {
      status(`${rows.length} passage${rows.length > 1 ? 's' : ''} ${what}${rows.length > shown.length ? ` (${shown.length} premiers affichés)` : ''}.`);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await EF.initChrome('passages');
    try {
      index = await EF.api('/api/passages');
    } catch (err) {
      status(`Index indisponible : ${err.message}`);
      return;
    }
    const y = index.years;
    document.getElementById('passages-coverage').textContent =
      `Recherche dans les ${index.stages} étapes dont le parcours a été transcrit village par village depuis les profils ` +
      `officiels (${y.length} éditions, de ${y[0]} à ${y[y.length - 1]}) : ${index.places.length} lieux de passage placés. ` +
      'Les autres éditions et les lieux non placés ne sont pas couverts.';
    document.getElementById('name-form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = document.getElementById('q').value;
      if (EFPassages.fold(q).length < 2) return status('Saisissez au moins deux lettres.');
      show(EFPassages.byName(index.places, q), `pour « ${q.trim()} »`);
    });
    document.getElementById('btn-here').addEventListener('click', () => {
      if (!navigator.geolocation) return status('Ce navigateur ne donne pas la position de l’appareil.');
      status('Position en cours de lecture…');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const r = Number(document.getElementById('radius').value);
          show(EFPassages.near(index.places, pos.coords.latitude, pos.coords.longitude, r), `à moins de ${r} km de votre position`);
        },
        (err) => status(`Position indisponible : ${err.message}`),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
      );
    });
    const q = EF.qs('q');
    if (q) {
      document.getElementById('q').value = q;
      show(EFPassages.byName(index.places, q), `pour « ${q.trim()} »`);
    }
  });
}
