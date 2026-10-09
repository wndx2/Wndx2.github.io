import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  // The button that opened it; the popover grows out of this element.
  anchor: HTMLElement;
  label: string;
  className?: string;
  onClose(): void;
  children: ReactNode;
}

// A small floating surface anchored to its trigger. Closes on Escape or a press outside.
export function Popover({ anchor, label, className, onClose, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  // Open below the trigger, or above it when there is more room there, and never
  // taller than the space available.
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const width = ref.current!.offsetWidth;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    if (below >= Math.min(ref.current!.scrollHeight, 240) || below >= above) {
      setStyle({ left, top: rect.bottom + 4, maxHeight: below, transformOrigin: `${rect.left - left + 16}px 0` });
    } else {
      setStyle({ left, bottom: window.innerHeight - rect.top + 4, maxHeight: above, transformOrigin: `${rect.left - left + 16}px 100%` });
    }
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [anchor, onClose]);

  // Rendered at the document root: the panel's backdrop filter would otherwise clip it.
  return createPortal(
    <div ref={ref} className={`popover ${className ?? ''}`} role="dialog" aria-label={label} style={style}>
      {children}
    </div>,
    document.body,
  );
}
