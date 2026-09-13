import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/report/render';
import { PLACEHOLDERS } from './placeholders';
import { twoProviderReport } from './helpers';

describe('privacy', () => {
  it('no redaction placeholder reaches json output', () => {
    const out = renderReport(twoProviderReport(), 'json');
    for (const p of PLACEHOLDERS) expect(out).not.toContain(p);
  });
});
