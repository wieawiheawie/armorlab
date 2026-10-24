// Rust integration tests (NOT executed in the authoring environment: no Rust toolchain was available there).
use armorlab_core::{presets::*, sim::*};

#[test] fn geo_los() {
    assert!((los_mm(100.0, 9.0) - 101.25).abs() < 0.01);
    assert!((los_mm(150.0, 50.0) - 233.36).abs() < 0.01);
}
#[test] fn pairing_and_mass() {
    assert_eq!(TARGETS[0].pairing, AMMO[0].id); assert_eq!(TARGETS[2].pairing, AMMO[1].id);
    assert_eq!(AMMO[0].mass_kg, 10.2); assert_eq!(AMMO[0].muzzle_mps, 773.0);
    assert_eq!(AMMO[1].mass_kg, 10.16); assert_eq!(AMMO[1].muzzle_mps, 1000.0);
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
#[test] fn reset_is_deterministic() {
    let c = config(0, 0, 3000.0, 0.0);
    let a = Sim::build(&c).hash();
    let mut s = Sim::build(&c); s.fire(); s.run(300);
    assert_ne!(s.hash(), a);
    assert_eq!(Sim::build(&c).hash(), a);
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
#[test] fn bonds_irreversible_and_energy_bounded() {
    let mut s = Sim::build(&config(0, 0, 3000.0, 0.0)); s.fire(); s.run(1500);
    let broken: Vec<usize> = (0..s.bi.len()).filter(|&b| s.bbroken[b] != 0).collect();
    s.run(500);
    assert!(broken.iter().all(|&b| s.bbroken[b] != 0));
    let st = s.stats();
    assert!(st[15].abs() < 0.05, "residual {}", st[15]);
}
