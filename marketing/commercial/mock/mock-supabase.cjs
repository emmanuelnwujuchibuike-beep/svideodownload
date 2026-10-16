// Local stand-in for Supabase used ONLY to film the commercial.
// Serves a demo account and demo posts; never talks to the real project.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { session } = require('./session.cjs');
const PORT = 59999;
const MEDIA = path.join(__dirname, '..', 'demo-media');
const LOG = process.env.MOCK_LOG === '1';

const ME = 'a0000000-0000-4000-8000-000000000001';
const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
const user = {
  id: ME, aud: 'authenticated', role: 'authenticated', email: 'demo@frenzsave.invalid',
  email_confirmed_at: iso(10000), phone: '', confirmed_at: iso(10000), last_sign_in_at: iso(5),
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { display_name: 'Frenz Demo' },
  identities: [], created_at: iso(20000), updated_at: iso(5), is_anonymous: false,
};
const creators = [
  { id: 'c0000000-0000-4000-8000-000000000011', handle: 'neon.studio', display_name: 'Neon Studio' },
  { id: 'c0000000-0000-4000-8000-000000000012', handle: 'motionlab', display_name: 'Motion Lab' },
  { id: 'c0000000-0000-4000-8000-000000000013', handle: 'pixelwave', display_name: 'Pixel Wave' },
];
const profileRow = (p) => ({ ...p, avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false, trust_score: 50, bio: null, created_at: iso(30000) });
const profiles = [profileRow({ id: ME, handle: 'frenzdemo', display_name: 'Frenz Demo' }), ...creators.map(profileRow)];
const base = 'https://media.frenz.test:59443/media';
const posts = [
  ['Aurora lines', 'Calm neon waves', 0, 1, 'art', 15],
  ['Into the tunnel', 'Hyperspace loop', 1, 2, 'art', 40],
  ['Liquid glow', 'Lava-lamp vibes', 2, 3, 'art', 90],
].map(([title, description, ci, n, category, mins], i) => ({
  id: `b0000000-0000-4000-8000-00000000010${i}`, publisher_id: creators[ci].id, source_url: null, platform: null,
  media_kind: 'video', title, description, category, thumbnail_url: `${base}/reel${n}.jpg`, media_url: `${base}/reel${n}.webm`,
  stream_uid: null, duration_sec: 8, visibility: 'public', status: 'published', views_count: 0, likes_count: 0,
  saves_count: 0, shares_count: 0, comments_count: 0, downloads_count: 0, created_at: iso(mins), is_nsfw: false,
  content_type: null, momentum_score: 0, hot_score: 0, format: 'reel', media_width: 540, media_height: 960,
  stream_ready: false, stream_error: null, sound_id: null, slug: null, publisher: undefined,
}));
// Demo wallpapers (demo-media/wp*.jpg) so the Wallpapers tile and gallery have images.
const wallpapers = ['Aurora lines', 'Neon tunnel', 'Liquid glow', 'Aurora drift', 'Blue tunnel', 'Violet glow'].map((title, i) => ({
  id: i + 1, title, category: 'abstract', image_url: `${base}/wp${i + 1}.jpg`, thumb_url: `${base}/wp${i + 1}.jpg`,
  status: 'published', likes_count: 0, saves_count: 0, comments_count: 0, downloads_count: 0, views_count: 0,
  views_boost: 0, likes_boost: 0, saves_boost: 0, width: 1080, height: 1920, created_at: iso(60 * (i + 1)),
  source: 'upload', uploaded_by: null, sort_order: i,
}));
const TABLES = { profiles, posts, wallpapers };

function parseFilters(u) {
  const f = [];
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = /^(eq|in|is|neq)\.(.*)$/.exec(v);
    if (!m) continue;
    f.push([k, m[1], m[2]]);
  }
  return f;
}
function apply(rows, filters) {
  return rows.filter((r) => filters.every(([k, op, val]) => {
    if (!(k in r)) return true;
    const rv = r[k] === null ? 'null' : String(r[k]);
    if (op === 'eq') return rv === val;
    if (op === 'neq') return rv !== val;
    if (op === 'is') return rv === val;
    if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, '')).includes(rv);
    return true;
  }));
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function handler(req, res) {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (LOG) console.log(req.method, u.pathname + u.search);
  if (req.method === 'OPTIONS') return send(res, 204);
  if (u.pathname.startsWith('/media/')) {
    const file = path.join(MEDIA, path.basename(u.pathname));
    if (!fs.existsSync(file)) return send(res, 404, {});
    const stat = fs.statSync(file);
    const type = file.endsWith('.mp4') ? 'video/mp4' : file.endsWith('.webm') ? 'video/webm' : 'image/jpeg';
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = +range[1] || 0; const end = range[2] ? +range[2] : stat.size - 1;
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'access-control-allow-origin': '*' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' });
    return fs.createReadStream(file).pipe(res);
  }
  if (u.pathname === '/auth/v1/user') return send(res, 200, user);
  if (u.pathname.startsWith('/auth/v1/token')) return send(res, 200, session());
  if (u.pathname.startsWith('/auth/v1/logout')) return send(res, 204);
  if (u.pathname.startsWith('/auth/v1/')) return send(res, 200, {});
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    let body = ''; req.on('data', (c) => (body += c));
    return req.on('end', () => send(res, 200, null));
  }
  const m = /^\/rest\/v1\/([^/]+)$/.exec(u.pathname);
  if (m) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.resume(); return req.on('end', () => send(res, 201, []));
    }
    let rows = apply(TABLES[m[1]] || [], parseFilters(u));
    const limit = +(u.searchParams.get('limit') || 0); if (limit) rows = rows.slice(0, limit);
    const range = { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' };
    if (req.method === 'HEAD') return send(res, 200, undefined, range);
    const single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
    if (single) return rows.length ? send(res, 200, rows[0], range) : send(res, 406, { code: 'PGRST116', message: 'no rows', details: '', hint: null });
    return send(res, 200, rows, range);
  }
  send(res, 404, { message: 'not mocked' });
}
http.createServer(handler).listen(PORT, '127.0.0.1', () => console.log('mock supabase on', PORT));
// Demo media over HTTPS (next/image only optimises https sources).
require('https').createServer({ key: fs.readFileSync(path.join(__dirname, 'key.pem')), cert: fs.readFileSync(path.join(__dirname, 'cert.pem')) }, handler).listen(59443, '127.0.0.1');

