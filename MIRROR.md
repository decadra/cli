# About this repository

This is the public release mirror of Decadra. It is generated from a private
working repository and holds the source of the current release.

Development, including work that is not yet released, happens privately. What
that means in practice is listed below, so you can see the boundary rather than
guess at it.

## Not present here

- `.github/workflows/evals.yml`
- `docs/decisions/0009-shadow-executor-eligibility.md`
- `docs/decisions/0010-decadra-picagear-boundary.md`
- `docs/module.md`
- `docs/picagear.md`
- `docs/plans/2026-09-12-routing-shadow.md`
- `docs/plans/2026-09-14-routing-core-module.md`
- `docs/plans/2026-09-27-joint-phase-three.md`
- `docs/routing.md`
- `docs/testing/2026-09-12-routing-verification.md`
- `docs/testing/2026-09-14-routing-core-verification.md`
- `evals/.gitignore`
- `evals/README.md`
- `evals/bridge.ts`
- `evals/decadra_evals/__init__.py`
- `evals/decadra_evals/bridge.py`
- `evals/decadra_evals/models.py`
- `evals/decadra_evals/runner.py`
- `evals/decadra_evals/scoring.py`
- `evals/requirements.in`
- `evals/requirements.lock`
- `evals/tests/test_evals.py`
- `evals/tsconfig.json`
- `scripts/consumer-smoke.mjs`
- `src/analysis/routing-lifecycle.ts`
- `src/analysis/routing.ts`
- `src/commands/route.schema.ts`
- `src/commands/route.ts`
- `src/git/repository.ts`
- `src/index.ts`
- `src/routing/core.ts`
- `src/routing/errors.ts`
- `src/routing/events.ts`
- `src/routing/explanation.schema.ts`
- `src/routing/factory.schema.ts`
- `src/routing/lifecycle.schema.ts`
- `src/routing/reason-explanations.ts`
- `src/routing/receipts.schema.ts`
- `src/routing/schema.ts`
- `src/store/routing.ts`
- `test/package-exports.test.ts`
- `test/routing-command.test.ts`
- `test/routing-core.test.ts`
- `test/routing-explanation.test.ts`
- `test/routing-factory.test.ts`
- `test/routing-help.test.ts`
- `test/routing-invariants.test.ts`
- `test/routing-lifecycle-stats.test.ts`
- `test/routing-lifecycle.test.ts`
- `test/routing-policy.test.ts`
- `test/routing-repository.test.ts`
- `test/routing-schema.test.ts`

## Present but modified here

These files exist upstream in a fuller form. The differences are the parts that
reference the modules listed above, plus the build not emitting source maps.

- `.github/workflows/ci.yml`
- `README.md`
- `docs/architecture/commands.md`
- `docs/architecture/overview.md`
- `docs/testing/README.md`
- `docs/testing/manual-checklist.md`
- `package.json`
- `src/cli.ts`
- `src/config/settings.ts`
- `tsup.config.ts`
- `tsup.config.ts`

## Reporting a problem

Open an issue. Pull requests against this repository are not merged directly,
because it is generated, but they are read and applied upstream.
