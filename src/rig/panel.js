/* panel.js — the industrial simulator's controller.
 *
 * Included into the page component's class body by tools/build.py. It owns the
 * bridge between three things that are otherwise independent:
 *
 *   CDU      the simulation engine — numbers, and nothing else
 *   RIGGL    the WebGL scene — geometry, camera, picking, tracers
 *   RIG2D    the process diagram — the same state, drawn flat
 *
 * Nothing here computes a process quantity. Everything displayed comes out of
 * CDU.run(); if there is no result, the page says so rather than drawing a
 * plausible one.
 */

/* ── lifecycle ─────────────────────────────────────────────────────────── */

/** Solve the base case once in the background while the landing page is being
 *  read. It costs a couple of hundred milliseconds of idle time, it makes the
 *  gateway preview show real numbers rather than dashes, and it means the
 *  simulator opens on a result instead of an empty panel. */
_rigPrewarm() {
  if (this._warm || this.state.view !== 'landing') return;
  this._warm = true;
  setTimeout(() => {
    if (this.state.rig.r) return;
    let r = null;
    try { r = CDU.run(this.state.rig.in); } catch (e) { return; }
    if (!r || !r.ok) return;
    this.setRig({ r: r, status: r.warns.length ? 'warning' : 'complete',
                  warns: r.warns, errs: [], dirty: false });
  }, 700);
}

/** Build the scene the first time the page is shown, and tear it down when it
 *  is left. Called from _afterRender, so it runs after the canvas exists. */
_rigMount() {
  const on = this.state.view === 'rig';
  if (!on) { this._rigUnmount(); this._rigPrewarm(); return; }
  const cv = document.getElementById('rig-gl');
  if (!cv || cv._dxBound) { return; }
  cv._dxBound = true;
  let gl = null;
  try {
    this._plant = PLANT.build();
    gl = RIGGL.create(cv, this._plant, { maxDpr: 2 });
  } catch (err) {
    this._glFail = (err && err.message) || 'WebGL is unavailable';
    this.setRig({ gl3d: false, view: '2d' });
    return;
  }
  this._gl = gl;
  this._cams = RIGINFO.cameras(this._plant);
  this.rigCamTo('plant', true);
  this._bindRigPointer(cv);
  if (this.rigReduced()) { gl.state.flow = false; }
  this._rigApplyResult();
  this._rigLoop();
  // The instrument tags are built from the plant, which did not exist when the
  // page first rendered. One more pass, once, puts them on screen.
  this.setRig({ glReady: true });
}

_rigUnmount() {
  if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  if (this._gl) { try { this._gl.dispose(); } catch (e) {} this._gl = null; }
  const cv = document.getElementById('rig-gl');
  if (cv) cv._dxBound = false;
}

/** The render loop. It never calls setState: everything that changes every
 *  frame — the tag positions, the frame counter — is written straight to the
 *  DOM, so a 60 Hz scene does not drag a virtual DOM behind it. */
_rigLoop() {
  const gl = this._gl;
  if (!gl) return;
  let last = performance.now(), acc = 0, frames = 0;
  const step = (now) => {
    if (!this._gl || this.state.view !== 'rig') { this._raf = 0; return; }
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
    try {
      gl.render(dt);
      this._rigTags();
    } catch (e) { this._raf = 0; return; }
    acc += dt; frames++;
    if (acc >= 0.5) {
      const fps = Math.round(frames / acc);
      const el = document.getElementById('rig-fps');
      if (el) el.textContent = fps + ' fps';
      this._rigAdapt(gl, fps);
      acc = 0; frames = 0;
    }
    this._raf = requestAnimationFrame(step);
  };
  this._raf = requestAnimationFrame(step);
}

/** Hold the frame rate, and say so when holding it costs something.
 *
 *  Two levers, in the order that costs the viewer least: the tracers, which
 *  are decoration, and then the backing-store resolution, which is the only
 *  thing that materially changes shading cost. Both climb back when the
 *  machine can afford them, so a momentary stall is not permanent.
 */
