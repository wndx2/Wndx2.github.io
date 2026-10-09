// LaTeX → AST. Accepts the LaTeX that MathLive emits, plus hand-typed LaTeX.

export type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  // A built-in function such as sin or max.
  | { t: 'call'; fn: string; args: Node[] }
  // `name(args)`: a user function call or an implicit product, decided at compile time
  // once we know whether `name` is a function. `pow` is an exponent written after the
  // closing parenthesis, which binds differently in the two readings.
  | { t: 'app'; name: string; args: Node[]; pow?: Node }
  | { t: 'tuple'; items: Node[] }
  | { t: 'big'; kind: 'sum' | 'prod'; index: string; lo: Node; hi: Node; body: Node }
  | { t: 'deriv'; wrt: string; body: Node }
  // A definite integral of `body` over `wrt` from `lo` to `hi`.
  | { t: 'int'; wrt: string; lo: Node; hi: Node; body: Node }
  // Braces: `{x > 0}` restricts whatever it multiplies, and `{x < 0: -x, x}` chooses
  // between values. The first branch whose condition holds gives the value (1 if the
  // branch has none); with no match it is `otherwise`, or undefined, which cuts the graph.
  | { t: 'piece'; branches: Branch[]; otherwise?: Node };

// A comparison, possibly chained: operands[0] rels[0] operands[1] rels[1] operands[2] …
export interface Condition {
  operands: Node[];
  rels: Rel[];
}

export interface Branch {
  when: Condition;
  value?: Node;
}

export type Rel = '=' | '<' | '>' | '<=' | '>=';

export interface Statement {
  lhs: Node;
  rel?: Rel;
  rhs?: Node;
}

export class MathError extends Error {
  // Soft errors are the ones you pass through while typing (an unfinished expression).
  soft: boolean;
  constructor(message: string, soft = false) {
    super(message);
    this.soft = soft;
  }
}

// `s` and `e` are the token's start and end offsets in the source text.
type Tok = { k: 'cmd' | 'ch'; v: string; s: number; e: number };

// Where each node came from in the source, so a sub-expression can be rewritten in place.
// The first span recorded for a node wins, which is the tightest one (inside any brackets).
const spans = new WeakMap<Node, [number, number]>();

export const spanOf = (node: Node): [number, number] | undefined => spans.get(node);

const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta',
  'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'phi', 'varphi', 'chi',
  'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Sigma', 'Phi', 'Psi', 'Omega',
]);

const FUNCTION_ALIASES: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot',
  arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
  asin: 'arcsin', acos: 'arccos', atan: 'arctan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  arsinh: 'arsinh', arcosh: 'arcosh', artanh: 'artanh',
  arcsinh: 'arsinh', arccosh: 'arcosh', arctanh: 'artanh',
  ln: 'ln', log: 'log', lg: 'log', exp: 'exp',
  abs: 'abs', floor: 'floor', ceil: 'ceil', round: 'round',
  sign: 'sign', sgn: 'sign', signum: 'sign',
  min: 'min', max: 'max', mod: 'mod',
};

const INVERSE: Record<string, string> = {
  sin: 'arcsin', cos: 'arccos', tan: 'arctan', sinh: 'arsinh', cosh: 'arcosh', tanh: 'artanh',
};

const SKIPPED_COMMANDS = new Set([
  'displaystyle', 'textstyle', 'limits', 'nolimits', 'quad', 'qquad', 'mathstrut', 'left.', 'right.',
  ',', ';', ':', '!', ' ', '>',
]);

const COMMAND_CHARS: Record<string, string> = {
  cdot: '*', times: '*', ast: '*', div: '/',
  lt: '<', gt: '>', le: '≤', leq: '≤', leqslant: '≤', ge: '≥', geq: '≥', geqslant: '≥',
  lvert: '|', rvert: '|', vert: '|', mid: '|',
  lparen: '(', rparen: ')', lbrack: '[', rbrack: ']', colon: ':',
};

