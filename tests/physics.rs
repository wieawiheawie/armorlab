use armorlab_core::{presets::*, sim::*};

fn isolated_impact(dtf: f64) -> (Sim, usize, usize, f64, f64) {
    let mut cfg = config(0, 0, 3000.0, 0.0);
    cfg[22] = dtf;
    let mut s = Sim::build(&cfg);
    s.bbroken.fill(1);
    s.fixed.fill(1);
    let target = 0;
    let projectile = s.n_plate;
    s.fixed[target] = 0;
    s.fixed[projectile] = 0;
    s.x[target] = 10.0;
    s.y[target] = 10.0;
    s.x[projectile] = 10.0 + 2.0 * s.h;
    s.y[projectile] = 10.0;
    s.vx[target] = 0.0;
    s.vy[target] = 0.0;
    s.vx[projectile] = -300.0;
    s.vy[projectile] = 0.0;
    s.compute_forces();
    let momentum0 = s.mass[target] * s.vx[target] + s.mass[projectile] * s.vx[projectile];
    let energy0 = 0.5 * s.mass[projectile] * s.vx[projectile].powi(2);
    (s, target, projectile, momentum0, energy0)
}

fn single_plastic_bond(model: f64, dtf: f64) -> (Sim, usize, usize, usize, f64) {
    let mut cfg = config(0, 0, 3000.0, 0.0);
    cfg[C_PLASTICITY] = model;
    cfg[C_DTF] = dtf;
    let mut s = Sim::build(&cfg);
    let b = (0..s.bi.len()).find(|&b| s.mat[s.bi[b] as usize] == 1).unwrap();
    s.bbroken.fill(1);
    s.fixed.fill(1);
    s.bbroken[b] = 0;
    let (i, j, l0) = (s.bi[b] as usize, s.bj[b] as usize, s.bl0[b]);
    s.fixed[i] = 0;
    s.fixed[j] = 0;
    s.x[i] = 10.0;
    s.y[i] = 10.0;
    s.y[j] = 10.0;
    s.mats[1].rate = 0.0;
    s.mats[1].ey = 0.01;
    s.mats[1].hr = 0.2;
    s.mats[1].ec = 10.0;
    s.crush = -10.0;
    (s, b, i, j, l0)
}

