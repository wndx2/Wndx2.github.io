// Draws the page: squared paper, then the wires and symbols in ink, and the values and meter
// readings written beside the parts.
import { key, pins, turn, centre } from "./circuit.js";
import { PARTS, GIVENS } from "./parts.js";
import { quantity } from "./units.js";
import { symbol, bodyOf } from "./symbols.js";
import { reading } from "./units.js";

// The pen: about the weight of a fine-liner, in grid squares.
const PEN = 0.09;

const paths = new Map();
function path2d(d) {
	let p = paths.get(d);
	if (!p) paths.set(d, (p = new Path2D(d)));
	return p;
}

// What a part measures, as a meter would show it: magnitudes, and rms values once there's an
// AC supply (NaN until a whole cycle has gone by).
export function measure(sim, part) {
	const s = sim.states.get(part.id);
	if (!s) return null;
	if (sim.ac) return { v: s.rms[0], i: s.rms[1], v2: s.rms[2], i2: s.rms[3], rms: true };
	return { v: Math.abs(s.v), i: Math.abs(s.i), v2: Math.abs(s.v2), i2: Math.abs(s.i2), rms: false };
}

const show = (value, unit) => (Number.isNaN(value) ? "–" : reading(value, unit));

// How brightly a lamp or LED is lit, from 0 up.
function glowOf(sim, part) {
	const s = sim.states.get(part.id);
	if (!s) return 0;
	if (part.type === "lamp") {
		const m = measure(sim, part);
		const power = sim.ac ? m.v * m.i : Math.abs(s.v * s.i);
		return Number.isNaN(power) ? Math.abs(s.v * s.i) / part.props.P : power / part.props.P;
	}
	// An LED follows its current as it is, so on AC it can be seen flashing in slow motion.
	return Math.max(0, s.i) / 0.02;
}

// The current along every wire, from its first end to its second. Parts give and take current
// at their ends; within each group of joined wires the current is shared out along a tree of
// them (a loop made only of wire carries none).
export function flows(circuit, sim) {
	const demand = new Map();
	const take = ([x, y], i) => {
		const k = key(x, y);
		demand.set(k, (demand.get(k) || 0) + i);
	};
	for (const part of circuit.parts) {
		const s = sim.states.get(part.id);
		if (!s) continue;
		const ends = pins(part);
		take(ends[0], s.i);
		take(ends[1], -s.i);
		if (part.type === "transformer") {
			take(ends[2], s.i2);
			take(ends[3], -s.i2);
		}
	}
	const adj = new Map();
	const link = (k, entry) => {
		if (!adj.has(k)) adj.set(k, []);
		adj.get(k).push(entry);
	};
	for (const w of circuit.wires) {
		const a = key(w.x1, w.y1);
		const b = key(w.x2, w.y2);
		link(a, { w, to: b, forward: true });
		link(b, { w, to: a, forward: false });
	}
	const out = new Map();
	const seen = new Set();
	for (const start of adj.keys()) {
		if (seen.has(start)) continue;
		seen.add(start);
		const order = [start];
		const up = new Map();
		for (let q = 0; q < order.length; q++) {
			for (const e of adj.get(order[q])) {
				if (seen.has(e.to)) continue;
				seen.add(e.to);
				up.set(e.to, e);
				order.push(e.to);
			}
		}
		const sub = new Map();
		for (let q = order.length - 1; q >= 0; q--) {
			const k = order[q];
			const total = (sub.get(k) || 0) + (demand.get(k) || 0);
			const e = up.get(k);
			if (!e) continue;
			out.set(e.w.id, e.forward ? total : -total);
			const parent = e.forward ? key(e.w.x1, e.w.y1) : key(e.w.x2, e.w.y2);
			sub.set(parent, (sub.get(parent) || 0) + total);
		}
	}
	return out;
}

// Where a part's label and reading go: the side, turned with the part.
function sideOf(part, which) {
	if (part.type === "transformer") return which === "label" ? [2, -0.8] : null;
	if (part.type === "ldr") return which === "label" ? [2, 1.4] : null;
	// A meter's reading goes above it, and its name, if it has one, below.
	if (part.type === "ammeter" || part.type === "voltmeter") return which === "reading" ? [2, -1.4] : [2, 1.4];
	return which === "label" ? [2, -1.4] : [2, 1.4];
}

