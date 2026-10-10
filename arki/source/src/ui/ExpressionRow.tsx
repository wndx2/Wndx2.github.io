import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { convertLatexToMarkup } from 'mathlive';
import type { Analysis } from '../math/analyze';
import { nameToLatex } from '../math/parser';
import { complexToLatex } from '../math/exact';
import { applyTrigOption, trigTerms, type TrigTerm } from '../math/trig';
import { CloseIcon, MoreIcon, TableIcon, WarningIcon } from './icons';
import { MathField } from './MathField';
import { PALETTE, colorOf, parseHex, type CurveColor } from './palette';
import { Popover } from './Popover';
import { Slider } from './Slider';
import { DEFAULT_TABLE, Table, tableColumns, type TableRange } from './Table';

export interface Expression {
  id: string;
  latex: string;
  color: CurveColor;
  hidden: boolean;
  // Slider range, used when the expression is `name = number`.
  min: number;
  max: number;
  // Present while the expression's table of values is open.
  table?: TableRange;
}

interface RowProps {
  expression: Expression;
  analysis: Analysis;
  dark: boolean;
  focusToken: number;
  // The value of a stand-alone expression, given everything defined in the list.
  evaluate(latex: string): number | undefined;
  onChange(patch: Partial<Expression>): void;
  onEnter(): void;
  onRemove(): void;
  onLeave(direction: 'up' | 'down'): void;
  onAddSliders(names: string[]): void;
}

const plainName = (name: string) => nameToLatex(name).replace(/[\\{}]/g, '');

export function ExpressionRow({ expression, analysis, dark, focusToken, evaluate, ...on }: RowProps) {
  const swatch = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [styling, setStyling] = useState(false);
  const [converting, setConverting] = useState(false);
  // The trig pieces of this expression that have equivalent forms to offer.
  const terms = useMemo(() => trigTerms(expression.latex), [expression.latex]);
  // The menu's button goes away with the last trig piece; don't leave the menu marked open.
  useEffect(() => {
    if (terms.length === 0) setConverting(false);
  }, [terms.length]);
  const { plot, slider, error, softError, missing = [] } = analysis;
  const color = colorOf(expression.color, dark);
  const columns = useMemo(() => tableColumns(plot), [plot]);
  const showMessage = error && !softError && missing.length === 0;
  // Results are typeset, and shown in exact form (π/2, √2, 1/3) when they have one.
  const valueMarkup = useMemo(
    () =>
      analysis.value === undefined
        ? undefined
        : convertLatexToMarkup(`=${complexToLatex(analysis.value, analysis.imaginary ?? 0)}`, { defaultMode: 'math' }),
    [analysis.value, analysis.imaginary],
  );

  const setSlider = (value: number) => {
    const prefix = expression.latex.slice(0, expression.latex.indexOf('=') + 1);
    on.onChange({ latex: prefix + String(value) });
  };

  return (
    <div className="row" data-hidden={expression.hidden || undefined} style={{ '--curve': color } as CSSProperties}>
      {error && !softError ? (
        <div className="swatch" title={error}>
          <span className="swatch-warning">
            <WarningIcon />
          </span>
        </div>
      ) : plot ? (
        <button
          ref={swatch}
          className="swatch"
          aria-label="Colour and visibility"
          aria-expanded={styling}
          onClick={() => setStyling((open) => !open)}
        >
          <span className="swatch-dot" />
        </button>
      ) : (
        <div className="swatch">
          <span className="swatch-none" />
        </div>
      )}

      <div className="row-body">
        <MathField
          value={expression.latex}
          focusToken={focusToken}
          label="Expression"
          onChange={(latex) => on.onChange({ latex })}
          onEnter={on.onEnter}
          onDeleteEmpty={on.onRemove}
          onLeave={on.onLeave}
        />
        {slider && (
          <Slider
            label={plainName(slider.name)}
            value={slider.value}
            min={expression.min}
            max={expression.max}
            onChange={setSlider}
            onBounds={(min, max) => on.onChange({ min, max })}
          />
        )}
        {valueMarkup && <div className="row-value" dangerouslySetInnerHTML={{ __html: valueMarkup }} />}
        {showMessage && <div className="row-message">{error}</div>}
        {missing.length > 0 && (
          <div className="row-actions">
            <span>Add slider</span>
            {missing.map((name) => (
              <button key={name} className="chip" onClick={() => on.onAddSliders([name])}>
                {plainName(name)}
              </button>
            ))}
            {missing.length > 1 && (
              <button className="chip" onClick={() => on.onAddSliders(missing)}>
                all
              </button>
            )}
          </div>
        )}
      </div>

      <div className="row-buttons">
        {terms.length > 0 && (
          <button
            ref={more}
            className="icon-button row-more"
            aria-label="Convert trig functions"
            aria-expanded={converting}
            onClick={() => setConverting((open) => !open)}
          >
            <MoreIcon />
          </button>
        )}
        {columns && (
          <button
            className="icon-button row-more"
            aria-label="Table of values"
            aria-expanded={!!expression.table}
            onClick={() => on.onChange({ table: expression.table ? undefined : DEFAULT_TABLE })}
          >
            <TableIcon />
          </button>
        )}
        <button className="icon-button row-delete" aria-label="Delete expression" onClick={on.onRemove}>
          <CloseIcon />
        </button>
      </div>

      {columns && expression.table && (
        <Table columns={columns} range={expression.table} evaluate={evaluate} onChange={(table) => on.onChange({ table })} />
      )}

      {converting && more.current && terms.length > 0 && (
        <TrigPopover
          anchor={more.current}
          latex={expression.latex}
          terms={terms}
          onConvert={(latex) => on.onChange({ latex })}
          onClose={() => setConverting(false)}
        />
      )}

      {styling && swatch.current && (
        <StylePopover
          anchor={swatch.current}
          expression={expression}
          dark={dark}
          onChange={on.onChange}
          onClose={() => setStyling(false)}
        />
      )}
    </div>
  );
}

