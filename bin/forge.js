#!/usr/bin/env node
// Skillforge CLI. Used by Claude (via SKILL.md) and by humans.
//   forge.js stats | list | review
//   forge.js lint <skill>
//   forge.js commit <skill> "<changelog>" [--pending <id>]   lint + snapshot + metrics (create or improve)
//   forge.js journal <skill> "<lesson>"                      append a lesson learnt
//   forge.js rollback <skill> [steps]                        restore an earlier version
//   forge.js archive <skill> | archive --stale [--yes]
//   forge.js pending [list] | pending done <id> | pending dismiss <id>
//   forge.js mode [propose|auto-draft|off]
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const skills = require('../lib/skills');
const { scrub } = require('../lib/scrub');
const { jaccard } = require('../lib/similarity');

const [cmd = 'stats', ...args] = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--pending');
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`✓ ${msg}`);
const today = () => new Date().toISOString().slice(0, 10);
const daysSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 864e5 : Infinity);

function needManaged(name) {
  if (!name) die('Falta el nombre de la skill');
  if (!skills.read(name)) die(`No existe ${skills.skillFile(name)}`);
  if (!skills.isManaged(name)) die(`"${name}" no está gestionada por skillforge (falta managed-by: skillforge). No la toco.`);
}

function journalFile(name) {
  fs.mkdirSync(store.p('journal'), { recursive: true });
  return store.p('journal', `${name}.md`);
}

function staleList(cfg, m) {
  return skills.listManaged().filter((s) => {
    const r = m.skills[s] || {};
    return daysSince(r.lastUsed || r.created) > cfg.archiveDays;
  });
}

function overlaps(m) {
  const list = skills.listManaged();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = (m.skills[list[i]] || {}).keywords, b = (m.skills[list[j]] || {}).keywords;
      const s = jaccard(a, b);
      if (a && b && s >= 0.5) out.push([list[i], list[j], s]);
    }
  }
  return out;
}

