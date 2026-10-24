// Offline smoke test of the BUNDLED worker source from dist/ArmorLab.html, executed in a real worker thread (node worker_threads),
// with the real WASM payload if embedded. NOT a browser test: file:// loading, Blob URLs and WebGL are only checked by scripts/smoke_browser.js (needs Playwright).
const fs = require('fs'), path = require('path'), { Worker } = require('worker_threads');
const html = fs.readFileSync(path.join(__dirname, '../dist/ArmorLab.html'), 'utf8');
const src = html.match(/<script type="text\/plain" id="al-worker-src">([\s\S]*?)<\/script>/)[1].replace(/<\\\/script/g, '</script');
const wasm = (html.match(/ARMORLAB_WASM_B64=("[^"]+"|null)/) || [])[1], wasmB64 = wasm && wasm !== 'null' ? JSON.parse(wasm) : null;
const P = require('../presets/presets.json'), S = require('../web/scenario.js'), cfg = S.makeConfig(P, 'TIGER1_UPPER_FRONT', 'TIGER1_PZGR39', { n: 5000 });
const boot = `const {parentPort}=require('worker_threads');globalThis.self=globalThis;globalThis.postMessage=(m,t)=>parentPort.postMessage(m,t);parentPort.on('message',m=>globalThis.onmessage({data:m}));` + 'new Function("module","exports","require",' + JSON.stringify(src) + ')(undefined,undefined,undefined);'; // hide node CommonJS globals so the script behaves like a browser worker
const w = new Worker(boot, { eval: true }); const seen = {}; const t0 = Date.now(); let snaps = 0, backend = '';
const fail = (m) => { console.error('SMOKE FAIL: ' + m); process.exit(1); }; const killer = setTimeout(() => fail('timeout'), 120000);
w.on('error', (e) => fail(e.message));
w.on('message', (m) => {
  seen[m.t] = (seen[m.t] || 0) + 1;
  if (m.t === 'boot') w.postMessage({ t: 'init', wasmB64, presets: P });
  else if (m.t === 'ready') { backend = m.backend; console.log('ready:', m.backend, '-', m.note); w.postMessage({ t: 'build', id: 1, cfg }); }
  else if (m.t === 'built') { w.postMessage({ t: 'fire' }); w.postMessage({ t: 'play', rate: 0, tEnd: 6e-5 }); }
  else if (m.t === 'snap') { snaps++; w.postMessage({ t: 'ret', pos: m.pos }, [m.pos.buffer]); }
  else if (m.t === 'error') fail(m.msg);
  else if (m.t === 'done') { console.log(`done in ${Date.now() - t0} ms; messages:`, JSON.stringify(seen)); if (wasmB64 && backend !== 'WASM') fail('WASM payload present but backend is ' + backend); if (!snaps) fail('no snapshots'); console.log('SMOKE PASS (worker thread, backend ' + backend + ')'); clearTimeout(killer); w.terminate(); }
});
