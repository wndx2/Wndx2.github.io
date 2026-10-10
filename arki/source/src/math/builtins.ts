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

function deriv2(f: (x: number) => number, x: number): number {
  const h = Math.max(Math.abs(x), 1) * 1e-4;
  return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
}

// The value f(h) tends to as h → 0⁺. Samples at halving steps are extrapolated to
// zero, which is accurate for smooth f; where that doesn't settle, much smaller
// steps are tried directly. ±Infinity for divergence, NaN where there is no limit.
function limitAtZero(f: (h: number) => number): number {
  const sample = (k: number) => f(2 ** -k);
  const extrapolate = (from: number, count: number) => {
    const hs = Array.from({ length: count }, (_, i) => 2 ** -(from + i));
    const table = hs.map((_, i) => sample(from + i));
    for (let level = 1; level < count; level++) {
      for (let i = 0; i < count - level; i++) {
        table[i] = (hs[i + level] * table[i] - hs[i] * table[i + 1]) / (hs[i + level] - hs[i]);
      }
    }
    return table[0];
  };
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a));
  const first = extrapolate(3, 7);
  const second = extrapolate(4, 7);
  if (Number.isFinite(first) && Number.isFinite(second) && close(first, second)) return second;

  let best = NaN;
  let gap = Infinity;
  let previous = sample(10);
  let growing = 0;
  for (let k = 11; k <= 30; k++) {
    const v = sample(k);
    const step = Math.abs(v - previous);
    if (Number.isFinite(v) && step < gap) {
      gap = step;
      best = v;
    }
    growing = Math.abs(v) > Math.abs(previous) && Math.sign(v) === Math.sign(previous) ? growing + 1 : 0;
    previous = v;
  }
  if (growing >= 10 && Math.abs(previous) > 1e4) return previous > 0 ? Infinity : -Infinity;
  if (previous === Infinity || previous === -Infinity) return previous;
  return gap <= 1e-7 * Math.max(1, Math.abs(best)) ? best : NaN;
}

// lim f(x) as x → a. `side` is +1 or -1 for a one-sided limit, 0 for both sides.
function lim(f: (x: number) => number, a: number, side: number): number {
  if (Number.isNaN(a)) return NaN;
  if (a === Infinity) return limitAtZero((h) => f(1 / h));
  if (a === -Infinity) return limitAtZero((h) => f(-1 / h));
  const scale = Math.max(1, Math.abs(a));
  const right = side < 0 ? NaN : limitAtZero((h) => f(a + h * scale));
  const left = side > 0 ? NaN : limitAtZero((h) => f(a - h * scale));
  if (side > 0) return right;
  if (side < 0) return left;
  if (left === right) return left;
  return Math.abs(left - right) <= 1e-6 * Math.max(1, Math.abs(left)) ? (left + right) / 2 : NaN;
}

