// Finds the trigonometric pieces of an expression and offers equivalent forms for
// each one (sin²x → 1 − cos²x, and so on). Every piece keeps its position in the
// source LaTeX, so one occurrence can be rewritten without touching the rest.

import { MathError, parse, spanOf, type Node } from './parser';

export interface TrigTerm {
  // Range of this piece in the source LaTeX, and that text.
  start: number;
  end: number;
  source: string;
  // Equivalent forms, as LaTeX ready to put in its place.
  options: string[];
}

// How a replacement binds, which decides whether it needs brackets where it lands.
type Shape = 'atom' | 'product' | 'sum';
interface Option {
  latex: string;
  shape: Shape;
}

// Where a piece sits inside its parent.
type Context = 'top' | 'add' | 'subtract' | 'multiply' | 'power' | 'argument';

const CIRCULAR = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);
const TRIG = new Set([...CIRCULAR, 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh']);

const atom = (latex: string): Option => ({ latex, shape: 'atom' });
const product = (latex: string): Option => ({ latex, shape: 'product' });
const sum = (latex: string): Option => ({ latex, shape: 'sum' });
const frac = (top: string, bottom: string) => `\\frac{${top}}{${bottom}}`;
const fn = (name: string, arg: string, power?: string) => `\\${name}${power ? `^{${power}}` : ''}\\left(${arg}\\right)`;
const sq = (name: string, arg: string) => fn(name, arg, '2');

const isNum = (node: Node, v: number) => node.t === 'num' && node.v === v;
const isBin = (node: Node, op: string): node is Extract<Node, { t: 'bin' }> => node.t === 'bin' && node.op === op;
const isHalfPi = (node: Node) => isBin(node, '/') && node.a.t === 'var' && node.a.name === 'pi' && isNum(node.b, 2);
const same = (a: Node, b: Node) => JSON.stringify(a) === JSON.stringify(b);

const RECIPROCAL: Record<string, string> = { sin: 'csc', cos: 'sec', tan: 'cot', csc: 'sin', sec: 'cos', cot: 'tan' };

export function trigTerms(latex: string): TrigTerm[] {
  let statement;
  try {
    statement = parse(latex);
  } catch (err) {
    if (err instanceof MathError) return [];
    throw err;
  }

  const terms: TrigTerm[] = [];
  const text = (node: Node): string | undefined => {
    const span = spanOf(node);
    return span && latex.slice(span[0], span[1]);
  };
  const simple = (node: Node) => node.t === 'var' || (node.t === 'num' && node.v >= 0);

  // An argument written with an even coefficient: 2x, 4x, 6(x + 1) …
  const isEven = (arg: Node): arg is Extract<Node, { t: 'bin' }> & { a: { t: 'num'; v: number } } =>
    isBin(arg, '*') && arg.a.t === 'num' && Number.isInteger(arg.a.v) && arg.a.v > 0 && arg.a.v % 2 === 0;

  // Twice and half an argument, as LaTeX to go inside a function's brackets. Where the
  // argument is already written as a multiple or a half, that is folded in (2·2x is 4x).
  const doubled = (arg: Node): string => {
    const u = text(arg) ?? '';
    if (arg.t === 'var') return `2${u}`;
    if (arg.t === 'num') return String(2 * arg.v);
    if (isBin(arg, '/') && isNum(arg.b, 2)) return text(arg.a) ?? `2\\left(${u}\\right)`;
    if (isBin(arg, '*') && arg.a.t === 'num' && Number.isInteger(arg.a.v) && arg.a.v > 0) {
      const [whole, coefficient] = [spanOf(arg), spanOf(arg.a)];
      if (whole && coefficient && whole[0] === coefficient[0]) return `${2 * arg.a.v}${latex.slice(coefficient[1], whole[1])}`;
    }
    return `2\\left(${u}\\right)`;
  };
  const halved = (arg: Node): string => {
    const u = text(arg) ?? '';
    if (isBin(arg, '*') && isNum(arg.a, 2)) return text(arg.b) ?? frac(u, '2');
    if (isEven(arg)) {
      const [whole, coefficient] = [spanOf(arg), spanOf(arg.a)];
      if (whole && coefficient && whole[0] === coefficient[0]) return `${arg.a.v / 2}${latex.slice(coefficient[1], whole[1])}`;
    }
    if (isBin(arg, '/') && arg.b.t === 'num' && Number.isInteger(arg.b.v) && arg.b.v > 0) {
      const top = text(arg.a);
      if (top !== undefined) return frac(top, String(2 * arg.b.v));
    }
    return frac(u, '2');
  };

  // A trig function of one argument, and its square.
  const plain = (node: Node) =>
    node.t === 'call' && TRIG.has(node.fn) && node.args.length === 1 ? { fn: node.fn, arg: node.args[0] } : undefined;
  const squared = (node: Node) => (isBin(node, '^') && isNum(node.b, 2) ? plain(node.a) : undefined);
  // 2·node.
  const twice = (node: Node) => (isBin(node, '*') && isNum(node.a, 2) ? node.b : undefined);

  // Forms of fn(arg).
  const forms = (name: string, arg: Node): Option[] => {
    const u = text(arg);
    if (u === undefined) return [];
    // The argument as it must appear under a power, and after a minus sign.
    const g = simple(arg) ? u : `\\left(${u}\\right)`;
    const m = isBin(arg, '+') || isBin(arg, '-') || arg.t === 'neg' ? g : u;
    const h = halved(arg);
    // A function of π/2 − w is the cofunction of w; otherwise offer it the other way round.
    const inner = isBin(arg, '-') && isHalfPi(arg.a) ? text(arg.b) : undefined;
    // The double-angle forms come first when the argument is written as 2v, and are
    // left out for π/2 − w, where halving the angle only makes a mess.
    const isDouble = isEven(arg);
    const order = (double: Option[], rest: Option[]) => (inner !== undefined ? rest : isDouble ? [...double, ...rest] : [...rest, ...double]);
    const co = (other: string) => atom(fn(other, inner ?? `\\frac{\\pi}{2}-${m}`));
    switch (name) {
      case 'sin':
        return order(
          [product(`2${fn('sin', h)}${fn('cos', h)}`)],
          [co('cos'), atom(frac('1', fn('csc', u))), product(`${fn('tan', u)}${fn('cos', u)}`)],
        );
      case 'cos':
        return order(
          [sum(`${sq('cos', h)}-${sq('sin', h)}`), sum(`2${sq('cos', h)}-1`), sum(`1-2${sq('sin', h)}`)],
          [co('sin'), atom(frac('1', fn('sec', u)))],
        );
      case 'tan':
        return order(isDouble ? [atom(frac(`2${fn('tan', h)}`, `1-${sq('tan', h)}`))] : [], [
          atom(frac(fn('sin', u), fn('cos', u))),
          atom(frac('1', fn('cot', u))),
          co('cot'),
        ]);
      case 'sec':
        return [atom(frac('1', fn('cos', u))), co('csc')];
      case 'csc':
        return [atom(frac('1', fn('sin', u))), co('sec')];
      case 'cot':
        return [atom(frac(fn('cos', u), fn('sin', u))), atom(frac('1', fn('tan', u))), co('tan')];
      case 'arcsin':
        return [sum(`\\frac{\\pi}{2}-${fn('arccos', u)}`), atom(fn('arctan', frac(u, `\\sqrt{1-${g}^{2}}`)))];
      case 'arccos':
        return [sum(`\\frac{\\pi}{2}-${fn('arcsin', u)}`)];
      case 'arctan':
        return [atom(fn('arcsin', frac(u, `\\sqrt{1+${g}^{2}}`)))];
      case 'sinh':
        return [atom(frac(`e^{${u}}-e^{-${m}}`, '2')), product(`${fn('tanh', u)}${fn('cosh', u)}`)];
      case 'cosh':
        return [atom(frac(`e^{${u}}+e^{-${m}}`, '2'))];
      case 'tanh':
        return [atom(frac(fn('sinh', u), fn('cosh', u))), atom(frac(`e^{${doubled(arg)}}-1`, `e^{${doubled(arg)}}+1`))];
    }
    return [];
  };

  // Forms of fn²(arg).
  const squareForms = (name: string, arg: Node): Option[] => {
    const u = text(arg);
    if (u === undefined) return [];
    const double = fn('cos', doubled(arg));
    switch (name) {
      case 'sin':
        return [sum(`1-${sq('cos', u)}`), atom(frac(`1-${double}`, '2')), atom(frac('1', sq('csc', u)))];
      case 'cos':
        return [sum(`1-${sq('sin', u)}`), atom(frac(`1+${double}`, '2')), atom(frac('1', sq('sec', u)))];
      case 'tan':
        return [sum(`${sq('sec', u)}-1`), atom(frac(sq('sin', u), sq('cos', u))), atom(frac(`1-${double}`, `1+${double}`))];
      case 'sec':
        return [sum(`1+${sq('tan', u)}`), atom(frac('1', sq('cos', u)))];
      case 'csc':
        return [sum(`1+${sq('cot', u)}`), atom(frac('1', sq('sin', u)))];
      case 'cot':
        return [sum(`${sq('csc', u)}-1`), atom(frac(sq('cos', u), sq('sin', u)))];
    }
    return [];
  };

  // Combinations that collapse into a single function: 1 − cos²x, sin x / cos x, 2 sin x cos x …
  // These undo every form offered above, so a conversion can always be taken back.
  const combined = (node: Node): Option[] => {
    if (node.t !== 'bin' || node.op === '^') return [];
    const { a, b } = node;
    const [pa, pb, sa, sb] = [plain(a), plain(b), squared(a), squared(b)];
    const u = (arg: Node) => text(arg) ?? '';
    type Call = ReturnType<typeof plain>;
    // The shared argument when x and y are `first` and `second` of the same thing.
    const pair = (x: Call, y: Call, first: string, second: string) =>
      x && y && x.fn === first && y.fn === second && same(x.arg, y.arg) ? x.arg : undefined;
    const out: Option[] = [];
    let arg: Node | undefined;
    if (node.op === '+') {
      if (pair(sa, sb, 'sin', 'cos') || pair(sa, sb, 'cos', 'sin')) out.push(atom('1'));
      const other = isNum(a, 1) ? sb : isNum(b, 1) ? sa : undefined;
      if (other?.fn === 'tan') out.push(atom(sq('sec', u(other.arg))));
      if (other?.fn === 'cot') out.push(atom(sq('csc', u(other.arg))));
    } else if (node.op === '-') {
      if (isNum(a, 1) && sb?.fn === 'cos') out.push(atom(sq('sin', u(sb.arg))));
      if (isNum(a, 1) && sb?.fn === 'sin') out.push(atom(sq('cos', u(sb.arg))));
      if (isNum(b, 1) && sa?.fn === 'sec') out.push(atom(sq('tan', u(sa.arg))));
      if (isNum(b, 1) && sa?.fn === 'csc') out.push(atom(sq('cot', u(sa.arg))));
      if ((arg = pair(sa, sb, 'cos', 'sin'))) out.push(atom(fn('cos', doubled(arg))));
      // 2cos²v − 1 and 1 − 2sin²v.
      const [ta, tb] = [twice(a), twice(b)];
      const [da, db] = [ta && squared(ta), tb && squared(tb)];
      if (isNum(b, 1) && da?.fn === 'cos') out.push(atom(fn('cos', doubled(da.arg))));
      if (isNum(a, 1) && db?.fn === 'sin') out.push(atom(fn('cos', doubled(db.arg))));
    } else if (node.op === '/') {
      if ((arg = pair(pa, pb, 'sin', 'cos'))) out.push(atom(fn('tan', u(arg))));
      if ((arg = pair(pa, pb, 'cos', 'sin'))) out.push(atom(fn('cot', u(arg))));
      if ((arg = pair(pa, pb, 'sinh', 'cosh'))) out.push(atom(fn('tanh', u(arg))));
      if ((arg = pair(sa, sb, 'sin', 'cos'))) out.push(atom(sq('tan', u(arg))));
      if ((arg = pair(sa, sb, 'cos', 'sin'))) out.push(atom(sq('cot', u(arg))));
      if (isNum(a, 1) && pb && pb.fn in RECIPROCAL) out.push(atom(fn(RECIPROCAL[pb.fn], u(pb.arg))));
      if (isNum(a, 1) && sb && sb.fn in RECIPROCAL) out.push(atom(sq(RECIPROCAL[sb.fn], u(sb.arg))));
      // (1 ∓ cos w) / 2 is sin² or cos² of half of w.
      if (isNum(b, 2) && (isBin(a, '+') || isBin(a, '-')) && isNum(a.a, 1)) {
        const cos = plain(a.b);
        if (cos?.fn === 'cos') out.push(atom(sq(a.op === '-' ? 'sin' : 'cos', halved(cos.arg))));
      }
      // 2tan v / (1 − tan²v).
      const top = twice(a);
      const tan = top && plain(top);
      if (tan?.fn === 'tan' && isBin(b, '-') && isNum(b.a, 1) && pair(tan, squared(b.b), 'tan', 'tan')) {
        out.push(atom(fn('tan', doubled(tan.arg))));
      }
    } else if (node.op === '*') {
      // 2·sin·cos in either order, or the bare product sin·cos.
      const half = twice(a);
      const first = half ? plain(half) : pa;
      if ((arg = pair(first, pb, 'sin', 'cos') ?? pair(first, pb, 'cos', 'sin'))) {
        const double = fn('sin', doubled(arg));
        out.push(atom(half ? double : frac(double, '2')));
      }
      if ((arg = pair(pa, pb, 'tan', 'cos') ?? pair(pa, pb, 'cos', 'tan'))) out.push(atom(fn('sin', u(arg))));
      if ((arg = pair(pa, pb, 'cot', 'sin') ?? pair(pa, pb, 'sin', 'cot'))) out.push(atom(fn('cos', u(arg))));
      if ((arg = pair(pa, pb, 'tanh', 'cosh') ?? pair(pa, pb, 'cosh', 'tanh'))) out.push(atom(fn('sinh', u(arg))));
    }
    return out;
  };

  // Whether whatever is written straight after `node` gets swallowed into it. A function
  // written without brackets takes the following factors as its argument (\sin x y is
  // sin(xy)), though it stops at the next named function; a sum or derivative takes everything.
  const swallows = (node: Node): 'nothing' | 'factors' | 'everything' => {
    if (node.t === 'bin' && node.op === '*') return swallows(node.b);
    if (node.t === 'neg') return swallows(node.a);
    if (node.t === 'big' || node.t === 'deriv' || (node.t === 'bind' && node.wrt !== '_' && node.fn !== 'solve' && !node.fn.startsWith('fm'))) return 'everything';
    const isCall = node.t === 'call' || (node.t === 'bin' && node.op === '^' && node.a.t === 'call');
    const source = text(node) ?? '';
    if (!isCall || !/^\\(?!left|sqrt|frac|dfrac|tfrac|lfloor|lceil)[a-zA-Z]/.test(source)) return 'nothing';
    const bracketed = /^\\[a-zA-Z]+(\{[a-zA-Z]+\})?\s*([\^_]\s*(\{[^{}]*\}|\\?[a-zA-Z0-9]+)\s*)*(\\left\s*)?\(/.test(source);
    return bracketed ? 'nothing' : 'factors';
  };
  const startsWithFunction = (option: string) => /^\\(arc)?(sin|cos|tan|sec|csc|cot)h?(?![a-zA-Z])/.test(option);

  const add = (
    span: [number, number] | undefined,
    options: Option[],
    context: Context,
    previous: ReturnType<typeof swallows> = 'nothing',
  ) => {
    if (!span || options.length === 0) return;
    const [start, end] = span;
    const before = latex.slice(0, start);
    // An explicit multiplication sign keeps the replacement out of the previous factor,
    // and keeps a leading digit from running into whatever is written before it.
    const multiplied = /(\\cdot|\\times|\*)\s*$/.test(before);
    const afterFactor = /([0-9.a-zA-Z})\]]|\\right\s*\|)\s*$/.test(before);
    // Already wrapped in brackets or braces in the source: nothing more is needed.
    const wrapped = /[({[]\s*$/.test(before) && /^\s*(\\right\s*[)\]]|[)}\]])/.test(latex.slice(end));
    const separate = (option: string) => {
      if (multiplied || wrapped) return option;
      const absorbed = previous === 'everything' || (previous === 'factors' && !startsWithFunction(option));
      const digits = afterFactor && /^[0-9]/.test(option);
      return absorbed || digits ? `\\cdot ${option}` : option;
    };
    const bracket = (shape: Shape) => {
      if (shape === 'atom' || wrapped) return false;
      if (shape === 'sum') return context !== 'top' && context !== 'add';
      return context === 'power' || context === 'argument';
    };
    const source = latex.slice(start, end);
    const built = options.map((o) => separate(bracket(o.shape) ? `\\left(${o.latex}\\right)` : o.latex));
    // Pieces found twice share one entry, and no form is listed twice or as itself.
    const existing = terms.find((term) => term.start === start && term.end === end);
    const term = existing ?? { start, end, source, options: [] };
    for (const option of built) if (option !== source && !term.options.includes(option)) term.options.push(option);
    if (!existing && term.options.length > 0) terms.push(term);
  };

  // The last two terms of a longer sum or product (the sin²x + cos²x in 3 + sin²x + cos²x)
  // can collapse on their own, as long as no bracket stands between them.
  const tail = (node: Extract<Node, { t: 'bin' }>) => {
    const left = node.a;
    if (left.t !== 'bin') return;
    const sums = (op: string) => op === '+' || op === '-';
    const [first, second] = [spanOf(left.b), spanOf(node.b)];
    if (!first || !second) return;
    const between = latex.slice(first[1], second[0]);
    const span: [number, number] = [first[0], second[1]];
    if (sums(node.op) && sums(left.op) && /^\s*[+-]\s*$/.test(between)) {
      if (left.op === '+') return add(span, combined({ t: 'bin', op: node.op as '+' | '-', a: left.b, b: node.b }), 'add');
      // After a minus sign the pair is negated as a whole: a − p + q is a − (p − q).
      // The piece then takes the sign with it, so what is shown reads as an identity.
      const sign = /-\s*$/.exec(latex.slice(0, first[0]));
      if (!sign) return;
      const options = combined({ t: 'bin', op: node.op === '+' ? '-' : '+', a: left.b, b: node.b });
      add([sign.index, second[1]], options.map((o) => atom(`-${o.latex}`)), 'add');
    } else if (node.op === '*' && left.op === '*' && /^\s*(\\cdot|\\times|\*)?\s*$/.test(between)) {
      // 2·sin·cos is already offered whole.
      if (combined(node).length > 0) return;
      add(span, combined({ t: 'bin', op: '*', a: left.b, b: node.b }), 'multiply', swallows(left.a));
    }
  };

  const walk = (node: Node, context: Context, previous: ReturnType<typeof swallows> = 'nothing'): void => {
    add(spanOf(node), combined(node), context, previous);
    switch (node.t) {
      case 'num':
      case 'var':
        return;
      case 'neg':
        return walk(node.a, 'multiply');
      case 'bin': {
        if (node.op === '^' && node.a.t === 'call' && TRIG.has(node.a.fn) && node.a.args.length === 1) {
          // A power of a trig function is one piece: its own identities when squared,
          // otherwise the base's forms raised to the same power.
          const base = node.a;
          const exponent = text(node.b);
          if (isNum(node.b, 2) && CIRCULAR.has(base.fn)) add(spanOf(node), squareForms(base.fn, base.args[0]), context, previous);
          else if (exponent !== undefined) {
            const raised = forms(base.fn, base.args[0]).map((o) => atom(`\\left(${o.latex}\\right)^{${exponent}}`));
            add(spanOf(node), raised, context, previous);
          }
          walk(base.args[0], 'argument');
          return walk(node.b, 'multiply');
        }
        const under = node.op === '/' && isNum(node.a, 1) ? (plain(node.b) ?? squared(node.b)) : undefined;
        if (under && under.fn in RECIPROCAL) {
          // 1 / csc x is sin x written another way, so it is one piece with everything
          // sin x converts to, rather than a csc x to convert underneath the 1.
          const [name, u] = [RECIPROCAL[under.fn], text(under.arg) ?? ''];
          const isSquare = !plain(node.b);
          const self = frac('1', isSquare ? sq(under.fn, u) : fn(under.fn, u));
          const others = (isSquare ? squareForms : forms)(name, under.arg).filter((o) => o.latex !== self);
          add(spanOf(node), others, context, previous);
          return walk(under.arg, 'argument');
        }
        tail(node);
        if (node.op === '+') {
          walk(node.a, 'add');
          return walk(node.b, 'add');
        }
        if (node.op === '-') {
          walk(node.a, 'add');
          return walk(node.b, 'subtract');
        }
        if (node.op === '^') {
          walk(node.a, 'power');
          return walk(node.b, 'multiply');
        }
        walk(node.a, 'multiply');
        if (node.op === '/') return walk(node.b, 'power');
        return walk(node.b, 'multiply', swallows(node.a));
      }
      case 'call':
        if (TRIG.has(node.fn) && node.args.length === 1) add(spanOf(node), forms(node.fn, node.args[0]), context, previous);
        return node.args.forEach((arg) => walk(arg, 'argument'));
      case 'app':
        node.args.forEach((arg) => walk(arg, 'argument'));
        if (node.pow) walk(node.pow, 'multiply');
        return;
      case 'tuple':
        return node.items.forEach((item) => walk(item, 'top'));
      case 'piece':
        for (const branch of node.branches) {
          branch.when.operands.forEach((operand) => walk(operand, 'top'));
          if (branch.value) walk(branch.value, 'top');
        }
        if (node.otherwise) walk(node.otherwise, 'top');
        return;
      case 'big':
      case 'int':
        walk(node.lo, 'multiply');
        walk(node.hi, 'multiply');
        return walk(node.body, 'multiply');
      case 'deriv':
        return walk(node.body, 'multiply');
      case 'bind':
        node.args.forEach((arg) => walk(arg, 'argument'));
        return walk(node.body, 'multiply');
    }
  };

  walk(statement.lhs, 'top');
  if (statement.rhs) walk(statement.rhs, 'top');
  // Left to right; where two pieces start together, the larger one first.
  return terms.sort((p, q) => p.start - q.start || q.end - p.end);
}

// The source with one piece replaced by one of its forms.
export function applyTrigOption(latex: string, term: TrigTerm, option: string): string {
  const before = latex.slice(0, term.start);
  // Keep a command such as \cdot from running into a replacement that starts with a letter.
  const gap = /\\[a-zA-Z]+$/.test(before) && /^[a-zA-Z]/.test(option) ? ' ' : '';
  return before + gap + option + latex.slice(term.end);
}
