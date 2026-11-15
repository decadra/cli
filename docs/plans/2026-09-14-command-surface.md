# Keep the command surface executable

Date: 2026-09-14. Status: implemented, pending review.

Remove the six unimplemented command placeholders: import, usage, prices, cap, waste and split. Keep existing plan-fit reporting, local diagnostics and routing evidence commands. Preserve the legacy aggregate outcome format alongside lifecycle observations.

Remove stale invocation advice from current documentation and diagnostics. Historical plans remain unchanged. Provider readers and persisted histories are unchanged.

Verify help, invalid-command failures and legacy entry points with command-surface tests, then run the repository checks.
