---
name: add-provider
description: Add a new provider to Decadra (a coding CLI with local logs, a CSV or JSON import format, or a manual usage source) following the adapter contract, the reader budget, and the fixture rules. Use when someone asks to support a new tool, vendor, or plan.
---

# Add a provider

Follow every step. Skipping the fixture or the doctor check is not a shortcut, it is a rejected change.

1. Decide the ingest kind. In order of preference: `ccusage` if ccusage already reads the tool (then no reader is needed, only an adapter and plans), `native` if the tool writes local logs, `import` if the vendor offers an official export, `manual` if nothing else exists. Do not add a cookie-authenticated or scraped source.
2. Verify the log location and format on a real installation or a real export. Record the tool version. Write down which fields carry timestamps, working directory, a session id, human turns, tool calls, and unit counts. If you cannot verify a field's meaning, say so in the adapter comment and do not use it.
3. Capture a real fixture and run the `redact-fixture` skill on it. Put it under `test/fixtures/<id>/` with a README naming the version and date.
4. Create `src/providers/<id>/adapter.ts` implementing `ProviderAdapter` from `src/providers/types.ts`: `id`, `displayName`, `meter`, `usage`, optional `sessions`, optional `ceilingSignal`, and a `doctor` check.
5. If `native`, write the reader in the same directory under the reader budget in `AGENTS.md` and `docs/architecture/constraints.md`. Map records into `SessionRecord` through `src/ingest/normalize.ts`. Skip unknown record types.
6. Register the adapter in `src/providers/registry.ts`.
7. Add the provider's plans to the scaffold in `src/config/plans.ts` using the generic plan model (`capped-window`, `included-credit`, or `metered`) with an `asOf` date and a source note. Add its models to `modelPricing` with all four token classes.
8. Write tests: reader on fixture, one malformed record, one unknown record type, and the doctor check in both found and not-found states.
9. Add a section under "Providers" in `docs/adding-a-provider.md` with what you verified in step 2.
10. Run `npm run lint`, `npm test`, `npm run build`, and `node dist/cli.js doctor`. All must pass.
11. Open one PR per provider. The PR body lists the verified log location, the fields used, the fields ignored, and the fixture version.
