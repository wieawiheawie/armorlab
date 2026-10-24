// RES-01/02: resolution convergence study (same physics, different discretisation). Writes docs/results/convergence.json
const fs = require('fs'), path = require('path');
const { E, S, P, mk } = require('../tests/helpers');
const cases = [['TIGER1_UPPER_FRONT', 'TIGER1_PZGR39', [2500, 5000, 10000, 18000]], ['TIGER2_UPPER_GLACIS', 'TIGER2_PZGR3943', [5000, 10000, 18000]]];
const out = [];
for (const [t, a, ns] of cases) for (const n of ns) {
  const s = mk(t, a, n); s.fire(); const t0 = Date.now(); s.run(Math.round(P.solver.end_time_s / s.dt)); const st = s.stats(), c = S.classify(st, s.vImpact);
  const r = { target: t, ammo: a, n_actual: s.n, h_mm: +(s.h * 1e3).toFixed(3), dz_mm: +(s.dz * 1e3).toFixed(2), t_us: +(st[0] * 1e6).toFixed(0), outcome: c.label, proj_vx_mps: +st[22].toFixed(1), behind_pct: +(st[24] * 100).toFixed(1), depth_mm: +(st[25] * 1e3).toFixed(1),
    pl_frac: +(st[8] / st[13]).toFixed(3), fr_frac: +(st[9] / st[13]).toFixed(4), ke_frac: +(st[6] / st[13]).toFixed(3), resid_pct: +(st[15] * 100).toFixed(2), broken_pct: +(st[17] / st[16] * 100).toFixed(1), frags: st[20], frag_particles: st[21], wall_s: +((Date.now() - t0) / 1e3).toFixed(1) };
  console.log(JSON.stringify(r)); out.push(r);
}
fs.writeFileSync(path.join(__dirname, '../docs/results/convergence.json'), JSON.stringify(out, null, 1));
