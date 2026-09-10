# DISTILLEX — Interactive Fractional Distillation Laboratory

A client-side simulator for the fractional distillation of **binary** mixtures: vapour–liquid
equilibrium, McCabe–Thiele stage construction, column operation, stage profiles, sensitivity
studies, theory and an exam mode. Everything is computed in the browser — no server, no build
step, no account, no telemetry, no stored data.

**Live entry point:** `index.html` (self-contained, ~480 KB, works offline by double-click).

---

## Contents

```
.
├── index.html      ← the deployable application (all CSS, fonts, runtime inlined)
├── src/            ← editable source
│   ├── DISTILLEX.dc.html    the application source (markup + calculation engine)
│   ├── support.js           component runtime
│   └── _ds/…                design-system tokens and stylesheet
├── vercel.json
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
- Dark mode; responsive from desktop down to mobile.

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
`variant`) kept separate from the UI. Re-generate `index.html` from `src/` when you are done, or
serve `src/DISTILLEX.dc.html` directly during development.

## Deployment (GitHub → Vercel)

1. Create a GitHub repository and push this project.
2. In Vercel, **Add New → Project → Import** the repository.
3. Framework preset: **Other**. Build command: *none*. Output directory: `.` (repository root).
   No environment variables and no secrets are required.
4. **Deploy**, then open the generated `*.vercel.app` URL.
5. To update the live site, commit and push to the tracked branch — Vercel rebuilds and
   redeploys automatically. Pull requests get their own preview URLs.

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
