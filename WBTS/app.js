// WBTS: a scribble pad. Everything lives in memory; nothing is saved.
(function () {
	"use strict";

	var board = document.getElementById("board");
	var inkCanvas = document.getElementById("ink");
	var liveCanvas = document.getElementById("live");
	var ink = inkCanvas.getContext("2d");
	var live = liveCanvas.getContext("2d");
	var zoomBtn = document.getElementById("zoom");

	// Sizes on the page, so a line is equally thick at any zoom, like ink on paper.
	// Fine, medium and bold, for each tool.
	var SIZES = {
		pen: [1.6, 3.2, 6.5],
		eraser: [12, 28, 60],
	};
	// The size picked for each tool, as an index into SIZES.
	var sizeChoice = { pen: 1, eraser: 1 };
	var MIN_ZOOM = 0.1;
	var MAX_ZOOM = 8;
	var GRID = 24;

	// Every stroke and every "clear" in order, in page coordinates.
	var actions = [];
	var redoStack = [];

	var tool = "pen";
	// fountain, ball or brush, like GoodNotes.
	var penType = "fountain";
	var color = "ink";
	var palette = {};

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
	var shownZoom = "";

	// ---------- View ----------

	function applyView(ctx) {
		ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y);
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
	function zoomAt(cx, cy, factor) {
		var s = clamp(view.s * factor, MIN_ZOOM, MAX_ZOOM);
		var px = (cx - view.x) / view.s;
		var py = (cy - view.y) / view.s;
		view.s = s;
		view.x = cx - px * s;
		view.y = cy - py * s;
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
		var ox = ((view.x % step) + step) % step;
		var oy = ((view.y % step) + step) % step;
		board.style.backgroundSize = step + "px " + step + "px";
		board.style.backgroundPosition = ox - step / 2 + "px " + (oy - step / 2) + "px";
		// Only touch the toolbar when the number changes, so it isn't re-laid-out every frame.
		var z = Math.round(view.s * 100) + "%";
		if (z !== shownZoom) zoomBtn.textContent = shownZoom = z;
	}

	// ---------- Setup ----------

	function readPalette() {
		var css = getComputedStyle(document.documentElement);
		palette = {
			ink: css.getPropertyValue("--ink").trim(),
			blue: css.getPropertyValue("--blue").trim(),
			red: css.getPropertyValue("--red").trim(),
		};
	}

	function resize() {
		dpr = window.devicePixelRatio || 1;
		width = board.clientWidth;
		height = board.clientHeight;
		[inkCanvas, liveCanvas].forEach(function (c) {
			c.width = Math.round(width * dpr);
			c.height = Math.round(height * dpr);
		});
		[ink, live].forEach(function (ctx) {
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
		});
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
			if (last && Math.hypot(r.x - last.x, r.y - last.y) < gap) {
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
			var lu = Math.hypot(ux, uy);
			var lv = Math.hypot(vx, vy);
			turn[i] = lu && lv ? (ux * vx + uy * vy) / (lu * lv) : 1;
		}
		// A corner is the sharpest point of a sharp turn. It stays exactly where it was drawn.
		for (i = 1; i < n - 1; i++) {
			pts[i].corner = turn[i] < -0.2 && turn[i] <= turn[i - 1] && turn[i] <= turn[i + 1];
		}

		// Smooth everything but the ends and the corners.
		for (var pass = 0; pass < 3; pass++) {
			var px0 = pts[0].x;
			var py0 = pts[0].y;
			var pp0 = pts[0].p;
			for (i = 1; i < n - 1; i++) {
				var c = pts[i];
				var next = pts[i + 1];
				var cx = c.x;
				var cy = c.y;
				var cp = c.p;
				if (!c.corner) {
					c.x = (px0 + 2 * cx + next.x) / 4;
					c.y = (py0 + 2 * cy + next.y) / 4;
					c.p = (pp0 + 2 * cp + next.p) / 4;
				}
				px0 = cx;
				py0 = cy;
				pp0 = cp;
			}
		}
		return pts;
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
			var len = Math.hypot(tx, ty);
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
			var lu = Math.hypot(ux, uy);
			var lv = Math.hypot(vx, vy);
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
			var ld = Math.hypot(dx, dy) || 1;
			inX[i] = outX[i] = dx / ld;
			inY[i] = outY[i] = dy / ld;
		}

		edge(first.x, first.y, W[0], outX[0], outY[0]);

		for (i = 0; i < n - 1; i++) {
			var p0 = pts[i];
			var p3 = pts[i + 1];
			var len = Math.hypot(p3.x - p0.x, p3.y - p0.y);
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

	function drawAction(ctx, a) {
		if (a.tool === "eraser") {
			eraseShape(ctx, a, a.shape);
			return;
		}
		// The outline was built for the zoom it was last drawn at. Zoomed in well past
		// that, rebuild it with more pieces so its curves don't show straight edges.
		if (view.s > a.detail * 1.5) {
			a.shape = penShape(a, null, true);
			a.detail = Math.max(view.s, 1);
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
	// Two layers: "ink" holds finished strokes, "live" holds the pen stroke being
	// drawn. The live stroke is rebuilt each frame (it's short), then moved onto
	// the ink layer once when the Pencil lifts. The eraser works straight on the
	// ink layer since it has to cut into it.

	function redrawAll() {
		wipe(ink);
		// Only draw strokes that are on screen.
		var vx0 = -view.x / view.s;
		var vy0 = -view.y / view.s;
		var vx1 = vx0 + width / view.s;
		var vy1 = vy0 + height / view.s;

		var start = 0;
		for (var i = actions.length - 1; i >= 0; i--) {
			if (actions[i].type === "clear") {
				start = i + 1;
				break;
			}
		}
		for (var j = start; j < actions.length; j++) {
			var b = actions[j].box;
			if (b.x1 < vx0 || b.x0 > vx1 || b.y1 < vy0 || b.y0 > vy1) continue;
			drawAction(ink, actions[j]);
		}

		if (current && current.tool === "eraser") {
			eraseShape(ink, current, eraserShape(current));
			current.erasedTo = current.points.length;
		}
		updateChrome();
	}

	function renderLive() {
		wipe(live);
		if (!current) return;
		var s = current;
		var pts = s.points;
		var last = pts[pts.length - 1];

		if (s.tool === "eraser") {
			// Cut the new part of the swipe into the ink.
			if (s.erasedTo < pts.length) {
				var path = new Path2D();
				var from = pts[Math.max(0, s.erasedTo - 1)];
				path.moveTo(from.x, from.y);
				for (var i = s.erasedTo; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
				if (s.erasedTo === 0) path.lineTo(from.x + 0.01, from.y);
				eraseShape(ink, s, path);
				s.erasedTo = pts.length;
			}
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

		fillShape(live, s, penShape(s, s.predicted));
	}

	function onFrame() {
		frame = 0;
		if (dirty) {
			dirty = false;
			redrawAll();
		}
		renderLive();
	}

	// full: the view or the strokes changed, so everything is redrawn.
	function requestRender(full) {
		if (full) dirty = true;
		if (!frame) frame = requestAnimationFrame(onFrame);
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
			var dist = Math.hypot(pt.x - prev.x, pt.y - prev.y) * view.s;
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
			pt.d = last.d + Math.hypot(dx, dy);
		}
		pts.push(pt);
	}

	function startStroke(e) {
		activeId = e.pointerId;
		activeType = e.pointerType;
		current = {
			tool: tool,
			pen: penType,
			color: color,
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
		// An eraser has already cut into the ink, so the page needs redrawing.
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
		if (s.tool === "eraser") {
			a.shape = eraserShape(s);
		} else {
			a.shape = penShape(s, null, true);
			fillShape(ink, a, a.shape);
		}
		actions.push(a);
		redoStack = [];
		current = null;
		activeId = null;
		updateButtons();
		requestRender();
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
			if (g.n >= 2 && gesture.d > 0) zoomAt(gesture.cx, gesture.cy, g.d / gesture.d);
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
		if (!penMenu.hidden || !copyMenu.hidden) {
			closePenMenu();
			copyMenu.hidden = true;
			return;
		}
		try {
			board.setPointerCapture(e.pointerId);
		} catch (err) {}

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
			if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.01));
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
		e.preventDefault();
	});

	// ---------- Toolbar ----------

	var undoBtn = document.getElementById("undo");
	var redoBtn = document.getElementById("redo");
	var clearBtn = document.getElementById("clear");
	var copyBtn = document.getElementById("copy");

	function pageIsEmpty() {
		return !actions.length || actions[actions.length - 1].type === "clear";
	}

	function updateButtons() {
		undoBtn.disabled = !actions.length;
		redoBtn.disabled = !redoStack.length;
		clearBtn.disabled = pageIsEmpty();
		copyBtn.disabled = pageIsEmpty();
	}

	function undo() {
		if (current || !actions.length) return;
		redoStack.push(actions.pop());
		requestRender(true);
		updateButtons();
	}

	function redo() {
		if (current || !redoStack.length) return;
		actions.push(redoStack.pop());
		requestRender(true);
		updateButtons();
	}

	function clearPage() {
		if (current || pageIsEmpty()) return;
		// Clearing is just another step, so Undo brings the page back.
		actions.push({ type: "clear" });
		redoStack = [];
		requestRender(true);
		updateButtons();
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
		tool = name;
		press(".tool", "tool", tool);
		// Each tool remembers its own thickness.
		press(".size", "size", String(sizeChoice[tool]));
	}

	document.querySelectorAll(".tool").forEach(function (b) {
		b.addEventListener("click", function () {
			// Tapping the pen again opens its menu, as in GoodNotes.
			if (b.dataset.tool === "pen" && tool === "pen") {
				if (penMenu.hidden) openPenMenu(b);
				else closePenMenu();
				return;
			}
			closePenMenu();
			selectTool(b.dataset.tool);
		});
	});

	// ---------- Pen menu ----------

	var penMenu = document.getElementById("pen-menu");

	// Draws a sample stroke for a pen type, light at both ends and heavy in the middle.
	function drawPreview(canvas, pen) {
		var w = canvas.clientWidth;
		var h = canvas.clientHeight;
		var ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(w * ratio);
		canvas.height = Math.round(h * ratio);
		var ctx = canvas.getContext("2d");
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		var s = { tool: "pen", pen: pen, color: color, size: SIZES.pen[sizeChoice.pen], points: [] };
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
		copyMenu.hidden = true;
		placeMenu(penMenu, button);
		penMenu.querySelectorAll("button").forEach(function (b) {
			drawPreview(b.querySelector("canvas"), b.dataset.pen);
		});
	}

	function closePenMenu() {
		penMenu.hidden = true;
	}

	// Any tap outside a menu (and not on the button that toggles it) closes it.
	document.addEventListener("pointerdown", function (e) {
		var t = e.target;
		[
			[penMenu, '[data-tool="pen"]'],
			[copyMenu, "#copy"],
		].forEach(function (m) {
			if (m[0].hidden || m[0].contains(t)) return;
			if (t.closest && t.closest(m[1])) return;
			m[0].hidden = true;
		});
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

	document.querySelectorAll(".size").forEach(function (b) {
		b.addEventListener("click", function () {
			sizeChoice[tool] = Number(b.dataset.size);
			press(".size", "size", b.dataset.size);
		});
	});

	document.querySelectorAll(".swatch").forEach(function (b) {
		b.addEventListener("click", function () {
			color = b.dataset.color;
			press(".swatch", "color", color);
			// Picking a colour means you want to write.
			selectTool("pen");
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

	// The same colours as style.css, for both themes at once.
	var THEMES = {
		light: { paper: "#fbfaf7", ink: "#1d1d1f", blue: "#2160d8", red: "#d23a32" },
		dark: { paper: "#000000", ink: "#f2f2f4", blue: "#5b93ff", red: "#ff6a5f" },
	};

	function toast(text) {
		toastEl.textContent = text;
		toastEl.classList.add("show");
		clearTimeout(toastTimer);
		toastTimer = setTimeout(function () {
			toastEl.classList.remove("show");
		}, 1800);
	}

	// Everything drawn since the last "clear".
	function pageActions() {
		var start = 0;
		for (var i = actions.length - 1; i >= 0; i--) {
			if (actions[i].type === "clear") {
				start = i + 1;
				break;
			}
		}
		return actions.slice(start);
	}

	// Draws the page onto a new canvas in the given theme, or returns null if there's no ink.
	function renderImage(themeName) {
		var colors = THEMES[themeName];
		var list = pageActions();
		// Crop to the pen strokes; the eraser can only remove ink, never add it.
		var box = null;
		list.forEach(function (a) {
			if (a.tool !== "pen") return;
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
			if (a.tool === "eraser") {
				eraseShape(ctx, a, a.shape);
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

	// Hardware keyboard shortcuts.
	document.addEventListener("keydown", function (e) {
		if (!(e.metaKey || e.ctrlKey)) return;
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

	// ---------- Start ----------

	readPalette();
	resize();
	window.addEventListener("resize", resize);
	// ---------- Light / dark ----------

	var themeMeta = document.querySelector('meta[name="theme-color"]');

	function setTheme(name) {
		document.documentElement.dataset.theme = name;
		themeMeta.content = name === "dark" ? "#000000" : "#fbfaf7";
		// Ink colours change with the theme, so redraw every stroke in the new colours.
		readPalette();
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
