// A small computer algebra system: expressions in a canonical form that can be
// simplified and written out as LaTeX, for showing a derivative or an antiderivative
// as a formula. Like terms are collected (x + x = 2x), powers of the same base merged
// (x·x² = x³), and numbers kept as exact fractions, so 1/3 never becomes 0.333….

import { nameToLatex, type Node } from './parser';

// Gives up on simplifying: the expression has something this doesn't handle.
export class Unsupported extends Error {}
const unsupported = (): never => {
  throw new Unsupported();
};

// An exact fraction n/d in lowest terms with d > 0, kept to safe integers.
export interface Frac {
  n: number;
  d: number;
}

const gcd = (a: number, b: number): number => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

function frac(n: number, d = 1): Frac {
  if (d === 0 || !Number.isSafeInteger(n) || !Number.isSafeInteger(d)) return unsupported();
  if (d < 0) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

const qAdd = (a: Frac, b: Frac) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const qMul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d);
const qIs = (a: Frac, n: number, d = 1) => a.n === n && a.d === d;

// A number as typed, as the fraction it was written as: 0.25 is 1/4.
function fracOf(v: number): Frac {
  if (Number.isInteger(v)) return frac(v);
  const match = /^(-?)(\d*)\.(\d+)$/.exec(String(v));
  if (!match || match[3].length > 12) return unsupported();
  return frac(Number(`${match[1]}${match[2] || '0'}${match[3]}`), 10 ** match[3].length);
}

export type E =
  | { k: 'num'; q: Frac }
  | { k: 'sym'; name: string }
  | { k: 'sum'; terms: E[] }
  | { k: 'prod'; factors: E[] }
  | { k: 'pow'; base: E; exp: E }
  | { k: 'fn'; fn: string; args: E[]; user?: boolean };

export const key = (e: E) => JSON.stringify(e);
export const num = (n: number, d = 1): E => ({ k: 'num', q: frac(n, d) });
export const sym = (name: string): E => ({ k: 'sym', name });
export const ZERO = num(0);
export const ONE = num(1);
const isNum = (e: E, n?: number, d = 1): boolean => e.k === 'num' && (n === undefined || qIs(e.q, n, d));
const isInteger = (e: E): e is Extract<E, { k: 'num' }> => e.k === 'num' && e.q.d === 1;

// A term as its number and the rest: 3x² is 3 and x².
function splitCoefficient(e: E): [Frac, E] {
  if (e.k === 'num') return [e.q, ONE];
  if (e.k === 'prod' && e.factors[0].k === 'num') {
    const rest = e.factors.slice(1);
    return [e.factors[0].q, rest.length === 1 ? rest[0] : { k: 'prod', factors: rest }];
  }
  return [frac(1), e];
}

export function add(...terms: E[]): E {
  const flat = terms.flatMap((t) => (t.k === 'sum' ? t.terms : [t]));
  let constant = frac(0);
  const groups = new Map<string, { coefficient: Frac; rest: E }>();
  for (const t of flat) {
    if (t.k === 'num') {
      constant = qAdd(constant, t.q);
      continue;
    }
    const [coefficient, rest] = splitCoefficient(t);
    const k = key(rest);
    const group = groups.get(k);
    if (group) group.coefficient = qAdd(group.coefficient, coefficient);
    else groups.set(k, { coefficient, rest });
  }
  const out: E[] = [];
  for (const { coefficient, rest } of groups.values()) {
    if (coefficient.n !== 0) out.push(mul({ k: 'num', q: coefficient }, rest));
  }
  if (constant.n !== 0) out.push({ k: 'num', q: constant });
  if (out.length === 0) return ZERO;
  return out.length === 1 ? out[0] : { k: 'sum', terms: out };
}

export const neg = (e: E) => mul(num(-1), e);
export const sub = (a: E, b: E) => add(a, neg(b));
export const div = (a: E, b: E) => mul(a, pow(b, num(-1)));

