// Works out the unknowns in a circuit from what's given, as an exam question does: "the
// current in lamp D is 1.4 A; find the resistance of the dimmer".
//
// Each unknown is adjusted, by Newton's method, until every given current, voltage and power
// is met in the circuit's steady (DC) state. There have to be as many givens as unknowns.
// Resistances are searched for on a log scale, so they stay positive and can span ohms to
// megohms.
import { Sim } from "./sim.js";
import { UNKNOWNS, GIVENS } from "./parts.js";

const positive = (key) => key === "R" || key === "r";

// Every unknown has the parts it applies to (several, for identical parts) and the value
// that's unknown in each.
function read(part, key) {
	const p = part.props;
	if (part.type === "varres" && key === "R") return (p.max * p.setting) / 100;
	return p[key];
}

function write(part, key, value) {
	const p = part.props;
	if (part.type === "varres" && key === "R") {
		if (value > p.max) p.max = value;
		p.setting = p.max ? (100 * value) / p.max : 0;
	} else {
		p[key] = value;
	}
}

// The circuit's steady state: one very long backward Euler step from rest, in which
// capacitors have charged (and pass nothing) and inductors have settled (and are just wire).
export function steady(circuit) {
	const sim = new Sim();
	sim.load(circuit);
	sim.step(1e6, true);
	return sim;
}

function measure(sim, part, key) {
	const s = sim.states.get(part.id);
	if (!s) return NaN;
	if (key === "givenI") return Math.abs(s.i);
	if (key === "givenV") return Math.abs(s.v);
	return Math.abs(s.v * s.i);
}

// What's unknown and what's given in a circuit.
export function problem(circuit) {
	const unknowns = [];
	const givens = [];
	const shared = new Map();
	for (const part of circuit.parts) {
		const p = part.props;
		if (p.unknown && (UNKNOWNS[part.type] || []).some(([k]) => k === p.unknown)) {
			if (p.unknown === "Rsame") {
				// Identical parts of one kind are a single unknown between them.
				let u = shared.get(part.type);
				if (!u) shared.set(part.type, (u = { part, parts: [], key: "R", mark: "Rsame" })) && unknowns.push(u);
				u.parts.push(part);
			} else {
				unknowns.push({ part, parts: [part], key: p.unknown, mark: p.unknown });
			}
		}
		for (const [key] of GIVENS) if (typeof p[key] === "number" && Number.isFinite(p[key])) givens.push({ part, key, value: p[key] });
	}
	return { unknowns, givens };
}

// Solves the circuit in place. Gives { status }, which is
//   "none"   nothing to work out
//   "count"  the number of givens doesn't match the number of unknowns
//   "fail"   no values meet the givens (the circuit is left as it was)
//   "ok"     solved
// with the unknowns and givens alongside.
export function solve(circuit) {
	const { unknowns, givens } = problem(circuit);
	const out = { unknowns, givens };
	if (!unknowns.length) return { ...out, status: "none" };
	if (unknowns.length !== givens.length) return { ...out, status: "count" };

	const toZ = (u) => {
		const v = read(u.part, u.key);
		if (positive(u.key)) return Math.log(Math.max(v, 1e-6));
		// An EMF of zero gives no current to steer by; start from a volt.
		return v || 1;
	};
	const set = (u, value) => u.parts.forEach((part) => write(part, u.key, value));
	const apply = (z) => unknowns.forEach((u, k) => set(u, positive(u.key) ? Math.exp(z[k]) : z[k]));
	const residual = (z) => {
		apply(z);
		const sim = steady(circuit);
		return givens.map((g) => (measure(sim, g.part, g.key) - g.value) / Math.max(Math.abs(g.value), 1e-9));
	};
	const size = (r) => Math.max(...r.map(Math.abs));

	const start = unknowns.map((u) => read(u.part, u.key));
	let z = unknowns.map(toZ);
	let r = residual(z);
	for (let iter = 0; iter < 80 && size(r) > 1e-10; iter++) {
		// The Jacobian, by small steps in each unknown.
		const J = unknowns.map(() => []);
		for (let j = 0; j < z.length; j++) {
			const h = 1e-6 * (1 + Math.abs(z[j]));
			const zj = z.slice();
			zj[j] += h;
			const rj = residual(zj);
			for (let k = 0; k < r.length; k++) J[k][j] = (rj[k] - r[k]) / h;
		}
		const dz = linear(J, r.map((v) => -v));
		if (!dz) break;
		// Take the whole Newton step if it helps, or less of it until it does.
		let t = 1;
		let moved = false;
		while (t > 1e-6) {
			const zt = z.map((v, k) => v + t * dz[k]);
			const rt = residual(zt);
			if (size(rt) < size(r)) {
				z = zt;
				r = rt;
				moved = true;
				break;
			}
			t /= 2;
		}
		if (!moved) break;
	}
	if (!(size(r) < 1e-6)) {
		unknowns.forEach((u, k) => set(u, start[k]));
		return { ...out, status: "fail" };
	}
	apply(z);
	return { ...out, status: "ok" };
}

// Solves A x = b for a small square system, or gives null if it has no single answer.
function linear(A, b) {
	const n = b.length;
	const M = A.map((row, k) => [...row, b[k]]);
	for (let c = 0; c < n; c++) {
		let p = c;
		for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
		if (!(Math.abs(M[p][c]) > 1e-14)) return null;
		[M[c], M[p]] = [M[p], M[c]];
		for (let r = c + 1; r < n; r++) {
			const f = M[r][c] / M[c][c];
			for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
		}
	}
	const x = Array(n).fill(0);
	for (let c = n - 1; c >= 0; c--) {
		let s = M[c][n];
		for (let k = c + 1; k < n; k++) s -= M[c][k] * x[k];
		x[c] = s / M[c][c];
	}
	return x;
}
