import { useEffect, useRef } from 'react';
import type { MathfieldElement } from 'mathlive';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<React.HTMLAttributes<MathfieldElement>, MathfieldElement>;
    }
  }
}

interface MathFieldProps {
  value: string;
  // Changes whenever this field should take focus.
  focusToken: number;
  label: string;
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
    return () => {
      field.removeEventListener('input', onInput);
      field.removeEventListener('keydown', onKeyDown, { capture: true });
      field.removeEventListener('move-out', onMoveOut);
    };
  }, []);

  // Push outside changes (a slider moving, a restored session) into the field.
  useEffect(() => {
    const field = ref.current!;
    if (field.value !== props.value) field.setValue(props.value, { silenceNotifications: true });
  }, [props.value]);

  useEffect(() => {
    if (props.focusToken) ref.current!.focus();
  }, [props.focusToken]);

  return <math-field ref={ref} aria-label={props.label} />;
}
