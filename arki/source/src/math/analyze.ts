// Turns the list of expressions into things to draw. The whole list is analysed
// together because expressions refer to each other (sliders, user functions).

import { ARITY, BINDERS, builtins } from './builtins';
import { complex, tidy, type Complex } from './complex';
import { differentiate } from './differentiate';
import { MathError, nameToLatex, parse, spanOf, type Node, type Statement } from './parser';

type Fn1 = (u: number) => number;

export type Plot =
  // y = f(x), with its first and second derivatives for stationary and inflection points.
  | { kind: 'fx'; f: Fn1; d1: Fn1; d2: Fn1 }
  // x = f(y), likewise.
  | { kind: 'fy'; f: Fn1; d1: Fn1; d2: Fn1 }
  // The curve f(x, y) = 0. With `region`, also the area where f < 0.
  | { kind: 'implicit'; f: (x: number, y: number) => number; region: boolean; strict: boolean }
  | { kind: 'parametric'; x: (t: number) => number; y: (t: number) => number }
  | { kind: 'polar'; f: (theta: number) => number }
  // A closed shape through its vertices, in the order they were given.
  | { kind: 'polygon'; vertices: [number, number][] }
  // `drag` says how each coordinate can be changed by dragging the point, if it can.
  | { kind: 'point'; x: number; y: number; drag?: [PointHandle | undefined, PointHandle | undefined] };

// What dragging a point along one axis rewrites: a number written in the point itself
// (the range of the source it occupies), or the slider the coordinate is.
export type PointHandle = { kind: 'literal'; span: [number, number] } | { kind: 'slider'; name: string };

export interface Analysis {
  empty?: boolean;
  plot?: Plot;
  // A constant result to show next to the expression.
  value?: number;
  // The imaginary part of that result, when it has one.
  imaginary?: number;
  // Set when the expression is `name = number`, which the UI shows as a slider.
  slider?: { name: string; value: number };
  error?: string;
  softError?: boolean;
  // Undefined variables that could be created as sliders.
  missing?: string[];
}

type Def =
  | { kind: 'var'; name: string; body: Node }
  | { kind: 'fn'; name: string; params: string[]; body: Node };

interface Entry {
  statement?: Statement;
  def?: Def;
  free: Set<string>;
  locals: Set<string>;
  // Involves the imaginary unit, directly or through something it refers to, so it is
  // evaluated with complex numbers.
  complex?: boolean;
  error?: MathError;
  missing: string[];
}

const CONSTANTS: Record<string, string> = { pi: 'Math.PI', e: 'Math.E', infty: 'Infinity' };
// The imaginary unit, unless the name has been given another meaning (a sum's index, a slider).
const IMAGINARY = 'i';
const NO_LOCALS: ReadonlySet<string> = new Set();

const parseCache = new Map<string, Statement | MathError>();

function parseCached(latex: string): Statement | MathError {
  let result = parseCache.get(latex);
  if (!result) {
    try {
      result = parse(latex);
    } catch (err) {
      result = err instanceof MathError ? err : new MathError('Couldn’t read this expression');
    }
    if (parseCache.size > 2000) parseCache.clear();
    parseCache.set(latex, result);
  }
  return result;
}

function collectFree(node: Node, bound: ReadonlySet<string>, out: Set<string>): Set<string> {
  switch (node.t) {
    case 'num':
      break;
    case 'var':
      if (!bound.has(node.name) && !(node.name in CONSTANTS)) out.add(node.name);
      break;
    case 'neg':
      collectFree(node.a, bound, out);
      break;
    case 'bin':
      collectFree(node.a, bound, out);
      collectFree(node.b, bound, out);
      break;
    case 'call':
      for (const arg of node.args) collectFree(arg, bound, out);
      break;
    case 'app':
      if (!bound.has(node.name)) out.add(node.name);
      for (const arg of node.args) collectFree(arg, bound, out);
      if (node.pow) collectFree(node.pow, bound, out);
      break;
    case 'tuple':
      for (const item of node.items) collectFree(item, bound, out);
      break;
    case 'big':
      collectFree(node.lo, bound, out);
      collectFree(node.hi, bound, out);
      collectFree(node.body, new Set(bound).add(node.index), out);
      break;
    case 'piece':
      for (const branch of node.branches) {
        for (const operand of branch.when.operands) collectFree(operand, bound, out);
        if (branch.value) collectFree(branch.value, bound, out);
      }
      if (node.otherwise) collectFree(node.otherwise, bound, out);
      break;
    case 'int':
      collectFree(node.lo, bound, out);
      collectFree(node.hi, bound, out);
      collectFree(node.body, new Set(bound).add(node.wrt), out);
      break;
    case 'bind':
      for (const arg of node.args) collectFree(arg, bound, out);
      collectFree(node.body, new Set(bound).add(node.wrt), out);
      break;
    case 'deriv':
      // The derivative is evaluated at the current value of its variable, so that stays free.
      if (!bound.has(node.wrt)) out.add(node.wrt);
      collectFree(node.body, new Set(bound).add(node.wrt), out);
      break;
  }
  return out;
}

