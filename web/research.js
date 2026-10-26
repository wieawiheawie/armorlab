(function (root) {
'use strict';
const requiredFiles = [
  'ammunition_mechanism_models.csv',
  'ammunition_variants.csv',
  'international_ammunition_evidence.csv',
  'armor_surfaces_and_samples.csv',
  'boundary_model_parameters.csv',
  'historical_penetration_reference_curves.csv',
  'image_and_drawing_references.csv',
  'implementation_milestones.csv',
  'material_and_solver_parameter_checklist.csv',
  'source_register.csv',
  'validation_cases.csv'
];
function parseCsv(text) {
  const rows = [], row = [];
  let field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') {
      if (field.length) throw new Error('Unexpected quote in CSV field');
      quoted = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((value) => value !== '')) rows.push(row.slice());
      row.length = 0;
    } else field += ch;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  if (field.length || row.length) { row.push(field); if (row.some((value) => value !== '')) rows.push(row); }
  if (!rows.length) throw new Error('CSV has no header');
  const headers = rows.shift();
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) throw new Error('CSV header is empty or duplicated');
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${cells.length} cells; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, column) => [header, cells[column]]));
  });
}
function numeric(value) {
  if (value == null || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function sourcedNumber(value, unit, conversions, label, id) {
  if (!value || value === 'unknown') return null;
  const raw = numeric(value);
  if (raw == null || raw <= 0) throw new Error(`Invalid ${label} value for ${id}: ${value}`);
  if (!Object.prototype.hasOwnProperty.call(conversions, unit)) throw new Error(`Invalid ${label} unit for ${id}: ${unit}`);
  return raw * conversions[unit];
}
function load(csvFiles) {
  const tables = {};
  for (const name of requiredFiles) {
    if (typeof csvFiles[name] !== 'string') throw new Error(`Missing research dataset: ${name}`);
    tables[name] = parseCsv(csvFiles[name]);
  }
  const Boundary = root.ALBoundary || (typeof require === 'function' ? require('./boundary.js') : null);
  if (!Boundary) throw new Error('Boundary parameter parser is not loaded');
  const boundaryModels = Boundary.parseRows(tables['boundary_model_parameters.csv']);
  const uniqueBy = (table, key, filename) => {
    const result = new Map();
    for (const record of table) {
      if (!record[key]) throw new Error(`${filename} contains a row without ${key}`);
      if (result.has(record[key])) throw new Error(`${filename} contains duplicate ${key}: ${record[key]}`);
      result.set(record[key], record);
    }
    return result;
  };
  const sources = uniqueBy(tables['source_register.csv'], 'source_id', 'source_register.csv');
  for (const model of boundaryModels) {
    const refs = model.source_reference.split(';').filter((id) => /^S\d+$/.test(id));
    for (const sourceId of refs) if (!sources.has(sourceId)) throw new Error(`Boundary model ${model.model_id} references missing source ${sourceId}`);
  }
  const sourceIds = (record) => Array.isArray(record.source_ids) ? record.source_ids : (record.source_ids || '').split(';').filter(Boolean);
  const ammunition = uniqueBy(tables['ammunition_variants.csv'].map((reported) => ({
    ...reported,
    reported,
    source_ids: sourceIds(reported),
    numeric: {
      projectile_mass_kg: numeric(reported.projectile_mass_kg),
      caliber_mm: numeric(reported.caliber_mm),
      muzzle_velocity_m_s: numeric(reported.muzzle_velocity_m_s),
      explosive_filler_kg: numeric(reported.explosive_filler_kg_reported)
    }
  })), 'ammo_id', 'ammunition_variants.csv');
  const internationalAmmunition = uniqueBy(tables['international_ammunition_evidence.csv'].map((reported) => {
    const id = reported.ammo_id || '(missing ID)';
    return {
      ...reported,
      source_ids: sourceIds(reported),
      projectile_mass_numeric_kg: sourcedNumber(reported.projectile_mass_value, reported.projectile_mass_unit, { kg: 1, g: 0.001, lb: 0.45359237 }, 'projectile mass', id),
      muzzle_velocity_numeric_m_s: sourcedNumber(reported.muzzle_velocity_value, reported.muzzle_velocity_unit, { 'm/s': 1, 'ft/s': 0.3048 }, 'muzzle velocity', id),
      calibre_numeric_mm: sourcedNumber(reported.calibre_value, reported.calibre_unit, { mm: 1 }, 'calibre', id)
    };
  }), 'ammo_id', 'international_ammunition_evidence.csv');
  for (const record of internationalAmmunition.values()) {
    if (!record.ammo_id || !record.designation || !record.country) throw new Error('international_ammunition_evidence.csv has a row without identity fields');
    for (const sourceId of record.source_ids) if (!sources.has(sourceId)) throw new Error(`International ammunition ${record.ammo_id} references missing source ${sourceId}`);
  }
  const armorTargets = uniqueBy(tables['armor_surfaces_and_samples.csv'].map((reported) => ({
    ...reported,
    reported,
    source_ids: sourceIds(reported),
    numeric: {
      nominal_thickness_mm: numeric(reported.nominal_thickness_mm),
      source_angle_deg: numeric(reported.source_angle_deg),
      measured_hardness_bhn: numeric(reported.measured_hardness_bhn)
    }
  })), 'armor_id', 'armor_surfaces_and_samples.csv');
  const guns = new Map();
  for (const [kind, records] of [['ammunition', ammunition], ['armour', armorTargets]]) {
    for (const record of records.values()) {
      for (const sourceId of sourceIds(record)) if (!sources.has(sourceId)) throw new Error(`${kind} ${record.ammo_id || record.armor_id} references missing source ${sourceId}`);
    }
  }
  for (const record of ammunition.values()) {
    if (!guns.has(record.gun_id)) guns.set(record.gun_id, { gun_id: record.gun_id, ammunition_ids: [], vehicle_contexts: [] });
    const gun = guns.get(record.gun_id);
    gun.ammunition_ids.push(record.ammo_id);
    if (!gun.vehicle_contexts.includes(record.vehicle_context)) gun.vehicle_contexts.push(record.vehicle_context);
  }
  const referenceCurves = tables['historical_penetration_reference_curves.csv'].map((reported) => ({
    reported,
    ammo_id: reported.ammo_id,
    curve_id: reported.curve_id,
    source_id: reported.source_id,
    range_m: numeric(reported.range_m),
    penetration_mm: numeric(reported.reported_penetration_mm),
    source_ids: [reported.source_id],
    reference_only: true
  }));
  for (const item of referenceCurves) if (!sources.has(item.source_id)) throw new Error(`Reference curve ${item.curve_id} references missing source ${item.source_id}`);
  const referenceTests = tables['validation_cases.csv'].map((reported) => ({
    reported,
    case_id: reported.case_id,
    source_ids: sourceIds(reported),
    velocity_m_s: numeric(reported.velocity_m_s),
    angle_deg: numeric(reported.angle),
    evidence_grade: reported.evidence_grade
  }));
  for (const test of referenceTests) for (const sourceId of test.source_ids) {
    if (!sources.has(sourceId)) throw new Error(`Reference test ${test.case_id} references missing source ${sourceId}`);
  }
  return {
    tables,
    sources,
    ammunition,
    internationalAmmunition,
    guns,
    armorTargets,
    referenceTests,
    validationCases: referenceTests,
    referenceCurves,
    sourceIds,
    boundaryModels
  };
}
function integratePresets(presets, research) {
  const result = JSON.parse(JSON.stringify(presets));
  result.boundary_models = research.boundaryModels;
  for (const [id, target] of Object.entries(result.targets)) {
    if (!target.research_id) throw new Error(`Target ${id} has no research_id`);
    const record = research.armorTargets.get(target.research_id);
    if (!record) throw new Error(`Target ${id} references missing armour record ${target.research_id}`);
    const thickness = record.numeric.nominal_thickness_mm;
    if (thickness != null) target.nominal_thickness_mm = thickness;
    const sourceAngle = record.numeric.source_angle_deg;
    const previousAngle = target.slope_from_vertical_deg;
    if (sourceAngle != null && sourceAngle === previousAngle) target.slope_from_vertical_deg = sourceAngle;
    target.face_angle_from_horizontal_deg = 90 - target.slope_from_vertical_deg;
    target.research_record = record;
    target.research_source_ids = research.sourceIds(record);
    target.geometry_note = sourceAngle != null && sourceAngle !== previousAngle
      ? `Existing scenario angle ${previousAngle}° retained; research record reports ${sourceAngle}° (${record.source_angle_basis}).`
      : record.source_angle_basis;
  }
  for (const [id, ammo] of Object.entries(result.ammunition)) {
    if (!ammo.research_id) throw new Error(`Ammunition ${id} has no research_id`);
    const record = research.ammunition.get(ammo.research_id);
    if (!record) throw new Error(`Ammunition ${id} references missing record ${ammo.research_id}`);
    const internationalRecord = research.internationalAmmunition.get(id);
    if (internationalRecord) {
      ammo.international_evidence = internationalRecord;
      ammo.country = internationalRecord.country;
      ammo.historical_designation = internationalRecord.designation;
    }
    const mass = record.numeric.projectile_mass_kg, caliber = record.numeric.caliber_mm, velocity = record.numeric.muzzle_velocity_m_s;
    if (internationalRecord) {
      const evidence = internationalRecord;
      if (mass != null && evidence.projectile_mass_numeric_kg != null && Math.abs(mass - evidence.projectile_mass_numeric_kg) > 1e-9 * Math.max(1, mass)) {
        throw new Error(`Ammunition ${id} projectile mass disagrees with its international evidence record`);
      }
      if (caliber != null && evidence.calibre_numeric_mm != null && caliber !== evidence.calibre_numeric_mm) {
        throw new Error(`Ammunition ${id} calibre disagrees with its international evidence record`);
      }
      if (velocity != null && evidence.muzzle_velocity_numeric_m_s != null && Math.abs(velocity - evidence.muzzle_velocity_numeric_m_s) > 1e-9 * Math.max(1, velocity)) {
        throw new Error(`Ammunition ${id} muzzle velocity disagrees with its international evidence record`);
      }
    }
    if (ammo.simulation_status === 'kinetic_approximation' && (mass == null || caliber == null || velocity == null)) {
      throw new Error(`Ammunition ${id} is missing a sourced mass, calibre, or muzzle velocity`);
    }
    if (ammo.simulation_status === 'experimental_approximation') {
      const model = ammo.solver_approximation;
      if (!model || model.status !== 'experimental_approximation' || model.model !== 'effective_solid_body' ||
          ![model.mass_kg, model.initial_velocity_mps, model.length_mm, model.nose_length_mm].every((value) => Number.isFinite(value) && value > 0) ||
          !model.material_id || !model.mass_basis || !model.velocity_basis || !model.geometry_basis || !model.material_basis ||
          !Array.isArray(model.metadata_only_features) || model.metadata_only_features.length === 0) {
        throw new Error(`Ammunition ${id} has an incomplete experimental approximation profile`);
      }
      if (caliber != null && model.nose_length_mm >= model.length_mm) {
        throw new Error(`Ammunition ${id} experimental geometry has nose length >= body length`);
      }
    }
    if (ammo.simulation_status === 'kinetic_approximation' || ammo.simulation_status === 'experimental_approximation') {
      const geometry = ammo.solver_approximation || ammo.simulation_geometry;
      if (!geometry || !['rounded', 'pointed', 'ogive'].includes(geometry.nose_profile) ||
          !Number.isFinite(geometry.body_taper_fraction) || geometry.body_taper_fraction < 0 || geometry.body_taper_fraction > 0.5 ||
          !(geometry.shape_basis || geometry.basis)) {
        throw new Error(`Ammunition ${id} has an incomplete or invalid solver geometry profile`);
      }
    }
    ammo.projectile_mass_kg = mass;
    ammo.calibre_mm = caliber == null ? ammo.calibre_mm : caliber;
    ammo.nominal_muzzle_velocity_mps = velocity;
    ammo.gun_id = record.gun_id;
    ammo.family = record.family;
    ammo.confidence = record.confidence;
    ammo.research_record = record;
    ammo.research_source_ids = research.sourceIds(record);
  }
  result.research = research;
  return result;
}
const api = { requiredFiles, parseCsv, numeric, load, integratePresets };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALResearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
