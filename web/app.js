(function () {
'use strict';
const R = window.ALResearch.load(window.ARMORLAB_RESEARCH_CSV);
const P = window.ALResearch.integratePresets(window.ARMORLAB_PRESETS, R), SC = window.ALScenario, $ = (id) => document.getElementById(id);
const st = { cfg: null, boundary: null, projectileProfile: null, running: false, started: false, done: false, wall: 0, cam: null, sel: -1, backend: 'JS', mode: 'inline', S: null, age: null, T_END: P.solver.end_time_s, userCam: false, n: 0, h: 0, dt: 0, nPlate: 0, pos: null, snapSim: 0, pending: null, host: null, buildId: 0, ready: false, calib: null, view: 0, pickIdx: new window.ALPick.PickIndex(), pickAt: -1e9, insp: null, dirty: true, rendMs: 0 };
const fmt = (v, d) => (Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-2) ? v.toExponential(2) : v.toFixed(d == null ? 2 : d));
// ---- UI population
for (const [id, t] of Object.entries(P.targets)) $('target').add(new Option(t.name, id));
const ammoGroups = new Map();
for (const [id, a] of Object.entries(P.ammunition)) {
  const country = a.country || 'Germany';
  if (!ammoGroups.has(country)) {
    const group = document.createElement('optgroup');
    group.label = country;
    ammoGroups.set(country, group);
    $('ammo').appendChild(group);
  }
  ammoGroups.get(country).appendChild(new Option(`${a.designation || a.name} — ${a.family} — ${a.gun}`, id));
}
for (const model of P.boundary_models) {
  const labels = { free: 'free plate (no support)', rigid_fixture: 'rigid fixture (fixed end regions)', compliant_foundation: 'compliant foundation', cohesive_interface: 'cohesive interface (unsupported)' };
  const option = new Option(`${labels[model.model_type]} — ${model.model_id}`, model.model_id);
  if (model.availability !== 'implemented') option.disabled = true;
  $('support').add(option);
}
$('support').value = 'rigid_fixture';
function syncAmmo() {
  const t = P.targets[$('target').value], cmp = $('cmp').checked;
  if (!cmp) $('ammo').value = t.pairing; $('ammo').disabled = !cmp;
  const a = P.ammunition[$('ammo').value];
  const profile = SC.projectileGeometry(P, $('ammo').value), silhouette = SC.projectileSilhouette(profile);
  const width = profile.lengthMm, height = profile.calibreMm, scale = Math.min(210 / width, 44 / height);
  const points = silhouette.map(([x, y]) => `${(120 + x * scale).toFixed(2)},${(38 - y * scale).toFixed(2)}`).join(' ');
  const shapeName = { rounded: 'rounded', pointed: 'pointed', ogive: 'ogive' }[profile.noseProfile];
  const core = profile.core;
  const coreSvg = core && core.geometry && core.geometry.diameter_mm && core.geometry.length_mm
    ? `<text class="caption" x="120" y="62" text-anchor="middle">estimated solver core / carrier section</text>
      <rect x="20" y="66" width="200" height="8" rx="2" fill="none" stroke="#e0a33e" stroke-width="1"/>
      <rect class="core" x="${(220 - core.geometry.length_mm / profile.lengthMm * 200).toFixed(1)}" y="${(70 - Math.max(2, core.geometry.diameter_mm / profile.calibreMm * 8) / 2).toFixed(1)}" width="${Math.min(200, core.geometry.length_mm / profile.lengthMm * 200).toFixed(1)}" height="${Math.max(2, core.geometry.diameter_mm / profile.calibreMm * 8).toFixed(1)}"/>`
    : `<text class="caption" x="120" y="72" text-anchor="middle">No source-backed internal dimensions; no cross-section shown</text>`;
  $('projectilePreview').innerHTML = `<svg viewBox="0 0 240 78" role="img" aria-label="Configured projectile silhouette: ${htmlText(a.designation || a.name)}">
    <polygon class="shape" points="${points}"/><text class="caption" x="120" y="57" text-anchor="middle">${profile.experimental ? 'PROVISIONAL TEST PROFILE' : 'APPROXIMATE SOLVER PROFILE'} · ${shapeName} nose · ${profile.bodyTaperFraction ? `taper ${(profile.bodyTaperFraction * 100).toFixed(0)}%` : 'cylindrical body'}</text>${coreSvg}</svg>
    <div class="note">${profile.calibreMm} mm diameter × ${profile.lengthMm} mm simulation length. World dimensions are converted from mm to m; camera zoom changes display only. ${htmlText(profile.basis || '')}</div>`;
  const evidence = a.international_evidence, approximation = a.solver_approximation;
  const mass = a.projectile_mass_kg == null ? 'unknown' : `${a.projectile_mass_kg} kg`;
  const velocity = a.nominal_muzzle_velocity_mps == null ? 'unknown' : `${a.nominal_muzzle_velocity_mps} m/s`;
  const simVelocity = approximation ? approximation.initial_velocity_mps : a.nominal_muzzle_velocity_mps;
  $('vel').value = simVelocity == null ? '' : simVelocity;
  $('vel').disabled = a.simulation_status === 'catalogue_only';
  const sources = a.research_source_ids.map((id) => {
    const source = R.sources.get(id);
    return source ? `<a href="${htmlText(source.url)}" target="_blank" rel="noopener">${htmlText(id)} — ${htmlText(source.title)}</a>` : htmlText(id);
  }).join('<br>');
  const status = a.simulation_status === 'catalogue_only'
    ? `<span class="warn">Catalogue entry only; physical simulation unavailable.</span> ${htmlText(a.simulation_status_reason)}`
    : a.simulation_status === 'experimental_approximation'
      ? `<span class="warn">Experimental approximation — inert effective solid body only.</span> ${htmlText(a.simulation_status_reason)}`
    : `Simulation capability: ${htmlText(a.simulation_status || 'existing approximation')}.`;
  const approximationHtml = approximation ? `<details open><summary>Experimental solver inputs (not historical specifications)</summary>
    <table class="tbl">${[
      ['model', approximation.model],
      ['simulation mass', `${approximation.mass_kg} kg — ${approximation.mass_basis}`],
      ['initial speed', `${approximation.initial_velocity_mps} m/s — ${approximation.velocity_basis}`],
      ['geometry', `${approximation.length_mm} mm length; ${approximation.nose_length_mm} mm nose — ${approximation.geometry_basis}`],
      ['material', `${approximation.material_id} — ${approximation.material_basis}`],
      ['metadata only / not simulated', approximation.metadata_only_features.join('; ')]
    ].map(([label, value]) => row(htmlText(label), htmlText(value))).join('')}</table></details>` : '';
  const evidenceHtml = evidence ? `<details><summary>Historical data and evidence</summary>
    <table class="tbl">${[
      ['country / designation', `${evidence.country} — ${evidence.designation}`],
      ['gun compatibility', evidence.gun_compatibility],
      ['source projectile mass', `${evidence.projectile_mass_value || 'unknown'} ${evidence.projectile_mass_unit || ''}; ${evidence.mass_convention}`],
      ['complete-round mass', `${evidence.complete_round_mass_value || 'unknown'} ${evidence.complete_round_mass_unit || ''}`],
      ['source velocity', `${evidence.muzzle_velocity_value || 'unknown'} ${evidence.muzzle_velocity_unit || ''}; ${evidence.velocity_kind}`],
      ['dimensions', evidence.dimensions],
      ['construction', evidence.construction],
      ['penetrator / cap', `${evidence.penetrator}; ${evidence.cap_or_nose}`],
      ['cavity / filler', `${evidence.explosive_cavity}; ${evidence.filler_value || 'unknown'} ${evidence.filler_unit || ''} ${evidence.filler_identity}`],
      ['fuze / tracer / sabot', `${evidence.fuze}; ${evidence.tracer_or_sabot}`],
      ['source confidence / effective simulation', `${evidence.confidence}; ${a.simulation_status}: ${a.simulation_status_reason}`],
      ['uncertainty / notes', `${evidence.uncertainty} ${evidence.notes}`],
      ['sources', sources]
    ].map(([label, value]) => row(htmlText(label), value === sources ? value : htmlText(value))).join('')}</table></details>` : '';
  $('ammoInfo').innerHTML = `${htmlText(a.country || 'Germany')} · ${htmlText(a.designation || a.name)} · ${htmlText(a.family)}<br>Historical record: ${htmlText(mass)} projectile mass; ${htmlText(velocity)} nominal muzzle velocity. ${htmlText(a.confidence || '')}<br>${SC.isHistorical(P, $('target').value, $('ammo').value) ? '<span>Historical pairing.</span>' : '<span class="warn">NON-HISTORICAL / comparison pairing.</span>'}<br>${htmlText(a.shape_fidelity || '')}<br>${status}${approximationHtml}${evidenceHtml}`;
  const L = SC.losMm(t.nominal_thickness_mm, t.slope_from_vertical_deg);
  $('geo').innerHTML = `${t.nominal_thickness_mm} mm ⟂ to face; ${t.slope_from_vertical_deg}° from vertical (${t.face_angle_from_horizontal_deg}° from horizontal). Horizontal LOS ${L.toFixed(1)} mm (geometry only, not a rating). Coupon face length ${t.coupon_face_length_mm} mm.<br>Research ${t.research_id}: ${t.research_record.confidence}; sources ${t.research_source_ids.join(', ')}. ${t.geometry_note} ${t.support}`;
}
// ---- simulation lifecycle (solver lives in the host: Web Worker by default, inline fallback labelled in the UI)
const INLINE_MAX = 18000; // inline (main-thread) fallback cannot keep the UI responsive above this
function build() {
  const ammo = P.ammunition[$('ammo').value];
  if (ammo.simulation_status === 'catalogue_only') {
    if (st.host) st.host.send({ t: 'pause' });
    st.buildId++;
    st.cfg = null; st.boundary = null; st.running = false; st.started = false; st.done = false; st.ready = false; st.S = null; st.age = null; st.n = 0; st.pos = null; st.pending = null; st.sel = -1;
    $('pause').disabled = true; $('pause').textContent = 'Pause'; $('fire').disabled = true;
    $('outcome').innerHTML = '<b>Catalogue entry — not simulated</b><div class="note">No ammunition-specific physical model is enabled.</div>';
    $('tele').textContent = 'Solver telemetry unavailable for this catalogue-only entry.';
    $('energy').textContent = 'Energy accounting unavailable; no simulation was run.';
    $('energyH').textContent = 'No simulation for this ammunition entry.';
    $('insp').textContent = 'No simulated particles.';
    setState('catalogue only'); st.dirty = true;
    return;
  }
  const tid = $('target').value, aid = $('ammo').value; let n = +$('quality').value;
  if (st.mode === 'inline' && n > INLINE_MAX) { n = INLINE_MAX; $('quality').value = String(INLINE_MAX); $('tierNote').textContent = 'Worker unavailable: capped at ~18k so the page stays responsive.'; }
  try {
    st.boundary = SC.resolveBoundary(P, tid, $('support').value, { supportStiffness: +$('supportK').value, supportDamping: +$('supportC').value });
    st.cfg = SC.makeConfig(P, tid, aid, { n, velocity: +$('vel').value, support: $('support').value, supportStiffness: +$('supportK').value, supportDamping: +$('supportC').value });
  } catch (error) { showErr(error); return; }
  st.running = false; st.started = false; st.done = false; st.wall = 0; st.sel = -1; st.S = null; st.ready = false; st.buildId++;
  $('pause').disabled = true; $('pause').textContent = 'Pause'; $('fire').disabled = true; setState('building…');
  st.host.send({ t: 'build', id: st.buildId, cfg: st.cfg });
}
function onBuilt(m) {
  if (m.id !== st.buildId) return;
  Object.assign(st, { n: m.n, h: m.h, dt: m.dt, nPlate: m.nPlate, dz: m.dz, buildMs: m.buildMs, S: m.S, age: m.age, ready: true, pos: m.pos, backend: m.backend });
  rend.setModel(m.n, m.h, m.mat, m.pos, m.dmg); st.pickAt = -1e9; st.insp = null;
  st.projectileProfile = SC.projectileGeometry(P, $('ammo').value);
  if (!st.userCam) fit(); st.host.send({ t: 'view', mode: +$('view').value });
  $('fire').disabled = false; setState('ready'); st.dirty = true; refresh();
}
function setState(s) { $('state').textContent = s; $('state').className = 'pill' + (s === 'running' ? ' run' : ''); }
function fit() {
  const p = st.pos; if (!p) return; let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
  for (let i = 0; i < st.n; i++) { const x = p[2 * i], y = p[2 * i + 1]; if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; }
  const vp = $('vp'), w = vp.clientWidth || 800, h = vp.clientHeight || 600;
  st.cam = { cx: (a + b) / 2, cy: (c + d) / 2, scale: 0.9 * Math.min(w / (b - a), h / (d - c)) }; st.userCam = false; st.dirty = true;
}
function onMsg(m) {
  try {
    switch (m.t) {
      case 'built': onBuilt(m); break;
      case 'snap': if (st.cfg) st.pending = m; break; // applied once per animation frame (latest wins; older buffers are returned)
      case 'stats': if (st.cfg) { st.S = m.S; st.age = m.age; st.wall = m.wall; if (m.level >= 1) st.fullAt = performance.now(); } break;
      case 'done': if (st.cfg) { st.running = false; st.done = true; setState('complete'); $('pause').disabled = true; } break;
      case 'particle': st.insp = m.p; break;
      case 'calibrated': onCalibrated(m); break;
      case 'error': showErr(new Error(m.msg)); break;
    }
  } catch (e) { showErr(e); }
}
function applySnap() {
  const m = st.pending; if (!m) return; st.pending = null; const t0 = performance.now(), back = { t: 'ret' }, tr = [];
  rend.updatePos(m.pos); if (m.dmg) { rend.updateDmg(m.dmg); back.dmg = m.dmg; tr.push(m.dmg.buffer); } if (m.spd) { rend.updateSpd(m.spd); back.spd = m.spd; tr.push(m.spd.buffer); }
  if (st.pos && st.holdPos) { back.pos = st.holdPos; tr.push(st.holdPos.buffer); } // keep newest position buffer for picking; return the previous one
  st.pos = m.pos; st.holdPos = m.pos; st.snapSim = m.time; st.dirty = true; st.rendMs = performance.now() - t0;
  st.host.send(back, st.mode === 'worker' ? tr : undefined);
}
function showErr(e) { $('err').style.display = 'flex'; $('err').textContent = 'Error: ' + (e && e.message || e); console.error(e); }
// ---- render loop (main thread only uploads snapshots and draws; it never runs solver code in worker mode)
function frame() {
  try { applySnap(); if (rend && st.cam && st.n && (st.dirty || st.running)) { draw(); st.dirty = false; } const now = performance.now(); if (now - (st.lastUi || 0) > 150) { refresh(); st.lastUi = now; } }
  catch (e) { showErr(e); return; }
  requestAnimationFrame(frame);
}
// ---- drawing
const gridC = $('grid'), glC = $('gl'), shapeC = $('shapeOverlay'), g2 = gridC.getContext('2d'), shape2 = shapeC.getContext('2d');
function resize() { const vp = $('vp'), r = devicePixelRatio || 1, w = vp.clientWidth, h = vp.clientHeight; for (const c of [gridC, glC, shapeC]) { c.width = Math.round(w * r); c.height = Math.round(h * r); } }
function draw() {
  const r = devicePixelRatio || 1, W = glC.width, H = glC.height, cam = st.cam, sc = cam.scale * r;
  rend.draw({ cx: cam.cx, cy: cam.cy, scale: sc }, +$('view').value, st.cfg[8], W, H);
  shape2.clearRect(0, 0, W, H);
  if (st.projectileProfile && st.pos && st.nPlate < st.n && !st.started) {
    let cx = 0, cy = 0, count = 0;
    for (let i = st.nPlate; i < st.n; i++) { cx += st.pos[2 * i]; cy += st.pos[2 * i + 1]; count++; }
    cx /= count; cy /= count;
    const points = SC.projectileSilhouette(st.projectileProfile, 48);
    shape2.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = (points[i][0] + cx - cam.cx) * sc + W / 2;
      const y = -(points[i][1] + cy - cam.cy) * sc + H / 2;
      if (i === 0) shape2.moveTo(x, y); else shape2.lineTo(x, y);
    }
    shape2.closePath(); shape2.lineWidth = 1.5 * r; shape2.strokeStyle = '#ffd27a'; shape2.stroke();
  }
  g2.clearRect(0, 0, W, H); g2.lineWidth = 1;
  const wx = (px) => (px - W / 2) / sc + cam.cx, wy = (py) => -(py - H / 2) / sc + cam.cy, sx = (x) => (x - cam.cx) * sc + W / 2, sy = (y) => -(y - cam.cy) * sc + H / 2;
  let step = 1e-4; for (const m of [1, 2, 5]) { /* placeholder to keep lint quiet */ } const ladder = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2]; step = ladder.find((v) => v * sc >= 40 * r) || 2;
  g2.strokeStyle = 'rgba(255,255,255,0.05)'; g2.beginPath();
  for (let x = Math.ceil(wx(0) / step) * step; x < wx(W); x += step) { g2.moveTo(sx(x), 0); g2.lineTo(sx(x), H); }
  for (let y = Math.ceil(wy(H) / step) * step; y < wy(0); y += step) { g2.moveTo(0, sy(y)); g2.lineTo(W, sy(y)); }
  g2.stroke();
  const bar = step * sc; g2.strokeStyle = '#8a929c'; g2.fillStyle = '#8a929c'; g2.font = `${11 * r}px system-ui`;
  g2.beginPath(); g2.moveTo(16 * r, H - 18 * r); g2.lineTo(16 * r + bar, H - 18 * r); g2.stroke(); g2.fillText((step * 1000) + ' mm', 16 * r, H - 24 * r);
  if (st.sel >= 0 && st.pos) { g2.strokeStyle = '#fff'; g2.lineWidth = 1.5 * r; g2.beginPath(); g2.arc(sx(st.pos[2 * st.sel]), sy(st.pos[2 * st.sel + 1]), Math.max(6 * r, st.h * sc), 0, 7); g2.stroke(); }
  const h = st.h * 1000, px = st.h * cam.scale;
  $('legend').textContent = `particle spacing ${h.toFixed(2)} mm · ${px.toFixed(1)} px/particle · ` + (px < 3.2 ? 'sub-pixel regime: dots merged (1.7 px floor)' : 'discrete particles');
}
// ---- panels
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const htmlText = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function syncSupportControls() {
  const model = SC.resolveBoundary(P, $('target').value, $('support').value);
  const compliant = model.model_type === 'compliant_foundation';
  $('supportParams').style.display = compliant ? 'block' : 'none';
  if (compliant) {
    $('supportK').value = model.foundationStiffnessPaPerM;
    $('supportC').value = model.foundationDampingPaSPerM;
  }
  $('supportParamNote').textContent = compliant ? `CSV reference: ${model.source_reference}; ${model.confidence}. Per-area coefficients are multiplied by h·dz per node.` : '';
  $('supportDescription').textContent = `${model.notes} ${model.uncertainty} Target: ${$('target').value}. Source/status: ${model.source_reference}; ${model.confidence}.`;
}
function showReferences(ammoId) {
  const curves = R.referenceCurves.filter((curve) => curve.ammo_id === P.ammunition[ammoId].research_id);
  if (!curves.length) { $('reference').textContent = 'No source curve in this research pack for this exact ammunition variant.'; return; }
  const grouped = new Map();
  for (const curve of curves) {
    if (!grouped.has(curve.curve_id)) grouped.set(curve.curve_id, []);
    grouped.get(curve.curve_id).push(curve);
  }
  const blocks = [];
  for (const [id, points] of grouped) {
    const first = points[0].reported;
    const source = R.sources.get(first.source_id);
    const rows = points.map((point) => `<tr><td>${htmlText(point.range_m == null ? point.reported.range_m : point.range_m)} m</td><td>${htmlText(point.penetration_mm == null ? point.reported.reported_penetration_mm : point.penetration_mm)} mm</td></tr>`).join('');
    blocks.push(`<b>${htmlText(id)}</b> · ${htmlText(first.source_id)} (${htmlText(source.evidence_grade)})<br>${htmlText(source.title)}<br>${htmlText(first.source_angle_wording)}; ${htmlText(first.target_hardness_reported)}; ${htmlText(first.perforation_criterion_reported)}<br>${htmlText(first.notes)}<table class="tbl">${rows}</table>`);
  }
  $('reference').innerHTML = '<span class="warn">Reference only — never used to determine a solver outcome.</span><br>' + blocks.join('<hr>');
}
function refresh() {
  const S = st.S; if (!S) return; const t = P.targets[$('target').value], a = P.ammunition[$('ammo').value];
  const supportLabel = st.boundary ? `${st.boundary.model_type} (${st.boundary.model_id})` : `unsupported mode ${S[44]}`;
  $('scenario').textContent = `${t.name} · ${a.name}` + (SC.isHistorical(P, $('target').value, $('ammo').value) ? '' : ' · NON-HISTORICAL');
  $('backend').textContent = 'engine: ' + (st.backend === 'WASM' ? 'Rust/WASM' : 'JS reference (' + (window.ARMORLAB_WASM_B64 ? 'WASM not active' : 'no WASM in this build') + ')') + ' · solver: ' + (st.mode === 'worker' ? 'Web Worker' : 'main thread (fallback)');
  showReferences($('ammo').value);
  const o = SC.classify(S, st.cfg[8]); const A = st.age || {}, us = (v) => (v * 1e6).toFixed(0) + ' µs';
  $('outcome').innerHTML = `<b>${o.label}${st.done ? '' : (st.started ? ' (live, run not finished)' : '')}</b><div class="note">${o.detail}</div>`;
  $('tele').innerHTML = row('sim time', fmt(S[0] * 1e6, 1) + ' µs') + row('wall-clock run', fmt(st.wall, 1) + ' s') + row('particles (all active)', S[2]) + row('plate / projectile', `${S[29]} / ${S[30]}`) +
    row('bonds intact / total', `${S[16] - S[17]} / ${S[16]}`) + row('mean / max plate disp.', `${fmt(S[18] * 1000)} / ${fmt(S[19] * 1000)} mm`) + row('fragments (count / particles) <span class="note">as of ' + (A.fragStep < 0 ? 'n/a' : us(A.fragTime || 0)) + '</span>', `${S[20]} / ${S[21]}`) +
    row('boundary model (target / solver)', `${htmlText(st.boundary ? st.boundary.selected_target_id : '')} / ${htmlText(supportLabel)}`) +
    row('boundary evidence / uncertainty', htmlText(st.boundary ? `${st.boundary.source_reference}; ${st.boundary.user_override ? 'user override (uncalibrated)' : st.boundary.confidence}; ${st.boundary.uncertainty}` : 'unknown')) +
    row('active foundation coefficients', `${fmt(S[55])} Pa/m; ${fmt(S[56])} Pa·s/m`) +
    row('support-region nodes / constrained DOF', `${S[45]} / ${S[46]}`) +
    row('support reaction x, y / resultant', `${fmt(S[47])}, ${fmt(S[48])} / ${fmt(S[49])} N`) +
    row('support impulse x, y', `${fmt(S[36])}, ${fmt(S[37])} N·s`) +
    row('momentum balance error x, y', `${fmt(S[53])}, ${fmt(S[54])} kg·m/s`) +
    row('projectile centroid v', fmt(S[22], 1) + ' m/s') + row('total momentum x, y', `${fmt(S[33])}, ${fmt(S[34])} kg·m/s`) + row('mass behind rear face', fmt(S[24] * 100, 1) + ' %') + row('max depth from front face', fmt(S[25] * 1000, 1) + ' mm') +
    row('dt / spacing h', `${(S[5] * 1e9).toFixed(0)} ns / ${(S[3] * 1000).toFixed(2)} mm`) + row('out-of-plane depth dz', fmt(S[4] * 1000, 1) + ' mm') + row('steps', S[1]);
  $('energyH').textContent = 'Energy accounting (J; damping estimated) — as of ' + (A.energyStep < 0 ? 'n/a' : us(A.energyTime || 0) + ' sim time (refreshed ~1 Hz / on pause)'); $('energy').innerHTML = row('kinetic (measured)', fmt(S[6])) + row('recoverable elastic bond energy (calculated)', fmt(S[7])) + row('isotropic hardening energy (calculated)', fmt(S[35])) + row('cumulative plastic dissipation (calculated)', fmt(S[8])) + row('released bond energy assigned to fracture (calculated)', fmt(S[9])) + row('contact potential (calculated)', fmt(S[10])) +
    row('bond viscous damping loss (estimated)', fmt(S[32])) + row('support external work', fmt(S[50])) +
    row('support elastic energy', fmt(S[51])) + row('support damping loss', fmt(S[52])) +
    `<tr class="sum"><td>accounted total</td><td>${fmt(S[12])}</td></tr>` + row('initial KE', fmt(S[13])) + row('unaccounted residual (diagnostic)', `${fmt(S[14])} (${fmt(S[15] * 100)} %)`);
  const w = [];
  if (!SC.isHistorical(P, $('target').value, $('ammo').value)) w.push('<span class="warn">Comparison mode: round/gun not historically paired with this plate.</span>');
  if (Math.abs(S[15]) > 0.05) w.push('<span class="bad">Unaccounted energy residual above 5%: numerical and model energy paths are not closed; do not interpret this as energy conservation.</span>');
  w.push(st.cfg[10] >= 0.5 ? 'Plasticity: 1D isotropic-hardening return map (uncalibrated).' : 'Plasticity: legacy rest-length update (uncalibrated).');
  w.push('Materials PROVISIONAL (not plate-specific); projectile shape APPROXIMATE; kinetic-only (no fuze/filler); 2D slab model. Not a 1:1 ballistic prediction.');
  w.push(`Build ${window.ARMORLAB_BUILD}; scenario build ${st.buildMs.toFixed(0)} ms; upload last frame ${st.rendMs.toFixed(1)} ms.`);
  $('warn').innerHTML = w.join('<br>');
  if (st.sel >= 0 && st.insp && st.insp.id === st.sel) { const p = st.insp; $('insp').innerHTML = '<table class="tbl">' + row('particle id', p.id) + row('material ID', p.mat) + row('constraint', p.fixed ? 'clamped (fixed)' : 'free') + row('x, y', `${fmt(p.x * 1000, 1)}, ${fmt(p.y * 1000, 1)} mm`) + row('vx, vy', `${fmt(p.vx, 1)}, ${fmt(p.vy, 1)} m/s`) + row('mass', fmt(p.mass * 1000, 2) + ' g') + row('damage (broken/total bonds)', `${fmt(p.damage, 2)} (${p.bondsBroken}/${p.bondsTotal})`) + row('stress / strain', 'not computed') + '</table>'; if (st.running) st.host.send({ t: 'particle', i: st.sel, req: 0 }); }
}
// ---- interaction
glC.addEventListener('wheel', (e) => { e.preventDefault(); const r = devicePixelRatio || 1, b = glC.getBoundingClientRect(), c = st.cam; const px = (e.clientX - b.left) * r, py = (e.clientY - b.top) * r, W = glC.width, H = glC.height;
  const f = Math.exp(-e.deltaY * 0.0015), ns = c.scale * f; const wx = (px - W / 2) / (c.scale * r) + c.cx, wy = -(py - H / 2) / (c.scale * r) + c.cy;
  c.scale = ns; c.cx = wx - (px - W / 2) / (ns * r); c.cy = wy + (py - H / 2) / (ns * r); st.userCam = true; }, { passive: false });
