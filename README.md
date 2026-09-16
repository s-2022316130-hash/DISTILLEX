# DISTILLEX — Interactive Fractional Distillation Laboratory

A client-side simulator for the fractional distillation of **binary** mixtures: vapour–liquid
equilibrium, McCabe–Thiele stage construction, column operation, stage profiles, sensitivity
studies, theory and an exam mode. Everything is computed in the browser — no server, no build
step, no account, no telemetry, no stored data.

**Live entry point:** `index.html` (self-contained, ~1180 KB, works offline by double-click).

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
│   ├── standalone/          the crude unit as a self-contained page
│   │   ├── page.html          markup and stylesheet
│   │   └── ui.js              the interface, without a framework
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
├── examples/
│   ├── crude-unit.html      the industrial simulator alone, in one file
│   └── README.md            how to adapt it to another process
├── tools/
│   ├── build.py             regenerates index.html from src/ (see below)
│   ├── standalone.py        regenerates examples/crude-unit.html from src/
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

### The design system

`src/rig/theme.js` holds every colour the simulator uses, in two themes, and
every other layer reads from it: the WebGL scene, the flow sheet, the charts
and the interface. Nothing downstream owns a colour of its own.

Everything was designed in OKLCH and converted. **Hue is held constant between
the themes** — only lightness and chroma move — so nothing changes identity
when the lights come on: diesel is the same orange, darker. Two stream
families keep a product from being mistaken for a utility:

- **Products** run as a sequential ramp, cold to hot, which is also the order
  of boiling point and roughly how a jar of each cut actually looks: wet gas a
  colourless vapour, naphtha pale straw, kerosene amber, diesel orange-brown,
  gas oil dark amber, residue nearly black-red. Lightness ramps *down* as the
  cut gets heavier — a flat lightness across the warm gamut cannot hold chroma
  and collapses diesel, gas oil and residue into one washed salmon.
- **Utilities** are cool or neutral. Crude is deliberately the dullest line on
  the plot, because it is the one stream not yet separated into anything.

The interface accent is indigo, deliberately outside the process ramp, so a
control can never be mistaken for a stream.

Light mode is not a filter over the dark one. The 3D scene is re-lit: a
brighter environment wants a **stronger** key and a **weaker** sky fill than a
dark one, or the form flattens into a chalky bath of ambient light, plus a
lower exposure because the same albedo catches far more light. The paving
changes albedo outright, the rim light is turned down to a fifth (on a bright
background it reads as a halo), the apron staining inverts — a dark deck is
stained lighter by traffic, a bright one darker — and the flow tracers switch
from additive to alpha blending, because additive is invisible on white.

The `rig` suite checks all of it in both themes: every text tone against every
surface it can appear over (WCAG 1.4.3, 4.5:1), every stream against the
ground and the panel (1.4.11, 3:1), that no two streams collide, that the
accent is not also a stream, that hue survives the theme switch, and that both
stylesheets still carry the exact values `theme.js` generates.

### One vocabulary for every diagram

The binary simulator's plots draw from a small set of *plot roles*, so a colour
means the same thing wherever it appears:

| Role | Carries | Why |
| --- | --- | --- |
| `--dx-plot-phys` | the equilibrium curve, the dew line, y vapour | the physics, which is not yours to move |
| `--dx-plot-spec` | the operating lines, the drag handles | what you specified |
| `--dx-plot-liq` | the bubble line, x liquid, L | the falling phase |
| `--dx-plot-feed` | the q-line, the feed stage | where the feed enters |
| `--dx-plot-work` | the stage construction | pencil work, laid over the lines it is built from |
| `--dx-plot-ref` | y = x, the minimum-reflux line | reference geometry |
| `--dx-mark` | the hovered stage, the swept case, the selected tray | a live cursor, tuned at 3:1 as a marker rather than 4.5:1 as a label |

Three hues carry meaning and the rest is ink. Before this the McCabe–Thiele
diagram used three different blues plus a teal — equilibrium in the accent,
operating lines in accent-800, the staircase split between two process colours
— and the *answer*, the staircase, was the quietest thing on the plot. The
stage charts under the column contradicted the column's own legend, colouring
x and y as two values of one blue while the legend beneath them said blue for
liquid and teal for vapour.

