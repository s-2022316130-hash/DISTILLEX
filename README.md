# DISTILLEX — Interactive Fractional Distillation Laboratory

A client-side simulator for the fractional distillation of **binary** mixtures: vapour–liquid
equilibrium, McCabe–Thiele stage construction, column operation, stage profiles, sensitivity
studies, theory and an exam mode. Everything is computed in the browser — no server, no build
step, no account, no telemetry, no stored data.

**Live entry point:** `index.html` (self-contained, ~521 KB, works offline by double-click).

---

## Contents

```
.
├── index.html      ← the deployable application (all CSS, fonts, runtime inlined)
├── src/            ← editable source
│   ├── DISTILLEX.dc.html    the application source (markup + calculation engine)
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
759.0 mmHg at 80.0 °C and water 757.6 mmHg at 100.0 °C, both ≈ 760 mmHg as they must. Latent
heats are values at the normal boiling point. Stage temperatures outside a fitted range raise an
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

## Local development

No toolchain required.

```bash
git clone <your-repo-url>
cd distillex
python3 -m http.server 8000     # or: npx serve .
# open http://localhost:8000
```

To edit the application, open `src/DISTILLEX.dc.html` — the markup and the calculation engine
(`class Component`) live in that one file, with the engineering functions (`psat`, `bubbleT`,
`dewT`, `curve`, `yEq`, `xEq`, `qIntersect`, `minReflux`, `lines`, `stepStages`, `solve`,
`variant`) kept separate from the UI. Serve `src/DISTILLEX.dc.html` directly while you work, then
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

## Validation

```bash
node tools/test.js            # the whole suite; exits non-zero on any failure
node tools/test.js --list     # list the suites
node tools/test.js thermo     # run selected suites
```

217 checks in twelve suites, standard library only, no dependencies. The suite loads the calculation
engine straight out of `src/DISTILLEX.dc.html`, so it tests the same code the page ships.

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
| `Referrer-Policy` | `no-referrer` — the page makes no outbound request and has no external link, so no referrer ever needs to leave |
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

## Licence

MIT — see `LICENSE`.

## Disclaimer

This simulator is intended for education and conceptual engineering analysis. Results depend on
the selected thermodynamic model and assumptions and should not be used as the sole basis for
industrial process design.
