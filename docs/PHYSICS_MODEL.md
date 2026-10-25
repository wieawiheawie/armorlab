# ArmorLab physics model (v0.1, PROVISIONAL)

Not a claim of Armor Sandbox's internals (unpublished) and not a 1:1 ballistic reproduction.

## Representation
2D cross-section. Each particle = one numerical element (persistent index, material ID, mass, x, v, bond list, bond damage). Spacing h; mass m = rho*h^2*dz.
Out-of-plane depth dz (plane-strip convention): chosen at build so the projectile's particle mass equals the preset projectile mass exactly (dz≈64 mm); the plate strip uses the same dz. Plate = rotated lattice (spacing h, `layers = t/h` exact), so slope is real geometry. Projectile lattice is axis-aligned.

## Internal forces (bond-based spring lattice)
Bonds connect same-material neighbours within 1.5h (axial k, diagonal k/2). The nominal lattice calibration is an isotropic 2D plane-stress lattice with nu=1/3 when k = 3·E·dz/4 [N/m]. For bond separation r and current rest length L, the spring force is F_s = k(r − L)·r̂, equal and opposite on the two particles.

The implemented viscous bond term adds F_d = c·v_n·r·r̂, where v_n is relative radial velocity and c is the material's small phenomenological rate coefficient. Its pair power is non-positive: P_d = −c·r·v_n². This term is uncalibrated; its lost energy is estimated by trapezoidal time integration of c·r·v_n² at force evaluations.

Plasticity compares elastic extension with (σy/E + (H/E)·εp)·L0; excess extension changes L irreversibly and increments εp. The diagnostic records the exact spring-potential drop for that update at fixed particle positions, ½k[(r−L_old)² − (r−L_new)²]. This is an energy-accounting calculation for the implemented spring state, not a validated thermodynamic plastic-work or heat model.

Fracture removes a bond irreversibly when tensile strain (r−L0)/L0 > ε_crit, or compressive strain falls below the configured crush cutoff. At deletion, the current recoverable spring energy ½k(r−L)² is removed from elastic energy and assigned to the fracture ledger. This transfer keeps the deleted spring's energy visible; it is not a measured fracture-surface energy and does not determine how much becomes heat, kinetic energy, or new surfaces.

Contact is a conservative penalty repulsion between every particle pair closer than h, independent of bonds: F_c = −kc(h−r)·r̂ and U_c = ½kc(h−r)². A spatial grid / Verlet candidate list accelerates pair search. There is no tangential friction or contact damping.

Integration is velocity Verlet with dt = 0.25·sqrt(m_min/k_max) by default. Clamped particles never move, so their boundary work is zero, but their support reactions can change the momentum of the moving particles. Total momentum is conserved only for a free system with pairwise internal forces and no external boundary constraints.

## Diagnostics and energy accounting (J)
The slow energy pass measures total kinetic energy, recoverable energy in intact springs, and instantaneous contact potential. It also reports calculated cumulative spring-potential drop at irreversible rest-length updates, calculated spring energy assigned to broken bonds, and estimated viscous damping loss. The accounted total is the sum of those terms; external constraint work is zero by construction. The relative residual is `(accounted total − initial impact KE) / initial impact KE`.

The residual is an accounting diagnostic, not a conservation claim. It includes integration error and any energy transfer not represented by the ledger. In a full impact using current guessed material parameters, the residual at 150 µs is about 10.0%, 5.0%, and 2.4% for dt factors 0.25, 0.125, and 0.06 respectively under the exact rest-update potential-drop diagnostic. These values are timestep-sensitive and are not physical validation. Earlier reported residuals used a different, work-conjugate estimate for plastic dissipation and are not comparable to this ledger. In a controlled two-particle penalty-contact benchmark without bonds, plasticity, fracture or damping, halving dt from 0.25 to 0.125 reduces the relative energy error from about 0.61% to 0.045%; momentum is conserved to roundoff. An isolated undamped elastic bond similarly shows decreasing energy error with timestep.

The full-impact residual reveals energy-closure limitations associated with abrupt plastic rest updates and explicit integration. The current model has no separate heat/thermal state, physical fracture-energy law, support impulse ledger, or contact friction dissipation. Those quantities must not be inferred from the residual, nor hidden by labeling the simulated energy as conserved.

## Outcome classification (from state only)
Projectile mass fraction past rear face plane, mass-weighted centroid velocity vs impact speed: >50 % behind → perforation; >0 → partial; centroid vx < −5 % v → rebound; |v| < 5 % v → stopped; else in progress. Thresholds are arbitrary documentation choices.

## Calibration status
| item | status |
|---|---|
| plate/projectile geometry thickness & slope | nominal values are reported in the research pack; Tiger I upper-front angle differs (8° record vs 9° existing setting), Tiger II source angle datum remains unresolved; coupon length is ArmorLab choice |
| projectile mass, muzzle speed | sourced (secondary refs); muzzle speed is used as an IDEALISED impact speed |
| projectile length/nose shape, solid body | placeholder, not sourced |
| density, E | generic steel |
| yield stress, hardening, critical strains | TUNING GUESSES, provisional, uncalibrated, unvalidated |
| plate chemistry/heat treatment | unknown, not modelled |
Results therefore must not be read as historical penetration predictions.

## Integrated research data and solver limits

The build embeds the original research-pack CSV files from `research/ArmorLab_Research_Pack/data/` into the offline HTML. `web/research.js` parses their reported cells without replacing source text; strict numeric fields are `null` when a cell is approximate, ranged, or otherwise not a single numeric value. The UI's starting scenario mass, muzzle velocity, calibre and nominal plate thickness are linked to the corresponding research records. Gun IDs and projectile IDs remain separate. An unresolved source-angle conflict is shown rather than silently selected (Tiger I upper-front scenario: existing 9° setting versus the research record's reported 8°).

Reference penetration tables and validation cases are displayed/stored as evidence only. No reference-curve value is read by the solver or outcome classifier. The table series are not averaged, and a range is not treated as impact velocity.

The simulated particles are numerical elements of a 2D spring/bond lattice, not literal steel grains. The code computes pairwise elastic spring forces, irreversible bond rest-length updates, bond deletion at configured tension/compression cutoffs, phenomenological velocity-dependent bond damping, and short-range repulsive penalty contact that remains after bonds break. Projectile and plate both use this same particle representation with separate configured generic material parameters; the solver can produce deformation, bond breakage, rebound, fragments and residual projectile motion as emergent state. These are not calibrated models of metallurgical fracture, cap action, shear plugging, ricochet limits or material-rate response.

There is no frictional contact, temperature/thermal softening, strain-rate constitutive law calibrated to material data, explicit plug or spall criterion, weld model, projectile AP-cap/ballistic-cap parts, fuze/filler detonation, HEAT jet, HESH shock/scab, or 3D yaw/fragment geometry. Particle-spacing tests currently verify exact free-flight kinematics only; a comparable impact-resolution study is not supported because changing the requested particle count also changes spacing, projectile sampling, out-of-plane depth, particle mass, and lattice topology. The preset yield, hardening and failure values remain tuning estimates; the damping coefficient is a model choice, not a sourced historical property. No physical-validation claim follows from build or software tests.