function bisect(f: (x: number) => number, a: number, b: number): number {
  let fa = f(a);
  for (let i = 0; i < 100; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (fa * fm < 0) b = mid;
    else {
      a = mid;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

// The zero of f on [lo, hi] nearest to `near`, found from a sign change between samples.
function scanForZero(f: (x: number) => number, lo: number, hi: number, near: number): number {
  const steps = 400;
  let best = NaN;
  let x0 = lo;
  let f0 = f(x0);
  for (let i = 1; i <= steps; i++) {
    const x1 = lo + ((hi - lo) * i) / steps;
    const f1 = f(x1);
    if (f0 === 0 || (Number.isFinite(f0) && Number.isFinite(f1) && f0 * f1 < 0)) {
      const zero = f0 === 0 ? x0 : bisect(f, x0, x1);
      // A sign change across a pole isn't a solution.
      const real = Math.abs(f(zero)) <= 1e-6 * Math.max(1, Math.abs(f0), Math.abs(f1));
      if (real && !(Math.abs(zero - near) >= Math.abs(best - near))) best = zero;
    }
    x0 = x1;
    f0 = f1;
  }
  return f0 === 0 && Number.isNaN(best) ? x0 : best;
}

// A solution of f(x) = 0: Newton's method from the guess, then a widening search around it.
function solve(f: (x: number) => number, guess = 0, lo = -Infinity, hi = Infinity): number {
  if (Number.isFinite(lo) && Number.isFinite(hi)) return scanForZero(f, lo, hi, guess);
  let x = guess;
  for (let i = 0; i < 60; i++) {
    const fx = f(x);
    if (!Number.isFinite(fx)) break;
    const slope = deriv(f, x);
    const next = x - fx / slope;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - x) <= 1e-14 * Math.max(1, Math.abs(next))) {
      if (Math.abs(f(next)) <= 1e-9 * Math.max(1, Math.abs(fx)) && next >= lo && next <= hi) return next;
      break;
    }
    x = next;
  }
  for (const radius of [1, 10, 100, 1000, 1e4]) {
    const zero = scanForZero(f, Math.max(lo, guess - radius), Math.min(hi, guess + radius), guess);
    if (!Number.isNaN(zero)) return zero;
  }
  return NaN;
}

// Where f is smallest on [a, b]: the best of a coarse scan, refined by golden-section search.
function fmin(f: (x: number) => number, a: number, b: number): number {
  if (!(a < b) || !Number.isFinite(a) || !Number.isFinite(b)) return a === b ? a : NaN;
  const steps = 400;
  const at = (i: number) => a + ((b - a) * i) / steps;
  let best = 0;
  let lowest = Infinity;
  for (let i = 0; i <= steps; i++) {
    const v = f(at(i));
    if (v < lowest) {
      lowest = v;
      best = i;
    }
  }
  if (lowest === Infinity) return NaN;
  let lo = at(Math.max(0, best - 1));
  let hi = at(Math.min(steps, best + 1));
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 80; i++) {
    const c = hi - ratio * (hi - lo);
    const d = lo + ratio * (hi - lo);
    if (f(c) < f(d)) hi = d;
    else lo = c;
  }
  return (lo + hi) / 2;
}

const isWhole = (...values: number[]) => values.every(Number.isInteger);

function gcd(...values: number[]): number {
  if (!isWhole(...values)) return NaN;
  return values.map(Math.abs).reduce((a, b) => {
    while (b) [a, b] = [b, a % b];
    return a;
  });
}

function lcm(...values: number[]): number {
  if (!isWhole(...values)) return NaN;
  return values.map(Math.abs).reduce((a, b) => (a && b ? (a / gcd(a, b)) * b : 0));
}

// n^p mod m without the intermediate power overflowing.
function modexp(n: number, p: number, m: number): number {
  if (!isWhole(n, p, m) || p < 0 || m <= 0 || m > 94906265) return NaN;
  let result = 1 % m;
  let base = ((n % m) + m) % m;
  for (; p > 0; p = Math.floor(p / 2)) {
    if (p % 2 === 1) result = (result * base) % m;
    base = (base * base) % m;
  }
  return result;
}

function ncr(n: number, r: number): number {
  if (!isWhole(n, r) || r < 0 || r > n) return isWhole(n, r) && n >= 0 ? 0 : NaN;
  r = Math.min(r, n - r);
  let total = 1;
  for (let i = 1; i <= r; i++) total = (total * (n - r + i)) / i;
  return Math.round(total);
}

function npr(n: number, r: number): number {
  if (!isWhole(n, r) || r < 0 || r > n) return isWhole(n, r) && n >= 0 ? 0 : NaN;
  let total = 1;
  for (let i = 0; i < r; i++) total *= n - i;
  return total;
}

function roundTo(x: number, places = 0): number {
  const scale = 10 ** places;
  return Math.round(x * scale) / scale;
}

function randnorm(sigma = 1, mu = 0): number {
  const u = 1 - Math.random();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function randbin(n: number, p: number): number {
  if (!Number.isInteger(n) || n < 0 || n > MAX_TERMS || !(p >= 0 && p <= 1)) return NaN;
  let hits = 0;
  for (let i = 0; i < n; i++) if (Math.random() < p) hits++;
  return hits;
}

// Probability distributions, named and ordered as on a Casio: σ before μ, and the
// inverse t, χ² and F functions take the area of the upper tail.

function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let sum = LANCZOS[0];
  for (let i = 1; i < 9; i++) sum += LANCZOS[i] / (x + i);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(sum);
}

