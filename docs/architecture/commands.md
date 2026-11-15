# Commands

All commands accept `--json` and `--config-dir <dir>`. `--html <file>` is declared on `assess` and `sessions` only, so any other command rejects it rather than ignoring it. `DECADRA_HOME` overrides the config dir.

| Command | Reads | Computes | Prints | Exit |
|---|---|---|---|---|
| `decadra` (bare) | environment | detects an agent shell | `now` inside an agent; home screen on a terminal; help when piped | 0 |
| `now [--all] [--provider id] [--timing]` | ccusage daily and session for the current month; baseline; verdicts | session cost and minutes, today, month to date, multiple of plan price, pace, ceiling status, last verdict | one block for the detected provider, or all with the bill line | always 0 |
| `assess [--months n] [--since] [--until] [--provider id...]` | ccusage daily and blocks; baseline timeline; Codex rate-limit snapshots; plans | calendar months with proration and exclusions, weekly and 5-hour peaks, effective cost under every plan, verdict | per provider: kv, plan table, recommendation line, notes; appends verdicts | 0, or 1 if a provider's ingest failed |
| `sessions [--months n] [--since] [--until] [--provider id...]` | native readers; git log per cwd | turns, wall and active minutes, tool calls, commit signals, medians and p90 | per provider: kv, recent-sessions table, caveat | 0, or 1 if a reader failed |
| `baseline add [flags] [-i]` | plans | validates tier for ingested providers, duplicate check | the record | 0; 1 on duplicate or bad tier |
| `baseline list` | baseline | current plan per provider | table | 0 |
| `alerts check` | verdicts, baseline, alerts | consecutive-month rule with cooldown | nothing when quiet; one line per fired alert | always 0 |
| `alerts list` | alerts | | fired alerts | 0 |
| `alerts schedule --weekly|--daily --print` | | | crontab line or launchd plist | 0; 1 without `--print` |
| `doctor` | everything above, adapters' directories | pricing coverage over the last 30 days | table | 0, or 1 if any check failed |
| `route shadow <manifest.json>` | Primary environment, routing settings, local events | bounded executor eligibility | strict metadata receipt | 0; 1 on invalid input or unsupported shell |
| `route record <outcome.json>` | contract and configuration snapshot, local events | weighted score and mandatory gate verification | strict metadata receipt; appends outcome or correction | 0; 1 on invalid input |
| `route stats [--pool id] [--configuration id] [--role role] [--suite suite]` | local routing events | one configuration's unchanged summary shape and lifecycle statistics | strict version 2 statistics object | 0; 1 on ambiguous selection or invalid history |
| `route observe <observation.json>` | local routing events | validates one version 2 lifecycle or capacity observation, binds it to its decision and attempt, derives the attempt outcome | strict receipt with the event id, whether it was newly recorded, and the derived outcome; appends | 0; 1 on invalid input, conflict or unsupported version |
| `route attempt --decision <uuid> --attempt <uuid>` | local routing events | the derived outcome of one attempt | strict report with the outcome and the effective observation per kind | 0; 1 when not found |
| `route capacity [--pool id] --configuration <id\|hash>` | local routing events | newest capacity observation for one configuration | strict snapshot in the provider's native unit, or an explicit unknown state | 0; 1 on ambiguous selection |

`route record` preserves the legacy aggregate outcome format. New integrations use lifecycle observations through `route observe` or the module. Deferred import, manual usage, price refresh, capacity prediction and context analysis commands are absent from help and are rejected.

The route commands are adapters over `src/routing/core.ts`, which the package also exports; see `docs/module.md`. They read a file, call the core and print its receipt, so the command line and an embedding host cannot disagree on the same input.

JSON output of `now`, `assess`, and `sessions` is a `Report`: `schemaVersion`, `generatedAt`, `timezone`, `window`, `caveats`, `bill`, `providers`. Each provider entry is `{ provider, displayName, data }` where `data` is validated by `src/commands/<command>.schema.ts`.