const freeOf = (node: Node) => collectFree(node, NO_LOCALS, new Set());

function definitionOf(st: Statement): Def | undefined {
  if (st.rel !== '=' || !st.rhs) return undefined;
  const { lhs, rhs } = st;
  if (lhs.t === 'app' && !lhs.pow && lhs.name !== 'x' && lhs.name !== 'y') {
    const params = lhs.args.map((arg) => (arg.t === 'var' && !(arg.name in CONSTANTS) ? arg.name : ''));
    if (params.every(Boolean) && new Set(params).size === params.length) {
      return { kind: 'fn', name: lhs.name, params, body: rhs };
    }
  }
  if (lhs.t === 'var' && lhs.name !== 'x' && lhs.name !== 'y' && !(lhs.name in CONSTANTS)) {
    const free = freeOf(rhs);
    const polar = lhs.name === 'r' && free.has('theta');
    if (!free.has('x') && !free.has('y') && !polar) return { kind: 'var', name: lhs.name, body: rhs };
  }
  return undefined;
}

interface Scope {
  locals: Map<string, string>;
  defs: Map<string, Def>;
  // The variables whose values are complex; only the complex generator needs to know.
  complexVars?: ReadonlySet<string>;
}

const quote = (name: string) => `“${nameToLatex(name).replace(/[\\{}]/g, '')}”`;

