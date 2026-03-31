#!/usr/bin/env node
/**
 * ROS-Dash user management — add/update users in SQLite
 * Usage: node src/add-user.js <username> <password> [role] [--must-change]
 */
const crypto = require('crypto');
const path   = require('path');
const { initDb, createUser, updatePassword, getUser, setPermission, getPages, getAllUsers } = require('./db');
const { validatePassword } = require('./util/passwordPolicy');

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'ros-dash.db');
initDb(dbPath);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

const args = process.argv.slice(2);
const username = args[0];
const password = args[1];
const role = args[2];
const mustChangePassword = args.includes('--must-change');
if (!username || !password) {
  console.error('Usage: node src/add-user.js <username> <password> [role] [--must-change]');
  console.error('Roles: admin, viewer (default: viewer)');
  process.exit(1);
}

const pwdIssues = validatePassword(password);
if (pwdIssues.length) {
  console.error('[ROS-Dash] Password policy failed:');
  pwdIssues.forEach(i => console.error(' - ' + i));
  process.exit(1);
}

const isAdmin   = role === 'admin';
const existing  = getUser(username);

if (existing) {
  // Update password
  updatePassword(username, hashPassword(password), { mustChangePassword });
  console.log(`[ROS-Dash] Password updated for '${username}'`);
} else {
  // Create new user
  const userId = createUser(username, hashPassword(password), new Date().toISOString(), mustChangePassword);
  // Grant permissions based on role
  if (isAdmin) {
    const pages = getPages();
    pages.forEach(p => setPermission(userId, p.key, 1, 1));
    console.log(`[ROS-Dash] Admin user '${username}' created with full permissions`);
  } else {
    console.log(`[ROS-Dash] Viewer user '${username}' created with default permissions`);
  }
}