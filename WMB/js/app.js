import { interpret } from "./parse.js";
import { render } from "./render.js";
import { composition } from "./mol.js";
import { chargeText } from "./condensed.js";

const EXAMPLES = ["ethanol", "CH3COOH", "SO4 2-", "XeF4", "2-methylpropan-2-ol", "NH4+", "NaCl", "benzene", "aspirin"];
const KINDS = { name: "a name", formula: "a formula", smiles: "SMILES" };
const STYLES = ["lewis", "structural", "skeletal", "condensed", "shape"];
const SWITCHES = ["partial", "resonance", "colour", "expanded"];
const still = matchMedia("(prefers-reduced-motion: reduce)");
const STORE = "wmb:state";

const $ = (id) => document.getElementById(id);
const app = $("app");
const view = $("view");
const message = $("error");

const state = {
	q: "ethanol",
	mode: "auto",
	style: "lewis",
	charges: "auto",
	// How a Lewis diagram draws its bonds: "lines", "dots" or "cross" (dots and crosses).
	bonds: "lines",
	partial: false,
	resonance: false,
	expanded: false,
	colour: false,
	// Exported images are drawn in black unless this is on.
	white: false,
	panel: true,
};

// What's on screen: the species read from the query, or null if it couldn't be read.
let current = null;

function restore() {
	try {
		const saved = JSON.parse(localStorage.getItem(STORE) || "{}");
		for (const key of Object.keys(state)) if (typeof saved[key] === typeof state[key]) state[key] = saved[key];
	} catch {
		// Private windows have no storage; the defaults will do.
	}
	// A link carries what to draw and how: #q=ethanol&style=skeletal
	const link = new URLSearchParams(location.hash.slice(1));
	if (link.has("q")) state.q = link.get("q");
	if (link.has("style")) state.style = link.get("style");
	if (!STYLES.includes(state.style)) state.style = "lewis";
}

function remember() {
	try {
		localStorage.setItem(STORE, JSON.stringify(state));
	} catch {
		// See restore().
	}
	const link = new URLSearchParams({ q: state.q, style: state.style });
	history.replaceState(null, "", state.q.trim() ? "#" + link : location.pathname);
}

function options(extra) {
	const { style, charges, bonds, partial, resonance, colour } = state;
	return { style, charges, bonds, partial, resonance, colour, ...extra };
}

function say(text) {
	message.textContent = text;
	message.hidden = !text;
}

function draw() {
	for (const button of $("style").children) {
		const chosen = button.dataset.value === state.style;
		button.setAttribute("aria-checked", String(chosen));
		// One stop for Tab; the arrow keys move within the group.
		button.tabIndex = chosen ? 0 : -1;
	}
	for (const key of SWITCHES) $(key).setAttribute("aria-checked", String(state[key]));
	$("white").setAttribute("aria-pressed", String(state.white));
	$("ink-name").textContent = state.white ? "White ink" : "Black ink";
	// Options that the chosen kind of diagram has no use for are dimmed, not removed, so that
	// nothing in the panel moves.
	$("bonds").disabled = state.style !== "lewis";
	$("partial").disabled = state.style === "skeletal" || state.style === "condensed";
	$("resonance").disabled = state.style === "condensed";
	app.dataset.panel = state.panel ? "open" : "closed";
	$("panel").inert = !state.panel;
	$("panel-show").inert = state.panel;

	$("meta").textContent = "";
	$("notes").textContent = "";
	view.textContent = "";
	say("");
	current = null;
	try {
		current = interpret(state.q, state.mode, { expanded: state.expanded });
		if (!current) {
			say("Type a name, a formula or SMILES to draw it.");
		} else {
			const drawn = render(current.parts, options({ ink: "currentColor", scale: 1.5 }));
			view.innerHTML = drawn.svg;
			describe([...current.notes, ...drawn.notes]);
		}
	} catch (error) {
		say(error.message);
	}
	for (const id of ["copy", "png", "svg"]) $(id).disabled = !current;
}

// The lines at the foot of the panel: how the text was read, the formula and the molar mass.
function describe(notes) {
	const { formula, mass, charge } = composition(current.parts);
	const what = document.createElement("b");
	for (const [el, n] of formula) {
		what.append(el);
		if (n > 1) what.append(Object.assign(document.createElement("sub"), { textContent: n }));
	}
	if (charge) what.append(Object.assign(document.createElement("sup"), { textContent: chargeText(charge) }));
	$("meta").append(`Read as ${KINDS[current.kind]} · `, what, ` · ${mass.toFixed(2)} g/mol`);
	for (const note of new Set(notes)) {
		$("notes").append(Object.assign(document.createElement("li"), { textContent: note }));
	}
}

function exported() {
	return render(current.parts, options({ ink: state.white ? "#ffffff" : "#000000" }));
}

async function pngBlob() {
	const { svg, width, height } = exported();
	const image = new Image();
	image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
	await image.decode();
	// Four times the drawn size, so it stays sharp in a document.
	const scale = 4;
	const canvas = document.createElement("canvas");
	canvas.width = Math.ceil(width * scale);
	canvas.height = Math.ceil(height * scale);
	canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
	return new Promise((resolve, reject) =>
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no image"))), "image/png"),
	);
}

