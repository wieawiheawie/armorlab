//! Numeric presets mirrored from presets/presets.json (checked by tests/presets.test.js).
use crate::sim::*;
use crate::boundary::{BoundaryDatabase, BoundaryType};

pub struct Target { pub id: &'static str, pub t_mm: f64, pub slope_deg: f64, pub face_mm: f64, pub pairing: &'static str }
pub struct Ammo {
    pub id: &'static str,
    pub gun: &'static str,
    pub mass_kg: f64,
    pub muzzle_mps: f64,
    pub proj_rho: f64,
    pub proj_e: f64,
    pub proj_sy: f64,
    pub proj_hr: f64,
    pub proj_ec: f64,
    pub calibre_mm: f64,
    pub length_mm: f64,
    pub nose_mm: f64,
    pub core_diameter_mm: f64,
    pub core_length_mm: f64,
    pub core_rho: f64,
    pub core_e: f64,
    pub core_sy: f64,
    pub core_hr: f64,
    pub core_ec: f64,
    pub interface_e: f64,
    pub interface_sy: f64,
    pub interface_hr: f64,
    pub interface_ec: f64,
    pub nose_profile: f64,
    pub body_taper_fraction: f64,
}

pub const TARGETS: [Target; 3] = [
    Target { id: "TIGER1_UPPER_FRONT", t_mm: 100.0, slope_deg: 9.0, face_mm: 400.0, pairing: "TIGER1_PZGR39" },
    Target { id: "TIGER1_NOSE_ALT", t_mm: 100.0, slope_deg: 25.0, face_mm: 400.0, pairing: "TIGER1_PZGR39" },
    Target { id: "TIGER2_UPPER_GLACIS", t_mm: 150.0, slope_deg: 50.0, face_mm: 500.0, pairing: "TIGER2_PZGR3943" },
];
pub const AMMO: [Ammo; 3] = [
    // Generic hardened-steel values are used as solver estimates only; exact shell-grade,
    // heat treatment, cap/body material split and filler geometry are not source-traced here.
    Ammo { id: "TIGER1_PZGR39", gun: "8.8 cm KwK 36 L/56", mass_kg: 10.2, muzzle_mps: 773.0, proj_rho: 7850.0, proj_e: 200e9, proj_sy: 1800e6, proj_hr: 0.02, proj_ec: 0.04, calibre_mm: 88.0, length_mm: 250.0, nose_mm: 90.0, core_diameter_mm: 0.0, core_length_mm: 0.0, core_rho: 0.0, core_e: 0.0, core_sy: 0.0, core_hr: 0.0, core_ec: 0.0, interface_e: 0.0, interface_sy: 0.0, interface_hr: 0.0, interface_ec: 0.0, nose_profile: 0.0, body_taper_fraction: 0.0 },
    Ammo { id: "TIGER2_PZGR3943", gun: "8.8 cm KwK 43 L/71", mass_kg: 10.16, muzzle_mps: 1000.0, proj_rho: 7850.0, proj_e: 200e9, proj_sy: 1800e6, proj_hr: 0.02, proj_ec: 0.04, calibre_mm: 88.0, length_mm: 250.0, nose_mm: 90.0, core_diameter_mm: 0.0, core_length_mm: 0.0, core_rho: 0.0, core_e: 0.0, core_sy: 0.0, core_hr: 0.0, core_ec: 0.0, interface_e: 0.0, interface_sy: 0.0, interface_hr: 0.0, interface_ec: 0.0, nose_profile: 0.0, body_taper_fraction: 0.0 },
    Ammo { id: "TIGER2_PZGR4043", gun: "8.8 cm KwK 43 L/71", mass_kg: 7.3, muzzle_mps: 1130.0, proj_rho: 7850.0, proj_e: 200e9, proj_sy: 1800e6, proj_hr: 0.02, proj_ec: 0.04, calibre_mm: 88.0, length_mm: 250.0, nose_mm: 55.0, core_diameter_mm: 45.0, core_length_mm: 160.0, core_rho: 15600.0, core_e: 550e9, core_sy: 2500e6, core_hr: 0.0, core_ec: 0.01, interface_e: 150e9, interface_sy: 700e6, interface_hr: 0.01, interface_ec: 0.02, nose_profile: 1.0, body_taper_fraction: 0.0 },
];

