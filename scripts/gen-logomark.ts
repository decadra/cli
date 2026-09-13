/**
 * Bakes assets/logomark.svg into src/ui/logomark-shape.ts.
 *
 * The mark is a grayscale trace: ~3000 subpaths over six fill levels, painted in document
 * order. Rendering it per frame is not free at 11fps, and shipping a path parser to draw a
 * splash screen is worse, so the shape is resolved here and the runtime only downsamples.
 *
 * Baked at 192x96. Two to one because a terminal cell is about twice as tall as wide, so a
 * square viewBox has to be squashed to read as a circle. Three times the largest size the
 * splash draws (64x32), which keeps the box filter clean at every step down.
 *
 * Run with: npm run gen:logomark
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Cells in the baked grid. */
const W = 192;
const H = 96;
/** Subsamples per cell per axis. 4 means each cell averages 16 points. */
const SS = 4;
/** Line segments per cubic. Fixed rather than adaptive so the bake is reproducible. */
const FLATTEN = 12;
/** Breathing room around the artwork, as a fraction of its longest side. */
const MARGIN = 0.02;

interface Pt { x: number; y: number }

/**
 * Parses the SVG path subset this asset actually uses: M, L, H, V, C, Z, all absolute.
 * Handles implicit repeated commands (a lone C followed by several coordinate sets) and the
 * implicit L that follows an M with extra pairs.
 *
 * Anything outside that subset throws. Both ways of getting it wrong are silent otherwise: a
 * relative command would be read as absolute, and an arc or a quadratic would not tokenise at
 * all, leaving its numbers to be eaten by whichever command came before it. Either bakes a
 * wrong drawing with no error, and the only signal would be someone noticing the splash looks
 * off. A re-export that changes the dialect should fail here instead.
 */
function parsePath(d: string): Pt[][] {
  const unsupported = [...new Set(d.match(/[A-Za-z]/g) ?? [])].filter((c) => !'MLHVCZ'.includes(c));
  if (unsupported.length) {
    throw new Error(`assets/logomark.svg uses path commands this generator does not implement: ${unsupported.join(', ')}. Re-export with absolute M/L/H/V/C/Z, or extend parsePath.`);
  }
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  const polys: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let cmd = '';
  let i = 0;

  const num = (): number => Number(tokens[i++]);
  const close = (): void => {
    if (cur.length > 2) polys.push(cur);
    cur = [];
  };

  while (i < tokens.length) {
    const tok = tokens[i] as string;
    if (/[A-Za-z]/.test(tok)) {
      cmd = tok.toUpperCase();
      i += 1;
      if (cmd === 'Z') {
        close();
        x = startX;
        y = startY;
        continue;
      }
    }
    if (cmd === 'M') {
      close();
      x = num();
      y = num();
      startX = x;
      startY = y;
      cur = [{ x, y }];
      // Any further pairs under the same M are line segments.
      cmd = 'L';
    } else if (cmd === 'L') {
      x = num();
      y = num();
      cur.push({ x, y });
    } else if (cmd === 'H') {
      x = num();
      cur.push({ x, y });
    } else if (cmd === 'V') {
      y = num();
      cur.push({ x, y });
    } else if (cmd === 'C') {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x3 = num();
      const y3 = num();
      for (let s = 1; s <= FLATTEN; s += 1) {
        const t = s / FLATTEN;
        const u = 1 - t;
        cur.push({
          x: u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          y: u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        });
      }
      x = x3;
      y = y3;
    } else {
      i += 1; // unknown command, skip a token rather than spin
    }
  }
  close();
  return polys;
}

/** Fills one path's polygons by non-zero winding, painting `gray` where it covers. */
function fill(polys: Pt[][], gray: number, buf: Float32Array, painted: Uint8Array, dw: number, dh: number, scaleX: number, scaleY: number, originX: number, originY: number): void {
  interface Edge { x0: number; y0: number; x1: number; y1: number; dir: number }
  const edges: Edge[] = [];
  let minY = Infinity;
  let maxY = -Infinity;

  for (const poly of polys) {
    for (let k = 0; k < poly.length; k += 1) {
      const a = poly[k] as Pt;
      const b = poly[(k + 1) % poly.length] as Pt;
      const ay = (a.y - originY) * scaleY;
      const by = (b.y - originY) * scaleY;
      if (ay === by) continue;
      edges.push({ x0: (a.x - originX) * scaleX, y0: ay, x1: (b.x - originX) * scaleX, y1: by, dir: by > ay ? 1 : -1 });
      if (ay < minY) minY = ay;
      if (by < minY) minY = by;
      if (ay > maxY) maxY = ay;
      if (by > maxY) maxY = by;
    }
  }
  if (!edges.length) return;

  const from = Math.max(0, Math.floor(minY - 0.5));
  const to = Math.min(dh - 1, Math.ceil(maxY + 0.5));
  const xs: { x: number; dir: number }[] = [];

  for (let j = from; j <= to; j += 1) {
    const sy = j + 0.5;
    xs.length = 0;
    for (const e of edges) {
      const lo = Math.min(e.y0, e.y1);
      const hi = Math.max(e.y0, e.y1);
      if (sy < lo || sy >= hi) continue;
      const t = (sy - e.y0) / (e.y1 - e.y0);
      xs.push({ x: e.x0 + t * (e.x1 - e.x0), dir: e.dir });
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p.x - q.x);

    let winding = 0;
    for (let k = 0; k < xs.length - 1; k += 1) {
      winding += (xs[k] as { dir: number }).dir;
      if (winding === 0) continue;
      const xa = (xs[k] as { x: number }).x;
      const xb = (xs[k + 1] as { x: number }).x;
      const start = Math.max(0, Math.ceil(xa - 0.5));
      const end = Math.min(dw - 1, Math.floor(xb - 0.5));
      const row = j * dw;
      for (let px = start; px <= end; px += 1) {
        buf[row + px] = gray;
        painted[row + px] = 1;
      }
    }
  }
}

