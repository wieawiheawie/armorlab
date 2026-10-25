//! ArmorLab solver: 2D bonded-particle (spring-lattice) explicit dynamics with
//! bond-independent penalty contact. See docs/PHYSICS_MODEL.md.
//! NOTE: this file mirrors web/engine_js.js step for step.

pub const CFG_LEN: usize = 24;
pub const STAT_LEN: usize = 36;

// cfg indices
pub const C_N: usize = 0;
pub const C_T: usize = 1;
pub const C_SLOPE: usize = 2;
pub const C_FACE: usize = 3;
pub const C_CAL: usize = 4;
pub const C_PLEN: usize = 5;
pub const C_NOSE: usize = 6;
pub const C_PMASS: usize = 7;
pub const C_V: usize = 8;
pub const C_SUPPORT: usize = 9; // 0 clamped ends, 1 free
pub const C_PLASTICITY: usize = 10; // 0 legacy rest update, 1 isotropic-hardening return map
pub const C_PL_RHO: usize = 11;
pub const C_PL_E: usize = 12;
pub const C_PL_SY: usize = 13;
pub const C_PL_HR: usize = 14;
pub const C_PL_EC: usize = 15;
pub const C_PR_RHO: usize = 16;
pub const C_PR_E: usize = 17;
pub const C_PR_SY: usize = 18;
pub const C_PR_HR: usize = 19;
pub const C_PR_EC: usize = 20;
pub const C_KC: usize = 21;
pub const C_DTF: usize = 22;
pub const C_CRUSH: usize = 23;

#[derive(Clone, Copy)]
pub struct Mat {
    pub rho: f64,
    pub e: f64,
    pub ey: f64, // yield strain sy/E
    pub hr: f64,
    pub ec: f64,
    pub rate: f64, // small viscous strain-rate sensitivity, consistent with a viscoplastic microelastic bond model
}

pub struct Sim {
    pub n: usize,
    pub n_plate: usize,
    pub h: f64,
    pub dz: f64,
    pub dt: f64,
    pub time: f64,
    pub steps: u64,
    pub fired: bool,
    pub v_impact: f64,
    pub plasticity_model: u8,
    pub crush: f64,
    pub kc: f64,
    pub plate_t: f64,
    pub nrm: [f64; 2],
    pub cen: [f64; 2],
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub vx: Vec<f64>,
    pub vy: Vec<f64>,
    pub fx: Vec<f64>,
    pub fy: Vec<f64>,
    pub x0: Vec<f64>,
    pub y0: Vec<f64>,
    pub mass: Vec<f64>,
    pub mat: Vec<u8>,
    pub fixed: Vec<u8>,
    pub nb_total: Vec<u32>,
    pub nb_broken: Vec<u32>,
    pub bi: Vec<u32>,
    pub bj: Vec<u32>,
    pub bk: Vec<f64>,
    pub bl0: Vec<f64>,
    pub bl: Vec<f64>,
    pub bep: Vec<f64>,
    pub bm: Vec<u8>,
    pub bbroken: Vec<u8>,
    pub mats: [Mat; 2],
    pub e_pl: f64,
    pub e_fr: f64,
    pub e_damp: f64,
    damping_power: f64,
    pub ke0: f64,
    // grid
    cs: f64,
    gx0: f64,
    gy0: f64,
    gnx: usize,
    gny: usize,
    cell_start: Vec<u32>,
    cell_items: Vec<u32>,
    cell_of: Vec<u32>,
    fill: Vec<u32>,
    pub grid_expansions: u32,
    // active (not yet broken) bond list: ascending bond ids, compacted lazily; bond ids/arrays are never renumbered
    pub act: Vec<u32>,
    pub n_act: usize,
    pending_dead: usize,
    pub n_broken: u64,
    pub dmg_gen: u64,
    // contact neighbour list (mode 1 = Verlet list with skin, mode 0 = rebuild the grid every call)
    pub contact_mode: u8,
    vl_skin: f64,
    vl_half2: f64,
    vl_valid: bool,
    pub vl_rebuilds: u64,
    ref_x: Vec<f64>,
    ref_y: Vec<f64>,
    pi: Vec<u32>,
    pj: Vec<u32>,
    np: usize,
    // cached slow diagnostics
    d_eel: f64,
    d_ehard: f64,
    d_ect: f64,
    d_fc: u64,
    d_fp: u64,
    pub d_energy_step: i64,
    pub d_frag_step: i64,
    pub d_energy_time: f64,
    pub d_frag_time: f64,
    // render buffers
    pub r_pos: Vec<f32>,
    pub r_mat: Vec<f32>,
    pub r_dmg: Vec<f32>,
    pub r_spd: Vec<f32>,
}

impl Sim {
    pub fn build(cfg: &[f64]) -> Sim { Sim::build_with(cfg, 1) }

