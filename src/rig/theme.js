/* ════════════════════════════════════════════════════════════════════════
   theme.js — the design system, as data.

   One file holds every colour the simulator uses, in two themes, and every
   other layer reads from here: the WebGL scene, the flow sheet, the charts
   and the interface. Nothing downstream owns a colour of its own.

   ── How the palette was built ──────────────────────────────────────────
   Everything was designed in OKLCH and converted, so lightness means the
   same thing across hues and the two themes are the same palette under
   different light rather than two unrelated sets.

   HUE IS HELD CONSTANT between themes. Only lightness and chroma move. A
   stream therefore keeps its identity when the lights come on: diesel is
   the same orange, darker.

   Two stream families, so a product is never mistaken for a utility:

     PRODUCTS  a sequential ramp, cold to hot — which is also the order of
               boiling point, and roughly how a jar of each cut actually
               looks: wet gas a colourless vapour, naphtha pale straw,
               kerosene amber, diesel orange-brown, gas oil dark amber,
               residue nearly black-red.
     UTILITIES cool or neutral. Crude is deliberately the dullest line on
               the plot because it is the one stream that has not been
               separated into anything yet.

   Lightness RAMPS DOWN as the cut gets heavier. A flat lightness across the
   warm half of the gamut cannot hold chroma — diesel, gas oil and residue
   collapse into one washed salmon — and the ramp is physically truthful.

   The interface accent is indigo, deliberately outside the process ramp
   (teal through crimson), so the chrome can never be mistaken for a stream.

   ── What is guaranteed ─────────────────────────────────────────────────
   Checked by the `theme` suite in tools/test.js, in BOTH themes:
     · every text tone clears WCAG 1.4.3 (4.5:1) on every surface it can
       appear over;
     · every stream clears 3:1 against the ground and the panel, the bar
       for non-text graphics under WCAG 1.4.11;
     · no two streams collide.
   ════════════════════════════════════════════════════════════════════════ */
