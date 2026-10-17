'use strict';
// Démo statique (scripts/build-site.js) : une trace avec FC dans la base ne
// laisse aucune fréquence cardiaque dans le site publié (Epic 30, relecture
// adverse). Chaque étape dans son propre processus (CLAUDE.md règle 4).

const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { test, after } = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-buildsite-hr-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function listFiles(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(d, e.name)) : [path.join(d, e.name)]));
}

test('build-site : aucune FC dans dist/ (fiche, édition, carte), alors que la base en contient', () => {
  const env = { ...process.env, ETAPEFORGE_DATA_DIR: path.join(dir, 'data'), ETAPEFORGE_OFFLINE: '1', ETAPEFORGE_DIST_DIR: path.join(dir, 'dist') };
  const setup = `
    const { importTrackAsStage } = require(${JSON.stringify(path.join(ROOT, 'pipeline/importTrack'))});
    const { getDb } = require(${JSON.stringify(path.join(ROOT, 'backend/db'))});
    (async () => {
      const pts = [];
      for (let i = 0; i <= 60; i++) pts.push({ lat: 45.3 + i * 0.001, lon: 5.7, ele: 300 + i, time: new Date(Date.UTC(2026, 5, 1, 8, 0, i * 10)), hr: 130 + (i % 20) });
      const id = await importTrackAsStage(pts, { name: 'Trace FC' });
      const db = getDb();
      const ed = db.prepare("INSERT INTO editions (name, is_custom) VALUES ('Perso', 1)").run().lastInsertRowid;
      db.prepare('UPDATE stages SET edition_id = ?, stage_order = 1 WHERE id = ?').run(ed, id);
      const n = db.prepare('SELECT COUNT(*) n FROM elevation_samples WHERE hr_bpm IS NOT NULL').get().n;
      if (!n || db.prepare('SELECT avg_hr_bpm FROM stages WHERE id = ?').get(id).avg_hr_bpm == null) throw new Error('FC absente de la base : test non discriminant');
    })().catch((e) => { console.error(e); process.exit(1); });`;
  execFileSync(process.execPath, ['-e', setup], { env, stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-site.js')], { env, stdio: 'pipe', timeout: 120000 });
  const files = listFiles(path.join(dir, 'dist')).filter((f) => /\.(json|html|js)$/.test(f) && !f.includes(`${path.sep}vendor${path.sep}`));
  assert.ok(files.some((f) => /stage-\d+\.json$/.test(f)), 'fiche de la trace publiée');
  assert.ok(files.some((f) => /edition-\d+\.json$/.test(f)), 'édition publiée');
  for (const f of files) {
    const body = fs.readFileSync(f, 'utf8');
    assert.ok(!/"(avg_hr_bpm|max_hr_bpm|hr_bpm)"\s*:/.test(body), `${path.relative(dir, f)} contient une FC`);
  }
});
