const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Isolated ~/.claude for every run.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'skillforge-'));
process.env.CLAUDE_CONFIG_DIR = ROOT;
delete process.env.SKILLFORGE_STATE;
const ENV = { ...process.env, CLAUDE_CONFIG_DIR: ROOT };
const FORGE = path.join(__dirname, '..', 'bin', 'forge.js');
const forge = (...a) => execFileSync(process.execPath, [FORGE, ...a], { env: ENV, encoding: 'utf8' });

const { analyzeLastTurn } = require('../lib/transcript');
const { keywords, similarity } = require('../lib/similarity');
const { scrub } = require('../lib/scrub');
const { decide } = require('../hooks/stop');
const skills = require('../lib/skills');
const store = require('../lib/store');

const prompt = (text, sid = 's1') => ({ type: 'user', sessionId: sid, cwd: '/proj', message: { role: 'user', content: text } });
const tool = (name, input = {}) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const result = (isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', is_error: isError, content: 'x' }] } });

function transcript(lines) {
  const file = path.join(ROOT, `t-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
  return file;
}
function task(text, { tools = 8, errors = 0, sid = 's1', extra = [] } = {}) {
  const lines = [prompt(text, sid), ...extra];
  for (let i = 0; i < tools; i++) lines.push(tool(i % 2 ? 'Edit' : 'Bash'), result(i < errors));
  return transcript(lines);
}
function writeSkill(name, { managed = true, version = 1, extra = '' } = {}) {
  const dir = path.join(ROOT, 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---
name: ${name}
description: Crea componentes React con su test unitario y story. Úsala cuando el usuario pida "crea un componente", "componente con test" o similar.
${managed ? 'managed-by: skillforge\n' : ''}version: ${version}
---

# ${name}

## Cuándo usar
- componentes

## Pasos
1. crear archivo
${extra}
## Gotchas
- nada

## Verificación
- npm test

## Changelog
- v${version}: test
`);
}

test('analyzeLastTurn counts tools, errors, skills and corrections', () => {
  const file = transcript([
    prompt('haz una cosa'), tool('Skill', { skill: 'old-skill' }), result(),
    prompt('no, así no, te dije que usaras pnpm'),
    tool('Bash'), result(true), tool('Edit'), result(),
  ]);
  const t = analyzeLastTurn(require('../lib/store').readJSONL(file));
  assert.equal(t.toolCount, 2);
  assert.equal(t.errors, 1);
  assert.equal(t.corrections, 1);
  assert.deepEqual(t.skills, ['old-skill']); // previous turn's skill is blamed by the correction
});

test('slash command counts as a skill and system lines are not prompts', () => {
  const file = transcript([
    prompt('<command-name>/deploy-web</command-name>'), tool('Bash'), result(),
    { type: 'user', message: { content: '<local-command-stdout>ok</local-command-stdout>' } },
  ]);
  const t = analyzeLastTurn(store.readJSONL(file));
  assert.deepEqual(t.skills, ['deploy-web']);
});

test('keywords and similarity group similar tasks', () => {
  const a = { kw: keywords('Crea un componente React con test para el botón de login'), tools: ['Edit', 'Bash'] };
  const b = { kw: keywords('crea un componente react con su test para el boton de registro'), tools: ['Edit', 'Bash'] };
  const c = { kw: keywords('despliega la landing en vercel y configura el dominio'), tools: ['Bash'] };
  assert.ok(similarity(a, b) >= 0.45, `similar ${similarity(a, b)}`);
  assert.ok(similarity(a, c) < 0.45, `different ${similarity(a, c)}`);
});

test('scrub removes secrets and emails', () => {
  const s = scrub('key sk-ant-abcdefghijklmnopqrstuvwxyz and ghp_abcdefghijklmnopqrstuvwxyz123 mail a.b@c.com api_key=supersecretvalue');
  assert.ok(!/sk-ant-a|ghp_a|a\.b@c|supersecret/.test(s), s);
});

test('stop hook: ignores stop_hook_active and small turns', () => {
  assert.equal(decide({ stop_hook_active: true, transcript_path: task('x') }), null);
  assert.equal(decide({ session_id: 'small', transcript_path: task('cambia el color del botón', { tools: 2 }) }), null);
});

test('stop hook: proposes a skill on the 2nd similar task, once per session', () => {
  const first = decide({ session_id: 'a1', transcript_path: task('crea un componente react con test para el login') });
  assert.equal(first, null);
  const second = decide({ session_id: 'a2', transcript_path: task('crea un componente react con test para el registro') });
  assert.equal(second.decision, 'block');
  assert.match(second.reason, /2ª vez/);
  const pend = store.readJSON(store.p('pending.json'), []);
  assert.equal(pend.length, 1);
  // same session: no second nudge
  assert.equal(decide({ session_id: 'a2', transcript_path: task('despliega la landing en vercel con dominio', { tools: 30 }) }), null);
  // already pending: no duplicate proposal in another session
  assert.equal(decide({ session_id: 'a3', transcript_path: task('crea un componente react con test para el perfil') }), null);
});

test('stop hook: painful task is proposed immediately; dismissed tasks never again', () => {
  const r = decide({ session_id: 'b1', transcript_path: task('migra la base de datos postgres a supabase', { tools: 10, errors: 4 }) });
  assert.equal(r.decision, 'block');
  const id = store.readJSON(store.p('pending.json'), []).find((x) => x.kw.includes('postgres')).id;
  forge('pending', 'dismiss', id);
  assert.equal(decide({ session_id: 'b2', transcript_path: task('migra la base de datos postgres a supabase otra vez', { tools: 10, errors: 4 }) }), null);
});

test('stop hook: managed skill with a correction asks to journal and refine', () => {
  writeSkill('react-component-test');
  const file = transcript([
    prompt('usa la skill'), tool('Skill', { skill: 'react-component-test' }), result(),
    prompt('no funciona, te dije que con vitest'), tool('Edit'), result(),
  ]);
  const r = decide({ session_id: 'c1', transcript_path: file });
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /react-component-test/);
  assert.match(r.reason, /Refinar/);
  const m = store.metrics().skills['react-component-test'];
  assert.equal(m.corrections, 1);
});

