# Prompt — a real-time 3D plant simulator, no 3D library

Paste the whole of this file into a Claude Code session, replace everything in
`⟨angle brackets⟩`, and delete any section that does not apply. It is written
from a working build (a crude distillation unit rendered as a full refinery
site), so every rule in it was paid for once already.

---

## The brief

Build an interactive 3D view of ⟨THE THING: a crude unit / a brewery / a water
treatment works / a data centre hall / a machine shop⟩ inside ⟨THE PROJECT⟩.

It must be driven by ⟨THE MODEL: the existing solver / simulation / telemetry
feed⟩ — the picture reports the state of that model and nothing else. It is an
instrument, not a screensaver.

Three things make it worth building, in this order:

1. **It is honest.** Every number the scene shows comes from the model. If the
   model did not converge, the scene says so; it never renders a plausible
   steady state over a failed run.
2. **It is readable.** Someone who knows ⟨THE DOMAIN⟩ recognises the equipment,
   and someone who does not can learn what each item is from the scene itself.
3. **It is fast on a phone.** Not "works on a phone" — holds a frame rate on a
   phone, and tells the viewer when it cannot.

---

## Hard constraints

- **No 3D library.** Raw WebGL1 + a small matrix module. Three.js and friends
  are 600 KB to draw a hundred cylinders. You will write ~2,500 lines instead
  and they will be the right 2,500 lines. (If the project already has a 3D
  stack, use it — but keep the module split below.)
- **No external requests at runtime.** No CDN, no font fetch, no texture
  download. Everything inlined or generated.
- **Do not break the existing Content-Security-Policy**, build, or deploy.
- **Do not invent domain numbers.** Temperatures, yields, pressures, capacities,
  dimensions: take them from the model, from a cited source, or leave them out.
  A label that says `TK-203 DIESEL — fixed cone roof` is a fact about the shape
  you drew. A label that says `1,450 m³` is a claim, and needs a source.
- **Do not add dependencies** before reading what the project already has.

---

## Architecture — split it this way

One module per concern, each a plain IIFE exposing one global, in this
dependency order. Do not merge them; the boundaries are what make the thing
editable six months later.

| Module | Owns | Must not know about |
|---|---|---|
| `glmath.js` | mat4/vec3, perspective, project, a critically damped spring | anything else |
| `geometry.js` | mesh generators: cylinder, cone, dish, box, annulus, sphere, swept arc. Each returns `{pos, nrm, idx}` | the domain, the renderer |
| `kit.js` | equipment builders — `K.vessel`, `K.tank`, `K.pump`, `K.stair`, `K.pipeRun`. Composes primitives into *machines* | the specific plant |
| `plant.js` | the plot plan: what exists, where, connected to what. Returns `{objects, streams, anchors, labels, instruments, bounds}` | GL, the DOM |
| `renderer.js` | buffers, shaders, draw calls, picking, camera | the domain |
| `info.js` | camera presets, per-item explanatory text, the guided tour | GL |
| `panel.js` | mount, rAF loop, pointer/touch, overlay projection, the adaptive watchdog | mesh internals |
| `vm.js` | what the template binds to | GL |

`plant.js` is the only file that says what your plant *is*. Someone should be
able to build a different plant by editing that one file.

---

## The rules that cost the most to learn

### 1. Winding

Swept meshes (cylinder, cone, arc) are wound to suit whatever axis-alignment
helper you write. If that helper's basis is left-handed — and the obvious one
is — then placing such a mesh with a **positive-scale** transform presents back
faces, and backface culling makes it invisible.

The symptom is a see-through tower, and you will chase it as a lighting bug.

Fix it once, in the kit, by negating one horizontal scale:

```js
K.up = function (mesh, mat, x, y, z, r, h, pick) {
  add(mesh, mat, M.trs(M.m4(), x, y, z, r, h, -r), pick);   // note the -r
};
```

Then write the rule in a comment at the top of the kit, and route **every**
swept placement through the kit. Meshes that are wound for a positive `trs`
(box, dish, annulus, sphere) get their own helper so the two never mix.

