import { useEffect, useRef } from 'react';
import type { MathfieldElement } from 'mathlive';
import { repairBackspace } from './backspace';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<React.HTMLAttributes<MathfieldElement>, MathfieldElement>;
    }
  }
}

// Function names that become upright operators as they are typed, on top of the ones
// MathLive already knows (sin, ln, gcd, …). Spelled as on a Casio where it has them.
const TYPED_FUNCTIONS = [
  'solve', 'fMin', 'fMax', 'nCr', 'nPr', 'lcm', 'trunc', 'round', 'RndFix', 'Int', 'Frac', 'modexp',
  'sign', 'abs', 'conj', 'polygon', 'arccot', 'csch', 'random', 'randint', 'RanInt', 'RanNorm', 'RanBin',
  'NormPD', 'NormCD', 'InvNormCD', 'tPD', 'tCD', 'InvTCD', 'ChiPD', 'ChiCD', 'InvChiCD', 'FPD', 'FCD', 'InvFCD',
  'BinomialPD', 'BinomialCD', 'InvBinomialCD', 'PoissonPD', 'PoissonCD', 'InvPoissonCD',
  'GeoPD', 'GeoCD', 'InvGeoCD', 'HypergeoPD', 'HypergeoCD',
];

// The smallest a long expression is shrunk to, as a share of the usual size, so it still fits.
const MIN_FIT = 0.6;

// Shrinks the field's text until the whole expression fits its width, as on a phone where
// a long equation would otherwise run off the edge. MathLive clips what doesn't fit, and
// its field can't be swiped along, so this is the only way to see the rest at a glance.
function fitToWidth(field: MathfieldElement) {
  const content = field.shadowRoot?.querySelector<HTMLElement>('[part=content]');
  if (!content) return;
  field.style.fontSize = '';
  const overflow = content.scrollWidth - content.clientWidth;
  if (overflow <= 1 || content.clientWidth === 0) return;
  const base = parseFloat(getComputedStyle(field).fontSize);
  const scale = Math.max(MIN_FIT, (content.clientWidth - 2) / content.scrollWidth);
  field.style.fontSize = `${Math.floor(base * scale * 10) / 10}px`;
}

interface MathFieldProps {
  value: string;
  // Changes whenever this field should take focus.
  focusToken: number;
  label: string;
  // LaTeX shown while the field is empty.
  placeholder?: string;
  onChange(latex: string): void;
  onEnter(): void;
  onDeleteEmpty(): void;
  onLeave(direction: 'up' | 'down'): void;
}

export function MathField(props: MathFieldProps) {
  const ref = useRef<MathfieldElement>(null);
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    const field = ref.current!;
    field.menuItems = [];
    field.smartFence = true;
    field.inlineShortcuts = {
      ...field.inlineShortcuts,
      ...Object.fromEntries(TYPED_FUNCTIONS.map((name) => [name, `\\operatorname{${name}}`])),
    };

    const onInput = () => handlers.current.onChange(field.value);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handlers.current.onEnter();
      } else if (e.key === 'Backspace' && field.value === '') {
        e.preventDefault();
        handlers.current.onDeleteEmpty();
      }
    };
    const onMoveOut = (e: Event) => {
      const direction = (e as CustomEvent<{ direction: string }>).detail.direction;
      if (direction === 'upward') handlers.current.onLeave('up');
      else if (direction === 'downward') handlers.current.onLeave('down');
    };

    field.addEventListener('input', onInput);
    field.addEventListener('keydown', onKeyDown, { capture: true });
    field.addEventListener('move-out', onMoveOut);
    const restoreBackspace = repairBackspace(field, onInput);
    // A field that changes width (the panel dragged, the phone turned) is fitted again,
    // and so is every field once the fonts have arrived and the text has its real width.
    let fitting = 0;
    const fit = () => {
      cancelAnimationFrame(fitting);
      fitting = requestAnimationFrame(() => fitToWidth(field));
    };
    let width = 0;
    const resized = new ResizeObserver(([entry]) => {
      if (Math.abs(entry.contentRect.width - width) < 1) return;
      width = entry.contentRect.width;
      fit();
    });
    resized.observe(field);
    field.addEventListener('input', fit);
    document.fonts.ready.then(fit);
    return () => {
      cancelAnimationFrame(fitting);
      resized.disconnect();
      field.removeEventListener('input', fit);
      restoreBackspace();
      field.removeEventListener('input', onInput);
      field.removeEventListener('keydown', onKeyDown, { capture: true });
      field.removeEventListener('move-out', onMoveOut);
    };
  }, []);

  // Push outside changes (a slider moving, a restored session) into the field.
  useEffect(() => {
    const field = ref.current!;
    if (field.value !== props.value) field.setValue(props.value, { silenceNotifications: true });
    requestAnimationFrame(() => fitToWidth(field));
  }, [props.value]);

  useEffect(() => {
    if (props.placeholder) ref.current!.setAttribute('placeholder', props.placeholder);
    else ref.current!.removeAttribute('placeholder');
  }, [props.placeholder]);

  useEffect(() => {
    if (props.focusToken) ref.current!.focus();
  }, [props.focusToken]);

  return <math-field ref={ref} aria-label={props.label} />;
}
