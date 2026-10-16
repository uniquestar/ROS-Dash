const ipaddr = require('ipaddr.js');

function toInt(ip) {
  return ipaddr.IPv4.parse(ip).toByteArray().reduce((n, b) => n * 256 + b, 0);
}

function toIp(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

// Host addresses taken by a RouterOS address field such as "192.168.168.5/32,10.0.0.0/24"
// or a client-address like "192.168.168.5/24". Only the host part of each entry counts:
// routed ranges (site-to-site, 0.0.0.0/0) don't consume tunnel addresses.
function hostsFromAddressField(value, { hostOnly = true } = {}) {
  const out = [];
  for (const raw of String(value || '').split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const [ip, prefix] = entry.split('/');
    if (!ipaddr.IPv4.isValidFourPartDecimal(ip)) continue;
    if (hostOnly && prefix !== undefined && prefix !== '32') continue;
    out.push(ip);
  }
  return out;
}

// Every tunnel address in use by WireGuard peers (all interfaces, to be safe)
function usedPeerIps(peers) {
  const used = new Set();
  for (const p of (peers || [])) {
    for (const ip of hostsFromAddressField(p['allowed-address'])) used.add(ip);
    // client-address carries the client's own IP with the tunnel prefix, e.g. 192.168.168.5/24
    for (const ip of hostsFromAddressField(p['client-address'], { hostOnly: false })) used.add(ip);
  }
  return used;
}

// Lowest free host address in an IPv4 subnet, skipping network/broadcast,
// anything in `used` and anything in `reserved` (router address, DNS, ...).
// Returns null when the subnet is full or invalid.
function nextFreeIp(subnet, used, reserved = []) {
  let net, prefix;
  try {
    [net, prefix] = ipaddr.IPv4.parseCIDR(String(subnet));
  } catch (_) {
    return null;
  }
  if (prefix > 30) return null;
  const size = 2 ** (32 - prefix);
  const base = toInt(net.toString()) - (toInt(net.toString()) % size);
  const taken = new Set([...(used || []), ...reserved]);
  for (let n = base + 1; n < base + size - 1; n++) {
    const ip = toIp(n);
    if (!taken.has(ip)) return ip;
  }
  return null;
}

function isTrue(v) {
  return v === true || v === 'true';
}

// Default split-tunnel AllowedIPs for new peers: the WG subnet first, then every
// static private (RFC1918) network configured on the router's other interfaces.
// Dynamic addresses (e.g. a DHCP-assigned WAN behind an ISP router) are skipped.
// A non-empty `override` (comma-separated, from WG_SPLIT_ROUTES) wins outright.
function defaultSplitRoutes(addresses, wgSubnet, wgInterface, override) {
  const fromEnv = String(override || '').split(',').map(s => s.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;

  const routes = [];
  const add = (cidr) => { if (cidr && !routes.includes(cidr)) routes.push(cidr); };
  try {
    add(ipaddr.IPv4.networkAddressFromCIDR(wgSubnet).toString() + '/' + String(wgSubnet).split('/')[1]);
  } catch (_) {}

  for (const a of (addresses || [])) {
    if (a.interface === wgInterface) continue;
    if (isTrue(a.dynamic) || isTrue(a.disabled) || isTrue(a.invalid)) continue;
    let net;
    try {
      net = ipaddr.IPv4.networkAddressFromCIDR(a.address || '');
    } catch (_) {
      continue;
    }
    if (net.range() !== 'private') continue;
    add(net.toString() + '/' + String(a.address).split('/')[1]);
  }
  return routes;
}

module.exports = { hostsFromAddressField, usedPeerIps, nextFreeIp, defaultSplitRoutes };