function gen(node: Node, scope: Scope): string {
  switch (node.t) {
    case 'num':
      return `(${node.v})`;
    case 'var': {
      const local = scope.locals.get(node.name);
      if (local) return local;
      if (node.name in CONSTANTS) return CONSTANTS[node.name];
      const def = scope.defs.get(node.name);
      if (!def) throw new MathError(`${quote(node.name)} isn’t defined`);
      if (def.kind === 'fn') throw new MathError(`${quote(node.name)} is a function and needs an argument`);
      return `S.${node.name}`;
    }
    case 'neg':
      return `(-${gen(node.a, scope)})`;
    case 'bin': {
      if (node.op === '^') return genPower(node.a, node.b, scope);
      return `(${gen(node.a, scope)}${node.op}${gen(node.b, scope)})`;
    }
    case 'call': {
      checkCall(node.fn, node.args);
      return `B.${node.fn}(${node.args.map((arg) => gen(arg, scope)).join(',')})`;
    }
    case 'app': {
      const def = scope.locals.has(node.name) ? undefined : scope.defs.get(node.name);
      const args = node.args.map((arg) => gen(arg, scope));
      if (def?.kind === 'fn') {
        if (args.length !== def.params.length) {
          const n = def.params.length;
          throw new MathError(`${quote(node.name)} takes ${n} argument${n === 1 ? '' : 's'}`);
        }
        const call = `F.${node.name}(${args.join(',')})`;
        return node.pow ? `B.pow(${call},${gen(node.pow, scope)})` : call;
      }
      // Not a function, so `a(b)` is the product a·b.
      if (args.length !== 1) throw new MathError(`${quote(node.name)} isn’t a function`);
      const factor = gen({ t: 'var', name: node.name }, scope);
      const group = node.pow ? genPower(node.args[0], node.pow, scope) : args[0];
      return `(${factor}*${group})`;
    }
    case 'tuple':
      throw new MathError('A point can’t be used as a number');
    case 'big': {
      const id = `$${node.index}`;
      const inner: Scope = { ...scope, locals: new Map(scope.locals).set(node.index, id) };
      return `B.${node.kind}(${gen(node.lo, scope)},${gen(node.hi, scope)},(${id})=>${gen(node.body, inner)})`;
    }
    case 'piece': {
      // A chain of conditionals; NaN (no branch taken) is what cuts a graph.
      let code = node.otherwise ? gen(node.otherwise, scope) : 'NaN';
      for (const branch of [...node.branches].reverse()) {
        const operands = branch.when.operands.map((operand) => gen(operand, scope));
        const tests = branch.when.rels.map((rel, i) => `${operands[i]}${rel === '=' ? '===' : rel}${operands[i + 1]}`);
        code = `(${tests.join('&&')}?${branch.value ? gen(branch.value, scope) : '1'}:${code})`;
      }
      return code;
    }
    case 'int': {
      const id = `$${node.wrt}`;
      const inner: Scope = { ...scope, locals: new Map(scope.locals).set(node.wrt, id) };
      return `B.integrate(${gen(node.lo, scope)},${gen(node.hi, scope)},(${id})=>${gen(node.body, inner)})`;
    }
    case 'bind': {
      checkBinder(node.fn, node.args);
      const id = `$${node.wrt}`;
      const inner: Scope = { ...scope, locals: new Map(scope.locals).set(node.wrt, id) };
      if (node.fn === 'deriv' || node.fn === 'deriv2') {
        // Differentiate symbolically where there are rules for it, which is exact; the
        // numeric derivative is kept for whatever the rules don't reach.
        const isFunction = (name: string) => scope.defs.get(name)?.kind === 'fn';
        let derived = differentiate(node.body, node.wrt, isFunction);
        if (node.fn === 'deriv2') derived = differentiate(derived, node.wrt, isFunction);
        const symbolic = !JSON.stringify(derived).includes('"t":"deriv"');
        if (symbolic) return `((${id})=>${gen(derived, inner)})(${gen(node.args[0], scope)})`;
      }
      return `B.${node.fn}(${[`(${id})=>${gen(node.body, inner)}`, ...node.args.map((arg) => gen(arg, scope))].join(',')})`;
    }
    case 'deriv': {
      const id = `$${node.wrt}`;
      const inner: Scope = { ...scope, locals: new Map(scope.locals).set(node.wrt, id) };
      return `B.deriv((${id})=>${gen(node.body, inner)},${gen({ t: 'var', name: node.wrt }, scope)})`;
    }
  }
}

function checkCall(fn: string, args: Node[]) {
  // A shape, not a value: it is only understood as an expression of its own.
  if (fn === 'polygon') throw new MathError('A polygon can’t be used as a number');
  const [min, max] = ARITY[fn] ?? [1, 1];
  if (args.length < min || args.length > max) throw new MathError(`“${fn}” takes ${arityText(min, max)}`);
}

function checkBinder(fn: string, args: Node[]) {
  const [min, max] = BINDERS[fn];
  if (args.length < min || args.length > max) {
    throw new MathError(`“${fn}” takes an expression and ${arityText(min, max)}`);
  }
}

function arityText(min: number, max: number): string {
  const plural = (n: number) => `argument${n === 1 ? '' : 's'}`;
  if (min === max) return `${min} ${plural(min)}`;
  if (max === Infinity) return `at least ${min} ${plural(min)}`;
  return `${min} to ${max} arguments`;
}

function genPower(base: Node, exponent: Node, scope: Scope): string {
  // A literal fraction with an odd denominator has a real value for negative bases.
  if (exponent.t === 'bin' && exponent.op === '/' && exponent.a.t === 'num' && exponent.b.t === 'num') {
    const p = exponent.a.v;
    const q = exponent.b.v;
    if (Number.isInteger(p) && Number.isInteger(q) && q % 2 !== 0) {
      return `B.rpow(${gen(base, scope)},${p},${q})`;
    }
  }
  return `B.pow(${gen(base, scope)},${gen(exponent, scope)})`;
}

const COMPLEX_OPS = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' } as const;

