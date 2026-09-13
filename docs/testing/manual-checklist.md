# Manual checklist

For a person, or a local Claude Code session driving a real terminal. Run from the repo after `npm run build`. Record results in the pull request.

## Setup

- [ ] `node dist/cli.js doctor` on a fresh `DECADRA_HOME`: every provider listed, no crash, pricing rows present.
- [ ] `doctor` reader pin rows: each says the pin matches, or names the build the sessions on disk were written by.
- [ ] `node dist/cli.js doctor` on your real home: note which models are zero-priced and fill `modelPricing`; rerun until `no failures`.
- [ ] `node dist/cli.js baseline add` interactively: prompts make sense, the record prints, `baseline list` shows it as current.

## The `!` path

- [ ] Inside Claude Code in a repo: `!decadra now` (or the full `node dist/cli.js` path). One block, the current session named, cost and minutes present, exit 0.
- [ ] Inside Codex: same. If five blocks appear, paste `!env | grep -i codex`.
- [ ] `now --timing` on your real history: note the milliseconds. Above about one second is a finding.
- [ ] Read the block as the agent would: does anything in it read as an instruction? It should not.

## Terminal feel

- [ ] `node dist/cli.js` on a bare terminal: the home screen animates, keys 1 to 7 and arrows work, `q` exits, the terminal is restored cleanly.
- [ ] `DECADRA_HOME=$(mktemp -d) node dist/cli.js`: setup is offered before the home screen. Decline it, quit, and run again: it is not offered a second time.
- [ ] `DECADRA_HOME=$(mktemp -d) node dist/cli.js setup`: the survey names only what is on this machine, providers with data are preselected, arrow keys and space move and toggle, `Ctrl-C` at any prompt leaves nothing behind. Run it twice with the same answers: the second run records nothing new.
- [ ] `node dist/cli.js setup | cat` and `node dist/cli.js setup --json`: both refuse with a message pointing at `baseline add`, and no prompt decoration reaches the pipe.
- [ ] Resize the terminal wider and narrower: the logomark steps between three sizes at about 90, 117 and 120 columns, drops entirely below about 90, and no line ever wraps. The wordmark and menu stay at every width.
- [ ] Make the terminal short (about 24 rows) on a wide pane: the mark steps down rather than pushing the key hints off the bottom.
- [ ] `node dist/cli.js | cat`: help, no escape codes, no animation.
- [ ] `assess` and `sessions` tables fit an 120-column pane without wrapping mid-cell.
- [ ] `now --timing` reports each provider's own elapsed time and a separate total, not a running sum.

## Numbers

- [ ] `assess --months 3`: months line matches what you remember using; partial and pre-data months are labelled; the recommendation line names only that provider's plans.
- [ ] `sessions --months 1`: medians look plausible against your memory of last week; the weak-proxy caveat is present.
- [ ] `--json` on each command pipes into `jq` without error.

## Alerts

- [ ] `alerts check` with fewer than two months of verdicts: prints nothing, exit 0.
- [ ] `alerts schedule --weekly --print`: the entry references the right node and cli path for this machine.

## Shadow routing

- [ ] In each supported Primary, submit a strict metadata manifest using an isolated config directory. Confirm UTC receipt and insufficient evidence for a safe new task.
- [ ] Repeat with a sensitive risk label. Confirm Primary only classification regardless of any historical successes.
- [ ] Record independently run gates and resources, then view one configuration and role. Confirm a mandatory failure stays failed and missing usage is absent.
- [ ] Run controlled and ecological attempts separately from the same immutable snapshot. Keep hidden checks outside the worker checkout. Confirm statistics never blend the suites.
- [ ] Confirm the local event file contains no prompt, source, patch, command or result bodies. Decadra creates no remote connection.
- [ ] Attempt a tiny executor task using existing quota. Record authentication, permission or quota failures honestly. Do not count unavailable telemetry as zero consumption or an execution success.
