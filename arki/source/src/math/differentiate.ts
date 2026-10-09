// Symbolic differentiation of the AST. The graph uses it to find stationary and
// inflection points precisely enough that their coordinates can be recognised as
// exact values. Anything it has no rule for is wrapped in a numeric derivative, so
// the result is always usable, just less precise in those spots.

import type { Branch, Node } from './parser';

const num = (v: number): Node => ({ t: 'num', v });
const call = (fn: string, ...args: Node[]): Node => ({ t: 'call', fn, args });
const isNum = (n: Node, v: number) => n.t === 'num' && n.v === v;

// The constructors drop zeros and ones as they go. Besides keeping the result small,
// this matters for correctness: 0·ln(x) must not turn into NaN for negative x.
const neg = (a: Node): Node => (isNum(a, 0) ? a : a.t === 'neg' ? a.a : { t: 'neg', a });
const add = (a: Node, b: Node): Node => (isNum(a, 0) ? b : isNum(b, 0) ? a : { t: 'bin', op: '+', a, b });
const sub = (a: Node, b: Node): Node => (isNum(b, 0) ? a : isNum(a, 0) ? neg(b) : { t: 'bin', op: '-', a, b });
const mul = (a: Node, b: Node): Node => {
  if (isNum(a, 0) || isNum(b, 0)) return num(0);
  if (isNum(a, 1)) return b;
  if (isNum(b, 1)) return a;
  return { t: 'bin', op: '*', a, b };
};
const div = (a: Node, b: Node): Node => (isNum(a, 0) ? a : isNum(b, 1) ? a : { t: 'bin', op: '/', a, b });
const pow = (a: Node, b: Node): Node => (isNum(b, 1) ? a : isNum(b, 0) ? num(1) : { t: 'bin', op: '^', a, b });
const square = (a: Node) => pow(a, num(2));

// d/du of each one-argument function, as a function of its argument u.
const RULES: Record<string, (u: Node) => Node> = {
  sin: (u) => call('cos', u),
  cos: (u) => neg(call('sin', u)),
  tan: (u) => square(call('sec', u)),
  sec: (u) => mul(call('sec', u), call('tan', u)),
  csc: (u) => neg(mul(call('csc', u), call('cot', u))),
  cot: (u) => neg(square(call('csc', u))),
  arcsin: (u) => div(num(1), call('sqrt', sub(num(1), square(u)))),
  arccos: (u) => neg(div(num(1), call('sqrt', sub(num(1), square(u))))),
  arctan: (u) => div(num(1), add(num(1), square(u))),
  sinh: (u) => call('cosh', u),
  cosh: (u) => call('sinh', u),
  tanh: (u) => sub(num(1), square(call('tanh', u))),
  arsinh: (u) => div(num(1), call('sqrt', add(square(u), num(1)))),
  arcosh: (u) => div(num(1), call('sqrt', sub(square(u), num(1)))),
  artanh: (u) => div(num(1), sub(num(1), square(u))),
  ln: (u) => div(num(1), u),
  log: (u) => div(num(1), mul(u, call('ln', num(10)))),
  log2: (u) => div(num(1), mul(u, call('ln', num(2)))),
  trunc: () => num(0),
  frac: () => num(1),
  exp: (u) => call('exp', u),
  sqrt: (u) => div(num(1), mul(num(2), call('sqrt', u))),
  abs: (u) => call('sign', u),
  floor: () => num(0),
  ceil: () => num(0),
  round: () => num(0),
  sign: () => num(0),
};

function dependsOn(node: Node, name: string): boolean {
  switch (node.t) {
    case 'num':
      return false;
    case 'var':
      return node.name === name;
    case 'neg':
      return dependsOn(node.a, name);
    case 'bin':
      return dependsOn(node.a, name) || dependsOn(node.b, name);
    case 'call':
      return node.args.some((arg) => dependsOn(arg, name));
    case 'app':
      return node.name === name || node.args.some((arg) => dependsOn(arg, name)) || (!!node.pow && dependsOn(node.pow, name));
    case 'tuple':
      return node.items.some((item) => dependsOn(item, name));
    case 'big':
      return dependsOn(node.lo, name) || dependsOn(node.hi, name) || (node.index !== name && dependsOn(node.body, name));
    case 'int':
      return dependsOn(node.lo, name) || dependsOn(node.hi, name) || (node.wrt !== name && dependsOn(node.body, name));
    case 'piece':
      return piecesOf(node).some((part) => dependsOn(part, name));
    case 'deriv':
      return node.wrt === name || dependsOn(node.body, name);
    case 'bind':
      return node.args.some((arg) => dependsOn(arg, name)) || (node.wrt !== name && dependsOn(node.body, name));
  }
}

// Every expression inside a pair of braces: the conditions' operands and the values.
function piecesOf(node: Extract<Node, { t: 'piece' }>): Node[] {
  const parts = node.branches.flatMap((branch) => [...branch.when.operands, ...(branch.value ? [branch.value] : [])]);
  return node.otherwise ? [...parts, node.otherwise] : parts;
}

// The same braces with every expression inside passed through `f`.
function mapPiece(node: Extract<Node, { t: 'piece' }>, f: (n: Node) => Node): Node {
  const branches: Branch[] = node.branches.map((branch) => ({
    when: { operands: branch.when.operands.map(f), rels: branch.when.rels },
    value: branch.value && f(branch.value),
  }));
  return { t: 'piece', branches, otherwise: node.otherwise && f(node.otherwise) };
}