var THEME = (function () {
  'use strict';

  /** sRGB hex to linear-space RGB, which is what the shaders want. */
  function lin(hex) {
    var o = [], i, c;
    for (i = 1; i < 7; i += 2) {
      c = parseInt(hex.substr(i, 2), 16) / 255;
      o.push(c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    }
    return o;
  }

  var DARK = {
    name: 'dark',

    /* ── surfaces and text ──────────────────────────────────────────── */
    ui: {
      floor:'#090c13', rail:'#10141c', panel:'#171b24', ctrl:'#212630', ctrl2:'#2a2f3a',
      line:'#303540', line2:'#474d59',
      ink:'#f1f3f8', ink2:'#b0b6c2', ink3:'#9098a9',
      accent:'#7d95ff', onAccent:'#090f1c',
      ok:'#58da98', warn:'#f2b036', err:'#ffa09c', busy:'#3ecfff', viol:'#c9acff'
    },

    /* ── process streams ────────────────────────────────────────────── */
    stream: {
      gas:'#3ae3d3', naphtha:'#f1cd2e', kerosene:'#f8ae00', diesel:'#fa8927',
      gasoil:'#f16b40', residue:'#e84d64',
      crude:'#9e886e', hot:'#ff763b', vapour:'#39d4e4', reflux:'#49adec', steam:'#acd8e6',
      // The eight atmospheric cuts, in the same order and the same colours the
      // landing page uses for them in CSS (--dx-f1 … --dx-f8). They live here
      // so the 3D tower can be re-tinted by retheme() like any other stream.
      f1:'#00beaf', f2:'#4ac06c', f3:'#c2a200', f4:'#d79700',
      f5:'#ef852e', f6:'#f77c56', f7:'#f97772', f8:'#f6758e'
    },

    /* ── the flow sheet's own surfaces ──────────────────────────────── */
    sheet: {
      ground:'#0a0e17', bg2:'#0e1420', shell:'#121826',
      block:'#151c2b', blockHover:'#1b2436', blockOn:'#1d2940',
      tray:'#5d6f92', label:'#a7b6d2', quiet:'#8892a6',
      tracer:'#f2f8ff', tracerOp:0.80, traceBlend:'add'
    },

    /* ── the 3D environment ─────────────────────────────────────────── */
    /* Night. The fog is deliberately much lighter than the sky: aerial
       perspective is what gives a dark scene its depth, and without it the
       far side of the plant merges into the near side. */
    env: {
      skyTop:'#0a1024', skyHorizon:'#141d33', skyGlow:'#5a3418', fog:'#40495e',
      expo: 1.18, fogD: 0.0030, fogCap: 0.62,
      key:  [0.46, 0.78, 0.44], keyC:'#fff9f0', keyI: 1.52,
      fill: '#9dacc8', fillI: 1.00,
      back: [-0.62, 0.30, -0.72], backC:'#7c95bf', backI: 1.00,
      rim:  '#95cef6', rimI: 1.00,
      skyFill: 0.75, ao: 0.56,
      deck: '#1b2130', concrete:'#848488'
    },

    /* ── the thermal ramp: one story, told twice ────────────────────── */
    heat: [[0.00,'#5d7ee6'], [0.30,'#00c8d8'], [0.56,'#febf32'], [0.78,'#f47f46'], [1.00,'#dc5c66']]
  };

  var LIGHT = {
    name: 'light',

    ui: {
      floor:'#f0f3f8', rail:'#fbfcff', panel:'#ffffff', ctrl:'#f8fafe', ctrl2:'#edf0f6',
      line:'#d6d9e0', line2:'#c0c4cd',
      ink:'#191e29', ink2:'#4f5767', ink3:'#5c6578',
      accent:'#4454df', onAccent:'#ffffff',
      ok:'#007d4d', warn:'#8b6000', err:'#b63039', busy:'#007494', viol:'#7a4aba'
    },

    stream: {
      gas:'#009185', naphtha:'#9e8400', kerosene:'#ab7600', diesel:'#aa5600',
      gasoil:'#b33600', residue:'#ba003a',
      crude:'#7d684d', hot:'#c64900', vapour:'#00848f', reflux:'#006ca0', steam:'#568999',
      f1:'#00786f', f2:'#007c37', f3:'#7f6a00', f4:'#8f6300',
      f5:'#a85500', f6:'#b9441c', f7:'#bc4040', f8:'#ba3e5b'
    },

    sheet: {
      ground:'#eef1f7', bg2:'#e6ebf3', shell:'#ffffff',
      block:'#ffffff', blockHover:'#f2f5fb', blockOn:'#eaf0fe',
      tray:'#aab3c6', label:'#5c6578', quiet:'#6d7688',
      // Additive blending is invisible on a bright ground, so in daylight the
      // tracers are drawn as ordinary alpha over the pipe, in a dark tone.
      tracer:'#0d1b2e', tracerOp:0.62, traceBlend:'alpha'
    },

    /* Daylight. The temptation is to flood the scene with sky, and it is the
       wrong instinct: an even bath of ambient light removes every shadow and
       the plant goes flat and chalky. A bright environment wants a STRONGER
       key and a WEAKER fill than a dark one, so the form still reads, plus a
       lower exposure because the same albedo is catching far more light. */
    env: {
      skyTop:'#9fc0e8', skyHorizon:'#dfe8f2', skyGlow:'#e8d2b4', fog:'#c8d4e5',
      expo: 0.86, fogD: 0.0024, fogCap: 0.52,
      key:  [0.44, 0.80, 0.41], keyC:'#fff9f0', keyI: 1.55,
      fill: '#909db3', fillI: 1.00,
      back: [-0.62, 0.34, -0.70], backC:'#818ea0', backI: 1.00,
      // A rim light on a bright background reads as a halo artifact, so in
      // daylight it is turned right down.
      rim:  '#95adc8', rimI: 0.34,
      skyFill: 0.52, ao: 0.60,
      deck: '#9ba1a9', concrete:'#b8babf'
    },

    heat: [[0.00,'#3552bc'], [0.30,'#008b96'], [0.56,'#bb8800'], [0.78,'#bd4d00'], [1.00,'#af283d']]
  };

  /* Linear-space mirrors of everything the shaders touch, computed once. */
  function prep(t) {
    var k;
    t.streamLin = {};
    for (k in t.stream) if (t.stream.hasOwnProperty(k)) t.streamLin[k] = lin(t.stream[k]);
    t.envLin = {};
    ['skyTop', 'skyHorizon', 'skyGlow', 'fog', 'keyC', 'fill', 'backC', 'rim', 'deck', 'concrete']
      .forEach(function (n) { t.envLin[n] = lin(t.env[n]); });
    return t;
  }
  prep(DARK); prep(LIGHT);

  var P = { dark: DARK, light: LIGHT };
  var MODE = 'dark';

  /** Interpolate the thermal ramp. lo/hi are the fixed ends of the scale —
   *  fixed so a colour means one temperature from run to run. */
  function heat(t, lo, hi, mode) {
    var st = P[mode || MODE].heat;
    var u = (t - lo) / Math.max(1e-6, hi - lo);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    for (var i = 1; i < st.length; i++) {
      if (u <= st[i][0]) {
        var a = st[i-1], b = st[i], w = (u - a[0]) / (b[0] - a[0]);
        return mixHex(a[1], b[1], w);
      }
    }
    return st[st.length - 1][1];
  }
  function mixHex(a, b, w) {
    var o = 'rgb(', i, x, y;
    for (i = 1; i < 7; i += 2) {
      x = parseInt(a.substr(i, 2), 16); y = parseInt(b.substr(i, 2), 16);
      o += Math.round(x + (y - x) * w) + (i < 5 ? ',' : ')');
    }
    return o;
  }

  return {
    lin: lin,
    heat: heat,
    modes: ['dark', 'light'],
    mode: function () { return MODE; },
    set: function (m) { MODE = (m === 'light') ? 'light' : 'dark'; return P[MODE]; },
    get: function () { return P[MODE]; },
    of: function (m) { return P[m] || P.dark; }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = THEME;
