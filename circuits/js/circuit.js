// A circuit is parts and wires on squared paper. Everything sits on the crossings of the grid,
// in whole squares. Wires join where their ends meet, as they would on paper; two wires that
// only cross don't.
//
//   part: { id, type, x, y, rot, props, name }   (x, y) is its first end; rot is quarter turns;
//                                                 name is an optional label, like "A" or "Bulb 2"
//   wire: { id, x1, y1, x2, y2 }
import { PARTS, centreOf } from "./parts.js";

export const key = (x, y) => x + "," + y;

// A point of a part, turned by a number of quarter turns clockwise (y points down).
export function turn(u, v, rot) {
	switch (rot & 3) {
		case 0:
			return [u, v];
		case 1:
			return [-v, u];
		case 2:
			return [-u, -v];
		default:
			return [v, -u];
	}
}

export function pins(part) {
	return PARTS[part.type].pins.map(([u, v]) => {
		const [dx, dy] = turn(u, v, part.rot);
		return [part.x + dx, part.y + dy];
	});
}

// A point on the page in the part's own squares, as it was drawn before being turned.
export function toLocal(part, x, y) {
	return turn(x - part.x, y - part.y, 4 - (part.rot & 3));
}

export function centre(part) {
	const [u, v] = centreOf(part.type);
	const [dx, dy] = turn(u, v, part.rot);
	return [part.x + dx, part.y + dy];
}

// Where to put a part's first end so that its middle lands on (x, y).
export function anchorFor(type, rot, x, y) {
	const [u, v] = centreOf(type);
	const [dx, dy] = turn(u, v, rot);
	return [Math.round(x - dx), Math.round(y - dy)];
}

export function emptyCircuit() {
	return { parts: [], wires: [], next: 1 };
}

// props may carry a name, which is kept on the part rather than among its settings.
export function newPart(circuit, type, x, y, rot = 0, props = {}) {
	const { name, ...settings } = props;
	const part = { id: "p" + circuit.next++, type, x, y, rot, props: { ...PARTS[type].props, ...settings } };
	if (name) part.name = String(name).slice(0, 24);
	circuit.parts.push(part);
	return part;
}

export function newWire(circuit, x1, y1, x2, y2) {
	const wire = { id: "w" + circuit.next++, x1, y1, x2, y2 };
	circuit.wires.push(wire);
	return wire;
}

// Is (x, y) on the wire, strictly between its ends?
function inside(w, x, y) {
	const dx = w.x2 - w.x1;
	const dy = w.y2 - w.y1;
	if ((x - w.x1) * dy - (y - w.y1) * dx !== 0) return false;
	const along = (x - w.x1) * dx + (y - w.y1) * dy;
	return along > 0 && along < dx * dx + dy * dy;
}

// Tidies the wiring after an edit. A wire that an end lands partway along is split there, so
// the two join, just as a T-junction drawn on paper does. Wires of no length, and second
// copies of a wire, go.
export function normalize(circuit) {
	const ends = new Map();
	const mark = (x, y) => ends.set(key(x, y), [x, y]);
	for (const w of circuit.wires) {
		mark(w.x1, w.y1);
		mark(w.x2, w.y2);
	}
	for (const part of circuit.parts) for (const [x, y] of pins(part)) mark(x, y);

	const wires = [];
	const seen = new Set();
	const keep = (w) => {
		if (w.x1 === w.x2 && w.y1 === w.y2) return;
		const a = key(w.x1, w.y1);
		const b = key(w.x2, w.y2);
		const id = a < b ? a + "|" + b : b + "|" + a;
		if (seen.has(id)) return;
		seen.add(id);
		wires.push(w);
	};
	for (const w of circuit.wires) {
		const cuts = [...ends.values()].filter(([x, y]) => inside(w, x, y));
		if (!cuts.length) {
			keep(w);
			continue;
		}
		const dist = ([x, y]) => Math.abs(x - w.x1) + Math.abs(y - w.y1);
		cuts.sort((p, q) => dist(p) - dist(q));
		let [x, y] = [w.x1, w.y1];
		cuts.forEach(([cx, cy], i) => {
			// The first piece keeps the wire's id, so a selected wire stays selected.
			keep({ id: i ? "w" + circuit.next++ : w.id, x1: x, y1: y, x2: cx, y2: cy });
			[x, y] = [cx, cy];
		});
		keep({ id: "w" + circuit.next++, x1: x, y1: y, x2: w.x2, y2: w.y2 });
	}
	circuit.wires = wires;
	return circuit;
}

