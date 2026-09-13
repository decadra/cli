# Overview

Decadra answers one question per AI coding provider: does the plan you pay for fit the usage you put through it. It wraps ccusage for token and cost ingest, adds thin native readers where ccusage has nothing, and layers plan-fit math, a per-session effort read, and an in-session readout on top. It never ranks providers.

## Layers

```
commands/        wire the layers, own exit codes, validate section data with a per-command zod schema
   |
   |  reads          analysis/ (pure)             report/ (renders a Report value)
   v                    ^                              ^
ingest/  providers/  git/  net/      <- the only modules that touch disk, processes, or network
   |
store/            append-only JSONL under ~/.decadra
config/           plans.json, settings.json, paths
ui/               home screen, agent detection (stdout and stdin only)
```

- `providers/<id>/adapter.ts` declares a provider: id, display name, meter unit, usage source (`ccusage`, `native`, `import`, `manual`), optional session reader, a doctor check, and optionally the earliest local data date. `providers/registry.ts` lists the built-ins and turns providers declared only in `plans.json` into adapters.
- `ingest/usage.ts` is the one function both `now` and `assess` call for usage. It runs ccusage through `ingest/ccusage.ts` with the config from `ingest/ccusage-config.ts`, parses with `ingest/ccusage.schema.ts`, and returns a failure rather than throwing so one provider cannot hide the others.
- `ingest/normalize.ts` is where a reader's raw counts become a `SessionRecord`. Provider quirks stop there.
- `analysis/` is pure: `planfit.ts` (effective cost under every plan, the verdict), `months.ts` and `windows.ts` (calendar buckets, rolling peaks), `effort.ts` (medians and commit shares), `alert-rules.ts`.
- `report/model.ts` defines `Report` and `ProviderSection`. `report/render.ts` is the only loop over providers. Each format implements `renderSection(section)`.
- `commands/deps.ts` is the test seam: a ccusage runner, a clock, an environment, a cwd. Tests inject fixtures and a fixed date; nothing is spawned.
- `routing/schema.ts` defines metadata contracts. `analysis/routing.ts` evaluates eligibility and outcomes without side effects. `commands/route.ts` connects those functions to the local append only routing store. Routing has no execution or network interface. See `docs/routing.md` and decision 0009.

## One request, end to end: `decadra assess --months 3`

1. `cli.ts` builds a `CommandContext` (paths, format, writer) and calls `runAssess`.
2. `resolveWindow` turns `--months 3` into a UTC calendar range. `writeCcusageConfig` turns `modelPricing` into ccusage pricing overrides under `~/.decadra/cache/`.
3. For each adapter, alphabetically: `loadProviderUsage` runs `ccusage <source> daily` (and `blocks` for Claude), `bucketMonths` builds one bucket per calendar month with proration and exclusions, `weeklyPeak` and `shortPeak` compute window peaks, the baseline gives the plan held on the window's last day, the Codex reader supplies recorded utilization, and `assessPlanFit` returns rows and a verdict.
4. `buildAssessSection` validates the section data against `assess.schema.ts`, builds display blocks, and adds the recommendation line from `templates.ts`.
5. `renderReport` renders terminal, JSON, or html. One verdict per provider is appended to `verdicts.jsonl`.
6. Exit 0, or 1 if any provider's ccusage call failed.

## What runs where

| Touches | Allowed in |
|---|---|
| Disk reads of provider data | `providers/**`, `ingest/**`, `ui/agent-env.ts` (head of one file only) |
| Disk writes | `store/**` (append only), `config/**` (create if missing), `ingest/ccusage-config.ts` (cache), commands writing `--html` |
| Processes | `ingest/ccusage.ts` (ccusage), `git/commits.ts` (git log), `commands/doctor.ts` (git --version) |
| Network | `net/**` only, behind explicit subcommands. Nothing there yet. |
