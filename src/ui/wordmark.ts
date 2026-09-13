/** Block-letter wordmark, five rows. Replace with the designed mark when it exists. */
const LETTERS: Record<string, string[]> = {
  D: [' ____  ', '|  _ \\ ', '| | | |', '| |_| |', '|____/ '],
  e: ['      ', '  ___ ', ' / _ \\', '|  __/', ' \\___|'],
  c: ['      ', '  ___ ', ' / __|', '| (__ ', ' \\___|'],
  a: ['       ', '  __ _ ', ' / _` |', '| (_| |', ' \\__,_|'],
  d: ['     _ ', '  __| |', ' / _` |', '| (_| |', ' \\__,_|'],
  r: ['      ', ' _ __ ', "| '__|", '| |   ', '|_|   '],
};

export function renderWordmark(text = 'Decadra'): string[] {
  const rows = ['', '', '', '', ''];
  for (const ch of text) {
    const glyph = LETTERS[ch];
    if (!glyph) continue;
    for (let i = 0; i < 5; i += 1) rows[i] += glyph[i] as string;
  }
  return rows;
}
