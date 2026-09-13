# Scenarios

Each scenario is a developer workflow with pass criteria. The executable version is in `test/scenarios.test.ts` under the same id, or named as a manual step. When a scenario changes, change both.

## R1 Shadow observation and outcome

Inside either supported Primary, submit a metadata manifest for an explicitly configured Executor Pool. Pass: a receipt contains only opaque identifiers, fixed classification reasons and UTC metadata. No agent is launched. Record an externally verified result; mandatory failure cannot become success. Repeating a receipt is idempotent, and a correction appends without changing the original record. Executable in `test/routing-command.test.ts`.

## R2 Evidence isolation

Collect observations under multiple executor configurations and both benchmark suites. Pass: statistics require one configuration and role, native units remain separate, controlled and ecological evidence never mix, and sparse observations have no success probability or calibration claim. Executable in `test/routing-command.test.ts` and `test/routing-policy.test.ts`.

## R3 Current terminal executor database

Open the real redacted database through the provider reader. Pass: hidden work is excluded, unknown or missing telemetry remains absent, message content does not enter normalized records, the source is never modified and doctor distinguishes installation from actual visible activity. Executable in `test/devin-reader.test.ts`.

## S1 First run on a clean machine

A developer installs, runs `decadra doctor` with no config dir. Pass: `plans.json` and its schema are created; every provider is listed found or absent without error; a second run creates nothing and changes nothing; exit 0 when no model is zero-priced. Executable.

## S2 In-session readout from Claude Code

Inside a Claude Code session in a repo, the developer types `!decadra now`. Pass: exactly one block, for Claude, naming the current session with its cost; the session is the one `CLAUDE_CODE_SESSION_ID` names, not the newest file in the project directory; no bill line; exit 0; the readout caveat is printed; under one second on a normal history (manual on a real laptop; the executable version asserts the block shape and exit code). Executable plus manual.

## S3 Month-end review with anchors

A developer with a baseline and anchors set runs `assess --months 3` with two full months of data. Pass: one section per provider in alphabetical order; a table with effective cost and multiple per plan; a ceiling column that says fits or above the estimate; a verdict with a direction and evidence lines; one verdict per provider appended; JSON with exactly the allowed top-level keys. Executable.

## S4 Tier change mid-window

A developer downgrades from Max 20x to Max 5x on the 15th. Pass: the held plan in the verdict is the one held on the window's last day; the section lists both plans held in the window; the paid figure splits the month by days. Executable.

## S5 A new model priced at $0

ccusage's offline table predates a model the developer used. Pass: `doctor` fails naming the model and the `modelPricing` key; `assess` and `now` show the warning; after the entry is filled with all four prices, `doctor` passes and cost is nonzero. Executable (`test/commands.test.ts`, doctor pricing checks) plus manual on a real laptop for the override path through ccusage.

## S6 Codex-only user

No Claude Code directory; Codex rollouts exist. Pass: the ChatGPT block shows cost from Codex rows with `models` as an object; the Claude block says absent or no evidence rather than failing; `sessions` reports the effort labels that provider wrote, in that provider's own vocabulary; it reads Codex rollouts and counts human turns from `user_message` events only, once per `(cwd, timestamp)` across a fork, a resume, and an archived copy of the same session; `custom_tool_call` counts as a tool call and its decoded input is what the commit rule reads. Executable.

## S7 No baseline yet

A developer runs `now` and `assess` before recording anything. Pass: `now` says "none recorded" with the command to run; the recommendation line says to record a baseline rather than "not enough data"; nothing crashes. Executable.

## S8 Alerts after two agreeing months

Two monthly verdicts point to the same cheaper plan. Pass: `alerts check` fires once with a one-provider message, appends the record, and is silent on the next run until the baseline changes. Executable (`test/alerts.test.ts`).

## S9 Effort read on a real transcript

A real redacted Claude Code transcript with a subagent file. Pass: human turns equal the count of human-origin user lines, a line with no origin counts only when a person wrote it rather than the transcript echoing a command or an injected note, subagent files are ignored, the commit call is detected, active minutes never exceed wall minutes, no placeholder text reaches the record. Executable (`test/readers.test.ts`, `test/sessions-command.test.ts`).

## S10 Piped and scripted use

`decadra --json doctor | jq` in CI, `decadra now` piped to a file. Pass: no home screen, no animation, no ANSI codes in JSON, `--html` rejected by any command that cannot write one, help printed when not a terminal and no command given. Executable for JSON validity; manual for the piped terminal path.

## S11 Home screen on a bare terminal

A developer types `decadra` with no arguments on a terminal outside any agent shell. Pass: the frame is the wordmark, the seven menu items, and the key hints, with the logomark beside them when the terminal is wide enough to hold both; the mark steps between three sizes as the terminal grows and disappears when there is no room for it; no line exceeds the terminal width at any width; every menu label except `exit` is the subcommand word the developer would type; selecting an item runs that command. Executable (`test/logomark.test.ts`) plus manual for the keys and the restored terminal.

## S12 A cache rate that is wrong but not zero

A developer fills in `modelPricing` by hand and enters a cache read of 0.25 against an input of 10, and a cache write at the 5-minute rate while every session writes for an hour. Pass: `doctor` warns on the read as a ratio of that model's own input price, naming the model; it warns separately that the writes on disk asked for a 1-hour TTL while the rate entered is the 5-minute one, and that warning names one provider and sums nothing across providers; neither warning is a failure; both go quiet once the rates are corrected; a home with no sessions produces no TTL check at all rather than a check reading zero. Executable (`test/plans.test.ts`, `test/commands.test.ts`).

## S13 doctor read at a glance

A developer runs `decadra doctor` on a machine with several providers absent. Pass: checks are grouped under one heading per provider with decadra's own first, each check named without the provider prefix it is already filed under; status is a glyph two columns wide so the list stays aligned; a remedy is shown in full on a check that wants action and on one line on a check that passed; the run ends with a count by status; no line exceeds the terminal width; `DECADRA_ASCII=1` produces the same report with no character above 7-bit; `--json` is unchanged and still carries every detail whatever the status. Executable (`test/commands.test.ts`, `test/layout.test.ts`) plus manual for the width.

## S14 First run on a machine that has never used decadra

A developer installs decadra and types `decadra` on a terminal with nothing recorded. Pass: setup is offered once, before the home screen; declining is remembered and never asked again; accepting shows what was detected with the date its usage data starts, preselects the providers with data on disk, asks which plan for each chosen provider, and writes both the snapshots and `providers.show`. Re-running setup with the same answers records nothing new; re-running with a different plan appends a snapshot dated today. Neither the offer nor the command ever prompts inside an agent's `!` shell, under `--json`, or when stdout is a pipe. Executable for the pure parts and the refusals (`test/setup-command.test.ts`); manual for the keys (`docs/testing/manual-checklist.md`).

## S15 A machine that uses one provider

A developer uses Claude Code only, has tried the Devin CLI once, and has never opened Cursor or Muse Code. Pass: `assess`, `sessions` and `now` cover Claude Code alone; the Devin CLI leaving a `sessions.db` behind does not make it a provider in use; each report names what it left out and how to change that, in the terminal and in `--json`; `doctor` still reports on all five, including Devin's `sessionsDb` as present; naming a hidden provider with `--provider` reports on it anyway. Executable (`test/provider-visibility.test.ts`).