#[test] fn geo_los() {
    assert!((los_mm(100.0, 9.0) - 101.25).abs() < 0.01);
    assert!((los_mm(150.0, 50.0) - 233.36).abs() < 0.01);
}
#[test] fn pairing_and_mass() {
    assert_eq!(TARGETS[0].pairing, AMMO[0].id); assert_eq!(TARGETS[2].pairing, AMMO[1].id);
    assert_eq!(AMMO[0].mass_kg, 10.2); assert_eq!(AMMO[0].muzzle_mps, 773.0);
    assert_eq!(AMMO[1].mass_kg, 10.16); assert_eq!(AMMO[1].muzzle_mps, 1000.0);
    assert_eq!(AMMO[2].id, "TIGER2_PZGR4043"); assert_eq!(AMMO[2].mass_kg, 7.3); assert_eq!(AMMO[2].muzzle_mps, 1130.0);
    assert_eq!(AMMO[0].nose_profile, 0.0);
    assert_eq!(AMMO[1].nose_profile, 0.0);
    assert_eq!(AMMO[2].nose_profile, 1.0);
}
#[test] fn projectile_geometry_profile_changes_solver_particle_envelope() {
    let rounded_cfg = config(0, 0, 2500.0, 1.0);
    let mut pointed_cfg = rounded_cfg;
    pointed_cfg[C_PROJECTILE_NOSE_PROFILE] = 1.0;
    pointed_cfg[C_PROJECTILE_BODY_TAPER] = 0.2;
    let rounded = Sim::build(&rounded_cfg);
    let pointed = Sim::build(&pointed_cfg);
    let round_count = rounded.n - rounded.n_plate;
    let pointed_count = pointed.n - pointed.n_plate;
    assert_ne!(round_count, pointed_count, "nose and taper alter sampled body geometry");
    let diameter = rounded_cfg[C_CAL];
    let max_radius = (rounded.n_plate..rounded.n).map(|i| rounded.y[i].abs()).fold(0.0, f64::max);
    assert!(max_radius <= diameter * 0.5 + rounded.h, "sampled shape stays within configured calibre");
    assert_eq!(rounded_cfg.len(), CFG_LEN);
}
#[test] fn apcr_core_and_carrier_are_solver_components_with_conservative_mass_and_momentum() {
    let cfg = config(2, 2, 3000.0, 1.0);
    let mut s = Sim::build(&cfg);
    assert_eq!(cfg[C_PROJECTILE_COMPONENT_MODE], 1.0);
    let core_count = (s.n_plate..s.n).filter(|&i| s.mat[i] == 2).count();
    let carrier_count = (s.n_plate..s.n).filter(|&i| s.mat[i] == 1).count();
    assert!(core_count > 0 && carrier_count > 0);
    assert!(s.bm.iter().any(|&m| m == 3), "core/carrier interface bonds participate in the solver");
    let total_mass: f64 = (s.n_plate..s.n).map(|i| s.mass[i]).sum();
    let core_mass: f64 = (s.n_plate..s.n).filter(|&i| s.mat[i] == 2).map(|i| s.mass[i]).sum();
    let carrier_mass: f64 = (s.n_plate..s.n).filter(|&i| s.mat[i] == 1).map(|i| s.mass[i]).sum();
    assert!((total_mass - AMMO[2].mass_kg).abs() < 1e-9 * AMMO[2].mass_kg);
    assert!((core_mass + carrier_mass - total_mass).abs() < 1e-12 * total_mass);
    assert!(core_mass > 0.0 && carrier_mass > 0.0);
    s.fire();
    let momentum: f64 = (s.n_plate..s.n).map(|i| s.mass[i] * s.vx[i]).sum();
    let expected_momentum = AMMO[2].mass_kg * AMMO[2].muzzle_mps;
    let expected_energy = 0.5 * AMMO[2].mass_kg * AMMO[2].muzzle_mps.powi(2);
    assert!((momentum - expected_momentum).abs() < 1e-9 * expected_momentum);
    assert!((s.ke0 - expected_energy).abs() < 1e-9 * expected_energy);
}
#[test] fn apcr_interface_stiffness_and_failure_change_solver_state() {
    let a = config(2, 2, 3000.0, 1.0);
    let mut b = a;
    b[C_INTERFACE_E] *= 2.0;
    let mut soft = Sim::build(&a);
    let mut stiff = Sim::build(&b);
    let bond = soft.bm.iter().position(|&m| m == 3).unwrap();
    let (i, j, l0) = (soft.bi[bond] as usize, soft.bj[bond] as usize, soft.bl0[bond]);
    assert_eq!(stiff.bm[bond], 3);
    assert!((stiff.bk[bond] / soft.bk[bond] - 2.0).abs() < 1e-12);
    for sim in [&mut soft, &mut stiff] {
        sim.bbroken.fill(1);
        sim.bbroken[bond] = 0;
        sim.fixed.fill(1);
        sim.fixed[i] = 0; sim.fixed[j] = 0;
        sim.x[i] = 10.0; sim.y[i] = 10.0;
        sim.x[j] = 10.0 + 1.01 * l0; sim.y[j] = 10.0;
        sim.mats[3].rate = 0.0; sim.mats[3].ey = 10.0; sim.mats[3].ec = 10.0; sim.crush = -10.0;
        sim.compute_forces();
    }
    assert!((stiff.fx[i] / soft.fx[i] - 2.0).abs() < 1e-9);
    soft.mats[3].ec = 0.02;
    soft.x[j] = 10.0 + 1.03 * l0;
    soft.compute_forces();
    assert_eq!(soft.bbroken[bond], 1, "interface tensile failure separates the core and carrier");
}
#[test] fn projectile_material_parameters_remain_distinct_per_round() {
    let a = config(0, 0, 3000.0, 0.0);
    let b = config(0, 1, 3000.0, 0.0);
    assert_eq!(a[C_PR_RHO], b[C_PR_RHO]);
    // Pzgr.39 and Pzgr.39/43 share one body material estimate (evidence: identical body, wider driving band only);
    // the rounds differ by mass, muzzle speed and gun pairing. The APCR round is a different construction.
    assert_eq!(a[C_PR_E], b[C_PR_E]);
    assert_eq!(a[C_PR_SY], b[C_PR_SY]);
    assert_eq!(a[C_PR_HR], b[C_PR_HR]);
    assert_eq!(a[C_PR_EC], b[C_PR_EC]);
    assert_ne!(a[C_PMASS], b[C_PMASS]);
    assert_ne!(a[C_V], b[C_V]);
    let c = config(2, 2, 3000.0, 0.0);
    assert_eq!(a[C_PROJECTILE_COMPONENT_MODE], 0.0);
    assert_eq!(c[C_PROJECTILE_COMPONENT_MODE], 1.0);
    assert_ne!(c[C_CORE_RHO], c[C_PR_RHO]);
    assert_eq!(a[C_PR_RHO], AMMO[0].proj_rho);
    assert_eq!(a[C_PR_E], AMMO[0].proj_e);
    assert_eq!(a[C_PR_SY], AMMO[0].proj_sy);
    assert_eq!(a[C_PR_HR], AMMO[0].proj_hr);
    assert_eq!(a[C_PR_EC], AMMO[0].proj_ec);
    assert_eq!(b[C_PR_RHO], AMMO[1].proj_rho);
    assert_eq!(b[C_PR_E], AMMO[1].proj_e);
    assert_eq!(b[C_PR_SY], AMMO[1].proj_sy);
    assert_eq!(b[C_PR_HR], AMMO[1].proj_hr);
    assert_eq!(b[C_PR_EC], AMMO[1].proj_ec);
}
#[test] fn rotated_thickness_and_projectile_mass() {
    for ti in 0..3 {
        let s = Sim::build(&config(ti, if ti == 2 { 1 } else { 0 }, 6000.0, 0.0));
        let (mut lo, mut hi) = (f64::MAX, f64::MIN);
        for i in 0..s.n_plate { let p = s.x[i] * s.nrm[0] + s.y[i] * s.nrm[1]; lo = lo.min(p); hi = hi.max(p); }
        assert!((hi - lo + s.h - TARGETS[ti].t_mm * 1e-3).abs() < 1e-9);
        let pm: f64 = (s.n_plate..s.n).map(|i| s.mass[i]).sum();
        let want = AMMO[if ti == 2 { 1 } else { 0 }].mass_kg;
        assert!((pm - want).abs() < 1e-9 * want);
    }
}
#[test] #[should_panic(expected = "support mode must be 0")]
fn invalid_support_mode_is_rejected() {
    let mut cfg = config(0, 0, 3000.0, 0.0);
    cfg[C_SUPPORT] = 3.0;
    let _ = Sim::build(&cfg);
}
#[test] #[should_panic(expected = "projectile nose profile must be 0")]
fn invalid_projectile_nose_profile_is_rejected() {
    let mut cfg = config(0, 0, 3000.0, 0.0);
    cfg[C_PROJECTILE_NOSE_PROFILE] = 3.0;
    let _ = Sim::build(&cfg);
}
#[test] #[should_panic(expected = "projectile body taper fraction")]
fn invalid_projectile_taper_is_rejected() {
    let mut cfg = config(0, 0, 3000.0, 0.0);
    cfg[C_PROJECTILE_BODY_TAPER] = f64::NAN;
    let _ = Sim::build(&cfg);
}
#[test] fn reset_is_deterministic() {
    let c = config(0, 0, 3000.0, 0.0);
    let a = Sim::build(&c).hash();
    let mut s = Sim::build(&c); s.fire(); s.run(300);
    assert_ne!(s.hash(), a);
    assert_eq!(Sim::build(&c).hash(), a);
}
#[test] fn free_motion_is_exact_at_coarse_and_fine_particle_spacing() {
    let mut spacings = Vec::new();
    for n in [2500.0, 9000.0] {
        let mut s = Sim::build(&config(0, 0, n, 1.0));
        s.bbroken.fill(1);
        s.fixed.fill(1);
        let i = s.n_plate;
        s.fixed[i] = 0;
        s.x[i] = 10.0;
        s.y[i] = 10.0;
        s.vx[i] = 123.5;
        s.vy[i] = -67.25;
        s.compute_forces();
        let (x0, y0, vx, vy) = (s.x[i], s.y[i], s.vx[i], s.vy[i]);
        s.run(250);
        assert!((s.x[i] - (x0 + vx * s.time)).abs() < 1e-10);
        assert!((s.y[i] - (y0 + vy * s.time)).abs() < 1e-10);
        assert_eq!(s.vx[i], vx);
        assert_eq!(s.vy[i], vy);
        spacings.push((s.h, s.x[i], s.y[i], s.time));
    }
    assert!(spacings[0].0 > spacings[1].0);
    for (h, x, y, time) in spacings {
        assert!((x - (10.0 + 123.5 * time)).abs() < 1e-10, "h={h}");
        assert!((y - (10.0 - 67.25 * time)).abs() < 1e-10, "h={h}");
    }
}
#[test] fn isolated_undamped_bond_energy_converges_with_timestep() {
    let run = |dtf: f64| {
        let mut cfg = config(0, 0, 3000.0, 0.0);
        cfg[22] = dtf;
        let mut s = Sim::build(&cfg);
        let b = (0..s.bi.len()).find(|&b| s.mat[s.bi[b] as usize] == 1).unwrap();
        s.bbroken.fill(1);
        s.fixed.fill(1);
        s.bbroken[b] = 0;
        let (a, c, rest) = (s.bi[b] as usize, s.bj[b] as usize, s.bl0[b]);
        s.fixed[a] = 0;
        s.fixed[c] = 0;
        s.x[a] = 10.0;
        s.y[a] = 10.0;
        s.x[c] = 10.0 + 1.1 * rest;
        s.y[c] = 10.0;
        s.mats[1].rate = 0.0;
        s.mats[1].ec = 100.0;
        s.mats[1].ey = 100.0;
        s.crush = -100.0;
        s.compute_forces();
        let energy = |s: &Sim| {
            0.5 * s.mass[a] * (s.vx[a].powi(2) + s.vy[a].powi(2))
                + 0.5 * s.mass[c] * (s.vx[c].powi(2) + s.vy[c].powi(2))
                + 0.5 * s.bk[b] * ((s.x[c] - s.x[a]).hypot(s.y[c] - s.y[a]) - s.bl[b]).powi(2)
        };
        let e0 = energy(&s);
        s.run(500);
        assert_eq!(s.e_damp, 0.0);
        assert_eq!(s.e_pl, 0.0);
        assert_eq!(s.e_fr, 0.0);
        (energy(&s) - e0).abs() / e0
    };
    let coarse = run(0.25);
    let fine = run(0.125);
    assert!(coarse < 0.003, "coarse relative energy error {coarse}");
    assert!(fine < coarse / 4.0, "halving dt improves error: {coarse} -> {fine}");
}
#[test] fn isolated_projectile_target_contact_exchanges_momentum_and_tracks_energy() {
    let (mut s, target, projectile, momentum0, energy0) = isolated_impact(0.25);
    let n = (100e-6 / s.dt).ceil() as usize;
    let mut peak_contact = 0.0f64;
    for _ in 0..n {
        s.step();
        peak_contact = peak_contact.max(s.stats_level(1)[10]);
    }
    let st = s.stats_level(1);
    let energy1 = st[6] + st[10];
    assert!(peak_contact > 0.0, "contact potential should be present during overlap");
    assert!(((energy1 - energy0) / energy0).abs() < 0.01, "contact energy error {}", (energy1 - energy0) / energy0);
    assert_eq!(st[8], 0.0);
    assert_eq!(st[9], 0.0);
    assert_eq!(st[32], 0.0);
    assert!((st[33] - momentum0).abs() < 1e-12, "total momentum {} vs {momentum0}", st[33]);
    assert!(s.vx[target].abs() > 100.0 && (s.vx[projectile] + 300.0).abs() > 100.0);
}
#[test] fn isolated_contact_energy_error_decreases_when_timestep_is_halved() {
    let drift = |dtf: f64| {
        let (mut s, _, _, _, energy0) = isolated_impact(dtf);
        s.run((100e-6 / s.dt).ceil() as usize);
        let st = s.stats_level(1);
        ((st[6] + st[10] - energy0) / energy0).abs()
    };
    let coarse = drift(0.25);
    let fine = drift(0.125);
    assert!(coarse < 0.01, "coarse contact energy error {coarse}");
    assert!(fine < coarse / 5.0, "halving dt improves error: {coarse} -> {fine}");
}
#[test] fn identical_complete_runs_reproduce_state_and_energy_diagnostics() {
    let cfg = config(0, 0, 2500.0, 0.0);
    let mut a = Sim::build(&cfg);
    let mut b = Sim::build(&cfg);
    a.fire();
    b.fire();
    a.run(300);
    b.run(300);
    assert_eq!(a.hash(), b.hash());
    assert_eq!(a.stats_level(1), b.stats_level(1));
}
#[test] fn rest_updates_and_bond_deletion_report_spring_energy_changes_separately() {
    let single_bond = || {
        let mut cfg = config(0, 0, 3000.0, 0.0);
        cfg[C_PLASTICITY] = 0.0;
        let mut s = Sim::build(&cfg);
        let b = (0..s.bi.len()).find(|&b| s.mat[s.bi[b] as usize] == 1).unwrap();
        s.bbroken.fill(1);
        s.fixed.fill(1);
        s.bbroken[b] = 0;
        let (a, c, rest) = (s.bi[b] as usize, s.bj[b] as usize, s.bl0[b]);
        s.fixed[a] = 0;
        s.fixed[c] = 0;
        s.x[a] = 10.0;
        s.y[a] = 10.0;
        s.y[c] = 10.0;
        s.mats[1].rate = 0.0;
        s.mats[1].hr = 0.0;
        s.mats[1].ey = 0.01;
        s.crush = -100.0;
        (s, b, a, c, rest)
    };
    let (mut plastic, b, _, c, rest) = single_bond();
    plastic.mats[1].ec = 2.0;
    plastic.x[c] = 10.0 + 1.05 * rest;
    plastic.compute_forces();
    let old_stretch = 0.05 * rest;
    let yield_stretch = 0.01 * rest;
    // dissipation = work of the capped force over the plastic extension (not the elastic-trial energy drop)
    let overshoot = old_stretch - yield_stretch;
    let expected_plastic_drop = plastic.bk[b] * yield_stretch * overshoot;
    assert!((plastic.e_pl - expected_plastic_drop).abs() < 1e-10 * expected_plastic_drop);
    let ps = plastic.stats_level(1);
    let undelivered = 0.5 * plastic.bk[b] * overshoot.powi(2); // trial energy of the overshoot, never delivered as force
    assert!((ps[7] + ps[8] - (0.5 * plastic.bk[b] * old_stretch.powi(2) - undelivered)).abs() < 1e-10 * expected_plastic_drop);

    let (mut fracture, b, _, c, rest) = single_bond();
    fracture.mats[1].ec = 0.05;
    fracture.x[c] = 10.0 + 1.2 * rest;
    fracture.compute_forces();
    // the bond is projected onto its yield surface before deletion: only the capped stored energy is assigned to fracture
    let expected_fracture_energy = 0.5 * fracture.bk[b] * (0.01 * rest).powi(2);
    assert!((fracture.e_fr - expected_fracture_energy).abs() < 1e-10 * expected_fracture_energy);
    assert!((fracture.e_pl - fracture.bk[b] * (0.01 * rest) * (0.19 * rest)).abs() < 1e-10 * fracture.e_pl);
    assert_eq!(fracture.bbroken[b], 1);
    assert!(fracture.stats_level(1)[7].abs() < 1e-12);
}
#[test] fn isotropic_return_map_tracks_elastic_yield_unload_and_reload_energy() {
    let (mut s, b, i, j, l0) = single_plastic_bond(1.0, 0.25);
    s.x[j] = s.x[i] + 1.005 * l0;
    s.compute_forces();
    assert!((s.bl[b] - l0).abs() < 1e-14);
    assert_eq!(s.bep[b], 0.0);
    assert_eq!(s.e_pl, 0.0);
    let elastic_energy = 0.5 * s.bk[b] * (0.005 * l0).powi(2);
    assert!((s.stats_level(1)[7] - elastic_energy).abs() < 1e-10 * elastic_energy);

    s.x[j] = s.x[i] + 1.01 * l0;
    s.compute_forces();
    assert!((s.bl[b] - l0).abs() < 1e-14, "exact yield stays elastic");
    assert!(s.e_pl < 1e-9, "only roundoff-scale dissipation at exact yield: {}", s.e_pl);
    let pre_yield_energy = 0.5 * s.bk[b] * (0.016 * l0).powi(2);
    s.x[j] = s.x[i] + 1.016 * l0;
    s.compute_forces();
    let gamma = (0.016 - 0.01) / 1.2;
    let alpha = s.bep[b];
    assert!((alpha - gamma).abs() < 1e-12);
    assert!(((s.bl[b] - l0) / l0 - gamma).abs() < 1e-12);
    assert!(((s.x[j] - s.x[i] - s.bl[b]) / l0 - (0.01 + 0.2 * gamma)).abs() < 1e-12);
    assert!(s.e_pl >= 0.0);
    let after_yield = s.stats_level(1);
    let undelivered = 0.5 * s.bk[b] * l0 * l0 * gamma * gamma; // elastic-trial energy of the step overshoot
    assert!((after_yield[7] + after_yield[35] + after_yield[8] - (pre_yield_energy - undelivered)).abs() < 1e-9);
    let expected_dissipation = s.bk[b] * l0 * l0 * (0.01 * gamma + 0.5 * 0.2 * gamma * gamma);
    assert!((s.e_pl - expected_dissipation).abs() < 1e-9);
    let (rest, alpha, dissipation) = (s.bl[b], s.bep[b], s.e_pl);

    s.x[j] = s.x[i] + l0;
    s.compute_forces();
    assert_eq!(s.bl[b], rest);
    assert_eq!(s.bep[b], alpha);
    assert_eq!(s.e_pl, dissipation);
    let unload_energy = 0.5 * s.bk[b] * (gamma * l0).powi(2);
    assert!((s.stats_level(1)[7] - unload_energy).abs() < 1e-9 * unload_energy);

    s.x[j] = s.x[i] + 1.02 * l0;
    s.compute_forces();
    assert!(s.bep[b] > alpha);
    assert!(s.e_pl > dissipation);
    assert!(((s.x[j] - s.x[i] - s.bl[b]) / l0 - (0.01 + 0.2 * s.bep[b])).abs() < 1e-12);
}
#[test] fn zero_strain_reversal_and_broken_bond_are_well_defined() {
    let (mut s, b, i, j, l0) = single_plastic_bond(1.0, 0.25);
    s.x[j] = s.x[i] + l0;
    s.compute_forces();
    assert_eq!(s.bl[b], l0);
    assert_eq!(s.bep[b], 0.0);
    assert_eq!(s.e_pl, 0.0);
    s.x[j] = s.x[i] + 1.016 * l0;
    s.compute_forces();
    let (rest_t, alpha_t, diss_t) = (s.bl[b], s.bep[b], s.e_pl);
    s.x[j] = s.x[i] + 0.97 * l0;
    s.compute_forces();
    assert!(s.bl[b] < rest_t, "reverse load reduces signed plastic extension");
    assert!(s.bep[b] > alpha_t, "equivalent plastic strain is accumulated");
    assert!(s.e_pl >= diss_t && s.e_pl >= 0.0);
    let state = (s.bl[b], s.bep[b], s.e_pl);
    let stored = s.stats_level(1);
    s.crush = -0.02;
    s.compute_forces();
    assert_eq!(s.bbroken[b], 1, "compressive cutoff fractures the bond");
    assert!((s.e_fr - stored[7] - stored[35]).abs() < 1e-9);
    assert_eq!(s.e_pl, state.2);
    s.x[j] = s.x[i] + 1.2 * l0;
    s.compute_forces();
    assert_eq!((s.bl[b], s.bep[b], s.e_pl), state);
    let st = s.stats_level(1);
    assert_eq!(st[7], 0.0);
    assert_eq!(st[35], 0.0);
    assert!(st[9] > 0.0);
}
#[test] fn dynamic_plastic_bond_energy_error_decreases_when_timestep_is_halved() {
    let run = |dtf: f64| {
        let (mut s, b, i, j, l0) = single_plastic_bond(1.0, dtf);
        s.x[j] = s.x[i] + l0;
        s.vx[i] = -100.0;
        s.vx[j] = 100.0;
        s.compute_forces();
        let e0 = s.stats_level(1)[12];
        s.run((100e-6 / s.dt).round() as usize);
        assert_eq!(s.bbroken[b], 0, "isolated bond remains intact");
        let st = s.stats_level(1);
        assert!(st[8] > 0.0 && st[35] > 0.0);
        (st[12] - e0).abs() / e0
    };
    let coarse = run(0.25);
    let fine = run(0.125);
    assert!(coarse < 0.18, "default-step plastic-system energy error {coarse}");
    assert!(fine < 0.6 * coarse, "halving dt improves energy error: {coarse} -> {fine}");
}
#[test]
#[should_panic(expected = "hardening ratio >= 0")]
fn isotropic_hardening_rejects_negative_hardening_ratio() {
    let mut cfg = config(0, 0, 2500.0, 0.0);
    cfg[C_PL_HR] = -0.01;
    let _ = Sim::build(&cfg);
}
#[test] fn pairwise_forces_balance() {
    let mut s = Sim::build(&config(0, 0, 3000.0, 1.0)); s.fire(); s.run(300);
    let (mut sx, mut sy) = (0.0, 0.0);
    for i in 0..s.n { sx += s.fx[i]; sy += s.fy[i]; }
    assert!(sx.abs() < 1e-6 * s.kc && sy.abs() < 1e-6 * s.kc);
}
#[test] fn momentum_free_support() {
    let mut s = Sim::build(&config(0, 0, 3000.0, 1.0)); s.fire();
    let p0: f64 = (0..s.n).map(|i| s.mass[i] * s.vx[i]).sum();
    s.run(1500);
    let p1: f64 = (0..s.n).map(|i| s.mass[i] * s.vx[i]).sum();
    assert!(((p1 - p0) / p0).abs() < 1e-9);
}
#[test] fn bonds_irreversible_and_energy_accounting_residual_is_bounded() {
    let mut s = Sim::build(&config(0, 0, 3000.0, 0.0)); s.fire(); s.run(1500);
    let broken: Vec<usize> = (0..s.bi.len()).filter(|&b| s.bbroken[b] != 0).collect();
    s.run(500);
    assert!(broken.iter().all(|&b| s.bbroken[b] != 0));
    let st = s.stats();
    assert!(st[15].is_finite() && st[15].abs() < 0.15, "accounting residual {}", st[15]);
}

