import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { PauseIcon, PlayIcon, TuneIcon } from './icons';
import { Popover } from './Popover';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  motion: SliderMotion;
  onChange(value: number): void;
  onBounds(min: number, max: number): void;
  onMotion(patch: SliderMotion): void;
}

// What a slider does at the end of its range while it plays: turn round, start again
// from the other end, or stop.
export type SliderLoop = 'bounce' | 'loop' | 'once';

// How a slider moves, by hand and by itself. Everything is optional: left out, the step
// suits the range, the speed is 1 and the slider bounces.
export interface SliderMotion {
  step?: number;
  playing?: boolean;
  speed?: number;
  loop?: SliderLoop;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const LOOPS: { loop: SliderLoop; name: string }[] = [
  { loop: 'bounce', name: 'Bounce' },
  { loop: 'loop', name: 'Loop' },
  { loop: 'once', name: 'Once' },
];

// About two hundred stops across the range, on a power of ten so values read cleanly.
export function stepFor(min: number, max: number): number {
  return 10 ** (Math.floor(Math.log10(max - min)) - 2);
}

// The stop nearest `value`, counting steps from the bottom of the range.
export function snap(value: number, step: number, min: number): number {
  return parseFloat((min + Math.round((value - min) / step) * step).toPrecision(12));
}

export function Slider({ label, value, min, max, motion, onChange, onBounds, onMotion }: SliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const options = useRef<HTMLButtonElement>(null);
  const grabOffset = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [tuning, setTuning] = useState(false);
  const step = motion.step ?? stepFor(min, max);
  const fraction = Math.min(1, Math.max(0, (value - min) / (max - min)));

  const valueAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - grabOffset.current - rect.left) / rect.width));
    return Math.min(max, snap(min + t * (max - min), step, min));
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
    const next = snap(value + direction * step * (e.shiftKey ? 10 : 1), step, min);
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

  const commitStep = (text: string) => {
    const n = Number(text);
    // Cleared, or anything that isn't a usable step, goes back to one that suits the range.
    onMotion({ step: text.trim() !== '' && Number.isFinite(n) && n > 0 && n <= max - min ? n : undefined });
  };

  return (
    <div className="slider">
      <button
        className="icon-button slider-button"
        aria-label={motion.playing ? `Pause ${label}` : `Play ${label}`}
        onClick={() => onMotion({ playing: !motion.playing })}
      >
        {motion.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
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
      <button
        ref={options}
        className="icon-button slider-button"
        aria-label={`${label} step and animation`}
        aria-expanded={tuning}
        onClick={() => setTuning((open) => !open)}
      >
        <TuneIcon />
      </button>
      {tuning && options.current && (
        <Popover anchor={options.current} label={`${label} step and animation`} className="slider-popover" onClose={() => setTuning(false)}>
          <label className="slider-option">
            <span>Step</span>
            <input
              // Remount when the step changes so a rejected edit snaps back.
              key={motion.step ?? 'auto'}
              className="hex-field"
              inputMode="decimal"
              placeholder={`Auto (${stepFor(min, max)})`}
              defaultValue={motion.step ?? ''}
              onBlur={(e) => commitStep(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
          <div className="slider-option">
            <span>Speed</span>
            <div className="segments" role="group" aria-label="Speed">
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  className="segment"
                  aria-pressed={(motion.speed ?? 1) === speed}
                  onClick={() => onMotion({ speed: speed === 1 ? undefined : speed })}
                >
                  {speed}×
                </button>
              ))}
            </div>
          </div>
          <div className="slider-option">
            <span>At the end</span>
            <div className="segments" role="group" aria-label="At the end">
              {LOOPS.map(({ loop, name }) => (
                <button
                  key={loop}
                  className="segment"
                  aria-pressed={(motion.loop ?? 'bounce') === loop}
                  onClick={() => onMotion({ loop: loop === 'bounce' ? undefined : loop })}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}