    /// contact_mode: 1 = Verlet neighbour list (default, matches the JS engine), 0 = grid rebuilt every call (reference)
    pub fn build_with(cfg: &[f64], contact_mode: u8) -> Sim {
        assert!(cfg.len() >= CFG_LEN, "ArmorLab: config must contain at least {CFG_LEN} values");
        assert!(cfg[C_N].is_finite() && cfg[C_N] > 0.0, "ArmorLab: particle count must be finite and > 0");
        assert!(cfg[C_T].is_finite() && cfg[C_T] > 0.0, "ArmorLab: target thickness must be finite and > 0");
        assert!(cfg[C_SLOPE].is_finite() && (0.0..=90.0).contains(&cfg[C_SLOPE]), "ArmorLab: target slope must be finite and within [0°, 90°]");
        assert!(cfg[C_FACE].is_finite() && cfg[C_FACE] > 0.0, "ArmorLab: face length must be finite and > 0");
        assert!(cfg[C_CAL].is_finite() && cfg[C_CAL] > 0.0, "ArmorLab: projectile caliber must be finite and > 0");
        assert!(cfg[C_PLEN].is_finite() && cfg[C_PLEN] > 0.0, "ArmorLab: projectile length must be finite and > 0");
        assert!(cfg[C_NOSE].is_finite() && cfg[C_NOSE] >= 0.0, "ArmorLab: nose length must be finite and >= 0");
        assert!(cfg[C_PMASS].is_finite() && cfg[C_PMASS] > 0.0, "ArmorLab: projectile mass must be finite and > 0");
        assert!(cfg[C_V].is_finite() && cfg[C_V] >= 0.0, "ArmorLab: impact speed must be finite and >= 0");
        assert!(cfg[C_SUPPORT].is_finite() && (cfg[C_SUPPORT] == 0.0 || cfg[C_SUPPORT] == 1.0), "ArmorLab: support mode must be 0 (clamped) or 1 (free)");
        assert!(cfg[C_KC].is_finite() && cfg[C_KC] > 0.0, "ArmorLab: contact stiffness must be finite and > 0");
        assert!(cfg[C_DTF].is_finite() && cfg[C_DTF] > 0.0, "ArmorLab: timestep factor must be finite and > 0");
        assert!(cfg[C_CRUSH].is_finite() && cfg[C_CRUSH] < 0.0, "ArmorLab: compressive crush cutoff must be negative");
        for (_, value, value_name) in [
            (C_PL_RHO, cfg[C_PL_RHO], "plate density"),
            (C_PL_E, cfg[C_PL_E], "plate modulus"),
            (C_PL_SY, cfg[C_PL_SY], "plate yield stress"),
            (C_PL_EC, cfg[C_PL_EC], "plate critical strain"),
            (C_PR_RHO, cfg[C_PR_RHO], "projectile density"),
            (C_PR_E, cfg[C_PR_E], "projectile modulus"),
            (C_PR_SY, cfg[C_PR_SY], "projectile yield stress"),
            (C_PR_EC, cfg[C_PR_EC], "projectile critical strain"),
        ] {
            assert!(value.is_finite() && value > 0.0, "ArmorLab: {value_name} must be finite and > 0");
        }
        assert!(cfg[C_PL_HR].is_finite() && cfg[C_PL_HR] >= 0.0, "ArmorLab: hardening ratio >= 0");
        assert!(cfg[C_PR_HR].is_finite() && cfg[C_PR_HR] >= 0.0, "ArmorLab: hardening ratio >= 0");
        let t = cfg[C_T];
        let s = cfg[C_SLOPE].to_radians();
        let tan = [s.sin(), s.cos()];
        let nrm = [-s.cos(), s.sin()];
        let face = cfg[C_FACE];
        let cal = cfg[C_CAL];
        let plen = cfg[C_PLEN];
        let nose = cfg[C_NOSE];
        let a_est = t * face + cal * plen * 0.92;
        let h0 = (a_est / cfg[C_N]).sqrt();
        let layers = ((t / h0).round() as usize).max(2);
        let h = t / layers as f64;
        let nf = ((face / h).round() as usize).max(4);
        let mut x: Vec<f64> = Vec::new();
        let mut y: Vec<f64> = Vec::new();
        let mut mat: Vec<u8> = Vec::new();
        let mut fixed: Vec<u8> = Vec::new();
        for a in 0..nf {
            for b in 0..layers {
                let ua = (a as f64 - (nf as f64 - 1.0) * 0.5) * h;
                let ub = (b as f64 - (layers as f64 - 1.0) * 0.5) * h;
                x.push(ua * tan[0] + ub * nrm[0]);
                y.push(ua * tan[1] + ub * nrm[1]);
                mat.push(0);
                let clamp = cfg[C_SUPPORT] < 0.5 && (a < 3 || a + 3 >= nf);
                fixed.push(if clamp { 1 } else { 0 });
            }
        }
        let n_plate = x.len();
        // projectile (front = +x, tip at u=0)
        let nr = ((cal / h).round() as usize).max(2);
        let nc = ((plen / h).round() as usize).max(2);
        let rad = cal * 0.5;
        let mut px: Vec<f64> = Vec::new();
        let mut py: Vec<f64> = Vec::new();
        for i in 0..nc {
            let u = (i as f64 + 0.5) * h;
            let hw = if u < nose {
                let q = 1.0 - u / nose;
                rad * (1.0 - q * q).max(0.0).sqrt()
            } else {
                rad
            };
            for j in 0..nr {
                let yy = (j as f64 - (nr as f64 - 1.0) * 0.5) * h;
                if yy.abs() <= hw {
                    px.push(-u);
                    py.push(yy);
                }
            }
        }
        // clearance shift along x so every projectile particle is >= 2h in front of the plate face
        let mut dx = f64::MAX;
        for k in 0..px.len() {
            let d = (px[k] * nrm[0] + py[k] * nrm[1] - t * 0.5 - 2.0 * h) / s.cos();
            if d < dx {
                dx = d;
            }
        }
        for k in 0..px.len() {
            x.push(px[k] + dx);
            y.push(py[k]);
            mat.push(1);
            fixed.push(0);
        }
        let n = x.len();
        let mats = [
            Mat { rho: cfg[C_PL_RHO], e: cfg[C_PL_E], ey: cfg[C_PL_SY] / cfg[C_PL_E], hr: cfg[C_PL_HR], ec: cfg[C_PL_EC], rate: 0.015 * (1.0 + cfg[C_PL_SY] / cfg[C_PL_E]) },
            Mat { rho: cfg[C_PR_RHO], e: cfg[C_PR_E], ey: cfg[C_PR_SY] / cfg[C_PR_E], hr: cfg[C_PR_HR], ec: cfg[C_PR_EC], rate: 0.015 * (1.0 + cfg[C_PR_SY] / cfg[C_PR_E]) },
        ];
        let plasticity_model = if cfg[C_PLASTICITY] >= 0.5 { 1 } else { 0 };
        if plasticity_model == 1 {
            for m in mats {
                assert!(m.e.is_finite() && m.e > 0.0 && m.ey.is_finite() && m.ey >= 0.0 && m.hr.is_finite() && m.hr >= 0.0,
                    "ArmorLab: isotropic plasticity requires finite E > 0, yield strain >= 0, and hardening ratio >= 0");
            }
        }
        let n_proj = n - n_plate;
        // out-of-plane depth so that projectile mass equals the preset exactly
        let dz = cfg[C_PMASS] / (mats[1].rho * h * h * n_proj as f64);
        let mut mass = vec![0.0; n];
        for i in 0..n {
            mass[i] = mats[mat[i] as usize].rho * h * h * dz;
        }
        let kmax = 0.75 * mats[0].e.max(mats[1].e) * dz;
        let kc = cfg[C_KC] * kmax;
        let mmin = mass[0].min(mass[n - 1]);
        let dt = cfg[C_DTF] * (mmin / kmax).sqrt();
        let mut sim = Sim {
            n,
            n_plate,
            h,
            dz,
            dt,
            time: 0.0,
            steps: 0,
            fired: false,
            v_impact: cfg[C_V],
            plasticity_model,
            crush: cfg[C_CRUSH],
            kc,
            plate_t: t,
            nrm,
            cen: [0.0, 0.0],
            x0: x.clone(),
            y0: y.clone(),
            x,
            y,
            vx: vec![0.0; n],
            vy: vec![0.0; n],
            fx: vec![0.0; n],
            fy: vec![0.0; n],
            mass,
            mat,
            fixed,
            nb_total: vec![0; n],
            nb_broken: vec![0; n],
            bi: vec![],
            bj: vec![],
            bk: vec![],
            bl0: vec![],
            bl: vec![],
            bep: vec![],
            bm: vec![],
            bbroken: vec![],
            mats,
            e_pl: 0.0,
            e_fr: 0.0,
            e_damp: 0.0,
            damping_power: 0.0,
            ke0: 0.0,
            cs: 1.5 * h,
            gx0: 0.0,
            gy0: 0.0,
            gnx: 1,
            gny: 1,
            cell_start: vec![],
            cell_items: vec![0; n],
            cell_of: vec![0; n],
            fill: vec![],
            grid_expansions: 0,
            act: vec![],
            n_act: 0,
            pending_dead: 0,
            n_broken: 0,
            dmg_gen: 0,
            contact_mode,
            vl_skin: 0.4 * h,
            vl_half2: (0.499 * 0.4 * h) * (0.499 * 0.4 * h),
            vl_valid: false,
            vl_rebuilds: 0,
            ref_x: vec![],
            ref_y: vec![],
            pi: vec![],
            pj: vec![],
            np: 0,
            d_eel: 0.0,
            d_ehard: 0.0,
            d_ect: 0.0,
            d_fc: 0,
            d_fp: 0,
            d_energy_step: -1,
            d_frag_step: -1,
            d_energy_time: 0.0,
            d_frag_time: 0.0,
            r_pos: vec![0.0; 2 * n],
            r_mat: vec![0.0; n],
            r_dmg: vec![0.0; n],
            r_spd: vec![0.0; n],
        };
        sim.setup_grid();
        sim.build_bonds();
        for i in 0..n {
            sim.r_mat[i] = if sim.fixed[i] != 0 { 2.0 } else { sim.mat[i] as f32 };
            sim.r_dmg[i] = if sim.nb_total[i] > 0 { 0.0 } else { 1.0 };
        }
        sim.compute_forces();
        sim
    }

