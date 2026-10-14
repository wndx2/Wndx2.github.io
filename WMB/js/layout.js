// Where each atom goes, in units of one bond length. y grows downwards, as on screen.

const TAU = Math.PI * 2;
const UP = -Math.PI / 2;
const deg = (d) => (d * Math.PI) / 180;

function between(a, b) {
	const d = Math.abs(a - b) % TAU;
	return d > Math.PI ? TAU - d : d;
}

// Angles for k new things (bonds, hydrogens, lone pairs) around an atom that already has
// something at each of the `used` angles: they go into the widest gaps, spaced evenly.
export function fillGaps(used, k, first = UP) {
	if (k <= 0) return [];
	if (!used.length) return Array.from({ length: k }, (_, i) => first + (i * TAU) / k);
	const sorted = used.map((a) => ((a % TAU) + TAU) % TAU).sort((p, q) => p - q);
	const gaps = sorted.map((start, i) => ({
		start,
		size: (i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + TAU) - start,
		n: 0,
	}));
	const middle = (g) => g.start + g.size / 2;
	for (let j = 0; j < k; j++) {
		let best = null;
		let bestRoom = -1;
		let bestApart = -1;
		for (const g of gaps) {
			const room = g.size / (g.n + 2);
			// Between equally wide gaps, take the one furthest from those already used, or the
			// one nearest the top to begin with.
			let apart = Math.PI - between(middle(g), UP);
			const taken = gaps.filter((o) => o.n && o !== g);
			if (taken.length) apart = Math.min(...taken.map((o) => between(middle(g), middle(o))));
			if (room > bestRoom + 1e-6 || (room > bestRoom - 1e-6 && apart > bestApart + 1e-6)) {
				best = g;
				bestRoom = room;
				bestApart = apart;
			}
		}
		best.n++;
	}
	return gaps.flatMap((g) => Array.from({ length: g.n }, (_, i) => g.start + (g.size * (i + 1)) / (g.n + 1)));
}

// The longest path through an unbranched-or-branched (but ring-free) skeleton: the main chain.
// Among equally long paths, the one with the most carbons, then the one that doesn't end on a
// double-bonded atom (so a C=O points off the chain rather than along it).
export function longestChain(mol, keep) {
	const atoms = mol.atoms.flatMap((_, i) => (keep[i] ? [i] : []));
	if (!atoms.length) return [];
	const next = (i) => mol.adj[i].filter((e) => keep[e.to]);
	let best = [atoms[0]];
	let bestScore = [-1];
	const score = (path) => {
		const capped = [path[0], path.at(-1)].filter(
			(i) => next(i).length === 1 && next(i)[0].bond.order > 1 && mol.atoms[i].el !== "C",
		).length;
		return [path.length, path.filter((i) => mol.atoms[i].el === "C").length, -capped];
	};
	const walk = (path, seen) => {
		let grew = false;
		for (const { to } of next(path.at(-1))) {
			if (seen.has(to)) continue;
			grew = true;
			seen.add(to);
			path.push(to);
			walk(path, seen);
			path.pop();
			seen.delete(to);
		}
		if (grew) return;
		const s = score(path);
		const k = s.findIndex((x, j) => x !== bestScore[j]);
		if (k >= 0 && s[k] > (bestScore[k] ?? -Infinity)) {
			best = [...path];
			bestScore = s;
		}
	};
	for (const start of atoms) if (next(start).length <= 1) walk([start], new Set([start]));
	if (mol.atoms[best[0]].el !== "C" && mol.atoms[best.at(-1)].el === "C") best.reverse();
	return best;
}

