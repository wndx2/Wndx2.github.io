// Run with `node tests/run.mjs` from WMB/. Checks that inputs are read as the right molecule
// and that every kind of diagram draws without throwing.
import { interpret } from "../js/parse.js";
import { render } from "../js/render.js";
import { composition } from "../js/mol.js";
import { condensedPieces } from "../js/condensed.js";

// A species written out so it can be compared: each heavy atom with its hydrogens, lone pairs
// (:), unpaired electrons (.) and charge, then the bonds between heavy atoms.
function describe(mol) {
	const isH = (i) => mol.atoms[i].el === "H";
	const atoms = mol.atoms.flatMap((a, i) => {
		if (isH(i) && mol.degree(i)) return [];
		const h = mol.adj[i].filter((e) => isH(e.to)).length;
		const charge = a.charge ? (a.charge > 0 ? "+" : "-").repeat(Math.abs(a.charge)) : "";
		return [a.el + (h ? "H" + (h > 1 ? h : "") : "") + ":".repeat(a.lp) + ".".repeat(a.rad) + charge];
	});
	const bonds = mol.bonds
		.filter((b) => !isH(b.a) && !isH(b.b))
		.map((b) => mol.atoms[b.a].el + "-=#"[b.order - 1] + mol.atoms[b.b].el);
	return [...atoms.sort(), "|", ...bonds.sort()].join(" ").replace(/ \|$/, "");
}

const hill = (parts) =>
	composition(parts)
		.formula.map(([el, n]) => el + (n > 1 ? n : ""))
		.join("");
const text = (parts) =>
	parts.map((p) => (p.count > 1 ? p.count : "") + condensedPieces(p.mol).pieces.map((x) => x.t).join("")).join(" ");

