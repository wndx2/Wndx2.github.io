import { SYMBOLS } from "./elements.js";
import { parseFormula, fixCase } from "./formula.js";
import { parseSmiles } from "./smiles.js";
import { parseName } from "./names.js";

// Two-letter strings that read as a formula rather than as SMILES: CO is carbon monoxide, not
// methanol.
const DIATOMIC = new Set(["CO", "NO", "SO", "CS", "ClF", "BrF", "BrCl", "ICl", "IBr", "IF"]);
const ORGANIC = new Set(["B", "C", "N", "O", "P", "S", "F", "Cl", "Br", "I"]);

function fromName(text, opts) {
	const found = parseName(text);
	if (!found) return null;
	if (found.formula) return parseFormula(found.formula, opts);
	const mols = found.smiles ? parseSmiles(found.smiles).fragments() : found.mols;
	return { parts: mols.map((mol) => ({ mol, count: 1 })), notes: [] };
}

function fromSmiles(text) {
	return { parts: parseSmiles(text).fragments().map((mol) => ({ mol, count: 1 })), notes: [] };
}

// Whether a string that could be either is more likely a formula or SMILES.
function likely(text) {
	// Letters that aren't part of an element symbol are SMILES' lowercase aromatic atoms.
	let stray = false;
	for (let i = 0; i < text.length; i++) {
		if (/[A-Z]/.test(text[i])) {
			if (/[a-z]/.test(text[i + 1] || "") && SYMBOLS.has(text.slice(i, i + 2))) i++;
		} else if (/[a-z]/.test(text[i])) stray = true;
	}
	const bare = text.replace(/\[[^[\]()]*\]/g, "");
	if (stray || /[@\\/%.:]/.test(text)) return "smiles";
	if (/H/.test(bare) || /\^/.test(text) || (/[+-]$/.test(text) && bare === text)) return "formula";
	if (bare !== text) return "smiles";
	const digits = bare.match(/\d/g) || [];
	if (digits.length) {
		// Ring numbers in SMILES come in pairs; counts in a formula mostly don't.
		const paired = [...new Set(digits)].every((d) => digits.filter((x) => x === d).length % 2 === 0);
		return paired ? "smiles" : "formula";
	}
	if (DIATOMIC.has(text) || (SYMBOLS.has(text) && !ORGANIC.has(text))) return "formula";
	return "smiles";
}

// Works out what was typed — a name, a formula or SMILES — and returns
// { parts: [{ mol, count }], notes, kind }. `mode` forces one reading; "auto" tries each in the
// order that suits the text.
export function interpret(input, mode = "auto", opts = {}) {
	const text = input.trim();
	if (!text) return null;
	const lowercase = text === text.toLowerCase();
	const readers = {
		name: () => fromName(text, opts),
		formula: () => parseFormula(lowercase ? fixCase(text) : text, opts),
		smiles: () => fromSmiles(text),
	};
	let order = [mode];
	if (mode === "auto") {
		if (lowercase) order = ["name", "smiles", "formula"];
		else order = likely(text) === "formula" ? ["name", "formula", "smiles"] : ["name", "smiles", "formula"];
	}

	const errors = [];
	for (const kind of order) {
		try {
			const result = readers[kind]();
			if (result) return { ...result, kind };
		} catch (error) {
			errors.push({ kind, error });
		}
	}
	if (mode === "name" && !errors.length) throw new Error(`“${text}” isn't a name WMB knows.`);
	// Something that reads like words was meant as a name, whatever the other readers made of it.
	const wordy = /[a-z]{4}/.test(text) && /^[A-Za-z][a-z0-9,\- ]+$/.test(text);
	const named = errors.find((e) => e.kind === "name");
	if (wordy && !named) {
		throw new Error(`“${text}” isn't a name WMB knows. Try its systematic name, a formula, or SMILES.`);
	}
	throw (named || errors.find((e) => e.kind === order.find((k) => k !== "name")) || errors[0]).error;
}
