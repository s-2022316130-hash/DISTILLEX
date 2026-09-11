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

function load() {
  const src = fs.readFileSync(SRC, 'utf8');
  const i = src.indexOf('class Component extends DCLogic');
  const j = src.lastIndexOf('</script>');
  if (i < 0 || j < 0) throw new Error('engine: cannot locate class Component in ' + SRC);

  const captured = [];
  global.window = { print: () => captured.push({ kind: 'print' }), innerWidth: 1440 };
  global.document = { createElement: () => ({ click() {} }) };
  global.Blob = class Blob { constructor(p, o) { this.parts = p; this.type = (o || {}).type; } };
  global.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };

  const factory = new Function(
    'var DCLogic = class { constructor(p){ this.props = p || {}; } ' +
    'setState(o){ Object.assign(this.state, o); } };\n' +
    src.slice(i, j) + '\nreturn Component;');
  const Component = factory();
  // Capture downloads and toasts instead of touching the DOM.
  Component.prototype.download = function (name, text, type) { captured.push({ name, text, type }); };
  Component.prototype.flash = function (m) { captured.push({ flash: m }); };
  return { Component, captured, source: src };
}

module.exports = { load, SRC };
