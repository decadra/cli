/**
 * Every human-facing string on the home screen. Edit here, not in the renderer.
 * Menu labels are the words you type after `decadra`, so the screen teaches the
 * command line rather than decorating it.
 */
export const COPY = {
  name: 'Decadra',
  menu: [
    { id: 'setup', label: 'setup', hint: 'what you use and what you pay for' },
    { id: 'baseline', label: 'baseline', hint: 'what you pay for today' },
    { id: 'assess', label: 'assess', hint: 'plan fit, one provider at a time' },
    { id: 'sessions', label: 'sessions', hint: 'effort per session, medians' },
    { id: 'doctor', label: 'doctor', hint: 'check local data and config' },
    { id: 'docs', label: 'docs', hint: 'read the manual' },
    { id: 'exit', label: 'exit', hint: 'leave the home screen' },
  ],
  keys: '↑↓ move   1-7 select   enter run   q quit',
  help: 'decadra --help',
} as const;

export type MenuId = (typeof COPY.menu)[number]['id'];