Convergence state uses the semantic roles rather than the accent: a rating
solve that fails to close cannot wear the same colour as one that succeeds.

### The phone

The interface was designed at desk width and then measured at 390x844, which
is where most of it was found wanting. The numbers below are measured, not
estimated, by a harness that drives the real page.

**Chrome.** 229 CSS px of a 844px viewport was permanently occupied: a wordmark
row, a horizontally scrolling destination rail, and a toolbar that wrapped to
two rows because an inline `flex-wrap:wrap` beat the media query that was
written to prevent exactly that. Navigation now docks to the bottom, in the
thumb's reach, and the occasional controls — reset, save, load, export, the
detail level, the theme — sit behind one target in a slim top bar. 229px became
117px, and the half of it that remains is navigation rather than a file menu.

Two related defects went with it. The active destination was scrolled off
screen on six of the ten views with nothing marked, because the pill that
indicates it is hidden on a phone and nothing ever scrolled the rail; the rail
now centres on wherever you are. And the chip that was supposed to mark the
active tab never painted at all, because the view-model wrote
`background:transparent` inline.

**Height.** Every card whose content is prose, a derived table, or something
set once a session now collapses, with the card's own heading as the
disclosure — so nothing hides behind an unlabelled control, and the heading is
still a heading in the document outline. Above 900px every card is simply open
and the summary is not a control, so a desk reader loses nothing.

| view | was | now |
| --- | --- | --- |
| Simulation | 4692px | 2908px |
| Results | 2970px | 1540px |
| About | 2911px | 1584px |
| VLE Explorer | 2112px | 1368px |
| Column | 1648px | 1081px |
| McCabe-Thiele | 2044px | 1765px |
| landing | 5267px | 4827px |

**Order.** Stacked, the desktop column order reads controls first and answer
last: on McCabe-Thiele the diagram — the entire point of the view — began
1,660px down, after five sliders, a note, the stage stepper and a results
table. The four diagram views now put the output first and the controls under
it, and Simulation leads with the solved result, then the column, then the
inputs. The desktop grid is untouched.

**Things that did not work on a touch screen at all.** The eight-cut tower on
the landing page was hover-only, so its detail panel was frozen on the overhead
cut for ever while the caption told the reader to hover. The McCabe-Thiele
specification handles were 7px targets, and a drag ended the moment the finger
crossed the plot edge. A theory topic could be opened and never closed. Plot
type set in user units resolved to 5-7px. Each of those is fixed, and none of
the fixes changes the desktop drawing: the handles get a transparent 56-unit
hit area only under `pointer: coarse`, the type is raised by CSS which wins
over the SVG presentation attribute, and the tower takes a tap as well as a
hover.

**Targets.** Every interactive element on every view, in both themes, reaches
44px — verified by hit-testing the document 20px out from each element's
centre rather than by measuring its box, because a box can be small while the
target is not. The one documented exception is the inline help marker beside a
slider label: it sits inside the words it annotates, so it takes WCAG 2.5.8's
24px minimum rather than 44px, which would swallow the label either side.

### The process, drawn

The landing page carries a schematic of the arrangement a column actually has:
feed into the middle, vapour up to a condenser and reflux drum, distillate out,
reflux back to the top, the reboiler firing the sump, bottoms out of the base.
The geometry is fixed — it is a schematic, and says so — but every number on
it is the engine's own answer for the loaded mixture: z_F, x_D, x_B, the reflux
ratio, and the top and bottom temperatures.

Two animations carry all of it: one dash offset shared by every pipe, and a set
of particles rising and falling inside the vessel. Both are properties the
compositor can handle on its own, and both stop under
`prefers-reduced-motion`.

It replaced a glyph matrix that plotted the composition profile in characters.
That was accurate and nobody could read it.

### Motion

The system is one scale — `--dx-t-fast` through `--dx-t-reveal`, two easings,
no loose millisecond values — and the pass that produced it was measured rather
than eyeballed. Frames longer than 20ms, counted over the interactions that
animate most:

| | before | after |
| --- | --- | --- |
| theme switch, worst frame | 133ms | 33ms |
| view change, worst frame | 50ms | 33ms |
| scroll the landing page | 0 long frames | 0 long frames |

