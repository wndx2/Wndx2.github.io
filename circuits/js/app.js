import { PARTS, PALETTE, resistanceOf } from "./parts.js";
import { emptyCircuit, newPart, newWire, normalize, splice, pins, toLocal, anchorFor, centre, key, meetings, bounds, pack, unpack, snapshot, restore } from "./circuit.js";
import { Sim } from "./sim.js";
import { draw, flows, measure } from "./render.js";
import { iconSVG, bodyOf } from "./symbols.js";
import { EXAMPLES } from "./examples.js";
import { PAPERS } from "./papers.js";
import { parseValue, quantity, reading } from "./units.js";

const STORE = "circuits:circuit";
const PREFS = "circuits:prefs";
const SOURCES = new Set(["cell", "battery", "ac"]);
const RESISTIVE = new Set(["resistor", "varres", "lamp", "ldr", "thermistor"]);

const $ = (id) => document.getElementById(id);
const app = $("app");
const board = $("board");
const ctx = board.getContext("2d");

let circuit = emptyCircuit();
const sim = new Sim();
const prefs = { speed: 1, playing: true, values: true, panel: true };
// The page's position and zoom: (ox, oy) is where the grid's origin is on screen, and s is
// the size of a square in pixels.
const view = { s: 24, ox: 0, oy: 0 };

// What's selected: { kind: "part" | "wire", id }.
let selection = null;
// The part waiting to be put down (a type, or "wire"), and which way it's turned.
let tool = null;
let toolRot = 0;
let hover = null;
// Where the pointer is on the page, in squares, while it's over the page.
let pointer = null;
let gesture = null;
const touches = new Map();

let undos = [];
let redos = [];
let meet = new Map();
let wireFlows = new Map();
const traces = new Map();
let dirty = true;
let colours = {};
let size = { width: 0, height: 0, dpr: 1 };

// Ids are given a prefix each time a whole circuit is loaded, so a part from one circuit is
// never mistaken for a part of another that happens to share its number.
let loads = 0;
function fresh(c) {
	const prefix = (++loads).toString(36) + Date.now().toString(36).slice(-4) + "-";
	for (const item of [...c.parts, ...c.wires]) item.id = prefix + item.id;
	return c;
}

// Saving

function restoreState() {
	try {
		const saved = JSON.parse(localStorage.getItem(PREFS) || "{}");
		for (const k of Object.keys(prefs)) if (typeof saved[k] === typeof prefs[k]) prefs[k] = saved[k];
		if (saved.view && saved.view.s > 0) Object.assign(view, saved.view);
		const text = localStorage.getItem(STORE);
		if (text) {
			circuit = restore(text);
			return true;
		}
	} catch {
		// Private windows have no storage, and a damaged save is no worse than none.
	}
	return false;
}

let saveTimer = 0;
function save() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		try {
			localStorage.setItem(STORE, snapshot(circuit));
			localStorage.setItem(PREFS, JSON.stringify({ ...prefs, view }));
		} catch {
			// See restoreState().
		}
	}, 300);
}

// Editing. Every change goes through edit(), which keeps a copy for Undo first.

function changed() {
	normalize(circuit);
	meet = meetings(circuit);
	sim.load(circuit);
	if (!prefs.playing) sim.settle();
	wireFlows = flows(circuit, sim);
	if (selection && !find(selection)) selection = null;
	$("undo").disabled = !undos.length;
	$("redo").disabled = !redos.length;
	dirty = true;
	save();
	inspect();
}

function edit(change) {
	undos.push(snapshot(circuit));
	if (undos.length > 200) undos.shift();
	redos = [];
	change();
	changed();
}

function undo() {
	if (!undos.length) return;
	redos.push(snapshot(circuit));
	circuit = restore(undos.pop());
	changed();
}

function redo() {
	if (!redos.length) return;
	undos.push(snapshot(circuit));
	circuit = restore(redos.pop());
	changed();
}

// A change made while a slider is dragged: shown at once, but kept for Undo as one step when
// the slider is let go.
let liveBefore = null;
function editLive(change) {
	if (liveBefore === null) liveBefore = snapshot(circuit);
	change();
	sim.load(circuit);
	if (!prefs.playing) sim.settle();
	wireFlows = flows(circuit, sim);
	dirty = true;
	save();
}

function endLive() {
	if (liveBefore === null) return;
	undos.push(liveBefore);
	redos = [];
	liveBefore = null;
	changed();
}

function find(sel) {
	if (!sel) return null;
	const list = sel.kind === "part" ? circuit.parts : circuit.wires;
	return list.find((item) => item.id === sel.id) || null;
}

function select(sel) {
	const before = selection && selection.kind + selection.id;
	selection = sel;
	dirty = true;
	if ((sel && sel.kind + sel.id) !== before) inspect();
}

function loadCircuit(c, { speed, chosen, note } = {}) {
	undos.push(snapshot(circuit));
	redos = [];
	circuit = fresh(c);
	sim.reset(circuit);
	traces.clear();
	if (speed) {
		prefs.speed = speed;
		$("speed").value = String(speed);
	}
	selection = chosen === undefined || !circuit.parts[chosen] ? null : { kind: "part", id: circuit.parts[chosen].id };
	changed();
	fit();
	if (note) notice(note);
}

function place(type, at) {
	const [x, y] = anchorFor(type, toolRot, at.x, at.y);
	let part;
	edit(() => {
		part = newPart(circuit, type, x, y, toolRot);
		// Dropped onto a wire, it goes into the wire in series.
		splice(normalize(circuit), part);
	});
	select({ kind: "part", id: part.id });
}

function remove() {
	if (!selection) return;
	const { kind, id } = selection;
	edit(() => {
		if (kind === "part") circuit.parts = circuit.parts.filter((p) => p.id !== id);
		else circuit.wires = circuit.wires.filter((w) => w.id !== id);
	});
	select(null);
}

// Turns the part waiting to be put down, or else the selected part, a quarter turn about its
// middle.
function rotate() {
	if (tool && tool !== "wire") {
		toolRot = (toolRot + 1) & 3;
		dirty = true;
		return;
	}
	const part = selection && selection.kind === "part" && find(selection);
	if (!part) return;
	edit(() => {
		const [cx, cy] = centre(part);
		part.rot = (part.rot + 1) & 3;
		[part.x, part.y] = anchorFor(part.type, part.rot, cx, cy);
	});
}

