// Records a page with the CDP screencast (lossless-ish PNG frames at device resolution),
// then rebuilds a constant-30fps H.264 clip from the frame timestamps.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
async function startRecording(page, dir) {
  dir = path.resolve(dir); // the concat list resolves entries relative to itself
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  const vp = page.viewportSize();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: vp.width * 3, maxHeight: vp.height * 3, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  return {
    async stop(out) {
      const tEnd = Date.now() / 1000;
      await cdp.send('Page.stopScreencast');
      await new Promise((r) => setTimeout(r, 300));
      if (!frames.length) throw new Error('no frames');
      // concat demuxer list: each frame held until the next one arrives
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const next = i + 1 < frames.length ? frames[i + 1].t : tEnd;
        lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`);
      }
      lines.push(`file '${frames[frames.length - 1].file}'`);
      const list = path.join(dir, 'list.txt'); fs.writeFileSync(list, lines.join('\n'));
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', out]);
      console.log('recorded', out, frames.length, 'frames', (tEnd - frames[0].t).toFixed(1) + 's', 'started', (frames[0].t - t0).toFixed(2));
    },
  };
}
// A visible touch indicator so taps read on camera.
async function installTouchDot(page) {
  await page.addStyleTag({ content: `#__tap{position:fixed;z-index:2147483647;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.55);border:2px solid rgba(80,70,255,.55);box-shadow:0 2px 12px rgba(60,40,200,.35);pointer-events:none;opacity:0;transform:scale(.6);transition:opacity .18s,transform .18s}` });
}
async function tap(page, locator, { hold = 160 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.evaluate(([x, y]) => {
    let d = document.getElementById('__tap'); if (!d) { d = document.createElement('div'); d.id = '__tap'; document.body.appendChild(d); }
    d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.opacity = '1'; d.style.transform = 'scale(1)';
  }, [x, y]);
  await page.waitForTimeout(hold);
  await page.mouse.click(x, y);
  await page.waitForTimeout(120);
  await page.evaluate(() => { const d = document.getElementById('__tap'); if (d) { d.style.opacity = '0'; d.style.transform = 'scale(1.4)'; } });
}
module.exports = { startRecording, installTouchDot, tap };