export function draw(ctx, scene) {
	const { width, height, dpr, view, colours, circuit, sim } = scene;
	const { s, ox, oy } = view;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = colours.canvas;
	ctx.fillRect(0, 0, width, height);

	// Squared paper, in hairlines on whole pixels.
	let step = s;
	while (step < 10) step *= 2;
	ctx.beginPath();
	for (let x = (((ox % step) + step) % step) - step; x < width; x += step) {
		const px = Math.round(x * dpr) / dpr + 0.5 / dpr;
		ctx.moveTo(px, 0);
		ctx.lineTo(px, height);
	}
	for (let y = (((oy % step) + step) % step) - step; y < height; y += step) {
		const py = Math.round(y * dpr) / dpr + 0.5 / dpr;
		ctx.moveTo(0, py);
		ctx.lineTo(width, py);
	}
	ctx.strokeStyle = colours.grid;
	ctx.lineWidth = 1 / dpr;
	ctx.stroke();

	const world = () => ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
	const screen = (x, y) => [ox + x * s, oy + y * s];
	world();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	const sel = scene.selection;
	const isSel = (kind, id) => sel && sel.kind === kind && sel.id === id;

	// Hovered: a soft patch behind the part, so it's clear what a click would take.
	if (scene.hover && scene.hover.kind === "part" && !isSel("part", scene.hover.id)) {
		const part = circuit.parts.find((p) => p.id === scene.hover.id);
		if (part) {
			const b = bodyOf(part.type);
			ctx.save();
			ctx.translate(part.x, part.y);
			ctx.rotate((part.rot * Math.PI) / 2);
			ctx.fillStyle = colours.fill;
			ctx.beginPath();
			ctx.roundRect(b.u0 - 0.2, b.v0 - 0.1, b.u1 - b.u0 + 0.4, b.v1 - b.v0 + 0.2, 0.35);
			ctx.fill();
			ctx.restore();
		}
	}

	// Wires.
	ctx.lineWidth = PEN;
	for (const w of circuit.wires) {
		ctx.strokeStyle = isSel("wire", w.id) ? colours.accent : colours.ink;
		ctx.beginPath();
		ctx.moveTo(w.x1, w.y1);
		ctx.lineTo(w.x2, w.y2);
		ctx.stroke();
	}

	// Parts.
	const texts = [];
	const drawPart = (part, colour, live) => {
		const sym = symbol(part.type, part.props, live);
		ctx.save();
		ctx.translate(part.x, part.y);
		ctx.rotate((part.rot * Math.PI) / 2);
		if (sym.glow && sym.glow.amount > 0.01) {
			const g = sym.glow;
			const a = Math.min(g.amount, 1.5);
			const halo = ctx.createRadialGradient(g.x, g.y, g.r * 0.3, g.x, g.y, g.r + 1.4 * a);
			halo.addColorStop(0, withAlpha(g.colour, Math.min(1, 0.95 * a)));
			halo.addColorStop(1, withAlpha(g.colour, 0));
			ctx.fillStyle = halo;
			ctx.beginPath();
			ctx.arc(g.x, g.y, g.r + 1.4 * a, 0, Math.PI * 2);
			ctx.fill();
			if (g.fill) {
				ctx.fillStyle = withAlpha(g.colour, Math.min(1, a));
				ctx.fill(path2d(g.fill));
			}
		}
		ctx.strokeStyle = colour;
		ctx.fillStyle = colour;
		for (const p of sym.paths) {
			if (p.fill) ctx.fill(path2d(p.d));
			else {
				ctx.lineWidth = PEN * (p.w || 1);
				ctx.stroke(path2d(p.d));
			}
		}
		ctx.restore();
		for (const t of sym.texts) {
			const [dx, dy] = turn(t.x, t.y, part.rot);
			texts.push({ t: t.t, x: part.x + dx, y: part.y + dy, colour, size: 1.0, align: "center", weight: 500 });
		}
	};
	for (const part of circuit.parts) {
		const s0 = sim.states.get(part.id);
		const live = s0 ? { blown: s0.blown, glow: part.type === "lamp" || part.type === "led" ? glowOf(sim, part) : 0 } : null;
		const colour = isSel("part", part.id) ? colours.accent : colours.ink;
		drawPart(part, colour, live);
	}

	// Junctions get a dot; a part's end with nothing on it is left as an open circle.
	const ends = new Set();
	for (const part of circuit.parts) for (const [x, y] of pins(part)) ends.add(key(x, y));
	for (const [k, n] of scene.meetings) {
		const [x, y] = k.split(",").map(Number);
		if (n >= 3) {
			ctx.fillStyle = colours.ink;
			ctx.beginPath();
			ctx.arc(x, y, 0.17, 0, Math.PI * 2);
			ctx.fill();
		} else if (n === 1 && ends.has(k)) {
			ctx.fillStyle = colours.canvas;
			ctx.strokeStyle = colours.ink;
			ctx.lineWidth = PEN * 0.75;
			ctx.beginPath();
			ctx.arc(x, y, 0.13, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
	}

	// What's being added: the part under the pointer, or the wire being drawn.
	if (scene.ghost) {
		ctx.globalAlpha = 0.55;
		drawPart(scene.ghost, colours.accent, null);
		ctx.globalAlpha = 1;
	}
	if (scene.draft) {
		ctx.strokeStyle = colours.accent;
		ctx.lineWidth = PEN;
		ctx.beginPath();
		for (const [x1, y1, x2, y2] of scene.draft) {
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
		}
		ctx.stroke();
	}
	if (scene.target) {
		const [x, y] = scene.target;
		ctx.strokeStyle = colours.accent;
		ctx.lineWidth = PEN * 0.9;
		ctx.beginPath();
		ctx.arc(x, y, 0.34, 0, Math.PI * 2);
		ctx.stroke();
	}

	// Writing goes on last, upright whichever way the part faces, at a size that grows with
	// the zoom but never gets too small to read.
	for (const part of circuit.parts) {
		const colour = isSel("part", part.id) ? colours.accent : colours.ink;
		// The name is always written, and anything the question gives; the value only while
		// values are shown. A value that was worked out is written in the reading colour.
		const value = scene.values ? PARTS[part.type].label(part.props) : "";
		const givens = GIVENS.filter(([key]) => typeof part.props[key] === "number").map(([key, , unit]) => quantity(part.props[key], unit));
		const text = [part.name, value, ...givens].filter(Boolean).join("   ");
		const side = sideOf(part, "label");
		const found = part.props.unknown && !isSel("part", part.id);
		if (text && side) texts.push(placed(part, side, text, found ? colours.reading : colour, 0.62, found ? 600 : 400));
		const at = sideOf(part, "reading");
		if (at && (part.type === "ammeter" || part.type === "voltmeter")) {
			const m = measure(sim, part);
			if (m) {
				const text = part.type === "ammeter" ? show(m.i, "A") : show(m.v, "V");
				texts.push({ ...placed(part, at, text, colours.reading, 0.62, 600), tag: true });
			}
		}
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.textBaseline = "middle";
	for (const t of texts) {
		const px = Math.max(10, t.size * s);
		ctx.font = `${t.weight} ${px}px ${colours.font}`;
		ctx.textAlign = t.align;
		const [x, y] = screen(t.x, t.y);
		if (t.tag) {
			const w = ctx.measureText(t.t).width;
			const left = t.align === "left" ? x : t.align === "right" ? x - w : x - w / 2;
			ctx.fillStyle = colours.tag;
			ctx.beginPath();
			ctx.roundRect(left - px * 0.4, y - px * 0.72, w + px * 0.8, px * 1.44, px * 0.72);
			ctx.fill();
		}
		ctx.fillStyle = t.colour;
		ctx.fillText(t.t, x, y);
	}
}

// Text placed at a point beside a part, aligned away from it: centred above or below, or
// starting from the part's side.
function placed(part, at, t, colour, size, weight) {
	const [cx, cy] = centre(part);
	const [dx, dy] = turn(at[0], at[1], part.rot);
	const x = part.x + dx;
	const y = part.y + dy;
	let align = "center";
	let nx = x;
	if (part.type !== "transformer" && Math.abs(x - cx) > Math.abs(y - cy)) {
		align = x > cx ? "left" : "right";
		nx = cx + Math.sign(x - cx) * 1.1;
	}
	return { t, x: nx, y, colour, size, align, weight };
}

function withAlpha(hex, a) {
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
