# 0002: No cross-provider verdict, enforced by structure

Date: 2026-09-05. Status: accepted.

Context: the brief required that Decadra never rank providers or print "switch to X", enforced at the output layer. A runtime banned-phrase scan that exits the process was proposed and rejected in review: it cannot catch a comparison phrased differently, and a false positive gets it disabled.

Decision: the guard is structural. `Report.providers` is a record keyed by provider with no cross-provider fields. `src/report/render.ts` is the only loop over providers, alphabetical by id. Every format implements `renderSection(section)` for one section. Recommendation and alert lines are fixed templates over one section. The JSON output schema is strict with a snapshot of allowed keys. ESLint forbids `src/report` importing anything that knows providers or numbers. The phrase list and the two-names-plus-amount check run in tests over golden and fuzzed reports.

Consequences: adding a "total" row, a shared axis, a providers array, or a metric-ordered listing fails a test or the type checker. A comparison expressed in new words still cannot be produced, because no function receives two sections.
