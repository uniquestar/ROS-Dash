const crypto = require('crypto');
const { getUser, getUserPermissions, getTokenGeneration, getUserSwitchWrite } = require('./db');

const DASH_SECRET = (process.env.DASH_SECRET || '').trim();
if (!DASH_SECRET) {
  throw new Error('DASH_SECRET is required. Set it in your environment before starting ROS-Dash.');
}
if (DASH_SECRET.length < 32) {
  console.warn('[auth] WARNING: DASH_SECRET is shorter than 32 characters. Use a longer secret.');
}

const SESSION_TTL = 60 * 60 * 1000; // 1 hour

function verifyPassword(stored, supplied) {
  if (stored.startsWith('plain:')) return stored.slice(6) === supplied;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const suppliedHash = crypto.pbkdf2Sync(supplied, salt, 100000, 64, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(suppliedHash, 'hex'));
}

function validateUser(username, password) {
  // Try database first
  const user = getUser(username);
  if (user && verifyPassword(user.password, password)) {
    const perms = getUserPermissions(user.id);
    return { username, id: user.id, permissions: perms, mustChangePassword: user.must_change_password === 1 };
  }
  // Fall back to .env credentials
  const u = process.env.DASH_USER;
  const p = process.env.DASH_PASS;
  if (u && p && username === u && password === p) {
    return { username, id: null, permissions: { dashboard: { read: true, write: true }, about: { read: true, write: true } } };
  }
  return null;
}

// Short fingerprint of the stored password hash: changing or resetting a
// password invalidates every token issued before the change.
function passwordFingerprint(storedHash) {
  return crypto.createHash('sha256').update(String(storedHash || '')).digest('hex').slice(0, 16);
}

function makeToken(user) {
  const expiry  = Date.now() + SESSION_TTL;
  const gen     = getTokenGeneration();
  const dbUser  = user && user.id != null ? getUser(user.username) : null;
  const pwf     = dbUser ? passwordFingerprint(dbUser.password) : null;
  const payload = Buffer.from(JSON.stringify({ expiry, user, gen, pwf })).toString('base64');
  const sig     = crypto.createHmac('sha256', DASH_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', DASH_SECRET).update(payload).digest('hex');
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (Date.now() >= decoded.expiry) return null;
    if (decoded.gen !== getTokenGeneration()) return null;
    return decoded;
  } catch { return null; }
}

function getTokenFromRequest(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(/(?:^|;\s*)rosdash_token=([^;]+)/);
  if (match) return match[1];
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// Resolve the token to the user's *current* state. Database users are re-read on
// every request, so deleting a user, changing permissions or resetting a password
// takes effect immediately instead of when the token expires.
function resolveUser(decoded) {
  if (!decoded || !decoded.user) return null;
  const tokenUser = decoded.user;
  if (tokenUser.id == null) return tokenUser; // .env fallback user: fixed permissions
  const dbUser = getUser(tokenUser.username);
  if (!dbUser || dbUser.id !== tokenUser.id) return null;
  if (decoded.pwf !== passwordFingerprint(dbUser.password)) return null;
  return {
    username: dbUser.username,
    id: dbUser.id,
    permissions: getUserPermissions(dbUser.id),
    mustChangePassword: dbUser.must_change_password === 1,
  };
}

function getTokenUser(req) {
  return resolveUser(verifyToken(getTokenFromRequest(req)));
}

// Until a forced password change is done, only /api/me, /api/me/password and
// logout work; every page/switch permission check refuses.
function passwordChangeBlock(user, res) {
  if (!user.mustChangePassword) return false;
  res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  return true;
}

/**
 * Express auth gate for browser routes/API routes.
 * Redirects unauthenticated users to login to preserve current UX.
 */
function requireAuth(req, res, next) {
  if (getTokenUser(req)) return next();
  res.redirect('/login.html');
}

/**
 * Socket.IO auth gate based on the same signed cookie token.
 */
function requireAuthSocket(socket, next) {
  const cookie = socket.handshake.headers.cookie || '';
  const match  = cookie.match(/(?:^|;\s*)rosdash_token=([^;]+)/);
  const token  = match ? match[1] : null;
  if (resolveUser(verifyToken(token))) return next();
  next(new Error('Unauthorised'));
}

/**
 * Per-page read authorization middleware factory.
 */
function requirePageRead(pageKey) {
  return function(req, res, next) {
    const user = getTokenUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorised' });
    if (passwordChangeBlock(user, res)) return;
    const perms = user.permissions || {};
    if (perms[pageKey] && perms[pageKey].read) return next();
    res.status(403).json({ error: 'Forbidden' });
  };
}

/**
 * Per-page write authorization middleware factory.
 */
function requirePageWrite(pageKey) {
  return function(req, res, next) {
    const user = getTokenUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorised' });
    if (passwordChangeBlock(user, res)) return;
    const perms = user.permissions || {};
    if (perms[pageKey] && perms[pageKey].write) return next();
    res.status(403).json({ error: 'Forbidden' });
  };
}

/**
 * Per-switch write authorization middleware factory.
 * Grants access to users with switchadmin.write or an explicit per-switch grant.
 */
function requireSwitchWrite(switchNameParam) {
  return function(req, res, next) {
    const user = getTokenUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorised' });
    if (passwordChangeBlock(user, res)) return;
    // .env fallback users only get dashboard/about, so no switch bypass for them
    if (user.id == null) return res.status(403).json({ error: 'Forbidden' });
    const perms = user.permissions || {};
    // switchadmin.write grants unrestricted write access to any switch
    if (perms.switchadmin && perms.switchadmin.write) return next();
    // fall back to per-switch DB grant
    const switchName = req.params[switchNameParam];
    if (switchName && getUserSwitchWrite(user.id, switchName)) return next();
    res.status(403).json({ error: 'Forbidden' });
  };
}

// Legacy — kept for any remaining references, maps to users page write
function requireAdmin(req, res, next) {
  return requirePageWrite('users')(req, res, next);
}

module.exports = {
  verifyPassword, validateUser, makeToken, verifyToken, getTokenFromRequest, getTokenUser,
  requireAuth, requireAuthSocket, requireAdmin, requirePageRead, requirePageWrite, requireSwitchWrite
};