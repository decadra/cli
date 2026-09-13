# Devin database fixture

Captured on 2026-09-12 from the installed Devin CLI, version 3000.10.21. Existing historical rows do not declare their writer version. The fixture retains that uncertainty rather than assigning the installed version to them.

The SQLite database was backed up read only into a scratch copy. `redact.mjs` transformed that copy and vacuumed it to remove stale content pages. All original table schemas are preserved. Prompts, assistant content, thinking, tool arguments and responses, rendered HTML, titles, rule contents and free text were replaced with `[redacted]`. Paths and identifiers were replaced consistently. App state was cleared. Timestamps, model metadata, structure, visibility, token metrics and native resource counts are original observations. No rows were fabricated.

The fixture contains an empty visible session, an old hidden session with real metrics and duplicated off-chain nodes, and the visible session from a bounded headless trial. The trial was rejected by the backend before its first assistant response, which exercises missing metrics honestly. The hidden session exercises main-chain traversal, human-origin input, duplicate exclusion, recorded latency, runtime model discovery, cache-write nulls and separate native credit and compute-unit fields. Successful visible generation has not been verified.

The reader selects individual JSON metadata fields in SQLite. It never materializes message content, tool arguments, thinking or results. Database metadata does not establish that a configured model was entitled or successfully invoked.
