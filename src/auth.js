const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const USERS_FILE  = path.join(__dirname, '..', 'users.json');
const DASH_SECRET = process.env.DASH_SECRET || 'fallback-secret';
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours in ms

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[auth] Failed to load users.json:', e.message);
  }
  // Fall back to .env credentials if no users.json exists
  const u = process.env.DASH_USER;
  const p = process.env.DASH_PASS;
  if (u && p) return { [u]: { password: `plain:${p}`, role: 'admin' } };
  return {};
}

function verifyPassword(stored, supplied) {
  // Legacy plain text fallback (from .env)
  if (stored.startsWith('plain:')) {
    return stored.slice(6) === supplied;
  }
  // Hashed: salt:hash
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const supplied_hash = crypto.pbkdf2Sync(supplied, salt, 100000, 64, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(supplied_hash, 'hex'));
}

function validateUser(username, password) {
  const users = loadUsers();
  const user  = users[username];
  if (!user) return null;
  if (!verifyPassword(user.password, password)) return null;
  return { username, role: user.role || 'viewer' };
}

// Simple HMAC token: base64(expiry) + '.' + hmac(base64(expiry))
function makeToken(user) {
  const expiry  = Date.now() + SESSION_TTL;
  const payload = Buffer.from(JSON.stringify({ expiry, user })).toString('base64');
  const sig     = crypto.createHmac('sha256', DASH_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', DASH_SECRET).update(payload).digest('hex');
  if (sig !== expected) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return Date.now() < decoded.expiry;
  } catch { return false; }
}

function getTokenFromRequest(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(/(?:^|;\s*)rosdash_token=([^;]+)/);
  if (match) return match[1];
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
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

function requireAdmin(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorised' });
  try {
    const [payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (decoded.user && decoded.user.role === 'admin') return next();
  } catch {}
  res.status(403).json({ error: 'Forbidden' });
}

module.exports = { validateUser, makeToken, verifyToken, requireAuth, requireAuthSocket, requireAdmin };
