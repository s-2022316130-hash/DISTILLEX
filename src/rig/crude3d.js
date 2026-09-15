/* ════════════════════════════════════════════════════════════════════════
   The atmospheric crude tower, as an assembly that comes apart.

   The landing page's industrial panel used to be an SVG: eight coloured
   rectangles stacked into a shell, which slid apart when you asked for the
   exploded view. This is the same eight cuts as a real vessel — a lagged
   tower on a skirt, a section window per cut showing its trays and
   downcomers, a side-draw nozzle and transfer line for every draw, a fired
   heater and the transfer line that carries the flashed feed in, the
   overhead line to a condenser and drum, and a stripping-steam line into the
   sump.

   EXPLODING IT IS A TRANSLATION, NOT A REBUILD. Every object carries the
   vector it travels along when the assembly comes apart, and apply() writes
   `base + vector · t` into its matrix. The renderer re-uploads twelve
   instance buffers a frame, so the transition interpolates continuously
   instead of cutting between two states — which is the whole difference
   between an exploded view and two pictures.

   Nothing here is computed by the engine and nothing here feeds it. The
   boiling ranges shown beside it are the conventional approximate cut points
   for an atmospheric unit; the geometry is a drawing of that process, not a
   claim about any particular tower.
   ════════════════════════════════════════════════════════════════════════ */
