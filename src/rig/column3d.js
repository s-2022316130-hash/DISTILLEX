/* ════════════════════════════════════════════════════════════════════════
   The fractionating column, as a machine rather than as a diagram.

   The landing page used to draw its column in CSS: stacked slats under a
   perspective transform. It read as a drawing of a column. This builds the
   same vessel as real geometry — a skirt on a foundation, a lagged shell with
   a broken-out section through the middle of it, torispherical heads, sieve
   trays with alternating downcomers and outlet weirs, nozzles with raised-face
   flanges, platforms with gratings and handrails, a caged ladder, and the two
   circuits that make a column a column: condenser, reflux drum and reflux
   return above, reboiler and bottoms below.

   The section is LOCAL. A cut that runs the full height turns the vessel into
   a glass tube and the eye stops believing there is any steel there at all;
   cutting a window through the middle third leaves a lagged pressure vessel
   with its internals shown, which is what a section view is for.

   It is plant-shaped on purpose. The object this returns has exactly the
   shape RIGGL.create() consumes — objects[], streams[], bounds — so the
   renderer, the lighting rig, the theme system and the flow tracers are the
   ones already in the repository. There is no second renderer.

   Dimensions are in metres and are the proportions a column of this height
   actually has. They are the geometry of the drawing, not a claim about any
   separation: nothing here is an operating condition, and no number from it
   reaches the results.
   ════════════════════════════════════════════════════════════════════════ */