function arm(type) {
	tool = tool === type ? null : type;
	if (tool && tool !== "wire") select(null);
	for (const button of $("palette").querySelectorAll(".tool")) button.setAttribute("aria-pressed", String(button.dataset.type === tool));
	updateCursor();
	dirty = true;
}

// Finding what's under the pointer

function gridAt(e) {
	const r = board.getBoundingClientRect();
	return { x: (e.clientX - r.left - view.ox) / view.s, y: (e.clientY - r.top - view.oy) / view.s };
}

const snap = (g) => [Math.round(g.x), Math.round(g.y)];

// The end of a part or wire within reach, if any.
function pinAt(g) {
	const reach = Math.min(0.9, Math.max(0.4, 10 / view.s));
	let best = null;
	let bestD = reach;
	const test = (x, y) => {
		const d = Math.hypot(g.x - x, g.y - y);
		if (d < bestD) {
			bestD = d;
			best = [x, y];
		}
	};
	for (const part of circuit.parts) for (const [x, y] of pins(part)) test(x, y);
	for (const w of circuit.wires) {
		test(w.x1, w.y1);
		test(w.x2, w.y2);
	}
	return best;
}

function partAt(g) {
	for (let k = circuit.parts.length - 1; k >= 0; k--) {
		const part = circuit.parts[k];
		const [u, v] = toLocal(part, g.x, g.y);
		const b = bodyOf(part.type);
		if (u >= b.u0 && u <= b.u1 && v >= b.v0 && v <= b.v1) return part;
	}
	return null;
}

function wireAt(g) {
	const reach = Math.max(0.3, 8 / view.s);
	for (const w of circuit.wires) {
		const dx = w.x2 - w.x1;
		const dy = w.y2 - w.y1;
		const t = Math.max(0, Math.min(1, ((g.x - w.x1) * dx + (g.y - w.y1) * dy) / (dx * dx + dy * dy)));
		if (Math.hypot(g.x - w.x1 - t * dx, g.y - w.y1 - t * dy) < reach) return w;
	}
	return null;
}

// The wires a dragged part pulls along: those with an end on one of its ends.
function attached(part) {
	const ends = pins(part).map(([x, y]) => key(x, y));
	const out = [];
	for (const w of circuit.wires) {
		const a = ends.indexOf(key(w.x1, w.y1));
		const b = ends.indexOf(key(w.x2, w.y2));
		if (a >= 0) out.push({ w, end: 1, pin: a });
		if (b >= 0) out.push({ w, end: 2, pin: b });
	}
	return out;
}

// A wire being drawn goes along, then up or down, in whichever direction the drag set off in.
function draftOf(g) {
	const [x1, y1] = g.from;
	const [x2, y2] = g.to;
	if (x1 === x2 || y1 === y2) return [[x1, y1, x2, y2]];
	return g.axis === "v"
		? [
				[x1, y1, x1, y2],
				[x1, y2, x2, y2],
			]
		: [
				[x1, y1, x2, y1],
				[x2, y1, x2, y2],
			];
}

function updateHover(g) {
	let next = null;
	let target = null;
	if (!tool) {
		target = pinAt(g);
		const part = !target && partAt(g);
		const wire = !target && !part && wireAt(g);
		next = part ? { kind: "part", id: part.id, type: part.type } : wire ? { kind: "wire", id: wire.id } : target ? { kind: "pin" } : null;
	} else if (tool === "wire") {
		target = pinAt(g) || snap(g);
	}
	hover = next;
	hoverTarget = target;
	updateCursor();
	dirty = true;
}
let hoverTarget = null;
// Where the pointer is in the window, for placing the hover card.
let client = null;

function updateCursor() {
	let c = "grab";
	if (gesture && gesture.kind === "pan" && gesture.moved) c = "grabbing";
	else if (gesture && gesture.kind === "move" && gesture.moved) c = "move";
	else if (tool) c = "crosshair";
	else if (hover && hover.kind === "pin") c = "crosshair";
	else if (hover && hover.kind === "part") c = hover.type === "switch" ? "pointer" : "move";
	else if (hover && hover.kind === "wire") c = "pointer";
	if (board.dataset.cursor !== c) board.dataset.cursor = c;
}

// Pointers on the page

function onDown(e) {
	if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
	board.setPointerCapture(e.pointerId);
	touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
	board.focus({ preventScroll: true });
	if (touches.size === 2) {
		// A second finger turns whatever the first was doing into a pinch.
		if (gesture && gesture.kind === "move") {
			restoreMove(gesture);
		}
		const [a, b] = [...touches.values()];
		gesture = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), m0: mid(a, b), view0: { ...view } };
		return;
	}
	if (touches.size > 2) return;
	const g = gridAt(e);
	pointer = g;
	const start = { x: e.clientX, y: e.clientY };
	if (e.button === 1) {
		gesture = { kind: "pan", start, ox: view.ox, oy: view.oy, moved: false };
	} else if (tool && tool !== "wire") {
		gesture = { kind: "place", start };
	} else if (tool === "wire") {
		const from = pinAt(g) || snap(g);
		gesture = { kind: "wire", start, from, to: from, axis: null };
	} else {
		const pin = pinAt(g);
		const part = !pin && partAt(g);
		const wire = !pin && !part && wireAt(g);
		if (pin) gesture = { kind: "wire", start, from: pin, to: pin, axis: null, onPin: true };
		else if (part) gesture = { kind: "move", start, part, g0: g, x0: part.x, y0: part.y, before: snapshot(circuit), pulls: attached(part), ends: [] };
		else if (wire) gesture = { kind: "wire", start, from: snap(g), to: snap(g), axis: null, wire };
		else gesture = { kind: "pan", start, ox: view.ox, oy: view.oy };
	}
	if (gesture.kind === "move") gesture.ends = gesture.pulls.map(({ w }) => [w.x1, w.y1, w.x2, w.y2]);
	gesture.moved = false;
	dirty = true;
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function restoreMove(g) {
	g.part.x = g.x0;
	g.part.y = g.y0;
	g.pulls.forEach(({ w }, k) => ([w.x1, w.y1, w.x2, w.y2] = g.ends[k]));
	meet = meetings(circuit);
}

