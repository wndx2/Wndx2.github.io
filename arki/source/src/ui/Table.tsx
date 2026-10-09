import { useEffect, useMemo, useRef, useState } from 'react';
import { convertLatexToMarkup } from 'mathlive';
import type { Plot } from '../math/analyze';
import { valueToLatex } from '../math/exact';
import { MathField } from './MathField';

export interface TableRange {
  // An optional run of evenly spaced values, listed once all three are filled in.
  start?: number;
  end?: number;
  step?: number;
  // Values entered by hand, as the LaTeX typed (so 2π or 1/3 work), listed after the
  // stepped ones in the order they were added.
  extra?: string[];
  // Whether the first and second derivative columns are shown.
  d1?: boolean;
  d2?: boolean;
}

// A new table is empty: it lists only the values typed into it.
export const DEFAULT_TABLE: TableRange = {};

const MAX_ROWS = 1000;

interface Column {
  name: string;
  f: (u: number) => number;
}

interface Columns {
  input: string;
  outputs: Column[];
  // The first and second derivative, for plots that have them.
  derivatives?: [Column, Column];
}

// What a plot tabulates: its input variable and the values worked out from it.
// Curves given only implicitly, and single points, have nothing to tabulate.
export function tableColumns(plot: Plot | undefined): Columns | undefined {
  switch (plot?.kind) {
    case 'fx':
      return {
        input: 'x',
        outputs: [{ name: 'y', f: plot.f }],
        derivatives: [{ name: 'dy/dx', f: plot.d1 }, { name: 'd²y/dx²', f: plot.d2 }],
      };
    case 'fy':
      return {
        input: 'y',
        outputs: [{ name: 'x', f: plot.f }],
        derivatives: [{ name: 'dx/dy', f: plot.d1 }, { name: 'd²x/dy²', f: plot.d2 }],
      };
    case 'polar':
      return { input: 'θ', outputs: [{ name: 'r', f: plot.f }] };
    case 'parametric':
      return { input: 't', outputs: [{ name: 'x', f: plot.x }, { name: 'y', f: plot.y }] };
    default:
      return undefined;
  }
}

function format(v: number): string {
  if (!Number.isFinite(v)) return 'undefined';
  const rounded = Number(v.toPrecision(6));
  const magnitude = Math.abs(rounded);
  const text = magnitude !== 0 && (magnitude >= 1e9 || magnitude < 1e-4) ? rounded.toExponential() : String(rounded);
  return text.replace('-', '−').replace('e+', 'e');
}

const markupCache = new Map<string, string>();

// A worked-out value, typeset and in exact form (π/2, √2, 1/3) when it has one.
function Result({ value }: { value: number | undefined }) {
  if (value === undefined) return <td />;
  // A division by zero comes out as an infinity, which is no value either.
  if (!Number.isFinite(value)) return <td data-undefined>undefined</td>;
  const latex = valueToLatex(value);
  let markup = markupCache.get(latex);
  if (markup === undefined) {
    markup = convertLatexToMarkup(latex, { defaultMode: 'math' });
    if (markupCache.size > 5000) markupCache.clear();
    markupCache.set(latex, markup);
  }
  return <td dangerouslySetInnerHTML={{ __html: markup }} />;
}

interface NumberFieldProps {
  label: string;
  value: number | undefined;
  onChange(value: number | undefined): void;
}

