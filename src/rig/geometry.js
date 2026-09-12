/* ════════════════════════════════════════════════════════════════════════
   Parametric geometry for the industrial scene.

   Every builder returns { pos, nrm, idx } as plain typed arrays in a UNIT
   frame — a cylinder of radius 1 and height 1 standing on the origin with its
   axis along +Y, a cube of side 1 centred on the origin, and so on. The plant
   is then assembled by instancing those unit meshes with per-object matrices,
   so the whole rig is a handful of draw calls rather than hundreds, and two
   pieces that should line up line up because they are placed by the same
   arithmetic rather than by eye.

   Vessels get torispherical heads, nozzles get raised-face flanges, platforms
   get gratings and handrails, and the skirt gets fireproofing. Those details
   are the difference between something that reads as a pressure vessel and
   something that reads as a cylinder.
   ════════════════════════════════════════════════════════════════════════ */
var GEO = (function () {
  'use strict';

  function mesh(nv, nt) {
    return { pos: new Float32Array(nv * 3), nrm: new Float32Array(nv * 3),
             idx: (nv > 65000 ? new Uint32Array(nt * 3) : new Uint16Array(nt * 3)),
             vi: 0, ti: 0 };
  }
  function push(m, x, y, z, nx, ny, nz) {
    var i = m.vi * 3;
    m.pos[i] = x; m.pos[i+1] = y; m.pos[i+2] = z;
    m.nrm[i] = nx; m.nrm[i+1] = ny; m.nrm[i+2] = nz;
    return m.vi++;
  }
  function tri(m, a, b, c) {
    var i = m.ti * 3; m.idx[i] = a; m.idx[i+1] = b; m.idx[i+2] = c; m.ti++;
  }
  function quad(m, a, b, c, d) { tri(m, a, b, c); tri(m, a, c, d); }
  function done(m) {
    return { pos: m.pos.subarray(0, m.vi * 3), nrm: m.nrm.subarray(0, m.vi * 3),
             idx: m.idx.subarray(0, m.ti * 3), count: m.ti * 3 };
  }

  /** Open cylinder, radius 1, height 1, base at y = 0, axis +Y.
   *  Smooth-shaded round the circumference — a faceted silhouette is the
   *  single clearest tell of a primitive. */
  function cylinder(seg, capTop, capBot) {
    seg = seg || 40;
    var m = mesh((seg + 1) * 2 + (capTop ? seg + 2 : 0) + (capBot ? seg + 2 : 0),
                 seg * 2 + (capTop ? seg : 0) + (capBot ? seg : 0));
    var i, a, c, s, base = [];
    for (i = 0; i <= seg; i++) {
      a = i / seg * Math.PI * 2; c = Math.cos(a); s = Math.sin(a);
      base.push(push(m, c, 0, s, c, 0, s));
      base.push(push(m, c, 1, s, c, 0, s));
    }
    for (i = 0; i < seg; i++) {
      var b0 = base[i*2], t0 = base[i*2+1], b1 = base[i*2+2], t1 = base[i*2+3];
      quad(m, b0, b1, t1, t0);
    }
    if (capTop) {
      var ct = push(m, 0, 1, 0, 0, 1, 0), first = -1, prev = -1;
      for (i = 0; i <= seg; i++) {
        a = i / seg * Math.PI * 2;
        var v = push(m, Math.cos(a), 1, Math.sin(a), 0, 1, 0);
        if (i === 0) first = v; else tri(m, ct, prev, v);
        prev = v;
      }
    }
    if (capBot) {
      var cb = push(m, 0, 0, 0, 0, -1, 0), pv = -1;
      for (i = 0; i <= seg; i++) {
        a = i / seg * Math.PI * 2;
        var v2 = push(m, Math.cos(a), 0, Math.sin(a), 0, -1, 0);
        if (i > 0) tri(m, cb, v2, pv);
        pv = v2;
      }
    }
    return done(m);
  }

  /** A partial cylinder: the same shell, swept through `sweep` radians and
   *  capped along both cut edges. This is the cutaway — the tower is drawn
   *  with a wedge removed so the trays inside are visible, which is the whole
   *  point of showing a column rather than a tube. */
  function cylArc(seg, sweep, wall) {
    seg = seg || 40; sweep = sweep || Math.PI * 1.45; wall = wall || 0.05;
    var m = mesh((seg + 1) * 4 + 8, seg * 4 + 4);
    var i, a, c, s2, out = [], inn = [];
    var ri = 1 - wall;
    for (i = 0; i <= seg; i++) {
      a = -sweep / 2 + i / seg * sweep; c = Math.cos(a); s2 = Math.sin(a);
      out.push(push(m, c, 0, s2, c, 0, s2), push(m, c, 1, s2, c, 0, s2));
      inn.push(push(m, c*ri, 0, s2*ri, -c, 0, -s2), push(m, c*ri, 1, s2*ri, -c, 0, -s2));
    }
    for (i = 0; i < seg; i++) {
      quad(m, out[i*2], out[i*2+2], out[i*2+3], out[i*2+1]);      // outer skin
      quad(m, inn[i*2], inn[i*2+1], inn[i*2+3], inn[i*2+2]);      // inner skin
    }
    // close the two cut edges so the wall reads as having thickness
    for (var e = 0; e < 2; e++) {
      var k = e ? seg : 0, sg = e ? 1 : -1;
      a = -sweep / 2 + (e ? sweep : 0); c = Math.cos(a); s2 = Math.sin(a);
      var nx = -s2 * sg, nz = c * sg;
      var q0 = push(m, c, 0, s2, nx, 0, nz), q1 = push(m, c, 1, s2, nx, 0, nz);
      var q2 = push(m, c*ri, 1, s2*ri, nx, 0, nz), q3 = push(m, c*ri, 0, s2*ri, nx, 0, nz);
      if (e) quad(m, q0, q1, q2, q3); else quad(m, q3, q2, q1, q0);
    }
    return done(m);
  }

  /** Truncated cone: radius 1 at the base, `rTop` at the top. Skirts,
   *  reducers and the transition under a vessel. */
  function cone(seg, rTop) {
    seg = seg || 40;
    var m = mesh((seg + 1) * 2, seg * 2);
    var i, a, c, s, v = [];
    // the side normal tilts with the taper, or the shading lies about the shape
    var slope = 1 - rTop, nl = Math.hypot(1, slope) || 1;
    for (i = 0; i <= seg; i++) {
      a = i / seg * Math.PI * 2; c = Math.cos(a); s = Math.sin(a);
      var nx = c / nl, ny = slope / nl, nz = s / nl;
      v.push(push(m, c, 0, s, nx, ny, nz));
      v.push(push(m, c * rTop, 1, s * rTop, nx, ny, nz));
    }
    for (i = 0; i < seg; i++) quad(m, v[i*2], v[i*2+2], v[i*2+3], v[i*2+1]);
    return done(m);
  }

  /** A 2:1 ellipsoidal (torispherical) head: the dished end every pressure
   *  vessel has. Radius 1 at the rim, depth 0.5, opening upward. Flip it with
   *  a negative Y scale for the bottom head. */
  function dish(seg, rings) {
    seg = seg || 40; rings = rings || 10;
    var m = mesh((seg + 1) * (rings + 1), seg * rings * 2);
    var grid = [], i, j;
    for (j = 0; j <= rings; j++) {
      var t = j / rings, phi = t * Math.PI / 2;       // rim → pole
      var r = Math.cos(phi), y = 0.5 * Math.sin(phi);
      var row = [];
      // ellipsoid normal: (x/a², y/b², z/a²) normalised, a = 1, b = 0.5
      for (i = 0; i <= seg; i++) {
        var a2 = i / seg * Math.PI * 2, c = Math.cos(a2), s = Math.sin(a2);
        var nx = c * r, ny = y / 0.25, nz = s * r;
        var nl = Math.hypot(nx, ny, nz) || 1;
        row.push(push(m, c * r, y, s * r, nx/nl, ny/nl, nz/nl));
      }
      grid.push(row);
    }
    for (j = 0; j < rings; j++)
      for (i = 0; i < seg; i++)
        quad(m, grid[j][i], grid[j][i+1], grid[j+1][i+1], grid[j+1][i]);
    return done(m);
  }

  /** Unit cube centred on the origin, flat-shaded. */
  function box() {
    var m = mesh(24, 12);
    var F = [[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]];
    for (var f = 0; f < 6; f++) {
      var n = F[f], u = [n[1], n[2], n[0]], w = [
        n[1]*u[2]-n[2]*u[1], n[2]*u[0]-n[0]*u[2], n[0]*u[1]-n[1]*u[0]];
      var a = [], k;
      for (k = 0; k < 4; k++) {
        var su = (k === 0 || k === 3) ? -0.5 : 0.5;
        var sw = (k < 2) ? -0.5 : 0.5;
        a.push(push(m, n[0]*0.5 + u[0]*su + w[0]*sw,
                       n[1]*0.5 + u[1]*su + w[1]*sw,
                       n[2]*0.5 + u[2]*su + w[2]*sw, n[0], n[1], n[2]));
      }
      quad(m, a[0], a[1], a[2], a[3]);
    }
    return done(m);
  }

  /** A quarter-torus elbow: sweeps from +Y at the origin round to +X, with a
   *  bend radius of 1 and a tube radius of `tube`. Every direction change in
   *  the piping uses one of these, which is what stops the runs looking like
   *  disconnected sticks. */
  function elbow(tube, arcSeg, ringSeg, sweep) {
    tube = tube || 0.16; arcSeg = arcSeg || 14; ringSeg = ringSeg || 16;
    sweep = sweep === undefined ? Math.PI / 2 : sweep;
    var m = mesh((arcSeg + 1) * (ringSeg + 1), arcSeg * ringSeg * 2);
    var grid = [], i, j;
    for (j = 0; j <= arcSeg; j++) {
      var t = j / arcSeg * sweep;
      // centreline: starts at (−1,0,0)+R going up, curls to +X
      var cx = -Math.cos(t) + 1, cy = Math.sin(t);
      var tx = Math.sin(t), ty = Math.cos(t);          // tangent
      var nx = -ty, ny = tx;                            // in-plane normal
      var row = [];
      for (i = 0; i <= ringSeg; i++) {
        var a = i / ringSeg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        var ox = nx * ca, oy = ny * ca, oz = sa;
        row.push(push(m, cx + ox * tube, cy + oy * tube, oz * tube, ox, oy, oz));
      }
      grid.push(row);
    }
    for (j = 0; j < arcSeg; j++)
      for (i = 0; i < ringSeg; i++)
        quad(m, grid[j][i], grid[j][i+1], grid[j+1][i+1], grid[j+1][i]);
    return done(m);
  }

  /** Flat annulus in the XZ plane: platform gratings, flange faces, the
   *  underside of a tray. Inner radius `ri`, outer radius 1. */
  function annulus(seg, ri, twoSided) {
    seg = seg || 40; ri = ri === undefined ? 0.5 : ri;
    var m = mesh((seg + 1) * 2 * (twoSided ? 2 : 1), seg * 2 * (twoSided ? 2 : 1));
    var up = [], i, a;
    for (i = 0; i <= seg; i++) {
      a = i / seg * Math.PI * 2;
      up.push(push(m, Math.cos(a)*ri, 0, Math.sin(a)*ri, 0, 1, 0));
      up.push(push(m, Math.cos(a), 0, Math.sin(a), 0, 1, 0));
    }
    for (i = 0; i < seg; i++) quad(m, up[i*2], up[i*2+1], up[i*2+3], up[i*2+2]);
    if (twoSided) {
      var dn = [];
      for (i = 0; i <= seg; i++) {
        a = i / seg * Math.PI * 2;
        dn.push(push(m, Math.cos(a)*ri, 0, Math.sin(a)*ri, 0, -1, 0));
        dn.push(push(m, Math.cos(a), 0, Math.sin(a), 0, -1, 0));
      }
      for (i = 0; i < seg; i++) quad(m, dn[i*2], dn[i*2+2], dn[i*2+3], dn[i*2+1]);
    }
    return done(m);
  }

  /** UV sphere of radius 1 — valve bodies, pump casings, the spherical
   *  fittings that break up a run of straight pipe. */
  function sphere(seg, rings) {
    seg = seg || 24; rings = rings || 16;
    var m = mesh((seg + 1) * (rings + 1), seg * rings * 2);
    var grid = [], i, j;
    for (j = 0; j <= rings; j++) {
      var phi = j / rings * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
      var row = [];
      for (i = 0; i <= seg; i++) {
        var th = i / seg * Math.PI * 2;
        var x = sp * Math.cos(th), y = cp, z = sp * Math.sin(th);
        row.push(push(m, x, y, z, x, y, z));
      }
      grid.push(row);
    }
    for (j = 0; j < rings; j++)
      for (i = 0; i < seg; i++)
        quad(m, grid[j][i], grid[j][i+1], grid[j+1][i+1], grid[j+1][i]);
    return done(m);
  }

  /** Merge several built meshes, each with its own 4×4 transform, into one.
   *  Used for the compound pieces — a ladder, a handrail run, a lattice bay —
   *  so they cost one instance instead of thirty. */
  function merge(parts) {
    var nv = 0, ni = 0, k;
    for (k = 0; k < parts.length; k++) { nv += parts[k].g.pos.length / 3; ni += parts[k].g.idx.length; }
    var pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
    var idx = nv > 65000 ? new Uint32Array(ni) : new Uint16Array(ni);
    var vo = 0, io = 0;
    for (k = 0; k < parts.length; k++) {
      var g = parts[k].g, m = parts[k].m, n = g.pos.length / 3, i;
      for (i = 0; i < n; i++) {
        var x = g.pos[i*3], y = g.pos[i*3+1], z = g.pos[i*3+2];
        pos[(vo+i)*3]   = m[0]*x + m[4]*y + m[8]*z + m[12];
        pos[(vo+i)*3+1] = m[1]*x + m[5]*y + m[9]*z + m[13];
        pos[(vo+i)*3+2] = m[2]*x + m[6]*y + m[10]*z + m[14];
        var a = g.nrm[i*3], b = g.nrm[i*3+1], c = g.nrm[i*3+2];
        var sx = 1/(Math.hypot(m[0],m[1],m[2])||1),
            sy = 1/(Math.hypot(m[4],m[5],m[6])||1),
            sz = 1/(Math.hypot(m[8],m[9],m[10])||1);
        var ux = (m[0]*sx)*a + (m[4]*sy)*b + (m[8]*sz)*c;
        var uy = (m[1]*sx)*a + (m[5]*sy)*b + (m[9]*sz)*c;
        var uz = (m[2]*sx)*a + (m[6]*sy)*b + (m[10]*sz)*c;
        var ul = Math.hypot(ux,uy,uz)||1;
        nrm[(vo+i)*3]=ux/ul; nrm[(vo+i)*3+1]=uy/ul; nrm[(vo+i)*3+2]=uz/ul;
      }
      for (i = 0; i < g.idx.length; i++) idx[io+i] = g.idx[i] + vo;
      vo += n; io += g.idx.length;
    }
    return { pos: pos, nrm: nrm, idx: idx, count: idx.length };
  }

  return { cylinder:cylinder, cylArc:cylArc, cone:cone, dish:dish, box:box, elbow:elbow,
           annulus:annulus, sphere:sphere, merge:merge };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GEO;
