#!/usr/bin/env node
/**
 * ROS-Dash user management — add/update users in SQLite
 * Usage: node src/add-user.js <username> <password> [role]
 */
const crypto = require('crypto');
const path   = require('path');
const { initDb, createUser, updatePassword, getUser, setPermission, getPages, getAllUsers } = require('./db');

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'ros-dash.db');
initDb(dbPath);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

const [,, username, password, role] = process.argv;
if (!username || !password) {
  console.error('Usage: node src/add-user.js <username> <password> [role]');
  console.error('Roles: admin, viewer (default: viewer)');
  process.exit(1);
}

const isAdmin   = role === 'admin';
const existing  = getUser(username);

if (existing) {
  // Update password
  updatePassword(username, hashPassword(password));
  console.log(`[ROS-Dash] Password updated for '${username}'`);
} else {
  // Create new user
  const userId = createUser(username, hashPassword(password), new Date().toISOString());
  // Grant permissions based on role
  if (isAdmin) {
    const pages = getPages();
    pages.forEach(p => setPermission(userId, p.key, 1, 1));
    console.log(`[ROS-Dash] Admin user '${username}' created with full permissions`);
  } else {
    console.log(`[ROS-Dash] Viewer user '${username}' created with default permissions`);
  }
}