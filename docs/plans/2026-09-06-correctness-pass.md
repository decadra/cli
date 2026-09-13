# Correctness pass, 2026-09-06

A pass over the findings from the 2026-09-06 local run and the review that followed it. No new slices. Slice 4 stays closed until this lands.

Every item is one commit. `npm run check` is green before each. When behaviour changes, `docs/testing/scenarios.md` or `invariants.md` changes in the same commit.

Status values: `open`, `done`, `dropped`. Unlike the earlier plans, the status column here is kept current as items land, because this plan is a worklist rather than a design. The decisions recorded in it are not rewritten afterwards.

## Scope note

Four path defects that would otherwise belong to a later infrastructure pass are folded into groups 1, 3 and 4 here, because they sit in lines these groups already rewrite and because turning a Windows CI runner on depends on them. The boundary: **this pass owns "the wrong file or session was chosen"; the folded items are "the path is parsed wrong on a backslash platform."** Same lines, different bug, one edit.

## 1. Agent detection and current session

`src/ui/agent-env.ts`.

| # | Item | Status |
|---|---|---|
| 1a | Codex exports `CODEX_THREAD_ID`, `CODEX_MANAGED_BY_NPM` and `CODEX_MANAGED_PACKAGE_ROOT` in its `!` shell, never `CODEX_SANDBOX`. Detect on `CODEX_THREAD_ID` and use its value as the session id. | done |
| 1b | Claude Code exports `CLAUDE_CODE_SESSION_ID`. Prefer it over the newest-mtime file. | done |
| 1c | The 16,000 byte head read truncates every real 0.144.6 `session_meta` line (18 to 46 KB), so `JSON.parse` always throws. Read to the first newline instead. | done |
| 1d | Codex names `sessions/YYYY/MM/DD` by local date while the lookup builds it from the UTC date and walks backwards only, so UTC-plus users never find today's session. Walk every root and decide by content, and take the clock from `deps`, not `new Date()`. | done |
| 1e | `now.ts` passes `detected ?? forced` to `findCurrentSession` while the target is `forced ?? detected`. Swap it. | done |
| 1f | Tests with realistic head sizes and a UTC-plus timezone. | done |
| 1g | Folded in: derive the session id with `basename(file, '.jsonl')` rather than `file.slice(file.lastIndexOf('/') + 1, -6)`, and the Cursor directory id with `basename(dirname(best.file))` rather than `split('/').slice(-2, -1)[0] as string`. The cast was hiding `undefined`. | done |

`src/providers/anthropic-claude-code/reader.ts` `f.slice(0, -6)` is correct and stays: `f` there is a bare filename from `listDir`, not a path.

## 2. Plan fit math

| # | Item | Status |
|---|---|---|
| 2a | `planfit.ts` scales recorded utilization by the plan held on `window.until`, while `utilizationMax` in `assess.ts` drops each sample's `planType`. Scale every sample by the plan it was recorded on. | done |
| 2b | `MonthlyUsage.tokens` is never populated, so a `tokenPricing` plan gets effective $0 and wins the verdict. Either populate tokens from ccusage daily rows or make `effectiveForMonth` return null and exclude unpriceable plans from candidates. | done |
| 2c | `store/baseline.ts` `heldByMonth` counts from day 1 of each month. Pass the window's `since` so a mid-month `--since` is prorated. | done |
| 2d | `--until` without `--since` anchors `since` to today. Derive `since` from `until`. Validate both as `YYYY-MM-DD` with the `isoDate` regex already in `config/plans.ts`. | done |
| 2e | `assess.ts` prints every amount through `money()` regardless of `adapter.meter`. Route amounts through one unit-aware formatter shared with `planfit` and `now`. | done |

## 3. Readers

| # | Item | Status |
|---|---|---|
| 3a | Claude reader counts an origin-less `user` line as a human turn whenever content is a string, overcounting by about 36 percent on real transcripts. Check `isMeta`, and for origin-less lines count only string content that is not a command or caveat marker. Do not count block arrays as non-human. | done |
| 3b | Codex reader: count `custom_tool_call` (name `exec`, JavaScript in `input`) as a tool call, and run the commit-call rule on the decoded input rather than on JSON-encoded text, so the newline guard applies. | done |
| 3c | Implement the `(cwd, timestamp)` human-turn dedupe that `docs/adding-a-provider.md` promises. Test with two rollouts sharing a `session_meta.id` plus one under `archived_sessions`. | done |
| 3d | `now` says "no recorded utilization" for Codex while `assess` reads it from the same rollouts. Make `now` consume the reader's utilization samples. | done |
| 3e | Folded in: derive the Codex session id with `basename`. Masked today only because `session_meta.id` overwrites it. | done |

