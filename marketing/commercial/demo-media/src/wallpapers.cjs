// Renders the demo wallpapers (1080×1920 JPEG stills of the shader clips).
// usage: node wallpapers.cjs <outDir>
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../../node_modules/playwright'));
const SHOTS = [[0, 2.2], [1, 1.3], [2, 2.0], [0, 6.5], [1, 4.2], [2, 6.0]];
(async () => {
  const out = process.argv[2];
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  for (let i = 0; i < SHOTS.length; i++) {
    const [s, t] = SHOTS[i];
    await p.goto('file://' + path.join(__dirname, 'shader-reels.html') + '?s=' + s);
    await p.waitForFunction(() => window.__ready === true);
    await p.evaluate((t) => window.seek(t), t);
    await p.screenshot({ path: path.join(out, `wp${i + 1}.jpg`), type: 'jpeg', quality: 90 });
  }
  await b.close();
})();
