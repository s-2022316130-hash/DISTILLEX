# DISTILLEX — Interactive Fractional Distillation Laboratory

A client-side simulator for the fractional distillation of **binary** mixtures: vapour–liquid
equilibrium, McCabe–Thiele stage construction, column operation, stage profiles, sensitivity
studies, theory and an exam mode. Everything is computed in the browser — no server, no build
step, no account, no telemetry, no stored data.

**Live entry point:** `index.html` (self-contained, ~920 KB, works offline by double-click).

Alongside the binary simulator there is an **industrial crude unit** at
`/industrial-distillation` — an interactive, educational visualisation of an atmospheric
distillation tower, reached from the landing page. It is a visualisation, not a second
engine: no temperature, pressure, rate or yield is claimed for the unit, because this
application computes none for a crude oil. The route is rewritten to `index.html` by
`vercel.json`; opened from the filesystem it falls back to `#/industrial-distillation`,
so the offline copy still links.

---

## Contents

```
.
├── index.html      ← the deployable application (all CSS, fonts, runtime inlined)
├── src/            ← editable source
│   ├── DISTILLEX.dc.html    the application source (markup + binary engine + page)
│   ├── rig/                 the industrial crude unit, as separate modules
│   │   ├── engine.js          the crude-unit simulation — the only thing that computes
│   │   ├── glmath.js          vectors, matrices and the camera spring
│   │   ├── geometry.js        parametric meshes, built in unit frames
│   │   ├── plant.js           the unit itself: geometry, streams, instruments
│   │   ├── renderer.js        the WebGL scene — instancing, id-buffer picking, tracers
│   │   ├── info.js            what each component is; camera presets; the guided tour
│   │   ├── view2d.js          the process flow sheet, drawn from the same result
│   │   ├── panel.js           the controller: run states, camera, selection, files
│   │   └── vm.js              the view model — formats, never calculates
│   ├── support.js           component runtime
│   └── _ds/…                design-system tokens and stylesheet
├── tools/
│   ├── build.py             regenerates index.html from src/ (see below)
│   ├── engine.js            loads the calculation engine out of src/ for testing
│   └── test.js              the regression suite (see Validation)
├── vercel.json
├── METHODS.md               derivations, assumptions and what is / is not validated
├── README.md
├── LICENSE
└── .gitignore
```

`index.html` is generated from `src/`. Deploying the repository root deploys `index.html`.

---

## Features

- **Industrial crude unit** — a separate page at `/industrial-distillation`: a working
  atmospheric-distillation simulator with its own solver, its own operator panel and a WebGL
  model of the plant. See *The industrial crude unit* below.
- **Simulation dashboard** — feed and operating conditions, live column schematic with per-tray
  hover data, live results, material balance and convergence residual, "What happens if?" comparator,
  and Learning / Engineering / Advanced interface levels.
- **VLE Explorer** — x–y and T–x–y diagrams with pointer read-out, component data table with
  CAS numbers, fitted temperature ranges and a vapour-pressure self-check, and a custom binary
  mixture with user-supplied Antoine constants.
- **McCabe–Thiele** — equilibrium curve, both operating lines, q-line, minimum-reflux line,
  animated or single-step stage stepping, draggable x_B / z_F / x_D handles.
- **Column** — reboiler type, full stage-by-stage table,
  clickable industrial flowsheet (tank, pump, preheater, column, condenser, reflux drum, reboiler).
- **Results** — inputs, calculated values, mass balance, assumptions, CSV / JSON / printable
  report export, save & load configuration as JSON.
- **Sensitivity** — sweep any independent variable against any dependent variable, with an
  automatically generated key observation and CSV export.
- **Theory** — twenty topics written against the same equations the engine solves.
- **Exam mode** — questions generated from the live case, with hint, worked solution and answer
  checking against the engine's own values.
- **Validation** — the engine's self-checks recomputed live in the browser: closed-form limiting
  cases, pure-component vapour pressures, equilibrium self-consistency and the invariants of the
  case on screen, each with its computed value, tolerance and error. Internal validation only —
  see below.
- Dark mode; responsive from desktop down to mobile; text contrast meets WCAG 2.1 AA (4.5:1)
  in both themes.

---

## Engineering models

