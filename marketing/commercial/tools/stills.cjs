// Render stills of the composition at given times: node stills.cjs <html> <outDir> <fmt h|v> <t...>
const { chromium } = require(require('path').resolve(__dirname, '../../../node_modules/playwright'));
(async () => {
  const [html, out, fmt, ...ts] = process.argv.slice(2);
  const V = fmt === 'v';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: V ? 1080 : 1920, height: V ? 1920 : 1080 } });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.goto('file://' + html + '?fmt=' + fmt);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  for (const t of ts) { await page.evaluate((t) => window.seek(t), +t); await page.screenshot({ path: `${out}/${fmt}-${t}.jpg`, quality: 85, type: 'jpeg' }); }
  await browser.close();
})();
