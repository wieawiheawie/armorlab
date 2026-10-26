# Boundary-model data and limitations

`research/ArmorLab_Research_Pack/data/material_and_solver_parameter_checklist.csv` is a research checklist, not an executable parameter table. Its `what_source_or_calibration_is_needed` and `current_status` columns contain guidance and uncertainty prose; it intentionally does not provide complete, validated solver values. It remains unchanged.

`research/ArmorLab_Research_Pack/data/boundary_model_parameters.csv` is the dedicated machine-readable boundary-model table. It is listed in the research manifest, embedded byte-for-byte into the offline HTML, and also embedded at Rust compile time for native/WASM parsing. The typed parser in `src/boundary.rs` validates its schema, numeric finiteness and signs, units, model/mode pairings, unique IDs, local direction vectors, and provenance fields. The JavaScript parser in `web/boundary.js` applies matching validation before `web/scenario.js` resolves a selected target/model. The UI and worker receive the same CSV data; only numeric solver inputs cross the WASM ABI.

## Implemented model types

| Model | Parameters and meaning | Runtime status |
|---|---|---|
| `free` | No applied support force and no constrained particles. | Implemented |
| `rigid_fixture` | Prescribed fixed coupon end regions; reaction and support impulse are reported. The fixture is not simulated. | Implemented |
| `compliant_foundation` | Distributed translational spring and dashpot coefficients per represented area. | Implemented as an explicitly provisional numerical foundation |
| `cohesive_interface` | Schema for a damageable joint; it is not a support foundation. | Unsupported and disabled; no cohesive law exists in the solver |

For the compliant foundation, `foundation_stiffness` is `κ` in Pa/m (`N/m³`) and `foundation_damping` is `c_A` in Pa·s/m (`N·s/m³`). A boundary particle represents area `A_i = h·dz` in the plane-strip convention. The per-particle coefficients are `k_i = κ A_i` in N/m and `c_i = c_A A_i` in N·s/m. For displacement from the initial reference position `u_i` and velocity `v_i`, the applied force is `F_i = -k_i u_i - c_i v_i` in N. Stored spring energy is `½ k_i |u_i|²` in J; dashpot loss integrates `c_i |v_i|²` over time in J. External force work, stored elastic energy and damping loss remain separate ledger entries. Foundation coefficients constrain the timestep only when this model is selected.

The CSV's `1e12 Pa/m` stiffness and zero damping are software reference values only. Their provenance and uncertainty explicitly say they are not measured or calibrated for a Tiger hull, welded joint, or real fixture. A UI-edited coefficient is shown as a user override; it is not relabeled as sourced.

## Cohesive-interface schema (not currently executable)

The table reserves separate normal and shear stiffnesses in Pa/m, tensile and shear strengths in Pa, Mode-I and Mode-II critical fracture energies in J/m², a mixed-mode exponent (dimensionless), effective area in m², and local unit normal/tangent vectors (dimensionless). The intended stiffness meaning is traction in Pa per separation in metres, equivalent to N/m³. The local directions must be orthonormal; they are not presumed to align with global X/Y. Unit columns are mandatory for this model even while its parameter values are unknown.

The Tiger II glacis-joint row records source references and uncertainty but leaves strengths, fracture energies, area, and local geometry unknown. The Rust parser represents those values as `Option<f64>` and does not fill them with plausible defaults. It rejects attempts to resolve the row into solver inputs. There is no damage initiation, mixed-mode traction–separation response, irreversible damage evolution, unloading/reloading rule, complete-separation transition, or cohesive energy ledger in either engine. The row is therefore schema/provenance only and is not offered as a selectable simulation model.

Implementing the interface later requires applicable joint and heat-affected-zone evidence, a defined interface geometry/area and local frame, a calibrated mixed-mode fracture law, and resolution/timestep studies against physical interface tests. No weld strength is inferred from armour yield strength or from a desired impact result.
