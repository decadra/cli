# Decadra plan (approved 2026-09-05, scope revised the same day)

## Scope decision, revision 3

Decadra is the money meter for agent sessions. From any shell or any agent's `!` prompt it tells you what you have spent per provider, in that provider's own unit, against the plan you hold, and once a month which tier fits. Offline, read-only, never ranking providers.

- `decadra now` is the primary surface. Inside an agent session, bare `decadra` prints it instead of the home screen.
- The bill line, a sum of subscription prices from the baseline, is the one figure that spans providers. Usage is never summed.
- No charts, no TUI dashboard, no live quota polling with vendor credentials, no provider count race.
- Integration beyond the manual `!` call is deferred.

Slices 1 to 3 are done. Slice 0's probe ran on one laptop: ambiguity 18% at N=15 (rule: drop above 25%), sparsity 60% (rule: drop above 60%), Spearman 0.65 (rule: drop below 0.3), agreement with the transcript signal 87%. Decision: the transcript-detected commit call is the primary signal and the time-window count ships as a secondary, labelled column. What follows is the original approved plan; where it disagrees with this section, this section wins.


## Context

Decadra is a TypeScript CLI, published on GitHub and npm for anyone to use, that answers one question per provider: does the plan I pay for fit the usage I actually put through it. It wraps existing ingest tooling where that tooling is sound, adds a small native reader where it is not, and layers plan-fit math and a per-session effort read on top. The repo is empty.

Revision 2 changes the scope from two providers to an open set. The first-class targets are Claude Code, Codex/ChatGPT, Cursor, Devin, and Meta's Muse Code, with any other CLI that has local logs addable through config or a small adapter. The rest of this section is what was verified, because the design follows from it.

### Ingest tooling, verified

