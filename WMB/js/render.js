import { ELEMENTS, COLORS } from "./elements.js";
import { layoutGrid, layoutAngular, fillGaps } from "./layout.js";
import { condensedPieces, chargeText } from "./condensed.js";
import { shapeAround, findCentre, isPolar, pull } from "./shape.js";

// Diagrams are drawn in a system font so that an exported file looks the same everywhere.
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const TAU = Math.PI * 2;
const r2 = (v) => Math.round(v * 100) / 100;
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// Text is measured by rule of thumb rather than by the browser, so that drawing needs no page.
function textWidth(s, size) {
	let em = 0;
	for (const c of s) {
		if (c >= "A" && c <= "Z") em += c === "I" ? 0.3 : c === "M" || c === "W" ? 0.86 : 0.69;
		else if (c >= "a" && c <= "z") em += c === "i" || c === "l" ? 0.24 : 0.54;
		else if (c === "(" || c === ")") em += 0.34;
		else em += 0.58;
	}
	return em * size;
}

function between(a, b) {
	const d = Math.abs(a - b) % TAU;
	return d > Math.PI ? TAU - d : d;
}

// Collects SVG elements and the box they cover.
class Sheet {
	constructor(ink) {
		this.ink = ink;
		this.out = [];
		this.x0 = this.y0 = Infinity;
		this.x1 = this.y1 = -Infinity;
	}

	cover(x, y, r = 0) {
		this.x0 = Math.min(this.x0, x - r);
		this.y0 = Math.min(this.y0, y - r);
		this.x1 = Math.max(this.x1, x + r);
		this.y1 = Math.max(this.y1, y + r);
	}

	line(x1, y1, x2, y2, width = 1.6) {
		this.cover(x1, y1, 1);
		this.cover(x2, y2, 1);
		this.out.push(
			`<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${this.ink}" stroke-width="${width}"/>`,
		);
	}