function save(blob, extension) {
	const name = state.q.trim().replace(/[^\w()+\-,]+/g, "_").slice(0, 60) || "diagram";
	const link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = `${name}.${extension}`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Shows an element, or plays its leaving animation and then hides it. Showing it again while
// it's on its way out simply brings it back.
function present(el, shown) {
	if (shown) {
		delete el.dataset.leaving;
		el.hidden = false;
	} else if (!el.hidden && !("leaving" in el.dataset)) {
		el.dataset.leaving = "";
		const gone = () => {
			if (!("leaving" in el.dataset)) return;
			el.hidden = true;
			delete el.dataset.leaving;
		};
		el.addEventListener("animationend", gone, { once: true });
		// In case the animation never runs (a background tab, say).
		setTimeout(gone, 400);
	}
}

let noticeTimer = 0;
function notice(text) {
	const el = $("notice");
	el.textContent = text;
	// Hidden and shown again so that the entrance plays each time.
	el.hidden = true;
	void el.offsetWidth;
	present(el, true);
	clearTimeout(noticeTimer);
	noticeTimer = setTimeout(() => present(el, false), 2200);
}

function help(open) {
	const sheet = $("help").firstElementChild;
	if (open) {
		present($("help"), true);
		// The sheet grows out of the Help button, so it's clear where it came from.
		// (Measured by offset, which ignores the scale the sheet is already animating from.)
		const from = $("help-open").getBoundingClientRect();
		const x = from.x + from.width / 2 - sheet.offsetLeft;
		const y = from.y + from.height / 2 - sheet.offsetTop;
		sheet.style.setProperty("--origin", `${x}px ${y}px`);
	} else {
		present($("help"), false);
	}
	// While the sheet is up, nothing behind it can be reached.
	for (const el of app.children) if (el !== $("help") && el !== $("notice")) el.inert = open;
	if (!open) {
		$("panel").inert = !state.panel;
		$("panel-show").inert = state.panel;
	}
	$("help-open").setAttribute("aria-expanded", String(open));
	(open ? $("help-close") : $("help-open")).focus();
}

// Showing or hiding the panel changes where the middle of the free space is. The diagram is put
// straight into its new place and then slid there from wherever it was on screen, so the move
// is a transform, and can be turned round partway.
function slide(update) {
	const before = view.getBoundingClientRect();
	update();
	const after = view.getBoundingClientRect();
	const dx = before.x + before.width / 2 - (after.x + after.width / 2);
	const dy = before.y + before.height / 2 - (after.y + after.height / 2);
	if (still.matches || (!dx && !dy)) return;
	view.getAnimations().forEach((a) => a.cancel());
	view.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
		duration: 420,
		easing: "cubic-bezier(0.32, 0.72, 0, 1)",
	});
}

function change() {
	remember();
	draw();
}

function bind() {
	const query = $("query");
	for (const text of EXAMPLES) {
		const chip = Object.assign(document.createElement("button"), { type: "button", textContent: text });
		chip.addEventListener("click", () => {
			query.value = state.q = text;
			change();
		});
		$("examples").append(chip);
	}

	query.value = state.q;
	query.addEventListener("input", () => {
		state.q = query.value;
		change();
	});
	$("style").addEventListener("click", (event) => {
		const button = event.target.closest("button");
		if (!button) return;
		state.style = button.dataset.value;
		change();
	});
	// Left and right move through the kinds of diagram, as they would through radio buttons.
	$("style").addEventListener("keydown", (event) => {
		const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
		if (!step) return;
		state.style = STYLES[(STYLES.indexOf(state.style) + step + STYLES.length) % STYLES.length];
		change();
		$("style").querySelector('[aria-checked="true"]').focus();
	});
	if (!["lines", "dots", "cross"].includes(state.bonds)) state.bonds = "lines";
	for (const key of ["mode", "charges", "bonds"]) {
		$(key).value = state[key];
		$(key).addEventListener("change", () => {
			state[key] = $(key).value;
			change();
		});
	}
	for (const key of SWITCHES) {
		$(key).addEventListener("click", () => {
			state[key] = !state[key];
			change();
		});
	}
	$("white").addEventListener("click", () => {
		state.white = !state.white;
		change();
	});
	for (const [id, open] of [["panel-hide", false], ["panel-show", true]]) {
		$(id).addEventListener("click", () => {
			state.panel = open;
			slide(change);
			(open ? query : $("panel-show")).focus();
		});
	}

	$("copy").addEventListener("click", async () => {
		try {
			// The image is handed over as a promise so that Safari still counts this as the click.
			await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob() })]);
			notice("Copied");
		} catch {
			notice("This browser can't copy images — save the PNG instead");
		}
	});
	$("png").addEventListener("click", async () => {
		try {
			save(await pngBlob(), "png");
		} catch {
			notice("Couldn't make the PNG — try the SVG instead");
		}
	});
	$("svg").addEventListener("click", () => save(new Blob([exported().svg], { type: "image/svg+xml" }), "svg"));

	$("help-open").addEventListener("click", () => help(true));
	$("help-close").addEventListener("click", () => help(false));
	$("help").addEventListener("click", (event) => {
		if (event.target === $("help")) help(false);
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !$("help").hidden && !("leaving" in $("help").dataset)) help(false);
	});

	$("theme").addEventListener("click", () => {
		const root = document.documentElement;
		root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
		try {
			localStorage.setItem("wmb:theme", root.dataset.theme);
		} catch {
			// See restore().
		}
	});
}

restore();
bind();
draw();