// [input, kind it should be read as, formula, then either the condensed text or a description]
const cases = [
	// Lewis structures from molecular formulas
	["H2O", "formula", "H2O", { is: "OH2::" }],
	["CO2", "formula", "CO2", { is: "C O:: O:: | C=O C=O" }],
	["NH3", "formula", "H3N", { is: "NH3:" }],
	["NH4+", "formula", "H4N", { is: "NH4+" }],
	["SO4 2-", "formula", "O4S", { is: "O:::- O:::- O:::- O:::- S++ | S-O S-O S-O S-O" }],
	["SO42-", "formula", "O4S", { is: "O:::- O:::- O:::- O:::- S++ | S-O S-O S-O S-O" }],
	["SO4 2-", "formula", "O4S", { is: "O:: O:: O:::- O:::- S | S-O S-O S=O S=O", expanded: true }],
	["SO2", "formula", "O2S", { is: "O:: O:: S: | S=O S=O", expanded: true }],
	["NO3-", "formula", "NO3", { is: "N+ O:: O:::- O:::- | N-O N-O N=O" }],
	["O3", "formula", "O3", { is: "O:+ O:: O:::- | O-O O=O" }],
	["CO", "formula", "CO", { is: "C:- O:+ | C#O" }],
	["BF3", "formula", "BF3", { is: "B F::: F::: F::: | B-F B-F B-F" }],
	["XeF4", "formula", "F4Xe", { is: "F::: F::: F::: F::: Xe:: | Xe-F Xe-F Xe-F Xe-F" }],
	["I3-", "formula", "I3", { is: "I::: I::: I:::- | I-I I-I" }],
	["NO2", "formula", "NO2", { is: "N.+ O:: O:::- | N-O N=O" }],
	["HNO3", "formula", "HNO3", { is: "N+ O:: O:::- OH:: | N-O N-O N=O" }],
	["H2SO4", "formula", "H2O4S", { is: "O:: O:: OH:: OH:: S | S-O S-O S=O S=O", expanded: true }],
	["HCN", "formula", "CHN", { is: "CH N: | C#N" }],
	["H2O2", "formula", "H2O2", { is: "OH:: OH:: | O-O" }],
	["HOCl", "formula", "ClHO", { is: "Cl::: OH:: | Cl-O" }],
	["Cl2O", "formula", "Cl2O", { is: "Cl::: Cl::: O:: | O-Cl O-Cl" }],
	["N2O", "formula", "N2O", { is: "N+ N: O:::- | N#N N-O" }],
	["C2H4", "formula", "C2H4", "CH2=CH2"],
	["C3H6", "formula", "C3H6", "CH3CH=CH2"],
	["CH2O2", "formula", "CH2O2", "HCOOH"],
	["CH4O", "formula", "CH4O", "CH3OH"],
	["CH3NO2", "formula", "CH3NO2", "CH3NO2"],
	["O2-", "formula", "O", { is: "O::::--" }],
	["Cl-", "formula", "Cl", { is: "Cl::::-" }],
	// Salts
	["NaCl", "formula", "ClNa", "Na+ Cl−"],
	["Ca(OH)2", "formula", "CaH2O2", "Ca2+ 2OH−"],
	["Al2(SO4)3", "formula", "Al2O12S3", "2Al3+ 3SO42−"],
	["NH4NO3", "formula", "H4N2O3", "NH4+ NO3−"],
	["CH3COONa", "formula", "C2H3NaO2", "Na+ CH3COO−"],
	["AlCl3", "formula", "AlCl3", "AlCl3"],
	// Condensed formulas
	["CH3CH2OH", "formula", "C2H6O", "CH3CH2OH"],
	["CH3COOH", "formula", "C2H4O2", "CH3COOH"],
	["CH3CO2H", "formula", "C2H4O2", "CH3COOH"],
	["CH3CHO", "formula", "C2H4O", "CH3CHO"],
	["CH3COCH3", "formula", "C3H6O", "CH3COCH3"],
	["CH3CH(CH3)CH3", "formula", "C4H10", "CH3CH(CH3)CH3"],
	["(CH3)3COH", "formula", "C4H10O", "CH3C(CH3)(OH)CH3"],
	["CH3(CH2)4CH3", "formula", "C6H14", "CH3CH2CH2CH2CH2CH3"],
	["CH2=CHCH3", "formula", "C3H6", "CH2=CHCH3"],
	["HOOCCOOH", "formula", "C2H2O4", "HOCOCOOH"],
	["C2H5OH", "formula", "C2H6O", "CH3CH2OH"],
	["CH3COOC2H5", "formula", "C4H8O2", "CH3COOCH2CH3"],
	["(C2H5)2O", "formula", "C4H10O", "CH3CH2OCH2CH3"],
	["C6H5OH", "formula", "C6H6O", "C6H6O"],
	["CH3CN", "formula", "C2H3N", "CH3CN"],
	["CH3CONH2", "formula", "C2H5NO", "CH3CONH2"],
	["CH3COCl", "formula", "C2H3ClO", "CH3COCl"],
	["CH3COO-", "formula", "C2H3O2", "CH3COO−"],
	["CH3NH3+", "formula", "CH6N", "CH3NH3+"],
	["CN-", "formula", "CN", "CN−"],
	["CHCl3", "formula", "CHCl3", "CHCl3"],
	["HCOOH", "formula", "CH2O2", "HCOOH"],
	// Lowercase
	["h2o", "formula", "H2O", "H2O"],
	["nacl", "formula", "ClNa", "Na+ Cl−"],
	["ch3cooh", "formula", "C2H4O2", "CH3COOH"],
	["caco3", "formula", "CCaO3", "Ca2+ CO32−"],
	// Names
	["ethanol", "name", "C2H6O", "CH3CH2OH"],
	["Propan-2-ol", "name", "C3H8O", "CH3CH(OH)CH3"],
	["2-butanol", "name", "C4H10O", "CH3CH(OH)CH2CH3"],
	["2-methylpropan-2-ol", "name", "C4H10O", "CH3C(OH)(CH3)CH3"],
	["but-2-ene", "name", "C4H8", "CH3CH=CHCH3"],
	["buta-1,3-diene", "name", "C4H6", "CH2=CHCH=CH2"],
	["ethyne", "name", "C2H2", "HC≡CH"],
	["ethanoic acid", "name", "C2H4O2", "CH3COOH"],
	["ethyl propanoate", "name", "C5H10O2", "CH3CH2COOCH2CH3"],
	["propanone", "name", "C3H6O", "CH3COCH3"],
	["butanal", "name", "C4H8O", "CH3CH2CH2CHO"],
	["methylpropane", "name", "C4H10", "CH3CH(CH3)CH3"],
	["2,2-dimethylpropane", "name", "C5H12", "CH3C(CH3)2CH3"],
	["1,2-dichloroethane", "name", "C2H4Cl2", "CH2ClCH2Cl"],
	["hexachloroethane", "name", "C2Cl6", "CCl3CCl3"],
	["N-methylethanamine", "name", "C3H9N", "CH3CH2NHCH3"],
	["propanenitrile", "name", "C3H5N", "CH3CH2CN"],
	["cyclohexene", "name", "C6H10", "C6H10"],
	["methylbenzene", "name", "C7H8", "C7H8"],
	["4-nitrophenol", "name", "C6H5NO3", "C6H5NO3"],
	["sodium ethanoate", "name", "C2H3NaO2", "Na+ CH3COO−"],
	["Sulphuric acid", "name", "H2O4S", "H2SO4"],
	["glucose", "name", "C6H12O6", "C6H12O6"],
	["urea", "name", "CH4N2O", "H2NCONH2"],
	// SMILES
	["CCO", "smiles", "C2H6O", "CH3CH2OH"],
	["CC(=O)O", "smiles", "C2H4O2", "CH3COOH"],
	["c1ccccc1", "smiles", "C6H6", "C6H6"],
	["C1CCCCC1", "smiles", "C6H12", "C6H12"],
	["c1ccc2ccccc2c1", "smiles", "C10H8", "C10H8"],
	["c1cc[nH]c1", "smiles", "C4H5N", "C4H5N"],
	["[NH4+]", "smiles", "H4N", "NH4+"],
	["[Na+].[Cl-]", "smiles", "ClNa", "Na+ Cl−"],
	["O=C=O", "smiles", "CO2", "CO2"],
	["CN", "smiles", "CH5N", "CH3NH2"],
	["CS(=O)(=O)O", "smiles", "CH4O3S", "CH3SO2OH"],
];

