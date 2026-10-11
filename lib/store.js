// Paths and small JSON/JSONL helpers. Everything lives under ~/.claude (or CLAUDE_CONFIG_DIR).
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
const STATE_DIR = process.env.SKILLFORGE_STATE || path.join(CLAUDE_DIR, 'skillforge');

const DEFAULT_CONFIG = {
  mode: 'propose',          // propose | auto-draft | off
  minTools: 6,              // a turn needs this many tool calls to count as a "task"
  painfulTools: 25,         // ...or this many to be "painful" on its own
  painfulErrors: 3,         // ...or this many failed tool calls
  repeatThreshold: 2,       // similar tasks seen (including this one) before proposing a skill
  similarity: 0.45,         // task-signature similarity cut-off (0..1)
  maxPromptsPerSession: 1,  // never nag more than this per session
  archiveDays: 60,          // managed skills unused this long are archive candidates
  refineAfter: 3,           // journal entries that justify a rewrite
};

const p = (...parts) => path.join(STATE_DIR, ...parts);

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function readJSONL(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function appendJSONL(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

const config = () => ({ ...DEFAULT_CONFIG, ...readJSON(p('config.json'), {}) });
const metrics = () => readJSON(p('metrics.json'), { skills: {} });
const saveMetrics = (m) => writeJSON(p('metrics.json'), m);

module.exports = {
  CLAUDE_DIR, SKILLS_DIR, STATE_DIR, DEFAULT_CONFIG, p,
  readJSON, writeJSON, readJSONL, appendJSONL, config, metrics, saveMetrics,
};
