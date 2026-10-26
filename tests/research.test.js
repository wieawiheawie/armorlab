const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Research = require('../web/research.js');
const Boundary = require('../web/boundary.js');
const root = path.join(__dirname, '..');
const manifest = require('../research/ArmorLab_Research_Pack/manifest.json');
const csv = Object.fromEntries(manifest.csv_files.map((name) => [name, fs.readFileSync(path.join(root, 'research/ArmorLab_Research_Pack/data', name), 'utf8')]));
const records = Research.load(csv);
const presets = Research.integratePresets(require('../presets/presets.json'), records);

test('research CSV parser handles BOM, quoted commas, escaped quotes, and embedded newlines', () => {
  assert.deepEqual(Research.parseCsv('\uFEFFid,text\r\n1,"a, ""quoted"" value"\r\n2,"line one\nline two"\r\n'), [
    { id: '1', text: 'a, "quoted" value' }, { id: '2', text: 'line one\nline two' }
  ]);
  assert.throws(() => Research.parseCsv('a,b\n1'), /expected 2/);
  assert.throws(() => Research.parseCsv('a,b\n1,"open'), /Unterminated/);
});

test('all research files load with provenance and explicitly unknown numeric values', () => {
  assert.deepEqual(Object.keys(records.tables).sort(), Research.requiredFiles.slice().sort());
  assert.equal(records.sources.size, 43);
  const tigerI = records.armorTargets.get('DE_TIGER1_HULL_FRONT_UPPER');
  assert.equal(tigerI.numeric.nominal_thickness_mm, 100);
  assert.equal(tigerI.numeric.source_angle_deg, 8);
  assert.deepEqual(tigerI.source_ids, ['S10', 'S29', 'S30']);
  const earlyTurret = records.armorTargets.get('DE_TIGER2_PORSCHE_TURRET_FRONT');
  assert.equal(earlyTurret.numeric.nominal_thickness_mm, null);
  assert.match(earlyTurret.reported.nominal_thickness_mm, /approx/);
  assert.equal(earlyTurret.numeric.measured_hardness_bhn, null);
  assert.equal(Research.numeric('unknown'), null);
  assert.equal(Research.numeric('300–800'), null);
});

test('boundary database resolves typed models with units, provenance, and unknown cohesive parameters', () => {
  assert.ok(records.tables['boundary_model_parameters.csv']);
  const foundation = Boundary.resolve(records.boundaryModels, 'TIGER2_UPPER_GLACIS', 'compliant_foundation');
  assert.deepEqual(Boundary.solverParameters(foundation), { mode: 2, stiffnessPaPerM: 1e12, dampingPaSPerM: 0 });
  assert.equal(foundation.foundation_stiffness_unit, 'Pa/m');
  assert.equal(foundation.foundation_damping_unit, 'Pa*s/m');
  assert.equal(foundation.confidence, 'provisional numerical reference');
  assert.match(foundation.uncertainty, /Not measured or calibrated/);
  const weld = Boundary.resolve(records.boundaryModels, 'TIGER2_UPPER_GLACIS', 'cohesive_interface');
  assert.equal(weld.availability, 'unsupported');
  assert.equal(weld.cohesive.normalStiffnessPaPerM, null);
  assert.equal(weld.cohesive.modeIFractureEnergyJPerM2, null);
  assert.equal(weld.source_reference, 'S14;S16');
  assert.deepEqual(weld.source_reference.split(';').filter((id) => /^S\d+$/.test(id)), ['S14', 'S16']);
  assert.throws(() => Boundary.solverParameters(weld), /unsupported/);
});

