// Managed skills: discovery, frontmatter, lint and version history.
const fs = require('fs');
const path = require('path');
const { SKILLS_DIR, p } = require('./store');
const { findSecrets } = require('./scrub');
const { keywords } = require('./similarity');

const SELF = 'skillforge';
const skillFile = (name) => path.join(SKILLS_DIR, name, 'SKILL.md');

function parseFrontmatter(text) {
  const m = String(text).match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: null, body: String(text) };
  const data = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      data[key] = /^[>|][-+]?$/.test(kv[2]) ? '' : kv[2].replace(/^["']|["']$/g, '');
    } else if (key && /^\s+\S/.test(line)) {
      data[key] = (data[key] ? data[key] + ' ' : '') + line.trim();
    }
  }
  return { data, body: String(text).slice(m[0].length) };
}

function read(name) {
  try { return fs.readFileSync(skillFile(name), 'utf8'); } catch { return null; }
}

function isManaged(name) {
  const t = read(name);
  if (!t) return false;
  const { data } = parseFrontmatter(t);
  return !!data && data['managed-by'] === SELF;
}

function listManaged() {
  let dirs = [];
  try { dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }); } catch { return []; }
  return dirs.filter((d) => d.isDirectory() && d.name !== SELF && isManaged(d.name)).map((d) => d.name);
}

const signatureOf = (name, data) => keywords(`${name.replace(/-/g, ' ')} ${data.description || ''}`, 12);

const SECTIONS = [
  ['## Cuándo usar', '## When to use'],
  ['## Pasos', '## Steps'],
  ['## Gotchas'],
  ['## Verificación', '## Verification'],
  ['## Changelog'],
];

function lint(name) {
  const errors = [];
  const text = read(name);
  if (text == null) return [`No existe ${skillFile(name)}`];
  const { data, body } = parseFrontmatter(text);
  if (!data) return ['Falta el frontmatter (--- name/description ---)'];
  if (data.name !== name) errors.push(`name "${data.name}" debe coincidir con la carpeta "${name}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) errors.push('El nombre debe ser kebab-case (≤64)');
  const d = data.description || '';
  if (d.length < 60 || d.length > 1024) errors.push(`description debe tener 60–1024 caracteres (tiene ${d.length})`);
  if (!/(úsala|usala|usar cuando|cuando|use when|use it|trigger|siempre que|whenever)/i.test(d)) {
    errors.push('description debe decir CUÁNDO usarla ("Úsala cuando…" / "Use when…") con frases concretas del usuario');
  }
  if (data['managed-by'] !== SELF) errors.push(`Falta "managed-by: ${SELF}" en el frontmatter`);
  if (!/^\d+$/.test(data.version || '')) errors.push('Falta "version: <entero>" en el frontmatter');
  for (const alts of SECTIONS) {
    if (!alts.some((h) => body.includes(h))) errors.push(`Falta la sección "${alts[0]}"`);
  }
  const lines = body.split('\n').length;
  if (lines > 300) errors.push(`Cuerpo demasiado largo (${lines} líneas > 300): mueve detalle a archivos de referencia`);
  const secrets = findSecrets(text);
  if (secrets.length) errors.push(`Posibles secretos/datos personales: ${secrets.join(', ')}`);
  return errors;
}

// ---- history: every committed version is snapshotted, rollback restores one ----
const histDir = (name) => p('history', name);

function versions(name) {
  try { return fs.readdirSync(histDir(name)).filter((f) => f.endsWith('.md')).sort(); } catch { return []; }
}

function snapshot(name, label = '') {
  const text = read(name);
  if (text == null) throw new Error(`No existe la skill ${name}`);
  const dir = histDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const n = String(versions(name).length + 1).padStart(3, '0');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${n}-${stamp}${label ? '-' + label : ''}.md`);
  fs.writeFileSync(file, text);
  return file;
}

function rollback(name, steps = 1) {
  const list = versions(name);
  const target = list[list.length - 1 - steps];
  if (!target) throw new Error(`No hay ${steps} versión(es) anteriores de ${name} (hay ${list.length})`);
  fs.writeFileSync(skillFile(name), fs.readFileSync(path.join(histDir(name), target)));
  snapshot(name, 'rollback');
  return target;
}

module.exports = {
  SELF, skillFile, parseFrontmatter, read, isManaged, listManaged, signatureOf, lint, versions, snapshot, rollback,
};