// A number that is only taken up once what's typed is a number; it can be left empty.
function NumberField({ label, value, onChange }: NumberFieldProps) {
  const shown = value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const parsed = Number(draft.replace('−', '-'));
    if (draft.trim() === '') onChange(undefined);
    else if (Number.isFinite(parsed)) onChange(parsed);
    else setDraft(shown);
  };
  return (
    <label className="table-field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

interface TableProps {
  columns: Columns;
  range: TableRange;
  // The value of an expression typed into the table, if it has one.
  evaluate(latex: string): number | undefined;
  onChange(range: TableRange): void;
}

const NO_EXTRA: string[] = [];

export function Table({ columns, range, evaluate, onChange }: TableProps) {
  const { start, end, step, extra = NO_EXTRA } = range;
  const body = useRef<HTMLTableSectionElement>(null);
  // Which hand-entered row should take the focus; the row after the last one is the blank.
  const [focus, setFocus] = useState({ index: -1, token: 0 });
  const focusOn = (index: number) => setFocus((f) => ({ index: Math.max(0, index), token: f.token + 1 }));
  // Keep the blank row in view as values are added above it (but not on opening the
  // table, which shouldn't move the list).
  const listed = useRef(extra.length);
  useEffect(() => {
    if (extra.length > listed.current) body.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
    listed.current = extra.length;
  }, [extra.length]);
  const values = useMemo(() => extra.map((latex) => evaluate(latex)), [extra, evaluate]);
  const setExtra = (index: number, latex: string) => {
    const next = [...extra];
    next[index] = latex;
    // Typing in the blank row makes it a row of its own; emptied rows at the end go again.
    while (next.length > 0 && next[next.length - 1].trim() === '') next.pop();
    onChange({ ...range, extra: next });
  };
  const removeExtra = (index: number) => {
    onChange({ ...range, extra: extra.filter((_, i) => i !== index) });
    focusOn(index - 1);
  };
  // The columns worked out for each row: the plot's values, then any derivatives switched on.
  const outputs = useMemo(() => {
    const [first, second] = columns.derivatives ?? [];
    return [...columns.outputs, ...(range.d1 && first ? [first] : []), ...(range.d2 && second ? [second] : [])];
  }, [columns, range.d1, range.d2]);
  const ranged = start !== undefined && end !== undefined && step !== undefined;
  const count = ranged && step > 0 && end >= start ? Math.floor((end - start) / step + 1e-9) + 1 : 0;
  const rows = useMemo(() => {
    const out: number[][] = [];
    if (start === undefined || step === undefined) return out;
    for (let i = 0; i < Math.min(count, MAX_ROWS); i++) {
      // Rounded so that steps of 0.1 read 0.3, not 0.30000000000000004.
      const u = Number((start + i * step).toPrecision(12));
      out.push([u, ...outputs.map((column) => column.f(u))]);
    }
    return out;
  }, [outputs, start, step, count]);

  return (
    <div className="table">
      <div className="table-range">
        <NumberField label="Start" value={start} onChange={(v) => onChange({ ...range, start: v })} />
        <NumberField label="End" value={end} onChange={(v) => onChange({ ...range, end: v })} />
        <NumberField label="Step" value={step} onChange={(v) => onChange({ ...range, step: v })} />
      </div>
      {columns.derivatives && (
        <div className="table-options">
          <button className="chip" aria-pressed={!!range.d1} onClick={() => onChange({ ...range, d1: !range.d1 })}>
            {columns.derivatives[0].name}
          </button>
          <button className="chip" aria-pressed={!!range.d2} onClick={() => onChange({ ...range, d2: !range.d2 })}>
            {columns.derivatives[1].name}
          </button>
        </div>
      )}
      {ranged && count === 0 && (
        <p className="table-note">{step > 0 ? 'End has to be at least Start.' : 'Step has to be more than 0.'}</p>
      )}
      {
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{columns.input}</th>
                {outputs.map((column) => (
                  <th key={column.name} scope="col">
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={body}>
              {rows.map((row) => (
                <tr key={row[0]}>
                  <td>{format(row[0])}</td>
                  {row.slice(1).map((v, i) => (
                    <Result key={i} value={v} />
                  ))}
                </tr>
              ))}
              {[...extra, ''].map((latex, index) => {
                const u = values[index];
                return (
                  <tr key={`own-${index}`} className="table-own">
                    <td>
                      <MathField
                        value={latex}
                        focusToken={focus.index === index ? focus.token : 0}
                        label={index < extra.length ? `Your ${columns.input} value` : `Add your own ${columns.input} value`}
                        placeholder={index < extra.length ? undefined : '\\text{Add}'}
                        onChange={(next) => setExtra(index, next)}
                        onEnter={() => focusOn(index + 1)}
                        onDeleteEmpty={() => removeExtra(index)}
                        onLeave={(direction) => focusOn(index + (direction === 'up' ? -1 : 1))}
                      />
                    </td>
                    {outputs.map((column) => (
                      <Result key={column.name} value={u === undefined ? undefined : column.f(u)} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      }
      {count > MAX_ROWS && <p className="table-note">Showing the first {MAX_ROWS} of {count} rows.</p>}
    </div>
  );
}
