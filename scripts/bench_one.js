// Child process: one (engine, N) measurement. Prints one JSON line. Uses hrtime, warm-up, multiple trials, medians, per-stage timers.
const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
const [engine, N] = [process.argv[2], +process.argv[3]];
const S = require(path.join(root, 'web/scenario.js')), P = require(path.join(root, 'presets/presets.json'));
const hr = () => Number(process.hrtime.bigint()) / 1e6, med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
(async () => {
  const cfg = S.makeConfig(P, 'TIGER1_UPPER_FRONT', 'TIGER1_PZGR39', { n: N }); let Sim, label = engine;
  if (engine === 'baseline') Sim = require(path.join(root, 'tests/reference_engine.js')).Sim;
  else if (engine === 'js-grid' || engine === 'js-verlet') { const C = require(path.join(root, 'web/engine_js.js')).Sim; Sim = class extends C { constructor(c) { super(c, { contact: engine === 'js-grid' ? 'grid' : 'verlet' }); } }; }
  else if (engine === 'wasm') { globalThis.ALEngineJS = 0; require(path.join(root, 'web/engine_wasm.js')); Sim = (await globalThis.ALEngineWasm.load(fs.readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/armorlab_core.wasm')).toString('base64'))).Sim; }
  const t0 = hr(); const s = new Sim(cfg); const build = hr() - t0; const rssBuild = process.memoryUsage().rss / 1048576; s.fire();
  const k = N <= 20000 ? 100 : N <= 120000 ? 20 : N <= 300000 ? 8 : 4, trials = 5, warm = N <= 20000 ? 30 : 4; s.run(warm);
  const per = []; for (let t = 0; t < trials; t++) { const a = hr(); s.run(k); per.push((hr() - a) / k); }
  const r = { engine, target: N, n: s.n, bonds: s.bi ? s.bi.length : s.stats(0)[16], dt_ns: +(s.dt * 1e9).toFixed(2), build_ms: +build.toFixed(0), step_ms_median: +med(per).toFixed(3), step_ms_min: +Math.min(...per).toFixed(3), step_ms_max: +Math.max(...per).toFixed(3), rss_after_build_MB: Math.round(rssBuild) };
  if (engine.startsWith('js') || engine === 'baseline') { // stage split on a fresh pass (timers add overhead; not used for headline numbers)
    if (engine !== 'baseline') { s.timers = {}; s.run(k); r.stage_ms_per_step = Object.fromEntries(Object.entries(s.timers).map(([a, b]) => [a, +(b / k).toFixed(3)])); s.timers = null; }
  }
  // telemetry + render costs at this state
  const f = (fn, reps) => { fn(); const a = hr(); for (let i = 0; i < reps; i++) fn(); return +((hr() - a) / reps).toFixed(2); }, reps = N > 200000 ? 2 : 4;
  r.stats_full_ms = f(() => s.stats(2), reps); if (engine !== 'baseline') { r.stats_fast_ms = f(() => s.stats(0), reps); } else r.stats_fast_ms = r.stats_full_ms; // baseline has only the full scan
  r.fill_render_all_ms = f(() => s.fillRender(true), reps); if (engine !== 'baseline') r.fill_render_pos_only_ms = f(() => s.fillRender(false), reps); else r.fill_render_pos_only_ms = r.fill_render_all_ms;
  if (N <= 20000) { s.run(600); const st = s.stats(2); r.energy_residual_pct_at_700_steps = +(st[15] * 100).toFixed(3); r.fragments_at_700 = st[20]; r.bonds_broken_at_700 = st[17]; }
  r.peak_rss_MB = Math.round(process.resourceUsage().maxRSS / 1024); r.node = process.version; console.log(JSON.stringify(r));
})().catch((e) => { console.log(JSON.stringify({ engine, target: N, error: String(e && e.message || e) })); });
