/* Loads the calculation engine out of src/DISTILLEX.dc.html so the tests run
 * against exactly the code the application ships — no duplicated copy.
 *
 * The engine is authored as the body of a Design-Canvas component; this shim
 * supplies the two things that body expects from the runtime (a DCLogic base
 * class and a few browser globals used by the download/flash helpers) and
 * nothing else. No dependencies.  */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.env.DX_SRC ||
  path.join(path.dirname(__dirname), 'src', 'DISTILLEX.dc.html');

/** Resolve the `// @include rig/x.js` directives exactly as tools/build.py
 *  does, so the tests run against the same assembled source the page ships.
 *  Kept deliberately simple: same directive, same depth-first order. */
const INCLUDE = /^([ \t]*)\/\/[ \t]*@include[ \t]+([A-Za-z0-9_./-]+\.js)[ \t]*$/gm;

function inlineModules(text, root, seen) {
  seen = seen || [];
  return text.replace(INCLUDE, (m, pad, rel) => {
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) throw new Error('engine: @include escapes src/: ' + rel);
    if (seen.indexOf(rel) >= 0) throw new Error('engine: @include cycle at ' + rel);
    const body = inlineModules(fs.readFileSync(file, 'utf8').replace(/\n+$/, ''), root, seen.concat([rel]));
    return body.split('\n').map(l => (l.trim() ? pad + l : '')).join('\n');
  });
}

function load() {
  const src = fs.readFileSync(SRC, 'utf8');
  // The whole component script, not just the class: the simulator's modules
  // are included above it and the class body refers to them.
  const open = src.indexOf('<script type="text/x-dc"');
  const i = open < 0 ? -1 : src.indexOf('>', open) + 1;
  const j = src.lastIndexOf('</script>');
  if (i <= 0 || j < 0 || src.indexOf('class Component extends DCLogic') < 0)
    throw new Error('engine: cannot locate the component script in ' + SRC);

  const body = inlineModules(src.slice(i, j), path.join(path.dirname(SRC)), []);

  const captured = [];
  global.window = { print: () => captured.push({ kind: 'print' }), innerWidth: 1440,
                    devicePixelRatio: 1,
                    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {} }),
                    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
                    location: { pathname: '/', hash: '', protocol: 'file:', origin: 'file://' },
                    history: { pushState() {} }, addEventListener() {},
                    scrollTo() {} };
  global.document = { createElement: () => ({ click() {}, style: {}, setAttribute() {} }),
                      getElementById: () => null, querySelector: () => null,
                      querySelectorAll: () => [], addEventListener() {},
                      removeEventListener() {}, body: { appendChild() {} } };
  global.Blob = class Blob { constructor(p, o) { this.parts = p; this.type = (o || {}).type; } };
  global.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};

  const factory = new Function(
    'var DCLogic = class { constructor(p){ this.props = p || {}; } ' +
    'setState(o){ Object.assign(this.state, o); } };\n' +
    body + '\nreturn { Component: Component, CDU: CDU, PLANT: PLANT, GEO: GEO, ' +
    'GLM: GLM, RIG2D: RIG2D, RIGINFO: RIGINFO };');
  const mods = factory();
  const Component = mods.Component;
  // Capture downloads and toasts instead of touching the DOM.
  Component.prototype.download = function (name, text, type) { captured.push({ name, text, type }); };
  Component.prototype.flash = function (m) { captured.push({ flash: m }); };
  return { Component, captured, source: src, modules: mods };
}

module.exports = { load, SRC };