// ---- armour stability / accounting regressions (mirror of tests/armor_validation.test.js) ----
fn rel(a: f64, b: f64) -> f64 { (a - b).abs() / b.abs().max(1e-300) }

#[test] fn every_target_starts_undamaged_at_rest_and_stress_free() {
    for t in 0..TARGETS.len() { for a in 0..AMMO.len() { for support in [0.0, 1.0] {
        let s = Sim::build(&config(t, a, 2500.0, support));
        assert_eq!(s.n_broken, 0);
        assert!(s.bbroken.iter().all(|&b| b == 0) && s.bep.iter().all(|&v| v == 0.0));
        assert!(s.vx.iter().chain(s.vy.iter()).all(|&v| v == 0.0));
        let fmax = (0..s.n).map(|i| s.fx[i].hypot(s.fy[i])).fold(0.0, f64::max);
        assert!(fmax < 1e-6, "initial net force {fmax}");
        assert!((0..s.bi.len()).all(|b| s.bl[b] == s.bl0[b]));
    }}}
}
#[test] fn unfired_armour_stays_undamaged() {
    let mut s = Sim::build(&config(2, 1, 2500.0, 0.0));
    s.run(2000);
    let o = s.stats();
    assert_eq!(o[17], 0.0); assert!(o[28] < 1e-9);
}
#[test] fn projectile_component_masses_sum_to_configured_mass() {
    for (t, a) in [(0, 0), (2, 1), (2, 2)] {
        let mut s = Sim::build(&config(t, a, 3000.0, 0.0));
        let o = s.stats_level(0);
        assert!(rel(o[26], AMMO[a].mass_kg) < 1e-12);
        assert!(rel(o[38] + o[39], AMMO[a].mass_kg) < 1e-12);
        if AMMO[a].core_diameter_mm > 0.0 { assert!(o[39] > 0.0 && o[38] > 0.0); } else { assert_eq!(o[39], 0.0); }
    }
}
#[test] fn initial_momentum_and_energy_match_configuration() {
    for (t, a) in [(0, 0), (2, 1), (2, 2)] {
        let mut s = Sim::build(&config(t, a, 3000.0, 0.0));
        s.fire();
        let o = s.stats_level(0);
        let (m, v) = (AMMO[a].mass_kg, AMMO[a].muzzle_mps);
        assert!(rel(o[33], m * v) < 1e-12 && o[34].abs() < 1e-9);
        assert!(rel(o[13], 0.5 * m * v * v) < 1e-12);
        assert!(rel(o[40] + o[41], o[13]) < 1e-12);
    }
}
#[test] fn momentum_change_equals_support_impulse_and_energy_residual_is_small_and_converging() {
    for (t, a) in [(0, 0), (2, 1), (2, 2)] {
        let mut resid = [0.0; 2];
        for (k, dtf) in [0.25, 0.125].into_iter().enumerate() {
            let mut cfg = config(t, a, 2500.0, 0.0);
            cfg[C_DTF] = dtf;
            let mut s = Sim::build(&cfg);
            s.fire();
            let p0 = s.stats_level(0)[33];
            s.run((100e-6 / s.dt).round() as usize);
            let o = s.stats();
            assert!(((o[33] - p0 - o[36]) / p0).abs() < 2e-3, "x momentum/impulse balance");
            assert!(((o[34] - o[37]) / p0).abs() < 2e-3, "y momentum/impulse balance");
            assert!(o[36].abs() > 0.0);
            resid[k] = o[15].abs();
        }
        assert!(resid[0] < 0.01, "residual {}", resid[0]);
        assert!(resid[1] < 0.7 * resid[0], "residual must shrink with dt: {:?}", resid);
    }
}
#[test] fn free_support_conserves_momentum_exactly() {
    let mut s = Sim::build(&config(0, 0, 2500.0, 1.0));
    s.fire();
    let p0 = s.stats_level(0)[33];
    s.run(400);
    let o = s.stats_level(0);
    assert_eq!(o[36], 0.0);
    assert!(rel(o[33], p0) < 1e-9);
}