var CRUDE3D = (function () {
  'use strict';
  var M = GLM;

  /* Eight cuts, lightest at the top. The keys are the ones the landing page's
     panel already uses, so a pick on the model names the same cut the text
     does. The colour key is the stream entry that matches --dx-f1 … --dx-f8. */
  var CUTS = [
    { k: 'gas',      c: 'f1', r: 0.42, len: 5.6 },
    { k: 'lpg',      c: 'f2', r: 0.40, len: 5.2 },
    { k: 'naphtha',  c: 'f3', r: 0.44, len: 4.8 },
    { k: 'kerosene', c: 'f4', r: 0.46, len: 4.4 },
    { k: 'diesel',   c: 'f5', r: 0.48, len: 4.0 },
    { k: 'gasoil',   c: 'f6', r: 0.50, len: 3.6 },
    { k: 'fueloil',  c: 'f7', r: 0.52, len: 3.2 },
    { k: 'residue',  c: 'f8', r: 0.56, len: 2.8 }
  ];

  var D = { R: 2.6, bandH: 4.1, skirtH: 4.0, furX: -13.5, condX: 12.0 };

  var HOME_YAW = -0.50;
  var CUT_YAW = Math.PI / 2 + HOME_YAW;

  function build(opts) {
    opts = opts || {};
    var lite = !!opts.lite;
    var MAT = PLANT.MAT;
    var objs = [], streams = [], labels = [];
    var STREAM = THEME.get().streamLin;
    var nB = CUTS.length, skirtTop = D.skirtH, shellH = nB * D.bandH, top = skirtTop + shellH;

    /** Every object records the vector it travels along when the assembly
     *  comes apart. `ex` is in metres at full explode. */
    function add(mesh, mat, mtx, pick, tint, tintKey, ex) {
      var o = { mesh: mesh, mat: mat, m: mtx, pick: pick || '',
                tintKey: tintKey || (tint ? tintOf(tint) : null),
                col: tint || mat.col,
                m0: new Float32Array(mtx),
                ex: ex || null };
      objs.push(o);
      return o;
    }
    function tintOf(tint) {
      for (var k in STREAM) if (STREAM.hasOwnProperty(k) && STREAM[k] === tint) return k;
      return null;
    }
    function upright(mesh, mat, x, y, z, r, h, pick, tint, tintKey, ex) {
      // cylinder(), cone() and cylArc() are wound for alignY()'s left-handed
      // basis; a positive-scale trs() would show their back faces and cull the
      // surface away. See column3d.js.
      return add(mesh, mat, M.trs(M.m4(), x, y, z, r, h, -r), pick, tint, tintKey, ex);
    }
    function cylBetween(a, b, r, mat, pick, tint, capped, ex) {
      var d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
      if (Math.hypot(d[0], d[1], d[2]) < 1e-6) return null;
      return add(capped ? 'cylCap' : 'cyl', mat, M.alignY(M.m4(), a, d, r), pick, tint, null, ex);
    }
    function pipeRun(pts, r, tint, pick, key, ex) {
      var i;
      for (i = 0; i < pts.length - 1; i++)
        cylBetween(pts[i], pts[i+1], r, MAT.shell, pick, tint, false, ex);
      for (i = 1; i < pts.length - 1; i++)
        add('sphere', MAT.shell, M.trs(M.m4(), pts[i][0], pts[i][1], pts[i][2], r, r, r), pick, tint, null, ex);
      if (key) streams.push({ key: key, pts: pts, r: r, col: tint, tintKey: tintOf(tint) });
      return pts;
    }
    function flange(p, dir, r, pick, ex) {
      add('cylCap', MAT.struct,
          M.alignY(M.m4(), [p[0]-dir[0]*0.13, p[1]-dir[1]*0.13, p[2]-dir[2]*0.13],
                   [dir[0]*0.26, dir[1]*0.26, dir[2]*0.26], r * 1.8), pick, MAT.struct.col, null, ex);
    }

    /* ── ground and skirt ─────────────────────────────────────────────── */
    add('box', MAT.deck, M.trs(M.m4(), -1, -0.06, 0, 46, 0.12, 26), '');
    add('annulus', MAT.concrete, M.trs(M.m4(), 0, 0.02, 0, D.R * 2.1, 1, D.R * 2.1), 'tower');
    upright('cylCap', MAT.concrete, 0, 0, 0, D.R * 1.8, 0.6, 'tower');
    upright('skirt', MAT.fire, 0, 0.55, 0, D.R / 0.94, D.skirtH - 0.55, 'tower');
    for (var ab = 0; ab < 16; ab++) {
      var aa = ab / 16 * Math.PI * 2;
      add('box', MAT.struct, M.yawTRS(M.m4(), Math.cos(aa) * D.R * 1.06, 0.9,
          Math.sin(aa) * D.R * 1.06, -aa, 0.42, 0.7, 0.18), 'tower');
    }

    /* ── the eight sections ───────────────────────────────────────────── */
    // Lightest cut at the top, so the model reads the same way round as the
    // temperature profile and the same way round as the panel beside it.
    var mid = (nB - 1) / 2;
    for (var i = 0; i < nB; i++) {
      var cut = CUTS[i];
      var band = nB - 1 - i;                         // 0 = bottom section
      var y0 = skirtTop + band * D.bandH;
      var tone = STREAM[cut.c];
      // Each section lifts off the one below and steps out, so the exploded
      // view fans rather than telescopes. It lifts UPWARD from the base: an
      // explosion centred on the middle of the stack drives the bottom section
      // through the paving.
      var ex = [(band - mid) * 0.9, band * 2.1, 0];

      // The course. Every other one is sectioned, so the trays inside can be
      // read; cutting all eight would leave a glass tube rather than a vessel
      // with windows in it.
      if (band % 2)
        add('cylArc', MAT.shell, M.yawTRS(M.m4(), 0, y0, 0, CUT_YAW, D.R, D.bandH, -D.R),
            cut.k, null, null, ex);
      else
        upright('cyl', MAT.insul, 0, y0, 0, D.R, D.bandH, cut.k, null, null, ex);
      // A collar in the cut's own colour. A one-pixel ring is invisible from
      // across the page; this is the band that says which fraction the section
      // makes, so it is given a height you can see at thumbnail size.
      upright('cylCap', MAT.head, 0, y0 + D.bandH * 0.42, 0, D.R * 1.045, D.bandH * 0.17,
              cut.k, tone, cut.c, ex);
      add('ringThin', MAT.struct, M.trs(M.m4(), 0, y0 + D.bandH, 0, D.R * 1.03, 1, D.R * 1.03),
          cut.k, null, null, ex);

      // trays and their downcomers
      var nt = lite ? 2 : 3;
      for (var t = 0; t < nt; t++) {
        var ty = y0 + D.bandH * (t + 0.7) / (nt + 0.4), sd = (t % 2) ? 1 : -1;
        upright('cylCap', MAT.grate, 0, ty, 0, D.R * 0.94, 0.10, cut.k, null, null, ex);
        add('box', MAT.struct, M.trs(M.m4(), sd * D.R * 0.56, ty - D.bandH * 0.13, 0,
            0.07, D.bandH * 0.26, D.R * 1.28), cut.k, null, null, ex);
      }

      // the side draw: nozzle, flange and the transfer line out to its label
      var drawY = y0 + D.bandH * 0.32;
      var ang = 0.10 + (i % 2 ? 0.34 : -0.34);
      var c = Math.cos(ang), s2 = Math.sin(ang);
      var a0 = [D.R * c, drawY, D.R * s2];
      var a1 = [(D.R + 1.1) * c, drawY, (D.R + 1.1) * s2];
      cylBetween(a0, a1, cut.r * 0.5, MAT.shell, cut.k, tone, false, ex);
      flange(a1, [c, 0, s2], cut.r * 0.5, cut.k, ex);
      var out = [(D.R + 1.1 + cut.len) * c, drawY, (D.R + 1.1 + cut.len) * s2];
      pipeRun([a1, out], cut.r * 0.5, tone, cut.k, 'draw-' + cut.k, ex);
      add('cylCap', MAT.struct, M.alignY(M.m4(), out, [c * 0.3, 0, s2 * 0.3], cut.r * 0.9),
          cut.k, tone, cut.c, ex);
      // where the label hangs, and what it travels with
      labels.push({ k: cut.k, at: [out[0], drawY + 0.5, out[2]], ex: ex });

      // the draw turns down the rack, so the line goes somewhere rather than
      // ending in mid-air
      if (!lite) {
        var rkx = (D.R + 1.1 + cut.len) * c, rkz = (D.R + 1.1 + cut.len) * s2;
        pipeRun([[rkx, drawY, rkz], [rkx, 3.4 + i * 0.5, rkz]], cut.r * 0.42, tone, cut.k, null, ex);
      }
    }

    /* ── the pipe rack the draws come down into ───────────────────────── */
    if (!lite) for (var rk = 0; rk < 2; rk++) {
      var rz = rk ? 7.6 : -7.6;
      for (var rp = -2; rp <= 2; rp++)
        add('box', MAT.struct, M.trs(M.m4(), rp * 4.4 + 2, 1.7, rz, 0.32, 3.4, 0.32), 'rack');
      cylBetween([-10.8, 3.4, rz], [12.8, 3.4, rz], 0.14, MAT.struct, 'rack');
      cylBetween([-10.8, 3.9, rz], [12.8, 3.9, rz], 0.14, MAT.struct, 'rack');
    }

    /* ── heads ────────────────────────────────────────────────────────── */
    var exTop = [(nB - 1 - mid) * 0.9 + 0.9, (nB - 1) * 2.1 + 2.1, 0];
    var exBot = [(0 - mid) * 0.9 - 0.9, -1.4, 0];
    add('dish', MAT.head, M.trs(M.m4(), 0, top, 0, D.R, D.R, D.R), 'tower', null, null, exTop);
    add('dish', MAT.head, M.trs(M.m4(), 0, skirtTop, 0, D.R, -D.R, -D.R), 'tower', null, null, exBot);

    /* ── platforms and the caged ladder ───────────────────────────────── */
    // They belong to the structure, not to any one section, so they travel
    // with the section they are bolted to.
    var plats = lite ? [2, 5] : [1, 3, 5, 7];
    for (var p2 = 0; p2 < plats.length; p2++) {
      var pb = plats[p2], py = skirtTop + pb * D.bandH + D.bandH * 0.86, pr = D.R + 1.4;
      var pex = [(pb - mid) * 0.9, pb * 2.1, 0];
      add('annulus', MAT.grate, M.trs(M.m4(), 0, py, 0, pr, 1, pr), 'tower', null, null, pex);
      var posts = lite ? 12 : 18;
      for (var q = 0; q < posts; q++) {
        var an = q / posts * Math.PI * 2;
        upright('rod', MAT.rail, Math.cos(an) * pr, py, Math.sin(an) * pr, 0.045, 1.0,
                'tower', null, null, pex);
      }
      add('ringThin', MAT.rail, M.trs(M.m4(), 0, py + 0.98, 0, pr, 1, pr), 'tower', null, null, pex);
      add('ringThin', MAT.rail, M.trs(M.m4(), 0, py + 0.52, 0, pr, 1, pr), 'tower', null, null, pex);
    }

    /* ── the fired heater and the transfer line ───────────────────────── */
    var fH = 7.0, fW = 8.0, fD = 6.0;
    add('box', MAT.concrete, M.trs(M.m4(), D.furX, 0.4, 0, fW * 1.1, 0.8, fD * 1.1), 'furnace');
    add('box', MAT.furnace, M.trs(M.m4(), D.furX, fH / 2 + 0.8, 0, fW, fH, fD), 'furnace');
    for (var cc = 0; cc < 4; cc++)
      add('box', MAT.struct, M.trs(M.m4(), D.furX + (cc < 2 ? -1 : 1) * fW * 0.5,
          fH / 2 + 0.8, (cc % 2 ? -1 : 1) * fD * 0.5, 0.38, fH, 0.38), 'furnace');
    upright('cylCap', MAT.stack, D.furX - fW * 0.30, fH + 0.8, 0, 1.0, 9.0, 'furnace');
    // the radiant tubes, seen down the near wall
    for (var rt = 0; rt < (lite ? 4 : 7); rt++)
      cylBetween([D.furX - fW * 0.36 + rt * fW * 0.72 / (lite ? 4 : 7), 1.4, fD * 0.42],
                 [D.furX - fW * 0.36 + rt * fW * 0.72 / (lite ? 4 : 7), fH + 0.2, fD * 0.42],
                 0.17, MAT.coil, 'furnace', STREAM.hot, false);
    // crude in, and the flashed transfer line into the flash zone
    var flashY = skirtTop + 1.2 * D.bandH;
    pipeRun([[D.furX - 8.5, 1.5, -fD * 0.5], [D.furX, 1.5, -fD * 0.5], [D.furX, 1.5, 0]],
            0.34, STREAM.crude, 'furnace', 'crude');
    pipeRun([[D.furX + fW * 0.5, fH * 0.6, 0], [D.furX + fW * 0.5 + 3.0, fH * 0.6, 0],
             [D.furX + fW * 0.5 + 3.0, flashY, 0], [-D.R, flashY, 0]],
            0.42, STREAM.hot, 'furnace', 'transfer');

    /* ── overhead and sump ────────────────────────────────────────────── */
    var ovY = top + D.R * 0.5;
    add('cylCap', MAT.shell, M.alignY(M.m4(), [0, ovY, 0], [0, 1.0, 0], 0.40),
        'tower', STREAM.vapour, null, exTop);
    var condY = top + 7.5;
    // condenser and drum on a short frame, so the overhead goes somewhere
    var cfH = condY - 2.6;
    for (var lg = 0; lg < 4; lg++)
      add('box', MAT.struct, M.trs(M.m4(), D.condX + (lg < 2 ? -2.4 : 2.4),
          cfH / 2, (lg % 2 ? -2.2 : 2.2), 0.3, cfH, 0.3), 'condenser');
    // ring beams and one diagonal a tier, alternating hand: forty metres of
    // bare pole reads as four sticks, not as a structure
    var tiers = Math.max(3, Math.round(cfH / 6));
    for (var tr = 1; tr <= tiers; tr++) {
      var ty2 = cfH * tr / tiers, yb = cfH * (tr - 1) / tiers, sg = (tr % 2) ? 1 : -1;
      for (var sd2 = -1; sd2 <= 1; sd2 += 2) {
        cylBetween([D.condX - 2.4, ty2, sd2 * 2.2], [D.condX + 2.4, ty2, sd2 * 2.2], 0.12, MAT.struct, 'condenser');
        cylBetween([D.condX + sd2 * 2.4, ty2, -2.2], [D.condX + sd2 * 2.4, ty2, 2.2], 0.12, MAT.struct, 'condenser');
        cylBetween([D.condX - sg * 2.4, yb, sd2 * 2.2], [D.condX + sg * 2.4, ty2, sd2 * 2.2], 0.09, MAT.struct, 'condenser');
      }
    }
    cylBetween([D.condX, condY, -3.4], [D.condX, condY, 3.4], 1.1, MAT.shell, 'condenser', MAT.shell.col, false);
    add('dish', MAT.shell, M.alignY(M.m4(), [D.condX, condY, -3.4], [0, 0, -1.1], 1.1), 'condenser');
    add('dish', MAT.shell, M.alignY(M.m4(), [D.condX, condY,  3.4], [0, 0,  1.1], 1.1), 'condenser');
    for (var cw2 = 1; cw2 < (lite ? 3 : 5); cw2++)
      add('ringThin', MAT.struct, M.trs(M.m4(), D.condX, condY, -3.4 + cw2 * 6.8 / (lite ? 3 : 5),
          1.18, 1, 1.18), 'condenser');
    pipeRun([[0, ovY + 1.0, 0], [0, condY, 0], [D.condX - 1.2, condY, 0]],
            0.38, STREAM.vapour, 'tower', 'ovhd');
    pipeRun([[D.condX, condY, 3.4 + 0.2], [D.condX, condY, 6.4], [D.condX + 4.0, condY, 6.4]],
            0.26, STREAM[CUTS[0].c], 'condenser', 'gasout');
    // stripping steam into the sump, and the residue draw out of it
    pipeRun([[-D.R - 5.4, skirtTop + 0.9, 2.2], [-D.R - 0.2, skirtTop + 0.9, 2.2]],
            0.22, STREAM.steam, 'tower', 'steam', exBot);
    pipeRun([[0, skirtTop - 0.4, 0], [0, 1.1, 0], [0, 1.1, 7.0]],
            0.34, STREAM[CUTS[7].c], 'residue', 'btms');

    /* ── the traffic inside the tower ─────────────────────────────────── */
    var upPts = [[0, skirtTop + 0.6, 0]];
    for (var v = 0; v < nB * 2; v++)
      upPts.push([((v % 2) ? 0.7 : -0.7), skirtTop + shellH * (v + 1) / (nB * 2 + 1), 0]);
    upPts.push([0, top + 0.6, 0]);
    streams.push({ key: 'vup', pts: upPts, r: 0.18, col: STREAM.vapour, tintKey: 'vapour' });

    return {
      objects: objs, streams: streams, anchors: {}, D: D, MAT: MAT, STREAM: STREAM,
      instruments: [], labels: labels, cuts: CUTS,
      bounds: { min: [D.furX - 10, 0, -10], max: [D.condX + 6, condY + 2, 10] },
      shellTop: top, skirtTop: skirtTop,
      home: { yaw: HOME_YAW, pitch: 0.09, dist: 80, target: [-0.6, 21.5, 0] },
      // the assembly grows when it comes apart, so the camera has to as well
      explodedDist: 94, explodedTarget: [-0.6, 28.5, 0]
    };
  }

  /** Slide every piece along its own vector. `t` runs 0 (assembled) to 1
   *  (fully apart); the caller eases it, and the renderer re-uploads. */
  function apply(P, t) {
    var objs = P.objects;
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (!o.ex) continue;
      o.m[12] = o.m0[12] + o.ex[0] * t;
      o.m[13] = o.m0[13] + o.ex[1] * t;
      o.m[14] = o.m0[14] + o.ex[2] * t;
    }
    for (i = 0; i < P.labels.length; i++) {
      var L = P.labels[i];
      L.now = [L.at[0] + L.ex[0] * t, L.at[1] + L.ex[1] * t, L.at[2] + L.ex[2] * t];
    }
    return P;
  }

  return { build: build, apply: apply, CUTS: CUTS, HOME_YAW: HOME_YAW };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CRUDE3D;
