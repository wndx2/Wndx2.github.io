import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { convertLatexToMarkup } from 'mathlive';
import { CURVE_WIDTH, type LineStyle, type PointStyle } from '../graph/render';
import type { Analysis } from '../math/analyze';
import { nameToLatex } from '../math/parser';
import { complexToLatex } from '../math/exact';
import { applyTrigOption, trigTerms, type TrigTerm } from '../math/trig';
import { ChevronIcon, CloseIcon, CopyIcon, EyeIcon, EyeOffIcon, MoreIcon, MoveIcon, NoteIcon, PlusIcon, TableIcon, TagIcon, WarningIcon } from './icons';
import { MathField } from './MathField';
import { PALETTE, colorOf, parseHex, type CurveColor } from './palette';
import { Popover } from './Popover';
import { Slider, type SliderMotion } from './Slider';
import { DEFAULT_TABLE, Table, tableColumns, type TableRange } from './Table';

export interface Expression extends SliderMotion {
  id: string;
  latex: string;
  color: CurveColor;
  hidden: boolean;
  // Slider range, used when the expression is `name = number`.
  min: number;
  max: number;
  // Present while the expression's table of values is open.
  table?: TableRange;
  // Present on a note: a row of plain text, with no maths in it.
  note?: string;
  // Present on a folder: its title. The rows that follow it and name it as their
  // `parent` are inside it.
  folder?: string;
  // On a folder, whether its rows are tucked away.
  collapsed?: boolean;
  // The folder this row is in.
  parent?: string;
  // Whether a point can be moved by dragging it on the graph; off unless switched on.
  draggable?: boolean;
  // Text shown beside a point while its label is on; empty shows its coordinates.
  label?: string;
  // How a point is drawn; a filled dot unless set.
  pointStyle?: PointStyle;
  // How a curve is drawn; a solid line unless set.
  lineStyle?: LineStyle;
  // The curve's thickness in pixels; the usual width unless set.
  lineWidth?: number;
  // From 0 (invisible) to 1 (solid); solid unless set.
  opacity?: number;
  // Whether the inside of a polygon or an inequality is shaded; it is unless set to false.
  fill?: boolean;
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
  // Adds a copy of this row below it; a folder is copied with everything in it.
  onDuplicate(): void;
  onLeave(direction: 'up' | 'down'): void;
  onAddSliders(names: string[]): void;
  // Adds an expression at the end of this folder.
  onAddInside(): void;
  // How many folders deep the row is, and whether any of them is hidden from the graph.
  depth: number;
  folderHidden: boolean;
}

const plainName = (name: string) => nameToLatex(name).replace(/[\\{}]/g, '');

