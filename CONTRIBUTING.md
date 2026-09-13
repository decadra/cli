# Contributing

Read `AGENTS.md` first. It is a router: the hard rules inline, everything else linked. `docs/architecture/` is current; `docs/plans/` is history; `docs/decisions/` says why; `docs/testing/` says what done means.

## Setup

```
npm install
npm run check      # lint, typecheck, tests, build
node dist/cli.js doctor
```

## Adding a provider

Follow `docs/adding-a-provider.md`. The same steps exist as a Claude Code skill in `.claude/skills/add-provider/`, and the redaction procedure for fixtures in `.claude/skills/redact-fixture/`. One provider per pull request.

## What gets a change rejected

- A cross-provider comparison anywhere in output, JSON included.
- A write to any session directory.
- A network call outside `src/net/`.
- A reader over budget, or one without a real redacted fixture.
- A synthetic fixture.
- A new native dependency.

## Commits

Imperative subject under 72 characters, body says why. One concern per commit. No model identifiers in the subject or body; a `Co-Authored-By` trailer is attribution and is exempt.
