import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Graph, type GraphHandle } from './graph/Graph';
import type { Drawable } from './graph/render';
import { analyze } from './math/analyze';
import { nameToLatex } from './math/parser';
import { ExpressionRow, type Expression } from './ui/ExpressionRow';
import { HomeIcon, MinusIcon, PlusIcon, SidebarIcon } from './ui/icons';
import { PALETTE, colorOf } from './ui/palette';

const STORAGE_KEY = 'arki:expressions:v1';
const PANEL_WIDTH = 360;
const PANEL_MARGIN = 12;
const NARROW = '(max-width: 640px)';

let nextId = 0;
const newExpression = (latex: string, color: number): Expression => ({
  id: `${Date.now().toString(36)}-${nextId++}`,
  latex,
  color: color % PALETTE.length,
  hidden: false,
  min: -10,
  max: 10,
});

function loadExpressions(): Expression[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.length > 0) return saved;
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

export function App() {
  const [expressions, setExpressions] = useState(loadExpressions);
  const [focus, setFocus] = useState({ id: '', token: 0 });
  const [panelOpen, setPanelOpen] = useState(true);
  const dark = useMediaQuery('(prefers-color-scheme: dark)');
  const narrow = useMediaQuery(NARROW);
  const graph = useRef<GraphHandle>(null);
  const created = useRef(expressions.length);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expressions));
    } catch {
      // Storage can be unavailable (private windows); the session still works.
    }
  }, [expressions]);

  const analyses = useMemo(() => analyze(expressions.map((e) => e.latex)), [expressions]);

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
    const added = latexes.map((latex) => newExpression(latex, created.current++));
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

  const inset = panelOpen && !narrow ? PANEL_WIDTH + PANEL_MARGIN : 0;

  return (
    <div className="app" data-panel={panelOpen ? 'open' : 'closed'}>
      <Graph ref={graph} items={drawables} dark={dark} insetLeft={inset} />

      <aside className="panel" aria-label="Expressions" inert={!panelOpen}>
        <header className="panel-header">
          <h1>Arki</h1>
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
