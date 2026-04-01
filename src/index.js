require('dotenv').config();

const path   = require('path');
const { initDb } = require('./db');

// Initialise database — path can be overridden via DB_PATH env var
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'ros-dash.db');
initDb(dbPath);

const { makeToken, verifyPassword, requireAuth, requireAuthSocket, requireAdmin, validateUser, getTokenUser, requirePageRead, requirePageWrite, requireSwitchWrite } = require('./auth');
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const { z } = require('zod');
const { RouterOsInputError, sanitizeRosId, sanitizePeerName, sanitizeAddressListName } = require('./util/routerosSanitize');
const { getErrorMessage } = require('./util/errors');
const { validatePassword } = require('./util/passwordPolicy');
const { initOuiCache, lookupVendor } = require('./util/oui');

const ROS                  = require('./routeros/client');
const { fetchInterfaces }  = require('./collectors/interfaces');
const TrafficCollector     = require('./collectors/traffic');
const DhcpLeasesCollector  = require('./collectors/dhcpLeases');
const DhcpNetworksCollector= require('./collectors/dhcpNetworks');
const ArpCollector         = require('./collectors/arp');
const ConnectionsCollector = require('./collectors/connections');
const TopTalkersCollector  = require('./collectors/talkers');
const LogsCollector        = require('./collectors/logs');
const SystemCollector      = require('./collectors/system');
// const WirelessCollector    = require('./collectors/wireless');
const VpnCollector         = require('./collectors/vpn');
const FirewallCollector    = require('./collectors/firewall');
const InterfaceStatusCollector = require('./collectors/interfaceStatus');
const PingCollector        = require('./collectors/ping');
const WanIpsCollector      = require('./collectors/wanips');
const NeighborsCollector   = require('./collectors/neighbors');
const SwitchesCollector    = require('./collectors/switches');
const RoutesCollector      = require('./collectors/routes');
const AddressListsCollector = require('./collectors/addressLists');

const app = express();

// Parse request bodies for login form
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Session middleware for CSRF token storage
const session = require('express-session');
app.use(session({
  secret: process.env.DASH_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, httpOnly: true, sameSite: 'strict', maxAge: 24*60*60*1000 },
}));

// CSRF protection middleware (will be applied selectively)
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: false });

// WireGuard environment-backed config
const WG_INTERFACE = process.env.WG_INTERFACE || 'WireGuard';
const WG_LIST_PREFIX = process.env.WG_LIST_PREFIX || 'WG-';
const WG_SERVER_LISTEN_PORT = parseInt(process.env.WG_SERVER_LISTEN_PORT || '13231', 10);
const WG_CLIENT_DNS = process.env.WG_CLIENT_DNS || '192.168.168.1';
const WG_ALLOWED_SUBNET = process.env.WG_ALLOWED_SUBNET || '192.168.168.0/24';
const WG_CLIENT_PREFIX = parseInt(process.env.WG_CLIENT_PREFIX || '24', 10);

function buildWgAllowedAddressRegex(cidr) {
  const m = String(cidr || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.0\/24$/);
  if (!m) {
    console.warn('[wireguard] WG_ALLOWED_SUBNET invalid, falling back to 192.168.168.0/24');
    return /^192\.168\.168\.\d{1,3}\/32$/;
  }
  return new RegExp('^' + m[1] + '\\.' + m[2] + '\\.' + m[3] + '\\.\\d{1,3}\\/32$');
}

const WG_ALLOWED_ADDRESS_REGEX = buildWgAllowedAddressRegex(WG_ALLOWED_SUBNET);

// ── Validation Schemas ───────────────────────────────────────────────────

// IP address regex: matches standard IPv4 format
const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;

// DHCP schemas
const dhcpMakeStaticSchema = z.object({
  ip: z.string().regex(ipRegex, 'Invalid IP address'),
});

const dhcpRemoveStaticSchema = z.object({
  ip: z.string().regex(ipRegex, 'Invalid IP address'),
});

// WireGuard schemas
const wireguardCreatePeerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  allowedAddress: z.string().regex(WG_ALLOWED_ADDRESS_REGEX, `Allowed address must be in ${WG_ALLOWED_SUBNET} with /32 CIDR`),
  clientEndpoint: z.string().regex(/^[\w\-.]+(:\d+)?$/, 'Invalid client endpoint format'),
  addressList: z.string().optional(),
  clientAllowedAddress: z.string().optional(),
});

const wireguardUpdatePeerSchema = z.object({
  disabled: z.boolean().optional(),
  addressList: z.string().optional(),
  currentList: z.string().optional(),
  allowedAddress: z.string().optional(),
});

// User schemas
const userCreateSchema = z.object({
  username: z.string().min(1, 'Username is required').max(50, 'Username too long'),
  password: z.string().min(1, 'Password is required').superRefine((val, ctx) => {
    const issues = validatePassword(val);
    for (const issue of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
  }),
  forcePasswordChange: z.boolean().optional(),
});

const userPasswordSchema = z.object({
  password: z.string().min(1, 'Password is required').superRefine((val, ctx) => {
    const issues = validatePassword(val);
    for (const issue of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
  }),
  forcePasswordChange: z.boolean().optional(),
});

const selfPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(1, 'New password is required').superRefine((val, ctx) => {
    const issues = validatePassword(val);
    for (const issue of issues) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue });
  }),
});

