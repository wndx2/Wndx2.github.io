import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { convertLatexToMarkup } from 'mathlive';
import { CloseIcon } from './icons';
import { messageHtml } from './fit';

// One thing arki can do: what it is, how to do it, and an example to type (LaTeX).
interface Feature {
  name: string;
  how: string;
  example?: string;
}

interface Section {
  title: string;
  features: Feature[];
}

const SECTIONS: Section[] = [
  {
    title: 'Graphing',
    features: [
      { name: 'Functions', how: 'Type y = … , or just the expression in x.', example: 'y=x^2-3x' },
      { name: 'Sideways curves', how: 'Write x in terms of y.', example: 'x=y^2' },
      { name: 'Implicit curves', how: 'Any equation in x and y: circles, ellipses, hyperbolas and more.', example: 'x^2+y^2=25' },
      { name: 'Inequalities', how: 'Shades the region. A strict inequality has a dashed edge.', example: 'y>x^2' },
      { name: 'Between two curves', how: 'Chain two inequalities to shade the region between them.', example: 'x^2<y<x+2' },
      { name: 'Restricting a curve', how: 'Put a condition in braces after it.', example: 'y=x^2\\left\\{0<x<2\\right\\}' },
      { name: 'Piecewise functions', how: 'Conditions with values, and a last value for everything else.', example: 'y=\\left\\{x<0:-x,x^2\\right\\}' },
      { name: 'Polar curves', how: 'r in terms of θ.', example: 'r=1+\\cos\\theta' },
      { name: 'Parametric curves', how: 'A point whose coordinates use t, for t from 0 to 2π.', example: '\\left(\\cos t,\\sin2t\\right)' },
      { name: 'Points', how: 'Type coordinates. The tag button labels a point; the move button lets you drag it on the graph.', example: '\\left(2,3\\right)' },
      { name: 'Polygons', how: 'polygon with three or more points.', example: '\\operatorname{polygon}\\left(\\left(0,0\\right),\\left(4,0\\right),\\left(2,3\\right)\\right)' },
    ],
  },
  {
    title: 'Sliders and functions',
    features: [
      { name: 'Sliders', how: 'A letter set to a number becomes a slider. Use a letter that isn’t defined and arki offers to add it.', example: 'a=2' },
      { name: 'Animating', how: 'Press play on a slider. Its settings set the range, step, speed and whether it bounces, loops or plays once.' },
      { name: 'Your own functions', how: 'Define a function once and use it anywhere.', example: 'f\\left(x\\right)=x^2+1' },
    ],
  },
  {
    title: 'Calculus',
    features: [
      { name: 'Derivative row', how: 'Add → Derivative. Type a function of x for its derivative as a formula and a graph. “Add as expression” copies the result into a row.' },
      { name: 'Antiderivative row', how: 'Add → Antiderivative. Gives the antiderivative + C. If there is no formula, it draws the area from 0 to x instead.' },
      { name: 'Derivatives in a row', how: 'Graph or evaluate a derivative directly, or f′ of a function you defined.', example: '\\frac{d}{dx}\\left(x^2\\sin x\\right)' },
      { name: 'Definite integrals', how: 'Limits below and above, then dx.', example: '\\int_0^1x^2\\,dx' },
      { name: 'Sums and products', how: 'Worked out exactly where possible.', example: '\\sum_{n=1}^{10}n^2' },
      { name: 'Limits', how: 'Write a^+ or a^- for one side only.', example: '\\lim_{x\\to0}\\frac{\\sin x}{x}' },
      { name: 'Solving', how: 'solve an equation in x, with a starting guess; fMin and fMax find a minimum or maximum.', example: '\\operatorname{solve}\\left(x^2=2,1\\right)' },
    ],
  },
  {
    title: 'Values and exact answers',
    features: [
      { name: 'Calculations', how: 'A row without x or y shows its value.', example: '\\sqrt{18}' },
      { name: 'Exact answers', how: 'Fractions, square roots and multiples of π are shown exactly where they can be.', example: '\\frac{1}{\\sqrt{3}-1}' },
      { name: 'Complex numbers', how: 'Use i, or take the square root of a negative number.', example: '\\left(2+3i\\right)^2' },
      { name: 'Counting and probability', how: 'Factorials, nCr and nPr, and distributions with the Casio names: NormCD, BinomialPD, PoissonCD, InvNormCD and others.', example: '\\operatorname{nCr}\\left(10,3\\right)' },
      { name: 'Number functions', how: 'gcd, lcm, mod, floor, ceil, round, abs, max, min, and random numbers.', example: '\\operatorname{gcd}\\left(84,36\\right)' },
      { name: 'Inverse trig', how: 'Type sin⁻¹ as \\sin^{-1}.', example: '\\sin^{-1}\\left(\\frac{1}{2}\\right)' },
    ],
  },
  {
    title: 'On the graph',
    features: [
      { name: 'Points of interest', how: 'Grey dots mark intercepts, turning points, inflection points and where curves cross. Click one to keep its coordinates showing.' },
      { name: 'Tracing', how: 'Hover over or drag along a curve to read off points on it.' },
      { name: 'Tangent lines', how: 'Turn on “Tangent line on trace” in Graph settings to see the tangent and its equation as you trace.' },
      { name: 'Moving around', how: 'Drag to pan. Scroll, pinch or double-click to zoom; Shift + double-click zooms out.' },
      { name: 'Stretching one axis', how: 'Shift + scroll, or pinch along an axis.' },
      { name: 'Tools', how: 'The star button in the corner: graph settings, zoom, reset view, copy link and copy image.' },
      { name: 'Graph settings', how: 'Grid, polar grid, projector mode, lock view, axes, axis numbers and labels, grid steps and the exact edges of the view.' },
    ],
  },
  {
    title: 'The expression list',
    features: [
      { name: 'Adding and removing rows', how: 'Enter adds a row below. Backspace in an empty row deletes it. ↑ and ↓ move between rows.' },
      { name: 'Colour and style', how: 'Click a row’s dot for colour, line or point style, thickness, opacity, shading, and hiding it.' },
      { name: 'Reordering', how: 'Drag a row by its dot. Drop it on a folder to put it inside.' },
      { name: 'Notes and folders', how: 'Add → Note for text, Add → Folder to group rows. A folder can be closed or hidden as a whole.' },
      { name: 'Tables of values', how: 'The table button on a curve. Add derivative columns, or type your own x values.' },
      { name: 'Data and regression', how: 'Add → Data. Type or paste x and y values (straight from a spreadsheet), then choose linear, quadratic, cubic, exponential, power or logarithmic for the fitted equation and R².' },
      { name: 'Rewriting trig', how: 'The ··· button on a row with trig offers equivalent forms.' },
      { name: 'Maths keyboard', how: 'The keyboard button at the top of the list. It appears by itself on touch screens.' },
    ],
  },
  {
    title: 'Saving and sharing',
    features: [
      { name: 'Undo and redo', how: 'The arrows in the top bar, or ⌘Z / Ctrl+Z and ⇧⌘Z / Ctrl+Y.' },
      { name: 'Automatic saving', how: 'Your graph is kept in this browser and is there when you come back.' },
      { name: 'Share link', how: 'Tools → Copy link. The whole graph is in the link; opening it can be undone.' },
      { name: 'Copy image', how: 'Tools → Copy image puts a picture of the graph on the clipboard.' },
      { name: 'As an app', how: 'On an iPhone, Share → Add to Home Screen in Safari.' },
      { name: 'Dark mode', how: 'The sun or moon button in the top bar.' },
    ],
  },
];

