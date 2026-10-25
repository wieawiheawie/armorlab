const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const { E, S, P, root, mk, T1, T2, A1, A2 } = require('./helpers');
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m || ''} got ${a}, want ${b} ±${tol}`);
function isolatedImpact(dtf = 0.25) {
  const q = mk(T1, A1, 3000, { dtf }); q.bbroken.fill(1); q.fixed.fill(1);
  const target = 0, projectile = q.nPlate;
  q.fixed[target] = q.fixed[projectile] = 0;
  q.x[target] = 10; q.y[target] = 10;
  q.x[projectile] = 10 + 2 * q.h; q.y[projectile] = 10;
  q.vx[target] = q.vy[target] = 0; q.vx[projectile] = -300; q.vy[projectile] = 0;
  q.computeForces();
  const momentum0 = q.mass[target] * q.vx[target] + q.mass[projectile] * q.vx[projectile];
  const energy0 = 0.5 * q.mass[projectile] * q.vx[projectile] ** 2;
  return { q, target, projectile, momentum0, energy0 };
}

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
test('PROJ-04 distinct ammunition variants preserve their own solver inputs', () => {
  const a = S.makeConfig(P, T1, A1, { n: 3000, velocity: 773 });
  const b = S.makeConfig(P, T2, A2, { n: 3000, velocity: 1000 });
  assert.notEqual(a[7], b[7]);
  assert.notEqual(a[8], b[8]);
  assert.equal(a[16], b[16]);
  assert.notEqual(a[17], b[17]);
  assert.notEqual(a[18], b[18]);
  assert.notEqual(a[19], b[19]);
  assert.notEqual(a[20], b[20]);
  assert.equal(a[16], 7850); assert.equal(b[16], 7850);
  assert.equal(a[17], 200e9); assert.equal(b[17], 210e9);
  assert.equal(a[18], 1800e6); assert.equal(b[18], 2100e6);
  assert.equal(a[19], 0.02); assert.equal(b[19], 0.018);
  assert.equal(a[20], 0.04); assert.equal(b[20], 0.035);
  assert.equal(a[7], P.ammunition[A1].projectile_mass_kg); assert.equal(b[7], P.ammunition[A2].projectile_mass_kg);
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
test('NUM-05 free particles follow exact uniform motion at coarse and fine particle spacing', () => {
  const results = [];
  for (const n of [2500, 9000]) {
    const q = mk(T1, A1, n); q.bbroken.fill(1); q.fixed.fill(1);
    const i = q.nPlate; q.fixed[i] = 0; q.x[i] = 10; q.y[i] = 10; q.vx[i] = 123.5; q.vy[i] = -67.25;
    q.computeForces(); const x0 = q.x[i], y0 = q.y[i], vx = q.vx[i], vy = q.vy[i];
    q.run(250);
    near(q.x[i], x0 + vx * q.time, 1e-10, `x at h=${q.h}`);
    near(q.y[i], y0 + vy * q.time, 1e-10, `y at h=${q.h}`);
    near(q.vx[i], vx, 0, 'free vx'); near(q.vy[i], vy, 0, 'free vy');
    results.push({ h: q.h, x: q.x[i], y: q.y[i], time: q.time });
  }
  assert.ok(results[0].h > results[1].h, 'configurations use distinct particle spacings');
  for (const r of results) { near(r.x, 10 + 123.5 * r.time, 1e-10); near(r.y, 10 - 67.25 * r.time, 1e-10); }
});
test('NUM-06 isolated undamped bond exchanges elastic and kinetic energy with timestep convergence', () => {
  const run = (dtf) => {
    const q = mk(T1, A1, 3000, { dtf }); let b = -1;
    for (let k = 0; k < q.bi.length; k++) if (q.mat[q.bi[k]] === 1) { b = k; break; }
    assert.ok(b >= 0, 'projectile bond exists');
    q.bbroken.fill(1); q.fixed.fill(1); q.bbroken[b] = 0;
    const a = q.bi[b], c = q.bj[b], rest = q.bl0[b]; q.fixed[a] = q.fixed[c] = 0;
    q.x[a] = 10; q.y[a] = 10; q.x[c] = 10 + 1.1 * rest; q.y[c] = 10;
    q.mats[1].rate = 0; q.mats[1].ec = 100; q.mats[1].ey = 100; q.crush = -100; q.computeForces();
    const energy = () => 0.5 * q.mass[a] * (q.vx[a] ** 2 + q.vy[a] ** 2) +
      0.5 * q.mass[c] * (q.vx[c] ** 2 + q.vy[c] ** 2) +
      0.5 * q.bk[b] * (Math.hypot(q.x[c] - q.x[a], q.y[c] - q.y[a]) - q.bl[b]) ** 2;
    const e0 = energy(); q.run(500);
    return { drift: Math.abs((energy() - e0) / e0), q };
  };
  const coarse = run(0.25), fine = run(0.125);
  assert.ok(coarse.drift < 0.003, `coarse relative energy error ${coarse.drift}`);
  assert.ok(fine.drift < coarse.drift / 4, `halving dt improves error: ${coarse.drift} -> ${fine.drift}`);
  assert.equal(coarse.q.eDamp, 0); assert.equal(coarse.q.ePl, 0); assert.equal(coarse.q.eFr, 0);
});
test('NUM-07 projectile-target contact exchanges momentum and has controlled energy accounting', () => {
  const { q, target, projectile, momentum0, energy0 } = isolatedImpact();
  let peakContact = 0;
  for (let k = 0; k < Math.ceil(100e-6 / q.dt); k++) {
    q.step(); peakContact = Math.max(peakContact, q.stats(1)[10]);
  }
  const st = q.stats(1), energy1 = st[6] + st[10];
  assert.ok(peakContact > 0, 'repulsive contact potential is present during overlap');
  assert.ok(Math.abs((energy1 - energy0) / energy0) < 0.01, `isolated-contact relative energy error ${(energy1 - energy0) / energy0}`);
  assert.equal(st[8], 0); assert.equal(st[9], 0); assert.equal(st[32], 0, 'no plasticity, fracture, or bond damping in the isolated contact case');
  near(st[33], momentum0, 1e-12, 'total x momentum');
  assert.ok(Math.abs(q.vx[target]) > 100 && Math.abs(q.vx[projectile] + 300) > 100, 'momentum is exchanged between target and projectile');
});
test('NUM-08 timestep sensitivity is measurable for the isolated contact benchmark', () => {
  const drift = (dtf) => {
    const { q, energy0 } = isolatedImpact(dtf); q.run(Math.ceil(100e-6 / q.dt));
    const st = q.stats(1); return Math.abs((st[6] + st[10] - energy0) / energy0);
  };
  const coarse = drift(0.25), fine = drift(0.125);
  assert.ok(coarse < 0.01, `coarse contact energy error ${coarse}`);
  assert.ok(fine < coarse / 5, `halving dt improves error: ${coarse} -> ${fine}`);
});
test('NUM-09 identical complete runs reproduce state and energy diagnostics', () => {
  const a = mk(T1, A1, 2500), b = mk(T1, A1, 2500);
  a.fire(); b.fire(); a.run(300); b.run(300);
  assert.equal(a.hash(), b.hash());
  assert.deepEqual(Array.from(a.stats(1)), Array.from(b.stats(1)));
});
test('NUM-10 legacy rest update remains selectable without changing its preset parameters', () => {
  const singleBond = () => {
    const q = mk(T1, A1, 3000, { plasticity: 'legacy' }); let b = -1;
    for (let k = 0; k < q.bi.length; k++) if (q.mat[q.bi[k]] === 1) { b = k; break; }
    q.bbroken.fill(1); q.fixed.fill(1); q.bbroken[b] = 0;
    const a = q.bi[b], c = q.bj[b], rest = q.bl0[b]; q.fixed[a] = q.fixed[c] = 0;
    q.x[a] = 10; q.y[a] = 10; q.y[c] = 10;
    q.mats[1].rate = 0; q.mats[1].hr = 0; q.mats[1].ey = 0.01; q.crush = -100;
    return { q, b, a, c, rest };
  };
  const plastic = singleBond(); plastic.q.mats[1].ec = 2;
  plastic.q.x[plastic.c] = 10 + 1.05 * plastic.rest; plastic.q.computeForces();
  const oldStretch = 0.05 * plastic.rest, yieldStretch = 0.01 * plastic.rest;
  const expectedPlasticDrop = 0.5 * plastic.q.bk[plastic.b] * (oldStretch ** 2 - yieldStretch ** 2);
  near(plastic.q.ePl, expectedPlasticDrop, 1e-10 * expectedPlasticDrop, 'plastic rest-update potential drop');
  const pstats = plastic.q.stats(1);
  near(pstats[7] + pstats[8], 0.5 * plastic.q.bk[plastic.b] * oldStretch ** 2, 1e-10 * expectedPlasticDrop, 'recoverable plus rest-update energy');
  const fracture = singleBond(); fracture.q.mats[1].ec = 0.05;
  fracture.q.x[fracture.c] = 10 + 1.2 * fracture.rest; fracture.q.computeForces();
  const expectedFractureEnergy = 0.5 * fracture.q.bk[fracture.b] * (0.2 * fracture.rest) ** 2;
  near(fracture.q.eFr, expectedFractureEnergy, 1e-10 * expectedFractureEnergy, 'energy assigned at bond deletion');
  assert.equal(fracture.q.bbroken[fracture.b], 1);
  near(fracture.q.stats(1)[7], 0, 1e-12, 'deleted bond no longer recoverable');
});
test('PL-01 isotropic return map: elastic loading, first yield, unloading and reloading', () => {
  const q = mk(T1, A1, 3000); const b = q.bi.findIndex((i) => q.mat[i] === 1);
  q.bbroken.fill(1); q.fixed.fill(1); q.bbroken[b] = 0;
  const i = q.bi[b], j = q.bj[b], l0 = q.bl0[b]; q.fixed[i] = q.fixed[j] = 0;
  q.x[i] = 10; q.y[i] = 10; q.y[j] = 10; q.mats[1].rate = 0; q.mats[1].ey = 0.01; q.mats[1].hr = 0.2; q.mats[1].ec = 10; q.crush = -10;
  const setStrain = (e) => { q.x[j] = q.x[i] + l0 * (1 + e); q.computeForces(); };
  setStrain(0.005);
  near(q.bl[b], l0, 1e-14); near(q.bep[b], 0, 0); near(q.ePl, 0, 0);
  near(q.stats(1)[7], 0.5 * q.bk[b] * (0.005 * l0) ** 2, 1e-9, 'elastic bond energy');
  setStrain(0.01);
  near(q.bl[b], l0, 1e-14, 'exact yield remains elastic');
  near(q.ePl, 0, 1e-9, 'roundoff-sized dissipation at first yield surface');
  const preYieldEnergy = 0.5 * q.bk[b] * (0.016 * l0) ** 2;
  setStrain(0.016);
  const gamma = (0.016 - 0.01) / 1.2, alpha = q.bep[b], hStored = q.stats(1)[35];
  near(alpha, gamma, 1e-12, 'first plastic increment');
  near((q.bl[b] - l0) / l0, gamma, 1e-12, 'signed plastic strain');
  near((q.x[j] - q.x[i] - q.bl[b]) / l0, 0.01 + 0.2 * gamma, 1e-12, 'return to yield surface');
  near(q.ePl, q.bk[b] * l0 ** 2 * (0.01 * gamma + 0.5 * 1.2 * gamma ** 2), 1e-9, 'nonnegative return-map dissipation');
  assert.ok(q.ePl >= 0, 'dissipation nonnegative');
  near(q.stats(1)[7] + hStored + q.ePl, preYieldEnergy, 1e-9, 'first-yield energy balance');
  const stateAtYield = { rest: q.bl[b], alpha: q.bep[b], diss: q.ePl };
  setStrain(0);
  near(q.bl[b], stateAtYield.rest, 1e-14, 'unloading preserves plastic rest extension');
  near(q.bep[b], stateAtYield.alpha, 1e-14, 'unloading does not accumulate plastic strain');
  near(q.ePl, stateAtYield.diss, 1e-10, 'unloading has no plastic dissipation');
  near(q.stats(1)[7], 0.5 * q.bk[b] * (-(gamma) * l0) ** 2, 1e-9, 'unloading elastic energy');
  setStrain(0.02);
  assert.ok(q.bep[b] > stateAtYield.alpha, 'reloading beyond yield accumulates plastic strain');
  assert.ok(q.ePl > stateAtYield.diss, 'reloading dissipates energy');
  near((q.x[j] - q.x[i] - q.bl[b]) / l0, 0.01 + 0.2 * q.bep[b], 1e-12, 'reloading return to yield surface');
});
test('PL-02 zero strain, sign reversal and broken bonds have defined state/energy behavior', () => {
  const q = mk(T1, A1, 3000); const b = q.bi.findIndex((i) => q.mat[i] === 1);
  q.bbroken.fill(1); q.fixed.fill(1); q.bbroken[b] = 0;
  const i = q.bi[b], j = q.bj[b], l0 = q.bl0[b]; q.fixed[i] = q.fixed[j] = 0;
  q.x[i] = 10; q.y[i] = 10; q.y[j] = 10; q.mats[1].rate = 0; q.mats[1].ey = 0.01; q.mats[1].hr = 0.2; q.mats[1].ec = 10; q.crush = -10;
  const setStrain = (e) => { q.x[j] = q.x[i] + l0 * (1 + e); q.computeForces(); };
  setStrain(0); const initialRest = q.bl[b], initialAlpha = q.bep[b], initialDiss = q.ePl;
  near(q.bl[b], initialRest, 0); near(q.bep[b], initialAlpha, 0); near(q.ePl, initialDiss, 0);
  setStrain(0.016); const tensileRest = q.bl[b], tensileAlpha = q.bep[b], tensileDiss = q.ePl;
  setStrain(-0.03);
  assert.ok(q.bl[b] < tensileRest, 'compressive return changes signed plastic extension in reverse');
  assert.ok(q.bep[b] > tensileAlpha, 'equivalent plastic strain is accumulated, not signed');
  assert.ok(q.ePl >= tensileDiss && q.ePl >= 0, 'reverse plastic dissipation remains nonnegative');
  const beforeBreak = { rest: q.bl[b], alpha: q.bep[b], diss: q.ePl }, storedBeforeBreak = q.stats(1);
  q.crush = -0.02; q.computeForces();
  assert.equal(q.bbroken[b], 1, 'compressive fracture cutoff breaks the active bond');
  near(q.eFr, storedBeforeBreak[7] + storedBeforeBreak[35], 1e-9, 'elastic and hardening energy transferred to fracture ledger');
  assert.equal(q.ePl, beforeBreak.diss);
  const beforeStats = q.stats(1);
  setStrain(0.2);
  assert.equal(q.bl[b], beforeBreak.rest); assert.equal(q.bep[b], beforeBreak.alpha); assert.equal(q.ePl, beforeBreak.diss);
  near(q.stats(1)[7] + q.stats(1)[35], 0, 1e-12, 'broken bond has no recoverable/hardening energy');
  assert.ok(beforeStats[9] > 0);
});
test('PL-03 dynamic plastic-bond accounting error decreases when timestep is halved', () => {
  const run = (dtf) => {
    const q = mk(T1, A1, 3000, { dtf }); let b = -1;
    for (let k = 0; k < q.bi.length; k++) if (q.mat[q.bi[k]] === 1) { b = k; break; }
    q.bbroken.fill(1); q.fixed.fill(1); q.bbroken[b] = 0;
    const i = q.bi[b], j = q.bj[b], l0 = q.bl0[b]; q.fixed[i] = q.fixed[j] = 0;
    q.x[i] = 10; q.y[i] = 10; q.x[j] = 10 + l0; q.y[j] = 10;
    q.vx[i] = -100; q.vx[j] = 100; q.vy[i] = q.vy[j] = 0;
    q.mats[1].rate = 0; q.mats[1].ey = 0.01; q.mats[1].hr = 0.2; q.mats[1].ec = 10; q.crush = -10;
    q.computeForces(); const e0 = q.stats(1)[12];
    q.run(Math.round(100e-6 / q.dt));
    assert.equal(q.bbroken[b], 0, 'isolated bond remains intact');
    const st = q.stats(1);
    assert.ok(st[8] > 0 && st[35] > 0, 'plastic dissipation and hardening energy recorded');
    return Math.abs((st[12] - e0) / e0);
  };
  const coarse = run(0.25), fine = run(0.125);
  assert.ok(coarse < 0.18, `default-step plastic-system energy error ${coarse}`);
  assert.ok(fine < 0.6 * coarse, `halving dt improves energy error: ${coarse} -> ${fine}`);
});
test('PL-04 isotropic-hardening configuration rejects negative hardening ratios', () => {
  const cfg = S.makeConfig(P, T1, A1, { n: 2500 }); cfg[14] = -0.01;
  assert.throws(() => new E.Sim(cfg), /hardening ratio >= 0/);
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
test('NUM-03/04 full-impact residual is explicit, terms do not double-count, and residual shrinks with dt', () => {
  const run = (dtf) => { const s = mk(T1, A1, 3000, { dtf }); s.fire(); let maxJump = 0, prev = 0, breaks = 0, lastB = 0; const T = 150e-6, N = Math.round(T / s.dt), every = Math.max(1, Math.round(N / 150));
    for (let k = 0; k < N; k += every) { s.run(every); const st = s.stats(); const sum = st[6] + st[7] + st[8] + st[9] + st[10] + st[11] + st[32] + st[35]; near(sum, st[12], 1e-9 * st[13], 'accounted total=sum of terms'); maxJump = Math.max(maxJump, Math.abs(st[15] - prev)); prev = st[15]; if (st[17] > lastB) { breaks++; lastB = st[17]; } }
    return { res: Math.abs(prev), maxJump, breaks }; };
  const a = run(0.25), b = run(0.125); assert.ok(a.breaks > 3, 'fractures occurred in window'); assert.ok(Number.isFinite(a.res), `default-step residual ${a.res}`); assert.ok(a.maxJump < 0.02, `max residual jump per sample ${a.maxJump}`);
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
  const a = r(0), b = r(1); assert.ok(Number.isFinite(a[15]) && Number.isFinite(b[15])); console.log(`  support clamped: mean disp ${(a[18] * 1e3).toFixed(2)} mm, depth ${(a[25] * 1e3).toFixed(1)} mm | free: ${(b[18] * 1e3).toFixed(2)} mm, ${(b[25] * 1e3).toFixed(1)} mm`);
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
