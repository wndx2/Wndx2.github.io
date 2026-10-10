import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { convertLatexToMarkup } from 'mathlive';
import { findPoints, type PointOfInterest } from './points';
import { DARK, LIGHT, draw, scaleY, sizeOf, type Drawable, type GraphSettings, type Label, type Trace, type View } from './render';
import { Spring, decay } from './spring';

// The part of the plane on show: the values at the edges of the graph.
export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface GraphHandle {
  zoomBy(factor: number): void;
  home(): void;
  bounds(): Bounds;
  // Shows exactly this part of the plane, stretching an axis if that is what it takes.
  setBounds(bounds: Bounds): void;
}

interface GraphProps {
  ref: Ref<GraphHandle>;
  items: Drawable[];
  dark: boolean;
  settings: GraphSettings;
  // A point was dragged to a new place on the plane.
  onMovePoint(id: string, x: number, y: number): void;
}

const MIN_SCALE = 1e-6;
const MAX_SCALE = 1e8;
const HIT_RADIUS = 14;
const POINT_RADIUS = 12;
// How close a press has to be to a movable point to pick it up; wider for a finger.
const GRAB_RADIUS = 14;
const TOUCH_GRAB_RADIUS = 24;
// A press that moves further than this is a drag, not a click.
const CLICK_SLOP = 6;

// How close to an axis line the pointer has to be to count as on it, in pixels.
const AXIS_RADIUS = 18;
// Fingers are less precise than a mouse, and cover the line they are aiming at.
const TOUCH_AXIS_RADIUS = 32;
// Below this spread along the axis, a pinch's ratio is too jumpy to stretch by.
const MIN_STRETCH_SPREAD = 24;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Animation =
  // A flick carrying on after release.
  | { kind: 'glide'; vx: number; vy: number }
  // Zooming about a fixed point on screen.
  | { kind: 'zoom'; log: Spring; sx: number; sy: number; x: number; y: number }
  | { kind: 'home'; cx: Spring; cy: Spring; log: Spring; aspect: Spring };