export function mul(...factors: E[]): E {
  const flat = factors.flatMap((f) => (f.k === 'prod' ? f.factors : [f]));
  let coefficient = frac(1);
  // Factors on the same base are merged by adding their exponents: x·x² = x³.
  const bases = new Map<string, { base: E; exps: E[] }>();
  for (const f of flat) {
    if (f.k === 'num') {
      coefficient = qMul(coefficient, f.q);
      continue;
    }
    const [base, exp] = f.k === 'pow' ? [f.base, f.exp] : [f, ONE];
    const k = key(base);
    const group = bases.get(k);
    if (group) group.exps.push(exp);
    else bases.set(k, { base, exps: [exp] });
  }
  if (coefficient.n === 0) return ZERO;
  const out: E[] = [];
  for (const { base, exps } of bases.values()) {
    const merged = exps.length === 1 ? exps[0] : add(...exps);
    const p = pow(base, merged);
    if (p.k === 'num') coefficient = qMul(coefficient, p.q);
    else if (p.k === 'prod') {
      for (const g of p.factors) {
        if (g.k === 'num') coefficient = qMul(coefficient, g.q);
        else out.push(g);
      }
    } else out.push(p);
  }
  if (coefficient.n === 0) return ZERO;
  out.sort((a, b) => (key(a) < key(b) ? -1 : 1));
  if (out.length === 0) return { k: 'num', q: coefficient };
  if (qIs(coefficient, 1) && out.length === 1) return out[0];
  return { k: 'prod', factors: qIs(coefficient, 1) ? out : [{ k: 'num', q: coefficient }, ...out] };
}

// p/q to a whole power, kept exact.
function powerOf(q: Frac, n: number): Frac | undefined {
  if (Math.abs(n) > 64) return undefined;
  let result = frac(1);
  for (let i = 0; i < Math.abs(n); i++) result = qMul(result, q);
  if (n < 0) return result.n === 0 ? undefined : frac(result.d, result.n);
  return result;
}

export function pow(base: E, exp: E): E {
  if (isNum(exp, 0)) return ONE;
  if (isNum(exp, 1)) return base;
  if (base.k === 'num') {
    if (qIs(base.q, 1)) return ONE;
    if (base.q.n === 0 && exp.k === 'num' && exp.q.n > 0) return ZERO;
    if (isInteger(exp)) {
      const q = powerOf(base.q, exp.q.n);
      if (q) return { k: 'num', q };
    }
    // √(n²) = n for a perfect square, and so on for other roots.
    if (exp.k === 'num' && base.q.n > 0) {
      const root = Math.round(base.q.n ** (1 / exp.q.d));
      const rootD = Math.round(base.q.d ** (1 / exp.q.d));
      if (root ** exp.q.d === base.q.n && rootD ** exp.q.d === base.q.d) return pow(num(root, rootD), num(exp.q.n));
    }
  }
  // (x^a)^n = x^(an) for a whole number n; with a root outside it isn't (√(x²) = |x|).
  if (base.k === 'pow' && isInteger(exp)) return pow(base.base, mul(base.exp, exp));
  if (base.k === 'prod' && isInteger(exp)) return mul(...base.factors.map((f) => pow(f, exp)));
  // e^(ln u) = u.
  if (base.k === 'sym' && base.name === 'e' && exp.k === 'fn' && exp.fn === 'ln') return exp.args[0];
  return { k: 'pow', base, exp };
}

export function fn(name: string, args: E[], user = false): E {
  if (user) return { k: 'fn', fn: name, args, user };
  const [u] = args;
  if (args.length === 1) {
    if (name === 'sqrt') return pow(u, num(1, 2));
    if (name === 'exp') return pow(sym('e'), u);
    if (name === 'ln' && u.k === 'sym' && u.name === 'e') return ONE;
    if (name === 'ln' && isNum(u, 1)) return ZERO;
    if (name === 'ln' && u.k === 'pow' && u.base.k === 'sym' && u.base.name === 'e') return u.exp;
    if (isNum(u, 0) && ['sin', 'tan', 'arcsin', 'arctan', 'sinh', 'tanh'].includes(name)) return ZERO;
    if (isNum(u, 0) && (name === 'cos' || name === 'cosh')) return ONE;
    if (name === 'abs' && u.k === 'num') return { k: 'num', q: frac(Math.abs(u.q.n), u.q.d) };
  }
  return { k: 'fn', fn: name, args };
}

