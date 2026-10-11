// Draws the grid and the plots onto a 2D canvas. All coordinates here are CSS pixels;
// the caller has already scaled the context for the device pixel ratio.

import type { Plot } from '../math/analyze';
import { decimalToLatex, exactForm, surdPair } from '../math/exact';
import type { PointOfInterest } from './points';

// `cx, cy` is the point of the plane at the centre of the canvas; `scale` is pixels per
// unit along x. `aspect` is how much longer a unit of y is drawn than a unit of x: 1
// until an axis is stretched on its own.
export interface View {
  cx: number;
  cy: number;
  scale: number;
  aspect: number;
}

// Pixels per unit along y.
export const scaleY = (view: View) => view.scale * view.aspect;

export interface Theme {
  background: string;
  minor: string;
  major: string;
  axis: string;
  label: string;
  marker: string;
  // The site's accent, for the axis that a shift-scroll would stretch.
  accent: string;
}

export const LIGHT: Theme = {
  background: '#ffffff',
  minor: 'rgba(0, 0, 0, 0.045)',
  major: 'rgba(0, 0, 0, 0.11)',
  axis: 'rgba(0, 0, 0, 0.62)',
  label: 'rgba(0, 0, 0, 0.58)',
  marker: '#8e8e93',
  accent: '#2929c8',
};

export const DARK: Theme = {
  background: '#0e0e10',
  minor: 'rgba(255, 255, 255, 0.04)',
  major: 'rgba(255, 255, 255, 0.1)',
  axis: 'rgba(255, 255, 255, 0.6)',
  label: 'rgba(255, 255, 255, 0.58)',
  marker: '#98989d',
  accent: '#ffc800',
};

export interface Drawable {
  id: string;
  plot: Plot;
  color: string;
  // LaTeX kept beside a point; empty for its coordinates.
  label?: string;
  // How a point is drawn; a filled dot unless set.
  pointStyle?: PointStyle;
  // How a curve is drawn; a solid line unless set.
  lineStyle?: LineStyle;
  // The curve's thickness in pixels; CURVE_WIDTH unless set.
  lineWidth?: number;
  // From 0 (invisible) to 1 (solid); solid unless set.
  opacity?: number;
  // Whether the inside of a polygon or an inequality is shaded; it is unless set to false.
  fill?: boolean;
}

export type PointStyle = 'open' | 'cross';
export type LineStyle = 'dashed' | 'dotted';

// Dash patterns for the usual curve width, which grow with a thicker line; with round
// caps a zero-length dash is a dot.
const DASHES: Record<LineStyle, number[]> = { dashed: [7, 6], dotted: [0, 6] };
const dashes = (style: LineStyle, width: number) => DASHES[style].map((length) => (length * width) / CURVE_WIDTH);

// A highlighted point on one plot; `at` is the value of that plot's independent variable.
// An implicit curve has none, so `on` is the point itself, kept on the curve as it moves.
export interface Trace {
  id: string;
  at: number;
  on?: [number, number];
}

const FONT = 'ChosunSm, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
// How much heavier and larger everything is drawn in projector mode.
const PROJECTOR = 1.7;
export const sizeOf = (settings: GraphSettings) => (settings.projector ? PROJECTOR : 1);

// The site's bar lies over the top of the canvas; anything pinned to the top edge clears it.
const TOP_BAR = 44;
export const CURVE_WIDTH = 2.5;
// How strongly the inside of a region or polygon is tinted with its colour.
const SHADE = 0.16;
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

export function formatNumber(v: number, digits = 6): string {
  if (Number.isNaN(v)) return 'undefined';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  let text: string;
  if (abs >= 1e9 || abs < 1e-5) {
    const exponent = Math.floor(Math.log10(abs));
    const mantissa = parseFloat((abs / 10 ** exponent).toPrecision(digits));
    const power = [...String(Math.abs(exponent))].map((d) => SUPERSCRIPT[Number(d)]).join('');
    text = `${mantissa === 1 ? '' : `${mantissa}×`}10${exponent < 0 ? '⁻' : ''}${power}`;
  } else {
    text = String(parseFloat(abs.toPrecision(digits)));
  }
  return v < 0 ? `−${text}` : text;
}

