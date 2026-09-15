# `crude-unit.html` — the industrial simulator, on its own

One file. Open it by double-clicking: no build step, no server, no
dependencies, and no network request of any kind — the fonts are the system
stack and the WebGL shaders are inline strings.

It is generated, not hand-maintained:

```bash
python3 tools/standalone.py           # rewrite examples/crude-unit.html
python3 tools/standalone.py --check   # verify it is in sync with src/
```

The source is `src/standalone/page.html` (markup + stylesheet + interface) plus
the same `src/rig/*.js` modules the application uses, inlined by the same
`// @include` resolver. Edit the sources, not the output.

## The layers, and which one to replace

| Layer | File | What it does |
|---|---|---|
| **simulation** | `rig/engine.js` | **the only thing that computes** |
| scene | `rig/plant.js`, `rig/renderer.js` | the unit as geometry; the WebGL view of it |
| flow sheet | `rig/view2d.js` | the same result, drawn flat |
| information | `rig/info.js` | what each component is; camera presets; the tour |
| interface | `standalone/ui.js` | state, rendering, input, run states |
| maths | `rig/glmath.js`, `rig/geometry.js` | vectors and parametric meshes |

To simulate something else, replace `engine.js` and `plant.js`. Everything
downstream reads whatever the engine returns, so the contract is the shape of
its result object, not its physics.

## The contract

`CDU.run(inputs)` returns either

```js
{ ok: false, status: 'error', errs: [{ field, msg }], warns: [] }
```

or

```js
{
  ok: true,
  status: 'complete' | 'warning',
  converged: Boolean,          // what the solver actually reported
  outer: Number,               // sweeps taken
  trace: [[i, dT, dF], …],     // the residual trajectory, for the plot
  ms: Number,
  feed:     { mass, molar, M, api, T },
  flash:    { psi, T, P, vapour, liquid },
  steam:    { molar, mass, side },
  products: [{ key, name, mass, pct, tbp5, tbp50, tbp95, sg, drawT, comp[] }, …],
  balance:  { inMass, outMass, closure },     // closure is the fractional error
  energy:   { furnace, condenser, Ttop, Tbot },
  internals:{ Tprofile[], Pprofile[], Lprofile[], Vprofile[],
              stageLabel[], stageKind[], feedStage, … },
  warns: [String, …]
}
```

Two other entry points: `CDU.validate(inputs)` → `{ ok, errs, warns }`, called
before anything else so bad inputs never reach the solver; and
`CDU.feedPhase(inputs)`, the cheap first half, so the page can show real
figures while the cascade is still iterating.

`CDU.LIMITS` drives the whole operator panel — label, unit, range, integer-ness.
Add a key there and it appears as a control; the panel cannot offer a value the
solver would refuse.

## Three rules worth keeping

**Never fill a gap with a plausible number.** Before a run, and after a refused
one, every figure on the page is an em dash. The flow sheet draws at nominal
line weights with no rates; the instruments read `—`; the scene has no flow.
`grep` for `DASH` in `ui.js` to see where.

**Never report convergence the solver did not report.** The status is
`COMPLETE` only when `converged` is true *and* the balance closes; otherwise
`WARNING`, with each qualification stated in full. The residual is plotted per
sweep so the claim is checkable rather than asserted.

**One piece of state, many views.** `plant.js` and `view2d.js` stamp the same
`pick` identifiers, so a selection in the 3D scene is already a selection in the
flow sheet and the information panel. There is no synchronisation code because
there is nothing to synchronise.

## Performance

The scene is ~53,000 triangles in 11 instanced draw calls. Level of detail is
assigned by size in `plant.js` — anything under 0.30 m across gets a coarse
mesh — as a substitution over the finished object list, so no call site has to
choose. A watchdog in `ui.js` thins the tracers, then drops the backing-store
resolution, restores both when the frames come back, and says on screen which
of the two it did.

Where WebGL is unavailable the page says so and falls back to the flow sheet,
which needs none.

## Licence and honesty

MIT, from [DISTILLEX](https://github.com/s-2022316130-hash/DISTILLEX).

The model is documented in the root `README.md`. Nothing in it has been
validated against a real unit or a commercial simulator, and the page says so
under *Model assumptions*. Keep that notice if you keep the model.
