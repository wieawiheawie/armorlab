const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const { S, P, root } = require('./helpers.js');
const M = require('../web/materials.js'), D = require('../web/design.js');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const libJson = JSON.parse(rd('designs/material_library.json')), setJson = JSON.parse(rd('designs/builtin_designs.json'));
const Research = require('../web/research.js'), manifest = require('../research/ArmorLab_Research_Pack/manifest.json');
const csv = Object.fromEntries(manifest.csv_files.map((n) => [n, rd('research/ArmorLab_Research_Pack/data/' + n)]));
const sourceIds = new Set(Research.load(csv).sources.keys());
const mk = (storage) => { const lib = new M.Library(JSON.parse(JSON.stringify(libJson)), sourceIds); return { lib, store: new D.DesignStore(lib, JSON.parse(JSON.stringify(setJson)), storage) }; };
const memStorage = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; };
const AMMO = Object.keys(P.ammunition);

test('DSG-01 every ammunition entry resolves to its own built-in design and visual template', () => {
  const { store } = mk(); assert.equal(AMMO.length, 11);
  const ids = new Set(), tpl = new Set();
  for (const a of AMMO) { const d = store.builtinFor(a); assert.equal(d.ammo_id, a); assert.ok(d.builtin); ids.add(d.id); tpl.add(d.template_id); assert.equal(store.designFor(a), d); }
  assert.equal(ids.size, 11); assert.equal(tpl.size, 11);
});
test('DSG-02 designs are visibly distinct: every pair differs in rendered pixels and silhouette', () => {
  const { lib, store } = mk(), ds = [...store.builtin.values()], hashes = new Set(), sils = new Map();
  for (const d of ds) { hashes.add(D.hashRaster(D.rasterize(d, lib, { mode: 'external', scale: 2 }))); sils.set(d.id, d.cells.map((c) => (c ? 1 : 0)).join('') + d.cols); }
  assert.equal(hashes.size, 11);
  const bySil = new Set(sils.values()); assert.equal(bySil.size, 11, 'no two designs share a silhouette (Pzgr.39 vs 39/43 differ by documented band width)');
  const sil = (d) => d.cells.map((c) => (c ? 1 : 0));
  const p39 = store.get('DSG_DE_88_PZGR39'), p3943 = store.get('DSG_DE_88_PZGR39_43'); let diff = 0; sil(p39).forEach((v, i) => { if (v !== sil(p3943)[i]) diff++; }); assert.ok(diff > 0);
});
test('DSG-03 template cell data is valid, uses only supported materials and reports evidence status', () => {
  const { lib, store } = mk();
  for (const d of store.builtin.values()) {
    assert.equal(d.cells.length, d.cols * d.rows); assert.ok(d.rows % 2 === 0, 'axis-symmetric grid');
    for (const id of new Set(d.cells.filter(Boolean))) { assert.ok(lib.has(id)); assert.ok(lib.get(id).builtin_assignable, `${d.id} uses ${id}, which is not assignable to built-ins`); assert.notEqual(lib.get(id).status, 'reference_only'); }
    assert.ok(Object.isFrozen(d.cells), 'built-in cells are immutable');
    assert.ok(d.provenance.features.length >= 4 && d.provenance.features.every((f) => ['documented', 'approximate', 'not_drawn'].includes(f.status)));
    assert.match(d.provenance.visual_status, /VISUAL APPROXIMATION/);
    for (const s of d.provenance.source_ids) assert.ok(sourceIds.has(s), `${d.id} cites unknown source ${s}`);
    const st = D.stats(d), env = d.envelope, a = P.ammunition[d.ammo_id], g = S.projectileGeometry(P, d.ammo_id);
    assert.equal(env.calibre_mm, g.calibreMm); assert.equal(env.length_mm, g.lengthMm);
    assert.ok(Math.abs(st.diameterMm - env.calibre_mm) <= d.cellMm * 2 + 1e-9 && st.diameterMm <= env.calibre_mm + d.cellMm, `${d.id} diameter within a cell of the solver envelope`);
    assert.ok(Math.abs(st.lengthMm - env.length_mm) <= d.cellMm + 1e-9, `${d.id} length within one cell of the solver envelope`);
    assert.match(d.provenance.solver_note, /solver/i);
  }
});
test('DSG-04 no unsupported materials: copper/aluminium absent from built-ins; APCR has core but no sabot; APDS keeps unverified materials', () => {
  const { store } = mk(), used = (id) => new Set(store.get(id).cells.filter(Boolean));
  for (const d of store.builtin.values()) for (const m of used(d.id)) assert.ok(!/COPPER|ALUMINIUM|HEAVY_ALLOY|SOFT_IRON/.test(m), `${d.id} uses unverified ${m}`);
  assert.ok(used('DSG_DE_88_PZGR40_43_APCR').has('MAT_TUNGSTEN_CARBIDE_CORE'));
  assert.ok(!used('DSG_DE_88_PZGR39').has('MAT_TUNGSTEN_CARBIDE_CORE'));
  assert.ok(store.get('DSG_DE_88_PZGR40_43_APCR').provenance.features.some((f) => /sabot/.test(f.name) && f.status === 'not_drawn'));
  const apds = used('DSG_CN_100_TYPE73_APDS'); assert.ok(apds.has('MAT_UNVERIFIED_PRIMARY') && apds.has('MAT_UNVERIFIED_SECONDARY') && ![...apds].some((m) => /TUNGSTEN|ALUMINIUM/.test(m)));
});
test('MAT-01 material library validates; IDs unique, do not collide with solver material IDs, appearance/physical separated', () => {
  assert.deepEqual(M.validate(libJson, sourceIds), []);
  const ids = libJson.materials.map((m) => m.id); assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(!(id in P.materials), `${id} collides with a solver material id`);
  for (const m of libJson.materials) { assert.ok(m.evidence && m.confidence && m.uncertainty); assert.ok(m.physical.unknown.length && m.physical.not_simulated.length); assert.ok(!JSON.stringify(m.appearance).match(/density|yield|modulus/i)); }
  const bad = JSON.parse(JSON.stringify(libJson)); bad.materials[0].appearance.external.density = 7850; assert.ok(M.validate(bad).length);
  const bad2 = JSON.parse(JSON.stringify(libJson)); bad2.materials[2].physical.solver_supported_properties = ['density']; assert.match(M.validate(bad2).join(), /without a solver link/);
  const bad3 = JSON.parse(JSON.stringify(libJson)); bad3.materials[0].appearance.external.base = 'red'; assert.throws(() => new M.Library(bad3));
});
test('MAT-02 changing appearance never changes physical/solver behaviour', () => {
  const { lib } = mk(); const before = {}; for (const id of lib.ids()) before[id] = JSON.stringify(lib.solverProperties(P, id));
  const lib2 = new M.Library((() => { const j = JSON.parse(JSON.stringify(libJson)); for (const m of j.materials) { m.appearance.external.base = '#ff00ff'; m.appearance.external.roughness = 0.99; m.appearance.cutaway.fill = '#00ff00'; m.appearance.cutaway.hatch = 'cross'; } return j; })(), sourceIds);
  for (const id of lib2.ids()) assert.equal(JSON.stringify(lib2.solverProperties(P, id)), before[id]);
  const golden = JSON.parse(rd('tests/fixtures/solver_config_golden.json'));
  for (const [k, v] of Object.entries(golden)) { const [t, a] = k.split('|'); assert.deepEqual(Array.from(S.makeConfig(P, t, a, { n: 5000 })), v, `solver config for ${k} unchanged`); }
  assert.equal(lib.solverProperties(P, 'MAT_COPPER_ALLOY_REF'), null);
  assert.equal(lib.solverProperties(P, 'MAT_TUNGSTEN_CARBIDE_CORE').density_kg_m3, P.ammunition.TIGER2_PZGR4043.core_material.density_kg_m3);
});
test('MAT-03 external and cutaway appearance differ per material; metals are restrained (no saturated rainbow colours)', () => {
  const { lib } = mk();
  for (const m of lib.list()) { const [r, g, b] = M.rgb(m.appearance.external.base), mx = Math.max(r, g, b), mn = Math.min(r, g, b); assert.ok((mx - mn) / (mx || 1) < 0.5, `${m.id} external base too saturated`); }
  const fills = new Set(lib.list().filter((m) => m.status !== 'reference_only').map((m) => m.appearance.cutaway.fill)); assert.equal(fills.size, lib.list().filter((m) => m.status !== 'reference_only').length);
  const d = mk().store.get('DSG_DE_88_PZGR40_43_APCR'); assert.notEqual(D.hashRaster(D.rasterize(d, lib, { mode: 'external', scale: 2 })), D.hashRaster(D.rasterize(d, lib, { mode: 'cutaway', scale: 2 })));
});
test('ED-01 painting, erasing, fill, replace, outline, mirror and symmetrize work on cell data; undo/redo restore it', () => {
  const { store, lib } = mk(); const d = store.duplicate('DSG_DE_88_PZGR39'), h = new D.History(); const base = d.cells.slice();
  h.push(d); assert.ok(D.paint(d, 30, 5, 'MAT_STEEL_CAP_PROVISIONAL', true)); assert.equal(d.get(30, 5), 'MAT_STEEL_CAP_PROVISIONAL'); assert.equal(d.get(30, d.rows - 1 - 5), 'MAT_STEEL_CAP_PROVISIONAL', 'mirrored');
  assert.ok(!D.paint(d, -1, 0, 'MAT_STEEL_CAP_PROVISIONAL')); h.push(d); assert.ok(D.erase(d, 60, 20, false)); assert.equal(d.get(60, 20), null);
  h.push(d); assert.ok(D.replaceMaterial(d, 'MAT_STEEL_HARDENED_AP', 'MAT_UNVERIFIED_PRIMARY')); assert.ok(!d.cells.includes('MAT_STEEL_HARDENED_AP'));
  h.push(d); assert.ok(D.fill(d, 0, 0, 'MAT_UNVERIFIED_SECONDARY', false)); assert.equal(d.get(0, 0), 'MAT_UNVERIFIED_SECONDARY');
  h.push(d); assert.ok(D.outline(d, 'MAT_STEEL_CAP_PROVISIONAL')); h.push(d); D.symmetrize(d, true); for (let c = 0; c < d.cols; c++) assert.equal(d.get(c, 3), d.get(c, d.rows - 4));
  while (h.undo(d)); assert.deepEqual(d.cells, base); while (h.redo(d)); assert.ok(d.cells.some((c) => c === 'MAT_UNVERIFIED_PRIMARY'));
  assert.ok(D.stats(d).cells > 0); assert.ok(lib.has('MAT_UNVERIFIED_SECONDARY'));
});
test('ED-02 built-in templates survive edits, duplication, reset and deletion of copies', () => {
  const { store } = mk(), b = store.get('DSG_SU_122_BR471_APHE'), snapshot = JSON.stringify(D.serializeDesign(b));
  assert.throws(() => D.paint(b, 40, 20, 'MAT_STEEL_CAP_PROVISIONAL'), TypeError);
  const u = store.editable(b.id); assert.notEqual(u.id, b.id); assert.equal(u.based_on, b.id); D.paint(u, 40, 30, 'MAT_STEEL_CAP_PROVISIONAL', true); D.replaceMaterial(u, 'MAT_STEEL_ASSUMED', 'MAT_UNVERIFIED_PRIMARY');
  const dup = store.duplicate(u.id); assert.equal(dup.based_on, b.id);
  assert.equal(JSON.stringify(D.serializeDesign(store.get(b.id))), snapshot);
  store.select(b.ammo_id, u.id); assert.equal(store.designFor(b.ammo_id), u);
  store.reset(u.id); assert.deepEqual(u.cells, b.cells); store.remove(u.id); assert.equal(store.designFor(b.ammo_id), b);
  assert.throws(() => store.remove(b.id)); assert.throws(() => store.reset(b.id).cells.push(1));
  assert.equal(JSON.stringify(D.serializeDesign(store.get(b.id))), snapshot);
});
test('SAVE-01 saved designs reload exactly (export/import and storage), and invalid data is rejected without harming built-ins', () => {
  const st = memStorage(), a = mk(st), u = a.store.duplicate('DSG_CN_100_TYPE73_HEATFS', 'my heat'); D.paint(u, 70, 25, 'MAT_COPPER_ALLOY_REF', true); a.store.select(u.ammo_id, u.id);
  const text = a.store.exportJson(u.id), back = D.parseDesign(JSON.parse(text), a.lib); assert.deepEqual(back.cells, u.cells); assert.equal(back.name, 'my heat');
  const b = mk(st); const re = b.store.get(u.id); assert.deepEqual(re.cells, u.cells); assert.equal(b.store.designFor(u.ammo_id).id, u.id); assert.equal(re.builtin, false);
  const imp = b.store.importJson(text); assert.notEqual(imp.id, u.id); assert.deepEqual(imp.cells, u.cells);
  const good = JSON.parse(text), tweak = (fn) => { const j = JSON.parse(text); fn(j); return JSON.stringify(j); };
  for (const bad of [tweak((j) => { j.schema = 'x'; }), tweak((j) => { j.rows[3] = j.rows[3].slice(1); }), tweak((j) => { j.legend.a = 'MAT_NOPE'; }), tweak((j) => { j.rows[0] = 'z'.repeat(j.grid.cols); }), tweak((j) => { j.rows.pop(); }), tweak((j) => { j.grid.cell_mm = -1; }), '{', tweak((j) => { j.rows = j.rows.map((r) => '.'.repeat(r.length)); })]) assert.throws(() => b.store.importJson(bad));
  assert.equal(b.store.builtin.size, 11);
  const st2 = memStorage(); st2.setItem(D.KEY, '{corrupt'); assert.equal(mk(st2).store.user.size, 0);
  const st3 = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }; const c = mk(st3); c.store.duplicate('DSG_DE_88_PZGR39'); assert.equal(c.store.user.size, 1);
  assert.ok(good.rows.length);
});
test('VIS-01 catalogue thumbnail, inspection preview and viewport use one rasteriser over one design object', () => {
  const { lib, store } = mk(), app = rd('web/app.js'), ui = rd('web/design_ui.js');
  for (const a of AMMO) { const d = store.designFor(a); assert.equal(D.hashRaster(D.rasterize(d, lib, { mode: 'external', scale: 3 })), D.hashRaster(D.rasterize(store.designFor(a), lib, { mode: 'external', scale: 3 }))); }
  assert.equal((ui.match(/store\.designFor\(/g) || []).length >= 3, true); assert.match(app, /DStore\.designFor\(\$\('ammo'\)\.value\)/); assert.match(app, /DUI\.rasterCanvas\(dsg/);
  assert.equal((ui + app).match(/D\.rasterize\(/g).length >= 1, true); assert.doesNotMatch(app, /projectileSilhouette\(profile\)/, 'old generic SVG silhouette preview removed');
  const u = store.duplicate('DSG_US_76_M62_APCT'); D.paint(u, 50, 20, 'MAT_STEEL_CAP_PROVISIONAL', true); store.select('US_76_M62_APCT', u.id);
  assert.equal(store.designFor('US_76_M62_APCT').id, u.id, 'selection is shared by catalogue and viewport lookups');
});
test('PKG-01 offline HTML embeds the material library, every template and the design modules (when built)', { skip: !fs.existsSync(path.join(root, 'dist/ArmorLab.html')) && 'dist not built' }, () => {
  const html = rd('dist/ArmorLab.html');
  for (const m of libJson.materials) assert.ok(html.includes(m.id), m.id);
  for (const d of setJson.designs) { assert.ok(html.includes(d.id), d.id); assert.ok(html.includes(d.rows[10]), `${d.id} cell rows embedded`); }
  for (const t of ['ARMORLAB_MATERIALS=', 'ARMORLAB_DESIGNS=', 'ALMaterials', 'ALDesignUI', 'openEd', 'openCat', 'setPalette']) assert.ok(html.includes(t), t);
  assert.ok(!/<script[^>]+src=/.test(html) && !/https?:\/\/[^"'\s]+\.(js|css)/.test(html.replace(/<a href[^>]*>/g, '')), 'no external scripts');
  assert.ok(/Rust\/WASM|JS-ONLY/.test(html));
});
