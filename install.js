#!/usr/bin/env node
// Skillforge — installer / uninstaller.
//   npx github:dfadify-web/skillforge              install (or update)
//   npx github:dfadify-web/skillforge --uninstall  remove the hook and the skill folder (your skills and state stay)
//   node install.js [--uninstall]                   same, from a local clone
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SKILL_DIR = path.join(CLAUDE_DIR, 'skills', 'skillforge');
const STATE_DIR = path.join(CLAUDE_DIR, 'skillforge');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const MARK = 'skillforge/hooks/';
const SKIP = new Set(['.git', '.github', 'node_modules', 'test', '.gitignore', 'docs']);

const uninstall = process.argv.includes('--uninstall');
const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => { console.error(`\x1b[31m✗\x1b[0m ${m}`); process.exit(1); };

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) fail(`Node 18+ required (you have ${process.versions.node}).`);

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(f.name)) continue;
    const s = path.join(src, f.name), d = path.join(dst, f.name);
    f.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

fs.mkdirSync(CLAUDE_DIR, { recursive: true });

// 1. settings.json: drop our previous hook entries, then add them again (unless uninstalling)
let settings = {};
if (fs.existsSync(SETTINGS)) {
  const raw = fs.readFileSync(SETTINGS, 'utf8');
  try { settings = raw.trim() ? JSON.parse(raw) : {}; } catch { fail(`${SETTINGS} is not valid JSON; fix it and run again.`); }
  fs.writeFileSync(SETTINGS + '.skillforge-backup', raw);
}
settings.hooks = settings.hooks || {};
for (const ev of Object.keys(settings.hooks)) {
  if (!Array.isArray(settings.hooks[ev])) continue;
  settings.hooks[ev] = settings.hooks[ev]
    .map((m) => ({ ...m, hooks: (m.hooks || []).filter((h) => !String(h.command || '').replace(/\\/g, '/').includes(MARK)) }))
    .filter((m) => m.hooks.length);
  if (!settings.hooks[ev].length) delete settings.hooks[ev];
}

if (!uninstall) {
  if (path.resolve(__dirname) !== path.resolve(SKILL_DIR)) {
    fs.rmSync(SKILL_DIR, { recursive: true, force: true });
    copyDir(__dirname, SKILL_DIR);
  }
  ok(`Skill installed in ${SKILL_DIR}`);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  // Stop must be synchronous: it may return {"decision":"block"} to make Claude reflect before finishing.
  const command = `node "${path.join(SKILL_DIR, 'hooks', 'stop.js').replace(/\\/g, '/')}"`;
  (settings.hooks.Stop = settings.hooks.Stop || []).push({ hooks: [{ type: 'command', command, timeout: 10 }] });
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;
fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
ok(uninstall ? `Hook removed from ${SETTINGS}` : `Stop hook registered in ${SETTINGS} (backup: settings.json.skillforge-backup)`);

if (uninstall) {
  try { fs.rmSync(SKILL_DIR, { recursive: true, force: true }); ok(`Removed ${SKILL_DIR}`); } catch {}
  console.log(`\nSkillforge uninstalled. Your generated skills and ${STATE_DIR} were kept.`);
} else {
  console.log('\n🔨 Skillforge is ready. Open a new Claude Code session and work as usual —');
  console.log('   repeated or painful tasks will be offered as skills, and managed skills learn from every use.');
  console.log('   Manual: /skillforge · /skillforge review · /skillforge stats\n');
}
