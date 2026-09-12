/* view2d.js — the process-flow diagram, built from the same result the 3D
 * scene is built from.
 *
 * The 2D view is not a picture of the plant; it is a second rendering of the
 * same state. Blocks carry the same `pick` keys as the 3D geometry, so a
 * selection made in one view is already a selection in the other, and the line
 * weights, tracer speeds and temperatures all come from the solved result
 * rather than from constants typed in here. With no result it still draws —
 * greyed, at nominal weights — so the diagram is never blank.
 *
 * The layout is an engineering flow sheet rather than a picture: equipment on
 * a baseline, every rundown finishing on one vertical, and the product data
 * in a single column on the right where it can be read down.
 */
var RIG2D = (function () {
  'use strict';

  var W = 980, H = 620;

  /* The thermal ramp's fixed end points, in °C. A colour has to mean the same
     temperature from one operating point to the next. */
  var T_LO = 30, T_HI = 380;

  /* Geometry of the sheet, in viewBox units. One place to move anything. */
  var G = {
    towerX: 352, towerW: 98, towerY: 56, towerH: 470,
    furX: 86,  furY: 322, furW: 138, furH: 108,
    stackX: 146, stackY: 214, stackW: 22,
    condX: 592, condY: 46,  condW: 112, condH: 38,
    drumX: 600, drumY: 126, drumW: 120, drumH: 44,
    stripX: 500, stripW: 46, stripH: 66,
    railX: 790,                       // every rundown finishes on this vertical
    labX:  804,                       // and its label starts here
    baseY: 574                        // the residue run
  };

  /* Where each product's label sits in the right-hand column. Fixed, so the
     column reads top to bottom in process order and nothing ever collides. */
  var LABY = { gas: 112, naphtha: 166, kerosene: 258, diesel: 312,
               gasoil: 366, residue: 556 };

  /* Where a side draw leaves the shell, as a fraction of shell height from the
     bottom. Fixed by the plant layout, not by the operating point. */
  var DRAWF = { kerosene: 0.760, diesel: 0.575, gasoil: 0.395 };

  /* Colours mirror plant.js STREAM, expressed for CSS. */
  var COL = {
    crude:  'rgb(150,160,178)', hot: 'rgb(255,150,64)',  vapour:'rgb(140,205,255)',
    reflux: 'rgb(130,180,235)', gas: 'rgb(120,235,220)', naphtha:'rgb(255,215,120)',
    kerosene:'rgb(255,190,80)', diesel:'rgb(250,158,51)', gasoil:'rgb(242,112,56)',
    residue:'rgb(230,92,122)',  steam:'rgb(184,204,235)'
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmt(v, d) { return (+v).toFixed(d); }

  /** The top tray temperature. Tprofile[0] is the condenser/drum stage, which
   *  sits downstream of the condenser and is far colder than the shell. */
  function topTrayT(r) {
    var T = r.internals && r.internals.Tprofile;
    return (T && T.length > 1) ? T[1] : r.energy.Ttop;
  }
  /** Everything that leaves the top of the tower, as mass. */
  function ovMass(byKey) {
    return (byKey.gas ? byKey.gas.mass : 0) + (byKey.naphtha ? byKey.naphtha.mass : 0);
  }

  /** Line weight from a mass flow: a gentle power law, so a stream an order of
   *  magnitude smaller is still visible rather than hairline. */
  function gauge(tph, ref) {
    if (!(tph > 0)) return 1.6;
    return clamp(1.8 + 5.6 * Math.pow(tph / Math.max(1e-6, ref), 0.42), 1.8, 8.0);
  }
  /** Seconds per tracer cycle: faster line, faster tracer, with a floor and a
   *  ceiling so nothing strobes or stalls. */
  function pace(tph, ref) {
    if (!(tph > 0)) return 0;
    return clamp(2.4 / Math.pow(Math.max(0.02, tph / Math.max(1e-6, ref)), 0.5), 0.6, 7);
  }

  /** Tower wall tint for a temperature: cool indigo at the overhead, through
   *  amber, to a hot red at the sump. */
  function heat(t, lo, hi) {
    var u = clamp((t - lo) / Math.max(1e-6, hi - lo), 0, 1);
    var stops = [[0.00, 74, 104, 190], [0.32, 96, 190, 214], [0.58, 232, 190, 96],
                 [0.80, 238, 132, 58], [1.00, 226, 74, 82]];
    for (var i = 1; i < stops.length; i++) {
      if (u <= stops[i][0]) {
        var a = stops[i-1], b = stops[i], w = (u - a[0]) / (b[0] - a[0]);
        return 'rgb(' + Math.round(a[1]+(b[1]-a[1])*w) + ',' +
                        Math.round(a[2]+(b[2]-a[2])*w) + ',' +
                        Math.round(a[3]+(b[3]-a[3])*w) + ')';
      }
    }
    return 'rgb(226,74,82)';
  }

  /**
   * Build the diagram.
   *   r     — a CDU result, or null before the first run
   *   mode  — 'material' | 'thermal' | 'flow'
   *   sel   — selected pick key
   *   prod  — emphasised product key
   *   anim  — false to freeze the tracers (reduced motion, or paused)
   */
  function build(r, mode, sel, prod, anim) {
    var ref = r ? r.feed.mass : 1200;
    var byKey = {}, q, k, s;
    if (r) for (q = 0; q < r.products.length; q++) byKey[r.products[q].key] = r.products[q];
    var thermal = mode === 'thermal', flowMode = mode === 'flow';
    var Ttop = r ? topTrayT(r) : 120, Tbot = r ? r.energy.Tbot : 350;

    function dim(pick) {
      if (sel) return pick === sel ? 1 : 0.28;
      if (prod) return (pick === 'product-' + prod) ? 1 : 0.24;
      return 1;
    }

    var blocks = [], pipes = [], trays = [], bands = [], tags = [], temps = [];
    var cx = G.towerX + G.towerW / 2;
    var feedY = G.towerY + G.towerH * (1 - 0.205);
    var sumpY = G.towerY + G.towerH;

    /* ── piping, drawn first so equipment sits on top of it ──────────── */
    function pipe(pick, d, col, tph, reverse) {
      var g = gauge(tph, ref), p = pace(tph, ref);
      pipes.push({
        pick: pick, d: d, col: col, w: g, op: dim(pick),
        tracer: anim && p > 0,
        tw: Math.max(1.1, g * 0.42),
        style: 'animation:d2Flow ' + fmt(p, 2) + 's linear infinite' + (reverse ? ' reverse' : ''),
        halo: flowMode ? (g + 6).toFixed(1) : 0
      });
    }

    var fMass = r ? r.feed.mass : 0;
    // crude in, through the heater, to the flash zone
    pipe('crude', 'M20 ' + (G.furY + 74) + ' H' + (G.furX + 18) + ' V' + (G.furY + G.furH - 10),
         COL.crude, fMass);
    pipe('feed', 'M' + (G.furX + G.furW) + ' ' + (G.furY + 22) +
                 ' H' + (G.furX + G.furW + 46) + ' V' + feedY + ' H' + G.towerX,
         COL.hot, fMass);
    // overhead to the condenser, condensate to the drum
    pipe('overhead', 'M' + cx + ' ' + G.towerY + ' V26 H' + (G.condX + G.condW / 2) + ' V' + G.condY,
         COL.vapour, r ? ovMass(byKey) : 0);
    pipe('condenser', 'M' + (G.condX + G.condW / 2) + ' ' + (G.condY + G.condH) +
                      ' V' + G.drumY, COL.reflux, r ? ovMass(byKey) : 0);
    // reflux back over the top of the tower
    pipe('reflux', 'M' + G.drumX + ' ' + (G.drumY + G.drumH / 2) +
                   ' H' + (G.towerX - 42) + ' V' + (G.towerY + 24) + ' H' + G.towerX,
         COL.reflux, r ? r.internals.Ltop * r.feed.M / 1000 : 0);
    // stripping steam into the base
    pipe('steam', 'M' + (G.towerX - 130) + ' ' + (sumpY - 26) + ' H' + G.towerX,
         COL.steam, r ? r.steam.mass : 0);

    function rundown(key, d) { pipe('product-' + key, d, COL[key],
                                    byKey[key] ? byKey[key].mass : 0); }
    rundown('gas', 'M' + (G.drumX + G.drumW) + ' ' + (G.drumY + 9) +
                   ' H' + (G.railX - 24) + ' V' + LABY.gas + ' H' + G.railX);
    rundown('naphtha', 'M' + (G.drumX + G.drumW) + ' ' + (G.drumY + G.drumH - 8) +
                       ' H' + (G.railX - 46) + ' V' + LABY.naphtha + ' H' + G.railX);

    var sideKeys = ['kerosene', 'diesel', 'gasoil'];
    for (s = 0; s < 3; s++) {
      k = sideKeys[s];
      var drawY = G.towerY + G.towerH * (1 - DRAWF[k]);
      var sTop = drawY + 10, sBot = sTop + G.stripH;
      // shell to stripper, stripper to the rundown rail
      pipe('sidedraw', 'M' + (G.towerX + G.towerW) + ' ' + drawY +
                       ' H' + (G.stripX + G.stripW / 2) + ' V' + sTop,
           COL[k], byKey[k] ? byKey[k].mass : 0);
      // stripped vapour back to the tower, one tray above the draw
      pipe('sidedraw', 'M' + (G.stripX + G.stripW / 2) + ' ' + sTop +
                       ' V' + (drawY - 20) + ' H' + (G.towerX + G.towerW),
           COL.vapour, byKey[k] ? byKey[k].mass * 0.06 : 0, true);
      rundown(k, 'M' + (G.stripX + G.stripW / 2) + ' ' + sBot +
                 ' V' + (sBot + 16 + s * 5) + ' H' + (G.railX - 60 + s * 18) +
                 ' V' + LABY[k] + ' H' + G.railX);
      blocks.push(mkBlock('sidedraw', G.stripX, sTop, G.stripW, G.stripH, '', '', 5));
      tags.push({ x: G.stripX + G.stripW / 2, y: sTop + G.stripH / 2 + 3, size: 8,
                  anchor: 'middle', op: 0.85 * dim('sidedraw'), col: COL[k],
                  text: 'ST-' + (s + 1) });
    }
    rundown('residue', 'M' + cx + ' ' + sumpY + ' V' + G.baseY +
                       ' H' + (G.railX - 80) + ' V' + LABY.residue + ' H' + G.railX);

    /* ── the tower: shell, thermal bands, trays, then an outline on top ── */
    var NB = 16;
    for (var b = 0; b < NB; b++) {
      var f0 = b / NB, f1 = (b + 1) / NB;                    // 0 at the sump
      var y = G.towerY + G.towerH * (1 - f1), hh = G.towerH / NB;
      var tAt = Ttop + (Tbot - Ttop) * (1 - (f0 + f1) / 2);
      bands.push({ x: G.towerX + 1, y: y, w: G.towerW - 2, h: hh + 0.7,
                   fill: heat(tAt, T_LO, T_HI),
                   op: (thermal ? 0.80 : 0.14) * dim('tower') });
    }
    for (var t2 = 0; t2 < 24; t2++) {
      var ty = G.towerY + 26 + (G.towerH - 60) * (t2 / 23);
      trays.push({ x1: G.towerX + 10, x2: G.towerX + G.towerW - 10, y: ty,
                   op: (sel === 'trays' || sel === 'tower' || !sel) ? 0.5 : 0.15 });
    }
    var tower = mkBlock('tower', G.towerX, G.towerY, G.towerW, G.towerH, '', '', 12);
    tower.hollow = true;

    /* ── the rest of the equipment ───────────────────────────────────── */
    blocks.push(mkBlock('furnace', G.furX, G.furY, G.furW, G.furH, 'FIRED HEATER',
                        r ? fmt(r.energy.furnace, 0) + ' MW' : '—'));
    // keyed into the firebox rather than floating above it
    blocks.push(mkBlock('furnace', G.stackX, G.stackY, G.stackW, G.furY - G.stackY + 14, '', '', 3));
    blocks.push(mkBlock('condenser', G.condX, G.condY, G.condW, G.condH, 'CONDENSER',
                        r ? fmt(r.energy.condenser, 0) + ' MW' : '—', 5));
    blocks.push(mkBlock('drum', G.drumX, G.drumY, G.drumW, G.drumH, 'REFLUX DRUM',
                        r ? fmt(r.energy.Ttop, 0) + ' °C' : '', 22));

    function mkBlock(pick, x, y, w, h, label, sub, rx) {
      return { pick: pick, x: x, y: y, w: w, h: h, rx: rx == null ? 6 : rx,
               label: label, sub: sub || '', hollow: false,
               lx: x + w / 2, ly: y + h / 2 - (sub ? 3 : -3),
               sy: y + h / 2 + 11,
               op: dim(pick), cls: 'd2-blk' + (pick === sel ? ' on' : '') };
    }

    /* ── static annotation ───────────────────────────────────────────── */
    tags.push({ x: G.towerX - 8, y: G.towerY - 14, size: 9, anchor: 'end',
                op: dim('tower'), col: '#a7b6d2', text: 'ATMOSPHERIC COLUMN' });
    tags.push({ x: 20, y: G.furY + 58, size: 8.5, anchor: 'start',
                op: dim('crude'), col: '#8996b0', text: 'CRUDE CHARGE' });
    tags.push({ x: G.towerX - 132, y: sumpY - 34, size: 8.5, anchor: 'start',
                op: dim('steam'), col: '#8996b0', text: 'STRIPPING STEAM' });
    tags.push({ x: G.furX + G.furW + 52, y: feedY + 16, size: 8.5, anchor: 'start',
                op: dim('feed'), col: '#c09070', text: 'TRANSFER LINE' });
    tags.push({ x: G.stackX + G.stackW / 2, y: G.stackY - 7, size: 8, anchor: 'middle',
                op: dim('furnace'), col: '#8996b0', text: 'STACK' });

    if (r) {
      // Inside the shell, where no pipe can cross them, and in thermal mode
      // sitting on the very band whose temperature they state.
      temps.push({ x: cx, y: G.towerY + 21, anchor: 'middle', text: fmt(Ttop, 0) + ' °C' });
      for (s = 0; s < 3; s++) {
        k = sideKeys[s];
        var p2 = byKey[k];
        if (!p2) continue;
        temps.push({ x: cx, y: G.towerY + G.towerH * (1 - DRAWF[k]) - 6,
                     anchor: 'middle', text: fmt(p2.drawT, 0) + ' °C' });
      }
      temps.push({ x: cx, y: feedY - 7,  anchor: 'middle', text: fmt(r.flash.T, 0) + ' °C' });
      temps.push({ x: cx, y: sumpY - 12, anchor: 'middle', text: fmt(r.energy.Tbot, 0) + ' °C' });
    }

    /* ── the product column ──────────────────────────────────────────── */
    var order = ['gas', 'naphtha', 'kerosene', 'diesel', 'gasoil', 'residue'];
    var out = [];
    for (q = 0; q < order.length; q++) {
      k = order[q];
      var p3 = byKey[k];
      out.push({
        key: k, pick: 'product-' + k, x: G.labX, y: LABY[k],
        col: COL[k], name: p3 ? p3.name : k,
        rate: p3 ? (p3.mass >= 100 ? fmt(p3.mass, 0) : fmt(p3.mass, 1)) : '—',
        pct: p3 ? fmt(p3.pct, 1) + ' % of charge' : '',
        cut: p3 && p3.mass > 0.05 ? fmt(p3.tbp5, 0) + '–' + fmt(p3.tbp95, 0) + ' °C' : '',
        op: dim('product-' + k),
        on: (prod === k || sel === 'product-' + k) ? 1 : 0,
        tick: { x1: G.railX, x2: G.labX - 6, y: LABY[k] }
      });
    }

    /* ── the thermal legend, shown only when it means something ──────── */
    var legend = null;
    if (thermal) {
      var stops = [];
      for (q = 0; q <= 8; q++) {
        var tv = T_LO + (T_HI - T_LO) * q / 8;
        stops.push({ off: (q / 8 * 100).toFixed(0) + '%', col: heat(tv, T_LO, T_HI) });
      }
      legend = { x: 24, y: H - 44, w: 200, h: 9, stops: stops,
                 lo: T_LO + ' °C', hi: T_HI + ' °C' };
    }

    return { w: W, h: H, blocks: blocks, tower: tower, bands: bands, trays: trays,
             pipes: pipes, tags: tags, out: out, temps: temps, legend: legend,
             thermal: thermal, flowMode: flowMode, hasLegend: !!legend };
  }

  return { build: build, COL: COL, heat: heat, gauge: gauge, pace: pace,
           G: G, T_LO: T_LO, T_HI: T_HI };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RIG2D;
