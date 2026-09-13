<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/mark-dark.svg">
  <img src="assets/mark.svg" alt="" width="76">
</picture>

# Decadra

**Does the AI coding plan you pay for fit the usage you put through it.**

Per provider, never across providers.

[![ci](https://github.com/rishabbalak/decadra/actions/workflows/ci.yml/badge.svg)](https://github.com/rishabbalak/decadra/actions/workflows/ci.yml)
[![license: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-0a0a0a)](LICENSE)
[![node >= 22.13](https://img.shields.io/badge/node-%E2%89%A5%2022.13-5fa04e)](package.json)
[![decadra.dev](https://img.shields.io/badge/decadra.dev-0a0a0a)](https://decadra.dev)

</div>

```
Decadra v0.4.0
────────────────────────────────────────────────────────────────────────────────────────────────────


          .-+*#%###*=:
       :+##%###########+=-.              ____                          _
     -#*+=-----=%#+---=====++:          |  _ \   ___   ___   __ _   __| | _ __   __ _
   .+%++++++*+-+#*--------::#%#-        | | | | / _ \ / __| / _` | / _` || '__| / _` |
  :=%#==++*+=--%#+----=---==#%##+.      | |_| ||  __/| (__ | (_| || (_| || |   | (_| |
 .-*%#-====---*%%+++*###%%%###**#+.     |____/  \___| \___| \__,_| \__,_||_|    \__,_|
 -=%##===+**#########*++=--:=#****:
.--%######**+*%##%+-::--===-:%#**+-.    > [1]  setup     what you use and what you pay for
 -:+%#-::::--*%*:=%%+==***+-:##**#-.      [2]  baseline  what you pay for today
 .::-*----=--%#=--:=#*****+=:*##*::.      [3]  assess    plan fit, one provider at a time
  .::*-:---=+%*:--=-:=***+==:+##=::       [4]  sessions  effort per session, medians
   ::==:::--%*+--=++==-=##+-:==+::        [5]  doctor    check local data and config
   .:::-=--+##=--=+*++-=-=**===::         [6]  docs      read the manual
     ::::=#%#**++*##**#****#+-:.          [7]  exit      leave the home screen
       :-:::-=+==+****+**+=::.
         ..::-:::::----:::.
                 .....

────────────────────────────────────────────────────────────────────────────────────────────────────
↑↓ move   1-7 select   enter run   q quit                                             decadra --help
```

Decadra reads the session logs that Claude Code, Codex, Cursor, Devin and Muse Code already write to your machine, computes what your observed usage costs under every plan the vendor sells, and adds a per-session effort read that nothing else emits. It reports each provider on its own. It never ranks providers against each other, because token counts measure consumption, not output.

## Status

0.4.0, unreleased. `now`, `assess`, `sessions`, `setup`, `alerts`, `baseline` and `doctor` work for Claude Code and Codex. Cursor import and the Devin and Muse readers need real fixtures and are the next slice. Architecture in `docs/architecture/`, the provider contract in `docs/adding-a-provider.md`, plans in `docs/plans/`, decision records in `docs/decisions/`, test criteria in `docs/testing/`, and what the search found about demand in `docs/demand-notes.md`. Agents working in this repo read `AGENTS.md`.

## Use

Inside a Claude Code or Codex session, from the `!` shell:

```
!decadra now
```

prints one block for the agent you are in: this session so far, today, month to date against the plan you hold, pace to month end, ceiling evidence, and the last plan-fit verdict. It always exits 0 and says it is a readout, not an instruction, because the agent reads it too.

From a plain shell:

```
npm install && npm run build
node dist/cli.js                   # home screen on a terminal, help when piped, `now` inside an agent
node dist/cli.js setup             # what this machine uses and what you pay for, in one pass
node dist/cli.js now --all         # every provider, plus the bill line from your baseline
node dist/cli.js baseline add      # record what you pay for today; prompts for anything missing
node dist/cli.js assess --months 3 # effective cost under every plan, one provider at a time
node dist/cli.js sessions          # turns, duration, tool calls, commit signals; medians per provider
node dist/cli.js doctor            # config, local data, pricing coverage, git, ccusage
node dist/cli.js --json assess     # machine output on any command; --html <file> for assess
```

`assess`, `sessions` and `now` report only on the providers a baseline names or that have usage data on disk, so a machine with one provider gets one block rather than five. `doctor` always reports on every provider. Run `decadra setup` or set `providers.show` in `settings.json` to change what is covered.

The first run creates `~/.decadra/plans.json` with the current plans for Claude, ChatGPT, Cursor, Devin, and Muse Code, plus a JSON schema so your editor validates edits. Prices are hand-maintained and dated; the file is never overwritten. Set `DECADRA_HOME` or pass `--config-dir` to keep it elsewhere.

Commands:

```
decadra setup            what this machine uses and what you pay for; re-run any time to change it
decadra now              this session, today, month to date, against the plan you hold
decadra baseline add     record a point-in-time snapshot of every subscription you hold, append only
decadra baseline list    every snapshot, newest first, with the current one per provider
decadra assess           plan fit and effective cost under every plan, per provider
decadra doctor           check config, every provider's local data, pricing coverage, git and ccusage
decadra sessions         turns, duration, and commit signals per session, medians per provider
decadra import cursor    load the official Cursor usage export                        (0.4.0)
decadra usage add        manual monthly usage for cloud-only sessions                 (0.4.0)
decadra prices refresh   opt-in price refresh, the only network call                  (0.5.0)
decadra alerts check     plan-change alerts from stored verdict history; quiet unless one fires
```

Everything runs offline. ccusage, which Decadra bundles for token and cost ingest, is always invoked with `--offline`. Price refreshes and vendor API pulls are separate opt-in commands.

## What it will never do

Rank providers against each other, or add their usage together. Token counts measure consumption, not output, and the units differ between vendors. Each provider gets its own block, in alphabetical order, with one recommendation line about that provider's own plans. This is enforced by the shape of the report type and a single render loop, and tested, not left to convention.

The one figure that spans providers is the bill line: the sum of subscription prices you recorded in the baseline. That is money paid, not usage.

## Pricing, and the one trap

Cost is list price from tokens, computed by ccusage offline. When a vendor ships a model newer than the bundled price table, ccusage prices it at $0.00, which looks like savings. `doctor` fails on any model that carried tokens at zero cost and names the `modelPricing` entry to fill in `~/.decadra/plans.json`. All four prices are required; ccusage prices 1-hour cache writes at twice the input rate, so a partial entry would silently under-count.

## License

Copyright © 2026 Decadra. All Rights Reserved.

Decadra is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). Any noncommercial purpose is permitted, including personal study, hobby projects, and use by charitable, educational, public research, public safety, health, environmental and government organizations.

Commercial use requires a separate license. See [decadra.dev](https://decadra.dev) for how to arrange one.
