/* Projectile cell editor + ammunition catalogue UI. All pixels come from ALDesign.rasterize() on the shared design data. */
(function (root) {
'use strict';
const D = root.ALDesign, esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toCanvas(img, target) { const c = target || document.createElement('canvas'); c.width = img.w; c.height = img.h; c.getContext('2d').putImageData(new ImageData(img.data, img.w, img.h), 0, 0); return c; }
const cache = new Map();
/* cached raster canvas keyed by design identity + content hash source (cells array reference + mode + scale) */
function rasterCanvas(d, lib, mode, scale) {
  const key = `${d.id}|${mode}|${scale}`, hit = cache.get(key), sig = d.cells;
  if (hit && hit.sig === sig && hit.n === d.name) return hit.canvas;
  const canvas = toCanvas(D.rasterize(d, lib, { mode, scale })); cache.set(key, { sig, n: d.name, canvas }); return canvas;
}
function legendHtml(d, lib) {
  return D.legend(d, lib).map((e) => `<div class="lg"><span class="sw" style="background:${e.cutaway}"></span><span class="sw" style="background:${e.external}"></span><b>${esc(e.name)}</b> <span class="note">${esc(e.status.replace('_', ' '))} · ${e.cells} cells</span></div>`).join('');
}
function featuresHtml(d) {
  const f = (d.provenance && d.provenance.features) || [], tag = { documented: 'ok', approximate: 'warn', not_drawn: 'dim' };
  return `<table class="tbl feat">${f.map((x) => `<tr><td><span class="tag ${tag[x.status] || ''}">${esc(x.status.replace('_', ' '))}</span></td><td>${esc(x.name)}<div class="note">${esc(x.note)}</div></td></tr>`).join('')}</table>`;
}
function init(ctx) {
  const { lib, store, P } = ctx, $ = (id) => document.getElementById(id);
  const st = { ammo: null, mode: 'external', tool: 'pencil', mat: 'MAT_STEEL_ASSUMED', mirror: true, zoom: 8, hist: new D.History(100), design: null, cat: null, catMode: 'external' };
  const ammoName = (id) => (P.ammunition[id].designation || P.ammunition[id].name);
  // ---------- inline preview (left panel)
  function renderPreview(ammoId) {
    const d = store.designFor(ammoId), stt = D.stats(d), builtin = store.builtinFor(ammoId), usingUser = d !== builtin;
    const host = $('projectilePreview'); host.innerHTML = '';
    const cv = document.createElement('canvas'); cv.className = 'pv'; cv.setAttribute('aria-label', `Design ${d.name}`);
    const mode = ctx.viewMode ? ctx.viewMode() : 'external'; const src = rasterCanvas(d, lib, mode, 3); cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0); host.appendChild(cv);
    const info = document.createElement('div'); info.className = 'note';
    info.innerHTML = `<b>${esc(d.name)}</b> · ${usingUser ? '<span class="warn">user design</span>' : 'built-in template'} (${esc(d.id)})<br>${stt.lengthMm.toFixed(1)} × ${stt.diameterMm.toFixed(1)} mm drawn (${d.cellMm} mm cells) · ${esc(mode)} view<br><span class="warn">${esc(d.provenance.visual_status || 'User-edited design: visual only.')}</span><br>${esc((d.provenance.solver_note) || 'Visual only; the solver envelope is unchanged.')}<div class="leg">${legendHtml(d, lib)}</div>`;
    host.appendChild(info);
  }
  // ---------- modal scaffolding
  const modal = document.createElement('div'); modal.id = 'dlab'; modal.hidden = true; document.body.appendChild(modal);
  const close = () => { modal.hidden = true; modal.innerHTML = ''; ctx.onChange(); };
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // ---------- catalogue
  function openCatalogue() {
    st.cat = st.cat || ctx.currentAmmo(); modal.hidden = false;
    const ids = Object.keys(P.ammunition);
    modal.innerHTML = `<div class="dwin" tabindex="-1"><div class="dhead"><b>Ammunition catalogue</b><span class="note"> thumbnails and inspection use the same design data as the editor and viewport</span><span class="sp"></span><label class="inl"><input type="radio" name="cm" value="external" ${st.catMode === 'external' ? 'checked' : ''}> external</label><label class="inl"><input type="radio" name="cm" value="cutaway" ${st.catMode === 'cutaway' ? 'checked' : ''}> material / cutaway</label><button id="dclose">Close</button></div>
      <div class="dbody"><div class="cgrid" id="cgrid"></div><div class="cinsp" id="cinsp"></div></div></div>`;
    $('dclose').onclick = close; modal.querySelector('.dwin').focus();
    modal.querySelectorAll('input[name=cm]').forEach((r) => { r.onchange = () => { st.catMode = r.value; fillCat(); }; });
    function fillCat() {
      const g = $('cgrid'); g.innerHTML = '';
      for (const id of ids) {
        const d = store.designFor(id), card = document.createElement('button'); card.className = 'ccard' + (id === st.cat ? ' sel' : ''); card.dataset.ammo = id;
        const cv = document.createElement('canvas'); cv.className = 'thumb'; const src = rasterCanvas(d, lib, st.catMode, 2); cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0);
        card.appendChild(cv); const t = document.createElement('div'); t.innerHTML = `<b>${esc(ammoName(id))}</b><div class="note">${esc(P.ammunition[id].country || 'Germany')} · ${esc(d.id)}${d.builtin ? '' : ' · user'}</div>`; card.appendChild(t);
        card.onclick = () => { st.cat = id; fillCat(); }; g.appendChild(card);
      }
      const a = P.ammunition[st.cat], d = store.designFor(st.cat), cv = document.createElement('canvas'), src = rasterCanvas(d, lib, st.catMode, 6); cv.width = src.width; cv.height = src.height; cv.className = 'big';
      cv.getContext('2d').drawImage(src, 0, 0); const box = $('cinsp'); box.innerHTML = ''; const scroller = document.createElement('div'); scroller.className = 'bigwrap'; scroller.appendChild(cv); box.appendChild(scroller);
      const stt = D.stats(d), body = document.createElement('div');
      body.innerHTML = `<h4>${esc(a.designation || a.name)}</h4><div class="note">${esc(d.name)} · ${esc(d.id)} · ${stt.lengthMm.toFixed(1)} × ${stt.diameterMm.toFixed(1)} mm drawn · cell ${d.cellMm} mm</div><div class="note warn">${esc(d.provenance.visual_status || '')}</div><p class="note">${esc(d.provenance.basis || '')}</p><h4>Features</h4>${featuresHtml(d)}<h4>Materials in this design</h4><div class="leg">${legendHtml(d, lib)}</div><p class="note">${st.catMode === 'cutaway' ? 'Cutaway colours are legend conventions, not the natural colour of the material. Colour alone does not prove identity.' : 'External view: lighting shows the silhouette; surface tones are display conventions.'}</p><h4>Solver link (separate from this visual)</h4><div class="note">${esc(d.provenance.solver_note || '')}</div><div class="row"><button id="csel">Use in simulation</button><button id="cedit">Edit design…</button></div>`;
      box.appendChild(body); $('csel').onclick = () => { ctx.setAmmo(st.cat); close(); }; $('cedit').onclick = () => { close(); ctx.setAmmo(st.cat); openEditor(); };
    }
    fillCat();
  }
  // ---------- editor
  function curDesign() { return st.design; }
  function setDesign(d) { st.design = d; st.hist = new D.History(100); }
  function openEditor() {
    st.ammo = ctx.currentAmmo(); setDesign(store.designFor(st.ammo)); modal.hidden = false;
    const mats = lib.list().filter((m) => m.builtin_assignable || m.status === 'reference_only' || true);
    modal.innerHTML = `<div class="dwin" tabindex="-1"><div class="dhead"><b>Projectile cell editor</b><span class="note" id="eammo"></span><span class="sp"></span><button id="dclose">Close</button></div>
      <div class="dbody ed"><div class="etools">
        <label>Design for this ammunition</label><select id="edsel"></select>
        <div class="row"><button id="edup">Duplicate</button><button id="edreset">Reset</button></div>
        <div class="row"><button id="edren">Rename</button><button id="eddel">Delete</button></div>
        <div class="row"><button id="edexp">Export</button><button id="edimp">Import</button></div><input type="file" id="edfile" accept="application/json,.json" hidden>
        <h4>Tool</h4><div class="tools" id="edtools">${['pencil', 'eraser', 'fill', 'replace', 'inspect'].map((t) => `<button data-t="${t}">${t}</button>`).join('')}</div>
        <div class="row"><button id="edoutline">Outline silhouette</button><button id="edsym">Symmetrize</button></div>
        <label class="inl"><input type="checkbox" id="edmirror" checked> Mirror across axis (draw both halves)</label>
        <div class="row"><button id="edundo">Undo</button><button id="edredo">Redo</button></div>
        <label>Zoom <span id="edzv"></span></label><input type="range" id="edzoom" min="3" max="20" value="8">
        <label class="inl"><input type="radio" name="em" value="cutaway" checked> material</label><label class="inl"><input type="radio" name="em" value="external"> external</label>
        <h4>Material</h4><div id="edmats" class="mats"></div>
        <div class="note" id="edmatinfo"></div></div>
        <div class="ecanvas"><div class="note" id="edstat"></div><div class="escroll"><canvas id="edcv"></canvas></div><div class="note" id="edinsp">Hover a cell to inspect it.</div><h4>Legend (materials in this design)</h4><div class="leg" id="edleg"></div><div class="note" id="edmsg"></div></div></div></div>`;
    $('dclose').onclick = close; modal.querySelector('.dwin').focus(); $('eammo').textContent = ' · ' + ammoName(st.ammo);
    const msg = (t) => { $('edmsg').textContent = t; };
    function fillSel() {
      const s = $('edsel'); s.innerHTML = ''; const b = store.builtinFor(st.ammo); s.add(new Option(`${b.name} — built-in`, b.id));
      for (const u of store.userFor(st.ammo)) s.add(new Option(`${u.name} — user (${u.id})`, u.id)); s.value = st.design.id;
    }
    function matList() {
      const box = $('edmats'); box.innerHTML = '';
      for (const m of mats) { const b = document.createElement('button'); b.className = 'mat' + (m.id === st.mat ? ' sel' : ''); b.title = `${m.name} — ${m.status}`; b.innerHTML = `<span class="sw" style="background:${m.appearance.cutaway.fill}"></span><span class="sw" style="background:${m.appearance.external.base}"></span> ${esc(m.name)}`; b.onclick = () => { st.mat = m.id; matList(); }; box.appendChild(b); }
      const m = lib.get(st.mat); $('edmatinfo').innerHTML = `<b>${esc(m.name)}</b> · ${esc(m.status.replace('_', ' '))} · ${esc(m.confidence)}<br>${esc(m.evidence.summary)}<br>Solver link: ${m.physical.solver_material_ref ? esc(m.physical.solver_material_ref) + ' (existing preset; changing colour never changes it)' : 'none — appearance only, no physical behaviour'}.`;
    }
    function draw() {
      const d = st.design, s = st.zoom, mode = document.querySelector('input[name=em]:checked').value, img = D.rasterize(d, lib, { mode, scale: s });
      const cv = $('edcv'), padL = 30, padB = 26, ctx2 = (cv.width = img.w + padL + 6, cv.height = img.h + padB + 6, cv.getContext('2d'));
      ctx2.fillStyle = '#0e1013'; ctx2.fillRect(0, 0, cv.width, cv.height);
      const off = toCanvas(img); ctx2.drawImage(off, padL, 4);
      ctx2.strokeStyle = 'rgba(255,255,255,.06)'; ctx2.beginPath(); if (s >= 8) { for (let c = 0; c <= d.cols; c++) { ctx2.moveTo(padL + c * s + .5, 4); ctx2.lineTo(padL + c * s + .5, 4 + img.h); } for (let r = 0; r <= d.rows; r++) { ctx2.moveTo(padL, 4 + r * s + .5); ctx2.lineTo(padL + img.w, 4 + r * s + .5); } } ctx2.stroke();
      ctx2.strokeStyle = 'rgba(224,163,62,.45)'; ctx2.setLineDash([4, 4]); ctx2.beginPath(); ctx2.moveTo(padL, 4 + img.h / 2); ctx2.lineTo(padL + img.w, 4 + img.h / 2); ctx2.stroke(); ctx2.setLineDash([]);
      ctx2.fillStyle = '#8a929c'; ctx2.strokeStyle = '#8a929c'; ctx2.font = '10px system-ui'; ctx2.beginPath();
      const stepMm = d.cellMm * s >= 12 ? 10 : 20; for (let mm = 0; mm <= d.cols * d.cellMm; mm += stepMm) { const x = padL + mm / d.cellMm * s; ctx2.moveTo(x + .5, 4 + img.h); ctx2.lineTo(x + .5, 4 + img.h + 5); ctx2.fillText(String(mm), x - 6, 4 + img.h + 17); }
      ctx2.moveTo(padL, 4 + img.h + .5); ctx2.lineTo(padL + img.w, 4 + img.h + .5); for (let mm = 0; mm <= d.rows * d.cellMm; mm += stepMm) { const y = 4 + mm / d.cellMm * s; ctx2.moveTo(padL - 5, y + .5); ctx2.lineTo(padL, y + .5); if (mm % (stepMm * 2) === 0) ctx2.fillText(String(mm), 1, y + 3); }
      ctx2.stroke(); const stt = D.stats(d);
      $('edstat').innerHTML = `<b>${esc(d.name)}</b> ${d.builtin ? '<span class="tag ok">built-in (read-only: edits make a copy)</span>' : '<span class="tag warn">user design</span>'} · grid ${d.cols}×${d.rows} · cell ${d.cellMm} mm · drawn ${stt.lengthMm.toFixed(1)} × ${stt.diameterMm.toFixed(1)} mm · scale ruler in mm (nose at right) · envelope ${d.envelope.length_mm} × ${d.envelope.calibre_mm} mm`;
      $('edleg').innerHTML = legendHtml(d, lib); $('edzv').textContent = s + ' px/cell'; $('edundo').disabled = !st.hist.canUndo(); $('edredo').disabled = !st.hist.canRedo();
      $('eddel').disabled = d.builtin; $('edreset').disabled = d.builtin; $('edren').disabled = d.builtin;
      document.querySelectorAll('#edtools button').forEach((b) => b.classList.toggle('sel', b.dataset.t === st.tool));
      $('edmirror').checked = st.mirror;
    }
    /* any mutation of a built-in first forks it into a user copy that becomes the active design for this ammunition */
    function ensureEditable() { if (st.design.builtin) { const u = store.editable(st.design.id); store.select(st.ammo, u.id); setDesign(u); fillSel(); msg('Built-in template preserved; editing a user copy.'); } }
    function commit(fn) { ensureEditable(); const d = st.design; st.hist.push(d); const changed = fn(d); if (!changed) { st.hist.undoS.pop(); } else { store.save(); ctx.onChange(true); } draw(); }
    function cellAt(e) { const cv = $('edcv'), b = cv.getBoundingClientRect(), k = cv.width / b.width, x = (e.clientX - b.left) * k - 30, y = (e.clientY - b.top) * k - 4; return [Math.floor(x / st.zoom), Math.floor(y / st.zoom)]; }
    let down = false, strokeOpen = false;
    function apply(c, r, first) {
      const d = st.design; if (!d.inside(c, r)) return;
      if (st.tool === 'inspect') return;
      if (st.tool === 'pencil' || st.tool === 'eraser') {
        if (first) { ensureEditable(); st.hist.push(st.design); strokeOpen = true; }
        const dd = st.design, ch = st.tool === 'pencil' ? D.paint(dd, c, r, st.mat, st.mirror) : D.erase(dd, c, r, st.mirror); if (ch) { store.save(); ctx.onChange(true); } draw(); return;
      }
      if (!first) return;
      if (st.tool === 'fill') commit((dd) => D.fill(dd, c, r, st.mat, st.mirror));
      if (st.tool === 'replace') commit((dd) => { const from = dd.get(c, r); return from ? D.replaceMaterial(dd, from, st.mat) : false; });
    }
    const cv = $('edcv');
    cv.addEventListener('pointerdown', (e) => { down = true; cv.setPointerCapture(e.pointerId); const [c, r] = cellAt(e); apply(c, r, true); });
    cv.addEventListener('pointermove', (e) => {
      const [c, r] = cellAt(e), d = st.design; if (d.inside(c, r)) { const id = d.get(c, r), m = id && lib.get(id); $('edinsp').innerHTML = `cell col ${c}, row ${r} · x ${(c * d.cellMm).toFixed(1)}–${((c + 1) * d.cellMm).toFixed(1)} mm from base · y ${((r - d.rows / 2) * d.cellMm).toFixed(1)} mm from axis · ${m ? `<b>${esc(m.name)}</b> (${esc(id)}, ${esc(m.status.replace('_', ' '))})` : 'empty'}`; }
      if (down) apply(c, r, false);
    });
    cv.addEventListener('pointerup', () => { down = false; if (strokeOpen) { strokeOpen = false; if (st.hist.undoS.length && st.hist.undoS[st.hist.undoS.length - 1].every((v, i) => v === st.design.cells[i])) st.hist.undoS.pop(); draw(); } });
    $('edtools').onclick = (e) => { if (e.target.dataset.t) { st.tool = e.target.dataset.t; draw(); } };
    $('edmirror').onchange = (e) => { st.mirror = e.target.checked; };
    $('edzoom').oninput = (e) => { st.zoom = +e.target.value; draw(); };
    document.querySelectorAll('input[name=em]').forEach((r) => { r.onchange = draw; });
    $('edoutline').onclick = () => commit((d) => D.outline(d, st.mat));
    $('edsym').onclick = () => commit((d) => D.symmetrize(d, true));
    $('edundo').onclick = () => { ensureEditable(); if (st.hist.undo(st.design)) { store.save(); ctx.onChange(true); } draw(); };
    $('edredo').onclick = () => { if (st.hist.redo(st.design)) { store.save(); ctx.onChange(true); } draw(); };
    $('edsel').onchange = (e) => { const id = e.target.value, d = store.get(id); store.select(st.ammo, d.builtin ? null : id); setDesign(d); draw(); ctx.onChange(true); };
    $('edup').onclick = () => { const u = store.duplicate(st.design.id); store.select(st.ammo, u.id); setDesign(u); fillSel(); draw(); ctx.onChange(true); msg('Duplicated.'); };
    $('edreset').onclick = () => { if (st.design.builtin) return; store.reset(st.design.id); st.hist = new D.History(100); draw(); ctx.onChange(true); msg('Reset to the built-in template.'); };
    $('eddel').onclick = () => { if (st.design.builtin) return; store.remove(st.design.id); setDesign(store.designFor(st.ammo)); fillSel(); draw(); ctx.onChange(true); };
    $('edren').onclick = () => { if (st.design.builtin) return; const n = prompt('Design name', st.design.name); if (n) { store.rename(st.design.id, n); fillSel(); draw(); ctx.onChange(true); } };
    $('edexp').onclick = () => { const blob = new Blob([store.exportJson(st.design.id)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${st.design.id}.armorlab-design.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    $('edimp').onclick = () => $('edfile').click();
    $('edfile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const d = store.importJson(await f.text()); if (d.ammo_id === st.ammo) { store.select(st.ammo, d.id); setDesign(d); } fillSel(); draw(); ctx.onChange(true); msg(`Imported ${d.name}.`); } catch (err) { msg('Import rejected: ' + err.message); } e.target.value = ''; };
    modal.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); (e.shiftKey ? $('edredo') : $('edundo')).click(); } });
    fillSel(); matList(); draw();
  }
  return { renderPreview, openCatalogue, openEditor, rasterCanvas: (d, mode, scale) => rasterCanvas(d, lib, mode, scale), toCanvas };
}
root.ALDesignUI = { init, legendHtml, featuresHtml };
})(typeof globalThis !== 'undefined' ? globalThis : this);
