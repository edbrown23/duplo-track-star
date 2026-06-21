/*
 * app.js — state, geometry maths, rendering and interaction for the
 * DUPLO Track Studio.
 *
 * Big picture
 * -----------
 * The layout is just a flat list of placed pieces, each with an absolute
 * transform { x, y, rot }. Connections between pieces are NOT stored — they
 * are derived from geometry every render: any two open connector ends that
 * sit on top of each other while facing opposite directions are considered
 * joined. This keeps the model trivial: undo, delete and loop-closure all
 * fall out for free because nothing has to be re-linked.
 */
(function () {
  "use strict";

  const Duplo = window.Duplo;
  const CFG = Duplo.CFG;
  const PIECES = Duplo.PIECES;
  const SVGNS = "http://www.w3.org/2000/svg";

  // ---- small helpers -------------------------------------------------------

  function el(tag, attrs) {
    const node = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }
  const deg = (rad) => (rad * 180) / Math.PI;
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a)); // wrap to (-π, π]

  // Apply a piece transform to a local point.
  function tp(t, x, y) {
    const c = Math.cos(t.rot);
    const s = Math.sin(t.rot);
    return { x: x * c - y * s + t.x, y: x * s + y * c + t.y };
  }

  // Subdivide a centreline so the bed/rails/sleepers all look smooth and the
  // sleeper spacing is even, regardless of how coarse the source samples are.
  function densify(samples, step) {
    const out = [];
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let j = 0; j < n; j++) {
        const u = j / n;
        out.push({
          x: a.x + dx * u,
          y: a.y + dy * u,
          dir: a.dir + norm(b.dir - a.dir) * u,
        });
      }
    }
    out.push(samples[samples.length - 1]);
    return out;
  }

  // Offset a point sideways from the centreline. The left normal of a heading
  // `dir` is (-sin, cos).
  function offset(p, d) {
    return { x: p.x - Math.sin(p.dir) * d, y: p.y + Math.cos(p.dir) * d };
  }
  function polyPath(pts, close) {
    let s = "M " + pts[0].x.toFixed(2) + " " + pts[0].y.toFixed(2);
    for (let i = 1; i < pts.length; i++)
      s += " L " + pts[i].x.toFixed(2) + " " + pts[i].y.toFixed(2);
    return close ? s + " Z" : s;
  }

  // ---- state ---------------------------------------------------------------

  let pieces = []; // { pid, type, t:{x,y,rot} }
  let nextId = 1;
  let activeType = "straight"; // which palette piece will be placed next
  let selectedKey = null; // "pid:ci" of the chosen open connector to grow from
  let selectedPiece = null; // pid of a piece selected for deletion
  let view = { x: 0, y: 0, scale: 1 };
  const history = []; // snapshots for undo

  // ---- connector geometry --------------------------------------------------

  function absConnectors(piece) {
    const def = PIECES[piece.type];
    return Duplo.localConnectors(def).map((c, ci) => {
      const p = tp(piece.t, c.x, c.y);
      return { key: piece.pid + ":" + ci, pid: piece.pid, ci, x: p.x, y: p.y, ang: c.ang + piece.t.rot };
    });
  }

  // Every connector across every piece, with `open` resolved by geometry.
  function allConnectors() {
    const list = [];
    pieces.forEach((p) => absConnectors(p).forEach((c) => list.push(c)));
    list.forEach((c) => (c.open = true));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.pid === b.pid) continue;
        const near = Math.hypot(a.x - b.x, a.y - b.y) < 6;
        const opposite = Math.abs(norm(a.ang + Math.PI - b.ang)) < 0.09;
        if (near && opposite) {
          a.open = false;
          b.open = false;
        }
      }
    }
    return list;
  }
  const openConnectors = () => allConnectors().filter((c) => c.open);

  // ---- mutations -----------------------------------------------------------

  function snapshot() {
    history.push(JSON.stringify(pieces));
    if (history.length > 200) history.shift();
  }
  function persist() {
    try {
      localStorage.setItem("duplo-track", JSON.stringify(pieces));
    } catch (e) {
      /* storage may be unavailable; non-fatal */
    }
  }

  function placePiece(type) {
    const open = openConnectors();
    let target = null;
    if (pieces.length === 0) {
      target = null; // first piece anchors at the origin
    } else {
      target = open.find((c) => c.key === selectedKey) || open[0];
      if (!target) {
        flash("That track is a closed loop — delete a piece to add more.");
        return;
      }
    }

    snapshot();
    const t = target ? { x: target.x, y: target.y, rot: target.ang } : { x: 0, y: 0, rot: 0 };
    const piece = { pid: nextId++, type, t };
    pieces.push(piece);

    // Advance the selection to the new exit so chaining is one click each.
    const stillOpen = openConnectors();
    const exit = stillOpen.find((c) => c.key === piece.pid + ":1");
    const entry = stillOpen.find((c) => c.key === piece.pid + ":0");
    selectedKey = (exit || entry || null) && (exit || entry).key;
    selectedPiece = null;
    persist();
    render();
  }

  function deletePiece(pid) {
    const i = pieces.findIndex((p) => p.pid === pid);
    if (i < 0) return;
    snapshot();
    pieces.splice(i, 1);
    if (selectedPiece === pid) selectedPiece = null;
    const open = openConnectors();
    if (!open.find((c) => c.key === selectedKey)) selectedKey = open.length ? open[open.length - 1].key : null;
    persist();
    render();
  }

  function undo() {
    if (!history.length) return;
    pieces = JSON.parse(history.pop());
    nextId = pieces.reduce((m, p) => Math.max(m, p.pid + 1), 1);
    const open = openConnectors();
    if (!open.find((c) => c.key === selectedKey)) selectedKey = open.length ? open[open.length - 1].key : null;
    selectedPiece = null;
    persist();
    render();
  }

  function clearAll() {
    if (pieces.length && !confirm("Clear the whole layout?")) return;
    snapshot();
    pieces = [];
    selectedKey = null;
    selectedPiece = null;
    persist();
    render();
  }

  // ---- piece rendering -----------------------------------------------------

  function buildPieceVisual(def) {
    const g = el("g");
    if (def.bridge) {
      addBridgeUnderstructure(g);
      drawTrackBody(g, bridgeDense());
      return g;
    }
    drawTrackBody(g, densify(def.samples(), 7));
    if (def.station) addStation(g, def);
    return g;
  }

  // Draw the bed, sleepers and rails along an (already dense) centreline.
  function drawTrackBody(g, dense) {
    // track bed: left edge forward, right edge back, closed.
    const left = dense.map((p) => offset(p, CFG.W / 2));
    const right = dense.map((p) => offset(p, -CFG.W / 2)).reverse();
    g.appendChild(
      el("path", { d: polyPath(left.concat(right), true), fill: "#39414e", stroke: "#2b323c", "stroke-width": 3, "stroke-linejoin": "round" })
    );

    // sleepers, evenly spaced along the length.
    const tieHalf = CFG.W / 2 - 7;
    let acc = 0;
    const spacing = 22;
    for (let i = 1; i < dense.length; i++) {
      acc += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y);
      if (acc >= spacing) {
        acc = 0;
        const a = offset(dense[i], tieHalf);
        const b = offset(dense[i], -tieHalf);
        g.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#4b5564", "stroke-width": 7, "stroke-linecap": "round" }));
      }
    }

    // rails: a darker base then a light highlight on top.
    [CFG.RAIL_GAP / 2, -CFG.RAIL_GAP / 2].forEach((d) => {
      const line = dense.map((p) => offset(p, d));
      g.appendChild(el("path", { d: polyPath(line, false), fill: "none", stroke: "#aeb6c2", "stroke-width": 9, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      g.appendChild(el("path", { d: polyPath(line, false), fill: "none", stroke: "#eef1f6", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    });
  }

  // ---- bridge geometry & decoration ----------------------------------------

  // Height of the deck above the ground at distance `s` along the bridge. Flat
  // on the ground at both ends, smoothly ramping up to a level raised span in
  // the middle. Smoothstep keeps the ramp gradient gentle at top and bottom.
  function bridgeHeight(s) {
    const L = CFG.BRIDGE_LEN;
    const ramp = CFG.BRIDGE_RAMP;
    const smooth = (u) => u * u * (3 - 2 * u);
    if (s < ramp) return CFG.BRIDGE_LIFT * smooth(s / ramp);
    if (s > L - ramp) return CFG.BRIDGE_LIFT * smooth((L - s) / ramp);
    return CFG.BRIDGE_LIFT;
  }

  // A dense centreline for the bridge deck: x runs along the piece, y lifts the
  // deck up (toward the viewer, i.e. -y) by bridgeHeight, and `dir` is taken
  // from neighbouring points so rails/sleepers bank correctly on the ramps.
  function bridgeDense() {
    const L = CFG.BRIDGE_LEN;
    const n = Math.ceil(L / 6);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const s = (L * i) / n;
      pts.push({ s, x: s, y: -bridgeHeight(s) });
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      pts[i].dir = Math.atan2(b.y - a.y, b.x - a.x);
    }
    return pts;
  }

  // The ground-level structure that holds the deck up: a soft shadow under the
  // raised span plus a trestle of legs at each end of the span. The middle is
  // deliberately left clear so a track can run underneath it.
  function addBridgeUnderstructure(g) {
    const L = CFG.BRIDGE_LEN;
    const lift = CFG.BRIDGE_LIFT;
    const half = CFG.W / 2;
    const spanStart = CFG.BRIDGE_RAMP;
    const spanEnd = L - CFG.BRIDGE_RAMP;
    const ground = half; // screen y of the ground line (a flat track's lower edge)
    const deckBottom = -lift + half; // screen y of the underside of the raised deck

    // soft shadow on the ground beneath the raised span.
    g.appendChild(
      el("rect", { x: spanStart - 6, y: ground - 6, width: spanEnd - spanStart + 12, height: 14, rx: 7, fill: "rgba(0,0,0,0.18)" })
    );

    // a trestle of two legs, plus a footing slab, at each end of the span.
    [spanStart, spanEnd].forEach((px) => {
      [-18, 18].forEach((dx) => {
        g.appendChild(el("rect", { x: px + dx - 6, y: deckBottom, width: 12, height: ground - deckBottom, rx: 3, fill: "#7b8696", stroke: "#5b6472", "stroke-width": 2 }));
      });
      g.appendChild(el("rect", { x: px - 28, y: ground - 4, width: 56, height: 10, rx: 4, fill: "#5b6472" }));
    });
  }

  // A cheerful little platform with a red roof on the +y side of the track.
  function addStation(g, def) {
    const len = def.samples()[def.samples().length - 1].x;
    const y0 = CFG.W / 2 + 4;
    const x0 = 10;
    const x1 = len - 10;
    g.appendChild(el("rect", { x: x0, y: y0, width: x1 - x0, height: 40, rx: 6, fill: "#f4c542", stroke: "#d9a92f", "stroke-width": 2 }));
    // supports
    [x0 + 8, x1 - 8].forEach((px) => g.appendChild(el("rect", { x: px - 3, y: y0 + 6, width: 6, height: 30, fill: "#cf4a40" })));
    // roof
    g.appendChild(el("rect", { x: x0 - 6, y: y0 + 36, width: x1 - x0 + 12, height: 14, rx: 5, fill: "#e2574c", stroke: "#c3463c", "stroke-width": 2 }));
  }

  // ---- world / view --------------------------------------------------------

  const svg = document.getElementById("board");
  const world = document.getElementById("world");
  const layerPieces = document.getElementById("layer-pieces");
  const layerConnectors = document.getElementById("layer-connectors");
  const layerGhost = document.getElementById("layer-ghost");
  const emptyHint = document.getElementById("empty-hint");

  function applyView() {
    world.setAttribute("transform", "translate(" + view.x + " " + view.y + ") scale(" + view.scale + ")");
  }

  function render() {
    layerPieces.textContent = "";
    layerConnectors.textContent = "";
    layerGhost.textContent = "";

    // Draw bridges last so their raised deck sits visually on top of any track
    // that crosses underneath the open middle span.
    const ordered = pieces
      .slice()
      .sort((a, b) => (PIECES[a.type].bridge ? 1 : 0) - (PIECES[b.type].bridge ? 1 : 0));
    ordered.forEach((p) => {
      const g = buildPieceVisual(PIECES[p.type]);
      g.setAttribute("transform", "translate(" + p.t.x + " " + p.t.y + ") rotate(" + deg(p.t.rot) + ")");
      g.setAttribute("class", "piece" + (selectedPiece === p.pid ? " piece--selected" : ""));
      g.style.cursor = "pointer";
      g.addEventListener("pointerdown", (e) => e.stopPropagation());
      g.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedPiece = selectedPiece === p.pid ? null : p.pid;
        render();
      });
      layerPieces.appendChild(g);
    });

    // ghost preview of the next piece at the chosen connector.
    const open = openConnectors();
    const target = pieces.length === 0 ? { x: 0, y: 0, ang: 0 } : open.find((c) => c.key === selectedKey);
    if (target && activeType) {
      const ghost = buildPieceVisual(PIECES[activeType]);
      ghost.setAttribute("transform", "translate(" + target.x + " " + target.y + ") rotate(" + deg(target.ang) + ")");
      ghost.setAttribute("class", "ghost");
      layerGhost.appendChild(ghost);
    }

    // open connector handles.
    open.forEach((c) => {
      const isSel = c.key === selectedKey;
      const dot = el("g", { class: "connector" + (isSel ? " connector--selected" : ""), transform: "translate(" + c.x + " " + c.y + ")" });
      dot.appendChild(el("circle", { r: 13, class: "connector__hit" }));
      dot.appendChild(el("circle", { r: 9, class: "connector__ring" }));
      if (isSel) dot.appendChild(el("circle", { r: 4.5, class: "connector__core" }));
      dot.addEventListener("pointerdown", (e) => e.stopPropagation());
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedKey = c.key;
        selectedPiece = null;
        render();
      });
      layerConnectors.appendChild(dot);
    });

    emptyHint.style.display = pieces.length ? "none" : "block";
    document.getElementById("count").textContent = pieces.length + (pieces.length === 1 ? " piece" : " pieces");
    updatePaletteActive();
  }

  // ---- fit / zoom ----------------------------------------------------------

  function bounds() {
    if (!pieces.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pieces.forEach((p) => {
      const dense = PIECES[p.type].bridge ? bridgeDense() : densify(PIECES[p.type].samples(), 12);
      dense.forEach((d) => {
        [CFG.W / 2 + 50, -CFG.W / 2].forEach((off) => {
          const o = offset(d, off);
          const a = tp(p.t, o.x, o.y);
          minX = Math.min(minX, a.x); minY = Math.min(minY, a.y);
          maxX = Math.max(maxX, a.x); maxY = Math.max(maxY, a.y);
        });
      });
    });
    return { minX, minY, maxX, maxY };
  }

  function fit() {
    const b = bounds();
    const rect = svg.getBoundingClientRect();
    if (!b) {
      view = { x: rect.width / 2, y: rect.height / 2, scale: 1 };
      applyView();
      return;
    }
    const pad = 60;
    const w = b.maxX - b.minX || 1;
    const h = b.maxY - b.minY || 1;
    const scale = Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h, 2.5);
    view.scale = scale;
    view.x = rect.width / 2 - ((b.minX + b.maxX) / 2) * scale;
    view.y = rect.height / 2 - ((b.minY + b.maxY) / 2) * scale;
    applyView();
  }

  function zoomBy(factor, cx, cy) {
    const rect = svg.getBoundingClientRect();
    if (cx == null) { cx = rect.width / 2; cy = rect.height / 2; }
    const ns = Math.max(0.2, Math.min(4, view.scale * factor));
    view.x = cx - ((cx - view.x) * ns) / view.scale;
    view.y = cy - ((cy - view.y) * ns) / view.scale;
    view.scale = ns;
    applyView();
  }

  // ---- pan (pointer drag on empty background) ------------------------------

  let panning = null;
  svg.addEventListener("pointerdown", (e) => {
    panning = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!panning) return;
    const dx = e.clientX - panning.sx;
    const dy = e.clientY - panning.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) panning.moved = true;
    view.x = panning.vx + dx;
    view.y = panning.vy + dy;
    applyView();
  });
  svg.addEventListener("pointerup", (e) => {
    if (panning && !panning.moved) {
      // a clean click on empty space clears the piece selection.
      selectedPiece = null;
      render();
    }
    panning = null;
  });
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false }
  );

  // ---- palette -------------------------------------------------------------

  function makeIcon(def) {
    const dense = def.bridge ? bridgeDense() : densify(def.samples(), 7);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    dense.forEach((d) => {
      [CFG.W / 2 + (def.station ? 54 : 0), -CFG.W / 2].forEach((off) => {
        const o = offset(d, off);
        minX = Math.min(minX, o.x); minY = Math.min(minY, o.y);
        maxX = Math.max(maxX, o.x); maxY = Math.max(maxY, o.y);
      });
    });
    const pad = 10;
    const icon = el("svg", {
      viewBox: minX - pad + " " + (minY - pad) + " " + (maxX - minX + pad * 2) + " " + (maxY - minY + pad * 2),
      class: "piece-icon",
    });
    icon.appendChild(buildPieceVisual(def));
    return icon;
  }

  function buildPalette() {
    const wrap = document.getElementById("palette");
    Duplo.PIECE_ORDER.forEach((type, idx) => {
      const def = PIECES[type];
      const btn = document.createElement("button");
      btn.className = "palette-item";
      btn.dataset.type = type;
      btn.title = def.label + "  (key " + (idx + 1) + ")";
      const iconWrap = document.createElement("div");
      iconWrap.className = "palette-item__icon";
      iconWrap.appendChild(makeIcon(def));
      const label = document.createElement("div");
      label.className = "palette-item__label";
      label.innerHTML = "<span class='palette-item__key'>" + (idx + 1) + "</span>" + def.label;
      btn.appendChild(iconWrap);
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        activeType = type;
        placePiece(type);
      });
      wrap.appendChild(btn);
    });
  }

  function updatePaletteActive() {
    document.querySelectorAll(".palette-item").forEach((b) => {
      b.classList.toggle("palette-item--active", b.dataset.type === activeType);
    });
  }

  // ---- toolbar -------------------------------------------------------------

  let flashTimer = null;
  function flash(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("toast--show");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => t.classList.remove("toast--show"), 2600);
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ version: 1, pieces }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "duplo-track.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.pieces)) throw new Error("bad file");
        snapshot();
        pieces = data.pieces.map((p) => ({ pid: p.pid, type: p.type, t: p.t }));
        nextId = pieces.reduce((m, p) => Math.max(m, p.pid + 1), 1);
        selectedKey = null;
        selectedPiece = null;
        persist();
        render();
        fit();
      } catch (e) {
        flash("Couldn't read that track file.");
      }
    };
    reader.readAsText(file);
  }

  function bindToolbar() {
    document.getElementById("btn-undo").addEventListener("click", undo);
    document.getElementById("btn-clear").addEventListener("click", clearAll);
    document.getElementById("btn-fit").addEventListener("click", fit);
    document.getElementById("btn-zoom-in").addEventListener("click", () => zoomBy(1.2));
    document.getElementById("btn-zoom-out").addEventListener("click", () => zoomBy(1 / 1.2));
    document.getElementById("btn-delete").addEventListener("click", () => {
      if (selectedPiece != null) deletePiece(selectedPiece);
      else flash("Tap a piece to select it, then delete.");
    });
    document.getElementById("btn-export").addEventListener("click", exportJSON);
    const importInput = document.getElementById("import-input");
    document.getElementById("btn-import").addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", (e) => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = "";
    });
  }

  function bindKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      const k = e.key;
      if (k >= "1" && k <= String(Duplo.PIECE_ORDER.length)) {
        const type = Duplo.PIECE_ORDER[+k - 1];
        activeType = type;
        placePiece(type);
      } else if (k === "u" || (k === "z" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        undo();
      } else if (k === "Delete" || k === "Backspace") {
        if (selectedPiece != null) {
          e.preventDefault();
          deletePiece(selectedPiece);
        }
      } else if (k === "f") {
        fit();
      } else if (k === "Escape") {
        selectedPiece = null;
        render();
      }
    });
  }

  // ---- boot ----------------------------------------------------------------

  function load() {
    try {
      const raw = localStorage.getItem("duplo-track");
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved)) {
          pieces = saved;
          nextId = pieces.reduce((m, p) => Math.max(m, p.pid + 1), 1);
        }
      }
    } catch (e) {
      /* ignore corrupt storage */
    }
    const open = openConnectors();
    selectedKey = open.length ? open[open.length - 1].key : null;
  }

  buildPalette();
  bindToolbar();
  bindKeys();
  load();
  render();
  fit();
  window.addEventListener("resize", applyView);
})();