// The same expression as `gen` makes, but computing with complex numbers: every value
// is a Complex and every operation a call into the complex library.
function genC(node: Node, scope: Scope): string {
  // `body` as a function of the variable it binds.
  const over = (name: string, body: Node) => {
    const id = `$${name}`;
    return `(${id})=>${genC(body, { ...scope, locals: new Map(scope.locals).set(name, id) })}`;
  };
  switch (node.t) {
    case 'num':
      return `C.of(${node.v})`;
    case 'var': {
      const local = scope.locals.get(node.name);
      if (local) return local;
      if (node.name in CONSTANTS) return `C.of(${CONSTANTS[node.name]})`;
      const def = scope.defs.get(node.name);
      if (!def && node.name === IMAGINARY) return 'C.I';
      if (!def) throw new MathError(`${quote(node.name)} isn’t defined`);
      if (def.kind === 'fn') throw new MathError(`${quote(node.name)} is a function and needs an argument`);
      return scope.complexVars?.has(node.name) ? `Z.${node.name}` : `C.of(S.${node.name})`;
    }
    case 'neg':
      return `C.neg(${genC(node.a, scope)})`;
    case 'bin': {
      if (node.op === '^') return genPowerC(node.a, node.b, scope);
      return `C.${COMPLEX_OPS[node.op]}(${genC(node.a, scope)},${genC(node.b, scope)})`;
    }
    case 'call': {
      checkCall(node.fn, node.args);
      return `C.call(${[JSON.stringify(node.fn), ...node.args.map((arg) => genC(arg, scope))].join(',')})`;
    }
    case 'app': {
      const def = scope.locals.has(node.name) ? undefined : scope.defs.get(node.name);
      const args = node.args.map((arg) => genC(arg, scope));
      if (def?.kind === 'fn') {
        if (args.length !== def.params.length) {
          const n = def.params.length;
          throw new MathError(`${quote(node.name)} takes ${n} argument${n === 1 ? '' : 's'}`);
        }
        const call = `G.${node.name}(${args.join(',')})`;
        return node.pow ? `C.pow(${call},${genC(node.pow, scope)})` : call;
      }
      if (args.length !== 1) throw new MathError(`${quote(node.name)} isn’t a function`);
      const factor = genC({ t: 'var', name: node.name }, scope);
      const group = node.pow ? genPowerC(node.args[0], node.pow, scope) : args[0];
      return `C.mul(${factor},${group})`;
    }
    case 'tuple':
      throw new MathError('A point can’t be used as a number');
    case 'big':
      return `C.${node.kind}(${genC(node.lo, scope)},${genC(node.hi, scope)},${over(node.index, node.body)})`;
    case 'piece': {
      // Only equality means anything between complex numbers; an order needs real ones.
      let code = node.otherwise ? genC(node.otherwise, scope) : 'C.of(NaN)';
      for (const branch of [...node.branches].reverse()) {
        const operands = branch.when.operands.map((operand) => genC(operand, scope));
        const tests = branch.when.rels.map((rel, i) =>
          rel === '=' ? `C.eq(${operands[i]},${operands[i + 1]})` : `C.real(${operands[i]})${rel}C.real(${operands[i + 1]})`,
        );
        code = `(${tests.join('&&')}?${branch.value ? genC(branch.value, scope) : 'C.of(1)'}:${code})`;
      }
      return code;
    }
    case 'int':
      return `C.integrate(${genC(node.lo, scope)},${genC(node.hi, scope)},${over(node.wrt, node.body)})`;
    case 'bind': {
      checkBinder(node.fn, node.args);
      if (node.fn === 'deriv' || node.fn === 'deriv2') {
        const isFunction = (name: string) => scope.defs.get(name)?.kind === 'fn';
        let derived = differentiate(node.body, node.wrt, isFunction);
        if (node.fn === 'deriv2') derived = differentiate(derived, node.wrt, isFunction);
        const symbolic = !JSON.stringify(derived).includes('"t":"deriv"');
        if (symbolic) return `(${over(node.wrt, derived)})(${genC(node.args[0], scope)})`;
      }
      const args = node.args.map((arg) => genC(arg, scope));
      return `C.bind(${[JSON.stringify(node.fn), over(node.wrt, node.body), ...args].join(',')})`;
    }
    case 'deriv':
      return `C.bind("deriv",${over(node.wrt, node.body)},${genC({ t: 'var', name: node.wrt }, scope)})`;
  }
}

