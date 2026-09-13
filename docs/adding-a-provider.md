# Adding a provider

This is the contract every provider adapter meets. `AGENTS.md` carries the rules an agent must not break; this file carries the shape of the work.

## Adapter interface

```ts
interface ProviderAdapter {
  id: ProviderId;                 // kebab-case, vendor first: "anthropic-claude-code", "openai-codex", "cursor", "devin", "meta-muse"
  displayName: string;
  meter: "usd-list" | "usd-billed" | "acu";
  usage: UsageSource;             // { kind: "ccusage", source } | { kind: "native", reader } | { kind: "import", format } | { kind: "manual" }
  sessions?: SessionReader;       // effort metrics; absent means the output says "no session data for this provider"
  ceilingSignal?: CeilingSignal;  // a recorded utilization signal, such as Codex rate_limits
  doctor(): Promise<DoctorCheck[]>;
}
```

`meter` is the unit the provider's plans are expressed in. It is never converted to another provider's unit.

## Ingest kinds, in order of preference

1. `ccusage`: the tool is one of ccusage's sources. The adapter names the source; tokens and cost come from `ccusage <source> daily|session --json --offline`. No reader is needed unless the effort metrics are wanted, in which case a reader supplies sessions only.
2. `native`: the tool writes local logs ccusage does not read. A reader under the budget below extracts sessions and unit counts.
3. `import`: the vendor offers an official export. A parser validates the header, normalizes rows, and dedupes by row hash across re-imports. The original file is kept verbatim under `~/.decadra/imports/<id>/`.
4. `manual`: nothing else exists. Usage is entered per month with `decadra usage add`.

Not accepted: undocumented dashboard endpoints, cookie or session-token authentication, scraping.

## Reader budget

- Under about 200 lines.
- Reads timestamps, entry kind, cwd, tool-call names, and unit counts as the tool wrote them. No prompt text. No free-text field longer than a path.
- Prices nothing. All token pricing goes through the single `modelPricing` table.
- No network. No native modules. SQLite through `node:sqlite` via `src/ingest/sqlite.ts`, opened read-only.
- Skips unknown record types without throwing. Formats drift.
- Pins the tool version it was written against and compares it with the version the files declare, so `doctor` can warn on drift.

## Normalized records

Readers emit `SessionRecord` values through `src/ingest/normalize.ts`:

```ts
interface SessionRecord {
  provider: ProviderId;
  sessionId: string;
  cwd: string | null;            // most frequent cwd; null when unknown
  cwds: string[];
  firstTs: string;               // ISO, UTC
  lastTs: string;
  humanTurns: number;
  assistantMessages: number;
  toolCalls: number;
  commitCommandsInTranscript: number;
  models: string[];
  durationQuality: "exact" | "coarse";   // coarse when timestamps come from mtime or a summary table
}
```

Per-step usage for native token or unit sources is emitted as `UsageEvent` values: `{ provider, ts, sessionId, model, tokens?, units?, source }`.

## Fixture rules

Real files, redacted with the `redact-fixture` skill, never synthetic. One README per fixture directory naming the tool version, capture date, what was redacted, and the cases covered. Placeholders are registered in `test/privacy.test.ts`.

## Doctor check

Every adapter reports: directory or file found, file count, newest file date, declared tool version against the reader's pin, and for SQLite sources whether the file opens read-only. Not found is a normal result, not an error.

## Plans

Plans go in the scaffold in `src/config/plans.ts` using the generic plan model:

- `capped-window`: flat monthly price, rolling-window caps in unpublished units, `multiplierVsBase`.
- `included-credit`: flat monthly price, an included `amount` in the provider's unit, `overageUsdPerUnit`.
- `metered`: no flat price or a `minimumUsd`, `usdPerUnit` or a pricing table.

Every plan entry carries an `asOf` date and a source note. Prices change; the note is how the next person knows where to look.

## Providers

Verified log locations and formats, one section per provider. Add yours when you add the adapter.

### anthropic-claude-code

