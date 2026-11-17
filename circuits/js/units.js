// Values are typed and shown the way they're written in physics: a number, an SI prefix and
// a unit, as in 4.7 kΩ or 100 µF.

const PREFIXES = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
const STEPS = [
	[1e9, "G"],
	[1e6, "M"],
	[1e3, "k"],
	[1, ""],
	[1e-3, "m"],
	[1e-6, "µ"],
	[1e-9, "n"],
	[1e-12, "p"],
];

// Reads "4.7k", "100 µF", "2.2e-3" or "0.5 A". Anything after the prefix (the unit) is
// ignored. Gives NaN for text that doesn't start with a number.
export function parseValue(text) {
	const match = String(text)
		.trim()
		.replace(/,/g, "")
		.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([pnuµμmkKMG])?/);
	if (!match) return NaN;
	const base = Number(match[1]);
	// "1 F" or "2 H": a capital that isn't a prefix belongs to the unit.
	return match[2] ? base * PREFIXES[match[2]] : base;
}

function scaled(value) {
	const size = Math.abs(value);
	for (const [factor, prefix] of STEPS) if (size / factor >= 0.9995) return [value / factor, prefix];
	return [value / 1e-12, "p"];
}

// A reading, to three significant figures with the zeros kept: 0.500 A is shown as 500 mA.
export function reading(value, unit) {
	if (!Number.isFinite(value)) return "∞ " + unit;
	if (Math.abs(value) < 1e-10) return "0.00 " + unit;
	const [n, prefix] = scaled(value);
	return `${n.toPrecision(3)} ${prefix}${unit}`;
}

// A value that was typed in, without trailing zeros: 10 Ω, 1.5 V, 100 µF.
export function quantity(value, unit) {
	if (!Number.isFinite(value)) return "∞ " + unit;
	if (value === 0) return "0 " + unit;
	const [n, prefix] = scaled(value);
	return `${Number(n.toPrecision(3))} ${prefix}${unit}`;
}
