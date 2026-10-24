/* Shared scenario/preset logic (pure; used by UI and tests). */
(function (root) {
'use strict';
const losMm = (tMm, slopeDeg) => tMm / Math.cos(slopeDeg * Math.PI / 180);
function makeConfig(P, targetId, ammoId, opts) {
  opts = opts || {};
  const t = P.targets[targetId], a = P.ammunition[ammoId], pm = P.materials[t.material], jm = P.materials[a.material], S = P.solver;
  const c = new Float64Array(24);
  c[0] = opts.n || 18000; c[1] = t.nominal_thickness_mm * 1e-3; c[2] = t.slope_from_vertical_deg; c[3] = t.coupon_face_length_mm * 1e-3;
  c[4] = a.calibre_mm * 1e-3; c[5] = a.length_mm * 1e-3; c[6] = a.nose_length_mm * 1e-3; c[7] = a.projectile_mass_kg;
  c[8] = opts.velocity != null ? opts.velocity : a.nominal_muzzle_velocity_mps; c[9] = opts.support || 0;
  c[11] = pm.density_kg_m3; c[12] = pm.youngs_modulus_Pa; c[13] = pm.yield_stress_Pa; c[14] = pm.hardening_ratio_H_over_E; c[15] = pm.critical_tensile_bond_strain;
  c[16] = jm.density_kg_m3; c[17] = jm.youngs_modulus_Pa; c[18] = jm.yield_stress_Pa; c[19] = jm.hardening_ratio_H_over_E; c[20] = jm.critical_tensile_bond_strain;
  c[21] = opts.kc != null ? opts.kc : S.contact_stiffness_factor; c[22] = opts.dtf != null ? opts.dtf : S.dt_factor; c[23] = S.crush_failure_strain;
  return c;
}
function isHistorical(P, targetId, ammoId) { return P.targets[targetId].pairing === ammoId; }
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
const api = { makeConfig, losMm, isHistorical, classify };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALScenario = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
