// Records every phone-screen clip used in the commercial from the REAL app
// (local dev server + local mock backend). usage: node scenes.cjs <outDir> [scene...]
const path = require('path');
const { open, BASE } = require('./common.cjs');
const { startRecording, installTouchDot, tap } = require('./recorder.cjs');
const OUT = process.argv[2];
const ONLY = process.argv.slice(3);
const wait = (p, ms) => p.waitForTimeout(ms);

// Extractor reply for the download demo: a local stand-in, no real video is fetched.
const LINK = 'https://vm.tiktok.com/ZMdemo2026/';
const META = {
  ok: true,
  data: {
    id: 'demo', platform: 'tiktok', platformName: 'TikTok', sourceUrl: LINK, title: 'Liquid glow',
    description: null, thumbnail: 'https://media.frenz.test:59443/media/reel3.jpg', durationSeconds: 8, creator: null,
    uploadDate: null, viewCount: null, likeCount: null, webpageUrl: LINK, extractor: 'tiktok', width: 1080, height: 1920,
    formats: [
      { formatId: '1080', kind: 'video', label: '1080p', ext: 'mp4', resolution: '1080x1920', fps: 30, filesize: null, tbr: null, vcodec: 'h264', acodec: 'aac' },
      { formatId: '720', kind: 'video', label: '720p', ext: 'mp4', resolution: '720x1280', fps: 30, filesize: null, tbr: null, vcodec: 'h264', acodec: 'aac' },
      { formatId: 'audio', kind: 'audio', label: 'audio', ext: 'mp3', resolution: null, fps: null, filesize: null, tbr: null, vcodec: null, acodec: 'mp3' },
    ],
  },
};

async function smoothScroll(page, dy, ms) {
  const steps = Math.max(1, Math.round(ms / 33));
  for (let i = 0; i < steps; i++) {
    const a = 0.5 - 0.5 * Math.cos((Math.PI * i) / steps), b = 0.5 - 0.5 * Math.cos((Math.PI * (i + 1)) / steps);
    await page.mouse.wheel(0, dy * (b - a));
    await wait(page, 33);
  }
}

const SCENES = {
  async download() {
    const { browser, ctx } = await open();
    await ctx.route('**/api/metadata', async (r) => { await new Promise((x) => setTimeout(x, 1300)); await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(META) }); });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 240000 });
    await wait(page, 6000);
    await installTouchDot(page);
    const input = page.locator('input[type="url"], input[placeholder*="link" i]').first();
    const rec = await startRecording(page, path.join(OUT, 'f-download'));
    await wait(page, 1200);
    await tap(page, input);
    await input.pressSequentially(LINK, { delay: 40 });
    await wait(page, 400);
    const save = page.getByRole('button', { name: /^save$/i }).first();
    if (await save.isVisible().catch(() => false)) await tap(page, save);
    await wait(page, 7000);
    await rec.stop(path.join(OUT, 'download.mp4'));
    await page.screenshot({ path: path.join(OUT, 'download-end.png') });
    await browser.close();
  },
  async ai() {
    const { browser, ctx } = await open({ signedIn: true });
    // No real pricing backend here: hold the quote request open so the UI shows its
    // neutral "—" instead of an error. Generate is never pressed.
    await ctx.route('**/api/ai/video/quote**', () => {});
    const page = await ctx.newPage();
    await page.goto(BASE + '/ai/text-to-video', { waitUntil: 'load', timeout: 240000 }); // warm compile
    await page.goto(BASE + '/ai', { waitUntil: 'load', timeout: 240000 });
    await wait(page, 6000);
    await installTouchDot(page);
    const rec = await startRecording(page, path.join(OUT, 'f-ai'));
    await wait(page, 3200);
    await smoothScroll(page, 200, 1000);
    await wait(page, 1500);
    await rec.stop(path.join(OUT, 'ai1.mp4'));
    // text to video: type a prompt into the real workspace (Generate is never pressed)
    await page.goto(BASE + '/ai/text-to-video', { waitUntil: 'load', timeout: 240000 });
    await wait(page, 5000);
    await installTouchDot(page);
    const ta = page.locator('textarea').first();
    await ta.scrollIntoViewIfNeeded();
    await smoothScroll(page, -2000, 100);
    await wait(page, 800);
    const rec2 = await startRecording(page, path.join(OUT, 'f-ai2'));
    await wait(page, 700);
    await smoothScroll(page, 330, 800);
    await wait(page, 300);
    await tap(page, ta);
    await ta.pressSequentially('A neon city at night, slow drone shot over glowing streets', { delay: 38 });
    await wait(page, 1600);
    await rec2.stop(path.join(OUT, 'ai2.mp4'));
    await page.screenshot({ path: path.join(OUT, 'ai2-end.png') });
    await browser.close();
  },
  async reels() {
    const { browser, ctx } = await open({ signedIn: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/reels', { waitUntil: 'load', timeout: 240000 });
    await page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.readyState >= 3 && !v.paused), null, { timeout: 60000 });
    await wait(page, 1500);
    const rec = await startRecording(page, path.join(OUT, 'f-reels'));
    // swipe: smooth-scroll the deck's own snap container one screen at a time
    const swipe = () => page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find((e) => getComputedStyle(e).scrollSnapType.includes('y') && e.scrollHeight > e.clientHeight + 10);
      if (el) el.scrollBy({ top: el.clientHeight, behavior: 'smooth' });
      return !!el;
    });
    await wait(page, 3000);
    console.log('swipe', await swipe());
    await wait(page, 3300);
    await swipe();
    await wait(page, 2800);
    await rec.stop(path.join(OUT, 'reels.mp4'));
    await browser.close();
  },
  async history() {
    const { browser, ctx } = await open({ history: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/history', { waitUntil: 'load', timeout: 240000 });
    await wait(page, 7000);
    const rec = await startRecording(page, path.join(OUT, 'f-history'));
    await wait(page, 1500);
    await page.mouse.move(195, 500);
    await smoothScroll(page, 260, 1400);
    await wait(page, 3500);
    await rec.stop(path.join(OUT, 'history.mp4'));
    await browser.close();
  },
  async montage() {
    for (const [name, route, dy] of [['explore', '/explore', 380], ['feed', '/home', 420], ['quests', '/quests', 360]]) {
      const { browser, ctx } = await open({ signedIn: true });
      const page = await ctx.newPage();
      await page.goto(BASE + route, { waitUntil: 'load', timeout: 240000 });
      await wait(page, 7000);
      console.log(name, page.url());
      const rec = await startRecording(page, path.join(OUT, 'f-' + name));
      await wait(page, 1600);
      await page.mouse.move(195, 500);
      await smoothScroll(page, dy, 1800);
      await wait(page, 3600);
      await rec.stop(path.join(OUT, name + '.mp4'));
      await browser.close();
    }
  },
};

(async () => {
  for (const [name, fn] of Object.entries(SCENES)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    console.log('scene', name);
    try { await fn(); } catch (e) { console.log('scene failed', name, e.message.split('\n')[0]); }
  }
})();