function genPowerC(base: Node, exponent: Node, scope: Scope): string {
  if (exponent.t === 'bin' && exponent.op === '/' && exponent.a.t === 'num' && exponent.b.t === 'num') {
    const p = exponent.a.v;
    const q = exponent.b.v;
    if (Number.isInteger(p) && Number.isInteger(q) && q % 2 !== 0) {
      return `C.rpow(${genC(base, scope)},${p},${q})`;
    }
  }
  return `C.pow(${genC(base, scope)},${genC(exponent, scope)})`;
}

type Values = Record<string, number>;
type Functions = Record<string, (...args: number[]) => number>;

// Everything a compiled expression can refer to: variables and functions, each in a
// real and a complex table.
interface World {
  defs: Map<string, Def>;
  S: Values;
  F: Functions;
  Z: Record<string, Complex>;
  G: Record<string, (...args: Complex[]) => Complex>;
  complexVars: Set<string>;
}

function build(params: string[], body: Node, world: World) {
  const locals = new Map(params.map((p) => [p, `$${p}`]));
  const source = `return (${[...locals.values()].join(',')})=>${gen(body, { locals, defs: world.defs })}`;
  return new Function('B', 'S', 'F', source)(builtins, world.S, world.F) as (...args: number[]) => number;
}

function buildC(params: string[], body: Node, world: World) {
  const locals = new Map(params.map((p) => [p, `$${p}`]));
  const scope: Scope = { locals, defs: world.defs, complexVars: world.complexVars };
  const source = `return (${[...locals.values()].join(',')})=>${genC(body, scope)}`;
  return new Function('C', 'S', 'Z', 'G', source)(complex, world.S, world.Z, world.G) as (...args: Complex[]) => Complex;
}

// A complex-mode expression as a function of real numbers, for plotting: it has a value
// only where the result is real.
function buildReal(params: string[], body: Node, world: World) {
  const f = buildC(params, body, world);
  return (...args: number[]) => {
    try {
      return complex.real(f(...args.map((arg) => complex.of(arg))));
    } catch {
      return NaN;
    }
  };
}

const isFinite = (z: Complex) => Number.isFinite(z.re) && Number.isFinite(z.im);

// The value of a constant expression. One that has no real value (√−4, ln −1) is tried
// again with complex numbers.
function evaluate(body: Node, world: World, isComplex: boolean): Complex {
  if (!isComplex) {
    const value = build([], body, world)();
    if (!Number.isNaN(value)) return complex.of(value);
  }
  let z: Complex;
  try {
    z = tidy(buildC([], body, world)());
  } catch (err) {
    if (isComplex) throw err;
    return complex.of(NaN);
  }
  return isComplex || (isFinite(z) && z.im !== 0) ? z : complex.of(NaN);
}

const result = (z: Complex): Analysis => (z.im === 0 ? { value: z.re } : { value: z.re, imaginary: z.im });

const sub = (a: Node, b: Node): Node => ({ t: 'bin', op: '-', a, b });
// A plain number, which is what makes a definition a slider.
const isLiteral = (node: Node) => node.t === 'num' || (node.t === 'neg' && node.a.t === 'num');
const isVar = (node: Node, name: string) => node.t === 'var' && node.name === name;

