import { ELEMENTS, VALENCES } from "./elements.js";
import { Mol, fillHydrogens, addBenzene } from "./mol.js";
import { setNonbonding } from "./electrons.js";

// Everyday names, as the formula ("f:") or SMILES ("s:") they stand for.
const COMMON = {
	water: "f:H2O",
	ammonia: "f:NH3",
	hydrogen: "f:H2",
	oxygen: "f:O2",
	nitrogen: "f:N2",
	fluorine: "f:F2",
	chlorine: "f:Cl2",
	bromine: "f:Br2",
	iodine: "f:I2",
	ozone: "f:O3",
	"hydrogen peroxide": "f:H2O2",
	"carbon dioxide": "f:CO2",
	"carbon monoxide": "f:CO",
	"carbon disulfide": "f:CS2",
	"sulfur dioxide": "f:SO2",
	"sulfur trioxide": "f:SO3",
	"sulfur hexafluoride": "f:SF6",
	"nitrogen dioxide": "f:NO2",
	"nitric oxide": "f:NO",
	"nitrogen monoxide": "f:NO",
	"nitrous oxide": "f:N2O",
	"dinitrogen tetroxide": "f:N2O4",
	"hydrogen fluoride": "f:HF",
	"hydrogen chloride": "f:HCl",
	"hydrochloric acid": "f:HCl",
	"hydrogen bromide": "f:HBr",
	"hydrogen iodide": "f:HI",
	"hydrogen sulfide": "f:H2S",
	"hydrogen cyanide": "f:HCN",
	hydrazine: "f:N2H4",
	phosphine: "f:PH3",
	"boron trifluoride": "f:BF3",
	"phosphorus trichloride": "f:PCl3",
	"phosphorus pentachloride": "f:PCl5",
	"xenon tetrafluoride": "f:XeF4",
	"xenon difluoride": "f:XeF2",
	"sulfuric acid": "f:H2SO4",
	"sulfurous acid": "f:H2SO3",
	"nitric acid": "f:HNO3",
	"nitrous acid": "f:HNO2",
	"phosphoric acid": "f:H3PO4",
	"carbonic acid": "f:H2CO3",
	"hypochlorous acid": "f:HClO",
	"perchloric acid": "f:HClO4",
	ammonium: "f:NH4^+",
	hydronium: "f:H3O^+",
	hydroxide: "f:OH^-",
	nitrate: "f:NO3^-",
	nitrite: "f:NO2^-",
	sulfate: "f:SO4^2-",
	sulfite: "f:SO3^2-",
	carbonate: "f:CO3^2-",
	"hydrogen carbonate": "f:HCO3^-",
	bicarbonate: "f:HCO3^-",
	phosphate: "f:PO4^3-",
	cyanide: "f:CN^-",
	hypochlorite: "f:ClO^-",
	chlorate: "f:ClO3^-",
	perchlorate: "f:ClO4^-",
	triiodide: "f:I3^-",
	azide: "f:N3^-",
	peroxide: "f:O2^2-",
	"sodium chloride": "f:NaCl",
	salt: "f:NaCl",
	"sodium hydroxide": "f:NaOH",
	"potassium hydroxide": "f:KOH",
	"calcium carbonate": "f:CaCO3",
	"calcium hydroxide": "f:Ca(OH)2",
	"magnesium oxide": "f:MgO",
	"ammonium chloride": "f:NH4Cl",
	"ammonium nitrate": "f:NH4NO3",
	"sodium carbonate": "f:Na2CO3",
	"sodium hydrogen carbonate": "f:NaHCO3",
	"baking soda": "f:NaHCO3",
	chloroform: "f:CHCl3",
	"carbon tetrachloride": "f:CCl4",
	"formic acid": "s:OC=O",
	"acetic acid": "s:CC(=O)O",
	vinegar: "s:CC(=O)O",
	acetate: "s:CC(=O)[O-]",
	"oxalic acid": "s:OC(=O)C(=O)O",
	"lactic acid": "s:CC(O)C(=O)O",
	"citric acid": "s:OC(=O)CC(O)(C(=O)O)CC(=O)O",
	formaldehyde: "s:C=O",
	acetaldehyde: "s:CC=O",
	acetone: "s:CC(=O)C",
	ethylene: "s:C=C",
	propylene: "s:CC=C",
	acetylene: "s:C#C",
	isopropanol: "s:CC(O)C",
	"isopropyl alcohol": "s:CC(O)C",
	"ethylene glycol": "s:OCCO",
	glycerol: "s:OCC(O)CO",
	"diethyl ether": "s:CCOCC",
	"dimethyl ether": "s:COC",
	urea: "s:NC(=O)N",
	glycine: "s:NCC(=O)O",
	alanine: "s:CC(N)C(=O)O",
	glucose: "s:OCC1OC(O)C(O)C(O)C1O",
	styrene: "s:C=Cc1ccccc1",
	naphthalene: "s:c1ccc2ccccc2c1",
	pyridine: "s:c1ccncc1",
	aspirin: "s:CC(=O)Oc1ccccc1C(=O)O",
	paracetamol: "s:CC(=O)Nc1ccc(O)cc1",
	caffeine: "s:Cn1cnc2c1c(=O)n(C)c(=O)n2C",
	ibuprofen: "s:CC(C)Cc1ccc(cc1)C(C)C(=O)O",
};

