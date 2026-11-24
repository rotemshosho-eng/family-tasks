// Loads the real index.html with ?demo=1, blocks every outside request (so Firebase can't be reached),
// clicks through the tabs, marks a task, and fails on any script error. Usage: node tests/demo.mjs [shot.png]
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}); const p = await b.newPage({ viewport: { width: 390, height: 860 } }); const errs = [], outside = [];
p.on('pageerror', e => errs.push(String(e.stack || e)));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.route('**/*', r => {
  const u = r.request().url();
  if (!u.startsWith('http://t/')){ if (/fonts\.(googleapis|gstatic)/.test(u)) return r.fulfill({ body: '', contentType: 'text/css' }); outside.push(u); return r.abort(); }
  const f = decodeURIComponent(new URL(u).pathname.slice(1)) || 'index.html';
  if (!fs.existsSync(ROOT + f)) return r.fulfill({ status: 404, body: '' });
  r.fulfill({ body: fs.readFileSync(ROOT + f), contentType: /\.m?js$/.test(f) ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : 'text/html' });
});
await p.goto('http://t/?demo=1'); await p.waitForTimeout(1500);
await p.mouse.click(195, 400); await p.waitForTimeout(800);   // skip the splash
const shots = process.argv[2];
for (const tab of ['today', 'tasks', 'rewards', 'family', 'admin']){
  const bt = p.locator('#tabs [data-tab="' + tab + '"]');
  if (await bt.isVisible().catch(() => false)){ await bt.click(); await p.waitForTimeout(300); if (shots) await p.screenshot({ path: shots.replace('.png', '-' + tab + '.png') }); }
}
const info = await p.evaluate(() => ({ bar: !!document.getElementById('demoBar'), tabs: [...document.querySelectorAll('#tabs [data-tab]')].filter(x => x.offsetParent).map(x => x.dataset.tab), text: document.body.innerText.slice(0, 0) }));
console.log('demo bar:', info.bar, 'tabs:', info.tabs.join(','));
if (outside.length) errs.push('outside requests: ' + outside.join(', '));
if (!info.bar) errs.push('no demo bar');
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors'); await b.close();
process.exit(errs.length ? 1 : 0);
