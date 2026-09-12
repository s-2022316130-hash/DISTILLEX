#!/usr/bin/env node
/* DISTILLEX regression suite.
 *
 *     node tools/test.js            run everything
 *     node tools/test.js --list     list the suites
 *     node tools/test.js <name>...  run selected suites
 *
 * Exits non-zero on any failure. No dependencies.
 *
 * Every check here is SELF-CONTAINED: the engine is compared against closed-form
 * analytic results, against its own internal consistency, or against values it
 * must reproduce by construction. Nothing is compared against a reference value
 * transcribed from the literature — no such validation has been performed.  */
'use strict';
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { load, SRC } = require('./engine.js');

const { Component, captured, source } = load();
const BASE = Object.assign({}, new Component().state);
const S = o => Object.assign({}, BASE, o);
const C = () => new Component();

let pass = 0, fail = 0, current = '';
function ok(cond, label, detail) {
  if (cond) { pass++; if (process.env.DX_VERBOSE) console.log('    ok   ' + label); }
  else { fail++; console.log('    FAIL ' + current + ' :: ' + label + (detail ? '  :: ' + detail : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ── 1. engine identity ─────────────────────────────────────────────────── */
function suiteIdentity() {
  const seg = (a, b) => source.slice(source.indexOf(a), source.indexOf(b));
  const sha = t => crypto.createHash('sha256').update(t).digest('hex');
  const solve = seg('\n  solve(s){', '\n  variant(s,over)');
  ok(sha(solve) === 'b453c27d147cbeca101fbb703b196f322691295918e026cc6336ca573353ffac',
     'solve() SHA-256 unchanged', sha(solve));
  ok(solve.length === 7751, 'solve() byte length unchanged', String(solve.length));
  // every engine entry point must sit behind the validation gate
  ok((source.match(/this\.solve\(/g) || []).length === 2,
     'exactly two this.solve( call sites, both gated');
}

/* ── 2. analytic benchmarks (closed form, constant relative volatility) ──── */
function suiteAnalytic() {
  const c = C(), a = 2.45, xD = 0.95, xB = 0.05, zF = 0.5;
  const r = c.solve(S({ model: 'alpha', alphaC: a, zF, xD, xB, q: 1, R: 2.0 }));
  // Fenske at total reflux:  N_min = ln[(xD/(1-xD))·((1-xB)/xB)] / ln α
  const NminA = Math.log((xD / (1 - xD)) * ((1 - xB) / xB)) / Math.log(a);
  // Underwood for a binary at q = 1:  R_min = [xD/zF − α(1-xD)/(1-zF)] / (α−1)
  const RminA = (xD / zF - a * (1 - xD) / (1 - zF)) / (a - 1);
  ok(near(r.Nmin, NminA, 1e-12), 'Fenske N_min matches the closed form',
     r.Nmin.toFixed(12) + ' vs ' + NminA.toFixed(12) + '  err ' + Math.abs(r.Nmin - NminA).toExponential(3));
  ok(near(r.Rmin, RminA, 1e-12), 'Underwood R_min matches the closed form',
     r.Rmin.toFixed(12) + ' vs ' + RminA.toFixed(12) + '  err ' + Math.abs(r.Rmin - RminA).toExponential(3));
  // At total reflux the stage count must approach ceil(N_min).
  const tot = c.solve(S({ model: 'alpha', alphaC: a, zF, xD, xB, q: 1, R: 1e4 }));
  ok(tot.N === Math.ceil(NminA), 'stage count at total reflux equals ceil(N_min)',
     tot.N + ' vs ' + Math.ceil(NminA));
}

/* ── 3. pure-component vapour-pressure self-check ───────────────────────── */
function suitePureComponent() {
  const c = C();
  for (const [k, comp] of Object.entries(Component.COMP)) {
    const p = c.psat(comp, comp.Tb);            // must return 1 atm at its own T_b
    ok(Math.abs(p - 101.325) / 101.325 < 0.01,
       'psat(' + k + ', T_b) is within 1% of 1 atm', p.toFixed(4) + ' kPa');
  }
}

/* ── 4. bubble/dew consistency and interpolation error ──────────────────── */
function suiteThermo() {
  const c = C(), s = S({ mixKey: 'bt' });
  let worst = 0;
  for (let i = 1; i < 40; i++) {
    const x = i / 40;
    worst = Math.max(worst, Math.abs(c.dewT(c.yEq(x, s), s) - c.bubbleT(x, s)));
  }
  ok(worst < 1e-10, 'T_bubble(x) equals T_dew(y*(x))', 'max ' + worst.toExponential(3) + ' °C');
  ok(near(c.bubbleT(0, s), 110.6253, 1e-3), 'benzene/toluene bubble point at x=0', c.bubbleT(0, s).toFixed(4));
  ok(near(c.bubbleT(1, s), 80.1000, 1e-3), 'benzene/toluene bubble point at x=1', c.bubbleT(1, s).toFixed(4));
  // interpolated y*(x) against the Raoult expression it tabulates
  const [A] = c.compsOf(s);
  let err = 0;
  for (let i = 0; i <= 1000; i++) {
    const x = i / 1000, T = c.bubbleT(x, s);
    err = Math.max(err, Math.abs(c.yEq(x, s) - x * c.psat(A, T) / s.P));
  }
  ok(err < 1e-4, 'equilibrium interpolation stays inside its stated 1e-4 bound',
     'max ' + err.toExponential(3) + ' mole fraction');

  // Under the constant-alpha model the curve is generated from alpha alone
  // while the temperatures still come from the pair's Antoine bubble curve.
  // The two are decoupled by construction, so the Raoult identity above must
  // NOT be asserted there; what must hold is that the tabulated curve
  // reproduces the constant-alpha relation exactly.
  for (const a of [1.5, 2.45, 4]) {
    const sa = S({ mixKey: 'bt', model: 'alpha', alphaC: a });
    const N = 240;                       // the tabulated curve has N+1 nodes
    let node = 0, mid = 0, td = 0;
    for (let i = 0; i <= N; i++) {       // at a node the relation is exact
      const x = i / N;
      node = Math.max(node, Math.abs(c.yEq(x, sa) - a * x / (1 + (a - 1) * x)));
    }
    for (let i = 0; i < N; i++) {        // between nodes only linear interpolation
      const x = (i + 0.5) / N;
      mid = Math.max(mid, Math.abs(c.yEq(x, sa) - a * x / (1 + (a - 1) * x)));
    }
    for (let i = 1; i < 40; i++) {
      const x = i / 40;
      td = Math.max(td, Math.abs(c.dewT(c.yEq(x, sa), sa) - c.bubbleT(x, sa)));
    }
    ok(node <= 1e-12, 'alpha=' + a + ': y*(x) is exact at the tabulated nodes',
       'max ' + node.toExponential(3));
    ok(mid < 1e-4, 'alpha=' + a + ': interpolation between nodes stays inside the 1e-4 bound',
       'max ' + mid.toExponential(3));
    // the temperatures must be exactly the Raoult ones - they never see alpha
    ok(Math.abs(c.bubbleT(0.5, sa) - c.bubbleT(0.5, s)) < 1e-12,
       'alpha=' + a + ': temperatures are the pair bubble curve, independent of alpha');
    if (a !== 2.45) ok(td > 1e-3,
       'alpha=' + a + ': the Raoult T identity is genuinely decoupled here (so it is not asserted)',
       'max ' + td.toFixed(4) + ' °C');
  }
}

/* ── 5. engine invariants over the feasible design space ────────────────── */
function suiteInvariants() {
  const c = C(); let n = 0, viol = 0;
  const bad = (cond, what) => { if (!cond) { viol++; if (viol < 4) console.log('    FAIL invariant: ' + what); } };
  for (const mixKey of ['bt', 'ew', 'mw', 'hh', 'aw'])
    for (const q of [0.5, 1, 1.3])
      for (const R of [1.8, 2.5, 4])
        for (const xD of [0.9, 0.96, 0.99])
          for (const xB of [0.02, 0.05]) {
            const s = S({ mixKey, q, R, xD, xB, zF: 0.45 });
            const r = c.solve(s); if (!r.ok) continue; n++;
            bad(Math.abs(r.F - (r.D + r.B)) < 1e-9, 'overall balance');
            bad(Math.abs(r.F * r.zF - (r.D * r.xD + r.B * r.xB)) < 1e-9, 'component balance');
            bad(Math.abs(r.V - (r.R + 1) * r.D) < 1e-9, 'V=(R+1)D');
            bad(Math.abs(r.L - r.R * r.D) < 1e-9, 'L=RD');
            bad(Math.abs(r.Lb - (r.L + r.q * r.F)) < 1e-9, 'Lbar=L+qF');
            bad(Math.abs(r.Vb - (r.V - (1 - r.q) * r.F)) < 1e-9, 'Vbar=V-(1-q)F');
            bad(Math.abs(r.stages[0].y - r.xD) < 1e-12, 'y1=xD (total condenser)');
            bad(r.Nmin <= r.N + 1e-9, 'Nmin<=N');
            bad(r.R > r.Rmin - 1e-12, 'R>Rmin');
            bad(r.Qc > 0 && r.Qr > 0, 'duties positive');
            bad(r.rec > 0 && r.rec <= 1 + 1e-12, 'recovery in (0,1]');
            bad(r.feedStage >= 1 && r.feedStage <= r.N, 'feed stage in range');
            const mr = r.R / (r.R + 1), br = r.xD / (r.R + 1);
            for (let i = 0; i < r.stages.length; i++) {
              const st = r.stages[i];
              bad(Math.abs(c.xEq(st.y, s) - st.x) < 1e-9, 'stage x = x*(y)');
              const exp = st.rect ? mr * st.x + br : r.xB + r.slopeS * (st.x - r.xB);
              bad(Math.abs(st.yn - exp) < 1e-9, 'yn on the operating line');
              if (i) {
                bad(st.x <= r.stages[i - 1].x + 1e-12, 'x monotone');
                bad(st.y <= r.stages[i - 1].y + 1e-12, 'y monotone');
                bad(Math.abs(st.y - r.stages[i - 1].yn) < 1e-12, 'y[i+1]=yn[i]');
              }
            }
          }
  ok(n >= 250, 'a representative slice of the feasible space was covered', n + ' cases');
  ok(viol === 0, 'all engine invariants hold', viol + ' violations');
}

/* ── 6. full design/rating matrix fingerprint ───────────────────────────── */
function suiteMatrix() {
  const c = C(), rows = [];
  const j = r => JSON.stringify(r, (k, v) =>
    typeof v === 'function' ? null : (typeof v === 'number' && !isFinite(v) ? String(v) : v));
  for (const mixKey of ['bt', 'ew', 'mw', 'hh', 'aw'])
    for (const q of [0.5, 1, 1.5])
      for (const R of [1.6, 2.2, 3.5])
        for (const xD of [0.9, 0.96, 0.99])
          rows.push(j(c.solve(S({ mixKey, q, R, xD, xB: 0.04, zF: 0.45 }))));
  for (let N = 4; N <= 40; N += 2)
    for (let DF = 0.1; DF <= 0.9; DF += 0.1)
      for (const R of [1.6, 2.2, 3.5])
        rows.push(j(c.solve(S({ calcMode: 'rating', Nspec: N, DF: +DF.toFixed(2), R }))));
  const sha = crypto.createHash('sha256').update(rows.join('\n')).digest('hex');
  ok(rows.length === 648, 'the matrix covers 648 cases', String(rows.length));
  ok(sha === 'b66346c7bb7c0f06051dae04195125e9ae41133ae7cd8d0a0e757347632ea6c2',
     '648-case design/rating fingerprint unchanged', sha);
}

/* ── 7. input validation and the two P1-B bypass blockers ───────────────── */
function suiteValidation() {
  const hostile = [
    ['F empty', { F: '' }], ['F text', { F: 'abc' }], ['F NaN', { F: NaN }],
    ['F Infinity', { F: Infinity }], ['F<=0', { F: 0 }], ['P<=0', { P: 0 }],
    ['R<=0', { R: 0 }], ['zF<=0', { zF: 0 }], ['zF>=1', { zF: 1 }],
    ['xD>=1', { xD: 1 }], ['xB<=0', { xB: 0 }], ['eff<=0', { eff: 0 }], ['eff>1', { eff: 1.5 }],
    ['N<3', { calcMode: 'rating', Nspec: 2, DF: 0.45 }],
    ['N>60', { calcMode: 'rating', Nspec: 61, DF: 0.45 }],
    ['N fractional', { calcMode: 'rating', Nspec: 7.5, DF: 0.45 }],
    ['N negative', { calcMode: 'rating', Nspec: -5, DF: 0.45 }],
    ['alpha<=1', { model: 'alpha', alphaC: 1 }], ['alpha<=0', { model: 'alpha', alphaC: 0 }],
    ['alpha negative', { model: 'alpha', alphaC: -2 }],
    ['D/F>=1', { calcMode: 'rating', Nspec: 12, DF: 1.5 }],
    ['custom null', { mixKey: 'custom', custom: null }],
    ['custom malformed', { mixKey: 'custom', custom: { a: { name: 'A' }, b: null } }],
    ['custom Antoine C', { mixKey: 'custom', custom: {
       a: { name: 'A', A: 6.9, B: 1211, C: -100, MW: 78, Tb: 80, lat: 30 },
       b: { name: 'B', A: 6.95, B: 1344, C: 219, MW: 92, Tb: 110, lat: 33 } } }],
    ['unknown mixture', { mixKey: 'zzz' }],
  ];
  let reached = 0, threw = 0, unvalidated = 0;
  for (const [label, over] of hostile) {
    const i = C(); i.state = S(Object.assign({ view: 'sens' }, over));
    const real = i.solve.bind(i);
    i.solve = x => { reached++; if (!i.validateInputs(x).ok) unvalidated++; return real(x); };
    let v = null;
    try {
      v = i.renderVals(); v.runWhatIf(); v.runSteps();
      if (i._t) { clearInterval(i._t); i._t = null; }
      v.exportCSV(); v.exportJSON(); i.variant(i.state, {});
    } catch (e) { threw++; console.log('    FAIL threw on ' + label + ': ' + e.message); }
    if (!v) continue;
    const shown = JSON.stringify([v.liveRows, v.calcRows, v.stageRows, v.r, v.compRows]);
    ok(v.issues.some(x => x.text.indexOf('⚠') === 0), label + ' is rejected');
    ok(!/NaN|Infinity/.test(shown), label + ' shows no NaN or Infinity');
    ok(!v.hasWhatIf, label + ' leaves no stale comparison');
    ok(i._t == null, label + ' leaves no running interval');
  }
  ok(threw === 0, 'no entry point throws on hostile input');
  ok(unvalidated === 0, 'solve() never receives unvalidated state',
     unvalidated + ' of ' + reached + ' calls');

  // The Validation page recomputes several cases of its own. It must be behind
  // the same gate: hostile input may make it skip checks, never report a
  // failing one, and never leak NaN into the table.
  let vThrew = 0, vFailRows = 0, vNaN = 0;
  for (const [label, over] of hostile) {
    const i = C(); i.state = S(Object.assign({ view: 'validate' }, over));
    const real = i.solve.bind(i);
    i.solve = x => { if (!i.validateInputs(x).ok) unvalidated++; return real(x); };
    try {
      const val = i.renderVals().val;
      const rows = val.groups.reduce((a, g) => a.concat(g.rows), []);
      const bad = rows.filter(r => r.status === '✗');
      // a not-applicable row must be reported as such, never tallied as a pass
      if (rows.some(r => r.skipped && r.status !== '—')) { vFailRows++;
        console.log('    FAIL skipped row not marked as such on ' + label); }
      if (val.total !== rows.filter(r => !r.skipped).length) { vFailRows++;
        console.log('    FAIL skipped rows counted in the total on ' + label); }
      if (bad.length) { vFailRows++; console.log('    FAIL validation page reports a failure on ' +
        label + ': ' + bad.map(r => r.check).join(', ')); }
      if (/NaN|Infinity/.test(JSON.stringify(rows))) { vNaN++;
        console.log('    FAIL validation page shows NaN on ' + label); }
    } catch (e) { vThrew++; console.log('    FAIL validation page threw on ' + label + ': ' + e.message); }
  }
  ok(vThrew === 0, 'the Validation page never throws on hostile input');
  ok(vFailRows === 0, 'the Validation page never reports a false failure on hostile input');
  ok(vNaN === 0, 'the Validation page never shows NaN or Infinity');
  ok(unvalidated === 0, 'the Validation page never routes unvalidated state to solve()');

  // and on a valid case it must actually produce checks, all of them passing
  for (const [label, over] of [['raoult', {}], ['alpha', { model: 'alpha', alphaC: 2.45 }],
                               ['rating', { calcMode: 'rating', Nspec: 12, DF: 0.45 }]]) {
    const i = C(); i.state = S(Object.assign({ view: 'validate' }, over));
    const val = i.renderVals().val;
    ok(val.total > 10 && val.failed === 0,
       'the Validation page passes all of its own checks on a valid ' + label + ' case',
       val.failed + ' of ' + val.total + ' failed');
  }
}

/* ── 8. configuration save / load ───────────────────────────────────────── */
function suiteSaveLoad() {
  const CUSTOM = {
    a: { name: 'Propan-2-ol', A: 8.11778, B: 1580.92, C: 219.61, MW: 60.10, Tb: 82.3, lat: 39.85 },
    b: { name: 'Propan-1-ol', A: 7.74416, B: 1437.686, C: 198.463, MW: 60.10, Tb: 97.2, lat: 41.44 } };
  const save = inst => { inst.renderVals().saveCfg();
    return JSON.parse(captured.filter(x => x.name === 'distillex-config.json').pop().text); };
  const loadInto = (inst, o) => {
    const clean = {};
    Component.CFG_KEYS.forEach(k => { if (k in o) clean[k] = o[k]; });
    if (o.custom !== undefined) clean.custom = inst.customRecord(o.custom);
    inst.setState(Object.assign({ whatIf: null }, clean));
  };
  const j = r => JSON.stringify(r, (k, v) => typeof v === 'function' ? null : v);

  const a = C(); a.state = S({ mixKey: 'custom', custom: JSON.parse(JSON.stringify(CUSTOM)), R: 2.8 });
  const before = a.solve(a.state);
  const file = save(a);
  ok('custom' in file, 'a saved configuration carries the custom mixture');
  const b = C(); b.state = S({}); loadInto(b, file);
  ok(JSON.stringify(b.state.custom) === JSON.stringify(CUSTOM), 'custom record round-trips exactly');
  ok(j(b.solve(b.state)) === j(before), 'the reloaded configuration reproduces the same solution');
  ok(JSON.stringify(save(b)) === JSON.stringify(file), 're-saving reproduces the same file');

  const legacy = C(); legacy.state = S({ mixKey: 'custom', custom: JSON.parse(JSON.stringify(CUSTOM)) });
  const keep = JSON.stringify(legacy.state.custom);
  loadInto(legacy, { mixKey: 'bt', R: 3 });             // a file written before custom was persisted
  ok(JSON.stringify(legacy.state.custom) === keep, 'a file without `custom` leaves the record untouched');
  ok(legacy.state.mixKey === 'bt' && legacy.state.R === 3, 'its other keys still load');

  const inj = C(); inj.state = S({});
  loadInto(inj, { mixKey: 'bt', view: 'zzz', whatIf: { x: 1 }, mtDrag: 'xD' });
  ok(inj.state.view === 'landing' && !inj.state.whatIf && inj.state.mtDrag === null,
     'a file cannot inject non-configuration state');
}

/* ── 9. reported numerics match the code that produces them ─────────────── */
function suiteDisclosures() {
  const i = C(); i.state = S({ view: 'sim', mode: 'advanced' });
  const lines = i.renderVals().modeLines.join('\n');
  const bub = /bubbleT\(x,s\)\{[\s\S]*?\n  \}/.exec(source)[0];
  const lo = +/let lo=(-?\d+)/.exec(bub)[1], hi = +/hi=(\d+)/.exec(bub)[1];
  const iters = +/for\(let i=0;i<(\d+);i\+\+\)/.exec(bub)[1];
  ok(lines.indexOf(String(hi - lo) + ' °C bracket') >= 0, 'stated bracket width matches the code', String(hi - lo));
  ok(lines.indexOf(iters + ' halvings') >= 0, 'stated iteration count matches the code', String(iters));
  const res = (hi - lo) / Math.pow(2, iters);
  ok(res > 1e-19 && res < 1e-18 && lines.indexOf('5×10⁻¹⁹') >= 0,
     'stated resolution matches width / 2^iterations', res.toExponential(2) + ' °C');
  const mr = /minReflux\(s,xD\)\{[\s\S]*?\n  \}/.exec(source)[0];
  const n = +/n=(\d+);/.exec(mr)[1];
  ok(lines.indexOf((n - 1) + ' interior points') >= 0, 'stated tangent-scan count matches the loop', String(n - 1));
  const nodes = +/const n=(\d+), xs=/.exec(/curve\(s\)\{[\s\S]*?\n  \}/.exec(source)[0])[1] + 1;
  ok(lines.indexOf(nodes + ' points') >= 0, 'stated equilibrium node count matches the code', String(nodes));
  const rating = C(); rating.state = S({ view: 'sim', mode: 'advanced', calcMode: 'rating' });
  ok(rating.renderVals().modeLines.join('\n').indexOf('10⁻⁴ mole fraction') >= 0,
     'stated rating tolerance matches RATING_TOL', String(Component.RATING_TOL));
  // the constant-alpha temperature decoupling must stay disclosed
  const al = C(); al.state = S({ view: 'results', model: 'alpha', alphaC: 2.45 });
  const as = al.renderVals().assumptions.join('\n');
  ok(/do not depend on α/.test(as) && /nominal overlay/.test(as),
     'constant-α temperature overlay is disclosed in the assumptions');
  const ra = C(); ra.state = S({ view: 'results', model: 'raoult' });
  ok(!/nominal overlay/.test(ra.renderVals().assumptions.join('\n')),
     'that caveat is not shown under the Raoult model, where it does not apply');

  // The README quotes engine-derived figures. They drifted once, so they are
  // recomputed here rather than trusted.
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const mmHg = (k) => {
    const comp = Component.COMP[k];
    return { t: comp.Tb, v: i.psat(comp, comp.Tb) / 0.13332239 };
  };
  for (const [k, label] of [['benzene', 'benzene'], ['water', 'water']]) {
    const { t, v } = mmHg(k);
    const want = v.toFixed(1) + ' mmHg';
    ok(readme.indexOf(want) >= 0,
       'README quotes the computed ' + label + ' self-check (' + want + ')', want);
    ok(readme.indexOf(String(t) + ' °C') >= 0 || readme.indexOf(t.toFixed(1) + ' °C') >= 0,
       'README quotes ' + label + "'s actual normal boiling point", String(t) + ' °C');
  }
  ok(readme.indexOf('~' + Math.round(fs.statSync(path.join(__dirname, '..', 'index.html')).size / 1024) + ' KB') >= 0,
     'README quotes the actual size of index.html');
  // the src/ mirror must stay a mirror: what ships has to match what is stored
  const idx2 = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const man2 = JSON.parse(/<script type="__bundler\/manifest">\s*([\s\S]*?)\s*<\/script>/.exec(idx2)[1]);
  const zlib2 = require('zlib');
  const shipped = Object.values(man2).map(e => {
    const raw = Buffer.from(e.data, 'base64');
    return e.compressed ? zlib2.gunzipSync(raw) : raw;
  });
  const stored = fs.readFileSync(path.join(__dirname, '..', 'src', 'support.js'));
  ok(shipped.some(b => b.equals(stored)),
     'src/support.js is byte-identical to the runtime the bundle actually ships');
  const dsDir = path.join(__dirname, '..', 'src', '_ds');
  const themeDir = path.join(dsDir, fs.readdirSync(dsDir)[0]);
  const dsb = fs.readFileSync(path.join(themeDir, '_ds_bundle.js'));
  ok(shipped.some(b => b.equals(dsb)),
     'src/_ds/_ds_bundle.js is a real shipped asset, not an inert stub');
  // and the build must keep depending on its <script> tag
  ok(/<script src="_ds\/[^"]+_ds_bundle\.js"><\/script>/.test(source),
     'the _ds_bundle.js script tag is present — build.py uses it to place the design-system layer');
}

/* ── 12. deployment security headers ───────────────────────────────────── */
function suiteHeaders() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const rules = cfg.headers || [];
  const all = rules.filter(r => r.source === '/(.*)');
  ok(all.length === 1, 'exactly one catch-all header rule covers every path');
  if (!all.length) return;
  const H = {};
  for (const h of all[0].headers) H[h.key.toLowerCase()] = h.value;

  for (const [k, want] of [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'SAMEORIGIN'],
    ['referrer-policy', 'no-referrer'],
    ['cross-origin-opener-policy', 'same-origin'],
    ['cross-origin-resource-policy', 'same-origin'],
  ]) ok(H[k] === want, k + ' is ' + want, String(H[k]));
  ok(/^max-age=\d+/.test(H['strict-transport-security'] || ''),
     'HSTS is set with a max-age', H['strict-transport-security']);
  ok(/camera=\(\)/.test(H['permissions-policy'] || '') && /geolocation=\(\)/.test(H['permissions-policy'] || ''),
     'Permissions-Policy denies the sensor and capture features the app never uses');

  const csp = H['content-security-policy'] || '';
  const dir = {};
  csp.split(';').map(d => d.trim()).filter(Boolean).forEach(d => {
    const p = d.split(/\s+/); dir[p[0]] = p.slice(1);
  });
  const has = (d, v) => (dir[d] || []).indexOf(v) >= 0;

  // locked down
  ok(has('default-src', "'self'"), "CSP default-src is 'self'");
  ok(has('object-src', "'none'"), "CSP object-src is 'none'");
  ok(has('base-uri', "'self'"), "CSP base-uri is 'self'");
  ok(has('form-action', "'none'"), "CSP form-action is 'none'");
  ok(!!dir['frame-ancestors'], 'CSP constrains frame-ancestors', String(dir['frame-ancestors']));
  ok(!!dir['connect-src'] && !has('connect-src', '*'), 'CSP constrains connect-src', String(dir['connect-src']));

  // nothing may open the policy back up
  for (const d of Object.keys(dir)) {
    ok(dir[d].indexOf('*') < 0, 'CSP ' + d + ' has no wildcard source');
    ok(dir[d].indexOf('http:') < 0 && dir[d].indexOf('https:') < 0,
       'CSP ' + d + ' allows no scheme-wide origin');
  }
  ok(!has('script-src', 'data:'), "CSP script-src does not allow data: (a script-injection sink)");

  // Each risky allowance must still be *needed*. The runtime is gzipped inside
  // the manifest, so it is decompressed and read rather than taken on trust:
  // if a future runtime stops using the Function constructor, 'unsafe-eval'
  // has to come out of the policy and this check is what says so.
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const man = JSON.parse(/<script type="__bundler\/manifest">\s*([\s\S]*?)\s*<\/script>/.exec(idx)[1]);
  const zlib = require('zlib');
  let runtime = '', fonts = 0;
  for (const e of Object.values(man)) {
    if (/^font\//.test(e.mime)) { fonts++; continue; }
    if (!/javascript/.test(e.mime)) continue;
    const raw = Buffer.from(e.data, 'base64');
    const txt = (e.compressed ? zlib.gunzipSync(raw) : raw).toString('utf8');
    if (/new Function\(/.test(txt)) runtime += txt;
  }
  ok(runtime.length > 0 && /new Function\(/.test(runtime),
     "the shipped runtime really does use the Function constructor, so 'unsafe-eval' is required");
  ok(has('script-src', "'unsafe-eval'"), "CSP script-src allows 'unsafe-eval' (the runtime needs it)");
  ok(has('script-src', "'unsafe-inline'"),
     "CSP script-src allows 'unsafe-inline' (the loader re-creates inline scripts)");
  ok(has('script-src', 'blob:'), 'CSP script-src allows blob: (bundled assets are minted as blobs)');
  ok(fonts > 0 && has('font-src', 'data:'),
     'CSP font-src allows data: (the ' + fonts + ' bundled fonts are inlined as data URIs)');
  ok(has('img-src', 'data:'), 'CSP img-src allows data: (the favicon is an inline SVG)');
  ok(has('style-src', "'unsafe-inline'"),
     "CSP style-src allows 'unsafe-inline' (the design system and markup use inline styles)");
  // and nothing beyond what was shown to be needed
  ok(!has('connect-src', 'blob:') && !has('img-src', 'blob:'),
     'no blob: allowance is kept where the app was shown not to need one');
}

/* ── 11. text contrast (WCAG 1.4.3) ────────────────────────────────────── */
function suiteContrast() {
  // The palette the page actually ships: the light tokens live in the inlined
  // design-system <style> of index.html, the dark overrides in the .dx-dark
  // rule of the source. Both are read back rather than restated here.
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const tplRaw = /<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/.exec(idx)[1];
  const tpl = JSON.parse(tplRaw.replace(/<\\u002F/g, '</'));
  const dsCss = /<style>\/\* Industry[\s\S]*?<\/style>/.exec(tpl)[0];
  const darkRule = /\.dx-dark \{([\s\S]*?)\}/.exec(source)[1];

  // The component stylesheet is loaded after the inlined design system and
  // re-pitches the palette, so a token has to be read from the override first
  // and only then from the design system it replaces — otherwise this suite
  // would happily validate colours the page no longer uses.
  const rootBlock = /:root \{([\s\S]*?)\n  \}/.exec(source);
  const overrideLight = rootBlock ? rootBlock[1] : '';
  const tok = (css, name, override) => {
    const re = () => new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})');
    const o = override !== undefined ? override : '';
    const m0 = re().exec(o);
    if (m0) return m0[1];
    const m = re().exec(css);
    return m ? m[1] : null;
  };
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = c => {
    const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const L = lum(rgb(a)), M = lum(rgb(b));
    return (Math.max(L, M) + 0.05) / (Math.min(L, M) + 0.05);
  };

  // --dx-ink-accent is defined as an alias in each theme; resolve it.
  const inkLight = /:root \{ --dx-ink-accent: var\(--(color-[a-z0-9-]+)\); \}/.exec(source);
  const inkDark = /\.dx-dark \{ --dx-ink-accent: var\(--(color-[a-z0-9-]+)\); \}/.exec(source);
  ok(!!inkLight && !!inkDark, 'the text-safe accent is defined for both themes');
  if (!inkLight || !inkDark) return;

  // the raised panel is where most text actually sits, so it is checked too
  const themes = [
    ['light', tok(dsCss, inkLight[1], overrideLight), tok(dsCss, 'color-bg', overrideLight),
     tok(dsCss, 'color-surface', overrideLight), tok(dsCss, 'dx-raised', overrideLight),
     tok(dsCss, 'dx-ctrl', overrideLight)],
    ['dark', tok(darkRule, inkDark[1]), tok(darkRule, 'color-bg'),
     tok(darkRule, 'color-surface'), tok(darkRule, 'dx-raised'), tok(darkRule, 'dx-ctrl')],
  ];
  for (const [name, ink, bg, surf, raised, ctrl] of themes) {
    ok(!!ink && !!bg && !!surf && !!raised && !!ctrl, name + ': palette resolved',
       ink + ' / ' + bg + ' / ' + surf + ' / ' + raised + ' / ' + ctrl);
    if (!ink || !bg || !surf || !raised || !ctrl) continue;
    for (const [what, ground] of [['page background', bg], ['inset surface', surf],
                                  ['raised panel', raised], ['control surface', ctrl]]) {
      const r = ratio(ink, ground);
      ok(r >= 4.5, name + ': accent text on the ' + what + ' meets 4.5:1',
         ink + ' on ' + ground + ' = ' + r.toFixed(2) + ':1');
    }
    // the accent also sits behind button labels painted in --color-bg
    ok(ratio(bg, ink) >= 4.5, name + ': button labels on the accent meet 4.5:1',
       ratio(bg, ink).toFixed(2) + ':1');
  }
  // the raw accent stays available for non-text use, where 3:1 (1.4.11) applies
  const rawLight = tok(dsCss, 'color-accent', overrideLight);
  const bgLight = tok(dsCss, 'color-bg', overrideLight);
  ok(ratio(rawLight, bgLight) >= 3,
     'the raw accent meets the 3:1 non-text bound',
     ratio(rawLight, bgLight).toFixed(2) + ':1');
  // the semantic and status hues are text in the interface, so they are held
  // to the text bound on every ground they are painted on
  for (const [theme, block, grounds] of [
    ['light', overrideLight, ['color-bg', 'color-surface', 'dx-raised', 'dx-ctrl']],
    ['dark', darkRule, ['color-bg', 'color-surface', 'dx-raised', 'dx-ctrl']]]) {
    for (const role of ['dx-ok', 'dx-warn', 'dx-err', 'dx-info', 'dx-liquid', 'dx-vapour',
                        'dx-violet', 'dx-magenta', 'dx-heat']) {
      const c = tok(block, role, block);
      if (!c) { ok(false, theme + ': ' + role + ' is defined'); continue; }
      let worst = 99, on = '';
      for (const g of grounds) {
        const gv = tok(dsCss, g, block); if (!gv) continue;
        const r = ratio(c, gv); if (r < worst) { worst = r; on = gv; }
      }
      ok(worst >= 4.5, theme + ': ' + role + ' meets 4.5:1 on every ground it is used on',
         c + ' worst ' + worst.toFixed(2) + ':1 on ' + on);
    }
  }
  // no text may go back to the raw accent, but controls legitimately keep it
  const textUses = (source.match(/(?:^|[^-a-z])color:var\(--color-accent\)/g) || []).length;
  ok(textUses === 0, 'no text is painted with the raw accent', String(textUses));
  ok((source.match(/accent-color:var\(--color-accent\)/g) || []).length > 0,
     'slider accent-color still uses the raw accent (a control colour, not text)');
}

/* ── 10. the bundle is reproducible from source ─────────────────────────── */
function suiteBuild() {
  const build = path.join(__dirname, 'build.py');
  if (!fs.existsSync(build)) { ok(false, 'tools/build.py exists'); return; }
  try {
    execFileSync('python3', [build, '--check'], { stdio: 'pipe' });
    ok(true, 'index.html is reproducible from src/DISTILLEX.dc.html');
  } catch (e) {
    ok(false, 'index.html is reproducible from src/DISTILLEX.dc.html',
       String(e.stderr || e.stdout || e.message).trim().slice(0, 120));
  }
}

const SUITES = {
  identity: suiteIdentity, analytic: suiteAnalytic, 'pure-component': suitePureComponent,
  thermo: suiteThermo, invariants: suiteInvariants, matrix: suiteMatrix,
  validation: suiteValidation, 'save-load': suiteSaveLoad,
  disclosures: suiteDisclosures, contrast: suiteContrast,
  headers: suiteHeaders, build: suiteBuild,
};

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { console.log(Object.keys(SUITES).join('\n')); return 0; }
  const names = args.filter(a => !a.startsWith('-'));
  const run = names.length ? names : Object.keys(SUITES);
  console.log('DISTILLEX regression suite — ' + path.relative(process.cwd(), SRC) + '\n');
  for (const name of run) {
    if (!SUITES[name]) { console.error('unknown suite: ' + name); return 2; }
    current = name;
    const before = fail, t = Date.now();
    SUITES[name]();
    console.log('  ' + (fail === before ? 'PASS' : 'FAIL') + '  ' + name.padEnd(16) +
                (Date.now() - t) + ' ms');
  }
  console.log('\n' + pass + ' checks passed, ' + fail + ' failed');
  return fail ? 1 : 0;
}

process.exit(main());