    fn setup_grid(&mut self) {
        let mut minx = f64::MAX;
        let mut maxx = f64::MIN;
        let mut miny = f64::MAX;
        let mut maxy = f64::MIN;
        for i in 0..self.n {
            minx = minx.min(self.x[i]);
            maxx = maxx.max(self.x[i]);
            miny = miny.min(self.y[i]);
            maxy = maxy.max(self.y[i]);
        }
        self.gx0 = minx - 0.1;
        self.gy0 = miny - 0.3;
        let wx = (maxx + 0.6) - self.gx0;
        let wy = (maxy + 0.3) - self.gy0;
        self.gnx = ((wx / self.cs).ceil() as usize).max(1);
        self.gny = ((wy / self.cs).ceil() as usize).max(1);
        self.alloc_grid();
    }

    fn alloc_grid(&mut self) {
        let nc = self.gnx * self.gny;
        self.cell_start = vec![0; nc + 1];
        self.fill = vec![0; nc + 1];
    }

    /// Grow the grid (whole cells, same origin alignment/cell size) when particles leave it: escaped fragments are never clamped into edge bins.
    fn fit_grid(&mut self) {
        let (mut minx, mut maxx, mut miny, mut maxy) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for i in 0..self.n {
            let (xi, yi) = (self.x[i], self.y[i]);
            if xi < minx { minx = xi; }
            if xi > maxx { maxx = xi; }
            if yi < miny { miny = yi; }
            if yi > maxy { maxy = yi; }
        }
        if !(minx + maxx + miny + maxy).is_finite() { panic!("ArmorLab: non-finite particle position (numerical blow-up)"); }
        let cs = self.cs;
        let lo = ((minx - self.gx0) / cs).floor();
        let hi = ((maxx - self.gx0) / cs).floor();
        let loy = ((miny - self.gy0) / cs).floor();
        let hiy = ((maxy - self.gy0) / cs).floor();
        if lo >= 0.0 && loy >= 0.0 && (hi as i64) < self.gnx as i64 && (hiy as i64) < self.gny as i64 { return; }
        let m = 8i64;
        let sx = if lo < 0.0 { -(lo as i64) + m } else { 0 };
        let sy = if loy < 0.0 { -(loy as i64) + m } else { 0 };
        let nnx = ((self.gnx as i64) + sx).max(hi as i64 + 1 + m) as usize;
        let nny = ((self.gny as i64) + sy).max(hiy as i64 + 1 + m) as usize;
        if (nnx as f64) * (nny as f64) > 6.4e7 { panic!("ArmorLab: contact grid would exceed 64M cells"); }
        self.gx0 -= sx as f64 * cs;
        self.gy0 -= sy as f64 * cs;
        self.gnx = nnx;
        self.gny = nny;
        self.grid_expansions += 1;
        self.alloc_grid();
    }