const STEMS = [
	["undec", 11],
	["dodec", 12],
	["meth", 1],
	["eth", 2],
	["prop", 3],
	["but", 4],
	["pent", 5],
	["hex", 6],
	["hept", 7],
	["oct", 8],
	["non", 9],
	["dec", 10],
];
const MULTIPLIERS = { di: 2, tri: 3, tetra: 4, penta: 5, hexa: 6 };
const HALO = { fluoro: "F", chloro: "Cl", bromo: "Br", iodo: "I" };
const SIMPLE = ["hydroxy", "amino", "nitro", "oxo", "phenyl", "isopropyl", "tert-butyl", "tertbutyl"];
const CATIONS = { lithium: "Li", sodium: "Na", potassium: "K" };
// Benzene with something already on carbon 1.
const RINGS = ["benzene", "phenol", "aniline", "toluene", "benzoicacid", "benzaldehyde"];

const LOCANTS = "((?:\\d+|n)(?:,(?:\\d+|n))*)-";
const readLocants = (text) => text.split(",").map((x) => (x === "n" ? "N" : +x));

// Reads a chemical name. Returns { formula } or { smiles } for a common name, { mols } for a
// systematic one, and null for text that isn't a name at all. A name that is understood but
// describes something impossible throws.
export function parseName(input) {
	let s = input.toLowerCase().trim().replace(/\s+/g, " ").replace(/sulph/g, "sulf");
	if (COMMON[s]) return COMMON[s][0] === "f" ? { formula: COMMON[s].slice(2) } : { smiles: COMMON[s].slice(2) };
	if (!/^[a-z0-9,\- ]+$/.test(s) || !/[a-z]{3}/.test(s)) return null;

	const words = s.split(" ");
	const cation = words.length > 1 ? CATIONS[words[0]] : null;
	if (cation) words.shift();
	s = words.join(" ").replace(/ acid$/, "acid").replace(/oyl chloride$/, "oylchloride");
	let ester = null;
	const split = s.split(" ");
	if (split.length === 2 && /oate$/.test(split[1])) [ester, s] = split;
	else if (split.length > 1) return null;

	const mol = systematic(s, ester, !!cation);
	if (!mol) return null;
	if (!cation) return { mols: [mol] };
	const ion = new Mol();
	ion.addAtom(cation, { charge: 1 });
	return { mols: [ion, mol] };
}

// A substituent prefix at position p: what it is and how many characters it takes.
function substituent(s, p) {
	for (const [name, el] of Object.entries(HALO)) {
		if (s.startsWith(name, p)) return { kind: "halo", el, len: name.length };
	}
	for (const name of SIMPLE) if (s.startsWith(name, p)) return { kind: name, len: name.length };
	for (const [stem, n] of STEMS) {
		if (s.startsWith(stem + "yl", p)) return { kind: "alkyl", n, len: stem.length + 2 };
		if (s.startsWith(stem + "oxy", p)) return { kind: "alkoxy", n, len: stem.length + 3 };
	}
	return null;
}