#[test] fn boundary_mode_diagnostics_reflect_solver_constraints_and_reactions() {
    let mut rigid = Sim::build(&config(2, 1, 3000.0, 0.0));
    let mut free = Sim::build(&config(2, 1, 3000.0, 1.0));
    assert_eq!(rigid.support_mode, 0);
    assert_eq!(free.support_mode, 1);
    assert_eq!(rigid.dt, free.dt, "inactive foundation coefficients must not constrain rigid/free timesteps");
    let r = rigid.stats_level(0);
    let f = free.stats_level(0);
    assert!(r[45] > 0.0 && r[46] == 2.0 * r[45]);
    assert_eq!(f[45], 0.0);
    assert_eq!(f[46], 0.0);
    assert_eq!(f[47], 0.0);
    assert_eq!(f[48], 0.0);
    assert_eq!(r[50], 0.0, "stationary fixed fixture does no mechanical work");
    assert_eq!(r[55], 0.0);
    assert_eq!(f[55], 0.0);
    assert_eq!(f[56], 0.0);
    let compliant = config(2, 1, 3000.0, 2.0);
    let mut c = Sim::build(&compliant);
    let cs = c.stats_level(0);
    assert_eq!(cs[55], compliant[C_SUPPORT_STIFFNESS]);
    assert_eq!(cs[56], compliant[C_SUPPORT_DAMPING]);
}

