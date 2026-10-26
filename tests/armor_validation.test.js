'use strict';
// Armour stability, mass/momentum/energy accounting, ammunition-specific configuration and numerical-consistency regressions.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { E, S, P, mk, root, T1, T2, A1, A2, A3 } = require('./helpers.js');
const N = E.STAT_NAMES, st = (s, lvl) => Object.fromEntries(N.map((k, i) => [k, s.stats(lvl)[i]]));
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const TARGETS = Object.keys(P.targets), AMMO = Object.keys(P.ammunition).filter((id) => P.ammunition[id].simulation_status === 'kinetic_approximation');
const CATALOGUE_AMMO = Object.keys(P.ammunition).filter((id) => P.ammunition[id].simulation_status === 'catalogue_only');
const EXPERIMENTAL_AMMO = Object.keys(P.ammunition).filter((id) => P.ammunition[id].simulation_status === 'experimental_approximation');

test('ARM-01 every target starts undamaged, at rest, and stress-free for every support mode and round', () => {
  for (const t of TARGETS) for (const a of AMMO) for (const support of [0, 1, 2]) {
    const s = mk(t, a, 2500, { support });
    assert.equal(s.nBrokenCount, 0); assert.ok(s.bbroken.every((b) => b === 0));
    assert.ok(s.bep.every((v) => v === 0), 'no accumulated plastic strain');
    assert.ok(s.vx.every((v) => v === 0) && s.vy.every((v) => v === 0), 'at rest before firing');
    let fmax = 0; for (let i = 0; i < s.n; i++) fmax = Math.max(fmax, Math.hypot(s.fx[i], s.fy[i]));
    assert.ok(fmax < 1e-6, `${t}/${a}: initial net force ${fmax} N`);
    for (let b = 0; b < s.bi.length; b++) assert.equal(s.bl[b], s.bl0[b], 'rest length = initial length');
    const o = st(s, 2); assert.equal(o.ke, 0); assert.equal(o.frag_count, 0); assert.equal(o.e_total, 0);
  }
});
test('GEOM-01 every ammunition record resolves a dimensioned, traceable simulation geometry profile', () => {
  const codes = { rounded: 0, pointed: 1, ogive: 2 }, signatures = new Set();
  for (const [id, ammo] of Object.entries(P.ammunition)) {
    const profile = S.projectileGeometry(P, id), points = S.projectileSilhouette(profile, 48);
    const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
    const width = Math.max(...xs) - Math.min(...xs), diameter = Math.max(...ys) - Math.min(...ys);
    assert.ok(Math.abs(width - profile.lengthMm / 1000) < 1e-12, `${id} preview length uses mm-to-m conversion`);
    assert.ok(Math.abs(diameter - profile.calibreMm / 1000) < 1e-12, `${id} preview diameter follows calibre`);
    assert.ok(profile.basis, `${id} geometry basis is displayed and traceable`);
    const cfg = S.makeConfig(P, T2, id, { n: 2500 });
    assert.ok(Math.abs(cfg[4] - profile.calibreMm / 1000) < 1e-12);
    assert.ok(Math.abs(cfg[5] - profile.lengthMm / 1000) < 1e-12);
    assert.ok(Math.abs(cfg[6] - profile.noseLengthMm / 1000) < 1e-12);
    assert.equal(cfg[38], codes[profile.noseProfile]);
    assert.equal(cfg[39], profile.bodyTaperFraction);
    if (EXPERIMENTAL_AMMO.includes(id)) {
      const signature = JSON.stringify([cfg[4], cfg[5], cfg[6], cfg[38], cfg[39]]);
      assert.ok(!signatures.has(signature), `${id} has its own geometry configuration`);
      signatures.add(signature);
    }
  }
  assert.equal(signatures.size, 8);
});
test('GEOM-02 configured nose and taper change sampled solver geometry; view zoom cannot alter it', () => {
  const base = S.makeConfig(P, T2, 'US_76_M62_APCT', { n: 2500 });
  const pointed = base.slice(); pointed[38] = 1; pointed[39] = 0.2;
  const a = new E.Sim(base), b = new E.Sim(pointed);
  assert.notEqual(a.n - a.nPlate, b.n - b.nPlate, 'nose/taper profile changes sampled projectile geometry');
  const preview = S.projectileSilhouette(S.projectileGeometry(P, 'US_76_M62_APCT'));
  const physicalWidth = Math.max(...preview.map((point) => point[0])) - Math.min(...preview.map((point) => point[0]));
  for (const zoom of [0.1, 1, 10]) {
    const screenWidth = physicalWidth * zoom;
    assert.ok(Math.abs(screenWidth / zoom - physicalWidth) < 1e-12, 'zoom is a view transform and does not mutate model dimensions');
  }
  const APCR = S.projectileGeometry(P, A3), APDS = S.projectileGeometry(P, 'CN_100_TYPE73_APDS');
  assert.ok(APCR.core && APCR.core.geometry, 'APCR preview uses its estimated, solver-enabled core record');
  assert.equal(APDS.core, null, 'APDS approximation does not borrow APCR core/carrier geometry');
  assert.match(APDS.metadataOnlyFeatures.join(' '), /sabot/);
  assert.match(S.projectileGeometry(P, 'CN_100_TYPE73_HEATFS').metadataOnlyFeatures.join(' '), /jet/);
});
test('ARM-02 an unfired armour coupon stays undamaged and motionless over a long run', () => {
  const s = mk(T2, A2, 2500); s.run(2000);
  const o = st(s, 2); assert.equal(o.bonds_broken, 0); assert.ok(o.max_speed < 1e-9); assert.ok(o.max_disp < 1e-12);
});
test('ARM-03 plate geometry, mass and thickness are internally consistent for every target', () => {
  for (const t of TARGETS) {
    const tg = P.targets[t], s = mk(t, tg.pairing, 4000), o = st(s, 0);
    const layers = Math.round(tg.nominal_thickness_mm * 1e-3 / s.h);
    assert.ok(rel(layers * s.h, tg.nominal_thickness_mm * 1e-3) < 1e-12, 'thickness = layers * h exactly');
    const nf = s.nPlate / layers; assert.equal(nf, Math.round(nf));
    assert.ok(rel(o.plate_mass, P.materials.PLATE_PROVISIONAL.density_kg_m3 * layers * s.h * nf * s.h * s.dz) < 1e-12, 'plate mass = rho * area * dz');
    // normal is perpendicular to the face tangent and tilted by the configured slope from vertical
    const nrm = s.nrm, ang = Math.asin(Math.abs(nrm[1])) * 180 / Math.PI;
    assert.ok(Math.abs(ang - tg.slope_from_vertical_deg) < 1e-9, `${t}: plate slope ${ang}`);
    assert.ok(Math.abs(tg.slope_from_vertical_deg + tg.face_angle_from_horizontal_deg - 90) < 1e-9);
  }
});
test('ARM-04 Tiger plate-angle uncertainty stays visible in the data (not silently resolved)', () => {
  const csv = fs.readFileSync(path.join(root, 'research/ArmorLab_Research_Pack/data/armor_surfaces_and_samples.csv'), 'utf8');
  assert.ok(/conflict|unresolved|differs|datum/i.test(csv), 'research pack records the angle conflict');
  const doc = fs.readFileSync(path.join(root, 'docs/PHYSICS_MODEL.md'), 'utf8'); assert.ok(/8°/.test(doc) && /9°/.test(doc));
});
test('MASS-01 projectile component masses sum exactly to the configured projectile mass for every round', () => {
  for (const a of AMMO) {
    const s = mk(T2, a, 3000), o = st(s, 0), M = P.ammunition[a].projectile_mass_kg;
    assert.ok(rel(o.proj_mass, M) < 1e-12, `${a}: ${o.proj_mass} vs ${M}`);
    assert.ok(rel(o.mass_proj_mat1 + o.mass_proj_mat2, M) < 1e-12, 'body + core = total');
    if (P.ammunition[a].solver_component_model === 'coaxial_core_carrier') { assert.ok(o.mass_proj_mat2 > 0 && o.mass_proj_mat1 > 0); }
    else assert.equal(o.mass_proj_mat2, 0);
  }
});
test('MASS-02 APCR plane-strain core mass share is reported and exceeds the TM 9-1985-3 Type 40 share (known 2D limitation)', () => {
  const o = st(mk(T2, A3, 3000), 0), share = o.mass_proj_mat2 / o.proj_mass;
  const tm = P.ammunition[A3].mass_share_evidence.tm_9_1985_3_type40_core_share;
  assert.ok(share > tm, `model share ${share.toFixed(3)} should be reported as larger than ${tm}; if it is not, the limitation text is stale`);
  const d = P.ammunition[A3].projectile_components.find((c) => c.id === 'wc_core').geometry.diameter_mm, D = P.ammunition[A3].calibre_mm;
  assert.ok((d / D) > (d / D) ** 2, 'area ratio exceeds axisymmetric volume ratio');
});
test('MOM-01 initial momentum and kinetic energy equal the configured projectile mass and speed', () => {
  for (const a of AMMO) {
    const s = mk(T2, a, 3000); s.fire(); const o = st(s, 0), M = P.ammunition[a].projectile_mass_kg, v = P.ammunition[a].nominal_muzzle_velocity_mps;
    assert.ok(rel(o.momentum_x, M * v) < 1e-12 && Math.abs(o.momentum_y) < 1e-9);
    assert.ok(rel(o.ke0, 0.5 * M * v * v) < 1e-12 && rel(o.ke, o.ke0) < 1e-12);
    assert.ok(rel(o.ke_proj_mat1 + o.ke_proj_mat2, o.ke0) < 1e-12, 'component kinetic energies sum to total');
  }
});
test('MOM-02 total momentum change equals the support-reaction impulse (clamped) and is exactly conserved (free)', () => {
  for (const [t, a] of [[T1, A1], [T2, A2], [T2, A3]]) for (const support of [0, 1]) {
    const s = mk(t, a, 2500, { support }); s.fire(); const p0 = st(s, 0).momentum_x; s.run(Math.round(100e-6 / s.dt));
    const o = st(s, 0), bal = (o.momentum_x - p0 - o.impulse_x) / p0, bal_y = (o.momentum_y - o.impulse_y) / p0;
    assert.ok(Math.abs(bal) < 2e-3 && Math.abs(bal_y) < 2e-3, `${t}/${a}/support ${support}: balance ${bal}`);
    if (support === 1) assert.equal(o.impulse_x, 0); else assert.ok(Math.abs(o.impulse_x) > 0, 'clamped support exerts an impulse');
  }
});
test('NRG-01 energy residual stays below 1% for each round and halves when the timestep is halved', () => {
  for (const [t, a] of [[T1, A1], [T2, A2], [T2, A3]]) {
    const r = [0.25, 0.125].map((dtf) => { const s = mk(t, a, 2500, { dtf }); s.fire(); s.run(Math.round(100e-6 / s.dt)); return Math.abs(st(s, 2).resid_rel); });
    assert.ok(r[0] < 0.01, `${t}/${a}: residual ${r[0]}`);
    assert.ok(r[1] < 0.7 * r[0], `${t}/${a}: residual should shrink with dt (${r[0]} -> ${r[1]})`);
  }
});
test('NRG-02 plastic dissipation is the work of the capped force: cumulative ledger never exceeds delivered kinetic loss + stored energy', () => {
  const s = mk(T1, A1, 2500); s.fire(); s.run(Math.round(100e-6 / s.dt)); const o = st(s, 2);
  assert.ok(o.e_pl >= 0 && o.e_fr >= 0 && o.e_damp >= 0);
  assert.ok(o.e_pl + o.e_fr + o.e_damp + o.e_el + o.e_hard + o.e_ct <= o.ke0 * 1.01 - o.ke + 1e-6 * o.ke0, 'no creation of energy through dissipation terms');
});
test('NUM-11 macroscopic outcome varies little with timestep and particle spacing (no unconstrained resolution dependence)', () => {
  const run = (n, dtf) => { const s = mk(T1, A1, n, { dtf }); s.fire(); s.run(Math.round(100e-6 / s.dt)); return st(s, 2); };
  const ref = run(3000, 0.25), fineDt = run(3000, 0.125), fineN = run(6000, 0.25);
  assert.ok(rel(fineDt.proj_vx, ref.proj_vx) < 0.06 && Math.abs(fineDt.proj_depth - ref.proj_depth) < 0.012, 'timestep');
  assert.ok(rel(fineN.proj_vx, ref.proj_vx) < 0.06 && Math.abs(fineN.proj_depth - ref.proj_depth) < 0.012, 'particle spacing');
  assert.ok(Math.abs(fineN.bonds_broken / fineN.bonds - ref.bonds_broken / ref.bonds) < 0.05, 'damage fraction');
});
test('FRG-01 debris is split into numerical single-particle debris (<4 particles) and resolved fragments', () => {
  const s = mk(T2, A3, 2500); s.fire(); s.run(Math.round(100e-6 / s.dt)); const o = st(s, 2);
  assert.equal(o.frag_small_count + o.frag_large_count, o.frag_count);
});
test('AMMO-01 every solver-enabled round reaches the solver with its own configuration (preset -> makeConfig -> engine -> WASM adapter)', () => {
  const seen = new Set();
  for (const a of AMMO) {
    const A = P.ammunition[a], c = S.makeConfig(P, A.compatible_gun_ids ? T2 : T2, a, { n: 2500 });
    assert.equal(c[7], A.projectile_mass_kg); assert.equal(c[8], A.nominal_muzzle_velocity_mps); assert.equal(c[4], A.calibre_mm * 1e-3);
    assert.equal(c[24], A.solver_component_model === 'coaxial_core_carrier' ? 1 : 0);
    const s = new E.Sim(c); assert.ok(rel(st(s, 0).proj_mass, A.projectile_mass_kg) < 1e-12);
    seen.add(JSON.stringify([c[7], c[8], c[24], c[27] || 0]));
  }
  assert.equal(seen.size, AMMO.length, 'no two rounds map to an identical solver configuration');
  const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'web/runner.js'), 'utf8');
  assert.ok(/makeConfig\(/.test(app), 'UI/runner builds configs through makeConfig');
});
test('AMMO-04 international entries retain historical metadata and explicit inert-body approximation profiles', () => {
  const expected = [
    'US_76_M62_APCT', 'US_90_M82_APCT', 'SU_122_BR471_APHE', 'SU_122_BR471B_APHEBC',
    'CN_100_TYPE73_APDS', 'CN_100_TYPE73_HEATFS', 'SE_57_SLPGR_M43', 'IT_90_53_CGP'
  ];
  assert.equal(CATALOGUE_AMMO.length, 0);
  assert.deepEqual(EXPERIMENTAL_AMMO, expected);
  const designations = {
    US_76_M62_APCT: ['United States', '76 mm M62 APC-T'],
    US_90_M82_APCT: ['United States', '90 mm M82 APC-T'],
    SU_122_BR471_APHE: ['Soviet Union', '122 mm BR-471 APHE'],
    SU_122_BR471B_APHEBC: ['Soviet Union', '122 mm BR-471B APHEBC'],
    CN_100_TYPE73_APDS: ['China', '100 mm Type 73 APDS'],
    CN_100_TYPE73_HEATFS: ['China', '100 mm Type 73 / Type 1973 HEAT-FS'],
    SE_57_SLPGR_M43: ['Sweden', '57 mm slpgr m/43 APHEBC'],
    IT_90_53_CGP: ['Italy', '90 mm Cartoccio Granata Perforante Mod. 1909']
  };
  for (const id of expected) {
    const ammo = P.ammunition[id];
    assert.deepEqual([ammo.country, ammo.designation], designations[id]);
    assert.equal(ammo.id, id);
    assert.equal(ammo.simulation_status, 'experimental_approximation');
    assert.equal(ammo.solver_component_model, 'effective_solid_body');
    assert.ok(ammo.country && ammo.designation && ammo.family);
    assert.ok(ammo.international_evidence.source_ids.length);
    const approximation = ammo.solver_approximation;
    assert.equal(approximation.status, 'experimental_approximation');
    assert.equal(approximation.model, 'effective_solid_body');
    assert.ok(approximation.mass_basis && approximation.velocity_basis && approximation.geometry_basis && approximation.material_basis);
    assert.ok(approximation.metadata_only_features.length);
    const cfg = S.makeConfig(P, T2, id, { n: 2500 });
    assert.equal(cfg[7], approximation.mass_kg);
    assert.equal(cfg[8], approximation.initial_velocity_mps);
    assert.equal(cfg[4], ammo.calibre_mm * 1e-3);
    assert.equal(cfg[5], approximation.length_mm * 1e-3);
    assert.equal(cfg[6], approximation.nose_length_mm * 1e-3);
    assert.equal(cfg[24], 0, 'uses inert effective body, not the German APCR component model');
  }
  assert.notEqual(P.ammunition.SU_122_BR471_APHE.designation, P.ammunition.SU_122_BR471B_APHEBC.designation);
  assert.notEqual(P.ammunition.CN_100_TYPE73_APDS.family, P.ammunition.CN_100_TYPE73_HEATFS.family);
  assert.deepEqual(P.ammunition.IT_90_53_CGP.documented_variants.map((variant) => variant.designation), [
    'Cartoccio Granata Perforante Mod. 1909', 'additional unlabeled Granata Perforante line'
  ]);
  assert.equal(P.ammunition.IT_90_53_CGP.documented_variants[1].id, 'IT_90_53_CGP_UNSPECIFIED_LINE');
  assert.equal(P.ammunition.IT_90_53_CGP.documented_variants[1].mass_table_value_kg, null);
  assert.match(P.ammunition.CN_100_TYPE73_APDS.solver_approximation.metadata_only_features.join(' '), /sabot discard/);
  assert.match(P.ammunition.CN_100_TYPE73_HEATFS.solver_approximation.metadata_only_features.join(' '), /jet formation/);
  const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
  assert.match(app, /optgroup/);
  assert.match(app, /Experimental approximation/);
  assert.match(app, /projectilePreview/);
  assert.match(app, /Object\.entries\(P\.ammunition\)/);
});
test('AMMO-05 every international approximation builds, fires, and advances in JavaScript and embedded Rust/WASM', async () => {
  const html = fs.readFileSync(path.join(root, 'dist/ArmorLab.html'), 'utf8');
  for (const id of EXPERIMENTAL_AMMO) assert.ok(html.includes(id), `${id} appears in the standalone application data`);
  const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
  assert.match(app, /\$\('ammo'\)\.onchange = \(\) => \{ syncAmmo\(\); build\(\); \};/);
  assert.match(app, /\$\('fire'\)\.onclick = \(\) => \{ if \(st\.started \|\| !st\.ready\) return; st\.host\.send\(\{ t: 'fire' \}\);/);
  assert.match(app, /\$\('fire'\)\.disabled = false; setState\('ready'\)/);
  assert.match(app, /new Option\(`\$\{a\.designation \|\| a\.name\} — \$\{a\.family\} — \$\{a\.gun\}`, id\)/);
  assert.match(app, /\$\('reset'\)\.onclick = \(\) => build\(\);/);
  const match = html.match(/ARMORLAB_WASM_B64="([A-Za-z0-9+/=]+)"/);
  assert.ok(match, 'release HTML contains embedded WASM');
  const context = { WebAssembly, Uint8Array, Float64Array, atob };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'web/engine_wasm.js'), 'utf8'), context);
  const { Sim: WasmSim } = await context.ALEngineWasm.load(match[1]);
  const configs = new Set();
  for (const id of EXPERIMENTAL_AMMO) {
    const cfg = S.makeConfig(P, T2, id, { n: 2500 });
    const signature = JSON.stringify(Array.from(cfg));
    assert.ok(!configs.has(signature), `${id} must not resolve to another round's configuration`);
    configs.add(signature);
    const js = new E.Sim(cfg), wasm = new WasmSim(cfg);
    js.fillRender(true);
    assert.ok(js.stats(2)[30] > 0, `${id} creates JavaScript projectile particles`);
    assert.ok(wasm.stats(2)[30] > 0, `${id} creates WASM projectile particles`);
    assert.equal(js.n, wasm.n, `${id} particle count parity`);
    assert.equal(js.nPlate, wasm.nPlate, `${id} plate count parity`);
    assert.deepEqual(Array.from(js.rPos), Array.from(wasm.rPos), `${id} initial render geometry parity`);
    js.fire(); wasm.fire(); js.run(3); wasm.run(3);
    assert.equal(js.stats(0)[31], 1, `${id} fired in JS`);
    assert.equal(wasm.stats(0)[31], 1, `${id} fired in WASM`);
    assert.ok(js.stats(0)[0] > 0 && js.stats(0)[1] >= 3, `${id} advanced in JS`);
    assert.ok(wasm.stats(0)[0] > 0 && wasm.stats(0)[1] >= 3, `${id} advanced in WASM`);
    assert.ok(Math.abs(js.stats(0)[26] - P.ammunition[id].solver_approximation.mass_kg) < 1e-9);
    assert.ok(Math.abs(wasm.stats(0)[26] - P.ammunition[id].solver_approximation.mass_kg) < 1e-9);
    assert.ok(Math.abs(js.stats(0)[22] - wasm.stats(0)[22]) < 1e-9, `${id} JS/WASM projectile velocity parity`);
    assert.ok(Math.abs(js.stats(0)[24] - wasm.stats(0)[24]) < 1e-9, `${id} JS/WASM mass-behind-plane parity`);
  }
});
test('AMMO-02 APCBC rounds share evidence-based body parameters; simulated/unsimulated components are not overstated', () => {
  for (const a of [A1, A2]) {
    const A = P.ammunition[a];
    assert.equal(A.solver_component_model, 'effective_solid_body');
    for (const id of ['ap_cap', 'ballistic_wind_cap', 'base_cavity_fuze_filler']) assert.equal(A.projectile_components.find((c) => c.id === id).simulated, false, `${a}/${id}`);
    assert.ok(A.construction_evidence && /NOT simulated/.test(A.construction_evidence.ap_cap_dimensions_and_material));
    assert.ok(A.construction_evidence.unresolved_masses);
  }
  assert.ok(P.ammunition[A2].construction_evidence.filler_conflict, 'Panzerworld 64 g vs Wikipedia 59 g conflict preserved');
  assert.ok(P.ammunition[A2].projectile_mass_evidence.includes('22.8 lb'), 'TM mass conflict preserved');
});
test('AMMO-03 APCR core and carrier both participate: separate masses, kinetic energy, interface bonds that can fail', () => {
  const s = mk(T2, A3, 3000); s.fire(); s.run(Math.round(60e-6 / s.dt)); const o = st(s, 2);
  assert.ok(o.mass_proj_mat1 > 0 && o.mass_proj_mat2 > 0 && o.ke_proj_mat1 > 0 && o.ke_proj_mat2 > 0);
  let iface = 0, ifaceBroken = 0, core = 0; for (let b = 0; b < s.bi.length; b++) { if (s.bm[b] === 3) { iface++; ifaceBroken += s.bbroken[b]; } if (s.bm[b] === 2) core++; }
  assert.ok(iface > 0 && core > 0 && ifaceBroken > 0, `interface ${iface}, core ${core}, interface broken ${ifaceBroken}`);
});
test('OUT-02 solver sources contain no hard-coded outcome, round names or penetration tables', () => {
  for (const f of ['web/engine_js.js', 'src/sim.rs']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/TIGER|Pzgr|penetrat(e|ion) *=|ricochet *=|mm_rha|historical_penetration/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), `${f} references named rounds or outcomes`);
  }
});
test('ENG-01 JS and Rust engines expose the same stats layout', () => {
  assert.equal(N.length, 57);
  const rs = fs.readFileSync(path.join(root, 'src/sim.rs'), 'utf8'); assert.ok(/STAT_LEN: usize = 57/.test(rs));
});
test('SUP-01 selected support mode controls actual constraints and reports solver-derived diagnostics', () => {
  const rigid = mk(T2, A2, 2500, { support: 0 });
  const free = mk(T2, A2, 2500, { support: 1 });
  const compliant = mk(T2, A2, 2500, { support: 2, supportStiffness: 1e12, supportDamping: 0 });
  assert.equal(st(rigid, 0).support_mode, 0); assert.ok(rigid.fixed.reduce((a, b) => a + b, 0) > 0);
  assert.equal(st(free, 0).support_mode, 1); assert.equal(free.fixed.reduce((a, b) => a + b, 0), 0); assert.equal(st(free, 0).support_node_count, 0);
  assert.equal(rigid.dt, free.dt, 'inactive foundation coefficients do not constrain rigid/free timesteps');
  assert.equal(st(compliant, 0).support_mode, 2); assert.equal(compliant.fixed.reduce((a, b) => a + b, 0), 0); assert.ok(st(compliant, 0).support_node_count > 0);
  assert.equal(st(rigid, 0).constrained_dof_count, 2 * st(rigid, 0).support_node_count);
  assert.equal(st(compliant, 0).constrained_dof_count, 0);
  const reset = new E.Sim(S.makeConfig(P, T2, A2, { n: 2500, support: 2, supportStiffness: 1e12 }));
  assert.equal(st(reset, 0).support_mode, 2);
});
test('SUP-02 compliant foundation force and energy use the configured distributed spring law', () => {
  const cfg = S.makeConfig(P, T2, A2, { n: 2500, support: 2, supportStiffness: 1e12, supportDamping: 1e8 });
  const s = new E.Sim(cfg), freeCfg = cfg.slice(); freeCfg[9] = 1;
  const free = new E.Sim(freeCfg);
  const i = s.supportNodes.findIndex((v, j) => v && j < s.nPlate);
  assert.ok(i >= 0); s.x[i] += 1e-5; free.x[i] += 1e-5; s.vx[i] = free.vx[i] = 0.01;
  s.computeForces(); free.computeForces();
  const kArea = cfg[36] * s.h * s.dz, cArea = cfg[37] * s.h * s.dz;
  assert.ok(Math.abs((s.fx[i] - free.fx[i]) - (-kArea * 1e-5 - cArea * 0.01)) < 1e-8);
  const o = st(s, 1); assert.ok(o.support_elastic_energy > 0 && o.reaction_magnitude > 0);
});
test('SUP-03 support impulse closes momentum balance; stationary rigid support does no work', () => {
  for (const support of [0, 1, 2]) {
    const s = mk(T2, A2, 2500, { support, supportStiffness: 1e12, supportDamping: 1e8 });
    s.fire(); const initial = st(s, 0); s.run(Math.round(100e-6 / s.dt)); const o = st(s, 0);
    assert.ok(Math.abs(o.momentum_x - initial.momentum_x - o.impulse_x) < 2e-3 * P.ammunition[A2].projectile_mass_kg * P.ammunition[A2].nominal_muzzle_velocity_mps);
    assert.ok(Math.abs(o.momentum_y - initial.momentum_y - o.impulse_y) < 2e-3 * P.ammunition[A2].projectile_mass_kg * P.ammunition[A2].nominal_muzzle_velocity_mps);
    if (support === 0) assert.equal(o.support_work, 0);
    if (support === 1) assert.equal(o.impulse_x + o.impulse_y, 0);
    if (support === 2) assert.ok(o.support_elastic_energy >= 0 && o.support_damping_loss >= 0);
  }
});
test('SUP-04 offline application exposes the three modeled supports and solver-derived telemetry', () => {
  const template = fs.readFileSync(path.join(root, 'web/index.template.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
  const built = fs.readFileSync(path.join(root, 'dist/ArmorLab.html'), 'utf8');
  assert.match(template, /<select id="support"><\/select>/, 'support options are populated from the data table');
  for (const label of ['rigid fixture (fixed end regions)', 'free plate (no support)', 'compliant foundation', 'cohesive interface (unsupported)']) assert.ok(app.includes(label), `application includes ${label}`);
  assert.ok(built.includes('tiger2_glacis_weld'), 'standalone application embeds boundary data');
  assert.match(app, /supportLabel = st\.boundary \?/, 'display includes the selected model resolved from active scenario data');
  for (const label of ['support reaction x, y / resultant', 'support impulse x, y', 'momentum balance error x, y', 'support elastic energy', 'support damping loss', 'active foundation coefficients', 'boundary evidence / uncertainty']) {
    assert.ok(app.includes(label), `telemetry includes ${label}`);
  }
});
test('SUP-05 compliant support force, spring energy, damping power, and impact residual refine consistently', () => {
  const measurements = [2500, 5000, 10000].map((n) => {
    const cfg = S.makeConfig(P, T2, A2, { n, support: 'compliant_foundation', supportStiffness: 1e12, supportDamping: 2e8 });
    const s = new E.Sim(cfg);
    let area = 0;
    for (let i = 0; i < s.nPlate; i++) if (s.supportNodes[i]) {
      area += s.h * s.dz;
      s.x[i] += 1e-3;
      s.vx[i] = 0.1;
    }
    s.computeForces();
    assert.ok(rel(s.reactX, -cfg[36] * area * 1e-3 - cfg[37] * area * 0.1) < 1e-12, 'distributed force follows kappa/cA times represented area');
    assert.ok(rel(s.supportEnergy, 0.5 * cfg[36] * area * 1e-6) < 1e-12, 'foundation elastic energy uses per-node k');
    assert.ok(rel(s.supportDampingPower, cfg[37] * area * 0.01) < 1e-12, 'dashpot loss rate uses actual relative velocity');
    return { area, force: s.reactX };
  });
  assert.ok(rel(measurements[2].area, measurements[1].area) < 0.02 && rel(measurements[1].area, measurements[0].area) < 0.02, 'represented foundation area is stable under resolution refinement');
  assert.ok(rel(measurements[2].force, measurements[1].force) < 0.02 && rel(measurements[1].force, measurements[0].force) < 0.02, 'aggregate support force is stable under resolution refinement');
  const residuals = [0.25, 0.125].map((dtf) => {
    const s = new E.Sim(S.makeConfig(P, T2, A2, { n: 2500, dtf, support: 'compliant_foundation', supportStiffness: 1e12, supportDamping: 0 }));
    s.fire(); s.run(Math.round(100e-6 / s.dt)); return Math.abs(st(s, 2).resid_rel);
  });
  assert.ok(residuals[0] < 0.01 && residuals[1] < 0.7 * residuals[0], `compliant energy error decreases with dt: ${residuals}`);
});
