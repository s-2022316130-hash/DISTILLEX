/* ════════════════════════════════════════════════════════════════════════
   A small WebGL renderer for the industrial scene.

   No library. DISTILLEX ships one static file under script-src 'self' with no
   bundler, so a 3D library cannot be loaded, and a renderer written for one
   scene can be a great deal smaller than a general one anyway. This is about
   six hundred lines and does what this scene needs and nothing else:

     · hardware MSAA, and a device-pixel-ratio cap so a 3× phone does not
       render nine times the pixels for no visible gain
     · one draw call per unit mesh through ANGLE_instanced_arrays — the whole
       plant is seven calls — with a non-instanced fallback path
     · a physically-motivated shader: key, fill and rim lights, a roughness
       and metalness pair per instance, distance fog, and a ground-contact
       darkening that stands in for an ambient-occlusion pass
     · picking by rendering instance ids into an offscreen buffer and reading
       one pixel, which is exact at any angle and costs nothing until a
       pointer actually moves
     · a critically-damped spring camera, so it settles rather than easing to
       a halt, and never overshoots
     · flow tracers that follow the pipe polylines the plant was built from,
       at a density and speed the simulation result sets

   Quality is spent where it shows: smooth-shaded silhouettes, clean normals,
   restrained speculars. There is no bloom pass and no shadow map; both cost
   more than they return at this scale, and the brief asks for industrial
   visualisation rather than spectacle.
   ════════════════════════════════════════════════════════════════════════ */