_rigAdapt(gl, fps) {
  const st = gl.state;
  let note = '';
  if (fps < 26 && st.tracers > 0.35 && this.state.rig.flow) {
    st.tracers = 0.3;
  } else if (fps < 22 && st.scale > 0.62) {
    st.scale = Math.max(0.6, st.scale - 0.2);
  } else if (fps > 52 && st.scale < 1) {
    st.scale = Math.min(1, st.scale + 0.2);
  } else if (fps > 55 && st.tracers < 1) {
    st.tracers = 1;
  }
  if (st.scale < 0.99 && st.tracers < 1) note = 'Tracers thinned and resolution reduced to hold the frame rate';
  else if (st.scale < 0.99) note = 'Resolution reduced to hold the frame rate';
  else if (st.tracers < 1) note = 'Tracers thinned to hold the frame rate';
  const w = document.getElementById('rig-degrade');
  if (w) { w.hidden = !note; if (note) w.textContent = note; }
}

/** Pin the instrument tags to the equipment they belong to. Transform only,
 *  so the browser never re-lays-out the overlay. */
_rigTags() {
  const gl = this._gl, P = this._plant;
  if (!gl || !P || !this._tagEls) return;
  // Project every tag, then drop the ones that would land on top of another.
  // Ten tags on a tower this tall overlap from most angles, and a pile of
  // half-legible labels is worse than showing the four that fit.
  // On a narrow viewport a tag is a much larger fraction of the picture, so
  // the clash box grows and the total is capped: four readable tags beat ten
  // that cover the plant.
  const narrow = (window.innerWidth || 1200) < 760;
  const gapY = narrow ? 30 : 21, gapX = narrow ? 150 : 118, cap = narrow ? 4 : 10;
  const shown = [];
  const placed = [];
  for (let i = 0; i < this._tagEls.length; i++) {
    const t = this._tagEls[i];
    if (!t.el || !t.el.isConnected) continue;
    const p = gl.toScreen(t.at);
    if (!p) { t.el.style.opacity = '0'; continue; }
    shown.push({ t: t, p: p });
  }
  shown.sort((a, b) => a.p.d - b.p.d);                  // nearest wins a clash
  for (let i = 0; i < shown.length; i++) {
    const q = shown[i], p = q.p;
    let clash = false;
    for (let j = 0; j < placed.length; j++) {
      if (Math.abs(placed[j].y - p.y) < gapY && Math.abs(placed[j].x - p.x) < gapX) { clash = true; break; }
    }
    if (clash || placed.length >= cap) { q.t.el.style.opacity = '0'; continue; }
    placed.push(p);
    // fade with distance so the far side of the plant does not shout
    q.t.el.style.opacity = String(Math.max(0.34, Math.min(1, 1.25 - p.d * 0.006)));
    q.t.el.style.transform = 'translate3d(' + Math.round(p.x) + 'px,' + Math.round(p.y) + 'px,0)';
  }
}

/** Collect the tag elements once per render pass; they are created by the
 *  template, so this runs after it. */
_rigCollectTags() {
  const P = this._plant;
  if (!P) { this._tagEls = null; return; }
  const out = [];
  const nodes = document.querySelectorAll('[data-rig-tag]');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i], key = el.getAttribute('data-rig-tag');
    const ins = P.instruments.filter(q => q.key === key)[0];
    if (ins) out.push({ el: el, at: ins.at });
  }
  this._tagEls = out;
}

/* ── pointer, wheel, touch and keyboard ────────────────────────────────── */

