// The circuit is solved by nodal analysis: every part is written as a conductance with a
// current alongside it (i = g·v + h, from its first end to its second), and Kirchhoff's
// current law at each node gives a set of linear equations, solved again at every step.
//
// Capacitors and inductors carry their history from step to step. They're stepped with the
// second-order backward difference (BDF2), which settles fast transients rather than ringing
// on them, after a single backward Euler step whenever the circuit or the step size changes.
// Diodes aren't linear, so each step is repeated with Newton's method until they agree.
import { nets } from "./circuit.js";
import { LED_COLOURS, resistanceOf } from "./parts.js";

// What an ideal part, which has no resistance on paper, is given so that the equations stay
// solvable: an ammeter, a closed switch, an intact fuse, a cell with no internal resistance.
const RON = 1e-5;
// A whisker of conductance from every node to earth, so a node that's connected to nothing
// still has a voltage (nothing measurable flows through it).
const GMIN = 1e-12;
// The thermal voltage at room temperature.
const VT = 0.025852;
// A lamp burns out once it has taken more than this many times its rated power for longer than
// BURN seconds, so a brief surge doesn't kill it but a lamp on far too high a voltage dies.
const OVERLOAD = 2;
const BURN = 0.05;
// How tightly a transformer's two coils are linked.
const COUPLING = 0.999;

export class Sim {
	constructor() {
		this.t = 0;
		this.states = new Map();
		this.elements = [];
		this.size = 0;
		// True when the next step has to be a backward Euler one.
		this.fresh = true;
		this.pending = 0;
		this.dt = 0;
		this.ac = false;
		this.period = 0;
		this.window = 0;
		this.rmsReady = false;
	}

	state(id) {
		let s = this.states.get(id);
		if (!s) {
			s = { v: 0, i: 0, v2: 0, i2: 0, vh: [0, 0], ih: [0, 0], jh: [0, 0], vd: 0, blown: false };
			s.sum = [0, 0, 0, 0];
			s.rms = [NaN, NaN, NaN, NaN];
			this.states.set(id, s);
		}
		return s;
	}

	// Takes in a circuit after an edit. What the parts have built up (a capacitor's charge,
	// the current in an inductor, a blown fuse) is kept for every part still there.
	load(circuit) {
		const net = nets(circuit);
		let size = net.count;
		const present = new Set();
		this.elements = circuit.parts.map((part) => {
			present.add(part.id);
			const el = { part, n: net.partNodes.get(part.id), s: this.state(part.id), g: 0, h: 0 };
			// A coil with resistance is an ideal inductor and a resistor, joined at a node of
			// their own.
			if (part.type === "inductor" && part.props.r > 0) el.m = size++;
			return el;
		});
		for (const id of [...this.states.keys()]) if (!present.has(id)) this.states.delete(id);
		this.size = size;
		this.A = new Float64Array(size * size);
		this.z = new Float64Array(size);
		this.x = new Float64Array(size);
		this.fresh = true;

		// Meters read rms once there's an AC supply, averaged over its slowest cycle.
		const freqs = circuit.parts.filter((p) => p.type === "ac").map((p) => p.props.f);
		const wasAc = this.ac;
		this.ac = freqs.length > 0;
		this.period = this.ac ? 1 / Math.min(...freqs) : 0;
		if (this.ac !== wasAc) this.clearRms();

		// The fastest thing that has to be followed: an AC supply, or a coil and capacitor
		// ringing together.
		let fmax = this.ac ? Math.max(...freqs) : 0;
		const Ls = [];
		const Cs = [];
		for (const p of circuit.parts) {
			if (p.type === "inductor") Ls.push(p.props.L);
			if (p.type === "transformer") Ls.push(p.props.L, p.props.L * (p.props.ns / p.props.np) ** 2);
			if (p.type === "capacitor") Cs.push(p.props.C);
		}
		if (Ls.length && Cs.length) fmax = Math.max(fmax, 1 / (2 * Math.PI * Math.sqrt(Math.min(...Ls) * Math.min(...Cs))));
		this.fmax = fmax;
	}

	// Back to the start: capacitors empty, no current in the coils, fuses mended.
	reset(circuit) {
		this.t = 0;
		this.pending = 0;
		this.states.clear();
		this.clearRms();
		this.load(circuit);
	}

	clearRms() {
		this.window = 0;
		this.rmsReady = false;
		for (const s of this.states.values()) {
			s.sum = [0, 0, 0, 0];
			s.rms = [NaN, NaN, NaN, NaN];
		}
	}

	// The step size for a given speed (seconds of the circuit per second on screen): about
	// twenty steps a frame, and at least a hundred in each cycle of the fastest thing there.
	stepFor(speed) {
		let dt = speed / 60 / 20;
		if (this.fmax) dt = Math.min(dt, 1 / (100 * this.fmax));
		return Math.max(dt, speed / 60 / 400);
	}

