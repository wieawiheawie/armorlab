# ArmorLab physics model (v0.1, PROVISIONAL)

Not a claim of Armor Sandbox's internals (unpublished) and not a 1:1 ballistic reproduction.

## Representation
2D cross-section. Each particle = one numerical element (persistent index, material ID, mass, x, v, bond list, bond damage). Spacing h; mass m = rho*h^2*dz.
Out-of-plane depth dz (plane-strip convention): chosen at build so the projectile's particle mass equals the preset projectile mass exactly (dz≈64 mm); the plate strip uses the same dz. Plate = rotated lattice (spacing h, `layers = t/h` exact), so slope is real geometry. Projectile lattice is axis-aligned.

## Internal forces (bond-based spring lattice)
Bonds to neighbours within 1.5h (axial k, diagonal k/2). Isotropic 2D plane-stress lattice with nu=1/3 when k = 3·E·dz/4 [N/m]. Force on pair: F = k(r − L)·r̂, equal and opposite (pairwise balanced).
Plasticity: elastic stretch limit (σy/E + (H/E)·εp)·L0; excess moves rest length L (permanent set, irreversible), εp accumulates. Plastic work booked = |F|·|ΔL|.
Fracture: bond removed irreversibly when tensile strain (r−L0)/L0 > ε_crit, or crush strain < −0.5. Stored elastic energy ½k(r−L)² moves to the fracture term at that instant.
Contact: penalty repulsion between ALL particle pairs closer than h, independent of bonds (kc = k_axial). Spatial grid (cell 1.5h), O(N).
Integration: velocity Verlet, dt = 0.25·sqrt(m/k). The bond force also includes a small phenomenological velocity-dependent damping term; it is an uncalibrated model choice. There is no friction, thermal model, or detonation/filler.

## Energy ledger (J)
kinetic, elastic bond, plastic work, fracture, contact potential, external constraints (0: clamped particles never move). Residual = total − initial KE; diagnostic only, never tuned.
Finding: the residual is O(dt) (0.56 % / 0.23 % / 0.10 % at dt factor 0.25/0.125/0.06; test NUM-03/04). An earlier formulation booking plastic work as the elastic-energy drop created ~9 % spurious energy (trial overshoot); replaced by work-conjugate |F|·|ΔL|.

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

The simulated particles are numerical elements of a 2D spring/bond lattice, not literal steel grains. The code computes pairwise elastic spring forces, a simple irreversible bond rest-length update for plastic work, bond deletion at configured tension/compression cutoffs, phenomenological velocity-dependent bond damping, and short-range repulsive penalty contact that remains after bonds break. Projectile and plate both use this same particle representation with separate configured generic material parameters; the solver can produce deformation, bond breakage, rebound, fragments and residual projectile motion as emergent state. These are not calibrated models of metallurgical fracture, cap action, shear plugging, ricochet limits or material-rate response.

There is no frictional contact, temperature/thermal softening, strain-rate constitutive law calibrated to material data, explicit plug or spall criterion, weld model, projectile AP-cap/ballistic-cap parts, fuze/filler detonation, HEAT jet, HESH shock/scab, or 3D yaw/fragment geometry. The preset yield, hardening and failure values remain tuning estimates; the damping coefficient is a model choice, not a sourced historical property. No physical-validation claim follows from build or software tests.
