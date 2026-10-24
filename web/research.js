(function (root) {
'use strict';
const requiredFiles = [
  'ammunition_mechanism_models.csv',
  'ammunition_variants.csv',
  'armor_surfaces_and_samples.csv',
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
function load(csvFiles) {
  const tables = {};
  for (const name of requiredFiles) {
    if (typeof csvFiles[name] !== 'string') throw new Error(`Missing research dataset: ${name}`);
    tables[name] = parseCsv(csvFiles[name]);
  }
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
    guns,
    armorTargets,
    referenceTests,
    validationCases: referenceTests,
    referenceCurves,
    sourceIds
  };
}
function integratePresets(presets, research) {
  const result = JSON.parse(JSON.stringify(presets));
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
    const mass = record.numeric.projectile_mass_kg, caliber = record.numeric.caliber_mm, velocity = record.numeric.muzzle_velocity_m_s;
    if (mass == null || caliber == null || velocity == null) throw new Error(`Ammunition ${id} is missing a sourced mass, calibre, or muzzle velocity`);
    ammo.projectile_mass_kg = mass;
    ammo.calibre_mm = caliber;
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
