import { ELEMENTS, HALOGENS } from "./elements.js";
import { longestChain } from "./layout.js";

// Text for a diagram is a list of pieces: { t } on the line, or { t, kind: "sub" | "sup" }.

export function chargeText(q) {
	return (Math.abs(q) > 1 ? Math.abs(q) : "") + (q > 0 ? "+" : "−");
}

// A plain formula for species a condensed formula doesn't suit (rings, and molecules with no
// carbon chain). With carbon it's C, H, then the rest; without, least electronegative first,
// with hydrogen leading where it's written that way (H2O, H2SO4) and trailing where it isn't
// (NH3, OH⁻).
export function formulaPieces(mol, showCharge = true, organic = false) {
	const counts = new Map();
	for (const atom of mol.atoms) counts.set(atom.el, (counts.get(atom.el) || 0) + 1);
	const heavy = [...counts.keys()].filter((el) => el !== "H");
	let order;
	if (organic) {
		order = ["C", "H", ...heavy.filter((el) => el !== "C").sort()];
	} else {
		order = heavy.sort((p, q) => ELEMENTS[p][3] - ELEMENTS[q][3]);
		if (counts.has("H")) {
			const hydride = heavy.length === 1 && (ELEMENTS[heavy[0]][2] <= 5 || (counts.get("H") === 1 && mol.charge < 0));
			hydride ? order.push("H") : order.unshift("H");
		}
	}
	const out = [];
	for (const el of order) {
		out.push({ t: el });
		if (counts.get(el) > 1) out.push({ t: String(counts.get(el)), kind: "sub" });
	}
	if (showCharge && mol.charge) out.push({ t: chargeText(mol.charge), kind: "sup" });
	return out;
}

// A condensed structural formula such as CH3CH(OH)CH3: the main chain written left to right,
// each atom followed by its hydrogens and then, in brackets, whatever branches off it.
export function condensedPieces(mol, showCharge = true) {
	const atoms = mol.atoms;
	const keep = mol.skeleton();
	// Carbon bonded to hydrogen or carbon — or to nitrogen, in something with hydrogens (urea).
	const hydrogens = atoms.some((a) => a.el === "H");
	const organic = atoms.some(
		(a, i) =>
			a.el === "C" &&
			mol.adj[i].some((e) => ["H", "C"].includes(atoms[e.to].el) || (hydrogens && atoms[e.to].el === "N")),
	);
	// Formal charges that cancel out (the N⁺ and O⁻ of a nitro group) aren't written in a formula.
	showCharge &&= mol.charge !== 0;
	if (mol.cyclic || !organic) {
		return { pieces: formulaPieces(mol, showCharge, organic), fallback: mol.cyclic && organic };
	}

	const link = (a, b) => {
		const { bond } = mol.adj[a].find((e) => e.to === b);
		const els = [atoms[a].el, atoms[b].el];
		if (bond.order === 3 && els.every((el) => el === "C")) return [{ t: "≡" }];
		if (bond.order === 2 && !els.includes("O") && !els.includes("S")) return [{ t: "=" }];
		return [];
	};
	const depth = (i, from) =>
		1 + Math.max(0, ...mol.adj[i].filter((e) => e.to !== from && keep[e.to]).map((e) => depth(e.to, i)));

	const atomPieces = (i, from, next, first) => {
		const atom = atoms[i];
		const others = mol.adj[i].filter((e) => e.to !== from && e.to !== next);
		const h = others.filter((e) => !keep[e.to]).length;
		const hydrogens = h ? [{ t: "H" }, ...(h > 1 ? [{ t: String(h), kind: "sub" }] : [])] : [];
		// A chain that starts on something other than carbon, on a triple bond, or on a carbon
		// with nothing but one hydrogen behind it, reads better hydrogen-first: HOCH2…, HC≡CH,
		// HCOOH.
		const lone =
			h === 1 &&
			!mol.adj[i].some((e) => atoms[e.to].el === "C") &&
			mol.adj[i].some((e) => e.bond.order === 2 && atoms[e.to].el === "O");
		const lead = first && (atom.el !== "C" || lone || mol.adj[i].some((e) => e.bond.order === 3));
		const out = lead ? [...hydrogens, { t: atom.el }] : [{ t: atom.el }, ...hydrogens];
		if (showCharge && atom.charge) out.push({ t: chargeText(atom.charge), kind: "sup" });

		const groups = new Map();
		for (const e of others) {
			if (!keep[e.to]) continue;
			const el = atoms[e.to].el;
			// Written straight after the atom, with no brackets: halogens and C=O oxygens.
			const oxo = (el === "O" || el === "S") && (e.bond.order === 2 || !showCharge);
			const simple = mol.degree(e.to) === 1 && (showCharge ? !atoms[e.to].charge : true) && (HALOGENS.has(el) || oxo);
			const pieces = branch(e.to, i);
			const id = JSON.stringify(pieces);
			if (!groups.has(id)) groups.set(id, { pieces, simple, oxo: simple && !HALOGENS.has(el), n: 0 });
			groups.get(id).n++;
		}
		const sorted = [...groups.values()].sort((p, q) => q.oxo - p.oxo || q.simple - p.simple);
		for (const g of sorted) {
			out.push(...(g.simple ? g.pieces : [{ t: "(" }, ...g.pieces, { t: ")" }]));
			if (g.n > 1) out.push({ t: String(g.n), kind: "sub" });
		}
		return out;
	};
	const branch = (i, from) => {
		const onward = mol.adj[i].filter((e) => e.to !== from && keep[e.to]).map((e) => e.to);
		if (!onward.length) return atomPieces(i, from, -1, false);
		const main = onward.reduce((p, q) => (depth(q, i) > depth(p, i) ? q : p));
		return [...atomPieces(i, from, main, false), ...link(i, main), ...branch(main, i)];
	};

	// Halogens are written after the carbon they're on (CH2ClCH2Cl), never as ends of the chain.
	const chain = longestChain(
		mol,
		keep.map((k, i) => k && !(HALOGENS.has(atoms[i].el) && mol.degree(i) === 1 && atoms[mol.adj[i][0].to].el === "C")),
	);
	// A chain that would start on a C=O oxygen starts on the carbon instead: HCOOH, not OCHOH.
	const oxo = (i) => atoms[i].el !== "C" && mol.degree(i) === 1 && mol.adj[i][0].bond.order === 2;
	if (chain.length > 2 && oxo(chain.at(-1)) && !oxo(chain[0]) && atoms[chain[0]].el !== "C") chain.reverse();
	if (chain.length > 2 && oxo(chain[0])) chain.shift();
	// And one that would end on a bare atom hanging off nitrogen or sulfur leaves it to be
	// counted with its twins: CH3NO2, not CH3NOO.
	const last = chain.at(-1);
	if (chain.length > 2 && atoms[last].el !== "C" && mol.degree(last) === 1 && atoms[chain.at(-2)].el !== "C") chain.pop();
	// Likewise a C=O oxygen at the end, so that it's written before a halogen: CH3COCl.
	else if (chain.length > 1 && oxo(last)) chain.pop();
	const pieces = [];
	chain.forEach((a, k) => {
		pieces.push(...atomPieces(a, chain[k - 1] ?? -1, chain[k + 1] ?? -1, k === 0));
		if (k + 1 < chain.length) pieces.push(...link(a, chain[k + 1]));
	});
	return { pieces, fallback: false };
}