    fn rebuild_grid(&mut self) {
        self.fit_grid();
        let nc = self.gnx * self.gny;
        for c in self.cell_start.iter_mut() {
            *c = 0;
        }
        for i in 0..self.n {
            let cx = ((self.x[i] - self.gx0) / self.cs).floor() as usize; // in range by construction (fit_grid) - no clamping
            let cy = ((self.y[i] - self.gy0) / self.cs).floor() as usize;
            let c = cy * self.gnx + cx;
            self.cell_of[i] = c as u32;
            self.cell_start[c + 1] += 1;
        }
        for c in 0..nc {
            self.cell_start[c + 1] += self.cell_start[c];
        }
        self.fill.copy_from_slice(&self.cell_start);
        for i in 0..self.n {
            let c = self.cell_of[i] as usize;
            let f = self.fill[c] as usize;
            self.cell_items[f] = i as u32;
            self.fill[c] += 1;
        }
    }

    fn build_bonds(&mut self) {
        self.rebuild_grid();
        let cap = (4.05 * self.n as f64) as usize + 64;
        self.bi.reserve_exact(cap); self.bj.reserve_exact(cap); self.bk.reserve_exact(cap); self.bl0.reserve_exact(cap); self.bl.reserve_exact(cap); self.bep.reserve_exact(cap); self.bm.reserve_exact(cap); self.bbroken.reserve_exact(cap);
        let rmax = 1.5 * self.h;
        for i in 0..self.n {
            let c = self.cell_of[i] as usize;
            let cx = (c % self.gnx) as i64;
            let cy = (c / self.gnx) as i64;
            for oy in -1..=1i64 {
                for ox in -1..=1i64 {
                    let qx = cx + ox;
                    let qy = cy + oy;
                    if qx < 0 || qy < 0 || qx >= self.gnx as i64 || qy >= self.gny as i64 {
                        continue;
                    }
                    let q = (qy as usize) * self.gnx + qx as usize;
                    for s in self.cell_start[q]..self.cell_start[q + 1] {
                        let j = self.cell_items[s as usize] as usize;
                        if j <= i || self.mat[j] != self.mat[i] {
                            continue;
                        }
                        let dx = self.x[j] - self.x[i];
                        let dy = self.y[j] - self.y[i];
                        let r = (dx * dx + dy * dy).sqrt();
                        if r <= rmax {
                            let m = self.mat[i] as usize;
                            let k0 = 0.75 * self.mats[m].e * self.dz;
                            let k = if r < 1.2 * self.h { k0 } else { 0.5 * k0 };
                            self.bi.push(i as u32);
                            self.bj.push(j as u32);
                            self.bk.push(k);
                            self.bl0.push(r);
                            self.bl.push(r);
                            self.bep.push(0.0);
                            self.bm.push(m as u8);
                            self.bbroken.push(0);
                            self.nb_total[i] += 1;
                            self.nb_total[j] += 1;
                        }
                    }
                }
            }
        }
        self.bi.shrink_to_fit(); self.bj.shrink_to_fit(); self.bk.shrink_to_fit(); self.bl0.shrink_to_fit(); self.bl.shrink_to_fit(); self.bep.shrink_to_fit(); self.bm.shrink_to_fit(); self.bbroken.shrink_to_fit();
        self.act = (0..self.bi.len() as u32).collect();
        self.n_act = self.act.len();
        self.pending_dead = 0;
    }

