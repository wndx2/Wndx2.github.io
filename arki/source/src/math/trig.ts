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
const same = (a: Node, b: Node) => JSON.stringify(a) === JSON.stringify(b);

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

  // A circular function of one argument, and its square.
  const plain = (node: Node) =>
    node.t === 'call' && CIRCULAR.has(node.fn) && node.args.length === 1 ? { fn: node.fn, arg: node.args[0] } : undefined;
  const squared = (node: Node) => (node.t === 'bin' && node.op === '^' && isNum(node.b, 2) ? plain(node.a) : undefined);

  // Forms of fn(arg).
  const forms = (name: string, arg: Node): Option[] => {
    const u = text(arg);
    if (u === undefined) return [];
    // The argument as it must appear after a minus sign, under a power, or doubled.
    const g = simple(arg) ? u : `\\left(${u}\\right)`;
    const half = frac(u, '2');
    const complement = `\\frac{\\pi}{2}-${g}`;
    // If the argument is 2v, the double-angle identities apply to v.
    const halved = arg.t === 'bin' && arg.op === '*' && isNum(arg.a, 2) ? text(arg.b) : undefined;
    const v = halved ?? '';
    switch (name) {
      case 'sin':
        return [
          ...(halved ? [product(`2${fn('sin', v)}${fn('cos', v)}`)] : []),
          atom(frac('1', fn('csc', u))),
          atom(fn('cos', complement)),
          product(`${fn('tan', u)}${fn('cos', u)}`),
          product(`2${fn('sin', half)}${fn('cos', half)}`),
        ];
      case 'cos':
        return [
          ...(halved ? [sum(`${sq('cos', v)}-${sq('sin', v)}`), sum(`2${sq('cos', v)}-1`), sum(`1-2${sq('sin', v)}`)] : []),
          atom(frac('1', fn('sec', u))),
          atom(fn('sin', complement)),
          sum(`2${sq('cos', half)}-1`),
          sum(`1-2${sq('sin', half)}`),
        ];
      case 'tan':
        return [
          ...(halved ? [atom(frac(`2${fn('tan', v)}`, `1-${sq('tan', v)}`))] : []),
          atom(frac(fn('sin', u), fn('cos', u))),
          atom(frac('1', fn('cot', u))),
          atom(fn('cot', complement)),
        ];
      case 'sec':
        return [atom(frac('1', fn('cos', u))), atom(fn('csc', complement))];
      case 'csc':
        return [atom(frac('1', fn('sin', u))), atom(fn('sec', complement))];
      case 'cot':
        return [atom(frac(fn('cos', u), fn('sin', u))), atom(frac('1', fn('tan', u))), atom(fn('tan', complement))];
      case 'arcsin':
        return [sum(`\\frac{\\pi}{2}-${fn('arccos', u)}`), atom(fn('arctan', frac(u, `\\sqrt{1-${g}^{2}}`)))];
      case 'arccos':
        return [sum(`\\frac{\\pi}{2}-${fn('arcsin', u)}`)];
      case 'arctan':
        return [atom(fn('arcsin', frac(u, `\\sqrt{1+${g}^{2}}`)))];
      case 'sinh':
        return [atom(frac(`e^{${u}}-e^{-${g}}`, '2')), product(`${fn('tanh', u)}${fn('cosh', u)}`)];
      case 'cosh':
        return [atom(frac(`e^{${u}}+e^{-${g}}`, '2'))];
      case 'tanh':
        return [atom(frac(fn('sinh', u), fn('cosh', u))), atom(frac(`e^{2${g}}-1`, `e^{2${g}}+1`))];
    }
    return [];
  };

  // Forms of fn²(arg).
  const squareForms = (name: string, arg: Node): Option[] => {
    const u = text(arg);
    if (u === undefined) return [];
    const double = fn('cos', simple(arg) ? `2${u}` : `2\\left(${u}\\right)`);
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
  const combined = (node: Node): Option[] => {
    if (node.t !== 'bin') return [];
    const { a, b } = node;
    const [pa, pb, sa, sb] = [plain(a), plain(b), squared(a), squared(b)];
    const u = (arg: Node) => text(arg) ?? '';
    const pair = (first: string, second: string) => {
      const [x, y] = node.op === '/' ? [pa, pb] : [sa, sb];
      return x && y && x.fn === first && y.fn === second && same(x.arg, y.arg) ? x.arg : undefined;
    };
    const out: Option[] = [];
    let arg: Node | undefined;
    if (node.op === '+') {
      if (pair('sin', 'cos') || pair('cos', 'sin')) out.push(atom('1'));
      const other = isNum(a, 1) ? sb : isNum(b, 1) ? sa : undefined;
      if (other?.fn === 'tan') out.push(atom(sq('sec', u(other.arg))));
      if (other?.fn === 'cot') out.push(atom(sq('csc', u(other.arg))));
    } else if (node.op === '-') {
      if (isNum(a, 1) && sb?.fn === 'cos') out.push(atom(sq('sin', u(sb.arg))));
      if (isNum(a, 1) && sb?.fn === 'sin') out.push(atom(sq('cos', u(sb.arg))));
      if (isNum(b, 1) && sa?.fn === 'sec') out.push(atom(sq('tan', u(sa.arg))));
      if (isNum(b, 1) && sa?.fn === 'csc') out.push(atom(sq('cot', u(sa.arg))));
      if ((arg = pair('cos', 'sin'))) out.push(atom(fn('cos', simple(arg) ? `2${u(arg)}` : `2\\left(${u(arg)}\\right)`)));
    } else if (node.op === '/') {
      if ((arg = pair('sin', 'cos'))) out.push(atom(fn('tan', u(arg))));
      if ((arg = pair('cos', 'sin'))) out.push(atom(fn('cot', u(arg))));
      const reciprocal: Record<string, string> = { sin: 'csc', cos: 'sec', tan: 'cot', csc: 'sin', sec: 'cos', cot: 'tan' };
      if (isNum(a, 1) && pb) out.push(atom(fn(reciprocal[pb.fn], u(pb.arg))));
      if (isNum(a, 1) && sb) out.push(atom(sq(reciprocal[sb.fn], u(sb.arg))));
    } else if (node.op === '*') {
      // 2·sin·cos in either order, or the bare product sin·cos.
      const inner = a.t === 'bin' && a.op === '*' && isNum(a.a, 2) ? plain(a.b) : undefined;
      const first = inner ?? pa;
      const matches =
        first && pb && same(first.arg, pb.arg) && ((first.fn === 'sin' && pb.fn === 'cos') || (first.fn === 'cos' && pb.fn === 'sin'));
      if (matches) {
        const double = fn('sin', simple(pb.arg) ? `2${u(pb.arg)}` : `2\\left(${u(pb.arg)}\\right)`);
        out.push(atom(inner ? double : frac(double, '2')));
      }
    }
    return out;
  };

  // Whether whatever is written straight after `node` gets swallowed into it. A function
  // written without brackets takes the following factors as its argument (\sin x y is
  // sin(xy)), though it stops at the next named function; a sum or derivative takes everything.
  const swallows = (node: Node): 'nothing' | 'factors' | 'everything' => {
    if (node.t === 'bin' && node.op === '*') return swallows(node.b);
    if (node.t === 'neg') return swallows(node.a);
    if (node.t === 'big' || node.t === 'deriv') return 'everything';
    const isCall = node.t === 'call' || (node.t === 'bin' && node.op === '^' && node.a.t === 'call');
    const source = text(node) ?? '';
    if (!isCall || !/^\\(?!left|sqrt|frac|dfrac|tfrac|lfloor|lceil)[a-zA-Z]/.test(source)) return 'nothing';
    const bracketed = /^\\[a-zA-Z]+(\{[a-zA-Z]+\})?\s*([\^_]\s*(\{[^{}]*\}|\\?[a-zA-Z0-9]+)\s*)*(\\left\s*)?\(/.test(source);
    return bracketed ? 'nothing' : 'factors';
  };
  const startsWithFunction = (option: string) => /^\\(arc)?(sin|cos|tan|sec|csc|cot)h?(?![a-zA-Z])/.test(option);

  const add = (node: Node, options: Option[], context: Context, previous: ReturnType<typeof swallows> = 'nothing') => {
    const span = spanOf(node);
    if (!span || options.length === 0) return;
    const [start, end] = span;
    // An explicit multiplication sign keeps the replacement out of the previous factor,
    // and keeps a leading digit from running into a number before it.
    const separate = (option: string) => {
      const absorbed = previous === 'everything' || (previous === 'factors' && !startsWithFunction(option));
      const digits = /[0-9.]\s*$/.test(latex.slice(0, start)) && /^[0-9]/.test(option);
      return absorbed || digits ? `\\cdot ${option}` : option;
    };
    // Already wrapped in brackets or braces in the source: nothing more is needed.
    const wrapped = /[({[]\s*$/.test(latex.slice(0, start)) && /^\s*(\\right\s*[)\]]|[)}\]])/.test(latex.slice(end));
    const bracket = (shape: Shape) => {
      if (shape === 'atom' || wrapped) return false;
      if (shape === 'sum') return context !== 'top' && context !== 'add';
      return context === 'power' || context === 'argument';
    };
    terms.push({
      start,
      end,
      source: latex.slice(start, end),
      options: options.map((o) => separate(bracket(o.shape) ? `\\left(${o.latex}\\right)` : o.latex)),
    });
  };

  const walk = (node: Node, context: Context, previous: ReturnType<typeof swallows> = 'nothing'): void => {
    add(node, combined(node), context, previous);
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
          if (isNum(node.b, 2) && CIRCULAR.has(base.fn)) add(node, squareForms(base.fn, base.args[0]), context, previous);
          else if (exponent !== undefined) {
            const raised = forms(base.fn, base.args[0]).map((o) => atom(`\\left(${o.latex}\\right)^{${exponent}}`));
            add(node, raised, context, previous);
          }
          walk(base.args[0], 'argument');
          return walk(node.b, 'multiply');
        }
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
        if (TRIG.has(node.fn) && node.args.length === 1) add(node, forms(node.fn, node.args[0]), context, previous);
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
