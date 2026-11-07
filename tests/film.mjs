// Dev helper for animation work: open(p) opens the kitchen; film(p, browser, label, foodName, [ms, ...]) saves tests/_film_<label>.png, a contact sheet of the stage at those times.
// Use it from a probe script built like tests/page2.mjs (same Firebase fake), then look at the picture. Not part of the smoke test.
export async function open(p){
  await p.waitForTimeout(4500); await p.evaluate(() => document.getElementById('splash')?.click()); await p.waitForTimeout(700);
  await p.locator('#tabKitchen').click(); await p.waitForTimeout(500);
}
export async function film(p, b, label, name, times, cols = 4){
  await p.locator('.kchip', { hasText: name }).first().click(); const t0 = Date.now(); const shots = [];
  for (const t of times){ const w = t - (Date.now() - t0); if (w > 0) await p.waitForTimeout(w); shots.push([Date.now() - t0, (await p.locator('#kStage').screenshot()).toString('base64')]); }
  const pg = await b.newPage({ viewport:{ width: cols * 372 + 16, height: 500 } });
  await pg.setContent('<body style="margin:0;background:#222;display:flex;flex-wrap:wrap;gap:8px;padding:8px;font:13px sans-serif;color:#fff">' + shots.map(([t, d]) => `<div style="width:364px"><img src="data:image/png;base64,${d}" style="width:364px;display:block;border-radius:8px"><div>${t}ms</div></div>`).join('') + '</body>');
  await pg.screenshot({ path: `tests/_film_${label}.png`, fullPage:true }); await pg.close();
}
