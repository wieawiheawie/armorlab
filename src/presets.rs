//! Numeric presets mirrored from presets/presets.json (checked by tests/presets.test.js).
use crate::sim::*;

pub struct Target { pub id: &'static str, pub t_mm: f64, pub slope_deg: f64, pub face_mm: f64, pub pairing: &'static str }
pub struct Ammo { pub id: &'static str, pub gun: &'static str, pub mass_kg: f64, pub muzzle_mps: f64 }

pub const TARGETS: [Target; 3] = [
    Target { id: "TIGER1_UPPER_FRONT", t_mm: 100.0, slope_deg: 9.0, face_mm: 400.0, pairing: "TIGER1_PZGR39" },
    Target { id: "TIGER1_NOSE_ALT", t_mm: 100.0, slope_deg: 25.0, face_mm: 400.0, pairing: "TIGER1_PZGR39" },
    Target { id: "TIGER2_UPPER_GLACIS", t_mm: 150.0, slope_deg: 50.0, face_mm: 500.0, pairing: "TIGER2_PZGR3943" },
];
pub const AMMO: [Ammo; 2] = [
    Ammo { id: "TIGER1_PZGR39", gun: "8.8 cm KwK 36 L/56", mass_kg: 10.2, muzzle_mps: 773.0 },
    Ammo { id: "TIGER2_PZGR3943", gun: "8.8 cm KwK 43 L/71", mass_kg: 10.16, muzzle_mps: 1000.0 },
];

pub fn los_mm(t_mm: f64, slope_deg: f64) -> f64 { t_mm / slope_deg.to_radians().cos() }

pub fn config(target: usize, ammo: usize, n: f64, support: f64) -> [f64; CFG_LEN] {
    let t = &TARGETS[target];
    let a = &AMMO[ammo];
    let mut c = [0.0; CFG_LEN];
    c[C_N] = n; c[C_T] = t.t_mm * 1e-3; c[C_SLOPE] = t.slope_deg; c[C_FACE] = t.face_mm * 1e-3;
    c[C_CAL] = 0.088; c[C_PLEN] = 0.250; c[C_NOSE] = 0.090; c[C_PMASS] = a.mass_kg; c[C_V] = a.muzzle_mps;
    c[C_SUPPORT] = support;
    c[C_PL_RHO] = 7850.0; c[C_PL_E] = 200e9; c[C_PL_SY] = 1000e6; c[C_PL_HR] = 0.02; c[C_PL_EC] = 0.08;
    c[C_PR_RHO] = 7850.0; c[C_PR_E] = 200e9; c[C_PR_SY] = 2000e6; c[C_PR_HR] = 0.02; c[C_PR_EC] = 0.04;
    c[C_KC] = 1.0; c[C_DTF] = 0.25; c[C_CRUSH] = -0.5;
    c
}
