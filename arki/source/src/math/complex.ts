// Runtime library for expressions compiled in complex mode, which is how anything that
// involves the imaginary unit is evaluated. Real arguments go to the real builtins first,
// so a result only turns complex where the real one doesn't exist (√−4, ln −1).

import { builtins } from './builtins';
import { MathError } from './parser';

export interface Complex {
  re: number;
  im: number;
}

type Fn = (...args: Complex[]) => Complex;
type RealFn = (...args: number[]) => number;

const REAL = builtins as unknown as Record<string, (...args: never[]) => number>;

// Adding zero turns −0 into 0, which keeps numbers on the negative real axis on one side
// of the branch cuts there: ln(−1) is πi however the −1 was arrived at.
const of = (re: number, im = 0): Complex => ({ re, im: im + 0 });
const ZERO = of(0);
const ONE = of(1);
const I = of(0, 1);
const HALF_PI = of(Math.PI / 2);

// The real number a value stands for, or NaN when it has an imaginary part.
const real = (z: Complex) => (Math.abs(z.im) <= 1e-9 * Math.max(1, Math.abs(z.re)) ? z.re : NaN);

// Drops a part that is only rounding error next to the other one, as in (1+i)² = 2i.
export function tidy(z: Complex): Complex {
  const re = Math.abs(z.re) <= 1e-12 * Math.abs(z.im) ? 0 : z.re;
  const im = Math.abs(z.im) <= 1e-12 * Math.abs(z.re) ? 0 : z.im;
  return of(re, im);
}

const add = (a: Complex, b: Complex) => of(a.re + b.re, a.im + b.im);
const sub = (a: Complex, b: Complex) => of(a.re - b.re, a.im - b.im);
const neg = (a: Complex) => of(-a.re, -a.im);
const scale = (a: Complex, k: number) => of(a.re * k, a.im * k);

