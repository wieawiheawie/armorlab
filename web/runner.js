/* Solver runner: owns the simulation, pacing, snapshots and slow diagnostics. Runs inside a Web Worker (default) or inline on the main thread (labelled fallback).
   Messages in : init, build, fire, play, pause, view, ret, particle, calibrate, full
   Messages out: ready, built, snap, stats, done, particle, calibrated, error */
(function (root) {
'use strict';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
class Runner {
  constructor(post, opts) {
    this.post = post; this.opts = opts || {}; this.sim = null; this.backend = 'JS'; this.backendNote = 'JS reference engine'; this.wasm = null;
    this.running = false; this.rate = 10; this.tEnd = 6e-4; this.view = 0; this.pool = { pos: [], dmg: [], spd: [] }; this.inflight = 0; this.wallRun = 0;
    this.lastTick = 0; this.lastSnap = 0; this.lastDmgSnap = 0; this.lastDmgGen = -1; this.lastStats = 0; this.lastEnergy = 0; this.lastFrag = 0; this.fragBroken = -1; this.stepMs = 0;
    this.snapMinMs = this.opts.snapMinMs || 33; this.seq = 0;
  }
  async handle(m) {
    try {
      switch (m.t) {
        case 'init': await this._init(m); break;
        case 'build': this._build(m); break;
        case 'fire': if (this.sim) { this.sim.fire(); this.fired = true; } break;
        case 'play': this.rate = m.rate; if (m.tEnd) this.tEnd = m.tEnd; this.running = true; this.lastTick = now(); break;
        case 'pause': this.running = false; this._stats(2, true); break;
        case 'view': this.view = m.mode; this.lastDmgGen = -1; if (this.sim) this._snap(true); break;
        case 'ret': this._ret(m); break;
        case 'particle': if (this.sim) this.post({ t: 'particle', req: m.req, p: this.sim.particle(m.i) }); break;
        case 'full': this._stats(2, true); break;
        case 'calibrate': this._calibrate(m); break;
      }
    } catch (e) { this.running = false; this.post({ t: 'error', msg: String((e && e.message) || e) }); }
  }
  async _init(m) {
    this.backend = 'JS'; this.backendNote = 'JS reference engine (no WASM in this build)';
    if (m.wasmB64 && !m.forceJS) {
      try {
        const w = await root.ALEngineWasm.load(m.wasmB64);
        const ok = this._parity(w.Sim); // refuse a WASM engine that does not reproduce the JS reference bit-for-bit on a short run
        if (ok.pass) { this.wasm = w; this.backend = 'WASM'; this.backendNote = 'Rust/WASM (parity-checked vs JS)'; }
        else this.backendNote = 'JS reference engine (WASM REJECTED: ' + ok.why + ')';
      } catch (e) { this.backendNote = 'JS reference engine (WASM failed to load: ' + ((e && e.message) || e) + ')'; }
    } else if (m.forceJS) this.backendNote = 'JS reference engine (forced)';
    this.post({ t: 'ready', backend: this.backend, note: this.backendNote });
  }
  _parity(WS) { // tolerance-based: same config, 60 steps, compare observables (float summation order may differ between engines)
    const cfg = root.ALScenario.makeConfig(this.opts.presets || root.ARMORLAB_PRESETS, 'TIGER1_UPPER_FRONT', 'TIGER1_PZGR39', { n: 2000 });
    const J = new root.ALEngineJS.Sim(cfg), W = new WS(cfg); J.fire(); W.fire(); J.run(60); W.run(60);
    const a = J.stats(2), b = W.stats(2), rel = (x, y) => Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y), 1e-30);
    if (a[2] !== b[2] || a[16] !== b[16]) return { pass: false, why: 'particle/bond count mismatch' };
    for (const i of [6, 7, 8, 12, 22, 25]) if (rel(a[i], b[i]) > 1e-6) return { pass: false, why: 'stat[' + i + '] differs by ' + rel(a[i], b[i]).toExponential(1) };
    return { pass: true };
  }
  _Sim() { return this.backend === 'WASM' ? this.wasm.Sim : root.ALEngineJS.Sim; }
  _build(m) {
    this.running = false; this.fired = false; this.wallRun = 0; this.lastDmgGen = -1; this.pool = { pos: [], dmg: [], spd: [] }; this.inflight = 0; this.fragBroken = -1; this.stepMs = 0;
    const t0 = now(); this.sim = new (this._Sim())(m.cfg); const buildMs = now() - t0; const s = this.sim;
    s.fillRender(true);
    const stat = s.stats(2); this.lastEnergy = this.lastFrag = now();
    this.post({ t: 'built', id: m.id, n: s.n, nPlate: s.nPlate, h: s.h, dt: s.dt, dz: s.dz, buildMs, backend: this.backend, mat: s.rMat.slice(), pos: s.rPos.slice(), dmg: s.rDmg.slice(), S: stat, age: s.diagAge() });
  }
  _take(k, len) { const p = this.pool[k]; while (p.length) { const b = p.pop(); if (b.length === len) return b; } return new Float32Array(len); }
  _ret(m) { this.inflight = Math.max(0, this.inflight - 1); for (const k of ['pos', 'dmg', 'spd']) if (m[k]) this.pool[k].push(m[k]); }
  _snap(force) {
    const s = this.sim, t = now(); if (!s || (!force && (this.inflight >= 2 || t - this.lastSnap < this.snapMinMs))) return;
    const needSpd = this.view === 3; s.fillRender(needSpd); this.lastSnap = t;
    const pos = this._take('pos', 2 * s.n); pos.set(s.rPos); const tr = [pos.buffer], msg = { t: 'snap', pos, time: s.time, steps: s.steps, wall: this.wallRun, seq: ++this.seq };
    if (needSpd) { const sp = this._take('spd', s.n); sp.set(s.rSpd); msg.spd = sp; tr.push(sp.buffer); }
    const gen = s.dmgGen; if (gen !== this.lastDmgGen && (force || t - this.lastDmgSnap >= 100)) { const d = this._take('dmg', s.n); d.set(s.rDmg); msg.dmg = d; tr.push(d.buffer); this.lastDmgGen = gen; this.lastDmgSnap = t; }
    this.inflight++; this.post(msg, tr);
  }
  _stats(level, force) {
    const s = this.sim; if (!s) return; const t = now(); this.lastStats = t;
    if (level < 2 && t - this.lastEnergy >= 1000) level = 1;
    if (level >= 1) this.lastEnergy = t;
    if (level < 2 && level >= 1) { const bc = s.stats(0)[17]; if (bc !== this.fragBroken && t - this.lastFrag >= 2500) level = 2; }
    if (level >= 2) { this.lastFrag = t; }
    const S = s.stats(level); if (level >= 2) this.fragBroken = S[17];
    this.post({ t: 'stats', S, level, age: s.diagAge(), wall: this.wallRun });
  }
  /* Advance work for at most ~budgetMs of wall time (at least one step when running). Returns true while running. */
  tick(budgetMs) {
    const s = this.sim; if (!s) return false; const t0 = now();
    if (this.running) {
      const dtw = Math.min(0.1, (t0 - this.lastTick) / 1000); this.lastTick = t0;
      let want = this.rate === 0 ? 1e12 : Math.max(1, Math.ceil(this.rate * 1e-6 * dtw / s.dt)), did = 0;
      while (did < want) {
        const left = budgetMs - (now() - t0); if (did > 0 && left <= 0) break;
        const room = this.stepMs > 0 ? Math.floor(left / this.stepMs) : 1; // adaptive chunk: never plans more steps than fit the budget
        const k = Math.max(1, Math.min(want - did, room, 64)), a = now(); s.run(k); const per = (now() - a) / k; this.stepMs = this.stepMs ? 0.7 * this.stepMs + 0.3 * per : per; did += k;
        if (s.time >= this.tEnd) break;
      }
      this.wallRun += (now() - t0) / 1000;
      if (s.time >= this.tEnd) { this.running = false; this.fired && this._snap(true); this._stats(2, true); this.post({ t: 'done' }); return false; }
    }
    this._snap(false);
    if (now() - this.lastStats >= 150) this._stats(0, false);
    return this.running;
  }
  _calibrate(m) {
    const prev = this.sim, S = new (this._Sim())(m.cfg); S.fire(); S.run(10); const per = [];
    for (let r = 0; r < 5; r++) { const a = now(); S.run(20); per.push((now() - a) / 20); } per.sort((a, b) => a - b);
    this.sim = null; this.post({ t: 'calibrated', n: S.n, dt: S.dt, msPerStep: per[2], spread: [per[0], per[4]], backend: this.backend }); void prev;
  }
}
const api = { Runner };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALRunner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
