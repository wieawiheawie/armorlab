# ArmorLab: sourced ballistics research & simulation handoff

**Purpose:** a source-traceable starter dataset for a physics-led armour-impact simulation, initially focused on Tiger I / Tiger II and the German 8.8 cm Pzgr.39 family. This is not a ready-to-claim “realistic ballistics” parameter set. It documents what is known, what is only a secondary-source benchmark, and what remains unknown.

## The core rule

**Do not use a hard-coded penetration millimetre value to decide an impact.** A table value is a measured or calculated result for a specific gun/round, velocity or range, target material/hardness, plate geometry/angle, test setup and penetration criterion. It is neither a universal property of the round nor a guarantee against all materials.

Use the `historical_penetration_reference_curves.csv` only as a validation target after the original angle and acceptance criterion are verified. Preserve the separate sources where the published curves disagree. Do not average them. Do not translate “202 mm at 100 m” into `if plate_thickness <= 202 then penetrates`.

## What the initial data supports

- Historical headline projectile mass and muzzle velocity for the 8.8 cm KwK 36/Pzgr.39 family and KwK 43/Pzgr.39/43 family.
- Initial armour geometry records for Tiger I and Tiger II plates, including important distinctions between hull, turret face, mantlet, sides, early Porsche-pattern Tiger II turret and production turret.
- Sample-specific hardness observations reported from captured vehicles. These are not universal fleet material constants.
- Test outcomes that include non-penetrating dents, cracking, spalling, weld failure, edge/joint penetration and multi-hit failure—not only binary pass/fail.
- Research literature and standards for ballistic limits, probability-of-perforation, oblique impact, layered targets, strain-rate calibration and behind-armour debris.

## What the research does not yet provide

We do not yet have fully authenticated and machine-readable primary test tables for every shot, the full mechanical property curves for exact Tiger I/Tiger II plates, exact material constants for each shell body/cap, or a complete validated dataset of projectile shape and material by manufacturing batch. Historical surface hardness is only one measured property; it is not enough to determine high-strain-rate strength, fracture strain, toughness, spall response or weld behaviour. Missing values in the CSVs are deliberately unknown rather than invented.

## How to model the probability without cheating

1. Resolve each impact from the current physical state: incoming velocity vector and speed, projectile orientation, local plate normal, impact point, plate thickness/geometric layers and current accumulated damage.
2. Solve contact, deformation, projectile failure/erosion, plate plasticity, cracking and fracture. Account for energy transfer and the remaining projectile velocity/state. Possible outcomes include ricochet, dent/partial penetration, plugging, full perforation with residual velocity, projectile breakup, rear-face spall and structural/weld damage.
3. Represent material variation only through explicit, logged property/geometry fields or sampled defect distributions. Since a deterministic solver returns the same answer for the same exact state, run repeated shots with varied measured/estimated conditions to estimate a perforation probability. Do not add an arbitrary random “penetration chance” after the physical solve.
4. Compare the predicted outcome distribution to actual experimental series. A V50 test is specifically about an approximately 50% perforation velocity for a particular test threat/configuration. Use its uncertainty and test protocol, not the V50 number as a universal one-shot threshold.
5. Log each run: source/variant IDs, material sample, particle resolution, model version, random seed, impact speed/angle, impact point, damage state, energy ledger, fragments, perforation criterion and solver warnings.

NIST's analysis of ballistic-limit uncertainty is particularly relevant: depending on armour construction, the perforation-probability transition may be sharp or gradual; V50 uncertainty depends on test count, test sequence and model assumptions. Read S01–S03 before making the probability system.

## Proposed solver hierarchy

### A. First: general steel coupon and simple ogive benchmark

Use the published normal-impact study of a 20 mm ogive projectile against 20, 40 and 80 mm steel plates (S21) to validate trends in penetration depth, crater/bulge geometry and energy absorption. Then use the 6.2 mm AP/mild steel obliquity data (S20) to validate the angle, residual velocity and ricochet behaviour. These are **not** a direct scale model of 88 mm APCBC against WWII armour; they validate mechanics separately.

If the current solver is a circle-based discrete particle model, calibrate its bonds/contact network against bulk elastic response, flow stress, fracture and coupon impacts. Circles are a numerical discretization—not real steel grains—unless the model is deliberately designed and validated at that microstructural scale. Particle-size reduction must converge toward similar physical results. Keep plane-strain/2D limitations explicit; a 2D slice cannot fully capture 3D cap, yaw, fragment and local geometry effects.

### B. Second: deformable APCBC projectile

Pzgr.39-family ammunition needs a steel body, distinct armour-piercing cap, distinct ballistic wind cap, and (if post-penetration effects are enabled) base fuze and explosive cavity. The cap changes the impact process; it is not simply decoration. The ballistic cap should not be modelled as though it were the structural AP cap. Use the drawings/manuals in S04–S06 to identify the exact variant before taking dimensions.