## 4. Ingest hardening

| # | Item | Status |
|---|---|---|
| 4a | `ccusage.schema.ts` defaults token and cost fields to 0, so a shape drift parses as $0 usage with high confidence. Require the fields ccusage 20.0.20 always emits and fail loudly on a row carrying only `date`. | done |
| 4b | Keep execa's `stderr` and `shortMessage` in the error, not just the first line. Execute a `ccusageBin` override directly when it is not a `.js` file, rather than always through node. | done |
| 4c | `discover.ts` `splitDirs` splits on `:`, which breaks Windows drive paths. Split on `,` only, matching ccusage's documented format. | done |

`splitDirs` was also considered as a platform-aware delimiter set. Comma-only was chosen: it fixes the drive-letter case completely, matches the documented format, and needs no `platform` argument threaded through six call sites.

## 5. Alerts and stores

| # | Item | Status |
|---|---|---|
| 5a | `alert-rules.ts`: require the N months to be calendar-adjacent. The cooldown lifts on any later baseline record; require a verdict recorded after the baseline change, and compare direction against the currently held plan. | done |
| 5b | `commands/alerts.ts`: build the launchd `ProgramArguments` from an argv array with XML escaping, quote the crontab line, and use the stable node path rather than the Cellar path. | done |
| 5c | `store/jsonl.ts`: ensure the file ends with a newline before appending. | done |
| 5d | `config/paths.ts`: treat an empty `DECADRA_HOME` or `--config-dir` as unset, and resolve relative values to absolute. | done |
| 5e | `commands/baseline.ts` and `cli.ts`: reject an empty price; `--supersedes` must name a record of the same provider; `-i` must prompt even when only tier is missing; suppress clack output under `--json`. | done |

## 6. Performance of the `!` path and sessions

| # | Item | Status |
|---|---|---|
| 6a | `ingest/usage.ts`: run the daily, blocks and session reports with `Promise.all`, request blocks only when the caller reads them (`assess`), and run providers concurrently in `now`, `assess` and `doctor`. `--timing` must report per-provider time, not cumulative. | done |
| 6b | `commands/sessions.ts`: one `git rev-parse` and one `git log` per distinct cwd, bucketed in memory, instead of two spawns per session. 28 seconds today on 1,087 rollouts. | done |
| 6c | `assess.ts` parses every transcript only to collect utilization the Claude reader never returns. Skip readers that declare no utilization. | done |

## 7. Small fixes, one commit each

| # | Item | Status |
|---|---|---|
| 7a | `cli.ts` and `planned.ts` reference `docs/PLAN.md`, which does not exist. | done |
| 7b | "arrives in 0.4.0" strings on a 0.4.0 build. | done |
| 7c | `docs/plans/README.md` and `CHANGELOG.md` still say the Codex fixture is pending. | done |
| 7d | `--html` is silently ignored by `now`, `doctor`, `baseline` and `alerts`. Declare it on `assess` and `sessions` only. | done |
| 7e | `doctor` should compare each reader's `verifiedAgainst` pin to the observed `cli_version`. | done |
| 7f | `test/fixtures/ccusage` session fixtures keep real session ids. Redact them and register the placeholders. | done |
| 7g | AGENTS.md's "no model identifiers in commits" rule conflicts with the required co-author trailer. Narrow the rule, keep the trailer. | done |
| 7h | `plans.json` gives the Codex short window `effectiveTo: 2026-07-12`, yet 0.144.6 rollouts still report a 300 minute primary window. Check the plan data. | done: the plan data was stale, the window had not ended |
| 7i | The home screen motto line overflowed below about 70 columns. | done, PR 3 |

7a and 7b were done here rather than deferred, as one concern: `src/roadmap.ts` replaces the version-promise table with capability and action and no version field, an invariant keeps a version from coming back, and the `docs/PLAN.md` pointers move to `docs/plans/README.md`. Recorded as `docs/decisions/0007`.

## Out of scope

Slice 4 (Cursor CSV import, Devin and Muse readers, manual usage entry) and slice 5 (html polish, price refresh, Devin API). The infrastructure pass (CI matrix, packaging, release) is a separate branch that follows this one.