| Item | Implementation |
| --- | --- |
| Vapour pressure | Antoine, log₁₀ P^sat[mmHg] = A − B/(T[°C] + C) |
| VLE | Ideal (Raoult's law) or constant relative volatility |
| Bubble / dew point | Bisection, 70 iterations over −80…500 °C |
| Equilibrium curve | 241-point table; y*(x) and x*(y) by linear interpolation (error < 1e−4) |
| Stage calculation | McCabe–Thiele stepping under constant molar overflow |
| Minimum reflux | q-line pinch plus a tangent-pinch scan; the larger requirement governs |
| Minimum stages | Fenske with geometric-mean α |
| Design mode | Fix x_D, x_B and R → solve for stages and feed stage |
| Rating mode | Fix N and D/F → shooting on x_D by bisection → solve for product purities |
| Material balance | F = D + B and F·z_F = D·x_D + B·x_B, solved for D and B — an identity, not an independent check |
| Convergence | Rating mode is rejected unless the shooting residual \|x_N − x_B\| ≤ 1e−4 mole fraction; design mode is not iterative |
| Duties | Latent heat only: Q_C = V·λ_top, Q_R = V̄·λ_bottom |

### Data provenance

Antoine constants are the Reid–Prausnitz–Poling / Lange sets in **mmHg and °C**, each stored with
the temperature range it was fitted over. The VLE Explorer prints that range and re-derives each
pure component's vapour pressure at its own normal boiling point as a self-check — benzene gives
760.0 mmHg at its normal boiling point of 80.1 °C and water 760.1 mmHg at 100.0 °C, both ≈ 760 mmHg
as they must. Latent heats are values at the normal boiling point. Stage temperatures outside a fitted range raise an
explicit extrapolation warning instead of silently degrading.

Known azeotropes are recorded per mixture — ethanol/water at 95.6 wt% ethanol (x ≈ 0.894),
boiling at 78.2 °C at 1 atm — and any specification that crosses one is flagged as physically
unreachable, whatever the ideal model computes. Methanol/water and acetone/water are non-ideal
but azeotrope-free at 1 atm and are marked as teaching approximations; benzene/toluene and
n-hexane/n-heptane are genuinely near-ideal and are the recommended demonstration systems.

### Input validation

Inputs are checked before they reach the calculation engine, and an invalid entry
withholds the result rather than producing one. Three cases are reported
separately: **invalid input** (non-numeric, or outside a quantity's physical
domain), **infeasible specification** (a request the material balance or the
equilibrium curve cannot satisfy, such as x_D ≤ x_B) and **model domain** (the
solver cannot reach a valid answer — a rating case that will not converge, or an
Antoine correlation pushed outside the range the bubble-point search covers).

Out-of-domain values are never silently clamped or replaced by defaults. Mole
fractions must lie strictly inside (0, 1); F, P and R are strictly positive;
overall tray efficiency lies in (0, 1]; the constant-α model requires α > 1;
stage counts are whole numbers in 3–60. A custom mixture must carry two
differently-named components with finite properties, positive Antoine B, positive
molar mass, and Antoine C above 80 — the last so that T + C stays positive across
the −80…500 °C interval the bubble- and dew-point solver bisects, keeping the
correlation clear of its own pole. These are teaching-level guards on a
client-side educational model, not an industrial validation suite.

### Assumptions

Steady state; binary system; constant molar overflow; uniform column pressure; negligible heat
loss; partial reboiler counted as one equilibrium stage; overall (not Murphree) tray efficiency;
latent-heat-only duties. Column hydraulics — flooding, weeping, pressure drop, sizing — are out
of scope. Activity-coefficient models (Wilson, NRTL, UNIQUAC) are **not** implemented; mixtures
that need them are flagged rather than approximated.


---

## The industrial crude unit

`/industrial-distillation` is a second simulator, not a second illustration. It has its own
engine (`src/rig/engine.js`), which the binary solver shares nothing with, and every number the
page shows — every yield, temperature, duty, line weight and tracer speed — comes out of a call
to it. Before the first run the page shows dashes; if a run is refused or fails, it goes back to
dashes and says why. Nothing on it is pre-computed and nothing is animated from a constant.

### What it solves

**Feed.** The crude is represented as 22 narrow-boiling pseudocomponents on a fixed
normal-boiling-point grid running from −130 °C to 580 °C. Each cut is represented by the
n-alkane of the same normal boiling point, which fixes its carbon number and therefore its molar
mass (M = 14.027·n + 2.016). Three assays — light, medium and heavy — are given as true-boiling-point
curves (cumulative mass % against temperature) and are converted to the grid by taking the mass
between each cut's boundaries off the interpolated curve.

**Vapour–liquid equilibrium.** The enthalpy of vaporisation of each cut comes from Kistiakowsky's
rule, ΔS_vap = 36.6 + 8.31·ln(T_b) J/(mol·K), and its vapour pressure from the Clausius–Clapeyron
equation integrated at constant ΔH_vap, anchored at one atmosphere at its own normal boiling
point. The vapour is ideal and the liquid follows Raoult's law, so K = Pˢᵃᵗ/P. Because the raw
sums span thirty orders of magnitude across this grid, every phase-boundary solve works on
log K and log-sum-exp residuals rather than on K directly.

**Flash.** The charge is heated to the furnace outlet temperature and flashed at the flash-zone
pressure by Rachford–Rice, solved by Newton's method with a bisection guard.

**The tower, above the flash zone.** A stagewise cascade solved by the bubble-point
(Wang–Henke) method. The component balances on each sweep form a tridiagonal system,

    ℓ_{j−1} − [(1 + φ_j) + S_j]·ℓ_j + S_{j+1}·ℓ_{j+1} = −f_j,    S_j = K_j·V_j/L_j,  φ_j = U_j/L_j

solved exactly by the Thomas algorithm. Side draws enter as **ratios** φ of the liquid flowing
past the tray rather than as fixed rates; the system then telescopes to an exact material balance
on every sweep, so the balance closes whether or not the temperatures have converged. Constant
molar overflow is imposed explicitly on the vapour and liquid traffic. Stage temperatures are
then updated from the bubble-point condition and the sweep repeats, under relaxation that is
reduced automatically when progress stalls.

**The tower, below the flash zone.** An atmospheric crude tower has no reboiler — heating that
bottoms would crack it — so the temperature in the stripping section is not free, and the
stagewise formulation is genuinely singular there. That section is treated by the Kremser group
method (absorption and stripping factors) instead. The two halves meet at the flash zone. The
same group method handles each side stripper.

**Steam.** Stripping steam is treated as an inert carrier: it is excluded from the equilibrium
solve and enters through the total vapour, so the bubble-point condition becomes Σ K·x = 1 − y_steam.
That is how the tower strips without a reboiler.

**Energy.** Furnace and condenser duties are computed from the sensible and latent terms the
model already carries. They are reported in MW to the nearest MW.

### What it does not claim

Tray efficiency is not modelled: every stage is a theoretical stage. Liquid non-ideality,
tray pressure drop beyond the linear profile, heat losses, and any cracking in the heater are
outside the model. The three assays are plausible shapes for light, medium and heavy crude, not
transcriptions of a particular field's assay. **No result on the page has been validated against
a real unit or against a commercial simulator,** and none should be read as a prediction of one.
The page states its assumptions on screen, under *Model assumptions*.

### Run states

`READY` → `CALCULATING` (the charge is characterised and flashed) → `CONVERGING` (the cascade
iterates) → `COMPLETE`, `WARNING` or `ERROR`. The three outcomes mean what they say:

- `COMPLETE` — the solver reported convergence and the material balance closes inside 1×10⁻⁶.
- `WARNING` — a result was produced with qualifications, each stated in full: the iteration limit
  was reached with the profile still moving, a side draw asked for more liquid than flows past
  its tray, the condenser cannot deliver the requested split, or the balance is outside tolerance.
  The page never reports convergence the solver did not report.
- `ERROR` — the inputs were refused or the solve failed. No product rate, temperature or duty is
  shown, in either view, and the plant is drawn with no flow.

The panel plots the residual against sweep number, so what the solver actually did is visible
rather than asserted.

### How the three views stay in step

The engine produces one result. `plant.js` and `view2d.js` both read it, and both stamp the same
`pick` identifiers onto what they draw, so a selection made in the 3D scene is already a selection
in the flow sheet and in the information panel — there is no synchronisation code, because there
is only one piece of state. Line weights and tracer densities follow the computed mass flows;
the thermal ramp is anchored to a fixed 30–380 °C scale so that a colour means the same
temperature from one run to the next.

### Rendering

WebGL 1 with `ANGLE_instanced_arrays`, ten instanced mesh groups and hardware multisampling; the
geometry is parametric and built in unit frames, so one cylinder mesh becomes every pipe.
Picking renders component ids to an offscreen buffer and reads one pixel. No library is loaded:
the Content-Security-Policy forbids external scripts, and the shaders are inline strings.
The renderer sheds tracer density if it cannot hold a usable frame rate, and says so on screen.
Where WebGL is unavailable the page falls back to the flow sheet, which needs none.

---

## Local development

No toolchain required.

```bash
git clone <your-repo-url>
cd distillex
python3 -m http.server 8000     # or: npx serve .
# open http://localhost:8000
```

To edit the application, open `src/DISTILLEX.dc.html` — the markup and the binary calculation
engine (`class Component`) live in that one file, and the industrial crude unit lives in
`src/rig/` and is inlined at build time by an `// @include rig/x.js` directive on a line of its
own. The directive is resolved depth-first, re-indented to its own column and refuses cycles, so
the repository keeps real modules while the deployed artefact stays a single self-contained page;
`tools/engine.js` resolves the same directives, so the regression suite runs against exactly the
assembled source the page ships. The binary engine's functions (`psat`, `bubbleT`,
`dewT`, `curve`, `yEq`, `xEq`, `qIntersect`, `minReflux`, `lines`, `stepStages`, `solve`,
`variant`) are kept separate from the UI, and the crude unit keeps its simulation, its scene, its
flow sheet, its controller and its view model in five separate files. Serve `src/DISTILLEX.dc.html` directly while you work, then
regenerate the deployable bundle:

