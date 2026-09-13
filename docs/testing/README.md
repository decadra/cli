# Testing

Four layers. A change is done when all four hold.

| Layer | Where | What it proves | Run |
|---|---|---|---|
| Unit | `test/*.test.ts` | each module does its arithmetic, parsing, or rendering correctly on fixtures and inline inputs | `npm test` |
| Scenario | `test/scenarios.test.ts`, criteria in `scenarios.md` | a developer's workflow end to end through the real command code, with ccusage and the clock injected | `npm test` |
| Invariant | `test/invariants.test.ts`, `test/guard.test.ts`, `test/reader-budget.test.ts`, list in `invariants.md` | the rules in `docs/architecture/constraints.md` cannot be broken silently | `npm test` |
| Manual | `manual-checklist.md` | the thing feels right on a real terminal with real logs: timing, layout, the `!` path | a person, or a local Claude Code session driving the terminal |

Fixtures are real files, redacted with the `redact-fixture` skill, never synthetic. See `test/fixtures/README.md`.

`npm run check` runs lint, typecheck, unit, scenario, and invariant tests, then the build. CI runs the same on Node 22 and 24 and then `decadra doctor --json` on an empty config dir.
