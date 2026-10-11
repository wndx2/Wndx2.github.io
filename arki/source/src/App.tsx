import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { convertLatexToMarkup } from 'mathlive';
import { Graph, type Bounds, type GraphHandle } from './graph/Graph';
import { DEFAULT_SETTINGS, type Drawable, type GraphSettings } from './graph/render';
import { analyze } from './math/analyze';
import { complexToLatex } from './math/exact';
import { nameToLatex } from './math/parser';
import { ExpressionRow, type DataResult, type Expression } from './ui/ExpressionRow';
import { fit } from './math/regression';
import { labelExpressions, labelToLatex, plainToLatex } from './ui/label';
import { Popover } from './ui/Popover';
import { snap, stepFor } from './ui/Slider';
import { DerivativeIcon, FolderIcon, FunctionIcon, IntegralIcon, NoteIcon, TableIcon, WrenchIcon } from './ui/icons';
import { HelpIcon, HomeIcon, ImageIcon, KeyboardIcon, LinkIcon, MinusIcon, MoonIcon, PlusIcon, RedoIcon, SidebarIcon, SunIcon, UndoIcon } from './ui/icons';
import { Help } from './ui/Help';
import { DEFAULT_COLOR, colorOf } from './ui/palette';
import type { TableRange } from './ui/Table';
import star from './images/star.png';
import { decodeGraph, encodeGraph, linkTo, sharedInLocation } from './share';

// The mark on the link to Ni Brain Too Sht: ℕ, typeset in blackboard bold.
const NATURALS = convertLatexToMarkup('\\mathbb{N}', { defaultMode: 'math' });

const STORAGE_KEY = 'arki:expressions:v1';
const THEME_KEY = 'arki:theme';
// How long switching between light and dark takes, in ms (as in the stylesheet).
const THEME_FADE = 500;
const PANEL_WIDTH = 360;
const PANEL_MIN_WIDTH = 280;
const PANEL_MIN_HEIGHT = 120;
const PANEL_KEY = 'arki:panel:v1';
const SETTINGS_KEY = 'arki:graph:v1';
// Seconds a playing slider takes to cross its range at normal speed.
const SLIDER_SWEEP = 4;
const PANEL_MARGIN = 12;
const NARROW = '(max-width: 640px)';

let nextId = 0;
const newExpression = (latex: string, color = DEFAULT_COLOR): Expression => ({
  id: `${Date.now().toString(36)}-${nextId++}`,
  latex,
  color,
  hidden: false,
  min: -10,
  max: 10,
});

// A saved expression, with anything an older version stored differently put right:
// a table's own values were once numbers, and are LaTeX now.
function restore(stored: Expression, _: number, all: Expression[]): Expression {
  // Nothing is moving when a visit starts, and nothing is in a folder that isn't there.
  let saved = stored.playing ? { ...stored, playing: undefined } : stored;
  if (saved.parent && !all.some((e) => e.id === saved.parent && e.folder !== undefined)) saved = { ...saved, parent: undefined };
  const table = saved.table as (Omit<TableRange, 'extra'> & { extra?: unknown }) | undefined;
  if (!table) return saved;
  if (![table.start, table.end, table.step].every((v) => v == null || (typeof v === 'number' && Number.isFinite(v)))) {
    return { ...saved, table: undefined };
  }
  const extra = (Array.isArray(table.extra) ? table.extra : [])
    .map((value) => (typeof value === 'number' ? String(value) : value))
    .filter((value): value is string => typeof value === 'string');
  return { ...saved, table: { ...table, extra } };
}

function loadExpressions(): Expression[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.length > 0) return saved.map(restore);
  } catch {
    // Unreadable storage just means starting fresh.
  }
  return [newExpression('\\left(x^2+y^2-1\\right)^3=x^2y^3', 1)];
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// Publishes how much of the bottom of the screen a keyboard covers as `--keyboard-inset`,
// so the panel can sit above it. Covers both the maths keyboard and the system one.
function useKeyboardInset() {
  useEffect(() => {
    const keyboard = window.mathVirtualKeyboard;
    const viewport = window.visualViewport;
    const update = () => {
      const backdrop = keyboard.visible ? document.querySelector<HTMLElement>('.MLK__backdrop') : null;
      const maths = backdrop?.offsetHeight ?? 0;
      const system = viewport ? window.innerHeight - viewport.height - viewport.offsetTop : 0;
      document.documentElement.style.setProperty('--keyboard-inset', `${Math.max(0, maths, Math.round(system))}px`);
      // The panel has just changed size; keep the row being edited inside it.
      requestAnimationFrame(() => document.activeElement?.scrollIntoView({ block: 'nearest' }));
    };
    update();
    keyboard.addEventListener('geometrychange', update);
    keyboard.addEventListener('virtual-keyboard-toggle', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      keyboard.removeEventListener('geometrychange', update);
      keyboard.removeEventListener('virtual-keyboard-toggle', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, []);
}

// Light or dark. It follows the system until one is chosen with the navbar's switch;
// the choice is remembered. (index.html applies it before the first paint.)
function useTheme(): [boolean, () => void] {
  const system = useMediaQuery('(prefers-color-scheme: dark)');
  const [chosen, setChosen] = useState<boolean | undefined>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === 'dark' ? true : saved === 'light' ? false : undefined;
    } catch {
      return undefined;
    }
  });
  const dark = chosen ?? system;
  // Set before the browser paints, so the new colours are what the switch fades to.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    // MathLive's keyboard takes its theme from this attribute.
    root.setAttribute('theme', dark ? 'dark' : 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e0e10' : '#ffffff');
  }, [dark]);
  const switching = useRef(0);
  const toggle = () => {
    // The colours ease from one theme to the other (see `theme-switching` in the
    // stylesheet) on the live page, so glass keeps its blur all the way through. A
    // snapshot cross-fade can't: blur isn't part of the snapshots.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const root = document.documentElement;
      root.classList.add('theme-switching');
      clearTimeout(switching.current);
      switching.current = window.setTimeout(() => root.classList.remove('theme-switching'), THEME_FADE + 60);
    }
    flushSync(() => setChosen(!dark));
    try {
      localStorage.setItem(THEME_KEY, dark ? 'light' : 'dark');
    } catch {
      // Without storage the choice just lasts for this visit.
    }
  };
  return [dark, toggle];
}

