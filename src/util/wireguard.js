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

function buildConfig({ name, privateKey, psk, serverPublicKey, allowedAddress, clientAddress, clientDns, clientEndpoint, clientAllowedAddresses, listenPort }) {
  const ip = allowedAddress.split('/')[0];
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
    'Endpoint = ' + clientEndpoint + ':' + listenPort,
    'PersistentKeepalive = 25',
  ].join('\n');
}

module.exports = { generateKeypair, generatePsk, buildConfig };