# ArmorLab v0.2 – implementation report

This is an incremental upgrade of the existing experimental bond-lattice solver, not the full continuum-engine roadmap. It does not implement FEM, SPH, MPM, an equation of state, Johnson–Cook, thermal coupling, or experimentally validated impact physics.

## Implemented
1. **Armour energy accounting root cause fixed.** The ~9–10 % positive energy residual was a ledger error, not energy creation: plastic dissipation was booked as the elastic-trial stored-energy drop, which exceeds the work of the capped force by ½kL0²γ² per update. Now booked as ∫F dp (end-point force). Trajectories are unchanged; residual is ~0.4 % (first order in dt: 0.45 → 0.23 → 0.11 % for dt factor 0.25/0.125/0.0625). Fracture energy is booked after projection onto the yield surface. Rust and JS engines changed identically.
2. **Support-reaction impulse ledger** (stats 36–37): momentum balance closes to <2e-3 (clamped); free support conserves momentum exactly.
3. **Component diagnostics** (stats 38–43): projectile mass/KE per material, resolved fragments vs single-particle debris. Raw fragment counts scale with particle count (artifact); residual speed/damage fraction do not.
4. **Ammunition data corrected to evidence:** Pzgr.39/43 had an unsourced stronger/less ductile steel than Pzgr.39; two secondary sources say the body is the same (wider driving bands only). Both now share one body estimate; they differ in mass, speed, gun. Fuze/filler masses and mass-convention conflicts (10.16 / 10.34 / 10.4 kg; 59 vs 64 g filler) recorded in presets. Rust presets mirrored.
5. **Tests:** 17 new JS tests (tests/armor_validation.test.js) + 7 new Rust tests: start state, stability, geometry/mass, momentum/energy, timestep/spacing consistency, ammunition trace, APCR core/carrier/interface participation, no hard-coded outcomes. Updated 4 existing ledger-identity tests to the new, correct identities.
6. `scripts/convergence_study.js` → `docs/results/convergence_v2.json`.

## Results
Verified on 2026-10-25:

- `npm run build:release` — PASS; standalone `dist/ArmorLab.html` is 303 KiB with a real 66 KiB Rust/WASM payload and labelled JS fallback.
- `npm test` — PASS; 65 passed, 0 failed, including WASM parity.
- `cargo test --release` — PASS; 28 passed, 0 failed.
- `npm run smoke` — PASS; worker completed using Rust/WASM (parity-checked against JS).
- `git diff --check` — PASS.
- Browser/WebGL `file://` test — NOT RUN; no browser or Playwright/Puppeteer is installed.

The tests verify software behavior and selected numerical identities, not experimental validity.

## Estimated / unknown (unchanged unless noted)
Plate yield 1000 MPa, hardening, critical strain 0.08 (tuning, no source) · plate chemistry/heat treatment · projectile steel E/σy/hardening/critical strain (generic) · projectile length 250 mm and nose 90 mm (placeholders) · AP cap and wind-cap dimensions/materials (not found; NOT simulated) · fuze/filler geometry (not simulated; 3.3 % mass inside body) · APCR core 45×160 mm, WC properties, interface law, carrier steel (estimates; TM Type 40 core 35.7×138.1 mm / 1.93 kg not substituted) · impact velocity = muzzle velocity (no drag) · Tiger I plate angle 8° (research) vs 9° (scenario), Tiger II angle datum · mass conflicts above · damping coefficient (model choice).

## Remaining approximations / unsupported
2D plane strain (not axisymmetric): APCR core carries ~50 % of mass in model vs ~27 % in TM Type 40 data; no yaw/3D. Bond-level strain fracture is not a calibrated ductile/shear-band law; no strain-rate, thermal softening, friction, plug/spall criterion (no calibrated constants – investigated, not added). APCBC caps, filler/fuze, HE function, APCR windshield not simulated. HEAT/HESH/APDS/APFSDS not added or claimed. Results are not historical penetration predictions.

## Deliverable
`ArmorLab_Implementation.zip` is a portable project snapshot including source, tests, research data, documentation, required assets and the generated standalone HTML. It excludes `.git`, `node_modules`, Rust `target` intermediates, and older unrelated ZIP archives. Recreate the embedded release with `npm run build:release`.

## Data-driven boundary models
The prose `material_and_solver_parameter_checklist.csv` remains research-only. Boundary configuration is in the separate, manifest-listed `data/boundary_model_parameters.csv`, embedded in the offline HTML and Rust binary. Rust and JavaScript validate model identity, availability, units, finite/non-negative coefficients and provenance before scenario resolution. Free plate, rigid fixture, and compliant foundation resolve to distinct solver inputs; foundation stiffness and damping are distributed per area (Pa/m and Pa·s/m) and converted using each node's represented area. Their included numerical coefficients are provisional, not measured Tiger II hull properties.

The cohesive-interface entry preserves source references but leaves joint strength, fracture energy, heat-affected-zone properties and geometry unknown. It is schema-only and rejected for solver use: there is no supported traction–separation damage law. A foundation is not represented as a weld or adjacent hull structure. The smoke harness now loads the same boundary CSV explicitly in Node rather than bypassing configuration validation.