function mul(a: Complex, b: Complex): Complex {
  if (a.im === 0 && b.im === 0) return of(a.re * b.re);
  return of(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

function div(a: Complex, b: Complex): Complex {
  if (b.im === 0) return a.im === 0 ? of(a.re / b.re) : of(a.re / b.re, a.im / b.re);
  const d = b.re * b.re + b.im * b.im;
  return of((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}

const abs = (z: Complex) => Math.hypot(z.re, z.im);
const arg = (z: Complex) => Math.atan2(z.im, z.re);

function exp(z: Complex): Complex {
  const r = Math.exp(z.re);
  return z.im === 0 ? of(r) : of(r * Math.cos(z.im), r * Math.sin(z.im));
}

const ln = (z: Complex) => of(Math.log(abs(z)), arg(z));

// The principal square root, exact for negative reals: √−4 = 2i.
function sqrt(z: Complex): Complex {
  const r = abs(z);
  const im = Math.sqrt((r - z.re) / 2);
  return of(Math.sqrt((r + z.re) / 2), z.im < 0 ? -im : im);
}

function pow(a: Complex, b: Complex): Complex {
  if (a.im === 0 && b.im === 0) {
    const r = Math.pow(a.re, b.re);
    if (!Number.isNaN(r)) return of(r);
  }
  // Whole powers by repeated squaring, so that i² is exactly −1.
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 1024) {
    let result = ONE;
    let base = a;
    for (let n = Math.abs(b.re); n > 0; n >>= 1) {
      if (n & 1) result = mul(result, base);
      base = mul(base, base);
    }
    return b.re < 0 ? div(ONE, result) : result;
  }
  if (a.re === 0 && a.im === 0) return b.re > 0 ? ZERO : of(NaN);
  return exp(mul(b, ln(a)));
}

// x^(p/q) for a literal fraction with odd q, which keeps its real value for real x.
const rpow = (x: Complex, p: number, q: number) => (x.im === 0 ? of(builtins.rpow(x.re, p, q)) : pow(x, of(p / q)));

const sin = (z: Complex) => of(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
const cos = (z: Complex) => of(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
const sinh = (z: Complex) => of(Math.sinh(z.re) * Math.cos(z.im), Math.cosh(z.re) * Math.sin(z.im));
const cosh = (z: Complex) => of(Math.cosh(z.re) * Math.cos(z.im), Math.sinh(z.re) * Math.sin(z.im));
const tan = (z: Complex) => div(sin(z), cos(z));
const tanh = (z: Complex) => div(sinh(z), cosh(z));
const inverse = (z: Complex) => div(ONE, z);

const arcsin = (z: Complex) => neg(mul(I, ln(add(mul(I, z), sqrt(sub(ONE, mul(z, z)))))));
const arccos = (z: Complex) => sub(HALF_PI, arcsin(z));
const arctan = (z: Complex) => mul(of(0, 0.5), sub(ln(sub(ONE, mul(I, z))), ln(add(ONE, mul(I, z)))));
const arsinh = (z: Complex) => ln(add(z, sqrt(add(mul(z, z), ONE))));
const arcosh = (z: Complex) => ln(add(z, mul(sqrt(add(z, ONE)), sqrt(sub(z, ONE)))));
const artanh = (z: Complex) => scale(sub(ln(add(ONE, z)), ln(sub(ONE, z))), 0.5);

const FUNCTIONS: Record<string, Fn> = {
  sin, cos, tan, sinh, cosh, tanh,
  sec: (z) => inverse(cos(z)),
  csc: (z) => inverse(sin(z)),
  cot: (z) => div(cos(z), sin(z)),
  sech: (z) => inverse(cosh(z)),
  csch: (z) => inverse(sinh(z)),
  coth: (z) => div(cosh(z), sinh(z)),
  arcsin, arccos, arctan, arsinh, arcosh, artanh,
  arcsec: (z) => arccos(inverse(z)),
  arccsc: (z) => arcsin(inverse(z)),
  arccot: (z) => sub(HALF_PI, arctan(z)),
  ln, exp, sqrt,
  log: (z) => scale(ln(z), 1 / Math.LN10),
  log2: (z) => scale(ln(z), 1 / Math.LN2),
  logb: (base, z) => div(ln(z), ln(base)),
  nthroot: (n, z) => pow(z, inverse(n)),
  abs: (z) => of(abs(z)),
  arg: (z) => of(arg(z)),
  re: (z) => of(z.re),
  im: (z) => of(z.im),
  conj: (z) => of(z.re, -z.im),
  sign: (z) => (abs(z) === 0 ? ZERO : scale(z, 1 / abs(z))),
};

// A named function: the real one where it has a value, otherwise its complex extension.
function call(fn: string, ...args: Complex[]): Complex {
  const allReal = args.every((z) => z.im === 0);
  if (allReal) {
    const value = (REAL[fn] as RealFn)(...args.map((z) => z.re));
    if (!Number.isNaN(value) || args.some((z) => Number.isNaN(z.re))) return of(value);
  }
  if (Object.hasOwn(FUNCTIONS, fn)) return FUNCTIONS[fn](...args);
  if (allReal) return of(NaN);
  throw new MathError(`“${fn}” doesn’t take complex numbers`);
}

const MAX_TERMS = 100000;

function accumulate(start: Complex, step: (a: Complex, b: Complex) => Complex) {
  return (lo: Complex, hi: Complex, term: (n: Complex) => Complex): Complex => {
    const from = Math.ceil(real(lo));
    const to = Math.floor(real(hi));
    if (!(to - from < MAX_TERMS)) return of(NaN);
    let total = start;
    for (let n = from; n <= to; n++) total = step(total, term(of(n)));
    return total;
  };
}

type Curve = (x: Complex) => Complex;

// The real and imaginary parts of a function of a real variable, each put through a
// real operation (an integral, a derivative, a limit).
function byParts(operate: (f: (x: number) => number) => number, f: Curve): Complex {
  return of(operate((x) => f(of(x)).re), operate((x) => f(of(x)).im));
}

function integrate(lo: Complex, hi: Complex, f: Curve): Complex {
  const a = real(lo);
  const b = real(hi);
  return byParts((part) => builtins.integrate(a, b, part), f);
}

const BY_PARTS = new Set(['deriv', 'deriv2', 'lim']);

// The functions that take an expression in a variable of their own (see BINDERS).
function bind(fn: string, f: Curve, ...args: Complex[]): Complex {
  const operate = (part: (x: number) => number) => (REAL[fn] as (f: typeof part, ...rest: number[]) => number)(part, ...args.map(real));
  return BY_PARTS.has(fn) ? byParts(operate, f) : of(operate((x) => real(f(of(x)))));
}

export const complex = {
  of, I, real, add, sub, mul, div, neg, pow, rpow, call, integrate, bind,
  eq: (a: Complex, b: Complex) => a.re === b.re && a.im === b.im,
  sum: accumulate(ZERO, add),
  prod: accumulate(ONE, mul),
};
