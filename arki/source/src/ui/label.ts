// A point's label is plain text that can quote live values: in `a = ${a}`, whatever is
// inside `${…}` is an expression, shown as its current value.

const QUOTED = /\$\{([^}]*)\}/g;

// Names that are typed as words in a label but written as commands in LaTeX.
const WORDS = /(?<![\\a-zA-Z])(sin|cos|tan|ln|log|exp|abs|floor|ceil|round|pi|theta)(?![a-zA-Z])/g;

// Maths typed as plain text (`2*pi`, `sin(a)`) as LaTeX the analyser can read.
export const plainToLatex = (plain: string) => plain.replace(WORDS, '\\$1');

// The expressions a label quotes, in order, as LaTeX the analyser can read.
export function labelExpressions(label: string): string[] {
  return [...label.matchAll(QUOTED)].map((match) => plainToLatex(match[1]));
}

const ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '%': '\\%', '#': '\\#', '&': '\\&', _: '\\_',
  '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
};

const text = (plain: string) => (plain ? `\\text{${plain.replace(/[\\{}$%#&_^~]/g, (c) => ESCAPES[c])}}` : '');

// The label as LaTeX: its text set as text, with each quoted expression replaced by the
// matching entry of `values` (already LaTeX).
export function labelToLatex(label: string, values: string[]): string {
  let out = '';
  let last = 0;
  let n = 0;
  for (const match of label.matchAll(QUOTED)) {
    out += text(label.slice(last, match.index)) + (values[n++] ?? '');
    last = match.index + match[0].length;
  }
  return out + text(label.slice(last));
}
