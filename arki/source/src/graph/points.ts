// Finds the points worth clicking on: where plots cross each other and the axes,
// and where a curve turns (stationary points) or changes its bend (inflection points).
// Every case is reduced to finding the zeros of a one-variable function across the
// visible part of the plane.

import { scaleY, type Drawable, type View } from './render';

export interface PointOfInterest {
  x: number;
  y: number;
  // Which plots (or axis) meet here; stays the same as the point moves.
  key: string;
}

// Past this many crossings in view the dots stop being useful (think sin(50x)).
const MAX_PER_PAIR = 40;

// Zeros of h on [from, to], sampled once per pixel. A sign change is refined by
// bisection and kept only if h really reaches zero there (not a jump or a pole).
// A dip that touches zero without crossing is refined by golden-section search, unless
// only real crossings are wanted (an inflection needs the second derivative to change sign).
function zeros(h: (u: number) => number, from: number, to: number, steps: number, crossingsOnly = false): number[] {
  const out: number[] = [];
  const touches: [number, number][] = [];
  const du = (to - from) / steps;
  let largest = 0;
  let before = NaN;
  let u0 = from;
  let h0 = h(u0);
  for (let i = 1; i <= steps; i++) {
    const u1 = from + i * du;
    const h1 = h(u1);
    if (Number.isFinite(h0)) largest = Math.max(largest, Math.abs(h0));
    if (h0 === 0) {
      out.push(u0);
    } else if (Number.isFinite(h0) && Number.isFinite(h1) && h0 * h1 < 0) {
      let a = u0;
      let b = u1;
      let ha = h0;
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        const hm = h(m);
        if (hm === 0) {
          a = b = m;
          break;
        }
        if (hm * ha < 0) b = m;
        else {
          a = m;
          ha = hm;
        }
      }
      const root = (a + b) / 2;
      if (Math.abs(h(root)) <= 1e-7 * (Math.abs(h0) + Math.abs(h1))) out.push(root);
    } else if (!crossingsOnly && Number.isFinite(before) && Number.isFinite(h1) && before * h0 > 0 && h0 * h1 > 0) {
      if (Math.abs(h0) < Math.abs(before) && Math.abs(h0) <= Math.abs(h1)) touches.push([u0 - du, u1]);
    }
    if (out.length > MAX_PER_PAIR) return [];
    before = h0;
    u0 = u1;
    h0 = h1;
  }
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let [a, b] of touches) {
    for (let k = 0; k < 50; k++) {
      const c = b - (b - a) * ratio;
      const d = a + (b - a) * ratio;
      if (Math.abs(h(c)) < Math.abs(h(d))) b = d;
      else a = c;
    }
    const root = (a + b) / 2;
    if (Math.abs(h(root)) <= 1e-9 * largest) out.push(root);
  }
  return out;
}

type Fn2 = (x: number, y: number) => number;

// Grid spacing, in pixels, for finding where an implicit curve turns.
const TURN_CELL = 8;

// f at every corner of a grid of cols × rows cells, row by row from the bottom left.
function sampleGrid(f: Fn2, left: number, bottom: number, cols: number, rows: number, sx: number, sy: number) {
  const out = new Float64Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) out[j * (cols + 1) + i] = f(left + i * sx, bottom + j * sy);
  }
  return out;
}

// Common solutions of f = 0 and g = 0, given both sampled on a grid. Every cell where
// both change sign seeds Newton's method, which keeps a solution only if it converges
// close to that cell. A g that is zero throughout (a line has no turn) never seeds.
function solve2(
  f: Fn2,
  g: Fn2,
  fs: Float64Array,
  gs: Float64Array,
  left: number,
  bottom: number,
  cols: number,
  rows: number,
  sx: number,
  sy: number,
): [number, number][] {
  const straddles = (a: number, b: number, c: number, d: number) => {
    const lo = Math.min(a, b, c, d);
    const hi = Math.max(a, b, c, d);
    return lo <= 0 && hi >= 0 && hi > lo;
  };
  // Step size for the numeric Jacobian: a small fraction of a cell.
  const ex = sx * 1e-4;
  const ey = sy * 1e-4;
  const out: [number, number][] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * (cols + 1) + i;
      const corners = [k, k + 1, k + cols + 1, k + cols + 2];
      const fc = corners.map((c) => fs[c]);
      const gc = corners.map((c) => gs[c]);
      if (!fc.every(Number.isFinite) || !gc.every(Number.isFinite)) continue;
      if (!straddles(fc[0], fc[1], fc[2], fc[3]) || !straddles(gc[0], gc[1], gc[2], gc[3])) continue;
      const x0 = left + (i + 0.5) * sx;
      const y0 = bottom + (j + 0.5) * sy;
      let x = x0;
      let y = y0;
      for (let step = 0; step < 40; step++) {
        const F = f(x, y);
        const G = g(x, y);
        const fx = (f(x + ex, y) - f(x - ex, y)) / (2 * ex);
        const fy = (f(x, y + ey) - f(x, y - ey)) / (2 * ey);
        const gx = (g(x + ex, y) - g(x - ex, y)) / (2 * ex);
        const gy = (g(x, y + ey) - g(x, y - ey)) / (2 * ey);
        const det = fx * gy - fy * gx;
        if (!det || !Number.isFinite(det)) break;
        const dx = (F * gy - G * fy) / det;
        const dy = (G * fx - F * gx) / det;
        x -= dx;
        y -= dy;
        if (Math.abs(dx) < sx * 1e-12 && Math.abs(dy) < sy * 1e-12) break;
      }
      if (Math.abs(x - x0) > 1.5 * sx || Math.abs(y - y0) > 1.5 * sy) continue;
      const fScale = Math.max(...fc.map(Math.abs));
      const gScale = Math.max(...gc.map(Math.abs));
      if (Math.abs(f(x, y)) <= 1e-7 * fScale && Math.abs(g(x, y)) <= 1e-7 * gScale) out.push([x, y]);
      if (out.length > MAX_PER_PAIR) return [];
    }
  }
  return out;
}