### C. Third: Tiger plate variants

Use separate geometry and material sample IDs for hull front, lower nose, turret face, curved mantlet, upper sides, turret side and panel/weld joints. Do not merge every surface into “100 mm Tiger armour”. The Tiger II's production flat 180 mm turret front is not the same as the earlier curved Porsche-pattern turret. The first 50 turret-plate specifications also differ from later production context in the cited historical monograph.

Resolve the angle datum for the Tiger II's 150 mm glacis from a measured drawing before final lock. Preserve each historical source's angle wording in the data. The simulation's own single convention should be **angle between the incoming velocity and the target-surface normal**, where 0° means normal impact.

### D. Fourth: historical calibration

Use the historical penetration curve only as a multivariate calibration target: gun + exact projectile variant + range/impact velocity + plate material/hardness + angle definition + penetration criterion. The two tables in the CSVs do not fully agree. The 2026 transcription reports a 50% perforation criterion on RHA HB 275–302 for its table, while the Panzerworld table does not fully restate that criterion in the page body. Do not call these identical datasets; investigate the cited primary manual pages first.

Also validate non-binary damage. The Soviet Tiger II test summaries report cracking/spalling, rear-side damage after stops, weld-seam weakness, edge/joint penetration and multi-hit structural failure. That evidence supports modelling accumulated damage and plate-to-plate variation, but it is not a precise, fully controlled Pzgr.39 ballistic-limit series.

## Ammo families cannot share one solver

- **AP/APC/APCBC:** kinetic impact, projectile/plate deformation and failure; caps and projectile shape matter.
- **APHE:** the penetration phase is still mechanical AP; the base fuze and filler affect the post-penetration result only after functioning conditions/delay.
- **APCR/HVAP:** high-density core and lighter body/sheath need separate states and material properties.
- **APDS/APFSDS:** subcalibre penetrator or long rod; distinct geometry, erosion and material response.
- **HEAT:** shaped-charge liner collapse and jet penetration; not a solid projectile that shoves particles aside.
- **HESH/HEP:** shock and rear-face scabbing/spall; not conventional perforation.
- **HE:** blast and fragmentation/structural effects, which may damage welds, tracks, optics or thin armour without acting like an AP penetrator.

A physics-led model can eventually support all of these, but a single “penetration” calculation cannot faithfully cover them all. Implement each mode only when it has a separate model and validation set.

## Evidence grading

- **A:** primary official manual/test standard/technical report or a peer-reviewed experimental dataset with stated conditions.
- **B:** archival report transcription or a credible technical synthesis with primary-source references. Useful, but the original document should be acquired for high-confidence numeric calibration.
- **C:** specialist secondary reference / museum educational overview. Good for discovery, taxonomy or initial geometry, not sufficient by itself for constitutive parameters.
- **D:** unsourced forum/game table or claim. Use only as a search lead, never as accepted physical data.

The source register is not a claim that every link is equally authoritative. Its `evidence_grade` and `limits` fields are part of the data. Check file-level licenses before reusing any images.

## Files in `data/`

- `source_register.csv` — source provenance, grade, use and limitations.
- `ammunition_variants.csv` — distinct 8.8 cm rounds, properties and model requirements.
- `armor_surfaces_and_samples.csv` — Tiger I/Tiger II geometry, sample readings and ambiguity flags.
- `historical_penetration_reference_curves.csv` — separate source curves; validation-only, not impact rules.
- `validation_cases.csv` — laboratory and historical outcomes with explicit missing values.
- `material_and_solver_parameter_checklist.csv` — required physical data and current gaps.
- `ammunition_mechanism_models.csv` — why AP, APCR, APFSDS, HEAT, HESH and HE require different mechanisms.
- `image_and_drawing_references.csv` — image/archive links plus reuse and engineering caveats.
- `implementation_milestones.csv` — suggested staged implementation and exit tests.

## Short implementation directive for Copilot/Claude

> Read `ArmorLab_Research_Pack/README.md` and all CSVs before changing the physics. Do not create a fixed penetration threshold from the historical tables. Preserve conflicting source curves and missing material properties as unknown. Implement the simulation in stages: generic coupon/ogive validation, oblique impact/ricochet, deformable multi-part APCBC, then Tiger I/Tiger II geometry and historical calibration. Log full impact state and energy, produce damage outcomes beyond binary pass/fail, and estimate perforation probability only from repeated runs with explicit variation and validation. Do not use the AP solver for APCR/APDS/APFSDS/HEAT/HESH/HE. Do not overwrite unrelated work or existing working builds. Report every assumption, source ID, test and unresolved issue.