// What is drawn behind the curves.
export interface GraphSettings {
  grid: boolean;
  // Rings and spokes about the origin in place of the squared grid.
  polar: boolean;
  // Everything drawn heavier and larger, to be read across a room.
  projector: boolean;
  // The view stays where it is: no panning or zooming by hand.
  locked: boolean;
  axes: boolean;
  // The numbers along the axes, which go when the axes do.
  numbers: boolean;
  // What each axis measures, written at its positive end; nothing when empty.
  xLabel: string;
  yLabel: string;
  // The gap between gridlines on each axis as typed (`2`, `pi/2`); empty leaves it to
  // the zoom. `xStepValue` and `yStepValue` are what those work out to.
  xStep: string;
  yStep: string;
  xStepValue?: number;
  yStepValue?: number;
}

export const DEFAULT_SETTINGS: GraphSettings = { grid: true, polar: false, projector: false, locked: false, axes: true, numbers: true, xLabel: '', yLabel: '', xStep: '', yStep: '' };

function gridSteps(scale: number): { major: number; minor: number } {
  const raw = 84 / scale;
  const power = 10 ** Math.floor(Math.log10(raw));
  const m = raw / power;
  if (m <= 1) return { major: power, minor: power / 5 };
  if (m <= 2) return { major: 2 * power, minor: power / 2 };
  if (m <= 5) return { major: 5 * power, minor: power };
  return { major: 10 * power, minor: 2 * power };
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

interface Steps {
  major: number;
  minor: number;
  // Writes the number at the k-th major line.
  label(k: number): string;
  // Every how many major lines get a number, so they don't run together.
  every: number;
}

// The gridlines for one axis: at the step that was asked for, unless that would crowd
// the screen with lines, and otherwise at a round step that suits the zoom.
function stepsFor(scale: number, wanted: number | undefined): Steps {
  if (!wanted || !(wanted * scale >= 6)) {
    const auto = gridSteps(scale);
    return { ...auto, label: (k) => formatNumber(k * auto.major), every: 1 };
  }
  const mantissa = wanted / 10 ** Math.floor(Math.log10(wanted));
  const parts = Math.abs(mantissa - 1) < 1e-9 || Math.abs(mantissa - 5) < 1e-9 ? 5 : 4;
  // A step that is a simple fraction of π is counted in π: π/2, π, 3π/2 …
  let label = (k: number) => formatNumber(k * wanted);
  for (let q = 1; q <= 12; q++) {
    const p = Math.round((wanted / Math.PI) * q);
    if (p < 1 || Math.abs(wanted / Math.PI - p / q) > 1e-9) continue;
    label = (k) => {
      const shared = gcd(k * p, q);
      const [top, bottom] = [(k * p) / shared, q / shared];
      return `${top === 1 ? '' : top === -1 ? '−' : formatNumber(top)}π${bottom === 1 ? '' : `/${bottom}`}`;
    };
    break;
  }
  return { major: wanted, minor: wanted / parts, label, every: Math.max(1, Math.ceil(44 / (wanted * scale))) };
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: View,
  theme: Theme,
  settings: GraphSettings,
  highlight?: 'x' | 'y',
) {
  // Lines and lettering grow together in projector mode.
  const k = sizeOf(settings);
  const { cx, cy, scale } = view;
  const yScale = scaleY(view);
  const left = cx - w / 2 / scale;
  const right = cx + w / 2 / scale;
  const bottom = cy - h / 2 / yScale;
  const top = cy + h / 2 / yScale;
  const sx = (x: number) => Math.round(w / 2 + (x - cx) * scale) + 0.5;
  const sy = (y: number) => Math.round(h / 2 - (y - cy) * yScale) + 0.5;
  // Each axis picks its own spacing, since they can be stretched apart.
  const stepsX = stepsFor(scale, settings.xStepValue);
  const stepsY = stepsFor(yScale, settings.yStepValue);

  const lines = (level: 'major' | 'minor', color: string) => {
    const skip = (steps: Steps) => (level === 'minor' ? Math.round(steps.major / steps.minor) : 0);
    ctx.beginPath();
    for (let k = Math.ceil(left / stepsX[level]); k <= right / stepsX[level]; k++) {
      if (skip(stepsX) && k % skip(stepsX) === 0) continue;
      ctx.moveTo(sx(k * stepsX[level]), 0);
      ctx.lineTo(sx(k * stepsX[level]), h);
    }
    for (let k = Math.ceil(bottom / stepsY[level]); k <= top / stepsY[level]; k++) {
      if (skip(stepsY) && k % skip(stepsY) === 0) continue;
      ctx.moveTo(0, sy(k * stepsY[level]));
      ctx.lineTo(w, sy(k * stepsY[level]));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = k;
    ctx.stroke();
  };
  const axisX = sx(0);
  const axisY = sy(0);

  // The polar grid: a ring at every step out from the origin, and a spoke every 15°
  // with the 30° ones drawn stronger. Stretched axes make the rings ellipses.
  const polar = () => {
    // How far from the origin the screen reaches, nearest and farthest, in plane units.
    const nearX = Math.max(left, Math.min(0, right));
    const nearY = Math.max(bottom, Math.min(0, top));
    const near = Math.hypot(nearX, nearY);
    const far = Math.hypot(Math.max(Math.abs(left), Math.abs(right)), Math.max(Math.abs(bottom), Math.abs(top)));
    const rings = (level: 'major' | 'minor', color: string) => {
      const step = stepsX[level];
      const skip = level === 'minor' ? Math.round(stepsX.major / stepsX.minor) : 0;
      if ((far - near) / step > 600) return;
      ctx.beginPath();
      for (let k = Math.max(1, Math.ceil(near / step)); k * step <= far; k++) {
        if (skip && k % skip === 0) continue;
        ctx.moveTo(axisX + k * step * scale, axisY);
        ctx.ellipse(axisX, axisY, k * step * scale, k * step * yScale, 0, 0, Math.PI * 2);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = k;
      ctx.stroke();
    };
    const spokes = (major: boolean, color: string) => {
      ctx.beginPath();
      for (let k = 0; k < 24; k++) {
        // The axes themselves are drawn separately.
        if ((k % 2 === 0) !== major || k % 6 === 0) continue;
        const angle = (k * Math.PI) / 12;
        ctx.moveTo(axisX, axisY);
        ctx.lineTo(axisX + Math.cos(angle) * far * scale, axisY - Math.sin(angle) * far * yScale);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = k;
      ctx.stroke();
    };
    rings('minor', theme.minor);
    spokes(false, theme.minor);
    rings('major', theme.major);
    spokes(true, theme.major);
    if (!settings.axes) {
      // With the axes off, their four directions are still spokes of the grid.
      ctx.beginPath();
      ctx.moveTo(axisX, 0);
      ctx.lineTo(axisX, h);
      ctx.moveTo(0, axisY);
      ctx.lineTo(w, axisY);
      ctx.stroke();
    }
  };

  if (settings.grid && settings.polar) polar();
  else if (settings.grid) {
    lines('minor', theme.minor);
    lines('major', theme.major);
  }
  if (!settings.axes) return;

  ctx.beginPath();
  ctx.moveTo(axisX, 0);
  ctx.lineTo(axisX, h);
  ctx.moveTo(0, axisY);
  ctx.lineTo(w, axisY);
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1.25 * k;
  ctx.stroke();
  if (highlight) {
    ctx.beginPath();
    if (highlight === 'x') {
      ctx.moveTo(0, axisY);
      ctx.lineTo(w, axisY);
    } else {
      ctx.moveTo(axisX, 0);
      ctx.lineTo(axisX, h);
    }
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3 * k;
    ctx.stroke();
  }

  // Labels sit beside their axis and stick to the edge of the canvas when the axis scrolls away.
  ctx.fillStyle = theme.label;
  ctx.strokeStyle = theme.background;
  ctx.lineWidth = 3 * Math.sqrt(k);
  ctx.lineJoin = 'round';
  const text = (label: string, x: number, y: number) => {
    ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
  };

  // Each axis is named at its positive end, on the side its numbers aren't.
  ctx.font = `600 ${13 * k}px ${FONT}`;
  if (settings.xLabel) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    text(settings.xLabel, w - 10, Math.min(Math.max(axisY - 6, 22), h - 6));
  }
  if (settings.yLabel) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    text(settings.yLabel, Math.min(Math.max(axisX + 8, 8), w - 8 - ctx.measureText(settings.yLabel).width), TOP_BAR + 8);
  }

  if (!settings.numbers) return;
  ctx.font = `${12 * k}px ${FONT}`;

  const labelY = Math.min(Math.max(axisY + 7, 7), h - 7 - 12 * k);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let k = Math.ceil(left / stepsX.major); k <= right / stepsX.major; k++) {
    if (k !== 0 && k % stepsX.every === 0) text(stepsX.label(k), sx(k * stepsX.major), labelY);
  }

  const pinnedLeft = axisX - 7 < 30 * k;
  const labelX = pinnedLeft ? 8 : Math.min(axisX - 7, w - 8);
  ctx.textAlign = pinnedLeft ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  for (let k = Math.ceil(bottom / stepsY.major); k <= top / stepsY.major; k++) {
    if (k !== 0 && k % stepsY.every === 0) text(stepsY.label(k), labelX, sy(k * stepsY.major));
  }

  if (axisX > 20 && axisX < w && axisY > 0 && axisY < h - 20) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    text('0', axisX - 7, axisY + 7);
  }
}