_bindRigPointer(cv) {
  const gl = this._gl;
  let drag = null, moved = 0, pinch = 0;
  const pos = (e) => {
    const b = cv.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  };
  const touches = (e) => {
    const b = cv.getBoundingClientRect(), t = e.touches;
    return { n: t.length,
             x: (t[0].clientX - b.left), y: (t[0].clientY - b.top),
             d: t.length > 1 ? Math.hypot(t[0].clientX - t[1].clientX,
                                          t[0].clientY - t[1].clientY) : 0 };
  };
  const orbit = (dx, dy) => {
    gl.cam.tYaw   -= dx * 0.006;
    gl.cam.tPitch  = Math.max(-0.28, Math.min(1.10, gl.cam.tPitch + dy * 0.005));
    this._camPreset = '';
    const b = document.querySelector('.rig-cams .on');
    if (b) b.classList.remove('on');
  };
  const zoom = (f) => { gl.cam.tDist = Math.max(18, Math.min(210, gl.cam.tDist * f)); };

  cv.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;                 // handled below
    cv.setPointerCapture(e.pointerId);
    drag = pos(e); moved = 0;
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (drag) {
      orbit(p[0] - drag[0], p[1] - drag[1]);
      moved += Math.abs(p[0] - drag[0]) + Math.abs(p[1] - drag[1]);
      drag = p;
      return;
    }
    if (this._hoverRaf) return;
    this._hoverRaf = requestAnimationFrame(() => {
      this._hoverRaf = 0;
      if (!this._gl) return;
      const k = this._gl.pickAt(p[0], p[1]);
      if (k !== this._gl.state.hov) {
        this._gl.state.hov = k;
        this._gl.refresh();
        cv.style.cursor = k ? 'pointer' : 'grab';
        this._rigHoverChip(k, p[0], p[1]);
      } else if (k) this._rigHoverChip(k, p[0], p[1]);
    });
  });
  const end = (e) => {
    if (!drag) return;
    const wasDrag = moved > 6;
    drag = null;
    if (wasDrag) return;
    const p = pos(e);
    const k = this._gl ? this._gl.pickAt(p[0], p[1]) : null;
    this.rigSelect(k);
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', () => { drag = null; });
  cv.addEventListener('pointerleave', () => {
    drag = null;
    if (this._gl && this._gl.state.hov) { this._gl.state.hov = null; this._gl.refresh(); }
    this._rigHoverChip(null);
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(Math.exp(e.deltaY * 0.0014));
  }, { passive: false });

  // touch: one finger orbits, two pinch, a tap selects
  cv.addEventListener('touchstart', (e) => {
    const t = touches(e);
    drag = [t.x, t.y]; moved = 0; pinch = t.d;
  }, { passive: true });
  cv.addEventListener('touchmove', (e) => {
    const t = touches(e);
    if (t.n > 1 && pinch > 0) {
      zoom(pinch / Math.max(1, t.d));
      pinch = t.d; moved = 99;
      e.preventDefault();
      return;
    }
    if (drag) {
      orbit(t.x - drag[0], t.y - drag[1]);
      moved += Math.abs(t.x - drag[0]) + Math.abs(t.y - drag[1]);
      drag = [t.x, t.y];
      e.preventDefault();
    }
  }, { passive: false });
  cv.addEventListener('touchend', (e) => {
    const wasDrag = moved > 8;
    const at = drag;
    drag = null; pinch = 0;
    if (wasDrag || !at || !this._gl) return;
    this.rigSelect(this._gl.pickAt(at[0], at[1]));
  });

  // keyboard, so the scene is reachable without a pointer
  cv.addEventListener('keydown', (e) => {
    const K = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (K[e.key]) { e.preventDefault(); orbit(K[e.key][0] * 28, K[e.key][1] * 20); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(0.88); }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(1.14); }
    if (e.key === 'Escape') this.rigSelect(null);
  });
  cv.style.cursor = 'grab';
}

/** The floating name that follows the cursor. Written directly: at 60 Hz this
 *  must not go through a render pass. */
_rigHoverChip(key, x, y) {
  const el = document.getElementById('rig-hover');
  if (!el) return;
  if (!key) { el.hidden = true; return; }
  const d = RIGINFO.describe(key);
  if (!d) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = d.name;
  el.style.transform = 'translate3d(' + Math.round(x + 14) + 'px,' + Math.round(y + 14) + 'px,0)';
}

/* ── camera ────────────────────────────────────────────────────────────── */

rigCamTo(key, snap) {
  const gl = this._gl, cams = this._cams;
  if (!gl || !cams) return;
  const c = cams.filter(q => q.key === key)[0] || cams[0];
  gl.cam.tYaw = c.yaw; gl.cam.tPitch = c.pitch; gl.cam.tDist = c.dist;
  gl.cam.ttx = c.t[0]; gl.cam.tty = c.t[1]; gl.cam.ttz = c.t[2];
  if (snap) {
    gl.cam.yaw = c.yaw; gl.cam.pitch = c.pitch; gl.cam.dist = c.dist;
    gl.cam.tx = c.t[0]; gl.cam.ty = c.t[1]; gl.cam.tz = c.t[2];
  }
  this._camPreset = c.key;
}

/* ── selection, shared by both views ───────────────────────────────────── */

rigSelect(key) {
  const rg = this.state.rig;
  const next = (key && key === rg.sel) ? null : (key || null);
  const prod = next && next.indexOf('product-') === 0 ? next.slice(8) : null;
  if (this._gl) {
    this._gl.state.sel = next;
    this._gl.state.product = prod;
    this._gl.refresh();
  }
  if (next) this.rigCamTo(RIGINFO.FOCUS[next] || this._camPreset || 'plant');
  this.setRig({ sel: next, prod: prod, tour: -1 });
  this.rigTourStop();
}