### 2. Detail tiers are instance-buffer prefixes

Give every object a `tier`: `0` the process itself, `1` the near surroundings,
`2` the far furniture and the fine access steel. Sort each mesh group by tier
and record the running counts, so **any tier is a prefix of the buffer**:

```js
list.sort((a, b) => (a.tier|0) - (b.tier|0));
const tierN = [0, 0, 0];
list.forEach(o => { for (let t = Math.min(2, o.tier|0); t < 3; t++) tierN[t]++; });
// ... at draw time:
ext.drawElementsInstancedANGLE(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0,
                               g.tierN[state.detail]);
```

Changing the detail level is then **one integer per draw call** — no rebuild,
no re-upload, no lost context. This is what makes an adaptive quality watchdog
safe to run continuously.

### 3. Stop drawing when nothing changed

```js
if (!dirty && !camMoved && !state.animating) return false;
```

Have the camera's spring step report whether it actually moved, and have every
state setter mark `dirty`. On a settled camera over a paused scene this takes a
phone from a 100%-busy GPU to idle, and it is the single biggest real-device
win available. Also bail the whole rAF loop on `document.hidden`.

### 4. Two shader programs, not one with branches

Compile the fragment shader twice — full, and with the rim light and the
environment fresnel removed — and pick per frame:

```js
drawScene((state.scale < 0.99 || state.detail < 2) ? progLite : progMain);
```

A machine already showing a reduced picture does not also need the expensive
one. Uniform branching in the shader does not save the work.

### 5. Measure before you optimise, and say what you measured on

On a software rasteriser (headless CI, SwiftShader) the scene is
**vertex-bound**; on a real GPU it is usually fill-bound. Cutting fragment work
gained ~1 fps in CI and cutting tessellation gained 3–4, which would invert on
a phone. Measure both, and when you report a number say what drew it —
a CI rasteriser is roughly two orders of magnitude pessimistic.

### 6. Overlay labels are DOM, projected

Do not render text in GL. Project the world anchor to CSS pixels and move a DOM
node with `translate3d` (transform only — never touch `top`/`left`, which
re-lays-out the overlay every frame):

```js
function toScreen(p) {
  M.project(tmp, p, viewProj);
  if (tmp[2] <= 0) return null;                       // behind the camera
  return { x: (tmp[0]*0.5+0.5) * cv.clientWidth,
           y: (1-(tmp[1]*0.5+0.5)) * cv.clientHeight, d: tmp[2] };
}
```

Then five rules, all of which you will otherwise discover by shipping a mess:

- **Nearest wins a clash**, and the selected item is placed first regardless.
- **Clash-test the box the label actually occupies**, using `offsetWidth` — not
  a fixed gap around its anchor. A narrow label otherwise hides inside a wide
  neighbour and both get drawn, one over the other.
- **Reach follows the camera distance** (`max(floor, cam.dist * 1.7)`). In a
  close-up, a label on something 100 m behind is clutter; in the wide shot the
  same label is the subject.
- **A label belongs to a detail tier** and disappears when that tier does —
  otherwise a reduced scene floats nameplates over empty ground.
- **Clamp the label inside the canvas box.** Its leader dot still points at the
  item, so a clamped label is right and a half-off-screen one is litter.

Cap the total (about 11 on a desktop, 5 on a phone). Fade with distance
*relative to the reach*, not an absolute metre count.

### 7. Camera presets, and the portrait problem

Ship named shots (`site`, `unit`, `overview`, one per subsystem) as
`{t:[x,y,z], yaw, pitch, dist}`, and drive them through the same spring the
user's own orbit uses, so pressing a preset is a move and not a cut.

Two things that always bite:

**Fitting.** `dist = halfExtent / tan(fov/2)` fits *vertically*. Anything wider
than it is tall needs the aspect too, or a phone frames two items out of seven:

```js
let dist = shot.dist;
if (shot.w) dist = Math.max(dist, shot.w / (0.32 * Math.max(0.35, aspect)));
```