// Plots one variable as a function of the other. `along` is the length of the screen
// axis we step across; `across` is the length of the axis the function's value lands on.
// Works in pixels on both axes so the same code draws y = f(x) and x = f(y).
function strokeFunction(
  ctx: CanvasRenderingContext2D,
  value: (p: number) => number,
  along: number,
  across: number,
  flipped: boolean,
) {
  const margin = 50;
  const limit = 1e5;
  let pen = false;
  const moveTo = (p: number, s: number) => {
    const c = Math.max(-limit, Math.min(limit, s));
    if (flipped) ctx.moveTo(c, p);
    else ctx.moveTo(p, c);
  };
  const lineTo = (p: number, s: number) => {
    const c = Math.max(-limit, Math.min(limit, s));
    if (flipped) ctx.lineTo(c, p);
    else ctx.lineTo(p, c);
  };

  // Connects two neighbouring samples, subdividing where the curve is steep. A gap that
  // doesn't shrink as the interval halves is a discontinuity, and is left open.
  const connect = (p0: number, s0: number, p1: number, s1: number, depth: number, parentGap: number) => {
    const ok0 = Number.isFinite(s0);
    const ok1 = Number.isFinite(s1);
    if (!ok0 && !ok1) {
      pen = false;
      return;
    }
    if (ok0 !== ok1) {
      // One end is outside the domain: bisect so the curve reaches the domain's edge.
      let a = ok0 ? p0 : p1;
      let sa = ok0 ? s0 : s1;
      let b = ok0 ? p1 : p0;
      for (let i = 0; i < 12; i++) {
        const m = (a + b) / 2;
        const sm = value(m);
        if (Number.isFinite(sm)) {
          a = m;
          sa = sm;
        } else b = m;
      }
      if (ok0) {
        if (!pen) moveTo(p0, s0);
        lineTo(a, sa);
        pen = false;
      } else {
        moveTo(a, sa);
        lineTo(p1, s1);
        pen = true;
      }
      return;
    }
    if ((s0 < -margin && s1 < -margin) || (s0 > across + margin && s1 > across + margin)) {
      pen = false;
      return;
    }
    const gap = Math.abs(s1 - s0);
    if (gap > 2 && depth > 0) {
      const pm = (p0 + p1) / 2;
      const sm = value(pm);
      connect(p0, s0, pm, sm, depth - 1, gap);
      connect(pm, sm, p1, s1, depth - 1, gap);
      return;
    }
    if (gap > 2 && gap > parentGap * 0.75) {
      pen = false;
      return;
    }
    if (!pen) moveTo(p0, s0);
    lineTo(p1, s1);
    pen = true;
  };

  ctx.beginPath();
  let prev = value(0);
  for (let p = 1; p <= along + 1; p++) {
    const next = value(p);
    connect(p - 1, prev, p, next, 7, Infinity);
    prev = next;
  }
  ctx.stroke();
}