test('boundary database rejects malformed headers, numeric values, invalid units, and negative coefficients', () => {
  const source = csv['boundary_model_parameters.csv'];
  assert.throws(() => Boundary.fromCsv(source.replace('model_type,', '')), /missing required header|cells; expected/);
  assert.throws(() => Boundary.fromCsv(source.replace('1e12,Pa/m', 'not-a-number,Pa/m')), /malformed or non-finite number/);
  assert.throws(() => Boundary.fromCsv(source.replace('1e12,Pa/m', 'NaN,Pa/m')), /malformed or non-finite number/);
  assert.throws(() => Boundary.fromCsv(source.replace('1e12,Pa/m', '-1,Pa/m')), /stiffness > 0/);
  assert.throws(() => Boundary.fromCsv(source.replace('1e12,Pa/m', '1e12,Pa')), /invalid unit/);
  assert.throws(() => Boundary.fromCsv(source.replace('J/m^2,,J/m^2', 'J/m,,J/m^2')), /invalid unit/);
  assert.throws(() => Boundary.fromCsv(source.replace('free,free,*,1,implemented,', 'free,free,*,1,implemented')), /cells; expected/);
});

test('ammunition configuration retains distinct gun and projectile variants with original units', () => {
  const kwk36 = records.ammunition.get('DE_88_KWK36_PZGR39_1');
  const kwk43 = records.ammunition.get('DE_88_KWK43_PZGR39_43');
  assert.equal(kwk36.numeric.projectile_mass_kg, 10.2);
  assert.equal(kwk36.numeric.muzzle_velocity_m_s, 773);
  assert.equal(kwk43.numeric.projectile_mass_kg, 10.16);
  assert.equal(kwk43.numeric.muzzle_velocity_m_s, 1000);
  assert.notEqual(kwk36.gun_id, kwk43.gun_id);
  assert.notEqual(kwk36.ammo_id, kwk43.ammo_id);
  assert.deepEqual(records.guns.get(kwk36.gun_id).ammunition_ids, ['DE_88_KWK36_PZGR39_1', 'DE_88_KWK36_GR39HL', 'DE_88_KWK36_SPRGR', 'DE_88_KWK36_PZGR40']);
  assert.deepEqual(records.guns.get(kwk43.gun_id).ammunition_ids, ['DE_88_KWK43_PZGR39_43', 'DE_88_KWK43_PZGR40_43']);
  assert.equal(kwk36.numeric.explosive_filler_kg, null);
  assert.match(kwk36.reported.explosive_filler_kg_reported, /0\.059/);
});

test('international ammunition evidence retains source-specific values, units, uncertainties, and variant separation', () => {
  const evidence = records.internationalAmmunition;
  assert.equal(evidence.size, 8);
  const m62 = evidence.get('US_76_M62_APCT');
  assert.equal(m62.projectile_mass_value, '15.44');
  assert.equal(m62.projectile_mass_unit, 'lb');
  assert.ok(Math.abs(m62.projectile_mass_numeric_kg - 7.0034661928) < 1e-9);
  assert.equal(m62.complete_round_mass_value, '24.80');
  assert.equal(m62.muzzle_velocity_value, '2600');
  assert.equal(m62.muzzle_velocity_unit, 'ft/s');
  assert.equal(m62.muzzle_velocity_numeric_m_s, 792.48);
  assert.equal(m62.source_ids[0], 'S35');
  const br471 = evidence.get('SU_122_BR471_APHE'), br471b = evidence.get('SU_122_BR471B_APHEBC');
  assert.equal(br471.projectile_mass_value, '25');
  assert.equal(br471.muzzle_velocity_value, '780');
  assert.equal(br471.filler_value, '156');
  assert.equal(br471.fuze, 'MD-8');
  assert.equal(br471b.filler_value, 'unknown');
  assert.match(br471b.uncertainty, /not zero/);
  assert.notEqual(br471.designation, br471b.designation);
  assert.equal(evidence.get('IT_90_53_CGP').muzzle_velocity_value, '758');
  assert.equal(evidence.get('IT_90_53_CGP').filler_value, '520');
  assert.equal(evidence.get('IT_90_53_CGP').filler_identity, 'TNT quantity reported; not TNT-equivalent');
  for (const id of ['US_90_M82_APCT', 'CN_100_TYPE73_APDS', 'CN_100_TYPE73_HEATFS', 'SE_57_SLPGR_M43']) {
    const record = evidence.get(id);
    assert.equal(record.projectile_mass_numeric_kg, null, `${id} mass remains unknown`);
    assert.equal(record.muzzle_velocity_numeric_m_s, null, `${id} velocity remains unknown`);
    assert.ok(record.source_ids.length, `${id} provenance retained`);
  }
});

