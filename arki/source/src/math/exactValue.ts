// Works out a constant expression exactly, in whole-number fractions and square roots,
// where the decimal answer could only be recognised by luck: Σ 1/(n(n+1)) for n up to
// 2021 is 2021/2022, at any size. Values are a + b√r with a and b fractions and r a
// square-free whole number, so √2·√8 = 4 and (1 + √5)/2 stay exact; anything else
// (π, sin, two different roots added together) gives up, and the decimal is used.

import type { Node } from './parser';

type Def = { kind: 'var'; name: string; body: Node } | { kind: 'fn'; name: string; params: string[]; body: Node };

// A fraction n/d in lowest terms, with d > 0.
interface Q {
  n: bigint;
  d: bigint;
}

// a + b√r. When b is 0, r is 1.
interface X {
  a: Q;
  b: Q;
  r: bigint;
}

class GiveUp extends Error {}
const giveUp = (): never => {
  throw new GiveUp();
};

// Past these the numbers are too big to be worth showing, or the work too long.
const MAX_BITS = 2048;
const MAX_STEPS = 300000;
const MAX_TERMS = 100000;

const abs = (n: bigint) => (n < 0n ? -n : n);
const gcd = (a: bigint, b: bigint): bigint => {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};
const bits = (n: bigint) => abs(n).toString(2).length;

function q(n: bigint, d = 1n): Q {
  if (d === 0n) giveUp();
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  n /= g;
  d /= g;
  if (bits(n) > MAX_BITS || bits(d) > MAX_BITS) giveUp();
  return { n, d };
}

const ZERO = q(0n);
const qAdd = (x: Q, y: Q) => q(x.n * y.d + y.n * x.d, x.d * y.d);
const qSub = (x: Q, y: Q) => q(x.n * y.d - y.n * x.d, x.d * y.d);
const qMul = (x: Q, y: Q) => q(x.n * y.n, x.d * y.d);
const qDiv = (x: Q, y: Q) => q(x.n * y.d, x.d * y.n);
const isZero = (x: Q) => x.n === 0n;

const rational = (a: Q): X => ({ a, b: ZERO, r: 1n });
const make = (a: Q, b: Q, r: bigint): X => (isZero(b) || r === 1n ? rational(r === 1n ? qAdd(a, b) : a) : { a, b, r });

// Two values on the same root, or a fraction and a value on a root.
function common(x: X, y: X): bigint {
  if (isZero(x.b)) return y.r;
  if (isZero(y.b) || x.r === y.r) return x.r;
  return giveUp();
}

const add = (x: X, y: X) => make(qAdd(x.a, y.a), qAdd(x.b, y.b), common(x, y));
const neg = (x: X) => make(qSub(ZERO, x.a), qSub(ZERO, x.b), x.r);
const sub = (x: X, y: X) => add(x, neg(y));
function mul(x: X, y: X): X {
  const r = common(x, y);
  const rr = q(r);
  return make(qAdd(qMul(x.a, y.a), qMul(qMul(x.b, y.b), rr)), qAdd(qMul(x.a, y.b), qMul(x.b, y.a)), r);
}
function div(x: X, y: X): X {
  // Times the conjugate, top and bottom: the bottom becomes a² − b²r, a fraction.
  const bottom = qSub(qMul(y.a, y.a), qMul(qMul(y.b, y.b), q(y.r)));
  if (isZero(bottom)) giveUp();
  const top = mul(x, make(y.a, qSub(ZERO, y.b), y.r));
  return make(qDiv(top.a, bottom), qDiv(top.b, bottom), top.r);
}
function pow(x: X, k: bigint): X {
  if (k < 0n) return div(rational(q(1n)), pow(x, -k));
  if (k > 4096n) giveUp();
  let result = rational(q(1n));
  let base = x;
  while (k > 0n) {
    if (k & 1n) result = mul(result, base);
    k >>= 1n;
    if (k > 0n) base = mul(base, base);
  }
  return result;
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  // Newton's method from the floating-point guess, which can be off for big n.
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x && x * x <= n && (x + 1n) * (x + 1n) > n) return x;
    x = y < 1n ? 1n : y;
  }
}