```bash
python3 tools/build.py           # rewrite index.html from src/DISTILLEX.dc.html
python3 tools/build.py --check   # verify index.html is in sync (non-zero exit if stale)
```

`src/DISTILLEX.dc.html` is the single source of truth for the markup and the engine.
`tools/build.py` regenerates only the part of `index.html` derived from it and reuses the
published asset layer — the loader, the gzipped font/React manifest and the inlined
design-system CSS — verbatim, since those are binary artifacts this repository does not rebuild.
Standard library only, no dependencies.

**The rest of `src/` is a mirror, not an input.** Only `src/DISTILLEX.dc.html` is compiled into
`index.html`. `src/support.js` and `src/_ds/` are byte-identical copies of what the published
bundle already carries, kept so the shipped runtime and design system are readable and
diffable — but editing them changes nothing, because the build lifts those assets out of the
existing `index.html` rather than rebuilding them. A design-system change therefore has to be
made as an override in the `<style>` block of `src/DISTILLEX.dc.html`, which the build does
compile and which is loaded after the inlined design-system CSS. Two consequences worth knowing:
`src/_ds/…/_ds_bundle.js` looks inert but is a real shipped asset and its `<script>` tag is the
anchor `build.py` uses to place the design-system layer, so neither may be deleted; and
`src/_ds/…/styles.css` still carries the upstream `@import` of Google Fonts that the publisher
replaced with inlined `@font-face` rules, so the deployed page makes no font request — were that
layer ever rebuilt from source it would reintroduce one, which the Content-Security-Policy would
then block.