// How far θ has to run before a polar curve starts retracing itself, as far as a few
// samples can tell. Dashes only stay dashes if the curve is drawn once over.
function polarSpan(f: (theta: number) => number): number {
  const repeats = (shift: number, sign: number) => {
    for (let i = 0; i < 24; i++) {
      const theta = 0.37 + i * 0.731;
      const [here, there] = [f(theta), sign * f(theta + shift)];
      if (Number.isNaN(here) && Number.isNaN(there)) continue;
      if (!(Math.abs(here - there) <= 1e-9 * Math.max(1, Math.abs(here)))) return false;
    }
    return true;
  };
  // r(θ + π) = −r(θ) lands on the same points, as r = cos θ does.
  if (repeats(Math.PI, -1)) return Math.PI;
  if (repeats(2 * Math.PI, 1)) return 2 * Math.PI;
  return 12 * Math.PI;
}

function strokeParametric(
  ctx: CanvasRenderingContext2D,
  point: (t: number) => [number, number],
  from: number,
  to: number,
  samples: number,
) {
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i <= samples; i++) {
    const [x, y] = point(from + ((to - from) * i) / samples);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e5 || Math.abs(y) > 1e5) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  }
  ctx.stroke();
}

const COARSE = 6;
let samples = new Float64Array(0);

