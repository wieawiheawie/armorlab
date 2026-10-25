/* ArmorLab JS engine: line-for-line port of src/sim.rs (used for tests here and as fallback when no WASM is embedded). */
(function (root) {
'use strict';
const I = { N:0,T:1,SLOPE:2,FACE:3,CAL:4,PLEN:5,NOSE:6,PMASS:7,V:8,SUPPORT:9,PL_RHO:11,PL_E:12,PL_SY:13,PL_HR:14,PL_EC:15,PR_RHO:16,PR_E:17,PR_SY:18,PR_HR:19,PR_EC:20,KC:21,DTF:22,CRUSH:23 };
const STAT_NAMES = ['time','steps','n','h','dz','dt','ke','e_el','e_pl','e_fr','e_ct','e_ext','e_total','ke0','resid','resid_rel','bonds','bonds_broken','mean_disp','max_disp','frag_count','frag_particles','proj_vx','proj_vy','proj_behind','proj_depth','proj_mass','plate_mass','max_speed','n_plate','n_proj','fired','e_damp','momentum_x','momentum_y'];

class Sim {
  constructor(cfg, opts) {
    opts = opts || {};
    this.contactMode = opts.contact || Sim.defaultContact; // 'verlet' (neighbour list + skin) or 'grid' (rebuild every step; reference)
    this.skinFrac = opts.skin != null ? opts.skin : 0.4;   // skin as a fraction of h (must stay <= 0.5 so cell size 1.5h covers cutoff)
    this.timers = null;                                     // optional per-stage timers {name: ms}; set by benchmark
    const t = cfg[I.T], s = cfg[I.SLOPE] * Math.PI / 180;
    const tan = [Math.sin(s), Math.cos(s)], nrm = [-Math.cos(s), Math.sin(s)];
    const face = cfg[I.FACE], cal = cfg[I.CAL], plen = cfg[I.PLEN], nose = cfg[I.NOSE];
    const h0 = Math.sqrt((t * face + cal * plen * 0.92) / cfg[I.N]);
    const layers = Math.max(2, Math.round(t / h0)), h = t / layers;
    const nf = Math.max(4, Math.round(face / h));
    const nPlate = nf * layers;
    const nr = Math.max(2, Math.round(cal / h)), nc = Math.max(2, Math.round(plen / h)), rad = cal * 0.5;
    const hwOf = (u) => { let hw = rad; if (u < nose) { const q = 1 - u / nose; hw = rad * Math.sqrt(Math.max(0, 1 - q * q)); } return hw; };
    let nProj = 0; // pass 1: count projectile particles so every array is allocated once, at its final size
    for (let i = 0; i < nc; i++) { const hw = hwOf((i + 0.5) * h); for (let j = 0; j < nr; j++) if (Math.abs((j - (nr - 1) * 0.5) * h) <= hw) nProj++; }
    const n = nPlate + nProj;
    const X = new Float64Array(n), Y = new Float64Array(n), M = new Uint8Array(n), F = new Uint8Array(n);
    let q = 0;
    for (let a = 0; a < nf; a++) for (let b = 0; b < layers; b++) {
      const ua = (a - (nf - 1) * 0.5) * h, ub = (b - (layers - 1) * 0.5) * h;
      X[q] = ua * tan[0] + ub * nrm[0]; Y[q] = ua * tan[1] + ub * nrm[1];
      F[q] = (cfg[I.SUPPORT] < 0.5 && (a < 3 || a + 3 >= nf)) ? 1 : 0; q++;
    }
    let dx = Infinity;
    for (let i = 0; i < nc; i++) {
      const u = (i + 0.5) * h, hw = hwOf(u);
      for (let j = 0; j < nr; j++) { const yy = (j - (nr - 1) * 0.5) * h; if (Math.abs(yy) <= hw) { X[q] = -u; Y[q] = yy; M[q] = 1; const d = (X[q] * nrm[0] + Y[q] * nrm[1] - t * 0.5 - 2 * h) / Math.cos(s); if (d < dx) dx = d; q++; } }
    }
    for (let k = nPlate; k < n; k++) X[k] += dx;
    this.n = n; this.nPlate = nPlate; this.h = h; this.time = 0; this.steps = 0; this.fired = false;
    this.vImpact = cfg[I.V]; this.crush = cfg[I.CRUSH]; this.plateT = t; this.nrm = nrm;
    this.mats = [
      { rho: cfg[I.PL_RHO], e: cfg[I.PL_E], ey: cfg[I.PL_SY] / cfg[I.PL_E], hr: cfg[I.PL_HR], ec: cfg[I.PL_EC], rate: 0.015 * (1 + cfg[I.PL_SY] / cfg[I.PL_E]) },
      { rho: cfg[I.PR_RHO], e: cfg[I.PR_E], ey: cfg[I.PR_SY] / cfg[I.PR_E], hr: cfg[I.PR_HR], ec: cfg[I.PR_EC], rate: 0.015 * (1 + cfg[I.PR_SY] / cfg[I.PR_E]) } ];
    this.dz = cfg[I.PMASS] / (this.mats[1].rho * h * h * (n - nPlate));
    this.x = X; this.y = Y; this.x0 = X.slice(); this.y0 = Y.slice();
    this.vx = new Float64Array(n); this.vy = new Float64Array(n); this.fx = new Float64Array(n); this.fy = new Float64Array(n);
    this.mat = M; this.fixed = F;
    this.mass = new Float64Array(n);
    for (let i = 0; i < n; i++) this.mass[i] = this.mats[this.mat[i]].rho * h * h * this.dz;
    const kmax = 0.75 * Math.max(this.mats[0].e, this.mats[1].e) * this.dz;
    this.kc = cfg[I.KC] * kmax;
    this.dt = cfg[I.DTF] * Math.sqrt(Math.min(this.mass[0], this.mass[n - 1]) / kmax);
    this.nbTotal = new Uint32Array(n); this.nbBroken = new Uint32Array(n);
    this.ePl = 0; this.eFr = 0; this.eDamp = 0; this.dampingPower = 0; this.ke0 = 0; this.nBrokenCount = 0; this.dmgGen = 0;
    this.cs = 1.5 * h; this._setupGrid(); this._buildBonds();
    // render buffers: material is static (written once), damage is updated incrementally when a bond breaks
    this.rPos = new Float32Array(2 * n); this.rMat = new Float32Array(n); this.rDmg = new Float32Array(n); this.rSpd = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.rMat[i] = this.fixed[i] ? 2 : this.mat[i]; this.rDmg[i] = this.nbTotal[i] > 0 ? 0 : 1; }
    this.vlValid = false; this.vlRebuilds = 0; this.vlSkin = Math.min(this.skinFrac, 0.5) * h; this.vlHalf2 = (0.499 * this.vlSkin) ** 2;
    this.refX = null; this.refY = null; this.pi = null; this.pj = null; this.np = 0;
    this.computeForces();
  }
  // ---- spatial grid. Origin/cell size never change; the grid EXPANDS (in whole cells) when particles leave it, so escaped fragments are never clamped into edge bins.
  _setupGrid() {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let i = 0; i < this.n; i++) { const xi = this.x[i], yi = this.y[i]; if (xi < minx) minx = xi; if (xi > maxx) maxx = xi; if (yi < miny) miny = yi; if (yi > maxy) maxy = yi; }
    this.gx0 = minx - 0.1; this.gy0 = miny - 0.3;
    this.gnx = Math.max(1, Math.ceil(((maxx + 0.6) - this.gx0) / this.cs)); this.gny = Math.max(1, Math.ceil(((maxy + 0.3) - this.gy0) / this.cs));
    this.gridExpansions = 0; this._allocGrid();
    this.cellItems = new Uint32Array(this.n); this.cellOf = new Uint32Array(this.n);
  }
  _allocGrid() { const nc = this.gnx * this.gny; this.cellStart = new Uint32Array(nc + 1); this.fill = new Uint32Array(nc + 1); }
  _fitGrid() {
    const { n, x, y, cs } = this; let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let i = 0; i < n; i++) { const xi = x[i], yi = y[i]; if (xi < minx) minx = xi; if (xi > maxx) maxx = xi; if (yi < miny) miny = yi; if (yi > maxy) maxy = yi; }
    if (!(minx === minx && maxx === maxx && miny === miny && maxy === maxy) || !isFinite(minx + maxx + miny + maxy)) throw new Error('ArmorLab: non-finite particle position (numerical blow-up)');
    let lo = Math.floor((minx - this.gx0) / cs), hi = Math.floor((maxx - this.gx0) / cs), loy = Math.floor((miny - this.gy0) / cs), hiy = Math.floor((maxy - this.gy0) / cs);
    if (lo >= 0 && loy >= 0 && hi < this.gnx && hiy < this.gny) return;
    const M = 8; // growth margin in cells so a drifting fragment does not trigger a regrow every rebuild
    const sx = lo < 0 ? -lo + M : 0, sy = loy < 0 ? -loy + M : 0;
    const nnx = Math.max(this.gnx + sx, hi + 1 + M), nny = Math.max(this.gny + sy, hiy + 1 + M);
    if (nnx * nny > 6.4e7) throw new Error('ArmorLab: contact grid would exceed 64M cells (particles flew implausibly far)');
    this.gx0 -= sx * cs; this.gy0 -= sy * cs; this.gnx = nnx; this.gny = nny; this.gridExpansions++; this._allocGrid();
  }
  _rebuildGrid() {
    this._fitGrid();
    const { n, x, y, cs, gx0, gy0, gnx, gny, cellStart, cellOf, cellItems, fill } = this;
    cellStart.fill(0);
    for (let i = 0; i < n; i++) {
      const cx = Math.floor((x[i] - gx0) / cs), cy = Math.floor((y[i] - gy0) / cs); // in range by construction (_fitGrid) - no clamping
      const c = cy * gnx + cx; cellOf[i] = c; cellStart[c + 1]++;
    }
    const nc = gnx * gny;
    for (let c = 0; c < nc; c++) cellStart[c + 1] += cellStart[c];
    fill.set(cellStart);
    for (let i = 0; i < n; i++) { const c = cellOf[i]; cellItems[fill[c]++] = i; }
  }
  // ---- bond build: typed arrays preallocated from a measured estimate (4.05 bonds/particle, grown 10% on overflow); no boxed-number arrays
  _buildBonds() {
    this._rebuildGrid();
    const { n, x, y, gnx, gny, cellStart, cellItems, cellOf, mat, h } = this, rmax = 1.5 * h;
    let cap = Math.ceil(4.05 * n) + 64, nb = 0;
    let bi = new Uint32Array(cap), bj = new Uint32Array(cap), bk = new Float64Array(cap), bl0 = new Float64Array(cap), bm = new Uint8Array(cap);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i], cx = c % gnx, cy = (c / gnx) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const qx = cx + ox, qy = cy + oy; if (qx < 0 || qy < 0 || qx >= gnx || qy >= gny) continue;
        const q = qy * gnx + qx;
        for (let s = cellStart[q]; s < cellStart[q + 1]; s++) {
          const j = cellItems[s]; if (j <= i || mat[j] !== mat[i]) continue;
          const dx = x[j] - x[i], dy = y[j] - y[i], r = Math.sqrt(dx * dx + dy * dy);
          if (r <= rmax) {
            if (nb === cap) { const nc2 = Math.ceil(cap * 1.1) + 64; const g = (A, T) => { const B = new T(nc2); B.set(A); return B; }; bi = g(bi, Uint32Array); bj = g(bj, Uint32Array); bk = g(bk, Float64Array); bl0 = g(bl0, Float64Array); bm = g(bm, Uint8Array); cap = nc2; }
            const m = mat[i], k0 = 0.75 * this.mats[m].e * this.dz;
            bi[nb] = i; bj[nb] = j; bk[nb] = r < 1.2 * h ? k0 : 0.5 * k0; bl0[nb] = r; bm[nb] = m; nb++;
            this.nbTotal[i]++; this.nbTotal[j]++;
          }
        }
      }
    }
    this.nBonds = nb; this.bi = bi.subarray(0, nb); this.bj = bj.subarray(0, nb); this.bk = bk.subarray(0, nb); this.bl0 = bl0.subarray(0, nb); this.bm = bm.subarray(0, nb);
    this.bl = this.bl0.slice(); this.bep = new Float64Array(nb); this.bbroken = new Uint8Array(nb);
    // compact ACTIVE bond list: ascending bond IDs (so accumulation order equals the full-list order); bond IDs/arrays are never renumbered
    this.act = new Uint32Array(nb); for (let b = 0; b < nb; b++) this.act[b] = b; this.nAct = nb; this.pendingDead = 0;
  }
  _compactActive() {
    const { act, bbroken } = this; let w = 0;
    for (let r = 0, na = this.nAct; r < na; r++) { const b = act[r]; if (!bbroken[b]) act[w++] = b; }
    this.nAct = w; this.pendingDead = 0;
  }
  computeForces() {
    const T = this.timers, t0 = T ? performance.now() : 0;
    const { x, y, vx, vy, fx, fy, bi, bj, bk, bl0, bl, bep, bm, bbroken, mats, crush, act, nbTotal, nbBroken, rDmg } = this;
    fx.fill(0); fy.fill(0); let dampingPower = 0;
    for (let r = 0, na = this.nAct; r < na; r++) {
      const b = act[r]; if (bbroken[b]) continue;
      const i = bi[b], j = bj[b], dx = x[j] - x[i], dy = y[j] - y[i];
      const rr = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-12), k = bk[b], l0 = bl0[b], m = mats[bm[b]];
      const relVx = vx[j] - vx[i], relVy = vy[j] - vy[i];
      const relN = (dx * relVx + dy * relVy) / (rr + 1e-12);
      const strain = (rr - l0) / l0;
      if (strain > m.ec || strain < crush) {
        const de0 = rr - bl[b]; this.eFr += 0.5 * k * de0 * de0; bbroken[b] = 1; nbBroken[i]++; nbBroken[j]++;
        rDmg[i] = nbBroken[i] / nbTotal[i]; rDmg[j] = nbBroken[j] / nbTotal[j]; this.nBrokenCount++; this.pendingDead++; this.dmgGen++; continue;
      }
      let de = rr - bl[b];
      const yieldLimit = (m.ey + m.hr * bep[b]) * l0;
      if (Math.abs(de) > yieldLimit) {
        const sgn = de > 0 ? 1 : -1, exc = de - sgn * yieldLimit;
        bl[b] += exc; bep[b] += Math.abs(exc) / l0;
        const dn = de - exc; this.ePl += 0.5 * k * (de * de - dn * dn); de = dn;
      }
      const viscous = m.rate * relN;
      dampingPower += m.rate * rr * relN * relN;
      const f = (k * de / rr) + viscous;
      fx[i] += f * dx; fy[i] += f * dy; fx[j] -= f * dx; fy[j] -= f * dy;
    }
    if (this.pendingDead > 512 && this.pendingDead * 50 > this.nAct) this._compactActive(); // compact only when >2% of the list is dead
    this.dampingPower = dampingPower;
    if (T) { const t1 = performance.now(); T.bonds = (T.bonds || 0) + t1 - t0; this._contact(false); T.contact = (T.contact || 0) + performance.now() - t1; } else this._contact(false);
  }
  // ---- contact. 'grid': rebuild every call (reference). 'verlet': candidate pair list within h+skin, rebuilt only when some particle moved >= skin/2 since the last build.
  _vlStale() {
    if (!this.vlValid) return true;
    const { n, x, y, refX, refY, vlHalf2 } = this;
    for (let i = 0; i < n; i++) { const dx = x[i] - refX[i], dy = y[i] - refY[i]; if (dx * dx + dy * dy >= vlHalf2) return true; }
    return false;
  }
  _vlBuild() {
    this._rebuildGrid();
    const { n, x, y, gnx, gny, cellStart, cellItems, cellOf } = this, rc = this.h + this.vlSkin, rc2 = rc * rc;
    let cap = this.pi ? this.pi.length : Math.ceil(5 * n) + 64, np = 0, pi = this.pi || new Uint32Array(cap), pj = this.pj || new Uint32Array(cap);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i], cx = c % gnx, cy = (c / gnx) | 0, xi = x[i], yi = y[i];
      for (let oy = -1; oy <= 1; oy++) {
        const qy = cy + oy; if (qy < 0 || qy >= gny) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const qx = cx + ox; if (qx < 0 || qx >= gnx) continue;
          const q = qy * gnx + qx;
          for (let s = cellStart[q], e = cellStart[q + 1]; s < e; s++) {
            const j = cellItems[s]; if (j <= i) continue;
            const dx = x[j] - xi, dy = y[j] - yi; if (dx * dx + dy * dy >= rc2) continue;
            if (np === cap) { cap = Math.ceil(cap * 1.25) + 64; const a = new Uint32Array(cap), b = new Uint32Array(cap); a.set(pi); b.set(pj); pi = a; pj = b; }
            pi[np] = i; pj[np] = j; np++;
          }
        }
      }
    }
    this.pi = pi; this.pj = pj; this.np = np;
    if (!this.refX) { this.refX = new Float64Array(n); this.refY = new Float64Array(n); }
    this.refX.set(x); this.refY.set(y); this.vlValid = true; this.vlRebuilds++;
  }
  _contact(energy) {
    const T = this.timers;
    if (this.contactMode === 'verlet') {
      const t0 = T ? performance.now() : 0;
      if (this._vlStale()) this._vlBuild();
      if (T) T.neighbor = (T.neighbor || 0) + performance.now() - t0;
      const { x, y, fx, fy, pi, pj, np, kc } = this, d = this.h, d2lim = d * d * (1 - 1e-9); let ec = 0;
      for (let p = 0; p < np; p++) {
        const i = pi[p], j = pj[p], dx = x[j] - x[i], dy = y[j] - y[i], r2 = dx * dx + dy * dy;
        if (r2 >= d2lim || r2 < 1e-24) continue;
        const r = Math.sqrt(r2), ov = d - r;
        if (energy) ec += 0.5 * kc * ov * ov;
        else { const f = -kc * ov / r; fx[i] += f * dx; fy[i] += f * dy; fx[j] -= f * dx; fy[j] -= f * dy; }
      }
      return ec;
    }
    const t0 = T ? performance.now() : 0;
    this._rebuildGrid();
    if (T) T.neighbor = (T.neighbor || 0) + performance.now() - t0;
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
    this.ke0 = ke; this.dampingPower = this._activeDampingPower();
  }
  _activeDampingPower() {
    let power = 0;
    for (let r = 0; r < this.nAct; r++) {
      const b = this.act[r]; if (this.bbroken[b]) continue;
      const i = this.bi[b], j = this.bj[b], dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i];
      const rr = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-12), relN = (dx * (this.vx[j] - this.vx[i]) + dy * (this.vy[j] - this.vy[i])) / (rr + 1e-12);
      power += this.mats[this.bm[b]].rate * rr * relN * relN;
    }
    return power;
  }
  step() {
    const { n, x, y, vx, vy, fx, fy, mass, fixed, dt } = this, T = this.timers, t0 = T ? performance.now() : 0;
    const dampingPowerStart = this.dampingPower;
    for (let i = 0; i < n; i++) { if (fixed[i]) continue; vx[i] += 0.5 * dt * fx[i] / mass[i]; vy[i] += 0.5 * dt * fy[i] / mass[i]; x[i] += dt * vx[i]; y[i] += dt * vy[i]; }
    const t1 = T ? performance.now() : 0;
    this.computeForces();
    this.eDamp += 0.5 * dt * (dampingPowerStart + this.dampingPower);
    const t2 = T ? performance.now() : 0;
    for (let i = 0; i < n; i++) { if (fixed[i]) continue; vx[i] += 0.5 * dt * fx[i] / mass[i]; vy[i] += 0.5 * dt * fy[i] / mass[i]; }
    this.time += dt; this.steps++;
    if (T) { const t3 = performance.now(); T.integrate = (T.integrate || 0) + (t1 - t0) + (t3 - t2); }
  }
  run(k) { for (let s = 0; s < k; s++) this.step(); }
  // ---- diagnostics (slow; never called from the stepping path)
  _components() {
    const n = this.n, p = new Uint32Array(n); for (let i = 0; i < n; i++) p[i] = i;
    const find = (a) => { while (p[a] !== a) { p[a] = p[p[a]]; a = p[a]; } return a; };
    for (let b = 0; b < this.bi.length; b++) { if (this.bbroken[b]) continue; const a = find(this.bi[b]), c = find(this.bj[b]); if (a !== c) p[a] = c; }
    const size = new Uint32Array(n), rootOf = new Uint32Array(n);
    for (let i = 0; i < n; i++) { const r = find(i); rootOf[i] = r; size[r]++; }
    return { rootOf, size };
  }
  _energyTerms() { // O(active bonds + contacts): elastic bond energy + contact potential
    const { x, y, bi, bj, bk, bl, bbroken } = this; let eel = 0, nbk = 0;
    for (let b = 0, nb = bi.length; b < nb; b++) {
      if (bbroken[b]) { nbk++; continue; }
      const i = bi[b], j = bj[b], dx = x[j] - x[i], dy = y[j] - y[i], de = Math.sqrt(dx * dx + dy * dy) - bl[b];
      eel += 0.5 * bk[b] * de * de;
    }
    this.nBrokenCount = nbk;
    return { eel, ect: this._contact(true) };
  }
  _fragmentTerms() {
    const { n, nPlate } = this, { rootOf, size } = this._components();
    let plateMain = -1, best = 0;
    for (let i = 0; i < nPlate; i++) if (this.fixed[i]) { plateMain = rootOf[i]; break; }
    for (let i = 0; i < nPlate; i++) { const r = rootOf[i]; if (size[r] > best) { best = size[r]; if (plateMain < 0) plateMain = r; } }
    let projMain = 0, bp = 0;
    for (let i = nPlate; i < n; i++) { const r = rootOf[i]; if (size[r] > bp) { bp = size[r]; projMain = r; } }
    let fc = 0, fp = 0;
    for (let i = 0; i < n; i++) if (rootOf[i] === i && i !== plateMain && i !== projMain) { fc++; fp += size[i]; }
    return { fc, fp };
  }
  /* stats(level): 0 = fast telemetry (O(N) scans, bond counters only; energy/fragment slots come from the last cached slow pass),
     1 = fast + energy ledger refresh, 2 (default) = everything incl. connected components (the original behaviour). */
  stats(level) {
    if (level === undefined) level = 2;
    const { n, nPlate, x, y, vx, vy, mass } = this; const s = new Float64Array(35), T = this.timers, t0 = T ? performance.now() : 0;
    let ke = 0, maxsp = 0, momentumX = 0, momentumY = 0;
    for (let i = 0; i < n; i++) { const v2 = vx[i] * vx[i] + vy[i] * vy[i]; ke += 0.5 * mass[i] * v2; momentumX += mass[i] * vx[i]; momentumY += mass[i] * vy[i]; if (v2 > maxsp) maxsp = v2; }
    maxsp = Math.sqrt(maxsp);
    const C = this._diag || (this._diag = { eel: 0, ect: 0, fc: 0, fp: 0, energyAtStep: -1, fragAtStep: -1, energyAtTime: 0, fragAtTime: 0 });
    if (level >= 1) { const t1 = T ? performance.now() : 0; const e = this._energyTerms(); C.eel = e.eel; C.ect = e.ect; C.energyAtStep = this.steps; C.energyAtTime = this.time; if (T) T.energy = (T.energy || 0) + performance.now() - t1; }
    if (level >= 2) { const t1 = T ? performance.now() : 0; const f = this._fragmentTerms(); C.fc = f.fc; C.fp = f.fp; C.fragAtStep = this.steps; C.fragAtTime = this.time; if (T) T.fragments = (T.fragments || 0) + performance.now() - t1; }
    const eel = C.eel, ect = C.ect, total = ke + eel + this.ePl + this.eFr + ect + this.eDamp;
    let sd = 0, md = 0;
    for (let i = 0; i < nPlate; i++) { const d = Math.hypot(x[i] - this.x0[i], y[i] - this.y0[i]); sd += d; if (d > md) md = d; }
    let pm = 0, pvx = 0, pvy = 0, behind = 0, minN = Infinity;
    for (let i = nPlate; i < n; i++) {
      pm += mass[i]; pvx += mass[i] * vx[i]; pvy += mass[i] * vy[i];
      const nn = x[i] * this.nrm[0] + y[i] * this.nrm[1]; if (nn < -this.plateT * 0.5) behind += mass[i]; if (nn < minN) minN = nn;
    }
    const dmax = Math.max(0, this.plateT * 0.5 - minN);
    let mpl = 0; for (let i = 0; i < nPlate; i++) mpl += mass[i];
    s.set([this.time, this.steps, n, this.h, this.dz, this.dt, ke, eel, this.ePl, this.eFr, ect, 0, total, this.ke0, total - this.ke0,
      this.ke0 > 0 ? (total - this.ke0) / this.ke0 : 0, this.bi.length, this.nBrokenCount, sd / nPlate, md, C.fc, C.fp, pvx / pm, pvy / pm, behind / pm, dmax, pm, mpl, maxsp, nPlate, n - nPlate, this.fired ? 1 : 0]);
    s[32] = this.eDamp; s[33] = momentumX; s[34] = momentumY;
    if (T && level === 0) T.fast = (T.fast || 0) + performance.now() - t0;
    return s;
  }
  diagAge() { const C = this._diag; return C ? { energyStep: C.energyAtStep, fragStep: C.fragAtStep, energyTime: C.energyAtTime, fragTime: C.fragAtTime } : { energyStep: -1, fragStep: -1, energyTime: 0, fragTime: 0 }; }
  /* fillRender(needSpeed): positions every call (f32 copy); material static (built once); damage kept current incrementally (see dmgGen);
     speed only computed when needSpeed !== false (UI passes false unless the velocity view is active). */
  fillRender(needSpeed) {
    const { n, x, y, rPos } = this;
    for (let i = 0; i < n; i++) { rPos[2 * i] = x[i]; rPos[2 * i + 1] = y[i]; }
    if (needSpeed !== false) { const { vx, vy, rSpd } = this; for (let i = 0; i < n; i++) rSpd[i] = Math.hypot(vx[i], vy[i]); }
  }
  hash() { // FNV-1a over float bit patterns (BigInt; only used in tests / reset check)
    const buf = new DataView(new ArrayBuffer(8)); let h = 0xcbf29ce484222325n; const P = 0x100000001b3n, MASK = (1n << 64n) - 1n;
    const mix = (v) => { h ^= v; h = (h * P) & MASK; };
    const f = (v) => { buf.setFloat64(0, v); return buf.getBigUint64(0); };
    for (let i = 0; i < this.n; i++) { mix(f(this.x[i])); mix(f(this.y[i])); mix(f(this.vx[i])); mix(f(this.vy[i])); mix(BigInt(this.mat[i])); }
    for (let b = 0; b < this.bi.length; b++) { mix(BigInt(this.bbroken[b])); mix(f(this.bl[b])); }
    mix(f(this.ePl)); mix(f(this.eFr)); mix(f(this.eDamp)); return h;
  }
  particle(i) {
    return { id: i, mat: this.mat[i], fixed: !!this.fixed[i], x: this.x[i], y: this.y[i], vx: this.vx[i], vy: this.vy[i], mass: this.mass[i],
      bondsTotal: this.nbTotal[i], bondsBroken: this.nbBroken[i], damage: this.nbTotal[i] ? this.nbBroken[i] / this.nbTotal[i] : 1 };
  }
}
Sim.defaultContact = 'verlet';
const api = { Sim, I, STAT_NAMES };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALEngineJS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
