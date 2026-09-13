# Changelog

## 0.4.0 (unreleased)

- Local shadow routing: strict task contracts, fixed eligibility reasons, append-only outcome corrections and statistics for one route configuration, role and benchmark suite. No automatic dispatch, provider selection, shared usage unit or remote telemetry. Sparse history remains unknown. See `docs/routing.md`.

- Devin session metadata now comes from a read-only SQLite reader with a real redacted fixture, main-chain visibility filtering and version drift checks. Message bodies are never selected. Unknown resource consumption remains unknown.

- The logomark is the real one. It was a density field of value noise, a rim, a diagonal and a bar, written before a mark existed; it is now the coin, baked from `assets/logomark.svg` by `npm run gen:logomark`. The trace is 2987 subpaths over six fill levels painted in document order, resolved once into a 192x96 grid of ink rather than drawn per frame at 11fps. The bake fits the artwork rather than its viewBox, which took the frame from 39.8% inked to 67.8%, and the splash now takes the widest of 64x32, 48x24 and 36x18 that fits beside the menu and inside the pane.

- `assess`, `sessions` and `now` report only on providers you pay for or actually use, instead of listing all five and saying nothing about three of them. A provider counts as in use when a baseline names it or it has usage data on disk; installation does not count, because the Devin CLI writes a `sessions.db` the first time it is opened and leaves it there. `doctor` still reports on every provider, since surveying the machine is its job, and names what the others skip. Nothing is hidden silently: the caveats say what was left out and how to change it. Set `providers.show` in `settings.json`, or run `decadra setup`.

- `decadra setup`: what this machine uses and what you pay for, in one pass. Shows what was detected with the date its usage data starts, asks which of them you pay for and on which plan, and records each through the existing append-only baseline store, so re-running it is how you change things. Offered once on a first interactive run and never again once answered. It refuses to prompt under `--json` or into a pipe.

- Terminal output is readable. Tables carry one rule under the header instead of one between every row, columns of figures set to the right, and every block wraps to the pane: on this laptop the widest line went from 762 characters to 100. `doctor` groups its checks under one heading per provider rather than repeating the provider down twenty-four boxed rows, names each check without the prefix it is already filed under, shows a remedy in full where a check wants action and clipped to a line where it passed, and ends with a count by status. `assess` draws each plan's multiple as a bar against the largest in its own table, and leads the months row with a sparkline of the same figures. Durations print as durations, so the longest session reads `23d 9h` rather than `33708m`. Every figure has an ASCII form, selected by `DECADRA_ASCII` or a non-UTF-8 locale. `--json` is unchanged throughout.

- Prices are checked. A cache rate is compared to its own model's input rate, and a rate outside what any vendor publishes warns rather than passing silently: the schema takes any number, and a rate wrong by a factor still costs more than $0, so the zero-price check never saw it. The cache-write rate is also compared to the TTL the transcripts on disk actually asked for, per provider. Both are warnings; these are other people's prices and they move.

- The record of what ccusage does with a cache-write price was wrong. It holds one cache-creation rate per model and charges it to every write whatever the TTL; it parses the 1-hour and 5-minute split and sums it before pricing. `doctor` no longer tells anyone to enter the 5-minute rate, and the reader now records the split, surfaced in `sessions` and in `--json`.

- Two counting fixes. Peak context is divided by assistant replies rather than human turns, since fan-out varies enough that the old denominator mostly measured how far the tool ran unattended; the `--json` key is now `contextPerReply`. A sidechain's effort label is no longer taken as the effort of the session that spawned it.

- Installable by someone else: a `prepare` script, because `bin` pointed at a build that installing from the repository never ran; a CI step that packs the tarball, installs production dependencies and runs `doctor` out of it; line endings pinned to LF; and the suite running on Windows as well as Linux, with fixture paths resolved through `fileURLToPath` rather than `URL.pathname`.

- `cap`, `waste` and `split` are recorded as planned, each with what it is blocked on. The planned-command list derives from the roadmap, so each answers for itself instead of failing as an unknown command.

