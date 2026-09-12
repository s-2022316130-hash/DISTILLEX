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
    condX: 22, condY: 29, condZ: -4, condW: 15, condD: 7,
    drumX: 23, drumY: 19, drumZ: 4, drumR: 1.7, drumL: 9,
    stripX: 11.5, stripR: 0.95, stripH: 11,
    rackX: 34, rackY: 7
  };

  /* ── materials ──────────────────────────────────────────────────────── */
  // col = base colour, rgh = roughness, mtl = metalness, emi = self-lit amount
  var MAT = {
    // Bare stainless and aluminium lagging read cool; mineral-wool cladding
    // painted light grey reads warm and matt; structural steel on a unit like
    // this is painted a dark blue-grey. Keeping those three families clearly
    // apart is what stops the model reading as one extruded material.
    shell:    { col:[0.60,0.645,0.715], rgh:0.30, mtl:0.90, emi:0.0 },
    insul:    { col:[0.775,0.760,0.730], rgh:0.92, mtl:0.03, emi:0.0 },
    head:     { col:[0.545,0.595,0.680], rgh:0.24, mtl:0.94, emi:0.0 },
    struct:   { col:[0.225,0.258,0.330], rgh:0.62, mtl:0.55, emi:0.0 },
    grate:    { col:[0.300,0.335,0.405], rgh:0.78, mtl:0.52, emi:0.0 },
    rail:     { col:[0.86,0.645,0.135], rgh:0.52, mtl:0.30, emi:0.04 },
    concrete: { col:[0.230,0.232,0.245], rgh:0.98, mtl:0.0,  emi:0.0 },
    deck:     { col:[0.115,0.126,0.152], rgh:1.0,  mtl:0.0,  emi:0.0, flag:1 },
    fire:     { col:[0.300,0.292,0.282], rgh:0.95, mtl:0.02, emi:0.0 },
    furnace:  { col:[0.250,0.228,0.208], rgh:0.95, mtl:0.05, emi:0.0 },
    stack:    { col:[0.300,0.290,0.282], rgh:0.78, mtl:0.24, emi:0.0 },
    coil:     { col:[0.40,0.335,0.300], rgh:0.66, mtl:0.72, emi:0.0 },
    tank:     { col:[0.415,0.430,0.455], rgh:0.88, mtl:0.10, emi:0.0 },
    instr:    { col:[0.86,0.89,0.94], rgh:0.38, mtl:0.5,  emi:0.10 }
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

  /* Where the cutaway wedge points.
     cylArc() keeps the arc centred on its local +X, so the missing wedge is
     centred on local −X. yawTRS maps a local angle a to the world angle
     a − yaw, so the gap ends up at world angle (π − yaw). The camera sits in
     the direction (sin φ, cos φ) for a camera azimuth φ, so the gap faces the
     camera when π − yaw = π/2 − φ, i.e.

         CUTAWAY_YAW = π/2 + φ

     φ = 0.62 is the 'cutaway' camera preset in info.js. From the default plant
     azimuth (φ = −0.72) the gap is about 77° round the shell, so the opening
     shot shows lagged steel and only the cutaway shot shows the internals. */
  var CUTAWAY_FACES = 0.62;
  var CUTAWAY_YAW = Math.PI / 2 + CUTAWAY_FACES;

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
    // The skirt: very slightly tapered, not a cone. It also gets the access
    // opening and the anchor-bolt chairs that make it read as load-bearing.
    add('skirt', MAT.fire, M.trs(M.m4(), 0, 0, 0, D.towerR * 1.16, D.skirtH, D.towerR * 1.16),
        'reboiler');
    for (var ab = 0; ab < 12; ab++) {
      var aba = ab / 12 * Math.PI * 2;
      add('box', MAT.struct, M.yawTRS(M.m4(), Math.cos(aba) * D.towerR * 1.2, 0.5, Math.sin(aba) * D.towerR * 1.2,
          -aba, 0.5, 1.0, 0.22), 'reboiler');
    }
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
    // radiant-section tubes, hung down the inside of both long walls and
    // visible past the casing: the part of a heater that actually does the work
    // Casing stiffeners: the vertical ribs that carry a firebox wall. Spaced
    // like structure rather than like siding, and in the casing's own colour.
    for (var rt = 0; rt < 7; rt++) {
      var rtx = D.furX - D.furW*0.40 + rt * (D.furW*0.80 / 6);
      add('box', MAT.stack, M.trs(M.m4(), rtx, D.furH/2 + 0.6, D.furZ + D.furD*0.505,
          0.34, D.furH - 0.6, 0.30), 'furnace');
      add('box', MAT.stack, M.trs(M.m4(), rtx, D.furH/2 + 0.6, D.furZ - D.furD*0.505,
          0.34, D.furH - 0.6, 0.30), 'furnace');
    }
    // the burner deck: a platform along the fired face, with a handrail
    var bdY = 3.4, bdZ = D.furZ + D.furD*0.5 + 1.5;
    add('box', MAT.grate, M.trs(M.m4(), D.furX, bdY, bdZ, D.furW*1.06, 0.16, 2.9), 'furnace');
    for (var bp = 0; bp < 9; bp++) {
      var bpx = D.furX - D.furW*0.5 + bp * (D.furW / 8);
      add('cyl', MAT.rail, M.trs(M.m4(), bpx, bdY, bdZ + 1.4, 0.05, 1.1, 0.05), 'furnace');
      cylBetween([bpx, 0, bdZ + 1.2], [bpx, bdY, bdZ + 1.2], 0.07, MAT.struct, 'furnace');
    }
    cylBetween([D.furX - D.furW*0.53, bdY + 1.05, bdZ + 1.4],
               [D.furX + D.furW*0.53, bdY + 1.05, bdZ + 1.4], 0.05, MAT.rail, 'furnace');
    cylBetween([D.furX - D.furW*0.53, bdY + 0.55, bdZ + 1.4],
               [D.furX + D.furW*0.53, bdY + 0.55, bdZ + 1.4], 0.05, MAT.rail, 'furnace');
    // the crossover header that ties them together at the top
    add('cyl', MAT.coil, M.alignY(M.m4(), [D.furX - D.furW*0.46, D.furH + 0.4, D.furZ + D.furD*0.51],
        [D.furW*0.92, 0, 0], 0.26), 'furnace');
    // stack: a transition cone off the convection section, then the barrel
    var stkX = D.furX + D.furW*0.34, stkY = cvY + cvH/2;
    add('cone', MAT.stack, M.trs(M.m4(), stkX, stkY - 1.8, D.furZ, 2.4, 1.9, 2.4), 'furnace');
    add('cylCap', MAT.stack, M.trs(M.m4(), stkX, stkY, D.furZ, 1.5, D.stackH, 1.5), 'furnace');
    add('cone', MAT.stack, M.trs(M.m4(), stkX, stkY + D.stackH, D.furZ, 1.5, 1.2, 1.5), 'furnace');
    add('ringThin', MAT.struct, M.trs(M.m4(), stkX, stkY + D.stackH*0.34, D.furZ, 1.72, 1, 1.72), 'furnace');
    // a ladder up the barrel and the platform it lands on. Painted steel, not
    // safety yellow: on a stack that height only the handrail is picked out.
    var plY = stkY + D.stackH * 0.66;
    add('annulus', MAT.grate, M.trs(M.m4(), stkX, plY, D.furZ, 2.6, 1, 2.6), 'furnace');
    cylBetween([stkX - 1.65, stkY, D.furZ - 0.34], [stkX - 1.65, plY, D.furZ - 0.34], 0.055, MAT.struct, 'furnace');
    cylBetween([stkX - 1.65, stkY, D.furZ + 0.34], [stkX - 1.65, plY, D.furZ + 0.34], 0.055, MAT.struct, 'furnace');
    for (var sl = 0; sl * 0.45 < plY - stkY; sl++)
      add('cyl', MAT.struct, M.alignY(M.m4(), [stkX - 1.65, stkY + sl * 0.45, D.furZ - 0.34],
          [0, 0, 0.68], 0.042), 'furnace');
    for (var sq = 0; sq < 16; sq++) {
      var sa = sq / 16 * Math.PI * 2;
      add('cyl', MAT.rail, M.trs(M.m4(), stkX + Math.cos(sa)*2.6, plY, D.furZ + Math.sin(sa)*2.6,
          0.045, 1.1, 0.045), 'furnace');
    }
    add('ringThin', MAT.rail, M.trs(M.m4(), stkX, plY + 1.05, D.furZ, 2.6, 1, 2.6), 'furnace');
    add('ringThin', MAT.rail, M.trs(M.m4(), stkX, plY + 0.55, D.furZ, 2.6, 1, 2.6), 'furnace');
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
    var stA = [D.furX - D.furW*0.54 - 1.0, 0.2, D.furZ - D.furD*0.3 - 0.42];
    var stB = [D.furX - D.furW*0.54 - 1.0, 1.4 + 12*0.78, D.furZ - D.furD*0.3 + 12*0.42];
    for (var sp3 = 0; sp3 < 12; sp3++)
      add('box', MAT.grate, M.trs(M.m4(), D.furX - D.furW*0.54 - 1.0, 1.4 + sp3*0.78,
          D.furZ - D.furD*0.3 + sp3*0.42, 1.5, 0.09, 0.5), 'furnace');
    for (var sg2 = 0; sg2 < 2; sg2++) {
      var sgx = D.furX - D.furW*0.54 - 1.0 + (sg2 ? 0.78 : -0.78);
      cylBetween([sgx, stA[1], stA[2]], [sgx, stB[1] - 0.3, stB[2]], 0.09, MAT.struct, 'furnace');
      cylBetween([sgx, stA[1] + 1.05, stA[2]], [sgx, stB[1] + 0.75, stB[2]], 0.05, MAT.rail, 'furnace');
    }
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
      for (var sb = 1; sb < 4; sb++)
        add('ringThin', MAT.struct, M.trs(M.m4(), sx, sy + D.stripH * sb / 4, sz,
            D.stripR * 1.05, 1, D.stripR * 1.05), 'sidedraw');
      // a small platform at the top of each stripper, reached off the tower
      add('annulus', MAT.grate, M.trs(M.m4(), sx, sy + D.stripH - 1.4, sz,
          D.stripR + 1.1, 1, D.stripR + 1.1), 'sidedraw');
      for (var sr = 0; sr < 12; sr++) {
        var sra = sr / 12 * Math.PI * 2;
        add('cyl', MAT.rail, M.trs(M.m4(), sx + Math.cos(sra) * (D.stripR + 1.1),
            sy + D.stripH - 1.4, sz + Math.sin(sra) * (D.stripR + 1.1), 0.045, 1.1, 0.045), 'sidedraw');
      }
      add('ringThin', MAT.rail, M.trs(M.m4(), sx, sy + D.stripH - 0.35, sz,
          D.stripR + 1.1, 1, D.stripR + 1.1), 'sidedraw');
      anchors.side[sideKeys[sI]] = [sx, sy + D.stripH + 1, sz];
      // draw line from the tower to the stripper, and the product away
      var noz = nozzle(sideY[sI], Math.atan2(sz, sx), 1.3, 0.22, 'sidedraw', STREAM[sideKeys[sI]]);
      pipeRun([noz, [sx, sideY[sI], sz], [sx, sy + D.stripH + 0.8, sz]],
              0.22, STREAM[sideKeys[sI]], 'sidedraw');
      pipeRun([[sx, sy + 0.4, sz], [sx, 3.4 + sI * 1.1, sz],
               [D.rackX + 1.1 + sI * 1.4, 3.4 + sI * 1.1, sz],
               [D.rackX + 1.1 + sI * 1.4, D.rackY + 0.6, sz],
               [D.rackX + 1.1 + sI * 1.4, D.rackY + 0.6, -19]],
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
    // up off the head, along at high level, then down onto the bank
    var ovStart = [0, shellTop + D.towerR * 0.5, 0];
    var ovHigh = shellTop + 3.4, ovDrop = D.towerR + 4.2;
    var overhead = [ovStart, [0, ovHigh, 0], [ovDrop, ovHigh, 0],
                    [ovDrop, D.condY + 6.5, D.condZ],
                    [D.condX - D.condW*0.5 - 2, D.condY + 6.5, D.condZ],
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
    // The structure under the bank. A braced four-post tower with ties at
    // three levels and an X in every bay on all four faces: the previous
    // version's random knee braces read as scaffolding rather than steel.
    var cLegX = D.condW * 0.44, cLegZ = D.condD * 0.40, cTop = D.condY - 0.4;
    var cLev = [D.rackY, D.rackY + (cTop - D.rackY) * 0.5, cTop];
    for (var lg = 0; lg < 4; lg++) {
      var lx = D.condX + (lg < 2 ? -1 : 1) * cLegX, lz = D.condZ + (lg % 2 ? -1 : 1) * cLegZ;
      add('box', MAT.struct, M.trs(M.m4(), lx, cTop / 2, lz, 0.52, cTop, 0.52), 'condenser');
      pad(lx, lz, 1.6, 1.6);
    }
    for (var lv = 0; lv < cLev.length; lv++) {
      var hy = cLev[lv];
      add('box', MAT.struct, M.trs(M.m4(), D.condX, hy, D.condZ - cLegZ, cLegX * 2, 0.34, 0.34), 'condenser');
      add('box', MAT.struct, M.trs(M.m4(), D.condX, hy, D.condZ + cLegZ, cLegX * 2, 0.34, 0.34), 'condenser');
      add('box', MAT.struct, M.trs(M.m4(), D.condX - cLegX, hy, D.condZ, 0.34, 0.34, cLegZ * 2), 'condenser');
      add('box', MAT.struct, M.trs(M.m4(), D.condX + cLegX, hy, D.condZ, 0.34, 0.34, cLegZ * 2), 'condenser');
      if (!lv) continue;
      var y0 = cLev[lv - 1], y1 = hy;
      // an X in each of the four faces of this bay
      for (var fz = 0; fz < 2; fz++) {
        var z2 = D.condZ + (fz ? 1 : -1) * cLegZ;
        cylBetween([D.condX - cLegX, y0, z2], [D.condX + cLegX, y1, z2], 0.11, MAT.struct, 'condenser');
        cylBetween([D.condX + cLegX, y0, z2], [D.condX - cLegX, y1, z2], 0.11, MAT.struct, 'condenser');
      }
      for (var fx = 0; fx < 2; fx++) {
        var x2 = D.condX + (fx ? 1 : -1) * cLegX;
        cylBetween([x2, y0, D.condZ - cLegZ], [x2, y1, D.condZ + cLegZ], 0.11, MAT.struct, 'condenser');
        cylBetween([x2, y0, D.condZ + cLegZ], [x2, y1, D.condZ - cLegZ], 0.11, MAT.struct, 'condenser');
      }
    }
    // the access platform round the bank, with its handrail
    add('box', MAT.grate, M.trs(M.m4(), D.condX, D.condY + 1.9, D.condZ + D.condD * 0.72,
        D.condW * 1.06, 0.14, 2.2), 'condenser');
    for (var cp = 0; cp < 10; cp++) {
      var cpx = D.condX - D.condW * 0.5 + cp * (D.condW / 9);
      add('cyl', MAT.rail, M.trs(M.m4(), cpx, D.condY + 1.9, D.condZ + D.condD * 0.72 + 1.0,
          0.05, 1.1, 0.05), 'condenser');
    }
    cylBetween([D.condX - D.condW*0.53, D.condY + 2.95, D.condZ + D.condD*0.72 + 1.0],
               [D.condX + D.condW*0.53, D.condY + 2.95, D.condZ + D.condD*0.72 + 1.0],
               0.05, MAT.rail, 'condenser');
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
    var rfX = D.towerR + 3.0;
    pipeRun([[D.drumX - D.drumL*0.5 - 0.6, D.drumY - D.drumR*0.6, D.drumZ],
             [rfX, D.drumY - D.drumR*0.6, D.drumZ],
             [rfX, D.drumY - D.drumR*0.6, 0],
             [rfX, shellTop - 2.5, 0],
             [D.towerR + 1.2, shellTop - 2.5, 0]],
            0.26, STREAM.reflux, 'reflux', 'reflux');
    // the riser is guided off the shell every few courses, as a real one is
    for (var rg2 = 0; rg2 * 7 < shellTop - D.drumY - 4; rg2++) {
      var rgy = D.drumY + 2 + rg2 * 7;
      cylBetween([D.towerR, rgy, 0], [rfX, rgy, 0], 0.09, MAT.struct, 'reflux');
    }
    nozzle(shellTop - 2.5, 0, 1.2, 0.26, 'reflux', STREAM.reflux);
    anchors.reflux = [D.towerR + 5, shellTop - 1.2, 0];

    // wet gas off the top of the drum, naphtha off the bottom
    pipeRun([[D.drumX + 2, D.drumY + D.drumR, D.drumZ],
             [D.drumX + 2, D.drumY + D.drumR + 5, D.drumZ],
             [D.rackX + 4.2, D.drumY + D.drumR + 5, D.drumZ],
             [D.rackX + 4.2, D.rackY + 1.5, D.drumZ],
             [D.rackX + 4.2, D.rackY + 1.5, -19]],
            0.22, STREAM.gas, 'product-gas', 'gas');
    pipeRun([[D.drumX + D.drumL*0.42, D.drumY - D.drumR, D.drumZ],
             [D.drumX + D.drumL*0.42, D.rackY + 1.1, D.drumZ],
             [D.rackX + 2.6, D.rackY + 1.1, D.drumZ],
             [D.rackX + 2.6, D.rackY + 1.1, -19]],
            0.26, STREAM.naphtha, 'product-naphtha', 'naphtha');

    /* ── bottoms, stripping steam, and the pipe rack ──────────────────── */
    pipeRun([[0, 0.9, 0], [0, 0.9, D.towerR + 3], [D.rackX + 5.6, 0.9, D.towerR + 3],
             [D.rackX + 5.6, D.rackY + 0.6, D.towerR + 3],
             [D.rackX + 5.6, D.rackY + 0.6, -19]],
            0.34, STREAM.residue, 'product-residue', 'residue');
    pipeRun([[-14, 2.6, -6], [-3.5, 2.6, -6], [-3.5, skirtTop + 1.6, 0]],
            0.16, STREAM.steam, 'reboiler', 'steam');
    nozzle(skirtTop + 1.6, Math.PI, 0.9, 0.16, 'reboiler', STREAM.steam);

    // The pipe rack: bents on a regular bay, two tiers of stringers, and
    // longitudinal bracing in every other bay. A rack without bracing reads as
    // a row of loose posts, which is what it looked like before.
    var rz0 = -14, rzN = 9, bays = 8, rzStep = (rzN - rz0) / (bays - 1);
    for (var rb = 0; rb < bays; rb++) {
      var rz = rz0 + rb * rzStep;
      add('box', MAT.struct, M.trs(M.m4(), D.rackX, D.rackY/2, rz, 0.55, D.rackY, 0.55), '');
      add('box', MAT.struct, M.trs(M.m4(), D.rackX + 5, D.rackY/2, rz, 0.55, D.rackY, 0.55), '');
      add('box', MAT.struct, M.trs(M.m4(), D.rackX + 2.5, D.rackY, rz, 6.2, 0.42, 0.48), '');
      add('box', MAT.struct, M.trs(M.m4(), D.rackX + 2.5, D.rackY * 0.55, rz, 6.2, 0.34, 0.40), '');
      pad(D.rackX, rz, 1.3, 1.3); pad(D.rackX + 5, rz, 1.3, 1.3);
      if (rb && rb % 2) {
        cylBetween([D.rackX, D.rackY * 0.55, rz - rzStep], [D.rackX, D.rackY, rz], 0.10, MAT.struct, '');
        cylBetween([D.rackX + 5, D.rackY * 0.55, rz], [D.rackX + 5, D.rackY, rz - rzStep], 0.10, MAT.struct, '');
      }
      if (rb) {
        add('box', MAT.struct, M.trs(M.m4(), D.rackX, D.rackY, rz - rzStep/2, 0.36, 0.34, rzStep), '');
        add('box', MAT.struct, M.trs(M.m4(), D.rackX + 5, D.rackY, rz - rzStep/2, 0.36, 0.34, rzStep), '');
      }
    }
    // The paved plot. It runs well past the fog so its edge is never a visible
    // circle; the joints and the apron staining are drawn in the shader from
    // world coordinates rather than modelled.
    add('disc', MAT.deck, M.trs(M.m4(), 0, 0.02, 0, 230, 1, 230), '');
    add('disc', MAT.concrete, M.trs(M.m4(), 0, 0.05, 0, 9.5, 1, 9.5), '');
    // Foundations. Nothing on a unit stands straight on the paving, and a
    // plinth under each item is most of what stops equipment looking dropped.
    function pad(x, z, w, d) {
      add('box', MAT.concrete, M.trs(M.m4(), x, 0.22, z, w, 0.44, d), '');
    }
    pad(D.stripX, -5, 3.4, 3.4); pad(D.stripX, 0, 3.4, 3.4); pad(D.stripX, 5, 3.4, 3.4);
    pad(D.furX, D.furZ, D.furW * 1.24, D.furD * 1.24);
    for (var fp = 0; fp < 4; fp++)
      pad(D.condX + (fp < 2 ? -1 : 1) * D.condW * 0.42,
          D.condZ + (fp % 2 ? -1 : 1) * D.condD * 0.38, 1.5, 1.5);
    // storage, far enough back to read as distance rather than as clutter
    for (var dr = 0; dr < 3; dr++) {
      var dx = -14 + dr * 17, dz = -54;
      add('cyl', MAT.tank, M.trs(M.m4(), dx, 0, dz, 5.2, 8.6, 5.2), '');
      add('dish', MAT.tank, M.trs(M.m4(), dx, 8.6, dz, 5.2, 1.6, 5.2), '');
      add('ringThin', MAT.struct, M.trs(M.m4(), dx, 4.4, dz, 5.3, 1, 5.3), '');
      pad(dx, dz, 12, 12);
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