## Validation

```bash
node tools/test.js            # the whole suite; exits non-zero on any failure
node tools/test.js --list     # list the suites
node tools/test.js thermo     # run selected suites
```

511 checks in fourteen suites, standard library only, no dependencies. The suite loads the
application straight out of `src/DISTILLEX.dc.html` — resolving the same `@include` directives
the build resolves — so it tests exactly the code the page ships.

| Suite | What it anchors against |
| --- | --- |
| `identity` | `solve()` is byte-for-byte unchanged and still has exactly two call sites, both behind the validation gate |
| `analytic` | Fenske and Underwood against their closed forms; stage count at total reflux against ⌈N_min⌉ |
| `pure-component` | every component's vapour pressure at its own normal boiling point must give 1 atm |
| `thermo` | bubble/dew consistency, interpolation error, and the constant-α curve against the relation it is built from |
| `invariants` | balances, constant molar overflow, stage recurrence and ordering over ~258 feasible cases |
| `matrix` | a 648-case SHA-256 fingerprint that changes if any computed number changes |
| `validation` | hostile inputs must be rejected with no NaN, no stale result, no uncaught error, and never reach `solve()` |
| `save-load` | a configuration must round-trip exactly and reproduce the same solution |
| `disclosures` | every numeric the interface states about its own method is re-read from the code |
| `contrast` | the palette the page ships must clear WCAG 1.4.3 (4.5:1) wherever the accent carries text, in both themes, and no text may fall back to the raw accent |
| `headers` | the deployed security headers, and every CSP allowance still being one the shipped runtime demonstrably needs |
| `build` | `index.html` must be reproducible from `src/` |
| `cdu` | the crude-unit engine: vapour pressure at every cut's own normal boiling point, Rachford–Rice residuals, phase recombination, the Kremser closed forms, exact material closure, a monotone temperature profile, and every direction the physics must move in — furnace, reflux, pressure, assay, steam and scale — plus the operating points that must be refused |
| `rig` | the presentation layers: every mesh well formed, every plant object naming a mesh the renderer builds, nothing modelled below the paving, every `pick` id carrying an information record, every tour stop naming a camera that exists, the flow sheet summing to the charge with no two labels colliding, the thermal scale fixed across runs, and the view model inventing nothing before a run or after a refusal |