const COMMAND_RENAMES: Record<string, string> = {
  mleft: 'left', mright: 'right', dfrac: 'frac', tfrac: 'frac', cfrac: 'frac',
  exponentialE: 'e', differentialD: 'd',
};

const CHAR_RENAMES: Record<string, string> = {
  '·': '*', '×': '*', '∗': '*', '÷': '/', '−': '-', '–': '-',
};

const NAME_WRAPPERS = new Set(['operatorname', 'mathrm', 'mathit', 'text', 'mathop', 'textrm']);

const isLetter = (c: string) => /^[a-zA-Z]$/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const push = (k: Tok['k'], v: string) => out.push({ k, v, s: 0, e: 0 });
  // Reads one token (or skips one piece of spacing) starting at `i`.
  const step = () => {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      return;
    }
    if (c !== '\\') {
      if (c === 'π') push('cmd', 'pi');
      else if (c === 'θ') push('cmd', 'theta');
      else push('ch', CHAR_RENAMES[c] ?? c);
      i++;
      return;
    }
    i++;
    let name = '';
    while (i < src.length && isLetter(src[i])) name += src[i++];
    if (name === '') name = src[i++] ?? '';
    if (NAME_WRAPPERS.has(name) && src[i] === '{') {
      const close = src.indexOf('}', i);
      const inner = close < 0 ? '' : src.slice(i + 1, close).trim();
      if (close >= 0 && /^[a-zA-Z]+$/.test(inner)) {
        i = close + 1;
        if (inner.length === 1) push('ch', inner);
        else push('cmd', inner);
        return;
      }
      throw new MathError('Text isn’t supported inside expressions');
    }
    if (SKIPPED_COMMANDS.has(name)) return;
    if (name === 'lbrace' || name === 'rbrace') push('cmd', name === 'lbrace' ? '{' : '}');
    else if (name in COMMAND_CHARS) push('ch', COMMAND_CHARS[name]);
    else if (name === 'e' || name === 'd') push('ch', name);
    else if (name in COMMAND_RENAMES) {
      const renamed = COMMAND_RENAMES[name];
      push(renamed.length === 1 ? 'ch' : 'cmd', renamed);
    } else push('cmd', name);
  };
  while (i < src.length) {
    const start = i;
    const before = out.length;
    step();
    for (let k = before; k < out.length; k++) {
      out[k].s = start;
      out[k].e = i;
    }
  }
  return out;
}

const num = (v: number): Node => ({ t: 'num', v });
const mul = (a: Node, b: Node): Node => ({ t: 'bin', op: '*', a, b });

class Parser {
  private pos = 0;
  // Depth of bare `|…|` groups, so a `|` inside one is read as the closing bar.
  private barDepth = 0;

  constructor(private toks: Tok[]) {}

  // Records the source range of a node that began at token `start` and ends at the
  // token just consumed.
  private mark<T extends Node>(node: T, start: number): T {
    if (!spans.has(node) && this.pos > start) {
      spans.set(node, [this.toks[start].s, this.toks[this.pos - 1].e]);
    }
    return node;
  }

  private peek(offset = 0): Tok | undefined {
    return this.toks[this.pos + offset];
  }

  private isCh(c: string, offset = 0): boolean {
    const t = this.peek(offset);
    return !!t && t.k === 'ch' && t.v === c;
  }

  private isCmd(name: string, offset = 0): boolean {
    const t = this.peek(offset);
    return !!t && t.k === 'cmd' && t.v === name;
  }

  private eatCh(c: string): boolean {
    if (!this.isCh(c)) return false;
    this.pos++;
    return true;
  }

  private eatCmd(name: string): boolean {
    if (!this.isCmd(name)) return false;
    this.pos++;
    return true;
  }

