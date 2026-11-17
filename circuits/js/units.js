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

// Reads "4.7k", "100 µF", "2.2e-3", "0.5 A", ".5" or "1,5". Anything after the prefix (the
// unit) is ignored. Gives NaN for text that doesn't start with a number.
export function parseValue(text) {
	const match = String(text)
		.trim()
		// A typographic minus counts as a minus.
		.replace(/[−–]/g, "-")
		// A comma before exactly three digits separates thousands (1,000); any other comma is a
		// decimal point (1,5).
		.replace(/,(?=\d{3}(?!\d))/g, "")
		.replace(/,/g, ".")
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

// As scaled(), but a value between 0.01 and 1 stays a plain decimal (0.5 Ω, not 500 mΩ), as
// it's written in physics.
function plain(value, digits) {
	const size = Math.abs(value);
	if (size >= 0.01 && size < 1 && Number(size.toPrecision(digits)) < 1) return [value, ""];
	return scaled(value);
}

// A reading, to three significant figures with the zeros kept: 0.500 A is shown as 500 mA.
export function reading(value, unit) {
	if (!Number.isFinite(value)) return "∞ " + unit;
	if (Math.abs(value) < 1e-10) return "0.00 " + unit;
	const [n, prefix] = scaled(value);
	return `${n.toPrecision(3)} ${prefix}${unit}`;
}

// A value that was typed in, without trailing zeros: 10 Ω, 1.5 V, 0.5 Ω, 100 µF. Three
// significant figures by default; a box being edited shows more, so what was typed comes back
// as typed.
export function quantity(value, unit, digits = 3) {
	if (!Number.isFinite(value)) return "∞ " + unit;
	if (value === 0) return "0 " + unit;
	const [n, prefix] = plain(value, digits);
	return `${Number(n.toPrecision(digits))} ${prefix}${unit}`;
}
