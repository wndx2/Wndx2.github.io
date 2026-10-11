// Curves of best fit through data. Polynomials are fitted by least squares; the
// exponential, power and logarithmic models by least squares on their logarithms, as a
// school calculator does (so y must be positive for the first two, and x for the last two).

import { decimalToLatex, exactForm } from './exact';

export type FitModel = 'linear' | 'quadratic' | 'cubic' | 'exponential' | 'power' | 'logarithmic';

export const FIT_MODELS: { model: FitModel; name: string; latex: string }[] = [
  { model: 'linear', name: 'Linear', latex: 'y=mx+c' },
  { model: 'quadratic', name: 'Quadratic', latex: 'y=ax^2+bx+c' },
  { model: 'cubic', name: 'Cubic', latex: 'y=ax^3+bx^2+cx+d' },
  { model: 'exponential', name: 'Exponential', latex: 'y=ae^{bx}' },
  { model: 'power', name: 'Power', latex: 'y=ax^b' },
  { model: 'logarithmic', name: 'Logarithmic', latex: 'y=a+b\\ln x' },
];

type Fn1 = (u: number) => number;

export interface Fit {
  f: Fn1;
  d1: Fn1;
  d2: Fn1;
  // The fitted curve's equation, its coefficients rounded or in exact form.
  latex: string;
  // The coefficient of determination, 1 − SSres/SStot on the data as given.
  r2: number;
}

// Solves A·x = b by Gaussian elimination with partial pivoting; undefined if singular.
function solve(A: number[][], b: number[]): number[] | undefined {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    if (!(Math.abs(M[pivot][c]) > 1e-12)) return undefined;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n];
    for (let j = r + 1; j < n; j++) sum -= M[r][j] * x[j];
    x[r] = sum / M[r][r];
  }
  return x;
}

// Least-squares polynomial of the given degree: coefficients from the constant term up.
// x is scaled to about ±1 first, which keeps the normal equations well conditioned.
function polyfit(xs: number[], ys: number[], degree: number): number[] | undefined {
  if (new Set(xs).size <= degree) return undefined;
  const s = Math.max(...xs.map(Math.abs)) || 1;
  const u = xs.map((x) => x / s);
  const n = degree + 1;
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => u.reduce((t, v) => t + v ** (i + j), 0)));
  const b = Array.from({ length: n }, (_, i) => u.reduce((t, v, k) => t + v ** i * ys[k], 0));
  const c = solve(A, b);
  return c?.map((ci, i) => ci / s ** i);
}

// A coefficient as it is written: a short decimal when it is one, an exact form when the
// data lie exactly on the curve (2e^{x/2}), otherwise rounded to 4 significant figures.
// Measured data give decimals, never fractions like 199/100.
function number(v: number, perfect: boolean): string {
  const tidy = Math.abs(v) < 1e-10 ? 0 : v;
  const short = parseFloat(tidy.toPrecision(4));
  if (Math.abs(short - tidy) <= 1e-9 * Math.max(1, Math.abs(tidy))) return decimalToLatex(short);
  return (perfect ? exactForm(tidy, 1e-9, 100) : undefined) ?? decimalToLatex(short);
}

// A coefficient in front of something: 1 and −1 go without the digit.
const factor = (k: string) => (k === '1' ? '' : k === '-1' ? '-' : k);
// A coefficient with a function in it is bracketed before it multiplies: (ln 2)x.
const bracketed = (k: string) => (/\\[a-z]/.test(k) && !k.startsWith('\\frac') ? `\\left(${k}\\right)` : k);

// Terms with their coefficients, dropping zeros and writing 1x as x: `2x^2-x+3`.
function polynomialLatex(c: number[], perfect: boolean): string {
  let out = '';
  for (let i = c.length - 1; i >= 0; i--) {
    const k = number(c[i], perfect);
    if (k === '0') continue;
    const power = i === 0 ? '' : i === 1 ? 'x' : `x^{${i}}`;
    let term = power ? `${factor(bracketed(k))}${power}` : k;
    if (out && !term.startsWith('-')) term = `+${term}`;
    out += term;
  }
  return `y=${out || '0'}`;
}

