/**
 * Database module — SQLite via better-sqlite3
 * Handles schema creation, page seeding, and users.json migration
 */
const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const { getErrorMessage } = require('./util/errors');

// All pages in the application — add new pages here
const PAGES = [
  { key: 'dashboard',    label: 'Dashboard',     sort_order: 1  },
  { key: 'interfaces',   label: 'Interfaces',    sort_order: 2  },
  { key: 'dhcp',         label: 'DHCP',          sort_order: 3  },
  { key: 'vpn',          label: 'VPN',           sort_order: 4  },
  { key: 'connections',  label: 'Connections',   sort_order: 5  },
  { key: 'switches',     label: 'Switches',      sort_order: 6  },
  { key: 'routes',       label: 'Routes',        sort_order: 7  },
  { key: 'addresslists', label: 'Address Lists', sort_order: 8  },
  { key: 'firewall',     label: 'Firewall',      sort_order: 9  },
  { key: 'logs',         label: 'Logs',          sort_order: 10 },
  { key: 'users',        label: 'Users',         sort_order: 11 },
  { key: 'about',        label: 'About',         sort_order: 12 },
  { key: 'switchadmin',  label: 'Switch Admin',  sort_order: 13 },
];

// Pages everyone gets read access to by default
const DEFAULT_READ_PAGES = ['dashboard', 'about'];

let _db = null;

function getDb() {
  if (!_db) throw new Error('Database not initialised — call initDb() first');
  return _db;
}