const focusedField = () => (document.activeElement?.tagName === 'MATH-FIELD' ? document.activeElement : null);

// The on-screen maths keyboard appears by itself on touch devices. Elsewhere it is
// switched on by hand, and then follows the field being edited in the same way.
function useKeyboardSwitch(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) {
      window.mathVirtualKeyboard.hide();
      return;
    }
    const show = () => {
      if (focusedField()) window.mathVirtualKeyboard.show({ animate: true });
    };
    show();
    document.addEventListener('focusin', show);
    return () => document.removeEventListener('focusin', show);
  }, [on]);
  return [on, setOn];
}

// A number as it is written into an expression: plain digits, never 1e-7.
const numberText = (value: number) => {
  const text = String(value);
  return text.includes('e') ? value.toFixed(12).replace(/\.?0+$/, '') : text;
};

// The folders a row is in, from the one it sits in directly out to the outermost.
function foldersAround(expression: Expression, byId: ReadonlyMap<string, Expression>): Expression[] {
  const chain: Expression[] = [];
  for (let at = byId.get(expression.parent ?? ''); at && !chain.includes(at); at = byId.get(at.parent ?? '')) chain.push(at);
  return chain;
}

interface PanelSize {
  // Width beside the graph on a wide screen; height above the bottom edge on a narrow one,
  // where the panel is as tall as its contents until it has been dragged.
  width: number;
  height?: number;
}

// The panel's size, which its edge can be dragged to change, kept between visits.
function usePanelSize(narrow: boolean) {
  const [size, setSize] = useState<PanelSize>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? 'null');
      if (typeof saved?.width === 'number') return { width: saved.width, height: typeof saved.height === 'number' ? saved.height : undefined };
    } catch {
      // Unreadable storage just means the usual size.
    }
    return { width: PANEL_WIDTH };
  });
  useEffect(() => {
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify(size));
    } catch {
      // The size still holds for this visit.
    }
  }, [size]);

  const resize = (to: number) =>
    setSize((s) =>
      narrow
        ? { ...s, height: Math.max(PANEL_MIN_HEIGHT, Math.min(to, window.innerHeight)) }
        : { ...s, width: Math.max(PANEL_MIN_WIDTH, Math.min(to, window.innerWidth - 2 * PANEL_MARGIN)) },
    );
  const reset = () => setSize((s) => (narrow ? { width: s.width } : { ...s, width: PANEL_WIDTH }));

  // The edge follows the pointer from wherever it was picked up.
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    const panel = e.currentTarget.parentElement!.getBoundingClientRect();
    const start = narrow ? panel.height + e.clientY : panel.width - e.clientX;
    const handle = e.currentTarget;
    // Capture keeps the drag going when the pointer runs ahead of the edge.
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => resize(narrow ? start - ev.clientY : start + ev.clientX);
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    e.preventDefault();
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const grow = narrow ? 'ArrowUp' : 'ArrowRight';
    const shrink = narrow ? 'ArrowDown' : 'ArrowLeft';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    const panel = e.currentTarget.parentElement!.getBoundingClientRect();
    resize((narrow ? panel.height : panel.width) + (e.key === grow ? 24 : -24));
  };

  return { size, handle: { onPointerDown, onKeyDown, onDoubleClick: reset } };
}

// How the graph is drawn, kept between visits.
function useGraphSettings(): [GraphSettings, (patch: Partial<GraphSettings>) => void] {
  const [settings, setSettings] = useState<GraphSettings>(() => {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // The settings still hold for this visit.
    }
  }, [settings]);
  return [settings, (patch) => setSettings((s) => ({ ...s, ...patch }))];
}

const BOUNDS: { key: keyof Bounds; name: string }[] = [
  { key: 'xMin', name: 'x from' },
  { key: 'xMax', name: 'to' },
  { key: 'yMin', name: 'y from' },
  { key: 'yMax', name: 'to' },
];

