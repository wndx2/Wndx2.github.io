// Recognises a decimal as a closed form (3π/2, √2, (1+√5)/2, 1/e, 1+ln 2 …) so values
// can be shown the way you would write them by hand. The result is LaTeX, so fractions
// and roots are typeset properly. Returns undefined when nothing simple matches.
//
// Each family of candidates is kept small relative to the tolerance, so the chance of a
// number matching by coincidence stays around one in a million.

const SQUARE_FREE = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23, 26, 29, 30];

// Constants a value can be a rational multiple of: [value, numerator part, denominator part].
const E = Math.E;
const FACTORS: [number, string, string][] = [
  [Math.PI, '\\pi', ''],
  [1 / Math.PI, '', '\\pi'],
  [Math.PI ** 2, '\\pi^{2}', ''],
  [E, 'e', ''],
  [1 / E, '', 'e'],
  [E ** 2, 'e^{2}', ''],
  [1 / E ** 2, '', 'e^{2}'],
  [E ** 3, 'e^{3}', ''],
  [1 / E ** 3, '', 'e^{3}'],
  [Math.sqrt(E), '\\sqrt{e}', ''],
  [1 / Math.sqrt(E), '', '\\sqrt{e}'],
  [Math.sqrt(Math.PI), '\\sqrt{\\pi}', ''],
  [Math.log(2), '\\ln 2', ''],
  [Math.log(3), '\\ln 3', ''],
  [Math.log(5), '\\ln 5', ''],
  [Math.log(7), '\\ln 7', ''],
  [Math.log(10), '\\ln 10', ''],
];

// Constants that can appear added to a rational, as in 1 + π or 2 − ln 2.
const ADDENDS: [number, string][] = [
  [Math.PI, '\\pi'],
  [E, 'e'],
  [1 / E, 'e^{-1}'],
  [Math.log(2), '\\ln 2'],
  [Math.log(3), '\\ln 3'],
];

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

// The fraction p/q with the smallest q ≤ maxQ that equals x within the tolerance.
function rational(x: number, maxQ: number, tolerance: number): [number, number] | undefined {
  const allowed = tolerance * Math.max(1, Math.abs(x));
  for (let q = 1; q <= maxQ; q++) {
    const p = Math.round(x * q);
    if (Math.abs(x - p / q) <= allowed) return Math.abs(p) > 1e9 ? undefined : [p, q];
  }
  return undefined;
}

// Writes (p/q) · top / bottom as a single fraction: \frac{3\pi}{2}, -\sqrt{2}, \frac{2}{e}.
function term(p: number, q: number, top = '', bottom = ''): string {
  const sign = p < 0 ? '-' : '';
  const n = Math.abs(p);
  const numerator = `${n === 1 && top ? '' : n}${top}`;
  if (q === 1 && !bottom) return sign + numerator;
  return `${sign}\\frac{${numerator}}{${q === 1 ? '' : q}${bottom}}`;
}

// Joins two signed terms, positive one first: \pi-1 rather than -1+\pi.
function sum(a: string, b: string): string {
  const [first, second] = a.startsWith('-') && !b.startsWith('-') ? [b, a] : [a, b];
  return second.startsWith('-') ? first + second : `${first}+${second}`;
}

