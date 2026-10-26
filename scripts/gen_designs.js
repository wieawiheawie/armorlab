#!/usr/bin/env node
// Developer tool: regenerates designs/builtin_designs.json (the shipped, data-only cell templates) from parametric outlines.
// The renderer never calls this; it only reads the generated JSON. Re-running reproduces the file byte-for-byte.
// Every outline here is a VISUAL APPROXIMATION informed by the research pack; each design lists which features are documented,
// approximate, or deliberately not drawn. No dimension below is claimed as a measured historical contour.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const P = JSON.parse(fs.readFileSync(path.join(root, 'presets/presets.json'), 'utf8'));
const MAT = {
  body: 'MAT_STEEL_HARDENED_AP', steel: 'MAT_STEEL_ASSUMED', cap: 'MAT_STEEL_CAP_PROVISIONAL', wind: 'MAT_STEEL_WINDSCREEN_PROVISIONAL',
  wc: 'MAT_TUNGSTEN_CARBIDE_CORE', ua: 'MAT_UNVERIFIED_PRIMARY', ub: 'MAT_UNVERIFIED_SECONDARY'
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/* tangent-ogive radius at distance xp from the ogive base; Lf = length to the (virtual) sharp point; truncated where the nose ends */
const ogive = (xp, Rb, Lf) => { const rho = (Rb * Rb + Lf * Lf) / (2 * Rb); return Math.max(0, Math.sqrt(Math.max(0, rho * rho - xp * xp)) + Rb - rho); };
const feature = (name, status, note) => ({ name, status, note });
/* Shared APCBC-style layout: cylindrical body with proud driving band, ogival nose; outer shell = windscreen, inner = body then AP cap (visual partition only). */
function apcbc(o) {
  const R = o.cal / 2, rb = R - o.relief, xs = o.L - o.nose;
  const profile = (x) => {
    if (x < 0 || x > o.L) return 0;
    let r;
    if (x >= xs) r = ogive(x - xs, rb, o.lf); else r = rb;
    if (x >= o.band[0] && x <= o.band[1]) r = Math.max(r, R);
    if (x < o.chamfer) r = Math.min(r, rb - (o.chamfer - x) * 0.6);
    return r;
  };
  const mat = (x, y, r) => {
    if (x >= o.band[0] && x <= o.band[1] && Math.abs(y) > rb - 0.01) return 'ub';
    if (x >= xs) {
      const u = (x - xs) / o.nose;
      if (Math.abs(y) > r - o.shell) return 'wind';
      if (o.cap && u > o.capFrom) return 'cap';
      return o.bodyKey;
    }
    return o.bodyKey;
  };
  return { profile, mat };
}
function make(spec) {
  const cal = spec.cal, L = spec.L, cell = spec.cell, cols = Math.ceil(L / cell), rows = 2 * Math.ceil(cal / 2 / cell);
  const used = new Set(), grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * cell, y = (r + 0.5 - rows / 2) * cell, pr = spec.profile(x);
      if (pr > 0 && Math.abs(y) <= pr) { const k = spec.mat(x, y, pr); used.add(k); row.push(MAT[k]); } else row.push(null);
    }
    grid.push(row);
  }
  const ids = Array.from(new Set(grid.flat().filter(Boolean))).sort(), chars = 'abcdefghijklmnop', legend = { '.': null };
  ids.forEach((id, i) => { legend[chars[i]] = id; });
  const inv = Object.fromEntries(Object.entries(legend).filter(([, v]) => v).map(([k, v]) => [v, k]));
  return {
    schema: 'armorlab-design-1', id: spec.id, template_id: spec.id, name: spec.name, ammo_id: spec.ammo, builtin: true, based_on: null,
    orientation: 'axis horizontal, base at left (column 0), nose at right; row 0 is the top',
    grid: { cols, rows, cell_mm: cell }, envelope: { calibre_mm: cal, length_mm: L },
    legend, rows: grid.map((row) => row.map((id) => (id ? inv[id] : '.')).join('')),
    provenance: { basis: spec.basis, visual_status: 'VISUAL APPROXIMATION: outline and region partition are not traced from a technical drawing; unknown dimensions are not claimed.', features: spec.features, solver_note: spec.solverNote, source_ids: spec.sources }
  };
}
const A = P.ammunition, designs = [];
const solverNoteEffective = (id) => `The solver still runs the effective ${A[id].calibre_mm} mm solid-body envelope from presets (${(A[id].solver_approximation || A[id]).length_mm} mm long). This design is the catalogue/viewport visual; its cells do not become solver particles.`;

