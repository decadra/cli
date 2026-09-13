# Decisions

Short, dated records of choices that constrain the code. One file per decision. A decision stays until a later one supersedes it, in which case both remain and the newer one says so.

| # | Decision |
|---|---|
| 0001 | Wrap ccusage, do not wrap codeburn, native readers only where ccusage has nothing |
| 0002 | No cross-provider verdict, enforced by structure and tests, not a runtime text scan |
| 0003 | The bill line is the one allowed cross-provider figure: prices paid, never usage |
| 0004 | The transcript-detected commit call is the primary commit signal; the time window is secondary |
| 0005 | `decadra now` is the primary surface; inside an agent, bare `decadra` prints it |
| 0006 | ccusage invocation rules learned from the binary: offline always, mode only on claude, session until exclusive, all four prices or none |
| 0007 | Output names no decadra version; a planned capability is named by its action, not its release |
| 0008 | Context size is the cost driver, not effort; `sessions` leads with peak context per reply |
| 0009 | Shadow executor eligibility records local metadata without selecting providers or dispatching work |
