#!/usr/bin/env node
// Builds dist/ArmorLab.html (single offline file: CSS, JS, presets, research CSVs, worker source, and optional WASM).
//   node scripts/build.js                -> WASM if the toolchain works, otherwise an explicitly labelled JS-ONLY build (warns loudly)
//   node scripts/build.js --require-wasm -> exits non-zero unless a real Rust/WASM payload was compiled and embedded (use for releases)
//   node scripts/build.js --js-only      -> skip Rust on purpose; output is labelled "JS-ONLY (compatibility build)"
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..'), rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const args = new Set(process.argv.slice(2)), requireWasm = args.has('--require-wasm'), jsOnly = args.has('--js-only');
const fail = (m) => { console.error('\nBUILD FAILED: ' + m); process.exit(1); };
const wasmPath = path.join(root, 'target/wasm32-unknown-unknown/release/armorlab_core.wasm');
const releaseHtml = path.join(root, 'dist/ArmorLab.html');
const hasValidWasmHtml = (file) => {
  if (!fs.existsSync(file)) return false;
  try {
    const html = fs.readFileSync(file, 'utf8');
    return /ARMORLAB_WASM_B64="[A-Za-z0-9+/=]{1000,}"/.test(html) && html.includes('Rust/WASM');
  } catch { return false; }
};
let wasmB64 = 'null', engine = 'JS-ONLY (compatibility build; no WASM)';
let buildSucceeded = false;
if (!jsOnly) {
  const has = (c) => { try { cp.execSync(c, { stdio: 'ignore' }); return true; } catch (e) { return false; } };
  if (!has('cargo --version')) {
    if (requireWasm) fail('cargo not found. Install Rust (https://rustup.rs) and run: rustup target add wasm32-unknown-unknown');
    console.warn('WARNING: cargo not found; leaving existing release untouched when a valid WASM build already exists.');
  } else {
    try {
      cp.execSync('cargo build --release --target wasm32-unknown-unknown', { cwd: root, stdio: 'inherit' });
      buildSucceeded = true;
    } catch (e) {
      if (requireWasm) fail('cargo build for wasm32-unknown-unknown failed (is the target installed? rustup target add wasm32-unknown-unknown)');
      console.warn('WARNING: wasm build failed; leaving existing release untouched when a valid WASM build already exists.');
    }
  }
  if (fs.existsSync(wasmPath)) {
    const bin = fs.readFileSync(wasmPath);
    if (bin.slice(0, 4).toString('hex') !== '0061736d') fail('wasm output has no \\0asm magic');
    wasmB64 = JSON.stringify(bin.toString('base64'));
    engine = `Rust/WASM (${(bin.length / 1024).toFixed(0)} KiB) + labelled JS fallback`;
    buildSucceeded = true;
  } else if (requireWasm) {
    fail('no .wasm produced');
  }
} else if (requireWasm) {
  fail('--js-only and --require-wasm are contradictory');
}
const esc = (v) => v.replace(/<\/script/gi, '<\\/script');
const presets = JSON.stringify(JSON.parse(rd('presets/presets.json')));
const researchManifest = JSON.parse(rd('research/ArmorLab_Research_Pack/manifest.json'));
const researchCsv = Object.fromEntries(researchManifest.csv_files.map((name) => [name, rd(`research/ArmorLab_Research_Pack/data/${name}`)]));
let html = rd('web/index.template.html');
const put = (k, v) => { html = html.replace(`/*__${k}__*/`, () => v); };
const files = { CSS: 'web/style.css', ENGINE_JS: 'web/engine_js.js', ENGINE_WASM: 'web/engine_wasm.js', RESEARCH: 'web/research.js', SCENARIO: 'web/scenario.js', RUNNER: 'web/runner.js', PICK: 'web/pick.js', HOST: 'web/host.js', RENDER: 'web/render.js', APP: 'web/app.js' };
for (const [k, f] of Object.entries(files)) put(k, esc(rd(f)));
put('WORKER_SRC', esc(['web/engine_js.js', 'web/engine_wasm.js', 'web/scenario.js', 'web/runner.js', 'web/worker_main.js'].map(rd).join('\n;\n')));
put('PRESETS', presets); put('RESEARCH_CSV', esc(JSON.stringify(researchCsv))); put('WASM', wasmB64); put('BUILD', `${engine}; ${new Date().toISOString().slice(0, 10)}`);
if (requireWasm && !/ARMORLAB_WASM_B64="AGFzbQ/.test(html)) fail('release HTML does not contain a WASM payload');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
if (!buildSucceeded && !jsOnly && hasValidWasmHtml(releaseHtml)) {
  console.warn('WARNING: no successful replacement build; keeping the existing Rust/WASM release at dist/ArmorLab.html.');
  process.exit(0);
}
const tmp = `${releaseHtml}.tmp`;
fs.writeFileSync(tmp, html);
fs.renameSync(tmp, releaseHtml);
console.log(`dist/ArmorLab.html written (${(html.length / 1024).toFixed(0)} KiB), engine: ${engine}`);
