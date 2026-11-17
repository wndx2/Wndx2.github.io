// Every part a circuit can be built from: what it's called, where its ends are, what can be
// set on it, and what's written beside it. The physics is in sim.js and the drawing in
// symbols.js.
import { quantity } from "./units.js";

// A two-ended part runs four squares, from (0, 0) to (4, 0) before it's turned.
const TWO = [
	[0, 0],
	[4, 0],
];

export const LED_COLOURS = {
	red: { name: "Red", vf: 1.8, glow: "#ff3b30" },
	yellow: { name: "Yellow", vf: 2.0, glow: "#ffcc00" },
	green: { name: "Green", vf: 2.2, glow: "#34c759" },
	blue: { name: "Blue", vf: 3.0, glow: "#0a84ff" },
	white: { name: "White", vf: 3.2, glow: "#f2f2ff" },
};

// An LDR goes from 1 MΩ in the dark to 100 Ω in full light, evenly on a log scale.
export const ldrResistance = (light) => 10 ** (6 - (4 * light) / 100);
// An NTC thermistor: 10 kΩ at 25 °C, falling as it warms (B = 3950 K).
export const thermistorResistance = (celsius) => 1e4 * Math.exp(3950 * (1 / (celsius + 273.15) - 1 / 298.15));

// The resistance of anything that's simply a resistor, or null.
export function resistanceOf(part) {
	const p = part.props;
	switch (part.type) {
		case "resistor":
		case "lamp":
			return p.R;
		case "varres":
			return (p.max * p.setting) / 100;
		case "ldr":
			return ldrResistance(p.light);
		case "thermistor":
			return thermistorResistance(p.temp);
		default:
			return null;
	}
}

const number = (key, label, unit, extra) => ({ kind: "number", key, label, unit, min: 0, ...extra });

export const PARTS = {
	cell: {
		name: "Cell",
		pins: TWO,
		props: { emf: 1.5, r: 0 },
		fields: [number("emf", "EMF", "V", { min: -1e6 }), number("r", "Internal resistance", "Ω")],
		label: (p) => quantity(p.emf, "V"),
	},
	battery: {
		name: "Battery",
		pins: TWO,
		props: { emf: 6, r: 0 },
		fields: [number("emf", "EMF", "V", { min: -1e6 }), number("r", "Internal resistance", "Ω")],
		label: (p) => quantity(p.emf, "V"),
	},
	ac: {
		name: "AC supply",
		pins: TWO,
		props: { vrms: 6, f: 50, r: 0 },
		fields: [
			number("vrms", "Voltage (rms)", "V"),
			number("f", "Frequency", "Hz", { min: 1e-3 }),
			number("r", "Internal resistance", "Ω"),
		],
		label: (p) => `${quantity(p.vrms, "V")} ${quantity(p.f, "Hz")}`,
	},
	switch: {
		name: "Switch",
		pins: TWO,
		props: { closed: false },
		fields: [{ kind: "switch", key: "closed", label: "Closed" }],
		label: () => "",
	},
	fuse: {
		name: "Fuse",
		pins: TWO,
		props: { rating: 1 },
		fields: [number("rating", "Rating", "A", { min: 1e-6 })],
		label: (p) => quantity(p.rating, "A"),
	},
	resistor: {
		name: "Resistor",
		pins: TWO,
		props: { R: 10 },
		fields: [number("R", "Resistance", "Ω")],
		label: (p) => quantity(p.R, "Ω"),
	},
	varres: {
		name: "Variable resistor",
		short: "Variable",
		pins: TWO,
		props: { max: 100, setting: 50 },
		fields: [
			// The resistance can be typed straight in; one above the maximum raises the maximum.
			number("R", "Resistance", "Ω", {
				get: (p) => (p.max * p.setting) / 100,
				set: (p, ohms) => {
					if (ohms > p.max) p.max = ohms;
					p.setting = p.max ? (100 * ohms) / p.max : 0;
				},
			}),
			{ kind: "range", key: "setting", label: "Setting", min: 0, max: 100, step: "any", show: (p) => quantity((p.max * p.setting) / 100, "Ω") },
			number("max", "Maximum", "Ω"),
		],
		label: (p) => quantity((p.max * p.setting) / 100, "Ω"),
	},
	lamp: {
		name: "Lamp",
		pins: TWO,
		// broken is a lamp that has died, set by hand; one also burns out on its own if it's run
		// well over its rated power (see sim.js).
		props: { R: 12, P: 3, broken: false },
		// A lamp is stored as its resistance and rated power, but can be entered the way it's
		// labelled: any two of rated voltage, power and current. Changing one keeps the rated
		// voltage where it can, so "12 V" then "5 W", in either order, makes a 12 V 5 W lamp.
		fields: [
			number("V", "Rated voltage", "V", { min: 1e-6, get: (p) => Math.sqrt(p.P * p.R), set: (p, v) => (p.R = (v * v) / p.P) }),
			number("P", "Rated power", "W", {
				min: 1e-6,
				set: (p, w) => {
					const v2 = p.P * p.R;
					p.P = w;
					p.R = v2 / w;
				},
			}),
			number("I", "Rated current", "A", {
				min: 1e-9,
				get: (p) => Math.sqrt(p.P / p.R),
				set: (p, i) => {
					const v = Math.sqrt(p.P * p.R);
					p.R = v / i;
					p.P = v * i;
				},
			}),
			number("R", "Resistance", "Ω"),
			{ kind: "note", text: "The rating is what's printed on the lamp. To say what current flows through it, use Given current below." },
			{ kind: "switch", key: "broken", label: "Blown" },
		],
		label: () => "",
	},
	ldr: {
		name: "LDR",
		pins: TWO,
		props: { light: 50 },
		fields: [{ kind: "range", key: "light", label: "Light", min: 0, max: 100, step: 1, show: (p) => `${p.light}%` }],
		label: (p) => quantity(ldrResistance(p.light), "Ω"),
	},
	thermistor: {
		name: "Thermistor",
		pins: TWO,
		props: { temp: 25 },
		fields: [{ kind: "range", key: "temp", label: "Temperature", min: -20, max: 120, step: 1, show: (p) => `${p.temp} °C` }],
		label: (p) => quantity(thermistorResistance(p.temp), "Ω"),
	},
	ammeter: {
		name: "Ammeter",
		pins: TWO,
		props: {},
		fields: [],
		label: () => "",
	},
	voltmeter: {
		name: "Voltmeter",
		pins: TWO,
		props: {},
		fields: [],
		label: () => "",
	},
	diode: {
		name: "Diode",
		pins: TWO,
		props: { vf: 0.7 },
		fields: [number("vf", "Forward voltage", "V", { min: 0.05 })],
		label: () => "",
	},
	led: {
		name: "LED",
		pins: TWO,
		props: { colour: "red" },
		fields: [
			{
				kind: "select",
				key: "colour",
				label: "Colour",
				options: Object.entries(LED_COLOURS).map(([key, c]) => [key, `${c.name} (${c.vf} V)`]),
			},
		],
		label: () => "",
	},
	capacitor: {
		name: "Capacitor",
		pins: TWO,
		props: { C: 100e-6 },
		fields: [number("C", "Capacitance", "F", { min: 1e-15 })],
		label: (p) => quantity(p.C, "F"),
	},
	inductor: {
		name: "Inductor",
		pins: TWO,
		props: { L: 1, r: 0 },
		fields: [number("L", "Inductance", "H", { min: 1e-9 }), number("r", "Coil resistance", "Ω")],
		label: (p) => quantity(p.L, "H"),
	},
	transformer: {
		name: "Transformer",
		// The primary's two ends on the left, the secondary's on the right; the top ends are
		// in phase.
		pins: [
			[0, 0],
			[0, 4],
			[4, 0],
			[4, 4],
		],
		props: { np: 200, ns: 100, L: 2 },
		fields: [
			number("np", "Primary turns", "", { min: 1 }),
			number("ns", "Secondary turns", "", { min: 1 }),
			number("L", "Primary inductance", "H", { min: 1e-6 }),
		],
		label: (p) => `${Number(p.np.toPrecision(3))} : ${Number(p.ns.toPrecision(3))}`,
	},
};

