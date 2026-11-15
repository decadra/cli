# Data files under ~/.decadra

The optional compaction observer writes `compact.sqlite` under the Decadra
home. Each row in `compact_v1` contains a hashed session identifier, the
native event kind, UTC receipt time and an optional phase. A repeated kind
following the same kind within a session is collapsed. If the host drops an
intervening event this rule can undercount compactions. The observer discards
other payload fields and proceeds silently when observation fails.

| File | Written by | Rule | Shape |
|---|---|---|---|
| `plans.json` | first run of any command | created if missing, never overwritten; `schemaVersion` checked by doctor | `config/plans.ts` zod schema; providers with plans of kind `capped-window`, `included-credit`, or `metered`; `modelPricing` in USD per million tokens with all four prices required per model |
| `plans.schema.json` | first run | copied from the package for editor validation | generated from the zod schema by `npm run gen:schema`; a test asserts the committed file matches |
| `settings.json` | never automatically; `setup` rewrites it in place | optional; defaults apply when absent. `updateSettings` merges and rewrites whole, `ensureSettings` still refuses to overwrite | `idleGapMinutes`, `commitWindowMinutes`, `ccusageBin`, `ui.animation`, `alerts.consecutiveMonths`, `alerts.minDays`, `devin.acuUsdRateOverride`, `providers.show` (`'auto'` or a list of provider ids) |
| `baseline.jsonl` | `baseline add` | append only; corrections append with `supersedes` | `{ id, recordedAt, asOf, provider, product, tier, price, currency, billing, note?, supersedes? }` |
| `verdicts.jsonl` | every `assess` run | append only | `{ recordedAt, window, plansAsOf, provider, heldPlan, bestFitPlan, direction, monthsOfEvidence, evidence, confidence, ... }` |
| `alerts.jsonl` | `alerts check` when one fires | append only | `{ firedAt, provider, direction, bestFitPlan, heldPlan, monthsAgreeing, basedOn, message }` |
| `routing-events.jsonl` | `route shadow`, `route record`, `route observe`, and the module's core | append only; corrections supersede the latest event of the same kind for the same attempt; new versions never rewrite earlier lines | strict versioned metadata events: version 1 `shadow` and `outcome`, version 3 `factory-decision` and `factory-` lifecycle events with atomic `delivery` identity; version 2 `attempt-started`, `capabilities-observed`, `artifact-observed`, `gates-observed`, `review-observed`, `integration-observed`, `attempt-closed`, `capacity-observed`; hashed repository, task, contract, pool, configuration, session, gate and criterion identities; a schema version this build does not know is refused by name; no prompts, code, commands, patches, screenshots or output bodies |
| `cache/ccusage.json` | every ccusage-backed command | regenerated each run | `{ defaults: { pricingOverrides } }` in USD per token |

The baseline is the only source of "held" state. `plans.json` describes what vendors sell; the baseline says what you bought and when.

Optional `settings.json` routing pools contain user chosen executor configurations. The route commands never discover or contact a service automatically. Runtime model and harness version observations are supplied explicitly. The selected Primary comes from the invoking agent environment. Routing settings do not alter subscriptions or the baseline. Routing metadata never leaves this directory through Decadra.