test('international evidence parser rejects malformed source-backed quantities, unsupported units, and missing schema fields', () => {
  const name = 'international_ammunition_evidence.csv';
  assert.throws(() => Research.load({ ...csv, [name]: csv[name].replace('15.44,lb', 'not-a-number,lb') }), /Invalid projectile mass/);
  assert.throws(() => Research.load({ ...csv, [name]: csv[name].replace('15.44,lb', '15.44,stone') }), /Invalid projectile mass unit/);
  assert.throws(() => Research.load({ ...csv, [name]: csv[name].replace('muzzle_velocity_value,', '') }), /cells; expected|missing/);
  assert.throws(() => Research.load({ ...csv, [name]: csv[name].replace('S35,', 'S999,') }), /references missing source S999/);
  const ammunitionCsv = 'ammunition_variants.csv';
  const inconsistent = Research.load({ ...csv, [ammunitionCsv]: csv[ammunitionCsv].replace('7.0034661928,76,792.48', '7.1,76,792.48') });
  assert.throws(() => Research.integratePresets(require('../presets/presets.json'), inconsistent), /mass disagrees/);
});

test('scenario configuration uses sourced values while exposing unresolved geometry conflict', () => {
  assert.equal(presets.targets.TIGER1_UPPER_FRONT.nominal_thickness_mm, 100);
  assert.equal(presets.targets.TIGER1_UPPER_FRONT.slope_from_vertical_deg, 9);
  assert.match(presets.targets.TIGER1_UPPER_FRONT.geometry_note, /reports 8°/);
  assert.equal(presets.targets.TIGER2_UPPER_GLACIS.slope_from_vertical_deg, 50);
  assert.equal(presets.ammunition.TIGER1_PZGR39.projectile_mass_kg, 10.2);
  assert.match(presets.ammunition.TIGER1_PZGR39.projectile_mass_evidence, /shot weight.*not complete cartridge/);
  assert.match(presets.ammunition.TIGER2_PZGR3943.projectile_mass_evidence, /22\.8 lb.*10\.34 kg/);
  assert.equal(presets.ammunition.TIGER2_PZGR3943.nominal_muzzle_velocity_mps, 1000);
  assert.match(presets.ammunition.TIGER2_PZGR3943.projectile_mass_evidence, /not reconciled/);
  const apcr = presets.ammunition.TIGER2_PZGR4043;
  assert.equal(apcr.projectile_mass_kg, 7.3); assert.equal(apcr.nominal_muzzle_velocity_mps, 1130);
  assert.equal(apcr.gun_id, 'DE_88_KWK43_L71'); assert.equal(apcr.family, 'APCR (tungsten-carbide core)');
  assert.match(apcr.projectile_mass_evidence, /Panzerworld.*Type 40/);
  assert.match(apcr.shape_fidelity, /Flak 36\/41.*variant applicability is unverified/);
  const apcrCoreGeometry = apcr.projectile_components.find((part) => part.id === 'wc_core').geometry;
  assert.equal(apcrCoreGeometry.diameter_mm, 45);
  assert.equal(apcrCoreGeometry.length_mm, 160);
  assert.match(apcrCoreGeometry.status, /not attributed to Pzgr\.40\/43/);
  assert.match(apcrCoreGeometry.status, /35\.7 mm × 138\.1 mm.*1\.93 kg/);
  const scenario = require('../web/scenario.js').makeConfig(presets, 'TIGER1_UPPER_FRONT', 'TIGER1_PZGR39', { n: 3000 });
  assert.equal(scenario[1], 0.1);
  assert.equal(scenario[8], 773);
  assert.equal(scenario[10], 1, 'new scenarios explicitly select isotropic hardening');
  const scenarioApi = require('../web/scenario.js');
  const resolvedReference = scenarioApi.resolveBoundary(presets, 'TIGER2_UPPER_GLACIS', 'compliant_foundation', { supportStiffness: 1e12, supportDamping: 0 });
  assert.equal(resolvedReference.user_override, false);
  const resolvedOverride = scenarioApi.resolveBoundary(presets, 'TIGER2_UPPER_GLACIS', 'compliant_foundation', { supportStiffness: 2e12, supportDamping: 0 });
  assert.equal(resolvedOverride.user_override, true);
  const boundaryScenario = scenarioApi.makeConfig(presets, 'TIGER2_UPPER_GLACIS', 'TIGER2_PZGR3943', { n: 3000, support: 'compliant_foundation' });
  assert.equal(boundaryScenario[9], 2); assert.equal(boundaryScenario[36], 1e12); assert.equal(boundaryScenario[37], 0);
  assert.throws(() => require('../web/scenario.js').makeConfig(presets, 'TIGER2_UPPER_GLACIS', 'TIGER2_PZGR3943', { support: 'cohesive_interface' }), /unsupported/);
  const apcrScenario = require('../web/scenario.js').makeConfig(presets, 'TIGER2_UPPER_GLACIS', 'TIGER2_PZGR4043', { n: 3000 });
  assert.equal(apcrScenario[24], 1); assert.equal(apcrScenario[25], 0.045); assert.equal(apcrScenario[26], 0.16);
  assert.equal(require('../web/scenario.js').makeConfig(presets, 'TIGER1_UPPER_FRONT', 'TIGER1_PZGR39', { n: 3000, plasticity: 'legacy' })[10], 0, 'legacy law remains opt-in');
});

