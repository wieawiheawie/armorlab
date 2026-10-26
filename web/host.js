/* Host: gives the UI one interface whether the solver runs in a Web Worker (default) or inline on the main thread (labelled fallback).
   Worker is created from a Blob built from the bundled <script type="text/plain" id="al-worker-src">; no SharedArrayBuffer, no external files => works from file://. */
(function (root) {
'use strict';
class Host {
  constructor(onMsg) { this.onMsg = onMsg; this.mode = 'inline'; this.note = ''; this.w = null; this.runner = null; this._raf = 0; }
  /* resolves { mode, backend, note }. Falls back to inline if the worker cannot start within 4 s. */
  async start(wasmB64, forceInline) {
    const src = !forceInline && typeof document !== 'undefined' && document.getElementById('al-worker-src');
    if (src && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
      try { await this._startWorker(src.textContent); this.mode = 'worker'; }
      catch (e) { this.note = 'worker unavailable (' + ((e && e.message) || e) + '); running inline'; this._cleanupWorker(); }
    } else this.note = forceInline ? 'inline forced' : 'Web Worker unsupported; running inline';
    if (this.mode !== 'worker') this._startInline();
    let ready;
    try { ready = await this._rpc({ t: 'init', wasmB64, presets: root.ARMORLAB_PRESETS }, 'ready'); }
    catch (e) {
      if (this.mode !== 'worker') throw e;
      this.note = 'worker initialization failed (' + ((e && e.message) || e) + '); running inline';
      this._cleanupWorker(); this._startInline();
      ready = await this._rpc({ t: 'init', wasmB64, presets: root.ARMORLAB_PRESETS }, 'ready');
    }
    return { mode: this.mode, backend: ready.backend, note: ready.note, hostNote: this.note };
  }
  _startWorker(text) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' })); let done = false;
      const to = setTimeout(() => { if (!done) { done = true; reject(new Error('worker boot timeout')); } }, 4000);
      try { this.w = new Worker(url); } catch (e) { clearTimeout(to); reject(e); return; }
      this.w.onerror = (e) => {
        const error = new Error(e.message || 'worker error');
        if (!done) { done = true; clearTimeout(to); reject(error); }
        else if (!this._rejectWait(error)) this.onMsg({ t: 'error', msg: 'worker error: ' + error.message });
      };
      this.w.onmessage = (e) => { if (!done && e.data.t === 'boot') { done = true; clearTimeout(to); this.w.onmessage = (ev) => this._in(ev.data); resolve(); } };
    });
  }
  _cleanupWorker() { if (this.w) { try { this.w.terminate(); } catch (e) { /* ignore */ } this.w = null; } }
  _startInline() {
    this.mode = 'inline'; this.runner = new root.ALRunner.Runner((m) => queueMicrotask(() => this._in(m)), { snapMinMs: 50 });
    const pump = () => { try { if (this.runner.tick(8)) this._raf = requestAnimationFrame(pump); else this._raf = 0; } catch (e) { this.onMsg({ t: 'error', msg: String((e && e.message) || e) }); } };
    this._pump = () => { if (!this._raf) this._raf = requestAnimationFrame(pump); };
  }
  _in(m) {
    if (this._wait && this._wait.t === m.t) { const w = this._wait; this._wait = null; clearTimeout(w.timer); w.res(m); }
    this.onMsg(m);
  }
  _rejectWait(error) {
    const w = this._wait; if (!w) return false;
    this._wait = null; clearTimeout(w.timer); w.rej(error); return true;
  }
  _rpc(msg, replyT) {
    return new Promise((res, rej) => {
      const wait = { t: replyT, res, rej, timer: null };
      wait.timer = setTimeout(() => { if (this._wait === wait) { this._wait = null; rej(new Error('host did not receive ' + replyT + ' response within 10 s')); } }, 10000);
      this._wait = wait;
      try { this.send(msg); }
      catch (e) { if (this._wait === wait) { this._wait = null; clearTimeout(wait.timer); } rej(e); }
    });
  }
  send(m, tr) {
    if (this.w) this.w.postMessage(m, tr || []);
    else { Promise.resolve(this.runner.handle(m)).then(() => { if (this.runner.running) this._pump(); }); }
  }
}
const api = { Host };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALHost = Host;
})(typeof globalThis !== 'undefined' ? globalThis : this);
