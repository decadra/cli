# Claude Code fixture

`sessions/2f44129c-0000-4000-8000-000000000001.jsonl` is the first 400 lines of a real Claude Code 2.1.261 transcript captured 2026-09-05 in a remote container, redacted with the `redact-fixture` skill. `sessions/<id>/subagents/agent-fixture01.jsonl` is the head of a real subagent transcript from the same session.

Redacted: all prompt, assistant, thinking, tool input and tool result text, replaced with `[redacted N lines]`; the cwd, replaced with `/home/fixture/decadra`; session, message, request and tool ids, replaced with stable fakes; the git branch name. Bash tool inputs that ran `git commit` keep a placeholder command containing `git commit` so the commit-call rule can be tested.

Kept: every `type`, `timestamp`, `origin`, `isSidechain`, `version`, `message.id`, `message.model`, `message.usage`, and content block types.

Cases covered: human turns identified by `origin.kind`, a `task-notification` user line that must not count, a `queue-operation` line, streaming assistant lines sharing one `message.id`, tool_use blocks including a git commit call, and a subagent file that must be ignored.
