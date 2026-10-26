(function (root) {
'use strict';
const headers = [
  'model_id', 'model_type', 'target_id', 'solver_mode', 'availability',
  'foundation_stiffness', 'foundation_stiffness_unit', 'foundation_damping', 'foundation_damping_unit',
  'normal_stiffness', 'normal_stiffness_unit', 'shear_stiffness', 'shear_stiffness_unit',
  'normal_strength', 'normal_strength_unit', 'shear_strength', 'shear_strength_unit',
  'mode_i_fracture_energy', 'mode_i_fracture_energy_unit', 'mode_ii_fracture_energy',
  'mode_ii_fracture_energy_unit', 'mixed_mode_exponent', 'mixed_mode_exponent_unit',
  'effective_area', 'effective_area_unit', 'normal_x', 'normal_y', 'normal_unit',
  'tangent_x', 'tangent_y', 'tangent_unit', 'source_reference', 'material_or_joint',
  'confidence', 'uncertainty', 'notes'
];
const solverModes = { rigid_fixture: 0, free: 1, compliant_foundation: 2 };
function parseCsv(text) {
  if (root.ALResearch && typeof root.ALResearch.parseCsv === 'function') return root.ALResearch.parseCsv(text);
  const rows = [], row = []; let field = '', quoted = false;
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
    } else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((value) => value !== '')) rows.push(row.splice(0));
      else row.length = 0;
    } else field += ch;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  if (field.length || row.length) { row.push(field); if (row.some((value) => value !== '')) rows.push(row); }
  if (!rows.length) throw new Error('CSV has no header');
  const names = rows.shift();
  if (names.some((name) => !name) || new Set(names).size !== names.length) throw new Error('CSV header is empty or duplicated');
  return rows.map((cells, index) => {
    if (cells.length !== names.length) throw new Error(`CSV row ${index + 2} has ${cells.length} cells; expected ${names.length}`);
    return Object.fromEntries(names.map((name, column) => [name, cells[column]]));
  });
}
function number(record, key, row) {
  const value = (record[key] || '').trim();
  if (!value) return null;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
    throw new Error(`boundary CSV row ${row} has malformed or non-finite number in '${key}'`);
  }
  return Number(value);
}
function unit(record, column, expected, row) {
  const value = (record[column] || '').trim();
  if (value && value !== expected) throw new Error(`boundary CSV row ${row} has invalid unit '${value}' in '${column}'; expected '${expected}'`);
}
function parseRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('boundary CSV has no header or records');
  const missingHeaders = headers.filter((name) => !Object.hasOwn(rows[0], name));
  if (missingHeaders.length) throw new Error(`boundary CSV is missing required header '${missingHeaders[0]}'`);
  const ids = new Set();
  return rows.map((reported, index) => {
    const line = index + 2, record = Object.fromEntries(headers.map((name) => [name, String(reported[name] == null ? '' : reported[name]).trim()]));
    if (!record.model_id) throw new Error(`boundary CSV row ${line} is missing required field 'model_id'`);
    if (ids.has(record.model_id)) throw new Error(`boundary CSV contains duplicate model_id '${record.model_id}'`);
    ids.add(record.model_id);
    if (!['free', 'rigid_fixture', 'compliant_foundation', 'cohesive_interface'].includes(record.model_type)) throw new Error(`boundary CSV row ${line} has unknown model_type '${record.model_type}'`);
    if (!['implemented', 'unsupported'].includes(record.availability)) throw new Error(`boundary CSV row ${line} has invalid availability '${record.availability}'`);
    if (!record.target_id || !record.source_reference || !record.material_or_joint || !record.confidence || !record.uncertainty || !record.notes) {
      throw new Error(`boundary CSV row ${line} is missing target or provenance/uncertainty metadata`);
    }
    const expectedMode = Object.hasOwn(solverModes, record.model_type) ? solverModes[record.model_type] : null;
    const solverMode = record.solver_mode ? number(record, 'solver_mode', line) : null;
    if (solverMode !== expectedMode) throw new Error(`boundary CSV row ${line} has a solver_mode inconsistent with model_type`);
    if (solverMode != null && (!Number.isInteger(solverMode) || solverMode < 0 || solverMode > 2)) throw new Error(`boundary CSV row ${line} has invalid solver_mode`);
    const foundationStiffness = number(record, 'foundation_stiffness', line);
    const foundationDamping = number(record, 'foundation_damping', line);
    unit(record, 'foundation_stiffness_unit', 'Pa/m', line);
    unit(record, 'foundation_damping_unit', 'Pa*s/m', line);
    if (record.model_type === 'compliant_foundation' && record.availability === 'implemented') {
      if (foundationStiffness == null || !(foundationStiffness > 0) || foundationDamping == null || !(foundationDamping >= 0)) throw new Error(`boundary CSV row ${line} requires foundation stiffness > 0 and damping >= 0`);
      if (record.foundation_stiffness_unit !== 'Pa/m' || record.foundation_damping_unit !== 'Pa*s/m') throw new Error(`boundary CSV row ${line} is missing explicit foundation coefficient units`);
    } else if (record.model_type !== 'compliant_foundation' && (foundationStiffness != null || foundationDamping != null)) {
      throw new Error(`boundary CSV row ${line} assigns foundation coefficients to a non-foundation model`);
    }
    const cohesive = {
      normalStiffnessPaPerM: number(record, 'normal_stiffness', line),
      shearStiffnessPaPerM: number(record, 'shear_stiffness', line),
      normalStrengthPa: number(record, 'normal_strength', line),
      shearStrengthPa: number(record, 'shear_strength', line),
      modeIFractureEnergyJPerM2: number(record, 'mode_i_fracture_energy', line),
      modeIIFractureEnergyJPerM2: number(record, 'mode_ii_fracture_energy', line),
      mixedModeExponent: number(record, 'mixed_mode_exponent', line),
      effectiveAreaM2: number(record, 'effective_area', line),
      localNormal: [number(record, 'normal_x', line), number(record, 'normal_y', line)],
      localTangent: [number(record, 'tangent_x', line), number(record, 'tangent_y', line)]
    };
    for (const [column, expected] of [
      ['normal_stiffness_unit', 'Pa/m'], ['shear_stiffness_unit', 'Pa/m'],
      ['normal_strength_unit', 'Pa'], ['shear_strength_unit', 'Pa'],
      ['mode_i_fracture_energy_unit', 'J/m^2'], ['mode_ii_fracture_energy_unit', 'J/m^2'],
      ['mixed_mode_exponent_unit', 'dimensionless'], ['effective_area_unit', 'm^2'],
      ['normal_unit', 'dimensionless'], ['tangent_unit', 'dimensionless']
    ]) unit(record, column, expected, line);
    if (record.model_type === 'cohesive_interface') {
      for (const [column, expected] of [
        ['normal_stiffness_unit', 'Pa/m'], ['shear_stiffness_unit', 'Pa/m'],
        ['normal_strength_unit', 'Pa'], ['shear_strength_unit', 'Pa'],
        ['mode_i_fracture_energy_unit', 'J/m^2'], ['mode_ii_fracture_energy_unit', 'J/m^2'],
        ['mixed_mode_exponent_unit', 'dimensionless'], ['effective_area_unit', 'm^2'],
        ['normal_unit', 'dimensionless'], ['tangent_unit', 'dimensionless']
      ]) {
        if (record[column] !== expected) throw new Error(`boundary CSV row ${line} is missing explicit unit '${expected}' in '${column}'`);
      }
    }
    if (cohesive.localNormal.some((v) => v != null) && cohesive.localNormal.some((v) => v == null)) throw new Error(`boundary CSV row ${line} must provide both local normal components`);
    if (cohesive.localTangent.some((v) => v != null) && cohesive.localTangent.some((v) => v == null)) throw new Error(`boundary CSV row ${line} must provide both local tangent components`);
    if (cohesive.localNormal.every((v) => v != null) && cohesive.localTangent.every((v) => v != null)) {
      const [nx, ny] = cohesive.localNormal, [tx, ty] = cohesive.localTangent;
      if (Math.abs(Math.hypot(nx, ny) - 1) > 1e-6 || Math.abs(Math.hypot(tx, ty) - 1) > 1e-6 || Math.abs(nx * tx + ny * ty) > 1e-6) {
        throw new Error(`boundary CSV row ${line} local normal/tangent must be orthonormal unit vectors`);
      }
    }
    for (const [name, value] of Object.entries(cohesive)) {
      if (typeof value === 'number' && value <= 0) throw new Error(`boundary CSV row ${line} has non-positive ${name}`);
    }
    const complete = Object.entries(cohesive).every(([key, value]) => key === 'localNormal' || key === 'localTangent' ? value.every((v) => v != null) : value != null);
    if (record.model_type === 'cohesive_interface' && record.availability === 'implemented' && !complete) {
      throw new Error(`boundary CSV row ${line} enables a cohesive interface without complete constitutive parameters`);
    }
    return {
      ...record,
      solverMode,
      foundationStiffnessPaPerM: foundationStiffness,
      foundationDampingPaSPerM: foundationDamping,
      cohesive
    };
  });
}
function fromCsv(csv) { return parseRows(parseCsv(csv)); }
function modelTypeForSelector(selector) {
  if (typeof selector === 'number' || /^[0-2]$/.test(String(selector))) {
    const type = { 0: 'rigid_fixture', 1: 'free', 2: 'compliant_foundation' }[Number(selector)];
    if (type) return type;
  }
  return String(selector);
}
function resolve(models, targetId, selector) {
  const type = modelTypeForSelector(selector);
  const exact = models.find((model) => model.model_type === type && model.target_id === targetId);
  const model = exact || models.find((candidate) => candidate.model_type === type && candidate.target_id === '*');
  if (!model) throw new Error(`No ${type} boundary model is configured for target '${targetId}'`);
  return model;
}
function solverParameters(model) {
  if (model.availability !== 'implemented') throw new Error(`Boundary model '${model.model_id}' is unsupported: ${model.uncertainty}`);
  if (model.model_type === 'cohesive_interface') throw new Error(`Boundary model '${model.model_id}' is unsupported: no cohesive-interface damage law is implemented`);
  return {
    mode: model.solverMode,
    stiffnessPaPerM: model.model_type === 'compliant_foundation' ? model.foundationStiffnessPaPerM : 0,
    dampingPaSPerM: model.model_type === 'compliant_foundation' ? model.foundationDampingPaSPerM : 0
  };
}
const api = { headers, parseCsv, parseRows, fromCsv, resolve, solverParameters, modelTypeForSelector };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.ALBoundary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
