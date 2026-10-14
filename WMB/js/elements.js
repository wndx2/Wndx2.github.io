// symbol: [atomic number, relative atomic mass, valence electrons, electronegativity, period,
// usual number of bonds]. Main-group elements only: these are the ones a Lewis diagram works for.
export const ELEMENTS = {
	H: [1, 1.008, 1, 2.2, 1, 1],
	He: [2, 4.0026, 2, 0, 1, 0],
	Li: [3, 6.94, 1, 0.98, 2, 1],
	Be: [4, 9.0122, 2, 1.57, 2, 2],
	B: [5, 10.81, 3, 2.04, 2, 3],
	C: [6, 12.011, 4, 2.55, 2, 4],
	N: [7, 14.007, 5, 3.04, 2, 3],
	O: [8, 15.999, 6, 3.44, 2, 2],
	F: [9, 18.998, 7, 3.98, 2, 1],
	Ne: [10, 20.18, 8, 0, 2, 0],
	Na: [11, 22.99, 1, 0.93, 3, 1],
	Mg: [12, 24.305, 2, 1.31, 3, 2],
	Al: [13, 26.982, 3, 1.61, 3, 3],
	Si: [14, 28.085, 4, 1.9, 3, 4],
	P: [15, 30.974, 5, 2.19, 3, 3],
	S: [16, 32.06, 6, 2.58, 3, 2],
	Cl: [17, 35.45, 7, 3.16, 3, 1],
	Ar: [18, 39.948, 8, 0, 3, 0],
	K: [19, 39.098, 1, 0.82, 4, 1],
	Ca: [20, 40.078, 2, 1.0, 4, 2],
	Ga: [31, 69.723, 3, 1.81, 4, 3],
	Ge: [32, 72.63, 4, 2.01, 4, 4],
	As: [33, 74.922, 5, 2.18, 4, 3],
	Se: [34, 78.971, 6, 2.55, 4, 2],
	Br: [35, 79.904, 7, 2.96, 4, 1],
	Kr: [36, 83.798, 8, 3.0, 4, 0],
	Rb: [37, 85.468, 1, 0.82, 5, 1],
	Sr: [38, 87.62, 2, 0.95, 5, 2],
	In: [49, 114.82, 3, 1.78, 5, 3],
	Sn: [50, 118.71, 4, 1.96, 5, 4],
	Sb: [51, 121.76, 5, 2.05, 5, 3],
	Te: [52, 127.6, 6, 2.1, 5, 2],
	I: [53, 126.9, 7, 2.66, 5, 1],
	Xe: [54, 131.29, 8, 2.6, 5, 0],
	Cs: [55, 132.91, 1, 0.79, 6, 1],
	Ba: [56, 137.33, 2, 0.89, 6, 2],
};

// Every symbol, so that an element this app can't draw is named in the error rather than misread.
export const SYMBOLS = new Set(
	(
		"H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
		"Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu " +
		"Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr " +
		"Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og"
	).split(" "),
);

export const HALOGENS = new Set(["F", "Cl", "Br", "I"]);

// The charge each element takes as a lone ion.
export const ION_CHARGE = {
	H: 1,
	Li: 1,
	Na: 1,
	K: 1,
	Rb: 1,
	Cs: 1,
	Be: 2,
	Mg: 2,
	Ca: 2,
	Sr: 2,
	Ba: 2,
	Al: 3,
	N: -3,
	P: -3,
	O: -2,
	S: -2,
	Se: -2,
	F: -1,
	Cl: -1,
	Br: -1,
	I: -1,
};

// Numbers of bonds each element makes when its hydrogens are left unwritten, lowest first.
export const VALENCES = {
	B: [3],
	C: [4],
	N: [3, 5],
	O: [2],
	P: [3, 5],
	S: [2, 4, 6],
	Si: [4],
	Se: [2, 4, 6],
	F: [1],
	Cl: [1],
	Br: [1],
	I: [1],
};

// Atom colours for the "colour atoms" option: mid-tones that read on white and on black.
export const COLORS = {
	O: "#e03131",
	N: "#3b6fe0",
	S: "#c08a00",
	P: "#e8590c",
	F: "#2f9e44",
	Cl: "#2f9e44",
	Br: "#b0562c",
	I: "#8e4ec6",
	B: "#d6719a",
	Si: "#8a7f5c",
	Na: "#8e4ec6",
	K: "#8e4ec6",
	Li: "#8e4ec6",
	Mg: "#2f9e44",
	Ca: "#2f9e44",
};

export function requireElement(symbol) {
	if (!ELEMENTS[symbol]) {
		throw new Error(
			SYMBOLS.has(symbol)
				? `${symbol} isn't supported — WMB only draws main-group elements.`
				: `“${symbol}” isn't an element.`,
		);
	}
	return ELEMENTS[symbol];
}
