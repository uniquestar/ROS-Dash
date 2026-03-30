const crypto = require('crypto');
const { getUser, getUserPermissions, getTokenGeneration } = require('./db');

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
    return { username, id: user.id, permissions: perms };
  }
  // Fall back to .env credentials
  const u = process.env.DASH_USER;
  const p = process.env.DASH_PASS;
  if (u && p && username === u && password === p) {
    return { username, id: null, permissions: { dashboard: { read: true, write: true }, about: { read: true, write: true } } };
  }
  return null;
}

function makeToken(user) {
  const expiry  = Date.now() + SESSION_TTL;
  const gen     = getTokenGeneration();
  const payload = Buffer.from(JSON.stringify({ expiry, user, gen })).toString('base64');
  const sig     = crypto.createHmac('sha256', DASH_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', DASH_SECRET).update(payload).digest('hex');
  if (sig !== expected) return null;
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

function getTokenUser(req) {
  const token   = getTokenFromRequest(req);
  const decoded = verifyToken(token);
  return decoded ? decoded.user : null;
}

function requireAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (verifyToken(token)) return next();
  res.redirect('/login.html');
}

function requireAuthSocket(socket, next) {
  const cookie = socket.handshake.headers.cookie || '';
  const match  = cookie.match(/(?:^|;\s*)rosdash_token=([^;]+)/);
  const token  = match ? match[1] : null;
  if (verifyToken(token)) return next();
  next(new Error('Unauthorised'));
}

function requirePageRead(pageKey) {
  return function(req, res, next) {
    const user = getTokenUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorised' });
    const perms = user.permissions || {};
    if (perms[pageKey] && perms[pageKey].read) return next();
    res.status(403).json({ error: 'Forbidden' });
  };
}

function requirePageWrite(pageKey) {
  return function(req, res, next) {
    const user = getTokenUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorised' });
    const perms = user.permissions || {};
    if (perms[pageKey] && perms[pageKey].write) return next();
    res.status(403).json({ error: 'Forbidden' });
  };
}

// Legacy — kept for any remaining references, maps to users page write
function requireAdmin(req, res, next) {
  return requirePageWrite('users')(req, res, next);
}

module.exports = {
  validateUser, makeToken, verifyToken, getTokenFromRequest, getTokenUser,
  requireAuth, requireAuthSocket, requireAdmin, requirePageRead, requirePageWrite
};