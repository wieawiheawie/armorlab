/* ArmorLab JS engine: line-for-line port of src/sim.rs (used for tests here and as fallback when no WASM is embedded). */
(function (root) {
'use strict';
const I = { N:0,T:1,SLOPE:2,FACE:3,CAL:4,PLEN:5,NOSE:6,PMASS:7,V:8,SUPPORT:9,PL_RHO:11,PL_E:12,PL_SY:13,PL_HR:14,PL_EC:15,PR_RHO:16,PR_E:17,PR_SY:18,PR_HR:19,PR_EC:20,KC:21,DTF:22,CRUSH:23 };
const STAT_NAMES = ['time','steps','n','h','dz','dt','ke','e_el','e_pl','e_fr','e_ct','e_ext','e_total','ke0','resid','resid_rel','bonds','bonds_broken','mean_disp','max_disp','frag_count','frag_particles','proj_vx','proj_vy','proj_behind','proj_depth','proj_mass','plate_mass','max_speed','n_plate','n_proj','fired'];

class Sim {
  constructor(cfg) {
    const t = cfg[I.T], s = cfg[I.SLOPE] * Math.PI / 180;
    const tan = [Math.sin(s), Math.cos(s)], nrm = [-Math.cos(s), Math.sin(s)];
    const face = cfg[I.FACE], cal = cfg[I.CAL], plen = cfg[I.PLEN], nose = cfg[I.NOSE];
    const h0 = Math.sqrt((t * face + cal * plen * 0.92) / cfg[I.N]);
    const layers = Math.max(2, Math.round(t / h0)), h = t / layers;
    const nf = Math.max(4, Math.round(face / h));
    const X = [], Y = [], M = [], F = [];
    for (let a = 0; a < nf; a++) for (let b = 0; b < layers; b++) {
      const ua = (a - (nf - 1) * 0.5) * h, ub = (b - (layers - 1) * 0.5) * h;
      X.push(ua * tan[0] + ub * nrm[0]); Y.push(ua * tan[1] + ub * nrm[1]); M.push(0);
      F.push(cfg[I.SUPPORT] < 0.5 && (a < 3 || a + 3 >= nf) ? 1 : 0);
    }
    const nPlate = X.length;
    const nr = Math.max(2, Math.round(cal / h)), nc = Math.max(2, Math.round(plen / h)), rad = cal * 0.5;
    const px = [], py = [];
    for (let i = 0; i < nc; i++) {
      const u = (i + 0.5) * h;
      let hw = rad; if (u < nose) { const q = 1 - u / nose; hw = rad * Math.sqrt(Math.max(0, 1 - q * q)); }
      for (let j = 0; j < nr; j++) { const yy = (j - (nr - 1) * 0.5) * h; if (Math.abs(yy) <= hw) { px.push(-u); py.push(yy); } }
    }
    let dx = Infinity;
    for (let k = 0; k < px.length; k++) { const d = (px[k] * nrm[0] + py[k] * nrm[1] - t * 0.5 - 2 * h) / Math.cos(s); if (d < dx) dx = d; }
    for (let k = 0; k < px.length; k++) { X.push(px[k] + dx); Y.push(py[k]); M.push(1); F.push(0); }
    const n = X.length;
    this.n = n; this.nPlate = nPlate; this.h = h; this.time = 0; this.steps = 0; this.fired = false;
    this.vImpact = cfg[I.V]; this.crush = cfg[I.CRUSH]; this.plateT = t; this.nrm = nrm;
    this.mats = [
      { rho: cfg[I.PL_RHO], e: cfg[I.PL_E], ey: cfg[I.PL_SY] / cfg[I.PL_E], hr: cfg[I.PL_HR], ec: cfg[I.PL_EC] },
      { rho: cfg[I.PR_RHO], e: cfg[I.PR_E], ey: cfg[I.PR_SY] / cfg[I.PR_E], hr: cfg[I.PR_HR], ec: cfg[I.PR_EC] } ];
    this.dz = cfg[I.PMASS] / (this.mats[1].rho * h * h * (n - nPlate));
    this.x = Float64Array.from(X); this.y = Float64Array.from(Y);
    this.x0 = Float64Array.from(X); this.y0 = Float64Array.from(Y);
    this.vx = new Float64Array(n); this.vy = new Float64Array(n); this.fx = new Float64Array(n); this.fy = new Float64Array(n);
    this.mat = Uint8Array.from(M); this.fixed = Uint8Array.from(F);
    this.mass = new Float64Array(n);
    for (let i = 0; i < n; i++) this.mass[i] = this.mats[this.mat[i]].rho * h * h * this.dz;
    const kmax = 0.75 * Math.max(this.mats[0].e, this.mats[1].e) * this.dz;
    this.kc = cfg[I.KC] * kmax;
    this.dt = cfg[I.DTF] * Math.sqrt(Math.min(this.mass[0], this.mass[n - 1]) / kmax);
    this.nbTotal = new Uint32Array(n); this.nbBroken = new Uint32Array(n);
    this.bi = []; this.bj = []; this.bk = []; this.bl0 = []; this.bl = []; this.bep = []; this.bm = []; this.bbroken = [];
    this.ePl = 0; this.eFr = 0; this.ke0 = 0;
    this.cs = 1.5 * h; this._setupGrid(); this._buildBonds();
    this.bi = Uint32Array.from(this.bi); this.bj = Uint32Array.from(this.bj); this.bk = Float64Array.from(this.bk);
    this.bl0 = Float64Array.from(this.bl0); this.bl = Float64Array.from(this.bl); this.bep = new Float64Array(this.bi.length);
    this.bm = Uint8Array.from(this.bm); this.bbroken = new Uint8Array(this.bi.length);
    this.rPos = new Float32Array(2 * n); this.rMat = new Float32Array(n); this.rDmg = new Float32Array(n); this.rSpd = new Float32Array(n);
    this.computeForces();
  }
  _setupGrid() {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let i = 0; i < this.n; i++) { minx = Math.min(minx, this.x[i]); maxx = Math.max(maxx, this.x[i]); miny = Math.min(miny, this.y[i]); maxy = Math.max(maxy, this.y[i]); }
    this.gx0 = minx - 0.1; this.gy0 = miny - 0.3;
    this.gnx = Math.max(1, Math.ceil(((maxx + 0.6) - this.gx0) / this.cs)); this.gny = Math.max(1, Math.ceil(((maxy + 0.3) - this.gy0) / this.cs));
    this.cellStart = new Uint32Array(this.gnx * this.gny + 1); this.cellItems = new Uint32Array(this.n); this.cellOf = new Uint32Array(this.n);
    this.fill = new Uint32Array(this.gnx * this.gny + 1);
  }
  _rebuildGrid() {
    const { n, x, y, cs, gx0, gy0, gnx, gny, cellStart, cellOf, cellItems, fill } = this;
    cellStart.fill(0);
    for (let i = 0; i < n; i++) {
      const cx = Math.min(gnx - 1, Math.max(0, Math.floor((x[i] - gx0) / cs))), cy = Math.min(gny - 1, Math.max(0, Math.floor((y[i] - gy0) / cs)));
      const c = cy * gnx + cx; cellOf[i] = c; cellStart[c + 1]++;
    }
    const nc = gnx * gny;
    for (let c = 0; c < nc; c++) cellStart[c + 1] += cellStart[c];
    fill.set(cellStart);
    for (let i = 0; i < n; i++) { const c = cellOf[i]; cellItems[fill[c]++] = i; }
  }
  _buildBonds() {
    this._rebuildGrid();
    const { n, x, y, gnx, gny, cellStart, cellItems, cellOf, mat, h } = this, rmax = 1.5 * h;
    for (let i = 0; i < n; i++) {
      const c = cellOf[i], cx = c % gnx, cy = (c / gnx) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const qx = cx + ox, qy = cy + oy; if (qx < 0 || qy < 0 || qx >= gnx || qy >= gny) continue;
        const q = qy * gnx + qx;
        for (let s = cellStart[q]; s < cellStart[q + 1]; s++) {
          const j = cellItems[s]; if (j <= i || mat[j] !== mat[i]) continue;
          const dx = x[j] - x[i], dy = y[j] - y[i], r = Math.sqrt(dx * dx + dy * dy);
          if (r <= rmax) {
            const m = mat[i], k0 = 0.75 * this.mats[m].e * this.dz;
            this.bi.push(i); this.bj.push(j); this.bk.push(r < 1.2 * h ? k0 : 0.5 * k0); this.bl0.push(r); this.bl.push(r); this.bm.push(m);
            this.nbTotal[i]++; this.nbTotal[j]++;
          }
        }
      }
    }
  }
  computeForces() {
    const { n, x, y, fx, fy, bi, bj, bk, bl0, bl, bep, bm, bbroken, mats, crush } = this;
    fx.fill(0); fy.fill(0);
    for (let b = 0, nb = bi.length; b < nb; b++) {
      if (bbroken[b]) continue;
      const i = bi[b], j = bj[b], dx = x[j] - x[i], dy = y[j] - y[i];
      const r = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-12), k = bk[b], l0 = bl0[b], m = mats[bm[b]];
      const strain = (r - l0) / l0;
      if (strain > m.ec || strain < crush) {
        const de0 = r - bl[b]; this.eFr += 0.5 * k * de0 * de0; bbroken[b] = 1; this.nbBroken[i]++; this.nbBroken[j]++; continue;
      }
      let de = r - bl[b];
      const elim = (m.ey + m.hr * bep[b]) * l0;
      if (Math.abs(de) > elim) {
        const sgn = de > 0 ? 1 : -1, exc = de - sgn * elim;
        bl[b] += exc; bep[b] += Math.abs(exc) / l0;
        const dn = de - exc; this.ePl += k * Math.abs(dn) * Math.abs(exc); de = dn; /* work-conjugate plastic work */
      }
      const f = k * de / r;
      fx[i] += f * dx; fy[i] += f * dy; fx[j] -= f * dx; fy[j] -= f * dy;
    }
    this._contact(false);
  }
  _contact(energy) {
    this._rebuildGrid();
    const { n, x, y, fx, fy, gnx, gny, cellStart, cellItems, cellOf, kc } = this, d = this.h, d2lim = d * d * (1 - 1e-9);
    let ec = 0;
    for (let i = 0; i < n; i++) {
      const c = cellOf[i], cx = c % gnx, cy = (c / gnx) | 0, xi = x[i], yi = y[i];
      for (let oy = -1; oy <= 1; oy++) {
        const qy = cy + oy; if (qy < 0 || qy >= gny) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const qx = cx + ox; if (qx < 0 || qx >= gnx) continue;
          const q = qy * gnx + qx;
          for (let s = cellStart[q], e = cellStart[q + 1]; s < e; s++) {
            const j = cellItems[s]; if (j <= i) continue;
            const dx = x[j] - xi, dy = y[j] - yi, r2 = dx * dx + dy * dy;
            if (r2 >= d2lim || r2 < 1e-24) continue;
            const r = Math.sqrt(r2), ov = d - r;
            if (energy) ec += 0.5 * kc * ov * ov;
            else { const f = -kc * ov / r; fx[i] += f * dx; fy[i] += f * dy; fx[j] -= f * dx; fy[j] -= f * dy; }
          }
        }
      }
    }
    return ec;
  }
  fire() {
    if (this.fired) return; this.fired = true; let ke = 0;
    for (let i = this.nPlate; i < this.n; i++) { this.vx[i] = this.vImpact; ke += 0.5 * this.mass[i] * this.vImpact * this.vImpact; }
    this.ke0 = ke;
  }
  step() {
    const { n, x, y, vx, vy, fx, fy, mass, fixed, dt } = this;
    for (let i = 0; i < n; i++) { if (fixed[i]) continue; vx[i] += 0.5 * dt * fx[i] / mass[i]; vy[i] += 0.5 * dt * fy[i] / mass[i]; x[i] += dt * vx[i]; y[i] += dt * vy[i]; }
    this.computeForces();
    for (let i = 0; i < n; i++) { if (fixed[i]) continue; vx[i] += 0.5 * dt * fx[i] / mass[i]; vy[i] += 0.5 * dt * fy[i] / mass[i]; }
    this.time += dt; this.steps++;
  }
  run(k) { for (let s = 0; s < k; s++) this.step(); }
  _components() {
    const n = this.n, p = new Uint32Array(n); for (let i = 0; i < n; i++) p[i] = i;
    const find = (a) => { while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; } return a; };
    for (let b = 0; b < this.bi.length; b++) { if (this.bbroken[b]) continue; const a = find(this.bi[b]), c = find(this.bj[b]); if (a !== c) p[a] = c; }
    const size = new Uint32Array(n), rootOf = new Uint32Array(n);
    for (let i = 0; i < n; i++) { const r = find(i); rootOf[i] = r; size[r]++; }
    return { rootOf, size };
  }
  stats() {
    const { n, nPlate, x, y, vx, vy, mass } = this; const s = new Float64Array(32);
    let ke = 0, maxsp = 0;
    for (let i = 0; i < n; i++) { const v2 = vx[i] * vx[i] + vy[i] * vy[i]; ke += 0.5 * mass[i] * v2; maxsp = Math.max(maxsp, Math.sqrt(v2)); }
    let eel = 0, nbk = 0;
    for (let b = 0; b < this.bi.length; b++) {
      if (this.bbroken[b]) { nbk++; continue; }
      const i = this.bi[b], j = this.bj[b], dx = x[j] - x[i], dy = y[j] - y[i], de = Math.sqrt(dx * dx + dy * dy) - this.bl[b];
      eel += 0.5 * this.bk[b] * de * de;
    }
    const ect = this._contact(true), total = ke + eel + this.ePl + this.eFr + ect;
    let sd = 0, md = 0;
    for (let i = 0; i < nPlate; i++) { const d = Math.hypot(x[i] - this.x0[i], y[i] - this.y0[i]); sd += d; md = Math.max(md, d); }
    let pm = 0, pvx = 0, pvy = 0, behind = 0, minN = Infinity;
    for (let i = nPlate; i < n; i++) {
      pm += mass[i]; pvx += mass[i] * vx[i]; pvy += mass[i] * vy[i];
      const nn = x[i] * this.nrm[0] + y[i] * this.nrm[1]; if (nn < -this.plateT * 0.5) behind += mass[i]; minN = Math.min(minN, nn);
    }
    const dmax = Math.max(0, this.plateT * 0.5 - minN);
    const { rootOf, size } = this._components();
    let plateMain = -1, best = 0;
    for (let i = 0; i < nPlate; i++) if (this.fixed[i]) { plateMain = rootOf[i]; break; }
    for (let i = 0; i < nPlate; i++) { const r = rootOf[i]; if (size[r] > best) { best = size[r]; if (plateMain < 0) plateMain = r; } }
    let projMain = 0, bp = 0;
    for (let i = nPlate; i < n; i++) { const r = rootOf[i]; if (size[r] > bp) { bp = size[r]; projMain = r; } }
    let fc = 0, fp = 0;
    for (let i = 0; i < n; i++) if (rootOf[i] === i && i !== plateMain && i !== projMain) { fc++; fp += size[i]; }
    let mpl = 0; for (let i = 0; i < nPlate; i++) mpl += mass[i];
    s.set([this.time, this.steps, n, this.h, this.dz, this.dt, ke, eel, this.ePl, this.eFr, ect, 0, total, this.ke0, total - this.ke0,
      this.ke0 > 0 ? (total - this.ke0) / this.ke0 : 0, this.bi.length, nbk, sd / nPlate, md, fc, fp, pvx / pm, pvy / pm, behind / pm, dmax, pm, mpl, maxsp, nPlate, n - nPlate, this.fired ? 1 : 0]);
    return s;
  }
  fillRender() {
    for (let i = 0; i < this.n; i++) {
      this.rPos[2 * i] = this.x[i]; this.rPos[2 * i + 1] = this.y[i];
      this.rMat[i] = this.fixed[i] ? 2 : this.mat[i];
      this.rDmg[i] = this.nbTotal[i] > 0 ? this.nbBroken[i] / this.nbTotal[i] : 1;
      this.rSpd[i] = Math.hypot(this.vx[i], this.vy[i]);
    }
  }
  hash() { // FNV-1a over float bit patterns (BigInt; only used in tests / reset check)
    const buf = new DataView(new ArrayBuffer(8)); let h = 0xcbf29ce484222325n; const P = 0x100000001b3n, MASK = (1n << 64n) - 1n;
    const mix = (v) => { h ^= v; h = (h * P) & MASK; };
    const f = (v) => { buf.setFloat64(0, v); return buf.getBigUint64(0); };
    for (let i = 0; i < this.n; i++) { mix(f(this.x[i])); mix(f(this.y[i])); mix(f(this.vx[i])); mix(f(this.vy[i])); mix(BigInt(this.mat[i])); }
    for (let b = 0; b < this.bi.length; b++) { mix(BigInt(this.bbroken[b])); mix(f(this.bl[b])); }
    mix(f(this.ePl)); mix(f(this.eFr)); return h;
  }
  particle(i) {
    return { id: i, mat: this.mat[i], fixed: !!this.fixed[i], x: this.x[i], y: this.y[i], vx: this.vx[i], vy: this.vy[i], mass: this.mass[i],
      bondsTotal: this.nbTotal[i], bondsBroken: this.nbBroken[i], damage: this.nbTotal[i] ? this.nbBroken[i] / this.nbTotal[i] : 1 };
  }
}
const api = { Sim, I, STAT_NAMES };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALEngineJS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
