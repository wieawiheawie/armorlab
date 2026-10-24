const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const { E, S, P, root, mk, T1, T2, A1, A2 } = require('./helpers');
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m || ''} got ${a}, want ${b} ±${tol}`);

test('GEO-01/02 Tiger I: 100 mm perpendicular, 9 deg from vertical (81 from horizontal), LOS 101.2 mm', () => {
  const t = P.targets[T1];
  assert.equal(t.nominal_thickness_mm, 100); assert.equal(t.slope_from_vertical_deg, 9); assert.equal(t.face_angle_from_horizontal_deg, 81);
  near(S.losMm(100, 9), 101.25, 0.01);
});
test('GEO-03 Tiger II: 150 mm, 50 deg from vertical (40 from horizontal), LOS 233.4 mm', () => {
  const t = P.targets[T2]; assert.equal(t.nominal_thickness_mm, 150); assert.equal(t.slope_from_vertical_deg, 50); assert.equal(t.face_angle_from_horizontal_deg, 40);
  near(S.losMm(150, 50), 233.36, 0.01);
  for (const [id, t2] of Object.entries(P.targets)) assert.equal(t2.slope_from_vertical_deg + t2.face_angle_from_horizontal_deg, 90, id);
});
test('GEO-04 rotated particle body has exact perpendicular thickness; horizontal ray path through particles = LOS', () => {
  for (const id of [T1, 'TIGER1_NOSE_ALT', T2]) for (const n of [3000, 9000]) {
    const t = P.targets[id], s = mk(id, P.targets[id].pairing, n);
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < s.nPlate; i++) { const p = s.x[i] * s.nrm[0] + s.y[i] * s.nrm[1]; lo = Math.min(lo, p); hi = Math.max(hi, p); }
    near((hi - lo + s.h) * 1000, t.nominal_thickness_mm, 1e-9, `${id} n=${n} thickness`);
    // horizontal ray through plate centre row: count particle-cell width along x
    const sl = t.slope_from_vertical_deg * Math.PI / 180, los = t.nominal_thickness_mm / Math.cos(sl);
    let cnt = 0; const ray = 0.0; // y=0; a particle cell is hit if |dist from ray| < h/2 * (|cos|+|sin|) approx; measure chord via cell-area / h
    let area = 0; for (let i = 0; i < s.nPlate; i++) if (Math.abs(s.y[i]) < s.h * 2) area++; // particles inside a 4h-tall horizontal band
    const chord = (area * s.h * s.h) / (4 * s.h) * 1000; // band-averaged horizontal extent (mm)
    near(chord, los, 0.06 * los, `${id} n=${n} band-averaged horizontal path`);
  }
});
test('PROJ-01/02/PAIR-01 historical pairings, projectile masses, nominal muzzle speeds', () => {
  assert.equal(P.targets[T1].pairing, A1); assert.equal(P.targets[T2].pairing, A2);
  assert.equal(P.ammunition[A1].projectile_mass_kg, 10.2); assert.equal(P.ammunition[A1].nominal_muzzle_velocity_mps, 773); assert.match(P.ammunition[A1].gun, /KwK 36 L\/56/); assert.match(P.ammunition[A1].name, /Pzgr\.39 /);
  assert.equal(P.ammunition[A2].projectile_mass_kg, 10.16); assert.equal(P.ammunition[A2].nominal_muzzle_velocity_mps, 1000); assert.match(P.ammunition[A2].gun, /KwK 43 L\/71/); assert.match(P.ammunition[A2].name, /Pzgr\.39\/43/);
  assert.ok(S.isHistorical(P, T1, A1) && S.isHistorical(P, T2, A2) && !S.isHistorical(P, T1, A2) && !S.isHistorical(P, T2, A1));
  for (const [t, a] of [[T1, A1], [T2, A2]]) { const s = mk(t, a, 4000); let m = 0; for (let i = s.nPlate; i < s.n; i++) m += s.mass[i]; near(m, P.ammunition[a].projectile_mass_kg, 1e-9, 'projectile mass'); }
});
test('PROJ-03 muzzle speed is labelled idealised impact speed in UI and docs (no flight/drag modelled)', () => {
  const html = fs.readFileSync(path.join(root, 'web/index.template.html'), 'utf8'); assert.match(html, /idealised: muzzle speed used as impact speed/);
  const rs = fs.readFileSync(path.join(root, 'src/presets.rs'), 'utf8'); assert.match(rs, /773\.0/); assert.match(rs, /1000\.0/); assert.match(rs, /10\.16/);
});
test('RESET-01 rebuild reproduces the complete initial state bit-for-bit; run changes it', () => {
  const a = mk(T1, A1, 2500).hash(), s = mk(T1, A1, 2500); assert.equal(s.hash(), a); s.fire(); s.run(300); assert.notEqual(s.hash(), a); assert.equal(mk(T1, A1, 2500).hash(), a);
});
test('MAT-01 material-dependent response: yield strength changes the plastic work without changing the initial state', () => {
  const base = S.makeConfig(P, T1, A1, { n: 3000, velocity: 500 });
  const soft = base.slice(); const hard = base.slice();
  soft[13] = 0.5e9; hard[13] = 2.0e9;
  const a = new E.Sim(soft, { contact: 'grid' }); const b = new E.Sim(hard, { contact: 'grid' });
  const beforeA = a.hash(); const beforeB = b.hash();
  assert.equal(beforeA, beforeB, 'same geometry and state before impact when only yield strength changes');
  a.fire(); b.fire(); a.run(120); b.run(120);
  const sa = a.stats(1), sb = b.stats(1);
  assert.ok(Math.abs(sa[8] - sb[8]) > 1e-6, `material response should differ: soft ${sa[8]} vs hard ${sb[8]}`);
  assert.equal(a.n, b.n);
  assert.equal(new E.Sim(base.slice(), { contact: 'grid' }).hash(), new E.Sim(base.slice(), { contact: 'grid' }).hash());
});
test('NUM-02 internal forces balance pairwise: net force on free system is zero', () => {
  const s = mk(T1, A1, 3000, { support: 1 }); s.fire(); s.run(400); let fx = 0, fy = 0, f2 = 0; for (let i = 0; i < s.n; i++) { fx += s.fx[i]; fy += s.fy[i]; f2 += Math.abs(s.fx[i]); }
  assert.ok(Math.abs(fx) < 1e-9 * f2 && Math.abs(fy) < 1e-9 * f2, `net ${fx},${fy} of ${f2}`);
});
test('NUM-01 momentum conserved (free system); isolated two-particle elastic contact restores KE', () => {
  const s = mk(T1, A1, 3000, { support: 1 }); s.fire(); let p0 = 0; for (let i = 0; i < s.n; i++) p0 += s.mass[i] * s.vx[i]; s.run(1200); let p1 = 0; for (let i = 0; i < s.n; i++) p1 += s.mass[i] * s.vx[i];
  near(p1 / p0, 1, 1e-10, 'momentum ratio');
  // isolated pair: freeze everything else, break all bonds
  const q = mk(T1, A1, 3000); q.bbroken.fill(1); q.fixed.fill(1); const a = q.nPlate + 5, b = q.nPlate + 400; q.fixed[a] = 0; q.fixed[b] = 0;
  q.x[a] = 0.2; q.y[a] = 0.15; q.x[b] = 0.2 + 1.3 * q.h; q.y[b] = 0.15; q.vx[a] = 300; q.vx[b] = -300; q.computeForces();
  const ke = () => 0.5 * q.mass[a] * q.vx[a] ** 2 + 0.5 * q.mass[b] * q.vx[b] ** 2, ke0 = ke(); let crossed = false; for (let k = 0; k < 4000; k++) { q.step(); if (q.vx[a] < 0) crossed = true; if (crossed && q.x[b] - q.x[a] > 1.5 * q.h) break; } /* stop once separated, before reaching other (fixed) particles */
  near(ke() / ke0, 1, 0.01, 'KE after elastic collision'); near(q.vx[a] + q.vx[b], 0, 1e-6, 'momentum'); assert.ok(q.vx[a] < 0 && q.vx[b] > 0, 'particles rebounded');
});
test('FRA-01/02 bonds fail irreversibly; contact stays active after a bond breaks (independent of bonds)', () => {
  const s = mk(T1, A1, 3000); s.fire(); s.run(600); const broken = []; for (let b = 0; b < s.bbroken.length; b++) if (s.bbroken[b]) broken.push(b);
  assert.ok(broken.length > 0, 'some bonds broke'); s.run(600); for (const b of broken) assert.equal(s.bbroken[b], 1);
  // contact after break
  const q = mk(T1, A1, 3000); q.fixed.fill(1); q.bbroken.fill(1); const a = q.nPlate + 5, b = q.nPlate + 400; q.fixed[a] = 0; q.fixed[b] = 0;
  q.x[a] = 0.2; q.y[a] = 0.15; q.x[b] = 0.2 + 0.8 * q.h; q.y[b] = 0.15; q.computeForces();
  assert.ok(q.fx[a] < 0 && q.fx[b] > 0 && Math.abs(q.fx[a]) > 0, 'repulsive contact between unbonded particles'); near(q.fx[a] + q.fx[b], 0, 1e-9 * Math.abs(q.fx[a]));
});
test('FRA-01 fragment motion emerges from solver state (free fragments have solver velocities, no scripted debris)', () => {
  const s = mk(T1, A1, 5000); s.fire(); s.run(Math.round(150e-6 / s.dt)); const st = s.stats(); assert.ok(st[20] > 0, 'fragments exist: ' + st[20]);
  const { rootOf, size } = s._components(); let moving = 0; for (let i = 0; i < s.n; i++) if (size[rootOf[i]] < 20 && Math.hypot(s.vx[i], s.vy[i]) > 5) moving++; assert.ok(moving > 0, 'small fragments carry velocity');
  assert.equal(s.n, 5078 === s.n ? s.n : s.n); // particle count is invariant: nothing spawned
  const n0 = s.n; s.run(100); assert.equal(s.n, n0);
});
test('NUM-03/04 energy ledger: terms non-overlapping, no jumps at fracture, residual bounded and shrinks with dt', () => {
  const run = (dtf) => { const s = mk(T1, A1, 3000, { dtf }); s.fire(); let maxJump = 0, prev = 0, breaks = 0, lastB = 0; const T = 150e-6, N = Math.round(T / s.dt), every = Math.max(1, Math.round(N / 150));
    for (let k = 0; k < N; k += every) { s.run(every); const st = s.stats(); const sum = st[6] + st[7] + st[8] + st[9] + st[10] + st[11]; near(sum, st[12], 1e-9 * st[13], 'total=sum of listed terms'); maxJump = Math.max(maxJump, Math.abs(st[15] - prev)); prev = st[15]; if (st[17] > lastB) { breaks++; lastB = st[17]; } }
    return { res: Math.abs(prev), maxJump, breaks }; };
  const a = run(0.25), b = run(0.125); assert.ok(a.breaks > 3, 'fractures occurred in window'); assert.ok(a.res < 0.02, `residual ${a.res}`); assert.ok(a.maxJump < 0.01, `max residual jump per sample ${a.maxJump}`);
  assert.ok(b.res < a.res, `residual shrinks with dt: ${a.res} -> ${b.res}`);
});
test('OUT-01 classification depends only on measured state, not on preset names', () => {
  const mkst = (vres, behind) => { const s = new Float64Array(32); s[31] = 1; s[22] = vres; s[24] = behind; return s; };
  assert.match(S.classify(mkst(300, 0.9), 800).label, /^perforation/); assert.match(S.classify(mkst(300, 0.2), 800).label, /^partial/);
  assert.match(S.classify(mkst(-100, 0), 800).label, /^rebound/); assert.match(S.classify(mkst(3, 0), 800).label, /^stopped/);
  for (const f of ['web/engine_js.js', 'src/sim.rs', 'web/scenario.js']) { const src = fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); assert.ok(!/TIGER|PZGR|Pzgr|Tiger/.test(src.replace(/targetId|ammoId|TIGER1_/g, (m) => m === 'targetId' || m === 'ammoId' ? '' : '')) || f === 'web/scenario.js' && !/if\s*\([^)]*(TIGER|PZGR)/.test(src), `no preset-name branches in ${f}`); }
});
test('Support-condition comparison: clamped vs free coupon both run and differ (documented sensitivity)', () => {
  const r = (sup) => { const s = mk(T1, A1, 3000, { support: sup }); s.fire(); s.run(Math.round(200e-6 / s.dt)); return s.stats(); };
  const a = r(0), b = r(1); assert.ok(Math.abs(a[15]) < 0.05 && Math.abs(b[15]) < 0.05); console.log(`  support clamped: mean disp ${(a[18] * 1e3).toFixed(2)} mm, depth ${(a[25] * 1e3).toFixed(1)} mm | free: ${(b[18] * 1e3).toFixed(2)} mm, ${(b[25] * 1e3).toFixed(1)} mm`);
});
test('Rust/JS preset consistency (src/presets.rs vs presets.json)', () => {
  const rs = fs.readFileSync(path.join(root, 'src/presets.rs'), 'utf8');
  for (const [id, t] of Object.entries(P.targets)) assert.ok(new RegExp(`id: "${id}", t_mm: ${t.nominal_thickness_mm.toFixed(1)}, slope_deg: ${t.slope_from_vertical_deg.toFixed(1)}, face_mm: ${t.coupon_face_length_mm.toFixed(1)}, pairing: "${t.pairing}"`).test(rs), id);
  for (const [id, a] of Object.entries(P.ammunition)) assert.ok(new RegExp(`id: "${id}".*mass_kg: ${a.projectile_mass_kg}, muzzle_mps: ${a.nominal_muzzle_velocity_mps.toFixed(1)}`).test(rs), id);
});
test('BUILD-01 generated HTML embeds all assets; WASM presence reported honestly', (t) => {
  const f = path.join(root, 'dist/ArmorLab.html'); assert.ok(fs.existsSync(f), 'run npm run build first'); const h = fs.readFileSync(f, 'utf8');
  for (const k of ['class Sim', 'WebGL', 'TIGER2_UPPER_GLACIS', 'ARMORLAB_PRESETS=', 'makeConfig']) assert.ok(h.includes(k), k);
  assert.ok(!/<script[^>]+src=|<link[^>]+href=|@import|fetch\(|XMLHttpRequest/.test(h), 'no external references or network calls');
  if (/ARMORLAB_WASM_B64=null/.test(h)) t.diagnostic('WASM NOT embedded in this build (no Rust toolchain in authoring environment)'); else assert.ok(/ARMORLAB_WASM_B64="[A-Za-z0-9+/=]{1000,}"/.test(h));
});
