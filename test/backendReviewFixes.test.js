'use strict';
// Epic 35.12 (revue globale du 19/10/2026) : petits correctifs backend.

const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

process.env.ETAPEFORGE_DATA_DIR = path.join(os.tmpdir(), `etapeforge-backendfix-test-${process.pid}`);
process.env.ETAPEFORGE_OFFLINE = '1';
delete process.env.ETAPEFORGE_PUBLIC;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

let appServer;
let base;
const send = (method, p, body) => fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  const { app } = require('../backend/server');
  await new Promise((r) => (appServer = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${appServer.address().port}`;
});
after(() => {
  appServer?.close();
  require('../backend/db').closeDb();
  fs.rmSync(process.env.ETAPEFORGE_DATA_DIR, { recursive: true, force: true });
});

test('recherche près d\'un lieu : un renommage d\'étape n\'est plus masqué par le cache', async () => {
  const db = require('../backend/db').getDb();
  const line = JSON.stringify({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[6.1778, 49.10], [6.1778, 49.14]] } });
  const ed = db.prepare('INSERT INTO editions (year, name, is_custom) VALUES (1950, ?, 0)').run('Ed 1950').lastInsertRowid;
  const id = db.prepare("INSERT INTO stages (edition_id, stage_order, name, date, state) VALUES (?, 5, 'Ancien nom', '1950-07-18', 'done')").run(ed).lastInsertRowid;
  db.prepare("INSERT INTO tracks (stage_id, geojson, distance_m, router) VALUES (?, ?, 1000, 'brouter')").run(id, line);
  const search = async () => (await (await fetch(`${base}/api/search/near?q=Metz&radiusKm=5`)).json()).results.find((r) => r.stageId === id);
  const before1 = await search();
  assert.ok(JSON.stringify(before1).includes('Ancien nom'));
  assert.strictEqual((await send('PUT', `/api/stages/${id}`, { name: 'Nouveau nom', date: '1950-07-19' })).status, 200);
  const after1 = await search();
  assert.ok(JSON.stringify(after1).includes('Nouveau nom'), JSON.stringify(after1));
  assert.ok(JSON.stringify(after1).includes('1950-07-19'));
  // Relecture adverse : renommage à longueur constante dans la même seconde,
  // et champs que l'ancienne clé ne voyait pas (catégorie, ordre).
  assert.strictEqual((await send('PUT', `/api/stages/${id}`, { name: 'Nouveau mot' })).status, 200);
  assert.ok(JSON.stringify(await search()).includes('Nouveau mot'));
  db.prepare("UPDATE editions SET category = 'femmes' WHERE id = ?").run(ed);
  db.prepare('UPDATE stages SET stage_order = 7 WHERE id = ?').run(id);
  const after2 = await search();
  assert.ok(JSON.stringify(after2) !== JSON.stringify(after1), 'catégorie et ordre visibles');
});

test('PUT : un stage_type vide (sélecteur sans option correspondante) n\'efface pas le type stocké', async () => {
  const { id } = await (await send('POST', '/api/stages', { name: 'T', stage_type: 'Intermediate stage', waypoints: [{ label: 'A', kind: 'start', lat: 43, lon: 0 }, { label: 'B', kind: 'finish', lat: 43.1, lon: 0.1 }] })).json();
  assert.strictEqual((await send('PUT', `/api/stages/${id}`, { stage_type: '' })).status, 200);
  const full = await (await fetch(`${base}/api/stages/${id}`)).json();
  assert.strictEqual(full.stage.stage_type, 'Intermediate stage');
});

test('export HTML : le nom du fichier ne reprend que l\'id entier', async () => {
  const { id } = await (await send('POST', '/api/stages', { name: 'E', waypoints: [{ label: 'A', kind: 'start', lat: 43, lon: 0 }, { label: 'B', kind: 'finish', lat: 43.1, lon: 0.1 }] })).json();
  await require('../pipeline/generate').generateStage(id);
  const r = await fetch(`${base}/api/stages/${id}%22%3B%20filename%3D%22facture.exe/export.html`);
  const cd = r.headers.get('content-disposition') || '';
  assert.doesNotMatch(cd, /facture|exe/);
  assert.match(cd, new RegExp(`filename="etape-${id}\\.html"`));
});

test('sauvegardes : un intervalle de 720 h ne déclenche pas une sauvegarde par milliseconde', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-bk-'));
  try {
    const script = `
      const b = require(${JSON.stringify(path.join(__dirname, '../backend/backup.js'))});
      b.startScheduledBackups();
      setTimeout(() => { console.log(JSON.stringify(b.getBackupStatus())); process.exit(0); }, 1500);`;
    for (const hours of ['720', '-5', 'abc', '0.00000001']) {
      const out = execFileSync(process.execPath, ['-e', script], {
        env: { ...process.env, ETAPEFORGE_BACKUP_DIR: path.join(dir, 'bk-' + hours), ETAPEFORGE_BACKUP_INTERVAL_HOURS: hours, ETAPEFORGE_DATA_DIR: path.join(dir, 'data-' + hours) },
        encoding: 'utf8',
      });
      const st = JSON.parse(out.trim().split('\n').pop());
      assert.ok(st.count <= 2, `${hours} h : ${st.count} sauvegardes en 1,5 s`);
      assert.ok(st.intervalHours > 0 && st.intervalHours <= 24 * 366, String(st.intervalHours));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/api/status en mode public : aucun chemin absolu du serveur', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-st-'));
  try {
    const script = `
      const { app } = require(${JSON.stringify(path.join(__dirname, '../backend/server.js'))});
      const s = app.listen(0, '127.0.0.1', async () => {
        const r = await (await fetch('http://127.0.0.1:' + s.address().port + '/api/status')).json();
        console.log(JSON.stringify(r)); s.close(); process.exit(0);
      });`;
    const out = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, ETAPEFORGE_PUBLIC: '1', ETAPEFORGE_DATA_DIR: dir, ETAPEFORGE_BACKUP_DIR: path.join(dir, 'bk') },
      encoding: 'utf8',
    });
    const st = JSON.parse(out.trim().split('\n').pop());
    assert.strictEqual(st.db, undefined);
    assert.strictEqual(st.backup.dir, undefined);
    assert.ok(!out.includes(dir), 'aucune occurrence du dossier de données');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
