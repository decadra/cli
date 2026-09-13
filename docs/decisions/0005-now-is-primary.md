# 0005: `decadra now` is the primary surface

Date: 2026-09-05. Status: accepted.

Context: the user's actual habit is the `!` shell inside Claude Code and Codex. The tracking category is crowded with after-the-fact dashboards and menu-bar limit gauges; none is designed to be called from inside the agent, and none is plan-aware across billing shapes. Since Claude Code 2.1.186 the agent reads `!` output.

Decision: `now` is the readout, built to return in well under a second, fit in a pane, exit 0 always, and carry a line saying it is a readout and not an instruction. Bare `decadra` inside an agent (detected from `CLAUDECODE`, `CODEX_SANDBOX*`, `CURSOR_TRACE_ID`) prints `now`; the animated home screen appears only on a bare terminal. No charts, no TUI dashboard, no live quota polling with vendor credentials. Integration beyond the manual `!` call is deferred.