    fn compact_active(&mut self) {
        let mut w = 0usize;
        for r in 0..self.n_act {
            let b = self.act[r];
            if self.bbroken[b as usize] == 0 {
                self.act[w] = b;
                w += 1;
            }
        }
        self.n_act = w;
        self.pending_dead = 0;
    }

    /// bond state update (fracture, plasticity) + force evaluation (bonds, contact)
    pub fn compute_forces(&mut self) {
        let mut damping_power = 0.0;
        for i in 0..self.n {
            self.fx[i] = 0.0;
            self.fy[i] = 0.0;
        }
        for ar in 0..self.n_act {
            let b = self.act[ar] as usize;
            if self.bbroken[b] != 0 {
                continue;
            }
            let i = self.bi[b] as usize;
            let j = self.bj[b] as usize;
            let dx = self.x[j] - self.x[i];
            let dy = self.y[j] - self.y[i];
            let r = (dx * dx + dy * dy).sqrt().max(1e-12);
            let k = self.bk[b];
            let l0 = self.bl0[b];
            let m = self.mats[self.bm[b] as usize];
            let rel_vx = self.vx[j] - self.vx[i];
            let rel_vy = self.vy[j] - self.vy[i];
            let rel_n = (dx * rel_vx + dy * rel_vy) / (r + 1e-12);
            let strain = (r - l0) / l0;
            if strain > m.ec || strain < self.crush {
                let de = r - self.bl[b];
                let hardening_energy = if self.plasticity_model == 1 {
                    0.5 * k * l0 * l0 * m.hr * self.bep[b] * self.bep[b]
                } else { 0.0 };
                self.e_fr += 0.5 * k * de * de + hardening_energy;
                self.bbroken[b] = 1;
                self.nb_broken[i] += 1;
                self.nb_broken[j] += 1;
                self.r_dmg[i] = self.nb_broken[i] as f32 / self.nb_total[i] as f32;
                self.r_dmg[j] = self.nb_broken[j] as f32 / self.nb_total[j] as f32;
                self.n_broken += 1;
                self.pending_dead += 1;
                self.dmg_gen += 1;
                continue;
            }
            let mut de = r - self.bl[b];
            if self.plasticity_model == 0 {
                let yield_limit = (m.ey + m.hr * self.bep[b]) * l0;
                if de.abs() > yield_limit {
                    let sgn = if de > 0.0 { 1.0 } else { -1.0 };
                    let exc = de - sgn * yield_limit;
                    self.bl[b] += exc;
                    self.bep[b] += exc.abs() / l0;
                    let dn = de - exc;
                    self.e_pl += 0.5 * k * (de * de - dn * dn);
                    de = dn;
                }
            } else {
                let h = m.hr;
                let alpha = self.bep[b];
                let trial_strain = de / l0;
                let yield_strain = m.ey + h * alpha;
                let gamma = ((trial_strain.abs() - yield_strain) / (1.0 + h)).max(0.0);
                if gamma > 0.0 {
                    let sign = trial_strain.signum();
                    let old_alpha = alpha;
                    let new_alpha = old_alpha + gamma;
                    let new_de = sign * l0 * (yield_strain + h * gamma);
                    let elastic_drop = 0.5 * k * (de * de - new_de * new_de);
                    let hardening_increase = 0.5 * k * l0 * l0 * h * (new_alpha * new_alpha - old_alpha * old_alpha);
                    self.bl[b] += sign * gamma * l0;
                    self.bep[b] = new_alpha;
                    self.e_pl += (elastic_drop - hardening_increase).max(0.0);
                    de = new_de;
                }
            }
            let viscous = m.rate * rel_n;
            damping_power += m.rate * r * rel_n * rel_n;
            let f = (k * de / r) + viscous;
            self.fx[i] += f * dx;
            self.fy[i] += f * dy;
            self.fx[j] -= f * dx;
            self.fy[j] -= f * dy;
        }
        if self.pending_dead > 512 && self.pending_dead * 50 > self.n_act {
            self.compact_active();
        }
        self.damping_power = damping_power;
        self.contact(false);
    }