export function findPoints(items: Drawable[], w: number, h: number, view: View): PointOfInterest[] {
  const left = view.cx - w / 2 / view.scale;
  const right = view.cx + w / 2 / view.scale;
  const bottom = view.cy - h / 2 / scaleY(view);
  const top = view.cy + h / 2 / scaleY(view);
  const found: PointOfInterest[] = [];
  const add = (x: number, y: number, key: string) => {
    if (x >= left && x <= right && y >= bottom && y <= top) found.push({ x, y, key });
  };
  const alongX = (fn: (x: number) => number, crossingsOnly = false) => zeros(fn, left, right, Math.ceil(w), crossingsOnly);
  const alongY = (fn: (y: number) => number, crossingsOnly = false) => zeros(fn, bottom, top, Math.ceil(h), crossingsOnly);

  const curves = items.filter((it) => it.plot.kind === 'fx' || it.plot.kind === 'fy' || it.plot.kind === 'implicit');

  for (const { id, plot } of curves) {
    if (plot.kind === 'fx') {
      for (const x of alongX(plot.f)) add(x, 0, `${id}|x-axis`);
      add(0, plot.f(0), `${id}|y-axis`);
      for (const x of alongX(plot.d1)) add(x, plot.f(x), `${id}|stationary`);
      for (const x of alongX(plot.d2, true)) add(x, plot.f(x), `${id}|inflection`);
    } else if (plot.kind === 'fy') {
      for (const y of alongY(plot.f)) add(0, y, `${id}|y-axis`);
      add(plot.f(0), 0, `${id}|x-axis`);
      for (const y of alongY(plot.d1)) add(plot.f(y), y, `${id}|stationary`);
      for (const y of alongY(plot.d2, true)) add(plot.f(y), y, `${id}|inflection`);
    } else if (plot.kind === 'implicit') {
      const f = plot.f;
      if (bottom <= 0 && top >= 0) for (const x of alongX((x) => f(x, 0))) add(x, 0, `${id}|x-axis`);
      if (left <= 0 && right >= 0) for (const y of alongY((y) => f(0, y))) add(0, y, `${id}|y-axis`);
      // Where the curve turns: a horizontal tangent (∂f/∂x = 0) is a highest or lowest
      // point, a vertical one (∂f/∂y = 0) a leftmost or rightmost.
      const cols = Math.ceil(w / TURN_CELL);
      const rows = Math.ceil(h / TURN_CELL);
      const sx = (right - left) / cols;
      const sy = (top - bottom) / rows;
      const fs = sampleGrid(f, left, bottom, cols, rows, sx, sy);
      for (const g of [plot.dx, plot.dy]) {
        const gs = sampleGrid(g, left, bottom, cols, rows, sx, sy);
        for (const [x, y] of solve2(f, g, fs, gs, left, bottom, cols, rows, sx, sy)) add(x, y, `${id}|stationary`);
      }
    }
  }

  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      // Order the pair so the cases below only need writing once.
      const rank = { fx: 0, fy: 1, implicit: 2 } as Record<string, number>;
      const [a, b] = rank[curves[i].plot.kind] <= rank[curves[j].plot.kind] ? [curves[i], curves[j]] : [curves[j], curves[i]];
      const key = `${curves[i].id}|${curves[j].id}`;
      const p = a.plot;
      const q = b.plot;
      if (p.kind === 'fx' && q.kind === 'fx') {
        for (const x of alongX((x) => p.f(x) - q.f(x))) add(x, p.f(x), key);
      } else if (p.kind === 'fx' && q.kind === 'fy') {
        for (const x of alongX((x) => q.f(p.f(x)) - x)) add(x, p.f(x), key);
      } else if (p.kind === 'fx' && q.kind === 'implicit') {
        for (const x of alongX((x) => q.f(x, p.f(x)))) add(x, p.f(x), key);
      } else if (p.kind === 'fy' && q.kind === 'fy') {
        for (const y of alongY((y) => p.f(y) - q.f(y))) add(p.f(y), y, key);
      } else if (p.kind === 'fy' && q.kind === 'implicit') {
        for (const y of alongY((y) => q.f(p.f(y), y))) add(p.f(y), y, key);
      }
      // Two implicit curves need a two-variable solve, which isn't here yet.
    }
  }

  // Several pairs can meet at one spot (three lines through the origin); keep one dot.
  const unique: PointOfInterest[] = [];
  for (const p of found) {
    const duplicate = unique.some((u) => Math.hypot((u.x - p.x) * view.scale, (u.y - p.y) * scaleY(view)) < 0.5);
    if (!duplicate) unique.push(p);
  }
  return unique;
}