// A row of plain text among the expressions. It grows with what is written in it.
function NoteRow({ text, expression, focusToken, depth, ...on }: { text: string } & Pick<RowProps, 'expression' | 'focusToken' | 'depth' | 'onChange' | 'onRemove' | 'onLeave' | 'onDuplicate'>) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = field.current!;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  useEffect(() => {
    if (focusToken) field.current!.focus();
  }, [focusToken]);

  return (
    <div className="row row-note" data-row-id={expression.id} data-nested={depth > 0 || undefined} style={{ '--depth': depth } as CSSProperties}>
      <div className="swatch">
        <span className="note-mark">
          <NoteIcon />
        </span>
      </div>
      <textarea
        ref={field}
        className="note-field"
        aria-label="Note"
        placeholder="Note"
        rows={1}
        value={text}
        onChange={(e) => on.onChange({ note: e.currentTarget.value })}
        onKeyDown={(e) => {
          const { selectionStart, selectionEnd, value } = e.currentTarget;
          if (e.key === 'Backspace' && value === '') {
            e.preventDefault();
            on.onRemove();
          } else if (e.key === 'ArrowUp' && selectionEnd === 0) on.onLeave('up');
          else if (e.key === 'ArrowDown' && selectionStart === value.length) on.onLeave('down');
        }}
      />
      <div className="row-buttons">
        <button className="icon-button row-copy" aria-label="Duplicate note" onClick={on.onDuplicate}>
          <CopyIcon />
        </button>
        <button className="icon-button row-delete" aria-label="Delete note" onClick={on.onRemove}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

// The heading of a folder: its title, with controls for everything inside it.
function FolderRow({ expression, focusToken, depth, folderHidden, ...on }: Pick<RowProps, 'expression' | 'focusToken' | 'depth' | 'folderHidden' | 'onChange' | 'onEnter' | 'onRemove' | 'onLeave' | 'onAddInside' | 'onDuplicate'>) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusToken) field.current!.focus();
  }, [focusToken]);
  const { collapsed, hidden } = expression;

  return (
    <div
      className="row row-folder"
      data-row-id={expression.id}
      data-hidden={hidden || folderHidden || undefined}
      data-nested={depth > 0 || undefined}
      style={{ '--depth': depth } as CSSProperties}
    >
      <button
        className="swatch folder-toggle"
        aria-label={collapsed ? 'Open folder' : 'Close folder'}
        aria-expanded={!collapsed}
        onClick={() => on.onChange({ collapsed: collapsed ? undefined : true })}
      >
        <ChevronIcon />
      </button>
      <input
        ref={field}
        className="folder-title"
        aria-label="Folder name"
        placeholder="Folder"
        value={expression.folder}
        onChange={(e) => on.onChange({ folder: e.currentTarget.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') on.onEnter();
          else if (e.key === 'Backspace' && e.currentTarget.value === '') {
            e.preventDefault();
            on.onRemove();
          } else if (e.key === 'ArrowUp') on.onLeave('up');
          else if (e.key === 'ArrowDown') on.onLeave('down');
        }}
      />
      <div className="row-buttons">
        <button
          className="icon-button row-more"
          aria-label={hidden ? 'Show folder on graph' : 'Hide folder from graph'}
          onClick={() => on.onChange({ hidden: !hidden })}
        >
          {hidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
        <button className="icon-button row-more" aria-label="Add expression to folder" onClick={on.onAddInside}>
          <PlusIcon />
        </button>
        <button className="icon-button row-copy" aria-label="Duplicate folder" onClick={on.onDuplicate}>
          <CopyIcon />
        </button>
        <button className="icon-button row-delete" aria-label="Delete folder" onClick={on.onRemove}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

export function ExpressionRow(props: RowProps) {
  const { note, folder } = props.expression;
  if (folder !== undefined) return <FolderRow {...props} />;
  if (note !== undefined) return <NoteRow text={note} {...props} />;
  return <MathRow {...props} />;
}

function MathRow({ expression, analysis, dark, focusToken, evaluate, depth, folderHidden, ...on }: RowProps) {
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
    <div
      className="row"
      data-row-id={expression.id}
      data-hidden={expression.hidden || folderHidden || undefined}
      data-nested={depth > 0 || undefined}
      style={{ '--curve': color, '--depth': depth } as CSSProperties}
    >
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
            motion={expression}
            onChange={setSlider}
            onBounds={(min, max) => on.onChange({ min, max })}
            onMotion={on.onChange}
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
        {plot?.kind === 'point' && (
          <button
            className="icon-button row-more"
            aria-label="Label on the graph"
            aria-pressed={expression.label !== undefined}
            onClick={() => on.onChange({ label: expression.label === undefined ? '' : undefined })}
          >
            <TagIcon />
          </button>
        )}
        {plot?.kind === 'point' && plot.drag && (
          <button
            className="icon-button row-more"
            aria-label="Drag on the graph"
            title={expression.draggable ? 'Dragging on' : 'Dragging off'}
            aria-pressed={!!expression.draggable}
            onClick={() => on.onChange({ draggable: !expression.draggable })}
          >
            <MoveIcon />
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
        <button className="icon-button row-copy" aria-label="Duplicate expression" onClick={on.onDuplicate}>
          <CopyIcon />
        </button>
        <button className="icon-button row-delete" aria-label="Delete expression" onClick={on.onRemove}>
          <CloseIcon />
        </button>
      </div>

      {plot?.kind === 'point' && expression.label !== undefined && (
        <input
          className="row-label"
          aria-label="Label"
          placeholder="Label — empty shows the coordinates"
          spellCheck={false}
          value={expression.label}
          onChange={(e) => on.onChange({ label: e.currentTarget.value })}
        />
      )}

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
          isPoint={plot?.kind === 'point'}
          hasInside={plot?.kind === 'polygon' || (plot?.kind === 'implicit' && plot.region)}
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
  isPoint: boolean;
  // A polygon or an inequality, whose inside can be shaded or left clear.
  hasInside: boolean;
  dark: boolean;
  onChange(patch: Partial<Expression>): void;
  onClose(): void;
}

// The ways a point can be drawn, each with a picture of itself for its button.
const POINT_STYLES: { style: PointStyle | undefined; name: string; glyph: ReactNode }[] = [
  { style: undefined, name: 'Filled', glyph: <circle cx="10" cy="10" r="5" fill="currentColor" stroke="none" /> },
  { style: 'open', name: 'Open', glyph: <circle cx="10" cy="10" r="4.5" /> },
  { style: 'cross', name: 'Cross', glyph: <path d="M5.5 5.5l9 9M5.5 14.5l9-9" /> },
];

const LINE_STYLES: { style: LineStyle | undefined; name: string; glyph: ReactNode }[] = [
  { style: undefined, name: 'Solid', glyph: <path d="M3 10h14" /> },
  { style: 'dashed', name: 'Dashed', glyph: <path d="M3 10h14" strokeDasharray="4 3" /> },
  { style: 'dotted', name: 'Dotted', glyph: <path d="M3.5 10h14" strokeDasharray="0 3.25" /> },
];

function StylePopover({ anchor, expression, isPoint, hasInside, dark, onChange, onClose }: StylePopoverProps) {
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
      {isPoint && (
        <div className="segments" role="group" aria-label="Point style">
          {POINT_STYLES.map(({ style, name, glyph }) => (
            <button
              key={name}
              className="segment"
              aria-label={name}
              aria-pressed={expression.pointStyle === style}
              onClick={() => onChange({ pointStyle: style, hidden: false })}
            >
              <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {glyph}
              </svg>
            </button>
          ))}
        </div>
      )}
      {!isPoint && (
        <div className="segments" role="group" aria-label="Line style">
          {LINE_STYLES.map(({ style, name, glyph }) => (
            <button
              key={name}
              className="segment"
              aria-label={name}
              aria-pressed={expression.lineStyle === style}
              onClick={() => onChange({ lineStyle: style, hidden: false })}
            >
              <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {glyph}
              </svg>
            </button>
          ))}
        </div>
      )}
      {!isPoint && (
        <label className="style-slider">
          <span>Thickness</span>
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={expression.lineWidth ?? CURVE_WIDTH}
            style={{ '--curve': current } as CSSProperties}
            // Back on the usual width, nothing is stored.
            onChange={(e) => {
              const width = Number(e.currentTarget.value);
              onChange({ lineWidth: width === CURVE_WIDTH ? undefined : width, hidden: false });
            }}
          />
        </label>
      )}
      {hasInside && (
        <div className="segments" role="group" aria-label="Inside">
          <button className="segment" aria-pressed={expression.fill !== false} onClick={() => onChange({ fill: undefined, hidden: false })}>
            Shaded
          </button>
          <button className="segment" aria-pressed={expression.fill === false} onClick={() => onChange({ fill: false, hidden: false })}>
            Outline only
          </button>
        </div>
      )}
      <label className="style-slider">
        <span>Opacity</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={expression.opacity ?? 1}
          style={{ '--curve': current } as CSSProperties}
          onChange={(e) => {
            const opacity = Number(e.currentTarget.value);
            onChange({ opacity: opacity === 1 ? undefined : opacity, hidden: false });
          }}
        />
      </label>
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
