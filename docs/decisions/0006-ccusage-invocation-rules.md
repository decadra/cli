# 0006: ccusage invocation rules learned from the binary

Date: 2026-09-05. Status: accepted. Verified against ccusage 20.0.20.

- `--offline --timezone UTC` on every call. The argument builder test asserts it.
- `--mode calculate` only on the `claude` source. The `codex` source has no `--mode` flag and fails on it.
- The session report treats `--until` as exclusive; the daily report treats it as inclusive. The session fetch asks for the day after.
- `blocks` takes `--session-length <hours>`; it comes from the plan's short window, not a constant.
- Offline pricing goes stale: a model newer than the bundled table prices at $0.00, which looks like savings. `doctor` fails on any model with tokens and zero cost.
- Pricing overrides go through `--config` with `defaults.pricingOverrides` in USD per token, and an override is applied only when all four prices are present.
- ccusage holds **one cache-creation price per model** and applies it to every cache write, whatever the write's TTL. An earlier version of this record claimed it prices 1-hour writes at twice the input rate and 5-minute writes at the cache-write rate. That is false, and it mattered, because it made a 5-minute rate look like a safe thing to enter. Checked against ccusage 20.0.20: the accepted override keys are `inputCostPerToken`, `outputCostPerToken`, `cacheCreationInputTokenCost`, `cacheReadInputTokenCost` and their four `*Above200kTokens` variants (`node_modules/ccusage/config-schema.json`), and the same four names are the whole of `struct LiteLlmPricing` and `struct ModelsDevCost` inside the binary. There is no field a second write rate could occupy.
- ccusage does parse the TTL split. `struct CacheCreationRaw`, `ephemeral_1h_input_tokens` and `ephemeral_5m_input_tokens` all appear in the binary. It reads the two and sums them into one token count, then prices that count once.
- So `modelPricing.cacheWrite` is the rate charged to **all** cache-creation tokens, and it should be set to the TTL the sessions actually use. For Claude Code that is the 1-hour rate: in this repo's own fixture the main session is 575,756 1-hour tokens against 0 5-minute, and the subagent file is the exact inverse. `doctor` checks the ratio against the input price and says so.
- Decadra never re-prices `cacheCreationTokens` from daily JSON, because that figure is a sum of two TTLs of tokens and no single rate is right for it.
- Codex rows carry `costUSD` at row level and `models` as an object keyed by model name with no per-model cost. Claude rows carry `totalCost` and `modelBreakdowns`. `src/ingest/ccusage.schema.ts` normalizes both.
- The Codex short window was recorded as ending on 2026-07-12. Real 0.144.6 rollouts on 2026-09-06 report `rate_limits.primary.window_minutes` of 300 with the weekly window as `secondary`, so it had not ended. Window dates are hand-maintained and are checked against captured rollouts, not against announcements.