- Location: `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Subagent transcripts under `<project>/<sessionId>/subagents/agent-*.jsonl`, excluded from turn counts.
- Line fields: `timestamp`, `type`, `cwd`, `gitBranch`, `sessionId`, `isSidechain`, `origin`, `version`, `message`.
- Human turn: `type: "user"` with `origin.kind: "human"` and `isSidechain` not true. Notifications also arrive as user lines with string content and a different `origin.kind`. Fall back to string content only when `origin` is absent, and exclude `isCompactSummary`.
- Assistant messages: count distinct `message.id`; streaming writes several lines per message.
- Usage and cost: ccusage `claude`. Verified against ccusage 20.0.20 and Claude Code 2.1.261.

### openai-codex

- Location: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` and `~/.codex/archived_sessions/`. Filter by last activity, not directory date.
- Line fields: `timestamp`, `type`, `payload`. First line `session_meta` with `id`, `timestamp`, `cwd`, `originator`, `cli_version`.
- Human turn: `event_msg` with `payload.type: "user_message"`. Do not count `response_item` role-user lines; they carry injected context, and on 0.144.x also the user's `!` shell commands wrapped in `<user_shell_command>`.
- Verified on a 0.144.6 rollout head: `session_meta.payload` carries both `id` and `session_id`, `originator`, `cli_version`, `source`, `thread_source`, `model_provider`, and a large `base_instructions.text`. Other event types seen: `task_started`, `task_complete`, `thread_settings_applied` (whose `thread_settings.model` and `cwd` are read). Unknown types are skipped.
- Dedupe rollouts by `session_meta.id` and human turns by `(cwd, timestamp)` so forks and resumes do not double count.
- Ceiling signal: `token_count` events carry `rate_limits.primary` and `secondary` with `used_percent`, `window_minutes`, `resets_at`, `plan_type`. Null in some builds.
- Usage and cost: ccusage `codex`. Verified on 20.0.20 against a real session: daily and session rows carry `costUSD` at row level only, `models` is an object keyed by model name whose entries hold tokens, `reasoningOutputTokens`, and `isFallback` but no cost, and `sessionId` is `YYYY/MM/DD/rollout-<timestamp>-<uuid>` with no `firstActivity`. The codex source has no `--mode` flag.

### cursor

- Dollars: official CSV export from Settings, Usage, Export. Columns `Date, Kind, Model, Max Mode, Input (w/ Cache Write), Input (w/o Cache Write), Cache Read, Output Tokens, Total Tokens, Cost`. `Cost` has been absent in some periods; rows without it are priced at list and flagged.
- Sessions: CLI transcripts under `~/.cursor/projects/<id>/agent-transcripts/<uuid>/<uuid>.jsonl`, role and content only. Timestamps from the `conversation_summaries` table in `state.vscdb` or file mtime, so `durationQuality` is `coarse`.
- Local token fields are zero for Cursor v3 sessions; do not use them for cost.
- Verification pending on a real installation before slice 4.

### devin

- Location verified on 2026-09-12 with installed CLI 3000.10.21: `~/.local/share/devin/cli/sessions.db`. No transcript export is required. Stored historical rows have no writer version, so the reader reports it as unknown and doctor warns.
- `sessions` supplies identity, working directory, configured model, visibility and `main_chain_id`. `message_nodes` supplies parent links, timestamps, role, message identity and selected JSON metadata. The reader walks backwards from the main chain head and excludes hidden sessions, abandoned branches and subagent branches. Empty headers do not establish local usage.
- Human turns require role `user` and `metadata.is_user_input` true. Assistant messages deduplicate message identity. Tool calls use the recorded array length. The reader never selects message bodies, thinking, tool arguments or results and does not inspect commands.
- Per-message metadata supplies generation model, timestamp, input/output/cache tokens and generation latency. Null counts remain unknown. Session metadata supplies `total_acu_cost` and `total_credit_cost` separately. These are native observations and are not converted or sent to the existing usage report.
- The SQLite file is opened read only through `node:sqlite` with extensions disabled. Strictly validated projections ignore additional vendor fields, skip malformed rows and fail closed on broken chains or incompatible schema.
- The real redacted fixture covers an unused visible header, hidden telemetry with duplicate branches, and a visible trial rejected before generation. Successful visible generation and paid-model entitlement remain unverified.
- Visibility uses a read-only timestamp aggregate over rooted visible main chains, without decoding resource metrics or normalizing complete sessions. SQLite loads only when a database is opened, so unrelated quiet commands do not emit its experimental warning on older supported runtimes.

### meta-muse

- Location: `~/.local/share/muse/sessions/YYYY/MM/DD/<session-uuid>/session.jsonl`, subagent logs nested beneath and excluded from turn counts.
- Events carry `input_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`, and a model name. No cost field.
- Meter: `usd-list` through `modelPricing`. No plan caps; tiers are metered.
- ccusage issue #1694 requests this source. When it lands, usage moves to `ccusage` and the reader keeps sessions only.
- Verification pending on a real installation before slice 4.

Effort: where a tool records a reasoning or effort level, the reader passes it to `noteEffort` verbatim. Labels are bounded by shape, not by a list, because vendors add levels; observed values across two tools include `low`, `medium`, `high`, `xhigh`, `max`, `ultra` and `banana`. Never map one vendor's scale onto another's: the vocabularies differ and one tool's `high` is not another's.

Context: a reader passes each reply's input size to `noteContext`, and the model's context window to `noteContextWindow` where the tool states one. The mapping differs per tool. Claude: `message.usage.cache_read_input_tokens + cache_creation_input_tokens + input_tokens`, and no window is written. Codex: `info.last_token_usage.input_tokens`, with `info.model_context_window`. Do not use a cumulative total such as `info.total_token_usage`; it is a different quantity and would mean something else under the same name. See `docs/decisions/0008`.
