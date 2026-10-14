import { ELEMENTS } from "./elements.js";

// Molecular shapes by VSEPR: the electron domains around an atom (bonded atoms plus lone pairs)
// keep as far apart as they can, and the shape is named for where the atoms end up.

const R3 = Math.sqrt(3);
// Corners of a tetrahedron, a trigonal bipyramid's equator, and the axes.
const T = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((v) => v.map((x) => x / R3));
const E = [[1, 0, 0], [-0.5, R3 / 2, 0], [-0.5, -R3 / 2, 0]];
const [X, Y, Z] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const neg = (v) => v.map((x) => -x);
const flat = (degrees) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180), 0];

// Keyed by "domains,lone pairs". Each bond has the angle it's drawn at on the page (degrees,
// anticlockwise from the right), how it's drawn — in the page ("plain"), towards you ("wedge")
// or away ("dash") — and its true direction in space, which decides polarity. `lone` lists the
// angles the lone pairs are drawn at.
export const SHAPES = {
	"2,0": { name: "Linear", angle: "180°", bonds: [[180, "plain", neg(X)], [0, "plain", X]], lone: [] },
	"3,0": {
		name: "Trigonal planar",
		angle: "120°",
		bonds: [[90, "plain", flat(90)], [210, "plain", flat(210)], [330, "plain", flat(330)]],
		lone: [],
	},
	"3,1": { name: "Bent", angle: "<120°", bonds: [[210, "plain", flat(210)], [330, "plain", flat(330)]], lone: [90] },
	"4,0": {
		name: "Tetrahedral",
		angle: "109.5°",
		bonds: [[90, "plain", T[0]], [200, "plain", T[1]], [305, "wedge", T[2]], [345, "dash", T[3]]],
		lone: [],
	},
	"4,1": {
		name: "Trigonal pyramidal",
		angle: "<109.5°",
		bonds: [[200, "plain", T[1]], [305, "wedge", T[2]], [345, "dash", T[3]]],
		lone: [90],
	},
	"4,2": { name: "Bent", angle: "<109.5°", bonds: [[215, "plain", T[1]], [325, "plain", T[2]]], lone: [60, 120] },
	"5,0": {
		name: "Trigonal bipyramidal",
		angle: "90° and 120°",
		bonds: [[90, "plain", Z], [270, "plain", neg(Z)], [180, "plain", E[0]], [330, "wedge", E[1]], [20, "dash", E[2]]],
		lone: [],
	},
	"5,1": {
		name: "See-saw",
		angle: "<90° and <120°",
		bonds: [[90, "plain", Z], [270, "plain", neg(Z)], [330, "wedge", E[1]], [20, "dash", E[2]]],
		lone: [180],
	},
	"5,2": {
		name: "T-shaped",
		angle: "<90°",
		bonds: [[90, "plain", Z], [270, "plain", neg(Z)], [0, "plain", E[0]]],
		lone: [150, 210],
	},
	"5,3": { name: "Linear", angle: "180°", bonds: [[180, "plain", neg(Z)], [0, "plain", Z]], lone: [90, 225, 315] },
	"6,0": {
		name: "Octahedral",
		angle: "90°",
		bonds: [[90, "plain", Z], [270, "plain", neg(Z)], [205, "wedge", X], [335, "wedge", Y], [155, "dash", neg(Y)], [25, "dash", neg(X)]],
		lone: [],
	},
	"6,1": {
		name: "Square pyramidal",
		angle: "<90°",
		bonds: [[90, "plain", Z], [205, "wedge", X], [335, "wedge", Y], [155, "dash", neg(Y)], [25, "dash", neg(X)]],
		lone: [270],
	},
	"6,2": {
		name: "Square planar",
		angle: "90°",
		bonds: [[205, "wedge", X], [335, "wedge", Y], [155, "dash", neg(Y)], [25, "dash", neg(X)]],
		lone: [90, 270],
	},
};

// The shape around one atom, or null if it has fewer than two neighbours or more domains than
// VSEPR names. A lone unpaired electron counts as a domain, as in NO2.
export function shapeAround(mol, i) {
	const atom = mol.atoms[i];
	const bonded = mol.degree(i);
	if (bonded < 2) return null;
	const lone = atom.lp + atom.rad;
	return SHAPES[`${bonded + lone},${lone}`] || null;
}

// A bond counts as polar from this difference in electronegativity up: S–H (0.38) and N–O
// (0.40) are in, C–H (0.35) is out.
export const POLAR = 0.36;

export function pull(mol, a, b) {
	const d = ELEMENTS[mol.atoms[b].el][3] - ELEMENTS[mol.atoms[a].el][3];
	return Math.abs(d) < POLAR ? 0 : d;
}

// Whether the bond dipoles around a central atom cancel. `ends` are the atoms on the shape's
// bonds, in order.
export function isPolar(mol, centre, shape, ends) {
	const net = [0, 0, 0];
	ends.forEach((end, k) => {
		const d = pull(mol, centre, end);
		shape.bonds[k][2].forEach((x, axis) => (net[axis] += x * d));
	});
	return Math.hypot(...net) > 0.2;
}

// The molecule as one central atom with everything else around it: { centre, ends }, where each
// end is an atom bonded to the centre that carries nothing but hydrogens (so CH3OH is a carbon
// with three H and an OH). Null if the molecule isn't built that way.
export function findCentre(mol) {
	const n = mol.atoms.length;
	if (n < 3) return null;
	let centre = 0;
	for (let i = 1; i < n; i++) if (mol.degree(i) > mol.degree(centre)) centre = i;
	const ends = mol.adj[centre].map((e) => e.to);
	const covered = new Set([centre, ...ends]);
	for (const end of ends) {
		for (const { to } of mol.adj[end]) {
			if (to === centre) continue;
			if (mol.atoms[to].el !== "H" || mol.degree(to) !== 1) return null;
			covered.add(to);
		}
	}
	return covered.size === n ? { centre, ends } : null;
}