function main(): void {
  const svg = readFileSync(join(ROOT, 'assets', 'logomark.svg'), 'utf8');

  // Parse every path once. Document order is the paint order: later paths cover earlier ones.
  const drawings: { polys: Pt[][]; gray: number }[] = [];
  for (const [, attrs] of svg.matchAll(/<path\b([^>]*)\/>/g)) {
    const d = /\bd="([^"]*)"/.exec(attrs as string);
    const f = /\bfill="#([0-9A-Fa-f]{6})"/.exec(attrs as string);
    if (!d || !f) continue;
    // The six fills are all neutral grays, so any channel is the level.
    drawings.push({ polys: parsePath(d[1] as string), gray: parseInt((f[1] as string).slice(0, 2), 16) });
  }
  if (!drawings.length) throw new Error('assets/logomark.svg has no filled paths');

  // Fit to the artwork rather than the viewBox: the trace sits high and narrow inside its
  // 1024 square, and honouring that would spend a quarter of the splash on empty rows. The
  // box is squared off first so the coin still reads as a circle.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { polys } of drawings) {
    for (const poly of polys) {
      for (const pt of poly) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
  }
  const side = Math.max(maxX - minX, maxY - minY) * (1 + MARGIN * 2);
  const originX = (minX + maxX) / 2 - side / 2;
  const originY = (minY + maxY) / 2 - side / 2;

  const dw = W * SS;
  const dh = H * SS;
  const buf = new Float32Array(dw * dh);
  const painted = new Uint8Array(dw * dh);
  const scale = dw / side;
  // Vertical scale is halved against horizontal on purpose: dh is half dw for the same square.
  const scaleY = dh / side;

  for (const { polys, gray } of drawings) {
    fill(polys, gray, buf, painted, dw, dh, scale, scaleY, originX, originY);
  }

  // Box downsample. Ink is coverage times brightness: nothing painted stays 0 and renders as
  // a space, so the corners of the frame stay empty and the disc reads as a disc.
  const ink = new Float64Array(W * H);
  let maxInk = 0;
  for (let cy = 0; cy < H; cy += 1) {
    for (let cx = 0; cx < W; cx += 1) {
      let sum = 0;
      let hits = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        const row = (cy * SS + sy) * dw + cx * SS;
        for (let sx = 0; sx < SS; sx += 1) {
          if (painted[row + sx]) {
            sum += buf[row + sx] as number;
            hits += 1;
          }
        }
      }
      const v = hits === 0 ? 0 : (hits / (SS * SS)) * (sum / hits / 255);
      ink[cy * W + cx] = v;
      if (v > maxInk) maxInk = v;
    }
  }

  // Normalise so the brightest highlight reaches the top of the ramp. The trace's lightest
  // fill is #EFEFEF, so without this the mark could never reach its densest character.
  const rows: string[] = [];
  for (let cy = 0; cy < H; cy += 1) {
    let row = '';
    for (let cx = 0; cx < W; cx += 1) {
      const v = maxInk > 0 ? (ink[cy * W + cx] as number) / maxInk : 0;
      row += Math.round(Math.min(1, v) * 15).toString(16);
    }
    rows.push(row);
  }

  const out = `/**
 * Generated by scripts/gen-logomark.ts from assets/logomark.svg. Do not edit by hand.
 *
 * One hex digit of ink per cell, row-major, ${W} wide by ${H} tall. Ink is coverage times
 * brightness, so 0 is "nothing painted here" and renders as a space. The grid is two to one
 * because a terminal cell is about twice as tall as wide.
 */
export const SHAPE_W = ${W};
export const SHAPE_H = ${H};

export const SHAPE: readonly string[] = [
${rows.map((r) => `  '${r}',`).join('\n')}
];
`;
  writeFileSync(join(ROOT, 'src', 'ui', 'logomark-shape.ts'), out);
  const covered = [...ink].filter((v) => v > 0).length;
  process.stdout.write(`baked ${drawings.length} paths into ${W}x${H} (${((covered / (W * H)) * 100).toFixed(1)}% of cells inked)\n`);
}

main();