interface StylePopoverProps {
  anchor: HTMLElement;
  expression: Expression;
  dark: boolean;
  onChange(patch: Partial<Expression>): void;
  onClose(): void;
}

function StylePopover({ anchor, expression, dark, onChange, onClose }: StylePopoverProps) {
  const current = colorOf(expression.color, dark);
  // What's typed in the hex field; it only becomes the curve's colour once it's valid.
  const [draft, setDraft] = useState(current);
  const pick = (color: CurveColor) => {
    setDraft(colorOf(color, dark));
    onChange({ color, hidden: false });
  };
  const type = (text: string) => {
    setDraft(text);
    const hex = parseHex(text);
    if (hex) onChange({ color: hex, hidden: false });
  };

  return (
    <Popover anchor={anchor} label="Colour and visibility" onClose={onClose}>
      <div className="popover-colors">
        {PALETTE.map((entry, index) => (
          <button
            key={entry.name}
            className="color-choice"
            aria-label={entry.name}
            aria-pressed={expression.color === index}
            style={{ '--curve': dark ? entry.dark : entry.light } as CSSProperties}
            onClick={() => pick(index)}
          />
        ))}
      </div>
      <div className="hex-row">
        <input
          type="color"
          className="hex-well"
          aria-label="Pick a custom colour"
          value={parseHex(current) ?? '#000000'}
          onChange={(e) => pick(e.currentTarget.value)}
        />
        <input
          className="hex-field"
          aria-label="Hex colour"
          aria-invalid={parseHex(draft) === undefined}
          placeholder="#007aff"
          spellCheck={false}
          autoCapitalize="off"
          maxLength={7}
          value={draft}
          onChange={(e) => type(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && parseHex(draft)) onClose();
          }}
        />
      </div>
      <button
        className="popover-action"
        onClick={() => {
          onChange({ hidden: !expression.hidden });
          onClose();
        }}
      >
        {expression.hidden ? 'Show on graph' : 'Hide from graph'}
      </button>
    </Popover>
  );
}

const typeset = (latex: string) => ({ __html: convertLatexToMarkup(latex, { defaultMode: 'math' }) });

interface TrigPopoverProps {
  anchor: HTMLElement;
  latex: string;
  terms: TrigTerm[];
  onConvert(latex: string): void;
  onClose(): void;
}

// One section per trig piece in the expression, each listing its equivalent forms.
// Choosing a form rewrites just that piece; the menu stays open for the next one.
function TrigPopover({ anchor, latex, terms, onConvert, onClose }: TrigPopoverProps) {
  return (
    <Popover anchor={anchor} label="Convert trig functions" className="trig-popover" onClose={onClose}>
      {terms.map((term) => (
        <section key={`${term.start}-${term.end}`} className="trig-term">
          <h2>
            <span>Rewrite</span>
            <span dangerouslySetInnerHTML={typeset(term.source)} />
          </h2>
          {term.options.map((option) => (
            <button
              key={option}
              className="trig-option"
              onClick={() => onConvert(applyTrigOption(latex, term, option))}
              dangerouslySetInnerHTML={typeset(option.replace(/^\\cdot /, ''))}
            />
          ))}
        </section>
      ))}
    </Popover>
  );
}
