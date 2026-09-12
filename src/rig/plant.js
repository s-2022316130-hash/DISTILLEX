/* ════════════════════════════════════════════════════════════════════════
   The atmospheric crude unit, described once.

   Dimensions are in metres and are the proportions a unit of this duty
   actually has: a 4.2 m tower 48 m tall on a 6 m skirt, a fired heater the
   size of a house, an air-cooled condenser bank on a structure above the
   pipe rack, side strippers beside the tower. Getting the proportions right
   is most of what makes a stylised model read as engineering rather than as
   an assembly of primitives.

   Piping is defined as POLYLINES and turned into runs by pipeRun(), which
   emits a straight section for every leg and an elbow at every corner. Two
   consequences: nothing is ever left floating, and the flow tracers follow
   the same polyline the pipe was built from, so a particle cannot travel
   through a wall.

   Everything selectable carries a `pick` id, and those ids are the same
   strings the 2D flowsheet and the information panel use.
   ════════════════════════════════════════════════════════════════════════ */
var PLANT = (function () {
  'use strict';
  var M = GLM, G = GEO;

  /* ── dimensions ─────────────────────────────────────────────────────── */
  var D = {
    towerR: 2.1, towerH: 44, skirtH: 6, towerX: 0, towerZ: 0,
    furX: -21.5, furZ: 3, furW: 15, furH: 9.5, furD: 11, stackH: 20,
    condX: 22, condY: 47, condZ: -4, condW: 15, condD: 7,
    drumX: 23, drumY: 34, drumZ: 4, drumR: 1.7, drumL: 9,
    stripX: 11.5, stripR: 0.95, stripH: 11,
    rackX: 34, rackY: 7
  };

  /* ── materials ──────────────────────────────────────────────────────── */
  // col = base colour, rgh = roughness, mtl = metalness, emi = self-lit amount
  var MAT = {
    shell:    { col:[0.62,0.66,0.72], rgh:0.34, mtl:0.85, emi:0.0 },
    insul:    { col:[0.72,0.715,0.695], rgh:0.90, mtl:0.04, emi:0.0 },
    head:     { col:[0.58,0.62,0.69], rgh:0.30, mtl:0.9,  emi:0.0 },
    struct:   { col:[0.40,0.44,0.52], rgh:0.60, mtl:0.55, emi:0.0 },
    grate:    { col:[0.46,0.50,0.58], rgh:0.74, mtl:0.5,  emi:0.0 },
    rail:     { col:[0.82,0.62,0.16], rgh:0.55, mtl:0.35, emi:0.03 },
    concrete: { col:[0.175,0.180,0.196], rgh:0.98, mtl:0.0,  emi:0.0 },
    deck:     { col:[0.085,0.098,0.125], rgh:1.0, mtl:0.0, emi:0.0 },
    fire:     { col:[0.335,0.325,0.305], rgh:0.94, mtl:0.03, emi:0.0 },
    furnace:  { col:[0.255,0.238,0.222], rgh:0.94, mtl:0.06, emi:0.0 },
    stack:    { col:[0.325,0.318,0.308], rgh:0.80, mtl:0.22, emi:0.0 },
    instr:    { col:[0.85,0.88,0.93], rgh:0.40, mtl:0.5,  emi:0.10 }
  };

  /* ── stream colours: what a line carries, not what it is made of ────── */
  var STREAM = {
    crude:   [0.72,0.42,0.16],
    hot:     [0.95,0.44,0.14],
    vapour:  [0.28,0.82,0.95],
    reflux:  [0.42,0.86,0.82],
    gas:     [0.55,0.92,0.98],
    naphtha: [0.72,0.90,0.28],
    kerosene:[0.98,0.82,0.22],
    diesel:  [0.98,0.62,0.20],
    gasoil:  [0.95,0.44,0.22],
    residue: [0.90,0.36,0.48],
    steam:   [0.72,0.80,0.92]
  };

  // Where the cutaway wedge points. The camera's home azimuth looks along
  // −Z and +X, so the missing quarter faces that way and the internals are
  // on show without having to turn the unit first.
  var CUTAWAY_YAW = 0.62;

  function build() {
    var objs = [], streams = [], anchors = {}, m;

    function add(mesh, mat, mtx, pick, tint) {
      objs.push({ mesh: mesh, mat: mat, m: mtx, pick: pick || '',
                  col: tint || mat.col });
    }
    function cylBetween(a, b, r, mat, pick, tint, capped) {
      var d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
      if (Math.hypot(d[0],d[1],d[2]) < 1e-6) return;
      add(capped ? 'cylCap' : 'cyl', mat, M.alignY(M.m4(), a, d, r), pick, tint);
    }

    /** A pipe run from a polyline: a straight section per leg, and a sphere at
     *  every interior corner standing in for the elbow. Using a sphere of the
     *  pipe radius makes the joint exact for any turn angle, which an elbow
     *  mesh only is at ninety degrees. */
    function pipeRun(pts, r, tint, pick, key) {
      for (var i = 0; i < pts.length - 1; i++)
        cylBetween(pts[i], pts[i+1], r, MAT.shell, pick, tint, false);
      for (i = 1; i < pts.length - 1; i++)
        add('sphere', MAT.shell, M.trs(M.m4(), pts[i][0], pts[i][1], pts[i][2], r, r, r), pick, tint);
      if (key) streams.push({ key: key, pts: pts, r: r, col: tint });
      return pts;
    }
    /** A raised-face flange: the collar that says a nozzle is a nozzle. */
    function flange(p, dir, r) {
      add('cylCap', MAT.struct,
          M.alignY(M.m4(), [p[0]-dir[0]*0.16, p[1]-dir[1]*0.16, p[2]-dir[2]*0.16],
                   [dir[0]*0.32, dir[1]*0.32, dir[2]*0.32], r * 1.7), '', MAT.struct.col);
    }
    /** A nozzle: a short stub off the shell with a flange on the end. */
    function nozzle(y, angle, len, r, pick, tint) {
      var c = Math.cos(angle), s = Math.sin(angle);
      var a = [D.towerR * c, y, D.towerR * s];
      var b = [(D.towerR + len) * c, y, (D.towerR + len) * s];
      cylBetween(a, b, r, MAT.shell, pick, tint || MAT.shell.col, false);
      flange(b, [c, 0, s], r);
      return b;
    }

    /* ── the tower ────────────────────────────────────────────────────── */
    var skirtTop = D.skirtH, shellTop = D.skirtH + D.towerH;
    add('cone', MAT.fire, M.trs(M.m4(), 0, 0, 0, D.towerR * 1.14, D.skirtH, D.towerR * 1.14),
        'reboiler');
    add('annulus', MAT.concrete, M.trs(M.m4(), 0, 0.25, 0, D.towerR * 1.9, 1, D.towerR * 1.9), 'reboiler');
    // the shell, in insulated bands so it does not read as one extruded tube
    var bands = 7;
    for (var b2 = 0; b2 < bands; b2++) {
      var y0 = skirtTop + D.towerH * (b2 / bands), h = D.towerH / bands;
      // A wedge is cut out of the shell so the trays inside are visible. The
      // cut faces the camera's home position; turning the unit shows the
      // internals from one side and the lagged shell from the other, which is
      // how a cutaway drawing works.
      add('cylArc', b2 % 2 ? MAT.insul : MAT.shell,
          M.yawTRS(M.m4(), 0, y0, 0, CUTAWAY_YAW, D.towerR, h, D.towerR), 'tower');
      // the banding strap between courses — a narrow ring, not a flange
      add('ringThin', MAT.struct,
          M.trs(M.m4(), 0, y0 + h, 0, D.towerR * 1.03, 1, D.towerR * 1.03), 'tower');
    }
    add('dish', MAT.head, M.trs(M.m4(), 0, shellTop, 0, D.towerR, D.towerR, D.towerR), 'tower');
    add('dish', MAT.head, M.trs(M.m4(), 0, skirtTop, 0, D.towerR, -D.towerR, D.towerR), 'reboiler');

    anchors.towerTop = [0, shellTop + 1.2, 0];
    anchors.towerMid = [0, skirtTop + D.towerH * 0.55, 0];
    anchors.flash    = [0, skirtTop + D.towerH * 0.20, 0];
    anchors.sump     = [0, skirtTop - 0.5, 0];

    /* ── trays: the internals, visible through the cutaway band ───────── */
    var trayLo = skirtTop + 3, trayHi = shellTop - 3, nTray = 26;
    var trays = [];
    for (var t = 0; t < nTray; t++) {
      var ty = trayLo + (trayHi - trayLo) * (t / (nTray - 1));
      trays.push(ty);
      // a tray is a plate, so it is nearly a full disc; the downcomer is the
      // chord taken out of one side
      add('disc', MAT.grate,
          M.trs(M.m4(), 0, ty, 0, D.towerR * 0.94, 1, D.towerR * 0.94), 'trays');
      add('box', MAT.struct,
          M.trs(M.m4(), D.towerR * 0.52, ty - 0.5, 0, 0.1, 1.0, D.towerR * 0.72), 'trays');
    }
    anchors.trays = trays;

    /* ── platforms, handrails and the caged ladder ────────────────────── */
    var platY = [skirtTop + 8, skirtTop + 19, skirtTop + 30, shellTop - 1];
    for (var p2 = 0; p2 < platY.length; p2++) {
      var py = platY[p2], pr = D.towerR + 1.9;
      add('annulus', MAT.grate, M.trs(M.m4(), 0, py, 0, pr, 1, pr), 'tower');
      // toe plate and two rails, as posts round the rim
      for (var q = 0; q < 22; q++) {
        var ang = q / 22 * Math.PI * 2;
        var px = Math.cos(ang) * pr, pz = Math.sin(ang) * pr;
        add('cyl', MAT.rail, M.trs(M.m4(), px, py, pz, 0.05, 1.1, 0.05), 'tower');
      }
      add('ringThin', MAT.rail, M.trs(M.m4(), 0, py + 1.05, 0, pr, 1, pr), 'tower');
      add('ringThin', MAT.rail, M.trs(M.m4(), 0, py + 0.55, 0, pr, 1, pr), 'tower');
      // the bracket under the platform
      for (q = 0; q < 8; q++) {
        var a3 = q / 8 * Math.PI * 2;
        cylBetween([Math.cos(a3)*D.towerR, py - 1.4, Math.sin(a3)*D.towerR],
                   [Math.cos(a3)*pr, py, Math.sin(a3)*pr], 0.06, MAT.struct, 'tower');
      }
    }
    // caged ladder up the north face
    var ladX = 0, ladZ = -(D.towerR + 0.75);
    for (var ly = skirtTop; ly < shellTop - 1; ly += 0.42)
      add('cyl', MAT.rail, M.trs(M.m4(), ladX, ly, ladZ, 0.38, 0.045, 0.045), 'tower');
    cylBetween([ladX-0.38, skirtTop, ladZ], [ladX-0.38, shellTop-1, ladZ], 0.06, MAT.rail, 'tower');
    cylBetween([ladX+0.38, skirtTop, ladZ], [ladX+0.38, shellTop-1, ladZ], 0.06, MAT.rail, 'tower');
    for (ly = skirtTop + 2; ly < shellTop - 2; ly += 1.6)
      add('ringThin', MAT.rail, M.trs(M.m4(), ladX, ly, ladZ - 0.35, 0.62, 1, 0.62), 'tower');

    /* ── the fired heater ─────────────────────────────────────────────── */
    var fy = D.furH / 2;
    // radiant firebox, on a plinth, with a bridgewall and a convection
    // section above it — a heater reads as a heater or it reads as a crate
    add('box', MAT.concrete, M.trs(M.m4(), D.furX, 0.5, D.furZ, D.furW*1.1, 1.0, D.furD*1.1), 'furnace');
    add('box', MAT.furnace, M.trs(M.m4(), D.furX, fy + 0.6, D.furZ, D.furW, D.furH, D.furD), 'furnace');
    // corner columns, so the box has structure rather than being a slab
    for (var cc = 0; cc < 4; cc++)
      add('box', MAT.struct, M.trs(M.m4(),
          D.furX + (cc < 2 ? -1 : 1) * D.furW*0.5, fy + 0.6, D.furZ + (cc % 2 ? -1 : 1) * D.furD*0.5,
          0.45, D.furH, 0.45), 'furnace');
    // convection section: a narrower box on top carrying the tube bank
    var cvH = 4.2, cvY = D.furH + 1.1 + cvH/2;
    add('box', MAT.furnace, M.trs(M.m4(), D.furX + D.furW*0.16, cvY, D.furZ,
        D.furW*0.56, cvH, D.furD*0.82), 'furnace');
    for (var tb = 0; tb < 6; tb++)
      add('cyl', MAT.shell, M.alignY(M.m4(),
          [D.furX + D.furW*0.16 - D.furW*0.24, D.furH + 1.6 + tb*0.62, D.furZ - D.furD*0.38],
          [0, 0, D.furD*0.76], 0.16), 'furnace');
    add('cylCap', MAT.stack, M.trs(M.m4(), D.furX + D.furW*0.34, cvY + cvH/2, D.furZ,
        1.15, D.stackH, 1.15), 'furnace');
    add('cone', MAT.stack, M.trs(M.m4(), D.furX + D.furW*0.34, cvY + cvH/2 + D.stackH, D.furZ,
        1.15, 1.1, 1.15), 'furnace');
    add('ringThin', MAT.struct, M.trs(M.m4(), D.furX + D.furW*0.34, cvY + cvH/2 + D.stackH*0.55,
        D.furZ, 1.34, 1, 1.34), 'furnace');
    // burner row along the base and an access door
    for (var bq = 0; bq < 5; bq++) {
      var bx = D.furX - D.furW*0.34 + bq * D.furW*0.17;
      add('cylCap', MAT.struct, M.alignY(M.m4(), [bx, 2.0, D.furZ + D.furD*0.5],
          [0, 0, 0.7], 0.34), 'furnace');
      add('ringThin', MAT.struct, M.alignY(M.m4(), [bx, 2.0, D.furZ + D.furD*0.5 + 0.7],
          [0, 0, 0.12], 0.52), 'furnace');
    }
    add('box', MAT.struct, M.trs(M.m4(), D.furX - D.furW*0.26, 3.2, D.furZ + D.furD*0.51,
        1.6, 3.0, 0.14), 'furnace');
    // the stair up the side
    for (var sp3 = 0; sp3 < 12; sp3++)
      add('box', MAT.rail, M.trs(M.m4(), D.furX - D.furW*0.54 - 1.0, 1.4 + sp3*0.78,
          D.furZ - D.furD*0.3 + sp3*0.42, 1.5, 0.09, 0.5), 'furnace');
    anchors.furnace = [D.furX, D.furH + 8, D.furZ];
    anchors.firebox = [D.furX, D.furH * 0.42, D.furZ + D.furD * 0.5];

    /* ── side strippers ───────────────────────────────────────────────── */
    var sideKeys = ['kerosene', 'diesel', 'gasoil'];
    var sideY = [skirtTop + 30, skirtTop + 21, skirtTop + 13];
    anchors.side = {};
    for (var sI = 0; sI < 3; sI++) {
      var sx = D.stripX, sz = -5 + sI * 5;
      var sy = sideY[sI] - D.stripH - 2;
      add('cyl', MAT.insul, M.trs(M.m4(), sx, sy, sz, D.stripR, D.stripH, D.stripR), 'sidedraw');
      add('dish', MAT.head, M.trs(M.m4(), sx, sy + D.stripH, sz, D.stripR, D.stripR, D.stripR), 'sidedraw');
      add('dish', MAT.head, M.trs(M.m4(), sx, sy, sz, D.stripR, -D.stripR, D.stripR), 'sidedraw');
      add('cone', MAT.struct, M.trs(M.m4(), sx, 0, sz, D.stripR*0.9, sy, D.stripR*0.55), 'sidedraw');
      anchors.side[sideKeys[sI]] = [sx, sy + D.stripH + 1, sz];
      // draw line from the tower to the stripper, and the product away
      var noz = nozzle(sideY[sI], Math.atan2(sz, sx), 1.3, 0.22, 'sidedraw', STREAM[sideKeys[sI]]);
      pipeRun([noz, [sx, sideY[sI], sz], [sx, sy + D.stripH + 0.8, sz]],
              0.22, STREAM[sideKeys[sI]], 'sidedraw');
      pipeRun([[sx, sy + 0.4, sz], [sx, 3.4 + sI * 1.1, sz],
               [D.rackX, 3.4 + sI * 1.1, sz], [D.rackX + 8, 3.4 + sI * 1.1, sz]],
              0.24, STREAM[sideKeys[sI]], 'product-' + sideKeys[sI], sideKeys[sI]);
      // the stripping-steam line into the base of each stripper
      pipeRun([[sx + 4.5, 1.6, sz], [sx, 1.6, sz], [sx, sy + 0.2, sz]],
              0.1, STREAM.steam, 'sidedraw');
    }

    /* ── crude in, through the heater, to the flash zone ───────────────── */
    var feedY = skirtTop + D.towerH * 0.20;
    var crudeIn = [[-52, 2.2, D.furZ], [D.furX - D.furW*0.5 - 2, 2.2, D.furZ],
                   [D.furX - D.furW*0.5 - 2, 4.5, D.furZ], [D.furX - D.furW*0.4, 4.5, D.furZ]];
    pipeRun(crudeIn, 0.34, STREAM.crude, 'crude', 'crude');
    anchors.crude = [-46, 3.6, D.furZ];
    var transfer = [[D.furX + D.furW*0.42, D.furH*0.62, D.furZ],
                    [D.furX + D.furW*0.42 + 6, D.furH*0.62, D.furZ],
                    [-7.5, D.furH*0.62, 0], [-7.5, feedY, 0],
                    [-D.towerR - 1.2, feedY, 0]];
    pipeRun(transfer, 0.4, STREAM.hot, 'feed', 'feed');
    nozzle(feedY, Math.PI, 1.2, 0.4, 'feed', STREAM.hot);
    anchors.feed = [-6, feedY + 2, 0];

    /* ── overhead, condenser, reflux drum ─────────────────────────────── */
    var ovStart = [0, shellTop + D.towerR * 0.5, 0];
    var overhead = [ovStart, [0, D.condY + 6, 0], [D.condX - D.condW*0.5 - 2, D.condY + 6, D.condZ],
                    [D.condX - D.condW*0.5 - 2, D.condY + 1.4, D.condZ]];
    pipeRun(overhead, 0.42, STREAM.vapour, 'overhead', 'overhead');
    anchors.overhead = [0, D.condY + 7.5, 0];

    // air-cooled condenser: a bank of finned tubes on a structure, with fans
    add('box', MAT.struct, M.trs(M.m4(), D.condX, D.condY, D.condZ, D.condW, 0.5, D.condD), 'condenser');
    for (var ft = 0; ft < 9; ft++) {
      var fz = D.condZ - D.condD*0.42 + ft * D.condD*0.105;
      add('cyl', MAT.shell, M.alignY(M.m4(), [D.condX - D.condW*0.46, D.condY + 0.75, fz],
          [D.condW*0.92, 0, 0], 0.2), 'condenser');
    }
    add('box', MAT.struct, M.trs(M.m4(), D.condX, D.condY + 1.35, D.condZ, D.condW, 0.4, D.condD), 'condenser');
    for (var fn = 0; fn < 2; fn++) {
      var fx2 = D.condX - D.condW*0.24 + fn * D.condW*0.48;
      add('cyl', MAT.struct, M.trs(M.m4(), fx2, D.condY - 2.6, D.condZ, 2.3, 0.3, 2.3), 'condenser');
      for (var bl = 0; bl < 4; bl++)
        add('box', MAT.grate, M.yawTRS(M.m4(), fx2, D.condY - 2.4, D.condZ,
            bl * Math.PI / 4, 4.2, 0.08, 0.5), 'condenser');
    }
    for (var lg = 0; lg < 4; lg++) {
      var lx = D.condX + (lg<2?-1:1)*D.condW*0.42, lz = D.condZ + (lg%2?-1:1)*D.condD*0.38;
      add('box', MAT.struct, M.trs(M.m4(), lx, D.condY/2, lz, 0.5, D.condY, 0.5), 'condenser');
      // knee bracing, which is what makes a tall frame look designed
      for (var kb = 0; kb < 3; kb++) {
        var ky = 8 + kb * (D.condY - 12) / 2;
        cylBetween([lx, ky, lz], [D.condX + (lg<2?-1:1)*D.condW*0.18, ky + 7, lz],
                   0.13, MAT.struct, 'condenser');
      }
    }
    for (var hz = 0; hz < 3; hz++) {
      var hy = 12 + hz * (D.condY - 16) / 2;
      add('box', MAT.struct, M.trs(M.m4(), D.condX, hy, D.condZ - D.condD*0.38,
          D.condW*0.84, 0.34, 0.34), 'condenser');
      add('box', MAT.struct, M.trs(M.m4(), D.condX, hy, D.condZ + D.condD*0.38,
          D.condW*0.84, 0.34, 0.34), 'condenser');
    }
    anchors.condenser = [D.condX, D.condY + 3.2, D.condZ];

    pipeRun([[D.condX + D.condW*0.5 + 1, D.condY + 0.75, D.condZ],
             [D.condX + D.condW*0.5 + 3.5, D.condY + 0.75, D.condZ],
             [D.condX + D.condW*0.5 + 3.5, D.drumY + D.drumR + 1.4, D.drumZ],
             [D.drumX + D.drumL*0.3, D.drumY + D.drumR + 1.4, D.drumZ],
             [D.drumX + D.drumL*0.3, D.drumY + D.drumR, D.drumZ]],
            0.3, STREAM.reflux, 'condenser');

    // reflux drum: a horizontal vessel with dished ends and a water boot
    add('cyl', MAT.shell, M.alignY(M.m4(), [D.drumX - D.drumL*0.5, D.drumY, D.drumZ],
        [D.drumL, 0, 0], D.drumR), 'drum');
    add('dish', MAT.head, M.alignY(M.m4(), [D.drumX + D.drumL*0.5, D.drumY, D.drumZ],
        [D.drumR, 0, 0], D.drumR), 'drum');
    add('dish', MAT.head, M.alignY(M.m4(), [D.drumX - D.drumL*0.5, D.drumY, D.drumZ],
        [-D.drumR, 0, 0], D.drumR), 'drum');
    add('cylCap', MAT.shell, M.trs(M.m4(), D.drumX - 1.4, D.drumY - D.drumR - 1.1, D.drumZ,
        0.62, 1.2, 0.62), 'drum');
    for (var sd = 0; sd < 2; sd++)
      add('box', MAT.struct, M.trs(M.m4(), D.drumX + (sd?1:-1)*D.drumL*0.3,
          (D.rackY + D.drumY - D.drumR) / 2, D.drumZ, 0.5, D.drumY - D.drumR - D.rackY, 2.4), 'drum');
    anchors.drum = [D.drumX, D.drumY + D.drumR + 1.6, D.drumZ];

    // reflux back to the top tray
    pipeRun([[D.drumX - D.drumL*0.5 - 0.6, D.drumY - D.drumR*0.6, D.drumZ],
             [D.drumX - D.drumL*0.5 - 3.5, D.drumY - D.drumR*0.6, D.drumZ],
             [D.drumX - D.drumL*0.5 - 3.5, shellTop - 2.5, 0],
             [D.towerR + 1.2, shellTop - 2.5, 0]],
            0.26, STREAM.reflux, 'reflux', 'reflux');
    nozzle(shellTop - 2.5, 0, 1.2, 0.26, 'reflux', STREAM.reflux);
    anchors.reflux = [D.towerR + 5, shellTop - 1.2, 0];

    // wet gas off the top of the drum, naphtha off the bottom
    pipeRun([[D.drumX + 2, D.drumY + D.drumR, D.drumZ],
             [D.drumX + 2, D.drumY + D.drumR + 5, D.drumZ],
             [D.rackX + 8, D.drumY + D.drumR + 5, D.drumZ]],
            0.22, STREAM.gas, 'product-gas', 'gas');
    pipeRun([[D.drumX + D.drumL*0.42, D.drumY - D.drumR, D.drumZ],
             [D.drumX + D.drumL*0.42, 9.2, D.drumZ],
             [D.rackX, 9.2, D.drumZ], [D.rackX + 8, 9.2, D.drumZ]],
            0.26, STREAM.naphtha, 'product-naphtha', 'naphtha');

    /* ── bottoms, stripping steam, and the pipe rack ──────────────────── */
    pipeRun([[0, 0.9, 0], [0, 0.9, D.towerR + 3], [D.rackX, 0.9, D.towerR + 3],
             [D.rackX + 8, 0.9, D.towerR + 3]],
            0.34, STREAM.residue, 'product-residue', 'residue');
    pipeRun([[-14, 2.6, -6], [-3.5, 2.6, -6], [-3.5, skirtTop + 1.6, 0]],
            0.16, STREAM.steam, 'reboiler', 'steam');
    nozzle(skirtTop + 1.6, Math.PI, 0.9, 0.16, 'reboiler', STREAM.steam);

    // the rack itself: bents and stringers, which give the eye its scale
    for (var rb = 0; rb < 5; rb++) {
      var rz = -8 + rb * 5.5;
      add('box', MAT.struct, M.trs(M.m4(), D.rackX, D.rackY/2, rz, 0.55, D.rackY, 0.55), '');
      add('box', MAT.struct, M.trs(M.m4(), D.rackX + 4, D.rackY/2, rz, 0.55, D.rackY, 0.55), '');
      add('box', MAT.struct, M.trs(M.m4(), D.rackX + 2, D.rackY, rz, 5.2, 0.4, 0.45), '');
    }
    // ground plane and a little surrounding plant, for depth
    add('disc', MAT.deck, M.trs(M.m4(), 0, 0.02, 0, 108, 1, 108), '');
    add('disc', MAT.concrete, M.trs(M.m4(), 0, 0.05, 0, 9.5, 1, 9.5), '');
    for (var dr = 0; dr < 3; dr++) {
      var dx = -44 + dr * 9, dz = 26;
      add('cyl', MAT.shell, M.trs(M.m4(), dx, 0, dz, 3.4, 7.5, 3.4), '');
      add('dish', MAT.head, M.trs(M.m4(), dx, 7.5, dz, 3.4, 1.4, 3.4), '');
    }

    /* ── instrument tags: anchored to the equipment they read ──────────── */
    var instruments = [
      { key:'TI-101', kind:'T', at:[D.towerR + 1.0, shellTop - 4.5, 0],   read:'top'   },
      { key:'TI-104', kind:'T', at:[D.towerR + 1.0, sideY[0], 0],         read:'kerosene' },
      { key:'TI-107', kind:'T', at:[D.towerR + 1.0, sideY[1], 0],         read:'diesel' },
      { key:'TI-110', kind:'T', at:[D.towerR + 1.0, sideY[2], 0],         read:'gasoil' },
      { key:'TI-120', kind:'T', at:[D.towerR + 1.0, feedY + 1.5, 0],      read:'flash' },
      { key:'PI-101', kind:'P', at:[-D.towerR - 1.0, shellTop - 6.5, 0],  read:'topP'  },
      { key:'PI-120', kind:'P', at:[-D.towerR - 1.0, feedY - 1.5, 0],     read:'flashP'},
      { key:'FI-001', kind:'F', at:[-40, 4.4, D.furZ],                    read:'charge'},
      { key:'FI-210', kind:'F', at:[D.towerR + 6, shellTop - 1.0, 0],     read:'reflux'},
      { key:'TI-200', kind:'T', at:[D.condX, D.condY + 2.0, D.condZ],     read:'drum'  }
    ];

    return { objects: objs, streams: streams, anchors: anchors, D: D,
             MAT: MAT, STREAM: STREAM, instruments: instruments,
             bounds: { min:[-56, 0, -30], max:[46, shellTop + 12, 30] },
             shellTop: shellTop, skirtTop: skirtTop, feedY: feedY,
             sideY: sideY, sideKeys: sideKeys, trays: trays };
  }

  return { build: build, MAT: MAT, STREAM: STREAM };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PLANT;
