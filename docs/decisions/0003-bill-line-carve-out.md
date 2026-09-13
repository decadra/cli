# 0003: The bill line is the one allowed cross-provider figure

Date: 2026-09-05. Status: accepted.

Context: "how much am I spending on these platforms" has an honest cross-provider answer, the sum of subscription prices. That is money paid, not consumption, and it ranks nothing. The user chose to allow it.

Decision: `Report.bill` is the sum of prices recorded in the baseline for plans held on the report date, annual prices divided by twelve. It is rendered by `billLine` in `src/report/terminal.ts` and its html twin, in one sentence that starts with "You pay". The guard test allows that sentence and nothing else to carry two provider names and an amount. Nothing derived from tokens, units, or cost estimates is ever summed across providers.
