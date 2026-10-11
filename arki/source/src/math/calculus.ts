// Derivatives and antiderivatives as formulas. Differentiation reuses the symbolic rules
// the graph already uses, then simplifies; antidifferentiation tries the methods taught
// for it in turn: the standard integrals, linearity, substitution (including the linear
// kind, ∫ f(ax + b)), integration by parts, partial-fraction-free special forms and
// expanding a polynomial. What it can't do, it says so rather than guess.

import {
  ONE,
  Unsupported,
  add,
  dependsOn,
  div,
  expand,
  fn,
  fromNode,
  mul,
  neg,
  num,
  pow,
  replace,
  sub,
  sym,
  toNode,
  type E,
} from './algebra';
import { differentiate } from './differentiate';

export function derivative(e: E, x: string): E {
  return fromNode(differentiate(toNode(e), x, () => false));
}

const isNum = (e: E, n: number, d = 1) => e.k === 'num' && e.q.n === n && e.q.d === d;

// u as a·x + b, if it is one (a and b free of x, a not zero).
function linear(u: E, x: string): { a: E; b: E } | undefined {
  try {
    const a = derivative(u, x);
    if (dependsOn(a, x) || isNum(a, 0)) return undefined;
    const b = sub(u, mul(a, sym(x)));
    return dependsOn(b, x) ? undefined : { a, b };
  } catch (err) {
    if (err instanceof Unsupported) return undefined;
    throw err;
  }
}

const lnAbs = (u: E) => fn('ln', [fn('abs', [u])]);

// The standard integrals of a function of a plain variable u.
function standard(name: string, u: E): E | undefined {
  switch (name) {
    case 'sin':
      return neg(fn('cos', [u]));
    case 'cos':
      return fn('sin', [u]);
    case 'tan':
      return neg(lnAbs(fn('cos', [u])));
    case 'cot':
      return lnAbs(fn('sin', [u]));
    case 'sec':
      return lnAbs(add(fn('sec', [u]), fn('tan', [u])));
    case 'csc':
      return neg(lnAbs(add(fn('csc', [u]), fn('cot', [u]))));
    case 'sinh':
      return fn('cosh', [u]);
    case 'cosh':
      return fn('sinh', [u]);
    case 'tanh':
      return fn('ln', [fn('cosh', [u])]);
    case 'ln':
      return sub(mul(u, fn('ln', [u])), u);
    case 'arctan':
      return sub(mul(u, fn('arctan', [u])), mul(num(1, 2), fn('ln', [add(ONE, pow(u, num(2)))])));
    case 'arcsin':
      return add(mul(u, fn('arcsin', [u])), pow(sub(ONE, pow(u, num(2))), num(1, 2)));
    case 'abs':
      return mul(num(1, 2), u, fn('abs', [u]));
    default:
      return undefined;
  }
}

