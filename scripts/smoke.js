// Browser smoke test: opens dist/ArmorLab.html via file://, blocks/records ALL network requests, fires, screenshots.
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const file = 'file://' + path.resolve(__dirname, '../dist/ArmorLab.html');
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: 1440, height: 860 } });
  const net = [], errs = [];
  await pg.route('**/*', (r) => { const u = r.request().url(); if (!u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:')) { net.push(u); return r.abort(); } return r.continue(); });
  pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(file); await pg.waitForTimeout(1500);
  const out = process.argv[2] || '/tmp/shot';
  await pg.screenshot({ path: out + '_ready.png' });
  await pg.selectOption('#speed', '0'); await pg.click('#fire'); await pg.waitForTimeout(9000);
  const info = await pg.evaluate(() => { const s = window.__armorlab; const S = s.sim.stats(); return { backend: s.backend, n: s.sim.n, t_us: S[0] * 1e6, state: document.getElementById('state').textContent, outcome: document.getElementById('outcome').innerText, resid: S[15] }; });
  await pg.screenshot({ path: out + '_run.png' });
  // zoom in on the impact zone to check discrete-particle regime
  await pg.evaluate(() => { const c = window.__armorlab.cam; c.scale *= 14; c.cx = -0.05; c.cy = 0; });
  await pg.waitForTimeout(600); await pg.screenshot({ path: out + '_zoom.png' });
  console.log(JSON.stringify({ info, networkRequests: net, pageErrors: errs }, null, 1));
  await b.close();
})();
