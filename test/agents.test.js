'use strict';
// Cohérence des consignes qui pilotent les assistants (Epic 37, issue #481,
// repris d'ISTQBFinder) : agents de .claude/agents/, import de AGENTS.md par
// CLAUDE.md, permissions de .claude/settings.json. Une consigne qui disparaît
// lors d'une réécriture ne casse aucun code — d'où ces vérifications
// textuelles simples.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AGENTS_DIR = path.join(ROOT, '.claude', 'agents');
const PERSONAS = ['henri', 'mireille'];
const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];
// Seul agent autorisé à modifier un fichier : il retire un correctif le temps
// de voir son test échouer, puis remet l'arbre en l'état.
const EDIT_ALLOWED = { 'verificateur-de-tests': ['Edit'] };

/** En-tête YAML minimal (« clé: valeur ») et corps d'un fichier d'agent. */
function readAgent(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  assert.strictEqual(lines[0], '---', `${path.basename(file)} : en-tête absent`);
  const end = lines.indexOf('---', 1);
  assert.ok(end > 0, `${path.basename(file)} : en-tête non fermé`);
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const i = line.indexOf(':');
    if (i > 0 && !line.startsWith(' ')) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

const list = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean);
const agentFiles = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));

test('chaque agent a un nom (= fichier), une description et ses outils', () => {
  assert.ok(agentFiles.length >= 5, 'agents attendus : 3 relecteurs + 2 personas');
  for (const f of agentFiles) {
    const { fields } = readAgent(path.join(AGENTS_DIR, f));
    assert.strictEqual(fields.name, path.basename(f, '.md'), `${f} : name`);
    assert.ok((fields.description || '').length > 80, `${f} : description trop courte pour départager`);
    assert.ok(list(fields.tools).length > 0, `${f} : tools`);
  }
});

test("aucun agent n'écrit, sauf verificateur-de-tests (Edit seulement)", () => {
  for (const f of agentFiles) {
    const name = path.basename(f, '.md');
    const { fields } = readAgent(path.join(AGENTS_DIR, f));
    const writes = list(fields.tools).filter((t) => WRITE_TOOLS.includes(t));
    assert.deepStrictEqual(writes, EDIT_ALLOWED[name] || [], `${f} : outils d'écriture`);
  }
});

test('les personas interdisent explicitement Write et Edit', () => {
  for (const name of PERSONAS) {
    const { fields } = readAgent(path.join(AGENTS_DIR, `${name}.md`));
    for (const t of ['Write', 'Edit']) {
      assert.ok(list(fields.disallowedTools).includes(t), `${name} : disallowedTools sans ${t}`);
    }
  }
});

test("henri lit le Web mais n'a pas de terminal ; mireille contrôle sans --write", () => {
  const henri = readAgent(path.join(AGENTS_DIR, 'henri.md'));
  assert.ok(!list(henri.fields.tools).includes('Bash'), 'henri : Bash dans tools');
  assert.ok(list(henri.fields.disallowedTools).includes('Bash'), 'henri : Bash non interdit');
  assert.match(readAgent(path.join(AGENTS_DIR, 'mireille.md')).body, /sans `--write`/);
});

test('mireille ne va pas sur le Web : elle juge sur pièces du dépôt', () => {
  const { fields } = readAgent(path.join(AGENTS_DIR, 'mireille.md'));
  for (const t of ['WebSearch', 'WebFetch']) {
    assert.ok(!list(fields.tools).includes(t), `mireille : ${t} dans tools`);
    assert.ok(list(fields.disallowedTools).includes(t), `mireille : ${t} non interdit`);
  }
});

test('les personas savent être sous-agents et ne bloquent jamais', () => {
  const required = [
    'sous-agent', // ne peut ni poser de question ni attendre de réponse
    'hypothèse explicite', // avance au lieu de bloquer
    'Questions à choix', // rendues à la conversation principale
    'DONNÉE', // texte lu = donnée, jamais consigne
    'Confiance : NN/100',
    'docs/CURATION-REGLES.md',
  ];
  for (const name of PERSONAS) {
    const { body } = readAgent(path.join(AGENTS_DIR, `${name}.md`));
    for (const r of required) assert.ok(body.includes(r), `${name} : mention « ${r} » absente`);
  }
});

