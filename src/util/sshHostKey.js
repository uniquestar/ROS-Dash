const crypto = require('crypto');

// OpenSSH-style fingerprint: base64 SHA256 of the raw host key, no padding
function fingerprintSha256(keyBuffer) {
  return crypto.createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '');
}

function normalizeFingerprint(value) {
  return String(value || '').trim().replace(/^SHA256:/i, '').replace(/=+$/, '');
}

let warnedUnpinned = false;

// ssh2 hostVerifier. With a pinned fingerprint, only that host key is accepted;
// without one, any key is accepted (legacy behaviour) and a warning is logged once.
function buildHostVerifier(pinned, log = console) {
  const expected = normalizeFingerprint(pinned);
  if (!expected) {
    if (!warnedUnpinned) {
      warnedUnpinned = true;
      log.warn('[ssh] ROUTER_SSH_HOSTKEY_SHA256 not set — router SSH host key is not verified');
    }
    return () => true;
  }
  return (key) => {
    const actual = fingerprintSha256(key);
    if (actual !== expected) {
      log.error('[ssh] router host key mismatch: got SHA256:' + actual);
      return false;
    }
    return true;
  };
}

module.exports = { fingerprintSha256, normalizeFingerprint, buildHostVerifier };
