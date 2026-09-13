import { describe, expectTypeOf, it } from 'vitest';
import * as terminal from '../src/report/terminal';
import * as json from '../src/report/json';
import * as html from '../src/report/html';
import type { ProviderSection } from '../src/report/model';

describe('renderSection contract', () => {
  it('every format takes exactly one section', () => {
    expectTypeOf(terminal.renderSection).parameters.toEqualTypeOf<[ProviderSection]>();
    expectTypeOf(json.renderSection).parameters.toEqualTypeOf<[ProviderSection]>();
    expectTypeOf(html.renderSection).parameters.toEqualTypeOf<[ProviderSection]>();
  });
});