// Exam questions give facts about a circuit ("the current in lamp D is 1.4 A") and ask for
// something missing. Any two-ended part can carry a given current, voltage or power (null when
// not given), and some can have one of their values marked unknown, to be worked out so the
// givens hold (see solve.js). These are the values that can be unknown, for each kind of part.
export const UNKNOWNS = {
	cell: [
		["emf", "EMF"],
		["r", "Internal resistance"],
	],
	battery: [
		["emf", "EMF"],
		["r", "Internal resistance"],
	],
	// "Identical" parts share one unknown resistance: every lamp marked so is the same lamp,
	// as in "three identical lamps".
	resistor: [
		["R", "Resistance"],
		["Rsame", "Resistance (identical resistors)"],
	],
	lamp: [
		["R", "Resistance"],
		["Rsame", "Resistance (identical lamps)"],
	],
	varres: [["R", "Resistance"]],
};
export const GIVENS = [
	["givenI", "Current", "A"],
	["givenV", "Voltage", "V"],
	["givenP", "Power", "W"],
];
for (const def of Object.values(PARTS)) {
	if (def.pins.length === 2) def.props = { ...def.props, givenI: null, givenV: null, givenP: null, unknown: "" };
}

// The order of the palette, in groups.
export const PALETTE = [
	["Sources", ["cell", "battery", "ac"]],
	["Switches", ["switch", "fuse", "wire"]],
	["Resistors", ["resistor", "varres", "lamp", "ldr", "thermistor"]],
	["Meters", ["ammeter", "voltmeter"]],
	["Semiconductors", ["diode", "led"]],
	["Capacitors and inductors", ["capacitor", "inductor", "transformer"]],
];

// Where the middle of a part is, before it's turned: it's placed and turned about this point.
export const centreOf = (type) => (type === "transformer" ? [2, 2] : [2, 0]);