const forcePwdSchema = z.object({
  mustChangePassword: z.boolean(),
});

// Permissions schemas
const permissionSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  pageKey: z.string().min(1, 'Page key is required'),
  canRead: z.boolean().optional(),
  canWrite: z.boolean().optional(),
});

const switchPortVlanSchema = z.object({
  ifName: z.string().min(1, 'Port name is required'),
  vlan: z.coerce.number().int().min(1, 'VLAN must be 1-4094').max(4094, 'VLAN must be 1-4094'),
});

const switchPortAdminSchema = z.object({
  ifName: z.string().min(1, 'Port name is required'),
  enabled: z.boolean(),
});

const switchPermSchema = z.object({
  username:   z.string().min(1, 'Username is required'),
  switchName: z.string().min(1, 'Switch name is required'),
  canWrite:   z.boolean(),
});

// Serve CSRF token for AJAX requests
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Login route — public, no CSRF check required for initial login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
const authedUser = validateUser(username, password);
  if (authedUser) {
    const token = makeToken(authedUser);
    res.setHeader('Set-Cookie', `rosdash_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    res.redirect('/');
  } else {
    res.redirect('/login.html?error=1');
  }
});

// WAN IPs for WireGuard endpoint dropdown
app.get('/api/wanips', requireAuth, requirePageRead('vpn'), (req, res) => {
  const ips = (wanIps.lastIps || []).map(ip => ip.split('/')[0]);
  res.json({ ips });
});

// Make DHCP lease static
app.post('/api/dhcp/make-static', csrfProtection, requireAuth, requirePageWrite('dhcp'), async (req, res) => {
  try {
    const { ip } = dhcpMakeStaticSchema.parse(req.body);
    const lease = dhcpLeases.getLeaseByIP(ip);
    if (!lease) return res.status(404).json({ error: 'Lease not found' });
    if (lease.type === 'static') return res.status(400).json({ error: 'Already static' });
    if (!lease.id) return res.status(400).json({ error: 'No lease ID — try again after next poll' });
    const safeLeaseId = sanitizeRosId(lease.id, 'lease id');
    await ros.write('/ip/dhcp-server/lease/make-static', ['=.id=' + safeLeaseId]);
    console.log(`[dhcp] made static: ${ip} id=${lease.id}`);
    auditLog(req, 'dhcp.reserve', ip, null, 'ok');
    res.json({ ok: true });
  } catch(e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    if (e instanceof RouterOsInputError) {
      return res.status(400).json({ error: e.message });
    }
    const msg = getErrorMessage(e);
    console.error('[dhcp] make-static failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Remove static DHCP lease
app.post('/api/dhcp/remove-static', csrfProtection, requireAuth, requirePageWrite('dhcp'), async (req, res) => {
  try {
    const { ip } = dhcpRemoveStaticSchema.parse(req.body);
    const lease = dhcpLeases.getLeaseByIP(ip);
    if (!lease) return res.status(404).json({ error: 'Lease not found' });
    if (lease.type === 'dynamic') return res.status(400).json({ error: 'Lease is already dynamic' });
    if (!lease.id) return res.status(400).json({ error: 'No lease ID — try again after next poll' });
    const safeLeaseId = sanitizeRosId(lease.id, 'lease id');
    await ros.write('/ip/dhcp-server/lease/remove', ['=.id=' + safeLeaseId]);
    console.log(`[dhcp] removed static lease: ${ip} id=${lease.id}`);
    auditLog(req, 'dhcp.release', ip, null, 'ok');
    res.json({ ok: true });
  } catch(e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    if (e instanceof RouterOsInputError) {
      return res.status(400).json({ error: e.message });
    }
    const msg = getErrorMessage(e);
    console.error('[dhcp] remove-static failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── WireGuard Management ──────────────────────────────────────────────────

const { generateKeypair, generatePsk, buildConfig } = require('./util/wireguard');

// Get all WireGuard user peers with address list membership
app.get('/api/wireguard/peers', requireAuth, requirePageRead('vpn'), async (req, res) => {
  try {
    const [peers, alRows] = await Promise.all([
      ros.write('/interface/wireguard/peers/print'),
      ros.write('/ip/firewall/address-list/print'),
    ]);
    // Only WireGuard interface peers
    const wgPeers = (peers || []).filter(p => p.interface === WG_INTERFACE);
    // Build map: ip -> [listName]
    const ipLists = new Map();
    for (const r of (alRows || [])) {
      if (!(r.list || '').startsWith(WG_LIST_PREFIX)) continue;
      const ip = r.address || '';
      if (!ipLists.has(ip)) ipLists.set(ip, []);
      ipLists.get(ip).push({ list: r.list, id: r['.id'], comment: r.comment || '' });
    }
    const result = wgPeers.map(p => {
      const allowedIp = (p['allowed-address'] || '').split('/')[0];
      const lists = ipLists.get(allowedIp + '/32') || ipLists.get(allowedIp) || [];
      return {
        id:                   p['.id'],
        name:                 p.comment || p.name || '',
        publicKey:            p['public-key'] || '',
        allowedAddress:       p['allowed-address'] || '',
        clientAddress:        p['client-address'] || '',
        clientDns:            p['client-dns'] || '',
        clientEndpoint:       p['client-endpoint'] || '',
        clientAllowedAddress: p['client-allowed-address'] || '',
        disabled:             p.disabled === 'true' || p.disabled === true,
        addressLists:         lists,
        currentList:          lists.length ? lists[0].list : '',
      };
    });
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: getErrorMessage(e) });
  }
});

// Get WG- address lists
app.get('/api/wireguard/address-lists', requireAuth, requirePageRead('vpn'), async (req, res) => {
  try {
    const rows = await ros.write('/ip/firewall/address-list/print');
    const lists = [...new Set((rows || [])
      .map(r => r.list || '')
      .filter(l => l.startsWith(WG_LIST_PREFIX))
    )].sort();
    res.json(lists);
  } catch(e) {
    res.status(500).json({ error: getErrorMessage(e) });
  }
});

// Get used WireGuard IPs for duplicate checking
app.get('/api/wireguard/used-ips', requireAuth, requirePageRead('vpn'), async (req, res) => {
  try {
    const peers = await ros.write('/interface/wireguard/peers/print');
    const ips = (peers || [])
      .filter(p => p.interface === WG_INTERFACE)
      .map(p => (p['allowed-address'] || '').split('/')[0])
      .filter(Boolean);
    res.json(ips);
  } catch(e) {
    res.status(500).json({ error: getErrorMessage(e) });
  }
});

// Create new WireGuard peer
app.post('/api/wireguard/peers', csrfProtection, requireAuth, requirePageWrite('vpn'), async (req, res) => {
  try {
    const { name, allowedAddress, addressList, clientEndpoint, clientAllowedAddress } = wireguardCreatePeerSchema.parse(req.body);
    const safeName = sanitizePeerName(name);
    
    // Validate /32
    const ip = allowedAddress.split('/')[0];

    // Check for duplicate
    const existing = await ros.write('/interface/wireguard/peers/print');
    const used = (existing || []).map(p => (p['allowed-address'] || '').split('/')[0]);
    if (used.includes(ip)) return res.status(409).json({ error: 'IP address ' + ip + ' is already in use' });

    // Generate keys
    const { privateKey, publicKey } = generateKeypair();
    const psk = generatePsk();

    // Get server public key
    const interfaces = await ros.write('/interface/wireguard/print');
    const wgIface = (interfaces || []).find(i => i.name === WG_INTERFACE);
    const serverPublicKey = wgIface ? wgIface['public-key'] : '';

    // Create peer on router
    await ros.write('/interface/wireguard/peers/add', [
      '=interface='          + WG_INTERFACE,
      '=comment='            + safeName,
      '=name='               + safeName,
      '=public-key='         + publicKey,
      '=preshared-key='      + psk,
      '=allowed-address='    + ip + '/32',
      '=client-address='     + ip + '/' + WG_CLIENT_PREFIX,
      '=client-dns='         + WG_CLIENT_DNS,
      '=client-endpoint='    + clientEndpoint,
      '=client-allowed-address=' + (clientAllowedAddress || '0.0.0.0/0'),
    ]);

    // Add to address list if specified
    if (addressList && addressList.startsWith(WG_LIST_PREFIX)) {
      const safeAddressList = sanitizeAddressListName(addressList, WG_LIST_PREFIX);
      await ros.write('/ip/firewall/address-list/add', [
        '=list='    + safeAddressList,
        '=address=' + ip + '/32',
        '=comment=' + safeName,
      ]);
    }

    // Build client config
    const config = buildConfig({
      name: safeName, privateKey, psk, serverPublicKey,
      allowedAddress:        ip + '/32',
      clientAddress:         ip + '/' + WG_CLIENT_PREFIX,
      clientDns:             WG_CLIENT_DNS,
      clientEndpoint,
      clientAllowedAddresses: clientAllowedAddress || '0.0.0.0/0',
      listenPort:            WG_SERVER_LISTEN_PORT,
    });

    console.log('[wireguard] created peer:', name, ip);
    auditLog(req, 'wg.create-peer', name, 'ip=' + ip, 'ok');
    res.json({ ok: true, config, publicKey });

  } catch(e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    if (e instanceof RouterOsInputError) {
      return res.status(400).json({ error: e.message });
    }
    const msg = getErrorMessage(e);
    console.error('[wireguard] create peer failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Update WireGuard peer (enable/disable, address list change)
app.patch('/api/wireguard/peers/:id', csrfProtection, requireAuth, requirePageWrite('vpn'), async (req, res) => {
  try {
    const safePeerId = sanitizeRosId(req.params.id, 'peer id');
    const { disabled, addressList, currentList, allowedAddress } = wireguardUpdatePeerSchema.parse(req.body);
    
    // Enable/disable
    if (typeof disabled !== 'undefined') {
      if (disabled) {
        await ros.write('/interface/wireguard/peers/disable', ['=.id=' + safePeerId]);
      } else {
        await ros.write('/interface/wireguard/peers/enable', ['=.id=' + safePeerId]);
      }
    }
    // Address list change
    if (typeof addressList !== 'undefined' && allowedAddress) {
      const ip = allowedAddress.split('/')[0];
      const rows = await ros.write('/ip/firewall/address-list/print');
      // Remove existing WG- list entries for this IP
      for (const r of (rows || [])) {
        if ((r.list || '').startsWith(WG_LIST_PREFIX) &&
            (r.address === ip + '/32' || r.address === ip)) {
          const safeAddressListId = sanitizeRosId(r['.id'], 'address list id');
          await ros.write('/ip/firewall/address-list/remove', ['=.id=' + safeAddressListId]);
        }
      }
      // Add to new list if specified
      if (addressList) {
        const safeAddressList = sanitizeAddressListName(addressList, WG_LIST_PREFIX);
        const peers = await ros.write('/interface/wireguard/peers/print');
        const peer  = (peers || []).find(p => p['.id'] === safePeerId);
        const comment = peer ? (peer.comment || peer.name || '') : '';
        const safeComment = String(comment || 'WireGuard peer').replace(/[=\r\n\0]/g, ' ').slice(0, 64);
        await ros.write('/ip/firewall/address-list/add', [
          '=list='    + safeAddressList,
          '=address=' + ip + '/32',
          '=comment=' + safeComment,
        ]);
      }
    }
    console.log('[wireguard] updated peer:', safePeerId);
    auditLog(req, 'wg.update-peer', safePeerId, null, 'ok');
    res.json({ ok: true });
  } catch(e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    if (e instanceof RouterOsInputError) {
      return res.status(400).json({ error: e.message });
    }
    const msg = getErrorMessage(e);
    console.error('[wireguard] update peer failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Router backup download
app.get('/api/system/backup', requireAuth, requirePageRead('dashboard'), async (req, res) => {
  const { Client } = require('ssh2');
  const backupName = 'ros-dash-backup';
  const backupFile = backupName + '.backup';

  try {
    // Step 1 — trigger backup save via RouterOS API
    await ros.write('/system/backup/save', ['=name=' + backupName, '=dont-encrypt=yes']);
    console.log('[backup] backup saved on router');

    // Step 2 — give router a moment to write the file
    await new Promise(r => setTimeout(r, 2000));

    // Step 3 — SFTP the file off the router
    const fileBuffer = await new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); return reject(err); }
          const chunks = [];
          const stream = sftp.createReadStream(backupFile);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => { conn.end(); resolve(Buffer.concat(chunks)); });
          stream.on('error', err => { conn.end(); reject(err); });
        });
      });
      conn.on('error', reject);
      conn.connect({
        host:     process.env.ROUTER_HOST,
        port:     22,
        username: process.env.ROUTER_USER,
        password: process.env.ROUTER_PASS,
      });
    });

    // Step 4 — clean up file on router
    try {
      await ros.write('/file/remove', ['=numbers=' + backupFile]);
    } catch(e) {
      console.warn('[backup] cleanup failed (non-fatal):', getErrorMessage(e));
    }

    // Step 5 — stream to browser
    const date = new Date().toISOString().slice(0, 10);
    const filename = 'ros-dash-backup-' + date + '.backup';
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fileBuffer.length);
    res.send(fileBuffer);
    console.log('[backup] sent ' + fileBuffer.length + ' bytes to client');

  } catch(e) {
    const msg = getErrorMessage(e);
    console.error('[backup] failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Switch port data for visualiser
app.get('/api/switches/list', requireAuth, requirePageRead('switches'), (req, res) => {
  res.json(switches.getSwitchList());
});

app.get('/api/switches/:name/ports', requireAuth, requirePageRead('switches'), (req, res) => {
  const data = switches.getPortData(req.params.name);
  if (!data) return res.status(404).json({ error: 'Switch not found or not yet polled' });
  const tokenUser = getTokenUser(req);
  let userCanWrite = false;
  if (tokenUser) {
    if (tokenUser.id === null) {
      userCanWrite = true;
    } else {
      const perms = tokenUser.permissions || {};
      if (perms.switchadmin && perms.switchadmin.write) {
        userCanWrite = true;
      } else {
        userCanWrite = getUserSwitchWrite(tokenUser.id, req.params.name);
      }
    }
  }
  res.json({ ...data, userCanWrite });
});

app.post('/api/switches/:name/port-vlan', csrfProtection, requireAuth, requireSwitchWrite('name'), async (req, res) => {
  try {
    const { ifName, vlan } = switchPortVlanSchema.parse(req.body);
    const result = await switches.setPortVlan({ switchName: req.params.name, ifName, vlan });
    auditLog(req, 'switch.vlan', req.params.name + '/' + ifName, 'vlan=' + vlan, 'ok');
    res.json({ ok: true, result });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    if (e && e.statusCode) {
      return res.status(e.statusCode).json({ error: getErrorMessage(e) });
    }
    const msg = getErrorMessage(e);
    console.error('[switches] set port vlan failed:', msg);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/switches/:name/port-admin', csrfProtection, requireAuth, requireSwitchWrite('name'), async (req, res) => {
  try {
    const { ifName, enabled } = switchPortAdminSchema.parse(req.body);
    const result = await switches.setPortAdmin({ switchName: req.params.name, ifName, enabled });
    auditLog(req, 'switch.admin', req.params.name + '/' + ifName, enabled ? 'no-shutdown' : 'shutdown', 'ok');
    res.json({ ok: true, result });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    if (e && e.statusCode) {
      return res.status(e.statusCode).json({ error: getErrorMessage(e) });
    }
    const msg = getErrorMessage(e);
    console.error('[switches] set port admin failed:', msg);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/switches/:name/write-memory', csrfProtection, requireAuth, requireSwitchWrite('name'), async (req, res) => {
  try {
    const result = await switches.writeMemory({ switchName: req.params.name });
    auditLog(req, 'switch.write-memory', req.params.name, null, 'ok');
    res.json({ ok: true, result });
  } catch (e) {
    if (e && e.statusCode) {
      return res.status(e.statusCode).json({ error: getErrorMessage(e) });
    }
    const msg = getErrorMessage(e);
    console.error('[switches] write memory failed:', msg);
    return res.status(500).json({ error: msg });
  }
});

// Switch write-access permissions grid — requires switchadmin
app.get('/api/switch-permissions', requireAuth, requirePageRead('switchadmin'), (req, res) => {
  const users = getAllUsers();
  const grants = getAllSwitchPermissions();
  const switchList = switches.getSwitchList().map(s => s.name);

  // Build a userId → { switchName: canWrite } map
  const grantsMap = {};
  for (const g of grants) {
    if (!grantsMap[g.user_id]) grantsMap[g.user_id] = {};
    grantsMap[g.user_id][g.switch_name] = g.can_write === 1;
  }

  const result = users.map(u => {
    const perms = getUserPermissions(u.id);
    return {
      username:    u.username,
      switchAdmin: !!(perms.switchadmin && perms.switchadmin.write),
      grants:      grantsMap[u.id] || {},
    };
  });

  res.json({ switches: switchList, users: result });
});

app.post('/api/switch-permissions', csrfProtection, requireAuth, requirePageWrite('switchadmin'), (req, res) => {
  try {
    const { username, switchName, canWrite } = switchPermSchema.parse(req.body);
    const user = getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    setSwitchPermission(user.id, switchName, canWrite);
    auditLog(req, 'perm.switch', username + '/' + switchName, canWrite ? 'grant' : 'revoke', 'ok');
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: e.errors[0].message });
    const msg = getErrorMessage(e);
    console.error('[switch-permissions] set failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Current user info
app.get('/api/me', requireAuth, (req, res) => {
  const user = getTokenUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorised' });
  res.json({ username: user.username, permissions: user.permissions || {}, mustChangePassword: !!user.mustChangePassword });
});

// Logout route
app.get('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'rosdash_token=; HttpOnly; Path=/; Max-Age=0');
  res.redirect('/login.html');
});

// User management API
const crypto_users = require('crypto');
const { getAllUsers, getUser, createUser, updatePassword, setMustChangePassword, deleteUser, getUserPermissions, setPermission, getUserSwitchWrite, getAllSwitchPermissions, setSwitchPermission, getPages, upsertInventoryMac, getAllInventory, updateInventoryNotes, addAuditLog, getAuditLogs } = require('./db');

function hashPassword(password) {
  const salt = crypto_users.randomBytes(16).toString('hex');
  const hash = crypto_users.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function auditLog(req, action, target, detail, outcome) {
  try {
    const u = getTokenUser(req);
    addAuditLog({ username: u ? u.username : 'unknown', action, target: target || '', detail: detail || null, outcome: outcome || 'ok' });
  } catch (_) {}
}

// List all users — requires users:read
app.get('/api/users', requireAuth, requirePageRead('users'), (_req, res) => {
  const users = getAllUsers();
  const result = users.map(u => ({
    username: u.username,
    createdAt: u.created_at,
    mustChangePassword: u.must_change_password === 1,
    permissions: getUserPermissions(u.id),
  }));
  res.json(result);
});

// Add user — requires users:write
app.post('/api/users', csrfProtection, requireAuth, requirePageWrite('users'), (req, res) => {
  try {
    const { username, password, forcePasswordChange } = userCreateSchema.parse(req.body);
    if (getUser(username)) return res.status(409).json({ error: 'User already exists' });
    createUser(username, hashPassword(password), new Date().toISOString(), !!forcePasswordChange);
    auditLog(req, 'user.create', username, forcePasswordChange ? 'force-change' : null, 'ok');
    res.json({ ok: true });
  } catch(e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    const msg = getErrorMessage(e);
    console.error('[users] create user failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Change password — requires users:write
app.patch('/api/users/:username', csrfProtection, requireAuth, requirePageWrite('users'), (req, res) => {
  try {
    const { username } = req.params;
    const { password, forcePasswordChange } = userPasswordSchema.parse(req.body);
    if (!getUser(username)) return res.status(404).json({ error: 'User not found' });
    updatePassword(username, hashPassword(password), { mustChangePassword: !!forcePasswordChange });
    auditLog(req, 'user.password', username, forcePasswordChange ? 'force-change' : null, 'ok');
    res.json({ ok: true });
  } catch(e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    const msg = getErrorMessage(e);
    console.error('[users] update password failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Delete user — requires users:write
app.delete('/api/users/:username', csrfProtection, requireAuth, requirePageWrite('users'), (req, res) => {
  const { username } = req.params;
  if (!getUser(username)) return res.status(404).json({ error: 'User not found' });
  deleteUser(username);
  auditLog(req, 'user.delete', username, null, 'ok');
  res.json({ ok: true });
});

app.post('/api/users/:username/force-password-change', csrfProtection, requireAuth, requirePageWrite('users'), (req, res) => {
  try {
    const { username } = req.params;
    const { mustChangePassword } = forcePwdSchema.parse(req.body);
    if (!getUser(username)) return res.status(404).json({ error: 'User not found' });
    setMustChangePassword(username, mustChangePassword);
    auditLog(req, 'user.force-change', username, mustChangePassword ? 'enabled' : 'disabled', 'ok');
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    const msg = getErrorMessage(e);
    console.error('[users] force password change failed:', msg);
    res.status(500).json({ error: msg });
  }
});

app.post('/api/me/password', csrfProtection, requireAuth, (req, res) => {
  try {
    const tokenUser = getTokenUser(req);
    if (!tokenUser) return res.status(401).json({ error: 'Unauthorised' });
    if (tokenUser.id === null) return res.status(400).json({ error: 'Password change is not supported for environment-based users' });

    const { currentPassword, newPassword } = selfPasswordSchema.parse(req.body);
    const dbUser = getUser(tokenUser.username);
    if (!dbUser) return res.status(404).json({ error: 'User not found' });
    if (!verifyPassword(dbUser.password, currentPassword)) return res.status(400).json({ error: 'Current password is incorrect' });

    updatePassword(tokenUser.username, hashPassword(newPassword), { mustChangePassword: false });
    auditLog(req, 'me.password', tokenUser.username, null, 'ok');
    const authedUser = validateUser(tokenUser.username, newPassword);
    const token = makeToken(authedUser);
    res.setHeader('Set-Cookie', `rosdash_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    const msg = getErrorMessage(e);
    console.error('[users] self password change failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Get pages list — requires users:read
app.get('/api/pages', requireAuth, requirePageRead('users'), (_req, res) => {
  res.json(getPages());
});

// Set permission — requires users:write
app.post('/api/permissions', csrfProtection, requireAuth, requirePageWrite('users'), (req, res) => {
  try {
    const { username, pageKey, canRead, canWrite } = permissionSchema.parse(req.body);
    const user = getUser(username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    setPermission(user.id, pageKey, canRead, canWrite);
    auditLog(req, 'perm.page', username + '/' + pageKey, 'read=' + !!canRead + ' write=' + !!canWrite, 'ok');
    res.json({ ok: true });
  } catch(e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    const msg = getErrorMessage(e);
    console.error('[permissions] set permission failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Client Inventory — aggregates from DHCP leases, ARP, and switch MAC tables
app.get('/api/inventory', requireAuth, requirePageRead('inventory'), (req, res) => {
  try {
    const now = new Date().toISOString();
    const seen = new Map();

    // From DHCP leases
    for (const [ip, v] of dhcpLeases.byIP.entries()) {
      if (!v.mac) continue;
      const mac = v.mac.toLowerCase();
      seen.set(mac, { mac, ip, hostname: v.hostName || v.name || '', status: v.status || '', leaseType: v.type || '' });
    }

    // From ARP (IPs not resolved via DHCP)
    for (const [ip, v] of arp.byIP.entries()) {
      if (!v.mac) continue;
      const mac = v.mac.toLowerCase();
      if (!seen.has(mac)) {
        seen.set(mac, { mac, ip, hostname: '', status: 'arp-only', leaseType: '' });
      }
    }

    // From switch MAC table — add port/VLAN info and fill in hostnames
    for (const port of switches.getLastMacPorts()) {
      if (!port.mac) continue;
      const mac = port.mac.toLowerCase();
      const entry = seen.get(mac) || { mac, ip: '', hostname: '', status: '', leaseType: '' };
      entry.switch = port.switch;
      entry.switchPort = port.port;
      entry.vlan = port.vlan;
      if (!entry.hostname && port.name) entry.hostname = port.name;
      if (!seen.has(mac)) seen.set(mac, entry);
    }

    // Update last_seen for all currently visible MACs
    for (const mac of seen.keys()) {
      upsertInventoryMac(mac, now);
    }

    const dbRecords = getAllInventory();
    const dbMap = new Map(dbRecords.map(r => [r.mac, r]));
    const devices = [];

    // Currently visible devices
    for (const [mac, entry] of seen.entries()) {
      const db = dbMap.get(mac) || {};
      devices.push({ ...entry, vendor: lookupVendor(mac), firstSeen: db.first_seen || now, lastSeen: db.last_seen || now, notes: db.notes || '', tags: db.tags || '', online: true });
    }

    // Historical devices no longer visible
    for (const row of dbRecords) {
      if (!seen.has(row.mac)) {
        devices.push({ mac: row.mac, ip: '', hostname: '', status: 'offline', leaseType: '', switch: '', switchPort: '', vlan: null, vendor: lookupVendor(row.mac), firstSeen: row.first_seen, lastSeen: row.last_seen, notes: row.notes || '', tags: row.tags || '', online: false });
      }
    }

    res.json({ devices });
  } catch (e) {
    res.status(500).json({ error: getErrorMessage(e) });
  }
});

// Audit Log — paginated, filterable
app.get('/api/audit-log', requireAuth, requirePageRead('auditlog'), (req, res) => {
  try {
    const limit    = Math.min(500, Math.max(1, parseInt(req.query.limit  || '100', 10)));
    const offset   = Math.max(0, parseInt(req.query.offset || '0',   10));
    const username = String(req.query.username || '').trim();
    const action   = String(req.query.action   || '').trim();
    const fromDate = String(req.query.fromDate || '').trim();
    const toDate   = String(req.query.toDate   || '').trim();
    const result   = getAuditLogs({ limit, offset, username, action, fromDate, toDate });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: getErrorMessage(e) });
  }
});

// Inventory — update notes/tags for a device
app.post('/api/inventory/:mac', requireAuth, requirePageWrite('inventory'), (req, res) => {
  try {
    const mac = req.params.mac;
    const { notes, tags } = req.body;
    
    if (!mac || typeof mac !== 'string') {
      return res.status(400).json({ error: 'Invalid MAC address' });
    }
    
    updateInventoryNotes(mac, notes || '', tags || '');
    auditLog(req, 'inventory-edit', mac, 'Updated notes/tags', 'ok');
    res.json({ success: true });
  } catch (e) {
    auditLog(req, 'inventory-edit', req.params.mac, 'Failed to update', 'error');
    res.status(500).json({ error: getErrorMessage(e) });
  }
});

// Serve login page specifically — no auth required
app.get('/login.html', (_req, res) => {
  res.sendFile('login.html', { root: 'public' });
});


// Serve logo without auth (needed for login page)
app.get('/logo.png', (_req, res) => {
  res.sendFile('logo.png', { root: 'public' });
});

// All other static files require auth
app.use(requireAuth, express.static('public'));

// Return clear 403 responses for invalid or missing CSRF tokens.
app.use((err, _req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  return next(err);
});

const server = http.createServer(app);
const io = new Server(server);

const state = {
  lastTrafficTs:0,  lastTrafficErr:null,
  lastConnsTs:0,    lastConnsErr:null,
  lastNetworksTs:0,
  lastLeasesTs:0,
  lastArpTs:0,
  lastTalkersTs:0,  lastTalkersErr:null,
  lastLogsTs:0,     lastLogsErr:null,
  lastSystemTs:0,   lastSystemErr:null,
  // lastWirelessTs:0, lastWirelessErr:null,
  lastVpnTs:0,      lastVpnErr:null,
  lastFirewallTs:0, lastFirewallErr:null,
  lastIfStatusTs:0,
  lastPingTs:0,
  lastNeighborsTs: 0,
  lastSwitchesTs:  0,
  lastRoutesTs: 0,
  lastAddressListsTs: 0,
};

const ros = new ROS({
  host:        process.env.ROUTER_HOST,
  port:        parseInt(process.env.ROUTER_PORT || '8729', 10),
  tls:         (process.env.ROUTER_TLS          || 'true') .toLowerCase() === 'true',
  tlsInsecure: (process.env.ROUTER_TLS_INSECURE || 'false').toLowerCase() === 'true',
  username:    process.env.ROUTER_USER,
  password:    process.env.ROUTER_PASS,
  debug:       (process.env.ROS_DEBUG           || 'false').toLowerCase() === 'true',
});

const DEFAULT_IF      = process.env.DEFAULT_IF       || 'WAN1';
const HISTORY_MINUTES = parseInt(process.env.HISTORY_MINUTES || '30', 10);

// Collectors — order matters: leases must exist before networks/connections
const dhcpLeases   = new DhcpLeasesCollector ({ros,io, pollMs:parseInt(process.env.LEASES_POLL_MS   ||'15000',10), state});
const arp          = new ArpCollector         ({ros,    pollMs:parseInt(process.env.ARP_POLL_MS      ||'30000',10), state});
const dhcpNetworks = new DhcpNetworksCollector({ros,io, pollMs:parseInt(process.env.DHCP_POLL_MS     ||'15000',10), dhcpLeases, state});
const traffic      = new TrafficCollector     ({ros,io, defaultIf:DEFAULT_IF, historyMinutes:HISTORY_MINUTES, pollMs:1000, state});
const conns        = new ConnectionsCollector ({ros,io, pollMs:parseInt(process.env.CONNS_POLL_MS    ||'3000',10),  topN:parseInt(process.env.TOP_N||'10',10), dhcpNetworks, dhcpLeases, arp, state});
const talkers      = new TopTalkersCollector  ({ros,io, pollMs:parseInt(process.env.KIDS_POLL_MS     ||'3000',10),  state, topN:parseInt(process.env.TOP_TALKERS_N||'5',10)});
conns._talkers = talkers;
const logs         = new LogsCollector        ({ros,io, state});
const system       = new SystemCollector      ({ros,io, pollMs:parseInt(process.env.SYSTEM_POLL_MS   ||'3000',10),  state});
// const wireless     = new WirelessCollector    ({ros,io, pollMs:parseInt(process.env.WIRELESS_POLL_MS ||'5000',10),  state, dhcpLeases, arp});
const vpn          = new VpnCollector         ({ros,io, pollMs:parseInt(process.env.VPN_POLL_MS      ||'10000',10), state});
const firewall     = new FirewallCollector    ({ros,io, pollMs:parseInt(process.env.FIREWALL_POLL_MS ||'10000',10), state, topN:parseInt(process.env.FIREWALL_TOP_N||'15',10)});
const ifStatus     = new InterfaceStatusCollector({ros,io, pollMs:parseInt(process.env.IFSTATUS_POLL_MS||'5000',10), state});
const ping         = new PingCollector({ros,io, pollMs:parseInt(process.env.PING_POLL_MS||'10000',10), state, target:process.env.PING_TARGET||'1.1.1.1'});
const wanIps       = new WanIpsCollector({ ros, io, pollMs: 30000, state, wanIface: DEFAULT_IF });
const neighbors    = new NeighborsCollector({ ros, io, pollMs: 60000, state });
const switches     = new SwitchesCollector({ ros, io, pollMs: parseInt(process.env.SWITCH_POLL_MS || '30000', 10), dhcpLeases, arp, dhcpNetworks, state });
const routes       = new RoutesCollector({ ros, io, pollMs: 30000, state });
const addressLists = new AddressListsCollector({ ros, io, pollMs: 60000, state });

app.get('/api/localcc', (_req, res) => {
  let geoip = null;
  try { geoip = require('geoip-lite'); } catch(e) {}
  const wanIp = (state.lastWanIp || '').split('/')[0];
  let cc = '';
  if (geoip && wanIp) { const g = geoip.lookup(wanIp); if (g) cc = g.country || ''; }
  res.json({ cc, wanIp });
});

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    version: '0.3.0',
    routerConnected: ros.connected,
    uptime: process.uptime(),
    now: Date.now(),
    defaultIf: DEFAULT_IF,
    checks: {
      traffic:  { ts:state.lastTrafficTs,  err:state.lastTrafficErr  },
      conns:    { ts:state.lastConnsTs,    err:state.lastConnsErr    },
      leases:   { ts:state.lastLeasesTs,   err:null                  },
      arp:      { ts:state.lastArpTs,      err:null                  },
      talkers:  { ts:state.lastTalkersTs,  err:state.lastTalkersErr  },
      logs:     { ts:state.lastLogsTs,     err:state.lastLogsErr     },
      system:   { ts:state.lastSystemTs,   err:state.lastSystemErr   },
      // wireless: { ts:state.lastWirelessTs, err:state.lastWirelessErr },
      vpn:      { ts:state.lastVpnTs,      err:state.lastVpnErr      },
      firewall: { ts:state.lastFirewallTs, err:state.lastFirewallErr },
      ping:     { ts:state.lastPingTs,     err:null                  },
    },
  });
});

ros.on('error', (err) => {
  // Errors are logged inside connectLoop — suppress uncaught crash
});
ros.connectLoop();

(async () => {
  try {
    await ros.waitUntilConnected(60000);
    console.log('[ROS-Dash] v0.3.2 — RouterOS connected, starting collectors');

    // Streams (traffic, logs, leases) start themselves and register
    // reconnect handlers internally. Polling collectors do the same.
    // No staggering needed — node-routeros handles concurrent commands.
    // Start wireless immediately in parallel — don't wait for dhcpLeases
    // Names won't resolve on the very first poll but arrive on the second
    // wireless.start();
    await dhcpLeases.start();   // async: loads initial state first
    dhcpNetworks.start();
    arp.start();
    traffic.start();
    conns.start();
    talkers.start();
    logs.start();
    system.start();
    vpn.start();
    firewall.start();
    ifStatus.start();
    ping.start();
    wanIps.start();
    neighbors.start();
    switches.start();
    routes.start();
    addressLists.start();

    console.log('[ROS-Dash] All collectors running');
  } catch (e) {
    console.error('[ROS-Dash] Startup error:', getErrorMessage(e));
  }
})();

async function sendInitialState(socket) {
  // Send traffic:history FIRST — before any async awaits — so the client
  // has currentIf set before traffic:update events start arriving.
  socket.emit('traffic:history', {
    ifName: DEFAULT_IF,
    windowMinutes: HISTORY_MINUTES,
    points: traffic.hist.get(DEFAULT_IF) ? traffic.hist.get(DEFAULT_IF).toArray() : [],
  });

  try { await ros.waitUntilConnected(10000); } catch (_) {}

  // These can fire in parallel — node-routeros is fully concurrent
  const [ifaceResult] = await Promise.allSettled([
    fetchInterfaces(ros),
  ]);

  const ifs = ifaceResult.status === 'fulfilled' ? ifaceResult.value : [];
  socket.emit('interfaces:list', { defaultIf: DEFAULT_IF, interfaces: ifs });

  socket.emit('lan:overview', {
    ts: Date.now(),
    lanCidrs: dhcpNetworks.getLanCidrs(),
    networks: dhcpNetworks.networks || [],
  });

  // Send current lease table to newly connected client
  const allLeases = [];
  for (const [ip, v] of dhcpLeases.byIP.entries()) {
    allLeases.push({ ip, ...v });
  }
  socket.emit('leases:list', { ts: Date.now(), leases: allLeases });

  // Push last wireless snapshot immediately so client doesn't wait for next poll
  // if (wireless.lastPayload) socket.emit('wireless:update', wireless.lastPayload);
}

io.use(requireAuthSocket);

io.on('connection', (socket) => {
  traffic.bindSocket(socket);
  sendInitialState(socket).catch(() => {});
});

// Broadcast full lease table every 15s so DHCP page stays current
setInterval(() => {
  const allLeases = [];
  for (const [ip, v] of dhcpLeases.byIP.entries()) allLeases.push({ ip, ...v });
  io.emit('leases:list', { ts: Date.now(), leases: allLeases });
}, 15000);

const PORT = parseInt(process.env.PORT || '3081', 10);
initOuiCache();
server.listen(PORT, () => console.log(`[ROS-Dash] v0.4.8 listening on http://0.0.0.0:${PORT}`));

// Graceful shutdown — checkpoint WAL so data persists across restarts
const { getDb } = require('./db');
function shutdown() {
  console.log('[ROS-Dash] Shutting down — checkpointing database...');
  try {
    const db = getDb();
    if (db) { db.pragma('wal_checkpoint(TRUNCATE)'); console.log('[ROS-Dash] Database checkpointed'); }
  } catch(e) { console.error('[ROS-Dash] Checkpoint failed:', getErrorMessage(e)); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);