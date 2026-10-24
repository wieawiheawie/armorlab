# ArmorLab optimization report (2026-10-24)

Machine: 1-core Intel Xeon 2.1 GHz, 3.9 GB, Node v22.22.2, Rust 1.75.0 (conda-forge) + wasm32-unknown-unknown. Same physical parameters and dt in every row. Baseline = original engine (`tests/reference_engine.js`).
Method: fresh process per row, hrtime, warm-up, 5 trials, median [min–max]; impact fired (projectile in contact). Stage timers are in `docs/results/benchmark_after.json`. Raw results: `docs/results/benchmark_after.json`. Reproduce: `npm run bench`.
Caveat: single shared core, so run-to-run spread is 10–40% (see min–max); the old audit measured 342 ms/step at 1M for the same baseline, this run 208 ms. Only same-run ratios are meaningful.

| Target N | Actual N | Engine | Step ms (median [min–max]) | Speedup vs baseline | Build ms | Peak RSS MB | Stats full→fast ms | Energy residual @700 steps |
|--:|--:|---|---|--:|--:|--:|---|--:|
| 5000 | 5078 | baseline | 1.639 [1.261–1.958] | 1.00x | 38 | 58 | 16.79 → 16.79 | 0.612% |
| 5000 | 5078 | js-grid | 1.407 [1.308–1.761] | 1.16x | 31 | 58 | 9.61 → 1.78 | 0.617% |
| 5000 | 5078 | js-verlet | 0.866 [0.736–0.998] | 1.89x | 42 | 56 | 9.79 → 1.87 | 0.616% |
| 5000 | 5078 | wasm | 0.643 [0.493–0.775] | 2.55x | 23 | 63 | 0.61 → 0.07 | 0.612% |
| 18000 | 18232 | baseline | 3.885 [3.26–4.501] | 1.00x | 67 | 79 | 19.98 → 19.98 | 0.467% |
| 18000 | 18232 | js-grid | 4.568 [4.212–4.922] | 0.85x | 66 | 61 | 22.43 → 0.41 | 0.479% |
| 18000 | 18232 | js-verlet | 2.527 [2.273–2.85] | 1.54x | 53 | 62 | 17.98 → 0.52 | 0.479% |
| 18000 | 18232 | wasm | 2.307 [1.766–2.689] | 1.68x | 49 | 65 | 2.04 → 0.25 | 0.468% |
| 100000 | 100502 | baseline | 21.922 [21.87–22.034] | 1.00x | 252 | 144 | 47.02 → 47.02 | -% |
| 100000 | 100502 | js-grid | 22.088 [20.268–25.75] | 0.99x | 147 | 85 | 51.97 → 1.74 | -% |
| 100000 | 100502 | js-verlet | 12.375 [11.829–18.656] | 1.77x | 167 | 87 | 35.02 → 1.81 | -% |
| 100000 | 100502 | wasm | 9.121 [8.125–10.12] | 2.40x | 342 | 94 | 8.78 → 1.13 | -% |
| 250000 | 251104 | baseline | 58.798 [54.202–67.398] | 1.00x | 459 | 226 | 109.64 → 109.64 | -% |
| 250000 | 251104 | js-grid | 48.253 [44.67–58.38] | 1.22x | 242 | 131 | 84.83 → 5.41 | -% |
| 250000 | 251104 | js-verlet | 28.928 [28.202–37.758] | 2.03x | 232 | 138 | 61.53 → 5.74 | -% |
| 250000 | 251104 | wasm | 25.16 [20.186–30.748] | 2.34x | 328 | 153 | 23.89 → 2.62 | -% |
| 1000000 | 998956 | baseline | 208.399 [191.682–210.494] | 1.00x | 1312 | 522 | 322.98 → 322.98 | -% |
| 1000000 | 998956 | js-grid | 190.574 [167.557–216.089] | 1.09x | 751 | 359 | 309.28 → 22.68 | -% |
| 1000000 | 998956 | js-verlet | 133.655 [127.7–138.913] | 1.56x | 853 | 390 | 173.13 → 21.27 | -% |
| 1000000 | 998956 | wasm | 105.137 [75.013–120.623] | 1.98x | 1057 | 446 | 117.34 → 12.47 | -% |

Stats columns: cost of the full diagnostic scan (energy + connected components) → cost of the new fast telemetry level. Baseline had only the full scan, run every ~150 ms by the UI.

## What changed (all measured above or covered by tests)
1. Solver runs in a Web Worker (inline Blob, no SharedArrayBuffer); UI thread only uploads snapshots/draws. Inline main-thread fallback is labelled and capped at ~18k particles.
2. Telemetry tiers: fast (every 150 ms), energy ledger (~1 Hz), fragment graph (on pause/complete or ≥2.5 s after new fractures). UI shows "as of" times.
3. Active-bond list (original bond IDs/counters kept; dead bonds dropped lazily when >2% of list).
4. Typed-array preallocated construction (no boxed arrays). Peak RSS after 1M build: 522 → 390 MB (JS), 446 MB (WASM).
5. Contact: Verlet neighbour list (skin 0.4h, rebuild when any particle moves ≥ skin/2) – never-miss test passes at 1500 m/s; grid now expands instead of clamping escaped fragments.
6. Render: material static, damage incremental, speed only in velocity view, `bufferSubData` into reusable buffers; picking via spatial index. Position-only fill at 1M: 27.5 → 2.5–3.8 ms.
7. Same changes ported to the Rust solver; the real WASM is built and embedded; the worker rejects WASM that fails a tolerance parity check against JS.

## Physics tolerances
- Grid mode is bit-identical to the original engine (init + 300 steps, test OPT-01).
- Verlet vs grid after 900 steps: KE, total energy, projectile velocity, depth within 0.5%; fragment count identical.
- Rust/WASM vs JS after 400 steps: all compared stats within 0.2% (OPT-11).
- Energy residual (UI warns above 5%): 5k: 0.612% baseline / 0.612% WASM; 18k: 0.467% baseline / 0.468% WASM / 0.479% JS-Verlet.

## Tests run (all executed here)
Latest integration run: `npm test`: 33 passed, 0 failed. `cargo test --release`: 7 passed. `npm run build:release`: OK, HTML contains the 56 KiB WASM payload. `npm run smoke`: bundled worker source from dist/ArmorLab.html ran in a worker thread with the embedded WASM: backend = WASM, 8 snapshots + done received. Research-pack CSV embedding and parsing are covered by `tests/research.test.js`.

## Limitations (not done / not verified)
- No browser available here: file:// loading, Blob worker creation, WebGL drawing and UI interaction of the final HTML were NOT tested in a real browser. Blob-worker failure falls back to labelled inline mode; WASM parity failure falls back to labelled JS.
- Rendering/upload speed was measured only as CPU fill cost, not GPU upload time. Main-thread long-task behaviour was not measured in a browser.
- The 600 µs full run was not timed end-to-end at large tiers; run-time estimates in the UI are extrapolations labelled as such. 1M remains experimental (≈105 ms/step, ~42,700 steps ≈ 75 min of pure stepping at best).
- js-grid at 18k was 0.85x baseline (extra grid-bounds scan, noise); the default is Verlet. WASM threads/SIMD/WebGPU/adaptive refinement not attempted.
- Toolchain note: Debian's rustc cannot use the official wasm std; used conda-forge Rust 1.75.0 + its wasm32 std. In Codespaces use rustup (`scripts/codespace_setup.sh`).
