# ccusage fixtures

Real output of `ccusage 20.0.20`, captured 2026-09-05 in a container whose only local data was one Claude Code session (Claude Code 2.1.261). Session ids are redacted: the first group of each uuid is kept and the rest zeroed, matching the ids in `claude/` and `codex/` so a fixture session lines up across them. The files otherwise carry token counts and the lossy project path `-home-user-decadra`, and no prompt text.

Cases covered:

- `claude-daily.json`, `claude-monthly.json`, `claude-session.json`, `claude-blocks.json`: one model, priced at `$0.00` by the offline table, which is the zero-price case `assess` must catch.
- `codex-daily-empty.json`, `codex-session-empty.json`: the shape ccusage emits when a source has no data, including the codex-only `reasoningOutputTokens` and `costUSD` totals fields.
- `codex-daily.json`, `codex-session.json`: one throwaway Codex CLI session captured on a laptop on 2026-09-05 with ccusage 20.0.20. Codex rows carry `costUSD` at row level only, `models` as an object keyed by model name with no per-model cost, and session ids shaped `YYYY/MM/DD/rollout-<timestamp>-<uuid>`. No prompt text; the uuid is redacted.

Recapture with:

```
ccusage claude <daily|monthly|session|blocks> --json --offline --timezone UTC
ccusage codex <daily|session> --json --offline --timezone UTC
```