test('historical reference curves stay source-specific and are not loaded into the outcome solver', () => {
  const tigerI = records.referenceCurves.filter((curve) => curve.ammo_id === 'DE_88_KWK36_PZGR39_1');
  const panzerworld = tigerI.find((curve) => curve.curve_id === 'KWK36_PZGR39_PANZERWORLD' && curve.range_m === 1000);
  const transcription = tigerI.find((curve) => curve.curve_id === 'KWK36_PZGR39_2026_TRANSCRIPTION' && curve.range_m === 1000);
  assert.equal(panzerworld.penetration_mm, 99);
  assert.equal(transcription.penetration_mm, 100);
  assert.equal(panzerworld.reference_only, true);
  assert.equal(panzerworld.source_id, 'S07');
  assert.equal(transcription.source_id, 'S09');
  assert.equal(presets.research.referenceCurves, records.referenceCurves);
  assert.ok(records.referenceTests.some((item) => item.case_id === 'TIGERII_KUBINKA_85MM_FRONT_STOP_1944' && item.velocity_m_s == null));
});

test('release HTML embeds every original CSV byte-for-byte as offline data', () => {
  const html = fs.readFileSync(path.join(root, 'dist/ArmorLab.html'), 'utf8');
  const match = html.match(/window\.ARMORLAB_RESEARCH_CSV=(\{[\s\S]*?\});window\.ARMORLAB_BOUNDARY_CSV="[\s\S]*?";window\.ARMORLAB_WASM_B64=/);
  assert.ok(match, 'research CSV data embedded in generated HTML');
  assert.deepEqual(JSON.parse(match[1]), csv);
});

test('release HTML JavaScript parses before startup scripts run', () => {
  const html = fs.readFileSync(path.join(root, 'dist/ArmorLab.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 10, 'standalone application and worker scripts embedded');
  scripts.forEach((match, index) => new vm.Script(match[1], { filename: `dist/ArmorLab.html#script-${index + 1}` }));
  assert.match(html, /Application script failed:/, 'global startup errors are visible in the app canvas');
});
