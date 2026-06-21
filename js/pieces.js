/*
 * pieces.js — Track piece definitions and shared geometry helpers.
 *
 * Every piece is described by a *centerline sampler*: a list of points along
 * the middle of the track, each with a position and a tangent direction (the
 * way a train travels at that point). Everything else — the track bed, the
 * rails, the sleepers and, crucially, the connectors — is derived from that
 * centerline. Adding a new piece is therefore just a matter of describing its
 * centerline.
 *
 * A piece is always authored in its own *local* frame, entering at the origin
 * travelling in the +x direction. When a piece is placed on the board it gets
 * an absolute transform (translate + rotate) that lines its entry connector up
 * with an open end of the existing layout.
 */
(function () {
  "use strict";

  const Duplo = (window.Duplo = window.Duplo || {});

  // All dimensions are in abstract "track units". They only need to be
  // self-consistent; the view can be zoomed freely. These roughly echo the
  // proportions of real LEGO DUPLO track.
  const CFG = {
    W: 64, // width of the track bed
    RAIL_GAP: 42, // distance between the two rails
    STRAIGHT_LEN: 100, // length of a straight piece
    STATION_LEN: 100, // length of a station piece (same footprint as straight)
    CURVE_RADIUS: 120, // centreline radius of a curve
    CURVE_ANGLE: Math.PI / 6, // 30° — twelve curves make a full circle
  };
  Duplo.CFG = CFG;

  // ---- centreline samplers -------------------------------------------------

  function straightSamples(len) {
    return [
      { x: 0, y: 0, dir: 0 },
      { x: len, y: 0, dir: 0 },
    ];
  }

  // sign: -1 turns to the viewer's left (toward -y / up on screen), +1 turns
  // right. SVG's y-axis points down, so "left" on screen is the -y direction.
  function curveSamples(radius, angle, sign) {
    const steps = 16;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = (angle * i) / steps;
      pts.push({
        x: radius * Math.sin(t),
        y: sign * radius * (1 - Math.cos(t)),
        dir: sign * t,
      });
    }
    return pts;
  }

  // ---- piece catalogue -----------------------------------------------------

  Duplo.PIECES = {
    straight: {
      id: "straight",
      label: "Straight",
      samples: () => straightSamples(CFG.STRAIGHT_LEN),
    },
    "curve-left": {
      id: "curve-left",
      label: "Curve Left",
      samples: () => curveSamples(CFG.CURVE_RADIUS, CFG.CURVE_ANGLE, -1),
    },
    "curve-right": {
      id: "curve-right",
      label: "Curve Right",
      samples: () => curveSamples(CFG.CURVE_RADIUS, CFG.CURVE_ANGLE, +1),
    },
    station: {
      id: "station",
      label: "Station",
      samples: () => straightSamples(CFG.STATION_LEN),
      station: true,
    },
  };

  // The order pieces appear in the palette.
  Duplo.PIECE_ORDER = ["straight", "curve-left", "curve-right", "station"];

  // ---- connectors ----------------------------------------------------------

  // A connector is { x, y, ang } where `ang` is the *open direction*: the way
  // the track would continue if something were attached here. For the entry
  // connector that points back the way the train came (start.dir + 180°); for
  // the exit connector it points forward (end.dir).
  Duplo.localConnectors = function (def) {
    const s = def.samples();
    const a = s[0];
    const b = s[s.length - 1];
    return [
      { x: a.x, y: a.y, ang: a.dir + Math.PI }, // 0: entry
      { x: b.x, y: b.y, ang: b.dir }, // 1: exit
    ];
  };
})();
