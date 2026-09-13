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
| `route stats [--pool id] [--configuration id] [--role role] [--suite suite]` | local routing events | one configuration's observations | strict statistics object | 0; 1 on ambiguous selection or invalid history |
| `import`, `usage`, `prices` | | | "arrives in 0.x.0" | 2 |

JSON output of `now`, `assess`, and `sessions` is a `Report`: `schemaVersion`, `generatedAt`, `timezone`, `window`, `caveats`, `bill`, `providers`. Each provider entry is `{ provider, displayName, data }` where `data` is validated by `src/commands/<command>.schema.ts`.
