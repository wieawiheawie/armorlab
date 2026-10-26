/* ArmorLab material library: appearance + evidence + solver link, strictly separated. Pure (browser global ALMaterials / CommonJS). */
(function (root) {
'use strict';
const HEX = /^#[0-9a-fA-F]{6}$/;
const APPEARANCE_ONLY = ['base', 'light', 'dark', 'roughness', 'reflectivity', 'finish'];
const PHYSICAL_KEYS = ['density', 'youngs_modulus', 'yield_stress', 'hardening_ratio', 'critical_tensile', 'density_kg_m3', 'youngs_modulus_Pa', 'yield_stress_Pa'];
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
function validate(lib, sourceIds) {
  const errors = [], seen = new Set();
  if (!lib || lib.schema !== 'armorlab-material-library-1' || !Array.isArray(lib.materials)) return ['material library: wrong schema'];
  for (const m of lib.materials) {
    const id = m && m.id;
    if (typeof id !== 'string' || !/^MAT_[A-Z0-9_]+$/.test(id)) { errors.push(`bad material id ${id}`); continue; }
    if (seen.has(id)) errors.push(`duplicate material id ${id}`); seen.add(id);
    if (!m.name) errors.push(`${id}: missing name`);
    if (!['documented_class', 'provisional', 'unverified', 'reference_only'].includes(m.status)) errors.push(`${id}: bad status`);
    if (!m.evidence || typeof m.evidence.summary !== 'string' || !Array.isArray(m.evidence.source_ids)) errors.push(`${id}: evidence block incomplete`);
    else if (sourceIds) for (const s of m.evidence.source_ids) if (!sourceIds.has(s)) errors.push(`${id}: unknown source ${s}`);
    if (!m.confidence || !m.uncertainty) errors.push(`${id}: confidence/uncertainty missing`);
    const ext = m.appearance && m.appearance.external, cut = m.appearance && m.appearance.cutaway;
    if (!ext || !cut) { errors.push(`${id}: appearance incomplete`); continue; }
    for (const k of ['base', 'light', 'dark']) if (!HEX.test(ext[k])) errors.push(`${id}: external.${k} not #rrggbb`);
    if (!HEX.test(cut.fill)) errors.push(`${id}: cutaway.fill not #rrggbb`);
    for (const k of ['roughness', 'reflectivity']) if (!(ext[k] >= 0 && ext[k] <= 1)) errors.push(`${id}: external.${k} outside 0..1`);
    if (!lib.hatches.includes(cut.hatch)) errors.push(`${id}: unknown hatch ${cut.hatch}`);
    for (const k of Object.keys(m.appearance)) if (k !== 'external' && k !== 'cutaway' && k !== 'note') errors.push(`${id}: unexpected appearance key ${k}`);
    for (const k of Object.keys(ext)) if (!APPEARANCE_ONLY.includes(k)) errors.push(`${id}: unexpected external key ${k}`);
    for (const k of PHYSICAL_KEYS) if (k in ext || k in cut || k in m.appearance) errors.push(`${id}: physical key ${k} inside appearance`);
    const ph = m.physical;
    if (!ph || !Array.isArray(ph.solver_supported_properties) || !Array.isArray(ph.not_simulated) || !Array.isArray(ph.unknown) || !('solver_material_ref' in ph)) errors.push(`${id}: physical block incomplete`);
    else {
      if (!ph.solver_material_ref && ph.solver_supported_properties.length) errors.push(`${id}: claims solver properties without a solver link`);
      for (const k of Object.keys(ph)) if (typeof ph[k] === 'number') errors.push(`${id}: numeric value ${k} stored in library (solver numbers live in presets only)`);
    }
    if (typeof m.builtin_assignable !== 'boolean') errors.push(`${id}: builtin_assignable missing`);
    if (m.status === 'reference_only' && m.builtin_assignable) errors.push(`${id}: reference-only material cannot be built-in assignable`);
  }
  return errors;
}
class Library {
  constructor(lib, sourceIds) {
    const errors = validate(lib, sourceIds);
    if (errors.length) throw new Error('Invalid material library: ' + errors.join('; '));
    this.raw = lib; this.map = new Map(lib.materials.map((m) => [m.id, m])); this.hatches = lib.hatches.slice();
    this._rgb = new Map(); for (const m of lib.materials) this._rgb.set(m.id, { base: rgb(m.appearance.external.base), light: rgb(m.appearance.external.light), dark: rgb(m.appearance.external.dark), fill: rgb(m.appearance.cutaway.fill) });
  }
  has(id) { return this.map.has(id); }
  get(id) { const m = this.map.get(id); if (!m) throw new Error(`Unknown material id ${id}`); return m; }
  ids() { return Array.from(this.map.keys()); }
  list() { return this.raw.materials; }
  rgb(id) { const c = this._rgb.get(id); if (!c) throw new Error(`Unknown material id ${id}`); return c; }
  /* Physical properties actually used by the solver for this material, read live from the preset records. null when the material has no solver link. */
  solverProperties(P, id) {
    const m = this.get(id), ref = m.physical.solver_material_ref;
    if (!ref) return null;
    if (ref.startsWith('ammunition:')) {
      const [, ammoId, key] = ref.split(':'), rec = P.ammunition[ammoId] && P.ammunition[ammoId][key];
      if (!rec) throw new Error(`${id}: solver ref ${ref} not found in presets`);
      return { ref, density_kg_m3: rec.density_kg_m3, youngs_modulus_Pa: rec.youngs_modulus_pa, yield_stress_Pa: rec.yield_stress_pa, hardening_ratio_H_over_E: rec.hardening_ratio_h_over_e, critical_tensile_bond_strain: rec.critical_tensile_bond_strain, status: rec.status };
    }
    const rec = P.materials[ref];
    if (!rec) throw new Error(`${id}: solver ref ${ref} not found in presets`);
    return { ref, density_kg_m3: rec.density_kg_m3, youngs_modulus_Pa: rec.youngs_modulus_Pa, yield_stress_Pa: rec.yield_stress_Pa, hardening_ratio_H_over_E: rec.hardening_ratio_H_over_E, critical_tensile_bond_strain: rec.critical_tensile_bond_strain, status: rec.status };
  }
}
const api = { Library, validate, rgb };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALMaterials = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
