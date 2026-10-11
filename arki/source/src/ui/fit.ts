import { useLayoutEffect, type RefObject } from 'react';
import { convertLatexToMarkup } from 'mathlive';

// The smallest typeset maths is shrunk to, as a share of its usual size.
const MIN_FIT = 0.6;

// Shrinks an element's text until it fits its width, as on a phone where a long formula
// would otherwise run off the edge. Measured again whenever `content` changes or the
// element changes width.
// `onTooWide` hears whether it still doesn't fit at the smallest size.
export function useFitWidth(ref: RefObject<HTMLElement | null>, content: unknown, onTooWide?: (tooWide: boolean) => void) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      // Late measurements (fonts arriving) are for the element still being fitted only.
      if (ref.current !== el) return;
      el.style.fontSize = '';
      if (el.scrollWidth - el.clientWidth <= 1 || el.clientWidth === 0) return onTooWide?.(false);
      const base = parseFloat(getComputedStyle(el).fontSize);
      const scale = Math.max(MIN_FIT, (el.clientWidth - 2) / el.scrollWidth);
      el.style.fontSize = `${Math.floor(base * scale * 10) / 10}px`;
      onTooWide?.(el.scrollWidth - el.clientWidth > 1);
    };
    fit();
    let width = el.clientWidth;
    const resized = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - width) < 1) return;
      width = el.clientWidth;
      fit();
    });
    resized.observe(el);
    // The maths fonts may arrive after the first measurement, and change the width.
    document.fonts.ready.then(fit);
    return () => resized.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, content]);
}

// A variable in a message (x, y, x², y³), with the letters around it in plain text.
const VARIABLE = /(?<![A-Za-z’'])([xyt])([²³])?(?![A-Za-z’'])/g;
const markup = new Map<string, string>();

// A message as HTML, its variables typeset as maths so they match the expressions:
// "Type a function of x" with the x in the maths font. Everything else is escaped text.
export function messageHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '';
  let last = 0;
  for (const match of text.matchAll(VARIABLE)) {
    const latex = match[1] + (match[2] ? `^{${match[2] === '²' ? 2 : 3}}` : '');
    let html = markup.get(latex);
    if (!html) markup.set(latex, (html = convertLatexToMarkup(latex, { defaultMode: 'math' })));
    out += escape(text.slice(last, match.index)) + html;
    last = match.index + match[0].length;
  }
  return out + escape(text.slice(last));
}

// A formula split where its top-level terms meet, at each + or − outside any brackets or
// braces: `x^{2}+2x\sin x-1` is `x^{2}`, `+2x\sin x` and `-1`. For writing a long one
// over several lines.
export function splitTerms(latex: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < latex.length; i++) {
    if (latex.startsWith('\\left', i)) {
      depth++;
      i += 5;
    } else if (latex.startsWith('\\right', i)) {
      depth--;
      i += 6;
    } else if (latex[i] === '{') depth++;
    else if (latex[i] === '}') depth--;
    else if ((latex[i] === '+' || latex[i] === '-') && depth === 0 && i > start) {
      out.push(latex.slice(start, i));
      start = i;
    }
  }
  out.push(latex.slice(start));
  return out;
}
