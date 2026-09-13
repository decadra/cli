import { SHAPE, SHAPE_H, SHAPE_W } from './logomark-shape';

/**
 * The logomark: the Decadra coin, baked from assets/logomark.svg by scripts/gen-logomark.ts
 * and downsampled here to whatever the splash asks for.
 *
 * The drawing is fixed. Animation is a soft band of light travelling across the face, applied
 * only where the mark has ink, so the frame around it stays empty at every t.
 */
export const RAMP = ' .:-=+*#%@';

/** How far the sweep lifts the ink under it. Enough to read as movement, not enough to flatten the drawing. */
const SWEEP_GAIN = 0.22;
/** Width of the band, as a fraction of the diagonal it travels along. */
const SWEEP_BAND = 0.3;

/**
 * Ink at one cell of the baked grid, 0 to 1. Outside the artwork this is 0, which is what
 * keeps the corners of the frame empty.
 */
function inkAt(x: number, y: number): number {
  const row = SHAPE[y];
  if (row === undefined) return 0;
  const ch = row[x];
  return ch === undefined ? 0 : parseInt(ch, 16) / 15;
}

/**
 * Box-downsample the baked grid to `width` by `height`. Each output cell averages the source
 * cells it covers, so the mark degrades evenly rather than dropping detail at fixed points.
 */
function sample(width: number, height: number): number[][] {
  const out: number[][] = [];
  for (let j = 0; j < height; j += 1) {
    const y0 = Math.floor((j * SHAPE_H) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * SHAPE_H) / height));
    const row: number[] = [];
    for (let i = 0; i < width; i += 1) {
      const x0 = Math.floor((i * SHAPE_W) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * SHAPE_W) / width));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += inkAt(x, y);
          n += 1;
        }
      }
      row.push(n === 0 ? 0 : sum / n);
    }
    out.push(row);
  }
  return out;
}

export function renderLogomark(width: number, height: number, t: number): string[] {
  const grid = sample(width, height);
  const rows: string[] = [];
  // The band travels the diagonal, so it crosses the face rather than sliding along one edge.
  const phase = ((t * 0.22) % 2) - 0.5;
  for (let j = 0; j < height; j += 1) {
    let row = '';
    for (let i = 0; i < width; i += 1) {
      const ink = (grid[j] as number[])[i] as number;
      if (ink <= 0) {
        row += RAMP[0] as string;
        continue;
      }
      const along = (i / Math.max(1, width - 1)) * 0.6 + (j / Math.max(1, height - 1)) * 0.4;
      const lift = Math.max(0, 1 - Math.abs(along - phase) / SWEEP_BAND) * SWEEP_GAIN;
      const v = Math.min(1, ink + lift * ink);
      row += RAMP[Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1)))] as string;
    }
    rows.push(row);
  }
  return rows;
}