// n = k²·m with m square-free. Prime factors up to n^⅓ are divided out; what is left
// has at most two prime factors, so it is either a square or square-free.
function squarePart(n: bigint): [bigint, bigint] {
  if (n > 10n ** 18n) giveUp();
  let k = 1n;
  let m = 1n;
  for (let p = 2n; p * p * p <= n; p += p === 2n ? 1n : 2n) {
    while (n % (p * p) === 0n) {
      n /= p * p;
      k *= p;
    }
    if (n % p === 0n) {
      n /= p;
      m *= p;
    }
  }
  const root = isqrt(n);
  if (root * root === n) return [k * root, m];
  return [k, m * n];
}

function sqrt(x: X): X {
  if (!isZero(x.b) || x.a.n < 0n) return giveUp();
  const { n, d } = x.a;
  // Top and bottom are often squares themselves, however big: √(n²/m²) = n/m.
  const rn = isqrt(n);
  const rd = isqrt(d);
  if (rn * rn === n && rd * rd === d) return rational(q(rn, rd));
  // √(n/d) = (kn/kd)·√(mn/md) = (kn/(kd·md))·√(mn·md), with n = kn²·mn and d = kd²·md.
  const [kn, mn] = squarePart(n);
  const [kd, md] = squarePart(d);
  const [k, m] = squarePart(mn * md);
  return make(ZERO, q(kn * k, kd * md), m);
}

const whole = (x: X): bigint => (isZero(x.b) && x.a.d === 1n ? x.a.n : giveUp());