function onMove(e) {
	if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
	if (gesture && gesture.kind === "pinch") {
		if (touches.size < 2) return;
		const [a, b] = [...touches.values()];
		const r = board.getBoundingClientRect();
		const v0 = gesture.view0;
		const s = clampZoom((v0.s * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.d0);
		const m = mid(a, b);
		view.s = s;
		view.ox = m.x - r.left - ((gesture.m0.x - r.left - v0.ox) * s) / v0.s;
		view.oy = m.y - r.top - ((gesture.m0.y - r.top - v0.oy) * s) / v0.s;
		dirty = true;
		save();
		return;
	}
	const g = gridAt(e);
	pointer = g;
	client = { x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse" };
	if (!gesture) {
		updateHover(g);
		return;
	}
	if (!gesture.moved && Math.hypot(e.clientX - gesture.start.x, e.clientY - gesture.start.y) > 4) gesture.moved = true;
	if (!gesture.moved) return;
	dirty = true;
	switch (gesture.kind) {
		case "pan":
			view.ox = gesture.ox + e.clientX - gesture.start.x;
			view.oy = gesture.oy + e.clientY - gesture.start.y;
			save();
			break;
		case "move": {
			const dx = Math.round(g.x - gesture.g0.x);
			const dy = Math.round(g.y - gesture.g0.y);
			const { part } = gesture;
			if (part.x === gesture.x0 + dx && part.y === gesture.y0 + dy) break;
			part.x = gesture.x0 + dx;
			part.y = gesture.y0 + dy;
			const ends = pins(part);
			for (const { w, end, pin } of gesture.pulls) {
				if (end === 1) [w.x1, w.y1] = ends[pin];
				else [w.x2, w.y2] = ends[pin];
			}
			meet = meetings(circuit);
			break;
		}
		case "wire": {
			const to = pinAt(g) || snap(g);
			gesture.to = to;
			const dx = to[0] - gesture.from[0];
			const dy = to[1] - gesture.from[1];
			if (!dx && !dy) gesture.axis = null;
			else if (!gesture.axis) gesture.axis = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
			break;
		}
	}
	updateCursor();
}

function onUp(e) {
	touches.delete(e.pointerId);
	const g = gesture;
	if (!g) return;
	if (g.kind === "pinch") {
		if (touches.size === 0) gesture = null;
		return;
	}
	gesture = null;
	switch (g.kind) {
		case "place":
			if (pointer) place(tool, pointer);
			if (!e.shiftKey) arm(null);
			break;
		case "wire":
			if (g.to[0] !== g.from[0] || g.to[1] !== g.from[1]) {
				edit(() => {
					for (const seg of draftOf(g)) newWire(circuit, ...seg);
				});
				if (!tool) select(null);
			} else if (g.wire) {
				select({ kind: "wire", id: g.wire.id });
			} else if (g.onPin) {
				// A click on a part's end, rather than a drag from it, selects the part.
				const part = partAt(pointer) || circuit.parts.find((p) => pins(p).some(([x, y]) => x === g.from[0] && y === g.from[1]));
				select(part ? { kind: "part", id: part.id } : null);
			}
			break;
		case "move":
			if (g.moved && (g.part.x !== g.x0 || g.part.y !== g.y0)) {
				undos.push(g.before);
				redos = [];
				splice(normalize(circuit), g.part);
				changed();
				select({ kind: "part", id: g.part.id });
			} else {
				if (g.moved) restoreMove(g);
				select({ kind: "part", id: g.part.id });
				// A switch is worked by clicking it, as it would be on the bench.
				if (!g.moved && g.part.type === "switch") edit(() => (g.part.props.closed = !g.part.props.closed));
			}
			break;
		case "pan":
			if (!g.moved) select(null);
			break;
	}
	if (pointer) updateHover(pointer);
	dirty = true;
}

const clampZoom = (s) => Math.max(6, Math.min(90, s));

function zoomAt(clientX, clientY, factor) {
	const r = board.getBoundingClientRect();
	const s = clampZoom(view.s * factor);
	const px = clientX - r.left;
	const py = clientY - r.top;
	view.ox = px - ((px - view.ox) * s) / view.s;
	view.oy = py - ((py - view.oy) * s) / view.s;
	view.s = s;
	dirty = true;
	save();
}

function onWheel(e) {
	e.preventDefault();
	// A pinch on a trackpad arrives as a wheel with Ctrl held; a mouse wheel moves in whole
	// notches. Both zoom. Two fingers sliding on a trackpad pan.
	const notch = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
	if (e.ctrlKey || e.metaKey || notch) {
		const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
		zoomAt(e.clientX, e.clientY, Math.exp(-dy * (notch ? 0.002 : 0.01)));
	} else {
		view.ox -= e.deltaX;
		view.oy -= e.deltaY;
		dirty = true;
		save();
	}
}

// Fits the circuit into the part of the window that nothing floats over.
function fit() {
	const b = bounds(circuit);
	const r = board.getBoundingClientRect();
	const phone = r.width <= 640;
	const navbar = $("app").querySelector(".navbar").getBoundingClientRect().bottom;
	let [x0, y0, x1, y1] = [16, navbar + 16, r.width - 16, r.height - 84];
	const panel = $("panel").getBoundingClientRect();
	if (phone) {
		y0 = navbar + 72;
		y1 = prefs.panel ? panel.top - 12 : r.height - 24;
	} else if (prefs.panel) {
		x0 = panel.right + 16;
	}
	if (!b) {
		view.s = 24;
		view.ox = Math.round((x0 + x1) / 2);
		view.oy = Math.round((y0 + y1) / 2);
	} else {
		const w = b.x1 - b.x0 + 2;
		const h = b.y1 - b.y0 + 2;
		view.s = Math.max(8, Math.min(36, (x1 - x0) / w, (y1 - y0) / h));
		view.ox = (x0 + x1) / 2 - ((b.x0 + b.x1) / 2) * view.s;
		view.oy = (y0 + y1) / 2 - ((b.y0 + b.y1) / 2) * view.s;
	}
	dirty = true;
	save();
}

// The palette

function buildPalette() {
	const palette = $("palette");
	for (const [group, types] of PALETTE) {
		palette.append(Object.assign(document.createElement("h3"), { textContent: group }));
		for (const type of types) {
			const name = type === "wire" ? "Wire" : PARTS[type].name;
			const button = document.createElement("button");
			button.type = "button";
			button.className = "tool";
			button.dataset.type = type;
			button.title = type === "wire" ? "Wire (W)" : name;
			button.setAttribute("aria-pressed", "false");
			button.innerHTML = iconSVG(type);
			button.append(Object.assign(document.createElement("span"), { textContent: (type !== "wire" && PARTS[type].short) || name }));
			button.addEventListener("pointerdown", (e) => dragFromPalette(e, type));
			button.addEventListener("click", (e) => {
				// Pointer clicks are handled in dragFromPalette; this is for the keyboard.
				if (e.detail === 0) arm(type);
			});
			palette.append(button);
		}
	}
}

// A part can be dragged straight from the palette onto the page, or clicked to be put down
// with the next click on the page.
function dragFromPalette(e, type) {
	if (e.button !== 0) return;
	const start = { x: e.clientX, y: e.clientY };
	let moved = false;
	const over = (ev) => document.elementFromPoint(ev.clientX, ev.clientY) === board;
	const move = (ev) => {
		if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) {
			moved = true;
			if (type !== "wire") {
				tool = type;
				toolRot = 0;
			}
		}
		if (moved && type !== "wire") {
			pointer = over(ev) ? gridAt(ev) : null;
			dirty = true;
		}
	};
	const up = (ev) => {
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		window.removeEventListener("pointercancel", up);
		if (!moved) {
			arm(type);
		} else if (type !== "wire") {
			if (ev.type === "pointerup" && over(ev)) place(type, gridAt(ev));
			tool = null;
			arm(null);
		}
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
	window.addEventListener("pointercancel", up);
}

// The hover card: the readings for whatever the pointer is over, beside the pointer.

let tipKey = "";
let tipRows = [];

function updateTip() {
	const tip = $("tip");
	const item = !gesture && !tool && client && client.mouse && hover && (hover.kind === "part" || hover.kind === "wire") ? find(hover) : null;
	if (!item) {
		if (!tip.hidden) tip.hidden = true;
		tipKey = "";
		return;
	}
	// Rebuilt when the pointer moves to something else, or an AC supply comes or goes (which
	// changes the labels).
	const k = hover.kind + item.id + sim.ac + (item.name || "");
	if (k !== tipKey) {
		tipKey = k;
		$("tip-title").textContent = hover.kind === "wire" ? "Wire" : [PARTS[item.type].name, item.name].filter(Boolean).join(" ");
		const dl = $("tip-rows");
		dl.textContent = "";
		tipRows = readingsOf(item, hover.kind).map(([label, value]) => {
			const dd = document.createElement("dd");
			dl.append(Object.assign(document.createElement("dt"), { textContent: label }), dd);
			return { dd, value };
		});
		tip.hidden = false;
	}
	for (const r of tipRows) {
		const text = r.value();
		if (r.dd.textContent !== text) r.dd.textContent = text;
	}
	// Below and to the right of the pointer, unless that would run off the window.
	const w = tip.offsetWidth;
	const h = tip.offsetHeight;
	let x = client.x + 16;
	let y = client.y + 18;
	if (x + w > innerWidth - 8) x = client.x - 16 - w;
	if (y + h > innerHeight - 8) y = client.y - 12 - h;
	tip.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(Math.max(8, y))}px)`;
}

// The inspector

let readouts = [];
let fieldSyncs = [];
let graph = null;

function inspect() {
	const panel = $("inspector");
	const item = find(selection);
	readouts = [];
	fieldSyncs = [];
	graph = null;
	if (!item) {
		present(panel, false);
		return;
	}
	const body = $("inspect-body");
	body.textContent = "";
	const dl = document.createElement("dl");
	dl.className = "readouts";
	body.append(dl);
	const row = ([label, value, big]) => {
		const dt = Object.assign(document.createElement("dt"), { textContent: label });
		const dd = document.createElement("dd");
		if (big) dd.className = "big";
		dl.append(dt, dd);
		readouts.push({ dd, value });
	};
	// The settings are edited below, so only what the circuit is doing is listed here.
	for (const r of readingsOf(item, selection.kind)) if (!r.setting) row(r);

	if (selection.kind === "wire") {
		$("inspect-title").textContent = "Wire";
		actions(body, item);
		present(panel, true);
		return;
	}

	const part = item;
	const def = PARTS[part.type];
	$("inspect-title").textContent = part.name ? `${def.name} ${part.name}` : def.name;
	body.append(nameField(part));
	for (const field of def.fields) body.append(fieldFor(part, field));
	if (part.type !== "transformer") body.append(graphFor(part));
	actions(body, part);
	present(panel, true);
	refreshReadouts(true);
}

// Everything worth knowing about a part as it stands: [label, value, big], where value is a
// function so it can be read again each frame. Rows marked setting are the part's own values
// (its resistance, capacitance, rating), which the inspector edits rather than lists.
function readingsOf(item, kind) {
	const rows = [];
	const add = (label, value, big) => rows.push([label, value, big]);
	const set = (label, value) => rows.push(Object.assign([label, value], { setting: true }));
	const rms = () => (sim.ac ? " (rms)" : "");
	const show = (x, unit) => (Number.isNaN(x) ? "–" : reading(x, unit));
	if (kind === "wire") {
		add("Current", () => reading(Math.abs(wireFlows.get(item.id) || 0), "A"));
		return rows;
	}
	const part = item;
	const p = part.props;
	const m = () => measure(sim, part) || { v: 0, i: 0, v2: 0, i2: 0 };
	const s = () => sim.states.get(part.id) || {};
	// Labels that change with an AC supply are worked out when the rows are made.
	const ac = rms();
	switch (part.type) {
		case "ammeter":
			add("Current" + ac, () => show(m().i, "A"), true);
			break;
		case "voltmeter":
			add("Voltage" + ac, () => show(m().v, "V"), true);
			break;
		case "transformer":
			set("Turns", () => `${Number(p.np.toPrecision(3))} : ${Number(p.ns.toPrecision(3))}`);
			add("Primary voltage" + ac, () => show(m().v, "V"));
			add("Primary current" + ac, () => show(m().i, "A"));
			add("Secondary voltage" + ac, () => show(m().v2, "V"));
			add("Secondary current" + ac, () => show(m().i2, "A"));
			break;
		default:
			add("Voltage" + ac, () => show(m().v, "V"));
			add("Current" + ac, () => show(m().i, "A"));
	}
	if (RESISTIVE.has(part.type)) {
		const r = ["Resistance", () => quantity(resistanceOf(part), "Ω")];
		// A resistor's resistance is its setting; the others' follow a slider or are worked out.
		if (part.type === "resistor" || part.type === "lamp") set(...r);
		else add(...r);
		add("Power" + ac, () => show(m().v * m().i, "W"));
	}
	switch (part.type) {
		case "cell":
		case "battery":
			set("EMF", () => quantity(p.emf, "V"));
			set("Internal resistance", () => quantity(p.r, "Ω"));
			add("Power delivered", () => show(m().v * m().i, "W"));
			break;
		case "ac":
			set("Supply", () => `${quantity(p.vrms, "V")} rms, ${quantity(p.f, "Hz")}`);
			set("Internal resistance", () => quantity(p.r, "Ω"));
			add("Power delivered", () => show(m().v * m().i, "W"));
			break;
		case "lamp":
			set("Rated power", () => quantity(p.P, "W"));
			add("Brightness", () => `${Math.round(Math.min(1, (m().v * m().i) / p.P) * 100) || 0}%`);
			add("State", () => (p.broken || s().blown ? "Blown" : "Working"));
			break;
		case "ldr":
			set("Light", () => `${p.light}%`);
			break;
		case "thermistor":
			set("Temperature", () => `${p.temp} °C`);
			break;
		case "capacitor":
			set("Capacitance", () => quantity(p.C, "F"));
			add("Charge", () => reading(p.C * Math.abs(s().v || 0), "C"));
			add("Energy stored", () => reading(0.5 * p.C * (s().v || 0) ** 2, "J"));
			if (sim.ac) add("Reactance", () => quantity(1 / (2 * Math.PI * acFrequency() * p.C), "Ω"));
			break;
		case "inductor":
			set("Inductance", () => quantity(p.L, "H"));
			set("Coil resistance", () => quantity(p.r, "Ω"));
			add("Energy stored", () => reading(0.5 * p.L * (s().i || 0) ** 2, "J"));
			if (sim.ac) add("Reactance", () => quantity(2 * Math.PI * acFrequency() * p.L, "Ω"));
			break;
		case "fuse":
			set("Rating", () => quantity(p.rating, "A"));
			add("State", () => (s().blown ? "Blown" : "Intact"));
			break;
		case "switch":
			add("State", () => (p.closed ? "Closed" : "Open"));
			break;
		case "diode":
		case "led":
			add("Power", () => show(Math.abs((s().v || 0) * (s().i || 0)), "W"));
			add("State", () => ((s().i || 0) > 1e-4 ? "Conducting" : "Off"));
			break;
	}
	return rows;
}

// The frequency reactances are worked out at: the (first) AC supply's.
function acFrequency() {
	const supply = circuit.parts.find((p) => p.type === "ac");
	return supply ? supply.props.f : 0;
}

function fieldFor(part, field) {
	const p = part.props;
	if (field.kind === "switch") {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "switch-row";
		button.setAttribute("role", "switch");
		button.append(field.label + " ", Object.assign(document.createElement("span"), { className: "switch" }));
		// A lamp counts as blown whether it was set so or burnt out; switching it off mends both.
		const burnt = () => field.key === "broken" && !!sim.states.get(part.id)?.blown;
		const sync = () => button.setAttribute("aria-checked", String(!!p[field.key] || burnt()));
		button.addEventListener("click", () => {
			const on = !!p[field.key] || burnt();
			if (burnt()) sim.states.get(part.id).blown = false;
			edit(() => (p[field.key] = !on));
		});
		fieldSyncs.push(sync);
		sync();
		return button;
	}
	if (field.kind === "range") {
		const wrap = Object.assign(document.createElement("label"), { className: "prop prop-range" });
		const out = document.createElement("output");
		const input = Object.assign(document.createElement("input"), { type: "range", min: field.min, max: field.max, step: field.step });
		wrap.append(Object.assign(document.createElement("span"), { textContent: field.label }), out, input);
		const sync = () => {
			input.value = p[field.key];
			out.textContent = field.show(p);
		};
		input.addEventListener("input", () => {
			editLive(() => (p[field.key] = Number(input.value)));
			out.textContent = field.show(p);
		});
		input.addEventListener("change", endLive);
		fieldSyncs.push(sync);
		sync();
		return wrap;
	}
	if (field.kind === "select") {
		const wrap = Object.assign(document.createElement("label"), { className: "prop" });
		const select = document.createElement("select");
		for (const [value, text] of field.options) select.append(new Option(text, value));
		wrap.append(Object.assign(document.createElement("span"), { textContent: field.label }), select);
		const sync = () => (select.value = p[field.key]);
		select.addEventListener("change", () => edit(() => (p[field.key] = select.value)));
		fieldSyncs.push(sync);
		sync();
		return wrap;
	}
	// A number, typed with an SI prefix if wanted: 4.7k, 100µ, 2.2M.
	const wrap = Object.assign(document.createElement("label"), { className: "prop" });
	const box = Object.assign(document.createElement("div"), { className: "field" });
	const input = Object.assign(document.createElement("input"), { type: "text", inputMode: "decimal", spellcheck: false, autocomplete: "off" });
	input.setAttribute("autocapitalize", "off");
	box.append(input);
	wrap.append(Object.assign(document.createElement("span"), { textContent: field.label }), box);
	const shown = () => quantity(p[field.key], field.unit).trim();
	const sync = () => {
		if (document.activeElement !== input) input.value = shown();
	};
	const commit = () => {
		const value = parseValue(input.value);
		if (!Number.isFinite(value) || value < field.min) {
			if (input.value.trim() !== shown()) notice(field.min > 0 ? `${field.label} has to be more than zero` : "Type a number, like 4.7k or 100µ");
			input.value = shown();
			return;
		}
		if (value !== p[field.key]) edit(() => (p[field.key] = value));
		input.value = shown();
	};
	input.addEventListener("change", commit);
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") input.blur();
		if (e.key === "Escape") {
			input.value = shown();
			input.blur();
		}
	});
	fieldSyncs.push(sync);
	sync();
	return wrap;
}

// A label for the part, like "A" or "Bulb 2", written beside it on the page.
function nameField(part) {
	const wrap = Object.assign(document.createElement("label"), { className: "prop" });
	const box = Object.assign(document.createElement("div"), { className: "field" });
	const input = Object.assign(document.createElement("input"), { type: "text", placeholder: "None", spellcheck: false, autocomplete: "off", maxLength: 24 });
	box.append(input);
	wrap.append(Object.assign(document.createElement("span"), { textContent: "Name" }), box);
	const sync = () => {
		if (document.activeElement !== input) input.value = part.name || "";
	};
	input.addEventListener("change", () => {
		const name = input.value.trim();
		if (name === (part.name || "")) return;
		edit(() => {
			if (name) part.name = name;
			else delete part.name;
		});
	});
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") input.blur();
	});
	fieldSyncs.push(sync);
	sync();
	return wrap;
}

function graphFor(part) {
	const wrap = Object.assign(document.createElement("div"), { className: "graph" });
	const legend = Object.assign(document.createElement("div"), { className: "legend" });
	const lv = Object.assign(document.createElement("span"), { className: "legend-v" });
	const li = Object.assign(document.createElement("span"), { className: "legend-i" });
	const lt = Object.assign(document.createElement("span"), { className: "legend-t" });
	legend.append(lv, li, lt);
	const canvas = document.createElement("canvas");
	canvas.setAttribute("aria-label", "Graph of voltage and current against time");
	wrap.append(legend, canvas);
	graph = { part, canvas, lv, li, lt };
	return wrap;
}

function actions(body, item) {
	const bar = Object.assign(document.createElement("div"), { className: "actions" });
	const button = (label, icon, run, danger) => {
		const b = Object.assign(document.createElement("button"), { type: "button", className: "action" + (danger ? " action-danger" : "") });
		if (icon) b.innerHTML = `<svg class="icon"><use href="#i-${icon}" /></svg>`;
		b.append(label);
		b.addEventListener("click", run);
		bar.append(b);
	};
	if (selection.kind === "part") {
		if (item.type === "fuse")
			button("Replace", null, () => {
				const s = sim.states.get(item.id);
				if (s) s.blown = false;
				if (!prefs.playing) sim.settle();
				dirty = true;
			});
		button("Turn", "rotate", rotate);
	}
	button("Delete", "trash", remove, true);
	body.append(bar);
}

function refreshReadouts(force) {
	for (const r of readouts) {
		const text = r.value();
		if (force || r.dd.textContent !== text) r.dd.textContent = text;
	}
	for (const sync of fieldSyncs) sync();
}

// Voltage and current against time, each scaled to fill the height, so their shapes and the
// phase between them can be compared.
function drawGraph() {
	if (!graph) return;
	const { canvas, part } = graph;
	const dpr = devicePixelRatio || 1;
	const w = canvas.clientWidth;
	const h = canvas.clientHeight;
	if (!w || !h) return;
	if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
	}
	const g = canvas.getContext("2d");
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	g.clearRect(0, 0, w, h);
	g.strokeStyle = colours.hairline;
	g.lineWidth = 1;
	g.beginPath();
	g.moveTo(0, Math.round(h / 2) + 0.5);
	g.lineTo(w, Math.round(h / 2) + 0.5);
	g.stroke();
	const tr = traces.get(part.id);
	if (!tr || tr.n < 2) {
		graph.lv.textContent = "Voltage";
		graph.li.textContent = "Current";
		graph.lt.textContent = "";
		g.fillStyle = colours.tertiary;
		g.font = `13px ${colours.font}`;
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.fillText(prefs.playing ? "" : "Press play to draw the graph", w / 2, h / 2 - 14);
		return;
	}
	const N = tr.t.length;
	const at = (k) => (tr.head - tr.n + k + N) % N;
	const sign = SOURCES.has(part.type) ? -1 : 1;
	let vmax = 0;
	let imax = 0;
	for (let k = 0; k < tr.n; k++) {
		vmax = Math.max(vmax, Math.abs(tr.v[at(k)]));
		imax = Math.max(imax, Math.abs(tr.i[at(k)]));
	}
	const t0 = tr.t[at(0)];
	const span = tr.t[at(tr.n - 1)] - t0 || 1;
	const trace = (data, max, colour, flip) => {
		if (max < 1e-12) return;
		g.strokeStyle = colour;
		g.lineWidth = 1.75;
		g.lineJoin = "round";
		g.beginPath();
		for (let k = 0; k < tr.n; k++) {
			const j = at(k);
			const x = ((tr.t[j] - t0) / span) * w;
			const y = h / 2 - ((flip * data[j]) / max) * (h / 2 - 4);
			if (k) g.lineTo(x, y);
			else g.moveTo(x, y);
		}
		g.stroke();
	};
	trace(tr.i, imax, colours.traceI, 1);
	trace(tr.v, vmax, colours.traceV, sign);
	graph.lv.textContent = "± " + reading(vmax, "V");
	graph.li.textContent = "± " + reading(imax, "A");
	graph.lt.textContent = reading(span, "s");
}

function record() {
	const N = 480;
	for (const part of circuit.parts) {
		const s = sim.states.get(part.id);
		if (!s) continue;
		let tr = traces.get(part.id);
		if (!tr) traces.set(part.id, (tr = { t: new Float64Array(N), v: new Float32Array(N), i: new Float32Array(N), n: 0, head: 0 }));
		tr.t[tr.head] = sim.t;
		tr.v[tr.head] = s.v;
		tr.i[tr.head] = s.i;
		tr.head = (tr.head + 1) % N;
		tr.n = Math.min(tr.n + 1, N);
	}
	for (const id of traces.keys()) if (!sim.states.has(id)) traces.delete(id);
}

// Shared pieces, as in WMB

// Shows an element, or plays its leaving animation and then hides it. Showing it again while
// it's on its way out simply brings it back.
function present(el, shown) {
	if (shown) {
		delete el.dataset.leaving;
		el.hidden = false;
	} else if (!el.hidden && !("leaving" in el.dataset)) {
		el.dataset.leaving = "";
		const gone = () => {
			if (!("leaving" in el.dataset)) return;
			el.hidden = true;
			delete el.dataset.leaving;
		};
		el.addEventListener("animationend", gone, { once: true });
		// In case the animation never runs (a background tab, say).
		setTimeout(gone, 400);
	}
}

let noticeTimer = 0;
function notice(text) {
	const el = $("notice");
	el.textContent = text;
	// Hidden and shown again so that the entrance plays each time.
	el.hidden = true;
	void el.offsetWidth;
	present(el, true);
	clearTimeout(noticeTimer);
	noticeTimer = setTimeout(() => present(el, false), 2600);
}

function help(open) {
	const sheet = $("help").firstElementChild;
	if (open) {
		present($("help"), true);
		// The sheet grows out of the Help button, so it's clear where it came from.
		const from = $("help-open").getBoundingClientRect();
		const x = from.x + from.width / 2 - sheet.offsetLeft;
		const y = from.y + from.height / 2 - sheet.offsetTop;
		sheet.style.setProperty("--origin", `${x}px ${y}px`);
	} else {
		present($("help"), false);
	}
	// While the sheet is up, nothing behind it can be reached.
	for (const el of app.children) if (el !== $("help") && el !== $("notice")) el.inert = open;
	if (!open) {
		$("panel").inert = !prefs.panel;
		$("panel-show").inert = prefs.panel;
	}
	$("help-open").setAttribute("aria-expanded", String(open));
	(open ? $("help-close") : $("help-open")).focus();
}

// Links: the circuit, compressed, after #c= in the address.

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64 = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function linkFor(c) {
	const json = JSON.stringify(pack(c));
	try {
		const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
		return "z" + toBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
	} catch {
		return "j" + toBase64(new TextEncoder().encode(json));
	}
}

async function readLink(code) {
	const bytes = fromBase64(code.slice(1));
	if (code[0] === "z") {
		const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
		return unpack(JSON.parse(await new Response(stream).text()));
	}
	return unpack(JSON.parse(new TextDecoder().decode(bytes)));
}

async function share() {
	const url = linkFor(circuit).then((code) => `${location.origin}${location.pathname}#c=${code}`);
	try {
		// Handed over as a promise so that Safari still counts this as the click.
		await navigator.clipboard.write([new ClipboardItem({ "text/plain": url.then((u) => new Blob([u], { type: "text/plain" })) })]);
		notice("Link copied");
	} catch {
		try {
			await navigator.clipboard.writeText(await url);
			notice("Link copied");
		} catch {
			history.replaceState(null, "", await url);
			notice("Couldn't copy — the link is in the address bar");
		}
	}
}