export function antiderivative(e: E, x: string): E | undefined {
  const X = sym(x);
  let depth = 0;

  const integrate = (e: E): E | undefined => {
    if (++depth > 400) return undefined;
    if (!dependsOn(e, x)) return mul(e, X);
    switch (e.k) {
      case 'sym':
        return mul(num(1, 2), pow(X, num(2)));
      case 'sum': {
        const parts = e.terms.map(integrate);
        return parts.every(Boolean) ? add(...(parts as E[])) : undefined;
      }
      case 'prod':
        return product(e.factors);
      case 'pow':
        return power(e);
      case 'fn':
        return func(e);
      default:
        return undefined;
    }
  };

  // ∫ f(ax + b) dx = F(ax + b) / a.
  const func = (e: Extract<E, { k: 'fn' }>): E | undefined => {
    if (e.user || e.args.length !== 1) return undefined;
    const line = linear(e.args[0], x);
    if (!line) return undefined;
    const F = standard(e.fn, e.args[0]);
    return F && div(F, line.a);
  };

  const power = (e: Extract<E, { k: 'pow' }>): E | undefined => {
    const { base, exp } = e;
    if (!dependsOn(exp, x)) {
      const line = linear(base, x);
      if (line) {
        // ∫ (ax + b)ⁿ = (ax + b)ⁿ⁺¹ / (a(n + 1)), and ln|ax + b| / a for n = −1.
        if (isNum(exp, -1)) return div(lnAbs(base), line.a);
        const next = add(exp, ONE);
        return div(pow(base, next), mul(line.a, next));
      }
      const special = specialForm(base, exp);
      if (special) return special;
      // sec²u, csc²u, sin²u and cos²u.
      if (base.k === 'fn' && base.args.length === 1) {
        const u = base.args[0];
        const inner = linear(u, x);
        if (inner) {
          const { a } = inner;
          if (isNum(exp, -2) && base.fn === 'cos') return div(fn('tan', [u]), a);
          if (isNum(exp, -2) && base.fn === 'sin') return neg(div(fn('cot', [u]), a));
          if (isNum(exp, 2) && base.fn === 'sec') return div(fn('tan', [u]), a);
          if (isNum(exp, 2) && base.fn === 'csc') return neg(div(fn('cot', [u]), a));
          if (isNum(exp, 2) && (base.fn === 'sin' || base.fn === 'cos')) {
            const twice = fn('sin', [mul(num(2), u)]);
            const wave = div(twice, mul(num(4), a));
            return base.fn === 'sin' ? sub(mul(num(1, 2), X), wave) : add(mul(num(1, 2), X), wave);
          }
        }
      }
      // A whole power of a polynomial, multiplied out.
      if (base.k === 'sum' && exp.k === 'num' && exp.q.d === 1 && exp.q.n > 1) return expanded(e);
      return undefined;
    }
    // ∫ b^(ax + c) = b^(ax + c) / (a ln b), and e^(ax + c) / a.
    if (!dependsOn(base, x)) {
      const line = linear(exp, x);
      if (!line) return undefined;
      if (base.k === 'sym' && base.name === 'e') return div(e, line.a);
      return div(e, mul(line.a, fn('ln', [base])));
    }
    return undefined;
  };

  // 1/(x² + c) and 1/√(c − x²), and 1/√(x² + c), with c a positive number.
  const specialForm = (base: E, exp: E): E | undefined => {
    if (base.k !== 'sum' || base.terms.length !== 2) return undefined;
    const square = base.terms.find((t) => t.k === 'pow' && t.base.k === 'sym' && t.base.name === x && isNum(t.exp, 2));
    const negSquare = base.terms.find((t) => t.k === 'prod' && t.factors.length === 2 && isNum(t.factors[0], -1) && t.factors[1].k === 'pow' && t.factors[1].base.k === 'sym' && t.factors[1].base.name === x && isNum(t.factors[1].exp, 2));
    const constant = base.terms.find((t) => t.k === 'num' && t.q.n > 0);
    if (!constant) return undefined;
    const root = pow(constant, num(1, 2));
    if (square && isNum(exp, -1)) return div(fn('arctan', [div(sym(x), root)]), root);
    if (negSquare && isNum(exp, -1, 2)) return fn('arcsin', [div(sym(x), root)]);
    if (square && isNum(exp, -1, 2)) return fn('ln', [fn('abs', [add(sym(x), pow(base, num(1, 2)))])]);
    return undefined;
  };

  const expanded = (e: E): E | undefined => {
    try {
      const out = expand(e);
      return out.k === 'sum' || out.k !== e.k ? integrate(out) : undefined;
    } catch (err) {
      if (err instanceof Unsupported) return undefined;
      throw err;
    }
  };

  const product = (factors: E[]): E | undefined => {
    const constant = factors.filter((f) => !dependsOn(f, x));
    const varying = factors.filter((f) => dependsOn(f, x));
    const c = mul(...constant);
    if (varying.length === 1) {
      const F = integrate(varying[0]);
      return F && mul(c, F);
    }
    const F = parts(varying) ?? substitution(varying) ?? secTan(varying) ?? logPower(varying) ?? expandedProduct(varying);
    return F && mul(c, F);
  };

  const expandedProduct = (factors: E[]) =>
    factors.some((f) => f.k === 'sum' || (f.k === 'pow' && f.base.k === 'sum')) ? expanded(mul(...factors)) : undefined;

  // ∫ sec u tan u = sec u, ∫ csc u cot u = −csc u.
  const secTan = (factors: E[]): E | undefined => {
    if (factors.length !== 2 || factors.some((f) => f.k !== 'fn')) return undefined;
    const [f, g] = factors as Extract<E, { k: 'fn' }>[];
    const names = [f.fn, g.fn].sort().join(' ');
    if (JSON.stringify(f.args) !== JSON.stringify(g.args)) return undefined;
    const line = linear(f.args[0], x);
    if (!line) return undefined;
    if (names === 'sec tan') return div(fn('sec', f.args), line.a);
    if (names === 'cot csc') return neg(div(fn('csc', f.args), line.a));
    return undefined;
  };

  // ∫ xⁿ ln x = xⁿ⁺¹ ln x / (n + 1) − xⁿ⁺¹ / (n + 1)².
  const logPower = (factors: E[]): E | undefined => {
    if (factors.length !== 2) return undefined;
    const log = factors.find((f) => f.k === 'fn' && f.fn === 'ln' && f.args[0].k === 'sym' && f.args[0].name === x);
    const other = factors.find((f) => f !== log);
    if (!log || !other) return undefined;
    const n = other.k === 'sym' && other.name === x ? ONE : other.k === 'pow' && other.base.k === 'sym' && other.base.name === x && !dependsOn(other.exp, x) ? other.exp : undefined;
    if (!n || isNum(n, -1)) return undefined;
    const next = add(n, ONE);
    return sub(div(mul(pow(X, next), log), next), div(pow(X, next), pow(next, num(2))));
  };

  // Substitution: a factor f(u) whose inner u has the rest of the product as its
  // derivative, up to a constant: ∫ f(u)·u′ dx = ∫ f(u) du. Also the case where the rest
  // is the derivative of the factor itself: ∫ u·u′ = u²/2.
  const substitution = (factors: E[]): E | undefined => {
    const U = sym('arki_u');
    for (let i = 0; i < factors.length; i++) {
      const outer = factors[i];
      const rest = mul(...factors.filter((_, j) => j !== i));
      const tries: [E, E][] = [];
      if (outer.k === 'fn' && outer.args.length === 1 && !outer.user) tries.push([outer.args[0], fn(outer.fn, [U])]);
      if (outer.k === 'pow' && !dependsOn(outer.exp, x)) tries.push([outer.base, pow(U, outer.exp)]);
      if (outer.k === 'pow' && !dependsOn(outer.base, x)) tries.push([outer.exp, pow(outer.base, U)]);
      tries.push([outer, U]);
      for (const [u, shape] of tries) {
        let du: E;
        try {
          du = derivative(u, x);
        } catch (err) {
          if (err instanceof Unsupported) continue;
          throw err;
        }
        if (isNum(du, 0)) continue;
        const ratio = div(rest, du);
        if (dependsOn(ratio, x)) continue;
        const F = antiderivative(shape, U.k === 'sym' ? U.name : '');
        if (F) return mul(ratio, replace(F, (U as Extract<E, { k: 'sym' }>).name, u));
      }
    }
    return undefined;
  };

  // Integration by parts for a polynomial times e^(ax+b), sin(ax+b) or cos(ax+b), done
  // the tabular way: differentiate the polynomial until it is gone, integrating the
  // other factor as many times.
  const parts = (factors: E[]): E | undefined => {
    const target = factors.find((f) => {
      if (f.k === 'pow' && !dependsOn(f.base, x)) return !!linear(f.exp, x);
      return f.k === 'fn' && (f.fn === 'sin' || f.fn === 'cos' || f.fn === 'sinh' || f.fn === 'cosh') && !!linear(f.args[0], x);
    });
    if (!target) return undefined;
    let poly: E = mul(...factors.filter((f) => f !== target));
    if (!isPolynomial(poly)) return undefined;
    let integral = integrate(target);
    if (!integral) return undefined;
    const terms: E[] = [];
    for (let k = 0; k < 16 && !isNum(poly, 0); k++) {
      terms.push(mul(k % 2 === 0 ? ONE : num(-1), poly, integral));
      poly = derivative(poly, x);
      const next = integrate(integral);
      if (!next) return undefined;
      integral = next;
    }
    return isNum(poly, 0) ? add(...terms) : undefined;
  };

  // Made of x, numbers, constants, sums and whole powers only.
  const isPolynomial = (e: E): boolean => {
    switch (e.k) {
      case 'num':
      case 'sym':
        return true;
      case 'sum':
        return e.terms.every(isPolynomial);
      case 'prod':
        return e.factors.every(isPolynomial);
      case 'pow':
        return isPolynomial(e.base) && e.exp.k === 'num' && e.exp.q.d === 1 && e.exp.q.n >= 0;
      default:
        return !dependsOn(e, x);
    }
  };

  try {
    return integrate(e);
  } catch (err) {
    if (err instanceof Unsupported) return undefined;
    throw err;
  }
}
