// Remove secrets before anything is written to a journal or a skill.
const PATTERNS = [
  /\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{16,}/g,          // Anthropic / OpenAI / OpenRouter
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                         // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,                             // Google API keys
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                       // Slack
  /\bAKIA[0-9A-Z]{16}\b/g,                                 // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\b(?:bearer|token|api[_-]?key|secret|password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,  // emails
];

function scrub(text) {
  let out = String(text || '');
  for (const re of PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

function findSecrets(text) {
  const hits = [];
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    const m = String(text || '').match(re);
    if (m) hits.push(...m.map((s) => s.slice(0, 12) + '…'));
  }
  return hits;
}

module.exports = { scrub, findSecrets };