// A layout on a square grid, the way structural formulas are written by hand: the main chain
// runs left to right and everything else points up, down or outwards. Only for molecules with
// no rings and no atom with more than four neighbours.
export function layoutGrid(mol) {
	const n = mol.atoms.length;
	const keep = mol.skeleton();
	const chain = longestChain(mol, keep);
	const onChain = new Set(chain);
	const stretch = new Map();
	const key = (a, b) => (a < b ? a + ":" + b : b + ":" + a);
	const size = (i, from) => {
		let total = 1;
		for (const { to } of mol.adj[i]) if (to !== from && !onChain.has(to)) total += size(to, i);
		return total;
	};
	const children = (i, from) =>
		mol.adj[i]
			.map((e) => e.to)
			.filter((v) => v !== from && !onChain.has(v))
			.sort((p, q) => size(q, i) - size(p, i));

	const attempt = () => {
		const pos = new Array(n).fill(null);
		const parent = new Array(n).fill(-1);
		const taken = new Map();
		let clash = null;
		const claim = (x, y, who) => {
			const k = x + "," + y;
			if (taken.has(k)) clash ??= [who, taken.get(k)];
			else taken.set(k, who);
		};
		const place = (i, from, x, y, dx, dy) => {
			const length = stretch.get(key(i, from)) || 1;
			for (let s = 1; s < length; s++) claim(x + dx * s, y + dy * s, i);
			x += dx * length;
			y += dy * length;
			pos[i] = { x, y };
			parent[i] = from;
			claim(x, y, i);
			// Onwards first, then to either side.
			const dirs = dx ? [[dx, 0], [0, 1], [0, -1]] : [[0, dy], [1, 0], [-1, 0]];
			children(i, from).forEach((child, k) => place(child, i, x, y, dirs[k][0], dirs[k][1]));
		};
		chain.forEach((a, k) => {
			pos[a] = { x: k, y: 0 };
			claim(k, 0, a);
		});
		chain.forEach((a, k) => {
			const L = [-1, 0];
			const R = [1, 0];
			const U = [0, -1];
			const D = [0, 1];
			const dirs =
				chain.length === 1 ? [L, R, D, U] : k === 0 ? [L, D, U] : k === chain.length - 1 ? [R, D, U] : [U, D];
			children(a, -1).forEach((child, j) => place(child, a, k, 0, dirs[j][0], dirs[j][1]));
		});
		return { pos, parent, clash };
	};

	for (let round = 0; ; round++) {
		const { pos, parent, clash } = attempt();
		if (!clash || round > 60) return pos;
		// Two branches ran into each other: lengthen the bond that one of them hangs from.
		let bond = null;
		for (const start of clash) {
			for (let v = start; parent[v] >= 0; v = parent[v]) {
				if (keep[v] && keep[parent[v]]) bond = key(v, parent[v]);
			}
			if (bond) break;
		}
		if (!bond) return pos;
		stretch.set(bond, (stretch.get(bond) || 1) + 1);
	}
}

function findRings(mol, keep) {
	const cycles = new Map();
	for (const bond of mol.bonds) {
		if (!keep[bond.a] || !keep[bond.b]) continue;
		// The shortest way round from one end of the bond to the other without using it.
		const prev = new Map([[bond.a, -1]]);
		const queue = [bond.a];
		for (let head = 0; head < queue.length && !prev.has(bond.b); head++) {
			for (const { to, bond: e } of mol.adj[queue[head]]) {
				if (e === bond || !keep[to] || prev.has(to)) continue;
				prev.set(to, queue[head]);
				queue.push(to);
			}
		}
		if (!prev.has(bond.b)) continue;
		const cycle = [];
		for (let v = bond.b; v !== -1; v = prev.get(v)) cycle.push(v);
		cycles.set([...cycle].sort((p, q) => p - q).join(), cycle);
	}
	const rings = [];
	const covered = new Set();
	for (const cycle of [...cycles.values()].sort((p, q) => p.length - q.length)) {
		const edges = cycle.map((v, i) => [v, cycle[(i + 1) % cycle.length]].sort((p, q) => p - q).join());
		if (edges.every((e) => covered.has(e))) continue;
		edges.forEach((e) => covered.add(e));
		rings.push(cycle);
	}
	return rings;
}

