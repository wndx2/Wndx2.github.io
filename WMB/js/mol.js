import { ELEMENTS, VALENCES } from "./elements.js";

// A molecule as a graph. Every hydrogen is an atom of its own, since Lewis and structural
// diagrams draw them all; skeletal diagrams fold them back into the labels.
export class Mol {
	constructor() {
		this.atoms = [];
		this.bonds = [];
		this._adj = null;
	}

	addAtom(el, props = {}) {
		this._adj = null;
		this.atoms.push({ el, charge: 0, lp: 0, rad: 0, ...props });
		return this.atoms.length - 1;
	}

	addBond(a, b, order = 1, props = {}) {
		this._adj = null;
		const bond = { a, b, order, ...props };
		this.bonds.push(bond);
		return bond;
	}

	// For each atom, its bonds as { to, bond }.
	get adj() {
		if (!this._adj) {
			this._adj = this.atoms.map(() => []);
			for (const bond of this.bonds) {
				this._adj[bond.a].push({ to: bond.b, bond });
				this._adj[bond.b].push({ to: bond.a, bond });
			}
		}
		return this._adj;
	}

	degree(i) {
		return this.adj[i].length;
	}

	orderSum(i) {
		let sum = 0;
		for (const { bond } of this.adj[i]) sum += bond.order;
		return sum;
	}

	// The atoms a diagram is laid out around: everything except hydrogens hanging off another
	// element.
	skeleton() {
		return this.atoms.map(
			(a, i) =>
				a.el !== "H" || this.adj[i].length !== 1 || this.atoms[this.adj[i][0].to].el === "H",
		);
	}

	get cyclic() {
		return this.bonds.length >= this.atoms.length;
	}

	get charge() {
		return this.atoms.reduce((sum, a) => sum + a.charge, 0);
	}

	clone() {
		const copy = new Mol();
		copy.atoms = this.atoms.map((a) => ({ ...a }));
		copy.bonds = this.bonds.map((b) => ({ ...b }));
		return copy;
	}

	// The connected pieces, each as a molecule of its own.
	fragments() {
		const piece = new Array(this.atoms.length).fill(-1);
		const out = [];
		for (let start = 0; start < this.atoms.length; start++) {
			if (piece[start] >= 0) continue;
			const mol = new Mol();
			const index = new Map();
			const queue = [start];
			piece[start] = out.length;
			for (let head = 0; head < queue.length; head++) {
				const i = queue[head];
				index.set(i, mol.addAtom(this.atoms[i].el, { ...this.atoms[i] }));
				for (const { to } of this.adj[i]) {
					if (piece[to] < 0) {
						piece[to] = out.length;
						queue.push(to);
					}
				}
			}
			for (const bond of this.bonds) {
				if (index.has(bond.a)) mol.bonds.push({ ...bond, a: index.get(bond.a), b: index.get(bond.b) });
			}
			out.push(mol);
		}
		return out;
	}
}

// Adds the hydrogens that were left unwritten: an atom's own count (`h`) if it has one,
// otherwise enough to reach its usual number of bonds.
export function fillHydrogens(mol) {
	const count = mol.atoms.length;
	for (let i = 0; i < count; i++) {
		const atom = mol.atoms[i];
		let h = atom.h;
		if (h == null) {
			const used = mol.orderSum(i);
			const valence = (VALENCES[atom.el] || [ELEMENTS[atom.el][5]]).find((v) => v >= used);
			h = valence == null ? 0 : valence - used;
		}
		delete atom.h;
		for (let k = 0; k < h; k++) mol.addBond(i, mol.addAtom("H"));
	}
}

// A benzene ring drawn with alternating double bonds, which stay put when electrons are solved.
export function addBenzene(mol) {
	const ring = [];
	for (let i = 0; i < 6; i++) ring.push(mol.addAtom("C"));
	for (let i = 0; i < 6; i++) mol.addBond(ring[i], ring[(i + 1) % 6], i % 2 ? 1 : 2, { fixed: true });
	return ring;
}

// Element counts over a list of { mol, count }, in Hill order: C, H, then alphabetical.
export function composition(parts) {
	const counts = new Map();
	let mass = 0;
	let charge = 0;
	for (const { mol, count } of parts) {
		charge += mol.charge * count;
		for (const atom of mol.atoms) {
			counts.set(atom.el, (counts.get(atom.el) || 0) + count);
			mass += ELEMENTS[atom.el][1] * count;
		}
	}
	const hasCarbon = counts.has("C");
	const rank = (el) => (hasCarbon && el === "C" ? "0" : hasCarbon && el === "H" ? "1" : "2" + el);
	const formula = [...counts].sort((p, q) => (rank(p[0]) < rank(q[0]) ? -1 : 1));
	return { formula, mass, charge };
}