rigProduct(key) {
  const rg = this.state.rig;
  const next = key === rg.prod ? null : key;
  if (this._gl) { this._gl.state.product = next; this._gl.refresh(); }
  this.setRig({ prod: next, sel: next ? 'product-' + next : null });
  if (next) this.rigCamTo(RIGINFO.FOCUS['product-' + next] || 'plant');
}

/* ── guided tour ───────────────────────────────────────────────────────── */

/** Leaving the page: drop the history entry, stop the tour, release the GL
 *  context on the next render pass. */
leaveRig() {
  this.pushRoute(false);
  this.rigTourStop();
  this.setState({ view: 'landing' });
  this.toTop();
}

rigTourStop() { if (this._tour) { clearTimeout(this._tour); this._tour = null; } }

rigTourGo(i) {
  this.rigTourStop();
  const T = RIGINFO.TOUR;
  if (i < 0 || i >= T.length) { this.setRig({ tour: -1 }); return; }
  const stop = T[i];
  if (this._gl) {
    this._gl.state.sel = stop.sel;
    this._gl.state.product = null;
    this._gl.refresh();
  }
  this.rigCamTo(stop.cam);
  this.setRig({ tour: i, sel: stop.sel, prod: null });
  this._tour = setTimeout(() => this.rigTourGo(i + 1), 8200);
}

/* ── the run ───────────────────────────────────────────────────────────
 * Three painted states, each of which corresponds to work that is genuinely
 * happening: CALCULATING while the charge is characterised and flashed,
 * CONVERGING while the stage cascade iterates, then the outcome. The status
 * never claims convergence the solver did not report.
 */

rigRun() {
  const rg = this.state.rig;
  if (rg.status === 'calculating' || rg.status === 'converging') return;
  const v = CDU.validate(rg.in);
  if (!v.ok) {
    this.setRig({ status: 'error', errs: v.errs, warns: [], r: null, dirty: false });
    return;
  }
  this.setRig({ status: 'calculating', errs: [], warns: [] });
  // one painted frame, then the feed half of the calculation
  this._rigStep1 = setTimeout(() => {
    let fp = null;
    try { fp = CDU.feedPhase(rg.in); } catch (e) { fp = null; }
    if (!fp || !fp.ok) { this.setRig({ status: 'error', errs: (fp && fp.errs) || [{ msg: 'The feed could not be characterised.' }] }); return; }
    this.setRig({ status: 'converging', pre: fp });
    // one more painted frame, then the cascade
    this._rigStep2 = setTimeout(() => this._rigSolve(), 32);
  }, 32);
}

_rigSolve() {
  const rg = this.state.rig;
  let r = null, thrown = null;
  try { r = CDU.run(rg.in); }
  catch (e) { thrown = (e && e.message) || String(e); }
  if (thrown || !r || !r.ok) {
    this.setRig({
      status: 'error', r: null, pre: null,
      errs: (r && r.errs) || [{ msg: thrown || 'The solver could not produce a result for these inputs.' }],
      warns: (r && r.warns) || [], dirty: false
    });
    if (this._gl) { this._gl.setFlow({}); this._gl.state.thermal = null; }
    return;
  }
  const hist = [{
    at: new Date().toISOString().slice(11, 19),
    assay: rg.in.assay, furnaceT: rg.in.furnaceT, reflux: rg.in.reflux,
    feedRate: rg.in.feedRate,
    conv: r.converged, outer: r.outer, ms: Math.round(r.ms),
    yield: r.products.filter(p => p.key !== 'residue')
                     .reduce((a, p) => a + p.pct, 0),
    snap: Object.assign({}, rg.in)
  }].concat(this.state.rig.hist || []).slice(0, 8);
  this.setRig({
    status: r.warns.length ? 'warning' : 'complete',
    r: r, pre: null, errs: [], warns: r.warns, hist: hist, dirty: false
  });
  this._rigApplyResult(r);
}

/** Push a result into the scene: tracer density and speed, thermal ramp. This
 *  is the only place the visualisation learns anything about the process. */