const markup = (latex: string) => convertLatexToMarkup(latex, { defaultMode: 'math' });

// Everything arki can do, by topic, with a search across it.
export function Help({ onClose }: { onClose(): void }) {
  const [query, setQuery] = useState('');
  const [leaving, setLeaving] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const close = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return onClose();
    setLeaving(true);
    setTimeout(onClose, 220);
  };

  useEffect(() => {
    search.current?.focus({ preventScroll: true });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sections = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      features: section.features.filter((f) => {
        const text = `${section.title} ${f.name} ${f.how}`.toLowerCase();
        return words.every((w) => text.includes(w));
      }),
    })).filter((section) => section.features.length > 0);
  }, [query]);

  return createPortal(
    <div className="help-backdrop" data-leaving={leaving || undefined} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="help" role="dialog" aria-label="Help" aria-modal="true">
        <header className="help-header">
          <h2>
            What <span className="blackboard">A</span>rki can do
          </h2>
          <button className="icon-button" aria-label="Close help" onClick={close}>
            <CloseIcon />
          </button>
        </header>
        <input
          ref={search}
          className="help-search"
          type="search"
          placeholder="Search, e.g. derivative, shade, share"
          aria-label="Search help"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <div className="help-body">
          {sections.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <dl>
                {section.features.map((f) => (
                  <div key={f.name} className="help-feature">
                    <dt>{f.name}</dt>
                    <dd>
                      {/* Variables in the text are typeset, as in the expressions. */}
                      <span dangerouslySetInnerHTML={{ __html: messageHtml(f.how) }} />
                      {f.example && <span className="help-example" dangerouslySetInnerHTML={{ __html: markup(f.example) }} />}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {sections.length === 0 && <p className="help-empty">Nothing matches “{query}”.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
