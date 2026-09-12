/* vm.js — the view model of the industrial simulator.
 *
 * One method, rigView(s), which turns the page's state into the flat data the
 * template binds to. It formats; it does not calculate. Every process number
 * it emits was produced by CDU.run() and is passed through with a stated
 * number of digits — never rounded up into a precision the model does not
 * have, and never invented when there is no result to read it from.
 */

/** Digits chosen for what the model can actually support. A tower temperature
 *  from a pseudocomponent model is worth a degree, not a tenth of one; a rate
 *  is worth about three significant figures. */
rigFmt(v, d) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return (+v).toFixed(d);
}
rigRate(v) { return !isFinite(v) ? '—' : (Math.abs(v) >= 100 ? (+v).toFixed(0) : (+v).toFixed(1)); }
rigExp(v) {
  if (!isFinite(v) || v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  return (v / Math.pow(10, e)).toFixed(1) + '×10' + this.rigSup(e);
}
/** Honour the operating system's reduced-motion setting: the tracers are the
 *  only continuously moving thing on the page, and they are the first to go. */
rigReduced() {
  if (this._reduced === undefined) {
    try { this._reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { this._reduced = false; }
  }
  return this._reduced;
}

/** Thin-space grouping, so a six-figure iteration count can be read. */
rigGroup(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f'); }

rigSup(n) {
  const map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³',
                '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(n).split('').map(c => map[c] || c).join('');
}

/** The operator panel, in the order an operator would reach for it. Every
 *  field's range is the engine's own limit, so the panel cannot offer a value
 *  the solver would refuse. */
static RIG_SECTIONS = [
  { key: 'feed', label: 'Feed', hint: 'What the unit is charged with, and how much of it.',
    keys: ['feedRate', 'feedT'] },
  { key: 'furnace', label: 'Furnace', hint: 'The heat that decides how much can vaporise.',
    keys: ['furnaceT'] },
  { key: 'column', label: 'Column', hint: 'Pressure, reflux and the steam that does the stripping.',
    keys: ['colP', 'topP', 'reflux', 'steam', 'sideSteam', 'drumT'] },
  { key: 'products', label: 'Product draws', hint: 'How much liquid each side draw takes, as a percentage of the charge.',
    keys: ['drawKero', 'drawDiesel', 'drawGasoil'] },
  { key: 'adv', label: 'Internals', hint: 'Tray counts by section. Expert territory: these change how sharp each split is.',
    keys: ['stagesTop', 'stagesKero', 'stagesDiesel', 'stagesGasoil', 'stagesWash', 'stagesStrip'] }
];

/** Short notes on the handles that are easy to misread. */
static RIG_HELP = {
  feedRate: 'The basis for every yield on this page.',
  feedT: 'Preheat-train outlet. It changes the furnace duty, not the flash.',
  furnaceT: 'Transfer-line temperature — the strongest handle on the unit.',
  colP: 'Flash-zone pressure. Higher pressure means less vaporises.',
  topP: 'Overhead pressure. Must be below the flash-zone pressure.',
  reflux: 'Returned liquid over distillate. Sharper separation, more condenser duty.',
  steam: 'Superheated steam to the tower base, as a percentage of the charge.',
  sideSteam: 'Stripping steam to each side stripper, as a percentage of that draw.',
  drumT: 'Reflux drum temperature. It fixes the gas/naphtha split, not the tower.',
  drawKero: 'Kerosene liquid draw. The tower cannot give more than flows past the tray.',
  drawDiesel: 'Diesel liquid draw.',
  drawGasoil: 'Heavy gas-oil liquid draw.',
  stagesTop: 'Trays between the top and the kerosene draw.',
  stagesKero: 'Trays between the kerosene and diesel draws.',
  stagesDiesel: 'Trays between the diesel and gas-oil draws.',
  stagesGasoil: 'Trays between the gas-oil draw and the wash section.',
  stagesWash: 'Wash trays above the flash zone, which keep the gas oil clean.',
  stagesStrip: 'Stripping trays below the flash zone.'
};

/** What the model does and does not claim. Shown on the page, not buried. */
static RIG_ASSUMPTIONS = [
  'The crude is represented as 22 narrow-boiling pseudocomponents on a fixed normal-boiling-point grid, each standing in for the n-alkane of the same boiling point. Molar mass follows from that carbon number.',
  'Vapour pressure comes from the Clausius–Clapeyron equation integrated at constant enthalpy of vaporisation, with the latent heat from Kistiakowsky’s rule ΔS_vap = 36.6 + 8.31·ln(T_b) J/(mol·K).',
  'The vapour is ideal and the liquid follows Raoult’s law, so K = Pˢᵃᵗ/P. This is reasonable for hydrocarbons near atmospheric pressure and is not corrected for non-ideality.',
  'Above the flash zone the tower is solved as a stagewise cascade by the bubble-point (Wang–Henke) method, with the component balances solved exactly by the Thomas algorithm on every sweep.',
  'Below the flash zone there is no reboiler and the temperature is not free, so that section is treated by the Kremser group method rather than stage by stage. The two halves meet at the flash zone.',
  'Stripping steam is treated as an inert carrier: it lowers every hydrocarbon partial pressure but does not appear in the equilibrium solve.',
  'Side draws are set as ratios of the liquid flowing past the tray, which makes the material balance close exactly on every iteration rather than only at convergence.',
  'Tray efficiency is not modelled: every stage is a theoretical stage.',
  'Heat losses, tray pressure drop beyond the linear profile, and any reaction or cracking in the heater are outside the model.'
];

/** The landing page's gateway: the same flow sheet the simulator draws, at a
 *  size that fits a teaser, plus the headline figures from the prewarmed run.
 *  Built on every render of the landing page — it is layout, not arithmetic. */
rigGate(s) {
  const r = s.rig.r, has = !!r;
  const f = (v, d) => this.rigFmt(v, d);
  return {
    gateD2: RIG2D.build(r, 'material', null, null, !this.rigReduced()),
    gateHas: has,
    gateFigs: [
      { k: 'Distillate yield', v: has ? f(r.products.filter(p => p.key !== 'residue')
                                             .reduce((a, p) => a + p.pct, 0), 1) : '\u2014', u: '%' },
      { k: 'Flash-zone vapour', v: has ? f(r.flash.psi * 100, 1) : '\u2014', u: '%' },
      { k: 'Furnace duty',     v: has ? f(r.energy.furnace, 0) : '\u2014', u: 'MW' },
      { k: 'Cascade sweeps',   v: has ? String(r.outer) : '\u2014', u: '' }
    ],
    gateNote: has
      ? 'Solved in your browser while you were reading this page: ' +
        CDU.ASSAY[s.rig.in.assay].name.toLowerCase() + ' at ' +
        this.rigRate(r.feed.mass) + ' t/h, ' + f(r.internals.stages, 0) +
        ' theoretical stages, balance closing to ' +
        this.rigExp(Math.abs(r.balance.closure)) + '.'
      : 'The base case is solving in the background; the figures appear as soon as it converges.'
  };
}

rigView(s) {
  const rg = s.rig, r = rg.r, C = Component;
  const f = (v, d) => this.rigFmt(v, d);
  const has = !!r;

  /* ── status ──────────────────────────────────────────────────────── */
  const STATUS = {
    ready:       ['READY', 'The unit is lined out. Press Run simulation to solve it.', 'idle'],
    calculating: ['CALCULATING', 'Characterising the charge and flashing it at the furnace outlet.', 'busy'],
    converging:  ['CONVERGING', 'Iterating the stage cascade.', 'busy'],
    complete:    ['COMPLETE', 'The solver converged and the balance closes.', 'ok'],
    warning:     ['WARNING', 'A result was produced, but it comes with qualifications.', 'warn'],
    error:       ['ERROR', 'No result. The inputs were refused, or the solve failed.', 'err']
  };
  const st = STATUS[rg.status] || STATUS.ready;
  const busy = rg.status === 'calculating' || rg.status === 'converging';

  /* ── the operator panel ──────────────────────────────────────────── */
  const sections = C.RIG_SECTIONS.map(sec => ({
    key: sec.key, label: sec.label, hint: sec.hint,
    open: !!rg.open[sec.key],
    chev: rg.open[sec.key] ? '−' : '+',
    bodyStyle: rg.open[sec.key] ? '' : 'display:none',
    fields: sec.keys.map(k => {
      const L = CDU.LIMITS[k], v = rg.in[k];
      const step = L.int ? 1 : (L.max - L.min) / 200;
      return {
        k: k, label: L.label, unit: L.unit, min: L.min, max: L.max,
        step: L.int ? 1 : (step >= 1 ? 1 : step >= 0.1 ? 0.1 : 0.01),
        val: v, show: L.int ? String(v) : this.rigRate(v),
        pct: ((v - L.min) / (L.max - L.min) * 100).toFixed(1) + '%',
        help: C.RIG_HELP[k] || '',
        range: L.min + ' – ' + L.max + (L.unit ? ' ' + L.unit : '')
      };
    })
  }));

  const assays = Object.keys(CDU.ASSAY).map(k => {
    const a = CDU.ASSAY[k];
    return { k: k, name: a.name, api: a.api + '° API', note: a.note,
             on: rg.in.assay === k,
             cls: 'rig-assay' + (rg.in.assay === k ? ' on' : '') };
  });

  /* ── products ────────────────────────────────────────────────────── */
  const TONE = { gas:'#78ebd8', naphtha:'#ffd778', kerosene:'#ffbe50',
                 diesel:'#fa9e33', gasoil:'#f27038', residue:'#e65c7a' };
  const products = (has ? r.products : CDU.CUTS.map(c => ({ key:c.key, name:c.name }))).map(p => {
    const on = rg.prod === p.key;
    return {
      key: p.key, name: p.name, col: TONE[p.key] || '#9aa6bd',
      rate: has ? this.rigRate(p.mass) : '—',
      pct: has ? f(p.pct, 1) : '—',
      bar: has ? Math.max(0.6, p.pct) + '%' : '0%',
      tbp: has && p.mass > 0.05 ? f(p.tbp5, 0) + '–' + f(p.tbp95, 0) + ' °C' : '—',
      mid: has && p.mass > 0.05 ? f(p.tbp50, 0) + ' °C' : '—',
      sg: has && p.mass > 0.05 ? f(p.sg, 3) : '—',
      drawT: has ? f(p.drawT, 0) + ' °C' : '—',
      M: has && p.mol > 0 ? f(p.M, 0) : (has && p.M ? f(p.M, 0) : '—'),
      use: (RIGINFO.PRODUCTS[p.key] || {}).use || '',
      on: on, cls: 'rig-prod' + (on ? ' on' : '')
    };
  });

  /* ── headline figures ────────────────────────────────────────────── */
  const distillate = has ? r.products.filter(p => p.key !== 'residue')
                                     .reduce((a, p) => a + p.pct, 0) : 0;
  const keyFigs = [
    { k: 'Distillate yield', v: has ? f(distillate, 1) : '—', u: '% of charge', c: '#7fd8ff' },
    { k: 'Flash-zone vapour', v: has ? f(r.flash.psi * 100, 1) : '—', u: '% vaporised', c: '#ffb457' },
    { k: 'Top tray', v: has ? f(r.internals.Tprofile[1], 0) : '—', u: '°C', c: '#9fb8ff' },
    { k: 'Furnace duty', v: has ? f(r.energy.furnace, 0) : '—', u: 'MW', c: '#ff8a4c' },
    { k: 'Condenser duty', v: has ? f(r.energy.condenser, 0) : '—', u: 'MW', c: '#78d2ff' },
    { k: 'Residue', v: has ? f(r.products[r.products.length - 1].pct, 1) : '—', u: '% of charge', c: '#e65c7a' }
  ];

  /* ── mass balance ────────────────────────────────────────────────── */
  const bal = has ? {
    inMass: this.rigRate(r.balance.inMass) + ' t/h',
    steam: this.rigRate(r.steam.mass) + ' t/h',
    outMass: this.rigRate(r.balance.outMass) + ' t/h',
    closure: this.rigExp(Math.abs(r.balance.closure)),
    ok: Math.abs(r.balance.closure) <= 1e-6,
    tone: Math.abs(r.balance.closure) <= 1e-6 ? 'ok' : 'warn',
    verdict: Math.abs(r.balance.closure) <= 1e-6
      ? 'within the 1×10⁻⁶ tolerance — the products account for the whole charge.'
      : 'outside the 1×10⁻⁶ tolerance — treat the split as approximate.',
    rows: r.products.map(p => ({ k: p.name, v: this.rigRate(p.mass) + ' t/h',
                                 pct: f(p.pct, 2) + ' %', c: TONE[p.key] }))
  } : null;

  /* ── convergence ─────────────────────────────────────────────────── */
  const conv = has ? {
    converged: r.converged,
    label: r.converged ? 'Converged' : 'Iteration limit reached',
    tone: r.converged ? 'ok' : 'warn',
    outer: String(r.outer),
    flashIt: this.rigGroup(r.iters),
    flashItLabel: r.iters > 999 ? 'Equilibrium solves' : 'Flash iterations',
    ms: String(Math.round(r.ms)),
    note: r.converged
      ? 'The tray temperatures and the component flows both stopped moving inside tolerance.'
      : 'The solver stopped at its iteration limit with the profile still moving. The numbers below are the last state it reached — not a converged answer.',
    trace: this.rigTrace(r.trace)
  } : null;

  /* ── charts ──────────────────────────────────────────────────────── */
  const charts = has ? {
    profile: this.rigProfileChart(r),
    dist: products.filter(p => p.key).map((p, i) => ({
      name: p.name, col: p.col, pct: p.pct,
      w: has ? Math.max(0.4, r.products[i].pct) * 0.92 + '%' : '0%',
      y: 14 + i * 26
    }))
  } : null;

  /* ── the 2D diagram, from the same result ────────────────────────── */
  const d2 = RIG2D.build(r, rg.mode, rg.sel, rg.prod, rg.flow && !this.rigReduced());

  /* ── selection and instruments ───────────────────────────────────── */
  const info = RIGINFO.describe(rg.sel);
  const infoReads = info ? info.reads.map(k => this.rigRead(k, r)).filter(Boolean) : [];
  const cams = (this._cams || RIGINFO.cameras(PLANT.build())).map(c => ({
    k: c.key, label: c.label, cls: 'rig-cam' + (this._camPreset === c.key ? ' on' : '') }));
  const instruments = (this._plant ? this._plant.instruments : []).map(q => {
    const rd = this.rigRead(q.read, r);
    return { key: q.key, kind: q.kind, tag: q.key,
             val: rd ? rd.v : '—', unit: rd ? rd.u : '' };
  });

  const tour = rg.tour >= 0 ? RIGINFO.TOUR[rg.tour] : null;

  /* ── history ─────────────────────────────────────────────────────── */
  const hist = (rg.hist || []).map((h, i) => ({
    i: i, at: h.at, assay: CDU.ASSAY[h.assay].name,
    furnaceT: f(h.furnaceT, 0) + ' °C', reflux: f(h.reflux, 2),
    rate: this.rigRate(h.feedRate) + ' t/h',
    yield: f(h.yield, 1) + ' %',
    conv: h.conv ? 'converged' : 'limit',
    tone: h.conv ? 'ok' : 'warn',
    ms: h.ms + ' ms',
    cls: 'rig-hrow' + (i === 0 ? ' now' : '')
  }));

  const MODES = [['material', 'Material'], ['thermal', 'Thermal'], ['flow', 'Flow']];
  const VIEWS = [['3d', '3D'], ['2d', 'Process'], ['split', 'Both']];

  return {
    rigSt: { key: rg.status, label: st[0], note: st[1], tone: st[2] },
    rigBusy: busy,
    rigHasR: has,
    rigDirty: rg.dirty && has,
    rigRunLabel: busy ? st[0] : (has ? 'Run again' : 'Run simulation'),
    rigSections: sections,
    rigAssays: assays,
    rigAssayNote: CDU.ASSAY[rg.in.assay].note,
    rigProducts: products,
    rigKeyFigs: keyFigs,
    rigBal: bal,
    rigConv: conv,
    rigCharts: charts,
    rigD2: d2,
    rigInfo: info,
    rigInfoReads: infoReads,
    rigHasInfo: !!info,
    rigCams: cams,
    rigInstr: instruments,
    rigTourOn: rg.tour >= 0,
    rigTour: tour ? { i: rg.tour + 1, n: RIGINFO.TOUR.length,
                      title: tour.title, text: tour.text } : null,
    rigWarns: (rg.warns || []).map(w => ({ t: typeof w === 'string' ? w : (w.msg || '') })),
    rigErrs: (rg.errs || []).map(e => ({ t: typeof e === 'string' ? e : (e.msg || ''),
                                         field: (e && e.field) || '' })),
    rigHasWarn: (rg.warns || []).length > 0,
    rigHasErr: (rg.errs || []).length > 0,
    rigHist: hist,
    rigHasHist: hist.length > 0,
    rigAssumptions: C.RIG_ASSUMPTIONS,
    rigModes: MODES.map(m => ({ k: m[0], label: m[1],
                                cls: 'rig-seg' + (rg.mode === m[0] ? ' on' : '') })),
    rigViews: VIEWS.map(v => ({ k: v[0], label: v[1],
                                cls: 'rig-seg' + (rg.view === v[0] ? ' on' : '') })),
    rigShow3d: rg.view !== '2d',
    rigShow2d: rg.view !== '3d',
    rigSplit: rg.view === 'split',
    rigStageCls: 'rig-stage v-' + rg.view + (rg.expert ? ' expert' : ''),
    rigExpert: rg.expert,
    rigExpertR: rg.expert && has,
    rigStageNote: rg.expert
      ? 'Every stage the solver carries, with the liquid and vapour traffic on it, in kmol/h.'
      : 'The named stages, top to bottom. Expert view lists every tray and its internal traffic.',
    rigExpertLabel: rg.expert ? 'Expert view on' : 'Expert view',
    rigFlowLabel: rg.flow ? 'Pause flow' : 'Resume flow',
    rigGl: rg.gl3d !== false,
    rigGlNote: this._glFail || '',
    rigStages: has ? this.rigStages(r, rg.expert) : [],
    rigFlows: has ? this.rigFlows(r) : [],
    rigCut: has ? this.rigCutChart(r, rg.prod) : null,
    rigPre: rg.pre ? {
      psi: f(rg.pre.flash.psi * 100, 1),
      F: this.rigRate(rg.pre.feed.molar),
      M: f(rg.pre.feed.M, 1),
      api: rg.pre.feed.api + '°'
    } : null,

    /* handlers */
    rigDo: (e) => {
      const d = e.currentTarget.dataset;
      if (d.act === 'run') this.rigRun();
      else if (d.act === 'reset') this.rigReset();
      else if (d.act === 'save') this.rigSave();
      else if (d.act === 'tour') this.state.rig.tour >= 0 ? (this.rigTourStop(), this.setRig({ tour: -1 })) : this.rigTourGo(0);
      else if (d.act === 'tourNext') this.rigTourGo(this.state.rig.tour + 1);
      else if (d.act === 'expert') this.setRig({ expert: !this.state.rig.expert });
      else if (d.act === 'flow') { const v = !this.state.rig.flow; if (this._gl) this._gl.state.flow = v; this.setRig({ flow: v }); }
      else if (d.act === 'clear') this.rigSelect(null);
      else if (d.act === 'home') this.leaveRig();
    },
    rigSection: (e) => { const k = e.currentTarget.dataset.k;
      this.setRig({ open: Object.assign({}, this.state.rig.open, { [k]: !this.state.rig.open[k] }) }); },
    rigNum: (e) => this.rigSet(e.target.dataset.k, e.target.value),
    rigAssay: (e) => { this.setRig({ in: Object.assign({}, this.state.rig.in, { assay: e.currentTarget.dataset.k }), dirty: true }); },
    rigMode: (e) => { const m = e.currentTarget.dataset.k;
      this.setRig({ mode: m });
      if (this._gl) { this._gl.state.mode = m; this._gl.state.flow = this.state.rig.flow; }
      setTimeout(() => this._rigApplyResult(), 0); },
    rigViewSet: (e) => { this.setRig({ view: e.currentTarget.dataset.k }); },
    rigCamPick: (e) => this.rigCamTo(e.currentTarget.dataset.k),
    rigPick2d: (e) => this.rigSelect(e.currentTarget.dataset.k || null),
    rigProdPick: (e) => this.rigProduct(e.currentTarget.dataset.k),
    rigHistLoad: (e) => this.rigLoadCase(this.state.rig.hist[+e.currentTarget.dataset.i].snap),
    rigFile: (e) => this.rigLoad(e),
    rigFileRef: (el) => { this._rigFile = el; },
    rigOpenFile: () => { if (this._rigFile) this._rigFile.click(); }
  };
}

/** One instrument reading, formatted, or null when nothing has been solved. */
rigRead(k, r) {
  if (!r) return null;
  const f = (v, d) => this.rigFmt(v, d);
  const M = {
    charge:      () => ({ l: 'Charge', v: this.rigRate(r.feed.mass), u: 't/h' }),
    feedT:       () => ({ l: 'Preheat outlet', v: f(r.feed.T, 0), u: '°C' }),
    furnaceT:    () => ({ l: 'Furnace outlet', v: f(r.flash.T, 0), u: '°C' }),
    furnaceDuty: () => ({ l: 'Furnace duty', v: f(r.energy.furnace, 0), u: 'MW' }),
    condDuty:    () => ({ l: 'Condenser duty', v: f(r.energy.condenser, 0), u: 'MW' }),
    flashP:      () => ({ l: 'Flash-zone pressure', v: f(r.flash.P, 0), u: 'kPa' }),
    flashT:      () => ({ l: 'Flash-zone temperature', v: f(r.flash.T, 0), u: '°C' }),
    psi:         () => ({ l: 'Vaporised', v: f(r.flash.psi * 100, 1), u: '%' }),
    topT:        () => ({ l: 'Top tray', v: f(r.internals.Tprofile[1], 0), u: '°C' }),
    top:         () => ({ l: 'Top tray', v: f(r.internals.Tprofile[1], 0), u: '°C' }),
    flash:       () => ({ l: 'Flash zone', v: f(r.flash.T, 0), u: '°C' }),
    kerosene:    () => this.rigDrawT(r, 'kerosene'),
    diesel:      () => this.rigDrawT(r, 'diesel'),
    gasoil:      () => this.rigDrawT(r, 'gasoil'),
    topP:        () => ({ l: 'Overhead pressure', v: f(r.internals.Pprofile[0], 0), u: 'kPa' }),
    bottomT:     () => ({ l: 'Sump', v: f(r.energy.Tbot, 0), u: '°C' }),
    drum:        () => ({ l: 'Reflux drum', v: f(r.energy.Ttop, 0), u: '°C' }),
    reflux:      () => ({ l: 'Reflux ratio', v: f(r.internals.reflux, 2), u: '' }),
    stages:      () => ({ l: 'Theoretical stages', v: String(r.internals.stages), u: '' }),
    steam:       () => ({ l: 'Stripping steam', v: this.rigRate(r.steam.mass), u: 't/h' }),
    sideSteam:   () => ({ l: 'Side-stripper steam', v: f(r.steam.side, 1), u: '% of draw' }),
    gas:         () => ({ l: 'Wet gas', v: this.rigRate(r.products[0].mass), u: 't/h' })
  };
  return M[k] ? M[k]() : null;
}

/** The tray temperature at a side draw, read off the solved profile. */
rigDrawT(r, key) {
  const p = r.products.filter(q => q.key === key)[0];
  return { l: (p ? p.name : key) + ' draw', v: this.rigFmt(p ? p.drawT : NaN, 0), u: '\u00b0C' };
}

/** The temperature profile, as a chart and as a list of selectable stages. */
rigProfileChart(r) {
  const T = r.internals.Tprofile, P = r.internals.Pprofile;
  const W = 300, H = 190, ml = 34, mb = 26, mt = 10, mr = 8;
  const n = T.length;
  const lo = Math.min.apply(null, T), hi = Math.max.apply(null, T);
  const pad = Math.max(6, (hi - lo) * 0.06);
  const t0 = lo - pad, t1 = hi + pad;
  const X = (t) => ml + (W - ml - mr) * (t - t0) / Math.max(1e-6, t1 - t0);
  const Y = (j) => mt + (H - mt - mb) * (j / Math.max(1, n - 1));
  const pts = T.map((t, j) => X(t).toFixed(1) + ',' + Y(j).toFixed(1)).join(' ');
  const dots = T.map((t, j) => ({
    x: X(t).toFixed(1), y: Y(j).toFixed(1), t: this.rigFmt(t, 0),
    label: r.internals.stageLabel[j] || ('Stage ' + j),
    kind: r.internals.stageKind[j] || '',
    p: this.rigFmt(P[j], 0),
    r: (r.internals.stageKind[j] === 'draw' || j === 0 || j === r.internals.feedStage) ? 3.6 : 2.0,
    col: RIG2D.heat(t, 30, 380)
  }));
  const ticks = [];
  for (let q = 0; q <= 4; q++) {
    const t = t0 + (t1 - t0) * q / 4;
    ticks.push({ x: X(t).toFixed(1), y: H - mb + 14, label: this.rigFmt(t, 0) });
  }
  return { w: W, h: H, pts: pts, dots: dots, ticks: ticks,
           axisY: (H - mb).toFixed(1), axisX: ml, top: mt };
}

/** The residual trajectory, plotted on a log scale — what the solver actually
 *  did, not an assertion that it worked. */
rigTrace(tr) {
  if (!tr || tr.length < 2) return null;
  const W = 300, H = 92, ml = 30, mb = 16, mt = 8, mr = 6;
  const y = tr.map(q => Math.log10(Math.max(1e-9, q[1])));
  const lo = Math.min.apply(null, y), hi = Math.max.apply(null, y);
  const X = (i) => ml + (W - ml - mr) * (i / Math.max(1, tr.length - 1));
  const Y = (v) => mt + (H - mt - mb) * (1 - (v - lo) / Math.max(1e-6, hi - lo));
  return {
    w: W, h: H,
    pts: y.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' '),
    n: tr.length, hi: this.rigExp(Math.pow(10, hi)), lo: this.rigExp(Math.pow(10, lo)),
    axisY: (H - mb).toFixed(1), axisX: ml
  };
}

/** The stages, with what the solver computed on each. The ordinary view lists
 *  the ones an operator names — the condenser, the draws, the flash zone, the
 *  sump — and expert view lists every one of them with its internal traffic. */
rigStages(r, expert) {
  const I = r.internals, out = [];
  const keep = { cond: 1, draw: 1, feed: 1, sump: 1 };
  for (let j = 0; j < I.Tprofile.length; j++) {
    const kind = I.stageKind[j] || 'tray';
    if (!expert && !keep[kind] && j !== 0 && j !== I.Tprofile.length - 1) continue;
    out.push({
      j: j, label: I.stageLabel[j] || ('Stage ' + j), kind: kind,
      T: this.rigFmt(I.Tprofile[j], 0),
      P: this.rigFmt(I.Pprofile[j], 0),
      L: this.rigRate(I.Lprofile[j]),
      V: this.rigRate(I.Vprofile[j]),
      steam: this.rigRate(I.steamProfile[j] || 0),
      col: RIG2D.heat(I.Tprofile[j], 30, 380),
      cls: 'rig-stg k-' + kind
    });
  }
  return out;
}

/** Internal traffic, in the units the solver works in. Expert view only: these
 *  are molar rates inside the tower, not product rates, and quoting them next
 *  to the yields would invite the two to be confused. */
rigFlows(r) {
  const I = r.internals, f = (v, d) => this.rigFmt(v, d);
  return [
    { k: 'Reflux to the top tray', v: this.rigRate(I.Ltop), u: 'kmol/h' },
    { k: 'Vapour off the flash zone', v: this.rigRate(I.Vflash), u: 'kmol/h' },
    { k: 'Liquid to the sump', v: this.rigRate(I.Lflash), u: 'kmol/h' },
    { k: 'Distillate, vapour', v: this.rigRate(I.Dvap), u: 'kmol/h' },
    { k: 'Distillate, liquid', v: this.rigRate(I.Dliq), u: 'kmol/h' },
    { k: 'Theoretical stages', v: String(I.stages), u: '' },
    { k: 'Cascade stages solved', v: String(I.cascade), u: '' },
    { k: 'Flash-zone stage index', v: String(I.feedStage), u: '' },
    { k: 'Charge, molar', v: this.rigRate(r.feed.molar), u: 'kmol/h' },
    { k: 'Mean molar mass', v: f(r.feed.M, 1), u: 'kg/kmol' },
    { k: 'Stripping steam', v: this.rigRate(r.steam.molar), u: 'kmol/h' }
  ];
}

/** The composition of one product on the pseudocomponent grid — the model's
 *  own internal representation, shown rather than described. */
rigCutChart(r, prodKey) {
  const p = r.products.filter(q => q.key === (prodKey || 'kerosene'))[0] || r.products[2];
  const tot = p.comp.reduce((a, v) => a + v, 0);
  if (!(tot > 0)) return null;
  const W = 300, H = 110, ml = 6, mb = 18, mt = 6;
  const n = p.comp.length, bw = (W - ml * 2) / n;
  const mx = Math.max.apply(null, p.comp);
  const bars = p.comp.map((v, i) => ({
    x: (ml + i * bw).toFixed(1), w: Math.max(1.5, bw - 1.4).toFixed(1),
    h: Math.max(0.6, (H - mt - mb) * v / mx).toFixed(1),
    y: (H - mb - Math.max(0.6, (H - mt - mb) * v / mx)).toFixed(1),
    col: RIG2D.heat(CDU.NBP_C[i], 30, 380),
    nbp: CDU.NBP_C[i]
  }));
  return { w: W, h: H, bars: bars, name: p.name,
           axisY: (H - mb).toFixed(1),
           lo: CDU.NBP_C[0] + ' \u00b0C', hi: CDU.NBP_C[n - 1] + ' \u00b0C',
           note: 'Molar flow of each pseudocomponent in the ' + p.name.toLowerCase() +
                 ', by normal boiling point. This is the grid the model actually solves on.' };
}