// Drawing

function readColours() {
	const css = getComputedStyle(document.documentElement);
	const v = (name) => css.getPropertyValue(name).trim();
	colours = {
		canvas: v("--canvas"),
		ink: v("--ink"),
		grid: v("--grid"),
		accent: v("--accent-ink"),
		warning: v("--warning"),
		reading: v("--reading"),
		tag: v("--tag"),
		fill: v("--fill"),
		hairline: v("--hairline"),
		tertiary: v("--text-tertiary"),
		traceV: v("--trace-v"),
		traceI: v("--trace-i"),
		font: v("--ui-font"),
	};
	dirty = true;
}

function resize() {
	const dpr = devicePixelRatio || 1;
	const width = board.clientWidth;
	const height = board.clientHeight;
	if (width === size.width && height === size.height && dpr === size.dpr) return;
	size = { width, height, dpr };
	board.width = Math.round(width * dpr);
	board.height = Math.round(height * dpr);
	dirty = true;
}

let last = performance.now();
let shownClock = "";
let blown = new Set();

function frame(now) {
	const seconds = Math.min((now - last) / 1000, 0.1);
	last = now;
	resize();
	if (prefs.playing && circuit.parts.length) {
		const t = sim.t;
		sim.advance(seconds, prefs.speed);
		if (sim.t !== t) record();
		wireFlows = flows(circuit, sim);
		dirty = true;
	}

	// A fuse or lamp that has just blown is worth a word.
	for (const part of circuit.parts) {
		if (part.type !== "fuse" && part.type !== "lamp") continue;
		const isBlown = !!sim.states.get(part.id)?.blown;
		if (isBlown && !blown.has(part.id))
			notice(part.type === "fuse" ? "The fuse blew — Reset, or Replace it, to mend it" : "The lamp blew — too much power for its rating");
		if (isBlown) blown.add(part.id);
		else blown.delete(part.id);
	}

	if (dirty) {
		dirty = false;
		let ghost = null;
		if (tool && tool !== "wire" && pointer) {
			const [x, y] = anchorFor(tool, toolRot, pointer.x, pointer.y);
			ghost = { id: "", type: tool, x, y, rot: toolRot, props: { ...PARTS[tool].props } };
		}
		const g = gesture;
		draw(ctx, {
			...size,
			view,
			colours,
			circuit,
			sim,
			meetings: meet,
			selection,
			hover: g ? null : hover,
			ghost,
			draft: g && g.kind === "wire" && g.moved ? draftOf(g) : null,
			target: g && g.kind === "wire" ? (g.moved ? g.to : g.from) : hoverTarget,
			values: prefs.values,
			wireFlows,
		});
		refreshReadouts(false);
		drawGraph();
	}

	updateTip();
	const clock = `t = ${sim.t ? reading(sim.t, "s") : "0 s"}`;
	if (clock !== shownClock) $("clock").textContent = shownClock = clock;
	requestAnimationFrame(frame);
}

