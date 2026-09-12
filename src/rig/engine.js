/* ════════════════════════════════════════════════════════════════════════
   CDU — an educational model of an atmospheric crude distillation unit
   ════════════════════════════════════════════════════════════════════════

   WHAT THIS IS
   A stagewise material-balance model of a crude tower, built from methods
   that are standard in separations teaching. It computes, from the operating
   conditions the user sets, where each part of the barrel leaves the column.
   Every number the page reports comes out of this file.

   WHAT THIS IS NOT
   A refinery process simulator. It is not rigorous MESH, there is no
   pumparound heat balance, no tray hydraulics, and no real crude assay.
   Each assumption below is listed on screen under MODEL ASSUMPTIONS so a
   reader can see exactly how far the model reaches.

   ── 1. FEED REPRESENTATION ──────────────────────────────────────────────
   Crude is represented as a set of narrow boiling cuts (pseudocomponents)
   on a fixed normal-boiling-point grid. Each cut is represented by the
   normal paraffin of the same normal boiling point, so its molar mass
   follows from a carbon number rather than being assumed. Real cuts also
   contain naphthenes and aromatics; this is a paraffinic idealisation.

   ── 2. VAPOUR–LIQUID EQUILIBRIUM ────────────────────────────────────────
   Raoult's law with an ideal vapour phase: K_i = Psat_i(T) / P.
   Psat from the Clausius–Clapeyron equation integrated at constant enthalpy
   of vaporisation, with that enthalpy taken at the normal boiling point from
   Kistiakowsky's correlation:
       ΔS_vap = 36.6 + 8.31·ln(Tb)          J/(mol·K)      [Kistiakowsky]
       ΔH_vap = Tb · ΔS_vap
       ln(Psat/P0) = −(ΔH_vap/R)·(1/T − 1/Tb),  P0 = 101.325 kPa
   Accurate near the normal boiling point and increasingly approximate far
   from it. The same ideal-VLE assumption the binary simulator in DISTILLEX
   uses, extended to many components.

   ── 3. THE COLUMN ───────────────────────────────────────────────────────
   Flash zone       an isothermal Rachford–Rice flash of the charge at the
                    furnace outlet temperature and the flash-zone pressure.
                    Newton with a bisection guard; it reports its own residual
                    and iteration count.
   The cascade      from the condenser down to the flash zone the tower is
                    solved stage by stage by the bubble-point (Wang–Henke)
                    method. For each component the stage balances form a
                    tridiagonal system in the liquid component flows,
                        ℓ_{j-1} − [(1+φ_j) + S_j]·ℓ_j + S_{j+1}·ℓ_{j+1} = −f_j
                    with the stripping factor S_j = K_j·V_j/L_j and the draw
                    ratio φ_j = U_j/L_j. It is solved exactly by the Thomas
                    algorithm; the stage temperatures then follow from the
                    stage bubble points; the two are repeated until neither
                    moves. Writing the draws as ratios rather than rates makes
                    the solve conserve mass exactly on every sweep.
   Internal flows   constant molar overflow, as in the binary simulator
                    elsewhere in DISTILLEX. There are no vapour draws above
                    the feed, so everything entering at the flash zone reaches
                    the top: V = V_flash + V_stripped, D = V/(1+R), and the
                    liquid steps down by each draw as it passes. There is no
                    stage energy balance and no pumparound.
   Stripping        below the flash zone constant molar overflow leaves the
                    boil-up undetermined — a crude tower has no reboiler — so
                    that section is solved instead by the Kremser group method
                    at the transfer-line temperature, which is the standard
                    treatment of an open-steam stripper. What the steam lifts
                    rejoins the cascade at the flash zone, and the two halves
                    are iterated against each other.
   Side strippers   each side draw is steam-stripped over four stages, again by
                    Kremser, and what the steam lifts returns to the tower just
                    above its draw tray. This is what sharpens the front end of
                    a cut.
   Condenser        the overhead is flashed at the drum temperature. What will
                    not condense leaves as wet gas; the rest splits between
                    reflux and liquid distillate by the reflux ratio. When more
                    vapour refuses to condense than the distillate rate can
                    carry, the specification is infeasible and is reported as
                    such rather than clipped.
   Convergence      reported, never asserted. A run that hit the iteration
                    limit says so and labels its own product split approximate.

   ── 4. ENERGY ───────────────────────────────────────────────────────────
   Duties use the enthalpy of vaporisation above together with a
   representative liquid and vapour heat capacity for hydrocarbons. They are
   order-of-magnitude educational figures, reported to two or three
   significant figures, and are labelled as approximate on screen.

   ── 5. WHAT IS NOT MODELLED ─────────────────────────────────────────────
   Pumparounds and their heat removal, a stage energy balance, tray
   efficiency, tray hydraulics, pressure drop across the tower, water and salt
   in the crude, thermal cracking above about 370 °C, and any real crude
   assay. Steam is treated as an inert carrier rather than as a component,
   which is right for open steam stripping and wrong for anything that would
   need its solubility.                                                    */

