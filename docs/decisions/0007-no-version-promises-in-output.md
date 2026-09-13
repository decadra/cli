# 0007: Output names no decadra version

Date: 2026-09-06. Status: accepted.

- Nine sites named a future version ("arrives in 0.4.0"), on a build that was already 0.4.0. Nothing had ever been released, so every one of them was a guess.
- One of those strings is written into `verdicts.jsonl` through the verdict's `evidence`. That store is append only and read back by `now` and `alerts`, so a version promise there becomes a false statement on disk that nothing can correct.
- The rule that follows: only persist a statement that stays true whenever it is read. "import (decadra import cursor \<file\>)" is such a statement. "0.4.0" is not.
- Output therefore names no decadra version other than the one running. A planned capability is described by the action it will enable and a pointer to `docs/plans/README.md`, which is maintained.
- `src/roadmap.ts` holds those descriptions with no version field, so there is no place to put one back.
- Enforced by a scan over `src/` in `test/invariants.test.ts`. Comments and a reader's `verifiedAgainst` pin are excluded: those name a vendor build the reader was checked against, which is a fact about someone else's software and does not rot.
- The JSON key `plannedVersion` is replaced by `plannedDocs`. Nothing had been published, so no consumer existed.