// Marching squares on a coarse grid, refined 2× in the cells the curve passes through.
// Crossing points are keyed by the grid edge they sit on, so the segments from
// neighbouring cells can be joined into continuous lines (needed for dashes).
function drawImplicit(
  ctx: CanvasRenderingContext2D,
  plot: Extract<Plot, { kind: 'implicit' }>,
  w: number,
  h: number,
  view: View,
  color: string,
  shade: boolean,
) {
  const { f } = plot;
  const yScale = scaleY(view);
  const F = (px: number, py: number) => f(view.cx + (px - w / 2) / view.scale, view.cy - (py - h / 2) / yScale);
  const cols = Math.ceil(w / COARSE) + 1;
  const rows = Math.ceil(h / COARSE) + 1;
  if (samples.length < cols * rows) samples = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) samples[j * cols + i] = F(i * COARSE, j * COARSE);
  }

  const fineCols = cols * 2;
  const points = new Map<number, [number, number]>();
  const links = new Map<number, number[]>();
  const fill = plot.region && shade ? new Path2D() : undefined;

  const link = (a: number, b: number) => {
    const la = links.get(a);
    if (la) la.push(b);
    else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a);
    else links.set(b, [a]);
  };

  // One fine cell with its top-left corner at (x, y); corner values clockwise from top-left.
  const cell = (x: number, y: number, size: number, fi: number, fj: number, tl: number, tr: number, br: number, bl: number) => {
    const inTl = tl < 0, inTr = tr < 0, inBr = br < 0, inBl = bl < 0;
    const count = +inTl + +inTr + +inBr + +inBl;
    if (count === 0) return;
    if (count === 4) {
      fill?.rect(x, y, size, size);
      return;
    }
    const base = (fj * fineCols + fi) * 2;
    const top = base, leftKey = base + 1, right = base + 3, bottomKey = base + fineCols * 2;
    const cross: number[] = [];
    if (inTl !== inTr) {
      points.set(top, [x + (size * tl) / (tl - tr), y]);
      cross.push(top);
    }
    if (inTr !== inBr) {
      points.set(right, [x + size, y + (size * tr) / (tr - br)]);
      cross.push(right);
    }
    if (inBr !== inBl) {
      points.set(bottomKey, [x + (size * bl) / (bl - br), y + size]);
      cross.push(bottomKey);
    }
    if (inBl !== inTl) {
      points.set(leftKey, [x, y + (size * tl) / (tl - bl)]);
      cross.push(leftKey);
    }
    if (cross.length === 2) link(cross[0], cross[1]);
    else if (cross.length === 4) {
      // Saddle: the centre decides which pair of opposite corners is connected.
      const centreIn = (tl + tr + br + bl) / 4 < 0;
      if (inTl === centreIn) {
        link(top, right);
        link(bottomKey, leftKey);
      } else {
        link(top, leftKey);
        link(right, bottomKey);
      }
    }
    if (fill) {
      const corners: [boolean, number, number][] = [
        [inTl, x, y], [inTr, x + size, y], [inBr, x + size, y + size], [inBl, x, y + size],
      ];
      const edges = [top, right, bottomKey, leftKey];
      let started = false;
      for (let k = 0; k < 4; k++) {
        const [inside, px, py] = corners[k];
        if (inside) {
          if (started) fill.lineTo(px, py);
          else fill.moveTo(px, py);
          started = true;
        }
        if (inside !== corners[(k + 1) % 4][0]) {
          const [qx, qy] = points.get(edges[k])!;
          if (started) fill.lineTo(qx, qy);
          else fill.moveTo(qx, qy);
          started = true;
        }
      }
      fill.closePath();
    }
  };

  const half = COARSE / 2;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = samples[j * cols + i];
      const tr = samples[j * cols + i + 1];
      const bl = samples[(j + 1) * cols + i];
      const br = samples[(j + 1) * cols + i + 1];
      if (Number.isNaN(tl) || Number.isNaN(tr) || Number.isNaN(bl) || Number.isNaN(br)) continue;
      const x = i * COARSE;
      const y = j * COARSE;
      const inside = +(tl < 0) + +(tr < 0) + +(bl < 0) + +(br < 0);
      if (inside === 0) continue;
      if (inside === 4) {
        fill?.rect(x, y, COARSE, COARSE);
        continue;
      }
      const tm = F(x + half, y);
      const ml = F(x, y + half);
      const mm = F(x + half, y + half);
      const mr = F(x + COARSE, y + half);
      const bm = F(x + half, y + COARSE);
      if (Number.isNaN(tm) || Number.isNaN(ml) || Number.isNaN(mm) || Number.isNaN(mr) || Number.isNaN(bm)) continue;
      cell(x, y, half, 2 * i, 2 * j, tl, tm, mm, ml);
      cell(x + half, y, half, 2 * i + 1, 2 * j, tm, tr, mr, mm);
      cell(x, y + half, half, 2 * i, 2 * j + 1, ml, mm, bm, bl);
      cell(x + half, y + half, half, 2 * i + 1, 2 * j + 1, mm, mr, br, bm);
    }
  }

  if (fill) {
    // Shaded lightly, on top of whatever opacity the expression has been given.
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = SHADE * alpha;
    ctx.fillStyle = color;
    ctx.fill(fill);
    ctx.globalAlpha = alpha;
  }

  // Join the segments into polylines: open chains first (from their loose ends), then loops.
  const visited = new Set<number>();
  ctx.beginPath();
  const walk = (start: number) => {
    let previous = -1;
    let current = start;
    const [x0, y0] = points.get(start)!;
    ctx.moveTo(x0, y0);
    for (;;) {
      visited.add(current);
      const neighbours = links.get(current)!;
      const next = neighbours.find((n) => n !== previous && !visited.has(n));
      if (next === undefined) {
        if (neighbours.length > 1 && neighbours.includes(start) && previous !== start) ctx.closePath();
        return;
      }
      const [x, y] = points.get(next)!;
      ctx.lineTo(x, y);
      previous = current;
      current = next;
    }
  };
  for (const [key, neighbours] of links) if (neighbours.length === 1 && !visited.has(key)) walk(key);
  for (const key of links.keys()) if (!visited.has(key)) walk(key);
  // A strict inequality's boundary isn't part of it, which a broken line says; one that
  // already has a line style of its own keeps it.
  const dash = ctx.getLineDash();
  if (plot.strict && dash.length === 0) ctx.setLineDash(dashes('dashed', ctx.lineWidth));
  ctx.stroke();
  ctx.setLineDash(dash);
}