// `maxDenominator` bounds plain fractions; a small bound suits values that are
// arbitrary anyway (a point being dragged along a curve), where 137/50 is just noise.
export function exactForm(v: number, tolerance = 1e-11, maxDenominator = 1000): string | undefined {
  if (!Number.isFinite(v)) return undefined;
  const close = (a: number, b: number) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(v));

  const plain = rational(v, maxDenominator, tolerance);
  if (plain) return term(plain[0], plain[1]);

  for (const [value, top, bottom] of FACTORS) {
    const r = rational(v / value, 12, tolerance);
    if (r) return term(r[0], r[1], top, bottom);
  }

  // A square root of a fraction: √(p/q) = k√m / q once the square part k² is pulled out.
  // Matching v² is looser than matching v for small values, so confirm against v itself.
  const square = rational(v * v, 50, tolerance);
  if (square && close(Math.abs(v), Math.sqrt(square[0] / square[1]))) {
    const [p, q] = square;
    let inside = p * q;
    let outside = 1;
    for (let k = 2; k * k <= inside; k++) {
      while (inside % (k * k) === 0) {
        inside /= k * k;
        outside *= k;
      }
    }
    const common = gcd(outside, q);
    return term(Math.sign(v) * (outside / common), q / common, `\\sqrt{${inside}}`);
  }

  // A cube root of a fraction, written with a whole number under the root: ∛(p/q) = ∛(p·q²) / q.
  const cube = rational(v * v * v, 12, tolerance);
  if (cube && close(v, Math.cbrt(cube[0] / cube[1]))) {
    const [p, q] = cube;
    return term(Math.sign(p), q, `\\sqrt[3]{${Math.abs(p) * q * q}}`);
  }

  // Logarithms and powers of e beyond the listed ones: ln(3/2), e^{3/2}.
  const antilog = rational(Math.exp(v), 20, tolerance);
  if (antilog && antilog[0] > 0 && close(v, Math.log(antilog[0] / antilog[1]))) {
    return `\\ln${antilog[1] === 1 ? ` ${antilog[0]}` : `\\frac{${antilog[0]}}{${antilog[1]}}`}`;
  }
  if (v > 0) {
    const exponent = rational(Math.log(v), 4, tolerance);
    if (exponent && exponent[0] !== 0) return `e^{${term(exponent[0], exponent[1])}}`;
  }

  // (a ± b√n) / c, the shape of a quadratic's roots.
  for (const n of SQUARE_FREE) {
    const root = Math.sqrt(n);
    for (let c = 1; c <= 6; c++) {
      for (let b = 1; b <= 6; b++) {
        for (const sign of [1, -1]) {
          const a = v * c - sign * b * root;
          const whole = Math.round(a);
          if (whole === 0 || Math.abs(whole) > 100) continue;
          if (Math.abs(a - whole) > tolerance * Math.max(1, Math.abs(v)) * c) continue;
          if (gcd(gcd(whole, b), c) !== 1) continue;
          const top = sum(String(whole), term(sign * b, 1, `\\sqrt{${n}}`));
          return c === 1 ? top : `\\frac{${top}}{${c}}`;
        }
      }
    }
  }

  // A rational plus a rational multiple of a constant: 1 + π, π/2 − 1, 2 − ln 2.
  for (const [value, symbol] of ADDENDS) {
    for (let q = 1; q <= 6; q++) {
      for (let p = -6; p <= 6; p++) {
        if (p === 0 || gcd(p, q) !== 1) continue;
        const rest = rational(v - (p / q) * value, 12, tolerance);
        if (rest && rest[0] !== 0) return sum(term(p, q, symbol), term(rest[0], rest[1]));
      }
    }
  }
  return undefined;
}

// A decimal as LaTeX, switching to scientific notation for very large or small values.
export function decimalToLatex(v: number): string {
  if (Number.isNaN(v)) return '\\text{undefined}';
  if (!Number.isFinite(v)) return v > 0 ? '\\infty' : '-\\infty';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9 || abs < 1e-5) {
    const exponent = Math.floor(Math.log10(abs));
    const mantissa = parseFloat((abs / 10 ** exponent).toPrecision(6));
    return `${sign}${mantissa === 1 ? '' : `${mantissa}\\times`}10^{${exponent}}`;
  }
  return sign + String(parseFloat(abs.toPrecision(10)));
}

// The exact form where there is one, otherwise a decimal to `significant` digits.
export function valueToLatex(v: number, significant = 6): string {
  return exactForm(v) ?? decimalToLatex(parseFloat(v.toPrecision(significant)));
}

// A complex value as re + im·i, each part in its exact form where it has one.
export function complexToLatex(re: number, im: number, significant = 6): string {
  if (im === 0 || Number.isNaN(re) || Number.isNaN(im)) return valueToLatex(re + im, significant);
  const size = valueToLatex(Math.abs(im), significant);
  // A sum has to be bracketed before it can multiply i: (1 + π)i.
  const factor = size === '1' ? '' : /[+-]/.test(size.replace(/\{[^{}]*\}/g, '')) ? `\\left(${size}\\right)` : size;
  const imaginary = `${factor}i`;
  if (re === 0) return (im < 0 ? '-' : '') + imaginary;
  return `${valueToLatex(re, significant)}${im < 0 ? '-' : '+'}${imaginary}`;
}
