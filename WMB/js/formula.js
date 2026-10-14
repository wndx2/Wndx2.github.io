import { ELEMENTS, SYMBOLS, HALOGENS, ION_CHARGE, requireElement } from "./elements.js";
import { Mol, addBenzene } from "./mol.js";
import { solveLewis } from "./electrons.js";

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻";
const METALS = { Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1, Mg: 2, Ca: 2, Sr: 2, Ba: 2, Al: 3 };

const isMono = (el) => el === "H" || HALOGENS.has(el);
const isEl = (item, el, n) => !!item && item.el === el && item.n === n;
const isHeavy = (item) => !!item && (item.phenyl || (item.el && !isMono(item.el)));

// Reads a chemical formula, either a molecular one (H2SO4, C3H8, SO4 2-, Ca(OH)2) or a
// condensed structural one (CH3CH(OH)CH3), and returns the species in it as { mol, count }.
export function parseFormula(input, opts = {}) {
	const { body, charge } = splitCharge(normalise(input));
	if (!body) throw new Error("Type a formula.");
	const items = tokenise(rewrite(body));
	const notes = [];
	const parts = splitIons(items, charge, opts, notes) || [
		{ mol: covalent(items, charge, opts, notes), count: 1 },
	];
	return { parts, notes };
}

// Capitalises a formula typed all in lowercase: "nacl" is NaCl, "co2" is CO2. Two letters make
// one symbol only when the second can't stand as an element by itself.
export function fixCase(text) {
	const s = text.toUpperCase();
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const pair = s[i] + (s[i + 1] || "").toLowerCase();
		const joins =
			/[A-Z]/.test(s[i]) &&
			/[A-Z]/.test(s[i + 1] || "") &&
			SYMBOLS.has(pair) &&
			(!SYMBOLS.has(s[i + 1]) || !SYMBOLS.has(s[i]) || pair === "Si");
		out += joins ? pair : s[i];
		if (joins) i++;
	}
	return out;
}

function normalise(text) {
	return text
		.trim()
		.replace(/[₀-₉]/g, (c) => SUBSCRIPTS.indexOf(c))
		.replace(/[⁰¹²³⁴-⁹⁺⁻]+/g, (run) =>
			"^" + [...run].map((c) => "0123456789+-"[SUPERSCRIPTS.indexOf(c)]).join(""),
		)
		.replace(/[−–—]/g, "-")
		.replace(/≡/g, "#")
		.replace(/\s+/g, " ");
}

// Splits a trailing charge off a formula. "SO4 2-" and "SO4^2-" are unambiguous; in "SO42-" the
// last digit is the charge; in "NH4+" the digit is a count, unless it's a lone atom whose usual
// ion it makes (O2- is oxide).
function splitCharge(s) {
	let m;
	if ((m = /^(.*?)\s*\^\s*\(?(\d*)([+-])(\d*)\)?$/.exec(s)) || (m = /^(.*\S) (\d*)([+-])()$/.exec(s))) {
		return { body: m[1].trim(), charge: (m[3] === "+" ? 1 : -1) * +(m[2] || m[4] || 1) };
	}
	if (!(m = /^(.*?)([+-]+)$/.exec(s)) || !m[1]) return { body: s, charge: 0 };
	const sign = m[2][0] === "+" ? 1 : -1;
	const digits = /^(.*?)(\d+)$/.exec(m[1]);
	if (digits && m[2].length === 1) {
		const [, head, run] = digits;
		if (/^[A-Z][a-z]?$/.test(head) && run.length === 1 && ION_CHARGE[head] === sign * +run) {
			return { body: head, charge: sign * +run };
		}
		if (run.length > 1) return { body: head + run.slice(0, -1), charge: sign * +run.slice(-1) };
	}
	return { body: m[1].trim(), charge: sign * m[2].length };
}