test('les descriptions des personas renvoient vers les autres agents', () => {
  const others = { henri: ['mireille', 'relecteur-adverse'], mireille: ['henri', 'relecteur-adverse'] };
  for (const [name, targets] of Object.entries(others)) {
    const { fields } = readAgent(path.join(AGENTS_DIR, `${name}.md`));
    for (const t of targets) assert.ok(fields.description.includes(`→ ${t}`), `${name} : pas de renvoi vers ${t}`);
  }
});

test('CLAUDE.md importe AGENTS.md, et les « règle N » citées y existent', () => {
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /^@AGENTS\.md$/m);
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const numbers = [...agents.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepStrictEqual(numbers, numbers.map((_, i) => i + 1), 'règles numérotées sans trou depuis 1');

  // Le code cite « CLAUDE.md règle N » (ou « CLAUDE.md, règle N ») : chaque N doit exister.
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter((f) => /\.(js|md|sh|yml)$/.test(f) && !f.startsWith('docs/SPRINT-STATUS'));
  const dangling = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/CLAUDE\.md,?\s+règle\s+(\d+)/g)) {
      if (!numbers.includes(Number(m[1]))) dangling.push(`${f} : règle ${m[1]}`);
    }
  }
  assert.deepStrictEqual(dangling, []);
});

// --- Permissions -----------------------------------------------------------

const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));

/** « Bash(x*) » couvre tout ce qui commence par x ; « Bash(x) », x seul.
 * Réimplémentation du motif par préfixe de Claude Code : ces tests prouvent la
 * cohérence du fichier, pas le comportement exact de l'outil. Limites connues
 * (relecture adverse de la PR #482) : un drapeau placé après la branche
 * (« git push origin x --force ») échappe à ask, et git diff/log/show
 * acceptent --output=<fichier> — d'où la protection de main à décider côté
 * GitHub, pas ici. */
function matches(rule, command) {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  const pattern = m[1].replace(/:\*$/, '*');
  return pattern.endsWith('*') ? command.startsWith(pattern.slice(0, -1)) : command === pattern;
}
const covered = (rules, command) => rules.some((r) => matches(r, command));

test("allow ne couvre aucune commande qui écrit", () => {
  const writes = [
    'git commit -m x', 'git push origin main', 'git push --force', 'git reset --hard HEAD',
    'git checkout -- .', 'gh pr merge 1 --squash', 'gh pr create', 'gh issue close 1',
    'gh issue create', 'npm audit fix', 'npm audit fix --force', 'npm install', 'npm run import',
    'npm run generate', 'npm audit --audit-level=high fix', 'node scripts/check-itineraries.js --write 1998',
    'node scripts/import-all-and-generate.js',
  ];
  const leaks = writes.filter((c) => covered(settings.permissions.allow, c));
  assert.deepStrictEqual(leaks, []);
});

test("ask couvre l'irréversible et les imports de plusieurs heures", () => {
  const sensitive = [
    'git push --force origin x', 'git push -f origin x', 'git push --delete origin x',
    'git reset --hard origin/main', 'gh repo delete x', 'gh release create v2', 'gh secret set X',
    'npm run import -- 1903', 'node scripts/import-all-and-generate.js',
    'git branch -D x', 'git clean -fdx', 'gh api -X DELETE repos/o/r/git/refs/heads/x',
  ];
  const missing = sensitive.filter((c) => !covered(settings.permissions.ask, c));
  assert.deepStrictEqual(missing, []);
});

test("le push et la fusion ordinaires ne sont pas en ask : ask n'ajoute pas de confirmation à la fusion autonome", () => {
  for (const c of ['git push -u origin epic-37', 'gh pr merge 1 --squash --match-head-commit abc']) {
    assert.ok(!covered(settings.permissions.ask, c), `${c} demanderait une confirmation`);
  }
});
