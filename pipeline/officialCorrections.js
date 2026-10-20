'use strict';
// Corrections sourcées des données officielles lues dans le tableau d'étapes
// de en.wikipedia (Epic 33.19) : distance, date, ville de départ ou
// d'arrivée. Elles viennent du recoupement avec Wikidata et fr.wikipedia
// (docs/WIKIDATA-EXAMEN.md). La valeur Wikipédia d'origine est gardée à côté
// de la valeur corrigée (CLAUDE.md règle 12) : jamais effacée en silence.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'official_corrections.json');
const FIELDS = {
  distanceKm: (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1000,
  dateIso: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)),
  start: (v) => typeof v === 'string' && v.trim() !== '' && v.length <= 200,
  finish: (v) => typeof v === 'string' && v.trim() !== '' && v.length <= 200,
};

/**
 * Valide le fichier : une entrée par « édition/étape » (clé de curation,
 * stageCurationKey : « 1970/5b » pour le 2e secteur), au moins un champ
 * connu, et une source écrite. Lève une erreur au premier défaut : un
 * fichier faux ne s'applique jamais à moitié.
 */
function validateCorrections(doc) {
  const out = {};
  const entries = doc && typeof doc.corrections === 'object' && doc.corrections ? doc.corrections : null;
  if (!entries || Array.isArray(entries)) throw new Error('official_corrections : objet « corrections » attendu');
  for (const [key, e] of Object.entries(entries)) {
    if (!/^\d{4}(-femmes)?\/\d+[a-z]?$/.test(key)) throw new Error(`official_corrections : clé invalide « ${key} »`);
    if (!e || typeof e !== 'object' || typeof e.source !== 'string' || !e.source.trim()) throw new Error(`official_corrections ${key} : source manquante`);
    const fields = Object.keys(e).filter((k) => k !== 'source');
    if (!fields.length) throw new Error(`official_corrections ${key} : aucune valeur corrigée`);
    for (const f of fields) {
      if (!FIELDS[f]) throw new Error(`official_corrections ${key} : champ inconnu « ${f} »`);
      if (!FIELDS[f](e[f])) throw new Error(`official_corrections ${key}.${f} : valeur invalide`);
    }
    out[key] = { ...e, ...(e.start ? { start: e.start.trim() } : {}), ...(e.finish ? { finish: e.finish.trim() } : {}) };
  }
  return out;
}

let cache = null;
/** Corrections du dépôt (lues une fois). Fichier absent ou faux : erreur. */
function loadCorrections(file = FILE) {
  if (file !== FILE) return validateCorrections(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!cache) cache = validateCorrections(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  return cache;
}

/** Clé d'édition : « 1987 », « 2022-femmes ». */
const editionKey = (year, category) => (category === 'femmes' ? `${year}-femmes` : String(year));

/**
 * Applique la correction d'une étape analysée (parseStagesFromHtml) :
 * renvoie une copie corrigée et la liste des corrections, chacune avec la
 * valeur Wikipédia d'origine. Sans correction : l'étape telle quelle, [].
 */
function correctStage(stage, key, corrections = loadCorrections()) {
  const c = corrections[key];
  if (!c) return { stage, applied: [] };
  const out = { ...stage };
  const applied = [];
  for (const f of Object.keys(FIELDS)) {
    if (c[f] == null || stage[f] === c[f]) continue;
    applied.push({ field: f, wikipedia: stage[f] ?? null, value: c[f], source: c.source });
    out[f] = c[f];
  }
  return { stage: out, applied };
}

module.exports = { validateCorrections, loadCorrections, correctStage, editionKey, FILE };