- Correctness pass over the 2026-09-06 local run and the review that followed. Agent detection reads the session id each tool exports rather than guessing by mtime, and Codex is detected by the names 0.144.6 actually sets. Utilization is scaled by the plan each sample was recorded on, and a plan that cannot be priced from the ingested data no longer wins a verdict at $0. Both readers count what the tools write: origin-less user lines are judged rather than assumed, and Codex `custom_tool_call` counts as a tool call with its input decoded before the commit rule reads it. A ccusage row missing a field the tool always emits is refused instead of read as zero usage. Alerts require calendar-adjacent months and evidence recorded after a baseline change. The `!` path went from 560 ms to about 200 ms for one provider and from 1148 ms to about 380 ms for all of them; `sessions` went from two git processes per session to one lookup per working directory. Output names no decadra version, and `doctor` warns when a reader's pin does not match the sessions on disk.

- `decadra alerts check | list | schedule --print`: plan-change alerts from the stored verdict history. Fires only when one provider's own plans point the same way for N consecutive monthly verdicts (default 2) over at least 30 days, once per direction and plan until the baseline changes. Quiet and exit 0 otherwise, so it runs under cron or launchd; `schedule --print` emits the platform entry and never installs it.

## 0.3.0 (unreleased)

- `decadra sessions`: effort per session for Claude Code and Codex from native thin readers. Human turns, wall and active minutes (gaps capped at the idle setting), tool calls, and three commit signals: a git commit call in the transcript (primary), a commit in the session window in that directory (secondary, labelled weak), and the Claude co-author trailer. Medians and p90 per provider, one block per provider.
- Readers extract timestamps, entry kinds, cwd, tool-call names and unit counts only. Claude: depth-one files, `origin.kind` for human turns, subagents and compaction summaries excluded, distinct `message.id` for assistant messages. Codex: `event_msg` user messages only, rollouts deduped by session id, rate-limit snapshots collected.
- `assess` uses recorded Codex utilization from those snapshots ahead of anchors.
- A redacted real Claude Code fixture with its subagent file, and a redacted real Codex 0.144.6 rollout.
- Probe result on one laptop (34 Claude sessions, 60 days): commit call in 24% of sessions, time-window signal ambiguous 18%, agreement 87%, Spearman 0.65. The transcript signal is primary; the time window ships as secondary.

## 0.2.0 (unreleased)

- `decadra now`: the in-session money meter. Detects Claude Code, Codex, or the Cursor CLI from the environment, finds the current session, and prints this session, today, month to date against the held plan, pace, ceiling evidence, and the last verdict. `--all` for every provider with the bill line. Always exits 0.
- `decadra assess`: effective cost under every plan for observed usage, calendar months with partial-month handling, day-aligned weekly peaks and 5-hour block peaks, held-plan timeline from the baseline, one verdict per provider appended to `verdicts.jsonl`. `--json` and `--html`.
- Bare `decadra` inside an agent prints `now` instead of the home screen.
- Shared ccusage data layer with pricing overrides generated from `plans.json`, `--mode calculate` for Claude, normalized rows that accept the Codex `costUSD` shape.
- `doctor` fails on models priced at $0 with tokens present and warns on incomplete `modelPricing` entries.
- Bill line: the sum of subscription prices from the baseline, the one figure that spans providers, documented as a carve-out in `AGENTS.md`.
- Codex rows parse: `models` as an object keyed by model name, cost at row level only, session ids as dated rollout paths. Real fixtures captured from a laptop replace the documentation-derived guess.

## 0.1.0 (unreleased)

- Scaffold: TypeScript, ESM, Node 22.13 or later, single-file build.
- `decadra baseline add | list`: append-only snapshots of every subscription held.
- `decadra doctor`: config validity, local data directories for Claude Code, Codex, Cursor, Devin, and Muse Code, git and ccusage availability.
- `~/.decadra/plans.json` created on first run with the generic plan model and a JSON schema for editor validation.
- Home screen with animated logomark when run on a terminal with no arguments.
- Report pipeline and verdict guard tests, ahead of `assess` in 0.2.0.
- Plan-fit math (`src/analysis/planfit.ts`) with scenario tests for capped, included-credit, and metered plans, ahead of `assess`.
- ccusage v20 output schemas validated against real captures, including the zero-priced-model check.
- `scripts/probe-commit-proxy.ts`, the slice 0 experiment for the commit-correlation proxy.
- `docs/demand-notes.md`: what the search found about demand and competing tools.
