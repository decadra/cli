# Subagent briefs

Each file here is a subagent definition Claude Code can delegate to. Frontmatter carries `name`, `description`, and the tools the agent may use. The body is the brief.

Briefs must restate the constraint they are most likely to break, because a subagent starts with no memory of `AGENTS.md`.

Current briefs:

- `provider-author.md`: writes a new provider adapter and reader under the reader budget.