function rSquared(f: Fn1, xs: number[], ys: number[]): number {
  const mean = ys.reduce((t, y) => t + y, 0) / ys.length;
  const total = ys.reduce((t, y) => t + (y - mean) ** 2, 0);
  const residual = ys.reduce((t, y, i) => t + (y - f(xs[i])) ** 2, 0);
  // Data with no spread at all are fitted perfectly by a flat line, or not at all.
  if (total === 0) return residual < 1e-20 ? 1 : 0;
  return 1 - residual / total;
}

export function fit(model: FitModel, xs: number[], ys: number[]): Fit | string {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const X = pairs.map(([x]) => x);
  const Y = pairs.map(([, y]) => y);
  // The equation is written once the fit is known to be exact or not.
  const finish = (f: Fn1, d1: Fn1, d2: Fn1, latex: (perfect: boolean) => string): Fit => {
    const r2 = rSquared(f, X, Y);
    return { f, d1, d2, latex: latex(r2 > 1 - 1e-12), r2 };
  };

  if (model === 'linear' || model === 'quadratic' || model === 'cubic') {
    const degree = model === 'linear' ? 1 : model === 'quadratic' ? 2 : 3;
    if (pairs.length < degree + 1) return `Needs at least ${degree + 1} points`;
    const c = polyfit(X, Y, degree);
    if (!c) return `Needs ${degree + 1} different x values`;
    const at = (cs: number[]) => (x: number) => cs.reduceRight((t, k) => t * x + k, 0);
    const dc = c.slice(1).map((k, i) => k * (i + 1));
    const ddc = dc.slice(1).map((k, i) => k * (i + 1));
    return finish(at(c), at(dc), at(ddc), (perfect) => polynomialLatex(c, perfect));
  }

  if (pairs.length < 2) return 'Needs at least 2 points';
  if (model === 'exponential') {
    if (Y.some((y) => y <= 0)) return 'Every y has to be positive';
    const c = polyfit(X, Y.map(Math.log), 1);
    if (!c) return 'Needs 2 different x values';
    const [a, b] = [Math.exp(c[0]), c[1]];
    const f = (x: number) => a * Math.exp(b * x);
    return finish(f, (x) => b * f(x), (x) => b * b * f(x), (p) => `y=${factor(number(a, p))}e^{${factor(bracketed(number(b, p)))}x}`);
  }
  if (model === 'power') {
    if (Y.some((y) => y <= 0) || X.some((x) => x <= 0)) return 'Every x and y has to be positive';
    const c = polyfit(X.map(Math.log), Y.map(Math.log), 1);
    if (!c) return 'Needs 2 different x values';
    const [a, b] = [Math.exp(c[0]), c[1]];
    const f = (x: number) => (x > 0 ? a * x ** b : NaN);
    return finish(f, (x) => a * b * x ** (b - 1), (x) => a * b * (b - 1) * x ** (b - 2), (p) => `y=${factor(number(a, p))}x^{${number(b, p)}}`);
  }
  // Logarithmic.
  if (X.some((x) => x <= 0)) return 'Every x has to be positive';
  const c = polyfit(X.map(Math.log), Y, 1);
  if (!c) return 'Needs 2 different x values';
  const [a, b] = c;
  const f = (x: number) => (x > 0 ? a + b * Math.log(x) : NaN);
  return finish(f, (x) => b / x, (x) => -b / (x * x), (p) => {
    const [constant, slope] = [number(a, p), number(b, p)];
    const term = slope === '0' ? '' : `${factor(bracketed(slope))}\\ln x`;
    if (constant === '0') return `y=${term || '0'}`;
    return `y=${constant}${term && !term.startsWith('-') ? '+' : ''}${term}`;
  });
}