// A literal as the fraction it was written as: 0.1 is 1/10, not the nearest double.
function fromNumber(v: number): X {
  if (!Number.isFinite(v)) return giveUp();
  const match = /^(-?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/.exec(String(v));
  if (!match) return giveUp();
  const [, sign, int, frac, exp] = match;
  let n = BigInt(`${sign}${int || '0'}${frac}`);
  let d = 10n ** BigInt(frac.length);
  const e = Number(exp ?? 0);
  if (Math.abs(e) > 400) giveUp();
  if (e > 0) n *= 10n ** BigInt(e);
  else d *= 10n ** BigInt(-e);
  return rational(q(n, d));
}

function evaluateExact(node: Node, defs: ReadonlyMap<string, Def>): X | undefined {
  let steps = 0;
  const known = new Map<string, X>();
  const visiting = new Set<string>();

  const value = (node: Node, locals: ReadonlyMap<string, X>): X => {
    if (++steps > MAX_STEPS) giveUp();
    switch (node.t) {
      case 'num':
        return fromNumber(node.v);
      case 'var': {
        const local = locals.get(node.name);
        if (local) return local;
        const def = defs.get(node.name);
        if (def?.kind !== 'var' || visiting.has(def.name)) return giveUp();
        let x = known.get(def.name);
        if (!x) {
          visiting.add(def.name);
          x = value(def.body, new Map());
          visiting.delete(def.name);
          known.set(def.name, x);
        }
        return x;
      }
      case 'neg':
        return neg(value(node.a, locals));
      case 'bin': {
        const a = value(node.a, locals);
        if (node.op === '^') return power(a, value(node.b, locals));
        const b = value(node.b, locals);
        return node.op === '+' ? add(a, b) : node.op === '-' ? sub(a, b) : node.op === '*' ? mul(a, b) : div(a, b);
      }
      case 'call': {
        if (node.args.length !== 1) return giveUp();
        const a = value(node.args[0], locals);
        if (node.fn === 'sqrt') return sqrt(a);
        if (node.fn === 'abs') return toNumber(a) < 0 ? neg(a) : a;
        return giveUp();
      }
      case 'app': {
        const def = locals.has(node.name) ? undefined : defs.get(node.name);
        if (def?.kind === 'fn') {
          if (def.params.length !== node.args.length || visiting.has(def.name)) return giveUp();
          const inner = new Map(def.params.map((p, i) => [p, value(node.args[i], locals)]));
          visiting.add(def.name);
          let x = value(def.body, inner);
          visiting.delete(def.name);
          if (node.pow) x = power(x, value(node.pow, locals));
          return x;
        }
        // Not a function, so `a(b)` is the product a·b.
        if (node.args.length !== 1) return giveUp();
        const group = node.pow ? power(value(node.args[0], locals), value(node.pow, locals)) : value(node.args[0], locals);
        return mul(value({ t: 'var', name: node.name }, locals), group);
      }
      case 'big': {
        const lo = whole(value(node.lo, locals));
        const hi = whole(value(node.hi, locals));
        if (hi - lo >= BigInt(MAX_TERMS)) return giveUp();
        let total = rational(q(node.kind === 'sum' ? 0n : 1n));
        for (let n = lo; n <= hi; n++) {
          const inner = new Map(locals).set(node.index, rational(q(n)));
          const term = value(node.body, inner);
          total = node.kind === 'sum' ? add(total, term) : mul(total, term);
        }
        return total;
      }
      default:
        return giveUp();
    }
  };

  try {
    return value(node, new Map());
  } catch (err) {
    if (err instanceof GiveUp || err instanceof RangeError) return undefined;
    throw err;
  }
}

// x^y for a whole-number y, or a half (a square root).
function power(x: X, y: X): X {
  if (!isZero(y.b)) return giveUp();
  const { n, d } = y.a;
  if (d === 1n) return pow(x, n);
  if (d === 2n) return pow(sqrt(x), n);
  return giveUp();
}

const toNumber = (x: X) => Number(x.a.n) / Number(x.a.d) + (Number(x.b.n) / Number(x.b.d)) * Math.sqrt(Number(x.r));

// Kept to numbers that can be read at a glance; a 40-digit fraction is no help.
const LONGEST = 15;

function toLatex(x: X): string | undefined {
  const { a, b, r } = x;
  if (isZero(b)) {
    if (abs(a.n).toString().length > LONGEST || a.d.toString().length > LONGEST) return undefined;
    const sign = a.n < 0n ? '-' : '';
    return a.d === 1n ? `${a.n}` : `${sign}\\frac{${abs(a.n)}}{${a.d}}`;
  }
  // Over a common denominator: (A + B√r) / C.
  const c = (a.d / gcd(a.d, b.d)) * b.d;
  const A = a.n * (c / a.d);
  const B = b.n * (c / b.d);
  if ([A, B, c].some((n) => abs(n).toString().length > LONGEST)) return undefined;
  const root = `${abs(B) === 1n ? '' : abs(B)}\\sqrt{${r}}`;
  if (A === 0n) {
    const sign = B < 0n ? '-' : '';
    return c === 1n ? `${sign}${root}` : `${sign}\\frac{${root}}{${c}}`;
  }
  // The positive term first: √2 − 1 rather than −1 + √2.
  const top = A < 0n && B > 0n ? `${root}-${abs(A)}` : `${A}${B < 0n ? '-' : '+'}${root}`;
  return c === 1n ? top : `\\frac{${top}}{${c}}`;
}

// The exact value of a constant expression as LaTeX, if it has a short one. `expected`
// is the value worked out the usual way; an exact one that disagrees is not trusted.
export function exactLatex(node: Node, defs: ReadonlyMap<string, Def>, expected: number): string | undefined {
  const x = evaluateExact(node, defs);
  if (!x) return undefined;
  const v = toNumber(x);
  if (!(Math.abs(v - expected) <= 1e-9 * Math.max(1, Math.abs(expected)))) return undefined;
  return toLatex(x);
}
