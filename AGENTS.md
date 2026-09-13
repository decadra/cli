# Decadra agent guide

This file is a router. It carries the rules that must never be broken and points to everything else. `CLAUDE.md` imports it; Codex reads it directly. Read the two tables below before touching code, then follow the links for the area you are working in.

## What Decadra is

A TypeScript CLI that answers one question per AI coding provider: does the plan you pay for fit the usage you put through it. It wraps ccusage for token and cost ingest, adds thin native readers where ccusage has nothing, and layers plan-fit math, a per-session effort read, and an in-session readout (`decadra now`, called from an agent's `!` shell) on top. It is not a session log parser and it never ranks providers.

Status: slices 1, 2, 3 and 6 of the master plan are in. Open work is listed in `docs/plans/README.md`.

## Hard constraints

| Constraint | Enforced by |
|---|---|
| Never print a cross-provider verdict. No "switch to X", no ranking, no usage totals across providers. The bill line (prices paid) is the one carve-out. | Report type, single render loop, strict JSON keys, fixed templates, ESLint import fences, `test/guard.test.ts`. Details: `docs/architecture/constraints.md`, `docs/decisions/0002`, `0003`. |
| Read only on session files. | Readers open for reading; `test/invariants.test.ts` greps for writes. |
| No network except opt-in subcommands under `src/net/`. ccusage always `--offline`. | ESLint `no-restricted-globals`, `test/ccusage-args.test.ts`. |
| Plan prices live in hand-maintained `~/.decadra/plans.json`, created once, never overwritten. | `config/plans.ts`, `test/plans.test.ts`. |

If a change needs an exception to any row, stop and say so.

## Where to read next

| You are about to | Read |
|---|---|
| Change any code | `docs/architecture/overview.md`, then `constraints.md` |
| Touch a command's output or JSON | `docs/architecture/commands.md`, `src/report/model.ts`, the command's `*.schema.ts` |
| Add or change a provider or reader | `docs/adding-a-provider.md`, the `add-provider` and `redact-fixture` skills in `.claude/skills/` |
| Touch `~/.decadra` files | `docs/architecture/data-files.md` |
| Write or change a test | `docs/testing/README.md`, `scenarios.md`, `invariants.md` |
| Verify on a real terminal | `docs/testing/manual-checklist.md` |
| Understand why something is the way it is | `docs/decisions/` |
| Plan new work | `docs/plans/README.md`; write a new dated plan, do not edit old ones |
| Learn what ccusage does and does not accept | `docs/decisions/0006-ccusage-invocation-rules.md` |

## Running checks

```
npm install
npm run check        # lint, typecheck, tests, build
node dist/cli.js doctor
```

All green before pushing. A push that turns CI red costs a review cycle.

## Conventions

- TypeScript strict, ESM, Node 22.13 or later. Zod schema for every external input.
- UTC everywhere. Output headers say so.
- Commit messages: imperative subject under 72 characters, body explains why, one concern per commit.
- No model identifiers in prose: not in a commit subject or body, a code comment, or a document. The rule is about prose, because naming the model that wrote something tells a reader nothing about the code and dates the moment it changes. A `Co-Authored-By` trailer is attribution, not prose, and is required by the tooling; it is outside this rule. Vendor tool versions a reader was verified against are facts about someone else's software and are outside it too.
- Prose in docs and output: plain sentences, no dashes used as punctuation, no marketing language.
- Fixtures are real files redacted with the `redact-fixture` skill, never synthetic.

## Do not

- Do not add `codeburn`, `better-sqlite3`, or any native dependency.
- Do not call ccusage without `--offline`. Do not pass `--mode` to the codex source.
- Do not re-price `cacheCreationTokens` from daily JSON; it sums 1-hour and 5-minute cache writes into one count, and no single rate is right for it.
- Do not reconstruct a cwd from a Claude project directory name; read the `cwd` field.
- Do not count `type: user` lines as human turns without checking `origin.kind`.
- Do not count an assistant record whose model is `<synthetic>`; it stands in for a reply that never came, and counting it invents a model nobody billed for.
- Do not read `subagents/` directories when counting turns.
- Do not sum anything across providers.
- Do not write under `~/.claude`, `~/.codex`, `~/.cursor`, `~/.local/share/devin`, or `~/.local/share/muse`.
- Do not add a runtime banned-phrase scan and call it enforcement.
