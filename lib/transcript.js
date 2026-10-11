// Reads a Claude Code transcript (JSONL) and summarises the last turn.
const { readJSONL } = require('./store');

// User pushback, in Spanish and English. A match means the previous attempt was wrong.
const CORRECTION = new RegExp([
  'no,? asi no', 'asi no es', 'eso no es', 'esta mal', 'estas mal', 'te (?:he )?dicho', 'te dije',
  'no funciona', 'sigue (?:sin funcionar|fallando|igual|mal)', 'otra vez (?:mal|lo mismo)', 'no es (?:eso|lo que)',
  'deshaz', 'revierte', 'no hagas', 'no toques', 'por que has',
  "that'?s wrong", 'not what i', 'i told you', "doesn'?t work", 'still (?:broken|failing|wrong)',
  'undo (?:that|this)', 'revert (?:that|this|it)', "don'?t do", 'why did you',
].map((s) => `\\b${s}`).join('|'), 'i');

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
}

function isPrompt(e) {
  if (!e || e.type !== 'user' || e.isMeta || e.isCompactSummary || !e.message) return false;
  const c = e.message.content;
  if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return false;
  const t = textOf(c).trim();
  if (!t || t.startsWith('<local-command') || t.startsWith('[Request interrupted')) return false;
  if (t.startsWith('This session is being continued from a previous conversation')) return false;
  return !/^(<system-reminder>[\s\S]*?<\/system-reminder>\s*)+$/.test(t);
}

const stripSkill = (s) => String(s || '').replace(/^\//, '').split(':').pop().trim();

function summarise(turn, prompt) {
  const tools = [], skills = new Set();
  let errors = 0, interrupts = 0;
  const cmd = prompt.match(/<command-name>\/?([^<]+)<\/command-name>/);
  if (cmd) skills.add(stripSkill(cmd[1]));
  for (const e of turn) {
    const c = e.message && e.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b) continue;
      if (e.type === 'assistant' && b.type === 'tool_use') {
        tools.push(b.name);
        if (b.name === 'Skill' && b.input && b.input.skill) skills.add(stripSkill(b.input.skill));
      } else if (e.type === 'user' && b.type === 'tool_result' && b.is_error) {
        errors++;
      } else if (e.type === 'user' && b.type === 'text' && /\[Request interrupted by user/.test(b.text || '')) {
        interrupts++;
      }
    }
  }
  return { tools, skills: [...skills], errors, interrupts };
}

// Returns null when there is no user prompt yet.
function analyzeLastTurn(entries) {
  const idx = [];
  entries.forEach((e, i) => { if (isPrompt(e)) idx.push(i); });
  if (!idx.length) return null;
  const start = idx[idx.length - 1];
  const prevStart = idx.length > 1 ? idx[idx.length - 2] : -1;
  const first = entries[start];
  const prompt = textOf(first.message.content);
  const cur = summarise(entries.slice(start), prompt);
  const corrections = (CORRECTION.test(fold(prompt).slice(0, 400)) ? 1 : 0) + cur.interrupts;
  // A correction blames the work done in the previous turn, so its skills count too.
  let skills = cur.skills;
  if (corrections && prevStart >= 0) {
    const prev = summarise(entries.slice(prevStart, start), textOf(entries[prevStart].message.content));
    skills = [...new Set([...skills, ...prev.skills])];
  }
  return {
    prompt,
    prevPrompt: prevStart >= 0 ? textOf(entries[prevStart].message.content) : '',
    tools: cur.tools,
    toolCount: cur.tools.length,
    errors: cur.errors,
    corrections,
    skills,
    sessionId: first.sessionId || null,
    cwd: first.cwd || null,
  };
}

const analyzeFile = (file) => analyzeLastTurn(readJSONL(file));

module.exports = { analyzeLastTurn, analyzeFile, isPrompt, textOf, CORRECTION, fold };
