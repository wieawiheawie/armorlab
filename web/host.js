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
    const ready = await this._rpc({ t: 'init', wasmB64, presets: root.ARMORLAB_PRESETS }, 'ready');
    return { mode: this.mode, backend: ready.backend, note: ready.note, hostNote: this.note };
  }
  _startWorker(text) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' })); let done = false;
      const to = setTimeout(() => { if (!done) { done = true; reject(new Error('worker boot timeout')); } }, 4000);
      try { this.w = new Worker(url); } catch (e) { clearTimeout(to); reject(e); return; }
      this.w.onerror = (e) => { if (!done) { done = true; clearTimeout(to); reject(new Error(e.message || 'worker error')); } else this.onMsg({ t: 'error', msg: 'worker error: ' + (e.message || '') }); };
      this.w.onmessage = (e) => { if (!done && e.data.t === 'boot') { done = true; clearTimeout(to); this.w.onmessage = (ev) => this._in(ev.data); resolve(); } };
    });
  }
  _cleanupWorker() { if (this.w) { try { this.w.terminate(); } catch (e) { /* ignore */ } this.w = null; } }
  _startInline() {
    this.mode = 'inline'; this.runner = new root.ALRunner.Runner((m) => queueMicrotask(() => this._in(m)), { snapMinMs: 50 });
    const pump = () => { try { if (this.runner.tick(8)) this._raf = requestAnimationFrame(pump); else this._raf = 0; } catch (e) { this.onMsg({ t: 'error', msg: String((e && e.message) || e) }); } };
    this._pump = () => { if (!this._raf) this._raf = requestAnimationFrame(pump); };
  }
  _in(m) { if (this._wait && this._wait.t === m.t) { const w = this._wait; this._wait = null; w.res(m); } this.onMsg(m); }
  _rpc(msg, replyT) { return new Promise((res) => { this._wait = { t: replyT, res }; this.send(msg); }); }
  send(m, tr) {
    if (this.w) this.w.postMessage(m, tr || []);
    else { Promise.resolve(this.runner.handle(m)).then(() => { if (this.runner.running) this._pump(); }); }
  }
}
root.ALHost = Host;
})(typeof globalThis !== 'undefined' ? globalThis : this);