- `ccusage` v20.0.20 (2026-08-15) is one binary covering 18 CLIs (Claude Code, Codex, Gemini CLI, Copilot CLI, OpenCode, Amp, Droid, Goose, Kimi, Qwen, Grok Build, Antigravity, and more). CLI only, no library exports. `ccusage <source> daily|session --json --offline` per source, and a unified `ccusage session --json` with an `agent` field per row. Not covered: Cursor, Devin (explicitly declined: "usage lives in Devin's cloud"), Muse Code (issue #1694 opened 2026-09-05, two earlier PRs abandoned).
- Run here against this container's own transcript, `ccusage claude session --json --offline` emits `sessionId`, lossy `projectPath`, `firstActivity`, `lastActivity`, tokens, `totalCost`, `modelsUsed`, `modelBreakdowns`. No turn counts, no per-message timestamps, no real cwd. It priced this session's model at `$0.00` because the offline table predates the model. It fetches pricing over the network unless `--offline` is passed, and accepts `--config` with `defaults.pricingOverrides` keyed by raw model name.
- `codeburn` v0.9.24 (npm, MIT, updated 2026-09-04, 10.9k stars) reads 25+ tools from local files including Cursor IDE, Cursor CLI, and Devin CLI. Its Cursor token counts are estimated from character length (real counts are zero for Cursor v3 sessions), it has no per-session JSON, it fetches LiteLLM pricing and ECB exchange rates over the network by default with no documented offline switch, and it installs `better-sqlite3` at run time for Cursor. It is a useful reference implementation, not a dependency.

### Per-provider facts, verified

- Claude Code: JSONL under `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Lines carry `timestamp`, `type`, `cwd`, `gitBranch`, `sessionId`, `isSidechain`, `origin`, `version`, `message`. The human prompt has `origin.kind: "human"`; a background-agent notification also arrives as `type: user` with string content but `origin.kind: "task-notification"`. Subagent transcripts live at `<project>/<sessionId>/subagents/agent-*.jsonl`. Streaming writes several assistant lines per `message.id`. Cache tokens dominate traffic (this session's first request: 2 input, 21k cache write, 27.7k cache read).
- Codex: rollouts under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and `archived_sessions/`. Every line has `timestamp`, `type`, `payload`. Line one is `session_meta` with `id`, `timestamp`, `cwd`, `originator`, `cli_version`. Human turns are `event_msg` with `payload.type: "user_message"`. `token_count` events carry cumulative totals and a `rate_limits` snapshot (`primary`/`secondary` windows with `used_percent`, `window_minutes`, `resets_at`, `plan_type`), null in some builds.
- Cursor: plans are Pro $20 with $20 of included model usage, Pro+ $60 with $70, Ultra $200 with $400, overage billed in arrears at model API prices, Auto routing unlimited. Most spend is IDE usage, not CLI. Local data: IDE chat in `state.vscdb` (SQLite; token fields zero for v3 sessions, no cost), CLI transcripts under `~/.cursor/projects/<id>/agent-transcripts/<uuid>/<uuid>.jsonl` (role and content only; timestamps come from the SQLite `conversation_summaries` table or file mtime). The honest dollar figure is the dashboard export at Settings, Usage, Export, a CSV with columns `Date, Kind, Model, Max Mode, Input (w/ Cache Write), Input (w/o Cache Write), Cache Read, Output Tokens, Total Tokens, Cost` (a forum thread reports Cost was dropped for a period). The Admin API is Teams only. The cookie-authenticated dashboard endpoint that community tools use is undocumented and brittle.
- Devin: Core is a $20 entry with pay-as-you-go ACUs at $2.25; Team is $500 per month with 250 ACUs included at $2.00. One ACU is roughly 15 minutes of agent work. The Devin CLI (PyPI `devin-cli` 1.5.1, 2026-09-04) writes local transcripts at `~/.local/share/devin/cli/transcripts/*.json` with per-step `timestamp`, `model_name`, token `metrics`, and `metadata.committed_acu_cost`, plus `sessions.db` with `id, working_directory, model, title, created_at, last_activity_at, hidden`. Sessions handed off to or started in the cloud are not local; the API (v3, service-user keys; v1 personal keys deprecated) or the dashboard is the only source for those.
- Muse Code: launched 2026-08-05. Writes one append-only `session.jsonl` per session under `~/.local/share/muse/sessions/YYYY/MM/DD/<session-uuid>/`, subagent logs nested beneath. Events carry `input_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens` and a model name, no cost. There is no subscription and no cap: standard tier $1.25 input and $4.25 output per million tokens, contributor tier $0.10 and $0.20 with training on your data and a 100 requests-per-minute throttle. `muse export --redacted` produces a self-contained JSON.
- Plan ceilings for Anthropic and OpenAI are unpublished rolling windows. Anthropic raises weekly limits 25% on 2026-09-14. OpenAI suspended the 5-hour window for Plus and Pro in July 2026 and kept weekly caps.
- Node 22 ships `node:sqlite` without a native build (22.13 and later), which covers Devin's `sessions.db` and Cursor's `state.vscdb` without `better-sqlite3`. Verify on first use.
- The npm name `decadra` is free.

User answers: one laptop, CLI only; thin native readers approved; current plans Claude Max 20x and ChatGPT Plus, with Cursor and Devin expected; Meta means Muse Code; the tool should be public on GitHub; dashboard-only usage should be investigated rather than dismissed.

## Answer on dashboard-only usage

There is a way for each, and it is mostly not network:

| Provider | Dollars or units | Sessions and effort | Network needed |
|---|---|---|---|
| Cursor | Import the official CSV export; fall back to list-price estimate from local tokens when Cost is absent, flagged | Cursor CLI transcripts, timestamps from `state.vscdb` via `node:sqlite` | No. The cookie endpoint is rejected as unofficial and brittle |
| Devin CLI | Local transcripts carry `committed_acu_cost` per step | Same transcripts plus `sessions.db` for cwd | No |
| Devin cloud | Manual monthly entry from the dashboard, or an opt-in API adapter behind a flag | None | Only for the opt-in adapter |
| Muse Code | Local session.jsonl tokens priced by `modelPricing` | Same file | No |

## Decisions

### Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 22.13+, ESM, TypeScript strict | `node:sqlite` without native builds; `npx` distribution |
| CLI | `commander` | Typed subcommands |
| Validation | `zod` | Every external input is untrusted and versioned |
| Subprocess | `execa` | ccusage and git |
| Tables, prompts | `cli-table3`, `picocolors`, `@clack/prompts` | Enough for terminal output |
| Build, test, lint | `tsup`, `vitest`, `eslint` | Two hard constraints are lint rules |
| Ingest engine | `ccusage` pinned as a regular dependency, invoked from `node_modules/.bin`, always `--offline --timezone UTC --config <generated>` | No runtime download, no network, one pricing path |
| SQLite | `node:sqlite` | No native dependency, so `npx decadra` works everywhere |
| HTML | Template literal, inline CSS, no scripts, no CDN | Self-contained and network-free for the viewer |
| Config | Strict JSON with a shipped `plans.schema.json` referenced by `$schema`, comments in `"//"` keys | Editor validation and hover docs |
| Repo hygiene | MIT license, GitHub Actions (lint, test, build on Node 22 and 24), CHANGELOG, `docs/adding-a-provider.md`, redacted fixtures | It is going public |

Rejected: wrapping `codeburn` (network by default, runtime native install, no per-session JSON, character-estimated Cursor tokens); JSONC config; runtime `npx ccusage`; the Cursor cookie endpoint.

### Wrap where sound, native where not

ccusage owns tokens and cost for every source it supports. Decadra adds native readers only where ccusage has nothing (Cursor, Devin, Muse) or where the effort metrics need what ccusage does not emit (per-message timestamps, human turns, real cwd). Native readers extract timestamps, entry kinds, cwd, tool-call names, and per-step usage numbers; they never price tokens themselves. Pricing for native token sources (Muse) goes through the same `modelPricing` table that feeds ccusage overrides, so there is one price table.

When ccusage gains a source Decadra reads natively (Muse is likely first), the native reader keeps the effort role and the usage role moves to ccusage behind the same adapter interface. Codeburn's MIT parsers are the reference when writing the Cursor and Devin readers, with attribution.

### Provider adapter model

```ts
interface ProviderAdapter {
  id: ProviderId;                 // "anthropic-claude-code", "openai-codex", "cursor", "devin", "meta-muse"
  displayName: string;
  meter: MeterUnit;               // "usd-list" | "usd-billed" | "acu"
  usage: UsageSource;             // { kind: "ccusage", source } | { kind: "native", reader } | { kind: "import", format } | { kind: "manual" }
  sessions?: SessionReader;       // effort metrics; absent means "no session data" in output
  ceilingSignal?: CeilingSignal;  // e.g. codex rate_limits
}
```

Adapters live in `src/providers/<id>/`. A provider can also be declared purely in `plans.json` with `"ingest": { "kind": "ccusage", "source": "gemini" }` or `{ "kind": "manual" }`, no code, so users with Gemini CLI or Copilot CLI get plan-fit math on day one.

### Generic plan model

"Plan" means three different things across these vendors, so the schema carries the shape:

```json
{ "id": "max20",      "monthlyUsd": 200, "allowance": { "kind": "capped-window", "multiplierVsBase": 20 } }
{ "id": "cursor-pro", "monthlyUsd": 20,  "allowance": { "kind": "included-credit", "unit": "usd-billed", "amount": 20, "overageUsdPerUnit": 1 } }
{ "id": "devin-team", "monthlyUsd": 500, "allowance": { "kind": "included-credit", "unit": "acu", "amount": 250, "overageUsdPerUnit": 2.00 } }
{ "id": "devin-core", "monthlyUsd": 0,   "allowance": { "kind": "metered", "unit": "acu", "usdPerUnit": 2.25, "minimumUsd": 20 } }
{ "id": "muse-standard", "monthlyUsd": 0, "allowance": { "kind": "metered", "unit": "usd-list", "pricingTable": "modelPricing" } }
```

Effective monthly cost of observed usage under a plan:

- capped-window: `monthlyUsd`; ceiling risk reported from observed peak windows against the user's estimate or, for Codex, recorded `used_percent`.
- included-credit: `monthlyUsd + max(0, usage - amount) × overageUsdPerUnit`.
- metered: `max(minimumUsd, usage × usdPerUnit)` or the token-priced sum.

Break-even multiple is a derived column for capped-window plans only. Units are never converted across providers and never summed across providers.

### Verdict guard, structural

Unchanged in mechanism, now over N providers: `Report.providers` is a `Record<ProviderId, ProviderSection>`, one render loop in `report/render.ts` in alphabetical order calls `renderSection(section)` per format, `planFitLine(section)` is a fixed template over one section, the JSON schema is `zod.strict()` with a key snapshot test, lint forbids `report/*` importing `analysis/*` or `ingest/*`, and the banned-phrase and two-names-plus-amount checks run over golden and fuzzed outputs in tests. No totals row, no shared axis, no provider ordering by any metric, identical exit codes for every provider. The mixed meter units make a cross-provider sum meaningless anyway, and the types make it impossible.

### Network, read-only, privacy, time

`net/fetch-pricing.ts` and `net/devin-api.ts` are the only files allowed to reference `fetch` (eslint `no-restricted-globals` elsewhere); both run only under explicit subcommands or flags and write only under `~/.decadra/cache/` or `~/.decadra/imports/`. Session directories are opened read-only; SQLite files are opened with `readOnly: true`. `SessionRecord` has no free-text field longer than a path, and a test greps `--json` output for fixture prompt text. UTC everywhere, stated in the header.

### Agent-facing repo files

The repo will be worked on by Claude Code and Codex, so it carries one source of agent guidance and two entry points:

- `AGENTS.md` is the single source. Sections: what Decadra is and is not (one paragraph), the four hard constraints and where each is enforced in code, module rules (which directories may touch disk, process, network), the reader budget (size, no pricing, no network, no native modules, fixture and version pin required), the verdict guard and why a runtime regex is not it, the append-only rule for stores, how to run lint, tests and build, how to add a provider (pointer to `docs/adding-a-provider.md`), and commit conventions. Written so that an agent that reads nothing else does not break a constraint.
- `CLAUDE.md` contains one line importing `AGENTS.md` (`@AGENTS.md`) plus anything Claude-specific, so the two never drift.
- `.claude/agents/` and `.claude/skills/` are created in slice 1 with a README each stating their purpose, plus two starters. Agent: `provider-author.md`, a subagent brief for writing a new adapter under the reader budget with a fixture and a doctor check. Skill: `add-provider/SKILL.md`, the step list from `docs/adding-a-provider.md` in executable form, and `redact-fixture/SKILL.md`, the redaction rules for turning a real transcript into a checked-in fixture. Codex reads `AGENTS.md` directly; the skills folder is Claude Code's but the same content is linked from `CONTRIBUTING.md` for other tools.

### Rails for a future feature: scheduled plan-change alerts

Not built in slices 0 to 5, but the design makes room for it now so it does not need a rewrite:

- `analysis/planfit.ts` returns a structured value per provider, not just numbers for a table: `PlanFitVerdict = { provider, heldPlan, bestFitPlan, direction: "upgrade" | "downgrade" | "hold", monthsOfEvidence, evidence: EvidenceLine[], confidence: "low" | "medium" | "high" }`. The recommendation line renders it; a future alert rule consumes it. Direction is always within one provider. The type has no field that names another provider, so the guard holds for alerts too.
- Alert rules are pure functions over a history of verdicts, with hysteresis and cooldown built in from the start: fire only after N consecutive months point the same way (default 2), never with fewer than 30 days of data, never twice for the same direction without a baseline change in between. Rule parameters live in `settings.json` under `alerts`.
- `decadra alerts check` is the entry point: idempotent, exits 0 with no output when nothing fires, prints and appends to `alerts.jsonl` when something does, `--json` for machine use. Because it is idempotent and quiet, it is safe to run from cron, launchd, Windows Task Scheduler, or a CI schedule. `decadra alerts schedule --weekly --print` emits the platform entry, and without `--print` writes it only after confirmation, since that is a system change.
- Delivery channels are adapters with the same shape as providers: terminal, file, OS notification (`osascript` or `notify-send`), and a webhook that lives in `net/` behind an explicit opt-in. No channel is on by default.
- Alert text is built from the same fixed templates as the recommendation line, so an alert can say "on observed usage, Max 5x would have cost less with zero windows above your estimate for 2 consecutive months" and cannot say anything about another provider.

## Repository layout

```
decadra/
  package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  eslint.config.js  LICENSE (MIT)
  README.md  CHANGELOG.md  CONTRIBUTING.md
  AGENTS.md                         single source of agent guidance
  CLAUDE.md                         imports AGENTS.md
  .claude/agents/README.md  provider-author.md
  .claude/skills/README.md  add-provider/SKILL.md  redact-fixture/SKILL.md
  .github/workflows/ci.yml          lint, test, build on Node 22 and 24
  docs/adding-a-provider.md         adapter contract, fixture rules, what "thin" means
  schema/plans.schema.json
  src/
    cli.ts
    commands/   baseline.ts  assess.ts  sessions.ts  import.ts  usage.ts  doctor.ts  prices.ts  alerts.ts (stub, slice 6)
    config/     paths.ts  plans.ts  settings.ts
    providers/
      registry.ts                   id -> adapter, plus config-declared providers
      types.ts                      ProviderAdapter, UsageSource, SessionReader, MeterUnit
      anthropic-claude-code/        adapter.ts  reader.ts
      openai-codex/                 adapter.ts  reader.ts (sessions + rate_limits)
      cursor/                       adapter.ts  csv-import.ts  agent-reader.ts  state-db.ts
      devin/                        adapter.ts  transcript-reader.ts  sessions-db.ts
      meta-muse/                    adapter.ts  reader.ts
    ingest/
      ccusage.ts  ccusage.schema.ts sqlite.ts (node:sqlite wrapper, read-only)  normalize.ts  types.ts
    git/        commits.ts
    net/        fetch-pricing.ts  devin-api.ts
    analysis/   planfit.ts (returns PlanFitVerdict)  windows.ts  effort.ts  stats.ts  alert-rules.ts (slice 6)
    report/     model.ts  render.ts  terminal.ts  json.ts  html.ts  templates.ts
    store/      baseline.ts  imports.ts  manual-usage.ts   (all append-only JSONL)
  test/
    fixtures/<provider>/            real redacted files, version-pinned, one README per provider
    fixtures/ccusage/               captured v20 JSON
  scripts/probe-commit-proxy.ts
```

Module rules: `providers/*`, `ingest`, `git`, `net` are the only modules that touch disk, processes, or network. `analysis` is pure over normalized records with no provider branches. `report` imports neither `analysis` nor `ingest`. `commands` wire the layers.

## Data files under ~/.decadra

- `plans.json`: created only if missing, `schemaVersion` checked by `doctor`. Scaffolded with the five first-class providers, their current plans, `windows[]` with `effectiveFrom`/`effectiveTo`, `anchorApiEquivalentUsd` nulls, and a `modelPricing` table with all four token classes required per model. A provider entry may carry `ingest` for code-free providers.
- `baseline.jsonl`: append-only. `{ id, recordedAt, asOf, provider, product, tier, price, currency, billing, note, supersedes? }`. Free-text `provider` and `product`; when `provider` matches a registered adapter, `tier` must be a plan id so usage can be attributed by date. This is the only source of "held" state.
- `imports/<provider>/<sha256>.csv` plus `imports/<provider>.jsonl`: the original export kept verbatim, and normalized rows deduped by row hash across re-imports.
- `usage-manual.jsonl`: append-only monthly entries for anything without local data (`decadra usage add devin --month 2026-09 --acu 42`).
- `settings.json`: `idleGapMinutes`, `commitWindowMinutes`, `ccusageBin`, `devin.acuUsdRateOverride`.
- `cache/`: generated ccusage config, optional price cache, optional Devin API pulls.
- `verdicts.jsonl`: append-only, one `PlanFitVerdict` per provider per `assess` run, the history that alert rules read. Written from slice 2 so history accrues before alerts exist.
- `alerts.jsonl`: append-only record of fired alerts, used for cooldown. Slice 6.

## Commands

### `decadra baseline add | list`

Slice 1. Append-only snapshot of every subscription. `--as-of` for backdating, `--interactive` walks `plans.json`, duplicates refused unless `--force`, corrections via `supersedes`.

### `decadra import cursor <file.csv>`

Slice 4. Validates the header against the known column set, tolerates a missing `Cost` column by pricing tokens at list price and flagging every such row, stores the file and the normalized rows, prints what was added and what was already present.

### `decadra usage add <provider> --month YYYY-MM (--usd | --acu | --tokens)`

Slice 4. Manual monthly entry for cloud-only usage. Shown in `assess` with source `manual`.

### `decadra assess [--months 3] [--since --until] [--provider id]`

Data per provider by adapter: ccusage daily and blocks, native readers, imports, manual entries. Usage is attributed to the plan held on each day from the baseline timeline. Calendar months, prorated partials marked partial.

Per provider, per plan: observed usage in the plan's unit, effective monthly cost under that plan, and for capped-window plans the multiple, months at or above 1x, p50/p95/max of 5h and 7d windows, "your estimate" reference when an anchor is set, and for Codex the recorded utilization. Source column on every usage figure: `ccusage`, `native`, `import`, `manual`, `list-estimate`. The recommendation line is the fixed per-provider template: the cheapest plan whose effective cost is lowest and whose windows stayed under the estimate, plus the held plan's figure.

Zero-price handling: a model with tokens and zero cost fails `doctor` and warns in `assess`, naming the `modelPricing` key. `doctor` diffs observed models against the table on every run and checks Codex `plan_type` against the baseline tier.

### `decadra sessions [--months 3] [--provider id]`

Per provider with a session reader: human turns, assistant messages, tool calls, wall and active duration (gaps between any two consecutive lines, capped at `idleGapMinutes`), and commit signals: a `git commit` tool call in the transcript (primary), a commit in `[firstTs, lastTs + N]` in the cwd (secondary), the Claude co-author trailer (Claude only, labeled), and a cwd-missing flag. Medians and p90, one block per provider, alphabetical. Providers without a reader print "no session data for this provider" rather than being omitted, so the absence is visible.

Reader rules already established for Claude and Codex are kept (depth-one files only, `origin.kind`, sidechain and compaction exclusion, `event_msg.user_message` only, fork dedupe by `session_meta.id`, last `token_count` per rollout). Cursor CLI: transcripts give turns and tool calls; timestamps from `conversation_summaries.updatedAt` or mtime, so duration is marked coarse. Devin: steps give turns and timestamps; `working_directory` from `sessions.db`. Muse: events give everything; subagent logs are excluded from turn counts the way Claude subagents are.

The weak-proxy caveat is carried in every renderer and in the JSON `caveats` array.

### `decadra doctor`

Slice 1. Per adapter: directory found, file count, newest file date, reader version pin vs observed `version`/`cli_version`, SQLite openable read-only. Plus ccusage version and exact command line, `plans.json` validity, baseline presence, git, price cache age, zero-price models, missing override fields.

## Slices

0. `scripts/probe-commit-proxy.ts` on the Claude and Codex readers, run on the laptop against real data. Numbers only.
1. Scaffold, CI, license, `AGENTS.md`, `CLAUDE.md`, `.claude/agents/` and `.claude/skills/` with their starters, `baseline`, `plans.json` v2 with the generic plan model, provider registry with the five adapters stubbed and their `doctor` checks, `report/render.ts` and guard tests. `decadra@0.1.0` on npm, repo public.
2. ccusage adapter for Claude, Codex, and config-declared sources; `assess` with the generic plan math; baseline timeline attribution; zero-price handling. `0.2.0`.
3. Claude and Codex readers, `sessions`, Codex utilization in `assess`, commit columns per the slice 0 result. `0.3.0`.
4. Cursor CSV import and CLI reader, Devin transcript reader and manual usage, Muse reader with `modelPricing`. Each lands as its own PR with fixtures. `0.4.0`.
5. HTML renderer, `prices refresh`, opt-in Devin API adapter. `0.5.0`.
6. Plan-change alerts: `alert-rules.ts` over stored verdict history, `decadra alerts check` and `alerts schedule --print`, terminal and file channels first, OS notification and webhook after. `0.6.0`. Depends on at least two months of verdict history existing, so it cannot be validated before then; the rails above are what slices 1 to 3 must leave in place.

## The riskiest part

Two now.

Commit correlation stays the riskiest metric, for the reason given in revision 1: the time-window signal moves with workflow rather than with the session. Back-to-back sessions in one repo, two tools open on the same repo at once (this user's stated workflow), deleted worktrees, rewritten history, and mid-session commits all corrupt it. The probe in slice 0 decides it: ambiguity above 25% at N=15, sparsity above 60%, or |Spearman rho| below 0.3 between turns and attributed commits drops the time-window column, leaving the transcript-detected commit flag. The two-line grep check from revision 1 still applies today.

The riskiest architectural piece is now scope. Five readers plus imports is most of a usage parser, which the spec said Decadra is not. The guard rails: a reader is accepted only if it stays under about 200 lines, extracts only the `SessionRecord` and per-step usage fields, prices nothing, and ships with a redacted real fixture and a version pin. Any reader that needs pricing logic, network, or a native module is rejected or routed through ccusage. `docs/adding-a-provider.md` states these rules so outside contributors meet them too.

## What the spec got wrong

1. "CLI-based tools with plans" is three different billing shapes. Anthropic and OpenAI sell capped flat plans, Cursor and Devin Team sell flat plans with an included credit and overage, Devin Core and Muse are metered with no cap. Break-even only means something for the first shape. The plan schema carries the shape and the math is per shape.
2. Cursor's usage is mostly the IDE, not a CLI, and local data does not carry cost or reliable tokens. The dashboard CSV export is the only honest dollar source and it is an official, network-free path.
3. Devin's meter is ACUs and its cloud sessions leave nothing local. The CLI writes ACU cost per step locally, which covers CLI work; cloud work needs manual entry or the opt-in API.
4. Muse has no plan at all. It is pay-as-you-go with two tiers, so "plan fit" for Muse is tier choice by observed token mix, and there is no ceiling.
5. Two upstream ingest tools exist and neither covers everything. ccusage is wrapped; codeburn is not, for network, native-install, and output-shape reasons, and its parsers are referenced instead.
6. Meter units differ, so nothing can be summed across providers. That is the same rule the verdict guard already imposes, now enforced by types as well.
7. Everything from revision 1 still holds: no library API in ccusage; effort metrics need native readers; ceilings are unpublished rolling windows with effective dates; offline pricing goes stale and a $0.00 looks like savings; the commit window is start to end plus N with the transcript signal primary; "held" is a timeline in the baseline; `--months` is calendar months; turns are human prompts by `origin.kind`; one provider block at a time; the guard is structural; `plans.json` is create-if-missing with a schema version; UTC; overage editable.
8. Going public adds obligations the spec did not mention: a license, CI, redacted fixtures, a contributor guide for adapters, and a README that states what is measured and what is not, in the same words the output uses.

## Verification

- Unit: output schema key snapshot; `renderSection` contract (no format function accepts two sections); phrase and two-names-plus-amount checks over golden and fuzzed reports; ccusage argument builder always includes `--offline --timezone UTC`; append-only stores never truncate; `plans.json` scaffold validates against its schema and a second run is a no-op; each reader on its fixtures (subagent, task-notification, compaction and streaming cases for Claude; archived, null `rate_limits`, and fork cases for Codex; missing-Cost CSV and re-import dedupe for Cursor; hidden sessions and missing `acuUsdRate` for Devin; nested subagent logs for Muse); privacy grep; lint with the import and `fetch` restrictions; a test that no reader file exceeds the size budget.
- Integration in this container: `decadra doctor` reports Claude found, Codex, Cursor, Devin, and Muse directories missing; `decadra assess --json` emits the zero-price failure for the current model; `decadra sessions --json` on this container's transcript reports exactly one human turn.
- Manual, on the laptop: the grep check, then slice 0's probe, recorded in the README before slice 3 is designed; one Cursor CSV export and one Devin CLI session run through `import` and `assess` before slice 4 is called done.