function attach(mol, host, sub) {
	const carbons = (first, n) => {
		let prev = first;
		for (let k = 0; k < n; k++) {
			const c = mol.addAtom("C");
			mol.addBond(prev, c);
			prev = c;
		}
	};
	const add = (el, order = 1, props = {}) => {
		const atom = mol.addAtom(el, props);
		mol.addBond(host, atom, order);
		return atom;
	};
	switch (sub.kind) {
		case "halo":
			return add(sub.el);
		case "alkyl":
			return carbons(host, sub.n);
		case "alkoxy":
			return carbons(add("O"), sub.n);
		case "hydroxy":
			return add("O");
		case "amino":
			return add("N");
		case "oxo":
			return add("O", 2);
		case "nitro": {
			const n = add("N", 1, { charge: 1, h: 0 });
			mol.addBond(n, mol.addAtom("O"), 2);
			mol.addBond(n, mol.addAtom("O", { charge: -1, h: 0 }));
			return;
		}
		case "phenyl":
			return mol.addBond(host, addBenzene(mol)[0]);
		case "isopropyl": {
			const c = add("C");
			carbons(c, 1);
			return carbons(c, 1);
		}
		default: {
			const c = add("C");
			for (let k = 0; k < 3; k++) carbons(c, 1);
		}
	}
}