// Inputs that should be turned down, and a word the message should contain.
const refused = [
	["C2H6O", "more than one"],
	["CuSO4", "Cu"],
	["pentan-9-ol", "carbon 9"],
	["ethanoll", "name"],
	["CC(C", "“(”"],
];

// [formula, the caption under its shape diagram]
const shapes = [
	["CH4", "Tetrahedral · 109.5° · non-polar"],
	["NH3", "Trigonal pyramidal · <109.5° · polar"],
	["H2O", "Bent · <109.5° · polar"],
	["H2S", "Bent · <109.5° · polar"],
	["CO2", "Linear · 180° · non-polar"],
	["BF3", "Trigonal planar · 120° · non-polar"],
	["SO2", "Bent · <120° · polar"],
	["PCl5", "Trigonal bipyramidal · 90° and 120° · non-polar"],
	["SF4", "See-saw · <90° and <120° · polar"],
	["ClF3", "T-shaped · <90° · polar"],
	["XeF2", "Linear · 180° · non-polar"],
	["SF6", "Octahedral · 90° · non-polar"],
	["BrF5", "Square pyramidal · <90° · polar"],
	["XeF4", "Square planar · 90° · non-polar"],
	["CH2Cl2", "Tetrahedral · 109.5° · polar"],
	["NH4+", "Tetrahedral · 109.5°"],
	["HCl", "Linear · polar"],
	["N2", "Linear · non-polar"],
];

// [formula, how many resonance forms it has, expanded octets?]
const resonance = [
	["NO3-", 3],
	["CO3 2-", 3],
	["O3", 2],
	["SO2", 2],
	["CH3COO-", 2],
	["H2O", 1],
	["CO2", 1],
	["CH3COOH", 1],
	["SO4 2-", 1],
	["SO4 2-", 6, true],
];

let failed = 0;
const fail = (input, message) => {
	failed++;
	console.log(`✗ ${input}: ${message}`);
};

for (const [input, kind, formula, want] of cases) {
	try {
		const got = interpret(input, "auto", { expanded: !!want.expanded });
		if (got.kind !== kind) fail(input, `read as ${got.kind}, not ${kind}`);
		if (hill(got.parts) !== formula) fail(input, `formula ${hill(got.parts)}, not ${formula}`);
		const shown = want.is ? got.parts.map((p) => describe(p.mol)).join(" + ") : text(got.parts);
		if (shown !== (want.is ?? want)) fail(input, `got “${shown}”, not “${want.is ?? want}”`);
		for (const style of ["lewis", "structural", "skeletal", "condensed", "shape"]) {
			for (const bonds of ["lines", "dots", "cross"]) {
				const all = bonds !== "lines";
				const { svg } = render(got.parts, { style, bonds, colour: all, partial: all, resonance: all, charges: all ? "formal" : "auto" });
				if (/NaN|undefined|Infinity/.test(svg)) fail(input, `${style} diagram has a bad number in it`);
			}
		}
	} catch (error) {
		fail(input, error.stack);
	}
}

for (const [input, word] of refused) {
	try {
		interpret(input);
		fail(input, "should have been refused");
	} catch (error) {
		if (!error.message.includes(word)) fail(input, `refused with “${error.message}”`);
	}
}

for (const [input, caption] of shapes) {
	const { svg } = render(interpret(input).parts, { style: "shape" });
	const got = (svg.match(/>([^<>]*(?:Linear|planar|Bent|hedral|pyramidal|saw|shaped)[^<>]*)</) || [])[1];
	if (got?.replace(/&lt;/g, "<") !== caption) fail(input, `shape captioned “${got}”, not “${caption}”`);
}

for (const [input, count, expanded] of resonance) {
	const [{ mol }] = interpret(input, "auto", { expanded: !!expanded }).parts;
	const got = mol.forms?.length ?? 1;
	if (got !== count) fail(input, `${got} resonance forms, not ${count}`);
	const arrows = render([{ mol, count: 1 }], { resonance: true }).svg.split("translate(").length - 1;
	if (arrows !== 2 * count - 1) fail(input, "resonance forms weren't all drawn");
}

const total = cases.length + refused.length + shapes.length + resonance.length;
console.log(failed ? `${failed} failed` : `all ${total} passed`);
process.exit(failed ? 1 : 0);