The `contrast` suite checks the palette and how the source uses it, which is what can be
verified without a browser; it does not walk the rendered page. The per-view sweep that found
the original 103 failing text instances was run separately with a headless browser and is not
part of this suite.

**Internal validation only.** Nothing is compared against a published worked example, tabulated
experimental VLE data, or another simulator — no such comparison has been carried out. These
checks show the implementation is faithful to *its own model*; they say nothing about how well
that model describes a real column. `METHODS.md` gives the derivations and §9 lists exactly what
is and is not checked.

## Deployment (GitHub → Vercel)

1. Create a GitHub repository and push this project.
2. In Vercel, **Add New → Project → Import** the repository.
3. Framework preset: **Other**. Build command: *none*. Output directory: `.` (repository root).
   No environment variables and no secrets are required.
4. **Deploy**, then open the generated `*.vercel.app` URL.
5. To update the live site, commit and push to the tracked branch — Vercel rebuilds and
   redeploys automatically. Pull requests get their own preview URLs.

## Security headers

`vercel.json` sets a catch-all header rule for every path:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | see below |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `no-referrer` — the page fetches nothing at runtime; the only outgoing link is the author's profile, which needs no referrer |
| `Permissions-Policy` | camera, microphone, geolocation, USB, payment, sensors and the rest denied outright |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=31536000` (one year, no `includeSubDomains`, not preloaded) |

The CSP is:

```
default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:;
style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;
connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none';
frame-src 'none'; worker-src 'none'; frame-ancestors 'self'
```

Three allowances are wider than one would like, and each is forced by how the
page is published rather than chosen:

- `'unsafe-eval'` — the component runtime executes the page's logic through the
  `Function` constructor. Removing it leaves the application unable to start.
- `'unsafe-inline'` for scripts — the loader unpacks the bundle and re-creates
  every script element inline. Removing it leaves nothing rendered at all.
- `blob:` in `script-src` — React, ReactDOM and the runtime are unpacked from
  the manifest into blob URLs. Removing it breaks the application.

`data:` is needed by `font-src` for the fifteen inlined font faces and by
`img-src` for the inline SVG favicon; removing the first silently drops the
page to fallback typography. Each of these was confirmed by serving the real
`vercel.json` locally, removing one allowance at a time and observing what
broke. `blob:` is deliberately **not** granted to `connect-src` or `img-src`,
where the application was shown not to need it.

Everything else is closed: no wildcard or scheme-wide source anywhere, objects
and forms denied, `base-uri` pinned, and cross-origin framing refused. Verified
in a browser: an injected external script, an `<object>`, a `<base>` hijack, a
cross-origin `fetch`, a cross-origin form submission and a cross-origin embed
are all blocked.

**What this does not do.** A CSP carrying `'unsafe-inline'` and `'unsafe-eval'`
does not stop script injection — it cannot, given how the bundle loads. Its
value here is confining the page to its own origin: no third-party script, no
exfiltration endpoint, no injected form target, no clickjacking frame. The
application has no server, no accounts, no cookies and no stored data, so there
is no session to steal; these headers reduce the blast radius of a compromised
*asset*, not of injected script.

## Roadmap

Activity-coefficient models (Wilson, NRTL, UNIQUAC); multicomponent shortcut design
(Fenske–Underwood–Gilliland); rigorous tray-by-tray energy balances; column hydraulics and
sizing; further unit operations — absorption, liquid–liquid extraction, evaporation, drying,
heat exchangers — reusing the same thermodynamic and data layers.

## Author

**Shafin Ahamed Neon** — developer. Design, thermodynamic model, calculation engine and interface.

- LinkedIn: <https://www.linkedin.com/in/shafin-ahamed-neon-aa9596213>

## Licence

MIT — see `LICENSE`.

## Disclaimer

This simulator is intended for education and conceptual engineering analysis. Results depend on
the selected thermodynamic model and assumptions and should not be used as the sole basis for
industrial process design.