// Regularised lower incomplete gamma function P(a, x).
function gammaP(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0)) return NaN;
  if (x === 0) return 0;
  if (x === Infinity) return 1;
  const front = Math.exp(-x + a * Math.log(x) - lgamma(a));
  if (x < a + 1) {
    let term = 1 / a;
    let total = term;
    for (let n = 1; n < 10000; n++) {
      term *= x / (a + n);
      total += term;
      if (Math.abs(term) < Math.abs(total) * 1e-16) break;
    }
    return total * front;
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return 1 - front * h;
}

// Regularised incomplete beta function I_x(a, b).
function betaI(a: number, b: number, x: number): number {
  if (!(a > 0) || !(b > 0) || !(x >= 0 && x <= 1)) return NaN;
  if (x === 0 || x === 1) return x;
  if (x > (a + 1) / (a + b + 2)) return 1 - betaI(b, a, 1 - x);
  const front = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)) / a;
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 10000; m++) {
    const even = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + even * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + even / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    const odd = (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + odd * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + odd / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return front * h;
}

type Cdf = (x: number) => number;

// The x where an increasing cdf reaches p, by bisection from a bracket that grows to fit.
function quantile(cdf: Cdf, p: number, lo: number, hi: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return lo === -1 ? -Infinity : lo;
  if (p === 1) return Infinity;
  while (cdf(hi) < p) hi *= 2;
  while (lo < 0 && cdf(lo) > p) lo *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// The smallest whole x, from `start`, at which a discrete cdf reaches p.
function discreteQuantile(cdf: Cdf, p: number, start: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  for (let x = start; x < start + MAX_TERMS; x++) if (cdf(x) >= p - 1e-12) return x;
  return NaN;
}

const between = (cdf: Cdf, lo: number, hi: number) => cdf(hi) - cdf(lo);
// A discrete "CD" takes either x (meaning P(X ≤ x)) or a lower and an upper bound.
const discreteCd = (cdf: Cdf, bounds: number[]) =>
  bounds.length === 1 ? cdf(bounds[0]) : cdf(bounds[1]) - cdf(Math.ceil(bounds[0]) - 1);

const normCdf: Cdf = (z) => {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const half = gammaP(0.5, (z * z) / 2) / 2;
  return z < 0 ? 0.5 - half : 0.5 + half;
};
const tCdf = (df: number): Cdf => (t) => {
  if (!(df > 0)) return NaN;
  if (Math.abs(t) === Infinity) return t > 0 ? 1 : 0;
  const tail = betaI(df / 2, 0.5, df / (df + t * t)) / 2;
  return t > 0 ? 1 - tail : tail;
};
const chiCdf = (df: number): Cdf => (x) => (x <= 0 ? 0 : gammaP(df / 2, x / 2));
const fCdf = (n: number, d: number): Cdf => (x) =>
  x <= 0 ? 0 : x === Infinity ? 1 : betaI(n / 2, d / 2, (n * x) / (n * x + d));

function binomialPd(x: number, n: number, p: number): number {
  if (!Number.isInteger(n) || n < 0 || !(p >= 0 && p <= 1)) return NaN;
  if (!Number.isInteger(x) || x < 0 || x > n) return 0;
  if (p === 0 || p === 1) return x === n * p ? 1 : 0;
  return Math.exp(lgamma(n + 1) - lgamma(x + 1) - lgamma(n - x + 1) + x * Math.log(p) + (n - x) * Math.log(1 - p));
}
const binomialCdf = (n: number, p: number): Cdf => (x) => {
  if (!Number.isInteger(n) || n < 0 || !(p >= 0 && p <= 1)) return NaN;
  const k = Math.floor(x);
  if (k < 0) return 0;
  if (k >= n) return 1;
  return betaI(n - k, k + 1, 1 - p);
};

function poissonPd(x: number, mean: number): number {
  if (!(mean >= 0)) return NaN;
  if (!Number.isInteger(x) || x < 0) return 0;
  if (mean === 0) return x === 0 ? 1 : 0;
  return Math.exp(x * Math.log(mean) - mean - lgamma(x + 1));
}
const poissonCdf = (mean: number): Cdf => (x) => {
  if (!(mean >= 0)) return NaN;
  const k = Math.floor(x);
  if (k < 0) return 0;
  return mean === 0 ? 1 : 1 - gammaP(k + 1, mean);
};

// Geometric: the number of the trial on which the first success comes (1, 2, 3, …).
const geoPd = (x: number, p: number) =>
  !(p > 0 && p <= 1) ? NaN : Number.isInteger(x) && x >= 1 ? p * (1 - p) ** (x - 1) : 0;
const geoCdf = (p: number): Cdf => (x) => (!(p > 0 && p <= 1) ? NaN : x < 1 ? 0 : 1 - (1 - p) ** Math.floor(x));

// Hypergeometric: x successes in n draws from a population of N that holds M successes.
function hypergeoPd(x: number, n: number, M: number, N: number): number {
  if (!isWhole(n, M, N) || n < 0 || M < 0 || n > N || M > N) return NaN;
  if (!Number.isInteger(x) || x < Math.max(0, n - (N - M)) || x > Math.min(n, M)) return 0;
  const choose = (a: number, b: number) => lgamma(a + 1) - lgamma(b + 1) - lgamma(a - b + 1);
  return Math.exp(choose(M, x) + choose(N - M, n - x) - choose(N, n));
}
const hypergeoCdf = (n: number, M: number, N: number): Cdf => (x) => {
  let total = 0;
  for (let k = Math.max(0, n - (N - M)); k <= Math.min(Math.floor(x), n, M); k++) total += hypergeoPd(k, n, M, N);
  return Number.isNaN(hypergeoPd(0, n, M, N)) ? NaN : Math.min(1, total);
};

const positive = (value: number, result: number) => (value > 0 ? result : NaN);

const distributions = {
  normpd: (x: number, sigma = 1, mu = 0) =>
    positive(sigma, Math.exp(-(((x - mu) / sigma) ** 2) / 2) / (sigma * Math.sqrt(2 * Math.PI))),
  normcd: (lo: number, hi: number, sigma = 1, mu = 0) =>
    positive(sigma, between(normCdf, (lo - mu) / sigma, (hi - mu) / sigma)),
  invnormcd: (area: number, sigma = 1, mu = 0) => positive(sigma, mu + sigma * quantile(normCdf, area, -1, 1)),
  tpd: (x: number, df: number) =>
    positive(df, Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - ((df + 1) / 2) * Math.log(1 + (x * x) / df)) / Math.sqrt(df * Math.PI)),
  tcd: (lo: number, hi: number, df: number) => between(tCdf(df), lo, hi),
  invtcd: (area: number, df: number) => positive(df, quantile(tCdf(df), 1 - area, -1, 1)),
  chipd: (x: number, df: number) =>
    positive(df, x < 0 ? 0 : Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.LN2 - lgamma(df / 2))),
  chicd: (lo: number, hi: number, df: number) => positive(df, between(chiCdf(df), lo, hi)),
  invchicd: (area: number, df: number) => positive(df, quantile(chiCdf(df), 1 - area, 0, 1)),
  fpd: (x: number, n: number, d: number) =>
    positive(Math.min(n, d), x < 0 ? 0 : Math.exp(
      lgamma((n + d) / 2) - lgamma(n / 2) - lgamma(d / 2) + (n / 2) * Math.log(n / d) +
      (n / 2 - 1) * Math.log(x) - ((n + d) / 2) * Math.log(1 + (n * x) / d),
    )),
  fcd: (lo: number, hi: number, n: number, d: number) => positive(Math.min(n, d), between(fCdf(n, d), lo, hi)),
  invfcd: (area: number, n: number, d: number) => positive(Math.min(n, d), quantile(fCdf(n, d), 1 - area, 0, 1)),
  binomialpd: binomialPd,
  binomialcd: (...a: number[]) => discreteCd(binomialCdf(a[a.length - 2], a[a.length - 1]), a.slice(0, -2)),
  invbinomialcd: (area: number, n: number, p: number) => discreteQuantile(binomialCdf(n, p), area, 0),
  poissonpd: poissonPd,
  poissoncd: (...a: number[]) => discreteCd(poissonCdf(a[a.length - 1]), a.slice(0, -1)),
  invpoissoncd: (area: number, mean: number) => discreteQuantile(poissonCdf(mean), area, 0),
  geopd: geoPd,
  geocd: (...a: number[]) => discreteCd(geoCdf(a[a.length - 1]), a.slice(0, -1)),
  invgeocd: (area: number, p: number) => discreteQuantile(geoCdf(p), area, 1),
  hypergeopd: hypergeoPd,
  hypergeocd: (x: number, n: number, M: number, N: number) => hypergeoCdf(n, M, N)(x),
};

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
  arcsec: (x: number) => Math.acos(1 / x),
  arccsc: (x: number) => Math.asin(1 / x),
  arccot: (x: number) => Math.PI / 2 - Math.atan(x),
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  arsinh: Math.asinh,
  arcosh: Math.acosh,
  artanh: Math.atanh,
  sech: (x: number) => 1 / Math.cosh(x),
  csch: (x: number) => 1 / Math.sinh(x),
  coth: (x: number) => 1 / Math.tanh(x),
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  logb: (base: number, x: number) => Math.log(x) / Math.log(base),
  exp: Math.exp,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: roundTo,
  trunc: Math.trunc,
  frac: (x: number) => x - Math.trunc(x),
  sign: Math.sign,
  sqrt: Math.sqrt,
  // The parts of a complex number, as they are for a real one.
  re: (x: number) => x,
  im: (x: number) => x * 0,
  conj: (x: number) => x,
  arg: (x: number) => (x < 0 ? Math.PI : x * 0),
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
  deriv2,
  integrate,
  lim,
  solve,
  fmin,
  fmax: (f: (x: number) => number, a: number, b: number) => fmin((x) => -f(x), a, b),
  gcd,
  lcm,
  modexp,
  ncr,
  npr,
  random: () => Math.random(),
  randint: (lo: number, hi: number) => (isWhole(lo, hi) && lo <= hi ? lo + Math.floor(Math.random() * (hi - lo + 1)) : NaN),
  randnorm,
  randbin,
  ...distributions,
};