// The point of an implicit curve nearest (x, y), by Newton steps along the gradient.
// Distances are measured in pixels, `ux` and `uy` being the size of one along each
// axis, so a stretched view still picks the point that looks nearest.
export function projectImplicit(
  plot: Extract<Plot, { kind: 'implicit' }>,
  x: number,
  y: number,
  ux = 1,
  uy = 1,
): [number, number] | undefined {
  for (let step = 0; step < 12; step++) {
    const value = plot.f(x, y);
    if (!Number.isFinite(value)) return undefined;
    // The gradient per pixel.
    const gx = plot.dx(x, y) * ux;
    const gy = plot.dy(x, y) * uy;
    const norm = gx * gx + gy * gy;
    if (!norm || !Number.isFinite(norm)) return undefined;
    const px = (value * gx) / norm;
    const py = (value * gy) / norm;
    x -= px * ux;
    y -= py * uy;
    if (Math.hypot(px, py) < 1e-6) break;
  }
  return Math.abs(plot.f(x, y)) < 1e-6 * (Math.hypot(plot.dx(x, y) * ux, plot.dy(x, y) * uy) || 1) ? [x, y] : undefined;
}

// Where a trace sits on a plot, in plane coordinates.
export function tracePoint(plot: Plot, trace: Trace): [number, number] | undefined {
  let p: [number, number];
  if (plot.kind === 'fx') p = [trace.at, plot.f(trace.at)];
  else if (plot.kind === 'fy') p = [plot.f(trace.at), trace.at];
  else if (plot.kind === 'point') p = [plot.x, plot.y];
  else if (plot.kind === 'implicit' && trace.on) {
    // The curve may have moved (a slider) since the point was put on it.
    const on = projectImplicit(plot, trace.on[0], trace.on[1]);
    if (!on) return undefined;
    p = on;
  } else return undefined;
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : undefined;
}