#[test] fn compliant_foundation_force_work_energy_and_impulse_are_accounted() {
    let mut cfg = config(2, 1, 2500.0, 2.0);
    cfg[C_SUPPORT_STIFFNESS] = 1.0e12;
    cfg[C_SUPPORT_DAMPING] = 1.0e8;
    let mut s = Sim::build(&cfg);
    assert_eq!(s.fixed.iter().filter(|&&v| v != 0).count(), 0);
    assert!(s.support_nodes.iter().filter(|&&v| v != 0).count() > 0);
    let mut changed = false;
    for i in 0..s.n_plate {
        if s.support_nodes[i] != 0 {
            s.x[i] += 1e-5;
            s.vx[i] = 0.01;
            changed = true;
            break;
        }
    }
    assert!(changed);
    s.compute_forces();
    let o = s.stats_level(1);
    assert_eq!(o[44], 2.0);
    assert_eq!(o[46], 0.0, "compliant support applies forces but constrains no DOFs");
    assert!(o[49] > 0.0);
    assert!(o[51] > 0.0, "spring energy is present");
    s.fire();
    s.run((100e-6 / s.dt).round() as usize);
    let final_stats = s.stats();
    assert!(final_stats[36].abs() + final_stats[37].abs() > 0.0);
    assert!(final_stats[50] < 0.0, "stationary foundation removes mechanical work from the plate");
    assert!(final_stats[51] >= 0.0 && final_stats[52] >= 0.0);
    assert!(final_stats[53].abs() < 2e-3 * AMMO[1].mass_kg * AMMO[1].muzzle_mps);
    assert!(final_stats[54].abs() < 2e-3 * AMMO[1].mass_kg * AMMO[1].muzzle_mps);
    assert!(final_stats[15].abs() < 0.02, "energy residual {}", final_stats[15]);
}
#[test] fn apcr_interface_bonds_exist_and_core_carrier_both_carry_energy() {
    let mut s = Sim::build(&config(2, 2, 3000.0, 0.0));
    s.fire();
    s.run((60e-6 / s.dt).round() as usize);
    let o = s.stats();
    assert!(o[40] > 0.0 && o[41] > 0.0);
    let iface = (0..s.bi.len()).filter(|&b| s.bm[b] == 3).count();
    let iface_broken = (0..s.bi.len()).filter(|&b| s.bm[b] == 3 && s.bbroken[b] != 0).count();
    assert!(iface > 0 && iface_broken > 0);
    assert_eq!(o[42] + o[43], o[20]);
}
