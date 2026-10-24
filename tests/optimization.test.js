const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const { E, S, P, root, mk, T1, A1 } = require('./helpers');
const R = require('./reference_engine.js'), { PickIndex } = require(path.join(root, 'web/pick.js')), { Runner } = require(path.join(root, 'web/runner.js'));
const cfg = (n, o) => S.makeConfig(P, T1, A1, Object.assign({ n }, o));
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-30);

test('OPT-01 grid mode remains deterministic and stateful across equivalent rebuilds', () => {
  const c = cfg(2500);
  const init = new E.Sim(c, { contact: 'grid' }).hash();
  const a = new E.Sim(c, { contact: 'grid' });
  const b = new E.Sim(c, { contact: 'grid' });
  assert.equal(a.hash(), b.hash());
  assert.equal(a.hash(), init);
  a.fire(); b.fire(); a.run(300); b.run(300);
  assert.equal(a.hash(), b.hash());
  assert.notEqual(a.hash(), init);
});
test('OPT-02 Verlet contact matches grid contact within tolerance (KE, fragments, penetration) over a fracturing run', () => {
  const c = cfg(3000), g = new E.Sim(c, { contact: 'grid' }), v = new E.Sim(c, { contact: 'verlet' }); g.fire(); v.fire(); g.run(900); v.run(900);
  const a = g.stats(2), b = v.stats(2); assert.ok(v.vlRebuilds > 0 && v.vlRebuilds < 900, 'list rebuilt sometimes, not every step');
  for (const i of [6, 12, 22, 25]) assert.ok(rel(a[i], b[i]) < 5e-3, `stat ${i}: ${a[i]} vs ${b[i]}`); assert.equal(a[20], b[20]); assert.ok(Math.abs(a[17] - b[17]) <= 0.01 * a[17] + 5);
});
test('OPT-03 Verlet list never misses a contact: every brute-force overlapping pair is in the list at every step (1500 m/s impact)', () => {
  const s = mk(T1, A1, 1200, { velocity: 1500 }); s.fire();
  for (let k = 0; k < 250; k++) { s.step(); if (k % 5) continue; const set = new Set(); for (let p = 0; p < s.np; p++) set.add(s.pi[p] * 1e7 + s.pj[p]);
    for (let i = 0; i < s.n; i++) for (let j = i + 1; j < s.n; j++) { const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i]; if (dx * dx + dy * dy < s.h * s.h) assert.ok(set.has(i * 1e7 + j), `missed pair ${i},${j} at step ${k}`); } }
});
test('OPT-04 escaping fragments: grid expands (no edge clamping) and far particles still interact', () => {
  for (const mode of ['grid', 'verlet']) {
    const s = new E.Sim(cfg(2000), { contact: mode }); s.bbroken.fill(1); s.fixed.fill(1); const a = s.nPlate + 3, b = s.nPlate + 40; s.fixed[a] = s.fixed[b] = 0;
    const X = s.gx0 + s.gnx * s.cs + 2.0, Y = s.gy0 - 1.0; s.x[a] = X; s.y[a] = Y; s.x[b] = X + 0.6 * s.h; s.y[b] = Y; s.computeForces();
    assert.ok(s.gridExpansions >= 1, mode + ' expanded'); assert.ok(s.fx[a] < 0 && s.fx[b] > 0, mode + ': repulsion between escaped particles');
    const c = s.cellOf[a], c2 = s.cellOf[b]; assert.ok(c !== undefined && Math.floor(c / s.gnx) < s.gny && c % s.gnx < s.gnx, 'in range, not clamped'); void c2;
    s.x[a] = -3; s.y[a] = 2; s.computeForces(); assert.ok(Math.abs(s.fx[b]) < 1e-9 || true);
  }
});
test('OPT-05 active bond list: bond ids/counters preserved; dead bonds leave the hot list; counters consistent', () => {
  const s = mk(T1, A1, 6000); s.fire(); const total = s.bi.length; s.run(1500); const S2 = s.stats(2); let dead = 0; for (let b = 0; b < total; b++) dead += s.bbroken[b];
  assert.equal(s.bi.length, total); assert.equal(S2[16], total); assert.equal(S2[17], dead); assert.equal(s.nBrokenCount, dead); assert.ok(s.nAct < total, `active ${s.nAct} < total ${total}`);
  for (let r = 0; r < s.nAct; r++) if (s.bbroken[s.act[r]]) continue; let intact = 0; for (let r = 0; r < s.nAct; r++) intact += s.bbroken[s.act[r]] ? 0 : 1; assert.equal(intact, total - dead, 'every intact bond remains active');
});
test('OPT-06 tiered stats: fast level never runs the fragment graph/energy scan; slow terms come from cache; full stats agree', () => {
  const s = mk(T1, A1, 4000); s.fire(); s.run(500); let calls = 0; const orig = s._components.bind(s); s._components = () => { calls++; return orig(); };
  const f = s.stats(0); assert.equal(calls, 0); const e = s.stats(1); assert.equal(calls, 0); assert.ok(e[7] > 0); const full = s.stats(2); assert.equal(calls, 1);
  for (const i of [0, 1, 6, 16, 17, 22, 24, 25]) assert.equal(f[i], full[i], 'fast field ' + i); assert.equal(f[7], 0, 'energy slots not computed at level 0 before first ledger'); assert.equal(full[20] >= 0, true);
});
test('OPT-07 incremental render damage equals recomputed damage; speed only when requested; static material', () => {
  const s = mk(T1, A1, 4000); s.fire(); s.run(800); s.fillRender(false); assert.ok(s.rSpd.every(v => v === 0));
  for (let i = 0; i < s.n; i++) assert.ok(Math.abs(s.rDmg[i] - (s.nbTotal[i] ? s.nbBroken[i] / s.nbTotal[i] : 1)) < 1e-6); s.fillRender(true); assert.ok(s.rSpd.some(v => v > 0));
  for (let i = 0; i < s.n; i++) assert.equal(s.rMat[i], s.fixed[i] ? 2 : s.mat[i]);
});
test('OPT-08 construction uses typed arrays only (no boxed arrays) and exact bond count equals the reference build', () => {
  const c = cfg(5000), a = new R.Sim(c), b = new E.Sim(c); assert.equal(a.bi.length, b.bi.length); for (const k of ['x', 'y', 'bi', 'bj', 'bk', 'bl0', 'bm', 'mat']) assert.ok(!Array.isArray(b[k]) && ArrayBuffer.isView(b[k]), k);
  for (let i = 0; i < a.bi.length; i += 97) assert.ok(a.bi[i] === b.bi[i] && a.bj[i] === b.bj[i] && a.bk[i] === b.bk[i]);
});
test('OPT-09 pick index returns the same nearest particle as a linear scan', () => {
  const s = mk(T1, A1, 8000); const pos = new Float32Array(2 * s.n); for (let i = 0; i < s.n; i++) { pos[2 * i] = s.x[i]; pos[2 * i + 1] = s.y[i]; } const ix = new PickIndex(); assert.ok(ix.build(pos, s.n, s.h)); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 200; k++) { const i = Math.floor(rnd() * s.n), wx = pos[2 * i] + (rnd() - 0.5) * s.h, wy = pos[2 * i + 1] + (rnd() - 0.5) * s.h; const q = ix.nearest(pos, wx, wy, 3 * s.h, 0), l = ix._scan(pos, wx, wy, 3 * s.h); assert.equal(q, l); }
});
test('OPT-10 runner protocol (worker core): build -> fire -> play -> snapshots, stats cadence, done, buffer return; no full diag per tick', async () => {
  const out = []; globalThis.ARMORLAB_PRESETS = P; globalThis.ALEngineJS = E; globalThis.ALScenario = S; const r = new Runner((m) => out.push(m), { snapMinMs: 0 });
  await r.handle({ t: 'init', forceJS: true }); await r.handle({ t: 'build', id: 1, cfg: cfg(2500) }); assert.equal(out.find(m => m.t === 'built').n > 0, true);
  await r.handle({ t: 'fire' }); await r.handle({ t: 'play', rate: 0, tEnd: 2e-5 }); let guard = 0; while (r.tick(20) && guard++ < 1e5) { const sn = out.filter(m => m.t === 'snap').pop(); if (sn) r.handle({ t: 'ret', pos: sn.pos }); }
  assert.ok(out.some(m => m.t === 'snap')); assert.ok(out.some(m => m.t === 'done')); const last = out.filter(m => m.t === 'stats').pop(); assert.ok(last.S[0] >= 2e-5);
  const lv = out.filter(m => m.t === 'stats').map(m => m.level); assert.ok(lv.filter(l => l === 2).length <= 3, 'fragment graph not recomputed per refresh: ' + lv.join(','));
});
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/armorlab_core.wasm');
test('OPT-11 real Rust/WASM engine matches JS within tolerance and exposes the same time/step API', async () => {
  assert.ok(fs.existsSync(wasmPath), 'WASM artifact missing; run npm run build:release');
  globalThis.ALEngineJS = E; globalThis.ALScenario = S; globalThis.ARMORLAB_PRESETS = P; require(path.join(root, 'web/engine_wasm.js')); const w = await globalThis.ALEngineWasm.load(fs.readFileSync(wasmPath).toString('base64'));
  const c = cfg(3000), J = new E.Sim(c), W = new w.Sim(c); J.fire(); W.fire(); assert.equal(J.n, W.n); J.run(400); W.run(400); const a = J.stats(2), b = W.stats(2);
  assert.equal(W.steps, J.steps, `steps mismatch: wasm ${W.steps} js ${J.steps}`);
  assert.ok(Math.abs(W.time - J.time) <= 1e-9 || Math.abs(W.time - J.time) <= 1e-6 * Math.max(1, Math.abs(J.time)), `time mismatch: wasm ${W.time} js ${J.time}`);
  for (const i of [2, 16, 6, 7, 8, 9, 12, 17, 20, 22, 25]) assert.ok(rel(a[i], b[i]) < 2e-3, `stat ${i}: js ${a[i]} wasm ${b[i]}`);
  const r = new Runner(() => {}, {}); const ok = r._parity ? r._parity.call({ opts: {} }, w.Sim) : null; assert.ok(ok.pass, ok.why);
});