    fn vl_stale(&self) -> bool {
        if !self.vl_valid { return true; }
        for i in 0..self.n {
            let dx = self.x[i] - self.ref_x[i];
            let dy = self.y[i] - self.ref_y[i];
            if dx * dx + dy * dy >= self.vl_half2 { return true; }
        }
        false
    }

    fn vl_build(&mut self) {
        self.rebuild_grid();
        let rc = self.h + self.vl_skin;
        let rc2 = rc * rc;
        self.pi.clear();
        self.pj.clear();
        for i in 0..self.n {
            let c = self.cell_of[i] as usize;
            let cx = (c % self.gnx) as i64;
            let cy = (c / self.gnx) as i64;
            let (xi, yi) = (self.x[i], self.y[i]);
            for oy in -1..=1i64 {
                let qy = cy + oy;
                if qy < 0 || qy >= self.gny as i64 { continue; }
                for ox in -1..=1i64 {
                    let qx = cx + ox;
                    if qx < 0 || qx >= self.gnx as i64 { continue; }
                    let q = (qy as usize) * self.gnx + qx as usize;
                    for s in self.cell_start[q]..self.cell_start[q + 1] {
                        let j = self.cell_items[s as usize] as usize;
                        if j <= i { continue; }
                        let dx = self.x[j] - xi;
                        let dy = self.y[j] - yi;
                        if dx * dx + dy * dy >= rc2 { continue; }
                        self.pi.push(i as u32);
                        self.pj.push(j as u32);
                    }
                }
            }
        }
        self.np = self.pi.len();
        self.ref_x.clear(); self.ref_x.extend_from_slice(&self.x);
        self.ref_y.clear(); self.ref_y.extend_from_slice(&self.y);
        self.vl_valid = true;
        self.vl_rebuilds += 1;
    }

    /// penalty contact between all pairs closer than h, independent of bonds.
    /// returns contact potential energy when `energy` is true
    fn contact(&mut self, energy: bool) -> f64 {
        if self.contact_mode == 1 {
            if self.vl_stale() { self.vl_build(); }
            let d = self.h;
            let d2 = d * d;
            let mut ec = 0.0;
            for p in 0..self.np {
                let i = self.pi[p] as usize;
                let j = self.pj[p] as usize;
                let dx = self.x[j] - self.x[i];
                let dy = self.y[j] - self.y[i];
                let r2 = dx * dx + dy * dy;
                if r2 >= d2 * (1.0 - 1e-9) || r2 < 1e-24 { continue; }
                let r = r2.sqrt();
                let ov = d - r;
                if energy {
                    ec += 0.5 * self.kc * ov * ov;
                } else {
                    let f = -self.kc * ov / r;
                    self.fx[i] += f * dx;
                    self.fy[i] += f * dy;
                    self.fx[j] -= f * dx;
                    self.fy[j] -= f * dy;
                }
            }
            return ec;
        }
        self.rebuild_grid();
        let d = self.h;
        let d2 = d * d;
        let mut ec = 0.0;
        for i in 0..self.n {
            let c = self.cell_of[i] as usize;
            let cx = (c % self.gnx) as i64;
            let cy = (c / self.gnx) as i64;
            for oy in -1..=1i64 {
                for ox in -1..=1i64 {
                    let qx = cx + ox;
                    let qy = cy + oy;
                    if qx < 0 || qy < 0 || qx >= self.gnx as i64 || qy >= self.gny as i64 {
                        continue;
                    }
                    let q = (qy as usize) * self.gnx + qx as usize;
                    for s in self.cell_start[q]..self.cell_start[q + 1] {
                        let j = self.cell_items[s as usize] as usize;
                        if j <= i {
                            continue;
                        }
                        let dx = self.x[j] - self.x[i];
                        let dy = self.y[j] - self.y[i];
                        let r2 = dx * dx + dy * dy;
                        if r2 >= d2 * (1.0 - 1e-9) || r2 < 1e-24 {
                            continue;
                        }
                        let r = r2.sqrt();
                        let ov = d - r;
                        if energy {
                            ec += 0.5 * self.kc * ov * ov;
                        } else {
                            let f = -self.kc * ov / r;
                            self.fx[i] += f * dx;
                            self.fy[i] += f * dy;
                            self.fx[j] -= f * dx;
                            self.fy[j] -= f * dy;
                        }
                    }
                }
            }
        }
        ec
    }

    pub fn fire(&mut self) {
        if self.fired {
            return;
        }
        self.fired = true;
        let v = self.v_impact;
        let mut ke = 0.0;
        for i in self.n_plate..self.n {
            self.vx[i] = v;
            ke += 0.5 * self.mass[i] * v * v;
        }
        self.ke0 = ke;
        self.damping_power = self.active_damping_power();
    }