  private fail(): never {
    const t = this.peek();
    if (!t) throw new MathError('Incomplete expression', true);
    if (t.k === 'cmd' && t.v === 'placeholder') throw new MathError('Incomplete expression', true);
    const shown = t.k === 'cmd' ? `\\${t.v}` : t.v;
    if (t.k === 'ch' && (t.v === ')' || t.v === '}' || t.v === ']')) {
      throw new MathError('Incomplete expression', true);
    }
    throw new MathError(`Unexpected “${shown}”`);
  }

  private expectCh(c: string): void {
    if (!this.eatCh(c)) this.fail();
  }

  // Parses the whole token list as one expression.
  parseAll(): Node {
    const node = this.parseExpr();
    if (this.peek()) this.fail();
    return node;
  }

  // Index of the `d` that closes the integral whose integrand starts at the current
  // position: the first `d` + variable outside any brackets, skipping one for each
  // integral nested inside the integrand.
  private findDifferential(): number {
    let depth = 0;
    let nested = 0;
    for (let i = this.pos; i < this.toks.length; i++) {
      const t = this.toks[i];
      if (t.k === 'cmd') {
        if (t.v === 'left') depth++;
        else if (t.v === 'right') depth--;
        else if (t.v === 'int') nested++;
        continue;
      }
      if (t.v === '{' || t.v === '(' || t.v === '[') depth++;
      else if (t.v === '}' || t.v === ')' || t.v === ']') depth--;
      else if (t.v === 'd' && depth === 0) {
        const next = this.toks[i + 1];
        const isVariable = !!next && (next.k === 'ch' ? isLetter(next.v) : GREEK.has(next.v));
        if (!isVariable) continue;
        if (nested === 0) return i;
        nested--;
      }
      if (depth < 0) break;
    }
    return -1;
  }

  // `\{ condition, condition: value, …, otherwise \}`, positioned at the opening brace.
  private parseBraces(): Node {
    this.pos++;
    const savedBars = this.barDepth;
    this.barDepth = 0;
    const branches: Branch[] = [];
    let otherwise: Node | undefined;
    do {
      if (otherwise) throw new MathError('The value without a condition has to come last');
      const first = this.parseExpr();
      let rel = this.parseRel();
      if (!rel) {
        otherwise = first;
        continue;
      }
      const when: Condition = { operands: [first], rels: [] };
      while (rel) {
        when.rels.push(rel);
        when.operands.push(this.parseExpr());
        rel = this.parseRel();
      }
      branches.push({ when, value: this.eatCh(':') ? this.parseExpr() : undefined });
    } while (this.eatCh(','));
    this.barDepth = savedBars;
    this.eatCmd('right');
    if (!this.eatCmd('}')) this.fail();
    if (branches.length === 0) throw new MathError('Braces need a condition, like {x > 0}');
    return { t: 'piece', branches, otherwise };
  }

  private parseIntegral(): Node {
    this.pos++;
    let lo: Node | undefined;
    let hi: Node | undefined;
    for (;;) {
      if (!lo && this.eatCh('_')) lo = this.parseArg();
      else if (!hi && this.eatCh('^')) hi = this.parseArg();
      else break;
    }
    if (!lo || !hi) {
      if (!this.peek()) throw new MathError('Incomplete expression', true);
      throw new MathError('An integral needs a lower and an upper limit');
    }
    const end = this.findDifferential();
    if (end < 0) throw new MathError('Finish the integral with dx', true);
    const body = end === this.pos ? num(1) : new Parser(this.toks.slice(this.pos, end)).parseAll();
    this.pos = end + 2;
    return { t: 'int', wrt: this.toks[end + 1].v, lo, hi, body };
  }

  parseStatement(): Statement {
    const lhs = this.parseExpr();
    const rel = this.parseRel();
    if (!rel) {
      if (this.peek()) this.fail();
      return { lhs };
    }
    const rhs = this.parseExpr();
    if (this.parseRel()) throw new MathError('Chained comparisons aren’t supported yet');
    if (this.peek()) this.fail();
    return { lhs, rel, rhs };
  }

