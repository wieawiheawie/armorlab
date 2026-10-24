// Benchmarks actual source (not dist): baseline (original engine) vs js-grid vs js-verlet vs real Rust/WASM. Each (engine,N) runs in a fresh process for clean peak RSS.
// Usage: node scripts/bench.js [--quick] [--max N]   -> docs/results/benchmark_after.json
const cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');
const args = process.argv.slice(2), max = args.includes('--max') ? +args[args.indexOf('--max') + 1] : 1000000, quick = args.includes('--quick');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null, resPath = path.join(__dirname, '../docs/results/benchmark_after.json');
const sizes = (quick ? [5000, 18000] : [5000, 18000, 100000, 250000, 1000000]).filter((n) => n <= max), engines = ['baseline', 'js-grid', 'js-verlet'];
if (fs.existsSync(path.join(__dirname, '../target/wasm32-unknown-unknown/release/armorlab_core.wasm'))) engines.push('wasm'); else console.warn('no wasm build: skipping wasm rows');
let out = only && fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath, 'utf8')) : null; if (out) out.rows = out.rows.filter((r) => r.engine !== only); else out = { machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, mem_GB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version, date: new Date().toISOString() }, rows: [] };
for (const n of sizes) for (const e of engines.filter((x) => !only || x === only)) {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'bench_one.js'), e, String(n)], { encoding: 'utf8', maxBuffer: 1 << 26 }); let j; try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (x) { j = { engine: e, target: n, error: 'child failed: ' + (r.stderr || '').slice(0, 200) }; }
  console.log(JSON.stringify(j)); out.rows.push(j);
}
fs.mkdirSync(path.join(__dirname, '../docs/results'), { recursive: true }); fs.writeFileSync(resPath, JSON.stringify(out, null, 1));
