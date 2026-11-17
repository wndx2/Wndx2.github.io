// The circuits from the NCEA Level 2 Physics electricity papers (91173), 2012 onwards, one
// for each circuit diagram, with the values the papers give. Where the paper gives a reading
// instead of a value ("the ammeter reads 6.0 A"), the reading is entered as given and the
// missing value is worked out from it, as the question intends (see solve.js). Where a paper
// leaves something out entirely (a lamp's rating, say), the note says what's used.
//
// Questions about induced voltages and charged plates have no circuit to run and aren't here.
// Electromagnetism questions that are really a supply and a resistance are, so their current
// can be seen.
//
// Most circuits are written as blocks in series and parallel (S and P below) and laid out the
// way the papers draw them: the supply along the top, the rest underneath.
import { emptyCircuit, newPart, newWire, normalize } from "./circuit.js";
import { solve } from "./solve.js";

// A part, with its settings and the name the paper gives it. sel marks the part to select
// when the circuit is opened.
const part = (t, p = {}, name, sel) => ({ t, p: name ? { ...p, name } : p, sel });
const battery = (emf, r = 0) => part("battery", { emf, r });
const R = (ohms, name, sel) => part("resistor", { R: ohms }, name, sel);
const lamp = (ohms, watts, name, sel) => part("lamp", { R: ohms, P: watts }, name, sel);
const A = (name) => part("ammeter", {}, name);
const V = (name) => part("voltmeter", {}, name);
// A part whose value is to be worked out (its resistance, unless another key is named)...
const unknown = (node, key = "R") => ({ ...node, p: { ...node.p, unknown: key } });
// ...and a part with a current, voltage or power the question gives.
const given = (node, { I, V: volts, P: watts }) => ({
	...node,
	p: { ...node.p, ...(I !== undefined && { givenI: I }), ...(volts !== undefined && { givenV: volts }), ...(watts !== undefined && { givenP: watts }) },
});
const S = (...items) => ({ series: items });
const P = (...items) => ({ parallel: items });

// The room a block takes, in squares: a part is four long, and branches are four apart.
function size(node) {
	if (node.t) return { w: 4, h: 4 };
	if (node.series) {
		const k = node.series.map(size);
		return { w: k.reduce((sum, b) => sum + b.w, 0) + k.length - 1, h: Math.max(...k.map((b) => b.h)) };
	}
	const k = node.parallel.map(size);
	return { w: Math.max(...k.map((b) => b.w)) + 4, h: k.reduce((sum, b) => sum + b.h, 0) };
}

// Lays a block out with its ends at (x, y) and (x + width, y). Series blocks go left to right,
// a square apart; parallel branches stack downwards between two rails.
function place(c, node, x, y, chosen) {
	if (node.t) {
		newPart(c, node.t, x, y, 0, node.p);
		if (node.sel) chosen.push(c.parts.length - 1);
		return;
	}
	if (node.series) {
		let at = x;
		node.series.forEach((item, i) => {
			if (i) newWire(c, at, y, ++at, y);
			place(c, item, at, y, chosen);
			at += size(item).w;
		});
		return;
	}
	const { w } = size(node);
	let at = y;
	let last = y;
	for (const item of node.parallel) {
		const iw = size(item).w;
		newWire(c, x, at, x + 2, at);
		place(c, item, x + 2, at, chosen);
		newWire(c, x + 2 + iw, at, x + w, at);
		last = at;
		at += size(item).h;
	}
	newWire(c, x, y, x, last);
	newWire(c, x + w, y, x + w, last);
}