export function Graph({ ref, items, dark, settings, onMovePoint }: GraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const live = useRef({ items, dark, settings, onMovePoint });
  live.current = { items, dark, settings, onMovePoint };
  const api = useRef<GraphHandle & { redraw(): void }>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const view: View = { cx: 0, cy: 0, scale: 50, aspect: 1 };
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastTime = 0;
    let animation: Animation | undefined;
    let trace: Trace | undefined;
    // Intersections and intercepts in view, refreshed on every draw.
    let points: PointOfInterest[] = [];
    // The ones the user clicked to keep labelled, and the one under the mouse.
    let pinned: PointOfInterest[] = [];
    let hovered: PointOfInterest | undefined;
    // Where the mouse is over the canvas, and the axis it is on with Shift held:
    // that axis is highlighted, and is the one a scroll would stretch. A pinch that
    // starts with both fingers on an axis sets it too.
    let mouse: { x: number; y: number } | undefined;
    let stretching: 'x' | 'y' | undefined;

    // The origin at the centre of the page, whatever the expression panel covers.
    const homeView = (): View => ({ cx: 0, cy: 0, scale: Math.min(64, Math.max(28, width / 21)), aspect: 1 });

    const toScreen = (x: number, y: number): [number, number] => [
      width / 2 + (x - view.cx) * view.scale,
      height / 2 - (y - view.cy) * scaleY(view),
    ];

    const nearestPoint = (sx: number, sy: number, radius: number, key?: string) => {
      let best: PointOfInterest | undefined;
      let bestDistance = radius;
      for (const p of points) {
        if (key && p.key !== key) continue;
        const [px, py] = toScreen(p.x, p.y);
        const distance = Math.hypot(px - sx, py - sy);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = p;
        }
      }
      return best;
    };

    // Coordinate labels are HTML placed over the canvas, so they can be typeset maths.
    // The elements are reused between frames; only their position changes while panning.
    const layer = labelsRef.current!;
    const sizes = new Map<Element, { latex: string; k: number; w: number; h: number }>();
    const placeLabels = (labels: Label[]) => {
      while (layer.children.length > labels.length) {
        sizes.delete(layer.lastElementChild!);
        layer.lastElementChild!.remove();
      }
      while (layer.children.length < labels.length) {
        const el = document.createElement('div');
        el.className = 'graph-label';
        layer.append(el);
      }
      // Labels are a different size in projector mode, so they are measured again for it.
      const k = sizeOf(live.current.settings);
      labels.forEach((label, i) => {
        const el = layer.children[i] as HTMLElement;
        let size = sizes.get(el);
        if (!size || size.latex !== label.latex || size.k !== k) {
          el.innerHTML = convertLatexToMarkup(label.latex, { defaultMode: 'math' });
          size = { latex: label.latex, k, w: el.offsetWidth, h: el.offsetHeight };
          sizes.set(el, size);
        }
        // Centred above the dot; below it near the top edge, and kept inside the canvas.
        const left = Math.max(8, Math.min(width - size.w - 8, label.x - size.w / 2));
        const gap = 14 * k;
        const top = label.y - gap - size.h < 8 ? label.y + gap : label.y - gap - size.h;
        el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      });
    };

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      points = findPoints(live.current.items, width, height, view);
      // Curves move (sliders), so pins follow the nearest point of the same pair.
      // A pin that is off screen is kept as it was; one whose point is gone is dropped.
      pinned = pinned.flatMap((pin) => {
        const [sx, sy] = toScreen(pin.x, pin.y);
        if (sx < 0 || sx > width || sy < 0 || sy > height) return [pin];
        const match = nearestPoint(sx, sy, 40, pin.key);
        return match ? [match] : [];
      });
      if (hovered) {
        const [sx, sy] = toScreen(hovered.x, hovered.y);
        hovered = nearestPoint(sx, sy, 2);
      }
      const labelled = hovered && !pinned.includes(hovered) ? [...pinned, hovered] : pinned;
      const theme = live.current.dark ? DARK : LIGHT;
      placeLabels(draw(ctx, width, height, view, theme, live.current.items, trace, points, labelled, stretching, live.current.settings));
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = lastTime ? Math.min(now - lastTime, 34) : 16;
      lastTime = now;
      if (animation?.kind === 'glide') {
        const x = decay(animation.vx, dt);
        const y = decay(animation.vy, dt);
        view.cx -= x.distance / view.scale;
        view.cy += y.distance / scaleY(view);
        animation.vx = x.velocity;
        animation.vy = y.velocity;
        if (Math.hypot(x.velocity, y.velocity) < 6) animation = undefined;
      } else if (animation?.kind === 'zoom') {
        const a = animation;
        a.log.step(dt / 1000);
        if (a.log.settled(1e-4)) {
          a.log.finish();
          animation = undefined;
        }
        view.scale = Math.exp(a.log.value);
        view.cx = a.x - (a.sx - width / 2) / view.scale;
        view.cy = a.y + (a.sy - height / 2) / scaleY(view);
      } else if (animation?.kind === 'home') {
        const a = animation;
        const springs = [a.cx, a.cy, a.log, a.aspect];
        for (const spring of springs) spring.step(dt / 1000, 0.45);
        const unit = 1 / view.scale;
        if (a.cx.settled(unit * 0.05) && a.cy.settled(unit * 0.05) && a.log.settled(1e-4) && a.aspect.settled(1e-4)) {
          for (const spring of springs) spring.finish();
          animation = undefined;
        }
        view.cx = a.cx.value;
        view.cy = a.cy.value;
        view.scale = Math.exp(a.log.value);
        view.aspect = Math.exp(a.aspect.value);
      }
      render();
      if (animation) frame = requestAnimationFrame(tick);
      else lastTime = 0;
    };

    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const toPlane = (sx: number, sy: number): [number, number] => [
      view.cx + (sx - width / 2) / view.scale,
      view.cy - (sy - height / 2) / scaleY(view),
    ];

    // Scales the view so the plane point under (sx, sy) stays under it.
    const zoomAt = (sx: number, sy: number, factor: number) => {
      const [x, y] = toPlane(sx, sy);
      view.scale = clampScale(view.scale * factor);
      view.cx = x - (sx - width / 2) / view.scale;
      view.cy = y + (sy - height / 2) / scaleY(view);
    };

    // Which axis the pointer is on, if either: within a few pixels of its line, which
    // takes in the numbers beside it. Near the origin the closer axis wins.
    const axisAt = (sx: number, sy: number): 'x' | 'y' | undefined => {
      const [originX, originY] = toScreen(0, 0);
      const fromXAxis = Math.abs(sy - originY);
      const fromYAxis = Math.abs(sx - originX);
      if (Math.min(fromXAxis, fromYAxis) > AXIS_RADIUS) return undefined;
      return fromXAxis <= fromYAxis ? 'x' : 'y';
    };

    // The axis both fingers of a pinch are on, if they share one. With both near the
    // origin, the axis the fingers are spread along wins.
    const axisBetween = (a: { x: number; y: number }, b: { x: number; y: number }): 'x' | 'y' | undefined => {
      const [originX, originY] = toScreen(0, 0);
      const onX = Math.max(Math.abs(a.y - originY), Math.abs(b.y - originY)) <= TOUCH_AXIS_RADIUS;
      const onY = Math.max(Math.abs(a.x - originX), Math.abs(b.x - originX)) <= TOUCH_AXIS_RADIUS;
      if (onX && onY) return Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? 'x' : 'y';
      return onX ? 'x' : onY ? 'y' : undefined;
    };

    // Works out the axis to highlight from where the mouse is and whether Shift is down.
    const updateStretching = (shift: boolean) => {
      const axis = shift && mouse && !hovered && pointers.size === 0 ? axisAt(mouse.x, mouse.y) : undefined;
      canvas.style.cursor = hovered ? 'pointer' : axis === 'x' ? 'ew-resize' : axis === 'y' ? 'ns-resize' : '';
      if (axis === stretching) return;
      stretching = axis;
      redraw();
    };

    // Stretches one axis about the plane point under (sx, sy), leaving the other alone.
    const stretchAt = (axis: 'x' | 'y', sx: number, sy: number, factor: number) => {
      const [x, y] = toPlane(sx, sy);
      const yScale = scaleY(view);
      if (axis === 'x') {
        view.scale = clampScale(view.scale * factor);
        view.aspect = yScale / view.scale;
        view.cx = x - (sx - width / 2) / view.scale;
      } else {
        view.aspect = clampScale(yScale * factor) / view.scale;
        view.cy = y + (sy - height / 2) / scaleY(view);
      }
    };

    const zoomBy = (factor: number, sx = width / 2, sy = height / 2) => {
      if (reducedMotion()) {
        animation = undefined;
        zoomAt(sx, sy, factor);
        redraw();
        return;
      }
      // Pressing again mid-zoom moves the target and keeps the spring's velocity.
      const log = animation?.kind === 'zoom' ? animation.log : new Spring(Math.log(view.scale));
      log.target = Math.log(clampScale(Math.exp(log.target) * factor));
      const [x, y] = toPlane(sx, sy);
      animation = { kind: 'zoom', log, sx, sy, x, y };
      redraw();
    };

    const home = () => {
      const target = homeView();
      if (reducedMotion()) {
        animation = undefined;
        Object.assign(view, target);
        redraw();
        return;
      }
      const cx = new Spring(view.cx);
      const cy = new Spring(view.cy);
      const log = new Spring(Math.log(view.scale));
      const aspect = new Spring(Math.log(view.aspect));
      cx.target = target.cx;
      cy.target = target.cy;
      log.target = Math.log(target.scale);
      aspect.target = 0;
      animation = { kind: 'home', cx, cy, log, aspect };
      redraw();
    };

    const bounds = (): Bounds => {
      const [xMin, yMax] = toPlane(0, 0);
      const [xMax, yMin] = toPlane(width, height);
      return { xMin, xMax, yMin, yMax };
    };
    const setBounds = ({ xMin, xMax, yMin, yMax }: Bounds) => {
      if (!(xMax > xMin && yMax > yMin) || width === 0 || height === 0) return;
      animation = undefined;
      view.scale = clampScale(width / (xMax - xMin));
      view.aspect = clampScale(height / (yMax - yMin)) / view.scale;
      view.cx = (xMin + xMax) / 2;
      view.cy = (yMin + yMax) / 2;
      redraw();
    };

    api.current = { zoomBy: (factor) => zoomBy(factor), home, bounds, setBounds, redraw };

    // Finds the plot under the pointer, measuring distance perpendicular to the curve
    // so steep curves are as easy to grab as flat ones.
    const hitTest = (sx: number, sy: number): Trace | undefined => {
      const [x, y] = toPlane(sx, sy);
      const yScale = scaleY(view);
      let best: Trace | undefined;
      let bestDistance = HIT_RADIUS;
      const list = live.current.items;
      for (let i = list.length - 1; i >= 0; i--) {
        const { id, plot } = list[i];
        let distance = Infinity;
        let at = 0;
        if (plot.kind === 'point') {
          distance = Math.hypot((plot.x - x) * view.scale, (plot.y - y) * yScale) - 4;
        } else if (plot.kind === 'fx' || plot.kind === 'fy') {
          at = plot.kind === 'fx' ? x : y;
          const other = plot.kind === 'fx' ? y : x;
          // Pixels per unit along the plot's variable, and across it (the plot's value).
          const along = plot.kind === 'fx' ? view.scale : yScale;
          const across = plot.kind === 'fx' ? yScale : view.scale;
          const px = 1 / along;
          const value = plot.f(at);
          // The slope as it appears on screen.
          const slope = ((plot.f(at + px) - plot.f(at - px)) / (2 * px)) * (across / along);
          distance = (Math.abs(value - other) * across) / Math.sqrt(1 + (Number.isFinite(slope) ? slope * slope : 0));
        }
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { id, at };
        }
      }
      return best;
    };

    // The movable point nearest the pointer, with where the pointer is relative to it.
    const movablePoint = (sx: number, sy: number, radius: number) => {
      let best: { id: string; dx: number; dy: number } | undefined;
      let bestDistance = radius;
      const list = live.current.items;
      for (let i = list.length - 1; i >= 0; i--) {
        const { id, plot } = list[i];
        if (plot.kind !== 'point' || !plot.drag) continue;
        const [px, py] = toScreen(plot.x, plot.y);
        const distance = Math.hypot(px - sx, py - sy);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { id, dx: px - sx, dy: py - sy };
        }
      }
      return best;
    };

    // A coordinate rounded to what one pixel can tell apart, so a dragged point lands on
    // tidy numbers rather than a string of digits.
    const snap = (value: number, scale: number) => {
      const step = 10 ** -Math.ceil(Math.log10(scale));
      return parseFloat((Math.round(value / step) * step).toPrecision(12));
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let mode: 'idle' | 'pan' | 'trace' | 'pinch' | 'point' | 'move' = 'idle';
    let moving: ReturnType<typeof movablePoint>;
    let pressed: { point: PointOfInterest; x: number; y: number } | undefined;
    let history: { t: number; x: number; y: number }[] = [];

    const position = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      // Any touch takes over from whatever was animating.
      animation = undefined;
      stretching = undefined;
      const p = position(e);
      pointers.set(e.pointerId, p);
      const grab = e.pointerType === 'mouse' ? GRAB_RADIUS : TOUCH_GRAB_RADIUS;
      moving = pointers.size === 1 ? movablePoint(p.x, p.y, grab) : undefined;
      const point = pointers.size === 1 && !moving ? nearestPoint(p.x, p.y, POINT_RADIUS) : undefined;
      if (moving) {
        // Its coordinates show while it is held.
        mode = 'move';
        trace = { id: moving.id, at: 0 };
        canvas.dataset.dragging = '';
      } else if (point) {
        // Might be a click on the point or the start of a pan; movement decides.
        mode = 'point';
        pressed = { point, ...p };
        trace = undefined;
      } else if (pointers.size === 1) {
        const hit = hitTest(p.x, p.y);
        trace = hit;
        mode = hit ? 'trace' : 'pan';
        history = [{ t: e.timeStamp, ...p }];
        if (!hit && !live.current.settings.locked) canvas.dataset.dragging = '';
      } else if (pointers.size === 2) {
        mode = 'pinch';
        trace = undefined;
        // Pinching on an axis stretches that axis alone.
        const [a, b] = pointers.values();
        stretching = axisBetween(a, b);
      }
      redraw();
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = position(e);
      const previous = pointers.get(e.pointerId);
      if (!previous) {
        if (e.pointerType === 'mouse') {
          const movable = movablePoint(p.x, p.y, GRAB_RADIUS);
          if (movable) canvas.dataset.movable = '';
          else delete canvas.dataset.movable;
          const point = movable ? undefined : nearestPoint(p.x, p.y, POINT_RADIUS);
          const hit = point ? undefined : hitTest(p.x, p.y);
          if (point !== hovered || hit?.id !== trace?.id || hit?.at !== trace?.at) {
            hovered = point;
            trace = hit;
            redraw();
          }
          mouse = p;
          updateStretching(e.shiftKey);
        }
        return;
      }
      pointers.set(e.pointerId, p);
      if (mode === 'point' && pressed && Math.hypot(p.x - pressed.x, p.y - pressed.y) > CLICK_SLOP) {
        mode = 'pan';
        pressed = undefined;
        history = [{ t: e.timeStamp, ...previous }];
        if (!live.current.settings.locked) canvas.dataset.dragging = '';
      }
      // A locked view ignores the drags and pinches that would move it.
      const locked = live.current.settings.locked;
      if (mode === 'move' && moving) {
        const [x, y] = toPlane(p.x + moving.dx, p.y + moving.dy);
        live.current.onMovePoint(moving.id, snap(x, view.scale), snap(y, scaleY(view)));
      } else if (mode === 'pan' && !locked) {
        view.cx -= (p.x - previous.x) / view.scale;
        view.cy += (p.y - previous.y) / scaleY(view);
        history.push({ t: e.timeStamp, ...p });
        while (history.length > 2 && e.timeStamp - history[0].t > 100) history.shift();
      } else if (mode === 'trace' && trace) {
        const item = live.current.items.find((it) => it.id === trace!.id);
        const [x, y] = toPlane(p.x, p.y);
        if (item?.plot.kind === 'fx') trace = { id: trace.id, at: x };
        else if (item?.plot.kind === 'fy') trace = { id: trace.id, at: y };
      } else if (mode === 'pinch' && pointers.size === 2 && !locked) {
        const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
        const before = { x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 };
        const after = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
        const spreadBefore = Math.hypot(previous.x - other.x, previous.y - other.y);
        const spreadAfter = Math.hypot(p.x - other.x, p.y - other.y);
        view.cx -= (after.x - before.x) / view.scale;
        view.cy += (after.y - before.y) / scaleY(view);
        if (stretching) {
          // Only the spread along the axis counts, so a wobble across it does nothing.
          const alongBefore = Math.abs(stretching === 'x' ? previous.x - other.x : previous.y - other.y);
          const alongAfter = Math.abs(stretching === 'x' ? p.x - other.x : p.y - other.y);
          if (Math.min(alongBefore, alongAfter) >= MIN_STRETCH_SPREAD) {
            stretchAt(stretching, after.x, after.y, alongAfter / alongBefore);
          }
        } else if (spreadBefore > 0) zoomAt(after.x, after.y, spreadAfter / spreadBefore);
      }
      redraw();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (mode === 'pinch' && pointers.size === 1) {
        // One finger lifted: the other carries on as a pan.
        const [rest] = pointers.values();
        mode = 'pan';
        history = [{ t: e.timeStamp, ...rest }];
        stretching = undefined;
        redraw();
        return;
      }
      if (pointers.size > 0) return;
      if (mode === 'pan' && e.type === 'pointerup' && !reducedMotion() && !live.current.settings.locked) {
        // Hand the finger's velocity to the glide so there is no seam at release.
        const first = history[0];
        const last = history[history.length - 1];
        const dt = last.t - first.t;
        if (dt > 8 && e.timeStamp - last.t < 60) {
          const vx = ((last.x - first.x) / dt) * 1000;
          const vy = ((last.y - first.y) / dt) * 1000;
          if (Math.hypot(vx, vy) > 60) animation = { kind: 'glide', vx, vy };
        }
      }
      if (mode === 'point' && pressed && e.type === 'pointerup') {
        // Clicking a point pins its label; clicking it again lets it go.
        const { point } = pressed;
        const [sx, sy] = toScreen(point.x, point.y);
        const existing = pinned.find((pin) => {
          const [px, py] = toScreen(pin.x, pin.y);
          return Math.hypot(px - sx, py - sy) < 2;
        });
        pinned = existing ? pinned.filter((pin) => pin !== existing) : [...pinned, point];
        if (e.pointerType === 'mouse') hovered = existing ? undefined : point;
      }
      pressed = undefined;
      stretching = undefined;
      if ((mode === 'trace' || mode === 'move') && e.pointerType !== 'mouse') trace = undefined;
      moving = undefined;
      mode = 'idle';
      delete canvas.dataset.dragging;
      redraw();
    };

    // Shift can go down or up while the mouse sits still on an axis.
    const onShift = (e: KeyboardEvent) => {
      if (e.key === 'Shift') updateStretching(e.type === 'keydown');
    };
    const onWindowBlur = () => updateStretching(false);

    const onPointerLeave = () => {
      mouse = undefined;
      updateStretching(false);
      if (mode === 'idle' && (trace || hovered)) {
        trace = undefined;
        hovered = undefined;
        redraw();
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (live.current.settings.locked) return;
      animation = undefined;
      const p = position(e);
      // Pinch on a trackpad arrives as ctrl+wheel with small deltas.
      const unit = e.deltaMode === 1 ? 16 : 1;
      // With Shift held, many systems turn a vertical scroll into a horizontal one.
      const raw = e.shiftKey && e.deltaY === 0 ? e.deltaX : e.deltaY;
      const delta = Math.max(-120, Math.min(120, raw * unit));
      const factor = Math.exp(-delta * (e.ctrlKey ? 0.012 : 0.0025));
      // Shift-scrolling on an axis stretches that axis alone.
      mouse = p;
      updateStretching(e.shiftKey);
      if (stretching) stretchAt(stretching, p.x, p.y, factor);
      else zoomAt(p.x, p.y, factor);
      redraw();
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (live.current.settings.locked) return;
      const p = position(e);
      if (nearestPoint(p.x, p.y, POINT_RADIUS)) return;
      zoomBy(e.shiftKey ? 0.5 : 2, p.x, p.y);
    };

    let sized = false;
    const observer = new ResizeObserver(() => {
      const parent = canvas.parentElement!;
      width = parent.clientWidth;
      height = parent.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (!sized && width > 0) {
        Object.assign(view, homeView());
        sized = true;
      }
      // Draw now rather than next frame, so the canvas never shows a blank frame mid-resize.
      render();
    });
    observer.observe(canvas.parentElement!);

    // Labels are measured when created; measure again once the maths fonts have loaded.
    document.fonts.ready.then(() => {
      sizes.clear();
      redraw();
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('keydown', onShift);
    window.addEventListener('keyup', onShift);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onShift);
      window.removeEventListener('keyup', onShift);
      window.removeEventListener('blur', onWindowBlur);
      canvas.removeEventListener('dblclick', onDoubleClick);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => api.current?.zoomBy(factor),
    home: () => api.current?.home(),
    bounds: () => api.current!.bounds(),
    setBounds: (bounds) => api.current?.setBounds(bounds),
  }));

  useEffect(() => {
    api.current?.redraw();
  }, [items, dark, settings]);

  return (
    <div className="graph" data-projector={settings.projector || undefined}>
      <canvas ref={canvasRef} aria-label="Graph" />
      <div className="graph-labels" ref={labelsRef} />
    </div>
  );
}
