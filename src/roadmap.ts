/**
 * Capabilities that are designed but not built. No version is named here, deliberately.
 *
 * A promised version rots the day it ships without the thing it promised, and one of these
 * strings is written into verdicts.jsonl, which is append only, so a stale promise would
 * become a false statement on disk that nothing can correct. What does not rot is the
 * command a person will type and what it will get them. See docs/decisions/0007.
 */
export interface PlannedCapability {
  /** What to run once it exists, or null when there is no single command. */
  action: string | null;
  /** What it gets you, as the second half of "not built yet: ...". */
  gets: string;
  /**
   * What is missing before it can be built, or null when the answer is only time. Recorded so a
   * reader can tell a design decision from an unsolved one, and so this list cannot quietly grow
   * into a set of promises nothing is blocking.
   */
  needs: string | null;
}

export const PLANNED: Record<string, PlannedCapability> = {
  import: { action: 'decadra import <provider> <file>', gets: 'an official vendor export, starting with the Cursor CSV', needs: 'a real export to write the parser against; fixtures are redacted real files, never synthetic' },
  usage: { action: 'decadra usage add', gets: 'manual monthly usage for cloud-only sessions', needs: null },
  prices: { action: 'decadra prices refresh', gets: 'an opt-in price refresh, the only network call', needs: 'the opt-in network surface under src/net/' },
  cap: {
    action: 'decadra cap',
    gets: 'the date the plan window resets and whether the current pace reaches the cap first',
    needs: 'the reset time. Codex rollouts state resets_at and the reader keeps only the window length, used percentage and plan type; Claude states nothing at all. Without it there is a rate and no clock to run it against',
  },
  waste: {
    action: 'decadra waste',
    gets: 'replies that re-read files already in context without editing one',
    needs: 'file paths per tool call. No reader extracts them: the Claude reader reads only a command string and the Codex reader only decodes one for the commit rule',
  },
  split: {
    action: 'decadra split',
    gets: 'where a long session could have been broken, and what the re-read would have cost',
    needs: 'the same file paths as waste, plus a measurement of what re-establishing context costs. The second has never been measured and decides whether the answer is worth anything',
  },
};

/** Where open work is listed. Maintained, unlike a version number in a string. */
export const PLANNED_DOCS = 'docs/plans/README.md';
export const PLANNED_DOCS_URL = 'https://github.com/rishabbalak/decadra/blob/main/docs/plans/README.md';

/** "not built yet" phrasing for a capability, with no version in it. */
export function notBuiltYet(name: string): string {
  const p = PLANNED[name];
  if (!p) return `${name} is not available yet. Open work is listed in ${PLANNED_DOCS}.`;
  return `${name} is not built yet: ${p.gets}. Open work is listed in ${PLANNED_DOCS}.`;
}