// Whole circuits: each a supply along the top, joined round to the rest below it. More than
// one goes side by side.
function circuit(...loops) {
	const c = emptyCircuit();
	const chosen = [];
	let x0 = 0;
	for (const [supply, rest] of loops) {
		const { w } = size(rest);
		const W = Math.max(w, 8);
		const nx = x0 + Math.floor((W - w) / 2);
		const sx = x0 + Math.floor((W - 4) / 2);
		place(c, supply, sx, 0, chosen);
		place(c, rest, nx, 4, chosen);
		newWire(c, x0, 0, sx, 0);
		newWire(c, sx + 4, 0, x0 + W, 0);
		newWire(c, x0, 0, x0, 4);
		newWire(c, x0 + W, 0, x0 + W, 4);
		newWire(c, x0, 4, nx, 4);
		newWire(c, nx + w, 4, x0 + W, 4);
		x0 += W + 8;
	}
	normalize(c);
	solve(c);
	c.select = chosen[0];
	return c;
}

// 2025's air fryer has its switches on the right-hand rail, between the branches, so it's laid
// out by hand. The rheostat is the heating element; the two resistors are the fans. The element
// is worked out from the 1800 W it's set to make (32 Ω). The ammeter isn't in the paper: it
// reads the supply current.
function airFryer() {
	const c = emptyCircuit();
	const path = (...pts) => pts.slice(1).forEach((p, k) => newWire(c, ...pts[k], ...p));
	newPart(c, "battery", 6, 0, 0, { emf: 240 });
	newPart(c, "switch", 16, 0, 1, { closed: true, name: "A" });
	newPart(c, "switch", 16, 10, 1, { name: "B" });
	newPart(c, "lamp", 6, 6, 0, { R: 1000, P: 57.6 });
	newPart(c, "varres", 6, 10, 0, { max: 64, setting: 25, name: "Element", unknown: "R", givenP: 1800 });
	newPart(c, "resistor", 2, 16, 0, { R: 480, name: "Fan" });
	newPart(c, "resistor", 8, 16, 0, { R: 480, name: "Fan" });
	newPart(c, "ammeter", 10, 0, 0);
	path([6, 0], [0, 0], [0, 6], [0, 10], [0, 16], [2, 16]);
	path([14, 0], [16, 0]);
	path([16, 4], [16, 6], [16, 10]);
	path([0, 6], [6, 6]);
	path([10, 6], [16, 6]);
	path([0, 10], [6, 10]);
	path([10, 10], [16, 10]);
	path([6, 16], [8, 16]);
	path([12, 16], [16, 16], [16, 14]);
	normalize(c);
	solve(c);
	c.select = 4;
	return c;
}

// A 12 V, 5 W lamp is 28.8 Ω; a 12 V, 18 W lamp is 8.0 Ω.
const L5 = (name, sel) => lamp(28.8, 5, name, sel);

