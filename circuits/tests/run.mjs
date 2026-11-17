// Run with `node tests/run.mjs` from circuits/. Builds circuits whose answers are known from
// the formulas taught at Level 2 and 3, and checks the simulator gets them.
import { emptyCircuit, newPart, newWire, normalize, nets, splice } from "../js/circuit.js";
import { Sim } from "../js/sim.js";
import { EXAMPLES } from "../js/examples.js";
import { PAPERS } from "../js/papers.js";

let failed = 0;
function check(name, got, want, tolerance = 0.01) {
	// A want of zero is checked to within the tolerance itself.
	const ok = Math.abs(got - want) <= (want ? tolerance * Math.abs(want) : tolerance);
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got.toPrecision(5)} (want ${want.toPrecision(5)})`);
}

// A loop: the parts in order round a rectangle, each 4 squares long, joined by the wires.
function loop(specs) {
	const c = emptyCircuit();
	const parts = [];
	let x = 0;
	for (const [type, props] of specs) {
		parts.push(newPart(c, type, x, 0, 0, props));
		x += 4;
	}
	newWire(c, x, 0, x, 4);
	newWire(c, x, 4, 0, 4);
	newWire(c, 0, 4, 0, 0);
	return { c: normalize(c), parts };
}

function run(c, seconds, dt) {
	const sim = new Sim();
	sim.load(c);
	const steps = Math.round(seconds / dt);
	for (let k = 0; k < steps; k++) sim.step(dt);
	return sim;
}

{
	// The battery's positive end is its second, so the conventional current runs from the
	// first to the second through it and the readings are positive.
	const { c, parts } = loop([["battery", { emf: 6 }], ["ammeter"], ["resistor", { R: 10 }]]);
	const sim = run(c, 1e-3, 1e-3);
	check("Ohm's law, I = V/R", sim.state(parts[1].id).i, 0.6);
}
{
	const { c, parts } = loop([["battery", { emf: 9, r: 1 }], ["resistor", { R: 2 }]]);
	const sim = run(c, 1e-3, 1e-3);
	check("Terminal voltage, V = ε − Ir", Math.abs(sim.state(parts[0].id).v), 6);
}
{
	const { c, parts } = loop([["battery", { emf: 6 }], ["resistor", { R: 1e4 }], ["capacitor", { C: 100e-6 }]]);
	const sim = run(c, 1, 1e-3);
	check("RC charging, V = ε(1 − e^(−t/RC)) at t = RC", Math.abs(sim.state(parts[2].id).v), 6 * (1 - Math.exp(-1)));
}
{
	const { c, parts } = loop([["battery", { emf: 6 }], ["resistor", { R: 10 }], ["inductor", { L: 2 }]]);
	const sim = run(c, 0.2, 1e-4);
	check("RL growth, I = (ε/R)(1 − e^(−tR/L)) at t = L/R", Math.abs(sim.state(parts[2].id).i), 0.6 * (1 - Math.exp(-1)));
}
{
	const { c, parts } = loop([["battery", { emf: 6 }], ["resistor", { R: 10 }], ["inductor", { L: 2, r: 5 }]]);
	const sim = run(c, 5, 1e-3);
	check("Coil resistance, I = ε/(R + r) at steady state", Math.abs(sim.state(parts[2].id).i), 0.4);
}
{
	const C = 1 / ((2 * Math.PI * 50) ** 2 * 0.2);
	const { c, parts } = loop([["ac", { vrms: 6, f: 50 }], ["resistor", { R: 10 }], ["inductor", { L: 0.2 }], ["capacitor", { C }]]);
	const sim = new Sim();
	sim.load(c);
	// The current builds up over a time of 2L/R = 40 ms; half a second is long enough.
	for (let k = 0; k < 1500; k++) sim.advance(1 / 60, 0.02);
	check("LCR at resonance, Irms = V/R", sim.state(parts[1].id).rms[1], 0.6);
	check("LCR at resonance, VL = I·XL", sim.state(parts[2].id).rms[0], 0.6 * 2 * Math.PI * 50 * 0.2);
}
{
	const { c, parts } = loop([["ac", { vrms: 10, f: 50 }], ["resistor", { R: 100 }], ["capacitor", { C: 31.83e-6 }]]);
	const sim = new Sim();
	sim.load(c);
	for (let k = 0; k < 400; k++) sim.advance(1 / 60, 0.02);
	const Z = Math.hypot(100, 1 / (2 * Math.PI * 50 * 31.83e-6));
	check("RC impedance, Irms = V/Z", sim.state(parts[1].id).rms[1], 10 / Z);
}
{
	const { c, parts } = loop([["battery", { emf: 5 }], ["resistor", { R: 215 }], ["diode", { vf: 0.7 }]]);
	const sim = run(c, 1e-3, 1e-3);
	check("Diode forward drop", Math.abs(sim.state(parts[2].id).v), 0.7, 0.02);
}
{
	const { c, parts } = loop([["battery", { emf: 5 }], ["diode", { vf: 0.7 }, 2]]);
	// The diode turned round: no current.
	parts[1].rot = 2;
	parts[1].x = 8;
	const sim = run(normalize(c), 1e-3, 1e-3);
	check("Reverse-biased diode blocks", Math.abs(sim.state(parts[1].id).i), 0, 1e-6);
}
{
	const c = emptyCircuit();
	const ac = newPart(c, "ac", 0, 4, 3, { vrms: 12, f: 50 });
	const tf = newPart(c, "transformer", 4, 0, 0, { np: 200, ns: 100 });
	const lamp = newPart(c, "resistor", 8, 0, 1, { R: 1000 });
	newWire(c, 0, 0, 4, 0);
	newWire(c, 0, 4, 4, 4);
	const sim = new Sim();
	sim.load(normalize(c));
	for (let k = 0; k < 400; k++) sim.advance(1 / 60, 0.02);
	check("Transformer, Vs/Vp = Ns/Np", sim.state(lamp.id).rms[0], 6, 0.02);
	void ac;
	void tf;
}
{
	const { c, parts } = loop([["battery", { emf: 6 }], ["fuse", { rating: 1 }], ["resistor", { R: 2 }]]);
	const sim = run(c, 1e-3, 1e-3);
	check("A fuse blows above its rating", sim.state(parts[1].id).blown ? 1 : 0, 1);
}
{
	// 2025 L2 (91173) Q2(d): the air fryer's lamp stops working. The lamp is in parallel, so
	// the supply loses the lamp's 0.24 A and the element still gets 240 V and makes 1800 W.
	const ex = PAPERS.find((p) => p.year === 2025);
	const c = ex.build();
	const [battery, , switchB, lamp, element] = c.parts;
	switchB.props.closed = true;
	const sim = run(c, 1e-3, 1e-3);
	const before = Math.abs(sim.state(battery.id).i);
	check("Air fryer, supply current with both switches closed", before, 7.99);
	lamp.props.broken = true;
	sim.load(c);
	sim.step(1e-3);
	const after = Math.abs(sim.state(battery.id).i);
	check("Air fryer, the dead lamp carries no current", Math.abs(sim.state(lamp.id).i), 0, 1e-9);
	check("Air fryer, supply current falls by the lamp's 0.24 A", before - after, 0.24);
	const e = sim.state(element.id);
	check("Air fryer, the element still makes 1800 W", Math.abs(e.v * e.i), 1800);
}
{
	// In series, a dead lamp breaks the only path: the current stops altogether.
	const { c, parts } = loop([["battery", { emf: 6 }], ["lamp", { R: 12 }], ["lamp", { R: 12 }]]);
	const sim = run(c, 1e-3, 1e-3);
	check("Series lamps, current while both work", Math.abs(sim.state(parts[2].id).i), 0.25);
	parts[1].props.broken = true;
	sim.load(c);
	sim.step(1e-3);
	check("Series lamps, one dies and the current stops", Math.abs(sim.state(parts[2].id).i), 0, 1e-9);
}
{
	// A 6 V, 3 W lamp put on 12 V takes four times its rating and burns out by itself; once it
	// has, the current in the circuit drops to nothing.
	const { c, parts } = loop([["battery", { emf: 12 }], ["ammeter"], ["lamp", { R: 12, P: 3 }]]);
	const sim = run(c, 0.2, 1e-3);
	check("An overloaded lamp burns out", sim.state(parts[2].id).blown ? 1 : 0, 1);
	check("After it burns out the current is zero", Math.abs(sim.state(parts[1].id).i), 0, 1e-9);
	const ok = run(loop([["battery", { emf: 6 }], ["lamp", { R: 12, P: 3 }]]).c, 1, 1e-3);
	check("A lamp at its rating keeps working", [...ok.states.values()].some((s) => s.blown) ? 1 : 0, 0);
}
{
	// The example's own ammeter, in series beside the supply, reads the supply current.
	const ex = PAPERS.find((p) => p.year === 2025);
	const c = ex.build();
	const [, , switchB, lamp] = c.parts;
	const meter = c.parts.find((p) => p.type === "ammeter");
	const read = () => {
		const sim = run(c, 1e-3, 1e-3);
		return Math.abs(sim.state(meter.id).i);
	};
	check("Air fryer ammeter, A closed and B open (lamp + element)", read(), 7.74);
	switchB.props.closed = true;
	check("Air fryer ammeter, both closed", read(), 7.99);
	lamp.props.broken = true;
	check("Air fryer ammeter, both closed and the lamp blown", read(), 7.75);
}
{
	// A wire ending partway along another joins it.
	const c = emptyCircuit();
	newWire(c, 0, 0, 10, 0);
	newWire(c, 5, 0, 5, 5);
	normalize(c);
	check("A T-junction joins", nets(c).count, 1);
	const d = emptyCircuit();
	newWire(d, 0, 0, 10, 0);
	newWire(d, 5, -5, 5, 5);
	normalize(d);
	check("Crossing wires don't join", nets(d).count, 2);
}
for (const ex of EXAMPLES) {
	const c = ex.build();
	const sim = new Sim();
	sim.load(c);
	let threw = null;
	try {
		for (let k = 0; k < 120; k++) sim.advance(1 / 60, ex.speed);
	} catch (e) {
		threw = e;
	}
	const ok = !threw && [...sim.states.values()].every((s) => Number.isFinite(s.v) && Number.isFinite(s.i));
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} example "${ex.name}" runs${threw ? ": " + threw.message : ""}`);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
