/* ════════════════════════════════════════════════════════════════════════
   The equipment kit.

   A refinery is not a pile of primitives; it is a small number of machines
   repeated. A pump is a plinth, a baseplate, a volute, a coupling guard and a
   motor, every time. An exchanger is a shell, a channel head, two tubesheets
   and a pair of saddles, every time. A vessel is a skirt, a shell in courses,
   two heads, banding, a platform and a caged ladder, every time.

   So they are written once here, and the plant is composed from them. Three
   things follow: a new item takes one line instead of forty, every item of a
   kind looks like every other, and the winding rule below is enforced in one
   place rather than remembered at ninety call sites.

   ── the winding rule ──────────────────────────────────────────────────
   cylinder(), cone() and cylArc() in geometry.js are wound to suit alignY(),
   whose basis is left-handed. Placing one of them with a plain positive-scale
   trs() therefore presents its BACK faces, and back-face culling makes the
   thing see-through. Negating one horizontal scale restores the handedness
   without moving a vertex, because all three meshes are symmetric about the
   plane being mirrored. `up()` does that; nothing else in a plant should call
   trs() with a swept mesh.
   ════════════════════════════════════════════════════════════════════════ */
var KIT = (function () {
  'use strict';
  var M = GLM;

  /** Bind the kit to one plant's emitter.
   *  `add(mesh, mat, mtx, pick, tint, tintKey)` is the plant's own. */
  function make(add, MAT, tier) {
    var K = {};
    /* The access steel is where the object count lives: handrail posts,
       ladder rungs, stair treads. Half of each is emitted into a higher
       detail tier, so a small screen gets a handrail at half the post
       spacing — which is invisible at the distance it is drawn from — rather
       than losing the handrail or the sharpness of the whole picture. */
    var TIER = tier || function () {};
    function fine(n, base) { TIER(n ? 2 : base || 0); }

    /* ── primitives ──────────────────────────────────────────────────── */

    /** Stand a swept mesh upright. See the winding rule above. */
    K.up = function (mesh, mat, x, y, z, r, h, pick, tint) {
      add(mesh, mat, M.trs(M.m4(), x, y, z, r, h, -r), pick, tint);
    };
    /** A swept mesh from a to b. alignY is already correctly wound. */
    K.tube = function (a, b, r, mat, pick, tint, capped) {
      var d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
      if (Math.hypot(d[0], d[1], d[2]) < 1e-6) return;
      add(capped ? 'cylCap' : 'cyl', mat, M.alignY(M.m4(), a, d, r), pick, tint);
    };
    /** A 2:1 head. `dir` is +1 for one bulging up (or along +axis), -1 down.
     *  A mirror flips winding, so the mirrored case negates Z as well. */
    K.headY = function (x, y, z, r, dir, mat, pick) {
      add('dish', mat, dir >= 0 ? M.trs(M.m4(), x, y, z, r, r, r)
                                : M.trs(M.m4(), x, y, z, r, -r, -r), pick);
    };
    K.headAxis = function (p, dir, r, mat, pick) {
      add('dish', mat, M.alignY(M.m4(), p, [dir[0]*r, dir[1]*r, dir[2]*r], r), pick);
    };
    /** A concrete plinth. Nothing on a unit stands on the paving. */
    K.pad = function (x, z, w, d, pick) {
      add('box', MAT.concrete, M.trs(M.m4(), x, 0.22, z, w, 0.44, d), pick || '');
    };
    /** A raised-face flange: the collar that says a nozzle is a nozzle. */
    K.flange = function (p, dir, r, pick) {
      add('cylCap', MAT.struct,
          M.alignY(M.m4(), [p[0]-dir[0]*0.14, p[1]-dir[1]*0.14, p[2]-dir[2]*0.14],
                   [dir[0]*0.28, dir[1]*0.28, dir[2]*0.28], r * 1.75), pick || '', MAT.struct.col);
    };

    /* ── access steel ────────────────────────────────────────────────── */

    /** A circular platform with toe plate, two rails and its brackets. */
    K.platform = function (x, y, z, r, pick, inner) {
      var i, a;
      add('annulus', MAT.grate, M.trs(M.m4(), x, y, z, r, 1, r), pick);
      var n = Math.max(8, Math.round(r * 4));
      for (i = 0; i < n; i++) {
        a = i / n * Math.PI * 2;
        fine(i % 2);
        K.up('rod', MAT.rail, x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0.045, 1.08, pick);
      }
      fine(0);
      add('ringThin', MAT.rail, M.trs(M.m4(), x, y + 1.05, z, r, 1, r), pick);
      add('ringThin', MAT.rail, M.trs(M.m4(), x, y + 0.55, z, r, 1, r), pick);
      if (inner > 0) for (i = 0; i < 8; i++) {
        a = i / 8 * Math.PI * 2;
        K.tube([x + Math.cos(a) * inner, y - 1.3, z + Math.sin(a) * inner],
               [x + Math.cos(a) * r, y, z + Math.sin(a) * r], 0.06, MAT.struct, pick);
      }
    };

    /** A caged ladder up a face, with its hoops. */
    K.ladder = function (x, z, y0, y1, dir, pick) {
      var w = 0.34, i;
      var px = dir[0] * 0.0, pz = dir[2] * 0.0;
      // stringers
      K.tube([x - dir[2]*w, y0, z + dir[0]*w], [x - dir[2]*w, y1, z + dir[0]*w], 0.055, MAT.rail, pick);
      K.tube([x + dir[2]*w, y0, z - dir[0]*w], [x + dir[2]*w, y1, z - dir[0]*w], 0.055, MAT.rail, pick);
      var rung = 0;
      for (i = y0 + 0.3; i < y1; i += 0.42) {
        fine((rung++) % 2);
        K.tube([x - dir[2]*w, i, z + dir[0]*w], [x + dir[2]*w, i, z - dir[0]*w], 0.04, MAT.rail, pick);
      }
      fine(0);
      for (i = y0 + 2.2; i < y1 - 1.2; i += 1.5)
        add('ringThin', MAT.rail, M.trs(M.m4(), x + dir[0]*0.3, i, z + dir[2]*0.3, 0.58, 1, 0.58), pick);
    };

    /** A straight run of stair: treads, two stringers and a handrail. */
    K.stair = function (a, b, width, pick) {
      var dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2];
      var n = Math.max(3, Math.round(dy / 0.22));
      var nx = -dz, nz = dx, nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      for (var i = 0; i < n; i++) {
        var t = (i + 0.5) / n;
        add('box', MAT.grate, M.trs(M.m4(), a[0] + dx*t, a[1] + dy*t, a[2] + dz*t,
            Math.abs(nx) * width + 0.28, 0.08, Math.abs(nz) * width + 0.28), pick);
      }
      for (var s = -1; s <= 1; s += 2) {
        var o = [nx * width/2 * s, 0, nz * width/2 * s];
        K.tube([a[0]+o[0], a[1]-0.12, a[2]+o[2]], [b[0]+o[0], b[1]-0.12, b[2]+o[2]], 0.08, MAT.struct, pick);
        K.tube([a[0]+o[0], a[1]+1.0,  a[2]+o[2]], [b[0]+o[0], b[1]+1.0,  b[2]+o[2]], 0.05, MAT.rail, pick);
        K.tube([a[0]+o[0], a[1]+0.52, a[2]+o[2]], [b[0]+o[0], b[1]+0.52, b[2]+o[2]], 0.05, MAT.rail, pick);
      }
    };

    /** A braced four-post frame: legs on pads, a ring beam and one diagonal
     *  per face per tier, alternating hand. Optional grating deck on top. */
    K.frame = function (o) {
      var x = o.x, z = o.z, w = o.w, d = o.d, top = o.top, pick = o.pick || '';
      var i, j, ty, yb, sg;
      for (i = -1; i <= 1; i += 2) for (j = -1; j <= 1; j += 2) {
        add('box', MAT.struct, M.trs(M.m4(), x + i*w/2, top/2, z + j*d/2, 0.34, top, 0.34), pick);
        K.pad(x + i*w/2, z + j*d/2, 1.4, 1.4, pick);
      }
      var tiers = Math.max(2, Math.round(top / 6));
      for (i = 1; i <= tiers; i++) {
        ty = top * i / tiers; yb = top * (i - 1) / tiers; sg = (i % 2) ? 1 : -1;
        for (j = -1; j <= 1; j += 2) {
          K.tube([x - w/2, ty, z + j*d/2], [x + w/2, ty, z + j*d/2], 0.13, MAT.struct, pick);
          K.tube([x + j*w/2, ty, z - d/2], [x + j*w/2, ty, z + d/2], 0.13, MAT.struct, pick);
          K.tube([x - sg*w/2, yb, z + j*d/2], [x + sg*w/2, ty, z + j*d/2], 0.10, MAT.struct, pick);
          K.tube([x + j*w/2, yb, z - sg*d/2], [x + j*w/2, ty, z + sg*d/2], 0.10, MAT.struct, pick);
        }
      }
      if (o.deck) add('box', MAT.grate, M.trs(M.m4(), x, top + 0.07, z, w + 1.0, 0.14, d + 1.0), pick);
      return top + 0.14;
    };

    /* ── vessels ─────────────────────────────────────────────────────── */

    /** A horizontal drum or exchanger lying along an axis.
     *  o: {x,y,z,r,len,axis:'x'|'z',mat,pick,tint,boot,bundle,channel,saddles} */
    K.drum = function (o) {
      var ax = o.axis === 'x' ? [1,0,0] : [0,0,1];
      var h = [ax[0]*o.len/2, 0, ax[2]*o.len/2];
      var a = [o.x - h[0], o.y, o.z - h[2]], b = [o.x + h[0], o.y, o.z + h[2]];
      var mat = o.mat || MAT.shell, i;
      K.tube(a, b, o.r, mat, o.pick, o.tint, false);
      K.headAxis(a, [-ax[0], 0, -ax[2]], o.r, o.headMat || MAT.head, o.pick);
      K.headAxis(b, [ ax[0], 0,  ax[2]], o.r, o.headMat || MAT.head, o.pick);
      // tubesheet bands and a channel head make a drum read as an exchanger
      if (o.bundle) for (i = 1; i < o.bundle; i++) {
        var t = i / o.bundle;
        add('ringThin', MAT.struct, M.trs(M.m4(), a[0] + (b[0]-a[0])*t, o.y, a[2] + (b[2]-a[2])*t,
            o.r * 1.06, 1, o.r * 1.06), o.pick);
      }
      if (o.channel) {
        K.tube(b, [b[0] + ax[0]*0.55, o.y, b[2] + ax[2]*0.55], o.r * 1.16, MAT.struct, o.pick, null, true);
      }
      // saddles, and the plinths under them
      if (o.saddles !== false) for (i = -1; i <= 1; i += 2) {
        var sx = o.x + ax[0]*o.len*0.3, sz = o.z + ax[2]*o.len*0.3;
        sx = o.x + ax[0]*o.len*0.3*i; sz = o.z + ax[2]*o.len*0.3*i;
        add('box', MAT.struct, M.trs(M.m4(), sx, o.y - o.r - 0.32, sz,
            ax[0] ? 0.5 : o.r*1.5, 0.75, ax[0] ? o.r*1.5 : 0.5), o.pick);
        if (o.stand > 0) {
          add('box', MAT.concrete, M.trs(M.m4(), sx, (o.y - o.r - 0.7) / 2, sz,
              ax[0] ? 0.7 : o.r*1.6, o.y - o.r - 0.7, ax[0] ? o.r*1.6 : 0.7), o.pick);
        }
      }
      // the water boot every overhead receiver has
      if (o.boot) {
        K.up('cylCap', mat, o.x - ax[0]*o.len*0.22, o.y - o.r - o.boot, o.z - ax[2]*o.len*0.22,
             o.r * 0.38, o.boot + 0.3, o.pick);
        K.headY(o.x - ax[0]*o.len*0.22, o.y - o.r - o.boot, o.z - ax[2]*o.len*0.22,
                o.r * 0.38, -1, o.headMat || MAT.head, o.pick);
      }
      return { a: a, b: b, top: o.y + o.r, bot: o.y - o.r };
    };

    /** A centrifugal pump: plinth, baseplate, volute with its suction and
     *  discharge flanges, a coupling guard and a motor. Every rundown on a
     *  unit has one, and a unit without them looks like a model. */
    K.pump = function (o) {
      var x = o.x, z = o.z, yaw = o.yaw || 0, pick = o.pick || '';
      var c = Math.cos(yaw), s = Math.sin(yaw);
      var at = function (u, v, y) { return [x + c*u - s*v, y, z + s*u + c*v]; };
      add('box', MAT.concrete, M.trs(M.m4(), x, 0.28, z, 3.4, 0.56, 1.7), pick);
      add('box', MAT.struct, M.yawTRS(M.m4(), x, 0.66, z, -yaw, 3.0, 0.2, 1.3), pick);
      // volute and its shaft end
      var p0 = at(-0.9, 0, 1.05);
      add('sphere', MAT.shell, M.trs(M.m4(), p0[0], p0[1], p0[2], 0.52, 0.46, 0.52), pick, o.tint);
      K.tube(at(-0.9, 0, 0.62), at(-0.9, 0, 1.30), 0.30, MAT.struct, pick, o.tint, true);
      // suction down, discharge up
      K.tube(at(-1.45, 0, 1.05), at(-1.45, 0, 0.25), 0.22, MAT.shell, pick, o.tint, false);
      K.flange(at(-1.45, 0, 0.25), [0,-1,0], 0.22, pick);
      K.tube(at(-0.9, 0, 1.52), at(-0.9, 0, 2.15), 0.20, MAT.shell, pick, o.tint, false);
      K.flange(at(-0.9, 0, 2.15), [0, 1, 0], 0.20, pick);
      // coupling guard, then the motor
      add('box', MAT.rail, M.yawTRS(M.m4(), at(-0.25, 0, 1.0)[0], 1.0, at(-0.25, 0, 1.0)[2],
          -yaw, 0.62, 0.5, 0.42), pick);
      var m0 = at(0.35, 0, 1.0), m1 = at(1.45, 0, 1.0);
      K.tube(m0, m1, 0.42, MAT.struct, pick, null, true);
      for (var f = 0; f < 5; f++) {
        var t = 0.14 + f * 0.18, mp = at(0.35 + 1.1*t, 0, 1.0);
        add('ringThin', MAT.struct, M.trs(M.m4(), mp[0], 1.0, mp[2], 0.47, 1, 0.47), pick);
      }
      // terminal box on top
      add('box', MAT.struct, M.yawTRS(M.m4(), at(0.9, 0, 1.0)[0], 1.44, at(0.9, 0, 1.0)[2],
          -yaw, 0.5, 0.34, 0.4), pick);
      return { suction: at(-1.45, 0, 0.25), discharge: at(-0.9, 0, 2.15) };
    };

    /** An air-cooler bay: the tube bundle between two headers, a plenum, the
     *  fans under it and the walkway beside it. */
    K.finFan = function (o) {
      var x = o.x, y = o.y, z = o.z, w = o.w, d = o.d, pick = o.pick || '';
      var i, n = o.tubes || 9;
      add('box', MAT.struct, M.trs(M.m4(), x, y, z, w, 0.5, d), pick);           // bottom header
      for (i = 0; i < n; i++)
        K.tube([x - w*0.46, y + 0.75, z - d*0.42 + i * d*0.84/(n-1)],
               [x + w*0.46, y + 0.75, z - d*0.42 + i * d*0.84/(n-1)], 0.2, MAT.shell, pick, o.tint);
      add('box', MAT.struct, M.trs(M.m4(), x, y + 1.35, z, w, 0.4, d), pick);    // top header
      // the plenum skirt under the bundle, and a fan in each cell
      var cells = o.fans || 2;
      for (i = 0; i < cells; i++) {
        var fx = x - w*0.5 + w*(i + 0.5)/cells;
        add('cone', MAT.struct, M.trs(M.m4(), fx, y - 2.8, z, w/cells*0.42, 2.8, -w/cells*0.42), pick);
        K.up('cylCap', MAT.struct, fx, y - 3.1, z, 0.34, 0.5, pick);
        for (var bl = 0; bl < 4; bl++)
          add('box', MAT.grate, M.yawTRS(M.m4(), fx, y - 2.9, z, bl * Math.PI / 4,
              w/cells*0.78, 0.08, 0.5), pick);
      }
      return { top: y + 1.55 };
    };

    /* ── the plant around the plant ──────────────────────────────────── */

    /** A storage tank, of the kind the product it holds actually needs.
     *
     *  roof: 'float'  external floating roof — the deck sits on the liquid and
     *                 there is no vapour space at all. What volatile stock
     *                 (crude, naphtha) is kept in.
     *        'ifr'    fixed roof with an internal floater and a vent ring —
     *                 medium flash point: kerosene, jet.
     *        'cone'   plain fixed cone roof — diesel, gas oil, anything whose
     *                 flash point is high enough not to need a deck.
     *  lagged: cladding and banding, for a stock that has to be kept warm.
     *  heated: the steam coil header and its lines, which residue needs or it
     *          will not pump.
     */
    K.tank = function (o) {
      var x = o.x, z = o.z, r = o.r, h = o.h, pick = o.pick || '';
      var roof = o.roof || 'cone', i;
      K.up('cyl', o.lagged ? MAT.insul : MAT.tank, x, 0, z, r, h, pick);
      // shell courses: a tank is rolled in plate, and the rings read as scale
      for (i = 1; i < 4; i++)
        add('ringThin', MAT.struct, M.trs(M.m4(), x, h * i / 4, z, r * 1.015, 1, r * 1.015), pick);
      if (roof === 'float') {
        // the deck, part way down, and the wind girder round the open top
        add('disc', MAT.struct, M.trs(M.m4(), x, h * (o.level || 0.62), z, r * 0.97, 1, r * 0.97), pick);
        add('ringThin', MAT.rail, M.trs(M.m4(), x, h + 0.1, z, r * 1.05, 1, r * 1.05), pick);
        add('ringThin', MAT.struct, M.trs(M.m4(), x, h - 0.5, z, r * 1.06, 1, r * 1.06), pick);
      } else {
        add('dish', o.lagged ? MAT.insul : MAT.tank, M.trs(M.m4(), x, h, z, r, r * 0.17, r), pick);
        // the centre vent, and on an internal-floater tank the ring of shell
        // vents that tells it apart from a plain cone roof
        K.up('cylCap', MAT.struct, x, h + r * 0.15, z, 0.26, 0.9, pick);
        if (roof === 'ifr') for (i = 0; i < 8; i++) {
          var va = i / 8 * Math.PI * 2;
          K.up('rodCap', MAT.struct, x + Math.cos(va) * r * 0.82, h + r * 0.09,
               z + Math.sin(va) * r * 0.82, 0.16, 0.5, pick);
        }
      }
      if (o.lagged) for (i = 0; i < 6; i++)
        add('ringThin', MAT.struct, M.trs(M.m4(), x, h * (i + 0.5) / 6, z, r * 1.03, 1, r * 1.03), pick);
      // the steam coil header a heated tank is fed through
      if (o.heated) {
        K.tube([x - r - 2.6, 1.0, z], [x - r * 0.2, 1.0, z], 0.16, MAT.shell, pick, o.steam);
        K.up('cylCap', MAT.shell, x - r * 0.2, 1.0, z, 0.2, 1.6, pick, o.steam);
      }
      // the stair that winds up the shell, and the platform it lands on
      var turns = 1.1, steps = Math.max(8, Math.round(h * (o.steps || 1.3)));
      for (i = 0; i < steps; i++) {
        var t = i / steps, a = t * turns * Math.PI * 2;
        fine(i % 2, 1);
        add('box', MAT.grate, M.yawTRS(M.m4(), x + Math.cos(a) * (r + 0.6), h * t + 0.4,
            z + Math.sin(a) * (r + 0.6), -a, 1.2, 0.08, 0.5), pick);
        K.up('rod', MAT.rail, x + Math.cos(a) * (r + 1.15), h * t + 0.4,
             z + Math.sin(a) * (r + 1.15), 0.045, 1.0, pick);
      }
      fine(0, 1);
      // the filling nozzle at the base, which is where the rundown lands
      var na = o.fillAngle == null ? Math.PI : o.fillAngle;
      var np = [x + Math.cos(na) * (r + 0.6), 1.3, z + Math.sin(na) * (r + 0.6)];
      K.tube([x + Math.cos(na) * r, 1.3, z + Math.sin(na) * r], np, 0.22, MAT.shell, pick, o.tint);
      K.flange(np, [Math.cos(na), 0, Math.sin(na)], 0.22, pick);
      // the bund wall
      if (o.bund) {
        K.up('cyl', MAT.concrete, x, 0, z, r * (o.bundR || 1.6), 1.1, pick);
        add('ringThin', MAT.concrete, M.trs(M.m4(), x, 1.1, z, r * (o.bundR || 1.6), 1, r * (o.bundR || 1.6)), pick);
      }
      return { top: h, fill: np };
    };

    /** A Horton sphere: the pressure vessel LPG is kept in, on its ring of
     *  legs with the cross bracing between them and the crown platform on top.
     *  Nothing else on a refinery looks remotely like one. */
    K.sphere = function (o) {
      var x = o.x, z = o.z, r = o.r, pick = o.pick || '';
      var cy = o.y == null ? r + 3.4 : o.y, legs = o.legs || 8, i, a, a2;
      add('sphere', o.mat || MAT.tank, M.trs(M.m4(), x, cy, z, r, r, r), pick);
      add('ringThin', MAT.struct, M.trs(M.m4(), x, cy, z, r * 1.005, 1, r * 1.005), pick);
      for (i = 0; i < legs; i++) {
        a = i / legs * Math.PI * 2;
        var lx = x + Math.cos(a) * r * 0.80, lz = z + Math.sin(a) * r * 0.80;
        K.tube([lx, 0, lz], [x + Math.cos(a) * r * 0.70, cy, z + Math.sin(a) * r * 0.70],
               0.22, MAT.struct, pick);
        K.pad(lx, lz, 1.5, 1.5, pick);
        // one cross brace to the next leg
        a2 = (i + 1) / legs * Math.PI * 2;
        K.tube([lx, cy * 0.55, lz],
               [x + Math.cos(a2) * r * 0.78, cy * 0.22, z + Math.sin(a2) * r * 0.78],
               0.10, MAT.struct, pick);
      }
      K.platform(x, cy + r * 0.92, z, r * 0.42, pick, 0);
      K.tube([x, cy + r, z], [x, cy + r * 0.92, z], 0.22, MAT.shell, pick, o.tint);
      return { top: cy + r };
    };

    /** A flare: the derrick that carries it, the riser, the tip, and the
     *  flame. The one thing on a refinery skyline you can see from a town. */
    K.flare = function (o) {
      var x = o.x, z = o.z, h = o.h, pick = o.pick || '';
      var leg = 2.4, i, j, ty, yb, sg;
      for (i = -1; i <= 1; i += 2) for (j = -1; j <= 1; j += 2) {
        K.tube([x + i*leg, 0, z + j*leg], [x + i*leg*0.28, h*0.86, z + j*leg*0.28], 0.22, MAT.struct, pick);
        K.pad(x + i*leg, z + j*leg, 1.8, 1.8, pick);
      }
      var tiers = 9;
      for (i = 1; i <= tiers; i++) {
        ty = h*0.86 * i / tiers; yb = h*0.86 * (i-1) / tiers; sg = (i % 2) ? 1 : -1;
        var rt = leg * (1 - 0.72 * i / tiers), rb = leg * (1 - 0.72 * (i-1) / tiers);
        for (j = -1; j <= 1; j += 2) {
          K.tube([x - rt, ty, z + j*rt], [x + rt, ty, z + j*rt], 0.09, MAT.struct, pick);
          K.tube([x + j*rt, ty, z - rt], [x + j*rt, ty, z + rt], 0.09, MAT.struct, pick);
          K.tube([x - sg*rb, yb, z + j*rb], [x + sg*rt, ty, z + j*rt], 0.07, MAT.struct, pick);
        }
      }
      K.up('cyl', MAT.stack, x, 0, z, 0.62, h, pick);
      K.up('cylCap', MAT.fire, x, h, z, 0.86, 2.2, pick);
      add('cone', MAT.fire, M.trs(M.m4(), x, h + 2.2, z, 0.86, 1.0, -0.86), pick);
      return { tip: [x, h + 2.4, z] };
    };

    /** A building: walls, a banded roof, a door and a run of windows. Control
     *  rooms and substations are what tell you people work here. */
    K.building = function (o) {
      var x = o.x, z = o.z, w = o.w, d = o.d, h = o.h, pick = o.pick || '';
      add('box', MAT.concrete, M.trs(M.m4(), x, 0.3, z, w + 1.2, 0.6, d + 1.2), pick);
      add('box', MAT.tank, M.trs(M.m4(), x, h/2 + 0.6, z, w, h, d), pick);
      add('box', MAT.struct, M.trs(M.m4(), x, h + 0.75, z, w + 0.5, 0.3, d + 0.5), pick);
      // a window band along the long face
      for (var i = 0; i < Math.max(2, Math.round(w / 2.2)); i++) {
        var wx = x - w*0.5 + w * (i + 0.5) / Math.max(2, Math.round(w / 2.2));
        add('box', MAT.struct, M.trs(M.m4(), wx, h*0.62, z + d*0.505, w*0.13, h*0.3, 0.12), pick);
      }
      add('box', MAT.struct, M.trs(M.m4(), x + w*0.34, 1.6, z + d*0.505, 1.1, 2.2, 0.14), pick);
      // rooftop plant
      add('box', MAT.struct, M.trs(M.m4(), x - w*0.25, h + 1.4, z, 2.2, 1.1, 1.8), pick);
      return { top: h + 0.9 };
    };

    /** An induced-draught cooling tower: a concrete basin, louvred cells and
     *  a fan stack over each. */
    K.coolTower = function (o) {
      var x = o.x, z = o.z, w = o.w, d = o.d, h = o.h, cells = o.cells || 3, pick = o.pick || '';
      add('box', MAT.concrete, M.trs(M.m4(), x, 0.5, z, w + 1.4, 1.0, d + 1.4), pick);
      for (var c = 0; c < cells; c++) {
        var cx = x - w*0.5 + w * (c + 0.5) / cells, cw = w / cells * 0.92;
        add('box', MAT.tank, M.trs(M.m4(), cx, h/2 + 1.0, z, cw, h, d), pick);
        // louvres down both long faces
        for (var l = 0; l < 5; l++)
          for (var sgn = -1; sgn <= 1; sgn += 2)
            add('box', MAT.struct, M.trs(M.m4(), cx, 1.6 + l * (h*0.42/5), z + sgn*d*0.505,
                cw*0.88, h*0.045, 0.14), pick);
        K.up('cyl', MAT.struct, cx, h + 1.0, z, cw*0.34, 1.9, pick);
        for (var bl = 0; bl < 4; bl++)
          add('box', MAT.grate, M.yawTRS(M.m4(), cx, h + 2.3, z, bl * Math.PI / 4,
              cw*0.6, 0.09, 0.42), pick);
      }
      return { top: h + 3.0 };
    };

    /** A lighting mast. Cheap, and it is what makes a night scene read as a
     *  place that is worked rather than a model on a table. */
    K.mast = function (x, z, h, pick) {
      K.up('cyl', MAT.struct, x, 0, z, 0.2, h, pick || '');
      K.pad(x, z, 1.4, 1.4, pick);
      add('box', MAT.struct, M.trs(M.m4(), x, h + 0.2, z, 2.6, 0.2, 0.9), pick || '');
      for (var i = -1; i <= 1; i += 2)
        add('box', MAT.instr, M.trs(M.m4(), x + i * 0.8, h + 0.02, z, 0.7, 0.24, 0.6), pick || '');
    };

    return K;
  }

  return { make: make };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = KIT;