let drag = null;
glC.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; glC.setPointerCapture(e.pointerId); });
glC.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; if (drag.moved) { st.cam.cx -= dx / st.cam.scale; st.cam.cy += dy / st.cam.scale; drag.x = e.clientX; drag.y = e.clientY; st.userCam = true; } });
glC.addEventListener('pointerup', (e) => { if (drag && !drag.moved && st.pos) { const b = glC.getBoundingClientRect(), c = st.cam, wx = (e.clientX - b.left - b.width / 2) / c.scale + c.cx, wy = -(e.clientY - b.top - b.height / 2) / c.scale + c.cy;
  const t = performance.now(); if (!st.pickIdx.n || t - st.pickAt > (st.running ? 500 : 1e12) || st.pickGen !== st.buildId) { st.pickIdx.build(st.pos, st.n, st.h); st.pickAt = t; st.pickGen = st.buildId; }
  const R = Math.max(3 * st.h, 12 / c.scale), best = st.pickIdx.nearest(st.pos, wx, wy, R, st.running ? 2 * st.h : 0);
  st.sel = best; if (st.sel < 0) { $('insp').textContent = 'Click a particle.'; st.insp = null; } else st.host.send({ t: 'particle', i: st.sel, req: 1 }); st.dirty = true; setTimeout(refresh, 30); } drag = null; });