// 1. Pzgr.39 (8.8 cm KwK 36)
{
  const o = { cal: 88, L: 250, nose: 100, lf: 128, relief: 1.2, band: [22, 34.3], chamfer: 3, shell: 4, cap: true, capFrom: 0.38, bodyKey: 'body' }, g = apcbc(o);
  designs.push(make({ id: 'DSG_DE_88_PZGR39', name: '8.8 cm Pzgr.39 (APCBC-HE-T)', ammo: 'TIGER1_PZGR39', cal: 88, L: 250, cell: 2, profile: g.profile, mat: g.mat, sources: ['S04', 'S05', 'S07', 'S09'],
    basis: 'Documented APCBC layout (AP cap + separate ballistic wind cap + base fuze, hardened steel body) drawn at the preset 88 mm x 250 mm envelope. Driving-band width 12.3 mm is the recorded value; all other proportions are estimates.',
    features: [feature('hardened steel body', 'documented', 'material class documented; grade unknown'), feature('AP cap', 'approximate', 'existence documented; size/material not found - drawn as inner forward nose region'), feature('ballistic wind cap', 'approximate', 'existence documented; thickness and shape not found'), feature('driving band', 'documented', 'width 12.3 mm recorded in presets; position and material not found - material shown as unverified'), feature('base fuze, filler, tracer cavity', 'not_drawn', 'present in documented variants but no geometry available; no cavity drawn')],
    solverNote: solverNoteEffective('TIGER1_PZGR39') }));
}
// 2. Pzgr.39/43 (8.8 cm KwK 43)
{
  const o = { cal: 88, L: 250, nose: 100, lf: 128, relief: 1.2, band: [20, 37.8], chamfer: 3, shell: 4, cap: true, capFrom: 0.38, bodyKey: 'body' }, g = apcbc(o);
  designs.push(make({ id: 'DSG_DE_88_PZGR39_43', name: '8.8 cm Pzgr.39/43 (APCBC-HE)', ammo: 'TIGER2_PZGR3943', cal: 88, L: 250, cell: 2, profile: g.profile, mat: g.mat, sources: ['S04', 'S05', 'S08', 'S09'],
    basis: 'Secondary sources describe Pzgr.39/43 as the Pzgr.39-1 body with wider driving bands (about 17.8 mm vs 12.3 mm). The only drawn difference from DSG_DE_88_PZGR39 is therefore the wider band; no other difference is evidenced.',
    features: [feature('hardened steel body', 'documented', 'same body as Pzgr.39-1 per secondary sources'), feature('wider driving band', 'documented', '~17.8 mm (secondary source)'), feature('AP cap and wind cap', 'approximate', 'as Pzgr.39; a changed windscreen is reported on a forum only and is NOT drawn'), feature('base fuze, filler', 'not_drawn', 'no geometry available')],
    solverNote: solverNoteEffective('TIGER2_PZGR3943') }));
}
// 3. Pzgr.40/43 APCR
{
  const R = 44, rb = R - 1.2, L = 250, nose = 80, xs = L - nose, lf = 86, band = [18, 30], coreD = 45, coreL = 160;
  designs.push(make({ id: 'DSG_DE_88_PZGR40_43_APCR', name: '8.8 cm Pzgr.40/43 (APCR)', ammo: 'TIGER2_PZGR4043', cal: 88, L: 250, cell: 2, sources: ['S04', 'S05', 'S08', 'S31'],
    profile: (x) => { if (x < 0 || x > L) return 0; let r = x >= xs ? ogive(x - xs, rb, lf) : rb; if (x >= band[0] && x <= band[1]) r = Math.max(r, R); if (x < 3) r = Math.min(r, rb - (3 - x) * 0.6); return r; },
    mat: (x, y, r) => { if (x >= band[0] && x <= band[1] && Math.abs(y) > rb - 0.01) return 'ub'; if (L - x <= coreL && Math.abs(y) <= coreD / 2) return 'wc'; return 'steel'; },
    basis: 'Full-calibre APCR body with a sharp ogival nose and NO separate cap, windscreen or sabot (none documented). The tungsten-carbide core region reproduces the solver\'s own estimated core (45 mm x 160 mm, measured back from the nose tip), which is an ArmorLab estimate and not Pzgr.40/43 data.',
    features: [feature('full-calibre carrier body', 'documented', 'tungsten-carbide core in a lighter body is documented; carrier steel identity is an assumption'), feature('tungsten-carbide core', 'approximate', 'dimensions are the solver estimate; TM 9-1985-3 Type 40 core was 35.7 x 138.1 mm and is not asserted for Pzgr.40/43'), feature('driving band', 'approximate', 'position/width not found; material unverified'), feature('sabot / carrier discard', 'not_drawn', 'APCR has none; no sabot is depicted'), feature('cap / windscreen, tracer', 'not_drawn', 'not documented for this record')],
    solverNote: 'The solver models a coaxial core/carrier body inside the preset envelope (250 mm long, 55 mm pointed nose). The core region here matches that model; the sharper 80 mm drawn ogive is a visual approximation and differs from the solver envelope nose.' }));
}
// 4. US 76 mm M62 APC-T
{
  const o = { cal: 76, L: 190, nose: 62, lf: 80, relief: 1.0, band: [14, 24], chamfer: 2, shell: 3, cap: true, capFrom: 0.4, bodyKey: 'steel' }, g = apcbc(o);
  designs.push(make({ id: 'DSG_US_76_M62_APCT', name: '76 mm M62 APC-T', ammo: 'US_76_M62_APCT', cal: 76, L: 190, cell: 1.5, profile: g.profile, mat: g.mat, sources: ['S35'],
    basis: 'Firing Test No. 3 transcription reports an armour-piercing cap, windshield, base fuze and tracer. Cap/windshield proportions, band position and body material are estimates.',
    features: [feature('AP cap', 'approximate', 'reported; size not available - drawn as inner forward nose region'), feature('windshield', 'approximate', 'reported; shape not available'), feature('driving band', 'approximate', 'not documented in the extracted record; material unverified'), feature('body material', 'approximate', 'assumed steel (solver generic body)'), feature('base fuze, tracer, possible filler', 'not_drawn', 'reported but no geometry; no cavity drawn')],
    solverNote: solverNoteEffective('US_76_M62_APCT') }));
}
// 5. US 90 mm M82 APC-T
{
  const o = { cal: 90, L: 225, nose: 78, lf: 98, relief: 1.0, band: [16, 29], chamfer: 2, shell: 3, cap: true, capFrom: 0.42, bodyKey: 'steel' }, g = apcbc(o);
  designs.push(make({ id: 'DSG_US_90_M82_APCT', name: '90 mm M82 APC-T', ammo: 'US_90_M82_APCT', cal: 90, L: 225, cell: 1.5, profile: g.profile, mat: g.mat, sources: ['S36'],
    basis: 'FAMILY-LEVEL drawing only: the handbook entry was not extracted, so the APC-T designation (cap + windshield + tracer family) is the sole basis. It shares the layout idea of the M62 but has its own 90 mm cell data and a longer, sharper ogive; the difference is a design choice, not a documented measurement.',
    features: [feature('AP cap / windshield', 'approximate', 'implied by the APC-T designation only'), feature('driving band', 'approximate', 'not extracted'), feature('body material', 'approximate', 'assumed steel'), feature('dimensions, fuze, filler, tracer', 'not_drawn', 'unknown')],
    solverNote: solverNoteEffective('US_90_M82_APCT') }));
}
// 6. Soviet 122 mm BR-471 APHE
{
  const o = { cal: 122, L: 305, nose: 118, lf: 118, relief: 1.5, band: [26, 50], chamfer: 4, shell: 0, cap: false, bodyKey: 'steel' }, g = apcbc(o);
  designs.push(make({ id: 'DSG_SU_122_BR471_APHE', name: '122 mm BR-471 APHE', ammo: 'SU_122_BR471_APHE', cal: 122, L: 305, cell: 2, profile: g.profile, mat: (x, y, r) => (x >= o.band[0] && x <= o.band[1] && Math.abs(y) > 122 / 2 - 1.5 - 0.01 ? 'ub' : 'steel'), sources: ['S37','S38'],
    basis: 'Source describes a sharp-nose armour-piercing projectile with no separate cap reported, so the nose is drawn as one solid sharp ogive with no cap or windscreen. Proportions and the single wide band are estimates.',
    features: [feature('sharp nose, no separate cap', 'documented', 'secondary transcription: sharp nose; separate cap not reported'), feature('driving band', 'approximate', 'width/position not documented; material unverified'), feature('HE filler / MD-8 fuze', 'not_drawn', 'filler mass and fuze designation reported; no geometry, no cavity drawn'), feature('body material', 'approximate', 'assumed steel')],
    solverNote: solverNoteEffective('SU_122_BR471_APHE') }));
}
// 7. Soviet 122 mm BR-471B APHEBC
{
  const o = { cal: 122, L: 317.2, nose: 128, lf: 140, relief: 1.5, band: [26, 50], chamfer: 4, shell: 4, cap: false, bodyKey: 'steel' }, g = apcbc(o), xs = o.L - o.nose;
  designs.push(make({ id: 'DSG_SU_122_BR471B_APHEBC', name: '122 mm BR-471B APHEBC', ammo: 'SU_122_BR471B_APHEBC', cal: 122, L: 317.2, cell: 2, profile: g.profile, sources: ['S37','S38'],
    mat: (x, y, r) => { if (x >= o.band[0] && x <= o.band[1] && Math.abs(y) > 122 / 2 - 1.5 - 0.01) return 'ub'; if (x >= xs + 0.52 * o.nose) return 'wind'; return 'steel'; },
    basis: 'Kept distinct from BR-471: a ballistic cap is implied by the APHEBC family name, so the front of the nose is a separate cap region with a slightly blunter tip. The cap length, thickness and any step at its joint are unknown.',
    features: [feature('ballistic cap', 'approximate', 'implied by designation; dimensions/material unknown'), feature('driving band', 'approximate', 'not documented; material unverified'), feature('HE filler, MD-8 / DBR fuze', 'not_drawn', 'designations reported; no geometry'), feature('body material', 'approximate', 'assumed steel')],
    solverNote: solverNoteEffective('SU_122_BR471B_APHEBC') }));
}
// 8. China 100 mm Type 73 APDS (in-bore assembly appearance; all dimensions unknown)
{
  const R = 50, L = 250, pr = 17, taperFrom = 140, taperTo = 178, noseR = 25;
  designs.push(make({ id: 'DSG_CN_100_TYPE73_APDS', name: '100 mm Type 73 APDS', ammo: 'CN_100_TYPE73_APDS', cal: 100, L: 250, cell: 2, sources: ['S39','S40'],
    profile: (x) => { if (x < 0 || x > L) return 0; let r; if (x <= taperFrom) r = R - 1.2; else if (x <= taperTo) r = (R - 1.2) + (noseR - (R - 1.2)) * ((x - taperFrom) / (taperTo - taperFrom)); else r = ogive(x - taperTo, noseR, (L - taperTo) * 1.08); if (x >= 14 && x <= 26) r = Math.max(r, R); return r; },
    mat: (x, y) => { if (x >= 14 && x <= 26 && Math.abs(y) > R - 1.21) return 'ub'; if (Math.abs(y) <= pr || x > taperTo) return 'ua'; return 'ub'; },
    basis: 'Pre-fire in-bore APDS assembly: a full-calibre discarding sabot around a narrower penetrator whose forward end protrudes. The designation implies a sabot but the record gives no dimensions, so the sabot taper, penetrator radius and ballistic cap are ALL estimates; both component materials are unverified.',
    features: [feature('discarding sabot', 'approximate', 'implied by the APDS designation; assembly unknown'), feature('sub-calibre penetrator', 'approximate', 'implied by APDS; material (steel / tungsten) and dimensions unverified'), feature('driving band on sabot', 'approximate', 'not documented'), feature('post-discard flight form', 'not_drawn', 'sabot separation is not depicted and is not simulated')],
    solverNote: 'The solver runs this entry as a full-calibre inert effective solid body (250 mm, 70 mm nose). It does NOT simulate the penetrator, sabot or discard; the design is visual only and differs strongly from the solver envelope.' }));
}
// 9. China 100 mm Type 73 HEAT-FS (fin-stabilised appearance; all dimensions unknown)
{
  const R = 50, L = 250, rb = R - 1.2, boom = 14, noseLen = 78, xs = L - noseLen, finEnd = 56;
  designs.push(make({ id: 'DSG_CN_100_TYPE73_HEATFS', name: '100 mm Type 73 HEAT-FS', ammo: 'CN_100_TYPE73_HEATFS', cal: 100, L: 250, cell: 2, sources: ['S39','S40'],
    profile: (x) => { if (x < 0 || x > L) return 0; if (x < finEnd) { const h = x < 20 ? R * 0.94 : boom + (R * 0.94 - boom) * (1 - (x - 20) / (finEnd - 20)); return Math.max(boom, h); } if (x < finEnd + 6) return boom + (rb - boom) * ((x - finEnd) / 6); if (x >= xs) return ogive(x - xs, rb, noseLen * 1.18); return rb; },
    mat: (x, y, r) => { if (x < finEnd + 2) return Math.abs(y) <= boom ? 'ua' : 'ub'; return 'ua'; },
    basis: 'Fin stabilisation is implied by the "-FS" designation, so a tail boom with swept fins is drawn at the preset 100 mm x 250 mm envelope with a blunt ogival warhead. Fin count/size, any standoff probe, liner and fuze are unknown and are NOT drawn.',
    features: [feature('fin-stabilised tail', 'approximate', 'implied by designation; fin count, span and shape unknown'), feature('shaped-charge warhead body', 'approximate', 'HEAT family; cavity/liner construction unknown'), feature('standoff probe, liner, fuze', 'not_drawn', 'not documented'), feature('body material', 'approximate', 'unverified')],
    solverNote: 'The solver runs this entry as an inert solid body: no detonation, liner collapse, jet, standoff or fins. The design is visual only; the drawn tail is not part of the solver envelope.' }));
}
// 10. Sweden 57 mm slpgr m/43 APHEBC
{
  const o = { cal: 57, L: 142.5, nose: 56, lf: 66, relief: 0.8, band: [11, 18.5], chamfer: 2, shell: 2.5, cap: false, bodyKey: 'steel' }, g = apcbc(o), xs = o.L - o.nose;
  designs.push(make({ id: 'DSG_SE_57_SLPGR_M43', name: '57 mm slpgr m/43 APHEBC', ammo: 'SE_57_SLPGR_M43', cal: 57, L: 142.5, cell: 1, profile: g.profile, sources: ['S41','S42'],
    mat: (x, y, r) => { if (x >= o.band[0] && x <= o.band[1] && Math.abs(y) > 57 / 2 - 0.8 - 0.01) return 'ub'; if (x >= xs && Math.abs(y) > r - o.shell) return 'wind'; if (x >= xs + 0.55 * o.nose) return 'wind'; return 'steel'; },
    basis: 'A ballistic cap is implied by the APHEBC designation; the article does not give the exact shell designation or any dimension. Slim long ogive with a front cap region drawn from the designation only.',
    features: [feature('ballistic cap', 'approximate', 'implied by designation; dimensions/material unknown'), feature('driving band', 'approximate', 'not documented'), feature('HE filler, fuze', 'not_drawn', 'not verified'), feature('body material', 'approximate', 'assumed steel')],
    solverNote: solverNoteEffective('SE_57_SLPGR_M43') }));
}
// 11. Italy 90/53 Cartoccio Granata Perforante Mod. 1909
{
  const o = { cal: 90, L: 225, nose: 70, lf: 70 * 1.55, relief: 1.2, band: [18, 30], chamfer: 3, shell: 0, cap: false, bodyKey: 'steel' }, g = apcbc(o);
  designs.push(make({ id: 'DSG_IT_90_53_CGP', name: '90 mm Cartoccio Granata Perforante Mod. 1909', ammo: 'IT_90_53_CGP', cal: 90, L: 225, cell: 1.5, profile: g.profile, sources: ['S43'],
    mat: (x, y, r) => (x >= o.band[0] && x <= o.band[1] && Math.abs(y) > 90 / 2 - 1.2 - 0.01 ? 'ub' : 'steel'),
    basis: 'Perforante (armour-piercing) shell with 520 g TNT and a Mod. 1909 fuze reported; no cap, dimensions or construction drawing found. Drawn as a plain ogival shell with a rounded tip and one band; nothing beyond the silhouette is asserted.',
    features: [feature('ogival body, no cap', 'approximate', 'no cap reported; shape is a generic estimate'), feature('driving band', 'approximate', 'not documented'), feature('TNT filler, Mod. 1909 fuze', 'not_drawn', 'quantity/designation reported; no cavity geometry'), feature('body material', 'approximate', 'assumed steel')],
    solverNote: solverNoteEffective('IT_90_53_CGP') }));
}
const out = { schema: 'armorlab-design-set-1', note: 'Built-in templates. Generated by scripts/gen_designs.js. Read-only at runtime: editing creates a user copy.', designs };
fs.writeFileSync(path.join(root, 'designs/builtin_designs.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${designs.length} designs`, designs.map((d) => `${d.id} ${d.grid.cols}x${d.grid.rows}`).join(', '));
