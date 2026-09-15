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

  /* Colours come from theme.js, in whichever theme is current, so the flow
     sheet and the 3D scene can never disagree about what diesel looks like. */
  function col() { return THEME.get().stream; }

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

  /** Tower wall tint for a temperature. The ramp lives in theme.js so the
   *  tower bands, the stage dots and the profile chart all tell one story. */
  function heat(t, lo, hi) { return THEME.heat(t, lo, hi); }

  /**
   * Build the diagram.
   *   r     — a CDU result, or null before the first run
   *   mode  — 'material' | 'thermal' | 'flow'
   *   sel   — selected pick key
   *   prod  — emphasised product key
   *   anim  — false to freeze the tracers (reduced motion, or paused)
   */
  function build(r, mode, sel, prod, anim) {
    var C = col(), SH = THEME.get().sheet;
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

    var blocks = [], pipes = [], trays = [], bands = [], tags = [], temps = [], detail = [];
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
         C.crude, fMass);
    pipe('feed', 'M' + (G.furX + G.furW) + ' ' + (G.furY + 22) +
                 ' H' + (G.furX + G.furW + 46) + ' V' + feedY + ' H' + G.towerX,
         C.hot, fMass);
    // overhead to the condenser, condensate to the drum
    pipe('overhead', 'M' + cx + ' ' + G.towerY + ' V26 H' + (G.condX + G.condW / 2) + ' V' + G.condY,
         C.vapour, r ? ovMass(byKey) : 0);
    pipe('condenser', 'M' + (G.condX + G.condW / 2) + ' ' + (G.condY + G.condH) +
                      ' V' + G.drumY, C.reflux, r ? ovMass(byKey) : 0);
    // reflux back over the top of the tower
    pipe('reflux', 'M' + G.drumX + ' ' + (G.drumY + G.drumH / 2) +
                   ' H' + (G.towerX - 42) + ' V' + (G.towerY + 24) + ' H' + G.towerX,
         C.reflux, r ? r.internals.Ltop * r.feed.M / 1000 : 0);
    // stripping steam into the base
    pipe('steam', 'M' + (G.towerX - 130) + ' ' + (sumpY - 26) + ' H' + G.towerX,
         C.steam, r ? r.steam.mass : 0);

    function rundown(key, d) { pipe('product-' + key, d, C[key],
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
           C[k], byKey[k] ? byKey[k].mass : 0);
      // stripped vapour back to the tower, one tray above the draw
      pipe('sidedraw', 'M' + (G.stripX + G.stripW / 2) + ' ' + sTop +
                       ' V' + (drawY - 20) + ' H' + (G.towerX + G.towerW),
           C.vapour, byKey[k] ? byKey[k].mass * 0.06 : 0, true);
      rundown(k, 'M' + (G.stripX + G.stripW / 2) + ' ' + sBot +
                 ' V' + (sBot + 16 + s * 5) + ' H' + (G.railX - 60 + s * 18) +
                 ' V' + LABY[k] + ' H' + G.railX);
      blocks.push(mkBlock('sidedraw', G.stripX, sTop, G.stripW, G.stripH, '', '', 5));
      tags.push({ x: G.stripX + G.stripW / 2, y: sTop + G.stripH / 2 + 3, size: 8,
                  anchor: 'middle', op: 0.85 * dim('sidedraw'), col: C[k],
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
    tower.fill = SH.shell;

    /* ── the rest of the equipment ───────────────────────────────────── */
    blocks.push(mkBlock('furnace', G.furX, G.furY, G.furW, G.furH, 'FIRED HEATER',
                        r ? fmt(r.energy.furnace, 0) + ' MW' : '—', 6, 'below'));
    // keyed into the firebox rather than floating above it
    blocks.push(mkBlock('furnace', G.stackX, G.stackY, G.stackW, G.furY - G.stackY + 14, '', '', 3));
    blocks.push(mkBlock('condenser', G.condX, G.condY, G.condW, G.condH, 'CONDENSER',
                        r ? fmt(r.energy.condenser, 0) + ' MW' : '—', 5, 'left'));
    blocks.push(mkBlock('drum', G.drumX, G.drumY, G.drumW, G.drumH, 'REFLUX DRUM',
                        r ? fmt(r.energy.Ttop, 0) + ' °C' : '', 22, 'below'));

    /** A line of equipment detail: the internals that tell one grey box from
     *  another. A block with nothing in it is a block; a block with a tube
     *  bundle in it is a condenser, and the difference is what makes a flow
     *  sheet readable rather than decorative. */
    function det(pick, d, c, w, opFactor) {
      detail.push({ pick: pick, d: d, col: c, w: w || 1.3,
                    op: dim(pick) * (opFactor == null ? 0.85 : opFactor) });
    }

    /** A block, and where its two lines of text go.
     *
     *  `place` matters once the equipment has internals in it: a name written
     *  across a tube bundle is unreadable, and every piece here has a
     *  different empty side to put it on. 'in' is only right for a box big
     *  enough to be empty in the middle. */
    function mkBlock(pick, x, y, w, h, label, sub, rx, place) {
      var lx = x + w / 2, ly, sy, anchor = 'middle';
      if (place === 'above')      { ly = y - 15;      sy = y - 4; }
      else if (place === 'below') { ly = y + h + 14;  sy = y + h + 26; }
      else if (place === 'left')  { lx = x - 8; anchor = 'end';
                                    ly = y + h / 2 - 3; sy = y + h / 2 + 9; }
      else                        { ly = y + h / 2 - (sub ? 3 : -3); sy = y + h / 2 + 11; }
      return { pick: pick, x: x, y: y, w: w, h: h, rx: rx == null ? 6 : rx,
               label: label, sub: sub || '', hollow: false,
               lx: lx, ly: ly, sy: sy, anchor: anchor,
               op: dim(pick), cls: 'd2-blk' + (pick === sel ? ' on' : '') };
    }

    /* ── what makes each box the thing it is ─────────────────────────── */
    // fired heater: a bridgewall, radiant tubes down the near wall, burners
    // along the floor and a convection bank under the stack
    var fbY = G.furY + G.furH, i2;
    var burn = '';
    for (i2 = 0; i2 < 4; i2++) {
      var bx = G.furX + 22 + i2 * (G.furW - 44) / 3;
      burn += 'M' + (bx - 7) + ' ' + (fbY - 9) + ' l7 -13 l7 13 ';
    }
    det('furnace', burn, C.hot, 1.7, 0.95);
    var rt = '';
    for (i2 = 0; i2 < 6; i2++) {
      var rx2 = G.furX + 16 + i2 * (G.furW - 32) / 5;
      rt += 'M' + rx2 + ' ' + (G.furY + 40) + ' V' + (fbY - 24) + ' ';
    }
    det('furnace', rt, C.crude, 1.5, 0.7);
    det('furnace', 'M' + (G.furX + 8) + ' ' + (G.furY + 30) + ' H' + (G.furX + G.furW - 8),
        SH.tray, 1.2, 0.6);
    var cvx = G.stackX + G.stackW / 2, cvw = 34, cvt = '';
    for (i2 = 0; i2 < 4; i2++)
      cvt += 'M' + (cvx - cvw / 2) + ' ' + (G.furY + 4 + i2 * 6) + ' H' + (cvx + cvw / 2) + ' ';
    det('furnace', cvt, SH.tray, 1.2, 0.7);
    det('furnace', 'M' + (G.stackX - 5) + ' ' + G.stackY + ' H' + (G.stackX + G.stackW + 5),
        SH.tray, 1.6, 0.7);

    // condenser: a tube bundle between two tubesheets, and the cooling water
    // that makes it a condenser rather than a drum
    var ccy = G.condY + G.condH / 2, tb = '';
    for (i2 = 0; i2 < 7; i2++) {
      var tx = G.condX + 14 + i2 * (G.condW - 28) / 6;
      tb += 'M' + tx + ' ' + (G.condY + 7) + ' V' + (G.condY + G.condH - 7) + ' ';
    }
    det('condenser', tb, SH.tray, 1.2, 0.75);
    det('condenser', 'M' + (G.condX + 8) + ' ' + (G.condY + 4) + ' V' + (G.condY + G.condH - 4) +
                     ' M' + (G.condX + G.condW - 8) + ' ' + (G.condY + 4) + ' V' + (G.condY + G.condH - 4),
        SH.label, 1.5, 0.7);
    det('condenser', 'M' + (G.condX + 26) + ' ' + (G.condY + G.condH + 14) + ' V' + (G.condY + G.condH) +
                     ' M' + (G.condX + G.condW - 26) + ' ' + (G.condY + G.condH) + ' V' + (G.condY + G.condH + 14),
        C.steam, 1.6, 0.8);
    // clear of the condensate drop, which runs down the shell's centre line
    tags.push({ x: G.condX + G.condW - 8, y: G.condY + G.condH + 25, size: 7.5,
                anchor: 'start', op: dim('condenser') * 0.8, col: SH.quiet, text: 'COOLING WATER' });

    // reflux drum: an operating level and the boot the water drops into
    det('drum', 'M' + (G.drumX + 8) + ' ' + (G.drumY + G.drumH * 0.58) + ' H' + (G.drumX + G.drumW - 8),
        C.reflux, 2.0, 0.85);
    det('drum', 'M' + (G.drumX + G.drumW * 0.32) + ' ' + (G.drumY + G.drumH) + ' v10 h16 v-10',
        SH.label, 1.4, 0.7);

    // side strippers: four trays and the stripping steam under them
    for (s = 0; s < 3; s++) {
      var k2 = sideKeys[s];
      var dY = G.towerY + G.towerH * (1 - DRAWF[k2]), stT = dY + 10;
      var st = '';
      for (i2 = 1; i2 <= 4; i2++)
        st += 'M' + (G.stripX + 7) + ' ' + (stT + G.stripH * i2 / 5) + ' H' + (G.stripX + G.stripW - 7) + ' ';
      det('sidedraw', st, SH.tray, 1.1, 0.7);
      det('sidedraw', 'M' + (G.stripX - 16) + ' ' + (stT + G.stripH - 10) + ' H' + G.stripX,
          C.steam, 1.5, 0.8);
    }

    // the tower's own nozzles, so every line lands on something
    var noz = '';
    function stub(x, y, dx2) { noz += 'M' + x + ' ' + y + ' h' + dx2 + ' '; }
    stub(G.towerX, feedY, -12);
    stub(G.towerX + G.towerW, G.towerY + G.towerH * (1 - DRAWF.kerosene), 12);
    stub(G.towerX + G.towerW, G.towerY + G.towerH * (1 - DRAWF.diesel), 12);
    stub(G.towerX + G.towerW, G.towerY + G.towerH * (1 - DRAWF.gasoil), 12);
    stub(G.towerX, G.towerY + 24, -12);
    stub(G.towerX, sumpY - 26, -12);
    det('tower', noz, SH.label, 3.2, 0.55);
    // the skirt the tower stands on
    det('tower', 'M' + (G.towerX + 12) + ' ' + sumpY + ' V' + (sumpY + 26) +
                 ' M' + (G.towerX + G.towerW - 12) + ' ' + sumpY + ' V' + (sumpY + 26) +
                 ' M' + (G.towerX + 4) + ' ' + (sumpY + 26) + ' H' + (G.towerX + G.towerW - 4),
        SH.label, 1.6, 0.55);

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
        col: C[k], name: p3 ? p3.name : k,
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
             pipes: pipes, tags: tags, out: out, temps: temps, detail: detail, legend: legend,
             thermal: thermal, flowMode: flowMode, hasLegend: !!legend,
             theme: THEME.mode(), sheet: SH };
  }

  return { build: build, heat: heat, gauge: gauge, pace: pace,
           G: G, T_LO: T_LO, T_HI: T_HI,
           get COL() { return THEME.get().stream; } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RIG2D;