// Which points are joined by wire: each group of joined points is one node of the circuit.
// Gives the number of nodes, the node of every point, and the nodes at each part's ends.
export function nets(circuit) {
	const parent = new Map();
	const find = (k) => {
		let root = k;
		while (parent.get(root) !== root) root = parent.get(root);
		while (parent.get(k) !== root) {
			const up = parent.get(k);
			parent.set(k, root);
			k = up;
		}
		return root;
	};
	const add = (k) => {
		if (!parent.has(k)) parent.set(k, k);
	};
	for (const w of circuit.wires) {
		const a = key(w.x1, w.y1);
		const b = key(w.x2, w.y2);
		add(a);
		add(b);
		parent.set(find(a), find(b));
	}
	for (const part of circuit.parts) for (const [x, y] of pins(part)) add(key(x, y));

	const index = new Map();
	const nodeOf = new Map();
	for (const k of parent.keys()) {
		const root = find(k);
		if (!index.has(root)) index.set(root, index.size);
		nodeOf.set(k, index.get(root));
	}
	const partNodes = new Map();
	for (const part of circuit.parts) partNodes.set(part.id, pins(part).map(([x, y]) => nodeOf.get(key(x, y))));
	return { count: index.size, nodeOf, partNodes };
}

// How many things meet at each point: wire ends and part ends. Three or more is a junction,
// drawn with a dot; a part's end with nothing else on it is left open.
export function meetings(circuit) {
	const count = new Map();
	const bump = (x, y) => {
		const k = key(x, y);
		count.set(k, (count.get(k) || 0) + 1);
	};
	for (const w of circuit.wires) {
		bump(w.x1, w.y1);
		bump(w.x2, w.y2);
	}
	for (const part of circuit.parts) for (const [x, y] of pins(part)) bump(x, y);
	return count;
}

export function bounds(circuit) {
	let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
	const take = (x, y) => {
		x0 = Math.min(x0, x);
		y0 = Math.min(y0, y);
		x1 = Math.max(x1, x);
		y1 = Math.max(y1, y);
	};
	for (const w of circuit.wires) {
		take(w.x1, w.y1);
		take(w.x2, w.y2);
	}
	for (const part of circuit.parts) {
		const box = part.type === "transformer" ? [[0, -1], [4, 5]] : [[0, -1.5], [4, 1.5]];
		for (const u of [box[0][0], box[1][0]])
			for (const v of [box[0][1], box[1][1]]) {
				const [dx, dy] = turn(u, v, part.rot);
				take(part.x + dx, part.y + dy);
			}
	}
	return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

// A short form for links: no ids, and only the settings that differ from a new part's.
export function pack(circuit) {
	const parts = circuit.parts.map((p) => {
		const defaults = PARTS[p.type].props;
		const changed = Object.fromEntries(Object.entries(p.props).filter(([k, v]) => defaults[k] !== v));
		const row = [p.type, p.x, p.y, p.rot];
		if (p.name) changed.name = p.name;
		if (Object.keys(changed).length) row.push(changed);
		return row;
	});
	return { v: 1, p: parts, w: circuit.wires.map((w) => [w.x1, w.y1, w.x2, w.y2]) };
}

export function unpack(data) {
	const circuit = emptyCircuit();
	for (const [type, x, y, rot, props] of data.p || []) {
		if (!PARTS[type]) continue;
		const name = props && typeof props.name === "string" ? props.name : "";
		newPart(circuit, type, x | 0, y | 0, rot & 3, { ...sanitize(type, props), name });
	}
	for (const [x1, y1, x2, y2] of data.w || []) newWire(circuit, x1 | 0, y1 | 0, x2 | 0, y2 | 0);
	return normalize(circuit);
}

// Keeps only settings the part has, of the right kind, so a hand-edited link can't break it.
function sanitize(type, props) {
	const defaults = PARTS[type].props;
	const out = {};
	for (const [k, v] of Object.entries(props || {})) {
		if (k in defaults && typeof v === typeof defaults[k] && (typeof v !== "number" || Number.isFinite(v))) out[k] = v;
	}
	return out;
}

// A whole copy, ids and all, for undo and for saving between visits.
export const snapshot = (circuit) => JSON.stringify(circuit);

export function restore(text) {
	const data = JSON.parse(text);
	const circuit = emptyCircuit();
	circuit.next = data.next | 0 || 1;
	for (const p of data.parts || []) {
		if (!PARTS[p.type]) continue;
		const part = { id: String(p.id), type: p.type, x: p.x | 0, y: p.y | 0, rot: p.rot & 3, props: { ...PARTS[p.type].props, ...sanitize(p.type, p.props) } };
		if (typeof p.name === "string" && p.name) part.name = p.name.slice(0, 24);
		circuit.parts.push(part);
	}
	for (const w of data.wires || []) circuit.wires.push({ id: String(w.id), x1: w.x1 | 0, y1: w.y1 | 0, x2: w.x2 | 0, y2: w.y2 | 0 });
	return circuit;
}

// Puts a two-ended part into a wire it was dropped on, in series: the piece of wire running
// between its two ends is taken out, so the current has to go through the part. Left in, that
// piece would join the part's ends and short it out, which is never what dropping a part on a
// wire means. Run after normalize(), which has already cut the wire at the part's ends.
export function splice(circuit, part) {
	const ends = pins(part);
	if (ends.length !== 2) return circuit;
	const [[ax, ay], [bx, by]] = ends;
	const between = (x, y) =>
		(x - ax) * (by - ay) === (y - ay) * (bx - ax) && (x - ax) * (bx - x) + (y - ay) * (by - y) >= 0;
	circuit.wires = circuit.wires.filter((w) => !(between(w.x1, w.y1) && between(w.x2, w.y2)));
	return circuit;
}
