// The maths keyboard's first layout: MathLive's numeric one, with the ∀ key swapped for
// a derivative at a value — `d/dx (…, …)`, or the second derivative with Shift — `n` for
// `y`, and the imaginary unit for braces, which restrict a graph to a range. The rest is
// MathLive's own definition, repeated here because a layout can only be replaced whole.
const NUMERIC = {
  label: '123',
  labelClass: 'MLK__tex-math',
  tooltip: 'keyboard.tooltip.numeric',
  rows: [
    [
      {
        latex: 'x',
        shift: 'y',
        variants: [
          'y', 'z', 't', 'r', 'x^2', 'x^n', 'x^{#?}', 'x_n', 'x_i', 'x_{#?}',
          { latex: 'f(#?)', class: 'small' },
          { latex: 'g(#?)', class: 'small' },
        ],
      },
      { latex: 'y', shift: 'a', variants: ['n', 'i', 'j', 'p', 'k', 'a', 'u'] },
      '[separator-5]',
      '[7]',
      '[8]',
      '[9]',
      '[/]',
      '[separator-5]',
      {
        latex: '\\exponentialE',
        shift: '\\ln',
        variants: ['\\exp', '\\times 10^{#?}', '\\ln', '\\log_{10}', '\\log', '\\lg', '\\operatorname{lb}'],
      },
      // Sent as keystrokes, like MathLive's own bracket keys, so smartFence pairs them.
      { label: '{', key: '{', shift: { label: '}', key: '}' }, variants: [{ latex: '\\rbrace', key: '}' }, ':', ','] },
      {
        latex: '\\pi',
        shift: '\\sin',
        variants: [
          '\\prod',
          { latex: '\\theta', aside: 'theta' },
          { latex: '\\rho', aside: 'rho' },
          { latex: '\\tau', aside: 'tau' },
          '\\sin',
          '\\cos',
          '\\tan',
        ],
      },
    ],
    [
      { label: '<', latex: '<', class: 'hide-shift', shift: { latex: '\\le', label: '≤' } },
      { label: '>', latex: '>', class: 'hide-shift', shift: { latex: '\\ge', label: '≥' } },
      '[separator-5]',
      '[4]',
      '[5]',
      '[6]',
      '[*]',
      '[separator-5]',
      { class: 'hide-shift', latex: '#@^2}', shift: '#@^{\\prime}}' },
      { latex: '#@^{#0}}', class: 'hide-shift', shift: '#@_{#?}' },
      { class: 'hide-shift', latex: '\\sqrt{#0}', shift: { latex: '\\sqrt[#0]{#?}}' } },
    ],
    [
      '[(]',
      '[)]',
      '[separator-5]',
      '[1]',
      '[2]',
      '[3]',
      '[-]',
      '[separator-5]',
      {
        latex: '\\int^{\\infty}_{0}\\!#?\\,\\mathrm{d}x',
        class: 'small hide-shift',
        shift: '\\int',
        variants: [
          { latex: '\\int_{#?}^{#?}', class: 'small' },
          { latex: '\\int', class: 'small' },
          { latex: '\\iint', class: 'small' },
          { latex: '\\iiint', class: 'small' },
          { latex: '\\oint', class: 'small' },
          '\\mathrm{d}x',
          { latex: '\\dfrac{\\mathrm{d}}{\\mathrm{d} x}', class: 'small' },
          { latex: '\\frac{\\partial}{\\partial x}', class: 'small' },
          '\\partial',
        ],
      },
      {
        class: 'small hide-shift',
        latex: '\\frac{d}{dx}',
        insert: '\\frac{d}{dx}\\left(#?,#?\\right)',
        shift: { class: 'small', latex: '\\frac{d^2}{dx^2}', insert: '\\frac{d^2}{dx^2}\\left(#?,#?\\right)' },
      },
      { label: '[backspace]', width: 1 },
    ],
    [
      { label: '[shift]', width: 2 },
      '[separator-5]',
      '[0]',
      '[.]',
      '[=]',
      '[+]',
      '[separator-5]',
      '[left]',
      '[right]',
      { label: '[action]', width: 1 },
    ],
  ],
};

export function setUpKeyboard() {
  window.mathVirtualKeyboard.layouts = [NUMERIC, 'symbols', 'alphabetic', 'greek'] as typeof window.mathVirtualKeyboard.layouts;
}
