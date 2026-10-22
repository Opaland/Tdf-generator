'use strict';
// Fichiers d'intégration Copilot et Gemini générés depuis .claude/ (Epic 37.5,
// issue #481) : à jour, sans outil d'écriture, et un écart à la source détecté.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { copyDir, removeSync } = require('../pipeline/fsPortable');
const { expectedFiles, gaps, generate, parseFrontmatter } = require('../scripts/generer-integrations');

const ROOT = path.join(__dirname, '..');
const agentNames = fs.readdirSync(path.join(ROOT, '.claude', 'agents'))
  .filter((f) => f.endsWith('.md')).map((f) => path.basename(f, '.md'));

test('les fichiers générés sont à jour (sinon : node scripts/generer-integrations.js)', () => {
  assert.deepStrictEqual(gaps(), []);
});

test('chaque agent a sa version Copilot, Gemini et sa commande Gemini', () => {
  const files = expectedFiles();
  for (const name of agentNames) {
    for (const rel of [`.github/agents/${name}.agent.md`, `.gemini/agents/${name}.md`, `.gemini/commands/${name}.toml`]) {
      assert.ok(rel in files, `${rel} manquant`);
    }
    assert.match(files[`.gemini/commands/${name}.toml`], /\{\{args\}\}/);
  }
});

test("aucun outil d'écriture ne passe dans une version générée", () => {
  const files = expectedFiles();
  for (const name of agentNames) {
    const copilot = parseFrontmatter(files[`.github/agents/${name}.agent.md`]).fields;
    assert.ok(!JSON.parse(copilot.tools).includes('edit'), `${name} (Copilot) : edit`);
    const gemini = files[`.gemini/agents/${name}.md`];
    assert.doesNotMatch(gemini.split('\n---\n')[0], /write_file|replace|edit/, `${name} (Gemini) : outil d'écriture`);
  }
});

test("mireille n'a pas le Web dans ses versions générées, henri l'a", () => {
  const files = expectedFiles();
  assert.ok(!JSON.parse(parseFrontmatter(files['.github/agents/mireille.agent.md']).fields.tools).includes('web'));
  assert.ok(JSON.parse(parseFrontmatter(files['.github/agents/henri.agent.md']).fields.tools).includes('web'));
  assert.doesNotMatch(files['.gemini/agents/mireille.md'], /google_web_search|web_fetch/);
});

test('Gemini charge AGENTS.md comme contexte', () => {
  const settings = JSON.parse(expectedFiles()['.gemini/settings.json']);
  assert.deepStrictEqual(settings.context.fileName, ['AGENTS.md']);
});

test('une source modifiée, un fichier généré absent ou orphelin sont détectés, puis réparés', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etapeforge-integrations-'));
  try {
    copyDir(path.join(ROOT, '.claude'), path.join(tmp, '.claude'));
    generate(tmp);
    assert.deepStrictEqual(gaps(tmp), []);

    const henri = path.join(tmp, '.claude', 'agents', 'henri.md');
    fs.appendFileSync(henri, '\nConsigne ajoutée.\n');
    fs.unlinkSync(path.join(tmp, '.gemini', 'commands', 'mireille.toml'));
    const orphan = path.join(tmp, '.github', 'agents', 'disparu.agent.md');
    fs.writeFileSync(orphan, '<!-- Fichier généré par scripts/generer-integrations.js depuis .claude/agents/disparu.md -->\n');
    const handWritten = path.join(tmp, '.github', 'agents', 'a-la-main.agent.md');
    fs.writeFileSync(handWritten, 'écrit à la main, sans marque\n');

    assert.deepStrictEqual(gaps(tmp).sort(), [
      'absent : .gemini/commands/mireille.toml',
      'orphelin : .github/agents/disparu.agent.md',
      'périmé : .gemini/agents/henri.md',
      'périmé : .gemini/commands/henri.toml',
      'périmé : .github/agents/henri.agent.md',
    ]);
    generate(tmp);
    assert.deepStrictEqual(gaps(tmp), []);
    assert.ok(!fs.existsSync(orphan), 'orphelin supprimé');
    assert.ok(fs.existsSync(handWritten), 'un fichier sans marque reste');
  } finally {
    removeSync(tmp);
  }
});

test('un outil interdit (disallowedTools) ou d\'écriture ne passe pas, même listé dans tools', () => {
  const { translateTools, TOOLS_COPILOT, TOOLS_GEMINI } = require('../scripts/generer-integrations');
  const fields = { tools: 'Read, Bash, Edit, WebFetch', disallowedTools: 'WebFetch, Bash' };
  assert.deepStrictEqual(translateTools(fields, TOOLS_COPILOT), ['read']);
  assert.deepStrictEqual(translateTools(fields, TOOLS_GEMINI), ['read_file']);
});

test('sans Edit, verificateur-de-tests ne met de côté que le fichier du correctif (story 37.6)', () => {
  const files = expectedFiles();
  for (const rel of ['.github/agents/verificateur-de-tests.agent.md', '.gemini/agents/verificateur-de-tests.md']) {
    assert.match(files[rel], /git stash push -- <fichier du correctif>/, rel);
    assert.match(files[rel], /git diff -- <fichier>` ne montre que le correctif/, rel);
  }
});

test("aucune consigne ne met de côté ou n'efface le travail non commité (#484)", () => {
  const sources = ['AGENTS.md', 'CLAUDE.md'];
  for (const sub of ['agents', 'skills']) {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    sources.push(...walk(path.join(ROOT, '.claude', sub)).map((p) => path.relative(ROOT, p)));
  }
  const texts = { ...expectedFiles() };
  for (const rel of sources) texts[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // Seules formes admises : stash ciblé, pop, ou la mise en garde elle-même.
  const allowed = /^git stash( push -- <fichier| pop|` sans chemin|` dans l'arbre courant)/;
  const forbidden = /git checkout -- \.|git restore \.|git stash push -- \.|git stash -u|git stash save|git reset --hard/;
  const bad = [];
  for (const [rel, text] of Object.entries(texts)) {
    for (const m of text.matchAll(/git stash/g)) {
      const context = text.slice(m.index, m.index + 40).replace(/\s+/g, ' ');
      if (!allowed.test(context)) bad.push(`${rel} : ${context}`);
    }
    if (forbidden.test(text)) bad.push(`${rel} : ${forbidden.exec(text)[0]}`);
  }
  assert.deepStrictEqual(bad, []);
});
