import { VALENCES, requireElement } from "./elements.js";
import { Mol, fillHydrogens } from "./mol.js";
import { setNonbonding } from "./electrons.js";

const ORGANIC = /^(Cl|Br|B|C|N|O|P|S|F|I|b|c|n|o|p|s)/;
const BRACKET = /^\[\d*([A-Z][a-z]?|[bcnops])(?:@{1,2})?(?:H(\d*))?(?:(\+{1,3}|-{1,3})(\d*))?(?::\d+)?\]/;
const ORDER = { "=": 2, "#": 3 };

// Bonds a ring atom has to spare for the ring's double bonds, before its charge is counted.
const AROMATIC = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2 };

// Reads a SMILES string. Stereo marks (@, /, \) are accepted and ignored: the diagrams are flat.
export function parseSmiles(input) {
	const s = input.trim();
	const mol = new Mol();
	const branches = [];
	const open = new Map();
	let prev = -1;
	let pending = null;
	let i = 0;

	const link = (a, b, symbol) => {
		if (a === b || mol.adj[a].some((e) => e.to === b)) {
			throw new Error("That SMILES bonds the same two atoms twice.");
		}
		const arom = symbol === ":" || (symbol == null && mol.atoms[a].arom && mol.atoms[b].arom);
		mol.addBond(a, b, ORDER[symbol] || 1, arom ? { arom: true } : {});
	};
	const atom = (symbol, props) => {
		const arom = symbol !== symbol.toUpperCase() && symbol.length === 1;
		const el = arom ? symbol.toUpperCase() : symbol;
		requireElement(el);
		const a = mol.addAtom(el, arom ? { ...props, arom } : props);
		if (prev >= 0) link(prev, a, pending);
		prev = a;
		pending = null;
	};

	while (i < s.length) {
		const c = s[i];
		if (c === "(") {
			if (prev < 0) throw new Error("A SMILES branch needs an atom before it.");
			branches.push(prev);
			i++;
		} else if (c === ")") {
			if (!branches.length) throw new Error("There's a “)” without a “(” in that SMILES.");
			prev = branches.pop();
			i++;
		} else if ("-=#:/\\".includes(c)) {
			pending = c;
			i++;
		} else if (c === ".") {
			prev = -1;
			pending = null;
			i++;
		} else if (c === "%" || (c >= "0" && c <= "9")) {
			let id = c;
			if (c === "%") {
				id = s.slice(i + 1, i + 3);
				if (!/^\d\d$/.test(id)) throw new Error("“%” in SMILES needs two digits after it.");
				i += 2;
			}
			i++;
			if (prev < 0) throw new Error("A ring number in SMILES needs an atom before it.");
			if (open.has(id)) {
				const start = open.get(id);
				open.delete(id);
				link(start.atom, prev, pending ?? start.symbol);
			} else {
				open.set(id, { atom: prev, symbol: pending });
			}
			pending = null;
		} else if (c === "[") {
			const m = BRACKET.exec(s.slice(i));
			if (!m) throw new Error("Couldn't read the “[…]” atom in that SMILES.");
			const size = m[4] ? +m[4] : m[3] ? m[3].length : 0;
			atom(m[1], {
				h: m[2] == null ? 0 : m[2] === "" ? 1 : +m[2],
				charge: m[3] && m[3][0] === "-" ? -size : size,
			});
			i += m[0].length;
		} else {
			const m = ORGANIC.exec(s.slice(i));
			if (!m) throw new Error(`“${c}” doesn't belong in a SMILES string.`);
			atom(m[1], {});
			i += m[0].length;
		}
	}
	if (open.size) throw new Error("A ring in that SMILES is never closed.");
	if (branches.length) throw new Error("There's a “(” without a “)” in that SMILES.");
	if (!mol.atoms.length) throw new Error("That SMILES has no atoms.");

	mol.atoms.forEach((a, k) => {
		if (a.arom && mol.adj[k].filter((e) => e.bond.arom).length < 2) {
			throw new Error("Lowercase atoms in SMILES have to be part of an aromatic ring.");
		}
		if (a.h != null) return;
		const used = mol.orderSum(k);
		const options = VALENCES[a.el] || [0];
		if (a.arom) a.h = Math.max(0, options[0] - used - 1);
		else a.h = (options.find((v) => v >= used) ?? used) - used;
	});
	kekulise(mol);
	fillHydrogens(mol);
	setNonbonding(mol);
	return mol;
}

// Turns an aromatic ring's bonds into alternating single and double ones: each atom with a bond
// to spare is paired with a neighbour that also has one.
function kekulise(mol) {
	const wants = mol.atoms.map((a, i) => {
		if (!a.arom) return false;
		const base = AROMATIC[a.el] ?? 0;
		const valence =
			a.el === "C" ? base - Math.abs(a.charge) : a.el === "B" ? base - a.charge : base + a.charge;
		return valence - mol.orderSum(i) - a.h >= 1;
	});
	const todo = wants.flatMap((w, i) => (w ? [i] : []));
	const mate = new Map();
	const pair = (k) => {
		while (k < todo.length && mate.has(todo[k])) k++;
		if (k === todo.length) return true;
		const a = todo[k];
		for (const { to, bond } of mol.adj[a]) {
			if (!bond.arom || !wants[to] || mate.has(to)) continue;
			mate.set(a, bond);
			mate.set(to, bond);
			if (pair(k + 1)) return true;
			mate.delete(a);
			mate.delete(to);
		}
		return false;
	};
	if (!pair(0)) throw new Error("Couldn't place the double bonds in that aromatic ring.");
	for (const bond of new Set(mate.values())) bond.order = 2;
	mol._adj = null;
}