// The edges of the graph as numbers that can be typed over. They are read when this
// appears; nothing else moves the graph while it is open.
function BoundsFields({ graph }: { graph: GraphHandle }) {
  const [bounds, setBounds] = useState(() => graph.bounds());
  const commit = (key: keyof Bounds, text: string) => {
    const value = Number(text.replace('−', '-'));
    if (text.trim() === '' || !Number.isFinite(value)) return;
    const next = { ...graph.bounds(), [key]: value };
    // A range that runs backwards is left as it was.
    if (!(next.xMax > next.xMin && next.yMax > next.yMin)) return;
    graph.setBounds(next);
    setBounds(graph.bounds());
  };
  return (
    <div className="bounds">
      {BOUNDS.map(({ key, name }) => {
        // Rounded for reading, and an edge that is zero but for rounding error is zero.
        const span = key.startsWith('x') ? bounds.xMax - bounds.xMin : bounds.yMax - bounds.yMin;
        const shown = Math.abs(bounds[key]) < span * 1e-9 ? '0' : String(parseFloat(bounds[key].toPrecision(6)));
        return (
          <label key={key}>
            <span>{name}</span>
            <input
              // Remount when the bound changes so a rejected edit snaps back.
              key={shown}
              className="hex-field"
              inputMode="decimal"
              aria-label={key.replace(/(Min|Max)/, (end) => (end === 'Min' ? ' minimum' : ' maximum'))}
              defaultValue={shown}
              onBlur={(e) => {
                commit(key, e.currentTarget.value);
                e.currentTarget.value = shown;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

// A short message at the foot of the graph, with something to do about it if anything.
interface Notice {
  text: string;
  action?: { label: string; run(): void };
}

// How long a notice takes to fade away (as in the stylesheet).
const NOTICE_EXIT = 180;

function useNotice(): [(Notice & { leaving?: boolean }) | undefined, (notice: Notice) => void, () => void] {
  const [notice, setNotice] = useState<Notice & { leaving?: boolean }>();
  const timer = useRef(0);
  // It fades out, then goes.
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setNotice((current) => current && { ...current, leaving: true });
    timer.current = window.setTimeout(() => setNotice(undefined), NOTICE_EXIT);
  }, []);
  const show = useCallback(
    (next: Notice) => {
      clearTimeout(timer.current);
      setNotice(next);
      // One that offers an action stays long enough to be acted on.
      timer.current = window.setTimeout(hide, next.action ? 8000 : 2400);
    },
    [hide],
  );
  return [notice, show, hide];
}

// Saves a file the browser was given, where copying it wasn't allowed.
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// How a change to the list counts for undo: the rows whose LaTeX alone changed (typing,
// dragging a point or a slider), or nothing, for any other change. Changes of the same
// kind close together in time are one step.
function changeKey(before: Expression[], after: Expression[]): string {
  if (before.length !== after.length || before.some((e, i) => e.id !== after[i].id)) return '';
  const changed: string[] = [];
  for (let i = 0; i < after.length; i++) {
    if (before[i] === after[i]) continue;
    const { latex: _a, ...restBefore } = before[i];
    const { latex: _b, ...restAfter } = after[i];
    if (JSON.stringify(restBefore) !== JSON.stringify(restAfter)) return '';
    changed.push(after[i].id);
  }
  return changed.join(',');
}

// Steps kept to go back through, and how long a pause starts a new one.
const UNDO_LIMIT = 200;
const UNDO_PAUSE = 1000;

// Undo and redo for the list of expressions. Every change is a step, except a playing
// slider moving by itself; typing in one row or dragging is gathered into one step until
// it pauses.
function useUndo(expressions: Expression[], setExpressions: (list: Expression[]) => void) {
  const history = useRef({ past: [] as Expression[][], future: [] as Expression[][], last: expressions, key: '', time: 0, restoring: false });
  const [, setVersion] = useState(0);
  useEffect(() => {
    const h = history.current;
    if (expressions === h.last) return;
    if (h.restoring) {
      h.restoring = false;
      h.last = expressions;
      return;
    }
    const key = changeKey(h.last, expressions);
    const playing = expressions.some((e) => e.playing) && key !== '';
    const now = performance.now();
    if (!playing) {
      if (!(key && key === h.key && now - h.time < UNDO_PAUSE)) {
        h.past.push(h.last);
        if (h.past.length > UNDO_LIMIT) h.past.shift();
      }
      h.future = [];
      h.key = key;
      h.time = now;
      setVersion((v) => v + 1);
    }
    h.last = expressions;
  }, [expressions]);

  const go = (from: 'past' | 'future') => {
    const h = history.current;
    const target = h[from].pop();
    if (!target) return;
    (from === 'past' ? h.future : h.past).push(h.last);
    h.key = '';
    if (target !== h.last) {
      h.restoring = true;
      setExpressions(target);
    }
    setVersion((v) => v + 1);
  };
  return {
    undo: () => go('past'),
    redo: () => go('future'),
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
  };
}

interface SwitchProps {
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange(on: boolean): void;
}

function Switch({ label, on, disabled, onChange }: SwitchProps) {
  return (
    <button className="switch-row" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}>
      <span>{label}</span>
      <span className="switch" />
    </button>
  );
}

export function App() {
  useKeyboardInset();
  const [expressions, setExpressions] = useState(loadExpressions);
  const [focus, setFocus] = useState({ id: '', token: 0 });
  const [panelOpen, setPanelOpen] = useState(true);
  // The menu of things to add, and the button it opens from.
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const [settings, changeSettings] = useGraphSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  // The typed steps as numbers; one that isn't a positive number counts as not set.
  const drawn = useMemo(() => {
    const stepOf = (text: string) => {
      const value = text.trim() ? analyze([plainToLatex(text)])[0].value : undefined;
      return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
    };
    return { ...settings, xStepValue: stepOf(settings.xStep), yStepValue: stepOf(settings.yStep) };
  }, [settings]);
  const [keyboardOn, setKeyboardOn] = useKeyboardSwitch();
  const [dark, toggleTheme] = useTheme();
  const narrow = useMediaQuery(NARROW);
  const panel = usePanelSize(narrow);
  const graph = useRef<GraphHandle>(null);
  const [notice, showNotice, hideNotice] = useNotice();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expressions));
    } catch {
      // Storage can be unavailable (private windows); the session still works.
    }
  }, [expressions]);

  const undo = useUndo(expressions, setExpressions);
  const [helpOpen, setHelpOpen] = useState(false);
  // ⌘Z and ⇧⌘Z (Ctrl+Z and Ctrl+Y elsewhere) undo and redo whole steps, except while
  // typing in a field, where they belong to the field's own text.
  const latestUndo = useRef(undo);
  latestUndo.current = undo;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest('math-field, input, textarea, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) latestUndo.current.undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') latestUndo.current.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const analyses = useMemo(() => analyze(expressions.map((e) => e.latex), expressions.map((e) => e.calculus)), [expressions]);
  const latest = useRef({ expressions, analyses, settings });
  latest.current = { expressions, analyses, settings };

  // A graph opened from a shared link replaces the one here, which can be had back.
  useEffect(() => {
    const open = async () => {
      const encoded = sharedInLocation();
      if (!encoded) return;
      // The address goes back to plain straight away, so the link is only opened once
      // (effects can run twice), and a reload doesn't open it over later work.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      // What was here, taken now: by the time the link is read it may already be replaced.
      const before = latest.current;
      const view = graph.current && { bounds: graph.current.bounds(), aspect: graph.current.aspect() };
      const shared = await decodeGraph(encoded);
      if (!shared) {
        showNotice({ text: 'That link doesn’t hold a graph' });
        return;
      }
      setExpressions(shared.expressions.map(restore));
      changeSettings({ ...DEFAULT_SETTINGS, ...shared.settings });
      const { bounds, aspect = 1 } = shared;
      // The graph may not have been measured yet; it will have been a frame or two on.
      if (bounds) {
        let tries = 0;
        const fit = () => {
          if (!graph.current?.fitBounds(bounds, aspect) && ++tries < 30) requestAnimationFrame(fit);
        };
        fit();
      }
      showNotice({
        text: 'Opened a shared graph',
        action: {
          label: 'Undo',
          run: () => {
            setExpressions(before.expressions);
            changeSettings(before.settings);
            if (view) graph.current?.fitBounds(view.bounds, view.aspect);
          },
        },
      });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
    // Runs once; what it needs at the time is read from `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shareLink = async () => {
    const encoded = await encodeGraph({
      expressions,
      settings,
      bounds: graph.current?.bounds(),
      aspect: graph.current?.aspect(),
    });
    const url = linkTo(encoded);
    try {
      await navigator.clipboard.writeText(url);
      showNotice({ text: 'Link copied' });
    } catch {
      // Without the clipboard, the link is left in the address bar to copy from there.
      history.replaceState(null, '', url);
      showNotice({ text: 'Copy the link from the address bar' });
    }
  };

  const copyImage = async () => {
    if (!graph.current) return;
    // Handed to the clipboard as a promise, so Safari still counts it as part of the click.
    const image = graph.current.snapshot();
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
      showNotice({ text: 'Image copied' });
    } catch {
      try {
        download(await image, 'arki-graph.png');
        showNotice({ text: 'Couldn’t copy, so the image was downloaded' });
      } catch {
        showNotice({ text: 'Couldn’t make an image of the graph' });
      }
    }
  };

  // Playing sliders are all moved by one loop, a frame at a time.
  const playing = expressions.some((e) => e.playing);
  useEffect(() => {
    if (!playing) return;
    // Where each slider really is, between the stops it shows, and which way it is going.
    // `sent` is the value last written and `seen` the one showing when it was, since a
    // frame can come round before the write has landed.
    const motion = new Map<string, { at: number; direction: 1 | -1; sent: number; seen: number }>();
    let last: number | undefined;
    let frame = requestAnimationFrame(function tick(now) {
      // A long gap (a hidden tab) counts as a short one, so nothing leaps on return.
      const elapsed = Math.min(0.1, (now - (last ?? now)) / 1000);
      last = now;
      const { expressions, analyses } = latest.current;
      const changed = new Map<string, Partial<Expression>>();
      expressions.forEach((e, i) => {
        const slider = analyses[i].slider;
        if (!e.playing || !slider) return void motion.delete(e.id);
        const { min, max } = e;
        const step = e.step ?? stepFor(min, max);
        const shown = slider.value;
        const stopAt = (value: number) => Math.min(max, Math.max(min, snap(value, step, min)));
        let state = motion.get(e.id);
        // Starting out, or moved by hand since the last frame: carry on from what it shows.
        if (!state || (shown !== state.sent && shown !== state.seen)) {
          state = { at: Math.min(max, Math.max(min, shown)), direction: state?.direction ?? 1, sent: shown, seen: shown };
        }
        const loop = e.loop ?? 'bounce';
        // Played from the end, a slider that doesn't turn round starts over.
        if (loop !== 'bounce' && state.at >= max) state.at = min;
        if (loop !== 'bounce') state.direction = 1;
        let at = state.at + (state.direction * (max - min) * elapsed * (e.speed ?? 1)) / SLIDER_SWEEP;
        let done = false;
        if (at >= max) {
          if (loop === 'bounce') [at, state.direction] = [Math.max(min, 2 * max - at), -1];
          else if (loop === 'loop') at = Math.min(max, min + (at - max));
          else [at, done] = [max, true];
        } else if (at <= min) [at, state.direction] = [Math.min(max, 2 * min - at), 1];
        state.at = at;
        motion.set(e.id, state);
        const value = stopAt(at);
        const patch: Partial<Expression> = {};
        if (value !== state.sent) [state.sent, state.seen] = [value, shown];
        if (value !== shown) patch.latex = e.latex.slice(0, e.latex.indexOf('=') + 1) + numberText(value);
        if (done) patch.playing = undefined;
        if (value !== shown || done) changed.set(e.id, patch);
      });
      if (changed.size > 0) setExpressions((list) => list.map((e) => (changed.has(e.id) ? { ...e, ...changed.get(e.id) } : e)));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // Dragging a point rewrites whatever its coordinates come from: the numbers written in
  // it, or the sliders it is made of (which stay within their limits).
  const movePoint = useCallback((id: string, x: number, y: number) => {
    const { expressions, analyses } = latest.current;
    const index = expressions.findIndex((e) => e.id === id);
    const plot = analyses[index]?.plot;
    if (plot?.kind !== 'point' || !plot.drag || !expressions[index].draggable) return;
    const changed = new Map<string, string>();
    const targets = [
      { handle: plot.drag[0], value: x },
      { handle: plot.drag[1], value: y },
    ];
    let latex = expressions[index].latex;
    // The later number is replaced first, so the earlier one's place in the text holds.
    for (const { handle, value } of [...targets].reverse()) {
      if (handle?.kind !== 'literal') continue;
      latex = latex.slice(0, handle.span[0]) + numberText(value) + latex.slice(handle.span[1]);
    }
    changed.set(id, latex);
    for (const { handle, value } of targets) {
      if (handle?.kind !== 'slider') continue;
      const row = expressions.find((_, i) => analyses[i].slider?.name === handle.name);
      if (!row) continue;
      const within = Math.min(row.max, Math.max(row.min, value));
      changed.set(row.id, row.latex.slice(0, row.latex.indexOf('=') + 1) + numberText(within));
    }
    setExpressions((list) =>
      list.map((e) => (changed.has(e.id) && changed.get(e.id) !== e.latex ? { ...e, latex: changed.get(e.id)! } : e)),
    );
  }, []);

  // Works out a value typed into a table, which may use the sliders and functions here.
  const evaluate = useCallback(
    (latex: string) => {
      const { value, imaginary } = analyze([latex, ...expressions.map((e) => e.latex)])[0];
      // A table runs along a real axis.
      return imaginary ? undefined : value;
    },
    [expressions],
  );

  // Every table of data worked out at once: each value typed may use the sliders and
  // functions here, and a fitted curve goes through the rows where both are numbers.
  const dataResults = useMemo(() => {
    const out = new Map<string, DataResult>();
    const tables = expressions.filter((e) => e.data);
    if (tables.length === 0) return out;
    const cells = tables.flatMap((e) => e.data!.x.flatMap((x, i) => [plainToLatex(x), plainToLatex(e.data!.y[i] ?? '')]));
    const sources = expressions.map((e) => e.latex);
    const found = analyze([...sources, ...cells]).slice(sources.length);
    const number = (a: (typeof found)[number]) =>
      a.value !== undefined && !a.imaginary && Number.isFinite(a.value) ? a.value : undefined;
    let at = 0;
    for (const e of tables) {
      const values = e.data!.x.map((): [number | undefined, number | undefined] => [number(found[at++]), number(found[at++])]);
      const rows = values.filter((v): v is [number, number] => v[0] !== undefined && v[1] !== undefined);
      const model = e.data!.fit;
      out.set(e.id, { values, fit: model ? fit(model, rows.map(([x]) => x), rows.map(([, y]) => y)) : undefined });
    }
    return out;
  }, [expressions]);

  const folders = useMemo(() => new Map(expressions.filter((e) => e.folder !== undefined).map((e) => [e.id, e])), [expressions]);
  // Folders can sit inside folders, so what holds for a folder holds all the way down.
  const around = (e: Expression) => foldersAround(e, folders);
  // Rows in a closed folder are not on show.
  const visible = expressions.filter((e) => !around(e).some((folder) => folder.collapsed));

  const drawables = useMemo(() => {
    const out: Drawable[] = [];
    // The values quoted in labels are worked out together, after everything they refer to.
    const quoted = expressions.map((e, i) => (e.label && analyses[i].plot?.kind === 'point' ? labelExpressions(e.label) : []));
    const sources = expressions.map((e) => e.latex);
    const values = quoted.some((list) => list.length > 0)
      ? analyze([...sources, ...quoted.flat()])
          .slice(sources.length)
          .map((a) => (a.value === undefined ? '\\text{undefined}' : a.exact ?? complexToLatex(a.value, a.imaginary ?? 0)))
      : [];
    let used = 0;
    expressions.forEach((expression, i) => {
      const own = values.slice(used, (used += quoted[i].length));
      const data = dataResults.get(expression.id);
      if (data) {
        if (expression.hidden || foldersAround(expression, folders).some((folder) => folder.hidden)) return;
        const color = colorOf(expression.color, dark);
        const { pointStyle, lineStyle, lineWidth, opacity } = expression;
        // Each row is a point of its own, so it can be hovered and labelled like one.
        data.values.forEach(([x, y], row) => {
          if (x === undefined || y === undefined) return;
          out.push({ id: `${expression.id}#${row}`, plot: { kind: 'point', x, y }, color, pointStyle, opacity });
        });
        const curve = data.fit;
        if (curve && typeof curve !== 'string') {
          const { f, d1, d2 } = curve;
          out.push({ id: `${expression.id}#fit`, plot: { kind: 'fx', f, d1, d2 }, color, lineStyle, lineWidth, opacity });
        }
        return;
      }
      const plot = analyses[i].plot;
      if (!plot || expression.hidden || foldersAround(expression, folders).some((folder) => folder.hidden)) return;
      const label = plot.kind === 'point' && expression.label !== undefined ? labelToLatex(expression.label, own) : undefined;
      // A point stays put on the graph unless dragging has been switched on for it.
      const fixed = plot.kind === 'point' && plot.drag && !expression.draggable;
      out.push({ id: expression.id, plot: fixed ? { ...plot, drag: undefined } : plot, color: colorOf(expression.color, dark), label, pointStyle: expression.pointStyle, lineStyle: expression.lineStyle, lineWidth: expression.lineWidth, opacity: expression.opacity, fill: expression.fill });
    });
    return out;
  }, [expressions, analyses, dark, folders, dataResults]);

  const focusOn = useCallback((id: string) => setFocus((f) => ({ id, token: f.token + 1 })), []);

  const change = (id: string, patch: Partial<Expression>) =>
    setExpressions((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  // Inserts rows after `afterId` (or at the end) and returns the first new one. A row
  // added after one in a folder joins that folder; after a folder's heading, it goes in
  // at the top.
  const insert = (afterId: string | undefined, latexes: string[]) => {
    const after = expressions.find((e) => e.id === afterId);
    const parent = after?.folder !== undefined ? after.id : after?.parent;
    const added = latexes.map((latex): Expression => ({ ...newExpression(latex), parent }));
    setExpressions((list) => {
      const index = afterId ? list.findIndex((e) => e.id === afterId) : list.length - 1;
      const opened = list.map((e) => (e.id === parent && e.collapsed ? { ...e, collapsed: undefined } : e));
      return [...opened.slice(0, index + 1), ...added, ...opened.slice(index + 1)];
    });
    return added[0];
  };

  // A new expression after everything already in the folder.
  const addInside = (folderId: string) => {
    const last = [...expressions].reverse().find((e) => around(e).some((folder) => folder.id === folderId));
    const added: Expression = { ...newExpression(''), parent: folderId };
    setExpressions((list) => {
      const index = list.findIndex((e) => e.id === (last?.id ?? folderId));
      const opened = list.map((e) => (e.id === folderId && e.collapsed ? { ...e, collapsed: undefined } : e));
      return [...opened.slice(0, index + 1), added, ...opened.slice(index + 1)];
    });
    focusOn(added.id);
  };

  // Deleting a folder leaves what was in it, which moves out to wherever the folder was.
  const remove = (id: string) => {
    const index = visible.findIndex((e) => e.id === id);
    const outer = expressions.find((e) => e.id === id)?.parent;
    const rest = expressions.filter((e) => e.id !== id).map((e) => (e.parent === id ? { ...e, parent: outer } : e));
    const next = rest.length > 0 ? rest : [newExpression('')];
    setExpressions(next);
    const neighbour = visible[index > 0 ? index - 1 : 1];
    focusOn((neighbour && next.find((e) => e.id === neighbour.id) ? neighbour : next[0]).id);
  };

  // A copy of a row goes straight after it. A folder's copy has copies of all its rows.
  const duplicate = (id: string) => {
    const block = expressions.filter((e) => e.id === id || around(e).some((folder) => folder.id === id));
    const fresh = new Map(block.map((e) => [e.id, newExpression('').id]));
    const copies = block.map((e): Expression => ({
      ...e,
      id: fresh.get(e.id)!,
      // Rows inside the copied folder belong to its copy; the row itself stays where it was.
      parent: e.parent && fresh.has(e.parent) && e.id !== id ? fresh.get(e.parent) : e.parent,
      playing: undefined,
    }));
    setExpressions((list) => {
      const end = list.findIndex((e) => e.id === block[block.length - 1].id);
      return [...list.slice(0, end + 1), ...copies, ...list.slice(end + 1)];
    });
    focusOn(copies[0].id);
  };

  const leave = (id: string, direction: 'up' | 'down') => {
    const index = visible.findIndex((e) => e.id === id);
    const neighbour = visible[index + (direction === 'up' ? -1 : 1)];
    if (neighbour) focusOn(neighbour.id);
  };

  // Rows are picked up by the mark at their left edge and dropped between other rows, or
  // onto a folder's heading to go inside it. A folder moves with everything in it.
  const list = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<{ top: number; height: number; depth: number } | undefined>();
  const onGrabRow = (e: React.PointerEvent<HTMLDivElement>) => {
    const row = (e.target as Element).closest('.swatch')?.closest<HTMLElement>('[data-row-id]');
    if (!row || e.button !== 0) return;
    const id = row.dataset.rowId!;
    const start = { x: e.clientX, y: e.clientY };
    let target: { before?: string; parent?: string } | undefined;

    const aim = (x: number, y: number) => {
      const box = list.current!;
      const frame = box.getBoundingClientRect();
      const all = latest.current.expressions;
      const byId = new Map(all.map((ex) => [ex.id, ex]));
      const within = (ex: Expression, folder: string) => foldersAround(ex, byId).some((f) => f.id === folder);
      // Every row on show except the ones being carried: the row itself and, for a
      // folder, everything in it.
      const rows = [...box.querySelectorAll<HTMLElement>('[data-row-id]')]
        .map((el) => ({ expression: byId.get(el.dataset.rowId!)!, rect: el.getBoundingClientRect() }))
        .filter(({ expression }) => expression && expression.id !== id && !within(expression, id));
      const place = (top: number, height: number, depth: number) =>
        setDrop({ top: top - frame.top + box.scrollTop, height, depth });
      const depthIn = (folder: Expression | undefined) => (folder ? foldersAround(folder, byId).length + 1 : 0);

      // The middle of a folder's heading means into it, at the end; its top and bottom
      // edges are still places between rows.
      const heading = rows.find((r) => r.expression.folder !== undefined && y >= r.rect.top + 10 && y <= r.rect.bottom - 10);
      if (heading) {
        const folder = heading.expression;
        const rest = all.filter((ex) => ex.id !== id && !within(ex, id));
        const at = rest.findIndex((ex) => ex.id === folder.id) + 1;
        target = { before: rest.slice(at).find((ex) => !within(ex, folder.id))?.id, parent: folder.id };
        return place(heading.rect.top, heading.rect.height, depthIn(byId.get(folder.parent ?? '')));
      }
      let next = rows.findIndex((r) => y < r.rect.top + r.rect.height / 2);
      if (next < 0) next = rows.length;
      const above = rows[next - 1]?.expression;
      const below = rows[next]?.expression;
      // Between two rows there can be several folders it could belong to: from the one
      // the row above is in (or is, if it is an open folder) out to the one the row below
      // is in. How far in from the edge the pointer is picks among them.
      const outermost = byId.get(below?.parent ?? '');
      const candidates: (Expression | undefined)[] = [];
      if (above) {
        const chain = [...(above.folder !== undefined && !above.collapsed ? [above] : []), ...foldersAround(above, byId)];
        for (const folder of chain) {
          if (folder === outermost) break;
          candidates.push(folder);
        }
      }
      candidates.push(outermost);
      const wanted = Math.floor((x - frame.left - 8) / 20);
      const parent = candidates.reduce((best, folder) =>
        Math.abs(depthIn(folder) - wanted) < Math.abs(depthIn(best) - wanted) ? folder : best,
      );
      target = { before: below?.id, parent: parent?.id };
      const edge = rows[next] ? rows[next].rect.top : rows.length ? rows[rows.length - 1].rect.bottom : frame.top;
      place(edge - 1, 2, depthIn(parent));
    };

    const onMove = (ev: PointerEvent) => {
      if (!target && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      ev.preventDefault();
      row.dataset.carried = '';
      // Near the top or bottom of the list, it scrolls to bring more rows within reach.
      const frame = list.current!.getBoundingClientRect();
      if (ev.clientY < frame.top + 28) list.current!.scrollTop -= 10;
      else if (ev.clientY > frame.bottom - 28) list.current!.scrollTop += 10;
      aim(ev.clientX, ev.clientY);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      delete row.dataset.carried;
      setDrop(undefined);
      if (!target || ev.type === 'pointercancel') return;
      // The press that ends a drag isn't also a click on the colour button.
      const stopClick = (click: MouseEvent) => click.stopPropagation();
      window.addEventListener('click', stopClick, { capture: true, once: true });
      // If no click follows (the pointer was let go off the button), don't eat a later one.
      setTimeout(() => window.removeEventListener('click', stopClick, true), 0);
      const { before, parent } = target;
      setExpressions((all) => {
        const byId = new Map(all.map((ex) => [ex.id, ex]));
        const carried = (ex: Expression) => ex.id === id || foldersAround(ex, byId).some((f) => f.id === id);
        const moving = all.filter(carried).map((ex) => (ex.id === id ? { ...ex, parent } : ex));
        const rest = all.filter((ex) => !carried(ex));
        const at = before ? rest.findIndex((ex) => ex.id === before) : rest.length;
        return [...rest.slice(0, at < 0 ? rest.length : at), ...moving, ...rest.slice(at < 0 ? rest.length : at)];
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const addExpression = () => {
    setPanelOpen(true);
    focusOn(insert(undefined, ['']).id);
  };

  const addNote = () => {
    const note: Expression = { ...newExpression(''), note: '' };
    setExpressions((list) => [...list, note]);
    focusOn(note.id);
  };

  const addData = () => {
    const table: Expression = { ...newExpression(''), data: { x: [], y: [] } };
    setExpressions((list) => [...list, table]);
    focusOn(table.id);
  };

  // A row that differentiates or antidifferentiates the function typed into it.
  const addCalculus = (calculus: 'derivative' | 'antiderivative') => {
    setPanelOpen(true);
    const row: Expression = { ...newExpression(''), calculus };
    setExpressions((list) => [...list, row]);
    focusOn(row.id);
  };

  const addFolder = () => {
    const folder: Expression = { ...newExpression(''), folder: '' };
    setExpressions((list) => [...list, folder]);
    focusOn(folder.id);
  };

  // The folded-away tools: whether they are out, and the panel's height to grow to.
  const [dockOpen, setDockOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const dockItems = useRef<HTMLDivElement>(null);
  const dockToggle = useRef<HTMLButtonElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  useLayoutEffect(() => {
    if (dockOpen && dockItems.current) setDockHeight(dockItems.current.offsetHeight);
  }, [dockOpen, narrow]);
  // A press anywhere else, or Escape, folds the panel away again. The settings that open
  // from it sit outside it on the page, and don't count as elsewhere.
  useEffect(() => {
    if (!dockOpen || narrow) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (!dockRef.current?.contains(target) && !target.closest('.popover')) setDockOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDockOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [dockOpen, narrow]);
  // On a phone the sheet of tools fades away before it goes, rather than vanishing.
  // It goes once the fade (260ms in the stylesheet) is over.
  const [sheetClosing, setSheetClosing] = useState(false);
  const closing = useRef(0);
  const finishClosing = () => {
    clearTimeout(closing.current);
    setSheetClosing(false);
    setDockOpen(false);
  };
  const closeSheet = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finishClosing();
    setSheetClosing(true);
    clearTimeout(closing.current);
    closing.current = window.setTimeout(finishClosing, 260);
  };
  useEffect(() => () => clearTimeout(closing.current), []);
  useEffect(() => {
    if (!dockOpen || !narrow) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dockOpen, narrow]);

  // The settings open above the panel of tools, or by the star on a phone, where the
  // tools have gone again by then.
  const settingsAnchor = narrow ? dockToggle.current : dockRef.current;
  // Folding the tools away puts the settings away with them, on a wide screen.
  useEffect(() => {
    if (!dockOpen && !narrow) setSettingsOpen(false);
  }, [dockOpen, narrow]);

  const tools: { name: string; icon: React.ReactNode; run(): void; disabled?: boolean; expanded?: boolean; ref?: React.Ref<HTMLButtonElement> }[] = [
    { name: 'Graph settings', icon: <WrenchIcon />, run: () => setSettingsOpen((open) => !open), expanded: settingsOpen, ref: settingsButton },
    { name: 'Zoom in', icon: <PlusIcon />, run: () => graph.current?.zoomBy(2), disabled: settings.locked },
    { name: 'Zoom out', icon: <MinusIcon />, run: () => graph.current?.zoomBy(0.5), disabled: settings.locked },
    { name: 'Reset view', icon: <HomeIcon />, run: () => graph.current?.home(), disabled: settings.locked },
    { name: 'Copy link', icon: <LinkIcon />, run: shareLink },
    { name: 'Copy image', icon: <ImageIcon />, run: copyImage },
  ];

  const toggleKeyboard = () => {
    // Switching it on with nothing being edited starts editing the last expression.
    const last = [...visible].reverse().find((e) => e.note === undefined && e.folder === undefined && !e.data);
    if (!keyboardOn && !focusedField() && last) focusOn(last.id);
    setKeyboardOn(!keyboardOn);
  };

  return (
    <div className="app" data-panel={panelOpen ? 'open' : 'closed'}>
      <Graph ref={graph} items={drawables} dark={dark} settings={drawn} onMovePoint={movePoint} />

      <nav className="navbar" aria-label="Site">
        {/* Focusable so the notice can also be reached by keyboard, or a tap on a phone. */}
        <h1 aria-label="Arki" aria-describedby="copyright" tabIndex={0}>
          <span aria-hidden="true">A</span>rki
          <span id="copyright" role="tooltip" className="navbar-tip">
            Copyright 2026 © Juyoung Park All rights reserved.
          </span>
        </h1>
        <div className="navbar-actions">
          <button className="icon-button" aria-label="Undo" title="Undo (⌘Z)" disabled={!undo.canUndo} onClick={undo.undo}>
            <UndoIcon />
          </button>
          <button className="icon-button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!undo.canRedo} onClick={undo.redo}>
            <RedoIcon />
          </button>
          <button className="icon-button" aria-label="Help" aria-expanded={helpOpen} onClick={() => setHelpOpen(true)}>
            <HelpIcon />
          </button>
          <button
            className="icon-button"
            aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => {
              // The graph's old picture fades out over the new one as the colours change.
              graph.current?.crossfade(THEME_FADE);
              toggleTheme();
            }}
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <a className="navbar-star" href="https://sleepywndud.github.io" target="_blank" rel="noopener" aria-label="Ni Brain Too Sht">
            <span className="navbar-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: NATURALS }} />
          </a>
        </div>
      </nav>

      <aside
        className="panel"
        aria-label="Expressions"
        inert={!panelOpen}
        data-sized={panel.size.height === undefined ? undefined : ''}
        style={{ '--panel-width': `${panel.size.width}px`, '--panel-height': `${panel.size.height ?? 0}px` } as React.CSSProperties}
      >
        {/* The edge facing the graph: drag it to resize the panel, double-click to reset. */}
        <div
          className="panel-resizer"
          role="separator"
          aria-label="Resize expressions"
          aria-orientation={narrow ? 'horizontal' : 'vertical'}
          tabIndex={0}
          {...panel.handle}
        />
        <header className="panel-header">
          <h2>Expressions</h2>
          <button
            className="icon-button keyboard-switch"
            aria-label="Maths keyboard"
            aria-pressed={keyboardOn}
            // Keeps the focus in the field being edited, which the keyboard types into.
            onPointerDown={(e) => e.preventDefault()}
            onClick={toggleKeyboard}
          >
            <KeyboardIcon />
          </button>
          <button
            ref={addButton}
            className="icon-button"
            aria-label="Add"
            aria-expanded={adding}
            onClick={() => setAdding((open) => !open)}
          >
            <PlusIcon />
          </button>
          {adding && addButton.current && (
            <Popover anchor={addButton.current} label="Add" className="menu" onClose={() => setAdding(false)}>
              {(
                [
                  ['Expression', <FunctionIcon />, addExpression],
                  ['Note', <NoteIcon />, addNote],
                  ['Data', <TableIcon />, addData],
                  ['Derivative', <DerivativeIcon />, () => addCalculus('derivative')],
                  ['Antiderivative', <IntegralIcon />, () => addCalculus('antiderivative')],
                  ['Folder', <FolderIcon />, addFolder],
                ] as const
              ).map(([name, icon, add]) => (
                <button
                  key={name}
                  className="menu-item"
                  onClick={() => {
                    setAdding(false);
                    add();
                  }}
                >
                  {icon}
                  {name}
                </button>
              ))}
            </Popover>
          )}
          <button className="icon-button" aria-label="Hide expressions" onClick={() => setPanelOpen(false)}>
            <SidebarIcon />
          </button>
        </header>
        <div className="panel-list" ref={list} onPointerDown={onGrabRow}>
          {drop && (
            <div
              className="drop-mark"
              data-frame={drop.height > 2 || undefined}
              style={{ top: drop.top, height: drop.height, '--depth': drop.depth } as React.CSSProperties}
            />
          )}
          {visible.map((expression) => (
            <ExpressionRow
              key={expression.id}
              expression={expression}
              analysis={analyses[expressions.indexOf(expression)]}
              depth={around(expression).length}
              folderHidden={around(expression).some((folder) => folder.hidden)}
              onAddInside={() => addInside(expression.id)}
              dark={dark}
              focusToken={focus.id === expression.id ? focus.token : 0}
              evaluate={evaluate}
              dataResult={dataResults.get(expression.id)}
              onChange={(patch) => change(expression.id, patch)}
              onEnter={() => focusOn(insert(expression.id, ['']).id)}
              onRemove={() => remove(expression.id)}
              onDuplicate={() => duplicate(expression.id)}
              onLeave={(direction) => leave(expression.id, direction)}
              onAddSliders={(names) => insert(expression.id, names.map((name) => `${nameToLatex(name)}=1`))}
              onAddBelow={(latex) => focusOn(insert(expression.id, [latex]).id)}
            />
          ))}
        </div>
      </aside>

      <button
        className="icon-button glass panel-reopen"
        aria-label="Show expressions"
        inert={panelOpen}
        onClick={() => setPanelOpen(true)}
      >
        <SidebarIcon />
      </button>

      {/* The graph's tools, folded away behind one faint button with the star on it. On a
          wide screen the button grows into a panel of them; on a phone they cover the
          screen, big enough to tap, and go again once one is chosen. */}
      <div className="dock" ref={dockRef} data-open={dockOpen && !narrow ? '' : undefined} style={{ '--dock-height': `${dockHeight}px` } as React.CSSProperties}>
        {!narrow && (
          <div className="dock-items" ref={dockItems} inert={!dockOpen}>
            {tools.map((tool) => (
              <button key={tool.name} ref={tool.ref} className="dock-item" disabled={tool.disabled} aria-expanded={tool.expanded} onClick={tool.run}>
                {tool.icon}
                <span>{tool.name}</span>
              </button>
            ))}
          </div>
        )}
        <button
          ref={dockToggle}
          className="dock-toggle"
          aria-label={dockOpen ? 'Close tools' : 'Tools'}
          aria-expanded={dockOpen}
          onClick={() => setDockOpen((open) => !open)}
        >
          <img src={star} alt="" />
        </button>
      </div>
      {settingsOpen && settingsAnchor && (
      <Popover anchor={settingsAnchor} label="Graph settings" className="settings" side={narrow ? undefined : 'left'} onClose={() => setSettingsOpen(false)}>
        <Switch label="Grid" on={settings.grid} onChange={(grid) => changeSettings({ grid })} />
        <Switch
          label="Polar grid"
          on={settings.grid && settings.polar}
          disabled={!settings.grid}
          onChange={(polar) => changeSettings({ polar })}
        />
        <Switch label="Projector mode" on={settings.projector} onChange={(projector) => changeSettings({ projector })} />
        <Switch label="Lock view" on={settings.locked} onChange={(locked) => changeSettings({ locked })} />
        <Switch label="Tangent line on trace" on={settings.tangent} onChange={(tangent) => changeSettings({ tangent })} />
        <Switch label="Axes" on={settings.axes} onChange={(axes) => changeSettings({ axes })} />
        <Switch
          label="Axis numbers"
          on={settings.axes && settings.numbers}
          disabled={!settings.axes}
          onChange={(numbers) => changeSettings({ numbers })}
        />
        {(['xLabel', 'yLabel'] as const).map((axis) => (
          <label key={axis} className="settings-field">
            <span>{axis === 'xLabel' ? 'x-axis label' : 'y-axis label'}</span>
            <input
              className="hex-field"
              placeholder="None"
              disabled={!settings.axes}
              value={settings[axis]}
              onChange={(e) => changeSettings({ [axis]: e.currentTarget.value })}
            />
          </label>
        ))}
        <div className="bounds">
          {(['xStep', 'yStep'] as const).map((axis) => (
            <label key={axis}>
              <span>{axis === 'xStep' ? 'x step' : 'y step'}</span>
              <input
                className="hex-field"
                aria-label={axis === 'xStep' ? 'x step' : 'y step'}
                aria-invalid={settings[axis].trim() !== '' && drawn[`${axis}Value`] === undefined}
                placeholder="Auto"
                spellCheck={false}
                autoCapitalize="off"
                value={settings[axis]}
                onChange={(e) => changeSettings({ [axis]: e.currentTarget.value })}
              />
            </label>
          ))}
        </div>
        {graph.current && <BoundsFields graph={graph.current} />}
      </Popover>
      )}

      {dockOpen && narrow && (
        <div
          className="tools-sheet"
          role="dialog"
          aria-label="Tools"
          data-closing={sheetClosing || undefined}
          onClick={(e) => e.target === e.currentTarget && closeSheet()}
        >
          <div className="tools-grid">
            {tools.map((tool, i) => (
              <button
                key={tool.name}
                className="tools-choice"
                style={{ '--i': i } as React.CSSProperties}
                disabled={tool.disabled}
                onClick={() => {
                  closeSheet();
                  tool.run();
                }}
              >
                {tool.icon}
                <span>{tool.name}</span>
              </button>
            ))}
          </div>
          <button className="tools-close" onClick={closeSheet}>
            Close
          </button>
        </div>
      )}

      {helpOpen && <Help onClose={() => setHelpOpen(false)} />}

      {notice && (
        <div className="notice glass" role="status" data-leaving={notice.leaving || undefined}>
          <span>{notice.text}</span>
          {notice.action && (
            <button
              className="notice-action"
              onClick={() => {
                notice.action!.run();
                hideNotice();
              }}
            >
              {notice.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