// A dot with its coordinates in a label above it (or below, near the top edge).
// A coordinate label to show beside a dot. Labels are typeset LaTeX, so they are
// returned to the caller to place as HTML over the canvas rather than drawn here.
export interface Label {
  // Screen position of the dot the label belongs to.
  x: number;
  y: number;
  latex: string;
}

// A point's coordinates as they are written in a label.
function coordinates(view: View, point: [number, number], fixed: boolean): string {
  // Deep zooms need a tighter match, or a genuinely tiny value would be called 0.
  const exact = (v: number, scale: number) => exactForm(v, Math.min(1e-11, 1e-6 / scale), fixed ? 1000 : 12);
  const decimal = (v: number, scale: number) => {
    // Show one more digit than a pixel can resolve at this zoom.
    const digits = Math.max(0, Math.min(12, Math.ceil(Math.log10(scale)) + 1));
    return decimalToLatex(parseFloat(v.toFixed(digits)));
  };
  let x = exact(point[0], view.scale);
  let y = exact(point[1], scaleY(view));
  // Coordinates too intricate to recognise one at a time may still be recognised together.
  if (fixed && (!x || !y)) {
    const pair = surdPair(point[0], point[1]);
    if (pair) [x, y] = [x ?? pair[0], y ?? pair[1]];
  }
  return `\\left(${x ?? decimal(point[0], view.scale)},\\ ${y ?? decimal(point[1], scaleY(view))}\\right)`;
}