// Controls

function showPrefs() {
	document.documentElement.dataset.playing = String(prefs.playing);
	$("play-label").textContent = prefs.playing ? "Pause" : "Play";
	$("values").setAttribute("aria-checked", String(prefs.values));
	app.dataset.panel = prefs.panel ? "open" : "closed";
	$("panel").inert = !prefs.panel;
	$("panel-show").inert = prefs.panel;
	if (![...$("speed").options].some((o) => Number(o.value) === prefs.speed)) prefs.speed = 1;
	$("speed").value = String(prefs.speed);
	dirty = true;
}

function bind() {
	board.addEventListener("pointerdown", onDown);
	board.addEventListener("pointermove", onMove);
	board.addEventListener("pointerup", onUp);
	board.addEventListener("pointercancel", (e) => {
		touches.delete(e.pointerId);
		if (gesture && gesture.kind === "move") restoreMove(gesture);
		gesture = null;
		dirty = true;
	});
	board.addEventListener("pointerleave", (e) => {
		if (e.pointerType === "mouse" && !gesture) {
			pointer = null;
			hover = null;
			hoverTarget = null;
			client = null;
			dirty = true;
		}
	});
	board.addEventListener("wheel", onWheel, { passive: false });
	// Safari's own pinch gesture would zoom the whole page.
	document.addEventListener("gesturestart", (e) => e.preventDefault());

	buildPalette();
	for (const ex of EXAMPLES) {
		const chip = Object.assign(document.createElement("button"), { type: "button", textContent: ex.name });
		chip.addEventListener("click", () => loadCircuit(ex.build(), { speed: ex.speed, chosen: ex.select, note: ex.note }));
		$("examples").append(chip);
	}
	// The past papers, newest first, grouped by year.
	const years = [...new Set(PAPERS.map((p) => p.year))].sort((a, b) => b - a);
	for (const year of years) {
		const group = Object.assign(document.createElement("optgroup"), { label: String(year) });
		PAPERS.forEach((p, k) => {
			if (p.year === year) group.append(new Option(`${p.q} · ${p.name}`, String(k)));
		});
		$("papers").append(group);
	}
	$("papers").addEventListener("change", () => {
		const paper = PAPERS[Number($("papers").value)];
		$("papers").value = "";
		if (!paper) return;
		const c = paper.build();
		loadCircuit(c, { speed: 1, chosen: c.select, note: `${paper.year} ${paper.q}: ${paper.note}` });
	});

	$("undo").addEventListener("click", undo);
	$("redo").addEventListener("click", redo);
	$("fit").addEventListener("click", fit);
	$("share").addEventListener("click", share);
	$("clear").addEventListener("click", () => {
		if (!circuit.parts.length && !circuit.wires.length) return;
		loadCircuit(emptyCircuit());
		notice("Cleared — Undo brings it back");
	});
	$("inspect-close").addEventListener("click", () => select(null));

	$("play").addEventListener("click", () => {
		prefs.playing = !prefs.playing;
		if (!prefs.playing) sim.settle();
		showPrefs();
		save();
	});
	$("reset").addEventListener("click", () => {
		sim.reset(circuit);
		sim.settle();
		traces.clear();
		wireFlows = flows(circuit, sim);
		dirty = true;
		inspect();
	});
	$("speed").addEventListener("change", () => {
		prefs.speed = Number($("speed").value);
		save();
	});
	for (const k of ["values"]) {
		$(k).addEventListener("click", () => {
			prefs[k] = !prefs[k];
			showPrefs();
			save();
		});
	}
	for (const [id, open] of [
		["panel-hide", false],
		["panel-show", true],
	]) {
		$(id).addEventListener("click", () => {
			prefs.panel = open;
			showPrefs();
			save();
			(open ? $("panel-hide") : $("panel-show")).focus();
		});
	}

	$("help-open").addEventListener("click", () => help(true));
	$("help-close").addEventListener("click", () => help(false));
	$("help").addEventListener("click", (event) => {
		if (event.target === $("help")) help(false);
	});

	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !$("help").hidden && !("leaving" in $("help").dataset)) {
			help(false);
			return;
		}
		if (!$("help").hidden) return;
		if (e.target.closest && e.target.closest("input, select, textarea")) return;
		const meta = e.metaKey || e.ctrlKey;
		const k = e.key.toLowerCase();
		if (meta && k === "z") {
			e.preventDefault();
			e.shiftKey ? redo() : undo();
		} else if (meta && k === "y") {
			e.preventDefault();
			redo();
		} else if (meta || e.altKey) {
			return;
		} else if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			remove();
		} else if (k === "r") {
			rotate();
		} else if (k === "w") {
			arm("wire");
		} else if (e.key === "Escape") {
			if (tool) arm(null);
			else select(null);
		} else if (e.key === " " && !(e.target.closest && e.target.closest("button"))) {
			e.preventDefault();
			$("play").click();
		}
	});

	$("theme").addEventListener("click", () => {
		const root = document.documentElement;
		root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
		try {
			localStorage.setItem("circuits:theme", root.dataset.theme);
		} catch {
			// See restoreState().
		}
		readColours();
	});
	addEventListener("resize", () => (dirty = true));
	document.fonts.ready.then(() => (dirty = true));
}

async function start() {
	const had = restoreState();
	bind();
	readColours();
	showPrefs();
	resize();
	const code = new URLSearchParams(location.hash.slice(1)).get("c");
	if (code) {
		try {
			const c = await readLink(code);
			history.replaceState(null, "", location.pathname);
			loadCircuit(c);
			undos = [];
			changed();
			requestAnimationFrame(frame);
			return;
		} catch {
			notice("That link couldn't be read");
		}
	}
	if (had) {
		sim.reset(circuit);
		changed();
	} else {
		const ex = EXAMPLES[0];
		loadCircuit(ex.build(), { speed: ex.speed });
		undos = [];
		changed();
	}
	requestAnimationFrame(frame);
}

start();