(Software rendering under SwiftShader, so the absolute numbers are pessimistic;
the comparison is the point.)

Three things were costing that:

- **`filter: blur()` was animating on every view change and every scroll
  reveal.** Blur cannot be composited — it re-rasters the whole element every
  frame — and it was on the two transitions that run most often. Both are
  opacity and transform now.
- **The theme switch had no transition at all**, so every surface repainted in
  one frame and it read as a flash. It cross-fades now, over a class that is on
  the root only while the switch is in flight. Scoped to the large flat
  surfaces: transitioning `*` was worse than the flash it fixed, at 133ms
  against a 50ms baseline.
- **A disclosure snapped to full height** and faded its contents in afterwards.
  Where the browser can interpolate to `auto` it now grows — 44px to 384px over
  340ms, measured mid-transition — and everywhere else it behaves exactly as
  before.

### The mark and the ground

The mark is the McCabe-Thiele construction: the equilibrium curve the physics
fixes, and the staircase stepped off against it. It is the drawing every
student of this subject makes by hand, so it says what the product is without a
word, and it reduces to a flat silhouette for the favicon. It replaces a
bordered square that could have belonged to anything.

The background was two drifting fields of colour and a grid. In daylight a wash
designed as glow-on-black reads as a stain, and every panel floated in coloured
haze. The ground is now an engineering sheet — a 22px module, a 132px major
rule, one soft lift where the page catches the light, and a flow sheet of the
unit itself drawn at the scale of a real drawing and bled off the right edge.
It is CSS gradients plus one 2.4 KB inline SVG, no animation, and the drawing
is dropped below 900px where it would never be seen.

It takes no hue of its own. Every saturated colour in this project means
something — a stream, a plot role, a state — so the rules and the drawing are
the theme's own ink at a weight low enough to read as paper. And it is
`position: absolute` rather than `fixed`: a rule that does not move with the
drawing is wallpaper.

**How the contrast was checked, and what that caught.** The first numbers here
were computed per layer — ink over one rule, ink over the motif — and they were
wrong. Decoding the actual painted page told a different story: the two grids
shared a pitch, so every 132px *four* rules landed on the same pixel, and
`--dx-ink3` over that lattice fell to 3.95:1. Reading the tokens would never
have shown it. The major rule is now offset half a minor cell so the grids
never coincide.

Measured off the composited page, sampling every pixel, with the cards hidden:

| | ground | worst pixel | `--dx-ink3` there | `--dx-ink2` | body ink |
| --- | --- | --- | --- | --- | --- |
| daylight | `rgb(240,243,248)` | `rgb(224,226,232)` | 4.52:1 | 5.61:1 | 12.88:1 |
| night | `rgb(9,12,19)` | `rgb(31,33,40)` | 5.55:1 | 7.90:1 | 14.48:1 |

78% of the frame is the base colour exactly. The script that does this is not
part of the headless suite — it needs a browser — but the method is the point:
a background layer is precisely what a token-reading contrast test cannot see.

### Taking it somewhere else

`examples/crude-unit.html` is the industrial page on its own: one file, no
build step, no dependencies, no network request. It is generated from
`src/standalone/` plus the same `src/rig/` modules, by the same `@include`
resolver, so it cannot drift from the application — `tools/standalone.py
--check` and the `standalone` suite both assert that. `examples/README.md`
documents the result-object contract, which is what a different process would
have to produce; everything downstream reads that, not the physics.

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

858 checks in fifteen suites, standard library only, no dependencies. The suite loads the
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
| `standalone` | `examples/crude-unit.html` is reproducible from `src/standalone/`, loads no external script or stylesheet, requests nothing over the network, declares each module exactly once, and still carries the not-validated notice |
| `rig` | the palette, in both themes — every text tone against every surface (4.5:1), every stream against the ground and the panel (3:1), no two streams colliding, the accent outside the process ramp, hue constant across the switch, the lighting rigs' invariants, and both stylesheets carrying the exact values `theme.js` generates — plus the presentation layers: every mesh well formed, every plant object naming a mesh the renderer builds, nothing modelled below the paving, every `pick` id carrying an information record, every tour stop naming a camera that exists, the flow sheet summing to the charge with no two labels colliding, the thermal scale fixed across runs, and the view model inventing nothing before a run or after a refusal |

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