// From the parser's tree. `isFunction` says which names are functions defined in the
// list (they should be inlined first; any left stay as calls).
export function fromNode(node: Node, isFunction: (name: string) => boolean = () => false): E {
  const e = (n: Node) => fromNode(n, isFunction);
  switch (node.t) {
    case 'num':
      return { k: 'num', q: fracOf(node.v) };
    case 'var':
      return node.name === 'infty' ? unsupported() : sym(node.name);
    case 'neg':
      return neg(e(node.a));
    case 'bin': {
      const [a, b] = [e(node.a), e(node.b)];
      switch (node.op) {
        case '+':
          return add(a, b);
        case '-':
          return sub(a, b);
        case '*':
          return mul(a, b);
        case '/':
          return div(a, b);
        case '^':
          return pow(a, b);
      }
      return unsupported();
    }
    case 'call':
      return fn(node.fn, node.args.map(e));
    case 'app': {
      const args = node.args.map(e);
      if (isFunction(node.name)) {
        const call = fn(node.name, args, true);
        return node.pow ? pow(call, e(node.pow)) : call;
      }
      if (args.length !== 1) return unsupported();
      return mul(sym(node.name), node.pow ? pow(args[0], e(node.pow)) : args[0]);
    }
    default:
      return unsupported();
  }
}

// Back to the parser's tree, to be compiled and drawn.
export function toNode(e: E): Node {
  switch (e.k) {
    case 'num': {
      const top: Node = { t: 'num', v: e.q.n };
      return e.q.d === 1 ? top : { t: 'bin', op: '/', a: top, b: { t: 'num', v: e.q.d } };
    }
    case 'sym':
      return { t: 'var', name: e.name };
    case 'sum':
      return e.terms.map(toNode).reduce((a, b) => ({ t: 'bin', op: '+', a, b }));
    case 'prod':
      return e.factors.map(toNode).reduce((a, b) => ({ t: 'bin', op: '*', a, b }));
    case 'pow':
      return { t: 'bin', op: '^', a: toNode(e.base), b: toNode(e.exp) };
    case 'fn':
      return e.user ? { t: 'app', name: e.fn, args: e.args.map(toNode) } : { t: 'call', fn: e.fn, args: e.args.map(toNode) };
  }
}

export function dependsOn(e: E, x: string): boolean {
  switch (e.k) {
    case 'num':
      return false;
    case 'sym':
      return e.name === x;
    case 'sum':
      return e.terms.some((t) => dependsOn(t, x));
    case 'prod':
      return e.factors.some((f) => dependsOn(f, x));
    case 'pow':
      return dependsOn(e.base, x) || dependsOn(e.exp, x);
    case 'fn':
      return e.args.some((a) => dependsOn(a, x));
  }
}

// `e` with the symbol `name` replaced by `value`, simplified again.
export function replace(e: E, name: string, value: E): E {
  const r = (f: E) => replace(f, name, value);
  switch (e.k) {
    case 'num':
      return e;
    case 'sym':
      return e.name === name ? value : e;
    case 'sum':
      return add(...e.terms.map(r));
    case 'prod':
      return mul(...e.factors.map(r));
    case 'pow':
      return pow(r(e.base), r(e.exp));
    case 'fn':
      return fn(e.fn, e.args.map(r), e.user);
  }
}

// Multiplies out products of sums and whole powers of sums, so a polynomial becomes a
// sum of terms in x. Gives up past a few hundred terms.
export function expand(e: E): E {
  switch (e.k) {
    case 'sum':
      return add(...e.terms.map(expand));
    case 'prod': {
      let terms: E[] = [ONE];
      for (const f of e.factors.map(expand)) {
        const parts = f.k === 'sum' ? f.terms : [f];
        terms = terms.flatMap((t) => parts.map((p) => mul(t, p)));
        if (terms.length > 400) return unsupported();
      }
      return add(...terms);
    }
    case 'pow':
      if (e.base.k === 'sum' && isInteger(e.exp) && e.exp.q.n > 1 && e.exp.q.n <= 12) {
        return expand({ k: 'prod', factors: Array.from({ length: e.exp.q.n }, () => e.base) });
      }
      return e;
    default:
      return e;
  }
}

// Writing it out.

const FUNCTION_LATEX: Record<string, string> = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot',
  arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan',
  sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', ln: '\\ln', log: '\\log',
};

const isNegative = (e: E) => (e.k === 'num' ? e.q.n < 0 : e.k === 'prod' && e.factors[0].k === 'num' && e.factors[0].q.n < 0);

// The power of x in a term, when the term is a number times a power of x (with any
// factors that don't involve x), for putting a polynomial's terms in order.
function degree(term: E, x: string): number | undefined {
  if (!dependsOn(term, x)) return 0;
  if (term.k === 'sym') return 1;
  if (term.k === 'pow' && term.base.k === 'sym' && term.base.name === x && term.exp.k === 'num') return term.exp.q.n / term.exp.q.d;
  if (term.k === 'prod') {
    let total = 0;
    for (const f of term.factors) {
      const d = degree(f, x);
      if (d === undefined) return undefined;
      total += d;
    }
    return total;
  }
  return undefined;
}