export function analyze(sources: string[]): Analysis[] {
  const defs = new Map<string, Def>();

  const entries: Entry[] = sources.map((latex) => {
    const entry: Entry = { free: new Set(), locals: new Set(), missing: [] };
    if (latex.trim() === '') return entry;
    const parsed = parseCached(latex);
    if (parsed instanceof MathError) {
      entry.error = parsed;
      return entry;
    }
    entry.statement = parsed;
    const def = definitionOf(parsed);
    if (def && defs.has(def.name)) {
      entry.error = new MathError(`${quote(def.name)} is already defined above`);
      return entry;
    }
    if (def) {
      defs.set(def.name, def);
      entry.def = def;
    }
    return entry;
  });

  const entryOfDef = new Map<string, Entry>();
  for (const entry of entries) {
    const st = entry.statement;
    if (!st || entry.error) continue;
    if (entry.def) {
      entryOfDef.set(entry.def.name, entry);
      if (entry.def.kind === 'fn') entry.def.params.forEach((p) => entry.locals.add(p));
      collectFree(entry.def.body, entry.locals, entry.free);
      continue;
    }
    collectFree(st.lhs, NO_LOCALS, entry.free);
    if (st.rhs) collectFree(st.rhs, NO_LOCALS, entry.free);
    entry.locals.add('x').add('y');
    if (st.lhs.t === 'tuple' && !st.rel) entry.locals.add('t');
    if (st.rel === '=' && isVar(st.lhs, 'r') && !defs.has('r') && entry.free.has('theta')) {
      entry.locals.add('r').add('theta');
    }
  }

  // Check every definition's dependencies depth-first; the post-order is a valid
  // evaluation order for variables.
  const state = new Map<Entry, 'visiting' | 'done'>();
  const order: Def[] = [];
  const visit = (entry: Entry): void => {
    if (state.get(entry) === 'done') return;
    state.set(entry, 'visiting');
    for (const name of entry.free) {
      if (entry.locals.has(name)) continue;
      const dep = entryOfDef.get(name);
      if (!dep && name === IMAGINARY) {
        entry.complex = true;
        continue;
      }
      if (!dep) {
        entry.missing.push(name);
        continue;
      }
      if (state.get(dep) === 'visiting') {
        entry.error ??= new MathError(`${quote(name)} is defined in terms of itself`);
        continue;
      }
      visit(dep);
      if (dep.error) entry.error ??= new MathError(`Depends on ${quote(name)}, which has a problem`);
    }
    if (entry.missing.length && !entry.error) {
      const names = entry.missing.map(quote).join(', ');
      entry.error = new MathError(`${names} ${entry.missing.length > 1 ? 'aren’t' : 'isn’t'} defined`);
    }
    state.set(entry, 'done');
    if (entry.def && !entry.error) order.push(entry.def);
  };
  for (const entry of entries) if (entry.statement && !entry.error) visit(entry);

  // Only healthy definitions are visible to the code generator.
  const live = new Map(order.map((def) => [def.name, def]));
  const world: World = { defs: live, S: {}, F: {}, Z: {}, G: {}, complexVars: new Set() };
  // Complex values spread to whatever is defined in terms of them. Definitions are
  // settled in dependency order, so this is known by the time it is asked.
  const refersToComplex = (entry: Entry) =>
    [...entry.free].some((name) => !entry.locals.has(name) && entryOfDef.get(name)?.complex);

  for (const def of order) {
    const entry = entryOfDef.get(def.name)!;
    entry.complex ||= refersToComplex(entry);
    try {
      if (def.kind === 'fn') {
        if (!entry.complex) world.F[def.name] = build(def.params, def.body, world);
        world.G[def.name] = buildC(def.params, def.body, world);
      } else {
        const z = evaluate(def.body, world, entry.complex);
        entry.complex ||= z.im !== 0;
        if (entry.complex) {
          world.Z[def.name] = z;
          world.complexVars.add(def.name);
        } else world.S[def.name] = z.re;
      }
    } catch (err) {
      entry.error = err instanceof MathError ? err : new MathError('Couldn’t evaluate this');
      live.delete(def.name);
    }
  }

  return entries.map((entry) => {
    const st = entry.statement;
    if (!st && !entry.error) return { empty: true };
    if (entry.error || !st) {
      return {
        error: entry.error!.message,
        softError: entry.error!.soft,
        missing: entry.missing.filter((name) => name !== 'x' && name !== 'y'),
      };
    }
    try {
      entry.complex ||= refersToComplex(entry);
      return describe(entry, st, world);
    } catch (err) {
      if (err instanceof MathError) return { error: err.message, softError: err.soft };
      return { error: 'Couldn’t evaluate this' };
    }
  });
}

