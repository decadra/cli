@AGENTS.md

## Claude Code specifics

- Skills live in `.claude/skills/`. Use `add-provider` when adding a provider and `redact-fixture` before checking in any transcript.
- Subagent briefs live in `.claude/agents/`. `provider-author` is the one to delegate a new adapter to.
- Use plan mode before touching `src/report/**` or `src/providers/**`. Both carry constraints that are cheap to break and expensive to notice.
- New plans go in `docs/plans/` with a date prefix. Old plans are history, not targets; `docs/architecture/` is current.
- After a session that changed behaviour, update `docs/testing/scenarios.md` or `invariants.md` in the same commit as the code.
- Scratch files go in the session scratchpad, not in the repo.
- When verifying against a live transcript, this repository's own `~/.claude/projects` entry is a valid read-only sample. Never write there.
