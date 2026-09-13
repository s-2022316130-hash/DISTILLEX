/* ════════════════════════════════════════════════════════════════════════
   ui.js — the whole interface of the standalone crude unit.

   No framework, no build step, no dependencies. State lives in one object;
   changing it calls render(); render() rebuilds the small regions of the DOM
   that depend on it. The 3D scene is NOT rebuilt by render() — it has its own
   animation loop and is told about state changes directly, because a 60 Hz
   scene must not drag a DOM diff behind it.

   The rule the whole file obeys: nothing here computes a process quantity.
   Every number displayed came out of CDU.run(). When there is no result, the
   interface shows an em dash and says why — it never fills the gap with
   something plausible.

   Read in this order:
     S              the state
     render()       what is drawn from it
     run()          the only thing that produces numbers
     applyResult()  how a result reaches the scene
   ════════════════════════════════════════════════════════════════════════ */
var APP = (function () {
  'use strict';

  /* ── state ─────────────────────────────────────────────────────────────
     One object. Anything that changes what is on screen lives here; anything
     that is a handle on the WebGL scene lives in the vars below it. */
  var S = {
    inputs: CDU.baseCase(),   // the operator's settings — the solver's input
    r: null,                  // the last result, or null
    pre: null,                // the feed half of a run, while it is working
    status: 'ready',          // ready | calculating | converging | complete | warning | error
    errs: [], warns: [],
    sel: null,                // selected pick id, shared by both views
    prod: null,               // emphasised product key
    stage: -1,                // selected stage index
    mode: 'material',         // material | thermal | flow
    view: '3d',               // 3d | 2d | split
    flow: true,
    open: { feed: true, furnace: true, column: false, products: false, adv: false },
    dirty: false,             // the panel has moved since the result was solved
    expert: false,
    tour: -1,
    hist: []
  };

  var gl = null, plant = null, cams = null, camPreset = 'plant';
  var raf = 0, tourTimer = null, tagEls = [], hoverRaf = 0, hoverAt = 0;
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ── DOM helpers ───────────────────────────────────────────────────── */
  function h(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    if (attrs) for (k in attrs) if (attrs.hasOwnProperty(k)) {
      if (k === 'style' || k === 'class') n.setAttribute(k === 'class' ? 'class' : 'style', attrs[k]);
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] === true) n.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    add(n, kids);
    return n;
  }
  var NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, kids) {
    var n = document.createElementNS(NS, tag), k;
    if (attrs) for (k in attrs) if (attrs.hasOwnProperty(k)) {
      if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    }
    add(n, kids);
    return n;
  }
  function add(n, kids) {
    if (kids == null) return;
    if (!Array.isArray(kids)) kids = [kids];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
  }
  function $(id) { return document.getElementById(id); }
  function fill(node, kids) { while (node.firstChild) node.removeChild(node.firstChild); add(node, kids); }

  /* ── number formatting ─────────────────────────────────────────────────
     Digits chosen for what the model can support. A tower temperature from a
     pseudocomponent model is worth a degree, not a tenth of one. */
  var DASH = '—';
  function fmt(v, d) { return (v == null || !isFinite(v)) ? DASH : (+v).toFixed(d); }
  function rate(v) { return !isFinite(v) ? DASH : (Math.abs(v) >= 100 ? (+v).toFixed(0) : (+v).toFixed(1)); }
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function expo(v) {
    if (!isFinite(v) || v === 0) return '0';
    var e = Math.floor(Math.log10(Math.abs(v)));
    var sup = { '-': '⁻', 0:'⁰', 1:'¹', 2:'²', 3:'³', 4:'⁴',
                5:'⁵', 6:'⁶', 7:'⁷', 8:'⁸', 9:'⁹' };
    return (v / Math.pow(10, e)).toFixed(1) + '×10' +
           String(e).split('').map(function (c) { return sup[c] || c; }).join('');
  }

  /* ── the operator panel's shape ────────────────────────────────────── */
  var SECTIONS = [
    { key:'feed', label:'Feed', hint:'What the unit is charged with, and how much of it.',
      keys:['feedRate', 'feedT'] },
    { key:'furnace', label:'Furnace', hint:'The heat that decides how much can vaporise.',
      keys:['furnaceT'] },
    { key:'column', label:'Column', hint:'Pressure, reflux and the steam that does the stripping.',
      keys:['colP', 'topP', 'reflux', 'steam', 'sideSteam', 'drumT'] },
    { key:'products', label:'Product draws', hint:'How much liquid each side draw takes, as a percentage of the charge.',
      keys:['drawKero', 'drawDiesel', 'drawGasoil'] },
    { key:'adv', label:'Internals', hint:'Tray counts by section. These change how sharp each split is.',
      keys:['stagesTop', 'stagesKero', 'stagesDiesel', 'stagesGasoil', 'stagesWash', 'stagesStrip'] }
  ];
  var HELP = {
    feedRate:'The basis for every yield on this page.',
    feedT:'Preheat-train outlet. It changes the furnace duty, not the flash.',
    furnaceT:'Transfer-line temperature — the strongest handle on the unit.',
    colP:'Flash-zone pressure. Higher pressure means less vaporises.',
    topP:'Overhead pressure. Must be below the flash-zone pressure.',
    reflux:'Returned liquid over distillate. Sharper separation, more condenser duty.',
    steam:'Superheated steam to the tower base, as a percentage of the charge.',
    sideSteam:'Stripping steam to each side stripper, as a percentage of that draw.',
    drumT:'Reflux drum temperature. It fixes the gas/naphtha split, not the tower.',
    drawKero:'Kerosene liquid draw. The tower cannot give more than flows past the tray.',
    drawDiesel:'Diesel liquid draw.',
    drawGasoil:'Heavy gas-oil liquid draw.',
    stagesTop:'Trays between the top and the kerosene draw.',
    stagesKero:'Trays between the kerosene and diesel draws.',
    stagesDiesel:'Trays between the diesel and gas-oil draws.',
    stagesGasoil:'Trays between the gas-oil draw and the wash section.',
    stagesWash:'Wash trays above the flash zone, which keep the gas oil clean.',
    stagesStrip:'Stripping trays below the flash zone.'
  };
  var ASSUMPTIONS = [
    'The crude is 22 narrow-boiling pseudocomponents on a fixed normal-boiling-point grid, each standing in for the n-alkane of the same boiling point. Molar mass follows from that carbon number.',
    'Vapour pressure comes from Clausius–Clapeyron integrated at constant enthalpy of vaporisation, with the latent heat from Kistiakowsky’s rule ΔS_vap = 36.6 + 8.31·ln(T_b) J/(mol·K).',
    'The vapour is ideal and the liquid follows Raoult’s law, so K = Pˢᵃᵗ/P. Reasonable for hydrocarbons near atmospheric pressure; not corrected for non-ideality.',
    'Above the flash zone the tower is a stagewise cascade solved by the bubble-point (Wang–Henke) method, the component balances solved exactly by the Thomas algorithm on every sweep.',
    'Below the flash zone there is no reboiler and the temperature is not free, so that section uses the Kremser group method instead. The two halves meet at the flash zone.',
    'Stripping steam is an inert carrier: it lowers every hydrocarbon partial pressure but does not appear in the equilibrium solve.',
    'Side draws are set as ratios of the liquid flowing past the tray, which makes the material balance close exactly on every iteration rather than only at convergence.',
    'Tray efficiency is not modelled: every stage is a theoretical stage.',
    'Heat losses, tray pressure drop beyond the linear profile, and any cracking in the heater are outside the model.',
    'Nothing here has been validated against a real unit or a commercial simulator. Treat it as a teaching model.'
  ];
  var STATUS = {
    ready:       ['READY', 'The unit is lined out. Press Run simulation to solve it.', 'idle'],
    calculating: ['CALCULATING', 'Characterising the charge and flashing it at the furnace outlet.', 'busy'],
    converging:  ['CONVERGING', 'Iterating the stage cascade.', 'busy'],
    complete:    ['COMPLETE', 'The solver converged and the balance closes.', 'ok'],
    warning:     ['WARNING', 'A result was produced, but it comes with qualifications.', 'warn'],
    error:       ['ERROR', 'No result. The inputs were refused, or the solve failed.', 'err']
  };
  var TONE = { gas:'#78ebd8', naphtha:'#ffd778', kerosene:'#ffbe50',
               diesel:'#fa9e33', gasoil:'#f27038', residue:'#e65c7a' };

  /* ── the run ───────────────────────────────────────────────────────────
     Three painted states, each matching work that is genuinely happening.
     The status never claims convergence the solver did not report. */
  function run() {
    if (S.status === 'calculating' || S.status === 'converging') return;
    var v = CDU.validate(S.inputs);
    if (!v.ok) { set({ status:'error', errs:v.errs, warns:[], r:null, pre:null }); return; }
    set({ status:'calculating', errs:[], warns:[] });
    setTimeout(function () {
      var fp = null;
      try { fp = CDU.feedPhase(S.inputs); } catch (e) { fp = null; }
      if (!fp || !fp.ok) {
        set({ status:'error', errs:(fp && fp.errs) || [{ msg:'The feed could not be characterised.' }] });
        return;
      }
      set({ status:'converging', pre:fp });
      setTimeout(solve, 32);
    }, 32);
  }

  function solve() {
    var r = null, thrown = null;
    try { r = CDU.run(S.inputs); } catch (e) { thrown = (e && e.message) || String(e); }
    if (thrown || !r || !r.ok) {
      set({ status:'error', r:null, pre:null,
            errs:(r && r.errs) || [{ msg: thrown || 'The solver could not produce a result for these inputs.' }],
            warns:(r && r.warns) || [] });
      if (gl) { gl.setFlow({}); gl.state.thermal = null; }
      return;
    }
    var entry = {
      at: new Date().toISOString().slice(11, 19),
      assay: S.inputs.assay, furnaceT: S.inputs.furnaceT, reflux: S.inputs.reflux,
      feedRate: S.inputs.feedRate, conv: r.converged, outer: r.outer, ms: Math.round(r.ms),
      yield: r.products.filter(function (p) { return p.key !== 'residue'; })
                       .reduce(function (a, p) { return a + p.pct; }, 0),
      snap: JSON.parse(JSON.stringify(S.inputs))
    };
    set({ status: r.warns.length ? 'warning' : 'complete', r:r, pre:null, errs:[],
          warns:r.warns, hist:[entry].concat(S.hist).slice(0, 8), stage:-1 });
    clearDirty();
    applyResult();
  }

  /** Push a result into the scene. The only place the visualisation learns
   *  anything about the process: tracer density and speed from the computed
   *  mass flows, the thermal ramp from the computed profile. */
  function applyResult() {
    if (!gl) return;
    var r = S.r;
    if (!r) { gl.setFlow({}); gl.state.thermal = null; gl.refresh(); return; }
    var ref = r.feed.mass, spec = {}, ST = PLANT.STREAM;
    function put(key, tph, col) {
      if (!(tph > 0)) { spec[key] = { n:0 }; return; }
      var f = tph / Math.max(1e-6, ref);
      spec[key] = { n: Math.max(2, Math.round(6 + 46 * Math.pow(f, 0.55))),
                    speed: 0.05 + 0.28 * Math.pow(f, 0.35),
                    size: 0.7 + 0.8 * Math.pow(f, 0.3), col: col };
    }
    put('crude', r.feed.mass, ST.crude);
    put('feed', r.feed.mass, ST.hot);
    var ov = r.products.filter(function (p) { return p.key === 'gas' || p.key === 'naphtha'; })
                       .reduce(function (a, p) { return a + p.mass; }, 0);
    put('overhead', ov, ST.vapour);
    put('reflux', r.internals.Ltop * r.feed.M / 1000, ST.reflux);
    put('steam', r.steam.mass, ST.steam);
    for (var i = 0; i < r.products.length; i++)
      put(r.products[i].key, r.products[i].mass, ST[r.products[i].key] || ST.crude);
    gl.setFlow(spec);

    var Ttop = r.internals.Tprofile.length > 1 ? r.internals.Tprofile[1] : r.energy.Ttop;
    var Tbot = r.energy.Tbot, y0 = plant.skirtTop, y1 = plant.shellTop;
    gl.state.thermal = S.mode === 'thermal' ? function (y) {
      var f = Math.max(0, Math.min(1, (y - y0) / Math.max(1e-6, y1 - y0)));
      return heatRGB(Tbot + (Ttop - Tbot) * f);
    } : null;
    gl.refresh();
  }
  /** The thermal ramp as linear-space RGB, from the same stops the flow sheet
   *  uses, so a colour means one temperature in both views. */
  function heatRGB(T) {
    var m = /rgb\((\d+),(\d+),(\d+)\)/.exec(RIG2D.heat(T, 30, 380));
    if (!m) return [0.6, 0.6, 0.6];
    function g(v) { return Math.pow(v / 255, 2.2); }
    return [g(+m[1]), g(+m[2]), g(+m[3])];
  }

  /* ── state changes ─────────────────────────────────────────────────── */
  function set(patch) {
    for (var k in patch) if (patch.hasOwnProperty(k)) S[k] = patch[k];
    render();
  }
  /** Take a value from a slider WITHOUT rebuilding the panel.
   *
   *  This matters more than it looks. render() replaces the nodes it draws,
   *  and replacing the element the pointer is dragging — or the one that has
   *  keyboard focus — ends the drag and drops the focus, so the control moves
   *  one step and then goes dead. Patch the two things that changed instead:
   *  the read-out and the slider's own fill. Nothing else in the interface
   *  depends on an input until the next run. */
  function setInput(k, raw, node) {
    var L = CDU.LIMITS[k], v = parseFloat(raw);
    if (!isFinite(v)) v = S.inputs[k];
    if (L && L.int) v = Math.round(v);
    S.inputs[k] = v;

    var fld = node.parentNode;
    var readout = fld.querySelector('.v');
    if (readout) readout.textContent = (L && L.int) ? String(v) : rate(v);
    node.style.setProperty('--p', ((v - L.min) / (L.max - L.min) * 100).toFixed(1) + '%');
    markDirty();
  }

  /** The panel now describes a case the result on screen was not solved from.
   *  Said once, on the button, without a rebuild. */
  function markDirty() {
    if (S.dirty || !S.r) return;
    S.dirty = true;
    var b = $('run');
    b.textContent = 'Run again';
    b.classList.add('dirty');
  }
  function clearDirty() {
    S.dirty = false;
    var b = $('run');
    b.textContent = S.r ? 'Run again' : 'Run simulation';
    b.classList.remove('dirty');
  }

  /* ── selection, shared by both views ───────────────────────────────── */
  function select(key) {
    var next = (key && key === S.sel) ? null : (key || null);
    var prod = next && next.indexOf('product-') === 0 ? next.slice(8) : null;
    if (gl) { gl.state.sel = next; gl.state.product = prod; gl.refresh(); }
    if (next) camTo(RIGINFO.FOCUS[next] || camPreset || 'plant');
    stopTour();
    set({ sel:next, prod:prod, tour:-1, stage:-1 });
  }
  function selectProduct(key) {
    var next = key === S.prod ? null : key;
    if (gl) { gl.state.product = next; gl.state.sel = next ? 'product-' + next : null; gl.refresh(); }
    if (next) camTo(RIGINFO.FOCUS['product-' + next] || 'plant');
    set({ prod:next, sel: next ? 'product-' + next : null, stage:-1 });
  }
  /** Look at one stage: map the cascade index onto the shell by the same
   *  fractions the solver uses, so the camera lands on the tray the row names. */
  function selectStage(j) {
    var r = S.r;
    if (!r || !plant) return;
    var n = r.internals.Tprofile.length, iFeed = r.internals.feedStage, y;
    if (j === 0) y = plant.shellTop + 2;
    else if (j >= iFeed) y = plant.feedY - (plant.feedY - plant.skirtTop + 1) * ((j - iFeed) / Math.max(1, n - 1 - iFeed));
    else y = plant.shellTop - 3 - (plant.shellTop - 3 - plant.feedY) * ((j - 1) / Math.max(1, iFeed - 1));
    var same = S.stage === j;
    if (gl) {
      gl.state.sel = same ? null : 'trays'; gl.state.product = null; gl.refresh();
      var c = gl.cam;
      c.tYaw = 0.62; c.tPitch = 0.02; c.tDist = 34; c.ttx = 0; c.tty = y; c.ttz = 0;
      camPreset = '';
    }
    stopTour();
    set({ stage: same ? -1 : j, sel: same ? null : 'trays', prod:null, tour:-1 });
  }

  /* ── camera ────────────────────────────────────────────────────────── */
  function camTo(key, snap) {
    if (!gl || !cams) return;
    var c = cams.filter(function (q) { return q.key === key; })[0] || cams[0];
    gl.cam.tYaw = c.yaw; gl.cam.tPitch = c.pitch; gl.cam.tDist = c.dist;
    gl.cam.ttx = c.t[0]; gl.cam.tty = c.t[1]; gl.cam.ttz = c.t[2];
    if (snap) {
      gl.cam.yaw = c.yaw; gl.cam.pitch = c.pitch; gl.cam.dist = c.dist;
      gl.cam.tx = c.t[0]; gl.cam.ty = c.t[1]; gl.cam.tz = c.t[2];
    }
    camPreset = c.key;
  }

  /* ── guided tour ───────────────────────────────────────────────────── */
  function stopTour() { if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; } }
  function tourGo(i) {
    stopTour();
    var T = RIGINFO.TOUR;
    if (i < 0 || i >= T.length) { set({ tour:-1 }); return; }
    var stop = T[i];
    if (gl) { gl.state.sel = stop.sel; gl.state.product = null; gl.refresh(); }
    camTo(stop.cam);
    set({ tour:i, sel:stop.sel, prod:null, stage:-1 });
    tourTimer = setTimeout(function () { tourGo(i + 1); }, 8200);
  }

  /* ── save / load / reset ───────────────────────────────────────────── */
  function reset() {
    stopTour();
    if (gl) { gl.setFlow({}); gl.state.thermal = null; gl.state.sel = null; gl.state.product = null; gl.refresh(); }
    set({ inputs: CDU.baseCase(), r:null, pre:null, status:'ready', errs:[], warns:[],
          sel:null, prod:null, tour:-1, stage:-1 });
    clearDirty();
  }
  function save() {
    try {
      var doc = { app:'CRUDE-UNIT', kind:'crude-unit-case', version:1,
                  saved:new Date().toISOString(), inputs:S.inputs };
      var url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type:'application/json' }));
      var a = document.createElement('a');
      a.href = url; a.download = 'crude-unit-case.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('Operating case saved');
    } catch (e) { toast('Could not save the case in this browser'); }
  }
  function load(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var o = JSON.parse(rd.result), src = (o && o.inputs) || o;
        var base = CDU.baseCase(), clean = {};
        for (var k in base) if (base.hasOwnProperty(k))
          clean[k] = (src && src[k] !== undefined) ? src[k] : base[k];
        var v = CDU.validate(clean);
        set({ inputs:clean, status:'ready', r:null, pre:null, errs:[], warns:[] });
        clearDirty();
        toast(v.ok ? 'Operating case loaded'
                   : 'Case loaded, but ' + v.errs.length + ' value(s) are outside their range');
      } catch (err) { toast('Could not read that file — expected a saved case'); }
    };
    rd.readAsText(f);
    ev.target.value = '';
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
  }

  /* ══ render ═══════════════════════════════════════════════════════════
     Each region is rebuilt from S. The regions are small, so replacing them
     wholesale is simpler than diffing and fast enough to be invisible. The
     3D canvas is never touched here. */
  function render() {
    renderBar();
    renderPanel();
    renderStage();
    renderResults();
    renderProducts();
    renderOverlay();
  }

  /* ── the bar ───────────────────────────────────────────────────────── */
  function renderBar() {
    var st = STATUS[S.status] || STATUS.ready;
    fill($('pill'), [h('i'), st[0]]);
    $('pill').className = 'pill ' + st[2];
    function segs(list, cur, onPick) {
      return h('div', { class:'segs', role:'group' }, list.map(function (p) {
        return h('button', { class:'seg' + (cur === p[0] ? ' on' : ''),
                             onclick: function () { onPick(p[0]); } }, p[1]);
      }));
    }
    fill($('tools'), [
      segs([['3d','3D'], ['2d','Process'], ['split','Both']], S.view, function (v) { set({ view:v }); }),
      segs([['material','Material'], ['thermal','Thermal'], ['flow','Flow']], S.mode, function (m) {
        S.mode = m;
        if (gl) gl.state.mode = m;
        applyResult();
        render();
      }),
      h('button', { class:'ghost', onclick: function () {
        if (S.tour >= 0) { stopTour(); set({ tour:-1 }); } else tourGo(0);
      } }, S.tour >= 0 ? 'End tour' : 'Guided tour'),
      h('button', { class:'ghost', onclick: function () { set({ expert: !S.expert }); } },
        S.expert ? 'Expert view on' : 'Expert view')
    ]);
  }

  /* ── the operator panel ────────────────────────────────────────────── */
  function renderPanel() {
    var out = [];
    out.push(h('div', { class:'sec' }, h('div', { class:'secbody', style:'padding-top:14px' }, [
      h('div', { class:'hd' }, 'Crude assay'),
      h('div', { class:'assays' }, Object.keys(CDU.ASSAY).map(function (k) {
        var a = CDU.ASSAY[k], on = S.inputs.assay === k;
        return h('button', { class:'assay' + (on ? ' on' : ''),
                             onclick: function () { S.inputs.assay = k; markDirty(); render(); } }, [
          h('span', { class:'nm' }, a.name),
          h('span', { class:'api' }, a.api + '° API')
        ]);
      })),
      h('p', { class:'hint', style:'margin:0' }, CDU.ASSAY[S.inputs.assay].note)
    ])));

    SECTIONS.forEach(function (sec) {
      var open = !!S.open[sec.key];
      var head = h('button', { 'aria-expanded': open ? 'true' : 'false',
        onclick: function () { S.open[sec.key] = !S.open[sec.key]; render(); } }, [
        h('span', { class:'t' }, sec.label),
        h('span', { class:'c' }, open ? '−' : '+')
      ]);
      var body = open ? h('div', { class:'secbody' }, [h('p', { class:'hint' }, sec.hint)].concat(
        sec.keys.map(function (k) { return field(k); }))) : null;
      out.push(h('div', { class:'sec' }, [head, body]));
    });
    fill($('panel'), out);
  }

  function field(k) {
    var L = CDU.LIMITS[k], v = S.inputs[k];
    var step = L.int ? 1 : ((L.max - L.min) / 200 >= 1 ? 1 : (L.max - L.min) / 200 >= 0.1 ? 0.1 : 0.01);
    var pct = ((v - L.min) / (L.max - L.min) * 100).toFixed(1) + '%';
    var input = h('input', {
      id:'f-' + k, type:'range', min:L.min, max:L.max, step:step, value:v,
      style:'--p:' + pct, 'aria-label':L.label,
      oninput: function (e) { setInput(k, e.target.value, e.target); }
    });
    return h('div', { class:'fld' }, [
      h('div', { class:'top' }, [
        h('label', { for:'f-' + k }, L.label),
        h('span', { class:'v' }, L.int ? String(v) : rate(v)),
        h('span', { class:'u' }, L.unit)
      ]),
      input,
      h('span', { class:'help' }, HELP[k] || '')
    ]);
  }

  /* ── which viewports are shown ─────────────────────────────────────── */
  function renderStage() {
    var st = $('stage');
    st.className = 'stage v-' + S.view;
    $('vp3d').hidden = S.view === '2d';
    $('vp2d').hidden = S.view === '3d';
    if (S.view !== '3d') render2D();
    // the scene keeps rendering while hidden would be waste; pause it instead
    if (gl) gl.state.flow = S.flow && !reduced && S.view !== '2d';
  }

  /* ── the 2D flow sheet ─────────────────────────────────────────────── */
  function render2D() {
    var d = RIG2D.build(S.r, S.mode, S.sel, S.prod, S.flow && !reduced);
    var kids = [];

    d.pipes.forEach(function (p) {
      var g = s('g', { opacity:p.op });
      if (p.halo) g.appendChild(s('path', { class:'d2-halo', d:p.d, stroke:p.col, 'stroke-width':p.halo }));
      g.appendChild(s('path', { class:'d2-pipe', d:p.d, stroke:p.col, 'stroke-width':p.w,
        onclick: function () { select(p.pick); } }));
      if (p.tracer) g.appendChild(s('path', { class:'d2-trace', d:p.d, 'stroke-width':p.tw, style:p.style }));
      kids.push(g);
    });

    var tw = d.tower, tg = s('g', { opacity:tw.op });
    tg.appendChild(s('rect', { x:tw.x, y:tw.y, width:tw.w, height:tw.h, rx:tw.rx, fill:'#0c1424' }));
    d.bands.forEach(function (b) {
      tg.appendChild(s('rect', { x:b.x, y:b.y, width:b.w, height:b.h, fill:b.fill, opacity:b.op }));
    });
    d.trays.forEach(function (t) {
      tg.appendChild(s('line', { class:'d2-tray', x1:t.x1, y1:t.y, x2:t.x2, y2:t.y, opacity:t.op }));
    });
    tg.appendChild(s('rect', { class:'d2-shell' + (S.sel === 'tower' ? ' on' : ''),
      x:tw.x, y:tw.y, width:tw.w, height:tw.h, rx:tw.rx,
      onclick: function () { select('tower'); } }));
    kids.push(tg);

    d.blocks.forEach(function (b) {
      kids.push(s('g', { opacity:b.op }, [
        s('rect', { class:b.cls, x:b.x, y:b.y, width:b.w, height:b.h, rx:b.rx,
          onclick: function () { select(b.pick); } }),
        s('text', { class:'d2-lbl', x:b.lx, y:b.ly, 'text-anchor':'middle' }, b.label),
        s('text', { class:'d2-sub', x:b.lx, y:b.sy, 'text-anchor':'middle' }, b.sub)
      ]));
    });
    d.tags.forEach(function (t) {
      kids.push(s('text', { class:'d2-tag', x:t.x, y:t.y, 'font-size':t.size,
        'text-anchor':t.anchor, fill:t.col, opacity:t.op }, t.text));
    });
    d.temps.forEach(function (t) {
      kids.push(s('text', { class:'d2-tin', x:t.x, y:t.y, 'text-anchor':t.anchor }, t.text));
    });
    d.out.forEach(function (o) {
      kids.push(s('g', { class:'d2-out', opacity:o.op, onclick: function () { select(o.pick); } }, [
        s('line', { class:'d2-tick', x1:o.tick.x1, y1:o.tick.y, x2:o.tick.x2, y2:o.tick.y, stroke:o.col }),
        s('text', { class:'nm', x:o.x, y:o.y, dy:'-4', fill:o.col }, o.name),
        s('text', { class:'r', x:o.x, y:o.y, dy:'12' }, o.rate + ' t/h'),
        s('text', { class:'sm', x:o.x, y:o.y, dy:'24' }, o.pct),
        s('text', { class:'sm', x:o.x, y:o.y, dy:'35' }, o.cut)
      ]));
    });
    if (d.legend) {
      var lg = d.legend;
      var grad = s('linearGradient', { id:'heatramp', x1:'0', x2:'1', y1:'0', y2:'0' },
        lg.stops.map(function (q) { return s('stop', { offset:q.off, 'stop-color':q.col }); }));
      kids.push(s('defs', null, grad));
      kids.push(s('rect', { x:lg.x, y:lg.y, width:lg.w, height:lg.h, rx:4, fill:'url(#heatramp)' }));
      kids.push(s('text', { class:'d2-tin', x:lg.x, y:lg.y, dy:'-5' }, lg.lo));
      kids.push(s('text', { class:'d2-tin', x:lg.x + lg.w, y:lg.y, dy:'-5', 'text-anchor':'end' }, lg.hi));
    }

    var svg = s('svg', { viewBox:'0 0 ' + d.w + ' ' + d.h, preserveAspectRatio:'xMidYMid meet',
      role:'img', 'aria-label':'Process flow diagram of the crude unit, with the computed rate on every product rundown.' }, kids);
    fill($('d2'), svg);
  }

  /* ── the product strip ─────────────────────────────────────────────── */
  function renderProducts() {
    var list = S.r ? S.r.products : CDU.CUTS.map(function (c) { return { key:c.key, name:c.name }; });
    fill($('products'), list.map(function (p) {
      var has = !!S.r, on = S.prod === p.key;
      var cut = has && p.mass > 0.05 ? fmt(p.tbp5, 0) + '–' + fmt(p.tbp95, 0) + ' °C' : DASH;
      return h('button', { class:'prod' + (on ? ' on' : ''), style:'--pc:' + (TONE[p.key] || '#9aa6bd'),
        onclick: function () { selectProduct(p.key); } }, [
        h('span', { class:'nm' }, p.name),
        h('span', { class:'n' }, has ? rate(p.mass) : DASH),
        h('span', { class:'d' }, 't/h · ' + (has ? fmt(p.pct, 1) : DASH) + ' % · ' + cut),
        h('span', { class:'meter' }, h('i', { style:'width:' + (has ? Math.max(0.6, p.pct) : 0) + '%' }))
      ]);
    }));
  }

  /* ── the results rail ──────────────────────────────────────────────── */
  function renderResults() {
    var r = S.r, st = STATUS[S.status] || STATUS.ready, out = [];

    /* run state */
    var blk = [h('div', { class:'hd' }, 'Run state'), h('p', { class:'note', style:'margin:0' }, st[1])];
    if (S.pre) {
      blk.push(row('Charge', rate(S.pre.feed.molar) + ' kmol/h'));
      blk.push(row('Mean molar mass', fmt(S.pre.feed.M, 1) + ' kg/kmol'));
      blk.push(row('Flash-zone vapour', fmt(S.pre.flash.psi * 100, 1) + ' %'));
    }
    if (r) {
      blk.push(row('Cascade sweeps', String(r.outer)));
      blk.push(row(r.iters > 999 ? 'Equilibrium solves' : 'Flash iterations', group(r.iters)));
      blk.push(row('Solve time', Math.round(r.ms) + ' ms'));
      blk.push(msg(r.converged ? 'ok' : 'warn', r.converged ? 'Converged' : 'Iteration limit reached',
        r.converged ? 'The tray temperatures and the component flows both stopped moving inside tolerance.'
                    : 'The solver stopped at its iteration limit with the profile still moving. The numbers below are the last state it reached — not a converged answer.'));
      var tr = traceChart(r.trace);
      if (tr) {
        blk.push(h('div', null, [
          h('div', { class:'hd', style:'margin-bottom:5px' }, 'Residual, per sweep'),
          tr.svg,
          h('div', { class:'note' }, 'Temperature residual on a log scale, ' + tr.hi +
            ' K down to ' + tr.lo + ' K over ' + tr.n + ' sweeps.')
        ]));
      }
    }
    S.errs.forEach(function (e) { blk.push(msg('err', '!', e.msg || String(e))); });
    S.warns.forEach(function (w) { blk.push(msg('warn', '⚠', typeof w === 'string' ? w : (w.msg || ''))); });
    out.push(h('div', { class:'blk' }, blk));

    if (r) {
      /* headline figures */
      var dist = r.products.filter(function (p) { return p.key !== 'residue'; })
                           .reduce(function (a, p) { return a + p.pct; }, 0);
      var figs = [
        ['Distillate yield', fmt(dist, 1), '% of charge', '#7fd8ff'],
        ['Flash-zone vapour', fmt(r.flash.psi * 100, 1), '% vaporised', '#ffb457'],
        ['Top tray', fmt(r.internals.Tprofile[1], 0), '°C', '#9fb8ff'],
        ['Furnace duty', fmt(r.energy.furnace, 0), 'MW', '#ff8a4c'],
        ['Condenser duty', fmt(r.energy.condenser, 0), 'MW', '#78d2ff'],
        ['Residue', fmt(r.products[r.products.length - 1].pct, 1), '% of charge', '#e65c7a']
      ];
      out.push(h('div', { class:'blk' }, [
        h('div', { class:'hd' }, 'Operating result'),
        h('div', { class:'figs' }, figs.map(function (f) {
          return h('div', { class:'fig', style:'border-top-color:' + f[3] }, [
            h('span', { class:'k' }, f[0]),
            h('span', { class:'n', style:'color:' + f[3] }, f[1]),
            h('span', { class:'u' }, f[2])
          ]);
        }))
      ]));

      /* temperature profile and the stages */
      out.push(h('div', { class:'blk' }, [
        h('div', { class:'hd' }, 'Temperature profile'),
        profileChart(r),
        h('div', { class:'note' }, S.expert
          ? 'Every stage the solver carries, with the liquid and vapour traffic on it, in kmol/h.'
          : 'The named stages, top to bottom. Expert view lists every tray and its internal traffic.'),
        h('div', { class:'stgs' }, stageRows(r))
      ]));

      /* material balance */
      var closes = Math.abs(r.balance.closure) <= 1e-6;
      var bal = [h('div', { class:'hd' }, 'Material balance'),
        row('Crude charged', rate(r.balance.inMass) + ' t/h'),
        row('Stripping steam (inert)', rate(r.steam.mass) + ' t/h'),
        row('Products out', rate(r.balance.outMass) + ' t/h')];
      r.products.forEach(function (p) {
        bal.push(h('div', { class:'row' }, [
          h('i', { class:'sw', style:'background:' + TONE[p.key] }),
          h('span', { class:'k' }, p.name),
          h('span', { class:'v' }, rate(p.mass) + ' t/h'),
          h('span', { class:'p' }, fmt(p.pct, 2) + ' %')
        ]));
      });
      bal.push(msg(closes ? 'ok' : 'warn', 'Σ',
        'Balance error ' + expo(Math.abs(r.balance.closure)) + ' of the charge, ' +
        (closes ? 'within the 1×10⁻⁶ tolerance — the products account for the whole charge.'
                : 'outside the 1×10⁻⁶ tolerance — treat the split as approximate.')));
      out.push(h('div', { class:'blk' }, bal));

      /* expert-only blocks */
      if (S.expert) {
        var I = r.internals;
        out.push(h('div', { class:'blk' }, [h('div', { class:'hd' }, 'Internal flows')].concat([
          ['Reflux to the top tray', rate(I.Ltop), 'kmol/h'],
          ['Vapour off the flash zone', rate(I.Vflash), 'kmol/h'],
          ['Liquid to the sump', rate(I.Lflash), 'kmol/h'],
          ['Distillate, vapour', rate(I.Dvap), 'kmol/h'],
          ['Distillate, liquid', rate(I.Dliq), 'kmol/h'],
          ['Theoretical stages', String(I.stages), ''],
          ['Charge, molar', rate(r.feed.molar), 'kmol/h'],
          ['Mean molar mass', fmt(r.feed.M, 1), 'kg/kmol'],
          ['Stripping steam', rate(r.steam.molar), 'kmol/h']
        ].map(function (q) {
          return h('div', { class:'row' }, [h('span', { class:'k' }, q[0]),
            h('span', { class:'v' }, q[1]), h('span', { class:'p' }, q[2])]);
        })).concat([h('div', { class:'note' },
          'Molar rates inside the tower. They are not product rates and do not sum to the charge.')])));
        var cut = cutChart(r, S.prod);
        if (cut) out.push(h('div', { class:'blk' }, [
          h('div', { class:'hd' }, 'Cut composition — ' + cut.name), cut.svg,
          h('div', { class:'note' }, cut.note)
        ]));
      }
    }

    /* run history */
    if (S.hist.length) {
      out.push(h('div', { class:'blk' }, [h('div', { class:'hd' }, 'Run history')].concat(
        S.hist.map(function (q, i) {
          return h('button', { class:'hrow' + (i === 0 ? ' now' : ''), title:'Load these inputs',
            onclick: function () { S.inputs = JSON.parse(JSON.stringify(q.snap)); markDirty(); render(); } }, [
            h('span', { class:'at' }, q.at),
            h('span', null, CDU.ASSAY[q.assay].name),
            h('span', { class:'y' }, fmt(q.yield, 1) + ' %'),
            h('span', { class:'m' }, fmt(q.furnaceT, 0) + ' °C · R ' + fmt(q.reflux, 2) +
              ' · ' + rate(q.feedRate) + ' t/h · ' + (q.conv ? 'converged' : 'limit') +
              ' in ' + q.ms + ' ms')
          ]);
        })).concat([h('div', { class:'note' }, 'Click a run to load its inputs back into the panel.')])));
    }

    /* assumptions */
    out.push(h('details', { class:'det' }, [
      h('summary', null, 'Model assumptions'),
      h('div', { class:'dbody' }, h('ul', null, ASSUMPTIONS.map(function (a) { return h('li', null, a); })))
    ]));

    fill($('results'), out);
  }

  function row(k, v, p) {
    return h('div', { class:'row' }, [h('span', { class:'k' }, k), h('span', { class:'v' }, v),
                                      p ? h('span', { class:'p' }, p) : null]);
  }
  function msg(tone, badge, text) {
    return h('div', { class:'msg ' + tone }, [h('b', null, badge), h('span', null, text)]);
  }

  /* ── charts ────────────────────────────────────────────────────────────
     Small SVGs built from the result. Each one plots something the solver
     produced; none of them smooths, extrapolates or fills a gap. */
  function profileChart(r) {
    var T = r.internals.Tprofile, P = r.internals.Pprofile;
    var W = 300, H = 190, ml = 34, mb = 26, mt = 10, mr = 8, n = T.length;
    var lo = Math.min.apply(null, T), hi = Math.max.apply(null, T);
    var pad = Math.max(6, (hi - lo) * 0.06), t0 = lo - pad, t1 = hi + pad;
    function X(t) { return ml + (W - ml - mr) * (t - t0) / Math.max(1e-6, t1 - t0); }
    function Y(j) { return mt + (H - mt - mb) * (j / Math.max(1, n - 1)); }
    var kids = [
      s('line', { class:'ax', x1:ml, y1:mt, x2:ml, y2:H - mb }),
      s('line', { class:'ax', x1:ml, y1:H - mb, x2:W - 6, y2:H - mb }),
      s('polyline', { class:'ln', points: T.map(function (t, j) {
        return X(t).toFixed(1) + ',' + Y(j).toFixed(1); }).join(' ') })
    ];
    T.forEach(function (t, j) {
      var kind = r.internals.stageKind[j] || '';
      kids.push(s('circle', { cx:X(t).toFixed(1), cy:Y(j).toFixed(1),
        r: (kind === 'draw' || j === 0 || j === r.internals.feedStage) ? 3.6 : 2.0,
        fill: RIG2D.heat(t, 30, 380) }));
    });
    for (var q = 0; q <= 4; q++) {
      var tv = t0 + (t1 - t0) * q / 4;
      kids.push(s('text', { class:'lbl', x:X(tv).toFixed(1), y:H - mb + 14, 'text-anchor':'middle' },
        fmt(tv, 0)));
    }
    kids.push(s('text', { class:'lbl', x:4, y:12 }, 'top'));
    kids.push(s('text', { class:'lbl', x:4, y:H - mb }, 'base'));
    return s('svg', { class:'chart', viewBox:'0 0 ' + W + ' ' + H, 'aria-hidden':'true' }, kids);
  }

  function traceChart(tr) {
    if (!tr || tr.length < 2) return null;
    var W = 300, H = 92, ml = 30, mb = 16, mt = 8, mr = 6;
    var y = tr.map(function (q) { return Math.log10(Math.max(1e-9, q[1])); });
    var lo = Math.min.apply(null, y), hi = Math.max.apply(null, y);
    function X(i) { return ml + (W - ml - mr) * (i / Math.max(1, tr.length - 1)); }
    function Y(v) { return mt + (H - mt - mb) * (1 - (v - lo) / Math.max(1e-6, hi - lo)); }
    var svg = s('svg', { class:'chart', viewBox:'0 0 ' + W + ' ' + H, 'aria-hidden':'true' }, [
      s('line', { class:'ax', x1:ml, y1:mt, x2:ml, y2:H - mb }),
      s('line', { class:'ax', x1:ml, y1:H - mb, x2:W - 6, y2:H - mb }),
      s('polyline', { class:'tr', points: y.map(function (v, i) {
        return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ') })
    ]);
    return { svg:svg, n:tr.length, hi:expo(Math.pow(10, hi)), lo:expo(Math.pow(10, lo)) };
  }

  /** One product's composition on the pseudocomponent grid — the model's own
   *  internal representation, shown rather than described. */
  function cutChart(r, prodKey) {
    var p = r.products.filter(function (q) { return q.key === (prodKey || 'kerosene'); })[0] || r.products[2];
    var tot = p.comp.reduce(function (a, v) { return a + v; }, 0);
    if (!(tot > 0)) return null;
    var W = 300, H = 110, ml = 6, mb = 18, mt = 6, n = p.comp.length;
    var bw = (W - ml * 2) / n, mx = Math.max.apply(null, p.comp);
    var kids = [s('line', { class:'ax', x1:4, y1:H - mb, x2:W - 4, y2:H - mb })];
    p.comp.forEach(function (v, i) {
      var bh = Math.max(0.6, (H - mt - mb) * v / mx);
      kids.push(s('rect', { x:(ml + i * bw).toFixed(1), y:(H - mb - bh).toFixed(1),
        width:Math.max(1.5, bw - 1.4).toFixed(1), height:bh.toFixed(1),
        fill:RIG2D.heat(CDU.NBP_C[i], 30, 380), rx:1 }));
    });
    kids.push(s('text', { class:'lbl', x:4, y:H - 4 }, CDU.NBP_C[0] + ' °C'));
    kids.push(s('text', { class:'lbl', x:W - 4, y:H - 4, 'text-anchor':'end' },
      CDU.NBP_C[n - 1] + ' °C'));
    return { name:p.name,
             svg:s('svg', { class:'chart', viewBox:'0 0 ' + W + ' ' + H, 'aria-hidden':'true' }, kids),
             note:'Molar flow of each pseudocomponent in the ' + p.name.toLowerCase() +
                  ', by normal boiling point. This is the grid the model actually solves on.' };
  }

  /** The stage list. The ordinary view names the stages an operator names;
   *  expert view lists every one with its internal traffic. Clicking a row
   *  takes the camera into the cutaway at that elevation. */
  function stageRows(r) {
    var I = r.internals, keep = { cond:1, draw:1, feed:1, sump:1 }, out = [];
    for (var j = 0; j < I.Tprofile.length; j++) {
      var kind = I.stageKind[j] || 'tray';
      if (!S.expert && !keep[kind] && j !== 0 && j !== I.Tprofile.length - 1) continue;
      out.push(stageRow(j, kind, I));
    }
    return out;
  }
  function stageRow(j, kind, I) {
    var kids = [
      h('i', { style:'background:' + RIG2D.heat(I.Tprofile[j], 30, 380) }),
      h('span', { class:'l' }, I.stageLabel[j] || ('Stage ' + j)),
      h('span', { class:'t' }, fmt(I.Tprofile[j], 0) + ' °C'),
      h('span', { class:'p' }, fmt(I.Pprofile[j], 0) + ' kPa')
    ];
    if (S.expert) {
      kids.push(h('span', { class:'p x' }, 'L ' + rate(I.Lprofile[j])));
      kids.push(h('span', { class:'p x' }, 'V ' + rate(I.Vprofile[j])));
    }
    return h('button', { class:'stg k-' + kind + (S.stage === j ? ' on' : ''),
      title:'Look at this stage in the cutaway',
      onclick: function () { selectStage(j); } }, kids);
  }

  /* ══ the 3D scene ═════════════════════════════════════════════════════ */
  function mountGL() {
    var cv = $('gl');
    try {
      plant = PLANT.build();
      gl = RIGGL.create(cv, plant, { maxDpr: 2 });
    } catch (err) {
      $('glfail').hidden = false;
      $('glfail').textContent = 'WebGL is unavailable in this browser, so the 3D view cannot be drawn. '
        + 'Everything else works: use the Process view, which needs no WebGL.';
      S.view = '2d';
      render();
      return;
    }
    cams = RIGINFO.cameras(plant);
    camTo('plant', true);
    if (reduced) gl.state.flow = false;
    bindPointer(cv);
    buildTags();
    loop();
  }

  /** The render loop. It never touches the DOM through render(): the tag
   *  positions and the frame counter are written directly, so a 60 Hz scene
   *  does not drag a rebuild behind it. */
  function loop() {
    var last = performance.now(), acc = 0, frames = 0;
    function step(now) {
      if (!gl) { raf = 0; return; }
      var dt = (now - last) / 1000; last = now;
      if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
      try { gl.render(dt); placeTags(); } catch (e) { raf = 0; return; }
      acc += dt; frames++;
      if (acc >= 0.5) {
        var fps = Math.round(frames / acc);
        $('fps').textContent = fps + ' fps';
        adapt(fps);
        acc = 0; frames = 0;
      }
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
  }

  /** Hold the frame rate, and say so when holding it costs something. Two
   *  levers in the order that costs the viewer least: the tracers, which are
   *  decoration, then the backing-store resolution, which is what actually
   *  changes shading cost. Both climb back when the machine can afford them. */
  function adapt(fps) {
    var st = gl.state, note = '';
    if (fps < 26 && st.tracers > 0.35 && S.flow) st.tracers = 0.3;
    else if (fps < 22 && st.scale > 0.62) st.scale = Math.max(0.6, st.scale - 0.2);
    else if (fps > 52 && st.scale < 1) st.scale = Math.min(1, st.scale + 0.2);
    else if (fps > 55 && st.tracers < 1) st.tracers = 1;
    if (st.scale < 0.99 && st.tracers < 1) note = 'Tracers + resolution reduced';
    else if (st.scale < 0.99) note = 'Resolution reduced';
    else if (st.tracers < 1) note = 'Tracers thinned';
    var w = $('degrade');
    w.hidden = !note;
    if (note) {
      w.textContent = note;
      w.title = 'This machine could not hold a usable frame rate at full quality, so the scene is '
              + 'being drawn with ' + note.toLowerCase() + '. It goes back up on its own.';
    }
  }

  /* ── instrument tags, pinned to world points ───────────────────────── */
  function buildTags() {
    var host = $('tags');
    fill(host, null);
    tagEls = plant.instruments.map(function (ins) {
      var el = h('div', { class:'tag' }, [
        h('b', null, ins.key), h('span', { class:'v' }, DASH), h('u', null, '')
      ]);
      host.appendChild(el);
      return { el:el, at:ins.at, read:ins.read };
    });
    updateTagValues();
  }
  function updateTagValues() {
    tagEls.forEach(function (t) {
      var rd = reading(t.read);
      t.el.querySelector('.v').textContent = rd ? rd.v : DASH;
      t.el.querySelector('u').textContent = rd ? rd.u : '';
    });
  }
  /** One instrument reading, or null when nothing has been solved. */
  function reading(k) {
    var r = S.r;
    if (!r) return null;
    function draw(key) {
      var p = r.products.filter(function (q) { return q.key === key; })[0];
      return { v: fmt(p ? p.drawT : NaN, 0), u:'°C' };
    }
    var M = {
      charge:      function () { return { v:rate(r.feed.mass), u:'t/h' }; },
      top:         function () { return { v:fmt(r.internals.Tprofile[1], 0), u:'°C' }; },
      flash:       function () { return { v:fmt(r.flash.T, 0), u:'°C' }; },
      flashP:      function () { return { v:fmt(r.flash.P, 0), u:'kPa' }; },
      topP:        function () { return { v:fmt(r.internals.Pprofile[0], 0), u:'kPa' }; },
      drum:        function () { return { v:fmt(r.energy.Ttop, 0), u:'°C' }; },
      reflux:      function () { return { v:fmt(r.internals.reflux, 2), u:'' }; },
      kerosene:    function () { return draw('kerosene'); },
      diesel:      function () { return draw('diesel'); },
      gasoil:      function () { return draw('gasoil'); }
    };
    return M[k] ? M[k]() : null;
  }
  /** Project every tag, then drop the ones that would land on another. Ten
   *  tags on a tower this tall overlap from most angles, and a pile of
   *  half-legible labels is worse than the four that fit. */
  function placeTags() {
    if (!gl || !tagEls.length) return;
    var narrow = (window.innerWidth || 1200) < 760;
    var gapY = narrow ? 30 : 21, gapX = narrow ? 150 : 118, cap = narrow ? 4 : 10;
    var shown = [], placed = [];
    tagEls.forEach(function (t) {
      var p = gl.toScreen(t.at);
      if (!p) { t.el.style.opacity = '0'; return; }
      shown.push({ t:t, p:p });
    });
    shown.sort(function (a, b) { return a.p.d - b.p.d; });
    shown.forEach(function (q) {
      var clash = placed.some(function (p) {
        return Math.abs(p.y - q.p.y) < gapY && Math.abs(p.x - q.p.x) < gapX;
      });
      if (clash || placed.length >= cap) { q.t.el.style.opacity = '0'; return; }
      placed.push(q.p);
      q.t.el.style.opacity = String(Math.max(0.34, Math.min(1, 1.25 - q.p.d * 0.006)));
      q.t.el.style.transform = 'translate3d(' + Math.round(q.p.x) + 'px,' + Math.round(q.p.y) + 'px,0)';
    });
  }

  /* ── pointer, wheel, touch and keyboard ────────────────────────────── */
  function bindPointer(cv) {
    var drag = null, moved = 0, pinch = 0;
    function pos(e) { var b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
    function orbit(dx, dy) {
      gl.cam.tYaw -= dx * 0.006;
      gl.cam.tPitch = Math.max(-0.28, Math.min(1.10, gl.cam.tPitch + dy * 0.005));
      camPreset = '';
      renderOverlay();
    }
    function zoom(f) { gl.cam.tDist = Math.max(18, Math.min(210, gl.cam.tDist * f)); }

    cv.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      cv.setPointerCapture(e.pointerId); drag = pos(e); moved = 0;
    });
    cv.addEventListener('pointermove', function (e) {
      var p = pos(e);
      if (drag) {
        orbit(p[0] - drag[0], p[1] - drag[1]);
        moved += Math.abs(p[0] - drag[0]) + Math.abs(p[1] - drag[1]);
        drag = p;
        return;
      }
      // Picking renders the id buffer and reads a pixel back, which stalls the
      // pipeline. Cap it by wall clock so a fast mouse cannot starve the scene.
      if (hoverRaf) return;
      var now = performance.now();
      if (now - hoverAt < 70) return;
      hoverAt = now;
      hoverRaf = requestAnimationFrame(function () {
        hoverRaf = 0;
        if (!gl) return;
        var k = gl.pickAt(p[0], p[1]);
        if (k !== gl.state.hov) { gl.state.hov = k; gl.refresh(); cv.style.cursor = k ? 'pointer' : 'grab'; }
        chip(k, p[0], p[1]);
      });
    });
    cv.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var wasDrag = moved > 6; drag = null;
      if (wasDrag) return;
      var p = pos(e);
      select(gl ? gl.pickAt(p[0], p[1]) : null);
    });
    cv.addEventListener('pointercancel', function () { drag = null; });
    cv.addEventListener('pointerleave', function () {
      drag = null;
      if (gl && gl.state.hov) { gl.state.hov = null; gl.refresh(); }
      chip(null);
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0014));
    }, { passive:false });

    function touches(e) {
      var b = cv.getBoundingClientRect(), t = e.touches;
      return { n:t.length, x:t[0].clientX - b.left, y:t[0].clientY - b.top,
               d: t.length > 1 ? Math.hypot(t[0].clientX - t[1].clientX,
                                            t[0].clientY - t[1].clientY) : 0 };
    }
    cv.addEventListener('touchstart', function (e) {
      var t = touches(e); drag = [t.x, t.y]; moved = 0; pinch = t.d;
    }, { passive:true });
    cv.addEventListener('touchmove', function (e) {
      var t = touches(e);
      if (t.n > 1 && pinch > 0) { zoom(pinch / Math.max(1, t.d)); pinch = t.d; moved = 99; e.preventDefault(); return; }
      if (drag) {
        orbit(t.x - drag[0], t.y - drag[1]);
        moved += Math.abs(t.x - drag[0]) + Math.abs(t.y - drag[1]);
        drag = [t.x, t.y];
        e.preventDefault();
      }
    }, { passive:false });
    cv.addEventListener('touchend', function () {
      var wasDrag = moved > 8, at = drag;
      drag = null; pinch = 0;
      if (!wasDrag && at && gl) select(gl.pickAt(at[0], at[1]));
    });

    cv.addEventListener('keydown', function (e) {
      var K = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
      if (K[e.key]) { e.preventDefault(); orbit(K[e.key][0] * 28, K[e.key][1] * 20); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(0.88); }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(1.14); }
      if (e.key === 'Escape') select(null);
    });
    cv.style.cursor = 'grab';
  }

  /** The name that follows the cursor. Written directly: at 60 Hz this must
   *  not go through a rebuild. */
  function chip(key, x, y) {
    var el = $('hover');
    var d = key && RIGINFO.describe(key);
    if (!d) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = d.name;
    el.style.transform = 'translate3d(' + Math.round(x + 14) + 'px,' + Math.round(y + 14) + 'px,0)';
  }

  /* ── the overlay: info card, cameras, tour ─────────────────────────── */
  function renderOverlay() {
    updateTagValues();

    var info = RIGINFO.describe(S.sel);
    var card = $('info');
    if (!info) fill(card, null);
    else {
      var reads = (info.reads || []).map(function (k) { return [k, reading(k)]; })
                                    .filter(function (q) { return q[1]; });
      fill(card, [
        h('button', { class:'x', 'aria-label':'Close', onclick: function () { select(null); } }, '×'),
        h('div', { class:'cat' }, info.cat),
        h('h3', null, info.name),
        h('dl', null, [
          h('div', null, [h('dt', null, 'Purpose'), h('dd', null, info.purpose)]),
          h('div', null, [h('dt', null, 'How it works'), h('dd', null, info.how)]),
          h('div', null, [h('dt', null, 'Role in the separation'), h('dd', null, info.role)])
        ]),
        reads.length ? h('div', { class:'reads' }, reads.map(function (q) {
          return h('span', null, [q[0], ' ', h('b', null, q[1].v), ' ' + q[1].u]);
        })) : null
      ]);
    }
    card.hidden = !info;

    fill($('cams'), (cams || []).map(function (c) {
      return h('button', { class:'cam' + (camPreset === c.key ? ' on' : ''),
        onclick: function () { camTo(c.key); renderOverlay(); } }, c.label);
    }));

    var tour = $('tour');
    if (S.tour < 0) { tour.hidden = true; fill(tour, null); }
    else {
      var stop = RIGINFO.TOUR[S.tour];
      tour.hidden = false;
      fill(tour, [
        h('span', { class:'n' }, (S.tour + 1) + ' / ' + RIGINFO.TOUR.length),
        h('div', { style:'min-width:0' }, [h('h4', null, stop.title), h('p', null, stop.text)]),
        h('div', { style:'display:flex;flex-direction:column;gap:6px;margin-left:auto' }, [
          h('button', { class:'cam', onclick: function () { tourGo(S.tour + 1); } }, 'Next'),
          h('button', { class:'cam', onclick: function () { stopTour(); set({ tour:-1 }); } }, 'End')
        ])
      ]);
    }

    $('flowbtn').textContent = S.flow ? 'Pause flow' : 'Resume flow';
  }

  /* ══ boot ═════════════════════════════════════════════════════════════ */
  function boot() {
    $('run').addEventListener('click', run);
    $('reset').addEventListener('click', reset);
    $('save').addEventListener('click', save);
    $('loadbtn').addEventListener('click', function () { $('loadfile').click(); });
    $('loadfile').addEventListener('change', load);
    $('flowbtn').addEventListener('click', function () {
      S.flow = !S.flow;
      if (gl) gl.state.flow = S.flow && !reduced;
      render();
    });
    mountGL();
    render();
    // Solve the base case once so the page opens on a result rather than an
    // empty panel. It is a couple of hundred milliseconds of idle time.
    setTimeout(run, 400);
  }

  return { boot: boot, state: S };
})();