const cmds = {
  stats() {
    const m = store.metrics();
    const list = skills.listManaged();
    if (!list.length) return console.log('Aún no hay skills gestionadas. Usa /skillforge al terminar una tarea que quieras repetir.');
    console.log('skill'.padEnd(32) + 'ver  usos  ok   corr  journal  último uso');
    for (const s of list) {
      const r = m.skills[s] || {};
      const { data } = skills.parseFrontmatter(skills.read(s));
      console.log(
        s.padEnd(32) + String(data.version || '?').padEnd(5) + String(r.uses || 0).padEnd(6) +
        String(r.successes || 0).padEnd(5) + String(r.corrections || 0).padEnd(6) +
        String(r.journalPending || 0).padEnd(9) + (r.lastUsed ? r.lastUsed.slice(0, 10) : '—'),
      );
    }
    const cfg = store.config();
    console.log(`\nmodo: ${cfg.mode} · ledger: ${store.readJSONL(store.p('ledger.jsonl')).length} tareas · pendientes: ${store.readJSON(store.p('pending.json'), []).length}`);
  },

  list() { for (const s of skills.listManaged()) console.log(s); },

  review() {
    const cfg = store.config(), m = store.metrics();
    const pend = store.readJSON(store.p('pending.json'), []);
    console.log(`## Propuestas pendientes (${pend.length})`);
    for (const x of pend) console.log(`- ${x.id} [${x.ts.slice(0, 10)}] ${x.kw.join(', ')} — ${x.repeats} veces, ${x.toolCount} tools · "${x.prompt.slice(0, 120).replace(/\s+/g, ' ')}"`);
    const refine = skills.listManaged().filter((s) => ((m.skills[s] || {}).journalPending || 0) >= cfg.refineAfter);
    console.log(`\n## Listas para refinar (${refine.length})`);
    for (const s of refine) console.log(`- ${s}: ${m.skills[s].journalPending} lecciones sin aplicar`);
    const weak = skills.listManaged().filter((s) => { const r = m.skills[s] || {}; return (r.uses || 0) >= 3 && (r.corrections || 0) / r.uses > 0.4; });
    console.log(`\n## Con muchas correcciones (${weak.length})`);
    for (const s of weak) console.log(`- ${s}: ${m.skills[s].corrections}/${m.skills[s].uses} usos con fallos`);
    const ov = overlaps(m);
    console.log(`\n## Posibles fusiones (${ov.length})`);
    for (const [a, b, s] of ov) console.log(`- ${a} ⟷ ${b} (similitud ${s.toFixed(2)})`);
    const stale = staleList(cfg, m);
    console.log(`\n## Sin uso > ${cfg.archiveDays} días (${stale.length})`);
    for (const s of stale) console.log(`- ${s}`);
  },

  lint() {
    const name = positional[0];
    if (!name) die('Uso: forge.js lint <skill>');
    const errs = skills.lint(name);
    if (errs.length) { errs.forEach((e) => console.error(`✗ ${e}`)); process.exit(1); }
    ok(`${name} pasa el lint`);
  },

  commit() {
    const [name, msg = ''] = positional;
    needManaged(name);
    const errs = skills.lint(name);
    if (errs.length) { errs.forEach((e) => console.error(`✗ ${e}`)); die('Lint fallido: corrige la skill y vuelve a hacer commit.'); }
    const file = skills.snapshot(name);
    const { data } = skills.parseFrontmatter(skills.read(name));
    const m = store.metrics();
    const r = (m.skills[name] = m.skills[name] || { uses: 0, successes: 0, corrections: 0, created: new Date().toISOString() });
    r.version = Number(data.version);
    r.keywords = skills.signatureOf(name, data);
    r.journalPending = 0;
    r.updated = new Date().toISOString();
    store.saveMetrics(m);
    if (msg) fs.appendFileSync(journalFile(name), `\n### v${data.version} (${today()}) — ${scrub(msg)}\n`);
    const pid = opt('--pending');
    if (pid) cmds.pending(['done', pid], true);
    ok(`${name} v${data.version} guardada (snapshot ${path.basename(file)})`);
  },

  journal() {
    const [name, ...rest] = positional;
    needManaged(name);
    const lesson = scrub(rest.join(' ')).trim();
    if (!lesson) die('Uso: forge.js journal <skill> "<lección>"');
    fs.appendFileSync(journalFile(name), `- [${today()}] ${lesson.replace(/\s+/g, ' ')}\n`);
    const m = store.metrics();
    const r = (m.skills[name] = m.skills[name] || { uses: 0, successes: 0, corrections: 0 });
    r.journalPending = (r.journalPending || 0) + 1;
    store.saveMetrics(m);
    const need = store.config().refineAfter;
    ok(`Lección anotada en ${name} (${r.journalPending}/${need} para refinar)`);
  },

  rollback() {
    const [name, steps = '1'] = positional;
    needManaged(name);
    const target = skills.rollback(name, Number(steps));
    ok(`${name} restaurada a ${target}`);
  },

  archive() {
    const cfg = store.config(), m = store.metrics();
    const targets = flag('--stale') ? staleList(cfg, m) : [positional[0]];
    if (!targets[0]) return console.log('Nada que archivar.');
    for (const s of targets) needManaged(s);
    if (flag('--stale') && !flag('--yes')) {
      console.log(`Se archivarían: ${targets.join(', ')}\nRepite con --yes para confirmarlo.`);
      return;
    }
    for (const s of targets) {
      const dst = store.p('archive', `${s}-${today()}`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(path.join(store.SKILLS_DIR, s), dst);
      ok(`${s} archivada en ${dst}`);
    }
  },

  pending(a = positional, quiet = false) {
    const [sub = 'list', id] = a;
    const file = store.p('pending.json');
    const list = store.readJSON(file, []);
    if (sub === 'list') {
      if (!list.length) return console.log('Sin propuestas pendientes.');
      for (const x of list) console.log(`${x.id}  ${x.kw.join(', ')}  (${x.repeats}×, ${x.toolCount} tools)  "${x.prompt.slice(0, 100).replace(/\s+/g, ' ')}"`);
      return;
    }
    const item = list.find((x) => x.id === id);
    if (!item) { if (quiet) return; die(`No hay propuesta ${id}`); }
    store.writeJSON(file, list.filter((x) => x.id !== id));
    if (sub === 'dismiss') {
      const d = store.readJSON(store.p('dismissed.json'), []);
      d.push({ id, kw: item.kw, tools: item.tools, ts: new Date().toISOString() });
      store.writeJSON(store.p('dismissed.json'), d);
      ok(`Propuesta ${id} descartada: no volveré a proponer tareas parecidas`);
    } else if (!quiet) ok(`Propuesta ${id} marcada como hecha`);
  },

  mode() {
    const v = positional[0];
    const cfgFile = store.p('config.json');
    const cfg = store.readJSON(cfgFile, {});
    if (!v) return console.log(`modo actual: ${store.config().mode}`);
    if (!['propose', 'auto-draft', 'off'].includes(v)) die('Modos: propose | auto-draft | off');
    cfg.mode = v;
    store.writeJSON(cfgFile, cfg);
    ok(`modo = ${v}`);
  },

  help() { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); },
};

(cmds[cmd] || cmds.help)();
