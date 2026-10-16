// Deterministic frame renderer: loads a page that exposes window.seek(t) (seconds),
// screenshots each frame, and pipes JPEGs into ffmpeg.
// usage: node render-frames.cjs <html> <out.mp4> <w> <h> <fps> <duration> [query]
const { chromium } = require(require('path').resolve(__dirname, '../../../node_modules/playwright'));
const { spawn } = require('child_process');
(async () => {
  const [html, out, w, h, fps, dur, query = ''] = process.argv.slice(2);
  const W = +w, H = +h, FPS = +fps, N = Math.round(+dur * FPS);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') console.error('[page]', m.text()); });
  await page.goto('file://' + html + (query ? '?' + query : ''));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    await page.evaluate(async (t) => { await window.seek(t); }, i / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 60 === 0) console.log(`frame ${i}/${N} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
})();
