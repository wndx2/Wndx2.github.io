// Circuits to start from, one for each idea in the Level 2 and 3 electricity topics. Each is
// laid out in grid squares, with the parts turned so that supplies have their positive end
// at the top.
import { emptyCircuit, newPart, newWire, normalize } from "./circuit.js";

// Joins points with wires: path(c, [x, y], [x, y], ...).
function path(c, ...points) {
	for (let k = 1; k < points.length; k++) newWire(c, ...points[k - 1], ...points[k]);
}

export const EXAMPLES = [
	{
		name: "Series and parallel",
		note: "Click the switch to open and close it",
		speed: 1,
		build() {
			const c = emptyCircuit();
			newPart(c, "battery", 0, 6, 3, { emf: 6 });
			newPart(c, "switch", 2, 0, 0, { closed: true });
			newPart(c, "resistor", 6, 0, 0, { R: 10 });
			newPart(c, "ammeter", 10, 0, 0);
			newPart(c, "lamp", 16, 2, 1);
			newPart(c, "lamp", 20, 2, 1);
			newPart(c, "voltmeter", 24, 2, 1);
			path(c, [0, 2], [0, 0], [2, 0]);
			path(c, [14, 0], [16, 0], [20, 0], [20, 2], [24, 2]);
			path(c, [16, 0], [16, 2]);
			path(c, [24, 6], [20, 6], [20, 8], [16, 8], [0, 8], [0, 6]);
			path(c, [16, 6], [16, 8]);
			return normalize(c);
		},
	},
	{
		name: "Internal resistance",
		note: "Close the switch and slide the variable resistor",
		speed: 1,
		select: 4,
		build() {
			const c = emptyCircuit();
			newPart(c, "battery", 0, 6, 3, { emf: 9, r: 1.5 });
			newPart(c, "voltmeter", -4, 6, 3);
			newPart(c, "ammeter", 4, 0, 0);
			newPart(c, "switch", 8, 0, 0);
			newPart(c, "varres", 12, 2, 1, { max: 20, setting: 50 });
			path(c, [-4, 2], [0, 2], [0, 0], [4, 0]);
			path(c, [12, 0], [12, 2]);
			path(c, [12, 6], [12, 8], [0, 8], [0, 6], [-4, 6]);
			return normalize(c);
		},
	},
	{
		name: "Capacitor",
		note: "Open the top switch, then close the middle one to discharge",
		speed: 1,
		select: 5,
		build() {
			const c = emptyCircuit();
			newPart(c, "battery", 0, 6, 3, { emf: 6 });
			newPart(c, "switch", 0, 0, 0, { closed: true });
			newPart(c, "switch", 6, 2, 1);
			newPart(c, "resistor", 8, 0, 0, { R: 10e3 });
			newPart(c, "ammeter", 12, 0, 0);
			newPart(c, "capacitor", 16, 2, 1, { C: 100e-6 });
			newPart(c, "voltmeter", 20, 2, 1);
			path(c, [0, 2], [0, 0]);
			path(c, [4, 0], [6, 0], [8, 0]);
			path(c, [6, 0], [6, 2]);
			path(c, [16, 0], [16, 2], [20, 2]);
			path(c, [20, 6], [16, 6], [16, 8], [6, 8], [0, 8], [0, 6]);
			path(c, [6, 6], [6, 8]);
			return normalize(c);
		},
	},
	{
		name: "Inductor",
		note: "Close the switch: the lamp lights, then dims as the current grows in the coil",
		speed: 0.1,
		select: 4,
		build() {
			const c = emptyCircuit();
			newPart(c, "battery", 0, 6, 3, { emf: 6 });
			newPart(c, "switch", 0, 0, 0);
			newPart(c, "resistor", 4, 0, 0, { R: 10 });
			newPart(c, "ammeter", 8, 0, 0);
			newPart(c, "inductor", 12, 2, 1, { L: 2, r: 5 });
			newPart(c, "lamp", 16, 2, 1, { R: 12, P: 0.5 });
			newPart(c, "voltmeter", 20, 2, 1);
			path(c, [0, 2], [0, 0]);
			path(c, [12, 0], [12, 2], [16, 2], [20, 2]);
			path(c, [20, 6], [16, 6], [12, 6], [12, 8], [0, 8], [0, 6]);
			return normalize(c);
		},
	},
	{
		name: "LCR resonance",
		note: "Try other frequencies on the supply: the current peaks at 50 Hz",
		speed: 0.02,
		select: 0,
		build() {
			const c = emptyCircuit();
			newPart(c, "ac", 0, 6, 3, { vrms: 6, f: 50 });
			newPart(c, "resistor", 0, 0, 0, { R: 10 });
			newPart(c, "ammeter", 4, 0, 0);
			newPart(c, "inductor", 8, 0, 0, { L: 0.2 });
			newPart(c, "capacitor", 12, 0, 0, { C: 50.7e-6 });
			newPart(c, "voltmeter", 8, -4, 0);
			newPart(c, "voltmeter", 12, -4, 0);
			path(c, [0, 2], [0, 0]);
			path(c, [8, 0], [8, -4]);
			path(c, [12, 0], [12, -4]);
			path(c, [16, -4], [16, 0], [16, 8], [0, 8], [0, 6]);
			return normalize(c);
		},
	},
	{
		name: "Rectifier",
		note: "Close the switch to smooth the output with the capacitor",
		speed: 0.02,
		select: 2,
		build() {
			const c = emptyCircuit();
			newPart(c, "ac", 0, 6, 3, { vrms: 6, f: 50 });
			newPart(c, "diode", 0, 0, 0);
			newPart(c, "resistor", 8, 2, 1, { R: 1000 });
			newPart(c, "switch", 12, 0, 1);
			newPart(c, "capacitor", 12, 4, 1, { C: 100e-6 });
			path(c, [0, 2], [0, 0]);
			path(c, [4, 0], [8, 0], [12, 0]);
			path(c, [8, 0], [8, 2]);
			path(c, [8, 6], [8, 8], [0, 8], [0, 6]);
			path(c, [12, 8], [8, 8]);
			return normalize(c);
		},
	},
	{
		name: "Transformer",
		note: "Change the turns to step the voltage up or down",
		speed: 0.02,
		select: 1,
		build() {
			const c = emptyCircuit();
			newPart(c, "ac", 0, 6, 3, { vrms: 12, f: 50 });
			newPart(c, "transformer", 4, 2, 0, { np: 200, ns: 100 });
			newPart(c, "lamp", 12, 2, 1);
			newPart(c, "voltmeter", -4, 6, 3);
			newPart(c, "voltmeter", 16, 2, 1);
			path(c, [-4, 2], [0, 2], [4, 2]);
			path(c, [-4, 6], [0, 6], [4, 6]);
			path(c, [8, 2], [12, 2], [16, 2]);
			path(c, [8, 6], [12, 6], [16, 6]);
			return normalize(c);
		},
	},
	{
		name: "Potential divider",
		note: "Slide the light level on the LDR",
		speed: 1,
		select: 2,
		build() {
			const c = emptyCircuit();
			newPart(c, "battery", 0, 6, 3, { emf: 6 });
			newPart(c, "resistor", 8, 0, 1, { R: 10e3 });
			newPart(c, "ldr", 8, 4, 1);
			newPart(c, "voltmeter", 12, 4, 1);
			path(c, [0, 2], [0, 0], [8, 0]);
			path(c, [8, 4], [12, 4]);
			path(c, [12, 8], [8, 8], [0, 8], [0, 6]);
			return normalize(c);
		},
	},
	{
		// NCEA Level 2 Physics 2025 (91173), Question Two: an air fryer. The rheostat is the
		// heating element and the two resistors are its fans. Switch A is the upper switch on the
		// right, B the lower; set to 32 Ω the element makes 1800 W. The ammeter isn't in the
		// paper: it sits in series beside the supply, so it reads the supply's current.
		name: "2025 L2: air fryer",
		note: "Top switch is A, lower is B. The ammeter reads the supply current",
		speed: 1,
		select: 4,
		build() {
			const c = emptyCircuit();
			newPart(c, "battery", 6, 0, 0, { emf: 240 });
			newPart(c, "switch", 16, 0, 1, { closed: true });
			newPart(c, "switch", 16, 10, 1);
			newPart(c, "lamp", 6, 6, 0, { R: 1000, P: 57.6 });
			newPart(c, "varres", 6, 10, 0, { max: 64, setting: 50 });
			newPart(c, "resistor", 2, 16, 0, { R: 480 });
			newPart(c, "resistor", 8, 16, 0, { R: 480 });
			newPart(c, "ammeter", 10, 0, 0);
			path(c, [6, 0], [0, 0], [0, 6], [0, 10], [0, 16], [2, 16]);
			path(c, [14, 0], [16, 0]);
			path(c, [16, 4], [16, 6], [16, 10]);
			path(c, [0, 6], [6, 6]);
			path(c, [10, 6], [16, 6]);
			path(c, [0, 10], [6, 10]);
			path(c, [10, 10], [16, 10]);
			path(c, [6, 16], [8, 16]);
			path(c, [12, 16], [16, 16], [16, 14]);
			return normalize(c);
		},
	},
];
