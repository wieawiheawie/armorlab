# ArmorLab (clean rebuild, v0.1 prototype)
2D particle impact simulator: Tiger I upper front (100 mm; scenario angle 9° from vertical) + Pzgr.39/KwK 36, Tiger II upper glacis (150 mm @ 50° from vertical = 40° from horizontal) + Pzgr.39/43/KwK 43. Also Tiger I nose alt (25°). Comparison mode (non-historical pairings) available. The research pack reports 8° for the Tiger I upper front; the scenario retains 9° and displays the unresolved source conflict.

Layout: `src/` Rust core (sim.rs, presets.rs, lib.rs C-ABI) · `web/` UI, WebGL renderer, JS engine port, WASM adapter, and research CSV loader · `presets/presets.json` · `research/ArmorLab_Research_Pack/` source-traceable datasets · `data/` prior reference material · `tests/` · `scripts/` · `docs/` · `dist/ArmorLab.html`.

## Commands
- `npm run build` → `dist/ArmorLab.html`. If `cargo` + target `wasm32-unknown-unknown` exist (`rustup target add wasm32-unknown-unknown`) it compiles the Rust core and embeds the WASM (base64); otherwise it builds a **JS-engine-only** HTML and prints a warning.
- `npm test` (Node ≥ 20) JS test suite · `cargo test --release` Rust tests · `node scripts/report.js` convergence · `node scripts/bench.js` benchmark · `node scripts/smoke.js` file:// browser smoke test (needs Playwright).

## VERIFICATION STATUS (read this)
- **v0.2 (armour/ammunition audit):** energy-ledger fix (residual ~9 % → ~0.4 %), support-impulse momentum ledger, per-component diagnostics, evidence-based Pzgr.39/39-43 body parameters, 28 Rust tests and 65 JS tests passing, Rust/WASM release built. See docs/PHYSICS_MODEL.md (v0.2 section) and docs/results/convergence_v2.json. Physics remains provisional and is not historically validated.
- **Current boundary-model implementation:** a dedicated validated CSV and typed Rust/JavaScript parsers resolve free, rigid-fixture, and compliant-foundation models; cohesive interfaces remain explicitly unsupported. See [docs/BOUNDARY_MODELS.md](./docs/BOUNDARY_MODELS.md). Current integration verification and limitations are recorded in [docs/TEST_REPORT.md](./docs/TEST_REPORT.md).
- **International ammunition simulations:** all eight additional country-grouped records can be selected in comparison mode and fired as explicitly provisional, inert effective-solid-body experiments. Historical evidence stays separate from assumed test mass, speed, geometry and generic material response. These runs do not model explosive effects, APDS sabot separation or HEAT-FS jet formation; they are not validated representations of those rounds. See [docs/INTERNATIONAL_AMMUNITION.md](./docs/INTERNATIONAL_AMMUNITION.md).
- **Projectile geometry:** each ammunition ID resolves a distinct data-driven silhouette used by both the solver's particle envelope and the catalogue preview. International profiles are visibly provisional; unknown caps, sabots and internals are not presented as measured geometry or simulated physics. The preview/overlay does not replace the post-impact particle view.
- Million-particle tier: JS engine builds ~1M particles (4.0 s, ~556 MB RSS) and steps at ~0.74 s/step, i.e. ~53 s wall per simulated µs (a 600 µs run ≈ 9 h). Not usable interactively; physical accuracy at 1M untested. 100k/250k/500k similarly slow. Rust/WASM speed unmeasured.
- Physics is provisional and not historically validated (see docs/PHYSICS_MODEL.md and docs/TEST_REPORT.md).
- The build embeds the original research-pack CSVs in the single-file offline HTML. Penetration tables are displayed as separate historical references, never as solver outcome thresholds. Plate angle conflicts and unknown material/projectile properties remain explicit.

## Build / test (optimized version)
```
rustup target add wasm32-unknown-unknown
npm run build:release   # fails loudly unless real Rust/WASM is embedded
npm test && cargo test --release && npm run smoke
npm run bench           # or bench:quick
```
`npm run build` produces a labelled JS-ONLY file if Rust is missing; `?inline=1` in the URL forces the labelled main-thread mode. See docs/OPTIMIZATION_REPORT.md.
Codespaces: open the repo, the devcontainer runs `scripts/codespace_setup.sh`, or run `bash scripts/codespace_setup.sh`.