function initDb(dbPath) {
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Create tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      key        TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      page_key  TEXT NOT NULL REFERENCES pages(key) ON DELETE CASCADE,
      can_read  INTEGER NOT NULL DEFAULT 0,
      can_write INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, page_key)
    );

    CREATE TABLE IF NOT EXISTS switch_permissions (
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      switch_name TEXT NOT NULL,
      can_write   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, switch_name)
    );
  `);

  // Migration: add must_change_password to existing databases.
  const userCols = _db.prepare('PRAGMA table_info(users)').all();
  const hasMustChangeCol = userCols.some(c => c.name === 'must_change_password');
  if (!hasMustChangeCol) {
    _db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  }

  // Token generation — incremented on each startup to invalidate old sessions
  _db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const gen = (_db.prepare('SELECT value FROM meta WHERE key = ?').get('token_generation')?.value || '0');
  const newGen = String(parseInt(gen) + 1);
  _db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('token_generation', newGen);
  console.log('[db] token generation:', newGen);

  // Seed pages — insert new pages, ignore existing
  const insertPage = _db.prepare(
    'INSERT OR IGNORE INTO pages (key, label, sort_order) VALUES (?, ?, ?)'
  );
  // Find users who have full access (admins) to grant new pages to
  const grantNewPages = _db.transaction(() => {
    for (const p of PAGES) {
      const existing = _db.prepare('SELECT key FROM pages WHERE key = ?').get(p.key);
      insertPage.run(p.key, p.label, p.sort_order);
      if (!existing) {
        // New page — grant read+write to all admin users
        const admins = getAdminUserIds();
        const grant  = _db.prepare(
          'INSERT OR IGNORE INTO permissions (user_id, page_key, can_read, can_write) VALUES (?, ?, 1, 1)'
        );
        for (const id of admins) grant.run(id, p.key);
      }
    }
  });
  grantNewPages();

  // Migration: grant switchadmin.write to anyone who previously had switches.write
  const migrateSwitchAdmin = _db.transaction(() => {
    const toMigrate = _db.prepare(
      'SELECT user_id FROM permissions WHERE page_key = ? AND can_write = 1'
    ).all('switches');
    const grantAdmin = _db.prepare(
      'INSERT OR IGNORE INTO permissions (user_id, page_key, can_read, can_write) VALUES (?, ?, 1, 1)'
    );
    for (const { user_id } of toMigrate) grantAdmin.run(user_id, 'switchadmin');
  });
  migrateSwitchAdmin();

  // Migrate users.json if it exists and hasn't been migrated yet
  migrateUsersJson();

  console.log('[db] initialised at', dbPath);
  return _db;
}

function getAdminUserIds() {
  // Admin = user who has read+write on all currently existing pages
  // On first run this returns empty array which is fine
  const users = _db.prepare('SELECT id FROM users').all();
  if (!users.length) return [];
  return users.filter(u => {
    const pageCount = _db.prepare('SELECT COUNT(*) as c FROM pages').get().c;
    const fullCount = _db.prepare(
      'SELECT COUNT(*) as c FROM permissions WHERE user_id = ? AND can_read = 1 AND can_write = 1'
    ).get(u.id).c;
    return pageCount > 0 && fullCount === pageCount;
  }).map(u => u.id);
}

function migrateUsersJson() {
  const jsonPath      = path.join(process.cwd(), 'users.json');
  const migratedPath  = path.join(process.cwd(), 'users.json.migrated');

  if (!fs.existsSync(jsonPath)) return;
  if (fs.existsSync(migratedPath)) return; // already migrated

  let data;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch(e) {
    console.error('[db] failed to parse users.json for migration:', getErrorMessage(e));
    return;
  }

  const insertUser = _db.prepare(
    'INSERT OR IGNORE INTO users (username, password, created_at) VALUES (?, ?, ?)'
  );
  const insertPerm = _db.prepare(
    'INSERT OR IGNORE INTO permissions (user_id, page_key, can_read, can_write) VALUES (?, ?, ?, ?)'
  );

  const migrate = _db.transaction(() => {
    for (const [username, u] of Object.entries(data)) {
      insertUser.run(username, u.password, u.createdAt || new Date().toISOString());
      const row = _db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (!row) continue;
      const isAdmin = u.role === 'admin';
      for (const p of PAGES) {
        if (isAdmin) {
          insertPerm.run(row.id, p.key, 1, 1);
        } else {
          // viewer — only dashboard and about get read access
          const canRead = DEFAULT_READ_PAGES.includes(p.key) ? 1 : 0;
          insertPerm.run(row.id, p.key, canRead, 0);
        }
      }
    }
  });

  migrate();
  fs.renameSync(jsonPath, migratedPath);
  console.log('[db] migrated users.json to SQLite, renamed to users.json.migrated');
}

// ── User operations ──────────────────────────────────────────────────────────

function getUser(username) {
  return _db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getAllUsers() {
  return _db.prepare('SELECT id, username, created_at, must_change_password FROM users ORDER BY username').all();
}

function createUser(username, passwordHash, createdAt, mustChangePassword = false) {
  const info = _db.prepare(
    'INSERT INTO users (username, password, must_change_password, created_at) VALUES (?, ?, ?, ?)'
  ).run(username, passwordHash, mustChangePassword ? 1 : 0, createdAt || new Date().toISOString());
  const userId = info.lastInsertRowid;
  // Grant default pages
  const grant = _db.prepare(
    'INSERT OR IGNORE INTO permissions (user_id, page_key, can_read, can_write) VALUES (?, ?, ?, ?)'
  );
  for (const p of PAGES) {
    const canRead = DEFAULT_READ_PAGES.includes(p.key) ? 1 : 0;
    grant.run(userId, p.key, canRead, 0);
  }
  return userId;
}

function updatePassword(username, passwordHash, opts = {}) {
  const mustChangePassword = typeof opts.mustChangePassword === 'boolean' ? opts.mustChangePassword : false;
  _db.prepare('UPDATE users SET password = ?, must_change_password = ? WHERE username = ?').run(passwordHash, mustChangePassword ? 1 : 0, username);
}

function setMustChangePassword(username, mustChangePassword) {
  _db.prepare('UPDATE users SET must_change_password = ? WHERE username = ?').run(mustChangePassword ? 1 : 0, username);
}

function deleteUser(username) {
  _db.prepare('DELETE FROM users WHERE username = ?').run(username);
}

// ── Permission operations ────────────────────────────────────────────────────

/**
 * Return per-page permission map for a user id.
 */
function getUserPermissions(userId) {
  const rows = _db.prepare(
    'SELECT page_key, can_read, can_write FROM permissions WHERE user_id = ?'
  ).all(userId);
  const perms = {};
  for (const r of rows) {
    perms[r.page_key] = {
      read:  r.can_read  === 1,
      write: r.can_write === 1,
    };
  }
  return perms;
}

/**
 * Upsert read/write permissions for a user-page pair.
 */
function setPermission(userId, pageKey, canRead, canWrite) {
  _db.prepare(`
    INSERT INTO permissions (user_id, page_key, can_read, can_write)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, page_key) DO UPDATE SET can_read = ?, can_write = ?
  `).run(userId, pageKey, canRead ? 1 : 0, canWrite ? 1 : 0, canRead ? 1 : 0, canWrite ? 1 : 0);
}

// ── Switch permission operations ─────────────────────────────────────────────

/**
 * Check if a user has per-switch write permission for a specific switch.
 */
function getUserSwitchWrite(userId, switchName) {
  const row = _db.prepare(
    'SELECT can_write FROM switch_permissions WHERE user_id = ? AND switch_name = ?'
  ).get(userId, switchName);
  return row ? row.can_write === 1 : false;
}

/**
 * Return all switch_permissions rows, used for the admin management UI.
 */
function getAllSwitchPermissions() {
  return _db.prepare(
    'SELECT user_id, switch_name, can_write FROM switch_permissions ORDER BY user_id, switch_name'
  ).all();
}

/**
 * Upsert per-switch write permission for a user.
 */
function setSwitchPermission(userId, switchName, canWrite) {
  _db.prepare(`
    INSERT INTO switch_permissions (user_id, switch_name, can_write)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, switch_name) DO UPDATE SET can_write = ?
  `).run(userId, switchName, canWrite ? 1 : 0, canWrite ? 1 : 0);
}

function getPages() {
  return _db.prepare('SELECT * FROM pages ORDER BY sort_order').all();
}

/**
 * Session generation value used to invalidate old tokens after restart.
 */
function getTokenGeneration() {
  return _db.prepare('SELECT value FROM meta WHERE key = ?').get('token_generation')?.value || '1';
}

module.exports = { initDb, getDb, getUser, getAllUsers, createUser, updatePassword, setMustChangePassword, deleteUser, getUserPermissions, setPermission, getUserSwitchWrite, getAllSwitchPermissions, setSwitchPermission, getPages, getTokenGeneration, DEFAULT_READ_PAGES, PAGES };
