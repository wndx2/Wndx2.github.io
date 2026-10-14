import { ELEMENTS } from "./elements.js";

// Lone pairs and unpaired electrons for a molecule whose bonds and charges are already known
// (SMILES and names say both): whatever valence electrons the bonds and the charge leave over.
export function setNonbonding(mol) {
	mol.atoms.forEach((atom, i) => {
		const left = ELEMENTS[atom.el][2] - atom.charge - mol.orderSum(i);
		if (left < 0) throw new Error(`${atom.el} has more bonds than it has electrons for.`);
		atom.lp = left >> 1;
		atom.rad = left & 1;
	});
}

// Works out a Lewis structure for a skeleton of single bonds: which bonds are double or triple,
// where the lone pairs sit, and each atom's formal charge.
//
// Every way of raising the bond orders is tried. For each, the electrons left over fill octets,
// most electronegative atoms first, and anything still left goes on an atom that can hold more
// than eight. The arrangement kept is the one with full octets and the least formal charge, with
// negative charge on the more electronegative atoms. With `expanded`, atoms from period 3 down
// may take extra bonds to shed formal charge (sulfate with two S=O); without it they keep to an
// octet wherever the number of atoms around them allows.
export function solveLewis(mol, charge = 0, { expanded = false } = {}) {
	const n = mol.atoms.length;
	const E = mol.atoms.map((a) => ELEMENTS[a.el]);
	let electrons = -charge;
	for (const e of E) electrons += e[2];

	const deg = mol.atoms.map((_, i) => mol.degree(i));
	const bo = mol.atoms.map((_, i) => mol.orderSum(i));
	const full = (i) => (E[i][4] === 1 ? 2 : 8);
	const cap = E.map((e, i) =>
		e[4] === 1 ? 1 : e[4] === 2 ? 4 : Math.max(deg[i], expanded ? Math.max(4, e[2]) : 4),
	);
	for (let i = 0; i < n; i++) {
		if (E[i][4] <= 2 && bo[i] > cap[i]) throw new Error(`${mol.atoms[i].el} can't make ${bo[i]} bonds.`);
	}
	let total = bo.reduce((sum, x) => sum + x, 0) / 2;
	if (electrons < 2 * total) throw new Error("There aren't enough electrons for those bonds.");

	// Bonds that might be multiple: not to hydrogen or fluorine, and not ones already decided.
	let free = mol.bonds.filter(
		(b) => !b.fixed && [b.a, b.b].every((i) => E[i][4] > 1 && mol.atoms[i].el !== "F"),
	);
	if (free.length > 8) {
		// Too many to try them all: keep the bonds whose two atoms both have bonds to spare.
		const spare = (i) => (E[i][4] > 2 && expanded ? cap[i] : E[i][5]) - bo[i];
		free = free.filter((b) => spare(b.a) > 0 && spare(b.b) > 0);
	}
	if (free.length > 14) {
		throw new Error("That's too big to work out from a formula — try its name or a SMILES string.");
	}

	const fillOrder = [...E.keys()].sort((p, q) => E[q][3] - E[p][3] || deg[p] - deg[q]);
	const roomy = [...E.keys()]
		.filter((i) => E[i][4] > 2)
		.sort((p, q) => deg[q] - deg[p] || E[p][3] - E[q][3])[0];

	let best = null;
	// Arrangements that score the same as the best one: its resonance forms.
	let ties = [];
	const evaluate = () => {
		let left = electrons - 2 * total;
		if (left < 0) return;
		const nb = new Array(n).fill(0);
		for (const i of fillOrder) {
			const give = Math.max(0, Math.min(full(i) - 2 * bo[i], left));
			nb[i] = give;
			left -= give;
		}
		if (left > 0) {
			if (roomy == null) return;
			nb[roomy] += left;
		}
		let score = 0;
		let clean = true;
		let formal = 0;
		for (let i = 0; i < n; i++) {
			const have = 2 * bo[i] + nb[i];
			const short = Math.max(0, full(i) - have) / 2;
			const extra = Math.max(0, have - full(i)) / 2;
			const fc = E[i][2] - nb[i] - bo[i];
			// Boron, beryllium and the metals are happy short of an octet; nothing else is.
			if (short) {
				score += short * (E[i][2] <= 3 ? 1.5 : 100);
				if (E[i][2] > 3 && short >= 1) clean = false;
			}
			score += extra * (expanded ? 0.01 : 10);
			score += Math.abs(fc) + 0.25 * Math.max(0, Math.abs(fc) - 1) + 0.1 * fc * E[i][3];
			formal += Math.abs(fc);
		}
		const tidy = clean && formal <= Math.abs(charge);
		const found = { score, clean: tidy, complete: clean, orders: free.map((b) => b.order), nb };
		if (!best || score < best.score - 1e-7) {
			best = found;
			ties = [found];
		} else if (score < best.score + 1e-7 && ties.length < 6) {
			ties.push(found);
		}
	};

	const search = (k) => {
		if (k === free.length) return evaluate();
		const bond = free[k];
		for (let order = 1; order <= 3; order++) {
			const up = order - 1;
			if (bo[bond.a] + up > cap[bond.a] || bo[bond.b] + up > cap[bond.b]) break;
			if (2 * (total + up) > electrons) break;
			bo[bond.a] += up;
			bo[bond.b] += up;
			total += up;
			bond.order = order;
			search(k + 1);
			bo[bond.a] -= up;
			bo[bond.b] -= up;
			total -= up;
		}
		bond.order = 1;
	};
	search(0);
	if (!best) throw new Error("Couldn't find a way to arrange the electrons.");

	const apply = (target, form) => {
		const bonds = free.map((bond) => target.bonds[mol.bonds.indexOf(bond)]);
		bonds.forEach((bond, k) => (bond.order = form.orders[k]));
		target._adj = null;
		target.atoms.forEach((atom, i) => {
			atom.lp = form.nb[i] >> 1;
			atom.rad = form.nb[i] & 1;
			atom.charge = E[i][2] - form.nb[i] - target.orderSum(i);
		});
		return target;
	};
	apply(mol, best);
	// `complete`: every atom has its octet. `clean`: and there's no formal charge to spare.
	// `resonance()` builds the other, equally good arrangements as molecules of their own.
	return {
		score: best.score,
		clean: best.clean,
		complete: best.complete,
		resonance: () => ties.slice(1).map((form) => apply(mol.clone(), form)),
	};
}