	dot(x, y, r, fill = this.ink) {
		this.cover(x, y, r);
		this.out.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="${fill}"/>`);
	}

	// A small ×, for the electrons drawn as crosses in a dot-and-cross diagram.
	cross(x, y, r, stroke = this.ink) {
		this.cover(x, y, r);
		this.out.push(
			`<path d="M${r2(x - r)} ${r2(y - r)}L${r2(x + r)} ${r2(y + r)}M${r2(x - r)} ${r2(y + r)}L${r2(x + r)} ${r2(y - r)}" stroke="${stroke}" stroke-width="1.2" fill="none"/>`,
		);
	}

	polygon(points, fill = this.ink) {
		for (const [x, y] of points) this.cover(x, y, 1);
		this.out.push(`<polygon points="${points.map(([x, y]) => `${r2(x)},${r2(y)}`).join(" ")}" fill="${fill}"/>`);
	}

	// Text centred vertically on y. Returns its width.
	text(x, y, s, size, anchor = "middle", fill = this.ink) {
		const width = textWidth(s, size);
		const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
		this.cover(left, y - size * 0.48);
		this.cover(left + width, y + size * 0.44);
		this.out.push(
			`<text x="${r2(x)}" y="${r2(y + size * 0.35)}" font-size="${r2(size)}" text-anchor="${anchor}" fill="${fill}">${escape(s)}</text>`,
		);
		return width;
	}
}

// The corner of an atom's label with the most room: where a charge or a δ goes. `used` holds
// the angles already taken by bonds and lone pairs, and gains the one chosen.
function corner(used) {
	const corners = [-0.25, -0.75, 0.25, 0.75].map((t) => t * Math.PI);
	const room = (angle) => Math.min(Math.PI, ...used.map((u) => between(u, angle)));
	const angle = corners.reduce((p, q) => (room(q) > room(p) + 1e-6 ? q : p));
	used.push(angle);
	return angle;
}

// δ+ or δ− for an atom on the losing or winning end of its polar bonds, or "" for neither.
function partial(mol, i) {
	if (mol.atoms[i].charge) return "";
	const lean = mol.adj[i].reduce((sum, e) => sum - Math.sign(pull(mol, i, e.to)), 0);
	return lean > 0 ? "δ−" : lean < 0 ? "δ+" : "";
}

// Which atoms' electrons are crosses in a dot-and-cross diagram: neighbours alternate, so that
// each bond shows one electron from either atom.
function crosses(mol) {
	const mark = new Array(mol.atoms.length).fill(-1);
	for (let start = 0; start < mark.length; start++) {
		if (mark[start] >= 0) continue;
		mark[start] = 0;
		const queue = [start];
		for (let head = 0; head < queue.length; head++) {
			for (const { to } of mol.adj[queue[head]]) {
				if (mark[to] < 0) {
					mark[to] = 1 - mark[queue[head]];
					queue.push(to);
				}
			}
		}
	}
	return mark;
}

function structureLayout(mol, style) {
	if (style === "skeletal") return layoutAngular(mol, false);
	const crowded = mol.atoms.some((_, i) => mol.degree(i) > 4);
	if (mol.cyclic || crowded) return layoutAngular(mol, true);
	return { pos: layoutGrid(mol), rings: [] };
}

// Draws one molecule as a Lewis, structural or skeletal diagram.
function drawStructure(mol, o, layout = structureLayout(mol, o.style)) {
	const sheet = new Sheet(o.ink);
	const skeletal = o.style === "skeletal";
	const lewis = o.style === "lewis";
	const atoms = mol.atoms;
	const dotted = lewis && o.bonds !== "lines";
	const mark = lewis && o.bonds === "cross" ? crosses(mol) : null;
	// One electron, as a dot or as the cross of the atom it came from.
	const electron = (x, y, i, fill) => (mark?.[i] ? sheet.cross(x, y, 2.1, fill) : sheet.dot(x, y, 1.7, fill));
	const unit = skeletal ? 38 : 46;
	const size = skeletal ? 16 : 20;
	const P = layout.pos.map((p) => p && { x: p.x * unit, y: p.y * unit });
	const drawn = (i) => P[i] != null;
	const colour = (i) => (o.colour && COLORS[atoms[i].el]) || o.ink;
	const near = (i) => mol.adj[i].filter((e) => drawn(e.to));
	const angleTo = (i, j) => Math.atan2(P[j].y - P[i].y, P[j].x - P[i].x);

	// What's written at each atom. In a skeletal diagram a carbon is just a corner, and other
	// atoms carry their hydrogens in the label.
	const labels = atoms.map((atom, i) => {
		if (!drawn(i)) return null;
		const h = mol.degree(i) - near(i).length;
		if (skeletal && atom.el === "C" && near(i).length && !atom.charge && !atom.rad) return null;
		return { text: atom.el, width: textWidth(atom.el, size), h };
	});
	// How far a label reaches from its atom's centre in a given direction.
	const reach = (i, angle) => {
		const label = labels[i];
		if (!label) return 0;
		const rx = label.width / 2 + size * 0.17;
		const ry = size * 0.56;
		return 1 / Math.hypot(Math.cos(angle) / rx, Math.sin(angle) / ry);
	};

	for (const bond of mol.bonds) {
		const { a, b, order } = bond;
		if (!drawn(a) || !drawn(b)) continue;
		const angle = angleTo(a, b);
		const ux = Math.cos(angle);
		const uy = Math.sin(angle);
		const nx = -uy;
		const ny = ux;
		const ra = reach(a, angle);
		const rb = reach(b, angle + Math.PI);
		const x1 = P[a].x + ux * ra;
		const y1 = P[a].y + uy * ra;
		const x2 = P[b].x - ux * rb;
		const y2 = P[b].y - uy * rb;

		if (dotted) {
			// Each shared pair as two electrons side by side, one from either atom, the pairs
			// spaced along the bond.
			const mx = (x1 + x2) / 2;
			const my = (y1 + y2) / 2;
			for (let k = 0; k < order; k++) {
				const along = (k - (order - 1) / 2) * 6.6;
				[a, b].forEach((from, j) => {
					const side = j ? 3.4 : -3.4;
					electron(mx + ux * along + nx * side, my + uy * along + ny * side, from, colour(from));
				});
			}
			continue;
		}

		const gap = skeletal ? 4.6 : 5;
		const stroke = (off, trim1 = 0, trim2 = 0) =>
			sheet.line(
				x1 + nx * off + ux * trim1,
				y1 + ny * off + uy * trim1,
				x2 + nx * off - ux * trim2,
				y2 + ny * off - uy * trim2,
			);
		if (order === 1) {
			stroke(0);
		} else if (order === 3) {
			stroke(0);
			stroke(gap);
			stroke(-gap);
		} else {
			// A double bond sits either side of the line between its atoms, except in a skeletal
			// chain or ring, where the second line goes inside the corner or the ring.
			const ends = (i, j) => near(i).length === 1 && (labels[i] || near(j).length === 1);
			if (!skeletal || ends(a, b) || ends(b, a)) {
				stroke(gap / 2);
				stroke(-gap / 2);
			} else {
				const mx = (P[a].x + P[b].x) / 2;
				const my = (P[a].y + P[b].y) / 2;
				const ring = layout.rings.find((r) => r.includes(a) && r.includes(b));
				let lean = 0;
				if (ring) {
					const cx = ring.reduce((s, v) => s + P[v].x, 0) / ring.length;
					const cy = ring.reduce((s, v) => s + P[v].y, 0) / ring.length;
					lean = nx * (cx - mx) + ny * (cy - my);
				} else {
					for (const i of [a, b]) {
						for (const { to } of near(i)) {
							if (to !== a && to !== b) lean += Math.sign(nx * (P[to].x - mx) + ny * (P[to].y - my));
						}
					}
				}
				const side = lean < 0 ? -1 : 1;
				stroke(0);
				stroke(side * gap, labels[a] ? 0 : gap * 0.9, labels[b] ? 0 : gap * 0.9);
			}
		}
	}

	atoms.forEach((atom, i) => {
		const label = labels[i];
		if (!label) return;
		const { x, y } = P[i];
		const fill = colour(i);
		sheet.text(x, y, label.text, size, "middle", fill);
		const used = near(i).map((e) => angleTo(i, e.to));

		if (skeletal && label.h) {
			// Hydrogens go on whichever side is clear of bonds: beside the symbol if they can,
			// above or below it if not.
			const clear = (angle) => Math.min(Math.PI, ...used.map((u) => between(u, angle)));
			const alone = !used.length;
			let side = alone && ELEMENTS[atom.el][2] >= 6 ? Math.PI : 0;
			if (!alone) {
				side = clear(0) >= clear(Math.PI) ? 0 : Math.PI;
				if (clear(side) < 0.9) side = clear(-Math.PI / 2) >= clear(Math.PI / 2) ? -Math.PI / 2 : Math.PI / 2;
			}
			const count = label.h > 1 ? String(label.h) : "";
			const small = size * 0.7;
			const wH = textWidth("H", size);
			const wCount = textWidth(count, small);
			let left = x - wH / 2;
			let top = y;
			if (side === 0) left = x + label.width / 2 + 0.5;
			else if (side === Math.PI) left = x - label.width / 2 - 0.5 - wH - wCount;
			else top = y + Math.sign(side) * size * 0.98;
			sheet.text(left, top, "H", size, "start", fill);
			if (count) sheet.text(left + wH, top + size * 0.3, count, small, "start", fill);
			used.push(side);
		}

		if (lewis) {
			const spots = fillGaps(used, atom.lp + atom.rad);
			spots.forEach((angle, k) => {
				// Pairs that share a gap sit a little further out so their dots don't run together.
				const tight = spots.some((other, j) => j !== k && between(other, angle) < 1.3);
				const d = reach(i, angle) + (tight ? 7 : 4.6);
				const cx = x + Math.cos(angle) * d;
				const cy = y + Math.sin(angle) * d;
				// A lone pair is two dots side by side; an unpaired electron is one.
				for (const off of k < atom.lp ? [-3.3, 3.3] : [0]) {
					electron(cx - Math.sin(angle) * off, cy + Math.cos(angle) * off, i, fill);
				}
			});
			used.push(...spots);
		}

		// Charges go in whichever corner is furthest from bonds and lone pairs.
		const tags = [o.formal && atom.charge ? chargeText(atom.charge) : "", o.partial && !skeletal ? partial(mol, i) : ""];
		for (const tag of tags.filter(Boolean)) {
			const angle = corner(used);
			const d = reach(i, angle) + size * 0.36 + (tag.length > 1 ? 3 : 0);
			sheet.text(x + Math.cos(angle) * d, y + Math.sin(angle) * d, tag, size * 0.64, "middle", fill);
		}
	});
	return sheet;
}

// Draws a molecule in three dimensions around its central atom: bonds in the page as lines,
// bonds towards you as wedges, bonds away from you as dashes. Returns null for a molecule that
// isn't one atom with everything else around it. `plan` is shared between resonance forms so
// that each atom stays where it is from one form to the next.
function drawShape(mol, o, plan) {
	const atoms = mol.atoms;
	const two = atoms.length === 2 && mol.bonds.length === 1;
	const found = two ? { centre: 0, ends: [1] } : findCentre(mol);
	if (!found) return null;
	const shape = two ? { name: "Linear", angle: "", bonds: [[0, "plain", [1, 0, 0]]], lone: [] } : shapeAround(mol, found.centre);
	if (!shape) return null;

	const { centre } = found;
	const orderTo = (end) => mol.adj[centre].find((e) => e.to === end).bond.order;
	// Double and triple bonds take the in-page positions, where their lines can be drawn.
	plan.ends ??= [...found.ends].sort((p, q) => orderTo(q) - orderTo(p));
	const ends = plan.ends;

	const sheet = new Sheet(o.ink);
	const size = 20;
	const unit = 58;
	const colour = (i) => (o.colour && COLORS[atoms[i].el]) || o.ink;
	const ellipse = (width, angle) => 1 / Math.hypot(Math.cos(angle) / (width / 2 + size * 0.17), Math.sin(angle) / (size * 0.56));
	const widthOf = (i) => {
		const h = i === centre ? 0 : mol.degree(i) - 1;
		return textWidth(atoms[i].el, size) + (h ? textWidth("H", size) : 0) + (h > 1 ? textWidth(String(h), size * 0.7) : 0);
	};
	const tag = (i, x, y, used) => {
		const tags = [o.formal && atoms[i].charge ? chargeText(atoms[i].charge) : "", o.partial ? partial(mol, i) : ""];
		for (const text of tags.filter(Boolean)) {
			const angle = corner(used);
			const d = ellipse(widthOf(i), angle) + size * 0.36 + (text.length > 1 ? 3 : 0);
			sheet.text(x + Math.cos(angle) * d, y + Math.sin(angle) * d, text, size * 0.64, "middle", colour(i));
		}
	};

	const taken = [];
	ends.forEach((end, k) => {
		const [degrees, kind] = shape.bonds[k];
		const angle = (-degrees * Math.PI) / 180;
		taken.push(angle);
		const ux = Math.cos(angle);
		const uy = Math.sin(angle);
		const nx = -uy;
		const ny = ux;
		const x = ux * unit;
		const y = uy * unit;
		const ra = ellipse(widthOf(centre), angle);
		const rb = ellipse(widthOf(end), angle + Math.PI);
		const [x1, y1, x2, y2] = [ux * ra, uy * ra, x - ux * rb, y - uy * rb];
		if (kind === "wedge") {
			sheet.polygon([[x1, y1], [x2 + nx * 4, y2 + ny * 4], [x2 - nx * 4, y2 - ny * 4]]);
		} else if (kind === "dash") {
			for (let j = 0; j < 6; j++) {
				const t = (j + 0.5) / 6;
				const half = 0.9 + 3.3 * t;
				const [px, py] = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
				sheet.line(px + nx * half, py + ny * half, px - nx * half, py - ny * half, 1.3);
			}
		} else {
			const order = orderTo(end);
			for (let j = 0; j < order; j++) {
				const off = (j - (order - 1) / 2) * 5;
				sheet.line(x1 + nx * off, y1 + ny * off, x2 + nx * off, y2 + ny * off);
			}
		}

		// The atom on the end, with any hydrogens it carries written on its outer side.
		const h = mol.degree(end) - 1;
		const count = h > 1 ? String(h) : "";
		const pieces = [[atoms[end].el, size, 0]];
		if (h) {
			const hydrogens = [["H", size, 0], ...(count ? [[count, size * 0.7, size * 0.3]] : [])];
			ux < -0.2 ? pieces.unshift(...hydrogens) : pieces.push(...hydrogens);
		}
		let left = x - widthOf(end) / 2;
		for (const [text, at, drop] of pieces) left += sheet.text(left, y + drop, text, at, "start", colour(end));
		tag(end, x, y, [angle + Math.PI]);
	});

	sheet.text(0, 0, atoms[centre].el, size, "middle", colour(centre));
	const lone = two ? 0 : atoms[centre].lp;
	shape.lone.forEach((degrees, k) => {
		const angle = (-degrees * Math.PI) / 180;
		taken.push(angle);
		const d = ellipse(widthOf(centre), angle) + 5;
		for (const off of k < lone ? [-3.3, 3.3] : [0]) {
			sheet.dot(Math.cos(angle) * d - Math.sin(angle) * off, Math.sin(angle) * d + Math.cos(angle) * off, 1.7, colour(centre));
		}
	});
	tag(centre, 0, 0, taken);

	// Polarity is only a fair question for a neutral molecule whose outer atoms are bare.
	const caption = [shape.name, shape.angle];
	if (!mol.charge && ends.every((end) => mol.degree(end) === 1)) {
		caption.push(isPolar(mol, centre, shape, ends) ? "polar" : "non-polar");
	}
	return { sheet, caption: caption.filter(Boolean).join(" · ") };
}

// The double-headed arrow between resonance forms.
function drawArrow(o) {
	const sheet = new Sheet(o.ink);
	sheet.line(0, 0, 30, 0, 1.4);
	for (const [x, d] of [[0, 5], [30, -5]]) {
		sheet.line(x, 0, x + d, -4, 1.4);
		sheet.line(x, 0, x + d, 4, 1.4);
	}
	sheet.cover(0, -8);
	sheet.cover(30, 8);
	return sheet;
}

// Draws one species as a line of text with subscripts and superscripts.
function drawText(pieces, o) {
	const sheet = new Sheet(o.ink);
	const size = 26;
	let x = 0;
	for (const piece of pieces) {
		const small = piece.kind ? size * 0.68 : size;
		const dy = piece.kind === "sub" ? size * 0.3 : piece.kind === "sup" ? -size * 0.36 : 0;
		x += sheet.text(x, dy, piece.t, small, "start") + (piece.kind ? 0.5 : 0);
	}
	return sheet;
}

// Renders a list of { mol, count } side by side and returns the SVG along with its size.
//   style:     "lewis" | "structural" | "skeletal" | "condensed" | "shape"
//   charges:   "auto" (ions in square brackets, formal charges otherwise) | "formal" | "none"
//   bonds:     "lines" | "dots" | "cross" (dots and crosses) — Lewis only
//   partial:   mark δ+ and δ− on the atoms of polar bonds
//   resonance: draw every resonance form, with arrows between them
//   colour:    colour atoms by element
//   ink:       the drawing colour;  background: an optional fill behind it;  scale: output size
export function render(parts, options = {}) {
	const o = { style: "lewis", charges: "auto", bonds: "lines", ink: "#000", scale: 1, ...options };
	const notes = [];
	const text = o.style === "condensed";

	const draw = (mol, count, plan) => {
		const bracket = !text && o.charges === "auto" && mol.charge !== 0;
		const formal = o.charges === "formal" || (o.charges === "auto" && !bracket);
		let sheet;
		let caption = "";
		if (text) {
			const { pieces, fallback } = condensedPieces(mol, o.charges !== "none");
			if (fallback) notes.push("Rings don't have a condensed formula, so this is the molecular formula.");
			sheet = drawText(pieces, o);
		} else if (o.style === "shape") {
			const shaped = drawShape(mol, { ...o, formal }, plan);
			if (shaped) {
				({ sheet, caption } = shaped);
			} else {
				// Too big to draw around one atom: name the shape at each atom that has one instead.
				plan.layout ??= structureLayout(mol, "structural");
				sheet = drawStructure(mol, { ...o, style: "structural", formal }, plan.layout);
				const around = mol.atoms.flatMap((atom, i) => {
					const shape = shapeAround(mol, i);
					return shape ? [`${atom.el}: ${shape.name.toLowerCase()}, ${shape.angle}`] : [];
				});
				if (around.length) notes.push(`Shape around each atom — ${[...new Set(around)].join("; ")}.`);
			}
		} else {
			plan.layout ??= structureLayout(mol, o.style);
			sheet = drawStructure(mol, { ...o, formal }, plan.layout);
		}
		const top = sheet.y0;
		const bottom = sheet.y1;
		if (bracket) {
			const pad = 9;
			const [x0, y0, x1, y1] = [sheet.x0 - pad, sheet.y0 - pad, sheet.x1 + pad, sheet.y1 + pad];
			const arm = 7;
			for (const [x, dx] of [[x0, arm], [x1, -arm]]) {
				sheet.out.push(
					`<path d="M${r2(x + dx)} ${r2(y0)}H${r2(x)}V${r2(y1)}H${r2(x + dx)}" fill="none" stroke="${o.ink}" stroke-width="1.6" stroke-linejoin="round"/>`,
				);
			}
			sheet.cover(x0, y0, 1);
			sheet.cover(x1, y1, 1);
			sheet.text(x1 + 4, y0 + 3, chargeText(mol.charge), 15, "start");
		}
		if (count > 1) sheet.text(sheet.x0 - 5, (top + bottom) / 2, String(count), text ? 26 : 22, "end");
		if (caption) sheet.text((sheet.x0 + sheet.x1) / 2, sheet.y1 + 20, caption, 13.5);
		return { sheet, mid: (top + bottom) / 2 };
	};

	const blocks = [];
	for (const { mol, count } of parts) {
		const forms = o.resonance && !text && mol.forms ? mol.forms : [mol];
		// Where each atom goes is decided once and shared, so that only the electrons move
		// between one resonance form and the next.
		const plan = {};
		forms.forEach((form, k) => {
			if (k) blocks.push({ sheet: drawArrow(o), mid: 0 });
			blocks.push(draw(form, k ? 1 : count, plan));
		});
	}

	// Side by side, centres level.
	const pad = 14;
	const spacing = 26;
	let x = 0;
	let y0 = Infinity;
	let y1 = -Infinity;
	const groups = blocks.map(({ sheet, mid }) => {
		const dx = x - sheet.x0;
		x += sheet.x1 - sheet.x0 + spacing;
		y0 = Math.min(y0, sheet.y0 - mid);
		y1 = Math.max(y1, sheet.y1 - mid);
		return `<g transform="translate(${r2(dx)} ${r2(-mid)})">${sheet.out.join("")}</g>`;
	});
	const width = x - spacing + pad * 2;
	const height = y1 - y0 + pad * 2;
	const box = `${r2(-pad)} ${r2(y0 - pad)} ${r2(width)} ${r2(height)}`;
	const background = o.background
		? `<rect x="${r2(-pad)}" y="${r2(y0 - pad)}" width="${r2(width)}" height="${r2(height)}" fill="${o.background}"/>`
		: "";
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="${r2(width * o.scale)}" height="${r2(height * o.scale)}" ` +
		`font-family="${FONT}" stroke-linecap="round">${background}${groups.join("")}</svg>`;
	return { svg, width, height, notes };
}
