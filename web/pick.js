/* Spatial index for particle picking: uniform grid over a position snapshot. Build is O(N) once per snapshot generation; each query is O(candidates in 3x3 cells). */
(function (root) {
'use strict';
class PickIndex {
  constructor() { this.n = 0; this.builtAt = -1e9; this.gen = -1; }
  build(pos, n, h) {
    const cs = Math.max(3 * h, 1e-9); let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let i = 0; i < n; i++) { const x = pos[2 * i], y = pos[2 * i + 1]; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    const nx = Math.max(1, Math.floor((maxx - minx) / cs) + 1), ny = Math.max(1, Math.floor((maxy - miny) / cs) + 1);
    if (nx * ny > 3e7) { this.n = 0; return false; } // absurdly sparse extent: caller falls back to a linear scan
    const start = new Uint32Array(nx * ny + 1), of = new Uint32Array(n);
    for (let i = 0; i < n; i++) { const c = Math.floor((pos[2 * i + 1] - miny) / cs) * nx + Math.floor((pos[2 * i] - minx) / cs); of[i] = c; start[c + 1]++; }
    for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c];
    const fill = start.slice(), items = new Uint32Array(n); for (let i = 0; i < n; i++) items[fill[of[i]]++] = i;
    Object.assign(this, { n, h, cs, minx, miny, nx, ny, start, items });
    return true;
  }
  /* nearest particle to (wx,wy) within maxR, measured against the CURRENT positions in `pos` (index cells may be slightly stale; the search ring is widened by `slack`). */
  nearest(pos, wx, wy, maxR, slack) {
    if (!this.n) return this._scan(pos, wx, wy, maxR);
    const { cs, minx, miny, nx, ny, start, items } = this, ring = Math.max(1, Math.ceil((maxR + (slack || 0)) / cs));
    const cx = Math.floor((wx - minx) / cs), cy = Math.floor((wy - miny) / cs); let best = -1, bd = maxR * maxR;
    for (let qy = Math.max(0, cy - ring); qy <= Math.min(ny - 1, cy + ring); qy++) for (let qx = Math.max(0, cx - ring); qx <= Math.min(nx - 1, cx + ring); qx++) {
      const c = qy * nx + qx; for (let s = start[c]; s < start[c + 1]; s++) { const i = items[s], dx = pos[2 * i] - wx, dy = pos[2 * i + 1] - wy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    }
    return best;
  }
  _scan(pos, wx, wy, maxR) { let best = -1, bd = maxR * maxR; for (let i = 0, n = pos.length >> 1; i < n; i++) { const dx = pos[2 * i] - wx, dy = pos[2 * i + 1] - wy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } return best; }
}
const api = { PickIndex };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALPick = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
