# Constraints and where each is enforced

If a change needs an exception to any row, stop and say so instead of working around it.

## Hard constraints

| Constraint | Enforcement |
|---|---|
| Never print a cross-provider verdict. No "switch to X", no ranking, no usage totals across providers. | `report/model.ts`: `Report.providers` is a record with no cross-provider fields. `report/render.ts` is the only loop over providers, alphabetical. Every format implements `renderSection(section)` for one section. `report/templates.ts` and `commands/alerts.ts` build lines from one section. JSON top-level keys are snapshot-tested. ESLint forbids `src/report/**` importing analysis, ingest, providers, config, store, net, git. `test/guard.test.ts` runs phrase and two-names-plus-amount checks over golden and fuzzed reports. |
| Read only on session files. | Readers open files for reading; `ui/agent-env.ts` reads at most a 64 KB head of one file, or that file's first line, capped at 512 KB, because a real Codex `session_meta` line runs to 46 KB. Generated files go under `~/.decadra/cache/`. `test/invariants.test.ts` greps `src/providers` and `src/ingest` for write calls. |
| No network except opt-in price lookups and provider API pulls. | `src/net/**` is the only place `fetch` may appear (ESLint `no-restricted-globals`). ccusage is always invoked with `--offline` (unit test on the argument builder). ccusage is a pinned dependency, never a runtime `npx`. |
| Plan prices live in hand-maintained `~/.decadra/plans.json`, created on first run. | `config/plans.ts` creates it only if missing and never overwrites. `schemaVersion` is checked by `doctor`. `schema/plans.schema.json` is generated from the zod definition and compared in a test. |

## The one carve-out

`Report.bill` is the sum of subscription prices from the baseline, normalized to monthly. It is money paid, not consumption. It is rendered by one function in one sentence starting with "You pay". See `docs/decisions/0003-bill-line-carve-out.md`.

## Module rules

- `src/providers/**`, `src/ingest/**`, `src/git/**`, `src/net/**` are the only modules that touch disk, spawn processes, or use the network.
- `src/analysis/**` is pure over normalized records, no provider branches, no filesystem or process imports (ESLint).
- `src/report/**` renders a `Report` value and nothing else.
- `src/commands/**` wires layers, validates section data with a per-command strict schema, owns exit codes. Exit codes are identical for every provider: 0 success, 1 a provider's ingest failed, 2 command not built yet, 130 cancelled.
- `src/store/**` is append-only JSONL. Corrections append a record with `supersedes`.
- `src/ui/**` writes stdout and reads keypresses. It renders no usage numbers.

## Reader budget

A native reader is accepted only if all hold: under about 200 lines (tested); extracts only timestamps, entry kinds, cwd, tool-call names, unit counts, no prompt text, no free-text field longer than a path; prices nothing; no network, no native modules, SQLite through `node:sqlite`; ships with a real redacted fixture and a README pinning the tool version; ships with a doctor check; skips unknown record types without throwing.

## Meter units

`usd-list` (tokens at list price), `usd-billed` (a vendor's own dollar figure), `acu` (Devin). Never converted across providers, never summed. Every usage figure carries a source: `ccusage`, `native`, `import`, `manual`, `list-estimate`.

## Verdict guard, and why a runtime regex is not it

A banned-phrase scan that exits the process cannot catch a comparison phrased differently, and a false positive gets it disabled. The guard is the structure above. The phrase list runs in tests. Do not add a runtime text scan and call it enforcement.

Forbidden in any renderer: a totals row spanning providers, a shared chart axis, ordering providers by any metric, and a line containing two provider display names and a currency amount (except the bill line). JSON provider reports accept only `schemaVersion`, `generatedAt`, `timezone`, `window`, `caveats`, `bill`, `providers`. Command receipts such as baseline and routing use their own strict contracts. Routing receipts expose opaque references, fixed reasons and statistics for one configuration and role, with no provider names. See decision 0009.

## Time

UTC everywhere. ccusage gets `--timezone UTC`; git dates are normalized; every report header says UTC.