_rigApplyResult(res) {
  const gl = this._gl;
  if (!gl) return;
  const r = res || this.state.rig.r;
  if (!r) { gl.setFlow({}); gl.state.thermal = null; return; }
  const ref = r.feed.mass, spec = {};
  const put = (key, tph, col) => {
    if (!(tph > 0)) { spec[key] = { n: 0 }; return; }
    const f = tph / Math.max(1e-6, ref);
    spec[key] = {
      n: Math.max(2, Math.round(6 + 46 * Math.pow(f, 0.55))),
      speed: 0.05 + 0.28 * Math.pow(f, 0.35),
      size: 0.7 + 0.8 * Math.pow(f, 0.3),
      col: col
    };
  };
  const S = PLANT.STREAM;
  put('crude', r.feed.mass, S.crude);
  put('feed', r.feed.mass, S.hot);
  const ov = r.products.filter(p => p.key === 'gas' || p.key === 'naphtha')
                       .reduce((a, p) => a + p.mass, 0);
  put('overhead', ov, S.vapour);
  put('reflux', r.internals.Ltop * r.feed.M / 1000, S.reflux);
  put('steam', r.steam.mass, S.steam);
  for (let i = 0; i < r.products.length; i++) {
    const p = r.products[i];
    put(p.key, p.mass, S[p.key] || S.crude);
  }
  gl.setFlow(spec);

  // thermal mode paints the shell from the solved profile, by height
  const P = this._plant;
  const Ttop = r.internals.Tprofile.length > 1 ? r.internals.Tprofile[1] : r.energy.Ttop;
  const Tbot = r.energy.Tbot;
  const y0 = P.skirtTop, y1 = P.shellTop;
  gl.state.thermal = this.state.rig.mode === 'thermal'
    ? (y) => {
        const f = Math.max(0, Math.min(1, (y - y0) / Math.max(1e-6, y1 - y0)));
        const T = Tbot + (Ttop - Tbot) * f;
        return this.rigHeatRGB(T);
      }
    : null;
  gl.refresh();
}

/** The thermal ramp, as linear-space RGB for the shader. Same stops as the 2D
 *  view uses, so a colour means one temperature in both. */
rigHeatRGB(T) {
  const css = RIG2D.heat(T, 30, 380);
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(css);
  if (!m) return [0.6, 0.6, 0.6];
  const g = (v) => Math.pow(v / 255, 2.2);
  return [g(+m[1]), g(+m[2]), g(+m[3])];
}

/* ── operator input ────────────────────────────────────────────────────── */

rigSet(k, raw) {
  const L = CDU.LIMITS[k];
  let v = raw;
  if (L) {
    v = parseFloat(raw);
    if (!isFinite(v)) v = this.state.rig.in[k];
    if (L.int) v = Math.round(v);
  }
  const nin = Object.assign({}, this.state.rig.in, { [k]: v });
  this.setRig({ in: nin, dirty: true });
}

rigReset() {
  this.rigTourStop();
  if (this._gl) { this._gl.setFlow({}); this._gl.state.thermal = null; this._gl.state.sel = null; this._gl.state.product = null; this._gl.refresh(); }
  this.setRig({ in: CDU.baseCase(), r: null, pre: null, status: 'ready',
                errs: [], warns: [], sel: null, prod: null, tour: -1, dirty: false });
}

rigLoadCase(snap) {
  this.setRig({ in: Object.assign({}, snap), dirty: true });
}

rigSave() {
  try {
    const rg = this.state.rig;
    const doc = { app: 'DISTILLEX', kind: 'crude-unit-case', version: 1,
                  saved: new Date().toISOString(), inputs: rg.in };
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)],
                { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'distillex-crude-case.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    this.flash('Operating case saved');
  } catch (e) { this.flash('Could not save the case in this browser'); }
}

rigLoad(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const o = JSON.parse(rd.result);
      const src = (o && o.inputs) || o;
      const base = CDU.baseCase(), clean = {};
      for (const k in base) if (base.hasOwnProperty(k))
        clean[k] = (src && src[k] !== undefined) ? src[k] : base[k];
      const v = CDU.validate(clean);
      this.setRig({ in: clean, dirty: true, status: 'ready', r: null, errs: [], warns: [] });
      this.flash(v.ok ? 'Operating case loaded'
                      : 'Case loaded, but ' + v.errs.length + ' value(s) are outside their range');
    } catch (err) { this.flash('Could not read that file — expected a DISTILLEX case'); }
  };
  rd.readAsText(f);
  e.target.value = '';
}
