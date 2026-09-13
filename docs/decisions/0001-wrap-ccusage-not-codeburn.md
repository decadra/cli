# 0001: Wrap ccusage, do not wrap codeburn

Date: 2026-09-05. Status: accepted.

Context: two maintained tools read coding-agent logs. ccusage (about 18k stars) covers 18 CLIs including Claude Code and Codex, is CLI only with no library API, and prices offline from a bundled table when asked. codeburn (about 11k stars) covers 25 or more tools including Cursor and Devin, fetches pricing and exchange rates over the network by default with no offline switch, installs a native SQLite module at run time, estimates Cursor tokens from character counts, and has no per-session JSON.

Decision: ccusage is a pinned dependency and owns tokens and cost for every source it supports, always invoked with `--offline`. codeburn is not a dependency. Where ccusage has nothing (Cursor, Devin, Muse) or does not emit what the effort read needs (per-message timestamps, human turns, cwd), Decadra carries a native reader under the budget in `docs/architecture/constraints.md`, written with codeburn's MIT parsers as reference.

Consequences: no network at run time; one pricing path; readers stay small. Open fork: once `modelPricing` overrides are maintained by hand, ccusage's contribution for Claude shrinks to parsing and dedupe. If its stale price table keeps costing correctness, cost may move into the readers and ccusage becomes a `doctor` cross-check. That call is made on laptop evidence.