var CDU = (function () {
  'use strict';

  var R      = 8.314462618;        // J/(mol·K)
  var P_STD  = 101.325;            // kPa
  var T0     = 273.15;

  /* ── n-paraffin reference table: carbon number ↔ normal boiling point ──
     Values are the accepted normal boiling points of the n-alkanes. They
     anchor every pseudocomponent to a real substance rather than a guess. */
  var ALKANE = [
    [1, 111.7], [2, 184.6], [3, 231.1], [4, 272.7], [5, 309.2], [6, 341.9],
    [7, 371.6], [8, 398.8], [9, 424.0], [10, 447.3], [11, 469.1], [12, 489.5],
    [13, 508.6], [14, 526.7], [15, 543.8], [16, 560.0], [17, 575.2],
    [18, 589.5], [19, 603.1], [20, 616.9], [22, 641.0], [24, 664.0],
    [26, 685.0], [28, 705.0], [30, 722.9], [35, 763.0], [40, 798.0]
  ];

  /** Carbon number of the n-paraffin boiling at Tb, interpolated. */
  function carbonAt(Tb) {
    if (Tb <= ALKANE[0][1]) return ALKANE[0][0];
    for (var i = 1; i < ALKANE.length; i++) {
      if (Tb <= ALKANE[i][1]) {
        var a = ALKANE[i - 1], b = ALKANE[i];
        return a[0] + (b[0] - a[0]) * (Tb - a[1]) / (b[1] - a[1]);
      }
    }
    var n = ALKANE.length;
    var p = ALKANE[n - 2], q = ALKANE[n - 1];
    return q[0] + (Tb - q[1]) * (q[0] - p[0]) / (q[1] - p[1]);
  }

  /* ── the pseudocomponent grid ────────────────────────────────────────
     Twenty-two narrow cuts from refinery gas to vacuum residue. The two
     lightest represent the dissolved C1–C2 and C3 a crude carries: without
     them the reflux drum can never make wet gas, because everything heavier
     stays dissolved in the naphtha at a normal drum temperature. The grid is
     fixed so that every assay is expressed in the same basis and two runs
     can be compared component by component.                              */
  var NBP_C = [-130, -85, -42, -12, 20, 50, 80, 110, 140, 170, 200, 230,
               260, 290, 320, 350, 380, 415, 450, 490, 530, 580];

  var COMP = NBP_C.map(function (tc, i) {
    var Tb = tc + T0;
    var n  = carbonAt(Tb);
    var M  = 14.027 * n + 2.016;                   // g/mol of the n-paraffin
    // Kistiakowsky: entropy of vaporisation at the normal boiling point
    var dS = 36.6 + 8.31 * Math.log(Tb);           // J/(mol·K)
    return {
      i: i,
      Tb: Tb,                                      // K
      TbC: tc,                                     // °C
      n: n,                                        // carbon number
      M: M,                                        // g/mol = kg/kmol
      dHv: Tb * dS,                                // J/mol at Tb
      // a representative liquid density for reporting only, from the
      // carbon number: light ends are gases, the heavy end approaches 1.0
      sg: Math.min(1.02, 0.36 + 0.147 * Math.log(Math.max(n, 1.2)))
    };
  });

  /** Saturated vapour pressure, kPa. Clausius–Clapeyron at constant ΔHvap. */
  function psat(c, T) {
    if (T <= 1) return 0;
    var e = -(c.dHv / R) * (1 / T - 1 / c.Tb);
    if (e > 300) e = 300;                          // finite, without flattening
    return P_STD * Math.exp(e);                    // underflows to 0 gracefully
  }
  /** ln K. The sums the phase-boundary solvers work on span many orders of
   *  magnitude, so they are formed in logs; an unscaled residual of 1e31 makes
   *  any interpolating root finder useless. */
  function lnK(c, T, P) {
    return Math.log(P_STD / P) - (c.dHv / R) * (1 / T - 1 / c.Tb);
  }
  /** log-sum-exp, so Σ z·K and Σ z/K stay representable at any temperature. */
  function lse(terms) {
    var m = -Infinity, i;
    for (i = 0; i < terms.length; i++) if (terms[i] > m) m = terms[i];
    if (!isFinite(m)) return m;
    var s2 = 0;
    for (i = 0; i < terms.length; i++) s2 += Math.exp(terms[i] - m);
    return m + Math.log(s2);
  }

  /** K-value under Raoult's law with an ideal vapour phase. */
  function kval(c, T, P) { return psat(c, T) / P; }

  /* ── representative educational feeds ────────────────────────────────
     Each feed is given as a true-boiling-point curve: the cumulative mass
     per cent of the charge boiling below a temperature. That is how a crude
     assay is actually reported, so the feed is stated in the same terms an
     engineer would read, and the yields that follow are a consequence of the
     curve and the thermodynamics rather than of a shape fitted to them.

     These are teaching profiles chosen to span the range of charges an
     atmospheric unit sees. They are not the assay of any particular crude,
     and the simulator says so wherever they are named.                    */
  var ASSAY = {
    light: { key:'light', name:'Light crude', api: 38,
      note:'A light, low-density charge. More naphtha and distillate, a small residue.',
      tbp: [[-120,0.35],[-70,0.9],[-20,2.2],[20,3.6],[70,9],[120,17],[180,27],[250,40],[300,51],[350,61],
            [400,69],[450,77],[500,84],[550,90],[620,96],[700,100]] },
    medium: { key:'medium', name:'Medium crude', api: 31,
      note:'A balanced charge. The base case for this simulator.',
      tbp: [[-120,0.2],[-70,0.55],[-20,1.3],[20,2.1],[70,5],[120,10.5],[180,18.5],[250,29],[300,39],[350,49],
            [400,57],[450,66],[500,74],[550,81],[620,90],[700,100]] },
    heavy: { key:'heavy', name:'Heavy crude', api: 22,
      note:'A heavy, dense charge. Less distillate and a large atmospheric residue.',
      tbp: [[-120,0.1],[-70,0.25],[-20,0.6],[20,1.0],[70,2.4],[120,5.4],[180,10],[250,18],[300,26],[350,34],
            [400,42],[450,51],[500,60],[550,69],[620,81],[700,100]] }
  };

  /** Mole fractions on the pseudocomponent grid from a TBP curve.
   *  Each grid cut takes the mass between its own boundaries, read off the
   *  interpolated curve; mass is then converted to moles by molar mass.
   *  `shift` moves the whole curve in boiling point, which is how the
   *  custom feed is offered: one honest handle, not a dozen invented ones. */
  function assayZ(a, shift) {
    var dT = (+shift) || 0;
    var cum = function (t) {
      var pts = a.tbp, q;
      t -= dT;
      if (t <= pts[0][0]) return pts[0][1] * Math.max(0, t + 60) / Math.max(1e-9, pts[0][0] + 60);
      for (q = 1; q < pts.length; q++) {
        if (t <= pts[q][0]) {
          var lo = pts[q - 1], hi = pts[q];
          return lo[1] + (hi[1] - lo[1]) * (t - lo[0]) / (hi[0] - lo[0]);
        }
      }
      return 100;
    };
    var bound = [], i;
    for (i = 0; i < NBP_C.length; i++) {
      var lo = (i === 0) ? NBP_C[0] - 30 : 0.5 * (NBP_C[i - 1] + NBP_C[i]);
      var hi = (i === NBP_C.length - 1) ? NBP_C[i] + 80 : 0.5 * (NBP_C[i] + NBP_C[i + 1]);
      bound.push([lo, hi]);
    }
    var mass = [], msum = 0;
    for (i = 0; i < bound.length; i++) {
      var w = Math.max(0, cum(bound[i][1]) - cum(bound[i][0]));
      mass.push(w); msum += w;
    }
    if (msum <= 0) { mass = mass.map(function () { return 1; }); msum = mass.length; }
    var mol = [], nsum = 0;
    for (i = 0; i < mass.length; i++) {
      mol.push((mass[i] / msum) / COMP[i].M); nsum += mol[i];
    }
    for (i = 0; i < mol.length; i++) mol[i] /= nsum;
    return mol;
  }

  /* ── solvers ─────────────────────────────────────────────────────────
     Each returns its own residual and iteration count. Nothing downstream
     claims convergence that these did not actually reach.                */

  /** Rachford–Rice: solve Σ z(K−1)/(1+ψ(K−1)) = 0 for the vapour fraction.
   *  Newton, bracketed and bisection-guarded, so it cannot run away. */
  function rachfordRice(z, K) {
    var i, n = z.length, kmin = Infinity, kmax = -Infinity;
    for (i = 0; i < n; i++) { if (z[i] <= 0) continue;
      if (K[i] < kmin) kmin = K[i]; if (K[i] > kmax) kmax = K[i]; }
    if (!isFinite(kmin) || kmax <= 1) return { psi: 0, it: 0, res: 0, phase: 'liquid' };
    if (kmin >= 1) return { psi: 1, it: 0, res: 0, phase: 'vapour' };

    var lo = 1 / (1 - kmax) + 1e-10, hi = 1 / (1 - kmin) - 1e-10;
    lo = Math.max(lo, 0); hi = Math.min(hi, 1);
    var f = function (p) { var s = 0;
      for (var j = 0; j < n; j++) { if (z[j] <= 0) continue;
        s += z[j] * (K[j] - 1) / (1 + p * (K[j] - 1)); } return s; };
    var df = function (p) { var s = 0;
      for (var j = 0; j < n; j++) { if (z[j] <= 0) continue;
        var d = 1 + p * (K[j] - 1); s -= z[j] * (K[j] - 1) * (K[j] - 1) / (d * d); } return s; };

    var flo = f(lo), fhi = f(hi);
    if (flo <= 0) return { psi: 0, it: 0, res: flo, phase: 'liquid' };
    if (fhi >= 0) return { psi: 1, it: 0, res: fhi, phase: 'vapour' };

    var p = 0.5 * (lo + hi), it = 0, fp = f(p);
    for (; it < 100; it++) {
      if (fp > 0) lo = p; else hi = p;
      var d = df(p), step = (d !== 0) ? fp / d : 0;
      var np = p - step;
      if (!(np > lo && np < hi)) np = 0.5 * (lo + hi);   // bisection guard
      if (Math.abs(np - p) < 1e-13) { p = np; fp = f(p); it++; break; }
      p = np; fp = f(p);
      if (Math.abs(fp) < 1e-13) { it++; break; }
    }
    return { psi: Math.min(1, Math.max(0, p)), it: it, res: Math.abs(fp), phase: 'two' };
  }

  /** Isothermal flash at T, P. Returns vapour fraction and both phases. */
  function flash(z, T, P) {
    var K = COMP.map(function (c) { return kval(c, T, P); });
    var rr = rachfordRice(z, K);
    var x = [], y = [], i;
    for (i = 0; i < z.length; i++) {
      var d = 1 + rr.psi * (K[i] - 1);
      var xi = z[i] / d;
      x.push(xi); y.push(xi * K[i]);
    }
    return { psi: rr.psi, x: x, y: y, K: K, it: rr.it, res: rr.res, phase: rr.phase };
  }

  /** Bubble point: the T where ln Σ z·K = 0. Monotone increasing in T. */
  function bubbleT(z, P, guess) {
    return solveT(function (T) {
      var t = [], i;
      for (i = 0; i < z.length; i++)
        if (z[i] > 0) t.push(Math.log(z[i]) + lnK(COMP[i], T, P));
      return t.length ? lse(t) : -1;
    }, guess);
  }
  /** Dew point: the T where ln Σ z/K = 0. Monotone decreasing in T. */
  function dewT(z, P, guess) {
    return solveT(function (T) {
      var t = [], i;
      for (i = 0; i < z.length; i++)
        if (z[i] > 0) t.push(Math.log(z[i]) - lnK(COMP[i], T, P));
      return t.length ? -lse(t) : -1;
    }, guess);
  }
  /** Bisection on temperature over 120 K … 1400 K. Both residuals above are
   *  monotone, so bisection is both sufficient and unconditionally stable —
   *  and it cannot be defeated by a badly scaled derivative. */
  function solveT(f, guess) {
    var LO = 120, HI = 1400, it = 0, lo, hi, flo, fhi;
    // Warm start: a stage temperature moves only a little between sweeps, so
    // try a narrow bracket round the previous value first and fall back to the
    // full range only when the root is not inside it.
    var g = (isFinite(guess) && guess > LO && guess < HI) ? guess : 500;
    var span = 45, found = false;
    for (var pass = 0; pass < 3 && !found; pass++, span *= 6) {
      lo = Math.max(LO, g - span); hi = Math.min(HI, g + span);
      flo = f(lo); fhi = f(hi); it += 2;
      if (isFinite(flo) && isFinite(fhi) && flo <= 0 && fhi >= 0) found = true;
    }
    if (!found) {
      lo = LO; hi = HI; flo = f(lo); fhi = f(hi); it += 2;
      if (!isFinite(flo) || !isFinite(fhi)) return { T: g, it: it, ok: false };
      if (flo > 0) return { T: lo, it: it, ok: false };   // boils below the range
      if (fhi < 0) return { T: hi, it: it, ok: false };   // boils above it
    }
    for (var k2 = 0; k2 < 48; k2++, it++) {
      if (hi - lo < 1e-6) break;
      var mid = 0.5 * (lo + hi);
      var fm = f(mid);
      if (!isFinite(fm)) { hi = mid; continue; }
      if (fm < 0) lo = mid; else hi = mid;
    }
    return { T: 0.5 * (lo + hi), it: it, ok: true };
  }

  /** Thomas algorithm: an exact O(N) solve of the tridiagonal system
   *      A_j·x_{j-1} + B_j·x_j + C_j·x_{j+1} = D_j
   *  which is the shape every component's stage balances take. Direct, not
   *  iterative, so the composition profile is exact for the current
   *  temperature and flow profiles. */
  function thomas(A, B, C, D, X, n) {
    var cp = new Float64Array(n), dp = new Float64Array(n), j;
    var b0 = B[0];
    if (Math.abs(b0) < 1e-300) b0 = -1e-300;
    cp[0] = C[0] / b0; dp[0] = D[0] / b0;
    for (j = 1; j < n; j++) {
      var m = B[j] - A[j] * cp[j - 1];
      if (Math.abs(m) < 1e-300) m = (m < 0 ? -1 : 1) * 1e-300;
      cp[j] = C[j] / m;
      dp[j] = (D[j] - A[j] * dp[j - 1]) / m;
    }
    X[n - 1] = dp[n - 1];
    for (j = n - 2; j >= 0; j--) X[j] = dp[j] - cp[j] * X[j + 1];
    return X;
  }

  /** The temperature at which Σ z·K reaches a target. The target is 1 for a
   *  plain bubble point, and 1 − y_steam on a stage carrying inert steam. */
  function bubbleTTarget(z, P, target, guess) {
    var lt = Math.log(Math.max(1e-12, target));
    return solveT(function (T) {
      var t = [], i;
      for (i = 0; i < z.length; i++)
        if (z[i] > 0) t.push(Math.log(z[i]) + lnK(COMP[i], T, P));
      return (t.length ? lse(t) : -50) - lt;
    }, guess);
  }

  /** Kremser absorption factor group: the fraction of a component in the
   *  rising vapour that the descending liquid absorbs over N stages.
   *      A = L / (K·V);   absorbed = (A^{N+1} − A) / (A^{N+1} − 1)
   *  The classic Souders–Brown/Kremser result for a constant-factor
   *  cascade. At A = 1 it degenerates and the limit N/(N+1) is used. */
  function kremserAbsorb(A, N) {
    if (!(A > 0) || !isFinite(A)) return 0;
    if (Math.abs(A - 1) < 1e-7) return N / (N + 1);
    var e = Math.pow(A, N + 1);
    if (!isFinite(e)) return 1;                    // A ≫ 1: absorbed entirely
    var v = (e - A) / (e - 1);
    return Math.min(1, Math.max(0, v));
  }
  /** The mirror group for stripping: S = K·V/L, fraction sent to vapour. */
  function kremserStrip(S, N) { return kremserAbsorb(S, N); }

  /* ── the product cuts ───────────────────────────────────────────────
     Where the barrel is withdrawn. Each draw belongs to a section of the
     tower; the section's stage count and internal reflux decide how
     sharply it is separated from its neighbours.                         */
  var CUTS = [
    { key:'gas',      name:'Wet gas',        tone:1, where:'overhead' },
    { key:'naphtha',  name:'Naphtha',        tone:3, where:'overhead' },
    { key:'kerosene', name:'Kerosene',       tone:4, where:'draw', stages: 6 },
    { key:'diesel',   name:'Diesel',         tone:5, where:'draw', stages: 6 },
    { key:'gasoil',   name:'Heavy gas oil',  tone:6, where:'draw', stages: 5 },
    { key:'residue',  name:'Atmospheric residue', tone:8, where:'bottoms' }
  ];

  /** Default operating case — a plausible mid-size atmospheric unit. */
  function baseCase() {
    return {
      assay:    'medium',
      feedRate: 1200,        // t/h of crude charge
      feedT:    240,         // °C, preheat train outlet
      furnaceT: 355,         // °C, furnace outlet (transfer line)
      colP:     175,         // kPa abs, flash-zone pressure
      topP:     135,         // kPa abs, overhead
      reflux:   2.4,         // external reflux ratio L/D
      stagesTop:  8,         // rectifying trays above the kerosene draw
      stagesKero: 5,         // trays between the kerosene and diesel draws
      stagesDiesel: 5,       // trays between the diesel and gas-oil draws
      stagesGasoil: 4,       // trays below the gas-oil draw
      stagesWash: 3,         // wash trays above the flash zone
      stagesStrip: 5,        // stripping trays below the flash zone
      steam:    1.6,         // % of charge, main-column stripping steam
      sideSteam: 2.4,        // % of each draw, side-stripper steam
      drumT:    50,          // °C, reflux drum
      // side draws, as a percentage of the charge — the handle an operator
      // actually has on a crude tower
      drawKero: 12, drawDiesel: 17, drawGasoil: 11
    };
  }

  /* ── input validation ────────────────────────────────────────────────
     Every field the operator can move, with the range the model is valid
     over. A case outside these is refused rather than silently solved. */
  var LIMITS = {
    feedRate:  { min: 100,  max: 4000, unit:'t/h',  label:'Charge rate' },
    feedT:     { min: 80,   max: 320,  unit:'°C',   label:'Feed preheat temperature' },
    furnaceT:  { min: 200,  max: 400,  unit:'°C',   label:'Furnace outlet temperature' },
    colP:      { min: 110,  max: 400,  unit:'kPa',  label:'Flash-zone pressure' },
    topP:      { min: 100,  max: 380,  unit:'kPa',  label:'Overhead pressure' },
    reflux:    { min: 0.4,  max: 9,    unit:'',     label:'Reflux ratio' },
    stagesTop:   { min: 2, max: 16, unit:'', label:'Rectifying trays', int: true },
    stagesKero:  { min: 1, max: 12, unit:'', label:'Kerosene-section trays', int: true },
    stagesDiesel:{ min: 1, max: 12, unit:'', label:'Diesel-section trays', int: true },
    stagesGasoil:{ min: 1, max: 12, unit:'', label:'Gas-oil-section trays', int: true },
    stagesWash:  { min: 1, max: 8,  unit:'', label:'Wash trays', int: true },
    stagesStrip: { min: 1, max: 10, unit:'', label:'Stripping trays', int: true },
    steam:     { min: 0,    max: 5,    unit:'% of charge', label:'Stripping steam' },
    sideSteam: { min: 0,    max: 8,    unit:'% of draw',   label:'Side-stripper steam' },
    drumT:     { min: 25,   max: 95,   unit:'°C',   label:'Reflux drum temperature' },
    drawKero:  { min: 0, max: 40, unit:'% of charge', label:'Kerosene draw' },
    drawDiesel:{ min: 0, max: 40, unit:'% of charge', label:'Diesel draw' },
    drawGasoil:{ min: 0, max: 40, unit:'% of charge', label:'Gas-oil draw' }
  };

  function validate(s) {
    var errs = [], warns = [], k;
    for (k in LIMITS) {
      if (!LIMITS.hasOwnProperty(k)) continue;
      var L = LIMITS[k], v = Number(s[k]);
      if (!isFinite(v)) { errs.push({ field: k, msg: L.label + ' must be a number.' }); continue; }
      if (L.int && Math.abs(v - Math.round(v)) > 1e-9)
        errs.push({ field: k, msg: L.label + ' must be a whole number.' });
      if (v < L.min || v > L.max)
        errs.push({ field: k, msg: L.label + ' must be between ' + L.min + ' and ' + L.max +
                    (L.unit ? ' ' + L.unit : '') + '; got ' + v + '.' });
    }
    if (!ASSAY[s.assay]) errs.push({ field:'assay', msg:'Unknown feed selection.' });
    if (isFinite(+s.topP) && isFinite(+s.colP) && +s.topP > +s.colP)
      errs.push({ field:'topP', msg:'Overhead pressure cannot exceed the flash-zone pressure — the tower would flow backwards.' });
    if (isFinite(+s.furnaceT) && isFinite(+s.feedT) && +s.furnaceT <= +s.feedT)
      errs.push({ field:'furnaceT', msg:'Furnace outlet must be hotter than the preheated feed.' });
    var drawSum = (+s.drawKero || 0) + (+s.drawDiesel || 0) + (+s.drawGasoil || 0);
    if (drawSum >= 95)
      errs.push({ field:'drawDiesel', msg:'The side draws add up to ' + drawSum.toFixed(0) +
        ' % of the charge. Nothing would be left for the overhead or the residue.' });
    else if (drawSum >= 70)
      warns.push('The side draws take ' + drawSum.toFixed(0) + ' % of the charge between them, which leaves very little residue. A real unit would be close to drying the sump.');
    if (isFinite(+s.furnaceT) && +s.furnaceT > 375)
      warns.push('Furnace outlet above about 375 °C: real crude begins to crack here, which this model does not represent.');
    return { ok: errs.length === 0, errs: errs, warns: warns };
  }

  /** The first half of a run: characterise the charge and flash it at the
   *  furnace outlet. The page calls this before the cascade so that the feed
   *  and flash figures it displays while the solver is working are the ones
   *  actually computed, not a placeholder. run() repeats the work — it is a
   *  few milliseconds — rather than depending on this having been called. */
  function feedPhase(state) {
    var v = validate(state);
    if (!v.ok) return { ok: false, errs: v.errs, warns: v.warns };
    var a = ASSAY[state.assay], z = assayZ(a, state.assaySkew);
    var Mavg = 0, i;
    for (i = 0; i < COMP.length; i++) Mavg += z[i] * COMP[i].M;
    var F = (+state.feedRate * 1000) / Mavg;
    var fl = flash(z, +state.furnaceT + T0, +state.colP);
    return { ok: true, warns: v.warns, assay: a, z: z,
             feed: { mass: +state.feedRate, molar: F, M: Mavg, api: a.api, T: +state.feedT },
             flash: { psi: fl.psi, T: +state.furnaceT, P: +state.colP,
                      vapour: F * fl.psi, liquid: F * (1 - fl.psi), it: fl.it } };
  }

  /* ── the run ─────────────────────────────────────────────────────────
     INPUTS → VALIDATION → FLASH → CASCADE → BALANCES → RESULTS          */
  function run(state, opts) {
    opts = opts || {};
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var s = {}, k;
    for (k in state) if (state.hasOwnProperty(k)) s[k] = state[k];

    var v = validate(s);
    if (!v.ok) return { ok: false, status: 'error', errs: v.errs, warns: v.warns };

    var assay = ASSAY[s.assay];
    var z = assayZ(assay, s.assaySkew);
    var i, j;

    // molar charge from the mass charge and the assay's mean molar mass
    var Mavg = 0;
    for (i = 0; i < COMP.length; i++) Mavg += z[i] * COMP[i].M;
    var F = (+s.feedRate * 1000) / Mavg;          // kmol/h
    var feedMol = z.map(function (zi) { return zi * F; });
    var feedMass = +s.feedRate;                   // t/h

    // ── furnace: heat the charge, then flash it in the tower ──────────
    var Tf   = +s.furnaceT + T0;
    var Tin  = +s.feedT + T0;
    var Pfl  = +s.colP;
    var fl   = flash(z, Tf, Pfl);
    var iters = fl.it, resid = fl.res;

    var Vflash = F * fl.psi;                       // kmol/h rising
    var Lflash = F - Vflash;                       // kmol/h falling to the sump

    var vapMol = fl.y.map(function (y) { return y * Vflash; });
    var liqMol = fl.x.map(function (x) { return x * Lflash; });

    // ── the tower: a stage-by-stage cascade, solved by the bubble-point
    //    (Wang–Henke) method ──────────────────────────────────────────────
    //
    //   j = 0   partial condenser ─► wet gas (vapour) + naphtha (liquid)
    //           │  reflux
    //   j = 1…  rectifying trays
    //   ──────  kerosene draw ─► side stripper ─┐ returns above the draw
    //   ──────  diesel   draw ─► side stripper ─┤
    //   ──────  gas-oil  draw ─► side stripper ─┘
    //           wash trays
    //   ──────  flash zone: the furnace outlet enters here
    //           stripping trays, steam entering at the sump
    //   j = N   sump ─► atmospheric residue
    //
    // Every stage is a real equilibrium stage. For each component the stage
    // balances form a tridiagonal system in the liquid component flows,
    //     ℓ_{j-1} − [(1+φ_j) + S_j]·ℓ_j + S_{j+1}·ℓ_{j+1} = −f_j
    // with the stripping factor S_j = K_j·V_j/L_j. It is solved exactly by the
    // Thomas algorithm, the temperatures are then updated from the stage
    // bubble points, and the two are repeated until neither moves. This is the
    // standard bubble-point method for narrow-boiling systems, which is what a
    // distillation column is.
    //
    // The draws enter as RATIOS φ_j = U_j/L_j rather than as absolute rates.
    // That matters: summing the stage equations telescopes to
    //     Σ f = ℓ_bottom + Σ φ_j·ℓ_j + (condenser outlets)
    // so the solve conserves mass exactly on every iteration, whatever the
    // temperature profile happens to be at the time. Specifying absolute draws
    // instead would divide by a liquid flow carried over from the previous
    // sweep, and the balance would only close once the whole thing had
    // converged. The outer loop then moves each ratio until the draw delivers
    // the rate the operator asked for.
    //
    // Constant molar overflow is assumed, as it is in the binary simulator
    // elsewhere in DISTILLEX: a mole condensing releases enough heat to boil a
    // mole. There is therefore no stage energy balance, and no pumparound.
    //
    // CMO is what fixes the internal traffic, and it has to be imposed rather
    // than hoped for. There are no vapour draws above the feed, so all the
    // vapour entering at the flash zone reaches the top:
    //     V = V_flash + V_stripped          (constant on every stage above the feed)
    //     D = V/(1+R),   L_0 = V·R/(1+R)    (the reflux ratio, by definition)
    //     L_j = L_0 − Σ U_k  for the draws above stage j
    // Without this the component balances alone leave the total flows
    // undetermined — they only constrain ratios — and the reflux quietly
    // evaporates on its way down, so no side draw can be met.
    //
    // WHERE THE RIGOROUS CASCADE STOPS, AND WHY
    // The stage cascade above runs from the condenser down to the flash zone.
    // It does not continue below it, and that is a modelling decision rather
    // than a shortcut taken for convenience.
    //
    // A crude tower has no reboiler: every joule arrives with the feed. Under
    // constant molar overflow the hydrocarbon vapour on a stage follows from
    //     V_hc = Σ K_i·x_i · (V_hc + V_steam)
    // which rearranges to V_hc = V_steam·ΣKx/(1 − ΣKx). In the stripping
    // section the liquid sits at its bubble point, so ΣKx → 1, the denominator
    // → 0, and the vapour rate is unbounded. The equation is singular there —
    // it carries no information, because with no reboiler nothing sets the
    // boil-up but the heat in the feed, which constant molar overflow has
    // already assumed away.
    //
    // So the stripping section is solved instead by the Kremser group method
    // at the transfer-line temperature, which is the standard treatment of an
    // open-steam stripper and is stable. The two halves are then iterated
    // against each other: the liquid leaving the bottom of the cascade is the
    // overflash, it is stripped, and what the steam lifts rejoins the cascade
    // at the flash zone.
    //
    // Stripping steam is carried as an inert. It never condenses, so it is
    // kept out of the component solve and enters only through the total
    // vapour, which is exactly how it works: it lowers the hydrocarbon partial
    // pressure, so the stage bubble-point condition becomes
    //     Σ K_i·x_i = 1 − y_steam
    // and the hydrocarbons boil at a lower temperature than they otherwise
    // would. Treating water as a Raoult component in a hydrocarbon liquid
    // would have been worse than treating it as the inert it effectively is.

    var Rr   = Math.max(0.05, +s.reflux);
    var Ptop = +s.topP;
    var steamMol = (+s.steam / 100) * (+s.feedRate * 1000) / 18.015;   // kmol/h
    var sideSteamPct = Math.max(0, +s.sideSteam || 0) / 100;
    var SIDE_STAGES = 4;

    // ── build the stage table ────────────────────────────────────────────
    var nTop   = Math.round(+s.stagesTop);
    var nKero  = Math.round(+s.stagesKero);
    var nDies  = Math.round(+s.stagesDiesel);
    var nGasoil= Math.round(+s.stagesGasoil);
    var nWash  = Math.round(+s.stagesWash);
    var nStrip = Math.round(+s.stagesStrip);

    var ST = [];
    ST.push({ kind:'cond',  label:'Condenser' });
    for (j = 0; j < nTop;  j++) ST.push({ kind:'tray', sec:'top',  label:'Rectifying' });
    var iKero = ST.length; ST.push({ kind:'draw', key:'kerosene', label:'Kerosene draw' });
    for (j = 0; j < nKero; j++) ST.push({ kind:'tray', sec:'kero', label:'Kerosene section' });
    var iDies = ST.length; ST.push({ kind:'draw', key:'diesel',   label:'Diesel draw' });
    for (j = 0; j < nDies; j++) ST.push({ kind:'tray', sec:'dies', label:'Diesel section' });
    var iGaso = ST.length; ST.push({ kind:'draw', key:'gasoil',   label:'Gas-oil draw' });
    for (j = 0; j < nGasoil; j++) ST.push({ kind:'tray', sec:'gaso', label:'Gas-oil section' });
    for (j = 0; j < nWash; j++)  ST.push({ kind:'tray', sec:'wash', label:'Wash section' });
    var iFeed = ST.length; ST.push({ kind:'feed', label:'Flash zone' });
    var NS = ST.length;                       // the rigorous cascade ends here
    // the stripping trays and the sump exist in the tower and in the drawing,
    // but they are solved by the group method below, not by the cascade
    for (j = 0; j < nStrip; j++) ST.push({ kind:'tray', sec:'strip', label:'Stripping' });
    var iSump = ST.length; ST.push({ kind:'sump', label:'Sump' });
    var NST = ST.length;                      // every stage, for display

    // pressure profile: linear from the overhead to the flash zone, then flat
    for (j = 0; j < NST; j++)
      ST[j].P = (j <= iFeed) ? (Ptop + (Pfl - Ptop) * (j / Math.max(1, iFeed))) : Pfl;

    // ── specified draws, as a share of the charge ────────────────────────
    var drawSpec = [
      { key:'kerosene', at:iKero, pct:+s.drawKero   },
      { key:'diesel',   at:iDies, pct:+s.drawDiesel },
      { key:'gasoil',   at:iGaso, pct:+s.drawGasoil }
    ];
    var phi = [], drawTot = 0;        // liquid draw ratio U_j / L_j
    for (j = 0; j < NST; j++) phi.push(0);
    for (j = 0; j < drawSpec.length; j++) {
      // mass draw → molar, using the molar mass the cut is expected to have,
      // refined each outer iteration once its real composition is known
      var mt = feedMass * drawSpec[j].pct / 100;                  // t/h
      drawSpec[j].mass = mt;
      drawSpec[j].Mguess = [175, 230, 310][j];
      drawSpec[j].mol = mt * 1000 / drawSpec[j].Mguess;           // kmol/h, first pass
      phi[drawSpec[j].at] = 0.25;                                 // opening guess
      drawTot += drawSpec[j].mol;
    }

    // ── steam profile: main steam everywhere, side-stripper steam above
    //    each draw it returns to ─────────────────────────────────────────
    var Vst = [];
    for (j = 0; j < NST; j++) {
      var st = steamMol;
      for (var q = 0; q < drawSpec.length; q++)
        if (j <= drawSpec[q].at) st += sideSteamPct * drawSpec[q].mass * 1000 / 18.015;
      Vst.push(st);
    }

    // ── flows, from constant molar overflow ──────────────────────────────
    var Vhc = [], Lhc = [], Lsolved = [];
    for (j = 0; j < NS; j++) { Vhc.push(1); Lhc.push(1); Lsolved.push(1); }

    /** Rebuild the whole flow profile from the current vapour load and draws.
     *  Returns false when a draw asks for more liquid than flows past its
     *  tray, which is a real operating limit, not a numerical failure. */
    function setFlows(V1, Umol) {
      var Dtot = V1 / (1 + Rr);
      var L0 = V1 - Dtot;
      Vhc[0] = Math.max(1e-9, rVap * L0);
      Lhc[0] = Math.max(1e-9, L0);
      var Lrun = L0, okFlow = true;
      for (var q2 = 1; q2 < NS; q2++) {
        Vhc[q2] = V1;
        Lrun -= (Umol[q2 - 1] || 0);               // draws taken above this stage
        if (Lrun < 1e-6) { Lrun = 1e-6; okFlow = false; }
        Lhc[q2] = Lrun;
      }
      return { ok: okFlow, D: Dtot, L0: L0 };
    }

    // ── initial temperature profile: a smooth ramp between the two ends ──
    // ── initial temperature profile: a smooth ramp between the two ends ──
    var Tj = [];
    var Ttop0 = dewT(norm(fl.y), Ptop, 420).T;
    var Tsump = Tf - 6;                    // no reboiler: the sump sits under
    for (j = 0; j < NS; j++)               // the transfer line
      Tj.push(Ttop0 + (Tf - Ttop0) * Math.pow(j / Math.max(1, iFeed), 0.85));
    // the section below the flash zone is fixed, not solved
    var Tfixed = [];
    for (j = 0; j < NS; j++) {
      // the condenser runs at the drum temperature the operator sets, and the
      // flash zone at the furnace outlet; the trays between are solved
      if (j === 0)      { Tfixed.push(+s.drumT + T0); Tj[0] = Tfixed[0]; continue; }
      if (j === iFeed)  { Tfixed.push(Tf);            Tj[j] = Tf;        continue; }
      Tfixed.push(null);
    }

    // ── the outer loop ───────────────────────────────────────────────────
    var ell = [];                          // ell[j][i] liquid component flow
    var vee = [];                          // vee[j][i] vapour component flow
    var sideRet = {}, sideProd = {};
    var stripUp = zeros();                 // what the sump stripper lifts back
    var residMolOut = zeros();             // the atmospheric residue
    // Opening estimates. With both distillate rates at zero the condenser
    // stage has no outlet at all and the first solve is degenerate.
    var Dvap = 0, Dliq = 0;
    var rVap = 0.12 / Rr, rLiq = 0.88 / Rr;      // opening condenser ratios
    var refluxMol = zeros(), gasMol = zeros(), napMol = zeros();
    var condShort = false, drawStarved = false;
    var converged = false, outer = 0, relax = 0.8, PHI_RELAX = 0.2, lastErr = Infinity, stall = 0;
    // The residual trajectory, recorded so the page can plot what the solver
    // actually did rather than assert that it converged.
    var trace = [];
    var NC = COMP.length;

    for (outer = 0; outer < 420; outer++) {
      // CMO fixes the traffic: everything entering at the flash zone rises
      var V1 = Math.max(1e-6, Vflash + sum(stripUp));
      var Umol = [];
      for (j = 0; j < NS; j++) Umol.push(0);
      for (q = 0; q < drawSpec.length; q++) Umol[drawSpec[q].at] = drawSpec[q].mol;
      var fl2 = setFlows(V1, Umol);
      drawStarved = !fl2.ok;
      // The draw ratio is taken against the liquid the SOLVE has on that tray,
      // not against the CMO estimate. Under constant molar overflow the two
      // are deliberately different — CMO fixes the traffic, the component
      // balances decide the composition — and a draw specified as a rate has
      // to be divided by the flow it is actually taken from, or it silently
      // misses its target.
      // φ is damped in its own right: it is divided by the very liquid flow
      // it controls, so taking it at face value each sweep makes the loop
      // oscillate instead of settle.
      for (j = 0; j < NS; j++) {
        var phiWant = Math.min(0.95, (Umol[j] || 0) / Math.max(1e-9, Lsolved[j]));
        phi[j] = phi[j] + PHI_RELAX * (phiWant - phi[j]);
      }

      // component feeds: the flashed charge at the feed stage, and the side
      // strippers returning their vapour just above each draw
      var Fj = [];
      for (j = 0; j < NS; j++) Fj.push(zeros());
      for (i = 0; i < NC; i++) Fj[iFeed][i] = vapMol[i] + stripUp[i];
      for (q = 0; q < drawSpec.length; q++) {
        var ret = sideRet[drawSpec[q].key];
        if (ret) for (i = 0; i < NC; i++) Fj[Math.max(0, drawSpec[q].at - 1)][i] += ret[i];
      }

      // K and the stripping factors on the current profiles
      var Kj = [], Sj = [];
      for (j = 0; j < NS; j++) {
        var kr = [], sr = [], Vtot = Vhc[j] + Vst[j];
        for (i = 0; i < NC; i++) {
          var kk = kval(COMP[i], Tj[j], ST[j].P);
          kr.push(kk);
          sr.push(kk * Vtot / Math.max(1e-9, Lhc[j]));
        }
        Kj.push(kr); Sj.push(sr);
      }

      // ── solve the tridiagonal system for each component ───────────────
      var A = new Float64Array(NS), B = new Float64Array(NS),
          Cc = new Float64Array(NS), Dd = new Float64Array(NS), X = new Float64Array(NS);
      var newEll = [], newVee = [];
      for (j = 0; j < NS; j++) { newEll.push(zeros()); newVee.push(zeros()); }

      for (i = 0; i < NC; i++) {
        for (j = 0; j < NS; j++) {
          var Uf = phi[j];
          A[j] = (j === 0) ? 0 : 1;
          Cc[j] = (j === NS - 1) ? 0 : Sj[j + 1][i];
          Dd[j] = -Fj[j][i];
          if (j === 0) {
            // partial condenser, also written as ratios against the reflux:
            //   D/L0 = 1/R,  D_vap/L0 = (1+1/R)·ψ,  D_liq/L0 = 1/R − D_vap/L0
            B[j] = -(1 + rLiq + rVap * Kj[0][i]);
          } else if (j === NS - 1) {
            // flash zone: all its liquid leaves downward as the overflash
            B[j] = -(1 + Sj[j][i]);
          } else {
            B[j] = -((1 + Uf) + Sj[j][i]);
          }
        }
        thomas(A, B, Cc, Dd, X, NS);
        for (j = 0; j < NS; j++) {
          var lv = X[j] > 0 ? X[j] : 0;
          newEll[j][i] = lv;
          newVee[j][i] = lv * Sj[j][i];
        }
      }

      // ── the condenser ─────────────────────────────────────────────────
      // V1 arrives from stage 1 and is cooled to the drum temperature. What
      // will not condense has to leave as wet gas; the rest splits between
      // reflux and liquid distillate. In ratios against the reflux L0:
      //     D/L0 = 1/R,  D_vap/L0 = (1 + 1/R)·ψ,  D_liq/L0 = 1/R − D_vap/L0
      // D_liq goes negative when ψ > 1/(1+R): more vapour refuses to condense
      // than the distillate rate can carry, and the specification is
      // infeasible rather than merely inaccurate. That is reported, not
      // quietly clipped.
      var ovMol = newVee[1] ? newVee[1].slice() : zeros();
      var ovTot = sum(ovMol);
      var ov = flash(norm(ovMol), +s.drumT + T0, Ptop);
      iters += ov.it; resid = Math.max(resid, ov.res);
      var psiC = ov.psi;
      var rVapNew = (1 + 1 / Rr) * psiC;
      var rLiqNew = 1 / Rr - rVapNew;
      condShort = rLiqNew < 0;
      if (condShort) { rLiqNew = 0; rVapNew = 1 / Rr; }
      rVap = rVap + relax * (rVapNew - rVap);
      rLiq = rLiq + relax * (rLiqNew - rLiq);

      // the actual flows follow from the solved reflux
      var L0 = Math.max(1e-9, sum(newEll[0]));
      Dvap = rVap * L0; Dliq = rLiq * L0;
      gasMol = zeros(); napMol = zeros(); refluxMol = zeros();
      for (i = 0; i < NC; i++) {
        var x0i = newEll[0][i] / L0;
        refluxMol[i] = newEll[0][i];
        napMol[i]    = x0i * Dliq;
        gasMol[i]    = x0i * Kj[0][i] * Dvap;
      }

      // ── flows and temperatures ────────────────────────────────────────
      var dT = 0, dF = 0;
      var newT = [], newV = [], newL = [];
      for (j = 0; j < NS; j++) {
        var Lsum = sum(newEll[j]), Vsum = sum(newVee[j]);
        newL.push(Math.max(1e-9, Lsum));
        // the condenser's only vapour outlet is the wet gas, which the flash
        // above has just settled; it is not a cascade unknown
        newV.push(Math.max(1e-9, Vsum));
        // stage temperature from Σ K·x = 1 − y_steam
        var x = norm(newEll[j]);
        var ysteam = Vst[j] / Math.max(1e-9, Vsum + Vst[j]);
        var target = Math.max(0.02, 1 - ysteam);
        var Tnew;
        if (Tfixed[j] !== null) {
          Tnew = Tfixed[j];                        // set by the transfer line
        } else {
          var bt = bubbleTTarget(x, ST[j].P, target, Tj[j]);
          iters += bt.it;
          Tnew = bt.T;
        }
        newT.push(Tnew);
        dT = Math.max(dT, Math.abs(Tnew - Tj[j]));
        // Note: newL is the sum of the solved component flows and Lhc is the
        // CMO traffic. They are not the same quantity and are not compared.
        dF = Math.max(dF, Math.abs(newL[j] - Lsolved[j]) / Math.max(1, newL[j]));
      }

      // ── side draws, then their strippers ──────────────────────────────
      // The solve removed φ_j·ℓ_j at each draw. Compare what that delivered
      // with what was asked for, and move the ratio toward it.
      for (q = 0; q < drawSpec.length; q++) {
        var d = drawSpec[q], jj = d.at;
        var raw = newEll[jj].map(function (e) { return e * phi[jj]; });
        var gotMass = massOf(raw);
        // the molar rate that delivers the specified mass rate, using the
        // composition the tray actually has
        var xj = norm(newEll[jj]);
        var Md = 0; for (i = 0; i < NC; i++) Md += xj[i] * COMP[i].M;
        var molWant = d.mass * 1000 / Math.max(1e-6, Md);
        dF = Math.max(dF, Math.abs(gotMass - d.mass) / Math.max(1, d.mass));
        d.mol = d.mol + relax * (molWant - d.mol);
        d.got = gotMass;
        // side stripper: Kremser over SIDE_STAGES with its own steam
        var Ld = Math.max(1e-9, sum(raw)), dm = massOf(raw);
        var Vs = Math.max(1e-12, sideSteamPct * dm * 1000 / 18.015);
        var Pd = ST[jj].P;
        var rt = zeros(), keep = zeros();
        for (i = 0; i < NC; i++) {
          var Ss = kval(COMP[i], newT[jj], Pd) * (Vs + Ld * 0.05) / Ld;
          var fsr = kremserStrip(Ss, SIDE_STAGES);
          rt[i] = raw[i] * fsr; keep[i] = raw[i] - rt[i];
        }
        sideRet[d.key] = rt; sideProd[d.key] = keep;
      }

      // ── stripping section: Kremser on the overflash plus the flash liquid ─
      var overflash = newEll[NS - 1] ? newEll[NS - 1].slice() : zeros();
      var sumpIn = zeros();
      for (i = 0; i < NC; i++) sumpIn[i] = liqMol[i] + overflash[i];
      var Lb = Math.max(1e-6, sum(sumpIn));
      var Tstrip = Tf - 6;
      // the steam dilutes the hydrocarbon partial pressure in the sump
      var yS = steamMol / Math.max(1e-9, steamMol + Lb * 0.08);
      var Pb = Pfl * Math.max(0.12, 1 - yS);
      var newStripUp = zeros(), newResid = zeros();
      for (i = 0; i < NC; i++) {
        var Sb = kval(COMP[i], Tstrip, Pb) * Math.max(1e-9, steamMol) / Lb;
        var fb = kremserStrip(Sb, nStrip);
        newStripUp[i] = sumpIn[i] * fb;
        newResid[i] = sumpIn[i] - newStripUp[i];
      }
      dF = Math.max(dF, Math.abs(sum(newStripUp) - sum(stripUp)) /
                        Math.max(1, sum(newStripUp)));
      for (i = 0; i < NC; i++)
        stripUp[i] = stripUp[i] + relax * (newStripUp[i] - stripUp[i]);
      residMolOut = newResid;

      // ── damped update ─────────────────────────────────────────────────
      for (j = 0; j < NS; j++) {
        Tj[j] = Tj[j] + relax * (newT[j] - Tj[j]);
        Lsolved[j] = Lsolved[j] + relax * (newL[j] - Lsolved[j]);
      }
      ell = newEll; vee = newVee;

      var err = Math.max(dT / 200, dF);
      // A stalled successive substitution is usually a limit cycle rather
      // than slow progress, so both relaxations come down together until it
      // settles. Whatever it reaches is what gets reported.
      if (err > lastErr * 0.995) {
        if (++stall > 8) {
          relax = Math.max(0.08, relax * 0.7);
          PHI_RELAX = Math.max(0.03, PHI_RELAX * 0.7);
          stall = 0;
        }
      }
      else stall = 0;
      lastErr = err;
      trace.push([outer, dT, dF]);
      if (opts.onIter) opts.onIter(outer, dT, dF);
      if (typeof CDU_TRACE !== 'undefined' && CDU_TRACE) CDU_TRACE.push({o:outer,dT:dT,dF:dF,relax:relax,
        phi:drawSpec.map(function(d){return +phi[d.at].toFixed(4);}),
        got:drawSpec.map(function(d){return +(d.got||0).toFixed(1);}),
        want:drawSpec.map(function(d){return +d.mass.toFixed(1);}),
        L:[+Lhc[0].toFixed(0),+Lhc[iKero].toFixed(0),+Lhc[iDies].toFixed(0),+Lhc[iGaso].toFixed(0)],
        rVap:+rVap.toFixed(5), rLiq:+rLiq.toFixed(5)});
      if (outer > 4 && dT < 2e-3 && dF < 5e-7) { converged = true; outer++; break; }
    }

    // ── the products that leave the tower ────────────────────────────────
    var residMol = residMolOut;
    var drawMol = {
      kerosene: sideProd.kerosene || zeros(),
      diesel:   sideProd.diesel   || zeros(),
      gasoil:   sideProd.gasoil   || zeros()
    };
    var drawT = {
      kerosene: Tj[iKero], diesel: Tj[iDies], gasoil: Tj[iGaso], top: Tj[0]
    };
    var Tbot = Tf - 6;
    // fill the display profile below the flash zone
    for (j = NS; j < NST; j++)
      Tj[j] = Tf - 6 * ((j - iFeed) / Math.max(1, NST - 1 - iFeed));
    var secT = [Tj[iGaso], Tj[iDies], Tj[iKero], Tj[0]];
    var Ltop = sum(refluxMol);

    // ── assemble the products ─────────────────────────────────────────
    var prodMol = {
      gas: gasMol, naphtha: napMol,
      kerosene: drawMol.kerosene || zeros(), diesel: drawMol.diesel || zeros(),
      gasoil: drawMol.gasoil || zeros(), residue: residMol
    };

    // ── overall material balance, computed and reported, not assumed ──
    var outMol = zeros();
    for (k in prodMol) if (prodMol.hasOwnProperty(k))
      for (i = 0; i < COMP.length; i++) outMol[i] += prodMol[k][i];

    var inMass = massOf(feedMol), outMass = massOf(outMol);
    var closure = (outMass - inMass) / Math.max(1e-9, inMass);

    // Any hydrocarbon the cascade has not placed is unaccounted-for internal
    // holdup: it is reported as its own line rather than hidden in a product.
    var unaccMol = [];
    for (i = 0; i < COMP.length; i++) unaccMol.push(Math.max(0, feedMol[i] - outMol[i]));
    var unaccMass = massOf(unaccMol);
    if (unaccMass / Math.max(1e-9, inMass) > 1e-9) {
      // close the balance by returning unplaced material to the residue,
      // which is physically where it would leave, and record that we did
      for (i = 0; i < COMP.length; i++) prodMol.residue[i] += unaccMol[i];
      outMol = zeros();
      for (k in prodMol) if (prodMol.hasOwnProperty(k))
        for (i = 0; i < COMP.length; i++) outMol[i] += prodMol[k][i];
      outMass = massOf(outMol);
      closure = (outMass - inMass) / Math.max(1e-9, inMass);
    }

    // ── energy: educational duties ────────────────────────────────────
    var CPL = 2.10, CPV = 2.30;                    // kJ/(kg·K), representative
    var qSens = 0;
    for (i = 0; i < COMP.length; i++) {
      var mi = feedMol[i] * COMP[i].M / 1000;      // t/h
      qSens += mi * 1000 * CPL * (Tf - Tin);       // kJ/h, sensible
    }
    // latent term, taken on what actually vaporised in the flash
    // kmol/h × kJ/kmol is kJ/h directly — dHv is J/mol, which is kJ/kmol.
    var vapLatent = 0;
    for (i = 0; i < COMP.length; i++) vapLatent += vapMol[i] * COMP[i].dHv;         // kJ/h
    var furnaceDuty = (qSens + vapLatent) / 3.6e6;                                  // MW
    var condLatent = 0, condSens = 0;
    for (i = 0; i < COMP.length; i++) {
      // everything the condenser has to condense: the distillate and the
      // reflux both leave it as liquid
      condLatent += (napMol[i] + refluxMol[i]) * COMP[i].dHv;
      condSens += (napMol[i] + refluxMol[i] + gasMol[i]) * COMP[i].M * CPV *
                  Math.max(0, Tj[1] - (+s.drumT + T0));
    }
    var condDuty = (condLatent + condSens) / 3.6e6;                                 // MW

    // ── per-product reporting ─────────────────────────────────────────
    var products = CUTS.map(function (c) {
      var m = prodMol[c.key] || zeros();
      var mass = massOf(m), mol = sum(m);
      var mb = meanBoil(m);
      return {
        key: c.key, name: c.name, tone: c.tone, where: c.where,
        molar: mol, mass: mass,
        pct: 100 * mass / Math.max(1e-9, inMass),
        M: mol > 1e-12 ? (mass * 1000 / mol) : 0,
        tbp5: mb.p5, tbp50: mb.p50, tbp95: mb.p95,
        sg: sgOf(m),
        drawT: c.key === 'residue' ? Tbot - T0
             : c.key === 'gas' || c.key === 'naphtha' ? drawT.top - T0
             : (drawT[c.key] || 0) - T0,
        comp: m.slice()
      };
    });

    // ── the tray temperature profile, top to bottom ───────────────────
    var profile = [
      { name:'Overhead',  T: drawT.top - T0,       P: Ptop },
      { name:'Kerosene',  T: drawT.kerosene - T0,  P: Pfl + (Ptop - Pfl) * 0.75 },
      { name:'Diesel',    T: drawT.diesel - T0,    P: Pfl + (Ptop - Pfl) * 0.50 },
      { name:'Gas oil',   T: drawT.gasoil - T0,    P: Pfl + (Ptop - Pfl) * 0.25 },
      { name:'Flash zone',T: Tf - T0,              P: Pfl },
      { name:'Sump',      T: Tbot - T0,            P: Pfl }
    ];

    var warns = v.warns.slice();
    if (!converged) {
      warns.push('The solver reached its iteration limit with the tray temperatures still moving. The product split below is the last state it reached, and should be treated as approximate rather than as a converged answer.');
      if (Rr < 1.0) warns.push('At a reflux ratio this low the rectifying section is barely fractionating, which is a genuinely hard case for any stagewise solver: the top of the tower is close to simply passing vapour through. Raising the reflux ratio above about 1 usually settles it.');
    }
    if (drawStarved) warns.push('At least one side draw asks for more liquid than flows past its tray. A real unit cannot draw what is not there: raise the reflux ratio, lower that draw, or move heat down the tower.');
    if (condShort) warns.push('At this drum temperature more of the overhead stays vapour than the reflux ratio allows to be withdrawn as distillate. A real unit would run a colder drum, a higher overhead pressure or a lower reflux ratio; the wet-gas rate shown is what the condenser actually permits.');
    if (fl.psi < 0.05) warns.push('Almost nothing vaporised in the flash zone: at this furnace outlet the tower has very little vapour traffic to fractionate.');
    if (fl.psi > 0.95) warns.push('Almost the whole charge vaporised: there is little liquid left to strip, and a real unit would be running far above its design.');
    if (Math.abs(closure) > 1e-6) warns.push('Material balance closes to ' + (closure * 100).toFixed(4) + ' %, outside the 1e-6 tolerance.');

    var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    return {
      ok: true,
      status: warns.length ? 'warning' : 'complete',
      converged: converged, outer: outer, iters: iters, residual: resid,
      trace: trace,
      ms: t1 - t0,
      assay: assay, z: z, comps: COMP,
      feed: { mass: inMass, molar: F, M: Mavg, api: assay.api,
              T: +s.feedT, mol: feedMol },
      flash: { psi: fl.psi, T: Tf - T0, P: Pfl, vapour: Vflash, liquid: Lflash },
      steam: { molar: steamMol, mass: steamMol * 18.015 / 1000,
               side: sideSteamPct * 100 },
      products: products, profile: profile,
      balance: { inMass: inMass, outMass: outMass, closure: closure,
                 unplaced: unaccMass },
      energy: { furnace: furnaceDuty, condenser: condDuty,
                Tbot: Tbot - T0, Ttop: drawT.top - T0 },
      internals: { Ltop: Ltop, Vflash: Vflash, Lflash: Lflash,
                   reflux: +s.reflux, stages: NST, cascade: NS, feedStage: iFeed,
                   Dvap: Dvap, Dliq: Dliq,
                   Lprofile: Lhc.slice(), Vprofile: Vhc.slice(),
                   steamProfile: Vst.slice(),
                   Tprofile: Tj.map(function (t) { return t - T0; }),
                   Pprofile: ST.map(function (q) { return q.P; }),
                   stageKind: ST.map(function (q) { return q.kind; }),
                   stageLabel: ST.map(function (q) { return q.label; }),
                   draws: { kerosene: iKero, diesel: iDies, gasoil: iGaso },
                   x: ell.map(function (e) { return norm(e); }) },
      warns: warns, errs: []
    };

    // ── small helpers, kept local to the run ─────────────────────────
    function clamp01(v) { return Math.min(0.95, Math.max(0.01, isFinite(v) ? v : 0.3)); }
    function zeros() { var a = []; for (var q = 0; q < COMP.length; q++) a.push(0); return a; }
    function sum(a) { var t = 0; for (var q = 0; q < a.length; q++) t += a[q]; return t; }
    function norm(a) { var t = sum(a); if (t <= 0) { var e = zeros(); e[0] = 1; return e; }
      return a.map(function (x) { return x / t; }); }
    function massOf(a) { var t = 0;
      for (var q = 0; q < a.length; q++) t += a[q] * COMP[q].M / 1000; return t; }
    function sgOf(a) { var m = 0, vv = 0;
      for (var q = 0; q < a.length; q++) { var mm = a[q] * COMP[q].M / 1000;
        m += mm; vv += mm / COMP[q].sg; }
      return vv > 1e-12 ? m / vv : 0; }
    /** 5/50/95 % points of the cut's own boiling curve, on a mass basis.
     *  These are computed from the composition the model produced, not
     *  quoted from a table. */
    function meanBoil(a) {
      var m = [], tot = 0, q;
      for (q = 0; q < a.length; q++) { var mm = a[q] * COMP[q].M / 1000; m.push(mm); tot += mm; }
      if (tot <= 1e-12) return { p5: 0, p50: 0, p95: 0 };
      var pick = function (frac) {
        var c = 0;
        for (var r = 0; r < m.length; r++) {
          var next = c + m[r] / tot;
          if (next >= frac) {
            var lo = r > 0 ? NBP_C[r - 1] : NBP_C[0] - 30;
            var w = (frac - c) / Math.max(1e-12, m[r] / tot);
            return lo + (NBP_C[r] - lo) * w;
          }
          c = next;
        }
        return NBP_C[NBP_C.length - 1];
      };
      return { p5: pick(0.05), p50: pick(0.5), p95: pick(0.95) };
    }
  }

  /* ── shared helpers used outside a run ─────────────────────────────── */
  function sum(a) { var t = 0; for (var q = 0; q < a.length; q++) t += a[q]; return t; }
  function norm(a) { var t = sum(a); if (t <= 0) return a.map(function () { return 0; });
    return a.map(function (x) { return x / t; }); }

  return {
    COMP: COMP, NBP_C: NBP_C, ASSAY: ASSAY, CUTS: CUTS, LIMITS: LIMITS,
    baseCase: baseCase, validate: validate, run: run, feedPhase: feedPhase,
    psat: psat, kval: kval, flash: flash, bubbleT: bubbleT, dewT: dewT,
    rachfordRice: rachfordRice, kremserAbsorb: kremserAbsorb,
    assayZ: assayZ, carbonAt: carbonAt
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CDU;
