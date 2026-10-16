// Shared browser setup for filming the real app against the local mock backend.
const { chromium, devices } = require(require('path').resolve(__dirname, '../../../node_modules/playwright'));
const { session } = require('../mock/session.cjs');
const BASE = 'http://localhost:3100';
async function open({ signedIn = false, dpr = 2, history = false } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required', '--no-proxy-server'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, bypassCSP: true, ignoreHTTPSErrors: true, serviceWorkers: 'block', colorScheme: 'light' });
  await ctx.route('**/api/app-version**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route(/googlesyndication|googletagmanager|google-analytics|doubleclick|adtrafficquality|fundingchoices/, (r) => r.abort());
  if (signedIn) {
    const value = 'base64-' + Buffer.from(JSON.stringify(session())).toString('base64url');
    await ctx.addCookies([{ name: 'sb-127-auth-token', value, url: BASE }]);
  }
  if (history) {
    // Demo download history (localStorage only, in this throwaway browser profile).
    const M = 'https://media.frenz.test:59443/media';
    const rows = [
      ['tiktok', 'TikTok', 'Neon waves at night', 1, '1080', 'video', '1080p', 8],
      ['instagram', 'Instagram', 'Studio light test', 2, '1080', 'video', '1080p', 12],
      ['youtube', 'YouTube', 'Tunnel run loop', 3, '720', 'video', '720p', 21],
      ['x', 'X (Twitter)', 'Glow study', 4, 'audio', 'audio', 'MP3', 30],
      ['facebook', 'Facebook', 'Liquid colours', 5, '1080', 'video', '1080p', 15],
      ['pinterest', 'Pinterest', 'Purple hour', 6, 'image', 'image', 'Original', null],
    ].map(([platform, platformName, title, n, formatId, kind, qualityLabel, dur], i) => ({
      id: `demo-${i}`, url: `https://example.com/demo/${i}`, platform, platformName, title, thumbnail: `${M}/thumb${n}.jpg`,
      formatId, kind, qualityLabel, durationSeconds: dur, createdAt: Date.now() - (i * 47 + 3) * 60000,
    }));
    await ctx.addInitScript((v) => { try { localStorage.setItem('svd:history:v1', v); } catch {} }, JSON.stringify(rows));
  }
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('frenz:ios-install-dismissed-session', '1'); } catch {}
    const css = 'nextjs-portal{display:none!important}';
    const add = () => { const s = document.createElement('style'); s.textContent = css; document.documentElement.appendChild(s); };
    if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
  });
  return { browser, ctx, BASE };
}
module.exports = { open, BASE };
