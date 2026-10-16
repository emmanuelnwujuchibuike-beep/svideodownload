// The demo session cookie payload (mirrors the mock server's /auth/v1/token).
const ME = 'a0000000-0000-4000-8000-000000000001';
function b64u(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'demo@frenzsave.invalid', app_metadata: { provider: 'email' }, user_metadata: { display_name: 'Frenz Demo' }, created_at: new Date(Date.now() - 864e6).toISOString() };
  const access_token = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: ME, exp, iat: exp - 86400, aud: 'authenticated', role: 'authenticated', email: user.email, session_id: 's1' })}.sig`;
  return { access_token, refresh_token: 'demo-refresh', token_type: 'bearer', expires_in: 86400, expires_at: exp, user };
}
module.exports = { session, ME };