var COL3D = (function () {
  'use strict';
  var M = GLM;

  var D = {
    R: 2.25, H: 21.0, skirtH: 4.2,
    condX: 8.2, condY: 30.0, condR: 1.15, condL: 7.0,
    drumX: 8.2, drumY: 24.0, drumR: 1.40, drumL: 6.0,
    rebX: -7.6, rebY: 3.2, rebR: 1.55, rebL: 6.4
  };

  /* Where the section window faces. cylArc keeps its arc centred on local +X,
     so the missing wedge is centred on local −X; yawTRS maps a local angle a
     to world a − yaw, putting the gap at world angle (π − yaw). A camera at
     azimuth φ looks from (sin φ, cos φ), so the gap faces it when
     π − yaw = π/2 − φ, i.e. yaw = π/2 + φ. The hero camera starts at HOME_YAW
     and sweeps, so the cut opens, turns past and closes again — which is what
     a section view does when you turn the part over. */
  var HOME_YAW = -0.58;
  var CUT_YAW = Math.PI / 2 + HOME_YAW;

  function build(opts) {
    opts = opts || {};
    var lite = !!opts.lite;
    var MAT = PLANT.MAT;
    var objs = [], streams = [];
    var STREAM = THEME.get().streamLin;

    function add(mesh, mat, mtx, pick, tint, tintKey) {
      objs.push({ mesh: mesh, mat: mat, m: mtx, pick: pick || '',
                  tintKey: tintKey || (tint ? tintOf(tint) : null),
                  col: tint || mat.col });
    }
    function tintOf(tint) {
      for (var k in STREAM) if (STREAM.hasOwnProperty(k) && STREAM[k] === tint) return k;
      return null;
    }
    function cylBetween(a, b, r, mat, pick, tint, capped) {
      var d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
      if (Math.hypot(d[0], d[1], d[2]) < 1e-6) return;
      add(capped ? 'cylCap' : 'cyl', mat, M.alignY(M.m4(), a, d, r), pick, tint);
    }
    /** A pipe run from a polyline: a straight leg per segment and a sphere of
     *  the pipe radius at every corner, which is an exact joint at any angle.
     *  Naming it registers the same polyline as a tracer stream, so a particle
     *  cannot travel outside the pipe it belongs to. */
    function pipeRun(pts, r, tint, pick, key) {
      var i;
      for (i = 0; i < pts.length - 1; i++)
        cylBetween(pts[i], pts[i+1], r, MAT.shell, pick, tint, false);
      for (i = 1; i < pts.length - 1; i++)
        add('sphere', MAT.shell, M.trs(M.m4(), pts[i][0], pts[i][1], pts[i][2], r, r, r), pick, tint);
      if (key) streams.push({ key: key, pts: pts, r: r, col: tint, tintKey: tintOf(tint) });
      return pts;
    }
    /** Stand a swept mesh upright on the Y axis.
     *
     *  cylinder(), cone() and cylArc() are wound to suit alignY(), whose basis
     *  is left-handed; placing one of them with a plain positive-scale trs()
     *  therefore presents its BACK faces to the camera, and back-face culling
     *  makes the vessel see-through. Negating one horizontal scale restores
     *  the handedness without changing the silhouette, because all three
     *  meshes are symmetric about the plane that is being mirrored.
     */
    function upright(mesh, mat, x, y, z, r, h, pick, tint) {
      add(mesh, mat, M.trs(M.m4(), x, y, z, r, h, -r), pick, tint);
    }

    function flange(p, dir, r) {
      add('cylCap', MAT.struct,
          M.alignY(M.m4(), [p[0]-dir[0]*0.13, p[1]-dir[1]*0.13, p[2]-dir[2]*0.13],
                   [dir[0]*0.26, dir[1]*0.26, dir[2]*0.26], r * 1.8), '', MAT.struct.col);
    }
    /** A nozzle off the shell: a stub with a flange on the end. Returns the
     *  flange face, so the pipe that leaves it starts exactly there. */
    function nozzle(y, angle, len, r, pick, tint) {
      var c = Math.cos(angle), s = Math.sin(angle);
      var a = [D.R * c, y, D.R * s], b = [(D.R + len) * c, y, (D.R + len) * s];
      cylBetween(a, b, r, MAT.shell, pick, tint || MAT.shell.col, false);
      flange(b, [c, 0, s], r);
      return b;
    }
    /** A horizontal drum lying along Z: shell, both 2:1 heads, and the pair of
     *  saddles it sits on. What carries the saddles is the caller's problem —
     *  a drum thirty metres up sits on steel, not on a thirty-metre plinth. */
    function drum(x, y, z, r, len, mat, pick) {
      cylBetween([x, y, z - len/2], [x, y, z + len/2], r, mat, pick, mat.col, false);
      add('dish', mat, M.alignY(M.m4(), [x, y, z - len/2], [0, 0, -r], r), pick);
      add('dish', mat, M.alignY(M.m4(), [x, y, z + len/2], [0, 0,  r], r), pick);
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        var sz = z + s2 * len * 0.30;
        add('box', MAT.struct, M.trs(M.m4(), x, y - r - 0.30, sz, r * 1.35, 0.7, 0.42), pick);
      }
      return { top: y + r, bot: y - r - 0.65 };
    }
    /** A braced steel frame carrying something overhead: four legs on a square
     *  footprint, cross-bracing on the two faces that read, and a grating deck
     *  at the top. Equipment in the air needs structure under it or the whole
     *  model stops being believable. */
    function frame(x, z, w, d, yTop, pick) {
      var i, j, lx, lz;
      for (i = -1; i <= 1; i += 2) for (j = -1; j <= 1; j += 2) {
        lx = x + i * w / 2; lz = z + j * d / 2;
        add('box', MAT.struct, M.trs(M.m4(), lx, yTop / 2, lz, 0.32, yTop, 0.32), pick);
      }
      var tiers = Math.max(2, Math.round(yTop / 6));
      for (i = 1; i <= tiers; i++) {
        var ty = yTop * i / tiers;
        // ring beam
        for (j = -1; j <= 1; j += 2) {
          cylBetween([x - w/2, ty, z + j*d/2], [x + w/2, ty, z + j*d/2], 0.13, MAT.struct, pick);
          cylBetween([x + j*w/2, ty, z - d/2], [x + j*w/2, ty, z + d/2], 0.13, MAT.struct, pick);
        }
        // one diagonal per face per tier, alternating hand
        var yb = yTop * (i - 1) / tiers, sg = (i % 2) ? 1 : -1;
        for (j = -1; j <= 1; j += 2)
          cylBetween([x - sg*w/2, yb, z + j*d/2], [x + sg*w/2, ty, z + j*d/2], 0.10, MAT.struct, pick);
      }
      add('box', MAT.grate, M.trs(M.m4(), x, yTop + 0.06, z, w + 1.1, 0.12, d + 1.1), pick);
      var posts = lite ? 10 : 16;
      for (i = 0; i < posts; i++) {
        var t = i / posts, px, pz;
        if (t < 0.5) { px = x - (w+1.1)/2 + (w+1.1) * (t * 2); pz = z + (d+1.1)/2; }
        else { px = x + (w+1.1)/2 - (w+1.1) * ((t - 0.5) * 2); pz = z - (d+1.1)/2; }
        add('rod', MAT.rail, M.trs(M.m4(), px, yTop + 0.12, pz, 0.04, 1.02, -0.04), pick);
      }
      return yTop + 0.12;
    }

    var skirtTop = D.skirtH, top = D.skirtH + D.H;

    /* ── ground, foundation and skirt ─────────────────────────────────── */
    // A paved apron under the whole unit. Without it the assembly floats, and
    // the renderer's ground-contact term has nothing to darken against.
    add('box', MAT.deck, M.trs(M.m4(), 0, -0.06, 0, 30, 0.12, 20), '');
    add('annulus', MAT.concrete, M.trs(M.m4(), 0, 0.02, 0, D.R * 2.3, 1, D.R * 2.3), 'skirt');
    upright('cylCap', MAT.concrete, 0, 0, 0, D.R * 1.95, 0.6, 'skirt');
    // The skirt tapers from 1 to 0.94, so it is scaled to land on the shell
    // radius at the TOP: a skirt wider than the vessel leaves an open annulus
    // under the bottom head, and the eye reads that gap as a hole.
    upright('skirt', MAT.fire, 0, 0.55, 0, D.R / 0.94, D.skirtH - 0.55, 'skirt');
    for (var ab = 0; ab < 14; ab++) {
      var aa = ab / 14 * Math.PI * 2;
      add('box', MAT.struct, M.yawTRS(M.m4(), Math.cos(aa) * D.R * 1.06, 0.92,
          Math.sin(aa) * D.R * 1.06, -aa, 0.40, 0.74, 0.17), 'skirt');
    }
    add('ringThin', MAT.struct, M.trs(M.m4(), 0, D.skirtH - 0.12, 0, D.R * 1.02, 1, D.R * 1.02), 'skirt');

    /* ── the shell, with a broken-out section through the middle ──────── */
    var courses = lite ? 7 : 10;
    var cutA = Math.round(courses * 0.30), cutB = Math.round(courses * 0.74);
    for (var c2 = 0; c2 < courses; c2++) {
      var y0 = skirtTop + D.H * (c2 / courses), hh = D.H / courses;
      var mat = c2 % 2 ? MAT.insul : MAT.shell;
      if (c2 >= cutA && c2 < cutB) {
        add('cylArc', mat, M.yawTRS(M.m4(), 0, y0, 0, CUT_YAW, D.R, hh, -D.R), 'shell');
      } else {
        upright('cyl', mat, 0, y0, 0, D.R, hh, 'shell');
      }
      add('ringThin', MAT.struct,
          M.trs(M.m4(), 0, y0 + hh, 0, D.R * 1.04, 1, D.R * 1.04), 'shell');
    }
    add('dish', MAT.head, M.trs(M.m4(), 0, top, 0, D.R, D.R, D.R), 'head');
    add('dish', MAT.head, M.trs(M.m4(), 0, skirtTop, 0, D.R, -D.R, -D.R), 'sump');
    var cutLo = skirtTop + D.H * (cutA / courses), cutHi = skirtTop + D.H * (cutB / courses);
    // the two cut planes, in bright machined steel. A section view says where
    // the material was taken away; without them the window reads as a defect
    // in the lagging rather than as a drawing convention.
    add('ringThin', MAT.head, M.trs(M.m4(), 0, cutLo, 0, D.R, 1, D.R), 'shell');
    add('ringThin', MAT.head, M.trs(M.m4(), 0, cutHi, 0, D.R, 1, D.R), 'shell');

    /* ── trays: the internals the window exists to show ───────────────── */
    // Sieve trays on a fixed spacing, downcomers alternating side to side,
    // each with the outlet weir the liquid flows over. Alternating the
    // downcomer is not decoration: it is why the liquid crosses the tray.
    // The decks are given real thickness — a zero-thickness plate seen close
    // to edge-on disappears, and a column whose trays vanish is a tube.
    var nTray = lite ? 13 : 19;
    var trayLo = skirtTop + 2.4, trayHi = top - 2.8, trays = [];
    var pitch = (trayHi - trayLo) / (nTray - 1);
    for (var t = 0; t < nTray; t++) {
      var ty = trayLo + pitch * t, side = (t % 2) ? 1 : -1;
      trays.push(ty);
      var inWin = ty > cutLo - 0.4 && ty < cutHi + 0.4;
      // the deck itself
      upright('cylCap', MAT.grate, 0, ty, 0, D.R * 0.95, 0.10, 'trays');
      add('ringThin', MAT.struct, M.trs(M.m4(), 0, ty, 0, D.R * 0.99, 1, D.R * 0.99), 'trays');
      if (!inWin) continue;                 // the rest is only ever seen in the cut
      // downcomer apron, hanging from this deck to just above the next
      add('box', MAT.struct,
          M.trs(M.m4(), side * D.R * 0.56, ty - pitch * 0.45, 0, 0.07, pitch * 0.88, D.R * 1.30), 'trays');
      // outlet weir on the opposite side, a low strip standing on the deck
      add('box', MAT.struct,
          M.trs(M.m4(), -side * D.R * 0.60, ty + 0.16, 0, 0.06, 0.30, D.R * 1.24), 'trays');
      // the perforated area, suggested by two rows of holes across the deck
      if (!lite) for (var ph = -2; ph <= 2; ph++)
        add('disc', MAT.struct, M.trs(M.m4(), -side * D.R * 0.16, ty + 0.055,
            ph * D.R * 0.26, D.R * 0.10, 1, D.R * 0.10), 'trays');
    }
    var feedTray = trays[Math.floor(nTray * 0.45)];

    /* ── platforms, handrails, caged ladder ───────────────────────────── */
    var platY = lite ? [skirtTop + 7.5, top - 1.5] : [skirtTop + 5.2, skirtTop + 11.6, top - 1.5];
    for (var p2 = 0; p2 < platY.length; p2++) {
      var py = platY[p2], pr = D.R + 1.5;
      add('annulus', MAT.grate, M.trs(M.m4(), 0, py, 0, pr, 1, pr), 'platform');
      var posts2 = lite ? 12 : 18;
      for (var q = 0; q < posts2; q++) {
        var an = q / posts2 * Math.PI * 2;
        upright('rod', MAT.rail, Math.cos(an) * pr, py, Math.sin(an) * pr, 0.045, 1.05, 'platform');
      }
      add('ringThin', MAT.rail, M.trs(M.m4(), 0, py + 1.02, 0, pr, 1, pr), 'platform');
      add('ringThin', MAT.rail, M.trs(M.m4(), 0, py + 0.54, 0, pr, 1, pr), 'platform');
      for (q = 0; q < 8; q++) {
        var a3 = q / 8 * Math.PI * 2;
        cylBetween([Math.cos(a3) * D.R, py - 1.2, Math.sin(a3) * D.R],
                   [Math.cos(a3) * pr, py, Math.sin(a3) * pr], 0.055, MAT.struct, 'platform');
      }
    }
    var ladZ = -(D.R + 0.58);
    for (var ly = skirtTop + 0.4; ly < top - 1.5; ly += 0.42)
      add('rod', MAT.rail, M.alignY(M.m4(), [-0.32, ly, ladZ], [0.64, 0, 0], 0.04), 'ladder');
    cylBetween([-0.32, skirtTop, ladZ], [-0.32, top - 1.5, ladZ], 0.055, MAT.rail, 'ladder');
    cylBetween([ 0.32, skirtTop, ladZ], [ 0.32, top - 1.5, ladZ], 0.055, MAT.rail, 'ladder');
    for (ly = skirtTop + 2.2; ly < top - 2.0; ly += 1.5)
      add('ringThin', MAT.rail, M.trs(M.m4(), 0, ly, ladZ - 0.28, 0.54, 1, 0.54), 'ladder');

    /* ── nozzles ──────────────────────────────────────────────────────── */
    var nFeed = nozzle(feedTray, Math.PI * 0.28, 1.4, 0.30, 'feed', STREAM.crude);
    var nRefl = nozzle(top - 1.1, 0.06, 1.2, 0.24, 'reflux', STREAM.reflux);
    var nBtms = nozzle(skirtTop + 0.8, Math.PI * 1.16, 1.3, 0.26, 'bottoms', STREAM.residue);
    var nRebO = nozzle(skirtTop + 0.3, Math.PI * 0.88, 1.2, 0.30, 'reboiler', STREAM.residue);
    var nRebR = nozzle(skirtTop + 2.2, Math.PI * 0.94, 1.2, 0.30, 'reboiler', STREAM.hot);
    // the overhead leaves the head, not the shell
    var nOvhd = [0, top + D.R * 0.50, 0];
    add('cylCap', MAT.shell, M.alignY(M.m4(), nOvhd, [0, 0.8, 0], 0.32), 'overhead', STREAM.vapour);
    flange([0, nOvhd[1] + 0.8, 0], [0, 1, 0], 0.32);
    for (var iq = 0; iq < (lite ? 4 : 7); iq++)
      nozzle(skirtTop + 1.8 + iq * (D.H - 3.6) / (lite ? 4 : 7), Math.PI * 1.60, 0.5, 0.10, 'instrument');

    /* ── overhead circuit, on its own structure ───────────────────────── */
    frame(D.condX, 0, 4.4, 4.0, D.drumY - D.drumR - 0.95, 'structure');
    drum(D.drumX, D.drumY, 0, D.drumR, D.drumL, MAT.tank, 'drum');
    // the condenser sits above the drum on short legs off the same frame
    for (var cl = -1; cl <= 1; cl += 2)
      cylBetween([D.condX - 1.3, D.drumY + D.drumR, cl * D.condL * 0.30],
                 [D.condX - 1.3, D.condY - D.condR - 0.3, cl * D.condL * 0.30], 0.16, MAT.struct, 'structure');
    for (cl = -1; cl <= 1; cl += 2)
      cylBetween([D.condX + 1.3, D.drumY + D.drumR, cl * D.condL * 0.30],
                 [D.condX + 1.3, D.condY - D.condR - 0.3, cl * D.condL * 0.30], 0.16, MAT.struct, 'structure');
    drum(D.condX, D.condY, 0, D.condR, D.condL, MAT.shell, 'condenser');
    // a channel head at one end and tube-sheet bands along it: an exchanger,
    // not a third drum
    add('cylCap', MAT.struct, M.alignY(M.m4(), [D.condX, D.condY, D.condL/2 + 0.05],
        [0, 0, 0.5], D.condR * 1.20), 'condenser');
    for (var cw = 1; cw < (lite ? 4 : 6); cw++)
      add('ringThin', MAT.struct, M.trs(M.m4(), D.condX, D.condY,
          -D.condL/2 + cw * D.condL / (lite ? 4 : 6), D.condR * 1.07, 1, D.condR * 1.07), 'condenser');
    // cooling water in and out of the channel end
    pipeRun([[D.condX + D.condR * 0.7, D.condY - 0.4, D.condL/2 + 0.6],
             [D.condX + D.condR * 0.7 + 2.2, D.condY - 0.4, D.condL/2 + 0.6]],
            0.16, STREAM.steam, 'condenser', 'cw');

    pipeRun([nOvhd, [0, top + 3.4, 0], [0, D.condY, 0], [D.condX - D.condR - 0.15, D.condY, 0]],
            0.30, STREAM.vapour, 'overhead', 'ovhd');
    pipeRun([[D.condX, D.condY - D.condR - 0.05, 0], [D.condX, D.drumY + D.drumR + 0.05, 0]],
            0.24, STREAM.reflux, 'condensate', 'cond');
    pipeRun([[D.drumX - D.drumR - 0.05, D.drumY, 0], [D.drumX - 3.2, D.drumY, 0],
             [D.drumX - 3.2, nRefl[1], 0], [nRefl[0], nRefl[1], nRefl[2]]],
            0.22, STREAM.reflux, 'reflux', 'reflux');
    pipeRun([[D.drumX, D.drumY, D.drumL/2 + 0.15], [D.drumX, D.drumY, D.drumL/2 + 2.2],
             [D.drumX + 3.4, D.drumY, D.drumL/2 + 2.2]],
            0.20, STREAM.naphtha, 'distillate', 'dist');

    /* ── bottoms circuit ──────────────────────────────────────────────── */
    add('box', MAT.concrete, M.trs(M.m4(), D.rebX, (D.rebY - D.rebR - 0.65) / 2, 0,
        D.rebR * 2.1, D.rebY - D.rebR - 0.65, D.rebL * 0.8), 'reboiler');
    drum(D.rebX, D.rebY, 0, D.rebR, D.rebL, MAT.shell, 'reboiler');
    add('cylCap', MAT.struct, M.alignY(M.m4(), [D.rebX, D.rebY, D.rebL/2 + 0.05],
        [0, 0, 0.45], D.rebR * 1.18), 'reboiler');
    // the steam chest and its condensate leg
    add('cylCap', MAT.insul, M.alignY(M.m4(), [D.rebX, D.rebY - D.rebR * 0.5, -D.rebL/2 - 0.8],
        [0, 0, 1.2], D.rebR * 0.48), 'reboiler', STREAM.steam);
    pipeRun([[D.rebX, D.rebY - D.rebR * 0.5, -D.rebL/2 - 3.2],
             [D.rebX, D.rebY - D.rebR * 0.5, -D.rebL/2 - 0.8]],
            0.18, STREAM.steam, 'reboiler', 'steam');
    pipeRun([nRebO, [D.rebX + D.rebR + 1.1, nRebO[1], 0],
             [D.rebX + D.rebR + 1.1, D.rebY - D.rebR - 0.5, 0], [D.rebX, D.rebY - D.rebR - 0.5, 0]],
            0.26, STREAM.residue, 'reboiler', 'rebdown');
    pipeRun([[D.rebX, D.rebY + D.rebR + 0.05, 0], [D.rebX + D.rebR + 2.3, D.rebY + D.rebR + 0.05, 0],
             [D.rebX + D.rebR + 2.3, nRebR[1], 0], [nRebR[0], nRebR[1], nRebR[2]]],
            0.28, STREAM.hot, 'reboiler', 'rebup');
    pipeRun([nBtms, [nBtms[0] - 1.4, nBtms[1], nBtms[2]],
             [nBtms[0] - 1.4, 1.0, nBtms[2]], [nBtms[0] - 1.4, 1.0, nBtms[2] + 5.0]],
            0.22, STREAM.residue, 'bottoms', 'btms');

    /* ── feed ─────────────────────────────────────────────────────────── */
    pipeRun([[nFeed[0] + 4.6, 1.1, nFeed[2] + 4.6], [nFeed[0] + 4.6, nFeed[1], nFeed[2] + 4.6],
             [nFeed[0] + 4.6, nFeed[1], nFeed[2]], nFeed],
            0.26, STREAM.crude, 'feed', 'feed');

    /* ── the traffic inside the column ────────────────────────────────── */
    // Vapour up and liquid down, on the sides the downcomers actually put
    // them. Both are tracer paths only: they carry no geometry, and the depth
    // buffer means they are visible through the section window and hidden by
    // the shell everywhere else — which is exactly right.
    var upPts = [], dnPts = [];
    for (var v = 0; v < trays.length; v++) {
      var vy = trays[v], sd = (v % 2) ? 1 : -1;
      upPts.push([-sd * D.R * 0.28, vy - 0.30, 0]);
      upPts.push([-sd * D.R * 0.28, vy + 0.30, 0]);
      dnPts.push([sd * D.R * 0.58, vy + 0.10, 0]);
      dnPts.push([sd * D.R * 0.58, vy - pitch * 0.82, 0]);
    }
    upPts.unshift([0, skirtTop + 0.9, 0]);
    upPts.push([0, top + 0.5, 0]);
    dnPts.reverse();
    dnPts.unshift([0, top - 1.2, 0]);
    dnPts.push([0, skirtTop + 0.5, 0]);
    streams.push({ key: 'vup', pts: upPts, r: 0.15, col: STREAM.vapour, tintKey: 'vapour' });
    streams.push({ key: 'ldn', pts: dnPts, r: 0.12, col: STREAM.reflux, tintKey: 'reflux' });

    return {
      objects: objs, streams: streams, anchors: {}, D: D, MAT: MAT, STREAM: STREAM,
      instruments: [],
      bounds: { min: [D.rebX - 4, 0, -9], max: [D.condX + 5, D.condY + 3, 9] },
      shellTop: top, skirtTop: skirtTop, feedY: feedTray, trays: trays,
      cut: { lo: cutLo, hi: cutHi },
      // where the camera sits to frame the whole assembly
      home: { yaw: HOME_YAW, pitch: 0.10, dist: 58, target: [0.8, 15.4, 0] }
    };
  }

  return { build: build, HOME_YAW: HOME_YAW };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = COL3D;