// Coordinates for a set of rings that share atoms: the first is a regular polygon, and each
// further ring is built outwards from the edge (or atom) it shares with what's already there.
function placeRings(rings) {
	const pts = new Map();
	const done = [];
	const todo = [...rings].sort((p, q) => q.length - p.length);
	const centroid = (list) => {
		const have = list.filter((v) => pts.has(v)).map((v) => pts.get(v));
		return { x: have.reduce((s, p) => s + p.x, 0) / have.length, y: have.reduce((s, p) => s + p.y, 0) / have.length };
	};
	const polygon = (ring, start, cx, cy, a0, dir) => {
		const r = 0.5 / Math.sin(Math.PI / ring.length);
		ring.forEach((_, k) => {
			const v = ring[(start + k) % ring.length];
			const a = a0 + (dir * k * TAU) / ring.length;
			if (!pts.has(v)) pts.set(v, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
		});
	};

	while (todo.length) {
		// Next, the ring that shares the most with what's placed.
		let pick = 0;
		if (done.length) {
			const shared = (ring) => ring.filter((v) => pts.has(v)).length;
			pick = todo.reduce((b, ring, k) => (shared(ring) > shared(todo[b]) ? k : b), 0);
		}
		const [ring] = todo.splice(pick, 1);
		const size = ring.length;
		const have = ring.filter((v) => pts.has(v));
		const r = 0.5 / Math.sin(Math.PI / size);
		if (!have.length) {
			polygon(ring, 0, 0, 0, UP, 1);
		} else if (have.length === 1) {
			// Spiro: the new ring sits directly away from the old one.
			const k = ring.indexOf(have[0]);
			const at = pts.get(have[0]);
			const from = centroid(done.find((d) => d.includes(have[0])));
			const away = Math.atan2(at.y - from.y, at.x - from.x);
			polygon(ring, k, at.x + r * Math.cos(away), at.y + r * Math.sin(away), away + Math.PI, 1);
		} else if (have.length === 2 && [1, size - 1].includes(Math.abs(ring.indexOf(have[0]) - ring.indexOf(have[1])))) {
			// Fused: mirror across the shared edge, away from the ring on its other side.
			let k = ring.indexOf(have[0]);
			if (ring[(k + 1) % size] !== have[1]) k = ring.indexOf(have[1]);
			const a = pts.get(ring[k]);
			const b = pts.get(ring[(k + 1) % size]);
			const other = centroid(done.find((d) => d.includes(ring[k]) && d.includes(ring[(k + 1) % size])) || [...pts.keys()]);
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			let nx = -(b.y - a.y);
			let ny = b.x - a.x;
			if (nx * (other.x - mx) + ny * (other.y - my) > 0) [nx, ny] = [-nx, -ny];
			const apothem = 0.5 / Math.tan(Math.PI / size);
			const cx = mx + nx * apothem;
			const cy = my + ny * apothem;
			const a0 = Math.atan2(a.y - cy, a.x - cx);
			const turn = Math.atan2(b.y - cy, b.x - cx) - a0;
			polygon(ring, k, cx, cy, a0, Math.sin(turn) > 0 ? 1 : -1);
		} else {
			// Bridged: bow each unplaced stretch outwards between the placed atoms at its ends.
			const all = centroid([...pts.keys()]);
			for (let k = 0; k < size; k++) {
				if (!pts.has(ring[k]) || pts.has(ring[(k + 1) % size])) continue;
				let end = k + 1;
				while (!pts.has(ring[end % size])) end++;
				const a = pts.get(ring[k]);
				const b = pts.get(ring[end % size]);
				const span = end - k;
				let nx = -(b.y - a.y);
				let ny = b.x - a.x;
				const len = Math.hypot(nx, ny) || 1;
				if (nx * (all.x - a.x) + ny * (all.y - a.y) > 0) [nx, ny] = [-nx, -ny];
				for (let j = 1; j < span; j++) {
					const t = j / span;
					const bow = Math.sin(Math.PI * t) * 0.45 * span;
					pts.set(ring[(k + j) % size], {
						x: a.x + (b.x - a.x) * t + (nx / len) * bow,
						y: a.y + (b.y - a.y) * t + (ny / len) * bow,
					});
				}
			}
		}
		done.push(ring);
	}
	return pts;
}

// A layout by angles, the way skeletal formulas are drawn: rings as regular polygons, chains as
// zigzags. With `hydrogens`, the hydrogens are then fanned out into the space left around each
// atom; without, they're left unplaced (null).
export function layoutAngular(mol, hydrogens) {
	const n = mol.atoms.length;
	const keep = mol.skeleton();
	const pos = new Array(n).fill(null);
	const near = (i) => mol.adj[i].map((e) => e.to).filter((v) => keep[v]);
	const rings = findRings(mol, keep);

	// Rings that share atoms are placed together, as one rigid system.
	const systems = [];
	for (const ring of rings) {
		const touching = systems.filter((s) => ring.some((v) => s.atoms.has(v)));
		const merged = { rings: [ring], atoms: new Set(ring), placed: false };
		for (const s of touching) {
			merged.rings.push(...s.rings);
			s.atoms.forEach((v) => merged.atoms.add(v));
			systems.splice(systems.indexOf(s), 1);
		}
		systems.push(merged);
	}
	const systemOf = (v) => systems.find((s) => s.atoms.has(v));

	// How far the molecule runs on beyond v, coming from `from`: the main chain goes that way.
	const reach = (v, from) => {
		const dist = new Map([[v, 0]]);
		const queue = [v];
		let far = 0;
		for (let head = 0; head < queue.length; head++) {
			for (const to of near(queue[head])) {
				if (to === from || dist.has(to) || pos[to]) continue;
				dist.set(to, dist.get(queue[head]) + 1);
				far = Math.max(far, dist.get(to));
				queue.push(to);
			}
		}
		return far;
	};
	const linear = (a) => {
		const orders = mol.adj[a].map((e) => e.bond.order);
		return orders.length === 2 && (orders.includes(3) || orders.every((o) => o === 2));
	};

	// Drops a ring system in. With `at`, that atom lands on `target` and the system is turned so
	// that it points away from the atom it's joined to.
	const placeSystem = (system, at, target, back) => {
		const local = placeRings(system.rings);
		system.placed = true;
		if (at == null) {
			local.forEach((p, v) => (pos[v] = p));
			return;
		}
		const p = local.get(at);
		const inRing = near(at).filter((v) => local.has(v));
		const cx = inRing.reduce((s, v) => s + local.get(v).x, 0) / inRing.length;
		const cy = inRing.reduce((s, v) => s + local.get(v).y, 0) / inRing.length;
		const turn = back - Math.atan2(p.y - cy, p.x - cx);
		const cos = Math.cos(turn);
		const sin = Math.sin(turn);
		local.forEach((q, v) => {
			const dx = q.x - p.x;
			const dy = q.y - p.y;
			pos[v] = { x: target.x + dx * cos - dy * sin, y: target.y + dx * sin + dy * cos };
		});
	};

	const grow = (a, sign) => {
		const angle = (v) => Math.atan2(pos[v].y - pos[a].y, pos[v].x - pos[a].x);
		const placed = near(a).filter((v) => pos[v]);
		const todo = near(a).filter((v) => !pos[v]);
		if (!todo.length) return;
		const hetero = (v) => (mol.atoms[v].el === "C" ? 0 : 1);
		todo.sort((p, q) => reach(q, a) - reach(p, a) || hetero(q) - hetero(p));
		const k = todo.length;
		let angles;
		if (!placed.length) {
			angles = k === 1 ? [deg(-30)] : fillGaps([], k, k % 2 ? UP : 0);
		} else if (placed.length === 1) {
			const on = angle(placed[0]) + Math.PI;
			if (k === 1) angles = [linear(a) ? on : on + sign * deg(60)];
			else if (k === 2) angles = [on + sign * deg(60), on - sign * deg(60)];
			else if (k === 3) angles = [on + sign * deg(60), on - sign * deg(20), on - sign * deg(100)];
			else angles = todo.map((_, i) => on + Math.PI + ((i + 1) * TAU) / (k + 1));
		} else {
			angles = fillGaps(placed.map(angle), k);
		}
		const next = [];
		const at = (angle) => ({ x: pos[a].x + Math.cos(angle), y: pos[a].y + Math.sin(angle) });
		const room = (angle) => {
			const t = at(angle);
			return Math.min(...pos.map((p, v) => (p && v !== a ? Math.hypot(p.x - t.x, p.y - t.y) : Infinity)));
		};
		todo.forEach((child, i) => {
			if (pos[child]) return;
			// If something is already where this atom would go, swing it round to a free spot,
			// or failing that to wherever is least crowded.
			const tries = [0, 60, -60, 120, -120, 30, -30, 90, -90].map((d) => angles[i] + deg(d));
			angles[i] = tries.find((angle) => room(angle) >= 0.75) ?? tries.reduce((p, q) => (room(q) > room(p) ? q : p));
			const target = at(angles[i]);
			const system = systemOf(child);
			if (system && !system.placed) {
				placeSystem(system, child, target, angles[i] + Math.PI);
				system.atoms.forEach((v) => next.push([v, 1]));
			} else {
				pos[child] = target;
				// The main chain turns the other way at each atom, which makes the zigzag.
				next.push([child, i === 0 && placed.length ? -sign : sign]);
			}
		});
		for (const [v, s] of next) grow(v, s);
	};

	if (systems.length) {
		const first = systems.reduce((p, q) => (q.atoms.size > p.atoms.size ? q : p));
		placeSystem(first);
		first.atoms.forEach((v) => grow(v, 1));
	} else {
		const chain = longestChain(mol, keep);
		// A small molecule built around one atom is drawn as a star around it.
		const hub = chain.length <= 3 && chain.length > 1 && near(chain[1]).length >= 3;
		const root = hub ? chain[1] : chain[0];
		pos[root] = { x: 0, y: 0 };
		grow(root, 1);
	}
	// Anything still unplaced isn't connected to the rest; park it alongside.
	keep.forEach((k, i) => {
		if (k && !pos[i]) {
			pos[i] = { x: Math.max(0, ...pos.filter(Boolean).map((p) => p.x)) + 2, y: 0 };
			grow(i, 1);
		}
	});

	if (hydrogens) {
		for (let a = 0; a < n; a++) {
			if (!keep[a]) continue;
			const hs = mol.adj[a].map((e) => e.to).filter((v) => !keep[v]);
			const used = near(a).map((v) => Math.atan2(pos[v].y - pos[a].y, pos[v].x - pos[a].x));
			fillGaps(used, hs.length).forEach((angle, k) => {
				pos[hs[k]] = { x: pos[a].x + 0.86 * Math.cos(angle), y: pos[a].y + 0.86 * Math.sin(angle) };
			});
		}
	}
	return { pos, rings };
}
