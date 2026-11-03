// WBTS: a scribble pad. Everything lives in memory; nothing is saved.
(function () {
	"use strict";

	var board = document.getElementById("board");
	var tileLayer = document.getElementById("tiles");
	var gridEl = document.getElementById("grid");
	var liveCanvas = document.getElementById("live");
	var live = liveCanvas.getContext("2d");
	var zoomBtn = document.getElementById("zoom");

	// Sizes on the page, so a line is equally thick at any zoom, like ink on paper.
	// Fine, medium and bold, for each tool.
	var SIZES = {
		pen: [1.6, 3.2, 6.5],
		highlighter: [10, 18, 30],
		eraser: [12, 28, 60],
		// A ball pen draws a little under its named width, so these run thicker to come
		// out at the same weight as a hand-drawn line.
		shape: [2.3, 4.2, 8],
		graph: [1.2, 2.2, 3.6],
	};
	// The size picked for each tool, as an index into SIZES.
	var sizeChoice = { pen: 1, highlighter: 1, eraser: 1, shape: 1, graph: 1 };
	var MIN_ZOOM = 0.1;
	var MAX_ZOOM = 8;
	var GRID = 24;

	// Every stroke, picture and "clear" in order, in page coordinates.
	var actions = [];
	// Edits waiting to be taken back, and ones already taken back. Each knows how to
	// undo and redo itself, so moving a selection can be taken back like a stroke can.
	var undoStack = [];
	var redoStack = [];

	var tool = "pen";
	// The lasso picks up what's already on the page instead of adding to it.
	var LASSO = "lasso";
	// Dragged out rather than drawn: straight lines, arrows, circles and boxes, and a
	// set of axes with sums drawn on it.
	var GRAPH = "graph";
	// fountain, ball or brush, like GoodNotes.
	var penType = "fountain";
	// The colour picked for each inking tool. Highlighter colours start with "hl-".
	var colorChoice = { pen: "ink", highlighter: "hl-yellow" };
	// The pen or highlighter, whichever was used last. The eraser shows its colours.
	var inkTool = "pen";
	var palette = {};
	var theme = "light";

	// Every ink colour in both themes. The toolbar swatches and copied images use these too.
	var THEMES = {
		light: {
			paper: "#fbfaf7",
			ink: "#1d1d1f",
			blue: "#2160d8",
			red: "#d23a32",
			green: "#1f8a4c",
			purple: "#7b3fd1",
			orange: "#e07000",
			"hl-yellow": "#ffd400",
			"hl-orange": "#ffa04d",
			"hl-pink": "#ff7ab8",
			"hl-purple": "#b892ff",
			"hl-blue": "#5ac8fa",
			"hl-green": "#7ee081",
		},
		dark: {
			paper: "#000000",
			ink: "#f2f2f4",
			blue: "#5b93ff",
			red: "#ff6a5f",
			green: "#4cd07d",
			purple: "#b48cff",
			orange: "#ff9f43",
			"hl-yellow": "#ffd60a",
			"hl-orange": "#ff9f43",
			"hl-pink": "#ff6fb5",
			"hl-purple": "#a77bff",
			"hl-blue": "#4fb8ff",
			"hl-green": "#5fd77f",
		},
	};
	// Highlighter ink is see-through, so writing underneath still shows.
	var HIGHLIGHT_ALPHA = { light: 0.45, dark: 0.42 };

	// Where the page sits on screen: screen = page * s + (x, y).
	// The board fills the window, so screen and client coordinates are the same.
	var view = { x: 0, y: 0, s: 1 };
	var dpr = 1;
	var width = 0;
	var height = 0;

	// The stroke being drawn right now, and which pointer is drawing it.
	var current = null;
	var activeId = null;
	var activeType = null;

	// Once the Pencil has been used, fingers only move and zoom the page.
	var pencilSeen = false;

	// Fingers on the screen that move the page, by pointer id.
	var touches = new Map();
	// Fingers that were down while the Pencil wrote, most likely a palm. Ignored until lifted.
	var ignored = new Set();
	// The previous centre and spread of the fingers.
	var gesture = null;
	// After a gesture, fingers can't draw until every finger has lifted.
	var touchLock = false;

	var frame = 0;
	var dirty = true;
	var liveDirty = true;
	var shownZoom = "";
	// The dot spacing the grid was last painted at, in CSS pixels, and its transform.
	var gridPainted = 0;
	var shownGrid = "";

	// ---------- View ----------

	// The shift is rounded to whole device pixels so tiles (see Rendering) line up exactly.
	function applyView(ctx) {
		var k = dpr * view.s;
		ctx.setTransform(k, 0, 0, k, Math.round(dpr * view.x), Math.round(dpr * view.y));
	}

	function len2(dx, dy) {
		return Math.sqrt(dx * dx + dy * dy);
	}

	function wipe(ctx) {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalCompositeOperation = "source-over";
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		applyView(ctx);
	}

	function clamp(v, lo, hi) {
		return Math.min(hi, Math.max(lo, v));
	}

	// Zoom by a factor while keeping the page point under (cx, cy) in place.
	// pinch: part of a continuous pinch or scroll, so tiles wait for it to settle.
	function zoomAt(cx, cy, factor, pinch) {
		var s = clamp(view.s * factor, MIN_ZOOM, MAX_ZOOM);
		var px = (cx - view.x) / view.s;
		var py = (cy - view.y) / view.s;
		view.s = s;
		view.x = cx - px * s;
		view.y = cy - py * s;
		if (pinch) {
			zoomedAt = performance.now();
			clearTimeout(settleTimer);
			settleTimer = setTimeout(function () {
				requestRender(true);
			}, SETTLE + 10);
		}
		requestRender(true);
	}

	function panBy(dx, dy) {
		view.x += dx;
		view.y += dy;
		requestRender(true);
	}

	function updateChrome() {
		var step = GRID * view.s;
		while (step < 14) step *= 2;
		while (step > 56) step /= 2;
		// The dots are painted once and then only moved and stretched, which costs nothing.
		// They're painted again only once stretched by more than a quarter.
		if (!gridPainted || step / gridPainted > 1.25 || gridPainted / step > 1.25) {
			gridPainted = step;
			gridEl.style.backgroundSize = step + "px " + step + "px";
		}
		var ox = ((view.x % step) + step) % step;
		var oy = ((view.y % step) + step) % step;
		// A dot is painted in the middle of each square, and the layer starts a square
		// and a half up and left so it always covers the screen.
		var grid =
			"translate3d(" + (ox - step * 1.5) + "px," + (oy - step * 1.5) + "px,0) scale(" + step / gridPainted + ")";
		if (grid !== shownGrid) gridEl.style.transform = shownGrid = grid;
		// Only touch the toolbar when the number changes, so it isn't re-laid-out every frame.
		var z = Math.round(view.s * 100) + "%";
		if (z !== shownZoom) zoomBtn.textContent = shownZoom = z;
	}

	// ---------- Setup ----------

	function themeName() {
		return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
	}

	function readPalette() {
		theme = themeName();
		palette = THEMES[theme];
		document.querySelectorAll(".swatch span").forEach(function (span) {
			span.style.background = palette[span.parentNode.dataset.color];
		});
	}

	function resize() {
		var oldDpr = dpr;
		dpr = window.devicePixelRatio || 1;
		width = board.clientWidth;
		height = board.clientHeight;
		liveCanvas.width = Math.round(width * dpr);
		liveCanvas.height = Math.round(height * dpr);
		live.lineCap = "round";
		live.lineJoin = "round";
		liveDrawn = true;
		// Big enough to cover the screen at the least stretch (1 / 1.25) plus a square and a half.
		gridEl.style.width = Math.ceil((width + 84) * 1.25) + "px";
		gridEl.style.height = Math.ceil((height + 84) * 1.25) + "px";
		// Tiles are laid out in CSS pixels, so a new pixel density needs new tiles.
		if (dpr !== oldDpr) dropAllTiles();
		// Room for the tiles on screen, the ring around them, and some from other zooms.
		var cols = Math.ceil(liveCanvas.width / TILE) + 1;
		var rows = Math.ceil(liveCanvas.height / TILE) + 1;
		maxTiles = Math.max(48, Math.ceil(2.5 * cols * rows));
		// A selection's bar is placed against the window, so it moves with it.
		if (sel) {
			selBarSize = { w: selBar.offsetWidth, h: selBar.offsetHeight };
			layoutSelection();
		}
		requestRender(true);
	}

	// ---------- Stroke shapes ----------
	//
	// A pen stroke becomes one filled outline: a smooth curve runs through the
	// midpoints between samples, and the outline sits half the line width out on
	// each side. The outline is built once when the stroke ends and kept, so
	// redrawing the page is one fill per stroke.

	// How each pen type turns pressure, speed and position along the line into width.
	// p: pressure 0 to 1. v: speed in screen pixels per millisecond.
	// d: distance from the start of the line. total: the line's full length once finished.
	var PENS = {
		// Ball pen: one even width. Ignores pressure and speed.
		ball: { base: 0.7, press: 0, curve: 1, slow: 0, taper: 0, tip: 1 },
		// Fountain pen: gentle pressure response, a little thinner when fast, soft tapered ends.
		fountain: { base: 0.3, press: 1.0, curve: 1, slow: 0.25, taper: 3, tip: 0.35 },
		// Brush pen: a hairline when light, thick when pressed, thin when fast, long pointed ends.
		brush: { base: 0.06, press: 2.3, curve: 1.3, slow: 0.6, taper: 8, tip: 0.05 },
	};

	function strokeWidth(s, pt, total) {
		var pen = PENS[s.pen] || PENS.fountain;
		var w = s.size * (pen.base + pen.press * Math.pow(pt.p, pen.curve));
		if (pen.slow) w /= 1 + pen.slow * (pt.v || 0);
		if (pen.taper) {
			var reach = s.size * pen.taper;
			var f = Math.min(1, pt.d / reach);
			if (total != null) f = Math.min(f, (total - pt.d) / reach);
			w *= pen.tip + (1 - pen.tip) * Math.sqrt(Math.max(0, f));
		}
		return w;
	}

	function addCircle(path, x, y, w) {
		var r = w / 2;
		path.moveTo(x + r, y);
		path.arc(x, y, r, 0, Math.PI * 2);
	}

	// Cleans up the Pencil's samples before the outline is built. The Pencil wobbles by
	// about a screen pixel, which can't be seen at the zoom you wrote at but turns into
	// lumps and notches once you zoom in. So: drop samples that are too close together,
	// find the real sharp corners, and gently smooth everything else. Sizes are in
	// screen pixels at the zoom the line was written at (s.scale).
	function cleanPoints(s) {
		var raw = s.points;
		var px = 1 / (s.scale || 1);
		var gap = 1.5 * px;
		var pts = [];
		for (var i = 0; i < raw.length; i++) {
			var r = raw[i];
			var last = pts[pts.length - 1];
			var copy = { x: r.x, y: r.y, p: r.p, v: r.v, d: r.d, corner: false };
			if (last && len2(r.x - last.x, r.y - last.y) < gap) {
				// Always end exactly where the Pencil lifted.
				if (i === raw.length - 1 && pts.length > 1) pts[pts.length - 1] = copy;
				continue;
			}
			pts.push(copy);
		}

		var n = pts.length;
		if (n < 3) return pts;

		// How sharply the line turns at each point, judged from points a few pixels
		// away on each side so a wobble doesn't count as a corner. 1 is straight, -1 doubles back.
		var reach = 4 * px;
		var turn = new Array(n);
		turn[0] = turn[n - 1] = 1;
		for (i = 1; i < n - 1; i++) {
			var a = i;
			var b = i;
			while (a > 0 && pts[i].d - pts[a].d < reach) a--;
			while (b < n - 1 && pts[b].d - pts[i].d < reach) b++;
			var ux = pts[i].x - pts[a].x;
			var uy = pts[i].y - pts[a].y;
			var vx = pts[b].x - pts[i].x;
			var vy = pts[b].y - pts[i].y;
			var lu = len2(ux, uy);
			var lv = len2(vx, vy);
			turn[i] = lu && lv ? (ux * vx + uy * vy) / (lu * lv) : 1;
		}
		// A corner is the sharpest point of a sharp turn. It stays exactly where it was drawn.
		for (i = 1; i < n - 1; i++) {
			pts[i].corner = turn[i] < -0.2 && turn[i] <= turn[i - 1] && turn[i] <= turn[i + 1];
		}

		// Smooth everything but the ends and the corners, over a set distance along the
		// line rather than a set number of samples, so the result doesn't depend on how
		// fast the Pencil moved.
		var d = pts.map(function (p) { return p.d; });
		var fixed = pts.map(function (p) { return p.corner; });
		var xs = smoothAlong(d, pts.map(function (p) { return p.x; }), 2 * px, fixed);
		var ys = smoothAlong(d, pts.map(function (p) { return p.y; }), 2 * px, fixed);
		for (i = 0; i < n; i++) {
			pts[i].x = xs[i];
			pts[i].y = ys[i];
		}
		return pts;
	}

	// Gaussian smoothing of vals along the line. d: distance along the line for each value.
	// sigma: how far the smoothing reaches. The ends and any fixed points stay as they are,
	// and the window shrinks near them so lines don't shrink back from their ends.
	function smoothAlong(d, vals, sigma, fixed) {
		var n = vals.length;
		var out = vals.slice();
		if (n < 3 || !(sigma > 0)) return out;
		var lo = 0;
		for (var i = 1; i < n - 1; i++) {
			if (fixed && fixed[i]) {
				lo = i;
				continue;
			}
			var hi = i + 1;
			while (hi < n - 1 && !(fixed && fixed[hi])) hi++;
			var reach = Math.min(3 * sigma, d[i] - d[lo], d[hi] - d[i]);
			if (reach <= 0) continue;
			var k = 1 / (2 * sigma * sigma);
			var sum = 0;
			var total = 0;
			for (var j = i; j >= lo && d[i] - d[j] <= reach; j--) {
				var w = Math.exp(-(d[i] - d[j]) * (d[i] - d[j]) * k) * spacing(d, j);
				sum += vals[j] * w;
				total += w;
			}
			for (j = i + 1; j <= hi && d[j] - d[i] <= reach; j++) {
				w = Math.exp(-(d[j] - d[i]) * (d[j] - d[i]) * k) * spacing(d, j);
				sum += vals[j] * w;
				total += w;
			}
			if (total > 0) out[i] = sum / total;
		}
		return out;
	}

	// How much of the line a sample stands for, so bunched-up samples don't count extra.
	function spacing(d, j) {
		var a = d[Math.max(0, j - 1)];
		var b = d[Math.min(d.length - 1, j + 1)];
		return Math.max(b - a, 1e-6);
	}

	// Builds the outline of a pen stroke. extra: predicted points to add on the end.
	// finished: the line is done, so its end tapers too.
	// detail: how finely to cut curves; defaults to suit the current zoom.
	function penShape(s, extra, finished, detail) {
		var pts = cleanPoints(s);
		var n = pts.length;
		var total = finished ? pts[n - 1].d : null;
		var W = new Array(n);
		for (var q = 0; q < n; q++) W[q] = strokeWidth(s, pts[q], total);
		// Pressure and speed jitter from sample to sample. Even it out so the edges
		// stay clean when zoomed in; real swells in width happen over a longer stretch.
		W = smoothAlong(
			pts.map(function (p) { return p.d; }),
			W,
			Math.max(4 / (s.scale || 1), s.size * 0.75),
			pts.map(function (p) { return p.corner; })
		);

		var body = new Path2D();
		// Round ends, plus blobs at sharp corners so the outline never shows a notch.
		var round = new Path2D();
		var first = pts[0];
		if (n === 1) {
			// A tap: a full-size dot, with no taper.
			addCircle(round, first.x, first.y, strokeWidth(s, { p: first.p, v: 0, d: Infinity }, null));
			return { body: body, round: round };
		}
		addCircle(round, first.x, first.y, W[0]);

		// More pieces per curve when zoomed in, so curves stay smooth.
		detail = detail || Math.max(view.s, 1);
		var left = [];
		var right = [];

		function edge(x, y, w, tx, ty) {
			var len = len2(tx, ty);
			if (!len) return;
			var h = w / 2 / len;
			left.push(x - ty * h, y + tx * h);
			right.push(x + ty * h, y - tx * h);
		}

		// Each point gets a direction: the line through its neighbours, so curves flow.
		// At a corner the line comes in one way and leaves another, so corners stay sharp.
		var inX = new Array(n);
		var inY = new Array(n);
		var outX = new Array(n);
		var outY = new Array(n);
		for (var i = 0; i < n; i++) {
			var a = pts[Math.max(0, i - 1)];
			var c = pts[i];
			var b = pts[Math.min(n - 1, i + 1)];
			var ux = c.x - a.x;
			var uy = c.y - a.y;
			var vx = b.x - c.x;
			var vy = b.y - c.y;
			var lu = len2(ux, uy);
			var lv = len2(vx, vy);
			if (c.corner && lu && lv) {
				inX[i] = ux / lu;
				inY[i] = uy / lu;
				outX[i] = vx / lv;
				outY[i] = vy / lv;
				// Round off the corner and cover any pinch on its inside.
				addCircle(round, c.x, c.y, W[i]);
				continue;
			}
			var dx = b.x - a.x;
			var dy = b.y - a.y;
			var ld = len2(dx, dy) || 1;
			inX[i] = outX[i] = dx / ld;
			inY[i] = outY[i] = dy / ld;
		}

		edge(first.x, first.y, W[0], outX[0], outY[0]);

		for (i = 0; i < n - 1; i++) {
			var p0 = pts[i];
			var p3 = pts[i + 1];
			var len = len2(p3.x - p0.x, p3.y - p0.y);
			// Bezier handles a third of the gap long, so the curve never overshoots.
			var h = len / 3;
			var p1x = p0.x + outX[i] * h;
			var p1y = p0.y + outY[i] * h;
			var p2x = p3.x - inX[i + 1] * h;
			var p2y = p3.y - inY[i + 1] * h;
			var steps = clamp(Math.ceil((len * detail) / 2), 1, 16);
			// j starts at 1: the piece's first point is where the last one ended.
			for (var j = 1; j <= steps; j++) {
				var t = j / steps;
				var u = 1 - t;
				var b0 = u * u * u;
				var b1 = 3 * u * u * t;
				var b2 = 3 * u * t * t;
				var b3 = t * t * t;
				edge(
					b0 * p0.x + b1 * p1x + b2 * p2x + b3 * p3.x,
					b0 * p0.y + b1 * p1y + b2 * p2y + b3 * p3.y,
					u * W[i] + t * W[i + 1],
					u * u * (p1x - p0.x) + 2 * u * t * (p2x - p1x) + t * t * (p3.x - p2x),
					u * u * (p1y - p0.y) + 2 * u * t * (p2y - p1y) + t * t * (p3.y - p2y)
				);
			}
		}

		var last = pts[n - 1];
		var end = last;
		if (extra) {
			for (var k = 0; k < extra.length; k++) {
				var e = extra[k];
				edge(e.x, e.y, W[n - 1], e.x - end.x, e.y - end.y);
				end = e;
			}
		}
		addCircle(round, end.x, end.y, W[n - 1]);

		if (left.length >= 4) {
			body.moveTo(left[0], left[1]);
			for (var m = 2; m < left.length; m += 2) body.lineTo(left[m], left[m + 1]);
			for (m = right.length - 2; m >= 0; m -= 2) body.lineTo(right[m], right[m + 1]);
			body.closePath();
		}
		return { body: body, round: round };
	}

	// The eraser is a plain round swipe along the samples.
	function eraserShape(s) {
		var path = new Path2D();
		var pts = s.points;
		path.moveTo(pts[0].x, pts[0].y);
		for (var i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
		if (pts.length === 1) path.lineTo(pts[0].x + 0.01, pts[0].y);
		return path;
	}

	// The highlighter is one even, round-ended swipe along the cleaned-up line.
	// Safari's own thick-line drawing leaves holes where a wide line bends, so the
	// swipe is built by hand instead: a circle at every point plus a strip between
	// each pair, all wound the same way so filling them gives one solid shape.
	// detail: how finely to cut curves; defaults to suit the current zoom.
	function highlighterShape(s, detail) {
		var pts = cleanPoints(s);
		var path = new Path2D();
		var r = s.size / 2;
		var n = pts.length;
		detail = detail || Math.max(view.s, 1);

		// The centre line: curves through the midpoints between samples, cut into short
		// straight pieces (more of them when zoomed in) so it stays smooth.
		var line = [pts[0].x, pts[0].y];
		var fromX = pts[0].x;
		var fromY = pts[0].y;
		for (var i = 1; i < n; i++) {
			var c = pts[i];
			var toX = i < n - 1 ? (c.x + pts[i + 1].x) / 2 : c.x;
			var toY = i < n - 1 ? (c.y + pts[i + 1].y) / 2 : c.y;
			var len = len2(c.x - fromX, c.y - fromY) + len2(toX - c.x, toY - c.y);
			var steps = clamp(Math.ceil((len * detail) / 2), 1, 16);
			for (var j = 1; j <= steps; j++) {
				var t = j / steps;
				var u = 1 - t;
				line.push(u * u * fromX + 2 * u * t * c.x + t * t * toX, u * u * fromY + 2 * u * t * c.y + t * t * toY);
			}
			fromX = toX;
			fromY = toY;
		}

		for (var k = 0; k < line.length; k += 2) {
			var x = line[k];
			var y = line[k + 1];
			addCircle(path, x, y, s.size);
			if (k + 3 >= line.length) continue;
			var dx = line[k + 2] - x;
			var dy = line[k + 3] - y;
			var d = len2(dx, dy);
			if (!d) continue;
			// Half the width out to each side. This corner order winds the same way as the circles.
			var nx = (-dy / d) * r;
			var ny = (dx / d) * r;
			path.moveTo(x - nx, y - ny);
			path.lineTo(line[k + 2] - nx, line[k + 3] - ny);
			path.lineTo(line[k + 2] + nx, line[k + 3] + ny);
			path.lineTo(x + nx, y + ny);
			path.closePath();
		}
		return path;
	}


	// On a light page the highlight darkens like a marker on paper; on a dark page it lightens.
	// So writing under it stays readable in both.
	//
	// The highlight's circles and strips overlap each other, which would show as darker
	// patches if drawn see-through. So it's first drawn solid on a spare canvas, then laid
	// on the page see-through in one go.
	var spare = document.createElement("canvas");
	var spareCtx = spare.getContext("2d");

	function drawHighlight(ctx, s, path, colors, theme) {
		// The stroke's box in the target canvas's pixels. The view is only ever a zoom
		// and a shift, so the corners map straight across.
		var m = ctx.getTransform();
		// A finished stroke keeps its box; the one being drawn is still growing.
		var b = s.box || bounds(s.points, s.size);
		var x0 = Math.max(0, Math.floor(b.x0 * m.a + m.e));
		var y0 = Math.max(0, Math.floor(b.y0 * m.d + m.f));
		var x1 = Math.min(ctx.canvas.width, Math.ceil(b.x1 * m.a + m.e));
		var y1 = Math.min(ctx.canvas.height, Math.ceil(b.y1 * m.d + m.f));
		var w = x1 - x0;
		var h = y1 - y0;
		if (w <= 0 || h <= 0) return;

		// Grow the spare canvas when needed; never shrink it, so it isn't reallocated each frame.
		if (spare.width < w || spare.height < h) {
			spare.width = Math.max(spare.width, w);
			spare.height = Math.max(spare.height, h);
		}
		spareCtx.setTransform(1, 0, 0, 1, 0, 0);
		spareCtx.globalAlpha = 1;
		spareCtx.globalCompositeOperation = "source-over";
		spareCtx.clearRect(0, 0, w, h);
		spareCtx.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
		spareCtx.fillStyle = colors[s.color];
		spareCtx.fill(path);

		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalCompositeOperation = theme === "dark" ? "screen" : "multiply";
		ctx.globalAlpha = HIGHLIGHT_ALPHA[theme];
		ctx.drawImage(spare, 0, 0, w, h, x0, y0, w, h);
		ctx.restore();
	}

	function fillShape(ctx, s, shape) {
		ctx.globalCompositeOperation = "source-over";
		ctx.fillStyle = palette[s.color];
		ctx.fill(shape.body);
		ctx.fill(shape.round);
	}

	function eraseShape(ctx, s, path) {
		ctx.globalCompositeOperation = "destination-out";
		ctx.strokeStyle = "#000";
		ctx.lineWidth = s.size;
		ctx.stroke(path);
	}

	// The outline was built for the zoom it was last drawn at. Zoomed in well past that,
	// it's rebuilt with more pieces so its curves don't show straight edges. Zoomed out
	// well past it, it's rebuilt with fewer, so a page full of writing stays quick to draw.
	function needsRebuild(a, zoom) {
		return zoom > a.detail * 1.5 || (a.detail > 1 && zoom * 4 < a.detail);
	}

	// A pasted picture: a rectangle on the page with a centre, a size, a turn and flips.
	function drawImageAction(ctx, a) {
		if (!a.img) return;
		ctx.save();
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = 1;
		ctx.translate(a.cx, a.cy);
		ctx.rotate(a.rot);
		ctx.scale(a.flipX ? -1 : 1, a.flipY ? -1 : 1);
		ctx.drawImage(a.img, -a.w / 2, -a.h / 2, a.w, a.h);
		ctx.restore();
	}

	// Some things on the page aren't strokes but rectangles with a middle, a size and a
	// turn: a pasted picture, and a set of axes. They share this much.
	function isFramed(a) {
		return a.tool === "image" || a.tool === "graph";
	}

	// The upright box around one of those, turned as it is.
	function frameBox(a) {
		var c = Math.abs(Math.cos(a.rot));
		var s = Math.abs(Math.sin(a.rot));
		var ex = (c * a.w + s * a.h) / 2;
		var ey = (s * a.w + c * a.h) / 2;
		return { x0: a.cx - ex, y0: a.cy - ey, x1: a.cx + ex, y1: a.cy + ey };
	}

	// zoom: the zoom the canvas is drawn at, as in view.s.
	function drawAction(ctx, a, zoom) {
		if (a.tool === "image") {
			drawImageAction(ctx, a);
			return;
		}
		if (a.tool === "graph") {
			drawGraph(ctx, a, zoom);
			return;
		}
		if (a.tool === "eraser") {
			eraseShape(ctx, a, a.shape || (a.shape = eraserShape(a)));
			return;
		}
		var detail = Math.max(zoom, 1);
		if (a.tool === "highlighter") {
			if (needsRebuild(a, zoom)) {
				a.shape = highlighterShape(a, detail);
				a.detail = detail;
			}
			drawHighlight(ctx, a, a.shape, palette, theme);
			return;
		}
		if (needsRebuild(a, zoom)) {
			a.shape = penShape(a, null, true, detail);
			a.detail = detail;
		}
		fillShape(ctx, a, a.shape);
	}

	function bounds(points, pad) {
		var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
		for (var i = 0; i < points.length; i++) {
			var p = points[i];
			if (p.x < b.x0) b.x0 = p.x;
			if (p.y < b.y0) b.y0 = p.y;
			if (p.x > b.x1) b.x1 = p.x;
			if (p.y > b.y1) b.y1 = p.y;
		}
		b.x0 -= pad;
		b.y0 -= pad;
		b.x1 += pad;
		b.y1 += pad;
		return b;
	}

	// ---------- Rendering ----------
	//
	// Finished strokes are drawn once into tiles: small canvases of TILE device pixels,
	// all at one zoom. Each zoom's tiles sit in one layer that's moved and stretched with
	// a CSS transform, so moving the page never redraws anything; the browser just slides
	// pictures it already has. Tiles are drawn a little at a time between frames, and one
	// shows once it's complete. Until then, tiles from another zoom underneath stand in,
	// stretched. During a pinch tiles are drawn at the nearest of a few fixed zooms, and
	// once the zoom settles they're drawn again at exactly the zoom on screen, so lines
	// end up sharp.
	//
	// The "live" canvas on top holds the stroke being drawn. It's rebuilt each frame (it's
	// short), then joins the finished strokes when the Pencil lifts. The eraser cuts
	// straight into the tiles on screen as it goes.

	var TILE = 512;
	// The most time a frame spends drawing tiles, in ms: less while writing so the pen keeps up.
	var BUDGET = 6;
	var BUDGET_WRITING = 2;
	// How long a pinch has to rest before tiles are drawn at exactly its zoom, in ms.
	var SETTLE = 160;

	// One set of tiles per zoom, in device pixels per page unit (ds).
	var tileSets = [];
	// Canvases from thrown-away tiles, ready for reuse.
	var spareTiles = [];
	var tileCanvases = 0;
	var tileCount = 0;
	var maxTiles = 64;
	// The first action after the last "clear".
	var pageStart = 0;
	var frameNo = 0;
	var zoomedAt = -Infinity;
	var settleTimer = 0;
	// Tiles on screen still to draw, nearest the middle first, and the grid on screen.
	var todo = [];
	var shown = null;
	// Draw these tiles on screen right away instead of a little at a time: all of them
	// (after an undo, say) or the ones a new stroke lands on.
	var urgent = false;
	var urgentBox = null;
	// The tiles the eraser being used has cut into so far.
	var cut = null;
	// Whether the live canvas has anything on it.
	var liveDrawn = true;

	function findStart() {
		for (var i = actions.length - 1; i >= 0; i--) {
			if (actions[i].type === "clear") return i + 1;
		}
		return 0;
	}

	// The zoom tiles are drawn at: exactly the one on screen, or during a pinch the
	// nearest of a few fixed zooms, so the tiles aren't redrawn for every step of it.
	function tileZoom() {
		var ds = dpr * view.s;
		if (performance.now() - zoomedAt >= SETTLE) return ds;
		return Math.pow(2, Math.round(Math.log2(ds) * 2) / 2);
	}

	function tileSet(ds) {
		for (var i = 0; i < tileSets.length; i++) {
			if (tileSets[i].ds === ds) return tileSets[i];
		}
		var el = document.createElement("div");
		el.className = "tileset";
		// New sets start at the bottom; the one on screen is moved to the top.
		tileLayer.insertBefore(el, tileLayer.firstChild);
		var set = { ds: ds, tiles: new Map(), el: el, transform: "", hidden: false };
		tileSets.push(set);
		return set;
	}

	function getTile(set, i, j) {
		var key = i + "," + j;
		var t = set.tiles.get(key);
		if (!t) {
			// The tile's square on the page.
			var size = TILE / set.ds;
			t = {
				set: set,
				key: key,
				i: i,
				j: j,
				x0: i * size,
				y0: j * size,
				x1: (i + 1) * size,
				y1: (j + 1) * size,
				canvas: null,
				ctx: null,
				visible: false,
				// The next action to draw into it. It's ready once this reaches the end.
				next: pageStart,
				used: frameNo,
			};
			set.tiles.set(key, t);
			tileCount++;
		}
		return t;
	}

	function forEachTile(fn) {
		tileSets.forEach(function (set) {
			set.tiles.forEach(fn);
		});
	}

	function ready(t) {
		return t.next === actions.length;
	}

	function hits(t, b) {
		return !(b.x1 < t.x0 || b.x0 > t.x1 || b.y1 < t.y0 || b.y0 > t.y1);
	}

	function setVisible(t, on) {
		if (!t.canvas || t.visible === on) return;
		t.visible = on;
		t.canvas.style.visibility = on ? "visible" : "hidden";
	}

	// A tile on screen shows once it's complete. Stand-ins are handled by updateStandIns.
	function syncTile(t) {
		if (!shown || t.set === shown.set) setVisible(t, ready(t));
	}

	// A tile only gets a canvas once something is drawn on it, so empty page costs nothing.
	function giveCanvas(t) {
		var c = spareTiles.pop();
		if (!c) {
			c = document.createElement("canvas");
			c.width = c.height = TILE;
		}
		var ctx = c.getContext("2d");
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = 1;
		ctx.clearRect(0, 0, TILE, TILE);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.setTransform(t.set.ds, 0, 0, t.set.ds, -t.i * TILE, -t.j * TILE);
		// Placed in CSS pixels inside its set's layer; whole device pixels apart.
		var size = TILE / dpr;
		c.style.left = t.i * size + "px";
		c.style.top = t.j * size + "px";
		c.style.width = c.style.height = size + "px";
		c.style.visibility = "hidden";
		t.visible = false;
		t.set.el.appendChild(c);
		t.canvas = c;
		t.ctx = ctx;
		tileCanvases++;
	}

	function takeCanvas(t) {
		if (!t.canvas) return;
		t.canvas.remove();
		if (spareTiles.length < 4) spareTiles.push(t.canvas);
		// Safari only gives a canvas's memory back once it's shrunk.
		else t.canvas.width = t.canvas.height = 0;
		t.canvas = t.ctx = null;
		t.visible = false;
		tileCanvases--;
	}

	// Starts a tile over from a blank page.
	function emptyTile(t) {
		takeCanvas(t);
		t.next = pageStart;
	}

	function dropTile(t) {
		takeCanvas(t);
		t.set.tiles.delete(t.key);
		tileCount--;
	}

	// Something on the page changed where it already was: every tile over that part is
	// drawn again from a blank page, so the old pixels go.
	function rerenderBox(b) {
		if (!b) return;
		forEachTile(function (t) {
			if (hits(t, b)) emptyTile(t);
		});
		urgent = true;
		requestRender(true);
	}

	// The box around both, for an edit that moved something.
	function unionBox(a, b) {
		if (!a) return b;
		if (!b) return a;
		return {
			x0: Math.min(a.x0, b.x0),
			y0: Math.min(a.y0, b.y0),
			x1: Math.max(a.x1, b.x1),
			y1: Math.max(a.y1, b.y1),
		};
	}

	// The upright box around a list of strokes and pictures.
	function listBox(list) {
		var b = null;
		for (var i = 0; i < list.length; i++) {
			var x = list[i].box;
			if (!x) continue;
			b = b ? unionBox(b, x) : { x0: x.x0, y0: x.y0, x1: x.x1, y1: x.y1 };
		}
		return b;
	}

	function dropAllTiles() {
		forEachTile(takeCanvas);
		tileSets = [];
		tileLayer.textContent = "";
		tileCount = 0;
		todo = [];
		shown = null;
		cut = null;
	}

	// Draws strokes into a tile until it's up to date or the time runs out. True if it's done.
	function drawTile(t, deadline) {
		var zoom = t.set.ds / dpr;
		while (t.next < actions.length) {
			var a = actions[t.next++];
			// Rubbed-out strokes, and ones the lasso is holding, aren't on the page.
			if (a.deleted || a.lifted || !hits(t, a.box)) continue;
			if (!t.canvas) {
				// Nothing to rub out on a blank tile.
				if (a.tool === "eraser") continue;
				giveCanvas(t);
			}
			drawAction(t.ctx, a, zoom);
			if (performance.now() > deadline) break;
		}
		syncTile(t);
		return ready(t);
	}

	// Moves and stretches a set's layer to match the view.
	function place(set, ox, oy, ds) {
		var k = ds / set.ds;
		var tf = "translate3d(" + ox / dpr + "px," + oy / dpr + "px,0) scale(" + k + ")";
		if (tf !== set.transform) set.el.style.transform = set.transform = tf;
	}

	// Tiles from other zooms show only where a tile on screen isn't complete yet, so
	// they don't double up see-through highlighter.
	function updateStandIns() {
		var cur = shown.set;
		var pending = todo.length > 0;
		var size = TILE / cur.ds;
		tileSets.forEach(function (s) {
			if (s === cur) return;
			var hide = !pending;
			if (s.hidden !== hide) {
				s.hidden = hide;
				s.el.style.display = hide ? "none" : "";
			}
			if (hide) return;
			s.tiles.forEach(function (ft) {
				if (!ft.canvas) return;
				var need = ready(ft) && !covered(cur, ft, size);
				setVisible(ft, need);
			});
		});
	}

	// Whether complete tiles of the set on screen cover all of tile ft.
	function covered(cur, ft, size) {
		var i0 = Math.floor(ft.x0 / size + 1e-6);
		var i1 = Math.ceil(ft.x1 / size - 1e-6) - 1;
		var j0 = Math.floor(ft.y0 / size + 1e-6);
		var j1 = Math.ceil(ft.y1 / size - 1e-6) - 1;
		// A far zoomed-out tile covers a lot; just keep it.
		if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) return false;
		for (var j = j0; j <= j1; j++) {
			for (var i = i0; i <= i1; i++) {
				var t = cur.tiles.get(i + "," + j);
				if (!t || !ready(t)) return false;
			}
		}
		return true;
	}

	// Lines the tile layers up with the view and lists the tiles on screen that aren't ready.
	function compose() {
		var ds = dpr * view.s;
		var set = tileSet(tileZoom());
		var span = (TILE * ds) / set.ds;
		var ox = Math.round(dpr * view.x);
		var oy = Math.round(dpr * view.y);
		var w = liveCanvas.width;
		var h = liveCanvas.height;
		var i0 = Math.floor(-ox / span);
		var i1 = Math.ceil((w - ox) / span) - 1;
		var j0 = Math.floor(-oy / span);
		var j1 = Math.ceil((h - oy) / span) - 1;
		var changed = !shown || shown.set !== set;
		shown = { set: set, i0: i0, i1: i1, j0: j0, j1: j1 };
		if (changed) {
			if (set.hidden) {
				set.hidden = false;
				set.el.style.display = "";
			}
			if (tileLayer.lastChild !== set.el) tileLayer.appendChild(set.el);
			// It may have been a stand-in with some tiles hidden.
			set.tiles.forEach(syncTile);
		}
		tileSets.forEach(function (s) {
			place(s, ox, oy, ds);
		});

		todo = [];
		for (var j = j0; j <= j1; j++) {
			for (var i = i0; i <= i1; i++) {
				var t = getTile(set, i, j);
				t.used = frameNo;
				if (ready(t)) continue;
				var dx = 2 * (ox + (i + 0.5) * span) - w;
				var dy = 2 * (oy + (j + 0.5) * span) - h;
				t.dist = dx * dx + dy * dy;
				todo.push(t);
			}
		}
		todo.sort(function (a, b) {
			return a.dist - b.dist;
		});
		updateStandIns();
		updateChrome();
	}

	// With time to spare, draws the ring of tiles just off screen so moving the page
	// finds them ready. True once they all are.
	function prefetch(deadline) {
		var g = shown;
		for (var j = g.j0 - 1; j <= g.j1 + 1; j++) {
			for (var i = g.i0 - 1; i <= g.i1 + 1; i++) {
				if (i >= g.i0 && i <= g.i1 && j >= g.j0 && j <= g.j1) continue;
				var t = getTile(g.set, i, j);
				t.used = frameNo;
				if (ready(t)) continue;
				if (performance.now() >= deadline || !drawTile(t, deadline)) return false;
			}
		}
		return true;
	}

	// Keeps tile memory in bounds, throwing away the tiles least recently on screen.
	function trimTiles() {
		if (tileCanvases <= maxTiles && tileCount <= maxTiles * 40) return;
		// Never the ones on screen.
		var g = shown;
		if (g) {
			for (var j = g.j0; j <= g.j1; j++) {
				for (var i = g.i0; i <= g.i1; i++) {
					var t = g.set.tiles.get(i + "," + j);
					if (t) t.used = frameNo;
				}
			}
		}
		var old = [];
		forEachTile(function (t) {
			if (t.used < frameNo) old.push(t);
		});
		old.sort(function (a, b) {
			return a.used - b.used;
		});
		for (var n = 0; n < old.length; n++) {
			if (tileCanvases <= maxTiles && tileCount <= maxTiles * 20) break;
			dropTile(old[n]);
		}
		tileSets = tileSets.filter(function (s) {
			if (s.tiles.size > 0 || (shown && s === shown.set)) return true;
			s.el.remove();
			return false;
		});
	}

	// Adds a finished stroke or a "clear" to the page.
	function pushAction(a) {
		actions.push(a);
		if (a.type === "clear") {
			pageStart = actions.length;
			forEachTile(emptyTile);
		} else {
			// Tiles that were ready get the new stroke straight away. Ones the eraser
			// already cut into as it went are done.
			forEachTile(function (t) {
				if (t.next !== actions.length - 1) return;
				if (cut && cut.has(t)) t.next++;
				else drawTile(t, Infinity);
			});
			urgentBox = a.box;
		}
		cut = null;
		requestRender(true);
	}

	// Takes the last stroke or "clear" off the page. Tiles it touched are drawn again.
	function popAction() {
		var a = actions.pop();
		var at = actions.length;
		if (a.type === "clear") pageStart = findStart();
		forEachTile(function (t) {
			if (t.next <= at) return;
			if (a.type === "clear" || hits(t, a.box)) emptyTile(t);
			else t.next = at;
			syncTile(t);
		});
		urgent = true;
		requestRender(true);
		return a;
	}

	// Cuts the eraser into the complete tiles on screen: the new part of the swipe (seg,
	// inside segBox) into tiles already cut, the whole swipe so far into the rest.
	function cutTiles(s, seg, segBox) {
		var g = shown;
		if (!g) return;
		if (!cut) cut = new Set();
		// Every tile already cut, even ones the page has since moved off, so none miss a part.
		if (seg) {
			cut.forEach(function (t) {
				if (t.canvas && hits(t, segBox)) eraseShape(t.ctx, s, seg);
			});
		}
		var whole = null;
		var wholeBox = null;
		for (var j = g.j0; j <= g.j1; j++) {
			for (var i = g.i0; i <= g.i1; i++) {
				var t = g.set.tiles.get(i + "," + j);
				if (!t || !t.canvas || !ready(t) || cut.has(t)) continue;
				cut.add(t);
				if (!wholeBox) wholeBox = bounds(s.points, s.size);
				if (!hits(t, wholeBox)) continue;
				if (!whole) whole = eraserShape(s);
				eraseShape(t.ctx, s, whole);
			}
		}
	}

	// The eraser was cancelled: tiles it cut into are drawn again without it.
	function uncut() {
		if (!cut) return;
		cut.forEach(emptyTile);
		cut = null;
		urgent = true;
	}

	function renderLive() {
		if (!current && !sel && !lasso && !shaping) {
			if (liveDrawn) wipe(live);
			liveDrawn = false;
			return;
		}
		wipe(live);
		liveDrawn = true;
		// What the lasso holds floats above the page until it's put down.
		if (sel) drawSelection();
		if (lasso) drawLasso();
		if (shaping) drawShaping(live);
		if (current) drawCurrent();
	}

	function drawCurrent() {
		// The selection may have left its own transform behind.
		applyView(live);
		live.globalCompositeOperation = "source-over";
		live.globalAlpha = 1;
		live.setLineDash([]);
		var s = current;
		var pts = s.points;
		var last = pts[pts.length - 1];

		if (s.tool === "eraser") {
			// Cut the new part of the swipe into the ink.
			var path = null;
			var box = null;
			if (s.erasedTo < pts.length) {
				var start = Math.max(0, s.erasedTo - 1);
				path = new Path2D();
				var from = pts[start];
				path.moveTo(from.x, from.y);
				for (var i = s.erasedTo; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
				if (s.erasedTo === 0) path.lineTo(from.x + 0.01, from.y);
				box = bounds(pts.slice(start), s.size);
				s.erasedTo = pts.length;
			}
			cutTiles(s, path, box);
			// Show where the eraser is.
			live.lineWidth = 1 / view.s;
			live.strokeStyle = palette.ink;
			live.globalAlpha = 0.35;
			live.beginPath();
			live.arc(last.x, last.y, s.size / 2, 0, Math.PI * 2);
			live.stroke();
			live.globalAlpha = 1;
			return;
		}

		if (s.tool === "highlighter") {
			drawHighlight(live, s, highlighterShape(s), palette, theme);
			return;
		}
		fillShape(live, s, penShape(s, s.predicted));
	}

	function onFrame() {
		frame = 0;
		frameNo++;
		var start = performance.now();
		if (dirty) {
			dirty = false;
			compose();
		}

		// Draw the tiles on screen that aren't ready, for as long as the frame allows.
		var budget = start + (current ? BUDGET_WRITING : BUDGET);
		var left = [];
		for (var n = 0; n < todo.length; n++) {
			var t = todo[n];
			t.used = frameNo;
			var deadline = urgent || (urgentBox && hits(t, urgentBox)) ? Infinity : budget;
			if (!ready(t) && performance.now() < deadline) drawTile(t, deadline);
			if (!ready(t)) left.push(t);
		}
		urgent = false;
		urgentBox = null;
		if (left.length < todo.length) {
			todo = left;
			// Stand-ins under the tiles just finished can go.
			if (shown) updateStandIns();
			// Tiles just finished need the eraser in use cut into them too.
			if (current && current.tool === "eraser") liveDirty = true;
		}

		var more = todo.length > 0;
		// Off-screen tiles only once the screen is done, nothing is being written,
		// and the zoom has settled.
		if (!more && !current && shown && shown.set.ds === dpr * view.s) {
			more = !prefetch(budget);
		}
		trimTiles();

		if (liveDirty) {
			liveDirty = false;
			renderLive();
		}
		if (more) schedule();
	}

	function schedule() {
		if (!frame) frame = requestAnimationFrame(onFrame);
	}

	// full: the view or the strokes changed, so the tiles are lined up again.
	function requestRender(full) {
		if (full) dirty = true;
		liveDirty = true;
		schedule();
	}

	// ---------- Drawing input ----------

	function toPage(e) {
		return {
			x: (e.clientX - view.x) / view.s,
			y: (e.clientY - view.y) / view.s,
		};
	}

	function pointFrom(e, s) {
		var pts = s.points;
		var prev = pts.length ? pts[pts.length - 1] : null;
		var pt = toPage(e);
		pt.t = e.timeStamp;

		// Speed on screen, smoothed so it doesn't jitter.
		pt.v = 0;
		if (prev) {
			var dist = len2(pt.x - prev.x, pt.y - prev.y) * view.s;
			var speed = dist / Math.max(1, pt.t - prev.t);
			pt.v = prev.v * 0.75 + Math.min(speed, 6) * 0.25;
		}

		var raw;
		if (e.pointerType === "pen") {
			raw = e.pressure;
			// Pencil can report 0 for a moment; keep the last pressure instead.
			if (!raw) raw = prev ? prev.p : 0.5;
		} else {
			// Mouse and finger have no pressure, so fake it from speed: slower is heavier.
			raw = clamp(0.7 - pt.v * 0.2, 0.15, 0.7);
		}
		// Smooth pressure so the width doesn't flicker.
		pt.p = prev ? prev.p * 0.6 + raw * 0.4 : raw;
		return pt;
	}

	function addPoint(s, pt) {
		var pts = s.points;
		var last = pts[pts.length - 1];
		pt.d = 0;
		if (last) {
			var dx = pt.x - last.x;
			var dy = pt.y - last.y;
			// Skip points less than half a screen pixel apart.
			if ((dx * dx + dy * dy) * view.s * view.s < 0.25) {
				last.p = pt.p;
				return;
			}
			pt.d = last.d + len2(dx, dy);
		}
		pts.push(pt);
	}

	function startStroke(e) {
		activeId = e.pointerId;
		activeType = e.pointerType;
		current = {
			tool: tool,
			pen: penType,
			color: colorChoice[tool] || colorChoice.pen,
			size: SIZES[tool][sizeChoice[tool]],
			// The zoom it was written at, so the clean-up knows how big a wobble is.
			scale: view.s,
			points: [],
			predicted: null,
			erasedTo: 0,
		};
		addPoint(current, pointFrom(e, current));
		requestRender();
	}

	function moveStroke(e) {
		// The Pencil reports at 240Hz; use every sample, not just one per frame.
		var events = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
		if (!events || !events.length) events = [e];
		for (var i = 0; i < events.length; i++) addPoint(current, pointFrom(events[i], current));

		var predicted = e.getPredictedEvents ? e.getPredictedEvents() : null;
		current.predicted = predicted && predicted.length ? predicted.map(toPage) : null;
		requestRender();
	}

	function discardCurrent() {
		if (!current) return;
		var wasEraser = current.tool === "eraser";
		current = null;
		activeId = null;
		// An eraser has already cut into the ink, so those tiles are drawn again.
		if (wasEraser) uncut();
		requestRender(wasEraser);
	}

	function commitCurrent() {
		if (!current) return;
		var s = current;
		var a = {
			tool: s.tool,
			pen: s.pen,
			color: s.color,
			size: s.size,
			scale: s.scale,
			points: s.points,
			box: bounds(s.points, s.size * 1.5),
			detail: Math.max(view.s, 1),
		};
		if (s.tool === "eraser") a.shape = eraserShape(s);
		else if (s.tool === "highlighter") a.shape = highlighterShape(s);
		else a.shape = penShape(s, null, true);
		current = null;
		activeId = null;
		// Draws it into the tiles, which then show in place of the live stroke.
		addActions([a]);
	}

	// ---------- Finger gestures ----------

	function fingerState() {
		var n = 0;
		var cx = 0;
		var cy = 0;
		var first = null;
		var second = null;
		touches.forEach(function (p) {
			cx += p.x;
			cy += p.y;
			if (!first) first = p;
			else if (!second) second = p;
			n++;
		});
		return {
			n: n,
			cx: cx / n,
			cy: cy / n,
			d: second ? Math.hypot(first.x - second.x, first.y - second.y) : 0,
		};
	}

	// Called whenever a finger lands or lifts, so the page doesn't jump.
	function resetGesture() {
		gesture = touches.size ? fingerState() : null;
	}

	function moveGesture() {
		var g = fingerState();
		if (gesture && g.n === gesture.n) {
			if (g.n >= 2 && gesture.d > 0) zoomAt(gesture.cx, gesture.cy, g.d / gesture.d, true);
			panBy(g.cx - gesture.cx, g.cy - gesture.cy);
		}
		gesture = g;
	}

	function liftFinger(id) {
		touches.delete(id);
		ignored.delete(id);
		if (!touches.size && !ignored.size) touchLock = false;
		resetGesture();
	}

	// ---------- Pointer events ----------

	board.addEventListener("pointerdown", function (e) {
		if (e.pointerType === "mouse" && e.button !== 0) return;
		e.preventDefault();
		// A tap on the page while a menu is open only closes the menu.
		if (!penMenu.hidden || !shapeMenu.hidden || !copyMenu.hidden || !notesMenu.hidden || !moreMenu.hidden) {
			closeMenus();
			return;
		}
		try {
			board.setPointerCapture(e.pointerId);
		} catch (err) {}

		// The lasso draws a loop, or takes hold of what's already picked up. Two fingers
		// still move and zoom the page, as with any other tool.
		if (tool === LASSO) {
			if (e.pointerType === "touch") {
				// A finger landing while the Pencil works is a palm.
				if (activeType === "pen" && (lasso || grab)) {
					ignored.add(e.pointerId);
					return;
				}
				touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
				if (pencilSeen || touchLock || touches.size > 1) {
					if (activeType === "touch" && (lasso || grab)) endSelectPointer(true);
					touchLock = true;
					resetGesture();
					return;
				}
			}
			if (e.pointerType === "pen") {
				pencilSeen = true;
				// A finger halfway through a loop gives way to the Pencil.
				if (activeType !== "pen" && (lasso || grab)) endSelectPointer(true);
				touches.forEach(function (_, id) {
					ignored.add(id);
				});
				touches.clear();
				gesture = null;
			}
			if (!lasso && !grab) startSelectPointer(e);
			return;
		}

		// A line, a circle or a set of axes is dragged out. Same rules: a finger landing
		// while the Pencil draws is a palm, two fingers still move the page.
		if (tool === SHAPE || tool === GRAPH) {
			if (e.pointerType === "touch") {
				if (activeType === "pen" && shaping) {
					ignored.add(e.pointerId);
					return;
				}
				touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
				if (pencilSeen || touchLock || touches.size > 1) {
					if (activeType === "touch" && shaping) endShape(true);
					touchLock = true;
					resetGesture();
					return;
				}
			}
			if (e.pointerType === "pen") {
				pencilSeen = true;
				if (activeType !== "pen" && shaping) endShape(true);
				touches.forEach(function (_, id) {
					ignored.add(id);
				});
				touches.clear();
				gesture = null;
			}
			if (!shaping) startShape(e);
			return;
		}

		if (e.pointerType === "pen") {
			pencilSeen = true;
			// A palm touched down just before the Pencil: throw that mark away.
			if (current && activeType === "touch") discardCurrent();
			// Anything resting on the screen now is a palm, not a gesture.
			touches.forEach(function (_, id) {
				ignored.add(id);
			});
			touches.clear();
			gesture = null;
			if (!current) startStroke(e);
			return;
		}

		if (e.pointerType === "touch") {
			if (current && activeType === "pen") {
				// Touches that land while the Pencil writes are a palm.
				ignored.add(e.pointerId);
				return;
			}
			touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pencilSeen || touchLock || touches.size > 1) {
				// A second finger turns a finger stroke into a pinch.
				if (current && activeType === "touch") discardCurrent();
				touchLock = true;
				resetGesture();
				return;
			}
		}

		if (!current) startStroke(e);
	});

	board.addEventListener("pointermove", function (e) {
		if ((lasso || grab) && e.pointerId === activeId) {
			moveSelectPointer(e);
			return;
		}
		if (shaping && e.pointerId === activeId) {
			moveShape(e);
			return;
		}
		if (current && e.pointerId === activeId) {
			moveStroke(e);
			return;
		}
		var finger = touches.get(e.pointerId);
		if (finger && gesture) {
			finger.x = e.clientX;
			finger.y = e.clientY;
			moveGesture();
		}
	});

	function pointerEnd(e, cancelled) {
		if (e.pointerType === "touch") liftFinger(e.pointerId);
		if ((lasso || grab) && e.pointerId === activeId) {
			endSelectPointer(cancelled);
			return;
		}
		if (shaping && e.pointerId === activeId) {
			// A cancelled drag is a palm or a second finger: no mark either way.
			endShape(cancelled && activeType !== "pen");
			return;
		}
		if (!current || e.pointerId !== activeId) return;
		current.predicted = null;
		// A cancelled Pencil stroke is still something you wrote; a cancelled touch is likely a palm.
		if (cancelled && activeType !== "pen") discardCurrent();
		else commitCurrent();
	}

	board.addEventListener("pointerup", function (e) {
		pointerEnd(e, false);
	});
	board.addEventListener("pointercancel", function (e) {
		pointerEnd(e, true);
	});

	// Trackpad and mouse wheel: scroll to pan, pinch (or Ctrl/⌘ + scroll) to zoom.
	board.addEventListener(
		"wheel",
		function (e) {
			e.preventDefault();
			var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
			var dx = e.deltaX * unit;
			var dy = e.deltaY * unit;
			if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.01), true);
			else panBy(-dx, -dy);
		},
		{ passive: false }
	);

	// Stop iOS from scrolling, zooming, selecting or showing the magnifier while writing.
	["touchstart", "touchmove", "gesturestart", "gesturechange"].forEach(function (type) {
		board.addEventListener(
			type,
			function (e) {
				e.preventDefault();
			},
			{ passive: false }
		);
	});
	document.addEventListener("gesturestart", function (e) {
		e.preventDefault();
	});
	document.addEventListener("contextmenu", function (e) {
		// The code box needs its menu for Paste.
		if (e.target.closest && e.target.closest("#code-dialog")) return;
		e.preventDefault();
	});

	// ---------- Toolbar ----------

	var undoBtn = document.getElementById("undo");
	var redoBtn = document.getElementById("redo");
	var clearBtn = document.getElementById("clear");
	var copyBtn = document.getElementById("copy");
	var sizeGroup = document.getElementById("sizes");
	// The dividers either side of the colour and thickness pickers, which go with them.
	var pickerDividers = [document.getElementById("div-colours"), document.getElementById("div-sizes")];

	// Looks back from the end for anything still showing, stopping at the last "clear".
	// An eraser on its own leaves nothing behind, so it doesn't count.
	function pageIsEmpty() {
		for (var i = actions.length - 1; i >= 0; i--) {
			var a = actions[i];
			if (a.type === "clear") return true;
			if (!a.deleted && a.tool !== "eraser") return false;
		}
		return true;
	}

	function updateButtons() {
		undoBtn.disabled = !undoStack.length;
		redoBtn.disabled = !redoStack.length;
		clearBtn.disabled = pageIsEmpty();
		copyBtn.disabled = pageIsEmpty();
	}

	// Does an edit and remembers how to take it back.
	function pushOp(op) {
		op.redo();
		undoStack.push(op);
		redoStack = [];
		updateButtons();
	}

	// An edit that has already been made: just remember how to take it back.
	function recordOp(op) {
		undoStack.push(op);
		redoStack = [];
		updateButtons();
	}

	// Puts strokes or pictures on the page as one undoable step. They go on the end, and
	// steps are always taken back in order, so taking them off the end again is safe.
	function addActions(list) {
		pushOp({
			redo: function () {
				list.forEach(pushAction);
			},
			undo: function () {
				for (var i = 0; i < list.length; i++) popAction();
			},
		});
	}

	function undo() {
		if (current || !undoStack.length) return;
		clearSelection();
		var op = undoStack.pop();
		op.undo();
		redoStack.push(op);
		updateButtons();
	}

	function redo() {
		if (current || !redoStack.length) return;
		clearSelection();
		var op = redoStack.pop();
		op.redo();
		undoStack.push(op);
		updateButtons();
	}

	function clearPage() {
		if (current || pageIsEmpty()) return;
		clearSelection();
		// Clearing is just another step, so Undo brings the page back.
		addActions([{ type: "clear" }]);
	}

	function resetZoom() {
		zoomAt(width / 2, height / 2, 1 / view.s);
	}

	function press(selector, attr, value) {
		document.querySelectorAll(selector).forEach(function (b) {
			b.setAttribute("aria-pressed", String(b.dataset[attr] === value));
		});
	}

	function selectTool(name) {
		// Leaving the lasso puts down whatever it was holding.
		if (name !== tool) clearSelection();
		tool = name;
		if (name === "pen" || name === "highlighter") inkTool = name;
		press(".tool", "tool", tool);
		// The lasso has no colour or thickness of its own, so neither picker shows.
		var picking = tool !== LASSO;
		// Lines and axes take the pen's colours: a highlighter-yellow graph is no use.
		var showing = tool === SHAPE || tool === GRAPH ? "pen" : inkTool;
		// Show the colours of the pen or the highlighter, whichever is in hand or was last.
		document.querySelectorAll(".swatches").forEach(function (g) {
			g.hidden = !picking || g.dataset.for !== showing;
		});
		sizeGroup.hidden = !picking;
		pickerDividers.forEach(function (d) {
			d.hidden = !picking;
		});
		press(".swatch", "color", colorChoice[showing]);
		// Each tool remembers its own thickness.
		if (picking) press(".size", "size", String(sizeChoice[tool]));
	}

	document.querySelectorAll(".tool").forEach(function (b) {
		b.addEventListener("click", function () {
			var which = b.dataset.tool;
			// Tapping a tool that's already in hand opens its own menu, as in GoodNotes:
			// which pen, which shape, or what the graph is to show.
			if (which === tool) {
				if (which === "pen") {
					if (penMenu.hidden) openPenMenu(b);
					else closePenMenu();
					return;
				}
				if (which === SHAPE) {
					closeMenus();
					if (shapeMenu.hidden) placeMenu(shapeMenu, b);
					else shapeMenu.hidden = true;
					return;
				}
				if (which === GRAPH) {
					closeMenus();
					showGraphDialog(null);
					return;
				}
			}
			closeMenus();
			selectTool(which);
		});
	});

	// ---------- Tool menus ----------

	var penMenu = document.getElementById("pen-menu");
	var shapeMenu = document.getElementById("shape-menu");

	// Shuts every menu that's open.
	function closeMenus() {
		penMenu.hidden = true;
		shapeMenu.hidden = true;
		copyMenu.hidden = true;
		notesMenu.hidden = true;
		moreMenu.hidden = true;
	}

	// Draws a sample stroke for a pen type, light at both ends and heavy in the middle.
	function drawPreview(canvas, pen) {
		var w = canvas.clientWidth;
		var h = canvas.clientHeight;
		var ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(w * ratio);
		canvas.height = Math.round(h * ratio);
		var ctx = canvas.getContext("2d");
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		var s = { tool: "pen", pen: pen, color: colorChoice.pen, size: SIZES.pen[sizeChoice.pen], points: [] };
		var d = 0;
		for (var i = 0; i <= 40; i++) {
			var t = i / 40;
			var pt = {
				x: 6 + t * (w - 12),
				y: h / 2 + Math.sin(t * Math.PI * 2) * (h / 2 - 6),
				p: 0.15 + 0.6 * Math.sin(t * Math.PI),
				v: 0.6,
			};
			var before = s.points[s.points.length - 1];
			if (before) d += Math.hypot(pt.x - before.x, pt.y - before.y);
			pt.d = d;
			s.points.push(pt);
		}
		fillShape(ctx, s, penShape(s, null, true));
	}

	// Opens a menu under its button, kept inside the window.
	function placeMenu(menu, button) {
		var r = button.getBoundingClientRect();
		menu.hidden = false;
		var left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
		menu.style.left = Math.max(8, left) + "px";
		menu.style.top = r.bottom + 10 + "px";
	}

	function openPenMenu(button) {
		shapeMenu.hidden = true;
		copyMenu.hidden = true;
		notesMenu.hidden = true;
		placeMenu(penMenu, button);
		penMenu.querySelectorAll("button").forEach(function (b) {
			drawPreview(b.querySelector("canvas"), b.dataset.pen);
		});
	}

	function closePenMenu() {
		penMenu.hidden = true;
	}

	shapeMenu.querySelectorAll("button").forEach(function (b) {
		b.addEventListener("click", function () {
			shapeKind = b.dataset.shape;
			shapeMenu.querySelectorAll("button").forEach(function (o) {
				o.setAttribute("aria-checked", String(o === b));
			});
			shapeMenu.hidden = true;
			selectTool(SHAPE);
		});
	});

	// Any tap outside a menu (and not on the button that toggles it) closes it.
	document.addEventListener("pointerdown", function (e) {
		var t = e.target;
		[
			[penMenu, '[data-tool="pen"]'],
			[shapeMenu, '[data-tool="shape"]'],
			[copyMenu, "#copy"],
			[notesMenu, "#notes"],
			[moreMenu, "#more"],
		].forEach(function (m) {
			if (m[0].hidden || m[0].contains(t)) return;
			if (t.closest && t.closest(m[1])) return;
			m[0].hidden = true;
		});
		if (!(t.closest && t.closest(".picker"))) closePickers();
	});

	penMenu.querySelectorAll("button").forEach(function (b) {
		b.addEventListener("click", function () {
			penType = b.dataset.pen;
			penMenu.querySelectorAll("button").forEach(function (o) {
				o.setAttribute("aria-checked", String(o === b));
			});
			closePenMenu();
		});
	});

	// In a narrow window only the colour and thickness in use show. Tapping it opens the
	// rest; picking one closes them again.
	var narrow = matchMedia("(max-width: 860px)");

	function closePickers() {
		document.querySelectorAll(".picker.open").forEach(function (g) {
			g.classList.remove("open");
		});
	}

	// True if this tap only opened the picker.
	function openPicker(b) {
		var group = b.closest(".picker");
		if (!narrow.matches || group.classList.contains("open") || b.getAttribute("aria-pressed") !== "true") {
			closePickers();
			return false;
		}
		closePickers();
		group.classList.add("open");
		return true;
	}

	document.querySelectorAll(".size").forEach(function (b) {
		b.addEventListener("click", function () {
			if (openPicker(b)) return;
			sizeChoice[tool] = Number(b.dataset.size);
			press(".size", "size", b.dataset.size);
		});
	});

	document.querySelectorAll(".swatch").forEach(function (b) {
		b.addEventListener("click", function () {
			// Picking the colour already in use with another tool in hand still switches tool.
			var forTool = b.closest(".swatches").dataset.for;
			if (tool === forTool && openPicker(b)) return;
			closePickers();
			colorChoice[forTool] = b.dataset.color;
			// Picking a colour means you want to write (or highlight) with it.
			selectTool(forTool);
		});
	});

	// ---------- Lasso ----------
	//
	// Draw a loop around some writing and it's picked up: the strokes are lifted off the
	// page (the tiles under them are drawn again without them) and float above it as one
	// picture, which can then be dragged, resized from a corner, turned, flipped or
	// duplicated. Each gesture is pressed back into the page as soon as it ends, with the
	// strokes' own points moved for real, so they stay sharp at any zoom and Undo takes
	// back one gesture at a time.

	// The loop being drawn, in page coordinates.
	var lasso = null;
	// What's picked up, or null.
	var sel = null;
	// The gesture happening on it: a move, a corner or the turn handle.
	var grab = null;
	// The handles, in screen pixels: how big they're drawn and how near counts as a hit.
	var HANDLE = 11;
	var HANDLE_HIT = 22;
	// How far the turn handle sits off the top edge.
	var ROT_GAP = 30;

	var selBar = document.getElementById("sel-bar");
	var selEdit = document.getElementById("sel-edit");
	var selBarSize = { w: 0, h: 0 };

	// ---------- Lasso: geometry ----------

	function pointInPoly(poly, x, y) {
		var inside = false;
		for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			var a = poly[i];
			var b = poly[j];
			if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
		}
		return inside;
	}

	// Two transforms into one. Each is [a, b, c, d, e, f], as in setTransform:
	// x' = a x + c y + e, y' = b x + d y + f. The result does n first, then m.
	function combine(m, n) {
		return [
			m[0] * n[0] + m[2] * n[1],
			m[1] * n[0] + m[3] * n[1],
			m[0] * n[2] + m[2] * n[3],
			m[1] * n[2] + m[3] * n[3],
			m[0] * n[4] + m[2] * n[5] + m[4],
			m[1] * n[4] + m[3] * n[5] + m[5],
		];
	}

	// The selection's live transform: a shift, a turn and an even scale about its centre.
	// It's identity whenever no gesture is in progress.
	function selMatrix() {
		var c = Math.cos(sel.rot) * sel.k;
		var s = Math.sin(sel.rot) * sel.k;
		return [c, s, -s, c, sel.cx + sel.tx - (c * sel.cx - s * sel.cy), sel.cy + sel.ty - (s * sel.cx + c * sel.cy)];
	}

	function applyMatrix(m, x, y) {
		return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
	}

	// The four corners of the selection, where they are on screen right now.
	function selCorners() {
		var m = selMatrix();
		var box = [
			[sel.x0, sel.y0],
			[sel.x1, sel.y0],
			[sel.x1, sel.y1],
			[sel.x0, sel.y1],
		];
		var out = [];
		for (var i = 0; i < 4; i++) {
			var p = applyMatrix(m, box[i][0], box[i][1]);
			out.push({ x: p.x * view.s + view.x, y: p.y * view.s + view.y });
		}
		return out;
	}

	// Where the selection reaches on the page, including any gesture in progress.
	function selBounds() {
		if (!sel) return null;
		var base = listBox(sel.list);
		if (!base) return null;
		var m = selMatrix();
		var box = [
			[base.x0, base.y0],
			[base.x1, base.y0],
			[base.x1, base.y1],
			[base.x0, base.y1],
		];
		var moved = null;
		for (var i = 0; i < 4; i++) {
			var p = applyMatrix(m, box[i][0], box[i][1]);
			var one = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
			moved = moved ? unionBox(moved, one) : one;
		}
		return unionBox(base, moved);
	}

	// ---------- Lasso: picking things up ----------

	// Only finished strokes and pictures on the page can be picked up. An eraser isn't a
	// thing on the page, it's a hole in one.
	function selectable() {
		return pageActions().filter(function (a) {
			return a.tool === "pen" || a.tool === "highlighter" || isFramed(a);
		});
	}

	// Rubbing something out doesn't take it away: the eraser is a hole cut in the page,
	// and the stroke underneath is still sitting there with nothing showing. The lasso
	// has to tell the difference, or a loop drawn over a blank patch picks up writing
	// that was rubbed out ages ago and drags it back into view.

	function boxesOverlap(a, b) {
		return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
	}

	// How far a point is from a line between two others.
	function distToSeg(x, y, a, b) {
		var dx = b.x - a.x;
		var dy = b.y - a.y;
		var l = dx * dx + dy * dy;
		var t = l ? ((x - a.x) * dx + (y - a.y) * dy) / l : 0;
		t = clamp(t, 0, 1);
		return len2(x - (a.x + t * dx), y - (a.y + t * dy));
	}

	// The eraser swipes drawn after this, over the top of it. Ones drawn before it are
	// underneath and never took anything off it.
	function erasersOver(a) {
		var out = [];
		var from = actions.indexOf(a);
		if (from < 0) return out;
		for (var i = from + 1; i < actions.length; i++) {
			var e = actions[i];
			if (e.deleted || e.tool !== "eraser" || !e.points) continue;
			if (!boxesOverlap(e.box, a.box)) continue;
			out.push(e);
		}
		return out;
	}

	// Is this spot on the page covered by one of the swipes?
	function underErasers(x, y, erasers) {
		for (var i = 0; i < erasers.length; i++) {
			var e = erasers[i];
			var b = e.box;
			// The box is drawn wider than the swipe, so anything outside it is clear.
			if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
			var r = e.size / 2;
			var pts = e.points;
			if (pts.length === 1) {
				if (len2(x - pts[0].x, y - pts[0].y) <= r) return true;
				continue;
			}
			for (var j = 1; j < pts.length; j++) {
				if (distToSeg(x, y, pts[j - 1], pts[j]) <= r) return true;
			}
		}
		return false;
	}

	// Walks the middle of a stroke and both its edges, stopping at the first spot fn
	// says yes to. The steps are no longer than the narrowest eraser's reach, so a swipe
	// can't slip between two of them unnoticed.
	function walkStroke(a, step, fn) {
		var pts = a.points;
		var r = a.size / 2;
		for (var i = 0; i < pts.length; i++) {
			var p = pts[i];
			var q = pts[i + 1];
			// Square across the way the line is heading, to reach its two edges.
			var ref = q || pts[i - 1];
			var nx = 0;
			var ny = 0;
			if (ref) {
				var dx = q ? ref.x - p.x : p.x - ref.x;
				var dy = q ? ref.y - p.y : p.y - ref.y;
				var d = len2(dx, dy);
				if (d) {
					nx = (-dy / d) * r;
					ny = (dx / d) * r;
				}
			}
			if (fn(p.x, p.y) || fn(p.x + nx, p.y + ny) || fn(p.x - nx, p.y - ny)) return true;
			if (!q) continue;
			// Samples can be far apart when the pen moved fast, so fill in between.
			var steps = Math.floor(len2(q.x - p.x, q.y - p.y) / step);
			for (var j = 1; j < steps; j++) {
				var t = j / steps;
				var mx = p.x + (q.x - p.x) * t;
				var my = p.y + (q.y - p.y) * t;
				if (fn(mx, my) || fn(mx + nx, my + ny) || fn(mx - nx, my - ny)) return true;
			}
		}
		return false;
	}

	// Is any of this still showing? Only once every last bit of it is under an eraser is
	// it counted as gone, so a stroke the eraser only nicked still gets picked up.
	function stillShowing(a) {
		var erasers = erasersOver(a);
		if (!erasers.length) return true;
		var step = Infinity;
		for (var i = 0; i < erasers.length; i++) step = Math.min(step, erasers[i].size / 2);
		step = Math.max(2, step);
		var clear = function (x, y) {
			return !underErasers(x, y, erasers);
		};
		if (isFramed(a)) {
			// A picture or a graph: a grid of spots across it, turned as it is.
			var cos = Math.cos(a.rot);
			var sin = Math.sin(a.rot);
			var n = Math.max(8, Math.ceil(Math.max(a.w, a.h) / step));
			for (var iy = 0; iy <= n; iy++) {
				for (var ix = 0; ix <= n; ix++) {
					var lx = (ix / n - 0.5) * a.w;
					var ly = (iy / n - 0.5) * a.h;
					if (clear(a.cx + lx * cos - ly * sin, a.cy + lx * sin + ly * cos)) return true;
				}
			}
			return false;
		}
		return walkStroke(a, step, clear);
	}

	// Mostly inside the loop counts as inside, so a loop drawn close around a word still
	// takes the whole word.
	function inLoop(a, poly) {
		var pts = [];
		if (isFramed(a)) {
			var c = Math.cos(a.rot);
			var s = Math.sin(a.rot);
			[[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].forEach(function (u) {
				var x = (u[0] * a.w) / 2;
				var y = (u[1] * a.h) / 2;
				pts.push({ x: a.cx + x * c - y * s, y: a.cy + x * s + y * c });
			});
		} else {
			var step = Math.max(1, Math.floor(a.points.length / 48));
			for (var i = 0; i < a.points.length; i += step) pts.push(a.points[i]);
			pts.push(a.points[a.points.length - 1]);
		}
		var inside = 0;
		for (var j = 0; j < pts.length; j++) {
			if (pointInPoly(poly, pts[j].x, pts[j].y)) inside++;
		}
		return inside / pts.length >= 0.6;
	}

	function measureSelection() {
		var b = listBox(sel.list);
		sel.x0 = b.x0;
		sel.y0 = b.y0;
		sel.x1 = b.x1;
		sel.y1 = b.y1;
		sel.cx = (b.x0 + b.x1) / 2;
		sel.cy = (b.y0 + b.y1) / 2;
	}

	// Draws what's picked up once, into its own picture. While a gesture is in progress
	// that picture is just moved about, which costs nothing however much was picked up.
	function bakeSelectionCanvas() {
		var w = sel.x1 - sel.x0;
		var h = sel.y1 - sel.y0;
		// The zoom it would ideally be drawn at, remembered so a big selection held down
		// to the size limit below isn't pointlessly drawn again every frame.
		var want = clamp(dpr * view.s, 0.1, 4);
		var res = want;
		sel.wanted = want;
		// Keep it to a size Safari is happy with.
		var limit = 4096;
		var px = Math.max(1, w * res);
		var py = Math.max(1, h * res);
		if (px > limit || py > limit) res *= limit / Math.max(px, py);
		var c = sel.canvas || (sel.canvas = document.createElement("canvas"));
		c.width = Math.max(1, Math.ceil(w * res));
		c.height = Math.max(1, Math.ceil(h * res));
		sel.res = res;
		var ctx = c.getContext("2d");
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, c.width, c.height);
		ctx.setTransform(res, 0, 0, res, -sel.x0 * res, -sel.y0 * res);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		sel.list.forEach(function (a) {
			drawFloating(ctx, a);
		});
	}

	function drawFloating(ctx, a) {
		if (a.tool === "image") {
			drawImageAction(ctx, a);
			return;
		}
		if (a.tool === "graph") {
			drawGraph(ctx, a, sel ? sel.res || view.s : view.s);
			return;
		}
		if (a.tool === "highlighter") {
			// A flat see-through fill. It's drawn into the page properly, blending with
			// what's under it, as soon as the selection is put down.
			ctx.globalCompositeOperation = "source-over";
			ctx.globalAlpha = HIGHLIGHT_ALPHA[theme];
			ctx.fillStyle = palette[a.color];
			ctx.fill(highlighterShape(a, Math.max(view.s, 1)));
			ctx.globalAlpha = 1;
			return;
		}
		var detail = Math.max(view.s, 1);
		if (!a.shape || needsRebuild(a, view.s)) {
			a.shape = penShape(a, null, true, detail);
			a.detail = detail;
		}
		fillShape(ctx, a, a.shape);
	}

	function makeSelection(list) {
		clearSelection();
		if (!list.length) return;
		sel = { list: list, tx: 0, ty: 0, rot: 0, k: 1, canvas: null, res: 1, wanted: 1, corners: [], handles: [] };
		list.forEach(function (a) {
			a.lifted = true;
		});
		measureSelection();
		bakeSelectionCanvas();
		layoutSelection();
		selEdit.hidden = !(list.length === 1 && list[0].tool === "graph");
		selBar.hidden = false;
		selBarSize = { w: selBar.offsetWidth, h: selBar.offsetHeight };
		layoutSelection();
		// The page redraws without what's been lifted off it.
		rerenderBox(listBox(list));
	}

	// Puts the selection back down on the page, as it now stands.
	function clearSelection() {
		if (!sel) return;
		bakeSelection();
		var box = selBounds();
		sel.list.forEach(function (a) {
			a.lifted = false;
		});
		if (sel.canvas) sel.canvas.width = sel.canvas.height = 0;
		sel = null;
		grab = null;
		selBar.hidden = true;
		rerenderBox(box);
	}

	// ---------- Lasso: changing what's picked up ----------

	// Everything needed to put an action back as it was.
	function snapshot(a) {
		if (isFramed(a)) {
			return {
				cx: a.cx, cy: a.cy, w: a.w, h: a.h, rot: a.rot,
				flipX: a.flipX, flipY: a.flipY, box: a.box,
				// A graph is mirrored by turning its numbers round, so they go back too.
				x0: a.x0, x1: a.x1, y0: a.y0, y1: a.y1, size: a.size,
			};
		}
		return { points: a.points, size: a.size, scale: a.scale, box: a.box, shape: a.shape, detail: a.detail };
	}

	function restore(a, state) {
		for (var key in state) {
			if (Object.prototype.hasOwnProperty.call(state, key)) a[key] = state[key];
		}
	}

	// Moves one stroke or picture for real. map: where a page point goes. k: how much
	// bigger it gets. turn: how far it turns. mirror: the map is a reflection.
	function applyMap(a, map, k, turn, mirrorX, mirrorY) {
		if (isFramed(a)) {
			var c = map(a.cx, a.cy);
			a.cx = c.x;
			a.cy = c.y;
			a.w *= k;
			a.h *= k;
			if (mirrorX !== mirrorY) {
				// A reflection turns the thing the other way and mirrors it.
				a.rot = -a.rot + turn;
				if (a.tool === "graph") {
					// A graph is mirrored by turning its numbers round instead, so they
					// stay the right way up and still say what the curve is doing.
					if (mirrorX) {
						var x0 = a.x0;
						a.x0 = -a.x1;
						a.x1 = -x0;
					} else {
						var y0 = a.y0;
						a.y0 = -a.y1;
						a.y1 = -y0;
					}
				} else if (mirrorX) a.flipX = !a.flipX;
				else a.flipY = !a.flipY;
			} else {
				a.rot += turn;
				// Both ways at once is just a half turn.
				if (mirrorX) a.rot += Math.PI;
			}
			if (a.tool === "graph") a.size *= k;
			a.box = frameBox(a);
			return;
		}
		// New points rather than changed ones, so the old array can be kept for Undo.
		a.points = a.points.map(function (p) {
			var q = map(p.x, p.y);
			return { x: q.x, y: q.y, p: p.p, v: p.v, d: p.d * k };
		});
		a.size *= k;
		// scale is the zoom the stroke was written at, which is how the wobble clean-up
		// knows how big a screen pixel is. Bigger strokes mean bigger pixels.
		a.scale = (a.scale || 1) / k;
		// The outline is built again from the new points, so it stays sharp.
		a.shape = null;
		a.detail = 0;
		a.box = bounds(a.points, a.size * 1.5);
	}

	// Changes the selected strokes and pictures for real, as one step that Undo can take back.
	function transformSelection(map, k, turn, mirrorX, mirrorY) {
		var list = sel.list.slice();
		var before = list.map(snapshot);
		var oldBox = listBox(list);
		list.forEach(function (a) {
			applyMap(a, map, k, turn, mirrorX, mirrorY);
		});
		var after = list.map(snapshot);
		var box = unionBox(oldBox, listBox(list));

		function set(states) {
			for (var i = 0; i < list.length; i++) restore(list[i], states[i]);
			rerenderBox(box);
		}

		recordOp({
			redo: function () {
				set(after);
			},
			undo: function () {
				set(before);
			},
		});
		rerenderBox(box);
		measureSelection();
		bakeSelectionCanvas();
		layoutSelection();
	}

	// Presses the gesture that just finished into the page.
	function bakeSelection() {
		if (!sel) return;
		if (sel.tx === 0 && sel.ty === 0 && sel.rot === 0 && sel.k === 1) return;
		var m = selMatrix();
		var k = sel.k;
		var turn = sel.rot;
		sel.tx = sel.ty = sel.rot = 0;
		sel.k = 1;
		transformSelection(
			function (x, y) {
				return applyMatrix(m, x, y);
			},
			k,
			turn,
			false,
			false
		);
	}

	function flipSelection(horizontal) {
		if (!sel) return;
		bakeSelection();
		var cx = sel.cx;
		var cy = sel.cy;
		transformSelection(
			horizontal
				? function (x, y) {
						return { x: 2 * cx - x, y: y };
					}
				: function (x, y) {
						return { x: x, y: 2 * cy - y };
					},
			1,
			0,
			horizontal,
			!horizontal
		);
	}

	function cloneAction(a) {
		var c = {};
		for (var key in a) {
			if (Object.prototype.hasOwnProperty.call(a, key)) c[key] = a[key];
		}
		c.lifted = false;
		c.deleted = false;
		c.box = { x0: a.box.x0, y0: a.box.y0, x1: a.box.x1, y1: a.box.y1 };
		// A graph's sums are its own, or editing the copy would change the original too.
		if (a.funcs) {
			c.funcs = a.funcs.map(function (f) {
				return { expr: f.expr, color: f.color, fn: f.fn };
			});
		}
		if (!isFramed(a)) {
			c.points = a.points.map(function (p) {
				return { x: p.x, y: p.y, p: p.p, v: p.v, d: p.d };
			});
			c.shape = null;
			c.detail = 0;
		}
		return c;
	}

	function duplicateSelection() {
		if (!sel) return;
		bakeSelection();
		// Offset by a little, about 20 screen pixels, so the copy can be seen.
		var off = 20 / view.s;
		var copies = sel.list.map(function (a) {
			var c = cloneAction(a);
			applyMap(
				c,
				function (x, y) {
					return { x: x + off, y: y + off };
				},
				1,
				0,
				false,
				false
			);
			return c;
		});
		clearSelection();
		addActions(copies);
		// The copy is what's now picked up, so it can be dragged straight off.
		makeSelection(copies);
	}

	function deleteSelection() {
		if (!sel) return;
		bakeSelection();
		var list = sel.list.slice();
		var box = listBox(list);
		clearSelection();
		pushOp({
			redo: function () {
				list.forEach(function (a) {
					a.deleted = true;
				});
				rerenderBox(box);
			},
			undo: function () {
				list.forEach(function (a) {
					a.deleted = false;
				});
				rerenderBox(box);
			},
		});
	}

	// ---------- Lasso: drawing it ----------

	// Works out where the box, its handles and its bar are on screen.
	function layoutSelection() {
		if (!sel) return;
		var poly = selCorners();
		sel.corners = poly;
		var ids = ["nw", "ne", "se", "sw"];
		var hs = [];
		for (var i = 0; i < 4; i++) hs.push({ id: ids[i], x: poly[i].x, y: poly[i].y });
		// The turn handle sits off the middle of the top edge, straight out from it.
		var mx = (poly[0].x + poly[1].x) / 2;
		var my = (poly[0].y + poly[1].y) / 2;
		var ux = poly[0].x - poly[3].x;
		var uy = poly[0].y - poly[3].y;
		var ul = len2(ux, uy) || 1;
		hs.push({ id: "rot", x: mx + (ux / ul) * ROT_GAP, y: my + (uy / ul) * ROT_GAP, from: { x: mx, y: my } });
		sel.handles = hs;
		placeSelBar();
	}

	// The bar sits above the selection, or below it when there's no room up there.
	function placeSelBar() {
		if (!sel || selBar.hidden) return;
		var poly = sel.corners;
		var cx = 0;
		var top = Infinity;
		var bottom = -Infinity;
		for (var i = 0; i < poly.length; i++) {
			cx += poly[i].x / poly.length;
			top = Math.min(top, poly[i].y);
			bottom = Math.max(bottom, poly[i].y);
		}
		var w = selBarSize.w || selBar.offsetWidth;
		var h = selBarSize.h || selBar.offsetHeight;
		var y = top - h - ROT_GAP - 8;
		if (y < 72) y = Math.min(bottom + 22, window.innerHeight - h - 8);
		selBar.style.left = clamp(cx - w / 2, 8, Math.max(8, window.innerWidth - w - 8)) + "px";
		selBar.style.top = clamp(y, 8, Math.max(8, window.innerHeight - h - 8)) + "px";
	}

	function drawSelection() {
		layoutSelection();
		var s = sel;
		// Zoomed a long way since it was picked up: draw its picture again at the new zoom,
		// so it stays sharp. The picture is only ever redrawn when the zoom really changes.
		var want = clamp(dpr * view.s, 0.1, 4);
		if (want > s.wanted * 1.6 || want * 1.6 < s.wanted) bakeSelectionCanvas();
		if (s.canvas && s.canvas.width > 1) {
			// The picture maps onto the page, and the page onto the screen. One draw.
			var k = dpr * view.s;
			var toScreen = [k, 0, 0, k, Math.round(dpr * view.x), Math.round(dpr * view.y)];
			var fromCanvas = [1 / s.res, 0, 0, 1 / s.res, s.x0, s.y0];
			var m = combine(toScreen, combine(selMatrix(), fromCanvas));
			live.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
			live.globalCompositeOperation = "source-over";
			live.globalAlpha = 1;
			live.imageSmoothingQuality = "high";
			live.drawImage(s.canvas, 0, 0);
		}

		// The box and its handles are drawn at screen size, so they don't grow with the zoom.
		live.setTransform(dpr, 0, 0, dpr, 0, 0);
		live.setLineDash([]);
		live.globalAlpha = 1;
		var accent = palette.blue;
		var poly = s.corners;
		live.beginPath();
		live.moveTo(poly[0].x, poly[0].y);
		for (var i = 1; i < 4; i++) live.lineTo(poly[i].x, poly[i].y);
		live.closePath();
		live.strokeStyle = accent;
		live.lineWidth = 1.5;
		live.stroke();

		var rot = s.handles[s.handles.length - 1];
		live.beginPath();
		live.moveTo(rot.from.x, rot.from.y);
		live.lineTo(rot.x, rot.y);
		live.stroke();

		for (i = 0; i < s.handles.length; i++) {
			var h = s.handles[i];
			live.beginPath();
			live.arc(h.x, h.y, HANDLE / 2, 0, Math.PI * 2);
			live.fillStyle = palette.paper;
			live.fill();
			live.lineWidth = 2;
			live.stroke();
		}
	}

	function drawLasso() {
		applyView(live);
		live.globalCompositeOperation = "source-over";
		var pts = lasso.points;
		live.beginPath();
		live.moveTo(pts[0].x, pts[0].y);
		for (var i = 1; i < pts.length; i++) live.lineTo(pts[i].x, pts[i].y);
		live.closePath();
		live.fillStyle = palette.blue;
		live.globalAlpha = 0.08;
		live.fill();
		live.globalAlpha = 0.9;
		live.strokeStyle = palette.blue;
		live.lineWidth = 1.4 / view.s;
		live.setLineDash([6 / view.s, 5 / view.s]);
		live.stroke();
		live.setLineDash([]);
		live.globalAlpha = 1;
	}

	// ---------- Lasso: the gestures ----------

	// What's under the finger: a handle, the selection itself, or nothing.
	function grabAt(cx, cy) {
		if (!sel) return null;
		layoutSelection();
		var poly = sel.corners;
		// On a small selection the corners would otherwise swallow the whole box and leave
		// nowhere to take hold of it, so their reach shrinks with it.
		var side = Math.min(len2(poly[1].x - poly[0].x, poly[1].y - poly[0].y), len2(poly[3].x - poly[0].x, poly[3].y - poly[0].y));
		var reach = clamp(side * 0.3, 9, HANDLE_HIT);
		for (var i = 0; i < sel.handles.length; i++) {
			var h = sel.handles[i];
			// The turn handle sits outside the box, so it always has room.
			var r = h.id === "rot" ? HANDLE_HIT : reach;
			if (len2(cx - h.x, cy - h.y) <= r) return h.id;
		}
		if (pointInPoly(poly, cx, cy)) return "move";
		return null;
	}

	// The corner opposite the one being dragged stays put, in the selection's own box.
	var OPPOSITE = { nw: [1, 1], ne: [0, 1], se: [0, 0], sw: [1, 0] };
	var CORNER = { nw: [0, 0], ne: [1, 0], se: [1, 1], sw: [0, 1] };

	function boxCorner(which) {
		return { x: which[0] ? sel.x1 : sel.x0, y: which[1] ? sel.y1 : sel.y0 };
	}

	function startSelectPointer(e) {
		activeId = e.pointerId;
		activeType = e.pointerType;
		var id = grabAt(e.clientX, e.clientY);
		if (id) {
			startGrab(id, e);
			return;
		}
		// Nothing under the finger: put down what was held and draw a new loop.
		clearSelection();
		lasso = { points: [toPage(e)], from: { x: e.clientX, y: e.clientY }, moved: false };
		requestRender();
	}

	function startGrab(id, e) {
		var p = toPage(e);
		grab = { id: id, px: p.x, py: p.y, tx: sel.tx, ty: sel.ty, rot: sel.rot, k: sel.k, moved: false };
		if (id === "rot") {
			// The angle the finger is at now counts as no turn.
			grab.a0 = Math.atan2(p.y - (sel.cy + sel.ty), p.x - (sel.cx + sel.tx)) - sel.rot;
			return;
		}
		if (id === "move") return;
		var m = selMatrix();
		var anchor = boxCorner(OPPOSITE[id]);
		var corner = boxCorner(CORNER[id]);
		// Where the corner that stays put is, and how far the dragged one is from it.
		var a = applyMatrix(m, anchor.x, anchor.y);
		var c = applyMatrix(m, corner.x, corner.y);
		grab.ax = a.x;
		grab.ay = a.y;
		grab.bx = anchor.x;
		grab.by = anchor.y;
		grab.d0 = len2(c.x - a.x, c.y - a.y);
	}

	function moveSelectPointer(e) {
		var p = toPage(e);
		if (lasso) {
			var last = lasso.points[lasso.points.length - 1];
			// A point every screen pixel and a half is plenty for a loop.
			if (len2(p.x - last.x, p.y - last.y) * view.s < 1.5) return;
			lasso.points.push(p);
			if (len2(e.clientX - lasso.from.x, e.clientY - lasso.from.y) > 6) lasso.moved = true;
			requestRender();
			return;
		}
		if (!grab || !sel) return;
		dragGrab(p);
		layoutSelection();
		requestRender();
	}

	function dragGrab(p) {
		var g = grab;
		if (len2(p.x - g.px, p.y - g.py) * view.s > 2) g.moved = true;
		if (g.id === "move") {
			sel.tx = g.tx + (p.x - g.px);
			sel.ty = g.ty + (p.y - g.py);
			return;
		}
		if (g.id === "rot") {
			var a = Math.atan2(p.y - (sel.cy + sel.ty), p.x - (sel.cx + sel.tx)) - g.a0;
			// A gentle catch every 15 degrees, so writing can be straightened up.
			var step = Math.PI / 12;
			var near = Math.round(a / step) * step;
			if (Math.abs(a - near) < 0.045) a = near;
			sel.rot = a;
			return;
		}
		// A corner: how far the finger is from the corner that stays put sets the size.
		if (!(g.d0 > 0)) return;
		var k = clamp((g.k * len2(p.x - g.ax, p.y - g.ay)) / g.d0, 0.02, 100);
		sel.k = k;
		// Then the shift is set so that corner really does stay put.
		var c = Math.cos(sel.rot) * k;
		var s = Math.sin(sel.rot) * k;
		var dx = g.bx - sel.cx;
		var dy = g.by - sel.cy;
		sel.tx = g.ax - (sel.cx + dx * c - dy * s);
		sel.ty = g.ay - (sel.cy + dx * s + dy * c);
	}

	function endSelectPointer(cancelled) {
		activeId = null;
		activeType = null;
		if (lasso) {
			var l = lasso;
			lasso = null;
			if (!cancelled && l.moved && l.points.length > 2) {
				var list = selectable().filter(function (a) {
					return inLoop(a, l.points) && stillShowing(a);
				});
				if (list.length) makeSelection(list);
			}
			requestRender(true);
			return;
		}
		if (!grab) return;
		var g = grab;
		grab = null;
		if (!cancelled && g.moved) bakeSelection();
		else {
			sel.tx = g.tx;
			sel.ty = g.ty;
			sel.rot = g.rot;
			sel.k = g.k;
		}
		layoutSelection();
		requestRender(true);
	}

	selBar.querySelectorAll("button").forEach(function (b) {
		b.addEventListener("click", function () {
			var what = b.dataset.sel;
			if (what === "edit") {
				// The graph stays held, so it can be nudged again after.
				if (sel && sel.list.length === 1 && sel.list[0].tool === "graph") showGraphDialog(sel.list[0]);
			} else if (what === "flip-h") flipSelection(true);
			else if (what === "flip-v") flipSelection(false);
			else if (what === "duplicate") duplicateSelection();
			else if (what === "delete") deleteSelection();
			else clearSelection();
		});
	});

	// ---------- Pictures ----------
	//
	// A pasted picture is another thing on the page, alongside the strokes: it draws into
	// the tiles like they do, the lasso picks it up like they do, and it goes into a
	// copied image. Notes codes are strokes only, so pictures aren't in them.

	function addImage(img) {
		var iw = img.naturalWidth || img.width;
		var ih = img.naturalHeight || img.height;
		if (!iw || !ih) {
			toast("That picture couldn't be read");
			return;
		}
		// One picture pixel per screen pixel, but never more than three quarters of the screen.
		var k = Math.min(1 / view.s, (width * 0.75) / view.s / iw, (height * 0.75) / view.s / ih);
		var a = {
			tool: "image",
			img: img,
			cx: (width / 2 - view.x) / view.s,
			cy: (height / 2 - view.y) / view.s,
			w: iw * k,
			h: ih * k,
			rot: 0,
			flipX: false,
			flipY: false,
		};
		a.box = frameBox(a);
		// The lasso comes out, with the picture already picked up, ready to be placed.
		selectTool(LASSO);
		addActions([a]);
		makeSelection([a]);
	}

	function loadImageBlob(blob) {
		return new Promise(function (resolve, reject) {
			var url = URL.createObjectURL(blob);
			var img = new Image();
			img.onload = function () {
				resolve(img);
			};
			img.onerror = function () {
				URL.revokeObjectURL(url);
				reject(new Error("That picture couldn't be read"));
			};
			img.src = url;
		});
	}

	function imageFromItems(items) {
		for (var i = 0; i < items.length; i++) {
			var type = items[i].type || "";
			if (type.indexOf("image/") === 0) return items[i].getAsFile ? items[i].getAsFile() : items[i];
		}
		return null;
	}

	// ⌘V, and the paste menu on an iPad with a keyboard attached.
	document.addEventListener("paste", function (e) {
		// Inside the code box, paste belongs to the text.
		if (codeDialog.open) return;
		var data = e.clipboardData;
		var blob = data && ((data.items && imageFromItems(data.items)) || (data.files && imageFromItems(data.files)));
		if (!blob) return;
		e.preventDefault();
		loadImageBlob(blob).then(addImage, function (err) {
			toast(err.message);
		});
	});

	// The paste button, for when there's no keyboard. Safari asks before it hands the
	// clipboard over, which is why this only runs straight from a tap.
	function pasteFromClipboard() {
		if (!navigator.clipboard || !navigator.clipboard.read) {
			toast("Press ⌘V to paste a picture");
			return;
		}
		navigator.clipboard.read().then(function (items) {
			for (var i = 0; i < items.length; i++) {
				var types = items[i].types || [];
				for (var j = 0; j < types.length; j++) {
					if (types[j].indexOf("image/") !== 0) continue;
					return items[i]
						.getType(types[j])
						.then(loadImageBlob)
						.then(addImage)
						.catch(function (err) {
							toast(err.message);
						});
				}
			}
			toast("No picture on the clipboard");
		}, function () {
			toast("Nothing was pasted");
		});
	}

	document.getElementById("paste").addEventListener("click", pasteFromClipboard);

	// A picture dragged onto the page from elsewhere lands where everything else does.
	// Anything else dropped is turned away: letting the browser open it would throw the
	// page, and everything on it, away.
	document.addEventListener("dragover", function (e) {
		e.preventDefault();
	});
	document.addEventListener("drop", function (e) {
		e.preventDefault();
		var files = e.dataTransfer && e.dataTransfer.files;
		var blob = files && files.length ? imageFromItems(files) : null;
		if (!blob) return;
		loadImageBlob(blob).then(addImage, function (err) {
			toast(err.message);
		});
	});

	// ---------- Straight lines, circles and boxes ----------
	//
	// Drag one out and it's laid down as ordinary ink: the same even-width ball pen a
	// hand-drawn line uses. So the eraser cuts it, the lasso picks it up and a notes code
	// carries it, with nothing added anywhere to make that work. A box is four lines and
	// an arrow is three, all laid down as one step, so one Undo takes the whole thing back.
	//
	// Nothing on an iPad can hold Shift, so the snapping happens on its own: near one of
	// the grid dots an end lands on it, and near a sixth of a turn a line straightens to it.

	var SHAPE = "shape";
	var shapeKind = "line";
	// The drag in progress: where it started, where it is now.
	var shaping = null;

	// How far apart the dots on the page are, in page units. They're drawn every GRID
	// units, doubled or halved to stay a comfortable distance apart on screen.
	function gridSpacing() {
		var step = GRID * view.s;
		while (step < 14) step *= 2;
		while (step > 56) step /= 2;
		return step / view.s;
	}

	// Lands on a dot if it's close enough to one, within the smaller of a quarter of the
	// gap and ten screen pixels.
	function snapToDots(p) {
		var gap = gridSpacing();
		var reach = Math.min(gap * 0.25, 10 / view.s);
		var x = Math.round(p.x / gap) * gap;
		var y = Math.round(p.y / gap) * gap;
		return {
			x: Math.abs(x - p.x) <= reach ? x : p.x,
			y: Math.abs(y - p.y) <= reach ? y : p.y,
		};
	}

	// Straightens a line to the nearest sixth of a half turn - every 15 degrees - when
	// it's already within four of them, keeping its length.
	function snapToAngle(from, to) {
		var dx = to.x - from.x;
		var dy = to.y - from.y;
		var len = len2(dx, dy);
		if (len < 1e-6) return to;
		var step = Math.PI / 12;
		var angle = Math.atan2(dy, dx);
		var near = Math.round(angle / step) * step;
		if (Math.abs(angle - near) > step * 0.3) return to;
		return { x: from.x + Math.cos(near) * len, y: from.y + Math.sin(near) * len };
	}

	// The colour and thickness a shape is drawn with. Shapes share the pen's colours;
	// a highlighter-yellow set of axes would be no use to anyone.
	function shapeColor() {
		return colorChoice.pen;
	}

	// Lays points out as a stroke, ready to go on the page. An even width, so a straight
	// line looks drawn with a ruler rather than by hand.
	function inkStroke(points, size, color) {
		var at = 0;
		var pts = points.map(function (p, i) {
			if (i) at += len2(p.x - points[i - 1].x, p.y - points[i - 1].y);
			return { x: p.x, y: p.y, p: 1, v: 0, d: at };
		});
		var s = {
			tool: "pen",
			pen: "ball",
			color: color,
			size: size,
			scale: view.s,
			points: pts,
		};
		s.box = bounds(pts, size * 1.5);
		s.shape = penShape(s, null, true);
		s.detail = Math.max(view.s, 1);
		return s;
	}

	function straightPoints(from, to) {
		return [
			{ x: from.x, y: from.y },
			{ x: to.x, y: to.y },
		];
	}

	// Round all the way, or an oval when the drag isn't square. Drawn from the middle out.
	function ovalPoints(from, to) {
		var rx = Math.abs(to.x - from.x);
		var ry = Math.abs(to.y - from.y);
		// Near enough round counts as round.
		var big = Math.max(rx, ry);
		if (big > 0 && Math.abs(rx - ry) / big < 0.08) rx = ry = (rx + ry) / 2;
		var round = Math.max(rx, ry);
		var n = clamp(Math.round(round * view.s * 0.9), 24, 240);
		var pts = [];
		for (var i = 0; i <= n; i++) {
			var t = (i / n) * Math.PI * 2;
			pts.push({ x: from.x + Math.cos(t) * rx, y: from.y + Math.sin(t) * ry });
		}
		return pts;
	}

	// The pieces a shape is made of, each a run of points to be laid down as one stroke.
	function shapeRuns(kind, from, to) {
		if (kind === "circle") return [ovalPoints(from, to)];
		if (kind === "rect") {
			var a = { x: from.x, y: from.y };
			var b = { x: to.x, y: to.y };
			return [
				straightPoints({ x: a.x, y: a.y }, { x: b.x, y: a.y }),
				straightPoints({ x: b.x, y: a.y }, { x: b.x, y: b.y }),
				straightPoints({ x: b.x, y: b.y }, { x: a.x, y: b.y }),
				straightPoints({ x: a.x, y: b.y }, { x: a.x, y: a.y }),
			];
		}
		var runs = [straightPoints(from, to)];
		if (kind === "arrow") {
			var dx = to.x - from.x;
			var dy = to.y - from.y;
			var len = len2(dx, dy);
			if (len > 1e-6) {
				var size = SIZES[SHAPE][sizeChoice[SHAPE]];
				var head = clamp(len * 0.22, size * 2.5, size * 7);
				var ux = dx / len;
				var uy = dy / len;
				// Two strokes back from the point, a fifth of a turn out to each side.
				var spread = Math.PI / 7;
				var c = Math.cos(spread);
				var s = Math.sin(spread);
				runs.push(straightPoints(to, { x: to.x - head * (ux * c - uy * s), y: to.y - head * (uy * c + ux * s) }));
				runs.push(straightPoints(to, { x: to.x - head * (ux * c + uy * s), y: to.y - head * (uy * c - ux * s) }));
			}
		}
		return runs;
	}

	// Where a drag has got to, with the snapping applied.
	function shapeEnds(g) {
		var from = snapToDots(g.from);
		var to = snapToDots(g.to);
		if (g.kind === "line" || g.kind === "arrow") to = snapToAngle(from, to);
		return { from: from, to: to };
	}

	// Shown while the drag is going on: the same lines, drawn plainly and quickly.
	function drawShaping(ctx) {
		if (!shaping) return;
		var ends = shapeEnds(shaping);
		ctx.save();
		applyView(ctx);
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = 1;
		ctx.setLineDash([]);
		if (shaping.kind === "graph") {
			// A graph is placed by its corners, so the frame is what's shown.
			ctx.strokeStyle = palette[shapeColor()] || palette.ink;
			ctx.lineWidth = SIZES.graph[sizeChoice.graph] / view.s;
			ctx.globalAlpha = 0.7;
			ctx.beginPath();
			ctx.rect(Math.min(ends.from.x, ends.to.x), Math.min(ends.from.y, ends.to.y), Math.abs(ends.to.x - ends.from.x), Math.abs(ends.to.y - ends.from.y));
			ctx.stroke();
			ctx.restore();
			return;
		}
		ctx.strokeStyle = palette[shapeColor()] || palette.ink;
		// The ball pen draws a little under its named width, so the preview matches.
		ctx.lineWidth = SIZES[SHAPE][sizeChoice[SHAPE]] * 0.7;
		ctx.beginPath();
		shapeRuns(shaping.kind, ends.from, ends.to).forEach(function (run) {
			ctx.moveTo(run[0].x, run[0].y);
			for (var i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
		});
		ctx.stroke();
		ctx.restore();
	}

	function startShape(e) {
		var p = toPage(e);
		activeId = e.pointerId;
		activeType = e.pointerType;
		shaping = { kind: tool === GRAPH ? "graph" : shapeKind, from: p, to: p, moved: false };
		liveDirty = true;
		requestRender();
	}

	function moveShape(e) {
		if (!shaping) return;
		var p = toPage(e);
		if (len2(p.x - shaping.from.x, p.y - shaping.from.y) * view.s > 3) shaping.moved = true;
		shaping.to = p;
		liveDirty = true;
		requestRender();
	}

	function endShape(cancelled) {
		var g = shaping;
		shaping = null;
		activeId = null;
		activeType = null;
		liveDirty = true;
		if (!g || cancelled) {
			requestRender(true);
			return;
		}
		var ends = shapeEnds(g);
		if (g.kind === "graph") {
			addGraph(g.moved ? ends : null);
			return;
		}
		// A tap with nothing dragged leaves no mark.
		if (!g.moved) {
			requestRender(true);
			return;
		}
		var size = SIZES[SHAPE][sizeChoice[SHAPE]];
		var color = shapeColor();
		addActions(
			shapeRuns(g.kind, ends.from, ends.to).map(function (run) {
				return inkStroke(run, size, color);
			})
		);
	}

	// ---------- Reading a sum ----------
	//
	// "x^2 - 3x" and the like, read into a little tree of operations and turned into a
	// function of x. Nothing is handed to the browser to run: anything that isn't
	// arithmetic, a name this knows, or a bracket is refused, so a sum out of a notes
	// code someone sent you can't do anything but arithmetic.

	var MATH_VALUES = {
		pi: Math.PI,
		"π": Math.PI,
		tau: Math.PI * 2,
		"τ": Math.PI * 2,
		e: Math.E,
		phi: (1 + Math.sqrt(5)) / 2,
	};

	// Each takes one number, unless it's in MATH_FUNCS2.
	var MATH_FUNCS = {
		sin: Math.sin,
		cos: Math.cos,
		tan: Math.tan,
		asin: Math.asin,
		acos: Math.acos,
		atan: Math.atan,
		sinh: Math.sinh,
		cosh: Math.cosh,
		tanh: Math.tanh,
		sec: function (x) {
			return 1 / Math.cos(x);
		},
		csc: function (x) {
			return 1 / Math.sin(x);
		},
		cot: function (x) {
			return 1 / Math.tan(x);
		},
		exp: Math.exp,
		ln: Math.log,
		log: function (x) {
			return Math.log(x) / Math.LN10;
		},
		log2: function (x) {
			return Math.log(x) / Math.LN2;
		},
		log10: function (x) {
			return Math.log(x) / Math.LN10;
		},
		sqrt: Math.sqrt,
		cbrt: function (x) {
			return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3);
		},
		abs: Math.abs,
		floor: Math.floor,
		ceil: Math.ceil,
		round: Math.round,
		sign: function (x) {
			return x > 0 ? 1 : x < 0 ? -1 : 0;
		},
	};
	var MATH_FUNCS2 = {
		min: Math.min,
		max: Math.max,
		mod: function (a, b) {
			return b ? a - Math.floor(a / b) * b : NaN;
		},
		atan2: Math.atan2,
		pow: Math.pow,
		logbase: function (x, b) {
			return Math.log(x) / Math.log(b);
		},
	};

	// Reads the text and gives back a function of x, or throws with something a person
	// can act on.
	function compileMath(text) {
		var src = String(text == null ? "" : text);
		// "y =" on the front is how people write it, and is just noise here.
		src = src.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=/i, "");
		// The sorts of characters a keyboard offers in place of the plain ones.
		src = src
			.replace(/[−–—]/g, "-")
			.replace(/[×⋅∙]/g, "*")
			.replace(/[÷]/g, "/")
			.replace(/√/g, "sqrt ")
			// Runs of space become one. They can't all be taken out, or "sin x" would
			// read as the name of something called sinx.
			.replace(/\s+/g, " ")
			.trim();
		if (!src) throw new Error("There's no sum there");
		var at = 0;
		// How many |...| the reader is inside, so a closing bar isn't taken for the
		// start of another one.
		var bars = 0;

		// A space is never part of anything, so looking at what comes next steps over it.
		function peek() {
			while (src.charAt(at) === " ") at++;
			return src.charAt(at);
		}
		// The character right here, space or not. A name and a number are read with this
		// rather than the above, or "sin x" would read as sinx and "1 2" as twelve.
		function cur() {
			return src.charAt(at);
		}
		function isDigit(c) {
			return c >= "0" && c <= "9";
		}
		// Letters, and the few Greek ones that stand for numbers.
		function isLetter(c) {
			return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "π" || c === "τ";
		}

		function readName() {
			var start = at;
			while (at < src.length && (isLetter(cur()) || isDigit(cur()))) at++;
			return src.slice(start, at);
		}

		// A number, a name, a bracket, or |something| for how big it is.
		function primary() {
			var c = peek();
			if (c === "(") {
				at++;
				var inner = expr();
				if (peek() !== ")") throw new Error("A bracket was left open");
				at++;
				return inner;
			}
			if (c === "|") {
				at++;
				bars++;
				var v = expr();
				if (peek() !== "|") throw new Error("A | was left open");
				at++;
				bars--;
				return function (x) {
					return Math.abs(v(x));
				};
			}
			if (isDigit(c) || (c === "." && isDigit(src.charAt(at + 1)))) {
				var start = at;
				while (isDigit(cur())) at++;
				if (cur() === ".") {
					at++;
					while (isDigit(cur())) at++;
				}
				if (cur() === "e" || cur() === "E") {
					var save = at;
					at++;
					if (cur() === "+" || cur() === "-") at++;
					if (isDigit(cur())) {
						while (isDigit(cur())) at++;
					} else {
						// "2e" is two times e, not a number with no exponent.
						at = save;
					}
				}
				var n = parseFloat(src.slice(start, at));
				if (!isFinite(n)) throw new Error("That number can't be read");
				return function () {
					return n;
				};
			}
			if (isLetter(c)) {
				var name = readName();
				var lower = name.toLowerCase();
				if (lower === "x") {
					return function (x) {
						return x;
					};
				}
				var one = MATH_FUNCS[lower];
				var two = MATH_FUNCS2[lower];
				if (one || two) {
					if (peek() !== "(") {
						// sin x, as it's written on paper.
						var bare = unary();
						if (!one) throw new Error(name + " needs two numbers, as in " + lower + "(a, b)");
						return function (x) {
							return one(bare(x));
						};
					}
					at++;
					var args = [expr()];
					while (peek() === ",") {
						at++;
						args.push(expr());
					}
					if (peek() !== ")") throw new Error("A bracket was left open after " + name);
					at++;
					if (two && args.length === 2) {
						return function (x) {
							return two(args[0](x), args[1](x));
						};
					}
					if (lower === "log" && args.length === 2) {
						return function (x) {
							return MATH_FUNCS2.logbase(args[0](x), args[1](x));
						};
					}
					if (!one || args.length !== 1) throw new Error(name + " was given " + args.length + " numbers");
					return function (x) {
						return one(args[0](x));
					};
				}
				if (Object.prototype.hasOwnProperty.call(MATH_VALUES, lower)) {
					var k = MATH_VALUES[lower];
					return function () {
						return k;
					};
				}
				throw new Error("I don't know what " + name + " is");
			}
			if (!c) throw new Error("The sum stops short");
			throw new Error("I can't read " + c + " in there");
		}

		// A minus sign in front, then powers. x^-2 works; -x^2 is -(x^2), as written.
		function unary() {
			if (peek() === "-") {
				at++;
				var inner = unary();
				return function (x) {
					return -inner(x);
				};
			}
			if (peek() === "+") {
				at++;
				return unary();
			}
			return power();
		}

		function power() {
			var base = primary();
			if (peek() === "^" || (peek() === "*" && src.charAt(at + 1) === "*")) {
				at += peek() === "^" ? 1 : 2;
				// Right to left: 2^3^2 is 2^(3^2).
				var exp = unary();
				return function (x) {
					return Math.pow(base(x), exp(x));
				};
			}
			return base;
		}

		// Is something that follows the start of another thing to multiply by? That's how
		// 2x, 3(x+1) and 2sin(x) are read.
		function startsValue() {
			var c = peek();
			// A bar only starts something when there isn't one open already: in |x| the
			// second bar closes the first rather than opening another.
			if (c === "|") return bars === 0;
			return isDigit(c) || isLetter(c) || c === "(" || c === ".";
		}

		function term() {
			var left = unary();
			for (;;) {
				var c = peek();
				if (c === "*" && src.charAt(at + 1) !== "*") {
					at++;
					left = times(left, unary());
				} else if (c === "/") {
					at++;
					left = over(left, unary());
				} else if (c === "%") {
					at++;
					left = (function (a, b) {
						return function (x) {
							return a(x) % b(x);
						};
					})(left, unary());
				} else if (startsValue()) {
					left = times(left, unary());
				} else {
					return left;
				}
			}
		}
		function times(a, b) {
			return function (x) {
				return a(x) * b(x);
			};
		}
		function over(a, b) {
			return function (x) {
				return a(x) / b(x);
			};
		}

		function expr() {
			var left = term();
			for (;;) {
				var c = peek();
				if (c === "+") {
					at++;
					left = (function (a, b) {
						return function (x) {
							return a(x) + b(x);
						};
					})(left, term());
				} else if (c === "-") {
					at++;
					left = (function (a, b) {
						return function (x) {
							return a(x) - b(x);
						};
					})(left, term());
				} else {
					return left;
				}
			}
		}

		var fn = expr();
		if (at < src.length) throw new Error("I can't read " + src.slice(at) + " on the end");
		// Try it out: a sum that throws rather than giving a number is no use.
		var test = fn(1);
		if (typeof test !== "number") throw new Error("That doesn't work out to a number");
		return fn;
	}

	// ---------- Axes and graphs ----------
	//
	// A set of axes is one thing on the page, like a pasted picture: a middle, a size and
	// a turn, so the lasso moves, resizes and turns it. It holds the window of numbers it
	// shows and the sums drawn on it, and it draws itself from those every time, so a
	// curve is smooth however far you zoom in and a notes code carries the whole graph in
	// a few dozen characters.

	// A step that lands on 1, 2 or 5 times a power of ten, so the numbers along the axis
	// read nicely.
	function niceStep(span, want) {
		if (!(span > 0)) return 1;
		var rough = span / Math.max(1, want);
		var pow = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
		var n = rough / pow;
		return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow;
	}

	// The number to write by a tick, with no trailing noise from the arithmetic.
	function tickLabel(v, step) {
		var places = clamp(Math.ceil(-Math.log(step) / Math.LN10 + 0.2), 0, 6);
		var s = v.toFixed(places);
		if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
		if (s === "-0") s = "0";
		return s;
	}

	// Everything needed to draw one: where the window sits inside the frame.
	function graphFrame(a) {
		var xs = a.w / (a.x1 - a.x0);
		var ys = a.h / (a.y1 - a.y0);
		return {
			xs: xs,
			ys: ys,
			left: -a.w / 2,
			top: -a.h / 2,
			px: function (x) {
				return -a.w / 2 + (x - a.x0) * xs;
			},
			py: function (y) {
				return a.h / 2 - (y - a.y0) * ys;
			},
		};
	}

	function drawGraph(ctx, a, zoom) {
		var f = graphFrame(a);
		var colors = ctx.__colors || palette;
		var axisColor = colors[a.color] || colors.ink;
		var font = clamp(Math.min(a.w, a.h) / 26, 5, 24);
		// Ticks about this far apart on screen, so a graph you've zoomed into or shrunk
		// doesn't end up with numbers on top of each other.
		var stepX = niceStep(a.x1 - a.x0, clamp((a.w * zoom) / 72, 2, 14));
		var stepY = niceStep(a.y1 - a.y0, clamp((a.h * zoom) / 56, 2, 14));
		// How far a tick reaches each side of the axis. Measured against the thickness of
		// the line rather than the size of the frame, so they stay small nicks on the
		// axis - as on a ruler - instead of growing into crosshairs on a big graph.
		var tick = clamp(a.size * 0.8, 0.6, 2.5);

		ctx.save();
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = 1;
		ctx.translate(a.cx, a.cy);
		ctx.rotate(a.rot);
		// Nothing drawn here escapes the frame, so a steep curve stops at the edge.
		ctx.beginPath();
		ctx.rect(-a.w / 2, -a.h / 2, a.w, a.h);
		ctx.save();
		ctx.clip();

		var i;
		var v;
		// The squares behind, if they're wanted.
		if (a.grid) {
			ctx.strokeStyle = axisColor;
			ctx.globalAlpha = 0.16;
			ctx.lineWidth = a.size * 0.5;
			ctx.beginPath();
			for (i = Math.ceil(a.x0 / stepX); i * stepX <= a.x1; i++) {
				v = f.px(i * stepX);
				ctx.moveTo(v, -a.h / 2);
				ctx.lineTo(v, a.h / 2);
			}
			for (i = Math.ceil(a.y0 / stepY); i * stepY <= a.y1; i++) {
				v = f.py(i * stepY);
				ctx.moveTo(-a.w / 2, v);
				ctx.lineTo(a.w / 2, v);
			}
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		// The two axes, kept inside the frame when the origin is off the edge.
		var zeroX = clamp(f.px(0), -a.w / 2, a.w / 2);
		var zeroY = clamp(f.py(0), -a.h / 2, a.h / 2);
		ctx.strokeStyle = axisColor;
		ctx.fillStyle = axisColor;
		ctx.lineWidth = a.size;
		ctx.beginPath();
		ctx.moveTo(-a.w / 2, zeroY);
		ctx.lineTo(a.w / 2, zeroY);
		ctx.moveTo(zeroX, -a.h / 2);
		ctx.lineTo(zeroX, a.h / 2);
		ctx.stroke();

		// Ticks, and a number under or beside each.
		ctx.lineWidth = a.size * 0.8;
		ctx.beginPath();
		for (i = Math.ceil(a.x0 / stepX); i * stepX <= a.x1; i++) {
			if (i === 0) continue;
			v = f.px(i * stepX);
			ctx.moveTo(v, zeroY - tick);
			ctx.lineTo(v, zeroY + tick);
		}
		for (i = Math.ceil(a.y0 / stepY); i * stepY <= a.y1; i++) {
			if (i === 0) continue;
			v = f.py(i * stepY);
			ctx.moveTo(zeroX - tick, v);
			ctx.lineTo(zeroX + tick, v);
		}
		ctx.stroke();

		// The numbers, when they're wanted. Bare axes with ticks on them are what most
		// working out needs; numbers are for a graph meant to be read off.
		if (a.labels && font * zoom > 5) {
			ctx.font = font + "px ui-sans-serif, -apple-system, Helvetica, Arial, sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			for (i = Math.ceil(a.x0 / stepX); i * stepX <= a.x1; i++) {
				if (i === 0) continue;
				v = f.px(i * stepX);
				// Numbers go under the axis, or above it when it's at the bottom.
				var below = zeroY + tick + font * 0.25;
				if (below + font > a.h / 2) below = zeroY - tick - font * 1.25;
				ctx.fillText(tickLabel(i * stepX, stepX), v, below);
			}
			ctx.textAlign = "right";
			ctx.textBaseline = "middle";
			for (i = Math.ceil(a.y0 / stepY); i * stepY <= a.y1; i++) {
				if (i === 0) continue;
				v = f.py(i * stepY);
				var leftOf = zeroX - tick - font * 0.3;
				ctx.textAlign = leftOf - font * 2 < -a.w / 2 ? "left" : "right";
				if (ctx.textAlign === "left") leftOf = zeroX + tick + font * 0.3;
				ctx.fillText(tickLabel(i * stepY, stepY), leftOf, v);
			}
			// The origin, named once.
			if (f.px(0) > -a.w / 2 + font && f.py(0) < a.h / 2 - font) {
				ctx.textAlign = "right";
				ctx.textBaseline = "top";
				ctx.fillText("0", zeroX - tick - font * 0.3, zeroY + tick + font * 0.25);
			}
		}

		// The curves.
		(a.funcs || []).forEach(function (fun) {
			var fn = graphFn(fun);
			if (!fn) return;
			ctx.strokeStyle = colors[fun.color] || axisColor;
			ctx.lineWidth = a.size * 1.3;
			// One step for every pixel across the frame, so it stays smooth at any zoom.
			var steps = Math.round(clamp(a.w * zoom, 48, 4000));
			var span = a.x1 - a.x0;
			var limit = a.h * 4;
			var drawing = false;
			var lastY = 0;
			ctx.beginPath();
			for (i = 0; i <= steps; i++) {
				var x = a.x0 + (span * i) / steps;
				var y = fn(x);
				if (typeof y !== "number" || !isFinite(y)) {
					drawing = false;
					continue;
				}
				var sy = f.py(y);
				// Keep the numbers sane, and break the line where it shoots off to
				// nothing and comes back the other side, as tan(x) does.
				if (sy > limit || sy < -limit) {
					if (drawing) {
						ctx.lineTo(f.px(x), clamp(sy, -limit, limit));
						drawing = false;
					}
					lastY = sy;
					continue;
				}
				if (drawing && Math.abs(sy - lastY) > a.h * 1.5) drawing = false;
				if (drawing) ctx.lineTo(f.px(x), sy);
				else {
					ctx.moveTo(f.px(x), sy);
					drawing = true;
				}
				lastY = sy;
			}
			ctx.stroke();
		});

		ctx.restore();
		ctx.restore();
	}

	// The compiled sum, kept on the graph so it isn't read again for every frame. A sum
	// that won't read is left out rather than stopping the rest of the graph.
	function graphFn(fun) {
		if (fun.fn === undefined) {
			try {
				fun.fn = compileMath(fun.expr);
			} catch (e) {
				fun.fn = null;
			}
		}
		return fun.fn;
	}

	// What the next graph will show, until it's changed in the dialog.
	var graphPlan = {
		x0: -10,
		x1: 10,
		y0: -10,
		y1: 10,
		// Until a y range is typed in, it's worked out from the shape of the frame so a
		// step up is as long as a step across and a circle comes out round.
		ySet: false,
		// Bare axes by default: the squares behind and the numbers are both there to be
		// turned on when a graph is meant to be read off rather than worked on.
		grid: false,
		labels: false,
		funcs: [],
	};
	// Curves are coloured in this order, so a second function doesn't land on top of the
	// first in the same colour.
	var GRAPH_COLORS = ["blue", "red", "green", "purple", "orange", "ink"];

	// Puts a set of axes on the page. ends: the corners dragged out, or null to drop one
	// of a comfortable size in the middle of the view.
	function addGraph(ends) {
		var w;
		var h;
		var cx;
		var cy;
		if (ends) {
			w = Math.abs(ends.to.x - ends.from.x);
			h = Math.abs(ends.to.y - ends.from.y);
			cx = (ends.from.x + ends.to.x) / 2;
			cy = (ends.from.y + ends.to.y) / 2;
		} else {
			// Two thirds of the screen, the short way, and square.
			var side = (Math.min(width, height) * 0.66) / view.s;
			w = h = side;
			cx = (width / 2 - view.x) / view.s;
			cy = (height / 2 - view.y) / view.s;
		}
		// Too small to read anything on, so give it a usable size instead.
		if (w * view.s < 60 || h * view.s < 60) {
			w = Math.max(w, 160 / view.s);
			h = Math.max(h, 160 / view.s);
		}
		var y0 = graphPlan.y0;
		var y1 = graphPlan.y1;
		if (!graphPlan.ySet) {
			// Same scale both ways.
			var half = (((graphPlan.x1 - graphPlan.x0) / 2) * h) / w;
			var mid = (graphPlan.y0 + graphPlan.y1) / 2;
			y0 = mid - half;
			y1 = mid + half;
		}
		var a = {
			tool: "graph",
			cx: cx,
			cy: cy,
			w: w,
			h: h,
			rot: 0,
			x0: graphPlan.x0,
			x1: graphPlan.x1,
			y0: y0,
			y1: y1,
			grid: graphPlan.grid,
			labels: graphPlan.labels,
			color: shapeColor(),
			size: SIZES.graph[sizeChoice.graph] / view.s,
			funcs: graphPlan.funcs.map(function (f) {
				return { expr: f.expr, color: f.color };
			}),
		};
		a.box = frameBox(a);
		// The lasso comes out holding it, so it can be placed straight away.
		selectTool(LASSO);
		addActions([a]);
		makeSelection([a]);
		return a;
	}

	// ---------- The graph dialog ----------

	var graphDialog = document.getElementById("graph-dialog");
	var graphText = document.getElementById("graph-text");
	var graphError = document.getElementById("graph-error");
	var graphGridBox = document.getElementById("graph-grid");
	var graphLabelBox = document.getElementById("graph-labels");
	var graphFields = {
		x0: document.getElementById("graph-x0"),
		x1: document.getElementById("graph-x1"),
		y0: document.getElementById("graph-y0"),
		y1: document.getElementById("graph-y1"),
	};
	// The graph being changed, or null when the next one is being set up.
	var graphEditing = null;

	function showGraphDialog(target) {
		graphEditing = target || null;
		var from = target || graphPlan;
		graphText.value = (target ? target.funcs : graphPlan.funcs)
			.map(function (f) {
				return f.expr;
			})
			.join("\n");
		graphFields.x0.value = String(round4(from.x0));
		graphFields.x1.value = String(round4(from.x1));
		graphFields.y0.value = String(round4(from.y0));
		graphFields.y1.value = String(round4(from.y1));
		graphGridBox.checked = !!from.grid;
		graphLabelBox.checked = !!from.labels;
		graphError.textContent = "";
		document.getElementById("graph-title").textContent = target ? "This graph" : "Axes and graphs";
		document.getElementById("graph-apply").textContent = target ? "Apply" : "Draw it";
		if (graphDialog.showModal) graphDialog.showModal();
		else graphDialog.setAttribute("open", "");
		graphText.focus();
	}

	function closeGraphDialog() {
		if (graphDialog.close) graphDialog.close();
		else graphDialog.removeAttribute("open");
		graphEditing = null;
	}

	// Enough places for anything anyone types, without the arithmetic's own noise.
	function round4(v) {
		return Math.round(v * 10000) / 10000;
	}

	// Reads the dialog. Throws with something a person can act on.
	function readGraphDialog() {
		var want = {};
		["x0", "x1", "y0", "y1"].forEach(function (k) {
			var v = parseFloat(graphFields[k].value);
			if (!isFinite(v)) throw new Error("The " + k.charAt(0) + " range needs two numbers");
			want[k] = v;
		});
		if (want.x1 - want.x0 <= 0) throw new Error("x has to run from a smaller number to a bigger one");
		if (want.y1 - want.y0 <= 0) throw new Error("y has to run from a smaller number to a bigger one");
		var lines = graphText.value.split("\n");
		var funcs = [];
		var used = 0;
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if (!line) continue;
			if (line.length > 200) throw new Error("That sum is too long");
			// Read it now so a mistake is caught while the dialog is still open.
			compileMath(line);
			funcs.push({ expr: line, color: GRAPH_COLORS[used % GRAPH_COLORS.length] });
			used++;
		}
		want.grid = !!graphGridBox.checked;
		want.labels = !!graphLabelBox.checked;
		want.funcs = funcs;
		return want;
	}

	document.getElementById("graph-cancel").addEventListener("click", closeGraphDialog);
	document.getElementById("graph-apply").addEventListener("click", function () {
		var want;
		try {
			want = readGraphDialog();
		} catch (e) {
			graphError.textContent = e.message;
			return;
		}
		var target = graphEditing;
		graphPlan.x0 = want.x0;
		graphPlan.x1 = want.x1;
		graphPlan.y0 = want.y0;
		graphPlan.y1 = want.y1;
		graphPlan.grid = want.grid;
		graphPlan.labels = want.labels;
		graphPlan.funcs = want.funcs;
		// A y range typed in is used as typed; left alone, it follows the frame's shape.
		if (!target) graphPlan.ySet = true;
		closeGraphDialog();
		if (!target) {
			addGraph(null);
			return;
		}
		// Changing one that's already on the page is a step like any other.
		var before = {
			x0: target.x0,
			x1: target.x1,
			y0: target.y0,
			y1: target.y1,
			grid: target.grid,
			labels: target.labels,
			funcs: target.funcs,
		};
		var after = {
			x0: want.x0,
			x1: want.x1,
			y0: want.y0,
			y1: want.y1,
			grid: want.grid,
			labels: want.labels,
			funcs: want.funcs,
		};
		function settle() {
			rerenderBox(target.box);
			// While it's still held by the lasso, what floats above the page is a picture
			// taken of it, so that has to be taken again or the change wouldn't show
			// until it was put down.
			if (sel && sel.list.indexOf(target) >= 0) {
				measureSelection();
				bakeSelectionCanvas();
				layoutSelection();
			}
			requestRender(true);
		}
		pushOp({
			redo: function () {
				restore(target, after);
				settle();
			},
			undo: function () {
				restore(target, before);
				settle();
			},
		});
	});

	// ---------- Copy as image ----------
	//
	// The strokes are vector shapes, so the picture is drawn fresh from them at a high
	// resolution rather than copied off the screen: it's sharp, cropped to the writing,
	// and can use either theme's colours. It goes on the clipboard as a PNG because
	// that's what other iPad apps accept when you paste.

	var copyMenu = document.getElementById("copy-menu");
	var toastEl = document.getElementById("toast");
	var toastTimer = 0;

	function toast(text) {
		toastEl.textContent = text;
		toastEl.classList.add("show");
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () {
			toastEl.classList.remove("show");
		}, 1800);
	}

	// Everything still on the page: drawn since the last "clear", and not deleted.
	function pageActions() {
		var list = [];
		for (var i = findStart(); i < actions.length; i++) {
			var a = actions[i];
			if (a.type === "clear" || a.deleted) continue;
			list.push(a);
		}
		return list;
	}

	// Draws the page onto a new canvas in the given theme, or returns null if there's no ink.
	function renderImage(themeName) {
		var colors = THEMES[themeName];
		var list = pageActions();
		// Crop to the pen and highlighter strokes; the eraser can only remove ink, never add it.
		var box = null;
		list.forEach(function (a) {
			if (a.tool === "eraser") return;
			var b = a.box;
			if (!box) box = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
			else {
				box.x0 = Math.min(box.x0, b.x0);
				box.y0 = Math.min(box.y0, b.y0);
				box.x1 = Math.max(box.x1, b.x1);
				box.y1 = Math.max(box.y1, b.y1);
			}
		});
		if (!box) return null;

		var pad = 24;
		var w = box.x1 - box.x0 + pad * 2;
		var h = box.y1 - box.y0 + pad * 2;
		// 4 pixels per page unit, kept under Safari's canvas size limits.
		var scale = Math.min(4, 8192 / Math.max(w, h), Math.sqrt(16e6 / (w * h)));
		var pw = Math.max(1, Math.round(w * scale));
		var ph = Math.max(1, Math.round(h * scale));

		// Ink goes on its own transparent layer so the eraser can't cut through the background.
		var layer = document.createElement("canvas");
		layer.width = pw;
		layer.height = ph;
		var ctx = layer.getContext("2d");
		ctx.setTransform(scale, 0, 0, scale, (pad - box.x0) * scale, (pad - box.y0) * scale);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		list.forEach(function (a) {
			if (a.tool === "image") {
				drawImageAction(ctx, a);
				return;
			}
			if (a.tool === "graph") {
				// The theme's own colours, so a graph copied as light really is light.
				ctx.__colors = colors;
				drawGraph(ctx, a, scale);
				ctx.__colors = null;
				return;
			}
			if (a.tool === "eraser") {
				eraseShape(ctx, a, a.shape || (a.shape = eraserShape(a)));
				return;
			}
			if (a.tool === "highlighter") {
				drawHighlight(ctx, a, highlighterShape(a, scale), colors, themeName);
				return;
			}
			var shape = penShape(a, null, true, scale);
			ctx.globalCompositeOperation = "source-over";
			ctx.fillStyle = colors[a.color];
			ctx.fill(shape.body);
			ctx.fill(shape.round);
		});

		var out = document.createElement("canvas");
		out.width = pw;
		out.height = ph;
		var octx = out.getContext("2d");
		octx.fillStyle = colors.paper;
		octx.fillRect(0, 0, pw, ph);
		octx.drawImage(layer, 0, 0);
		layer.width = layer.height = 0;
		// A big picture can grow the spare canvas a lot; let it go back to tile size.
		spare.width = spare.height = 0;
		return out;
	}

	// If the clipboard says no, save the picture as a file instead.
	function saveImage(blob, themeName) {
		blob.then(function (b) {
			var url = URL.createObjectURL(b);
			var link = document.createElement("a");
			link.href = url;
			link.download = "wbts-" + themeName + ".png";
			document.body.appendChild(link);
			link.click();
			link.remove();
			setTimeout(function () {
				URL.revokeObjectURL(url);
			}, 10000);
			toast("Couldn't copy, so it was saved as an image");
		});
	}

	function copyImage(themeName) {
		if (current) return;
		var canvas = renderImage(themeName);
		if (!canvas) {
			toast("Nothing to copy");
			return;
		}
		var blob = new Promise(function (resolve, reject) {
			canvas.toBlob(function (b) {
				if (b) resolve(b);
				else reject(new Error("Couldn't make the image"));
			}, "image/png");
		});
		// Safari only allows a clipboard write straight from a tap, so it's started now
		// and given the image as a promise to fill in when ready.
		if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
			navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
				function () {
					toast(themeName === "dark" ? "Copied on dark" : "Copied on light");
				},
				function () {
					saveImage(blob, themeName);
				}
			);
		} else {
			saveImage(blob, themeName);
		}
	}

	copyBtn.addEventListener("click", function () {
		if (!copyMenu.hidden) {
			copyMenu.hidden = true;
			return;
		}
		closePenMenu();
		notesMenu.hidden = true;
		placeMenu(copyMenu, copyBtn);
	});

	copyMenu.querySelectorAll("button").forEach(function (b) {
		b.addEventListener("click", function () {
			copyMenu.hidden = true;
			copyImage(b.dataset.copy);
		});
	});

	undoBtn.addEventListener("click", undo);
	redoBtn.addEventListener("click", redo);
	clearBtn.addEventListener("click", clearPage);
	zoomBtn.addEventListener("click", resetZoom);

	// Escape lets a selection go; Delete gets rid of what's selected.
	document.addEventListener("keydown", function (e) {
		if (e.metaKey || e.ctrlKey || e.altKey || codeDialog.open) return;
		if (e.key === "Escape" && sel) clearSelection();
		else if ((e.key === "Backspace" || e.key === "Delete") && sel) deleteSelection();
		else return;
		e.preventDefault();
	});

	// Hardware keyboard shortcuts.
	document.addEventListener("keydown", function (e) {
		if (!(e.metaKey || e.ctrlKey)) return;
		// Inside the code box, copy, paste and undo work on the text as usual.
		if (codeDialog.open) return;
		var k = e.key.toLowerCase();
		if (k === "z" && e.shiftKey) redo();
		else if (k === "z") undo();
		else if (k === "y") redo();
		else if (k === "c") copyImage(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
		else if (k === "0") resetZoom();
		else if (k === "=" || k === "+") zoomAt(width / 2, height / 2, 1.25);
		else if (k === "-") zoomAt(width / 2, height / 2, 0.8);
		else return;
		e.preventDefault();
	});

	// ---------- Notes codes ----------
	//
	// A notes code is the page itself, written out as text: every line's points, pen,
	// colour and size, packed into bytes, compressed, and turned into letters and digits.
	// Paste it back (or open it as a link) and the same notes come back, sharp at any zoom.
	// Nothing is stored anywhere else, so the code is the only copy.

	var notesMenu = document.getElementById("notes-menu");
	var notesBtn = document.getElementById("notes");
	var codeDialog = document.getElementById("code-dialog");
	var codeText = document.getElementById("code-text");
	var CODE_PREFIX = "wb1";
	// The tool a stroke was drawn with, two bits of the code. The fourth slot is a set of
	// axes, which isn't a stroke at all and is written out its own way below.
	var TOOLS = ["pen", "highlighter", "eraser", "graph"];
	var PEN_TYPES = ["fountain", "ball", "brush"];
	var COLOR_KEYS = Object.keys(THEMES.light).filter(function (k) {
		return k !== "paper";
	});

	// Small numbers take one byte, bigger ones more. Negative numbers are folded in
	// (0, -1, 1, -2, ...) so small steps either way stay small.
	function writeNum(out, n) {
		n = n < 0 ? -2 * n - 1 : 2 * n;
		while (n >= 128) {
			out.push((n % 128) + 128);
			n = Math.floor(n / 128);
		}
		out.push(n);
	}

	function Reader(bytes) {
		this.b = bytes;
		this.i = 0;
	}
	Reader.prototype.byte = function () {
		if (this.i >= this.b.length) throw new Error("The code is cut short");
		return this.b[this.i++];
	};
	Reader.prototype.num = function () {
		var n = 0;
		var mul = 1;
		var c;
		do {
			c = this.byte();
			n += (c % 128) * mul;
			mul *= 128;
		} while (c >= 128);
		return n % 2 ? -(n + 1) / 2 : n / 2;
	};

	// ---------- Making the code short ----------
	//
	// The code gets pasted into messages and links, so its length is the whole point.
	// Three things are done about it, and between them they cut it to about a quarter:
	//
	//  - Only what's still showing is written down. Anything rubbed out is left out,
	//    and so is an eraser with nothing left to cut.
	//  - The line is thinned to the fewest points that still trace it, and those are
	//    rounded onto a grid. Both are measured against the line's own width: a hair's
	//    breadth on a 30-wide highlighter can't be seen, on a fine pen it can.
	//  - How hard and how fast the hand was going is kept to a few bits, and only at
	//    every few points. It changes slowly and all it does is set the width.
	//
	// All three throw away a little of what was written. The amounts below are set so
	// that what you see doesn't change: the line ends up about a quarter of a page unit
	// from where it was on average, which is finer than the Pencil itself reports and
	// finer than the wobble the clean-up already takes out.

	// How far the rebuilt line may stray from what was written, in screen pixels at the
	// zoom it was written at. Two thirds of the line's width: a fine pen keeps its
	// shape, a 30-wide highlighter can wander a long way without anyone being able to
	// tell. Turning this up is the one knob that trades how the writing looks for how
	// short the code is; past here it costs much more than it saves.
	function codeTol(size) {
		return clamp(size / 1.5, 1, 4);
	}

	// Positions are rounded onto a grid of this many steps to the page unit. A step is
	// half the line's width, never finer than half a screen pixel (there's nothing there
	// to keep) nor coarser than three.
	function codeGrid(size, scale) {
		var step = clamp(size / 2, 0.5, 3);
		return clamp((scale || 1) / step, 0.25, 64);
	}

	// How far apart the rebuilt points are laid down, in screen pixels. Just wider than
	// the gap the clean-up drops samples at, so they all survive it.
	function codeStep(scale) {
		return 2 / (scale || 1);
	}

	// ---------- The line, as few points as will trace it ----------
	//
	// A line of dots has to be dense to look smooth; a curve through them doesn't. So
	// the code keeps only the points a curve needs, and runs the curve through them
	// again when the code is opened. Handwriting comes out at about a third of the
	// points, and the curve is a closer match to a moving hand than the straight lines
	// it replaces.

	// A smooth curve through every one of these points, laid down in pieces about `step`
	// apart. Catmull-Rom, which passes through the points it's given rather than near
	// them, so a point kept is a point landed on. How hard and fast the hand was going
	// is carried along from point to point the same way.
	function throughPoints(pts, step) {
		var n = pts.length;
		if (n < 2) return pts.slice();
		var out = [{ x: pts[0].x, y: pts[0].y, p: pts[0].p, v: pts[0].v }];
		for (var i = 0; i < n - 1; i++) {
			var p0 = pts[i - 1] || pts[i];
			var p1 = pts[i];
			var p2 = pts[i + 1];
			var p3 = pts[i + 2] || p2;
			var steps = clamp(Math.round(len2(p2.x - p1.x, p2.y - p1.y) / step), 1, 64);
			for (var k = 1; k <= steps; k++) {
				var t = k / steps;
				var t2 = t * t;
				var t3 = t2 * t;
				out.push({
					x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
					y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
					p: p1.p + (p2.p - p1.p) * t,
					v: p1.v + (p2.v - p1.v) * t,
				});
			}
		}
		return out;
	}

	// How far a point is from a line of points, starting the search at `from` and only
	// looking a little way along. Both run the same way along the stroke, so the search
	// can creep forward with it instead of starting over. Looking at only some of the
	// line can overstate the distance, never understate it, so the worst that comes of
	// it is a point kept that needn't have been.
	function nearestOn(path, p, from) {
		var best = Infinity;
		var at = from;
		var stop = Math.min(path.length - 1, from + 160);
		for (var i = Math.max(1, from); i <= stop; i++) {
			var d = distToSeg(p.x, p.y, path[i - 1], path[i]);
			if (d < best) {
				best = d;
				at = i;
			}
		}
		if (path.length === 1) best = len2(p.x - path[0].x, p.y - path[0].y);
		return { d: best, at: Math.max(0, at - 40) };
	}

	// The points rounded onto the grid, which is how they'll be stored, so the straying
	// measured below is the straying that will really happen.
	function snapped(pts, keep, grid) {
		var out = [];
		for (var i = 0; i < keep.length; i++) {
			var p = pts[keep[i]];
			out.push({ x: Math.round(p.x * grid) / grid, y: Math.round(p.y * grid) / grid, p: p.p, v: p.v });
		}
		return out;
	}

	// Which of a stroke's samples to keep: start with its two ends, then keep adding
	// wherever the rebuilt curve strays furthest, until none of it strays too far.
	function curveIndices(pts, grid, tol, step) {
		var n = pts.length;
		var i;
		if (n <= 2) {
			var all = [];
			for (i = 0; i < n; i++) all.push(i);
			return all;
		}
		// Start from what straight lines would need, which is close and quick to find,
		// then let the curve take points back out and put any strays back in.
		var keep = straightIndices(pts, tol);
		for (var round = 0; round < 40; round++) {
			var curve = throughPoints(snapped(pts, keep, grid), step);
			// The worst stray in each gap between two kept points, so a whole round's
			// worth of points can be added at once instead of one at a time.
			var worstAt = [];
			var worstD = [];
			for (i = 0; i + 1 < keep.length; i++) {
				worstAt.push(-1);
				worstD.push(tol);
			}
			var at = 0;
			var gap = 0;
			for (i = 1; i < n - 1; i++) {
				while (gap + 2 < keep.length && i >= keep[gap + 1]) gap++;
				var m = nearestOn(curve, pts[i], at);
				at = m.at;
				if (m.d > worstD[gap]) {
					worstD[gap] = m.d;
					worstAt[gap] = i;
				}
			}
			var added = false;
			for (i = 0; i < worstAt.length; i++) {
				if (worstAt[i] >= 0) {
					keep.push(worstAt[i]);
					added = true;
				}
			}
			if (!added) break;
			keep.sort(function (a, b) {
				return a - b;
			});
		}
		return dropSpare(pts, keep, grid, tol, step);
	}

	// Adding a whole round's worth at once overshoots: a point that strayed before its
	// neighbours arrived often isn't needed once they have. So each is tried without,
	// and dropped if the curve holds up without it. Only the stretch around it is
	// rebuilt, and only the samples between its two neighbours can have moved, so this
	// costs little and takes about a quarter of the points back out.
	function dropSpare(pts, keep, grid, tol, step) {
		var g = 1;
		while (g < keep.length - 1) {
			// Two neighbours each way: that's as far as the curve's shape reaches.
			var lo = Math.max(0, g - 2);
			var hi = Math.min(keep.length - 1, g + 2);
			var trial = keep.slice(lo, g).concat(keep.slice(g + 1, hi + 1));
			var curve = throughPoints(snapped(pts, trial, grid), step);
			var worst = 0;
			for (var i = keep[g - 1] + 1; i < keep[g + 1]; i++) {
				var d = nearestOn(curve, pts[i], 0).d;
				if (d > worst) worst = d;
				if (worst > tol) break;
			}
			if (worst <= tol) keep.splice(g, 1);
			else g++;
		}
		return keep;
	}

	// Which points to keep if the line between them were straight. Working up to the
	// answer one point at a time is slow on a full page, so this is used as the opening
	// guess: it's quick, and it keeps more than the curve needs rather than fewer, which
	// is the safe way round to be wrong.
	function straightIndices(pts, tol) {
		var n = pts.length;
		var keep = new Array(n);
		var i;
		if (n <= 2) {
			for (i = 0; i < n; i++) keep[i] = true;
			return indicesOf(keep);
		}
		keep[0] = keep[n - 1] = true;
		var stack = [[0, n - 1]];
		while (stack.length) {
			var seg = stack.pop();
			var a = pts[seg[0]];
			var b = pts[seg[1]];
			var dx = b.x - a.x;
			var dy = b.y - a.y;
			var len = Math.hypot(dx, dy);
			var far = -1;
			var farDist = tol;
			for (var i = seg[0] + 1; i < seg[1]; i++) {
				var p = pts[i];
				var dist = len ? Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len : Math.hypot(p.x - a.x, p.y - a.y);
				if (dist > farDist) {
					farDist = dist;
					far = i;
				}
			}
			if (far >= 0) {
				keep[far] = true;
				stack.push([seg[0], far], [far, seg[1]]);
			}
		}
		return indicesOf(keep);
	}

	function indicesOf(flags) {
		var out = [];
		for (var i = 0; i < flags.length; i++) {
			if (flags[i]) out.push(i);
		}
		return out;
	}

	// Pictures aren't written into the code: they'd make it enormous. Strokes only.
	function pageHasImage() {
		return pageActions().some(function (a) {
			return a.tool === "image";
		});
	}

	// Only a pen whose width answers to the hand needs that written down. A ball pen is
	// one even width, and the highlighter and eraser are even swipes.
	function hasFeel(a) {
		if (a.tool !== "pen") return false;
		var pen = PENS[a.pen] || PENS.fountain;
		return pen.press > 0 || pen.slow > 0;
	}

	// The points that carry how hard and fast the hand was going: every few, and always
	// the last one. The rest are read off the line between them when the code is opened.
	var FEEL_STEP = 4;
	function feelAt(n) {
		var ix = [];
		for (var i = 0; i < n; i += FEEL_STEP) ix.push(i);
		if (n && ix[ix.length - 1] !== n - 1) ix.push(n - 1);
		return ix;
	}

	// The zoom a stroke was written at, to a quarter of a doubling. Both writing and
	// reading work from the rounded value, so they agree on the grid.
	function packScale(scale) {
		return clamp(Math.round(Math.log2(scale || 1) * 4) + 16, 0, 31);
	}
	function unpackScale(code) {
		return Math.pow(2, (code - 16) / 4);
	}

	// Everything on the page that's worth writing down: no pictures, nothing that's
	// been rubbed out, and no eraser left with nothing to cut.
	function codeActions() {
		var list = pageActions().filter(function (a) {
			return a.type !== "clear" && a.tool !== "image";
		});
		var out = [];
		var ink = [];
		list.forEach(function (a) {
			if (a.tool === "eraser") {
				// Keep it only while something it cuts into is still being written out.
				for (var i = 0; i < ink.length; i++) {
					if (boxesOverlap(ink[i].box, a.box)) {
						out.push(a);
						return;
					}
				}
				return;
			}
			if (!stillShowing(a)) return;
			ink.push(a);
			out.push(a);
		});
		return out;
	}

	function packPage() {
		var list = codeActions();
		var out = [3];
		writeNum(out, list.length);
		list.forEach(function (a) {
			if (a.tool === "graph") {
				packGraph(out, a);
				return;
			}
			var sizes = SIZES[a.tool] || [];
			var sizeIx = sizes.indexOf(a.size);
			if (sizeIx < 0) sizeIx = 3;
			var feel = hasFeel(a);
			var scaleCode = packScale(a.scale);
			// Two bytes for everything that was a choice from a list: the tool, which pen,
			// the colour, which of the three thicknesses, and the zoom it was written at.
			// Each is masked to the bits it's given, so an unknown one can't spill into
			// the next field and turn a stroke into something else.
			out.push((Math.max(0, TOOLS.indexOf(a.tool)) & 3) | ((Math.max(0, PEN_TYPES.indexOf(a.pen)) & 3) << 2) | ((Math.max(0, COLOR_KEYS.indexOf(a.color)) & 15) << 4));
			out.push(sizeIx | (feel ? 4 : 0) | (scaleCode << 3));
			// A thickness that isn't one of the three is written out in full.
			if (sizeIx === 3) writeNum(out, Math.round(a.size * 10));
			var size = sizeIx === 3 ? Math.round(a.size * 10) / 10 : sizes[sizeIx];
			var scale = unpackScale(scaleCode);
			var grid = codeGrid(size, scale);
			// Only the points the curve needs. Measured in screen pixels at the zoom it
			// was written at, which is what the hand was working to.
			var keep = curveIndices(a.points, grid, codeTol(size) / scale, codeStep(scale));
			var pts = keep.map(function (i) {
				return a.points[i];
			});
			writeNum(out, pts.length);
			// Positions, each as a step from the one before.
			var x = 0;
			var y = 0;
			pts.forEach(function (p) {
				var qx = Math.round(p.x * grid);
				var qy = Math.round(p.y * grid);
				writeNum(out, qx - x);
				writeNum(out, qy - y);
				x = qx;
				y = qy;
			});
			if (!feel) return;
			// Then the feel of it, all together on the end: pressure to a sixteenth,
			// speed to an eighth off a curve so slow writing, where it shows, is finer.
			feelAt(pts.length).forEach(function (i) {
				var p = pts[i];
				var press = Math.round(clamp(p.p, 0, 1) * 15);
				var speed = Math.round(Math.sqrt(clamp((p.v || 0) / 6, 0, 1)) * 7);
				out.push(press | (speed << 4));
			});
		});
		return new Uint8Array(out);
	}

	function unpackPage(bytes) {
		var r = new Reader(bytes);
		var version = r.byte();
		if (version === 3) return unpackV2(r, true);
		if (version === 2) return unpackV2(r, false);
		if (version !== 1) throw new Error("This code is from a newer version");
		return unpackV1(r);
	}

	// Versions 2 and 3 are written the same way. The difference is what the points mean:
	// in 2 they're the line itself, in 3 they're the points a curve runs through.
	// A set of axes in a notes code: the frame, the window of numbers, and the sums as
	// the text they were typed as. A whole graph comes to a few dozen characters.
	function packGraph(out, a) {
		out.push(3 | ((Math.max(0, COLOR_KEYS.indexOf(a.color)) & 15) << 4) | (a.grid ? 4 : 0) | (a.labels ? 8 : 0));
		// Twentieths of a page unit for the frame, which is finer than anyone can place it.
		[a.cx, a.cy, a.w, a.h].forEach(function (v) {
			writeNum(out, Math.round(v * 20));
		});
		// A turn to a thousandth, and the line thickness to a tenth.
		writeNum(out, Math.round(a.rot * 1000));
		writeNum(out, Math.round(a.size * 10));
		// The window, to a ten-thousandth: enough for anything typed into the dialog.
		[a.x0, a.x1, a.y0, a.y1].forEach(function (v) {
			writeNum(out, Math.round(v * 10000));
		});
		var funcs = (a.funcs || []).slice(0, 32);
		out.push(funcs.length);
		funcs.forEach(function (f) {
			var text = String(f.expr || "").slice(0, 200);
			out.push(Math.max(0, COLOR_KEYS.indexOf(f.color)) & 15);
			// Sums are written in plain characters, bar the few Greek ones, which are
			// spelled out so every byte here stands for one character.
			var plain = text.replace(/π/g, "pi").replace(/τ/g, "tau");
			var bytes = [];
			for (var i = 0; i < plain.length && bytes.length < 200; i++) {
				var c = plain.charCodeAt(i);
				if (c >= 32 && c < 127) bytes.push(c);
			}
			out.push(bytes.length);
			for (i = 0; i < bytes.length; i++) out.push(bytes[i]);
		});
	}

	function unpackGraph(r, kind) {
		var a = {
			tool: "graph",
			color: COLOR_KEYS[(kind >> 4) & 15] || "ink",
			grid: !!(kind & 4),
			labels: !!(kind & 8),
			cx: r.num() / 20,
			cy: r.num() / 20,
			w: r.num() / 20,
			h: r.num() / 20,
			rot: r.num() / 1000,
			size: r.num() / 10,
			x0: r.num() / 10000,
			x1: r.num() / 10000,
			y0: r.num() / 10000,
			y1: r.num() / 10000,
			funcs: [],
		};
		var n = r.byte();
		for (var i = 0; i < n; i++) {
			var color = COLOR_KEYS[r.byte() & 15] || "ink";
			var len = r.byte();
			var text = "";
			for (var j = 0; j < len; j++) text += String.fromCharCode(r.byte());
			a.funcs.push({ expr: text, color: color });
		}
		if (!(a.w > 0) || !(a.h > 0) || !(a.x1 > a.x0) || !(a.y1 > a.y0) || !(a.size > 0)) {
			throw new Error("The code is damaged");
		}
		a.box = frameBox(a);
		return a;
	}

	function unpackV2(r, curve) {
		var count = r.num();
		var list = [];
		for (var j = 0; j < count; j++) {
			var kind = r.byte();
			if ((kind & 3) === 3) {
				list.push(unpackGraph(r, kind));
				continue;
			}
			var rest = r.byte();
			var tool = TOOLS[kind & 3];
			var sizeIx = rest & 3;
			var feel = !!(rest & 4);
			var scale = unpackScale(rest >> 3);
			var size = sizeIx === 3 ? r.num() / 10 : (SIZES[tool] || [])[sizeIx];
			var s = {
				tool: tool,
				pen: PEN_TYPES[(kind >> 2) & 3] || "fountain",
				color: COLOR_KEYS[(kind >> 4) & 15] || "ink",
				size: size,
				scale: scale,
				points: [],
			};
			if (!s.tool || !(s.size > 0)) throw new Error("The code is damaged");
			var grid = codeGrid(size, scale);
			var n = r.num();
			var kept = [];
			var x = 0;
			var y = 0;
			for (var i = 0; i < n; i++) {
				x += r.num();
				y += r.num();
				kept.push({ x: x / grid, y: y / grid, p: 0.5, v: 0 });
			}
			if (feel) {
				// Read what was kept of how hard and fast the hand was going, then fill
				// in the points between by running from one to the next.
				var at = feelAt(n);
				var press = [];
				var speed = [];
				for (i = 0; i < at.length; i++) {
					var b = r.byte();
					press.push((b & 15) / 15);
					var q = ((b >> 4) & 7) / 7;
					speed.push(q * q * 6);
				}
				for (i = 0; i + 1 < at.length; i++) {
					var from = at[i];
					var to = at[i + 1];
					for (var k = from; k <= to; k++) {
						var t = to === from ? 0 : (k - from) / (to - from);
						kept[k].p = press[i] + (press[i + 1] - press[i]) * t;
						kept[k].v = speed[i] + (speed[i + 1] - speed[i]) * t;
					}
				}
				if (at.length === 1 && n) {
					kept[0].p = press[0];
					kept[0].v = speed[0];
				}
			}
			// Version 3 keeps only the points a curve needs, so the curve is run through
			// them again here. Version 2 wrote the line out point by point.
			s.points = curve ? throughPoints(kept, codeStep(scale)) : kept;
			// How far along the line each point sits: the pens use it to taper the ends.
			var d = 0;
			for (i = 0; i < s.points.length; i++) {
				if (i) d += Math.hypot(s.points[i].x - s.points[i - 1].x, s.points[i].y - s.points[i - 1].y);
				s.points[i].d = d;
			}
			if (n) list.push(s);
		}
		return list;
	}

	// Codes written before the format was shortened. Kept so old codes still open.
	function unpackV1(r) {
		var count = r.num();
		var list = [];
		for (var j = 0; j < count; j++) {
			var kind = r.byte();
			var s = {
				tool: TOOLS[Math.floor(kind / 4)],
				pen: PEN_TYPES[kind % 4] || "fountain",
				color: COLOR_KEYS[r.byte()] || "ink",
				size: r.num() / 10,
				scale: r.num() / 100 || 1,
				points: [],
			};
			if (!s.tool || !(s.size > 0)) throw new Error("The code is damaged");
			var n = r.num();
			var x = 0;
			var y = 0;
			var d = 0;
			for (var i = 0; i < n; i++) {
				x += r.num();
				y += r.num();
				var pt = { x: x / 20, y: y / 20, p: r.byte() / 255, v: (r.byte() / 255) * 6 };
				var before = s.points[s.points.length - 1];
				if (before) d += Math.hypot(pt.x - before.x, pt.y - before.y);
				pt.d = d;
				s.points.push(pt);
			}
			if (n) list.push(s);
		}
		return list;
	}

	// Runs bytes through a browser compression stream. Older browsers don't have one.
	function squeeze(bytes, Stream, format) {
		return new Response(new Blob([bytes]).stream().pipeThrough(new Stream(format))).arrayBuffer().then(function (b) {
			return new Uint8Array(b);
		});
	}

	function toLetters(bytes) {
		var bin = "";
		for (var i = 0; i < bytes.length; i += 0x8000) {
			bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		}
		return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}

	function fromLetters(text) {
		var b64 = text.replace(/-/g, "+").replace(/_/g, "/");
		while (b64.length % 4) b64 += "=";
		var bin = atob(b64);
		var bytes = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return bytes;
	}

	// ---------- Letters that carry more ----------
	//
	// The letters above carry six bits each: a-z, A-Z, 0-9 and two more. These carry
	// fourteen, which leaves the code well under half as long. They're Chinese
	// characters, picked because there are twenty thousand of them in one unbroken run,
	// every one is a single character as far as a program is concerned, and none of them
	// change under the tidying text goes through on its way between apps - no accents to
	// combine, no upper and lower case, nothing that looks like a space.
	//
	// The catch is web addresses, where every one of them has to be spelled out in
	// escapes and the saving is lost. So a notes link still uses the plain letters, and
	// the reader takes either.
	var DENSE_FIRST = 0x4e00;
	var DENSE_SIZE = 16384;
	var DENSE_BITS = 14;
	var DENSE_PREFIX = "wb2";

	function toDense(bytes) {
		// How many bytes there are goes in first, so the few spare bits rounding off the
		// last character can't be read as part of the page.
		var head = [];
		writeNum(head, bytes.length);
		var out = "";
		var acc = 0;
		var bits = 0;
		var i;
		var all = head.concat(Array.prototype.slice.call(bytes));
		for (i = 0; i < all.length; i++) {
			acc = acc * 256 + all[i];
			bits += 8;
			while (bits >= DENSE_BITS) {
				bits -= DENSE_BITS;
				var pow = Math.pow(2, bits);
				var v = Math.floor(acc / pow);
				acc -= v * pow;
				out += String.fromCharCode(DENSE_FIRST + v);
			}
		}
		if (bits) out += String.fromCharCode(DENSE_FIRST + acc * Math.pow(2, DENSE_BITS - bits));
		return out;
	}

	function fromDense(text) {
		var bytes = [];
		var acc = 0;
		var bits = 0;
		for (var i = 0; i < text.length; i++) {
			var v = text.charCodeAt(i) - DENSE_FIRST;
			if (!(v >= 0) || v >= DENSE_SIZE) throw new Error("The code is damaged");
			acc = acc * DENSE_SIZE + v;
			bits += DENSE_BITS;
			while (bits >= 8) {
				bits -= 8;
				var pow = Math.pow(2, bits);
				var b = Math.floor(acc / pow);
				acc -= b * pow;
				bytes.push(b);
			}
		}
		var r = new Reader(new Uint8Array(bytes));
		var n = r.num();
		if (!(n >= 0) || r.i + n > bytes.length) throw new Error("The code is damaged");
		return new Uint8Array(bytes.slice(r.i, r.i + n));
	}

	// Four ways to write the same page out: squeezed or not, in plain letters or the ones
	// that carry more. Squeezing carries a header of its own, so for a line or two of
	// writing it makes the code longer. All four are made and the shortest is handed
	// over, along with the shortest that will survive being put in a web address.
	function makeCodes() {
		var raw = packPage();
		function shortest(list) {
			var best = list[0];
			for (var i = 1; i < list.length; i++) {
				if (list[i].length < best.length) best = list[i];
			}
			return best;
		}
		function pick(bytes, mode) {
			return [CODE_PREFIX + mode + toLetters(bytes), DENSE_PREFIX + mode + toDense(bytes)];
		}
		var plain = pick(raw, "r");
		if (window.CompressionStream) {
			return squeeze(raw, CompressionStream, "deflate")
				.then(function (z) {
					var packed = pick(z, "z");
					return { code: shortest(plain.concat(packed)), link: shortest([plain[0], packed[0]]) };
				})
				.catch(function () {
					return { code: shortest(plain), link: plain[0] };
				});
		}
		return Promise.resolve({ code: shortest(plain), link: plain[0] });
	}

	function makeCode() {
		return makeCodes().then(function (both) {
			return both.code;
		});
	}

	function readCode(text) {
		// Accept a whole link too, and ignore spaces or line breaks picked up when pasting.
		text = String(text || "").replace(/\s+/g, "");
		var hash = text.indexOf("#n=");
		if (hash >= 0) text = text.slice(hash + 3);
		// A code in a web address arrives with its characters spelled out in escapes.
		if (text.indexOf("%") >= 0) {
			try {
				text = decodeURIComponent(text);
			} catch (e) {
				// Leave it as it is; it'll be turned away below if it isn't a code.
			}
		}
		var dense = text.slice(0, DENSE_PREFIX.length) === DENSE_PREFIX;
		var head = dense ? DENSE_PREFIX : CODE_PREFIX;
		if (!dense && text.slice(0, CODE_PREFIX.length) !== CODE_PREFIX) {
			return Promise.reject(new Error("That isn't a notes code"));
		}
		var mode = text.charAt(head.length);
		var bytes;
		try {
			var body = text.slice(head.length + 1);
			bytes = dense ? fromDense(body) : fromLetters(body);
		} catch (e) {
			return Promise.reject(new Error("The code is damaged"));
		}
		var unzip;
		if (mode === "r") unzip = Promise.resolve(bytes);
		else if (mode === "z" && window.DecompressionStream) unzip = squeeze(bytes, DecompressionStream, "deflate");
		else return Promise.reject(new Error("This browser can't open that code"));
		return unzip.then(unpackPage, function () {
			throw new Error("The code is damaged");
		});
	}

	// Puts the notes on the page. The old page is cleared as a normal step, so Undo gets it back.
	function loadNotes(list) {
		if (current) return;
		clearSelection();
		var added = [];
		if (!pageIsEmpty()) added.push({ type: "clear" });
		var box = null;
		list.forEach(function (s) {
			// A set of axes arrives whole; it isn't made of points.
			var a =
				s.tool === "graph"
					? s
					: {
							tool: s.tool,
							pen: s.pen,
							color: s.color,
							size: s.size,
							scale: s.scale,
							points: s.points,
							box: bounds(s.points, s.size * 1.5),
							// No shape yet: each is built the first time a tile draws it.
							shape: null,
							detail: 0,
						};
			added.push(a);
			if (a.tool === "eraser") return;
			var b = a.box;
			if (!box) box = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
			else {
				box.x0 = Math.min(box.x0, b.x0);
				box.y0 = Math.min(box.y0, b.y0);
				box.x1 = Math.max(box.x1, b.x1);
				box.y1 = Math.max(box.y1, b.y1);
			}
		});

		// A new page at a new zoom: start the tiles afresh.
		function settle() {
			pageStart = findStart();
			dropAllTiles();
			requestRender(true);
		}

		pushOp({
			redo: function () {
				added.forEach(function (a) {
					actions.push(a);
				});
				// Fit the notes on screen, below the toolbar, never zoomed in past 100%.
				if (box) {
					var top = 80;
					var fit = Math.min(1, (width - 48) / (box.x1 - box.x0), (height - top - 24) / (box.y1 - box.y0));
					view.s = clamp(fit, MIN_ZOOM, MAX_ZOOM);
					view.x = width / 2 - ((box.x0 + box.x1) / 2) * view.s;
					view.y = top + (height - top) / 2 - ((box.y0 + box.y1) / 2) * view.s;
				}
				settle();
			},
			undo: function () {
				actions.length = Math.max(0, actions.length - added.length);
				settle();
			},
		});
	}

	function openCode(text) {
		return readCode(text).then(function (list) {
			loadNotes(list);
			toast(list.length ? "Notes opened" : "That code was an empty page");
		});
	}

	// The dialog does both jobs: shows a code to copy, or takes one to open.
	var codeMode = "save";
	// The code shown is the shortest there is. A link needs the plain-letter one, which
	// is longer but survives being put in a web address.
	var linkCode = "";

	function showDialog(mode) {
		codeMode = mode;
		notesMenu.hidden = true;
		codeDialog.dataset.mode = mode;
		document.getElementById("code-title").textContent = mode === "save" ? "Notes code" : "Open notes";
		document.getElementById("code-note").textContent =
			mode === "save"
				? "Keep this code somewhere safe. Paste it into Open notes, or open the link, to get these notes back." +
					(pageHasImage() ? " Pasted pictures aren't part of the code, only writing." : "")
				: "Paste a notes code or link. The current page is cleared first; Undo brings it back.";
		codeText.readOnly = mode === "save";
		codeText.value = "";
		document.getElementById("code-error").textContent = "";
		if (codeDialog.showModal) codeDialog.showModal();
		else codeDialog.setAttribute("open", "");
		if (mode === "save") {
			codeText.placeholder = "Making the code…";
			linkCode = "";
			makeCodes().then(function (both) {
				codeText.value = both.code;
				linkCode = both.link;
				document.getElementById("code-error").textContent = both.code.length.toLocaleString() + " characters";
			});
		} else {
			codeText.placeholder = "wb2… or wb1…";
			codeText.focus();
		}
	}

	function closeDialog() {
		if (codeDialog.close) codeDialog.close();
		else codeDialog.removeAttribute("open");
	}

	function copyText(text, done) {
		if (!text) return;
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(
				function () {
					toast(done);
				},
				function () {
					codeText.select();
					toast("Select the code and copy it");
				}
			);
		} else {
			codeText.select();
			toast("Select the code and copy it");
		}
	}

	function notesLink(code) {
		return location.origin + location.pathname + "#n=" + code;
	}

	notesBtn.addEventListener("click", function () {
		if (!notesMenu.hidden) {
			notesMenu.hidden = true;
			return;
		}
		closePenMenu();
		copyMenu.hidden = true;
		notesMenu.querySelector('[data-notes="save"]').disabled = pageIsEmpty();
		placeMenu(notesMenu, notesBtn);
	});

	notesMenu.querySelectorAll("button").forEach(function (b) {
		b.addEventListener("click", function () {
			showDialog(b.dataset.notes);
		});
	});

	document.getElementById("code-copy").addEventListener("click", function () {
		copyText(codeText.value, "Code copied");
	});
	document.getElementById("code-link").addEventListener("click", function () {
		if (linkCode) copyText(notesLink(linkCode), "Link copied");
	});
	document.getElementById("code-cancel").addEventListener("click", closeDialog);
	document.getElementById("code-open").addEventListener("click", function () {
		var err = document.getElementById("code-error");
		err.textContent = "";
		openCode(codeText.value).then(closeDialog, function (e) {
			err.textContent = e.message;
		});
	});

	// Opening a notes link loads its notes, then tidies the address so a reload doesn't redo it.
	function openFromAddress() {
		if (location.hash.indexOf("#n=") !== 0) return;
		var code = location.hash.slice(3);
		if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
		openCode(code).catch(function (e) {
			toast(e.message);
		});
	}
	window.addEventListener("hashchange", openFromAddress);

	// ---------- More menu (narrow windows) ----------

	var moreMenu = document.getElementById("more-menu");
	var moreBtn = document.getElementById("more");

	moreBtn.addEventListener("click", function () {
		if (!moreMenu.hidden) {
			moreMenu.hidden = true;
			return;
		}
		closePenMenu();
		copyMenu.hidden = true;
		notesMenu.hidden = true;
		var empty = pageIsEmpty();
		moreMenu.querySelectorAll('[data-more="clear"], [data-more^="copy"], [data-more="save"]').forEach(function (b) {
			b.disabled = empty;
		});
		moreMenu.querySelector('[data-more="theme"] span').textContent =
			themeName() === "dark" ? "Switch to light" : "Switch to dark";
		placeMenu(moreMenu, moreBtn);
	});

	moreMenu.querySelectorAll("button").forEach(function (b) {
		b.addEventListener("click", function () {
			moreMenu.hidden = true;
			var what = b.dataset.more;
			if (what === "clear") clearPage();
			else if (what === "paste") pasteFromClipboard();
			else if (what === "copy-light") copyImage("light");
			else if (what === "copy-dark") copyImage("dark");
			else if (what === "save" || what === "open") showDialog(what);
			else if (what === "theme") document.getElementById("theme").click();
		});
	});

	// ---------- Start ----------

	readPalette();
	resize();
	openFromAddress();
	window.addEventListener("resize", resize);
	// ---------- Light / dark ----------

	var themeMeta = document.querySelector('meta[name="theme-color"]');

	function setTheme(name) {
		document.documentElement.dataset.theme = name;
		themeMeta.content = name === "dark" ? "#000000" : "#fbfaf7";
		// Ink colours change with the theme, so redraw every stroke in the new colours.
		readPalette();
		// Including anything the lasso is holding.
		if (sel) {
			bakeSelectionCanvas();
			layoutSelection();
		}
		dropAllTiles();
		urgent = true;
		requestRender(true);
	}

	document.getElementById("theme").addEventListener("click", function () {
		var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
		try {
			localStorage.setItem("wbts:theme", next);
		} catch (e) {}
		setTheme(next);
	});

	// Follow the iPad's setting until a choice has been made with the button.
	var scheme = matchMedia("(prefers-color-scheme: dark)");
	var onScheme = function () {
		var saved = null;
		try {
			saved = localStorage.getItem("wbts:theme");
		} catch (e) {}
		if (!saved) setTheme(scheme.matches ? "dark" : "light");
	};
	if (scheme.addEventListener) scheme.addEventListener("change", onScheme);
	else if (scheme.addListener) scheme.addListener(onScheme);
})();