// Spellings whose atoms aren't in bonding order: a carboxyl group written backwards, and CO2
// standing for COO.
function rewrite(body) {
	return body
		.replace(/HOOC|HO2C/g, "C(O)(OH)")
		.replace(/CO2H/g, "COOH")
		.replace(/CO2(?=[A-Z(])/g, "COO");
}

// A formula as a list of { el, n }, { group, n } and { bond } items.
function tokenise(s) {
	let i = 0;
	const count = () => {
		const m = /^\d+/.exec(s.slice(i));
		if (!m) return 1;
		i += m[0].length;
		if (+m[0] < 2) throw new Error("A formula doesn't write counts of 1 or 0.");
		return +m[0];
	};
	const sequence = (close) => {
		const items = [];
		while (i < s.length) {
			const c = s[i];
			if (c === " ") {
				i++;
			} else if (c === "(" || c === "[") {
				i++;
				const group = sequence(c === "(" ? ")" : "]");
				if (!group.length) throw new Error("There's an empty pair of brackets.");
				items.push({ group, n: count() });
			} else if (c === ")" || c === "]") {
				if (c !== close) throw new Error("The brackets in that formula don't match up.");
				i++;
				return items;
			} else if (c === "=" || c === "#" || c === "-") {
				i++;
				items.push({ bond: true });
			} else {
				const m = /^[A-Z][a-z]?/.exec(s.slice(i));
				if (!m) throw new Error(`“${c}” doesn't belong in a formula.`);
				let el = m[0];
				if (!SYMBOLS.has(el)) el = el[0];
				requireElement(el);
				i += el.length;
				items.push({ el, n: count() });
			}
		}
		if (close) throw new Error("A bracket in that formula is never closed.");
		return items;
	};
	return sequence(null);
}

// Ionic compounds: metal atoms and ammonium come off as cations, and whatever is left carries
// the opposite charge as one or more anions.
function splitIons(items, charge, opts, notes) {
	const elements = new Set();
	(function walk(list) {
		for (const it of list) it.group ? walk(it.group) : it.el && elements.add(it.el);
	})(items);
	const covalentAl = [...elements].every((el) => el === "Al" || el === "H" || (HALOGENS.has(el) && el !== "F"));

	let list = items;
	const cations = [];
	if (list.length > 2 && isEl(list[0], "N", 1) && isEl(list[1], "H", 4)) {
		cations.push({ ammonium: true, n: 1, q: 1 });
		list = list.slice(2);
	}
	const rest = [];
	for (const it of list) {
		if (it.el && METALS[it.el] && !(it.el === "Al" && covalentAl)) {
			cations.push({ el: it.el, n: it.n, q: METALS[it.el] });
		} else if (it.group && it.group.length === 2 && isEl(it.group[0], "N", 1) && isEl(it.group[1], "H", 4) && list.length > 1) {
			cations.push({ ammonium: true, n: it.n, q: 1 });
		} else {
			rest.push(it);
		}
	}
	if (!cations.length || !rest.length) return null;

	const total = cations.reduce((sum, c) => sum + c.n * c.q, 0) - charge;
	let anion = { items: rest, n: 1 };
	const only = rest.length === 1 ? rest[0] : null;
	if (only?.group) anion = { items: only.group, n: only.n };
	else if (only?.el && ION_CHARGE[only.el] < 0 && -ION_CHARGE[only.el] * only.n === total) {
		anion = { items: [{ el: only.el, n: 1 }], n: only.n };
	}
	if (total <= 0 || total % anion.n) throw new Error("The charges in that formula don't balance.");

	const parts = cations.map((c) => ({
		mol: covalent(c.ammonium ? [{ el: "N", n: 1 }, { el: "H", n: 4 }] : [{ el: c.el, n: 1 }], c.q, opts, notes),
		count: c.n,
	}));
	parts.push({ mol: covalent(anion.items, -total / anion.n, opts, notes), count: anion.n });
	return parts;
}

// A formula with every element written once is a plain count of atoms; one that repeats an
// element, or brackets a group, spells out which atom is bonded to which.
function covalent(items, charge, opts, notes) {
	const flat = [];
	let structural = false;
	(function walk(list) {
		for (const it of list) {
			if (it.bond) structural = true;
			else if (it.group) {
				structural = true;
				walk(it.group);
			} else flat.push([it.el, it.n]);
		}
	})(items);
	// Keeps the result's resonance forms with it, the one that was chosen first.
	const done = (result) => {
		const others = result.resonance();
		if (others.length) result.mol.forms = [result.mol, ...others];
		return result.mol;
	};
	const elements = new Set(flat.map(([el]) => el));
	if (structural || elements.size < flat.length) return done(condensed(items, charge, opts, notes));
	const counted = molecular(new Map(flat), charge, opts, notes);
	if (counted.clean) return done(counted);
	// Some formulas with each element written once are still in bonding order (CH3NO2), so see
	// whether reading it that way does better.
	try {
		const spelled = condensed(items, charge, opts, []);
		if (spelled.score < counted.score - 1e-9) return done(spelled);
	} catch {
		// It only makes sense as a count of atoms.
	}
	return done(counted);
}

// Builds a molecule from atom counts alone. The least electronegative element sits in the
// middle (as a chain, if there are several of it) with everything else around it, and hydrogens
// go wherever gives the best Lewis structure — on the oxygens of an oxyacid, for one.
function molecular(count, charge, opts, notes) {
	const mol = new Mol();
	const elements = [...count.keys()];
	const hydrogens = count.get("H") || 0;
	const heavy = elements.filter((el) => el !== "H");

	if (elements.length === 1) {
		const [el] = elements;
		const n = count.get(el);
		const atoms = Array.from({ length: n }, () => mol.addAtom(el));
		for (let k = 1; k < n; k++) mol.addBond(atoms[k - 1], atoms[k]);
		if (el === "S" && n === 8) mol.addBond(atoms[7], atoms[0]);
		return { ...solveLewis(mol, charge, opts), mol };
	}
	if (count.get("C") === 6 && hydrogens === 6 && heavy.length === 1 && !charge) {
		addBenzene(mol).forEach((c) => mol.addBond(c, mol.addAtom("H")));
		return { ...solveLewis(mol, 0, opts), mol };
	}

	// Fluorine is never central, and nor is a halogen there's more than one of (Cl2O is Cl–O–Cl).
	let central = heavy.filter((el) => el !== "F");
	if (!central.length) central = heavy;
	const single = central.filter((el) => !(HALOGENS.has(el) && count.get(el) > 1));
	if (single.length) central = single;
	const centre = central.sort((p, q) => ELEMENTS[p][3] - ELEMENTS[q][3] || count.get(p) - count.get(q))[0];
	const nCentre = count.get(centre);
	const others = heavy.filter((el) => el !== centre).flatMap((el) => Array(count.get(el)).fill(el));
	const chain = centre === "C" && nCentre > 1;
	if (chain && hydrogens && others.some((el) => !HALOGENS.has(el))) {
		throw new Error(
			"That formula fits more than one molecule. Write how it's put together (like CH3CH2OH), or use its name.",
		);
	}

	const centres = Array.from({ length: nCentre }, () => mol.addAtom(centre));
	for (let k = 1; k < nCentre; k++) mol.addBond(centres[k - 1], centres[k]);
	// Outer atoms are shared out from the ends of the chain inwards.
	const turn = (k) => (k % 2 ? nCentre - 1 - (k >> 1) : k >> 1);
	const outer = others.map((el, k) => {
		const atom = mol.addAtom(el);
		mol.addBond(centres[turn(k % nCentre)], atom);
		return atom;
	});
	const oxygens = outer.filter((i) => mol.atoms[i].el === "O");

	let best = null;
	for (let onCentre = hydrogens; onCentre >= 0; onCentre--) {
		const onOxygen = hydrogens - onCentre;
		if (onOxygen > oxygens.length || (onOxygen && chain)) break;
		const trial = mol.clone();
		for (let k = 0; k < onOxygen; k++) trial.addBond(oxygens[k], trial.addAtom("H"));
		for (let k = 0; k < onCentre; k++) {
			const room = (i) => ELEMENTS[centre][5] - trial.degree(i);
			const target = centres.reduce((p, q) => (room(q) > room(p) ? q : p));
			trial.addBond(target, trial.addAtom("H"));
		}
		try {
			const result = solveLewis(trial, charge, opts);
			if (!best || result.score < best.score - 1e-9) best = { ...result, mol: trial };
		} catch {
			// This placing of the hydrogens gives an atom too many bonds; try the next.
		}
	}
	if (!best) throw new Error("Couldn't work out a structure for that formula.");
	if (chain && nCentre > 2) notes.push("Several molecules share this formula — this is the straight-chain one.");
	return best;
}

// Tidies a condensed formula's items before it's built: bonds are dropped (the hydrogen counts
// already say where the double bonds are), C6H5 becomes a phenyl ring, and groups written before
// the atom they hang from — (CH3)3COH — are moved behind it.
function prepare(list) {
	const items = list.filter((it) => !it.bond).map((it) => (it.group ? { ...it, group: prepare(it.group) } : it));
	let out = [];
	for (let i = 0; i < items.length; i++) {
		if (isEl(items[i], "C", 6) && isEl(items[i + 1], "H", 5)) {
			out.push({ phenyl: true });
			i++;
		} else out.push(items[i]);
	}
	let lead = 0;
	while (out[lead]?.group) lead++;
	const host = out[lead];
	if (lead && isHeavy(host)) {
		const groups = out.slice(0, lead).map((g) => ({ ...g, group: reverse(g.group) }));
		const more = host.el && host.n > 1 ? [{ ...host, n: host.n - 1 }] : [];
		out = [host.el ? { ...host, n: 1 } : host, ...groups, ...more, ...out.slice(lead + 1)];
	}
	return out;
}

// Turns a group around so that it joins by what was its last atom: (CH3CH2) becomes CH2CH3.
function reverse(list) {
	const chunks = [[]];
	for (const it of list) {
		if (isHeavy(it) && chunks.at(-1).some(isHeavy)) chunks.push([]);
		chunks.at(-1).push(it);
	}
	return chunks
		.map((chunk) => {
			const at = chunk.findIndex(isHeavy);
			return at > 0 ? [chunk[at], ...chunk.slice(0, at), ...chunk.slice(at + 1)] : chunk;
		})
		.reverse()
		.flat();
}

// Flattens the items into steps for the builder. A repeated group might be n branches off one
// atom, as in C(CH3)4, or n links of the chain, as in CH3(CH2)4CH3, so both readings are kept.
function compile(items) {
	let variants = [[]];
	let seenHeavy = false;
	const emit = (ops) => (variants = variants.map((v) => v.concat(ops)));
	const unit = (h) => [{ op: "atom", el: "C", n: 1 }, { op: "mono", el: "H", n: h }];
	const repeat = (ops, n) => Array.from({ length: n }, () => ops).flat();

	const walk = (list) => {
		for (let i = 0; i < list.length; i++) {
			const it = list[i];
			if (it.group) {
				const before = variants;
				variants = [[]];
				walk(it.group);
				const inner = variants;
				variants = [];
				for (const v of before) {
					for (const g of inner) {
						variants.push(v.concat(repeat([{ op: "push" }, ...g, { op: "pop" }], it.n)));
						if (it.n > 1) variants.push(v.concat(repeat(g, it.n)));
					}
				}
				variants = variants.slice(0, 16);
			} else if (it.phenyl) {
				emit([{ op: "phenyl" }]);
				seenHeavy = true;
			} else if (it.el === "C" && it.n > 1) {
				// An alkyl group written as a count, like the C2H5 of C2H5OH.
				const n = it.n;
				const h = list[i + 1]?.el === "H" ? list[i + 1].n : 0;
				if (h === 2 * n + 1) {
					emit(seenHeavy ? [...repeat(unit(2), n - 1), ...unit(3)] : [...unit(3), ...repeat(unit(2), n - 1)]);
				} else if (h === 2 * n) {
					emit(repeat(unit(2), n));
				} else {
					throw new Error(`Can't tell how C${n}${h ? "H" + h : ""} is put together — write it out, like CH3CH2.`);
				}
				seenHeavy = true;
				i++;
			} else if (isMono(it.el)) {
				emit([{ op: "mono", el: it.el, n: it.n }]);
			} else {
				emit([{ op: "atom", el: it.el, n: it.n }]);
				seenHeavy = true;
			}
		}
	};
	walk(items);
	return variants;
}

// Builds a molecule from a condensed formula. Atoms are read left to right, each joining the
// most recent atom that still has a bond to spare; when that's a choice (the second O of COOH
// could join the first O or the carbon) each option is followed, and the first structure whose
// electrons work out with no formal charges to spare is the answer.
function condensed(items, charge, opts, notes) {
	const spare = (mol, i) => ELEMENTS[mol.atoms[i].el][5] - mol.orderSum(i);
	let best = null;
	let leaves = 0;

	const run = (ops, pc, mol, path, pending, saved) => {
		if (best?.clean || leaves > 4000) return;
		if (pc === ops.length) {
			leaves++;
			if (!mol.atoms.length || pending.length) return;
			try {
				const trial = mol.clone();
				const result = solveLewis(trial, charge, opts);
				if (!best || result.score < best.score - 1e-9) best = { ...result, mol: trial };
			} catch {
				// Not a structure that can exist; another reading may be.
			}
			return;
		}
		const op = ops[pc];
		if (op.op === "push") return run(ops, pc + 1, mol, path, pending, [...saved, path]);
		if (op.op === "pop") return run(ops, pc + 1, mol, saved.at(-1), pending, saved.slice(0, -1));

		// Where the next atom may join: the nearest atoms back along the chain with room.
		const hosts = [];
		for (let k = path.length - 1; k >= 0 && hosts.length < 3; k--) {
			if (spare(mol, path[k]) >= 1) hosts.push(k);
		}
		if (!hosts.length && path.length) {
			const last = path.at(-1);
			if (charge || ELEMENTS[mol.atoms[last].el][4] > 2) hosts.push(path.length - 1);
		}

		if (op.op === "mono") {
			if (!path.length) return run(ops, pc + 1, mol, path, [...pending, op], saved);
			for (const k of hosts) {
				const host = path[k];
				if (!charge && ELEMENTS[mol.atoms[host].el][4] <= 2 && spare(mol, host) < op.n) continue;
				const next = mol.clone();
				for (let j = 0; j < op.n; j++) next.addBond(host, next.addAtom(op.el));
				run(ops, pc + 1, next, path, pending, saved);
			}
			return;
		}

		const add = (next, host) => {
			let atom;
			if (op.op === "phenyl") {
				const ring = addBenzene(next);
				ring.slice(1).forEach((c) => next.addBond(c, next.addAtom("H")));
				atom = ring[0];
				if (host >= 0) next.addBond(host, atom);
			} else {
				for (let j = 0; j < op.n; j++) {
					const prev = atom;
					atom = next.addAtom(op.el);
					if (host >= 0) next.addBond(host, atom);
					else if (j) next.addBond(prev, atom);
				}
			}
			return atom;
		};
		if (!path.length) {
			const next = mol.clone();
			const atom = add(next, -1);
			for (const p of pending) for (let j = 0; j < p.n; j++) next.addBond(atom, next.addAtom(p.el));
			return run(ops, pc + 1, next, [atom], [], saved);
		}
		for (const k of hosts) {
			const next = mol.clone();
			const atom = add(next, path[k]);
			run(ops, pc + 1, next, [...path.slice(0, k + 1), atom], pending, saved);
		}
	};

	for (const ops of compile(prepare(items))) {
		run(ops, 0, new Mol(), [], [], []);
		if (best?.clean) break;
	}
	if (!best) throw new Error("Couldn't turn that formula into a structure — check the hydrogen counts.");
	if (!best.complete) notes.push("No structure fits this formula with full octets, so this is the closest — check how it's written.");
	return best;
}