export const PAPERS = [
	{
		year: 2012,
		q: "Q1",
		name: "12 V lamps in parallel",
		note: "The 18 W lamp is brighter: same voltage, less resistance",
		build: () => circuit([battery(12), P(lamp(28.8, 5, "12 V 5 W", true), lamp(8, 18, "12 V 18 W"))]),
	},
	{
		year: 2012,
		q: "Q2",
		name: "Three lamps in series",
		note: "Identical 12 V 5 W lamps share the 12 V equally",
		build: () => circuit([battery(12), S(L5("1", true), L5("2"), L5("3"))]),
	},
	{
		year: 2012,
		q: "Q2(b)",
		name: "Lamp A in series, B and C in parallel",
		note: "Lamp A takes all the current, so it's brighter than B and C",
		build: () => circuit([battery(12), S(L5("A", true), P(L5("B"), L5("C")))]),
	},
	{
		year: 2012,
		q: "Q4",
		name: "Rails and rod",
		note: "The wires, rails and rod are drawn as their 35.4 Ω",
		build: () => circuit([battery(12), R(35.4, "Rails and rod", true)]),
	},
	{
		year: 2013,
		q: "Q2(a)",
		name: "3 Ω and 6 Ω, with 12 Ω across both",
		note: "The supply is worked out from the voltmeter's 18.0 V",
		build: () => circuit([unknown(battery(12), "emf"), P(S(R(3), P(R(6, "", true), given(V(), { V: 18 }))), R(12))]),
	},
	{
		year: 2013,
		q: "Q2(c)",
		name: "3 Ω, then 6 Ω and 12 Ω in parallel",
		note: "The supply is worked out from the 2.0 A in the 6.0 Ω",
		build: () => circuit([unknown(battery(12), "emf"), S(R(3, "", true), P(given(R(6), { I: 2 }), R(12), V()))]),
	},
	{
		year: 2014,
		q: "Q2",
		name: "Resistors drawing 6.0 A",
		note: "The supply is worked out from the 6.0 A drawn",
		build: () => circuit([unknown(battery(12), "emf"), S(given(A(), { I: 6 }), R(3), P(S(R(4.6), R(2.2)), R(3.5, "", true)))]),
	},
	{
		year: 2014,
		q: "Q3(a)",
		name: "Lamp A, then B and C in parallel",
		note: "Lamps assumed 12 V 12 W. Blow lamp B in its panel and watch lamp A",
		build: () => circuit([battery(12), S(lamp(12, 12, "A"), P(lamp(12, 12, "B", true), lamp(12, 12, "C")))]),
	},
	{
		year: 2014,
		q: "Q3(b)",
		name: "Lamp D added in parallel",
		note: "Lamps assumed 12 V 12 W. Compare the voltages with Q3(a)",
		build: () => circuit([battery(12), S(lamp(12, 12, "A", true), P(lamp(12, 12, "B"), lamp(12, 12, "C"), lamp(12, 12, "D")))]),
	},
	{
		year: 2014,
		q: "Q3(c)",
		name: "0.5 Ω in series, R alongside 2 Ω and 4 Ω",
		note: "R is worked out from the 6.0 A",
		build: () => circuit([battery(12), S(given(A(), { I: 6 }), R(0.5), P(unknown(R(1, "R", true)), S(R(2), R(4))))]),
	},
	{
		year: 2015,
		q: "Q1",
		name: "Nichrome wire",
		note: "The wire's resistance isn't given (4 Ω here); the field is 6.0 V over 1.0 m either way",
		build: () => circuit([battery(6), P(R(4, "Nichrome 1.0 m", true), V())]),
	},
	{
		year: 2015,
		q: "Q4(a)",
		name: "Two 6 V 2 W lamps and a resistor",
		note: "The resistor is worked out so the lamps get their 6 V. Blow one lamp and watch the resistor's current",
		build: () => circuit([battery(9), S(P(given(lamp(18, 2, "6 V 2 W", true), { V: 6 }), lamp(18, 2, "6 V 2 W")), unknown(R(1)))]),
	},
	{
		year: 2015,
		q: "Q4(d)",
		name: "3 Ω and 6 Ω lamps with 4 Ω",
		note: "Lamp ratings assumed (3 W and 1.5 W)",
		build: () => circuit([battery(9), S(P(lamp(3, 3, "3 Ω"), lamp(6, 1.5, "6 Ω")), R(4, "", true))]),
	},
	{
		year: 2016,
		q: "Q1",
		name: "Car radio and speakers",
		note: "Speaker B is worked out from the 0.300 A",
		build: () => circuit([battery(12), S(given(A(), { I: 0.3 }), R(10, "Receiver"), P(R(80, "Speaker A", true), unknown(R(100, "Speaker B"))))]),
	},
	{
		year: 2016,
		q: "Q3",
		name: "Rod on rails, with a switch",
		note: "The rod is drawn as its 20 Ω. Close the switch",
		build: () => circuit([battery(12), S(part("switch", {}, "", true), R(20, "Rod AB"))]),
	},
	{
		year: 2017,
		q: "Q2(b)",
		name: "Rheostat and two 9 V 12 W bulbs",
		note: "The rheostat is worked out so each bulb gets 9.00 V (1.13 Ω)",
		build: () =>
			circuit([battery(12), S(unknown(part("varres", { max: 2.26, setting: 25 }, "Rheostat", true)), P(given(lamp(6.75, 12, "9 V 12 W"), { V: 9 }), lamp(6.75, 12, "9 V 12 W")))]),
	},
	{
		year: 2017,
		q: "Q2(d)",
		name: "Bulb 3 added",
		note: "2.13 A from the battery; Bulb 1 now gets more than 9 V",
		build: () =>
			circuit([battery(12), S(A(), part("varres", { max: 2.26, setting: 50 }, "Rheostat"), P(lamp(6.75, 12, "Bulb 1", true), S(lamp(6.75, 12, "Bulb 2"), lamp(6.75, 12, "Bulb 3"))))]),
	},
	{
		year: 2017,
		q: "Q3",
		name: "Spotlight",
		note: "The light and its wires together are 2.40 Ω (rating assumed 60 W)",
		build: () => circuit([battery(12), S(A(), lamp(2.4, 60, "Spotlight", true))]),
	},
	{
		year: 2018,
		q: "Q3",
		name: "Bulb 1, then bulbs 2 and 3 in parallel",
		note: "Bulb ratings assumed 24 W. Bulb 2 is brighter than bulb 3",
		build: () => circuit([battery(12), S(lamp(7, 24, "Bulb 1", true), P(lamp(4.8, 24, "Bulb 2"), lamp(7, 24, "Bulb 3")))]),
	},
	{
		year: 2018,
		q: "Q3(d)",
		name: "An ammeter across bulb 1",
		note: "The ideal ammeter shorts out bulb 1",
		build: () => circuit([battery(12), S(P(lamp(7, 24, "Bulb 1", true), A()), P(lamp(4.8, 24, "Bulb 2"), lamp(7, 24, "Bulb 3")))]),
	},
	{
		year: 2019,
		q: "Q1(a)",
		name: "Bicycle lamp",
		note: "R is worked out from the voltmeter's 4.0 V",
		build: () => circuit([battery(15), S(P(R(5, "", true), given(V(), { V: 4 })), unknown(R(10, "R")))]),
	},
	{
		year: 2019,
		q: "Q1(c)",
		name: "6.0 Ω and 5.6 Ω alongside 3.2 Ω",
		note: "The paper has no supply: 12 V and an ammeter are added, so R = V ÷ I = 2.51 Ω",
		build: () => circuit([battery(12), S(A(), P(S(R(6), R(5.6)), R(3.2, "", true)))]),
	},
	{
		year: 2019,
		q: "Q1(d)",
		name: "Circuit 1 and circuit 2",
		note: "Lamps assumed 12 Ω 12 W. Hover the batteries to compare the power",
		build: () =>
			circuit(
				[battery(12), S(lamp(12, 12, "1", true), P(lamp(12, 12), lamp(12, 12)))],
				[battery(12), S(lamp(12, 12, "2"), P(lamp(12, 12, "Extra"), lamp(12, 12), lamp(12, 12)))],
			),
	},
	{
		year: 2020,
		q: "Q1",
		name: "Seat heaters",
		note: "Hand units 3.0 Ω and foot units 5.0 Ω: 3.5 A",
		build: () => circuit([battery(28), S(P(R(6, "Hand", true), R(6, "Hand")), P(R(10, "Foot"), R(10, "Foot")), A())]),
	},
	{
		year: 2020,
		q: "Q3(c)",
		name: "Feeder wire",
		note: "The circuit's 5.0 Ω on the 28 V supply",
		build: () => circuit([battery(28), S(A(), R(5, "Feeder wire", true))]),
	},
	{
		year: 2021,
		q: "Q1(a)",
		name: "12.0 Ω and 6.00 Ω in series",
		note: "8.00 V across the 12.0 Ω",
		build: () => circuit([battery(12), S(R(12, "", true), R(6), A())]),
	},
	{
		year: 2021,
		q: "Q1(c)",
		name: "Lamp across the 12.0 Ω",
		note: "Lamp assumed 16 Ω, made for 8.00 V: it gets less here",
		build: () => circuit([battery(12), S(P(R(12), lamp(16, 4, "8 V", true)), R(6), A())]),
	},
	{
		year: 2021,
		q: "Q1(d)",
		name: "4.57 Ω lamp across the 6.00 Ω",
		note: "Lamp rating assumed 4 W",
		build: () => circuit([battery(12), S(R(12), P(R(6), lamp(4.57, 4, "4.57 Ω", true)), A())]),
	},
	{
		year: 2022,
		q: "Q2(b)",
		name: "Headlamps and number-plate lamp",
		note: "Headlamps 12 V 55 W (2.62 Ω); lamp C 1.22 Ω, rating assumed 30 W",
		build: () => circuit([battery(12), S(P(lamp(2.62, 55, "A", true), lamp(2.62, 55, "B")), lamp(1.22, 30, "C"))]),
	},
	{
		year: 2022,
		q: "Q2(c)",
		name: "Radio added",
		note: "The radio's resistance isn't given (6 Ω here). Compare lamp A with Q2(b)",
		build: () => circuit([battery(12), S(P(lamp(2.62, 55, "A", true), S(R(6, "Radio"), lamp(2.62, 55, "B"))), lamp(1.22, 30, "C"))]),
	},
	{
		year: 2022,
		q: "Q3(c)",
		name: "Wire in a field, with 3.40 Ω",
		note: "3.53 A through the wire",
		build: () => circuit([battery(12), S(A(), R(3.4, "", true))]),
	},
	{
		year: 2023,
		q: "Q2",
		name: "Camping oven",
		note: "Lamp ratings assumed 20 W. Blow the bottom lamp for part (d)",
		build: () =>
			circuit([battery(12), S(P(R(6.2, "Top"), lamp(4.2, 20, "Top")), P(R(8.2, "Bottom", true), lamp(4.2, 20, "Bottom")), A())]),
	},
	{
		year: 2023,
		q: "Q3",
		name: "Axle on rails",
		note: "The axle and rails are drawn as their 42.1 Ω",
		build: () => circuit([battery(120), S(A(), R(42.1, "Axle and rails", true))]),
	},
	{
		year: 2024,
		q: "Q2",
		name: "Harvester warning lamps",
		note: "The identical lamps' resistance is worked out from lamp D's 1.4 A. Ratings assumed 12 W",
		build: () =>
			circuit([
				battery(12),
				S(
					part("varres", { max: 7, setting: 50 }, "Dimmer", true),
					P(S(unknown(lamp(3, 12, "B"), "Rsame"), unknown(lamp(3, 12, "C"), "Rsame")), given(unknown(lamp(3, 12, "D"), "Rsame"), { I: 1.4 })),
				),
			]),
	},
	{
		year: 2024,
		q: "Q2(d)",
		name: "Dimmer set for lamp D's 530 J a minute",
		note: "The dimmer is worked out from lamp D's 8.83 W (530 J ÷ 60 s)",
		build: () =>
			circuit([
				battery(12),
				S(unknown(part("varres", { max: 7, setting: 50 }, "Dimmer", true)), A(), P(S(lamp(3.3, 12, "B"), lamp(3.3, 12, "C")), given(lamp(3.3, 12, "D"), { P: 530 / 60 }))),
			]),
	},
	{
		year: 2024,
		q: "Q3(d)",
		name: "Sprayer boom lamps",
		note: "Two 6 V 3 W lamps in series on 12 V",
		build: () => circuit([battery(12), S(lamp(12, 3, "6 V 3 W", true), lamp(12, 3, "6 V 3 W"))]),
	},
	{
		year: 2025,
		q: "Q2",
		name: "Air fryer",
		note: "The element is worked out from its 1800 W. Close switch B for the fans; blow the lamp for part (d)",
		build: airFryer,
	},
];
