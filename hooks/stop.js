#!/usr/bin/env node
// Skillforge Stop hook. Looks at the turn that just ended and, at most once per session, asks Claude to
// either propose a new skill (repeated or painful task) or record a lesson in a managed skill's journal.
// Never fails the session: any error exits 0 silently.
const path = require('path');
const store = require('../lib/store');
const { analyzeFile } = require('../lib/transcript');
const { keywords, similarity, jaccard } = require('../lib/similarity');
const skills = require('../lib/skills');

const FORGE = `node "${path.join(__dirname, '..', 'bin', 'forge.js').replace(/\\/g, '/')}"`;
const GUIDE = path.join(store.SKILLS_DIR, skills.SELF, 'SKILL.md').replace(/\\/g, '/');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 3000);
  });
}

function decide(input, now = Date.now()) {
  if (!input || input.stop_hook_active || !input.transcript_path) return null;
  const cfg = store.config();
  if (cfg.mode === 'off') return null;

  const t = analyzeFile(input.transcript_path);
  if (!t || t.skills.includes(skills.SELF)) return null;
  const sid = input.session_id || t.sessionId || 'unknown';
  // Short follow-ups ("sigue", "dale") inherit the topic of the previous prompt.
  let kw = keywords(t.prompt);
  if (kw.length < 3 && t.prevPrompt) kw = keywords(`${t.prevPrompt}\n${t.prompt}`);
  const sig = { kw, tools: [...new Set(t.tools)] };

  // 1. Outcome bookkeeping for managed skills used in this turn.
  const managed = skills.listManaged();
  const used = t.skills.filter((s) => managed.includes(s));
  const bad = t.errors > 0 || t.corrections > 0;
  if (used.length) {
    const m = store.metrics();
    for (const s of used) {
      const r = (m.skills[s] = m.skills[s] || { uses: 0, successes: 0, corrections: 0 });
      r.uses = (r.uses || 0) + 1;
      r[bad ? 'corrections' : 'successes'] = (r[bad ? 'corrections' : 'successes'] || 0) + 1;
      r.lastUsed = new Date(now).toISOString();
    }
    store.saveMetrics(m);
  }

  // 2. Ledger of substantial tasks (the memory that lets us notice repetition).
  const ledgerFile = store.p('ledger.jsonl');
  const history = store.readJSONL(ledgerFile);
  const substantial = t.toolCount >= cfg.minTools;
  if (substantial) {
    store.appendJSONL(ledgerFile, {
      ts: new Date(now).toISOString(), session: sid, cwd: t.cwd, ...sig,
      toolCount: t.toolCount, errors: t.errors, corrections: t.corrections, skills: t.skills,
    });
  }

  // 3. Rate limit: one nudge per session.
  const sessFile = store.p('sessions.json');
  const sessions = store.readJSON(sessFile, {});
  if ((sessions[sid] || 0) >= cfg.maxPromptsPerSession) return null;

  let reason = null;
  if (used.length && bad) {
    const m = store.metrics();
    const s = used[0];
    const pending = (m.skills[s] && m.skills[s].journalPending) || 0;
    const refineNow = t.corrections > 0 || pending + 1 >= cfg.refineAfter;
    reason =
      `[Skillforge] La skill gestionada "${s}" tuvo ${t.errors} error(es) y ${t.corrections} corrección(es) del usuario en este turno. ` +
      `Antes de terminar: 1) registra la lección en una frase accionable (qué falló → regla correcta): ${FORGE} journal ${s} "<lección>". ` +
      (refineNow
        ? `2) Hay evidencia suficiente: aplica §Refinar de ${GUIDE} sobre "${s}" (edita su SKILL.md, sube version, añade changelog, luego ${FORGE} commit ${s} "<cambio>"). `
        : '2) No la reescribas todavía. ') +
      'Después dile al usuario en UNA línea qué has aprendido. No repitas tu respuesta anterior.';
  } else if (substantial && !t.skills.length && kw.length >= 2) {
    const covered = managed.some((s) => {
      const r = store.metrics().skills[s];
      return r && r.keywords && jaccard(kw, r.keywords) >= 0.4;
    });
    const dismissed = store.readJSON(store.p('dismissed.json'), []).some((d) => similarity(sig, d) >= cfg.similarity);
    const pendingList = store.readJSON(store.p('pending.json'), []);
    const already = pendingList.some((d) => similarity(sig, d) >= cfg.similarity);
    if (!covered && !dismissed && !already) {
      const repeats = history.filter((h) => similarity(sig, h) >= cfg.similarity).length + 1;
      const painful = t.toolCount >= cfg.painfulTools || t.errors >= cfg.painfulErrors || t.corrections > 0;
      if (repeats >= cfg.repeatThreshold || painful) {
        const id = 'p' + now.toString(36);
        pendingList.push({ id, ts: new Date(now).toISOString(), cwd: t.cwd, ...sig, prompt: t.prompt.slice(0, 300), repeats, toolCount: t.toolCount, errors: t.errors });
        store.writeJSON(store.p('pending.json'), pendingList);
        const why = repeats >= cfg.repeatThreshold
          ? `es la ${repeats}ª vez que haces una tarea de este tipo (${kw.join(', ')})`
          : `esta tarea ha costado ${t.toolCount} herramientas, ${t.errors} errores y ${t.corrections} correcciones`;
        reason = cfg.mode === 'auto-draft'
          ? `[Skillforge] ${why}. Crea ya una skill borrador siguiendo §Crear de ${GUIDE} (pending ${id}) y avisa al usuario en UNA línea. No repitas tu respuesta anterior.`
          : `[Skillforge] ${why}. Añade al final UNA sola línea proponiendo al usuario convertirlo en skill reutilizable ("¿La convierto en skill? /skillforge"). ` +
            `No la crees todavía. Si en su siguiente mensaje acepta, sigue §Crear de ${GUIDE} con pending ${id}; si la rechaza, ejecuta ${FORGE} pending dismiss ${id}. No repitas tu respuesta anterior.`;
      }
    }
  }

  if (!reason) return null;
  sessions[sid] = (sessions[sid] || 0) + 1;
  // keep the file small
  const keys = Object.keys(sessions);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete sessions[k];
  store.writeJSON(sessFile, sessions);
  return { decision: 'block', reason };
}

if (require.main === module) {
  readStdin()
    .then((raw) => {
      const out = decide(JSON.parse(raw || '{}'));
      if (out) process.stdout.write(JSON.stringify(out));
    })
    .catch(() => {})
    .finally(() => process.exit(0));
}

module.exports = { decide };
