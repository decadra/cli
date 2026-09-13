import { describe, expect, it } from 'vitest';
import { notBuiltYet, PLANNED, PLANNED_DOCS } from '../src/roadmap';
import { runPlanned } from '../src/commands/planned';
import type { CommandContext } from '../src/commands/context';
import { resolvePaths } from '../src/config/paths';

const ctx = (format: 'terminal' | 'json', out: string[]): CommandContext => ({
  paths: resolvePaths('/tmp/roadmap'),
  format,
  htmlPath: undefined,
  write: (s) => out.push(s),
  version: 't',
});

describe('roadmap', () => {
  it('every planned capability says what it gets you and what is missing', () => {
    for (const [name, p] of Object.entries(PLANNED)) {
      expect(p.gets, name).toMatch(/\S/);
      expect(p.gets, name).not.toMatch(/^[A-Z]/); // reads as the tail of "not built yet: ..."
      // needs is nullable, but null has to be a decision rather than an unfilled field
      expect(p.needs === null || p.needs.length > 10, name).toBe(true);
    }
  });

  it('names no version, since a promised release rots the day it slips', () => {
    for (const [name, p] of Object.entries(PLANNED)) {
      const text = `${p.action ?? ''} ${p.gets} ${p.needs ?? ''}`;
      expect(text, name).not.toMatch(/\bv?\d+\.\d+\b/);
      expect(text, name).not.toMatch(/\bslice \d|\bQ[1-4]\b|\bnext (release|version)\b/i);
    }
  });

  it('answers for a capability it knows and for one it does not', () => {
    expect(notBuiltYet('cap')).toContain('not built yet');
    expect(notBuiltYet('cap')).toContain(PLANNED_DOCS);
    expect(notBuiltYet('nonesuch')).toBe(`nonesuch is not available yet. Open work is listed in ${PLANNED_DOCS}.`);
  });

  it('exits 2 and writes machine-readable json for every planned command', () => {
    for (const name of Object.keys(PLANNED)) {
      const out: string[] = [];
      expect(runPlanned(ctx('json', out), name), name).toBe(2);
      expect(JSON.parse(out[0] as string)).toEqual({ command: name, available: false, plannedDocs: PLANNED_DOCS });
      const term: string[] = [];
      runPlanned(ctx('terminal', term), name);
      expect(term[0], name).toContain(PLANNED[name]!.gets);
    }
  });
});