pub fn los_mm(t_mm: f64, slope_deg: f64) -> f64 { t_mm / slope_deg.to_radians().cos() }

pub fn config(target: usize, ammo: usize, n: f64, support: f64) -> [f64; CFG_LEN] {
    let t = &TARGETS[target];
    let a = &AMMO[ammo];
    assert!(support.is_finite() && (0.0..=2.0).contains(&support) && support.fract() == 0.0, "support mode must be an integer in [0, 2]");
    let mode = support as u8;
    let boundary_type = BoundaryType::from_solver_mode(mode).expect("supported boundary model");
    let database = BoundaryDatabase::embedded().expect("embedded boundary parameter CSV is valid");
    let boundary = database.resolve(t.id, boundary_type).expect("boundary model exists for preset target");
    let (solver_mode, stiffness, damping) = boundary.solver_parameters().expect("boundary model is implemented");
    let mut c = [0.0; CFG_LEN];
    c[C_N] = n; c[C_T] = t.t_mm * 1e-3; c[C_SLOPE] = t.slope_deg; c[C_FACE] = t.face_mm * 1e-3;
    c[C_CAL] = a.calibre_mm * 1e-3; c[C_PLEN] = a.length_mm * 1e-3; c[C_NOSE] = a.nose_mm * 1e-3; c[C_PMASS] = a.mass_kg; c[C_V] = a.muzzle_mps;
    c[C_SUPPORT] = solver_mode as f64;
    c[C_SUPPORT_STIFFNESS] = stiffness;
    c[C_SUPPORT_DAMPING] = damping;
    c[C_PROJECTILE_NOSE_PROFILE] = a.nose_profile;
    c[C_PROJECTILE_BODY_TAPER] = a.body_taper_fraction;
    c[C_PLASTICITY] = 1.0;
    c[C_PL_RHO] = 7850.0; c[C_PL_E] = 200e9; c[C_PL_SY] = 1000e6; c[C_PL_HR] = 0.02; c[C_PL_EC] = 0.08;
    c[C_PR_RHO] = a.proj_rho; c[C_PR_E] = a.proj_e; c[C_PR_SY] = a.proj_sy; c[C_PR_HR] = a.proj_hr; c[C_PR_EC] = a.proj_ec;
    c[C_KC] = 1.0; c[C_DTF] = 0.25; c[C_CRUSH] = -0.5;
    if a.core_diameter_mm > 0.0 {
        c[C_PROJECTILE_COMPONENT_MODE] = 1.0;
        c[C_CORE_DIAMETER] = a.core_diameter_mm * 1e-3;
        c[C_CORE_LENGTH] = a.core_length_mm * 1e-3;
        c[C_CORE_RHO] = a.core_rho; c[C_CORE_E] = a.core_e; c[C_CORE_SY] = a.core_sy;
        c[C_CORE_HR] = a.core_hr; c[C_CORE_EC] = a.core_ec;
        c[C_INTERFACE_E] = a.interface_e; c[C_INTERFACE_SY] = a.interface_sy;
        c[C_INTERFACE_HR] = a.interface_hr; c[C_INTERFACE_EC] = a.interface_ec;
    }
    c
}

#[cfg(test)]
mod boundary_config_tests {
    use super::*;

    #[test]
    fn preset_boundary_slots_are_resolved_from_the_embedded_boundary_table() {
        let database = BoundaryDatabase::embedded().unwrap();
        for target in &TARGETS {
            for (mode, kind) in [
                (0.0, BoundaryType::RigidFixture),
                (1.0, BoundaryType::Free),
                (2.0, BoundaryType::CompliantFoundation),
            ] {
                let record = database.resolve(target.id, kind).unwrap();
                let (solver_mode, stiffness, damping) = record.solver_parameters().unwrap();
                let config = config(TARGETS.iter().position(|candidate| candidate.id == target.id).unwrap(), 0, 2500.0, mode);
                assert_eq!(config[C_SUPPORT], solver_mode as f64);
                assert_eq!(config[C_SUPPORT_STIFFNESS], stiffness);
                assert_eq!(config[C_SUPPORT_DAMPING], damping);
            }
        }
    }
}
