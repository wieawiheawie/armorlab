const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const Research = require('../web/research.js');
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
  assert.equal(records.sources.size, 34);
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

test('scenario configuration uses sourced values while exposing unresolved geometry conflict', () => {
  assert.equal(presets.targets.TIGER1_UPPER_FRONT.nominal_thickness_mm, 100);
  assert.equal(presets.targets.TIGER1_UPPER_FRONT.slope_from_vertical_deg, 9);
  assert.match(presets.targets.TIGER1_UPPER_FRONT.geometry_note, /reports 8°/);
  assert.equal(presets.targets.TIGER2_UPPER_GLACIS.slope_from_vertical_deg, 50);
  assert.equal(presets.ammunition.TIGER1_PZGR39.projectile_mass_kg, 10.2);
  assert.equal(presets.ammunition.TIGER2_PZGR3943.nominal_muzzle_velocity_mps, 1000);
  const scenario = require('../web/scenario.js').makeConfig(presets, 'TIGER1_UPPER_FRONT', 'TIGER1_PZGR39', { n: 3000 });
  assert.equal(scenario[1], 0.1);
  assert.equal(scenario[8], 773);
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
  const match = html.match(/window\.ARMORLAB_RESEARCH_CSV=(\{[\s\S]*?\});window\.ARMORLAB_WASM_B64=/);
  assert.ok(match, 'research CSV data embedded in generated HTML');
  assert.deepEqual(JSON.parse(match[1]), csv);
});