    pub fn step(&mut self) {
        let dt = self.dt;
        let damping_power_start = self.damping_power;
        for i in 0..self.n {
            if self.fixed[i] != 0 {
                continue;
            }
            self.vx[i] += 0.5 * dt * self.fx[i] / self.mass[i];
            self.vy[i] += 0.5 * dt * self.fy[i] / self.mass[i];
            self.x[i] += dt * self.vx[i];
            self.y[i] += dt * self.vy[i];
        }
        self.compute_forces();
        self.e_damp += 0.5 * dt * (damping_power_start + self.damping_power);
        for i in 0..self.n {
            if self.fixed[i] != 0 {
                continue;
            }
            self.vx[i] += 0.5 * dt * self.fx[i] / self.mass[i];
            self.vy[i] += 0.5 * dt * self.fy[i] / self.mass[i];
        }
        self.time += dt;
        self.steps += 1;
    }

    pub fn run(&mut self, nsteps: usize) {
        for _ in 0..nsteps {
            self.step();
        }
    }

    /// union-find fragments over intact bonds
    fn components(&self) -> (Vec<u32>, Vec<u32>) {
        let mut p: Vec<u32> = (0..self.n as u32).collect();
        fn find(p: &mut Vec<u32>, mut a: u32) -> u32 {
            while p[a as usize] != a {
                let g = p[p[a as usize] as usize];
                p[a as usize] = g;
                a = g;
            }
            a
        }
        for b in 0..self.bi.len() {
            if self.bbroken[b] != 0 {
                continue;
            }
            let a = find(&mut p, self.bi[b]);
            let c = find(&mut p, self.bj[b]);
            if a != c {
                p[a as usize] = c;
            }
        }
        let mut size = vec![0u32; self.n];
        let mut root = vec![0u32; self.n];
        for i in 0..self.n {
            let r = find(&mut p, i as u32);
            root[i] = r;
            size[r as usize] += 1;
        }
        (root, size)
    }

    /// full diagnostics (energy + fragments), same as the original behaviour
    pub fn stats(&mut self) -> [f64; STAT_LEN] { self.stats_level(2) }

    /// level 0 = fast telemetry (no bond scan, no connected components; slow terms come from the last cached pass),
    /// 1 = + energy ledger refresh, 2 = + fragment graph
    pub fn stats_level(&mut self, level: u8) -> [f64; STAT_LEN] {
        let mut s = [0.0; STAT_LEN];
        let mut ke = 0.0;
        let mut maxsp: f64 = 0.0;
        for i in 0..self.n {
            let v2 = self.vx[i] * self.vx[i] + self.vy[i] * self.vy[i];
            ke += 0.5 * self.mass[i] * v2;
            maxsp = maxsp.max(v2.sqrt());
        }
        if level >= 1 {
        let mut eel = 0.0;
        let mut ehard = 0.0;
        let mut nbk = 0u64;
        for b in 0..self.bi.len() {
            if self.bbroken[b] != 0 {
                nbk += 1;
                continue;
            }
            let i = self.bi[b] as usize;
            let j = self.bj[b] as usize;
            let dx = self.x[j] - self.x[i];
            let dy = self.y[j] - self.y[i];
            let de = (dx * dx + dy * dy).sqrt() - self.bl[b];
            eel += 0.5 * self.bk[b] * de * de;
            if self.plasticity_model == 1 {
                let m = self.mats[self.bm[b] as usize];
                ehard += 0.5 * self.bk[b] * self.bl0[b] * self.bl0[b] * m.hr * self.bep[b] * self.bep[b];
            }
        }
        let ect = self.contact(true);
        self.n_broken = nbk;
        self.d_eel = eel;
        self.d_ehard = ehard;
        self.d_ect = ect;
        self.d_energy_step = self.steps as i64;
        self.d_energy_time = self.time;
        }
        let eel = self.d_eel;
        let ehard = self.d_ehard;
        let ect = self.d_ect;
        let total = ke + eel + ehard + self.e_pl + self.e_fr + ect + self.e_damp;
        let (mut px, mut py) = (0.0, 0.0);
        for i in 0..self.n {
            px += self.mass[i] * self.vx[i];
            py += self.mass[i] * self.vy[i];
        }
        let (mut sd, mut md) = (0.0f64, 0.0f64);
        for i in 0..self.n_plate {
            let d = ((self.x[i] - self.x0[i]).powi(2) + (self.y[i] - self.y0[i]).powi(2)).sqrt();
            sd += d;
            md = md.max(d);
        }
        // projectile observables
        let (mut pm, mut pvx, mut pvy, mut behind, mut dmax) = (0.0, 0.0, 0.0, 0.0, 0.0f64);
        let mut ymin_n = f64::MAX;
        for i in self.n_plate..self.n {
            pm += self.mass[i];
            pvx += self.mass[i] * self.vx[i];
            pvy += self.mass[i] * self.vy[i];
            let nn = self.x[i] * self.nrm[0] + self.y[i] * self.nrm[1];
            if nn < -self.plate_t * 0.5 {
                behind += self.mass[i];
            }
            ymin_n = ymin_n.min(nn);
        }
        dmax = dmax.max(self.plate_t * 0.5 - ymin_n);
        if level >= 2 {
        let (root, size) = self.components();
        let mut plate_main = u32::MAX;
        let mut best = 0u32;
        for i in 0..self.n_plate {
            if self.fixed[i] != 0 {
                plate_main = root[i];
                break;
            }
        }
        for i in 0..self.n_plate {
            let r = root[i];
            if size[r as usize] > best {
                best = size[r as usize];
                if plate_main == u32::MAX {
                    plate_main = r;
                }
            }
        }
        let mut proj_main = 0u32;
        let mut bestp = 0u32;
        for i in self.n_plate..self.n {
            let r = root[i];
            if size[r as usize] > bestp {
                bestp = size[r as usize];
                proj_main = r;
            }
        }
        let mut fr_count = 0u64;
        let mut fr_particles = 0u64;
        for i in 0..self.n {
            if root[i] as usize == i && root[i] != plate_main && root[i] != proj_main {
                fr_count += 1;
                fr_particles += size[i] as u64;
            }
        }
        self.d_fc = fr_count;
        self.d_fp = fr_particles;
        self.d_frag_step = self.steps as i64;
        self.d_frag_time = self.time;
        }
        let (fr_count, fr_particles) = (self.d_fc, self.d_fp);
        let mpl: f64 = (0..self.n_plate).map(|i| self.mass[i]).sum();
        s[0] = self.time;
        s[1] = self.steps as f64;
        s[2] = self.n as f64;
        s[3] = self.h;
        s[4] = self.dz;
        s[5] = self.dt;
        s[6] = ke;
        s[7] = eel;
        s[8] = self.e_pl;
        s[9] = self.e_fr;
        s[10] = ect;
        s[11] = 0.0; // external work: clamped particles never move => 0 by construction
        s[12] = total;
        s[13] = self.ke0;
        s[14] = total - self.ke0;
        s[15] = if self.ke0 > 0.0 { (total - self.ke0) / self.ke0 } else { 0.0 };
        s[16] = self.bi.len() as f64;
        s[17] = self.n_broken as f64;
        s[18] = sd / self.n_plate as f64;
        s[19] = md;
        s[20] = fr_count as f64;
        s[21] = fr_particles as f64;
        s[22] = pvx / pm;
        s[23] = pvy / pm;
        s[24] = behind / pm;
        s[25] = dmax;
        s[26] = pm;
        s[27] = mpl;
        s[28] = maxsp;
        s[29] = self.n_plate as f64;
        s[30] = (self.n - self.n_plate) as f64;
        s[31] = if self.fired { 1.0 } else { 0.0 };
        s[32] = self.e_damp;
        s[33] = px;
        s[34] = py;
        s[35] = ehard;
        s
    }

