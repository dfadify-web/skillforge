# 🔨 Skillforge

**Claude Code skills that write and improve themselves.**

[Español](README.es.md)

You keep explaining the same things to Claude: how you deploy, which test runner you use, that gotcha in your build. Skillforge turns that into skills automatically — and keeps them getting better.

```
 capture ──► detect pattern ──► create skill ──► use ──► learn ──► refine ──► merge / archive
    ▲                                                                   │
    └───────────────────────────────────────────────────────────────────┘
```

## How it works

A single `Stop` hook looks at every turn when Claude finishes (fast, offline, no LLM calls):

| Situation | What happens |
|---|---|
| You do a **similar task for the 2nd time** (keyword + tool signature) | Claude offers, in one line, to turn it into a skill |
| A task was **painful** (25+ tool calls, 3+ errors, or you corrected Claude) | Same offer, right away |
| A **managed skill** was used and something failed or you corrected it | Claude writes the lesson to the skill's journal; with enough evidence it **refines** the skill |
| Anything else | Nothing. Silence. |

Guardrails, because self-modifying things need them:

- **At most one nudge per session.** If you say no, similar tasks are never proposed again.
- **It only touches skills it created** (`managed-by: skillforge`). Your own skills are never edited.
- **Every version is snapshotted.** `rollback` undoes any change.
- **Lint gate.** A generated skill must have a precise *when to use* description, required sections, under 300 lines and no secrets, or it isn't saved.
- **Secrets and emails are scrubbed** before anything is written to a journal.
- **Refines only on evidence.** One explicit correction from you, or 3 journal lessons. Never "just because".

## Install

```bash
npx github:dfadify-web/skillforge
```

This copies the skill to `~/.claude/skills/skillforge` and registers one `Stop` hook in `~/.claude/settings.json` (a backup is saved next to it). Requires Node 18+.

Uninstall (your generated skills are kept):

```bash
npx github:dfadify-web/skillforge --uninstall
```

## Use

Just work. When it makes sense, Claude ends with something like:

> *This is the 2nd time we set up a React component with tests. Shall I turn it into a skill? /skillforge*

Manual commands:

| Command | |
|---|---|
| `/skillforge` | Turn what we just did into a skill (or improve the one that covers it) |
| `/skillforge review` | Pending proposals, skills ready to refine, overlaps to merge, stale skills |
| `/skillforge stats` | Uses, successes and corrections per skill |
| `/skillforge improve <skill>` | Apply the journal's lessons now |
| `/skillforge rollback <skill> [n]` | Go back n versions |
| `/skillforge mode propose\|auto-draft\|off` | `propose` (default) asks first; `auto-draft` creates drafts without asking |

## Anatomy of a generated skill

```markdown
---
name: react-component-test
description: Creates a React component with a Vitest test and story. Use when the user asks "create a component", "component with tests"...
managed-by: skillforge
version: 3
---
## When to use / Steps / Gotchas / Verification / Changelog
```

`Gotchas` is where your corrections end up: *"used Jest → this repo uses Vitest"*. That is the part that makes the next run better.

## Files

| Path | |
|---|---|
| `hooks/stop.js` | The hook: transcript analysis, ledger, decisions |
| `lib/` | transcript parser, task signatures, secret scrubber, lint + version history |
| `bin/forge.js` | CLI used by Claude: `stats`, `review`, `commit`, `journal`, `rollback`, `archive`, `pending`, `mode` |
| `~/.claude/skillforge/` | State: `config.json`, `ledger.jsonl`, `journal/`, `history/`, `metrics.json`, `pending.json` |

Tune the thresholds in `~/.claude/skillforge/config.json` (`minTools`, `repeatThreshold`, `similarity`, `refineAfter`, `archiveDays`...).

## Tests

```bash
npm test
```

## License

MIT
