#!/usr/bin/env node
/**
 * ROS-Dash user management — add/update users
 * Usage: node src/add-user.js <username> <password>
 */
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const USERS_FILE = path.join(__dirname, '..', 'users.json');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

const [,, username, password] = process.argv;
if (!username || !password) {
  console.error('Usage: node src/add-user.js <username> <password>');
  process.exit(1);
}

let users = {};
if (fs.existsSync(USERS_FILE)) {
  try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (_) {}
}

users[username] = {
  password: hashPassword(password),
  role: 'viewer',  // ready for future roles
  createdAt: new Date().toISOString(),
};

fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
console.log(`[ROS-Dash] User '${username}' saved to users.json`);
