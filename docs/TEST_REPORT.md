# Test report (environment: Node v24.21.0, Linux, Rust 1.99.1, wasm32-unknown-unknown)

## Current integration verification
`npm test`: 33 passed, 0 failed, including research CSV parsing, provenance, unknown-value handling, distinct ammunition/gun variants, source-specific reference curves, and release HTML data embedding.
`cargo test --release`: 7 passed, 0 failed. `npm run build:release`: PASS; compiled and embedded a 56 KiB Rust/WASM core. One pre-existing compiler warning remains: unnecessary `unsafe` block in `src/lib.rs:14`.
`npm run smoke`: PASS; the bundled worker loaded Rust/WASM, parity-checked it against JS, and completed a run (8 snapshots). Release HTML includes all nine original research CSVs and existing build tests verify no external script/style/fetch dependencies.
Browser `file://`/WebGL smoke: NOT RUN in this integration because Playwright is unavailable. No historical physical validation was added; available test summaries omit conditions needed to reproduce exact impacts.

Earlier performance and convergence measurements below are retained as historical software runs; they are not physical validation.

## Convergence (600 µs, clamped ends, kinetic-only, idealised muzzle-speed impact) — docs/results/convergence.json
Tiger I: n=2.4k/5.1k/10.2k/18.2k → projectile centroid vx 413/423/444/441 m/s; depth 276/300/307/315 mm; plastic fraction 0.48/0.47/0.45/0.44; residual 0.5–0.8 %; fragment count 38/66/75/173 (NOT converged). Velocity & energy split roughly converge (~1 % 10k→18k); depth still drifting ~2.5 %. 
Tiger II: 4.9k/10.2k/17.9k → vx 220/222/226 m/s, projectile mass behind rear face ~5.5 %, depth 205/209/216 mm; fragments 157/332/484 (not converged).
Resulting outcomes (Tiger I: perforation; Tiger II: partial perforation) come from untuned-to-data provisional materials; NOT validated against historical results. 100k+ tiers not run to completion (cost), so convergence beyond 18k is untested.

## Benchmark (JS engine, 1 thread, first 5–200 steps; 5k/18k contended by a concurrent job) — docs/results/benchmark.json
| particles | bonds | build s | ms/step | dt ns | wall s per sim µs | RSS MB |
|---|---|---|---|---|---|---|
| 5,078 | 19.6k | 0.1 | 4.9 | 197 | 0.025 | 56 |
| 18,232 | 71.6k | 0.15 | 15.0 | 104 | 0.144 | 79 |
| 100,502 | 399k | 0.8 | 77.7 | 44 | 1.75 | 137 |
| 251,104 | 999k | 1.6 | 183 | 28 | 6.5 | 304 |
| 499,944 | 1.99M | 2.2 | 382 | 20 | 19.2 | 309 |
| 998,956 | 3.99M | 4.1 | 744 | 14 | 52.9 | 556 |
No allocation failures; but 1M is not interactive and was not run through an impact.
