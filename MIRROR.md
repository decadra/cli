# About this repository

This is the public release mirror of Decadra. It is generated from a private
working repository and holds the source of the current release.

Development, including work that is not yet released, happens privately. What
that means in practice is listed below, so you can see the boundary rather than
guess at it.

## Not present here

- `docs/decisions/0009-shadow-executor-eligibility.md`
- `docs/plans/2026-09-12-routing-shadow.md`
- `docs/routing.md`
- `docs/testing/2026-09-12-routing-verification.md`
- `src/analysis/routing.ts`
- `src/commands/route.schema.ts`
- `src/commands/route.ts`
- `src/git/repository.ts`
- `src/routing/schema.ts`
- `src/store/routing.ts`
- `test/routing-command.test.ts`
- `test/routing-invariants.test.ts`
- `test/routing-policy.test.ts`
- `test/routing-repository.test.ts`
- `test/routing-schema.test.ts`

## Present but modified here

These files exist upstream in a fuller form. The differences are the parts that
reference the modules listed above, plus the build not emitting source maps.

- `src/cli.ts`
- `src/config/settings.ts`
- `tsup.config.ts`

## Reporting a problem

Open an issue. Pull requests against this repository are not merged directly,
because it is generated, but they are read and applied upstream.
