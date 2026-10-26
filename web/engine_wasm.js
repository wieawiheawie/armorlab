/* Adapter exposing the Rust/WASM core through the same interface as engine_js.js (stats(level), fillRender(needSpeed), dmgGen, diagAge). */
(function (root) {
'use strict';
async function load(b64) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const { instance } = await WebAssembly.instantiate(bin, {});
  const w = instance.exports;
  class WSim {
    constructor(cfg) {
      const cfgLen = w.al_cfg_len();
      if (cfg.length !== cfgLen) throw new Error(`WASM config length ${cfgLen} does not match scenario length ${cfg.length}`);
      this.statLen = w.al_stat_len();
      { const p = w.al_cfg_ptr(); new Float64Array(w.memory.buffer, p, cfgLen).set(cfg); }
      this.n = w.al_build(); this.vImpact = cfg[8]; this.plateT = cfg[1]; this.fired = false;
      const s = this.stats(2); this.h = s[3]; this.dt = s[5]; this.nPlate = s[29]; this.dz = s[4];
      this.fillRender(true);
    }
    get time() { return this.stats(0)[0]; }
    get steps() { return Number(this.stats(0)[1]); }
    get dmgGen() { return this.diagRaw()[4]; }
    fire() { w.al_fire(); this.fired = true; }
    run(k) { w.al_step(k); this._t = undefined; }
    stats(level) { const p = w.al_stats_level(level === undefined ? 2 : level); return new Float64Array(w.memory.buffer, p, this.statLen).slice(); } // pointer first: the call may grow (detach) memory
    diagRaw() { const p = w.al_diag_age(); return new Float64Array(w.memory.buffer, p, this.statLen).slice(); }
    diagAge() { const d = this.diagRaw(); return { energyStep: d[0], fragStep: d[1], energyTime: d[2], fragTime: d[3] }; }
    fillRender(needSpeed) { // memory may have grown -> re-create views every call
      w.al_render_opt(needSpeed === false ? 0 : 1); const n = this.n, pp = w.al_pos_ptr(), pm = w.al_mat_ptr(), pd = w.al_dmg_ptr(), ps = w.al_spd_ptr(), b = w.memory.buffer;
      this.rPos = new Float32Array(b, pp, 2 * n); this.rMat = new Float32Array(b, pm, n); this.rDmg = new Float32Array(b, pd, n); this.rSpd = new Float32Array(b, ps, n);
    }
    particle(i) {
      const p = w.al_particle(i), o = new Float64Array(w.memory.buffer, p, 10).slice();
      return { id: i, mat: o[0], x: o[1], y: o[2], vx: o[3], vy: o[4], damage: o[5], bondsTotal: o[6], bondsBroken: o[7], fixed: !!o[8], mass: o[9] };
    }
    hash() { return (BigInt(w.al_hash_hi()) << 32n) | BigInt(w.al_hash_lo()); }
  }
  return { Sim: WSim };
}
root.ALEngineWasm = { load };
})(typeof globalThis !== 'undefined' ? globalThis : this);