  private parseRel(): Rel | undefined {
    const t = this.peek();
    if (!t || t.k !== 'ch') return undefined;
    if (t.v === '=') {
      this.pos++;
      return '=';
    }
    if (t.v === '≤' || t.v === '≥') {
      this.pos++;
      return t.v === '≤' ? '<=' : '>=';
    }
    if (t.v === '<' || t.v === '>') {
      this.pos++;
      if (this.eatCh('=')) return t.v === '<' ? '<=' : '>=';
      return t.v;
    }
    return undefined;
  }

  private parseExpr(): Node {
    const start = this.pos;
    let left = this.parseTerm();
    for (;;) {
      if (this.eatCh('+')) left = this.mark({ t: 'bin', op: '+', a: left, b: this.parseTerm() }, start);
      else if (this.eatCh('-')) left = this.mark({ t: 'bin', op: '-', a: left, b: this.parseTerm() }, start);
      else return left;
    }
  }

  private parseTerm(): Node {
    const start = this.pos;
    let left = this.parseUnary();
    for (;;) {
      if (this.eatCh('*')) left = this.mark(mul(left, this.parseUnary()), start);
      else if (this.eatCh('/')) left = this.mark({ t: 'bin', op: '/', a: left, b: this.parseUnary() }, start);
      else if (this.startsOperand()) left = this.mark(mul(left, this.parsePostfix()), start);
      else return left;
    }
  }

  private parseUnary(): Node {
    const start = this.pos;
    if (this.eatCh('-')) return this.mark({ t: 'neg', a: this.parseUnary() }, start);
    if (this.eatCh('+')) return this.parseUnary();
    return this.parsePostfix();
  }

  // A run of juxtaposed factors, e.g. the `2x` in `\sin 2x`. With `stopAtFunction`,
  // the run ends before the next named function so `\sin x\cos x` is a product of two calls.
  private parseJuxtaposed(stopAtFunction: boolean): Node {
    const start = this.pos;
    let left = this.eatCh('-') ? this.mark<Node>({ t: 'neg', a: this.parsePostfix() }, start) : this.parsePostfix();
    while (this.startsOperand() && !(stopAtFunction && this.startsFunction())) {
      left = this.mark(mul(left, this.parsePostfix()), start);
    }
    return left;
  }

  private startsFunction(): boolean {
    const t = this.peek();
    return !!t && t.k === 'cmd' && (t.v in FUNCTION_ALIASES || t.v === 'sum' || t.v === 'prod' || t.v === 'int');
  }

