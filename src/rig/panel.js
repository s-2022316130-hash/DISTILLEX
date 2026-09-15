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
/** Keep the scene's lighting in step with the application's theme switch.
 *  Called on every render pass; it only does work when the theme actually
 *  changed, so it costs a string comparison the rest of the time. */
_rigTheme() {
  const want = this.state.theme === 'light' ? 'light' : 'dark';
  if (this._themeNow === want) return false;
  this._themeNow = want;
  THEME.set(want);
  if (this._gl) this._gl.setTheme(want);
  if (this._heroGl) this._heroGl.setTheme(want);
  if (this._crudeGl) { this._crudeGl.setTheme(want); this._crudeDirty = true; this._crudeLoop(); }
  return true;
}

_rigMount() {
  const on = this.state.view === 'rig';
  if (!on) { this._rigUnmount(); this._rigPrewarm(); return; }
  const cv = document.getElementById('rig-gl');
  if (!cv || cv._dxBound) { return; }
  cv._dxBound = true;
  let gl = null;
  const mode = this.state.theme === 'light' ? 'light' : 'dark';
  THEME.set(mode);
  this._themeNow = mode;
  try {
    // The surroundings are most of the triangles and none of the process, so
    // a small screen gets the unit and not the site it stands on.
    this._plant = PLANT.build({ site: (window.innerWidth || 1200) >= 820 });
    gl = RIGGL.create(cv, this._plant, { maxDpr: 2, theme: mode });
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

/** Show the scene on its own.
 *
 *  Two things happen, and either can work without the other. The class lays
 *  the page out with the rails gone and the bar floating over the stage; the
 *  Fullscreen API asks the browser to drop its own chrome as well. The request
 *  can be refused — an iframe without the permission, a browser that does not
 *  do it — so the class is what is relied on and the API is a bonus.
 *
 *  The canvas is sized from its client box every frame, so nothing has to be
 *  told the viewport changed. */
rigFullToggle() {
  const want = !this.state.rig.full;
  this.setRig({ full: want });
  const el = document.getElementById('rig-root');
  try {
    if (want) {
      if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el && el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } catch (e) { /* the layout does not depend on it */ }
  if (!this._rigFsBound) {
    this._rigFsBound = true;
    // Leaving fullscreen by Escape or by the browser's own control has to put
    // the layout back, or the rails stay hidden with no way to bring them back.
    const sync = () => {
      const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!on && this.state.rig.full) this.setRig({ full: false });
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state.rig.full &&
          !document.fullscreenElement && !document.webkitFullscreenElement) {
        this.setRig({ full: false });
      }
    });
  }
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
  if (st.scale < 0.99 && st.tracers < 1) note = 'Tracers + resolution reduced';
  else if (st.scale < 0.99) note = 'Resolution reduced';
  else if (st.tracers < 1) note = 'Tracers thinned';
  const w = document.getElementById('rig-degrade');
  if (w) {
    w.hidden = !note;
    if (note) {
      w.textContent = note;
      w.title = 'This machine could not hold a usable frame rate at full quality, so the '
              + 'scene is being drawn with ' + note.toLowerCase()
              + '. It goes back up on its own when the frames come back.';
    }
  }
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
    // Picking renders the id buffer and reads a pixel back, which stalls the
    // pipeline. Once per animation frame is far more often than a pointer
    // needs; cap it by wall clock so a fast mouse cannot starve the scene.
    if (this._hoverRaf) return;
    const now = performance.now();
    if (now - (this._hoverAt || 0) < 70) return;
    this._hoverAt = now;
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

/** Look at one stage. The cascade index is mapped onto the shell by the same
 *  fractions the solver uses — the condenser sits above the head, the flash
 *  zone at the feed elevation, the sump in the skirt — so the camera lands on
 *  the tray the row names rather than on a tray-shaped guess. */
rigStage(j) {
  const rg = this.state.rig, r = rg.r, P = this._plant;
  if (!r || !P) return;
  const n = r.internals.Tprofile.length;
  const iFeed = r.internals.feedStage;
  let y;
  if (j === 0) y = P.shellTop + 2;                       // the condenser
  else if (j >= iFeed) {
    const f = (j - iFeed) / Math.max(1, n - 1 - iFeed);
    y = P.feedY - (P.feedY - P.skirtTop + 1) * f;        // flash zone down to the sump
  } else {
    const f = (j - 1) / Math.max(1, iFeed - 1);
    y = P.shellTop - 3 - (P.shellTop - 3 - P.feedY) * f; // top tray down to the flash zone
  }
  const same = rg.stage === j;
  if (this._gl) {
    this._gl.state.sel = same ? null : 'trays';
    this._gl.state.product = null;
    this._gl.refresh();
    const cam = this._gl.cam;
    cam.tYaw = 0.62; cam.tPitch = 0.02;                  // the cutaway azimuth
    cam.tDist = 34; cam.ttx = 0; cam.tty = y; cam.ttz = 0;
    this._camPreset = '';
  }
  this.rigTourStop();
  this.setRig({ stage: same ? -1 : j, sel: same ? null : 'trays', prod: null, tour: -1 });
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

/* ── the hero model ───────────────────────────────────────────────────────
   The landing page's column, mounted on the same renderer as the crude unit.

   Three things keep it cheap enough to sit at the top of a marketing page:
   it only runs while it is actually on screen, it only exists on the landing
   view, and under prefers-reduced-motion it draws exactly one frame and then
   stops. The canvas stays invisible until that first frame lands, so a
   machine without WebGL keeps the drawing it already had.
   ══════════════════════════════════════════════════════════════════════ */

_heroMount() {
  if (this.state.view !== 'landing') { this._heroUnmount(); return; }
  const cv = document.getElementById('hero-gl');
  if (!cv || cv._dxBound || this._heroFailed) return;
  cv._dxBound = true;
  const mode = this.state.theme === 'light' ? 'light' : 'dark';
  let gl = null;
  try {
    THEME.set(mode);
    this._heroPlant = COL3D.build({ lite: (window.innerWidth || 1200) < 700 });
    // The hero is a picture, not an instrument: a slightly softer edge costs
    // nothing, and a backing store at full retina density is the single most
    // expensive thing on the landing page.
    gl = RIGGL.create(cv, this._heroPlant, { maxDpr: 1.6, theme: mode, calm: true });
  } catch (err) { gl = null; }
  if (!gl || gl.error || !gl.render) { this._heroFailed = true; cv._dxBound = false; return; }
  this._heroGl = gl;
  const h = this._heroPlant.home;
  gl.cam.tYaw = gl.cam.yaw = h.yaw;
  gl.cam.tPitch = gl.cam.pitch = h.pitch;
  gl.cam.tDist = gl.cam.dist = h.dist;
  gl.cam.ttx = gl.cam.tx = h.target[0];
  gl.cam.tty = gl.cam.ty = h.target[1];
  gl.cam.ttz = gl.cam.tz = h.target[2];
  // The traffic. Counts are small on purpose: this is a hero, and a hundred
  // and thirty sparks read as a working unit where six hundred read as noise.
  gl.setFlow({
    feed:    { n: 10, speed: 0.080, size: 0.90 },
    ovhd:    { n: 12, speed: 0.130, size: 0.90 },
    cond:    { n:  6, speed: 0.100, size: 0.80 },
    reflux:  { n: 10, speed: 0.090, size: 0.80 },
    dist:    { n:  6, speed: 0.090, size: 0.80 },
    cw:      { n:  5, speed: 0.110, size: 0.70 },
    steam:   { n:  5, speed: 0.120, size: 0.70 },
    rebdown: { n:  8, speed: 0.080, size: 0.80 },
    rebup:   { n: 10, speed: 0.110, size: 0.90 },
    btms:    { n:  8, speed: 0.070, size: 0.80 },
    vup:     { n: 26, speed: 0.055, size: 0.75 },
    ldn:     { n: 22, speed: 0.050, size: 0.65 }
  });
  this._heroYaw = h.yaw;
  this._heroSeen = true;
  // Only run while the stage is on screen. A hero that keeps a GPU busy after
  // the reader has scrolled past it is the whole cost with none of the point.
  if (typeof IntersectionObserver !== 'undefined' && !this._heroIo) {
    this._heroIo = new IntersectionObserver((rows) => {
      for (const row of rows) this._heroSeen = row.isIntersecting;
      if (this._heroSeen) this._heroLoop();
    }, { threshold: 0.02 });
  }
  const stage = document.getElementById('hero-stage');
  if (this._heroIo && stage) this._heroIo.observe(stage);
  if (this._calm()) {
    // one frame, held: the model is still worth seeing, the motion is not
    gl.state.flow = false;
    try { gl.render(1 / 60); } catch (e) { this._heroFailed = true; return; }
    if (stage) stage.classList.add('dx-hero-3d');
    return;
  }
  this._heroLoop();
}

_heroUnmount() {
  if (this._heroRaf) { cancelAnimationFrame(this._heroRaf); this._heroRaf = 0; }
  if (this._heroGl) { try { this._heroGl.dispose(); } catch (e) {} this._heroGl = null; }
  if (this._heroIo) { try { this._heroIo.disconnect(); } catch (e) {} this._heroIo = null; }
  const cv = document.getElementById('hero-gl');
  if (cv) cv._dxBound = false;
  this._heroPlant = null;
  this._heroFirst = false;
}

/** A turntable, not a spin. The camera sweeps through a little under a
 *  half-turn and comes back, so the sectioned face is never off screen for
 *  long, and it eases at each end instead of reversing on the spot — which is
 *  how a CAD viewer behaves when someone is turning a part over in their
 *  hands, and why it reads as an assembly rather than as a logo. */
_heroLoop() {
  const gl = this._heroGl;
  if (!gl || this._heroRaf) return;
  const home = this._heroPlant.home;
  let last = performance.now(), acc = 0, frames = 0, phase = 0, stall = 0;
  const step = (now) => {
    this._heroRaf = 0;
    if (!this._heroGl || this.state.view !== 'landing') return;
    if (!this._heroSeen) return;                       // resumes on re-entry
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;
    phase += dt * 0.135;
    const sw = Math.sin(phase);
    gl.cam.tYaw = home.yaw + sw * 0.95;
    gl.cam.tPitch = home.pitch + Math.sin(phase * 0.63) * 0.085;
    // the dolly only ever pulls BACK from the framing distance: moving in
    // would crop the condenser off the top of a 6:5 box
    gl.cam.tDist = home.dist + (1 - Math.cos(phase * 0.47)) * 2.6;
    try { gl.render(dt); } catch (e) { this._heroFailed = true; return; }
    if (this._heroFirst !== true) {
      this._heroFirst = true;
      const stage = document.getElementById('hero-stage');
      if (stage) stage.classList.add('dx-hero-3d');
    }
    // The same watchdog the rig uses, with the same two levers, so a slow
    // machine gets a hero that still moves rather than one that stutters.
    acc += dt; frames++;
    if (acc >= 0.7) {
      const fps = frames / acc;
      const st = gl.state;
      // It gives ground earlier than the rig does. Nobody came to the landing
      // page for the hero, so it is the first thing that should get out of the
      // way when the machine is struggling.
      if (fps < 34 && st.scale > 0.62) st.scale = Math.max(0.6, st.scale - 0.2);
      else if (fps < 26 && st.tracers > 0.35) st.tracers = 0.3;
      else if (fps > 55 && st.scale < 1) st.scale = Math.min(1, st.scale + 0.2);
      else if (fps > 58 && st.tracers < 1) st.tracers = 1;
      // The floor under the floor. If the machine still cannot hold frames at
      // the lowest quality the watchdog can ask for, the honest answer is to
      // stop moving: the model is the point, the turntable is not, and a hero
      // stuttering at fifteen frames is worse than one that sits still.
      if (fps < 20 && st.scale <= 0.62 && st.tracers <= 0.35) {
        if (++stall >= 2) { st.flow = false; try { gl.render(1 / 60); } catch (e) {} return; }
      } else stall = 0;
      acc = 0; frames = 0;
    }
    this._heroRaf = requestAnimationFrame(step);
  };
  this._heroRaf = requestAnimationFrame(step);
}

/* ── the crude tower on the landing page ──────────────────────────────────
   Same renderer again, with two things the hero does not need: the assembly
   comes apart, and the eight cuts are selectable.

   Exploding is a translation per object, so it interpolates — the view button
   moves a single number between 0 and 1 and every piece, every draw line and
   every label follows it. Selection goes through the renderer's own id buffer,
   so a pointer anywhere on a section names the same cut the label does, and
   the panel beside the model reads it.
   ══════════════════════════════════════════════════════════════════════ */

_crudeMount() {
  if (this.state.view !== 'landing') { this._crudeUnmount(); return; }
  const cv = document.getElementById('crude-gl');
  if (!cv || cv._dxBound || this._crudeFailed) return;
  cv._dxBound = true;
  const mode = this.state.theme === 'light' ? 'light' : 'dark';
  let gl = null;
  try {
    THEME.set(mode);
    this._crudePlant = CRUDE3D.build({ lite: (window.innerWidth || 1200) < 700 });
    gl = RIGGL.create(cv, this._crudePlant, { maxDpr: 1.6, theme: mode, calm: true });
  } catch (err) { gl = null; }
  if (!gl || gl.error || !gl.render) { this._crudeFailed = true; cv._dxBound = false; return; }
  this._crudeGl = gl;
  const P = this._crudePlant, h = P.home;
  gl.cam.tYaw = gl.cam.yaw = h.yaw;
  gl.cam.tPitch = gl.cam.pitch = h.pitch;
  gl.cam.tDist = gl.cam.dist = h.dist;
  gl.cam.ttx = gl.cam.tx = h.target[0];
  gl.cam.tty = gl.cam.ty = h.target[1];
  gl.cam.ttz = gl.cam.tz = h.target[2];
  const draws = {};
  for (const c of P.cuts) draws['draw-' + c.k] = { n: 5, speed: 0.09, size: 0.80 };
  gl.setFlow(Object.assign({
    crude:    { n: 10, speed: 0.080, size: 0.90 },
    transfer: { n: 14, speed: 0.110, size: 1.00 },
    ovhd:     { n: 12, speed: 0.130, size: 0.90 },
    gasout:   { n:  6, speed: 0.100, size: 0.80 },
    btms:     { n:  8, speed: 0.070, size: 0.90 },
    steam:    { n:  6, speed: 0.120, size: 0.70 },
    vup:      { n: 30, speed: 0.060, size: 0.80 }
  }, draws));
  this._crudeT = this.state.crudeView === 'exploded' ? 1 : 0;
  CRUDE3D.apply(P, this._crudeT);
  gl.remap();
  this._crudeSeen = true;
  this._crudeDirty = true;
  if (typeof IntersectionObserver !== 'undefined' && !this._crudeIo) {
    this._crudeIo = new IntersectionObserver((rows) => {
      for (const row of rows) this._crudeSeen = row.isIntersecting;
      if (this._crudeSeen) { this._crudeDirty = true; this._crudeLoop(); }
    }, { threshold: 0.02 });
  }
  const stage = document.getElementById('crude-stage');
  if (this._crudeIo && stage) this._crudeIo.observe(stage);
  this._bindCrudePointer(cv);
  this._crudeLoop();
}

_crudeUnmount() {
  if (this._crudeRaf) { cancelAnimationFrame(this._crudeRaf); this._crudeRaf = 0; }
  if (this._crudeGl) { try { this._crudeGl.dispose(); } catch (e) {} this._crudeGl = null; }
  if (this._crudeIo) { try { this._crudeIo.disconnect(); } catch (e) {} this._crudeIo = null; }
  const cv = document.getElementById('crude-gl');
  if (cv) cv._dxBound = false;
  this._crudePlant = null;
  this._crudeFirst = false;
  this._crudeMeasW = -1;
}

/** Pointing at the model names a cut, exactly as pointing at its label does.
 *  The id buffer is read on move, which is one pixel per event. */
_bindCrudePointer(cv) {
  if (cv._dxPtr) return;
  cv._dxPtr = true;
  const hit = (e) => {
    const gl = this._crudeGl;
    if (!gl) return null;
    const r = cv.getBoundingClientRect();
    return gl.pickAt(e.clientX - r.left, e.clientY - r.top);
  };
  const keys = {};
  for (const c of CRUDE3D.CUTS) keys[c.k] = 1;
  cv.addEventListener('pointermove', (e) => {
    const k = hit(e);
    const want = (k && keys[k]) ? k : null;
    if (want !== this.state.crudeHover) this.setState({ crudeHover: want });
  });
  cv.addEventListener('click', (e) => {
    const k = hit(e);
    if (k && keys[k]) this.setState({ crudeHover: this.state.crudeHover === k ? null : k });
  });
}

_crudeLoop() {
  const gl = this._crudeGl;
  if (!gl || this._crudeRaf) return;
  const P = this._crudePlant, h = P.home;
  let last = performance.now(), phase = 0, selNow = null, acc = 0, frames = 0, stall = 0, still = false;
  const calm = this._calm();
  const step = (now) => {
    this._crudeRaf = 0;
    if (!this._crudeGl || this.state.view !== 'landing') return;
    if (!this._crudeSeen) return;
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60;

    // the assembly opens and closes on one number
    const want = this.state.crudeView === 'exploded' ? 1 : 0;
    const prev = this._crudeT;
    this._crudeT = calm ? want
                        : prev + (want - prev) * (1 - Math.exp(-dt * 3.0));
    if (Math.abs(want - this._crudeT) < 0.0015) this._crudeT = want;
    if (this._crudeT !== prev) {
      CRUDE3D.apply(P, this._crudeT);
      gl.remap();
      this._crudeDirty = true;
    }
    // the camera pulls back as it opens, because the assembly gets bigger
    const t = this._crudeT;
    const dist = h.dist + (P.explodedDist - h.dist) * t;
    const ty = h.target[1] + (P.explodedTarget[1] - h.target[1]) * t;
    if (!calm && !still) {
      phase += dt * 0.115;
      gl.cam.tYaw = h.yaw + Math.sin(phase) * 0.62;
      gl.cam.tPitch = h.pitch + Math.sin(phase * 0.58) * 0.055;
      this._crudeDirty = true;
    }
    gl.cam.tDist = dist;
    gl.cam.tty = ty;

    // selection, through the renderer's own dim-and-glow path
    const sel = this.state.crudeHover || null;
    if (sel !== selNow) { selNow = sel; gl.state.sel = sel; gl.refresh(); this._crudeDirty = true; }

    if (this._crudeDirty) {
      try { gl.render(dt); } catch (e) { this._crudeFailed = true; return; }
      this._crudeTags();
      if (this._crudeFirst !== true) {
        this._crudeFirst = true;
        const stage = document.getElementById('crude-stage');
        if (stage) stage.classList.add('dx-crude-3d');
      }
      if (calm || still) this._crudeDirty = false;   // one frame, then hold it
      // the same watchdog the hero runs, for the same reason: this is a
      // picture on a landing page, and it should be the first thing to give
      // ground when the machine cannot hold a frame
      acc += dt; frames++;
      if (acc >= 0.7) {
        const fps = frames / acc, st = gl.state;
        if (fps < 34 && st.scale > 0.62) st.scale = Math.max(0.6, st.scale - 0.2);
        else if (fps < 26 && st.tracers > 0.35) st.tracers = 0.3;
        else if (fps > 55 && st.scale < 1) st.scale = Math.min(1, st.scale + 0.2);
        else if (fps > 58 && st.tracers < 1) st.tracers = 1;
        // As in the hero: once the quality levers are spent, stop the idle
        // motion rather than stutter. The view button still works — opening
        // and closing the assembly marks the scene dirty, which is the only
        // thing that draws from here on.
        if (fps < 20 && st.scale <= 0.62 && st.tracers <= 0.35) {
          if (++stall >= 2) { still = true; st.flow = false; }
        } else stall = 0;
        acc = 0; frames = 0;
      }
    }
    this._crudeRaf = requestAnimationFrame(step);
  };
  this._crudeRaf = requestAnimationFrame(step);
}

/** Pin each label to the end of its own transfer line. Transform only, so
 *  eight labels moving every frame never trigger a layout. */
_crudeTags() {
  const gl = this._crudeGl, P = this._crudePlant;
  if (!gl || !P) return;
  const wrap = document.getElementById('crude-stage');
  if (!wrap) return;
  const els = wrap.querySelectorAll('.dx-ctag');
  if (!els.length) return;
  const cv = document.getElementById('crude-gl');
  const W = cv ? cv.clientWidth : 0, H = cv ? cv.clientHeight : 0;

  // Project everything first. A label that has swung behind the tower is
  // faded, not moved: leaving it where it belongs is what keeps it attached
  // to its own nozzle.
  // offsetWidth forces the browser to flush layout. Eight of those a frame is
  // a synchronous layout per label per frame, for boxes whose text never
  // changes — so they are measured once, and again only when the stage
  // resizes, which is the only thing that can change them.
  if (this._crudeMeasW !== W) {
    this._crudeMeasW = W;
    for (let i = 0; i < els.length; i++) {
      els[i]._dxW = els[i].offsetWidth || 90;
      els[i]._dxH = els[i].offsetHeight || 24;
    }
  }
  const rows = [];
  for (let i = 0; i < els.length; i++) {
    const el = els[i], L = P.labels[i];
    if (!L) { el.style.opacity = '0'; continue; }
    const p = gl.toScreen(L.now || L.at);
    if (!p) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; continue; }
    rows.push({ el: el, p: p, w: el._dxW, h: el._dxH, y: p.y - el._dxH / 2 });
  }

  // Then spread them. Eight draws off one tower project within thirty pixels
  // of each other, and two labels thirty pixels apart are two touch targets
  // that overlap — the tap lands on the neighbour. Pushing them to at least a
  // finger apart is what makes each one its own target, and it reads better.
  const MIN = 44;
  rows.sort((a, b) => a.y - b.y);
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].y - rows[i - 1].y;
    if (gap < MIN) rows[i].y = rows[i - 1].y + MIN;
  }
  // If that pushed the stack off the bottom, walk it back up from the end.
  // PAD keeps the bottom label's own touch extension inside the stage, which
  // is what the browser will hit-test against.
  const PAD = 12;
  const over = rows.length ? (rows[rows.length - 1].y + rows[rows.length - 1].h + PAD) - H : 0;
  if (over > 0) {
    for (let i = rows.length - 1; i >= 0; i--) {
      rows[i].y -= over;
      if (i > 0 && rows[i].y - rows[i - 1].y >= MIN) break;
    }
  }
  for (const r of rows) {
    const x = Math.max(0, Math.min(W - r.w, r.p.x + 6));
    const y = Math.max(PAD, Math.min(H - r.h - PAD, r.y));
    r.el.style.transform = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
    r.el.style.opacity = String(Math.max(0.42, Math.min(1, 1.35 - r.p.d * 0.0072)));
    r.el.style.pointerEvents = 'auto';
  }
}