// Terms with functions in them first, in the order they came, then a polynomial's
// terms from the highest power down, then the constant; and a positive term in front
// where there is one, so x ln x − x rather than −x + x ln x.
function orderTerms(terms: E[], x: string): E[] {
  const ranked = terms.map((t, i) => {
    const d = degree(t, x);
    const group = d === 0 ? 2 : d === undefined ? 0 : 1;
    return { t, i, group, d: d ?? 0 };
  });
  ranked.sort((a, b) => a.group - b.group || (a.group === 1 ? b.d - a.d : 0) || a.i - b.i);
  const out = ranked.map((r) => r.t);
  const positive = out.findIndex((t) => !isNegative(t));
  if (positive > 0) out.unshift(...out.splice(positive, 1));
  return out;
}

function numberLatex(q: Frac): string {
  const sign = q.n < 0 ? '-' : '';
  return q.d === 1 ? `${q.n}` : `${sign}\\frac{${Math.abs(q.n)}}{${q.d}}`;
}

// How a factor is placed within a product: numbers' roots first, then constants such as
// π or a, then x, then brackets, then functions.
function factorRank(f: E, x: string): number {
  const base = f.k === 'pow' ? f.base : f;
  if (base.k === 'num') return 0;
  if (base.k === 'sym' && base.name !== x && !(f.k === 'pow' && dependsOn(f.exp, x))) return 1;
  if (base.k === 'sym') return base.name === x && !(f.k === 'pow' && dependsOn(f.exp, x)) ? 2 : 4;
  if (base.k === 'sum') return 3;
  return 4;
}

// A function's argument goes without brackets when it is a single letter or number.
const plainArgument = (u: E) => u.k === 'sym' || (u.k === 'num' && u.q.d === 1 && u.q.n >= 0);

function functionLatex(f: Extract<E, { k: 'fn' }>, x: string, power?: string): string {
  const args = f.args.map((a) => latex(a, x));
  if (f.user) return `${nameToLatex(f.fn)}${power ? `^{${power}}` : ''}\\left(${args.join(',')}\\right)`;
  if (f.fn === 'abs') return `\\left|${args[0]}\\right|${power ? `^{${power}}` : ''}`;
  const name = FUNCTION_LATEX[f.fn] ?? `\\operatorname{${f.fn}}`;
  const head = power ? `${name}^{${power}}` : name;
  // ln|u|, with the bars as its brackets.
  if (f.args.length === 1 && f.args[0].k === 'fn' && f.args[0].fn === 'abs') return `${head}${args[0]}`;
  return f.args.length === 1 && plainArgument(f.args[0]) ? `${head} ${args[0]}` : `${head}\\left(${args.join(',')}\\right)`;
}

function powerLatex(base: E, exp: E, x: string): string {
  if (exp.k === 'num' && exp.q.n === 1 && exp.q.d === 2) return `\\sqrt{${latex(base, x)}}`;
  if (exp.k === 'num' && exp.q.n === 1 && exp.q.d === 3) return `\\sqrt[3]{${latex(base, x)}}`;
  const power = latex(exp, x);
  if (base.k === 'sym') return `${base.name === 'e' ? 'e' : nameToLatex(base.name)}^{${power}}`;
  // sin²x, as it is usually written.
  if (base.k === 'fn' && !base.user && base.fn !== 'abs' && isInteger(exp) && exp.q.n > 0) return functionLatex(base, x, power);
  if (base.k === 'num' && base.q.d === 1 && base.q.n > 0) return `${base.q.n}^{${power}}`;
  return `\\left(${latex(base, x)}\\right)^{${power}}`;
}

function factorLatex(f: E, x: string): string {
  switch (f.k) {
    case 'sum':
      return `\\left(${latex(f, x)}\\right)`;
    case 'pow':
      return powerLatex(f.base, f.exp, x);
    case 'fn':
      return functionLatex(f, x);
    case 'sym':
      return nameToLatex(f.name);
    default:
      return latex(f, x);
  }
}