  private startsOperand(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.k === 'ch') {
      if (isDigit(t.v) || isLetter(t.v) || t.v === '.' || t.v === '(' || t.v === '{') return true;
      return t.v === '|' && this.barDepth === 0;
    }
    return (
      t.v === 'frac' || t.v === 'sqrt' || t.v === 'left' || t.v === 'int' || t.v === '{' || t.v === 'lfloor' || t.v === 'lceil' ||
      t.v === 'pi' || t.v === 'infty' || t.v === 'placeholder' || GREEK.has(t.v) || this.startsFunction()
    );
  }

  private parsePostfix(): Node {
    const start = this.pos;
    let base = this.mark(this.parsePrimary(), start);
    for (;;) {
      if (this.eatCh('^')) {
        const exponent = this.parseArg();
        if (base.t === 'app' && !base.pow) base = this.mark({ ...base, pow: exponent }, start);
        else base = this.mark({ t: 'bin', op: '^', a: base, b: exponent }, start);
      } else if (this.eatCh('!')) {
        base = this.mark({ t: 'call', fn: 'fact', args: [base] }, start);
      } else return base;
    }
  }

  // A TeX argument: a braced group, or exactly one token (`x^2y` is x²·y).
  private parseArg(): Node {
    if (this.eatCh('{')) {
      const inner = this.parseExpr();
      this.expectCh('}');
      return inner;
    }
    const t = this.peek();
    if (!t) this.fail();
    const start = this.pos++;
    if (t.k === 'ch' && isDigit(t.v)) return this.mark(num(Number(t.v)), start);
    if (t.k === 'ch' && isLetter(t.v)) return this.mark({ t: 'var', name: t.v }, start);
    if (t.k === 'cmd' && (t.v === 'pi' || t.v === 'infty' || GREEK.has(t.v))) {
      return this.mark({ t: 'var', name: t.v }, start);
    }
    this.pos = start;
    this.fail();
  }

  private parseSubscript(): string {
    let text = '';
    if (this.eatCh('{')) {
      while (this.peek() && !this.isCh('}')) text += this.toks[this.pos++].v;
      this.expectCh('}');
    } else {
      const t = this.peek();
      if (!t) this.fail();
      text = t.v;
      this.pos++;
    }
    text = text.replace(/[^a-zA-Z0-9]/g, '');
    if (!text) throw new MathError('Incomplete expression', true);
    return text;
  }

  // Comma-separated expressions up to (not including) the closing delimiter.
  private parseList(): Node[] {
    const items = [this.parseExpr()];
    while (this.eatCh(',')) items.push(this.parseExpr());
    return items;
  }

  private opensParen(): boolean {
    return this.isCh('(') || (this.isCmd('left') && (this.isCh('(', 1) || this.isCh('[', 1)));
  }

  private parseParenList(): Node[] {
    const fenced = this.eatCmd('left');
    const open = this.peek();
    if (!open || open.k !== 'ch' || (open.v !== '(' && open.v !== '[')) this.fail();
    this.pos++;
    const savedBars = this.barDepth;
    this.barDepth = 0;
    const items = this.parseList();
    this.barDepth = savedBars;
    if (fenced && !this.eatCmd('right')) this.fail();
    this.expectCh(open.v === '(' ? ')' : ']');
    return items;
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (!t) this.fail();

    if (t.k === 'ch') {
      if (isDigit(t.v) || t.v === '.') return this.parseNumber();
      if (isLetter(t.v)) return this.parseIdentifier();
      if (t.v === '(' || t.v === '[') return this.parseGroup();
      if (t.v === '{') {
        this.pos++;
        const inner = this.parseExpr();
        this.expectCh('}');
        return inner;
      }
      if (t.v === '|') {
        this.pos++;
        this.barDepth++;
        const inner = this.parseExpr();
        this.barDepth--;
        this.expectCh('|');
        return { t: 'call', fn: 'abs', args: [inner] };
      }
      this.fail();
    }

    switch (t.v) {
      case 'left': {
        if (this.isCh('|', 1)) {
          this.pos += 2;
          const savedBars = this.barDepth;
          this.barDepth = 0;
          const inner = this.parseExpr();
          this.barDepth = savedBars;
          if (!this.eatCmd('right')) this.fail();
          this.expectCh('|');
          return { t: 'call', fn: 'abs', args: [inner] };
        }
        if (this.isCmd('lfloor', 1) || this.isCmd('lceil', 1)) {
          this.pos++;
          return this.parsePrimary();
        }
        if (this.opensParen()) return this.parseGroup();
        if (this.isCmd('{', 1)) {
          this.pos++;
          return this.parseBraces();
        }
        this.fail();
      }
      case '{':
        return this.parseBraces();
      case 'lfloor':
      case 'lceil': {
        this.pos++;
        const inner = this.parseExpr();
        this.eatCmd('right');
        if (!this.eatCmd(t.v === 'lfloor' ? 'rfloor' : 'rceil')) this.fail();
        return { t: 'call', fn: t.v === 'lfloor' ? 'floor' : 'ceil', args: [inner] };
      }
      case 'frac': {
        this.pos++;
        const top = this.parseArg();
        const bottom = this.parseArg();
        const wrt = derivativeVariable(top, bottom);
        if (wrt) return { t: 'deriv', wrt, body: this.parseJuxtaposed(false) };
        return { t: 'bin', op: '/', a: top, b: bottom };
      }
      case 'sqrt': {
        this.pos++;
        if (this.eatCh('[')) {
          const index = this.parseExpr();
          this.expectCh(']');
          return { t: 'call', fn: 'nthroot', args: [index, this.parseArg()] };
        }
        return { t: 'call', fn: 'sqrt', args: [this.parseArg()] };
      }
      case 'sum':
      case 'prod': {
        this.pos++;
        this.expectCh('_');
        this.expectCh('{');
        const index = this.parseIdentifier();
        if (index.t !== 'var') this.fail();
        this.expectCh('=');
        const lo = this.parseExpr();
        this.expectCh('}');
        this.expectCh('^');
        const hi = this.parseArg();
        return { t: 'big', kind: t.v, index: index.name, lo, hi, body: this.parseJuxtaposed(false) };
      }
      case 'int':
        return this.parseIntegral();
      case 'pi':
      case 'infty':
        this.pos++;
        return { t: 'var', name: t.v };
      case 'placeholder':
      // A closing delimiter where a value should be: the expression isn't finished yet.
      case 'right':
      case '}':
      case 'rfloor':
      case 'rceil':
        throw new MathError('Incomplete expression', true);
    }

    if (GREEK.has(t.v)) return this.parseIdentifier();
    if (t.v in FUNCTION_ALIASES) return this.parseFunction();
    throw new MathError(`“\\${t.v}” isn’t supported yet`);
  }

  private parseNumber(): Node {
    let text = '';
    while (this.peek()?.k === 'ch' && (isDigit(this.peek()!.v) || (this.isCh('.') && !text.includes('.')))) {
      text += this.toks[this.pos++].v;
    }
    if (text === '.') throw new MathError('Incomplete expression', true);
    return num(Number(text));
  }

  private parseIdentifier(): Node {
    let name = this.toks[this.pos++].v;
    if (this.eatCh('_')) name += '_' + this.parseSubscript();
    if (name !== 'e' && name !== 'pi' && this.opensParen()) {
      return { t: 'app', name, args: this.parseParenList() };
    }
    return { t: 'var', name };
  }

  private parseGroup(): Node {
    const items = this.parseParenList();
    return items.length === 1 ? items[0] : { t: 'tuple', items };
  }

  private parseFunction(): Node {
    let fn = FUNCTION_ALIASES[this.toks[this.pos++].v];
    let base: Node | undefined;
    let power: Node | undefined;
    for (;;) {
      if (fn === 'log' && !base && this.eatCh('_')) base = this.parseArg();
      else if (!power && this.eatCh('^')) power = this.parseArg();
      else break;
    }
    if (power && isMinusOne(power) && fn in INVERSE) {
      fn = INVERSE[fn];
      power = undefined;
    }
    const args = this.opensParen() ? this.parseParenList() : [this.parseJuxtaposed(true)];
    let node: Node = base ? { t: 'call', fn: 'logb', args: [base, ...args] } : { t: 'call', fn, args };
    if (power) node = { t: 'bin', op: '^', a: node, b: power };
    return node;
  }
}

function isMinusOne(n: Node): boolean {
  return n.t === 'neg' && n.a.t === 'num' && n.a.v === 1;
}

// Recognises the `d / dx` in `\frac{d}{dx}` and returns the variable.
function derivativeVariable(top: Node, bottom: Node): string | undefined {
  if (top.t !== 'var' || top.name !== 'd') return undefined;
  if (bottom.t === 'bin' && bottom.op === '*' && bottom.a.t === 'var' && bottom.a.name === 'd' && bottom.b.t === 'var') {
    return bottom.b.name;
  }
  return undefined;
}

export function parse(latex: string): Statement {
  return new Parser(tokenize(latex)).parseStatement();
}

// The LaTeX spelling of an identifier produced by the parser (`theta` → `\theta`, `a_1` → `a_{1}`).
export function nameToLatex(name: string): string {
  const [base, sub] = name.split('_');
  return (base.length > 1 ? `\\${base}` : base) + (sub ? `_{${sub}}` : '');
}