    fn active_damping_power(&self) -> f64 {
        let mut power = 0.0;
        for ar in 0..self.n_act {
            let b = self.act[ar] as usize;
            if self.bbroken[b] != 0 { continue; }
            let i = self.bi[b] as usize;
            let j = self.bj[b] as usize;
            let dx = self.x[j] - self.x[i];
            let dy = self.y[j] - self.y[i];
            let r = (dx * dx + dy * dy).sqrt().max(1e-12);
            let rel_n = (dx * (self.vx[j] - self.vx[i]) + dy * (self.vy[j] - self.vy[i])) / (r + 1e-12);
            let rate = self.mats[self.bm[b] as usize].rate;
            power += rate * r * rel_n * rel_n;
        }
        power
    }

    /// positions every call; material is static and damage is maintained incrementally (see dmg_gen); speed only when asked
    pub fn fill_render_opt(&mut self, need_speed: bool) {
        for i in 0..self.n {
            self.r_pos[2 * i] = self.x[i] as f32;
            self.r_pos[2 * i + 1] = self.y[i] as f32;
        }
        if need_speed {
            for i in 0..self.n {
                self.r_spd[i] = (self.vx[i] * self.vx[i] + self.vy[i] * self.vy[i]).sqrt() as f32;
            }
        }
    }

    pub fn fill_render(&mut self) { self.fill_render_opt(true); }

    /// deterministic state hash (FNV-1a over raw bits) used by reset tests
    pub fn hash(&self) -> u64 {
        let mut hh: u64 = 0xcbf29ce484222325;
        let mut mix = |v: u64| {
            hh ^= v;
            hh = hh.wrapping_mul(0x100000001b3);
        };
        for i in 0..self.n {
            mix(self.x[i].to_bits());
            mix(self.y[i].to_bits());
            mix(self.vx[i].to_bits());
            mix(self.vy[i].to_bits());
            mix(self.mat[i] as u64);
        }
        for b in 0..self.bi.len() {
            mix(self.bbroken[b] as u64);
            mix(self.bl[b].to_bits());
            mix(self.bep[b].to_bits());
        }
        mix(self.e_pl.to_bits());
        mix(self.e_fr.to_bits());
        mix(self.e_damp.to_bits());
        hh
    }
}
