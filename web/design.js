/* ArmorLab projectile cell designs: data model, validation, editing operations, undo/redo, shared rasteriser, and the design store.
   Pure (no DOM): the editor, catalogue thumbnails, inspection preview and the simulation viewport all call rasterize() on the same Design data. */
(function (root) {
'use strict';
const SCHEMA = 'armorlab-design-1', MAX_CELLS = 40000;
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- model ---------- */
class Design {
  constructor(meta, cols, rows, cellMm, cells) { Object.assign(this, meta); this.cols = cols; this.rows = rows; this.cellMm = cellMm; this.cells = cells; }
  idx(c, r) { return r * this.cols + c; }
  inside(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
  get(c, r) { return this.inside(c, r) ? this.cells[r * this.cols + c] : null; }
  clone() { return new Design(clone(this.meta()), this.cols, this.rows, this.cellMm, this.cells.slice()); }
  meta() { return { id: this.id, template_id: this.template_id, name: this.name, ammo_id: this.ammo_id, builtin: !!this.builtin, based_on: this.based_on || null, envelope: this.envelope, provenance: this.provenance, orientation: this.orientation }; }
}
function parseDesign(json, lib) {
  if (!json || json.schema !== SCHEMA) throw new Error('design: wrong or missing schema');
  const g = json.grid || {};
  if (!Number.isInteger(g.cols) || !Number.isInteger(g.rows) || g.cols < 4 || g.rows < 2 || g.cols * g.rows > MAX_CELLS) throw new Error('design: invalid grid size');
  if (!(g.cell_mm > 0 && g.cell_mm <= 20)) throw new Error('design: invalid cell_mm');
  if (typeof json.id !== 'string' || !/^[A-Za-z0-9_\-]{1,64}$/.test(json.id)) throw new Error('design: invalid id');
  if (typeof json.name !== 'string' || !json.name.trim()) throw new Error('design: missing name');
  if (!json.legend || typeof json.legend !== 'object' || !('.' in json.legend) || json.legend['.'] !== null) throw new Error("design: legend must map '.' to null");
  if (!Array.isArray(json.rows) || json.rows.length !== g.rows) throw new Error('design: row count does not match grid');
  const cells = new Array(g.cols * g.rows).fill(null);
  for (let r = 0; r < g.rows; r++) {
    const row = json.rows[r];
    if (typeof row !== 'string' || row.length !== g.cols) throw new Error(`design: row ${r} has wrong length`);
    for (let c = 0; c < g.cols; c++) {
      const ch = row[c];
      if (!Object.hasOwn(json.legend, ch)) throw new Error(`design: row ${r} col ${c} uses undefined legend character '${ch}'`);
      const id = json.legend[ch];
      if (id !== null) { if (!lib.has(id)) throw new Error(`design: unknown material id ${id}`); cells[r * g.cols + c] = id; }
    }
  }
  const env = json.envelope || {};
  if (!(env.calibre_mm > 0 && env.length_mm > 0)) throw new Error('design: envelope missing');
  const d = new Design({ id: json.id, template_id: json.template_id || json.id, name: json.name, ammo_id: json.ammo_id || null, builtin: !!json.builtin, based_on: json.based_on || null, envelope: clone(env), provenance: clone(json.provenance || {}), orientation: json.orientation || '' }, g.cols, g.rows, g.cell_mm, cells);
  if (!cells.some(Boolean)) throw new Error('design: no occupied cells');
  return d;
}
function serializeDesign(d) {
  const ids = Array.from(new Set(d.cells.filter(Boolean))).sort(), chars = 'abcdefghijklmnopqrstuvwxyz';
  if (ids.length > chars.length) throw new Error('design: too many materials');
  const legend = { '.': null }, inv = {};
  ids.forEach((id, i) => { legend[chars[i]] = id; inv[id] = chars[i]; });
  const rows = [];
  for (let r = 0; r < d.rows; r++) { let s = ''; for (let c = 0; c < d.cols; c++) { const id = d.cells[r * d.cols + c]; s += id ? inv[id] : '.'; } rows.push(s); }
  return { schema: SCHEMA, id: d.id, template_id: d.template_id, name: d.name, ammo_id: d.ammo_id, builtin: !!d.builtin, based_on: d.based_on || null, orientation: d.orientation,
    grid: { cols: d.cols, rows: d.rows, cell_mm: d.cellMm }, envelope: clone(d.envelope), legend, rows, provenance: clone(d.provenance) };
}

/* ---------- editing operations (all return true when anything changed) ---------- */
const mirrorRow = (d, r) => d.rows - 1 - r;
function paint(d, c, r, mat, mirror) {
  if (!d.inside(c, r)) return false; let ch = false; const set = (cc, rr) => { const i = rr * d.cols + cc; if (d.cells[i] !== mat) { d.cells[i] = mat; ch = true; } };
  set(c, r); if (mirror) set(c, mirrorRow(d, r)); return ch;
}
const erase = (d, c, r, mirror) => paint(d, c, r, null, mirror);
function fill(d, c, r, mat, mirror) {
  if (!d.inside(c, r)) return false; const target = d.get(c, r); if (target === mat) return false;
  const stack = [[c, r]], seen = new Uint8Array(d.cells.length); let ch = false;
  while (stack.length) {
    const [x, y] = stack.pop(); if (!d.inside(x, y)) continue; const i = y * d.cols + x; if (seen[i] || d.cells[i] !== target) continue; seen[i] = 1;
    d.cells[i] = mat; ch = true; stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  if (mirror) { const my = mirrorRow(d, r); if (my !== r && d.get(c, my) === target) fill(d, c, my, mat, false); }
  return ch;
}
function replaceMaterial(d, from, to) { let ch = false; if (from === to || !from) return false; for (let i = 0; i < d.cells.length; i++) if (d.cells[i] === from) { d.cells[i] = to; ch = true; } return ch; }
function outline(d, mat) { /* re-material the outermost occupied cells of the silhouette */
  const edge = []; for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) { if (!d.get(c, r)) continue; if (!d.get(c + 1, r) || !d.get(c - 1, r) || !d.get(c, r + 1) || !d.get(c, r - 1)) edge.push([c, r]); }
  let ch = false; for (const [c, r] of edge) { if (d.get(c, r) !== mat) { d.cells[r * d.cols + c] = mat; ch = true; } } return ch;
}
function symmetrize(d, fromTop) { /* mirror design across the axis: copy one half onto the other */
  let ch = false; for (let r = 0; r < d.rows / 2; r++) for (let c = 0; c < d.cols; c++) {
    const a = fromTop ? r : mirrorRow(d, r), b = fromTop ? mirrorRow(d, r) : r, v = d.cells[a * d.cols + c];
    if (d.cells[b * d.cols + c] !== v) { d.cells[b * d.cols + c] = v; ch = true; }
  } return ch;
}
function stats(d) {
  let minC = 1e9, maxC = -1, minR = 1e9, maxR = -1, n = 0; const byMat = {};
  for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) { const m = d.cells[r * d.cols + c]; if (!m) continue; n++; byMat[m] = (byMat[m] || 0) + 1; if (c < minC) minC = c; if (c > maxC) maxC = c; if (r < minR) minR = r; if (r > maxR) maxR = r; }
  return { cells: n, byMaterial: byMat, lengthMm: n ? (maxC - minC + 1) * d.cellMm : 0, diameterMm: n ? (maxR - minR + 1) * d.cellMm : 0, areaMm2: n * d.cellMm * d.cellMm, bbox: { minC, maxC, minR, maxR } };
}
class History {
  constructor(limit) { this.limit = limit || 100; this.undoS = []; this.redoS = []; }
  push(d) { this.undoS.push(d.cells.slice()); if (this.undoS.length > this.limit) this.undoS.shift(); this.redoS.length = 0; }
  undo(d) { if (!this.undoS.length) return false; this.redoS.push(d.cells.slice()); d.cells = this.undoS.pop(); return true; }
  redo(d) { if (!this.redoS.length) return false; this.undoS.push(d.cells.slice()); d.cells = this.redoS.pop(); return true; }
  canUndo() { return this.undoS.length > 0; } canRedo() { return this.redoS.length > 0; }
}

/* ---------- shared rasteriser ---------- */
const hash2 = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hatchOn = (kind, x, y, s) => { const k = Math.max(3, Math.round(s * 1.6));
  switch (kind) { case 'diag': return ((x + y) % k) === 0; case 'diag-rev': return (((x - y) % k) + k) % k === 0; case 'diag-sparse': return ((x + y) % (k * 2)) === 0; case 'cross': return ((x + y) % k) === 0 || (((x - y) % k) + k) % k === 0; case 'dots': return (x % k === 1 && y % k === 1); default: return false; } };
/* mode: 'external' (lit finished surface) or 'cutaway' (legend colours + hatch). Returns { w, h, data } RGBA. Pure and deterministic. */
function rasterize(d, lib, opts) {
  opts = opts || {}; const mode = opts.mode === 'cutaway' ? 'cutaway' : 'external', s = Math.max(1, Math.floor(opts.scale || 4));
  const W = d.cols * s, H = d.rows * s, data = new Uint8ClampedArray(W * H * 4);
  const top = new Int32Array(d.cols).fill(-1), bot = new Int32Array(d.cols).fill(-1);
  for (let c = 0; c < d.cols; c++) for (let r = 0; r < d.rows; r++) if (d.cells[r * d.cols + c]) { if (top[c] < 0) top[c] = r; bot[c] = r; }
  for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
    const id = d.cells[r * d.cols + c]; if (!id) continue; const col = lib.rgb(id), m = lib.get(id), ext = m.appearance.external, hatch = m.appearance.cutaway.hatch;
    const center = (top[c] + bot[c] + 1) / 2, half = (bot[c] - top[c] + 1) / 2;
    const lN = d.get(c - 1, r), rN = d.get(c + 1, r), uN = d.get(c, r - 1), dN = d.get(c, r + 1);
    for (let py = 0; py < s; py++) for (let px = 0; px < s; px++) {
      let rgb;
      if (mode === 'external') {
        const t = half > 1.2 ? clampN(((r + (py + 0.5) / s) - center) / half, -1, 1) : 0, nz = Math.sqrt(Math.max(0, 1 - t * t));
        const lum = clampN(nz * 0.78 + (-t) * 0.62, 0, 1);
        rgb = lum < 0.6 ? mixc(col.dark, col.base, lum / 0.6) : mixc(col.base, col.light, (lum - 0.6) / 0.4);
        const spec = Math.pow(lum, 4 + (1 - ext.roughness) * 28) * ext.reflectivity * 0.55; rgb = mixc(rgb, [255, 255, 255], spec);
        const n = (hash2(c * s + px, r * s + py) - 0.5) * ext.roughness * 14; rgb = [rgb[0] + n, rgb[1] + n, rgb[2] + n];
      } else {
        rgb = col.fill.slice(); if (hatchOn(hatch, c * s + px, r * s + py, s)) rgb = mixc(rgb, [0, 0, 0], 0.22);
      }
      if (s >= 3) {
        const seam = (px === 0 && lN && lN !== id) || (py === 0 && uN && uN !== id), edge = (px === 0 && !lN) || (py === 0 && !uN) || (px === s - 1 && !rN) || (py === s - 1 && !dN);
        if (edge) rgb = mixc(rgb, [0, 0, 0], 0.42); else if (seam) rgb = mixc(rgb, [0, 0, 0], 0.3);
      }
      const o = ((r * s + py) * W + c * s + px) * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
    }
  }
  return { w: W, h: H, data };
}
function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }
function hashRaster(img) { let h = 2166136261; for (let i = 0; i < img.data.length; i++) { h ^= img.data[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
function legend(d, lib) {
  const st = stats(d); return Object.entries(st.byMaterial).map(([id, n]) => { const m = lib.get(id); return { id, name: m.name, status: m.status, confidence: m.confidence, cells: n, cutaway: m.appearance.cutaway.fill, external: m.appearance.external.base, hatch: m.appearance.cutaway.hatch }; }).sort((a, b) => b.cells - a.cells);
}

/* ---------- store: immutable built-ins + user designs + per-ammunition selection ---------- */
const KEY = 'armorlab.designs.v1';
class DesignStore {
  constructor(lib, builtinSet, storage) {
    this.lib = lib; this.storage = storage || null; this.builtin = new Map(); this.user = new Map(); this.selected = {};
    for (const j of builtinSet.designs) { const d = parseDesign(j, lib); if (this.builtin.has(d.id)) throw new Error(`duplicate built-in design ${d.id}`); d.builtin = true; deepFreeze(d.cells); this.builtin.set(d.id, d); }
    this.byAmmo = new Map(); for (const d of this.builtin.values()) { if (this.byAmmo.has(d.ammo_id)) throw new Error(`two built-in designs for ${d.ammo_id}`); this.byAmmo.set(d.ammo_id, d); }
    this.load();
  }
  has(id) { return this.builtin.has(id) || this.user.has(id); }
  get(id) { const d = this.builtin.get(id) || this.user.get(id); if (!d) throw new Error(`Unknown design ${id}`); return d; }
  builtinFor(ammoId) { const d = this.byAmmo.get(ammoId); if (!d) throw new Error(`No built-in design for ammunition ${ammoId}`); return d; }
  /* the design every view (catalogue, preview, viewport) must use for an ammunition record */
  designFor(ammoId) { const sel = this.selected[ammoId]; return sel && this.user.has(sel) ? this.user.get(sel) : this.builtinFor(ammoId); }
  select(ammoId, designId) { if (designId === null || this.builtin.has(designId) && this.builtin.get(designId).ammo_id === ammoId) delete this.selected[ammoId]; else if (this.user.has(designId)) this.selected[ammoId] = designId; else throw new Error('cannot select that design for this ammunition'); this.save(); }
  userFor(ammoId) { return Array.from(this.user.values()).filter((d) => d.ammo_id === ammoId); }
  nextId() { let i = 1; while (this.user.has('USR_' + i)) i++; return 'USR_' + i; }
  duplicate(id, name) { const src = this.get(id), d = src.clone(); d.id = this.nextId(); d.builtin = false; d.based_on = src.builtin ? src.id : (src.based_on || src.id); d.template_id = src.template_id; d.name = name || `${src.name} (copy)`; d.ammo_id = src.ammo_id; this.user.set(d.id, d); this.save(); return d; }
  /* editing a built-in never modifies it: callers must edit the returned user copy */
  editable(id) { const d = this.get(id); return d.builtin ? this.duplicate(id, `${d.name} (edited)`) : d; }
  reset(id) { const d = this.get(id); if (d.builtin) return d; const base = this.builtin.get(d.based_on); if (!base) throw new Error('design has no built-in template to reset to'); d.cells = base.cells.slice(); this.save(); return d; }
  remove(id) { if (!this.user.has(id)) throw new Error('only user designs can be deleted'); this.user.delete(id); for (const [a, s] of Object.entries(this.selected)) if (s === id) delete this.selected[a]; this.save(); }
  rename(id, name) { const d = this.get(id); if (d.builtin) throw new Error('built-in designs cannot be renamed'); d.name = String(name).slice(0, 80) || d.name; this.save(); }
  exportJson(id) { return JSON.stringify(serializeDesign(this.get(id)), null, 1); }
  importJson(text) { const d = parseDesign(JSON.parse(text), this.lib); d.builtin = false; if (this.builtin.has(d.id) || this.user.has(d.id)) d.id = this.nextId(); if (d.ammo_id && !this.byAmmo.has(d.ammo_id)) d.ammo_id = null; this.user.set(d.id, d); this.save(); return d; }
  toSaved() { return { v: 1, designs: Array.from(this.user.values()).map(serializeDesign), selected: this.selected }; }
  save() { if (!this.storage) return false; try { this.storage.setItem(KEY, JSON.stringify(this.toSaved())); return true; } catch (e) { return false; } }
  load() {
    if (!this.storage) return; let raw = null; try { raw = this.storage.getItem(KEY); } catch (e) { return; } if (!raw) return;
    try {
      const saved = JSON.parse(raw); if (!saved || saved.v !== 1) return;
      for (const j of saved.designs || []) { try { const d = parseDesign(j, this.lib); d.builtin = false; if (!this.builtin.has(d.id)) this.user.set(d.id, d); } catch (e) { /* skip one corrupt design, keep others */ } }
      for (const [a, s] of Object.entries(saved.selected || {})) if (this.byAmmo.has(a) && this.user.has(s)) this.selected[a] = s;
    } catch (e) { /* corrupt storage: ignore, built-ins unaffected */ }
  }
}
const api = { SCHEMA, Design, parseDesign, serializeDesign, paint, erase, fill, replaceMaterial, outline, symmetrize, stats, History, rasterize, hashRaster, legend, DesignStore, deepFreeze, KEY };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ALDesign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
