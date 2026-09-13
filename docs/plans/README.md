# Plans

Every plan that shaped the code, dated, kept as written. A plan is a record of what was decided and why at that moment; it is not updated to match the code afterwards. When code and plan disagree, the code and `docs/architecture/` are current and the plan explains the history.

| Plan | Status | What it covers |
|---|---|---|
| `2026-09-12-routing-shadow.md` | foundation implemented; repeated executor trials pending | Local shadow decisions, outcome contracts, configuration specific evidence, terminal executor database reader, and controlled experiments |
| `2026-09-05-master-plan.md` | slices 1, 2, 3, 6 done; 4 and 5 open | Scope, stack, provider model, generic plan model, the verdict guard, the commit-proxy probe and its decision rule, what the original brief got wrong. Revision 3 scope decision at the top. |
| `2026-09-05-slices-2-3-6.md` | done | `now` as the primary surface, the shared ccusage data layer, `assess`, the review findings that were folded in (pruning, exclusive session `--until`, cache-write pricing, Codex row shapes), then `sessions` and alerts. |
| `2026-09-06-correctness-pass.md` | open | The findings from the 2026-09-06 local run and the review that followed: agent detection and current session, plan-fit math, both readers, ingest hardening, alerts and stores, the `!` path and `sessions` performance, and the small fixes. No new slices. |

Open work from the master plan:

- Slice 4: Cursor CSV import, Muse reader, manual usage entry. Each needs a real redacted fixture from a machine that has the tool. The Devin SQLite metadata reader is implemented; priced usage ingest and successful repeated execution trials remain pending.
- Slice 5: html polish, opt-in price refresh, opt-in Devin API adapter. Both network paths need endpoint access to verify.
- Future, not planned: a non-technical surface with the same readout. The report model and the block renderer were built so a second front end can render the same `Report` value.

How to add a plan: write it as `docs/plans/YYYY-MM-DD-<slug>.md`, get it approved, build against it, then add a row here with its status. Do not edit an old plan to match new code; write a decision record in `docs/decisions/` instead.
