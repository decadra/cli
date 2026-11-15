# Invariants

Properties that must hold for every input, and where each is checked. Add a row when adding a rule; add a check when adding a row.

| Invariant | Check |
|---|---|
| Shadow routing cannot spawn executors, contact the network or feed provider reports | `test/routing-invariants.test.ts`, ESLint import fences |
| Routing accepts only metadata contracts, computes mandatory gate success and hashes evaluator references | `test/routing-schema.test.ts`, `test/routing-command.test.ts` |
| Routing evidence and usage remain scoped to one configuration, role and benchmark suite, and unscoped aggregation functions are not public | `test/routing-command.test.ts`, `test/routing-policy.test.ts`, `test/routing-core.test.ts`, `test/routing-lifecycle-stats.test.ts` |
| The routing core never prints, exits or reads a terminal, takes clock, environment, paths and store from options, and resolves relative module paths against the injected working directory | `test/routing-core.test.ts` |
| Public routing selections, attempt references and assessment contexts reject unknown fields | `test/routing-core.test.ts` |
| The command line and the module produce identical routing decisions for identical inputs | `test/routing-core.test.ts` |
| A routing record with a schema version this build does not know is refused by name, never read as malformed or migrated, including seeded memory history | `test/routing-lifecycle.test.ts`, `scripts/consumer-smoke.mjs` |
| Version 1 statistics receipts keep their strict shape while current statistics use the version 2 lifecycle envelope | `test/routing-lifecycle-stats.test.ts` |
| A worker's exit status is advisory: exit zero without a qualifying artifact derives a no op, never a success | `test/routing-lifecycle.test.ts` |
| Capability mismatch, mechanical verification, review acceptance and integration are distinct derived states, and dependent evidence is observed and recorded no earlier than the effective artifact | `test/routing-lifecycle.test.ts` |
| Attempt identity is immutable; corrections append with a predecessor; a repair is a linked attempt that removes the repaired one from clean evidence and supersedes its delivered class | `test/routing-lifecycle.test.ts`, `test/routing-core.test.ts` |
| A non null session hash starts exactly one attempt while null sessions and identical start replays remain admissible | `test/routing-lifecycle.test.ts` |
| No gate id, criterion id, session reference or configuration alias reaches the routing store unhashed | `test/routing-lifecycle.test.ts`, `test/routing-core.test.ts` |
| Unknown lifecycle measurements and capacity stay null and are counted as missing, never zero | `test/routing-lifecycle.test.ts`, `test/routing-factory.test.ts`, `test/routing-lifecycle-stats.test.ts`, `scripts/consumer-smoke.mjs` |
| A factory delivery deduplicates on producer hash and delivery id under the store lock; an exact retry replays the original event identity and a changed request conflicts, with no sidecar state | `test/routing-factory.test.ts`, `scripts/consumer-smoke.mjs` |
| A duplicate delivery refused inside a mutation is checked before any index mutation, so no dependent event can persist against it | `test/routing-factory.test.ts` |
| Factory attempts run executor only, match the recorded pool, and factory supplied binding hashes persist unchanged; neither legacy path records against a factory decision nor the reverse | `test/routing-factory.test.ts`, `scripts/consumer-smoke.mjs` |
| Factory eligibility evidence counts independent parent tasks, so sibling children of one parent count once | `test/routing-factory.test.ts` |
| A factory explanation is a strict locked read of the original decision, labels evidence as the pool minimum of independent parent or task units, exposes no individual suitability or raw inputs, appends nothing and does not reinterpret current settings or later evidence | `test/routing-explanation.test.ts`, `scripts/consumer-smoke.mjs` |
| `src/index.ts` exports the routing core only and imports no ui, report, command, ingest, provider or network module | `test/package-exports.test.ts`, ESLint import fences |
| No rendered line contains two provider display names and a currency amount, except the bill line | `test/guard.test.ts` over golden and fuzzed reports in all three formats |
| No rendered text contains a comparison phrase (`switch to`, `cheaper than`, `better than`, `vs`, `rank`, ...) | `test/guard.test.ts` |
| Providers render in alphabetical order regardless of insertion order or any metric | `test/guard.test.ts` |
| A bar, sparkline or column block never draws wider than the width it was given, and colour is measured out of every width | `test/layout.test.ts` |
| No rendered terminal line exceeds the pane, at any width down to the 60-column floor, including the header, the bill line and the caveats | `test/terminal-width.test.ts` |
| Every drawn figure has an ASCII form, chosen once at load from `DECADRA_ASCII` or a non-UTF-8 locale | `test/layout.test.ts` |
| JSON output has exactly the seven allowed top-level keys | `test/guard.test.ts`, `test/commands.test.ts`, `test/sessions-command.test.ts` |
| Every format's `renderSection` takes exactly one section | `test/render-contract.test.ts` (type-level) |
| html contains no `<script>` and no external URL | `test/guard.test.ts`, `test/commands.test.ts` |
| Every ccusage call carries `--offline` and `--timezone UTC`; `--mode` only for claude | `test/ccusage-args.test.ts` |
| A ccusage row missing a field the tool always emits is refused, never read as zero | `test/ccusage-schema.test.ts` |
| A provider directory list splits on ',' only, so a drive letter stays in its path | `test/discovery.test.ts` |
| Tests resolve fixture and source paths with `fileURLToPath`, never `URL.pathname`, which yields `/C:/...` on Windows | CI runs the suite on `ubuntu-latest` and `windows-latest` |
| `fetch` appears only under `src/net/` | ESLint `no-restricted-globals`, `test/invariants.test.ts` |
| No source file names a decadra version, or points at `docs/PLAN.md` | `test/invariants.test.ts` |
| Help exposes implemented commands only; deferred commands are rejected while legacy outcome ingestion remains available | `test/command-surface.test.ts` |
| `src/providers` and `src/ingest` never write files, except the ccusage config under `cache/` | `test/invariants.test.ts` |
| `src/analysis` imports no filesystem, process, provider, or store module | ESLint `no-restricted-imports`, `test/invariants.test.ts` |
| `src/report` imports nothing from analysis, ingest, providers, config, store, net, git | ESLint `no-restricted-imports` |
| Every reader file is under the line budget and contains no pricing, fetch, or native SQLite | `test/reader-budget.test.ts` |
| `doctor` warns when a reader's `verifiedAgainst` pin does not match the sessions on disk | `src/commands/doctor.ts`, manual checklist |
| Stores only append: a second write leaves the first line byte-identical | `test/baseline-store.test.ts` |
| An append never joins two records, even when the file lacks a trailing newline | `test/stores-and-paths.test.ts` |
| An empty `DECADRA_HOME` or `--config-dir` is unset, and every path is absolute | `test/stores-and-paths.test.ts` |
| A correction supersedes a snapshot that exists and belongs to the same provider | `test/stores-and-paths.test.ts` |
| `--json` never prompts, so machine output is never interrupted | `test/stores-and-paths.test.ts` |
| An alert needs calendar-adjacent months and evidence recorded after the baseline change | `test/alerts.test.ts` |
| A scheduled entry survives a path with spaces and a node upgrade | `test/alerts.test.ts` |
| `plans.json` is created once and never overwritten | `test/plans.test.ts` |
| Every hand-entered cache rate is checked against its own model's input rate, and a rate outside a published band warns | `test/plans.test.ts`, `test/commands.test.ts` |
| The cache-write rate is checked against the TTL the transcripts on disk actually asked for, per provider, never summed across them | `test/commands.test.ts` |
| Committed `schema/plans.schema.json` equals the generated schema | `test/plans.test.ts` |
| `now` exits 0 even when ccusage fails | `test/commands.test.ts` |
| `alerts check` is idempotent: the same state never fires twice | `test/alerts.test.ts` |
| No content placeholder reaches `--json` output or a session record; ids and paths may | `test/privacy.test.ts`, `test/readers.test.ts`, `test/sessions-command.test.ts` |
| Active minutes never exceed wall minutes | `test/readers.test.ts` |
| A user line with no `origin` counts as a turn only when a person wrote it | `test/readers.test.ts` |
| A record standing in for a reply that never came is not a message or a model | `test/readers.test.ts` |
| Effort labels are kept as each tool wrote them, never mapped onto another provider's scale | `test/readers.test.ts` |
| A sidechain's effort label is never taken as the effort of the session that spawned it | `test/readers.test.ts` |
| The cache-write TTL split is null where the tool states none, never zero, and a sidechain's writes are not the session's | `test/readers.test.ts` |
| Context peak survives a compaction drop and a zeroed record; a cumulative total is never read as a level | `test/readers.test.ts` |
| Context per reply divides by assistant replies, never by human turns | `test/readers.test.ts` |
| A human turn is counted once per `(cwd, timestamp)` across rollouts of one session | `test/readers.test.ts` |
| The commit rule reads a decoded command, never JSON-escaped text | `test/readers.test.ts` |
| A reader that records no utilization is never run just to collect it | `providesUtilization` on `SessionReader`; `test/commands.test.ts` |
| A month with fewer than 7 observed days never counts as evidence | `test/months.test.ts`, `test/planfit.test.ts` |
| A plan that cannot be priced from the ingested data never wins a verdict | `test/planfit.test.ts` |
| Recorded utilization is scaled by the plan each sample was recorded on | `test/planfit.test.ts` |
| Every usage figure prints in its own provider's meter unit; prices print in dollars | `test/window-flags.test.ts` |
| A duration prints as at most two units and JSON keeps the raw minutes | `test/layout.test.ts`, `test/sessions-command.test.ts` |
| `--since` and `--until` are YYYY-MM-DD, and a window given only `--until` ends there | `test/window-flags.test.ts` |
| Exit codes do not depend on which provider failed | `test/invariants.test.ts` (no `exitCode` under `src/providers`) |
| Each command's section data validates against its strict schema before rendering | the command itself parses it; `test/commands.test.ts` and `test/sessions-command.test.ts` exercise it |
| `now` on fixtures completes within a small time budget with ccusage injected | `test/invariants.test.ts` |
| A provider is never hidden silently: `assess`, `sessions` and `now` name what they left out | `test/provider-visibility.test.ts` |
| The reason given for hiding a provider is the reason it was hidden, in both the reports and `doctor` | `test/provider-visibility.test.ts` |
| An installed but unused provider is not treated as one you use | `test/provider-visibility.test.ts` |
| `doctor` reports every provider whatever `providers.show` says | `test/provider-visibility.test.ts` |
| Naming a provider on the command line overrides `providers.show` | `test/provider-visibility.test.ts` |
