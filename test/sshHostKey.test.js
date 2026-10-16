const test = require('node:test');
const assert = require('node:assert/strict');

const { fingerprintSha256, normalizeFingerprint, buildHostVerifier } = require('../src/util/sshHostKey');

const silent = { warn() {}, error() {} };
const key = Buffer.from('fake-host-key-bytes');
const fp = fingerprintSha256(key);

test('normalizeFingerprint strips SHA256: prefix and padding', () => {
  assert.equal(normalizeFingerprint('SHA256:abc='), 'abc');
  assert.equal(normalizeFingerprint('  abc  '), 'abc');
});

test('pinned verifier accepts the matching key in either notation', () => {
  assert.equal(buildHostVerifier(fp, silent)(key), true);
  assert.equal(buildHostVerifier('SHA256:' + fp + '=', silent)(key), true);
});

test('pinned verifier rejects a different key', () => {
  assert.equal(buildHostVerifier(fp, silent)(Buffer.from('attacker-key')), false);
});

test('unpinned verifier accepts any key', () => {
  assert.equal(buildHostVerifier('', silent)(Buffer.from('anything')), true);
});
