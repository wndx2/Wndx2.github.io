import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  onBounds(min: number, max: number): void;
}

// About two hundred stops across the range, on a power of ten so values read cleanly.
function stepFor(min: number, max: number): number {
  return 10 ** (Math.floor(Math.log10(max - min)) - 2);
}

function snap(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return parseFloat((Math.round(value / step) * step).toFixed(decimals));
}

export function Slider({ label, value, min, max, onChange, onBounds }: SliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const grabOffset = useRef(0);
  const [dragging, setDragging] = useState(false);
  const step = stepFor(min, max);
  const fraction = Math.min(1, Math.max(0, (value - min) / (max - min)));

  const valueAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - grabOffset.current - rect.left) / rect.width));
    return snap(min + t * (max - min), step);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Grabbing the thumb keeps it under the finger where it was grabbed;
    // pressing the track brings the thumb to the finger straight away.
    const rect = track.current!.getBoundingClientRect();
    const thumbX = rect.left + fraction * rect.width;
    grabOffset.current = Math.abs(e.clientX - thumbX) <= 14 ? e.clientX - thumbX : 0;
    setDragging(true);
    if (grabOffset.current === 0) onChange(valueAt(e.clientX));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onChange(valueAt(e.clientX));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const direction = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!direction) return;
    e.preventDefault();
    const next = snap(value + direction * step * (e.shiftKey ? 10 : 1), step);
    onChange(Math.min(max, Math.max(min, next)));
  };

  const commitBound = (which: 'min' | 'max', text: string) => {
    const n = Number(text.replace('−', '-'));
    if (text.trim() === '' || !Number.isFinite(n)) return;
    if (which === 'min' && n < max) onBounds(n, max);
    if (which === 'max' && n > min) onBounds(min, n);
  };

  const bound = (which: 'min' | 'max', current: number) => (
    <input
      // Remount when the bound changes so a rejected edit snaps back.
      key={current}
      className="slider-bound"
      defaultValue={current}
      inputMode="decimal"
      aria-label={`${label} ${which === 'min' ? 'minimum' : 'maximum'}`}
      onBlur={(e) => {
        commitBound(which, e.currentTarget.value);
        e.currentTarget.value = String(current);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );

  return (
    <div className="slider">
      {bound('min', min)}
      <div
        className="slider-track"
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        data-dragging={dragging || undefined}
        style={{ '--fraction': fraction } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={onKeyDown}
      >
        <div className="slider-fill" />
        <div className="slider-thumb" />
      </div>
      {bound('max', max)}
    </div>
  );
}