// Replaces the free variable `name` with `value` throughout `node`.
function substitute(node: Node, name: string, value: Node): Node {
  const s = (n: Node): Node => {
    switch (n.t) {
      case 'num':
        return n;
      case 'var':
        return n.name === name ? value : n;
      case 'neg':
        return { ...n, a: s(n.a) };
      case 'bin':
        return { ...n, a: s(n.a), b: s(n.b) };
      case 'call':
        return { ...n, args: n.args.map(s) };
      case 'app': {
        const args = n.args.map(s);
        const power = n.pow && s(n.pow);
        // `name(args)` with the name itself replaced can only have been a product.
        if (n.name !== name) return { ...n, args, pow: power };
        return { t: 'bin', op: '*', a: value, b: power ? pow(args[0], power) : args[0] };
      }
      case 'tuple':
        return { ...n, items: n.items.map(s) };
      case 'big':
        return { ...n, lo: s(n.lo), hi: s(n.hi), body: n.index === name ? n.body : s(n.body) };
      case 'int':
        return { ...n, lo: s(n.lo), hi: s(n.hi), body: n.wrt === name ? n.body : s(n.body) };
      case 'piece':
        return mapPiece(n, s);
      case 'deriv':
        // A derivative in `name` can't have an expression put in its place; callers
        // check for that case first (see containsDerivativeOf) and never reach it.
        return n.wrt === name ? n : { ...n, body: s(n.body) };
      case 'bind':
        return { ...n, args: n.args.map(s), body: n.wrt === name ? n.body : s(n.body) };
    }
  };
  return s(node);
}

function containsDerivativeOf(node: Node, name: string): boolean {
  switch (node.t) {
    case 'num':
    case 'var':
      return false;
    case 'neg':
      return containsDerivativeOf(node.a, name);
    case 'bin':
      return containsDerivativeOf(node.a, name) || containsDerivativeOf(node.b, name);
    case 'call':
    case 'app':
      return node.args.some((arg) => containsDerivativeOf(arg, name));
    case 'tuple':
      return node.items.some((item) => containsDerivativeOf(item, name));
    case 'big':
    case 'int':
      return containsDerivativeOf(node.body, name);
    case 'piece':
      return piecesOf(node).some((part) => containsDerivativeOf(part, name));
    case 'deriv':
      return node.wrt === name || containsDerivativeOf(node.body, name);
    case 'bind':
      return containsDerivativeOf(node.body, name) || node.args.some((arg) => containsDerivativeOf(arg, name));
  }
}

// `isFunction` says whether a name is a user-defined function, which decides how
// `name(args)` reads: a call, or the product name·(args).
export function differentiate(node: Node, wrt: string, isFunction: (name: string) => boolean): Node {
  const d = (n: Node): Node => {
    if (!dependsOn(n, wrt)) return num(0);
    const numeric: Node = { t: 'deriv', wrt, body: n };
    switch (n.t) {
      case 'num':
        return num(0);
      case 'var':
        return num(1);
      case 'neg':
        return neg(d(n.a));
      case 'bin': {
        const { a, b } = n;
        switch (n.op) {
          case '+':
            return add(d(a), d(b));
          case '-':
            return sub(d(a), d(b));
          case '*':
            return add(mul(d(a), b), mul(a, d(b)));
          case '/':
            return div(sub(mul(d(a), b), mul(a, d(b))), square(b));
          case '^': {
            if (!dependsOn(b, wrt)) {
              const lower: Node = b.t === 'num' ? num(b.v - 1) : sub(b, num(1));
              return mul(mul(b, pow(a, lower)), d(a));
            }
            if (!dependsOn(a, wrt)) return mul(mul(n, call('ln', a)), d(b));
            return mul(n, add(mul(d(b), call('ln', a)), div(mul(b, d(a)), a)));
          }
        }
        return numeric;
      }
      case 'call': {
        const rule = RULES[n.fn];
        if (!rule || n.args.length !== 1) return numeric;
        return mul(rule(n.args[0]), d(n.args[0]));
      }
      case 'app': {
        if (isFunction(n.name) || n.args.length !== 1) return numeric;
        const group = n.pow ? pow(n.args[0], n.pow) : n.args[0];
        return d({ t: 'bin', op: '*', a: { t: 'var', name: n.name }, b: group });
      }
      case 'big':
        if (n.kind !== 'sum' || n.index === wrt || dependsOn(n.lo, wrt) || dependsOn(n.hi, wrt)) return numeric;
        return { ...n, body: d(n.body) };
      case 'int': {
        // Leibniz's rule: the limits contribute the integrand at each end, and any
        // dependence inside the integrand is differentiated under the integral sign.
        const hasInner = n.wrt === wrt ? false : dependsOn(n.body, wrt);
        const inner = dependsOn(n.body, n.wrt) && [n.lo, n.hi].some((limit) => dependsOn(limit, wrt));
        // A `deriv` node in the integrand can't have the limit substituted into it.
        if (inner && containsDerivativeOf(n.body, n.wrt)) return numeric;
        const upper = mul(substitute(n.body, n.wrt, n.hi), d(n.hi));
        const lower = mul(substitute(n.body, n.wrt, n.lo), d(n.lo));
        const under: Node = hasInner ? { ...n, body: d(n.body) } : num(0);
        return add(sub(upper, lower), under);
      }
      case 'piece':
        // Same conditions, each value differentiated. A bare condition stands for the
        // constant 1, so its derivative is 0 where it holds and still undefined elsewhere.
        return {
          t: 'piece',
          branches: n.branches.map((branch) => ({ when: branch.when, value: branch.value ? d(branch.value) : num(0) })),
          otherwise: n.otherwise && d(n.otherwise),
        };
      case 'tuple':
      case 'deriv':
      case 'bind':
        return numeric;
    }
  };
  return d(node);
}
