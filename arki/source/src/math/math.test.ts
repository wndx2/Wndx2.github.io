// Run with `npm test`. Plain assertions, no test framework.

import assert from 'node:assert/strict';
import { analyze, type Analysis, type Plot } from './analyze';
import { decimalToLatex, exactForm, valueToLatex } from './exact';
import { applyTrigOption, trigTerms } from './trig';

const one = (latex: string, ...context: string[]): Analysis => analyze([latex, ...context])[0];

function plot<K extends Plot['kind']>(a: Analysis, kind: K): Extract<Plot, { kind: K }> {
  assert.equal(a.error, undefined, `unexpected error: ${a.error}`);
  assert.equal(a.plot?.kind, kind);
  return a.plot as Extract<Plot, { kind: K }>;
}

const near = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} is not close to ${expected}`);

const value = (latex: string, ...context: string[]) => {
  const a = one(latex, ...context);
  assert.equal(a.error, undefined, `unexpected error in ${latex}: ${a.error}`);
  return a.value as number;
};

// Arithmetic and precedence
near(value('1+2\\cdot3'), 7);
near(value('-2^2'), -4);
near(value('2^{-1}'), 0.5);
near(value('\\frac{1}{2}+\\frac12'), 1);
near(value('2\\pi'), 2 * Math.PI);
near(value('e^{2}'), Math.E ** 2);
near(value('\\sqrt{16}+\\sqrt[3]{-8}'), 2);
near(value('\\left(-8\\right)^{\\frac{1}{3}}'), -2);
near(value('\\left|-3\\right|+|2-5|'), 6);
near(value('5!'), 120);
near(value('.5+1.25'), 1.75);
near(value('2\\left(3+1\\right)^2'), 32);

// Functions
near(value('\\sin\\left(\\frac{\\pi}{2}\\right)'), 1);
near(value('\\sin^{2}\\left(1\\right)+\\cos^21'), 1);
near(value('\\sin^{-1}\\left(1\\right)'), Math.PI / 2);
near(value('\\ln e+\\log100+\\log_{2}8'), 6);
near(value('\\max\\left(1,5,3\\right)-\\min\\left(1,5\\right)'), 4);
near(value('\\operatorname{floor}\\left(2.7\\right)+\\lfloor-0.5\\rfloor'), 1);
near(value('\\operatorname{mod}\\left(-1,3\\right)'), 2);
near(value('\\sum_{n=1}^{10}n^2'), 385);
near(value('\\prod_{k=1}^{5}k'), 120);

// Plots
near(plot(one('y=x^2'), 'fx').f(3), 9);
near(plot(one('x^2-1'), 'fx').f(3), 8);
near(plot(one('2x\\sin x'), 'fx').f(1), 2 * Math.sin(1));
near(plot(one('\\sin2x'), 'fx').f(1), Math.sin(2));
near(plot(one('\\sin x\\cos x'), 'fx').f(1), Math.sin(1) * Math.cos(1));
near(plot(one('x\\left(x+1\\right)^2'), 'fx').f(2), 18);
near(plot(one('x=y^2'), 'fy').f(3), 9);
near(plot(one('x=3'), 'fy').f(100), 3);
near(plot(one('\\frac{d}{dx}x^3'), 'fx').f(2), 12, 1e-5);
near(plot(one('r=1+\\cos\\theta'), 'polar').f(0), 2);

const circle = plot(one('x^2+y^2=25'), 'implicit');
near(circle.f(3, 4), 0);
assert.equal(circle.region, false);

const below = plot(one('y>x'), 'implicit');
assert.ok(below.region && below.strict);
assert.ok(below.f(0, 1) < 0 && below.f(1, 0) > 0);

const curve = plot(one('\\left(\\cos t,\\sin t\\right)'), 'parametric');
near(curve.x(0), 1);
near(curve.y(Math.PI / 2), 1);

const point = plot(one('\\left(1,a\\right)', 'a=2'), 'point');
assert.deepEqual([point.x, point.y], [1, 2]);

// Definitions
assert.deepEqual(one('a=-2.5').slider, { name: 'a', value: -2.5 });
near(value('b=a+1', 'a=2'), 3);
near(plot(one('y=ax', 'a=3'), 'fx').f(2), 6);
near(plot(one('f\\left(x\\right)=x^2'), 'fx').f(4), 16);
near(plot(one('y=f\\left(x\\right)^2+g\\left(x,1\\right)', 'f(x)=2x', 'g(u,v)=u+v'), 'fx').f(1), 6);
near(plot(one('y=a\\left(x+1\\right)', 'a=3'), 'fx').f(1), 6);
near(value('c', 'c=b^2', 'b=a+1', 'a=2'), 9);
near(plot(one('y=a_{1}x+\\alpha', 'a_1=2', '\\alpha=1'), 'fx').f(1), 3);

// Problems
assert.deepEqual(one('y=ax+b').missing, ['a', 'b']);
assert.equal(one('y=').softError, true);
assert.equal(one('\\frac{1}{\\placeholder{}}').softError, true);
assert.equal(one('').empty, true);
assert.match(one('a=a+1').error!, /itself/);
assert.match(one('f(x)=g(x)', 'g(x)=f(x)').error!, /itself|problem/);
assert.match(analyze(['a=1', 'a=2'])[1].error!, /already defined/);
assert.match(one('y=f(1,2)', 'f(x)=x').error!, /1 argument/);
assert.match(one('1=2').error!, /Nothing to plot/);
assert.ok(one('y=\\foo x').error);

// Derivatives used for stationary and inflection points
const cubic = plot(one('y=x^3-3x'), 'fx');
near(cubic.d1(1), 0);
near(cubic.d1(2), 9);
near(cubic.d2(0), 0);
near(cubic.d2(-2), -12);
const wave = plot(one('f(x)=a\\sin\\left(2x\\right)+\\frac{1}{x}', 'a=3'), 'fx');
near(wave.d1(1), 6 * Math.cos(2) - 1);
near(wave.d2(1), -12 * Math.sin(2) + 2);
near(plot(one('y=e^{-x^2}'), 'fx').d2(Math.SQRT1_2), 0);
near(plot(one('y=x^x'), 'fx').d1(2), 4 * (Math.log(2) + 1));
near(plot(one('y=x^2', ), 'fx').d1(-3), -6);
near(plot(one('y=\\left|x\\right|\\ln\\left(x^2+1\\right)'), 'fx').d1(-1), -Math.log(2) - 1);
near(plot(one('x=y^2-4y'), 'fy').d1(2), 0);
// No rule for max, so this falls back to a numeric derivative.
near(plot(one('y=\\max\\left(x^2,1\\right)'), 'fx').d1(3), 6, 1e-4);
near(plot(one('y=g\\left(x\\right)^2', 'g(u)=3u'), 'fx').d1(1), 18, 1e-4);

// Definite integrals
const integral = (latex: string, expected: number, eps = 1e-12) => near(value(latex), expected, eps);
integral('\\int_{0}^{1}x^2dx', 1 / 3);
integral('\\int_0^1x^{20}\\,dx', 1 / 21);
integral('\\int_{0}^{\\pi}\\sin x\\,\\mathrm{d}x', 2);
integral('\\int_1^e\\frac{1}{t}\\differentialD t', 1);
integral('\\int_{2}^{0}x\\,dx', -2);
integral('2\\int_{0}^{1}\\left(x+1\\right)dx+1', 4);
integral('\\int_{0}^{1}dx', 1);
integral('\\int_{0}^{1}\\int_{0}^{x}y\\,dy\\,dx', 1 / 6);
integral('\\int_{-\\infty}^{\\infty}e^{-x^2}dx', Math.sqrt(Math.PI), 1e-10);
integral('\\int_{0}^{\\infty}e^{-x}dx', 1, 1e-10);
integral('\\int_{0}^{1}\\sqrt{x}\\,dx', 2 / 3, 1e-6);
assert.equal(valueToLatex(value('\\int_{0}^{1}x^2dx')), '\\frac{1}{3}');
assert.equal(valueToLatex(value('\\int_{0}^{\\frac{1}{2}}\\frac{1}{\\sqrt{1-x^2}}dx')), '\\frac{\\pi}{6}');
near(value('\\int_{0}^{a}bx\\,dx', 'a=2', 'b=3'), 6);
const area = plot(one('y=\\int_{0}^{x}\\cos t\\,dt'), 'fx');
near(area.f(1), Math.sin(1));
near(area.d1(1), Math.cos(1));
near(area.d2(1), -Math.sin(1));
const leibniz = plot(one('y=\\int_{0}^{x^2}xt\\,dt'), 'fx');
near(leibniz.f(2), 16);
near(leibniz.d1(2), 40, 1e-9);
assert.equal(one('\\int_{0}^{1}x^2').softError, true);
assert.match(one('\\int x\\,dx').error!, /limit/);
assert.deepEqual(one('y=\\int_{0}^{x}at\\,dt').missing, ['a']);

// Trig conversions: every offered form must equal the original, wherever it sits.
const trigSamples = [
  'y=\\sin^{2}x', 'y=\\cos^2x+1', 'y=2\\tan^{2}\\left(x\\right)', 'y=3-\\sec^2x', 'y=\\csc^{2}x\\cot^{2}x',
  'y=\\sin x', 'y=x\\cos\\left(x\\right)', 'y=-\\tan x', 'y=\\sec x-\\csc x', 'y=\\frac{\\cot x}{2}',
  'y=\\sin\\left(2x\\right)', 'y=5-\\cos\\left(2x\\right)', 'y=\\tan\\left(2x\\right)^{2}', 'y=\\sin^{3}x', 'y=\\cos\\left(x\\right)^{4}',
  'y=1-\\cos^2x', 'y=\\sin^2x+\\cos^2x', 'y=1+\\tan^2x', 'y=\\sec^2x-1', 'y=\\frac{\\sin x}{\\cos x}', 'y=\\frac{1}{\\sin x}',
  'y=2\\sin x\\cos x', 'y=\\sin x\\cos x', 'y=\\cos^2x-\\sin^2x', 'y=\\frac{1}{\\cos^{2}x}',
  'y=\\sin\\left(x+1\\right)\\cos^{2}\\left(3x\\right)', 'y=\\sin^2\\left(\\cos x\\right)', 'y=e^{\\sin x}', 'y=\\sqrt{1+\\tan^{2}x}',
  'y=\\arcsin\\left(\\frac{x}{9}\\right)', 'y=2\\arccos\\left(\\frac{x}{9}\\right)', 'y=\\arctan\\left(x+1\\right)',
  'y=\\sinh x', 'y=x-\\cosh\\left(x+1\\right)', 'y=\\tanh^{2}x',
  'y=\\sin x+\\cos x\\tan x-\\sec^{2}x\\csc x+\\cot\\left(2x\\right)',
  '\\sin^{2}x+y\\cos x=1', 'y=\\int_{0}^{x}\\sin^{2}t\\,dt',
  // Pieces written straight after something that would swallow the replacement.
  'y=x^2\\sin x', 'y=\\ln x\\cos x', 'y=\\sum_{n=1}^{3}n\\sin^2x', 'y=2\\cdot\\cos x', 'y=\\operatorname{floor}x\\cos x',
];
let converted = 0;
for (const sample of trigSamples) {
  const terms = trigTerms(sample);
  assert.ok(terms.length > 0, `no trig terms found in ${sample}`);
  const before = one(sample).plot!;
  for (const term of terms) {
    for (const option of term.options) {
      const rewritten = applyTrigOption(sample, term, option);
      const result = one(rewritten);
      assert.equal(result.error, undefined, `${sample} → ${rewritten}: ${result.error}`);
      const after = result.plot!;
      for (const x of [0.37, 1.13, 2.6, -0.71]) {
        const [p, q] =
          before.kind === 'implicit' && after.kind === 'implicit'
            ? [before.f(x, 0.4), after.f(x, 0.4)]
            : [(before as { f(x: number): number }).f(x), (after as { f(x: number): number }).f(x)];
        if (Number.isFinite(p) && Number.isFinite(q)) near(q, p, 1e-7 * Math.max(1, Math.abs(p)));
      }
      converted++;
    }
  }
}
assert.ok(converted > 150, `only ${converted} conversions checked`);
assert.equal(trigTerms('y=\\sin x+\\cos x\\tan x-\\sec^{2}x\\csc x+\\cot\\left(2x\\right)').length, 6);
assert.deepEqual(trigTerms('y=\\sin^{2}x').map((t) => t.source), ['\\sin^{2}x']);
assert.equal(applyTrigOption('y=2\\sin^{2}x', trigTerms('y=2\\sin^{2}x')[0], trigTerms('y=2\\sin^{2}x')[0].options[0]),
  'y=2\\left(1-\\cos^{2}\\left(x\\right)\\right)');
assert.equal(trigTerms('y=\\sin^{2}x')[0].options[0], '1-\\cos^{2}\\left(x\\right)');
assert.deepEqual(trigTerms('y=x^2+1'), []);
assert.deepEqual(trigTerms('y=\\sin('), []);

// Braces: restrictions and piecewise values
const cut = plot(one('y=x^2\\left\\{0<x<2\\right\\}'), 'fx');
near(cut.f(1), 1);
assert.ok(Number.isNaN(cut.f(-1)) && Number.isNaN(cut.f(3)) && Number.isNaN(cut.f(2)));
near(cut.d1(1), 2);
assert.ok(Number.isNaN(cut.d1(3)));
near(plot(one('y=x\\left\\lbrace x\\ge1\\right\\rbrace'), 'fx').f(1), 1);
near(plot(one('y=\\sin x\\{x>0\\}\\{x\\le3\\}'), 'fx').f(3), Math.sin(3));
assert.ok(Number.isNaN(plot(one('y=\\sin x\\{x>0\\}\\{x\\le3\\}'), 'fx').f(4)));
const either = plot(one('y=1\\left\\{x<-1,x>1\\right\\}'), 'fx');
assert.ok(either.f(-2) === 1 && either.f(2) === 1 && Number.isNaN(either.f(0)));
const pieces = plot(one('y=\\left\\{x<0:-x,x<1:x^2,3\\right\\}'), 'fx');
assert.deepEqual([pieces.f(-2), pieces.f(0.5), pieces.f(5)], [2, 0.25, 3]);
near(pieces.d1(0.5), 1);
near(pieces.d1(-2), -1);
assert.ok(Number.isNaN(plot(one('x=y^2\\left\\{y>0\\right\\}'), 'fy').f(-1)));
const arc = plot(one('x^2+y^2=9\\left\\{y>0\\right\\}'), 'implicit');
near(arc.f(3, 1), 1);
assert.ok(Number.isNaN(arc.f(3, -1)));
const band = plot(one('y=x\\left\\{y<a\\right\\}', 'a=2'), 'implicit');
assert.ok(Number.isNaN(band.f(0, 3)) && band.f(1, 1) === 0);
near(plot(one('f\\left(x\\right)=x\\left\\{\\left|x\\right|<a\\right\\}', 'a=2'), 'fx').f(-1), -1);
assert.deepEqual(one('y=x\\left\\{x<b\\right\\}').missing, ['b']);
assert.equal(one('y=x\\left\\{x>\\right\\}').softError, true);
assert.match(one('y=x\\left\\{x\\right\\}').error!, /condition/);
assert.equal(trigTerms('y=\\sin^2x\\left\\{\\cos x>0\\right\\}').length, 2);

// Exact forms
const exact: [number, string | undefined][] = [
  [Math.PI, '\\pi'], [-Math.PI / 2, '-\\frac{\\pi}{2}'], [3 * Math.PI / 4, '\\frac{3\\pi}{4}'], [2 * Math.PI, '2\\pi'],
  [0, '0'], [1, '1'], [-1, '-1'], [-3, '-3'], [1 / 3, '\\frac{1}{3}'], [-2.5, '-\\frac{5}{2}'], [1e-12, '0'],
  [Math.SQRT2, '\\sqrt{2}'], [-Math.sqrt(3) / 2, '-\\frac{\\sqrt{3}}{2}'], [Math.sqrt(8), '2\\sqrt{2}'],
  [1 / Math.sqrt(2), '\\frac{\\sqrt{2}}{2}'], [(1 + Math.sqrt(5)) / 2, '\\frac{1+\\sqrt{5}}{2}'],
  [2 - Math.sqrt(3), '2-\\sqrt{3}'], [(-1 - Math.sqrt(13)) / 2, '\\frac{-1-\\sqrt{13}}{2}'],
  [Math.E, 'e'], [Math.log(2), '\\ln 2'], [Math.log(3) / 2, '\\frac{\\ln 3}{2}'],
  [Math.sin(1), undefined],
];
for (const [input, expected] of exact) assert.equal(exactForm(input), expected, `exactForm(${input})`);
const wider: [number, string][] = [
  [1 / Math.E, '\\frac{1}{e}'], [2 / Math.E ** 2, '\\frac{2}{e^{2}}'], [Math.E ** 2 / 4, '\\frac{e^{2}}{4}'],
  [Math.PI ** 2 / 6, '\\frac{\\pi^{2}}{6}'], [2 / Math.PI, '\\frac{2}{\\pi}'], [Math.sqrt(Math.E), '\\sqrt{e}'],
  [27 / 256, '\\frac{27}{256}'], [Math.cbrt(2), '\\sqrt[3]{2}'], [-Math.cbrt(0.5), '-\\frac{\\sqrt[3]{4}}{2}'],
  [Math.log(1.5), '\\ln\\frac{3}{2}'], [Math.log(6), '\\ln 6'], [Math.E ** 1.5, 'e^{\\frac{3}{2}}'], [Math.E ** 4, 'e^{4}'],
  [1 + Math.PI, '\\pi+1'], [Math.PI / 2 - 1, '\\frac{\\pi}{2}-1'], [2 - Math.log(2), '2-\\ln 2'], [-1 - Math.E, '-e-1'],
  [(Math.sqrt(5) - 1) / 2, '\\frac{\\sqrt{5}-1}{2}'],
];
for (const [input, expected] of wider) assert.equal(exactForm(input), expected, `exactForm(${input})`);
for (const v of [Math.sin(1), Math.cos(2), Math.tan(0.3), 0.1445912, 2.9965103, Math.PI ** Math.E, Math.exp(Math.SQRT2)]) {
  assert.equal(exactForm(v), undefined, `exactForm(${v}) should not match`);
}
// A dragged point only recognises simple fractions.
assert.equal(exactForm(2.74, 1e-11, 12), undefined);
assert.equal(exactForm(0.5, 1e-11, 12), '\\frac{1}{2}');
assert.equal(valueToLatex(Math.sin(1)), '0.841471');
assert.equal(valueToLatex(NaN), '\\text{undefined}');
assert.equal(decimalToLatex(-2.5e-7), '-2.5\\times10^{-7}');
assert.equal(exactForm(1e-12, 1e-14), undefined);

console.log('math: all checks passed');