// Draws the dot and returns its coordinate label.
function drawLabelledDot(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: View,
  theme: Theme,
  point: [number, number],
  color: string,
  // A traced point sits wherever the pointer is, so only simple fractions are worth
  // recognising there; a fixed point (an intersection, a turning point) gets the full search.
  fixed: boolean,
  k: number,
): Label | undefined {
  const x = w / 2 + (point[0] - view.cx) * view.scale;
  const y = h / 2 - (point[1] - view.cy) * scaleY(view);
  if (x < -20 || x > w + 20 || y < -20 || y > h + 20) return undefined;

  ctx.beginPath();
  ctx.arc(x, y, 6 * k, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.background;
  ctx.stroke();

  return { x, y, latex: coordinates(view, point, fixed) };
}

export function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: View,
  theme: Theme,
  items: Drawable[],
  trace: Trace | undefined,
  // Intersections and intercepts: every one gets a small dot, the labelled ones a label.
  points: PointOfInterest[],
  labelled: PointOfInterest[],
  // The axis to pick out, while the pointer is on it with Shift held.
  highlight?: 'x' | 'y',
  settings: GraphSettings = DEFAULT_SETTINGS,
): Label[] {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, w, h, view, theme, settings, highlight);

  const { cx, cy, scale } = view;
  const yScale = scaleY(view);
  const toX = (px: number) => cx + (px - w / 2) / scale;
  const toY = (py: number) => cy - (py - h / 2) / yScale;
  const fromX = (x: number) => w / 2 + (x - cx) * scale;
  const fromY = (y: number) => h / 2 - (y - cy) * yScale;

  const k = sizeOf(settings);
  ctx.lineWidth = CURVE_WIDTH * k;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const { plot, color, lineStyle, lineWidth = CURVE_WIDTH, opacity = 1, fill = true } of items) {
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth * k;
    ctx.setLineDash(lineStyle ? dashes(lineStyle, lineWidth * k) : []);
    switch (plot.kind) {
      case 'fx':
        strokeFunction(ctx, (px) => fromY(plot.f(toX(px))), w, h, false);
        break;
      case 'fy':
        strokeFunction(ctx, (py) => fromX(plot.f(toY(py))), h, w, true);
        break;
      case 'implicit':
        drawImplicit(ctx, plot, w, h, view, color, fill);
        break;
      case 'parametric':
        strokeParametric(ctx, (t) => [fromX(plot.x(t)), fromY(plot.y(t))], 0, 2 * Math.PI, 2000);
        break;
      case 'polar':
        strokeParametric(
          ctx,
          (theta) => {
            const r = plot.f(theta);
            return [fromX(r * Math.cos(theta)), fromY(r * Math.sin(theta))];
          },
          0,
          lineStyle ? polarSpan(plot.f) : 12 * Math.PI,
          6000,
        );
        break;
      case 'polygon': {
        const corners = plot.vertices.map(([x, y]): [number, number] => [fromX(x), fromY(y)]);
        // One corner that can't be placed leaves no shape to draw.
        if (!corners.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) break;
        ctx.beginPath();
        corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        if (fill) {
          ctx.globalAlpha = SHADE * opacity;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = opacity;
        }
        ctx.stroke();
        break;
      }
      case 'point':
        break;
    }
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Points go on top of every curve.
  for (const { plot, color, pointStyle, opacity = 1 } of items) {
    ctx.globalAlpha = 1;
    if (plot.kind !== 'point') continue;
    const x = fromX(plot.x);
    const y = fromY(plot.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (plot.drag) {
      // A halo marks a point that can be picked up and moved.
      ctx.beginPath();
      ctx.arc(x, y, 12 * k, 0, Math.PI * 2);
      ctx.globalAlpha = 0.22 * opacity;
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = opacity;
    if (pointStyle === 'cross') {
      // Outlined in the background colour first, like the dot, so it reads over a curve.
      const arm = 5 * k;
      ctx.beginPath();
      ctx.moveTo(x - arm, y - arm);
      ctx.lineTo(x + arm, y + arm);
      ctx.moveTo(x - arm, y + arm);
      ctx.lineTo(x + arm, y - arm);
      ctx.lineWidth = 5.5 * k;
      ctx.strokeStyle = theme.background;
      ctx.stroke();
      ctx.lineWidth = 2.5 * k;
      ctx.strokeStyle = color;
      ctx.stroke();
      continue;
    }
    ctx.beginPath();
    ctx.arc(x, y, (pointStyle === 'open' ? 5 : 5.5) * k, 0, Math.PI * 2);
    if (pointStyle === 'open') {
      // A ring with the background showing through its middle.
      ctx.fillStyle = theme.background;
      ctx.fill();
      ctx.lineWidth = 2.25 * k;
      ctx.strokeStyle = color;
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.background;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;

  for (const p of points) {
    ctx.beginPath();
    ctx.arc(fromX(p.x), fromY(p.y), 3.25 * k, 0, Math.PI * 2);
    ctx.fillStyle = theme.marker;
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = theme.background;
    ctx.stroke();
  }
  const labels: Label[] = [];
  // Labels switched on for points stay up for as long as the point is in view.
  for (const { plot, label } of items) {
    if (plot.kind !== 'point' || label === undefined) continue;
    const x = fromX(plot.x);
    const y = fromY(plot.y);
    if (!(x >= -20 && x <= w + 20 && y >= -20 && y <= h + 20)) continue;
    labels.push({ x, y, latex: label || coordinates(view, [plot.x, plot.y], true) });
  }
  for (const p of labelled) {
    const label = drawLabelledDot(ctx, w, h, view, theme, [p.x, p.y], theme.axis, true, k);
    if (label) labels.push(label);
  }

  if (trace) {
    const item = items.find((it) => it.id === trace.id);
    const point = item && tracePoint(item.plot, trace);
    const label = item && point && drawLabelledDot(ctx, w, h, view, theme, point, item.color, false, k);
    // A point with a label of its own keeps that one.
    if (label && item.label === undefined) labels.push(label);
  }
  return labels;
}