// IUPAC substitutive names: prefixes, an optional "cyclo", a chain stem, then -ane/-ene/-yne
// and a functional suffix, each with optional position numbers.
function systematic(s, ester, anion) {
	let p = 0;
	const subs = [];
	let loc = null;
	for (;;) {
		const rest = s.slice(p);
		let m;
		if (rest[0] === "-") {
			p++;
			continue;
		}
		if (loc == null && (m = new RegExp("^" + LOCANTS).exec(rest))) {
			loc = readLocants(m[1]);
			p += m[0].length;
			continue;
		}
		let mult = 1;
		let at = p;
		if ((m = /^(di|tri|tetra|penta|hexa)/.exec(rest)) && substituent(s, p + m[0].length)) {
			mult = MULTIPLIERS[m[1]];
			at += m[0].length;
		}
		const sub = substituent(s, at);
		if (!sub) break;
		subs.push({ ...sub, mult, loc });
		loc = null;
		p = at + sub.len;
	}
	let early = loc;

	const mol = new Mol();
	const c = [null];
	const bonds = [];
	let n;
	let cyclo = false;
	let ring = null;
	const features = [];

	if (RINGS.includes(s.slice(p))) {
		ring = s.slice(p);
		n = 6;
		cyclo = true;
		c.push(...addBenzene(mol));
		mol.bonds.forEach((bond, k) => (bonds[k + 1] = bond));
	} else {
		if (s.startsWith("cyclo", p)) {
			cyclo = true;
			p += 5;
		}
		const stem = STEMS.find(([text]) => s.startsWith(text, p));
		if (!stem) return null;
		p += stem[0].length;
		n = stem[1];
		if (p === s.length || (cyclo && n < 3)) return null;

		let floc = null;
		let fmult = 1;
		while (p < s.length) {
			const rest = s.slice(p);
			let m;
			if ((m = new RegExp("^-?" + LOCANTS).exec(rest))) {
				floc = readLocants(m[1]);
				p += m[0].length;
			} else if (rest[0] === "-") {
				p++;
			} else if ((m = /^(di|tri|tetra)(?=en|yn|ol|al|one|oic|oate|amin|amid|thiol|nitrile)/.exec(rest))) {
				fmult = MULTIPLIERS[m[1]];
				p += m[0].length;
			} else if ((m = /^(oylchloride|nitrile|amine|amide|thiol|oicacid|oate|one|ol|al|ane|an|ene|en|yne|yn|e|a)/.exec(rest))) {
				p += m[0].length;
				const kind = { en: "ene", yn: "yne", ane: null, an: null, e: null, a: null }[m[1]];
				if (kind !== null) features.push({ kind: kind || m[1], loc: floc, mult: fmult });
				floc = null;
				fmult = 1;
			} else {
				return null;
			}
		}
		for (let k = 1; k <= n; k++) c.push(mol.addAtom("C"));
		for (let k = 1; k < n; k++) bonds[k] = mol.addBond(c[k], c[k + 1]);
		if (cyclo) bonds[n] = mol.addBond(c[n], c[1]);
	}
	if ((ester || anion) && !features.some((f) => f.kind === "oate")) return null;

	const carbon = (k) => {
		if (!Number.isInteger(k) || k < 1 || k > n) {
			throw new Error(`There's no carbon ${k} in a ${n}-carbon ${cyclo ? "ring" : "chain"}.`);
		}
		return c[k];
	};
	// A feature's positions: its own, else numbers written ahead of the stem ("2-butanol"),
	// else the only place it could sensibly be.
	const positions = (f, fallback) => {
		let at = f.loc;
		if (!at && early) {
			at = early;
			early = null;
		}
		at ||= fallback(f.mult);
		if (!at || at.length !== f.mult) {
			throw new Error("That name needs position numbers (like the 2 in butan-2-ol).");
		}
		return at;
	};
	const add = (host, el, order = 1, props = {}) => {
		const atom = mol.addAtom(el, props);
		mol.addBond(host, atom, order);
		return atom;
	};

	let nitrogen = null;
	for (const f of features) {
		if (f.kind === "ene" || f.kind === "yne") {
			const at = positions(f, (m) => (m === 1 ? [1] : m === 2 && f.kind === "ene" && n >= 4 ? [1, 3] : null));
			for (const k of at) {
				carbon(k);
				if (!bonds[k]) throw new Error(`Carbon ${k} is the end of the chain, so a multiple bond can't start there.`);
				bonds[k].order = f.kind === "ene" ? 2 : 3;
			}
		} else if (f.kind === "ol" || f.kind === "thiol" || f.kind === "amine") {
			const el = { ol: "O", thiol: "S", amine: "N" }[f.kind];
			const at = positions(f, (m) => (m === 1 ? [1] : m === n ? c.slice(1).map((_, k) => k + 1) : null));
			for (const k of at) {
				const atom = add(carbon(k), el);
				if (el === "N") nitrogen ??= atom;
			}
		} else if (f.kind === "one") {
			const at = positions(f, (m) => (m === 1 ? [cyclo || n < 3 ? 1 : 2] : null));
			for (const k of at) add(carbon(k), "O", 2);
		} else {
			if (cyclo || f.mult > 2) return null;
			for (const k of f.mult === 2 ? [1, n] : [1]) {
				const host = c[k];
				if (f.kind === "nitrile") {
					add(host, "N", 3);
					continue;
				}
				add(host, "O", 2);
				if (f.kind === "oicacid") add(host, "O");
				else if (f.kind === "amide") nitrogen ??= add(host, "N");
				else if (f.kind === "oylchloride") add(host, "Cl");
				else if (f.kind === "oate") {
					const oxygen = add(host, "O", 1, ester ? {} : { charge: -1, h: 0 });
					if (ester) {
						const group = substituent(ester, 0);
						if (!group || group.len !== ester.length || group.kind === "halo") return null;
						attach(mol, oxygen, group);
					}
				}
			}
		}
	}

	if (ring === "phenol") add(c[1], "O");
	else if (ring === "aniline") nitrogen = add(c[1], "N");
	else if (ring === "toluene") add(c[1], "C");
	else if (ring === "benzaldehyde") add(add(c[1], "C"), "O", 2);
	else if (ring === "benzoicacid") {
		const acid = add(c[1], "C");
		add(acid, "O", 2);
		add(acid, "O");
	}

	for (const sub of subs) {
		let at = sub.loc;
		if (!at && sub.mult === 1 && (!ring || ring === "benzene")) {
			// An alkyl group on carbon 1 would just lengthen the chain, so unnumbered it's on 2.
			at = [sub.kind === "alkyl" && !cyclo && n >= 3 ? 2 : 1];
		} else if (!at && !ring && n <= 3 && sub.kind === "alkyl") {
			at = Array(sub.mult).fill(n === 3 ? 2 : 1);
		} else if (!at && !ring && n === 1) {
			at = Array(sub.mult).fill(1);
		} else if (!at && !ring && n === 2 && sub.mult === 6) {
			at = [1, 1, 1, 2, 2, 2];
		}
		if (!at || at.length !== sub.mult) {
			throw new Error("That name needs position numbers for its side groups (like 2,2-dimethyl).");
		}
		for (const k of at) {
			if (k === "N" && nitrogen == null) throw new Error("“N-” needs an amine or amide to attach to.");
			attach(mol, k === "N" ? nitrogen : carbon(k), sub);
		}
	}

	mol.atoms.forEach((atom, i) => {
		const options = VALENCES[atom.el] || [8];
		const most = (ELEMENTS[atom.el][4] > 2 ? options.at(-1) : options[0]) + Math.max(0, atom.charge);
		if (mol.orderSum(i) > most) {
			throw new Error(`That name gives a ${atom.el} atom too many bonds — check the position numbers.`);
		}
	});
	fillHydrogens(mol);
	setNonbonding(mol);
	return mol;
}
