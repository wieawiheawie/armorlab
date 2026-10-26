#!/usr/bin/env node
// Resolution/timestep study for the three rounds (diagnostic only; no outcome thresholds). Writes docs/results/convergence_v2.json
const fs = require('fs'), path = require('path');
const { E, mk, P } = require('../tests/helpers.js');
const N = E.STAT_NAMES, rows = [];
const cases = [['TIGER1_UPPER_FRONT', 'TIGER1_PZGR39'], ['TIGER2_UPPER_GLACIS', 'TIGER2_PZGR3943'], ['TIGER2_UPPER_GLACIS', 'TIGER2_PZGR4043']];
const us = +(process.argv[2] || 150);
for (const [t, a] of cases) {
  for (const [n, dtf] of [[1500, 0.25], [3000, 0.25], [6000, 0.25], [12000, 0.25], [3000, 0.125], [3000, 0.0625]]) {
    const s = mk(t, a, n, { dtf }); s.fire(); s.run(Math.round(us * 1e-6 / s.dt));
    const v = s.stats(2), o = Object.fromEntries(N.map((k, i) => [k, v[i]]));
    rows.push({ target: t, ammo: a, n_requested: n, n: o.n, h_mm: +(o.h * 1e3).toFixed(3), dtf, t_us: us, residual_rel: +o.resid_rel.toFixed(5),
      projectile_residual_vx: +o.proj_vx.toFixed(1), depth_mm: +(o.proj_depth * 1e3).toFixed(1), mass_behind_rear_face: +o.proj_behind.toFixed(3),
      ke_fraction: +(o.ke / o.ke0).toFixed(4), plastic_fraction: +(o.e_pl / o.ke0).toFixed(4), fracture_fraction: +(o.e_fr / o.ke0).toFixed(4),
      bonds_broken_fraction: +(o.bonds_broken / o.bonds).toFixed(4), fragments_resolved: o.frag_large_count, fragments_single_particle_debris: o.frag_small_count });
  }
}
fs.mkdirSync(path.join(__dirname, '../docs/results'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '../docs/results/convergence_v2.json'), JSON.stringify({ note: 'Diagnostic software study at fixed time; not a validation against historical penetration data.', rows }, null, 1));
for (const r of rows) console.log(r.ammo.padEnd(16), 'n', String(r.n).padStart(6), 'dtf', r.dtf, 'resid', (r.residual_rel * 100).toFixed(2) + '%', 'vx', r.projectile_residual_vx, 'depth', r.depth_mm, 'broken', r.bonds_broken_fraction, 'frag(res/debris)', r.fragments_resolved, r.fragments_single_particle_debris);
