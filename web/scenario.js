/* Shared scenario/preset logic (pure; used by UI and tests). */
(function (root) {
'use strict';
const Boundary = root.ALBoundary || (typeof require === 'function' ? require('./boundary.js') : null);
const losMm = (tMm, slopeDeg) => tMm / Math.cos(slopeDeg * Math.PI / 180);
const noseProfileCode = { rounded: 0, pointed: 1, ogive: 2 };
function projectileGeometry(P, ammoId) {
  const ammo = P.ammunition[ammoId];
  if (!ammo) throw new Error(`Unknown ammunition ID: ${ammoId}`);
  const approximation = ammo.simulation_status === 'experimental_approximation' ? ammo.solver_approximation : null;
  const source = approximation || ammo.simulation_geometry;
  if (!source || !Object.hasOwn(noseProfileCode, source.nose_profile) ||
      !Number.isFinite(source.body_taper_fraction) || source.body_taper_fraction < 0 || source.body_taper_fraction > 0.5) {
    throw new Error(`Ammunition ${ammoId} has no valid projectile geometry profile`);
  }
  const calibreMm = ammo.calibre_mm;
  const lengthMm = approximation ? approximation.length_mm : ammo.length_mm;
  const noseLengthMm = approximation ? approximation.nose_length_mm : ammo.nose_length_mm;
  return {
    calibreMm,
    lengthMm,
    noseLengthMm,
    noseProfile: source.nose_profile,
    bodyTaperFraction: source.body_taper_fraction,
    basis: source.shape_basis || source.basis,
    experimental: !!approximation,
    model: approximation ? approximation.model : ammo.solver_component_model,
    metadataOnlyFeatures: approximation ? approximation.metadata_only_features : (ammo.projectile_components || []).filter((part) => !part.simulated).map((part) => part.role),
    core: ammo.solver_component_model === 'coaxial_core_carrier' ? ammo.projectile_components.find((part) => part.simulated && part.id === 'wc_core') : null
  };
}
function projectileSilhouette(profile, segments) {
  segments = Math.max(8, segments || 40);
  const length = profile.lengthMm * 1e-3, noseLength = profile.noseLengthMm * 1e-3, radius = profile.calibreMm * 0.5e-3;
  const stations = Array.from(new Set([...Array.from({ length: segments + 1 }, (_, i) => length * i / segments), noseLength])).sort((a, b) => a - b);
  const points = [];
  const halfWidth = (u) => {
    if (u < noseLength && noseLength > 0) {
      const f = Math.max(0, Math.min(1, u / noseLength));
      const shape = profile.noseProfile === 'pointed' ? f : profile.noseProfile === 'ogive' ? f ** 0.75 : Math.sqrt(Math.max(0, 1 - (1 - f) ** 2));
      return radius * shape;
    }
    const f = length > noseLength ? Math.max(0, Math.min(1, (u - noseLength) / (length - noseLength))) : 0;
    return radius * (1 - profile.bodyTaperFraction * f);
  };
  for (const u of stations) {
    points.push([length * 0.5 - u, halfWidth(u)]);
  }
  for (let i = stations.length - 1; i >= 0; i--) {
    const u = stations[i];
    points.push([length * 0.5 - u, -halfWidth(u)]);
  }
  return points;
}
function resolveBoundary(P, targetId, selector, opts) {
  opts = opts || {};
  if (!Boundary) throw new Error('Boundary parameter parser is not available');
  let models = P.boundary_models || (root.ARMORLAB_BOUNDARY_CSV ? Boundary.fromCsv(root.ARMORLAB_BOUNDARY_CSV) : null);
  if (!models && typeof module !== 'undefined' && typeof require === 'function') {
    const fs = require('fs'), path = require('path');
    models = Boundary.fromCsv(fs.readFileSync(path.join(__dirname, '../research/ArmorLab_Research_Pack/data/boundary_model_parameters.csv'), 'utf8'));
  }
  if (!models) throw new Error('Boundary parameter database is not available');
  const model = Boundary.resolve(models, targetId, selector == null ? 'rigid_fixture' : selector);
  const effective = Boundary.solverParameters(model);
  let userOverride = false;
  if (model.model_type === 'compliant_foundation') {
    if (opts.supportStiffness != null) {
      effective.stiffnessPaPerM = Number(opts.supportStiffness);
      userOverride ||= effective.stiffnessPaPerM !== model.foundationStiffnessPaPerM;
    }
    if (opts.supportDamping != null) {
      effective.dampingPaSPerM = Number(opts.supportDamping);
      userOverride ||= effective.dampingPaSPerM !== model.foundationDampingPaSPerM;
    }
    if (!(Number.isFinite(effective.stiffnessPaPerM) && effective.stiffnessPaPerM > 0)) throw new Error('Compliant-foundation stiffness must be finite and > 0 Pa/m');
    if (!(Number.isFinite(effective.dampingPaSPerM) && effective.dampingPaSPerM >= 0)) throw new Error('Compliant-foundation damping must be finite and >= 0 Pa*s/m');
  }
  return {
    ...model,
    selected_target_id: targetId,
    effective_stiffness_pa_per_m: effective.stiffnessPaPerM,
    effective_damping_pa_s_per_m: effective.dampingPaSPerM,
    user_override: userOverride
  };
}
function makeConfig(P, targetId, ammoId, opts) {
  opts = opts || {};
  const t = P.targets[targetId], a = P.ammunition[ammoId];
  if (!a) throw new Error(`Unknown ammunition ID: ${ammoId}`);
  const experimental = a.simulation_status === 'experimental_approximation';
  if (a.simulation_status === 'catalogue_only') {
    throw new Error(`Ammunition ${ammoId} is catalogue-only: ${a.simulation_status_reason}`);
  }
  const approximation = experimental ? a.solver_approximation : null;
  if (experimental && (!approximation || approximation.status !== 'experimental_approximation' || approximation.model !== 'effective_solid_body')) {
    throw new Error(`Ammunition ${ammoId} has no explicit experimental inert-body configuration`);
  }
  const pm = P.materials[t.material], jmBase = P.materials[a.material] || {}, S = P.solver;
  const solverMaterial = experimental ? P.materials[approximation.material_id] : jmBase;
  if (experimental && !solverMaterial) throw new Error(`Ammunition ${ammoId} references missing approximation material ${approximation.material_id}`);
  const jm = {
    density_kg_m3: a.projectile_density_kg_m3 != null ? a.projectile_density_kg_m3 : (solverMaterial.density_kg_m3 != null ? solverMaterial.density_kg_m3 : 7850),
    youngs_modulus_Pa: a.projectile_youngs_modulus_pa != null ? a.projectile_youngs_modulus_pa : (solverMaterial.youngs_modulus_Pa != null ? solverMaterial.youngs_modulus_Pa : 200e9),
    yield_stress_Pa: a.projectile_yield_stress_pa != null ? a.projectile_yield_stress_pa : (solverMaterial.yield_stress_Pa != null ? solverMaterial.yield_stress_Pa : 2000e6),
    hardening_ratio_H_over_E: a.projectile_hardening_ratio_h_over_e != null ? a.projectile_hardening_ratio_h_over_e : (solverMaterial.hardening_ratio_H_over_E != null ? solverMaterial.hardening_ratio_H_over_E : 0.02),
    critical_tensile_bond_strain: a.projectile_critical_tensile_bond_strain != null ? a.projectile_critical_tensile_bond_strain : (solverMaterial.critical_tensile_bond_strain != null ? solverMaterial.critical_tensile_bond_strain : 0.04),
  };
  const usesCoreCarrier = a.solver_component_model === 'coaxial_core_carrier';
  const core = usesCoreCarrier && Array.isArray(a.projectile_components)
    ? a.projectile_components.find((component) => component.simulated && component.role === 'tungsten-carbide penetrator core')
    : null;
  if (usesCoreCarrier && (!core || !core.geometry || !a.core_material || !a.interface_material)) {
    throw new Error(`Ammunition ${ammoId} has an incomplete core/carrier solver definition`);
  }
  const coreMaterial = core && a.core_material;
  const interfaceMaterial = core && a.interface_material;
  const boundary = resolveBoundary(P, targetId, opts.support, opts);
  const geometry = projectileGeometry(P, ammoId);
  const c = new Float64Array(40);
  c[0] = opts.n || 18000; c[1] = t.nominal_thickness_mm * 1e-3; c[2] = t.slope_from_vertical_deg; c[3] = t.coupon_face_length_mm * 1e-3;
  const mass = experimental ? approximation.mass_kg : a.projectile_mass_kg;
  const lengthMm = geometry.lengthMm;
  const noseMm = geometry.noseLengthMm;
  c[4] = a.calibre_mm * 1e-3; c[5] = lengthMm * 1e-3; c[6] = noseMm * 1e-3; c[7] = mass;
  const impactVelocity = opts.impactVelocity != null ? opts.impactVelocity : opts.velocity;
  c[8] = impactVelocity != null ? impactVelocity : (experimental ? approximation.initial_velocity_mps : (a.assumed_impact_velocity_mps != null ? a.assumed_impact_velocity_mps : a.nominal_muzzle_velocity_mps));
  c[9] = boundary.solverMode;
  c[10] = opts.plasticity === 'legacy' ? 0 : 1;
  c[11] = pm.density_kg_m3; c[12] = pm.youngs_modulus_Pa; c[13] = pm.yield_stress_Pa; c[14] = pm.hardening_ratio_H_over_E; c[15] = pm.critical_tensile_bond_strain;
  c[16] = jm.density_kg_m3; c[17] = jm.youngs_modulus_Pa; c[18] = jm.yield_stress_Pa; c[19] = jm.hardening_ratio_H_over_E; c[20] = jm.critical_tensile_bond_strain;
  c[21] = opts.kc != null ? opts.kc : S.contact_stiffness_factor; c[22] = opts.dtf != null ? opts.dtf : S.dt_factor; c[23] = S.crush_failure_strain;
  c[36] = boundary.effective_stiffness_pa_per_m;
  c[37] = boundary.effective_damping_pa_s_per_m;
  c[38] = noseProfileCode[geometry.noseProfile];
  c[39] = geometry.bodyTaperFraction;
  c[24] = core ? 1 : 0;
  if (core) {
    c[25] = core.geometry.diameter_mm * 1e-3; c[26] = core.geometry.length_mm * 1e-3;
    c[27] = coreMaterial.density_kg_m3; c[28] = coreMaterial.youngs_modulus_pa; c[29] = coreMaterial.yield_stress_pa;
    c[30] = coreMaterial.hardening_ratio_h_over_e; c[31] = coreMaterial.critical_tensile_bond_strain;
    c[32] = interfaceMaterial.youngs_modulus_pa; c[33] = interfaceMaterial.yield_stress_pa;
    c[34] = interfaceMaterial.hardening_ratio_h_over_e; c[35] = interfaceMaterial.critical_tensile_bond_strain;
  }
  return c;
}
function isHistorical(P, targetId, ammoId) {
  const targetAmmo = P.ammunition[P.targets[targetId].pairing], selectedAmmo = P.ammunition[ammoId];
  if (P.targets[targetId].pairing === ammoId) return true;
  const targetGuns = targetAmmo && targetAmmo.compatible_gun_ids || [];
  const selectedGuns = selectedAmmo && selectedAmmo.compatible_gun_ids || [];
  return targetGuns.some((gunId) => selectedGuns.includes(gunId));
}
/* Outcome from measured state only (no preset-name logic). Thresholds are documented in docs/PHYSICS_MODEL.md. */
function classify(st, vImpact) {
  const vres = st[22], behind = st[24], tfrac = vres / vImpact;
  if (!st[31]) return { label: 'not fired', detail: '' };
  let label;
  if (behind > 0.5) label = 'perforation (projectile body past rear face)';
  else if (behind > 0.0) label = 'partial perforation (part of projectile mass past rear face)';
  else if (vres < -0.05 * vImpact) label = 'rebound (centroid moving back toward shooter)';
  else if (Math.abs(tfrac) < 0.05) label = 'stopped / embedded (centroid speed < 5% of impact)';
  else label = 'in progress (projectile still moving, not past rear face)';
  return { label, detail: `centroid vx ${vres.toFixed(1)} m/s, mass behind rear face ${(behind * 100).toFixed(1)}%, max depth ${(st[25] * 1000).toFixed(1)} mm` };
}
const api = { makeConfig, resolveBoundary, projectileGeometry, projectileSilhouette, losMm, isHistorical, classify };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALScenario = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
