// Runtime library for compiled expressions. Everything works on plain numbers and
// signals "undefined here" with NaN, which the plotters treat as a gap.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function gamma(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  x -= 1;
  let sum = LANCZOS[0];
  for (let i = 1; i < 9; i++) sum += LANCZOS[i] / (x + i);
  const t = x + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * sum;
}

function fact(x: number): number {
  if (Number.isInteger(x)) {
    if (x < 0) return NaN;
    if (x > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= x; i++) r *= i;
    return r;
  }
  return gamma(x + 1);
}

// The real n-th root, defined for negative x when n is odd.
function nthroot(n: number, x: number): number {
  if (x < 0 && Number.isInteger(n) && Math.abs(n) % 2 === 1) return -Math.pow(-x, 1 / n);
  return Math.pow(x, 1 / n);
}

// x^(p/q) for a literal fraction with odd q, so x^(1/3) and x^(2/3) exist for x < 0.
function rpow(x: number, p: number, q: number): number {
  if (x >= 0) return Math.pow(x, p / q);
  const magnitude = Math.pow(-x, p / q);
  return Math.abs(p) % 2 === 1 ? -magnitude : magnitude;
}

const MAX_TERMS = 100000;

function sum(lo: number, hi: number, term: (n: number) => number): number {
  lo = Math.ceil(lo);
  hi = Math.floor(hi);
  if (!(hi - lo < MAX_TERMS)) return NaN;
  let total = 0;
  for (let n = lo; n <= hi; n++) total += term(n);
  return total;
}

function prod(lo: number, hi: number, term: (n: number) => number): number {
  lo = Math.ceil(lo);
  hi = Math.floor(hi);
  if (!(hi - lo < MAX_TERMS)) return NaN;
  let total = 1;
  for (let n = lo; n <= hi; n++) total *= term(n);
  return total;
}

function deriv(f: (x: number) => number, x: number): number {
  const h = Math.max(Math.abs(x), 1) * 1e-5;
  return (f(x + h) - f(x - h)) / (2 * h);
}

// Gauss–Kronrod 7/15 nodes and weights on [-1, 1] (positive half; the rule is symmetric).
const GK_NODES = [
  0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.741531185599394440,
  0.586087235467691130, 0.405845151377397167, 0.207784955007898468, 0,
];
const GK_WEIGHTS = [
  0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919,
  0.169004726639267903, 0.190350578064785410, 0.204432940075298892, 0.209482141084727828,
];
// Weights of the embedded 7-point Gauss rule, for the odd-indexed nodes above.
const GAUSS_WEIGHTS = [0.129484966168869693, 0.279705391489276668, 0.381830050505118945, 0.417959183673469388];

// One 15-point estimate over [a, b]: the integral, an error estimate, and ∫|f|.
function kronrod(f: (x: number) => number, a: number, b: number): [number, number, number] {
  const centre = (a + b) / 2;
  const half = (b - a) / 2;
  const middle = f(centre);
  let k = GK_WEIGHTS[7] * middle;
  let g = GAUSS_WEIGHTS[3] * middle;
  let magnitude = GK_WEIGHTS[7] * Math.abs(middle);
  for (let i = 0; i < 7; i++) {
    const offset = half * GK_NODES[i];
    const lower = f(centre - offset);
    const upper = f(centre + offset);
    k += GK_WEIGHTS[i] * (lower + upper);
    magnitude += GK_WEIGHTS[i] * (Math.abs(lower) + Math.abs(upper));
    if (i % 2 === 1) g += GAUSS_WEIGHTS[(i - 1) / 2] * (lower + upper);
  }
  return [k * half, Math.abs((k - g) * half), magnitude * Math.abs(half)];
}

const MAX_INTERVALS = 2000;

// Adaptive quadrature, accurate to about 13 digits for smooth integrands so results
// can be recognised as exact values. Infinite limits are mapped onto a finite interval.
function integrate(a: number, b: number, f: (x: number) => number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  if (a === b) return 0;
  if (a > b) return -integrate(b, a, f);
  if (a === -Infinity && b === Infinity) {
    return integrate(-1, 1, (t) => (f(t / (1 - t * t)) * (1 + t * t)) / (1 - t * t) ** 2);
  }
  if (b === Infinity) return integrate(0, 1, (t) => f(a + t / (1 - t)) / (1 - t) ** 2);
  if (a === -Infinity) return integrate(0, 1, (t) => f(b - t / (1 - t)) / (1 - t) ** 2);

  let budget = MAX_INTERVALS;
  const refine = (lo: number, hi: number, estimate: number, error: number, allowed: number): number => {
    if (error <= allowed || budget <= 0 || !Number.isFinite(estimate)) return estimate;
    budget -= 2;
    const mid = (lo + hi) / 2;
    const [k1, e1] = kronrod(f, lo, mid);
    const [k2, e2] = kronrod(f, mid, hi);
    return refine(lo, mid, k1, e1, allowed / 2) + refine(mid, hi, k2, e2, allowed / 2);
  };
  const [estimate, error, magnitude] = kronrod(f, a, b);
  return refine(a, b, estimate, error, 1e-13 * magnitude);
}

export const builtins = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sec: (x: number) => 1 / Math.cos(x),
  csc: (x: number) => 1 / Math.sin(x),
  cot: (x: number) => 1 / Math.tan(x),
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  arsinh: Math.asinh,
  arcosh: Math.acosh,
  artanh: Math.atanh,
  ln: Math.log,
  log: Math.log10,
  logb: (base: number, x: number) => Math.log(x) / Math.log(base),
  exp: Math.exp,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  sqrt: Math.sqrt,
  min: Math.min,
  max: Math.max,
  mod: (a: number, b: number) => a - b * Math.floor(a / b),
  pow: Math.pow,
  nthroot,
  rpow,
  fact,
  sum,
  prod,
  deriv,
  integrate,
};

// Argument counts for functions that don't take exactly one; [min, max].
export const ARITY: Record<string, [number, number]> = {
  min: [1, Infinity],
  max: [1, Infinity],
  mod: [2, 2],
  logb: [2, 2],
  nthroot: [2, 2],
};