	// Moves the circuit on by the time a frame took, at the given speed.
	advance(seconds, speed) {
		const dt = this.stepFor(speed);
		if (dt !== this.dt) {
			this.dt = dt;
			this.fresh = true;
		}
		this.pending += Math.min(seconds, 0.1) * speed;
		let steps = 0;
		while (this.pending >= dt * 0.999 && steps < 800) {
			this.step(dt);
			this.pending -= dt;
			steps++;
		}
		// Too much to keep up with: the circuit falls behind rather than the page freezing.
		if (steps === 800) this.pending = 0;
	}

	// Solves the circuit as it stands without moving time on, after an edit while paused.
	// The step is so short that capacitors hold their voltage and coils their current.
	settle() {
		this.fresh = true;
		this.step(1e-9, true);
		this.fresh = true;
	}

	step(dt, still = false) {
		const order = this.fresh ? 1 : 2;
		const t = still ? this.t : this.t + dt;
		const { A, z, x, size } = this;
		const diodes = this.elements.filter((el) => el.part.type === "diode" || el.part.type === "led");
		for (let iter = 0; iter < 60; iter++) {
			A.fill(0);
			z.fill(0);
			for (let k = 0; k < size; k++) A[k * size + k] = GMIN;
			for (const el of this.elements) this.stamp(el, dt, order, t);
			solve(A, z, x, size);
			let settled = true;
			for (const el of diodes) {
				const s = el.s;
				const v = x[el.n[0]] - x[el.n[1]];
				const next = limit(v, s.vd, el.nvt, el.vcrit);
				if (Math.abs(next - s.vd) > 1e-7 + 1e-6 * Math.abs(next)) settled = false;
				s.vd = next;
			}
			if (settled) break;
		}
		this.commit(dt, order, still);
		this.t = t;
		this.fresh = false;
	}

	// Adds a part to the equations.
	stamp(el, dt, order, t) {
		const { part, s } = el;
		const p = part.props;
		const [a, b] = el.n;
		let g = 0;
		let h = 0;
		switch (part.type) {
			case "lamp":
				// A blown lamp's filament is broken: no current gets through.
				g = p.broken || s.blown ? 0 : 1 / Math.max(p.R, RON);
				break;
			case "resistor":
			case "varres":
			case "ldr":
			case "thermistor":
				g = 1 / Math.max(resistanceOf(part), RON);
				break;
			case "ammeter":
				g = 1 / RON;
				break;
			case "switch":
				g = p.closed ? 1 / RON : 0;
				break;
			case "fuse":
				g = s.blown ? 0 : 1 / RON;
				break;
			case "voltmeter":
				break;
			case "cell":
			case "battery":
				// The second end is the positive one: with no current, it sits emf above the first.
				g = 1 / Math.max(p.r, RON);
				h = p.emf * g;
				break;
			case "ac":
				g = 1 / Math.max(p.r, RON);
				h = p.vrms * Math.SQRT2 * Math.sin(2 * Math.PI * p.f * t) * g;
				break;
			case "capacitor":
				if (order === 1) {
					g = p.C / dt;
					h = -g * s.vh[0];
				} else {
					g = (1.5 * p.C) / dt;
					h = (-p.C / dt) * (2 * s.vh[0] - 0.5 * s.vh[1]);
				}
				break;
			case "inductor": {
				g = (order === 1 ? dt : (2 * dt) / 3) / p.L;
				h = order === 1 ? s.ih[0] : (4 * s.ih[0] - s.ih[1]) / 3;
				if (el.m !== undefined) {
					this.add(a, el.m, g, h);
					this.add(el.m, b, 1 / p.r, 0);
					el.g = g;
					el.h = h;
					return;
				}
				break;
			}
			case "diode":
			case "led": {
				// Shockley's equation, fitted so that the diode drops its forward voltage at 20 mA.
				const vf = part.type === "led" ? (LED_COLOURS[p.colour] || LED_COLOURS.red).vf : p.vf;
				const nvt = (part.type === "led" ? 2 : 1) * VT;
				const is = 0.02 / Math.expm1(vf / nvt);
				el.nvt = nvt;
				el.vcrit = nvt * Math.log(nvt / (is * Math.SQRT2));
				const e = Math.exp(Math.min(s.vd / nvt, 200));
				g = (is * e) / nvt + 1e-12;
				h = is * (e - 1) - g * s.vd;
				break;
			}
			case "transformer":
				this.stampTransformer(el, dt, order);
				return;
		}
		el.g = g;
		el.h = h;
		this.add(a, b, g, h);
	}

	// A part between nodes a and b carrying i = g·(Va − Vb) + h from a to b.
	add(a, b, g, h) {
		const { A, z, size } = this;
		A[a * size + a] += g;
		A[b * size + b] += g;
		A[a * size + b] -= g;
		A[b * size + a] -= g;
		z[a] -= h;
		z[b] += h;
	}