$('fire').onclick = () => { if (st.started || !st.ready) return; st.host.send({ t: 'fire' }); st.started = true; st.running = true; $('fire').disabled = true; $('pause').disabled = false; setState('running'); st.host.send({ t: 'play', rate: +$('speed').value, tEnd: st.T_END }); };
$('pause').onclick = () => { if (st.done) return; st.running = !st.running; $('pause').textContent = st.running ? 'Pause' : 'Resume'; setState(st.running ? 'running' : 'paused'); st.host.send(st.running ? { t: 'play', rate: +$('speed').value, tEnd: st.T_END } : { t: 'pause' }); };
$('speed').onchange = () => { if (st.running) st.host.send({ t: 'play', rate: +$('speed').value, tEnd: st.T_END }); };
$('view').onchange = () => { st.host.send({ t: 'view', mode: +$('view').value }); st.dirty = true; };
$('reset').onclick = () => build();
$('fit').onclick = () => fit();
$('calib').onclick = () => { if (st.running) return; $('tierNote').textContent = 'Calibrating (~1 s)…'; const c = SC.makeConfig(P, $('target').value, $('ammo').value, { n: 5000, velocity: +$('vel').value, support: $('support').value, supportStiffness: +$('supportK').value, supportDamping: +$('supportC').value }); st.host.send({ t: 'calibrate', cfg: c }); };
// tier advice: ms/step is measured at ~5k particles; larger tiers are EXTRAPOLATED (cost/step ~ N, dt ~ 1/sqrt(N)) - labelled as estimates, never as measurements.
function onCalibrated(m) {
  st.calib = m; const tiers = [[3000, 'Draft'], [18000, 'Standard'], [100000, 'High'], [250000, 'Extreme'], [1000000, 'Experimental']], lines = []; let rec = null;
  for (const [n, name] of tiers) { const ms = m.msPerStep * n / m.n, dt = m.dt * Math.sqrt(m.n / n), est = st.T_END / dt * ms / 1000; lines.push(`${name} ~${n >= 1e6 ? '1M' : n >= 1e3 ? n / 1e3 + 'k' : n}: ~${est < 90 ? est.toFixed(0) + ' s' : est < 5400 ? (est / 60).toFixed(0) + ' min' : (est / 3600).toFixed(1) + ' h'}`); if (est <= 60) rec = name; }
  $('tierNote').innerHTML = `Measured ${m.msPerStep.toFixed(2)} ms/step at ${m.n} particles (${m.backend}; spread ${m.spread[0].toFixed(2)}–${m.spread[1].toFixed(2)}). <b>Estimated</b> full 600 µs run (extrapolated, not measured): ${lines.join(' · ')}. ` + (rec ? `Largest tier estimated ≤ 60 s: <b>${rec}</b>.` : 'No tier estimated under 60 s.') + ' Estimates ignore fracture/contact growth and render cost.';
  build();
}
for (const id of ['quality']) $(id).onchange = () => build();
syncSupportControls();
$('support').onchange = () => { syncSupportControls(); build(); };
for (const id of ['supportK', 'supportC']) $(id).onchange = () => { if ($('support').value === 'compliant_foundation') build(); };
$('vel').onchange = () => build();
$('target').onchange = () => { syncAmmo(); syncSupportControls(); build(); };
$('ammo').onchange = () => { syncAmmo(); build(); };
$('cmp').onchange = () => { syncAmmo(); build(); };
window.addEventListener('resize', () => { resize(); if (!st.userCam && st.pos) fit(); st.dirty = true; });
// ---- boot
let rend = null;
(async function boot() {
  try {
    syncAmmo(); resize(); rend = new window.ALRenderer(glC);
    st.host = new window.ALHost(onMsg); const info = await st.host.start(window.ARMORLAB_WASM_B64, /[?&]inline=1/.test(location.search));
    st.mode = info.mode; st.backend = info.backend; st.engineNote = info.note; st.hostNote = info.hostNote;
    if (info.hostNote) console.warn('ArmorLab host:', info.hostNote); if (info.note) console.info('ArmorLab engine:', info.note);
    window.__armorlab = st; // exposed for smoke tests
    build(); requestAnimationFrame(frame);
  } catch (e) { showErr(e); }
})();
})();
