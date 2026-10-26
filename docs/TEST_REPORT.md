# Test report (environment: Node v24.21.0, Linux, Rust 1.99.1, wasm32-unknown-unknown)

## Current integration verification
`npm test`: 78 passed, 0 failed. Includes per-round geometry and scale checks, particle-envelope changes, camera zoom invariance, JS/WASM rendered-position parity, support-mode initialization, reaction/impulse, reset, ammunition mechanics, source/unit validation, boundary parsing and standalone HTML checks. The eight international approximation profiles are each built, fired, and advanced in JS and Rust/WASM.
`cargo test --release -- --nocapture`: 37 passed, 0 failed (4 library tests and 33 integration tests; 0 doc tests). `npm run build:release`: PASS; compiled and embedded the 40-value Rust/WASM configuration and 57-value statistics ABI. The existing compiler warning remains: unnecessary `unsafe` block in `src/lib.rs:17`.
`npm run smoke`: PASS; worker selected Rust/WASM with parity against JavaScript, completed a run, and emitted 5 snapshots and 3 stats messages. `git diff --check`: PASS. The 414 KiB standalone HTML embeds the research data and a valid Rust/WASM payload (~76 KiB), including the catalogue preview and geometry-aware scenario code. No external script/style/fetch dependency was introduced.
Browser `file://`/WebGL verification: NOT RUN; Chromium/Chrome/Firefox and Playwright/Puppeteer are unavailable in this environment. The offline build was verified by automated HTML/asset checks and worker smoke, not by an interactive browser. No historical physical validation was added; software tests do not establish material or ballistic accuracy.

The eight new international entries are visible in country-grouped catalogue options and can be selected in comparison mode. Each receives a separate, visibly provisional inert-body test configuration. The app labels profile values and source/assumption basis and explicitly excludes explosive, APDS sabot-discard, and HEAT-FS jet behavior. These are solver demonstrations, not validated representations of the historical rounds.

Every ammunition ID has a distinct geometry profile. The rounded/pointed/ogive nose and taper parameters affect the sampled solver particle envelope; the same profile generates the pre-fire silhouette and catalogue preview. International geometry is provisional, and unmeasured cap, windshield, sabot, fin, and cavity geometry is not drawn as verified construction. The zoom transform is display-only. Post-fire viewing uses the deformed particle renderer rather than a rigid silhouette overlay.

The controlled two-particle penalty-contact case exchanges momentum to roundoff; at dt factor 0.25 its final relative energy error is about 0.61%, falling to about 0.045% at factor 0.125. The isolated undamped spring and dynamic plastic-bond tests show lower energy error when dt is halved. Free-flight position and velocity agree with uniform-motion kinematics across two particle spacings. Those are numerical software checks, not material or ballistic validation.

Earlier performance and convergence measurements below are retained as historical software runs; they are not physical validation.

## Convergence (600 µs, clamped ends, kinetic-only, idealised muzzle-speed impact) — docs/results/convergence.json
Tiger I: n=2.4k/5.1k/10.2k/18.2k → projectile centroid vx 413/423/444/441 m/s; depth 276/300/307/315 mm; plastic fraction 0.48/0.47/0.45/0.44; legacy-ledger residual 0.5–0.8 %; fragment count 38/66/75/173 (NOT converged). Velocity & energy split roughly converge (~1 % 10k→18k); depth still drifting ~2.5 %.
Tiger II: 4.9k/10.2k/17.9k → vx 220/222/226 m/s, projectile mass behind rear face ~5.5 %, depth 205/209/216 mm; fragments 157/332/484 (not converged).
Resulting outcomes (Tiger I: perforation; Tiger II: partial perforation) come from untuned-to-data provisional materials; NOT validated against historical results. 100k+ tiers not run to completion (cost), so convergence beyond 18k is untested.
The legacy residuals above used a work-conjugate plastic-work estimate and older model behavior. The current default uses an explicit isotropic-hardening return map with separate stored hardening energy and cumulative plastic dissipation. The corrected 150 µs, 3k-particle software case has residuals of about 0.45%, 0.23%, and 0.11% at dt factors 0.25, 0.125, and 0.0625. Earlier ablations using a superseded ledger are historical diagnostics only, not additive error shares and not interchangeable with the current results. These numbers are not physical validation.

## Boundary-condition comparison
Equivalent Tiger II glacis/Pzgr.39/43 software runs (3,092 particles, 150 µs, same initial state; compliant preset stiffness 1e12 Pa/m, zero damping) showed that support choice affects deformation and fragment metrics but does not by itself explain the extensive impact damage. Rigid fixture: mean/max displacement 7.76/54.73 mm, 25 fragments, 1,456/11,850 bonds broken, support impulse (−1513.5, −413.8) N·s, zero fixture work, 0.446% energy residual. Free plate: 9.67/58.89 mm, 29 fragments, 1,473 bonds broken, zero support impulse, 0.439% residual. Compliant foundation: 8.26/51.66 mm, 29 fragments, 1,459 bonds broken, support impulse (−1103.1, −22.9) N·s, work −22.5 kJ, stored foundation energy 22.3 kJ, zero damping loss, 0.434% residual. The compliant coefficients are numerical reference values, not measured hull or fixture properties; these comparisons are solver sensitivity studies, not realistic hull-support validation.

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