	// Two coils on one core. Each coil's voltage is L di/dt from its own current plus M di/dt
	// from the other's, so each current depends on both voltages.
	stampTransformer(el, dt, order) {
		const p = el.part.props;
		const s = el.s;
		const n = p.ns / p.np;
		const L1 = p.L;
		const L2 = L1 * n * n;
		const M = COUPLING * L1 * n;
		const det = L1 * L2 - M * M;
		const c = (order === 1 ? dt : (2 * dt) / 3) / det;
		const Y = [
			[c * L2, -c * M],
			[-c * M, c * L1],
		];
		const hist = (hh) => (order === 1 ? hh[0] : (4 * hh[0] - hh[1]) / 3);
		const H = [hist(s.ih), hist(s.jh)];
		el.Y = Y;
		el.H = H;
		const { A, z, size } = this;
		const ends = [
			[el.n[0], el.n[1]],
			[el.n[2], el.n[3]],
		];
		for (let k = 0; k < 2; k++) {
			const [ak, bk] = ends[k];
			for (let j = 0; j < 2; j++) {
				const [aj, bj] = ends[j];
				const y = Y[k][j];
				A[ak * size + aj] += y;
				A[ak * size + bj] -= y;
				A[bk * size + aj] -= y;
				A[bk * size + bj] += y;
			}
			z[ak] -= H[k];
			z[bk] += H[k];
		}
	}

	// Reads each part's voltage and current off the solution and carries its history on.
	commit(dt, order, still) {
		const x = this.x;
		for (const el of this.elements) {
			const { part, s } = el;
			const [a, b] = el.n;
			const v = x[a] - x[b];
			let i;
			switch (part.type) {
				case "transformer": {
					const v1 = v;
					const v2 = x[el.n[2]] - x[el.n[3]];
					const i1 = el.Y[0][0] * v1 + el.Y[0][1] * v2 + el.H[0];
					const i2 = el.Y[1][0] * v1 + el.Y[1][1] * v2 + el.H[1];
					s.ih = [i1, s.ih[0]];
					s.jh = [i2, s.jh[0]];
					s.v2 = v2;
					s.i2 = i2;
					i = i1;
					break;
				}
				case "inductor":
					i = el.g * (el.m !== undefined ? x[a] - x[el.m] : v) + el.h;
					s.ih = [i, s.ih[0]];
					break;
				case "capacitor":
					i = el.g * v + el.h;
					s.vh = [v, s.vh[0]];
					break;
				default:
					i = el.g * v + el.h;
			}
			if (part.type === "fuse" && !s.blown && Math.abs(i) > part.props.rating) s.blown = true;
			if (part.type === "lamp" && !s.blown && !still) {
				const over = Math.abs(v * i) > OVERLOAD * part.props.P;
				s.heat = over ? (s.heat || 0) + dt : Math.max(0, (s.heat || 0) - dt);
				if (s.heat > BURN) s.blown = true;
			}
			s.v = v;
			s.i = i;
			if (this.ac && !still) {
				s.sum[0] += v * v * dt;
				s.sum[1] += i * i * dt;
				s.sum[2] += s.v2 * s.v2 * dt;
				s.sum[3] += s.i2 * s.i2 * dt;
			}
		}
		if (this.ac && !still) {
			this.window += dt;
			if (this.window >= this.period * (1 - 1e-9)) {
				for (const el of this.elements) {
					const s = el.s;
					s.rms = s.sum.map((q) => Math.sqrt(q / this.window));
					s.sum = [0, 0, 0, 0];
				}
				this.window = 0;
				this.rmsReady = true;
			}
		}
	}
}

// Newton's method on a diode can overshoot into exp() of something enormous. Steps up a
// diode's voltage are cut down to grow by about its log (the limiting SPICE uses).
function limit(vnew, vold, nvt, vcrit) {
	if (vnew > vcrit && Math.abs(vnew - vold) > 2 * nvt) {
		if (vold > 0) {
			const arg = 1 + (vnew - vold) / nvt;
			return arg > 0 ? vold + nvt * Math.log(arg) : vcrit;
		}
		return nvt * Math.log(vnew / nvt);
	}
	return vnew;
}

// Gaussian elimination with partial pivoting, in place: A x = z.
function solve(A, z, x, n) {
	for (let k = 0; k < n; k++) {
		let p = k;
		let max = Math.abs(A[k * n + k]);
		for (let r = k + 1; r < n; r++) {
			const v = Math.abs(A[r * n + k]);
			if (v > max) {
				max = v;
				p = r;
			}
		}
		if (max === 0) continue;
		if (p !== k) {
			for (let c = k; c < n; c++) {
				const tmp = A[k * n + c];
				A[k * n + c] = A[p * n + c];
				A[p * n + c] = tmp;
			}
			const tmp = z[k];
			z[k] = z[p];
			z[p] = tmp;
		}
		const pivot = A[k * n + k];
		for (let r = k + 1; r < n; r++) {
			const f = A[r * n + k] / pivot;
			if (f === 0) continue;
			for (let c = k; c < n; c++) A[r * n + c] -= f * A[k * n + c];
			z[r] -= f * z[k];
		}
	}
	for (let k = n - 1; k >= 0; k--) {
		let sum = z[k];
		for (let c = k + 1; c < n; c++) sum -= A[k * n + c] * x[c];
		const d = A[k * n + k];
		x[k] = d ? sum / d : 0;
	}
}
