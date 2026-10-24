/* Entry point inside the Web Worker (bundled after engine/scenario/runner into one Blob). */
(function () {
'use strict';
const post = (m, tr) => self.postMessage(m, tr || []); const R = new self.ALRunner.Runner(post);
let pump = false; const loop = () => { if (!pump) return; const more = R.tick(25); if (more) setTimeout(loop, 0); else pump = false; };
const kick = () => { if (!pump) { pump = true; setTimeout(loop, 0); } };
self.onmessage = async (e) => { const m = e.data; if (m.t === 'init' && m.presets) self.ARMORLAB_PRESETS = m.presets; await R.handle(m); if (R.running) kick(); };
self.postMessage({ t: 'boot' });
})();