var RIGGL = (function () {
  'use strict';
  var M = GLM;

  var VS = [
    'precision highp float;',
    'attribute vec3 aPos; attribute vec3 aNrm;',
    'attribute vec4 aM0; attribute vec4 aM1; attribute vec4 aM2; attribute vec4 aM3;',
    'attribute vec4 aCol;',          // rgb + roughness
    'attribute vec4 aFx;',           // metal, emissive, dim, unused
    'attribute vec3 aPick;',
    'uniform mat4 uVP; uniform vec3 uEye;',
    'varying vec3 vN; varying vec3 vW; varying vec4 vCol; varying vec4 vFx; varying vec3 vPick;',
    'void main(){',
    '  mat4 m = mat4(aM0,aM1,aM2,aM3);',
    '  vec4 w = m * vec4(aPos,1.0);',
    '  vW = w.xyz;',
    // uniform-ish scale: normalise the rotation columns rather than invert
    '  vec3 sx = vec3(length(m[0].xyz), length(m[1].xyz), length(m[2].xyz));',
    '  mat3 nm = mat3(m[0].xyz/sx.x, m[1].xyz/sx.y, m[2].xyz/sx.z);',
    '  vN = normalize(nm * (aNrm / max(sx, vec3(1e-5))) * sx);',
    '  vCol = aCol; vFx = aFx; vPick = aPick;',
    '  gl_Position = uVP * w;',
    '}'
  ].join('\n');

  var FS = [
    'precision highp float;',
    'varying vec3 vN; varying vec3 vW; varying vec4 vCol; varying vec4 vFx;',
    'uniform vec3 uEye; uniform vec3 uFog; uniform float uFogD;',
    'uniform vec3 uKey; uniform vec3 uKeyC; uniform vec3 uFill; uniform vec3 uRim;',
    'uniform vec3 uBack; uniform vec3 uBackC; uniform vec3 uSkyT; uniform vec3 uSkyH;',
    'uniform float uExpo;',
    'void main(){',
    '  vec3 N = normalize(vN);',
    '  vec3 V = normalize(uEye - vW);',
    '  if (dot(N,V) < 0.0) N = -N;',                 // two-sided: gratings, annuli
    '  float rough = clamp(vCol.a, 0.05, 1.0);',
    '  float metal = clamp(vFx.x, 0.0, 1.0);',
    '  float flag  = vFx.w;',
    '  vec3 base = vCol.rgb;',
    // ── the paved plot. Drawn procedurally from world XZ so the disc has
    //    joints, a stained apron under the plant, and an edge that dissolves
    //    into the fog instead of ending in a hard circle.
    '  if (flag > 0.5) {',
    '    vec2 g = abs(fract(vW.xz / 7.0) - 0.5);',
    '    float joint = 1.0 - smoothstep(0.0, 0.055, min(g.x, g.y));',
    '    float rad = length(vW.xz);',
    '    float apron = 1.0 - smoothstep(12.0, 52.0, rad);',
    '    base = mix(base, base * 1.65, apron * 0.55);',
    '    base = mix(base, base * 0.42, joint * 0.7);',
    '  }',
    '  vec3 L = normalize(uKey);',
    '  float ndl = max(dot(N,L), 0.0);',
    // a wrapped diffuse term: bare Lambert makes a cylinder read as a cutout
    '  float wrap = max((dot(N,L) + 0.35) / 1.35, 0.0);',
    // the sky is the fill: cool from above, warmer near the horizon, which is
    // what actually distinguishes painted steel from insulation outdoors
    '  vec3 sky = mix(uSkyH, uSkyT, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));',
    '  vec3 amb = uFill * (0.72 + 0.28 * N.y) + sky * 0.75;',
    '  float bdl = max(dot(N, normalize(uBack)), 0.0);',
    '  vec3 diff = base * (uKeyC * wrap + amb + uBackC * bdl * 0.42);',
    '  vec3 H = normalize(L + V);',
    '  float shin = mix(18.0, 220.0, 1.0 - rough);',
    '  float spec = pow(max(dot(N,H), 0.0), shin) * (1.0 - rough) * (0.25 + 0.75 * metal);',
    '  vec3 specC = mix(vec3(1.0), base, metal) * spec * ndl * 1.7;',
    // a fresnel-weighted sky reflection, so metal picks the sky up at grazing
    // angles and insulation barely does
    '  float fres = pow(1.0 - max(dot(N,V), 0.0), 4.0);',
    '  vec3 env = sky * fres * (0.10 + 0.90 * metal) * (1.0 - rough * 0.7) * 2.1;',
    '  vec3 rimC = uRim * pow(1.0 - max(dot(N,V), 0.0), 3.2) * (0.22 + 0.50 * metal);',
    // contact darkening near the ground, standing in for occlusion
    '  float ao = clamp(0.56 + 0.44 * smoothstep(0.0, 11.0, vW.y), 0.0, 1.0);',
    '  vec3 col = (diff * ao + specC + env + rimC) * uExpo + base * vFx.y;',
    '  col *= mix(1.0, 0.30, clamp(vFx.z, 0.0, 1.0));',   // de-emphasis
    '  float d = length(uEye - vW);',
    '  float f = 1.0 - exp(-pow(max(d - 46.0, 0.0) * uFogD, 1.30));',
    '  col = mix(col, uFog, clamp(f, 0.0, flag > 0.5 ? 0.94 : 0.62));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  var SKY_VS = [
    'precision highp float;',
    'attribute vec2 aP; varying vec2 vUv;',
    'void main(){ vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.9999, 1.0); }'
  ].join('\n');
  var SKY_FS = [
    'precision highp float;',
    'varying vec2 vUv; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGlow;',
    'void main(){',
    '  float t = pow(clamp(vUv.y, 0.0, 1.0), 1.25);',
    '  vec3 c = mix(uHorizon, uTop, t);',
    // a soft warm pool low and left, where the heater stands
    '  float d = distance(vUv, vec2(0.26, 0.16));',
    '  c += uGlow * exp(-d * d * 9.0) * 0.55;',
    '  float d2 = distance(vUv, vec2(0.78, 0.72));',
    '  c += vec3(0.06, 0.16, 0.26) * exp(-d2 * d2 * 7.0) * 0.5;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var PICK_FS = [
    'precision highp float;',
    'varying vec3 vPick;',
    'void main(){ gl_FragColor = vec4(vPick, 1.0); }'
  ].join('\n');

  var TRACE_VS = [
    'precision highp float;',
    'attribute vec3 aPos; attribute vec4 aCol; attribute float aSize;',
    'uniform mat4 uVP; uniform float uScale;',
    'varying vec4 vCol;',
    'void main(){',
    '  vCol = aCol;',
    '  vec4 c = uVP * vec4(aPos,1.0);',
    '  gl_Position = c;',
    '  gl_PointSize = max(1.5, aSize * uScale / max(c.w, 1.0));',
    '}'
  ].join('\n');
  var TRACE_FS = [
    'precision highp float;',
    'varying vec4 vCol;',
    'void main(){',
    '  vec2 d = gl_PointCoord - vec2(0.5);',
    '  float r = dot(d,d);',
    '  if (r > 0.25) discard;',
    '  float a = smoothstep(0.25, 0.02, r);',
    '  gl_FragColor = vec4(vCol.rgb, vCol.a * a);',
    '}'
  ].join('\n');

  function compile(gl, type, src, name) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(name + ': ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs, name) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, name + '.vert'));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, name + '.frag'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(name + ': ' + gl.getProgramInfoLog(p));
    return p;
  }

  function create(canvas, plant, opts) {
    opts = opts || {};
    var gl = canvas.getContext('webgl', {
      antialias: true, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false
    }) || canvas.getContext('experimental-webgl', { antialias: true, alpha: false });
    if (!gl) return null;

    var inst = gl.getExtension('ANGLE_instanced_arrays');
    var maxAttr = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    if (maxAttr < 10) inst = null;                       // fall back below

    var progMain, progPick, progTrace, progSky;
    try {
      progMain  = program(gl, VS, FS, 'main');
      progPick  = program(gl, VS, PICK_FS, 'pick');
      progTrace = program(gl, TRACE_VS, TRACE_FS, 'trace');
      progSky   = program(gl, SKY_VS, SKY_FS, 'sky');
    } catch (e) { return { error: e.message }; }

    /* ── unit meshes ─────────────────────────────────────────────────── */
    var LOD = opts.lite ? 0.5 : 1;
    var seg = function (n) { return Math.max(8, Math.round(n * LOD)); };
    var MESHES = {
      cyl:    GEO.cylinder(seg(40), false, false),
      cylCap: GEO.cylinder(seg(40), true, true),
      // Low-poly counterparts for anything slim enough that the facets cannot
      // be seen: handrail posts, ladder rungs, bracing, small-bore pipe and
      // the elbow knuckles. plant.js assigns them by radius, so no call site
      // has to remember. Roughly half the scene's triangles live here.
      rod:    GEO.cylinder(seg(10), false, false),
      rodCap: GEO.cylinder(seg(10), true, true),
      knuckle:GEO.sphere(seg(10), Math.max(4, Math.round(6 * LOD))),
      cone:   GEO.cone(seg(40), 0.62),
      skirt:  GEO.cone(seg(40), 0.94),               // a support skirt barely tapers
      dish:   GEO.dish(seg(36), Math.max(4, Math.round(9 * LOD))),
      box:    GEO.box(),
      annulus:GEO.annulus(seg(30), 0.62, true),      // platform gratings
      ringThin:GEO.annulus(seg(22), 0.90, true),     // banding straps, flanges
      disc:   GEO.annulus(seg(24), 0.06, true),      // trays, blanking plates
      cylArc: GEO.cylArc(seg(44), Math.PI * 1.44, 0.055),
      sphere: GEO.sphere(seg(22), Math.max(6, Math.round(14 * LOD)))
    };

    /* ── group the plant by mesh, and build the instance buffers ─────── */
    var groups = {}, pickMap = {}, nextPick = 1;
    var objects = plant.objects;
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (!MESHES[o.mesh]) continue;
      if (!groups[o.mesh]) groups[o.mesh] = [];
      if (o.pick && pickMap[o.pick] === undefined) pickMap[o.pick] = nextPick++;
      groups[o.mesh].push(o);
    }
    var pickBack = {};
    for (var k in pickMap) if (pickMap.hasOwnProperty(k)) pickBack[pickMap[k]] = k;

    function buf(data, target, usage) {
      var b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, usage || gl.STATIC_DRAW);
      return b;
    }

    var G = [];
    for (var name in groups) {
      if (!groups.hasOwnProperty(name)) continue;
      var list = groups[name], g = MESHES[name], n = list.length;
      var mData = new Float32Array(n * 16);
      var cData = new Float32Array(n * 4);
      var fData = new Float32Array(n * 4);
      var pData = new Float32Array(n * 3);
      for (i = 0; i < n; i++) {
        var ob = list[i];
        mData.set(ob.m, i * 16);
        cData[i*4] = ob.col[0]; cData[i*4+1] = ob.col[1]; cData[i*4+2] = ob.col[2];
        cData[i*4+3] = ob.mat.rgh;
        fData[i*4] = ob.mat.mtl; fData[i*4+1] = ob.mat.emi; fData[i*4+2] = 0;
        fData[i*4+3] = ob.mat.flag || 0;
        var id = ob.pick ? pickMap[ob.pick] : 0;
        pData[i*3] = ((id >> 0) & 255) / 255;
        pData[i*3+1] = ((id >> 8) & 255) / 255;
        pData[i*3+2] = ((id >> 16) & 255) / 255;
      }
      G.push({
        name: name, n: n, list: list, geo: g,
        vb: buf(g.pos, gl.ARRAY_BUFFER), nb: buf(g.nrm, gl.ARRAY_BUFFER),
        ib: buf(g.idx, gl.ELEMENT_ARRAY_BUFFER),
        u16: g.idx instanceof Uint16Array,
        mb: buf(mData, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW),
        cb: buf(cData, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW),
        fb: buf(fData, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW),
        pb: buf(pData, gl.ARRAY_BUFFER),
        cData: cData, fData: fData
      });
    }
    if (!gl.getExtension('OES_element_index_uint'))
      for (i = 0; i < G.length; i++) if (!G[i].u16) return { error: 'uint indices unavailable' };

    /* ── tracer buffers ──────────────────────────────────────────────── */
    var MAXTR = opts.lite ? 260 : 620;
    var trPos = new Float32Array(MAXTR * 3), trCol = new Float32Array(MAXTR * 4),
        trSize = new Float32Array(MAXTR);
    var trPb = buf(trPos, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW),
        trCb = buf(trCol, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW),
        trSb = buf(trSize, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    var trN = 0;
    var skyVb = buf(new Float32Array([-1,-1, 3,-1, -1,3]), gl.ARRAY_BUFFER);

    // precompute the arc length of every stream, so a tracer moves at a
    // constant speed along a polyline instead of jumping at each corner
    var streams = plant.streams.map(function (s) {
      var seg2 = [], total = 0;
      for (var q = 0; q < s.pts.length - 1; q++) {
        var a = s.pts[q], b = s.pts[q+1];
        var l = Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
        seg2.push({ a: a, b: b, l: l, s: total }); total += l;
      }
      return { key: s.key, col: s.col, r: s.r, seg: seg2, len: Math.max(0.001, total) };
    });
    function pointAt(st, u) {
      var d = u * st.len, q;
      for (q = 0; q < st.seg.length; q++) {
        var sg = st.seg[q];
        if (d <= sg.s + sg.l || q === st.seg.length - 1) {
          var t = Math.max(0, Math.min(1, (d - sg.s) / Math.max(1e-6, sg.l)));
          return [sg.a[0] + (sg.b[0]-sg.a[0])*t, sg.a[1] + (sg.b[1]-sg.a[1])*t,
                  sg.a[2] + (sg.b[2]-sg.a[2])*t];
        }
      }
      return st.seg[0].a;
    }

    /* ── picking target ──────────────────────────────────────────────── */
    var pickFBO = gl.createFramebuffer(), pickTex = gl.createTexture(),
        pickRB = gl.createRenderbuffer(), pickW = 0, pickH = 0;
    function sizePick(w, h) {
      if (w === pickW && h === pickH) return;
      pickW = w; pickH = h;
      gl.bindTexture(gl.TEXTURE_2D, pickTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindRenderbuffer(gl.RENDERBUFFER, pickRB);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, pickRB);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /* ── attribute plumbing ──────────────────────────────────────────── */
    // Attribute and uniform locations never change for a linked program, and
    // querying them is a synchronous driver round trip. Ten groups times two
    // passes times eight names is 160 of those a frame, for nothing.
    var locCache = [];
    function progLoc(prog) {
      for (var q = 0; q < locCache.length; q++) if (locCache[q].p === prog) return locCache[q];
      var e = { p: prog, a: {}, u: {} };
      locCache.push(e);
      return e;
    }
    function attrLoc(prog, n) {
      var e = progLoc(prog);
      if (e.a[n] === undefined) e.a[n] = gl.getAttribLocation(prog, n);
      return e.a[n];
    }
    function uniLoc(prog, n) {
      var e = progLoc(prog);
      if (e.u[n] === undefined) e.u[n] = gl.getUniformLocation(prog, n);
      return e.u[n];
    }

    function bindGroup(prog, grp, useInst) {
      var loc = function (n) { return attrLoc(prog, n); };
      var aPos = loc('aPos'), aNrm = loc('aNrm');
      gl.bindBuffer(gl.ARRAY_BUFFER, grp.vb);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, grp.nb);
      gl.enableVertexAttribArray(aNrm); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grp.ib);
      if (!useInst) return { aPos: aPos, aNrm: aNrm };
      var names = ['aM0','aM1','aM2','aM3'], q;
      gl.bindBuffer(gl.ARRAY_BUFFER, grp.mb);
      for (q = 0; q < 4; q++) {
        var a = loc(names[q]);
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 64, q * 16);
        inst.vertexAttribDivisorANGLE(a, 1);
      }
      var aC = loc('aCol');
      gl.bindBuffer(gl.ARRAY_BUFFER, grp.cb);
      gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 4, gl.FLOAT, false, 0, 0);
      inst.vertexAttribDivisorANGLE(aC, 1);
      var aF = loc('aFx');
      gl.bindBuffer(gl.ARRAY_BUFFER, grp.fb);
      gl.enableVertexAttribArray(aF); gl.vertexAttribPointer(aF, 4, gl.FLOAT, false, 0, 0);
      inst.vertexAttribDivisorANGLE(aF, 1);
      var aP = loc('aPick');
      gl.bindBuffer(gl.ARRAY_BUFFER, grp.pb);
      gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
      inst.vertexAttribDivisorANGLE(aP, 1);
      return { aPos: aPos, aNrm: aNrm, aM: names.map(loc), aC: aC, aF: aF, aP: aP };
    }
    function unbind(h, useInst) {
      if (!useInst || !h.aM) return;
      for (var q = 0; q < 4; q++) inst.vertexAttribDivisorANGLE(h.aM[q], 0);
      inst.vertexAttribDivisorANGLE(h.aC, 0);
      inst.vertexAttribDivisorANGLE(h.aF, 0);
      inst.vertexAttribDivisorANGLE(h.aP, 0);
    }

    /* ── camera ──────────────────────────────────────────────────────── */
    var cam = {
      // spherical about a target
      yaw: -0.72, pitch: 0.20, dist: 96, tx: 0, ty: 26, tz: 0,
      tYaw: -0.72, tPitch: 0.20, tDist: 96, ttx: 0, tty: 26, ttz: 0,
      vYaw: 0, vPitch: 0, vDist: 0, vtx: 0, vty: 0, vtz: 0,
      fov: 0.62
    };
    function camStep(dt, stiff) {
      var K = stiff || 5.5, r;
      r = M.springStep(cam.yaw,   cam.tYaw,   cam.vYaw,   K, dt); cam.yaw = r[0];   cam.vYaw = r[1];
      r = M.springStep(cam.pitch, cam.tPitch, cam.vPitch, K, dt); cam.pitch = r[0]; cam.vPitch = r[1];
      r = M.springStep(cam.dist,  cam.tDist,  cam.vDist,  K, dt); cam.dist = r[0];  cam.vDist = r[1];
      r = M.springStep(cam.tx,    cam.ttx,    cam.vtx,    K, dt); cam.tx = r[0];    cam.vtx = r[1];
      r = M.springStep(cam.ty,    cam.tty,    cam.vty,    K, dt); cam.ty = r[0];    cam.vty = r[1];
      r = M.springStep(cam.tz,    cam.ttz,    cam.vtz,    K, dt); cam.tz = r[0];    cam.vtz = r[1];
      cam.pitch = M.clamp(cam.pitch, -0.30, 1.15);
      cam.dist  = M.clamp(cam.dist, 16, 240);
    }
    function eye() {
      var cp = Math.cos(cam.pitch);
      return [cam.tx + cam.dist * cp * Math.sin(cam.yaw),
              cam.ty + cam.dist * Math.sin(cam.pitch),
              cam.tz + cam.dist * cp * Math.cos(cam.yaw)];
    }

    /* ── state the page drives ───────────────────────────────────────── */
    var st = {
      sel: null, hov: null, product: null, mode: 'material',
      flow: true, tracers: 1, thermal: null, dpr: 1, time: 0,
      // Resolution scale, driven by the page's frame-rate watchdog. Shading
      // cost is the dominant term in this scene, so backing-store size is the
      // one lever that actually buys frames.
      scale: 1,
      fog: [0.055, 0.068, 0.115], expo: 1.18,
      skyTop: [0.026, 0.034, 0.068], skyHorizon: [0.085, 0.102, 0.158],
      skyGlow: [0.20, 0.10, 0.03]
    };
    var VP = M.m4(), P = M.m4(), V = M.m4();

    function dimFor(pick) {
      if (!pick) return st.sel ? 0.72 : 0;
      if (st.sel) {
        if (pick === st.sel) return 0;
        if (st.product && pick === 'product-' + st.product) return 0;
        return 0.78;
      }
      if (st.product) return (pick === 'product-' + st.product) ? 0 : 0.62;
      return 0;
    }
    /** Push the per-instance colour and effect data that selection, product
     *  emphasis and thermal mode change. Only the two small buffers are
     *  re-uploaded; the geometry and matrices never move. */
    function refresh() {
      for (var gi = 0; gi < G.length; gi++) {
        var grp = G[gi], changed = false;
        for (var q = 0; q < grp.n; q++) {
          var ob = grp.list[q];
          var d = dimFor(ob.pick);
          var hov = (ob.pick && ob.pick === st.hov && ob.pick !== st.sel) ? 1 : 0;
          var emi = ob.mat.emi + (ob.pick === st.sel ? 0.30 : 0) + hov * 0.16;
          var col = ob.col;
          if (st.thermal && ob.pick === 'tower') col = st.thermal(ob.m[13]);
          if (grp.cData[q*4] !== col[0] || grp.cData[q*4+1] !== col[1] ||
              grp.cData[q*4+2] !== col[2]) {
            grp.cData[q*4] = col[0]; grp.cData[q*4+1] = col[1]; grp.cData[q*4+2] = col[2];
            changed = true;
          }
          if (grp.fData[q*4+1] !== emi || grp.fData[q*4+2] !== d) {
            grp.fData[q*4+1] = emi; grp.fData[q*4+2] = d; changed = true;
          }
        }
        if (changed) {
          gl.bindBuffer(gl.ARRAY_BUFFER, grp.cb); gl.bufferData(gl.ARRAY_BUFFER, grp.cData, gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, grp.fb); gl.bufferData(gl.ARRAY_BUFFER, grp.fData, gl.DYNAMIC_DRAW);
        }
      }
    }

    /* ── tracers, whose density and speed the result sets ────────────── */
    var trSpec = {};                 // key -> { n, speed, size, col }
    function setFlow(spec) { trSpec = spec || {}; }
    function buildTracers(t) {
      trN = 0;
      if (!st.flow) return;
      for (var s2 = 0; s2 < streams.length; s2++) {
        var stm = streams[s2], sp = trSpec[stm.key];
        if (!sp || sp.n <= 0) continue;
        var n = Math.min(sp.n, Math.floor((MAXTR - trN)));
        var dim = st.product ? (st.product === stm.key ? 1 : 0.18) : 1;
        if (st.sel && st.sel !== 'product-' + stm.key) dim *= st.sel ? 0.55 : 1;
        for (var q = 0; q < n; q++) {
          var u = ((t * sp.speed + q / n) % 1 + 1) % 1;
          var p = pointAt(stm, u);
          trPos[trN*3] = p[0]; trPos[trN*3+1] = p[1]; trPos[trN*3+2] = p[2];
          var c = sp.col || stm.col || [1,1,1];
          trCol[trN*4] = c[0]; trCol[trN*4+1] = c[1]; trCol[trN*4+2] = c[2];
          trCol[trN*4+3] = 0.95 * dim;
          trSize[trN] = (sp.size || 1) * 22;
          trN++;
          if (trN >= MAXTR) break;
        }
        if (trN >= MAXTR) break;
      }
      if (trN) {
        gl.bindBuffer(gl.ARRAY_BUFFER, trPb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, trPos.subarray(0, trN*3));
        gl.bindBuffer(gl.ARRAY_BUFFER, trCb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, trCol.subarray(0, trN*4));
        gl.bindBuffer(gl.ARRAY_BUFFER, trSb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, trSize.subarray(0, trN));
      }
    }

    /* ── drawing ─────────────────────────────────────────────────────── */
    function drawScene(prog, w, h, forPick) {
      gl.useProgram(prog);
      var e = eye();
      M.perspective(P, cam.fov, w / Math.max(1, h), 0.5, 520);
      M.lookAt(V, e, [cam.tx, cam.ty, cam.tz], [0,1,0]);
      M.mul(VP, P, V);
      gl.uniformMatrix4fv(uniLoc(prog, 'uVP'), false, VP);
      gl.uniform3fv(uniLoc(prog, 'uEye'), e);
      if (!forPick) {
        gl.uniform3fv(uniLoc(prog, 'uFog'), st.fog);
        gl.uniform1f(uniLoc(prog, 'uFogD'), 0.0030);
        gl.uniform3fv(uniLoc(prog, 'uKey'), [0.46, 0.78, 0.44]);
        gl.uniform3fv(uniLoc(prog, 'uKeyC'), [1.52, 1.44, 1.32]);
        gl.uniform3fv(uniLoc(prog, 'uFill'), [0.335, 0.415, 0.575]);
        gl.uniform3fv(uniLoc(prog, 'uRim'), [0.30, 0.62, 0.92]);
        gl.uniform3fv(uniLoc(prog, 'uBack'), [-0.62, 0.30, -0.72]);
        gl.uniform3fv(uniLoc(prog, 'uBackC'), [0.20, 0.30, 0.52]);
        gl.uniform3fv(uniLoc(prog, 'uSkyT'), st.skyTop);
        gl.uniform3fv(uniLoc(prog, 'uSkyH'), st.skyHorizon);
        gl.uniform1f(uniLoc(prog, 'uExpo'), st.expo);
      }
      var useInst = !!inst;
      for (var gi = 0; gi < G.length; gi++) {
        var grp = G[gi];
        var hnd = bindGroup(prog, grp, useInst);
        var type = grp.u16 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
        if (useInst) {
          inst.drawElementsInstancedANGLE(gl.TRIANGLES, grp.geo.count, type, 0, grp.n);
        } else {
          // fallback: per-object uniforms, correct but slower
          for (var q = 0; q < grp.n; q++) {
            var ob = grp.list[q];
            gl.vertexAttrib4f(attrLoc(prog, 'aM0'), ob.m[0], ob.m[1], ob.m[2], ob.m[3]);
            gl.vertexAttrib4f(attrLoc(prog, 'aM1'), ob.m[4], ob.m[5], ob.m[6], ob.m[7]);
            gl.vertexAttrib4f(attrLoc(prog, 'aM2'), ob.m[8], ob.m[9], ob.m[10], ob.m[11]);
            gl.vertexAttrib4f(attrLoc(prog, 'aM3'), ob.m[12], ob.m[13], ob.m[14], ob.m[15]);
            gl.vertexAttrib4f(attrLoc(prog, 'aCol'),
              grp.cData[q*4], grp.cData[q*4+1], grp.cData[q*4+2], grp.cData[q*4+3]);
            gl.vertexAttrib4f(attrLoc(prog, 'aFx'),
              grp.fData[q*4], grp.fData[q*4+1], grp.fData[q*4+2], grp.fData[q*4+3]);
            gl.drawElements(gl.TRIANGLES, grp.geo.count, type, 0);
          }
        }
        unbind(hnd, useInst);
      }
    }

    function pixelRatio() {
      return Math.min(opts.maxDpr || 2, window.devicePixelRatio || 1) * st.scale;
    }

    function render(dt) {
      var dpr = pixelRatio();
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      camStep(dt, opts.calm ? 1e4 : 5.5);
      st.time += dt * (st.flow ? st.tracers : 0);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.disable(gl.BLEND);
      gl.clearColor(st.fog[0], st.fog[1], st.fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // graded sky first, at the far plane, so the scene sits in an
      // atmosphere rather than on a flat field
      gl.useProgram(progSky);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.uniform3fv(uniLoc(progSky, 'uTop'), st.skyTop);
      gl.uniform3fv(uniLoc(progSky, 'uHorizon'), st.skyHorizon);
      gl.uniform3fv(uniLoc(progSky, 'uGlow'), st.skyGlow);
      var aSky = attrLoc(progSky, 'aP');
      gl.bindBuffer(gl.ARRAY_BUFFER, skyVb);
      gl.enableVertexAttribArray(aSky); gl.vertexAttribPointer(aSky, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(aSky);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
      drawScene(progMain, w, h, false);

      // tracers last, additively, so they read as light rather than as beads
      if (st.flow) {
        buildTracers(st.time);
        if (trN) {
          gl.useProgram(progTrace);
          gl.uniformMatrix4fv(uniLoc(progTrace, 'uVP'), false, VP);
          gl.uniform1f(uniLoc(progTrace, 'uScale'), dpr * 26);
          var ap = attrLoc(progTrace, 'aPos');
          var ac = attrLoc(progTrace, 'aCol');
          var as = attrLoc(progTrace, 'aSize');
          gl.bindBuffer(gl.ARRAY_BUFFER, trPb);
          gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, trCb);
          gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 4, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, trSb);
          gl.enableVertexAttribArray(as); gl.vertexAttribPointer(as, 1, gl.FLOAT, false, 0, 0);
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          gl.depthMask(false);
          gl.drawArrays(gl.POINTS, 0, trN);
          gl.depthMask(true);
          gl.disable(gl.BLEND);
        }
      }
    }

    /** Which component is under this point, by reading the id buffer. */
    function pickAt(cssX, cssY) {
      // The id buffer is only ever read one pixel at a time, so it can be much
      // coarser than the picture without changing which object is named.
      var dpr = Math.min(0.75, pixelRatio());
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      sizePick(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFBO);
      gl.viewport(0, 0, w, h);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawScene(progPick, w, h, true);
      var px = new Uint8Array(4);
      var rx = Math.round(cssX * dpr), ry = Math.round((canvas.clientHeight - cssY) * dpr);
      rx = Math.max(0, Math.min(w - 1, rx)); ry = Math.max(0, Math.min(h - 1, ry));
      gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      var id = px[0] | (px[1] << 8) | (px[2] << 16);
      return pickBack[id] || null;
    }

    /** Where a world point lands on screen, in CSS pixels — used to pin the
     *  instrument tags and labels to the equipment they belong to. */
    var tmp = [0,0,0];
    function toScreen(p) {
      M.project(tmp, p, VP);
      if (tmp[2] <= 0) return null;
      return { x: (tmp[0] * 0.5 + 0.5) * canvas.clientWidth,
               y: (1 - (tmp[1] * 0.5 + 0.5)) * canvas.clientHeight, d: tmp[2] };
    }

    return {
      gl: gl, cam: cam, state: st, render: render, pickAt: pickAt,
      toScreen: toScreen, refresh: refresh, setFlow: setFlow,
      instanced: !!inst, groups: G.length,
      tris: G.reduce(function (a, g) { return a + g.geo.count / 3 * g.n; }, 0),
      objects: objects.length,
      samples: gl.getParameter(gl.SAMPLES),
      dispose: function () {
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    };
  }

  return { create: create };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RIGGL;
