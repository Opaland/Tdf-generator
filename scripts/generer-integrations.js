#!/usr/bin/env node
'use strict';
// Génère les fichiers d'intégration des autres assistants depuis la source
// unique `.claude/` (Epic 37.5, issue #481 — repris d'ISTQBFinder,
// scripts/generer_integrations.py) :
//
//   node scripts/generer-integrations.js              # (ré)écrit les fichiers générés
//   node scripts/generer-integrations.js --verifier   # code 1 si un fichier n'est pas à jour
//
// Source (à modifier) : `.claude/agents/*.md`, `.claude/skills/*/`, et les
// permissions `allow` de `.claude/settings.json` ; règles communes dans
// `AGENTS.md`. Fichiers générés (à ne jamais modifier à la main) :
//
// - GitHub Copilot : `.github/agents/<agent>.agent.md`. Copilot lit
//   `AGENTS.md` et `.claude/skills/` lui-même : pas de copie.
// - Gemini CLI, qui ne lit pas `.claude/` : `.gemini/agents/<agent>.md`
//   (sous-agents, `@henri`), `.gemini/commands/<agent>.toml` (`/henri …`),
//   `.gemini/skills/<skill>/` (copie) et `.gemini/settings.json` (contexte
//   `AGENTS.md`, seules les commandes `allow` pré-approuvées).
//
// Un outil d'écriture (Write, Edit) ne passe jamais dans une version générée :
// `verificateur-de-tests` y retire son correctif par `git stash` au terminal.
// test/integrations.test.js échoue si un fichier généré n'est pas à jour.

const fs = require('fs');
const path = require('path');

const MARK = 'Fichier généré par scripts/generer-integrations.js';
const ROOT = path.join(__dirname, '..');

// Outils Claude Code → alias Copilot (docs.github.com, custom agents configuration).
const TOOLS_COPILOT = { Bash: 'execute', Read: 'read', Grep: 'search', Glob: 'search', WebSearch: 'web', WebFetch: 'web' };
// Outils Claude Code → outils intégrés de Gemini CLI.
const TOOLS_GEMINI = {
  Bash: 'run_shell_command', Read: 'read_file', Grep: 'grep_search', Glob: 'glob',
  WebSearch: 'google_web_search', WebFetch: 'web_fetch',
};

const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

const lf = (text) => text.replace(/\r\n/g, '\n');

/** En-tête YAML minimal (« clé: valeur ») et corps d'un fichier Markdown. */
function parseFrontmatter(text) {
  const lines = lf(text).split('\n');
  if (lines[0] !== '---') throw new Error('en-tête YAML absent');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('en-tête YAML non fermé');
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const i = line.indexOf(':');
    if (i > 0 && !line.startsWith(' ')) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { fields, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}

const list = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean);

/** Outils autorisés par l'agent Claude, traduits ; les outils d'écriture ne passent jamais. */
function translateTools(fields, table) {
  const denied = new Set(list(fields.disallowedTools));
  const out = [];
  for (const name of list(fields.tools)) {
    const target = table[name];
    if (!denied.has(name) && target && !out.includes(target)) out.push(target);
  }
  return out;
}

function preamble(sourceName, fields, assistant, readTool) {
  const writes = list(fields.tools).filter((t) => WRITE_TOOLS.includes(t));
  const lines = [
    `<!-- ${MARK} depuis .claude/agents/${sourceName} : ne pas modifier, relancer le script. -->`, '',
    `> **Version ${assistant}** de l'agent défini dans \`.claude/agents/${sourceName}\` (source unique).`,
    `> Outils : « \`Read\` » désigne ici \`${readTool}\` ; les commandes (\`npm\`, \`node scripts/…\`, \`git\`) ` +
      'passent par le terminal, lancées depuis la racine du dépôt. ' +
      (writes.length
        ? `${writes.join(', ')} n'existe pas dans cette version : retire un correctif par \`git stash\` au terminal, ` +
          "et remets toujours l'arbre en l'état (`git stash pop`)."
        : 'Tu ne modifies aucun fichier.'),
  ];
  return lines.join('\n') + '\n\n';
}