// Argument counts for functions that don't take exactly one; [min, max].
export const ARITY: Record<string, [number, number]> = {
  min: [1, Infinity],
  max: [1, Infinity],
  mod: [2, 2],
  logb: [2, 2],
  nthroot: [2, 2],
  round: [1, 2],
  gcd: [2, Infinity],
  lcm: [2, Infinity],
  modexp: [3, 3],
  ncr: [2, 2],
  npr: [2, 2],
  random: [0, 0],
  randint: [2, 2],
  randnorm: [0, 2],
  randbin: [2, 2],
  normpd: [1, 3],
  normcd: [2, 4],
  invnormcd: [1, 3],
  tpd: [2, 2],
  tcd: [3, 3],
  invtcd: [2, 2],
  chipd: [2, 2],
  chicd: [3, 3],
  invchicd: [2, 2],
  fpd: [3, 3],
  fcd: [4, 4],
  invfcd: [3, 3],
  binomialpd: [3, 3],
  binomialcd: [3, 4],
  invbinomialcd: [3, 3],
  poissonpd: [2, 2],
  poissoncd: [2, 3],
  invpoissoncd: [2, 2],
  geopd: [2, 2],
  geocd: [2, 3],
  invgeocd: [2, 2],
  hypergeopd: [4, 4],
  hypergeocd: [4, 4],
};

// Functions whose first argument is an expression in a variable of their own, with
// the number of further arguments they take; [min, max].
export const BINDERS: Record<string, [number, number]> = {
  deriv: [1, 1],
  deriv2: [1, 1],
  lim: [2, 2],
  solve: [0, 3],
  fmin: [2, 2],
  fmax: [2, 2],
};
