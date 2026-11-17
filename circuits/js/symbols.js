// The symbols, drawn as they're written on paper in NZ physics: a resistor is a box, a lamp is
// a circle with a cross, meters are circles with their letter, and so on.
//
// Each is a list of SVG path strings in grid squares, with the first end at (0, 0) and, for a
// two-ended part, the second at (4, 0). The same paths draw the page (through Path2D) and the
// palette's icons (as SVG), so the two always match.
import { LED_COLOURS } from "./parts.js";

const f = (n) => +n.toFixed(3);

const circle = (cx, cy, r) => `M${f(cx + r)} ${f(cy)}A${r} ${r} 0 1 1 ${f(cx - r)} ${f(cy)}A${r} ${r} 0 1 1 ${f(cx + r)} ${f(cy)}Z`;

const box = (x0, x1, h) => `M${x0} ${-h}H${x1}V${h}H${x0}Z`;

const leads = (from, to) => `M0 0H${from}M${to} 0H4`;

// A line with an arrowhead at its second end.
function arrow(x1, y1, x2, y2, head = 0.3) {
	const a = Math.atan2(y2 - y1, x2 - x1);
	const l = [x2 - head * Math.cos(a - 0.5), y2 - head * Math.sin(a - 0.5)];
	const r = [x2 - head * Math.cos(a + 0.5), y2 - head * Math.sin(a + 0.5)];
	return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}M${f(l[0])} ${f(l[1])}L${f(x2)} ${f(y2)}L${f(r[0])} ${f(r[1])}`;
}

// The plates of a cell: the long thin one is positive, the short thick one negative.
const plate = (x, long) => ({ d: long ? `M${x} -0.9V0.9` : `M${x} -0.42V0.42`, w: long ? 1 : 2.4 });
const plus = (x) => ({ d: `M${x} -1.08H${f(x + 0.36)}M${f(x + 0.18)} -1.26V-0.9`, w: 0.7 });

const RESISTOR = [leads(1.1, 2.9), box(1.1, 2.9, 0.42)];
const ROUND = (inner) => [leads(1.2, 2.8), circle(2, 0, 0.8), ...inner];
const DIODE = ["M0 0H4", "M1.5 -0.62V0.62L2.5 0Z", "M2.5 -0.62V0.62"];
const HUMPS = (dir, sweep) => Array(4).fill(`a0.3 0.3 0 0 ${sweep} ${dir}`).join("");

// The symbol for a part as it stands. live, when given, is the part's state in the
// simulation: whether a fuse has blown, how bright a lamp or LED is.
//
// Gives { paths: [{ d, w, fill }], texts: [{ t, x, y }], glow }. w scales the line width;
// fill paths are filled with the ink rather than stroked.
export function symbol(type, props = {}, live = null) {
	const paths = [];
	const texts = [];
	let glow = null;
	const add = (...ds) => ds.forEach((d) => paths.push(typeof d === "string" ? { d } : d));
	switch (type) {
		case "wire":
			add("M0.4 0H3.6", { d: circle(0.4, 0, 0.14), fill: true }, { d: circle(3.6, 0, 0.14), fill: true });
			break;
		case "cell":
			add("M0 0H1.8M2.2 0H4", plate(1.8, false), plate(2.2, true), plus(2.45));
			break;
		case "battery":
			add("M0 0H1.2M2.8 0H4", plate(1.2, false), plate(1.6, true), plate(2.4, false), plate(2.8, true));
			add({ d: "M1.72 0H1.88M1.96 0H2.04M2.12 0H2.28", w: 0.8 }, plus(3.05));
			break;
		case "ac":
			add(...ROUND(["M1.42 0C1.6 -0.62 1.84 -0.62 2 0S2.4 0.62 2.58 0"]));
			break;
		case "switch":
			add("M0 0H1.17M2.83 0H4", circle(1.3, 0, 0.13), circle(2.7, 0, 0.13));
			add(props.closed ? "M1.4 -0.09L2.72 -0.16" : "M1.4 -0.09L2.5 -0.95");
			break;
		case "fuse":
			add(box(1.1, 2.9, 0.32));
			add(live && live.blown ? "M0 0H1.75L1.85 -0.14M2.15 0.14L2.25 0H4" : "M0 0H4");
			break;
		case "resistor":
			add(...RESISTOR);
			break;
		case "varres":
			add(...RESISTOR, arrow(1.2, 0.85, 2.85, -0.9));
			break;
		case "ldr":
			add(leads(1.15, 2.85), circle(2, 0, 0.85), box(1.42, 2.58, 0.28));
			add(arrow(0.45, -1.85, 1.15, -1.05, 0.24), arrow(1.05, -2.15, 1.75, -1.35, 0.24));
			break;
		case "thermistor":
			add(...RESISTOR, "M0.6 0.82H1.02L2.98 -0.82");
			break;
		case "lamp": {
			const k = 0.8 * Math.SQRT1_2;
			if (props.broken || (live && live.blown)) {
				// A blown lamp: the filament snapped, so the cross is broken in the middle.
				const g = 0.2;
				add(...ROUND([`M${f(2 - k)} ${f(-k)}L${f(2 - g)} ${f(-g)}M${f(2 + g)} ${f(g)}L${f(2 + k)} ${f(k)}M${f(2 - k)} ${f(k)}L${f(2 - g)} ${f(g + 0.08)}M${f(2 + g)} ${f(-g - 0.08)}L${f(2 + k)} ${f(-k)}`]));
				break;
			}
			add(...ROUND([`M${f(2 - k)} ${f(-k)}L${f(2 + k)} ${f(k)}M${f(2 - k)} ${f(k)}L${f(2 + k)} ${f(-k)}`]));
			if (live) glow = { x: 2, y: 0, r: 0.8, colour: "#ffc21a", amount: live.glow || 0 };
			break;
		}
		case "ammeter":
		case "voltmeter":
			add(...ROUND([]));
			texts.push({ t: type === "ammeter" ? "A" : "V", x: 2, y: 0 });
			break;
		case "diode":
			add(...DIODE);
			break;
		case "led":
			add(...DIODE, arrow(1.9, -0.8, 2.4, -1.45, 0.24), arrow(2.4, -0.7, 2.9, -1.35, 0.24));
			if (live) glow = { x: 2, y: 0, r: 0.6, colour: (LED_COLOURS[props.colour] || LED_COLOURS.red).glow, amount: live.glow || 0, fill: "M1.5 -0.62V0.62L2.5 0Z" };
			break;
		case "capacitor":
			add("M0 0H1.8M2.2 0H4M1.8 -0.85V0.85M2.2 -0.85V0.85");
			break;
		case "inductor":
			add(`M0 0H0.8${HUMPS("0.6 0", 1)}H4`);
			break;
		case "transformer":
			add(`M0 0H1.2V0.8${HUMPS("0 0.6", 1)}V4H0`, `M4 0H2.8V0.8${HUMPS("0 0.6", 0)}V4H4`);
			add("M1.85 0.55V3.45M2.15 0.55V3.45");
			break;
	}
	return { paths, texts, glow };
}

// The part's outline, before it's turned: what a click lands on, and what's lit when hovered.
export function bodyOf(type) {
	if (type === "transformer") return { u0: 0.5, u1: 3.5, v0: 0.3, v1: 3.7 };
	return { u0: 0.6, u1: 3.4, v0: -1, v1: 1 };
}

// An icon for the palette: the symbol as an SVG, in the current colour.
export function iconSVG(type) {
	const { paths, texts } = symbol(type, type === "switch" ? { closed: false } : {});
	const view = type === "transformer" ? "-0.4 -0.4 4.8 4.8" : type === "ldr" ? "-0.2 -2.3 4.4 3.3" : "-0.2 -1.6 4.4 3.2";
	const body = paths
		.map((p) =>
			p.fill
				? `<path d="${p.d}" fill="currentColor" stroke="none"/>`
				: `<path d="${p.d}"${p.w ? ` stroke-width="${0.13 * p.w}"` : ""}/>`,
		)
		.join("");
	const words = texts
		.map((t) => `<text x="${t.x}" y="${t.y}" font-size="1" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none">${t.t}</text>`)
		.join("");
	return `<svg viewBox="${view}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="0.13" stroke-linecap="round" stroke-linejoin="round">${body}${words}</svg>`;
}