function copilotAgent(file) {
  const { fields, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const head = ['---', `name: ${fields.name}`, `description: ${JSON.stringify(fields.description)}`,
    `tools: ${JSON.stringify(translateTools(fields, TOOLS_COPILOT))}`, '---', ''];
  return head.join('\n') + preamble(path.basename(file), fields, 'GitHub Copilot', 'read') + body;
}

function geminiAgent(file) {
  const { fields, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const head = ['---', `name: ${fields.name}`, `description: ${JSON.stringify(fields.description)}`, 'kind: local',
    'tools:', ...translateTools(fields, TOOLS_GEMINI).map((t) => `  - ${t}`), '---', ''];
  return head.join('\n') + preamble(path.basename(file), fields, 'Gemini CLI', 'read_file') + body;
}

/** Chaîne TOML multiligne « basique » (échappe \ et "). */
const tomlString = (text) => '"""\n' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"""';

/** `/henri <demande>` : le prompt de l'agent joué dans la conversation principale. */
function geminiCommand(file) {
  const { fields, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const name = fields.name;
  // Le marqueur est déjà en commentaire TOML : inutile de l'envoyer au modèle.
  const prompt = preamble(path.basename(file), fields, `Gemini CLI (commande /${name})`, 'read_file').split('\n').slice(2).join('\n') +
    '> Ici tu réponds directement dans la conversation (pas en sous-agent) : tu peux poser toi-même ' +
    `les questions de cadrage. Pour une délégation en sous-agent : \`@${name}\`.\n\n` +
    body.replace(/\n+$/, '') + "\n\n## Demande de l'utilisateur\n\n{{args}}\n";
  const description = fields.description.split('. ')[0].replace(/\.$/, '') + '.';
  return `# ${MARK} depuis .claude/agents/${path.basename(file)} : ne pas modifier, relancer le script.\n` +
    `description = ${JSON.stringify(description)}\n` +
    `prompt = ${tomlString(prompt)}\n`;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** Copie d'un skill : en-tête réduit à name/description, arborescence conservée. */
function geminiSkill(root, dir) {
  const files = {};
  const name = path.basename(dir);
  for (const f of walk(dir)) {
    const rel = path.relative(dir, f).split(path.sep).join('/');
    let text = lf(fs.readFileSync(f, 'utf8'));
    const mark = `<!-- ${MARK} depuis .claude/skills/${name}/${rel} : ne pas modifier, relancer le script. -->\n`;
    if (rel === 'SKILL.md') {
      const { fields, body } = parseFrontmatter(text);
      text = `---\nname: ${fields.name}\ndescription: ${JSON.stringify(fields.description)}\n---\n${mark}\n${body}`;
    } else if (f.endsWith('.md')) {
      text = `${mark}\n${text}`;
    }
    files[`.gemini/skills/${name}/${rel}`] = text;
  }
  return files;
}

/** Commandes pré-approuvées (`allow`) au format Gemini. Gemini compare par
 * préfixe : une règle exacte de Claude y deviendrait un préfixe
 * (« npm audit --audit-level=high » couvrirait « … fix », « npm run lint »
 * couvrirait « npm run lint -- --fix ») — seules les règles déjà en préfixe
 * passent ; test/agents.test.js vérifie qu'aucune ne couvre une commande qui
 * écrit. */
function geminiSettings(root) {
  const allow = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8')).permissions.allow;
  const allowed = allow.filter((r) => /^Bash\(.*\*\)$/.test(r))
    .map((r) => `run_shell_command(${r.slice(5, -1).replace(/:?\*$/, '').trim()})`);
  return JSON.stringify({ context: { fileName: ['AGENTS.md'] }, tools: { allowed } }, null, 2) + '\n';
}

/** Chemin relatif (POSIX) → contenu attendu de chaque fichier généré. */
function expectedFiles(root = ROOT) {
  const out = {};
  const agentsDir = path.join(root, '.claude', 'agents');
  for (const f of fs.readdirSync(agentsDir).filter((n) => n.endsWith('.md')).sort()) {
    const file = path.join(agentsDir, f);
    const stem = path.basename(f, '.md');
    out[`.github/agents/${stem}.agent.md`] = copilotAgent(file);
    out[`.gemini/agents/${stem}.md`] = geminiAgent(file);
    out[`.gemini/commands/${stem}.toml`] = geminiCommand(file);
  }
  const skillsDir = path.join(root, '.claude', 'skills');
  for (const d of fs.readdirSync(skillsDir).sort()) {
    if (fs.existsSync(path.join(skillsDir, d, 'SKILL.md'))) Object.assign(out, geminiSkill(root, path.join(skillsDir, d)));
  }
  out['.gemini/settings.json'] = geminiSettings(root);
  return out;
}

/** Fichiers générés autrefois (marqués) dont la source a disparu. */
function orphans(root, expected) {
  const found = [];
  for (const dir of [path.join(root, '.github', 'agents'), path.join(root, '.gemini')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of walk(dir)) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      if (!(rel in expected) && fs.readFileSync(f, 'utf8').includes(MARK)) found.push(rel);
    }
  }
  return found;
}

/** Fichiers absents, périmés ou orphelins (liste vide = tout est à jour). */
function gaps(root = ROOT) {
  const expected = expectedFiles(root);
  const out = [];
  for (const [rel, content] of Object.entries(expected)) {
    const f = path.join(root, rel);
    if (!fs.existsSync(f)) out.push(`absent : ${rel}`);
    else if (lf(fs.readFileSync(f, 'utf8')) !== content) out.push(`périmé : ${rel}`);
  }
  return out.concat(orphans(root, expected).map((rel) => `orphelin : ${rel}`));
}

function generate(root = ROOT) {
  const expected = expectedFiles(root);
  const written = [];
  for (const [rel, content] of Object.entries(expected)) {
    const f = path.join(root, rel);
    if (!fs.existsSync(f) || lf(fs.readFileSync(f, 'utf8')) !== content) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content, 'utf8');
      written.push(rel);
    }
  }
  for (const rel of orphans(root, expected)) {
    fs.unlinkSync(path.join(root, rel));
    written.push(`${rel} (supprimé)`);
  }
  return written;
}

function main(args) {
  if (args.includes('--verifier')) {
    const problems = gaps();
    for (const p of problems) console.log(p);
    if (problems.length) {
      console.log('Intégrations à régénérer : node scripts/generer-integrations.js');
      return 1;
    }
    console.log('Intégrations à jour.');
    return 0;
  }
  const written = generate();
  console.log(written.length ? written.join('\n') : 'Rien à régénérer : intégrations à jour.');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { parseFrontmatter, translateTools, expectedFiles, gaps, generate, MARK, TOOLS_COPILOT, TOOLS_GEMINI };
