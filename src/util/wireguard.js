const crypto = require('crypto');
const { generateKeyPair } = require('curve25519-js');

function generateKeypair() {
  const seed = crypto.randomBytes(32);
  const kp   = generateKeyPair(seed);
  return {
    privateKey: Buffer.from(kp.private).toString('base64'),
    publicKey:  Buffer.from(kp.public).toString('base64'),
  };
}

function generatePsk() {
  return crypto.randomBytes(32).toString('base64');
}

const ipaddr = require('ipaddr.js');

// "10.0.0.0/24, 192.168.168.0/24" -> true. Only IPv4 CIDRs; anything else (including
// newlines that could smuggle PostUp= lines into a client config) is rejected.
function isIpv4CidrList(value, maxEntries = 32) {
  const s = String(value || '');
  if (!s.trim() || s.length > 1024 || /[\r\n]/.test(s)) return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length > maxEntries) return false;
  return parts.every(p => {
    const m = p.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
    return !!m && ipaddr.IPv4.isValidFourPartDecimal(m[1]) && +m[2] <= 32;
  });
}

function normalizeCidrList(value) {
  return String(value || '').split(',').map(p => p.trim()).filter(Boolean).join(', ');
}

function buildConfig({ name, privateKey, psk, serverPublicKey, allowedAddress, clientAddress, clientDns, clientEndpoint, clientAllowedAddresses, listenPort }) {
  // Defence in depth: a newline in any value would inject extra config directives
  for (const [k, v] of Object.entries({ name, privateKey, psk, serverPublicKey, allowedAddress, clientAddress, clientDns, clientEndpoint, clientAllowedAddresses, listenPort })) {
    if (/[\r\n]/.test(String(v == null ? '' : v))) throw new Error('Invalid characters in WireGuard ' + k);
  }
  // Only append the server port when the endpoint doesn't already carry one
  const endpoint = /:\d+$/.test(clientEndpoint) ? clientEndpoint : clientEndpoint + ':' + listenPort;
  return [
    '[Interface]',
    '# ' + name,
    'PrivateKey = ' + privateKey,
    'Address = ' + clientAddress,
    'DNS = ' + clientDns,
    '',
    '[Peer]',
    'PublicKey = ' + serverPublicKey,
    'PresharedKey = ' + psk,
    'AllowedIPs = ' + clientAllowedAddresses,
    'Endpoint = ' + endpoint,
    'PersistentKeepalive = 25',
  ].join('\n');
}

module.exports = { generateKeypair, generatePsk, buildConfig, isIpv4CidrList, normalizeCidrList };