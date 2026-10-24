const path = require('path'), root = path.join(__dirname, '..');
exports.E = require(path.join(root, 'web/engine_js.js'));
exports.S = require(path.join(root, 'web/scenario.js'));
exports.P = require(path.join(root, 'presets/presets.json'));
exports.root = root;
exports.mk = (t, a, n, o) => { const s = new exports.E.Sim(exports.S.makeConfig(exports.P, t, a, Object.assign({ n }, o))); return s; };
exports.T1 = 'TIGER1_UPPER_FRONT'; exports.T2 = 'TIGER2_UPPER_GLACIS'; exports.A1 = 'TIGER1_PZGR39'; exports.A2 = 'TIGER2_PZGR3943';
