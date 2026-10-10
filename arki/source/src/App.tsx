import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Graph, type GraphHandle } from './graph/Graph';
import type { Drawable } from './graph/render';
import { analyze } from './math/analyze';
import { nameToLatex } from './math/parser';
import { ExpressionRow, type Expression } from './ui/ExpressionRow';
import { HomeIcon, KeyboardIcon, MinusIcon, MoonIcon, PlusIcon, SidebarIcon, SunIcon } from './ui/icons';
import { DEFAULT_COLOR, colorOf } from './ui/palette';
import type { TableRange } from './ui/Table';

const STORAGE_KEY = 'arki:expressions:v1';
const THEME_KEY = 'arki:theme';
const PANEL_WIDTH = 360;
const PANEL_MIN_WIDTH = 280;
const PANEL_MIN_HEIGHT = 120;
const PANEL_KEY = 'arki:panel:v1';
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
function restore(saved: Expression): Expression {
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
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    // MathLive's keyboard takes its theme from this attribute.
    root.setAttribute('theme', dark ? 'dark' : 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e0e10' : '#ffffff');
  }, [dark]);
  const toggle = () => {
    setChosen(!dark);
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

export function App() {
  useKeyboardInset();
  const [expressions, setExpressions] = useState(loadExpressions);
  const [focus, setFocus] = useState({ id: '', token: 0 });
  const [panelOpen, setPanelOpen] = useState(true);
  const [keyboardOn, setKeyboardOn] = useKeyboardSwitch();
  const [dark, toggleTheme] = useTheme();
  const narrow = useMediaQuery(NARROW);
  const panel = usePanelSize(narrow);
  const graph = useRef<GraphHandle>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expressions));
    } catch {
      // Storage can be unavailable (private windows); the session still works.
    }
  }, [expressions]);

  const analyses = useMemo(() => analyze(expressions.map((e) => e.latex)), [expressions]);

  // Works out a value typed into a table, which may use the sliders and functions here.
  const evaluate = useCallback(
    (latex: string) => {
      const { value, imaginary } = analyze([latex, ...expressions.map((e) => e.latex)])[0];
      // A table runs along a real axis.
      return imaginary ? undefined : value;
    },
    [expressions],
  );

  const drawables = useMemo(() => {
    const out: Drawable[] = [];
    expressions.forEach((expression, i) => {
      const plot = analyses[i].plot;
      if (plot && !expression.hidden) out.push({ id: expression.id, plot, color: colorOf(expression.color, dark) });
    });
    return out;
  }, [expressions, analyses, dark]);

  const focusOn = useCallback((id: string) => setFocus((f) => ({ id, token: f.token + 1 })), []);

  const change = (id: string, patch: Partial<Expression>) =>
    setExpressions((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  // Inserts rows after `afterId` (or at the end) and returns the first new one.
  const insert = (afterId: string | undefined, latexes: string[]) => {
    const added = latexes.map((latex) => newExpression(latex));
    setExpressions((list) => {
      const index = afterId ? list.findIndex((e) => e.id === afterId) : list.length - 1;
      return [...list.slice(0, index + 1), ...added, ...list.slice(index + 1)];
    });
    return added[0];
  };

  const remove = (id: string) => {
    const index = expressions.findIndex((e) => e.id === id);
    if (expressions.length === 1) {
      change(id, { latex: '' });
      focusOn(id);
      return;
    }
    setExpressions((list) => list.filter((e) => e.id !== id));
    focusOn(expressions[index > 0 ? index - 1 : 1].id);
  };

  const leave = (id: string, direction: 'up' | 'down') => {
    const index = expressions.findIndex((e) => e.id === id);
    const neighbour = expressions[index + (direction === 'up' ? -1 : 1)];
    if (neighbour) focusOn(neighbour.id);
  };

  const addExpression = () => {
    setPanelOpen(true);
    focusOn(insert(undefined, ['']).id);
  };

  const toggleKeyboard = () => {
    // Switching it on with nothing being edited starts editing the last expression.
    if (!keyboardOn && !focusedField()) focusOn(expressions[expressions.length - 1].id);
    setKeyboardOn(!keyboardOn);
  };

  const inset = panelOpen && !narrow ? panel.size.width + PANEL_MARGIN : 0;

  return (
    <div className="app" data-panel={panelOpen ? 'open' : 'closed'}>
      <Graph ref={graph} items={drawables} dark={dark} insetLeft={inset} />

      <nav className="navbar" aria-label="Site">
        {/* Focusable so the notice can also be reached by keyboard, or a tap on a phone. */}
        <h1 aria-label="Arki" aria-describedby="copyright" tabIndex={0}>
          <span aria-hidden="true">A</span>rki
          <span id="copyright" role="tooltip" className="navbar-tip">
            Copyright 2026 © Juyoung Park All rights reserved.
          </span>
        </h1>
        <div className="navbar-actions">
          <button className="icon-button" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <a href="https://sleepywndud.github.io" target="_blank" rel="noopener">
            NI BRAIN TOO SHT
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
          <button className="icon-button" aria-label="Add expression" onClick={addExpression}>
            <PlusIcon />
          </button>
          <button className="icon-button" aria-label="Hide expressions" onClick={() => setPanelOpen(false)}>
            <SidebarIcon />
          </button>
        </header>
        <div className="panel-list">
          {expressions.map((expression, i) => (
            <ExpressionRow
              key={expression.id}
              expression={expression}
              analysis={analyses[i]}
              dark={dark}
              focusToken={focus.id === expression.id ? focus.token : 0}
              evaluate={evaluate}
              onChange={(patch) => change(expression.id, patch)}
              onEnter={() => focusOn(insert(expression.id, ['']).id)}
              onRemove={() => remove(expression.id)}
              onLeave={(direction) => leave(expression.id, direction)}
              onAddSliders={(names) => insert(expression.id, names.map((name) => `${nameToLatex(name)}=1`))}
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

      <div className="controls">
        <div className="glass control-group">
          <button className="icon-button" aria-label="Zoom in" onClick={() => graph.current?.zoomBy(2)}>
            <PlusIcon />
          </button>
          <button className="icon-button" aria-label="Zoom out" onClick={() => graph.current?.zoomBy(0.5)}>
            <MinusIcon />
          </button>
        </div>
        <button className="icon-button glass" aria-label="Reset view" onClick={() => graph.current?.home()}>
          <HomeIcon />
        </button>
      </div>
    </div>
  );
}