function describe(entry: Entry, st: Statement, world: World): Analysis {
  const isComplex = !!entry.complex;
  const make = (params: string[], body: Node) => (isComplex ? buildReal : build)(params, body, world);
  const isFunction = (name: string) => world.defs.get(name)?.kind === 'fn';
  const curve = (kind: 'fx' | 'fy', body: Node): Plot => {
    const v = kind === 'fx' ? 'x' : 'y';
    if (isComplex) {
      // The rules for differentiating assume real numbers, so these are measured instead.
      const f = make([v], body);
      return { kind, f, d1: (u) => builtins.deriv(f, u), d2: (u) => builtins.deriv2(f, u) };
    }
    const d1 = differentiate(body, v, isFunction);
    const d2 = differentiate(d1, v, isFunction);
    return { kind, f: make([v], body), d1: make([v], d1), d2: make([v], d2) };
  };
  const { def, free } = entry;
  const usesXY = free.has('x') || free.has('y');

  if (def?.kind === 'var') {
    const literal = isLiteral(def.body);
    if (isComplex) return result(world.Z[def.name]);
    return literal ? { slider: { name: def.name, value: world.S[def.name] } } : { value: world.S[def.name] };
  }
  if (def?.kind === 'fn') {
    if (def.params.length !== 1) return {};
    if (def.params[0] === 'x') return { plot: curve('fx', def.body) };
    if (def.params[0] === 'y') return { plot: curve('fy', def.body) };
    return {};
  }

  const { lhs, rel, rhs } = st;

  if (!rel || !rhs) {
    if (lhs.t === 'tuple') {
      if (lhs.items.length !== 2) throw new MathError('A point needs two coordinates');
      const [px, py] = lhs.items;
      if (usesXY) throw new MathError('A point can’t depend on x or y');
      if (free.has('t')) return { plot: { kind: 'parametric', x: make(['t'], px), y: make(['t'], py) } };
      const handle = (node: Node): PointHandle | undefined => {
        const span = spanOf(node);
        if (span && freeOf(node).size === 0) return { kind: 'literal', span };
        const def = node.t === 'var' ? world.defs.get(node.name) : undefined;
        if (def?.kind === 'var' && isLiteral(def.body)) return { kind: 'slider', name: def.name };
        return undefined;
      };
      const drag: [PointHandle | undefined, PointHandle | undefined] = [handle(px), handle(py)];
      const point = { kind: 'point' as const, x: make([], px)(), y: make([], py)() };
      return { plot: drag[0] || drag[1] ? { ...point, drag } : point };
    }
    if (lhs.t === 'call' && lhs.fn === 'polygon') {
      if (lhs.args.length < 3) throw new MathError('A polygon needs at least three points', lhs.args.length < 2);
      if (usesXY) throw new MathError('A polygon can’t depend on x or y');
      const vertices = lhs.args.map((arg): [number, number] => {
        if (arg.t !== 'tuple' || arg.items.length !== 2) throw new MathError('A polygon is made of points, like (1, 2)');
        return [make([], arg.items[0])(), make([], arg.items[1])()];
      });
      return { plot: { kind: 'polygon', vertices } };
    }
    if (free.has('y')) throw new MathError('Write this as an equation, like y = …');
    if (free.has('x')) return { plot: curve('fx', lhs) };
    return result(evaluate(lhs, world, isComplex));
  }

  if (rel === '=') {
    if (entry.locals.has('theta')) return { plot: { kind: 'polar', f: make(['theta'], rhs) } };
    if (isVar(lhs, 'y') && !freeOf(rhs).has('y')) return { plot: curve('fx', rhs) };
    if (isVar(rhs, 'y') && !freeOf(lhs).has('y')) return { plot: curve('fx', lhs) };
    if (isVar(lhs, 'x') && !freeOf(rhs).has('x')) return { plot: curve('fy', rhs) };
    if (isVar(rhs, 'x') && !freeOf(lhs).has('x')) return { plot: curve('fy', lhs) };
  }
  if (!usesXY) throw new MathError('Nothing to plot — use x or y');

  const greater = rel === '>' || rel === '>=';
  const f = make(['x', 'y'], greater ? sub(rhs, lhs) : sub(lhs, rhs));
  return { plot: { kind: 'implicit', f, region: rel !== '=', strict: rel === '<' || rel === '>' } };
}
