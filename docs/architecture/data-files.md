# Data files under ~/.decadra

| File | Written by | Rule | Shape |
|---|---|---|---|
| `plans.json` | first run of any command | created if missing, never overwritten; `schemaVersion` checked by doctor | `config/plans.ts` zod schema; providers with plans of kind `capped-window`, `included-credit`, or `metered`; `modelPricing` in USD per million tokens with all four prices required per model |
| `plans.schema.json` | first run | copied from the package for editor validation | generated from the zod schema by `npm run gen:schema`; a test asserts the committed file matches |
| `settings.json` | never automatically; `setup` rewrites it in place | optional; defaults apply when absent. `updateSettings` merges and rewrites whole, `ensureSettings` still refuses to overwrite | `idleGapMinutes`, `commitWindowMinutes`, `ccusageBin`, `ui.animation`, `alerts.consecutiveMonths`, `alerts.minDays`, `devin.acuUsdRateOverride`, `providers.show` (`'auto'` or a list of provider ids) |
| `baseline.jsonl` | `baseline add` | append only; corrections append with `supersedes` | `{ id, recordedAt, asOf, provider, product, tier, price, currency, billing, note?, supersedes? }` |
| `verdicts.jsonl` | every `assess` run | append only | `{ recordedAt, window, plansAsOf, provider, heldPlan, bestFitPlan, direction, monthsOfEvidence, evidence, confidence, ... }` |
| `alerts.jsonl` | `alerts check` when one fires | append only | `{ firedAt, provider, direction, bestFitPlan, heldPlan, monthsAgreeing, basedOn, message }` |
| `routing-events.jsonl` | `route shadow`, `route record` | append only; corrections supersede the latest event for the same attempt | strict versioned metadata events; hashed repository, task, contract, pool and configuration identities; no prompts, code, commands or output bodies |
| `cache/ccusage.json` | every ccusage-backed command | regenerated each run | `{ defaults: { pricingOverrides } }` in USD per token |
| `cache/prices.json` | `prices refresh` (not built) | opt-in only | |
| `imports/` | `import` (not built) | original files kept verbatim plus normalized rows | |
| `usage-manual.jsonl` | `usage add` (not built) | append only | |

The baseline is the only source of "held" state. `plans.json` describes what vendors sell; the baseline says what you bought and when.

Optional `settings.json` routing pools contain user chosen executor configurations. The route commands never discover or contact a service automatically. Runtime model and harness version observations are supplied explicitly. The selected Primary comes from the invoking agent environment. Routing settings do not alter subscriptions or the baseline. Routing metadata never leaves this directory through Decadra.
