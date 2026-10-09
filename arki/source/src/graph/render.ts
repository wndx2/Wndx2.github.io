// Draws the grid and the plots onto a 2D canvas. All coordinates here are CSS pixels;
// the caller has already scaled the context for the device pixel ratio.

import type { Plot } from '../math/analyze';
import { decimalToLatex, exactForm } from '../math/exact';
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
}

// A highlighted point on one plot; `at` is the value of that plot's independent variable.
export interface Trace {
  id: string;
  at: number;
}

const FONT = 'ChosunSm, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const CURVE_WIDTH = 2.5;
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

function gridSteps(scale: number): { major: number; minor: number } {
  const raw = 84 / scale;
  const power = 10 ** Math.floor(Math.log10(raw));
  const m = raw / power;
  if (m <= 1) return { major: power, minor: power / 5 };
  if (m <= 2) return { major: 2 * power, minor: power / 2 };
  if (m <= 5) return { major: 5 * power, minor: power };
  return { major: 10 * power, minor: 2 * power };
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, view: View, theme: Theme, highlight?: 'x' | 'y') {
  const { cx, cy, scale } = view;
  const yScale = scaleY(view);
  const left = cx - w / 2 / scale;
  const right = cx + w / 2 / scale;
  const bottom = cy - h / 2 / yScale;
  const top = cy + h / 2 / yScale;
  const sx = (x: number) => Math.round(w / 2 + (x - cx) * scale) + 0.5;
  const sy = (y: number) => Math.round(h / 2 - (y - cy) * yScale) + 0.5;
  // Each axis picks its own spacing, since they can be stretched apart.
  const stepsX = gridSteps(scale);
  const stepsY = gridSteps(yScale);

  const lines = (level: 'major' | 'minor', color: string) => {
    const skip = (steps: { major: number; minor: number }) => (level === 'minor' ? Math.round(steps.major / steps.minor) : 0);
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
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  lines('minor', theme.minor);
  lines('major', theme.major);

  const axisX = sx(0);
  const axisY = sy(0);
  ctx.beginPath();
  ctx.moveTo(axisX, 0);
  ctx.lineTo(axisX, h);
  ctx.moveTo(0, axisY);
  ctx.lineTo(w, axisY);
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1.25;
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
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Labels sit beside their axis and stick to the edge of the canvas when the axis scrolls away.
  ctx.font = `12px ${FONT}`;
  ctx.fillStyle = theme.label;
  ctx.strokeStyle = theme.background;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  const text = (label: string, x: number, y: number) => {
    ctx.strokeText(label, x, y);
    ctx.fillText(label, x, y);
  };

  const labelY = Math.min(Math.max(axisY + 7, 7), h - 19);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let k = Math.ceil(left / stepsX.major); k <= right / stepsX.major; k++) {
    if (k !== 0) text(formatNumber(k * stepsX.major), sx(k * stepsX.major), labelY);
  }

  const pinnedLeft = axisX - 7 < 30;
  const labelX = pinnedLeft ? 8 : Math.min(axisX - 7, w - 8);
  ctx.textAlign = pinnedLeft ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  for (let k = Math.ceil(bottom / stepsY.major); k <= top / stepsY.major; k++) {
    if (k !== 0) text(formatNumber(k * stepsY.major), labelX, sy(k * stepsY.major));
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
  const fill = plot.region ? new Path2D() : undefined;

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
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.fill(fill);
    ctx.globalAlpha = 1;
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
  if (plot.strict) ctx.setLineDash([7, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Where a trace sits on a plot, in plane coordinates.
export function tracePoint(plot: Plot, at: number): [number, number] | undefined {
  let p: [number, number];
  if (plot.kind === 'fx') p = [at, plot.f(at)];
  else if (plot.kind === 'fy') p = [plot.f(at), at];
  else if (plot.kind === 'point') p = [plot.x, plot.y];
  else return undefined;
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
): Label | undefined {
  const x = w / 2 + (point[0] - view.cx) * view.scale;
  const y = h / 2 - (point[1] - view.cy) * scaleY(view);
  if (x < -20 || x > w + 20 || y < -20 || y > h + 20) return undefined;

  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.background;
  ctx.stroke();

  const text = (v: number, scale: number) => {
    // Show one more digit than a pixel can resolve at this zoom.
    const digits = Math.max(0, Math.min(12, Math.ceil(Math.log10(scale)) + 1));
    // Deep zooms need a tighter match, or a genuinely tiny value would be called 0.
    const tolerance = Math.min(1e-11, 1e-6 / scale);
    return exactForm(v, tolerance, fixed ? 1000 : 12) ?? decimalToLatex(parseFloat(v.toFixed(digits)));
  };
  return { x, y, latex: `\\left(${text(point[0], view.scale)},\\ ${text(point[1], scaleY(view))}\\right)` };
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
): Label[] {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, w, h, view, theme, highlight);

  const { cx, cy, scale } = view;
  const yScale = scaleY(view);
  const toX = (px: number) => cx + (px - w / 2) / scale;
  const toY = (py: number) => cy - (py - h / 2) / yScale;
  const fromX = (x: number) => w / 2 + (x - cx) * scale;
  const fromY = (y: number) => h / 2 - (y - cy) * yScale;

  ctx.lineWidth = CURVE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const { plot, color } of items) {
    ctx.strokeStyle = color;
    switch (plot.kind) {
      case 'fx':
        strokeFunction(ctx, (px) => fromY(plot.f(toX(px))), w, h, false);
        break;
      case 'fy':
        strokeFunction(ctx, (py) => fromX(plot.f(toY(py))), h, w, true);
        break;
      case 'implicit':
        drawImplicit(ctx, plot, w, h, view, color);
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
          12 * Math.PI,
          6000,
        );
        break;
      case 'point':
        break;
    }
  }

  // Points go on top of every curve.
  for (const { plot, color } of items) {
    if (plot.kind !== 'point') continue;
    const x = fromX(plot.x);
    const y = fromY(plot.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.background;
    ctx.stroke();
  }

  for (const p of points) {
    ctx.beginPath();
    ctx.arc(fromX(p.x), fromY(p.y), 3.25, 0, Math.PI * 2);
    ctx.fillStyle = theme.marker;
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = theme.background;
    ctx.stroke();
  }
  const labels: Label[] = [];
  for (const p of labelled) {
    const label = drawLabelledDot(ctx, w, h, view, theme, [p.x, p.y], theme.axis, true);
    if (label) labels.push(label);
  }

  if (trace) {
    const item = items.find((it) => it.id === trace.id);
    const point = item && tracePoint(item.plot, trace.at);
    const label = item && point && drawLabelledDot(ctx, w, h, view, theme, point, item.color, false);
    if (label) labels.push(label);
  }
  return labels;
}