**Composition.** A subject that is 190 m wide and 15 m tall *cannot* be shown
broadside on an upright phone. Give such presets a second composition used when
`aspect < 1` — stand at the end of the row and look along it, so the subject
recedes up the frame and uses the tall dimension the device actually has:

```js
{ key:'farm', t:[-6,13,-46], yaw: Math.PI, pitch:0.20, dist: fit(66), w: 94,
  port: { t:[-14,9,-46], yaw:-1.38, pitch:0.42, dist: fit(92), w: 0 } }
```

**And a preset that frames a tier must raise that tier** before it moves, or it
is a beautifully composed shot of nothing.

### 8. The adaptive watchdog, in the right order

Sample fps over ~0.5 s and step **one** lever, with a gap between the down and
up thresholds so it cannot oscillate:

```
detail  down  (far clutter goes first — it is the most triangles, least meaning)
tracers down
resolution down   (blurring the picture costs the viewer the most — do it last)
```

and climb back in reverse. Tell the viewer, quietly, in a corner: *"Site detail
reduced — it goes back up on its own when the frames come back."* A picture
that silently got worse is a bug report.

### 9. Picking

Render an id buffer (object index as an RGB colour) to an offscreen target at
low resolution and `readPixels` one pixel under the pointer. It is exact, it
costs one extra draw only on click, and it needs no ray-mesh maths. Give the
selected object a real highlight — an emissive tint *and* a rim, not a 10%
brightness change, which reads as a rendering glitch rather than a selection.

### 10. Verify the camera numerically, not by squinting

You will guess a camera azimuth wrong three times in a row and burn an hour on
screenshots. Instead expose the GL handle behind a temporary hook, then ask the
page where things land:

```js
for (let i = 0; i < 12; i++) {
  cam.yaw = -Math.PI + i * (Math.PI/6);
  await frame();
  console.log(i, Object.fromEntries(KEYS.map(k =>
    [k, (s => s ? `${s.x|0},${s.y|0} d${s.d|0}` : 'off')(gl.toScreen(anchors[k]))])));
}
```

The row where your subjects are spread across the frame at a *shorter* depth
than the thing that was hiding them is the shot. Read that table, then set the
preset once. (Also: if the headless renderer is slow, the watchdog will strip
detail before your screenshot and you will misread an empty scene as a framing
bug. Pin the detail level in the probe.)

---

## Build it in this order

1. `glmath` + `geometry` + a spinning grey cylinder on screen. Prove the
   context, the resize, and the depth buffer before anything else.
2. Instancing (`ANGLE_instanced_arrays`), one draw call per mesh group.
3. Lighting: key, fill, rim, a back light, distance fog, and a cheap
   ground-contact darkening. This is where it stops looking like a toy.
4. `kit.js`, then `plant.js`. Build the real plot plan.
5. Picking + selection + the information panel.
6. Camera presets, then the overlay labels.
7. Tiers, idle-skip, the lite program, the watchdog.
8. The phone pass: portrait compositions, touch (one finger orbits, two pinch),
   `maxDpr` cap, label caps.

Commit at each step. Step 7 is much harder to add later than to design in.

---

## Done means

- [ ] Every camera preset, on ⟨desktop⟩ and ⟨phone⟩ widths, in both themes:
      no page errors, no label outside the canvas, subject actually framed.
- [ ] Toggling detail to the lowest tier leaves no label pointing at nothing.
- [ ] Idle scene with the animation paused: rAF work drops to ~0.
- [ ] Every pickable object has an information record; no pick id is orphaned.
- [ ] Nothing below the ground plane, nothing floating above it.
- [ ] A failed ⟨model run⟩ shows as a failure, not as a pretty steady state.
- [ ] The whole thing still builds, still passes the existing test suite, and
      still deploys.

Write a test that walks every camera preset and every pick id in a headless
browser. It is thirty lines and it catches the entire class of "I moved a
vessel and forgot its label".
