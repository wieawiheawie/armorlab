//! WASM C-ABI wrapper (no wasm-bindgen; zero dependencies). Single global simulation instance.
pub mod presets;
pub mod boundary;
pub mod sim;
use sim::*;

static mut SIM: *mut Sim = std::ptr::null_mut();
static mut STATS: [f64; STAT_LEN] = [0.0; STAT_LEN];
static mut CFG: [f64; CFG_LEN] = [0.0; CFG_LEN];

#[allow(static_mut_refs)]
fn sim() -> &'static mut Sim { unsafe { &mut *SIM } }

#[no_mangle] pub extern "C" fn al_cfg_len() -> u32 { CFG_LEN as u32 }
#[no_mangle] pub extern "C" fn al_stat_len() -> u32 { STAT_LEN as u32 }
/// pointer to a CFG_LEN f64 buffer JS fills before calling al_build
#[no_mangle] pub extern "C" fn al_cfg_ptr() -> *mut f64 { unsafe { std::ptr::addr_of_mut!(CFG) as *mut f64 } }

#[no_mangle] pub extern "C" fn al_build() -> u32 { al_build_mode(1) }
/// contact_mode 1 = Verlet neighbour list (default), 0 = grid rebuilt every call
#[no_mangle] pub extern "C" fn al_build_mode(contact_mode: u32) -> u32 {
    unsafe {
        if !SIM.is_null() { drop(Box::from_raw(SIM)); }
        let cfg: [f64; CFG_LEN] = *std::ptr::addr_of!(CFG);
        SIM = Box::into_raw(Box::new(Sim::build_with(&cfg, contact_mode as u8)));
        (*SIM).n as u32
    }
}
#[no_mangle] pub extern "C" fn al_fire() { sim().fire(); }
#[no_mangle] pub extern "C" fn al_step(n: u32) { sim().run(n as usize); }
#[no_mangle] pub extern "C" fn al_hash_lo() -> u32 { (sim().hash() & 0xffff_ffff) as u32 }
#[no_mangle] pub extern "C" fn al_hash_hi() -> u32 { (sim().hash() >> 32) as u32 }
#[no_mangle] pub extern "C" fn al_stats() -> *const f64 { al_stats_level(2) }
/// level 0 fast telemetry, 1 + energy ledger, 2 + fragment graph
#[no_mangle] pub extern "C" fn al_stats_level(level: u32) -> *const f64 {
    unsafe { let s = sim().stats_level(level as u8); STATS = s; std::ptr::addr_of!(STATS) as *const f64 }
}
/// [energy_step, frag_step, energy_time, frag_time, dmg_gen]
#[no_mangle] pub extern "C" fn al_diag_age() -> *const f64 {
    unsafe { let s = sim(); let mut o = [0.0; STAT_LEN]; o[0] = s.d_energy_step as f64; o[1] = s.d_frag_step as f64; o[2] = s.d_energy_time; o[3] = s.d_frag_time; o[4] = s.dmg_gen as f64; o[5] = s.vl_rebuilds as f64; o[6] = s.grid_expansions as f64; STATS = o; std::ptr::addr_of!(STATS) as *const f64 }
}
#[no_mangle] pub extern "C" fn al_render() { sim().fill_render(); }
#[no_mangle] pub extern "C" fn al_render_opt(need_speed: u32) { sim().fill_render_opt(need_speed != 0); }
#[no_mangle] pub extern "C" fn al_pos_ptr() -> *const f32 { sim().r_pos.as_ptr() }
#[no_mangle] pub extern "C" fn al_mat_ptr() -> *const f32 { sim().r_mat.as_ptr() }
#[no_mangle] pub extern "C" fn al_dmg_ptr() -> *const f32 { sim().r_dmg.as_ptr() }
#[no_mangle] pub extern "C" fn al_spd_ptr() -> *const f32 { sim().r_spd.as_ptr() }
/// writes [mat,x,y,vx,vy,damage,bonds_total,bonds_broken,fixed,mass] for particle i into the stats-sized scratch
#[no_mangle] pub extern "C" fn al_particle(i: u32) -> *const f64 {
    unsafe {
        let s = sim(); let i = i as usize;
        let mut o = [0.0; STAT_LEN];
        o[0] = s.mat[i] as f64; o[1] = s.x[i]; o[2] = s.y[i]; o[3] = s.vx[i]; o[4] = s.vy[i];
        o[5] = if s.nb_total[i] > 0 { s.nb_broken[i] as f64 / s.nb_total[i] as f64 } else { 1.0 };
        o[6] = s.nb_total[i] as f64; o[7] = s.nb_broken[i] as f64; o[8] = s.fixed[i] as f64; o[9] = s.mass[i];
        STATS = o; std::ptr::addr_of!(STATS) as *const f64
    }
}
