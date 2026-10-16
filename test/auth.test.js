const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.DASH_SECRET = process.env.DASH_SECRET || crypto.randomBytes(32).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rosdash-auth-'));
const db = require('../src/db');
db.initDb(path.join(dir, 'test.db'));
const auth = require('../src/auth');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function hash(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.pbkdf2Sync(pw, salt, 1000, 64, 'sha256').toString('hex');
}

// pbkdf2 iteration count is part of verifyPassword, so log in via the token API directly
function loginAs(username) {
  const u = db.getUser(username);
  const token = auth.makeToken({ username, id: u.id, permissions: db.getUserPermissions(u.id) });
  return { headers: { cookie: 'rosdash_token=' + token }, params: {} };
}

function run(mw, req) {
  let status = 200, body = null, nexted = false;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; }, redirect() { status = 302; return this; } };
  mw(req, res, () => { nexted = true; });
  return { status, body, nexted };
}

let n = 0;
function newUser(opts = {}) {
  const name = 'user' + (++n);
  db.createUser(name, hash('pw'), null, !!opts.mustChange);
  return name;
}

test('token resolves to the current user and permissions', () => {
  const name = newUser();
  const req = loginAs(name);
  const u = auth.getTokenUser(req);
  assert.equal(u.username, name);
  assert.ok(run(auth.requireAuth, req).nexted);
});

test('permission changes apply immediately to existing tokens', () => {
  const name = newUser();
  const id = db.getUser(name).id;
  const req = loginAs(name);
  assert.equal(run(auth.requirePageWrite('users'), req).status, 403);
  db.setPermission(id, 'users', true, true);
  assert.ok(run(auth.requirePageWrite('users'), req).nexted, 'granted without re-login');
  db.setPermission(id, 'users', false, false);
  assert.equal(run(auth.requirePageWrite('users'), req).status, 403, 'revoked without re-login');
});

test('deleting a user invalidates their token', () => {
  const name = newUser();
  const req = loginAs(name);
  db.deleteUser(name);
  assert.equal(auth.getTokenUser(req), null);
  assert.equal(run(auth.requireAuth, req).status, 302);
});

test('changing a password invalidates tokens issued before it', () => {
  const name = newUser();
  const req = loginAs(name);
  db.updatePassword(name, hash('new-password'));
  assert.equal(auth.getTokenUser(req), null);
  assert.ok(auth.getTokenUser(loginAs(name)), 'a fresh login works');
});

test('a forced password change blocks page access but not authentication', () => {
  const name = newUser({ mustChange: true });
  const req = loginAs(name);
  assert.ok(run(auth.requireAuth, req).nexted);
  const r = run(auth.requirePageRead('dashboard'), req);
  assert.equal(r.status, 403);
  assert.equal(r.body.mustChangePassword, true);
  db.setMustChangePassword(name, false);
  assert.ok(run(auth.requirePageRead('dashboard'), req).nexted);
});

test('tampered or foreign tokens are rejected', () => {
  const name = newUser();
  const req = loginAs(name);
  const [payload, sig] = req.headers.cookie.slice('rosdash_token='.length).split('.');
  const bad = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
  assert.equal(auth.getTokenUser({ headers: { cookie: 'rosdash_token=' + payload + '.' + bad } }), null);
  assert.equal(auth.getTokenUser({ headers: { cookie: 'rosdash_token=' + payload + '.short' } }), null);
});

test('.env fallback user gets no switch write bypass', () => {
  const token = auth.makeToken({ username: 'envadmin', id: null, permissions: { dashboard: { read: true, write: true } } });
  const req = { headers: { cookie: 'rosdash_token=' + token }, params: { name: 'sw1' } };
  assert.equal(run(auth.requireSwitchWrite('name'), req).status, 403);
  assert.ok(run(auth.requirePageRead('dashboard'), req).nexted);
});
