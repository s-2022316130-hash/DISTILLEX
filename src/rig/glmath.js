/* ════════════════════════════════════════════════════════════════════════
   Minimal 3D maths for the industrial renderer.
   Column-major 4×4 matrices, matching what WebGL expects, so a matrix can
   go straight into uniformMatrix4fv with transpose = false. Every routine
   writes into a caller-supplied array where it can, because these run once
   per object per frame and allocating there is what makes a frame stutter.
   ════════════════════════════════════════════════════════════════════════ */
var GLM = (function () {
  'use strict';

  function m4() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  }
  function identity(o) {
    o[0]=1;o[1]=0;o[2]=0;o[3]=0; o[4]=0;o[5]=1;o[6]=0;o[7]=0;
    o[8]=0;o[9]=0;o[10]=1;o[11]=0; o[12]=0;o[13]=0;o[14]=0;o[15]=1; return o;
  }
  /** o = a · b  (apply b first, then a) */
  function mul(o, a, b) {
    var a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7],
        a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    for (var i = 0; i < 4; i++) {
      var b0=b[i*4], b1=b[i*4+1], b2=b[i*4+2], b3=b[i*4+3];
      o[i*4]   = a00*b0 + a10*b1 + a20*b2 + a30*b3;
      o[i*4+1] = a01*b0 + a11*b1 + a21*b2 + a31*b3;
      o[i*4+2] = a02*b0 + a12*b1 + a22*b2 + a32*b3;
      o[i*4+3] = a03*b0 + a13*b1 + a23*b2 + a33*b3;
    }
    return o;
  }
  function perspective(o, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o[0]=f/aspect;o[1]=0;o[2]=0;o[3]=0;
    o[4]=0;o[5]=f;o[6]=0;o[7]=0;
    o[8]=0;o[9]=0;o[10]=(far+near)*nf;o[11]=-1;
    o[12]=0;o[13]=0;o[14]=2*far*near*nf;o[15]=0;
    return o;
  }
  function lookAt(o, eye, at, up) {
    var zx=eye[0]-at[0], zy=eye[1]-at[1], zz=eye[2]-at[2];
    var zl=Math.hypot(zx,zy,zz) || 1; zx/=zl; zy/=zl; zz/=zl;
    var xx=up[1]*zz-up[2]*zy, xy=up[2]*zx-up[0]*zz, xz=up[0]*zy-up[1]*zx;
    var xl=Math.hypot(xx,xy,xz) || 1; xx/=xl; xy/=xl; xz/=xl;
    var yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    o[0]=xx;o[1]=yx;o[2]=zx;o[3]=0;
    o[4]=xy;o[5]=yy;o[6]=zy;o[7]=0;
    o[8]=xz;o[9]=yz;o[10]=zz;o[11]=0;
    o[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);
    o[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);
    o[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
    o[15]=1;
    return o;
  }
  /** The 3×3 normal matrix of a rigid-plus-uniform-scale transform is just
   *  its rotation part; these scenes never shear, so the inverse-transpose
   *  reduces to a normalise and is not worth computing every frame. */
  function normalFromM4(o9, m) {
    var sx = 1/(Math.hypot(m[0],m[1],m[2])||1),
        sy = 1/(Math.hypot(m[4],m[5],m[6])||1),
        sz = 1/(Math.hypot(m[8],m[9],m[10])||1);
    o9[0]=m[0]*sx;o9[1]=m[1]*sx;o9[2]=m[2]*sx;
    o9[3]=m[4]*sy;o9[4]=m[5]*sy;o9[5]=m[6]*sy;
    o9[6]=m[8]*sz;o9[7]=m[9]*sz;o9[8]=m[10]*sz;
    return o9;
  }
  function translate(o, x, y, z) { identity(o); o[12]=x;o[13]=y;o[14]=z; return o; }
  function scale(o, x, y, z) { identity(o); o[0]=x;o[5]=y;o[10]=z; return o; }

  /** A transform that takes the unit +Y axis onto the direction d, placing
   *  its base at `from` and its length along |d|. This is what lets one
   *  cylinder mesh become every pipe run in the plant. */
  function alignY(o, from, dir, radius) {
    var dx=dir[0], dy=dir[1], dz=dir[2];
    var len = Math.hypot(dx,dy,dz) || 1e-6;
    var ux=dx/len, uy=dy/len, uz=dz/len;
    // any vector not parallel to u
    var ax, ay, az;
    if (Math.abs(uy) < 0.999) { ax=0; ay=1; az=0; } else { ax=1; ay=0; az=0; }
    // right = normalize(cross(a, u)), fwd = cross(u, right)
    var rx=ay*uz-az*uy, ry=az*ux-ax*uz, rz=ax*uy-ay*ux;
    var rl=Math.hypot(rx,ry,rz)||1; rx/=rl; ry/=rl; rz/=rl;
    var fx=uy*rz-uz*ry, fy=uz*rx-ux*rz, fz=ux*ry-uy*rx;
    var R = radius === undefined ? 1 : radius;
    o[0]=rx*R;  o[1]=ry*R;  o[2]=rz*R;  o[3]=0;
    o[4]=ux*len;o[5]=uy*len;o[6]=uz*len;o[7]=0;
    o[8]=fx*R;  o[9]=fy*R;  o[10]=fz*R; o[11]=0;
    o[12]=from[0];o[13]=from[1];o[14]=from[2];o[15]=1;
    return o;
  }
  function trs(o, px, py, pz, sx, sy, sz) {
    identity(o); o[0]=sx;o[5]=sy;o[10]=sz; o[12]=px;o[13]=py;o[14]=pz; return o;
  }
  /** Rotation about +Y, then translate — used for anything that stands
   *  upright but faces a particular way. */
  function yawTRS(o, px, py, pz, yaw, sx, sy, sz) {
    var c=Math.cos(yaw), s=Math.sin(yaw);
    o[0]=c*sx; o[1]=0; o[2]=-s*sx; o[3]=0;
    o[4]=0;    o[5]=sy;o[6]=0;     o[7]=0;
    o[8]=s*sz; o[9]=0; o[10]=c*sz; o[11]=0;
    o[12]=px;o[13]=py;o[14]=pz;o[15]=1;
    return o;
  }

  /** Project a world point to normalised device coordinates, for anchoring
   *  HTML labels to 3D positions without a second renderer. */
  function project(out, p, vp) {
    var x=p[0],y=p[1],z=p[2];
    var cx = vp[0]*x + vp[4]*y + vp[8]*z + vp[12];
    var cy = vp[1]*x + vp[5]*y + vp[9]*z + vp[13];
    var cw = vp[3]*x + vp[7]*y + vp[11]*z + vp[15];
    if (cw <= 1e-6) { out[0]=0; out[1]=0; out[2]=-1; return out; }
    out[0]=cx/cw; out[1]=cy/cw; out[2]=cw;
    return out;
  }

  var lerp  = function (a, b, t) { return a + (b - a) * t; };
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  /** Critically-damped spring step. Frame-rate independent, no overshoot,
   *  and it settles rather than easing to a stop — which is what makes a
   *  camera feel like it has mass instead of following a curve. */
  function springStep(cur, target, vel, stiffness, dt) {
    var omega = stiffness, x = cur - target;
    var exp = Math.exp(-omega * dt);
    var nv = (vel + omega * x) * dt;
    var newVel = (vel - omega * nv) * exp;
    var newPos = target + (x + nv) * exp;
    return [newPos, newVel];
  }

  return { m4:m4, identity:identity, mul:mul, perspective:perspective, lookAt:lookAt,
           normalFromM4:normalFromM4, translate:translate, scale:scale,
           alignY:alignY, trs:trs, yawTRS:yawTRS, project:project,
           lerp:lerp, clamp:clamp, springStep:springStep };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GLM;