test('mode off disables the hook', () => {
  forge('mode', 'off');
  assert.equal(decide({ session_id: 'd1', transcript_path: task('algo muy doloroso con docker compose', { tools: 40 }) }), null);
  forge('mode', 'propose');
});

test('CLI: lint, commit, journal, rollback, never touches unmanaged skills', () => {
  writeSkill('react-component-test', { version: 1 });
  assert.match(forge('commit', 'react-component-test', 'creada'), /v1 guardada/);
  forge('journal', 'react-component-test', 'usaba jest → usar vitest; token sk-ant-abcdefghijklmnopqrstuvwxyz');
  const journal = fs.readFileSync(store.p('journal', 'react-component-test.md'), 'utf8');
  assert.ok(!journal.includes('sk-ant-a'));
  assert.equal(store.metrics().skills['react-component-test'].journalPending, 1);

  writeSkill('react-component-test', { version: 2, extra: '2. usar vitest\n' });
  forge('commit', 'react-component-test', 'vitest');
  assert.equal(store.metrics().skills['react-component-test'].journalPending, 0);
  forge('rollback', 'react-component-test');
  assert.match(skills.read('react-component-test'), /version: 1/);

  writeSkill('user-own', { managed: false });
  assert.throws(() => forge('commit', 'user-own', 'x'));
  assert.match(skills.read('user-own'), /^---/); // untouched

  writeSkill('bad-skill');
  fs.writeFileSync(skills.skillFile('bad-skill'), '---\nname: bad-skill\ndescription: corta\nmanaged-by: skillforge\nversion: 1\n---\nnada\n');
  assert.throws(() => forge('lint', 'bad-skill'));
  assert.match(forge('stats'), /react-component-test/);
});

test('installer adds and removes only its own hook', () => {
  const settings = path.join(ROOT, 'settings.json');
  const original = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node other.js' }] }] }, model: 'opus' };
  fs.writeFileSync(settings, JSON.stringify(original, null, 2) + '\n');
  const install = path.join(__dirname, '..', 'install.js');
  execFileSync(process.execPath, [install], { env: ENV });
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(after.hooks.Stop.length, 2);
  assert.ok(fs.existsSync(path.join(ROOT, 'skills', 'skillforge', 'SKILL.md')));
  execFileSync(process.execPath, [install], { env: ENV }); // idempotent
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).hooks.Stop.length, 2);
  execFileSync(process.execPath, [install, '--uninstall'], { env: ENV });
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), original);
});