function productLatex(factors: E[], x: string): string {
  let q = frac(1);
  const top: E[] = [];
  const bottom: E[] = [];
  for (const f of factors) {
    if (f.k === 'num') q = qMul(q, f.q);
    // A negative power goes under the line: x⁻² is 1/x².
    else if (f.k === 'pow' && f.exp.k === 'num' && f.exp.q.n < 0) bottom.push(pow(f.base, num(-f.exp.q.n, f.exp.q.d)));
    else top.push(f);
  }
  const order = (list: E[]) => [...list].sort((a, b) => factorRank(a, x) - factorRank(b, x));
  const join = (list: E[]) => {
    let out = '';
    for (const f of order(list)) {
      const text = factorLatex(f, x);
      // Two numbers side by side would read as one.
      out += out && /^[\d]/.test(text) ? `\\cdot ${text}` : text;
    }
    return out;
  };
  const sign = q.n < 0 ? '-' : '';
  const n = Math.abs(q.n);
  // In a fraction, a sum alone above or below the line needs no brackets.
  const alone = (list: E[], number: number) => (list.length === 1 && list[0].k === 'sum' && number === 1 ? latex(list[0], x) : undefined);
  if (bottom.length === 0 && q.d === 1) return sign + (n !== 1 || top.length === 0 ? `${n}` : '') + join(top);
  const upper = alone(top, n) ?? (n !== 1 || top.length === 0 ? `${n}` : '') + join(top);
  const lower = alone(bottom, q.d) ?? (q.d !== 1 ? `${q.d}` : '') + join(bottom);
  return `${sign}\\frac{${upper || '1'}}{${lower}}`;
}

// The LaTeX for an expression, with `x` as the variable its polynomial terms are ordered by.
export function latex(e: E, x = 'x'): string {
  switch (e.k) {
    case 'num':
      return numberLatex(e.q);
    case 'sym':
      return nameToLatex(e.name);
    case 'sum': {
      let out = '';
      for (const term of orderTerms(e.terms, x)) {
        if (!out) out = latex(term, x);
        else if (isNegative(term)) out += `-${latex(neg(term), x)}`;
        else out += `+${latex(term, x)}`;
      }
      return out;
    }
    case 'prod':
      return productLatex(e.factors, x);
    case 'pow':
      if (e.exp.k === 'num' && e.exp.q.n < 0) return productLatex([e], x);
      return powerLatex(e.base, e.exp, x);
    case 'fn':
      return functionLatex(e, x);
  }
}

// A sum of fractions over one common denominator, its top multiplied out:
// 1/(x + 1) − x/(x + 1)² becomes 1/(x + 1)². Returns the sum unchanged if it has no
// fractions or can't be combined.
export function together(e: E): E {
  if (e.k !== 'sum') return e;
  const parts = e.terms.map((t) => {
    const factors = t.k === 'prod' ? t.factors : [t];
    const top: E[] = [];
    const bottom = new Map<string, { base: E; exp: Frac }>();
    for (const f of factors) {
      if (f.k === 'pow' && f.exp.k === 'num' && f.exp.q.n < 0) bottom.set(key(f.base), { base: f.base, exp: frac(-f.exp.q.n, f.exp.q.d) });
      else top.push(f);
    }
    return { top, bottom };
  });
  if (parts.every((p) => p.bottom.size === 0)) return e;
  const common = new Map<string, { base: E; exp: Frac }>();
  for (const { bottom } of parts) {
    for (const [k, b] of bottom) {
      const seen = common.get(k);
      if (!seen || b.exp.n / b.exp.d > seen.exp.n / seen.exp.d) common.set(k, b);
    }
  }
  try {
    const numerator = expand(
      add(
        ...parts.map(({ top, bottom }) => {
          const missing = [...common].map(([k, { base, exp }]) => {
            const own = bottom.get(k)?.exp ?? frac(0);
            return pow(base, { k: 'num', q: qAdd(exp, frac(-own.n, own.d)) });
          });
          return mul(...top, ...missing);
        }),
      ),
    );
    return mul(numerator, ...[...common.values()].map(({ base, exp }) => pow(base, { k: 'num', q: frac(-exp.n, exp.d) })));
  } catch (err) {
    if (err instanceof Unsupported) return e;
    throw err;
  }
}

// The shorter of a sum as it stands and over a common denominator.
export function pretty(e: E, x = 'x'): string {
  const plain = latex(e, x);
  const combined = together(e);
  if (combined === e) return plain;
  const joined = latex(combined, x);
  return joined.length < plain.length ? joined : plain;
}
