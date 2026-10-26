// Loads the app in headless Chromium with Firebase faked (see run2.mjs), clicks through the tabs and reports script errors.
// Usage:  node tests/run2.mjs <kid|parent|admin> [plain]  &&  node tests/page2.mjs <label>
import { chromium } from 'playwright';
import fs from 'fs';
const ROOT = new URL('../', import.meta.url).pathname, HERE = new URL('./', import.meta.url).pathname;
const b = await chromium.launch(); const p = await b.newPage({ viewport:{ width:390, height:900 } }); const errs = [];
p.on('pageerror', e => errs.push(String(e.stack || e)));
await p.route('**/*', r => r.request().url().startsWith('http://t/') ? r.continue() : r.abort());
await p.route('http://t/**', r => {
  const f = r.request().url().slice(9) || 'index.html';
  const body = f === 'index.html'
    ? fs.readFileSync(ROOT + 'index.html', 'utf8').replace(/<script[^>]*src="app.js"[^>]*><\/script>/, '<script>window.__errs=[]</script><script type="module" src="app.test.mjs"></script>')
    : fs.existsSync(HERE + f) ? fs.readFileSync(HERE + f) : fs.existsSync(ROOT + f) ? fs.readFileSync(ROOT + f) : '';
  r.fulfill({ body, contentType: /\.m?js$/.test(f) ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
});
await p.goto('http://t/'); await p.waitForTimeout(1500);
for (const tab of ['today','tasks','rewards','family','admin']){ const bt = p.locator('#tabs [data-tab="' + tab + '"]'); if (await bt.isVisible().catch(() => false)){ await bt.click(); await p.waitForTimeout(200); } }
const inner = await p.evaluate(() => window.__errs || []);
console.log(process.argv[2] || '', 'tabs visible:', await p.locator('#tabs').isVisible());
const all = errs.concat(inner); console.log(all.length ? 'ERRORS:\n' + all.join('\n') : 'no errors'); await b.close();
process.exit(all.length ? 1 : 0);
