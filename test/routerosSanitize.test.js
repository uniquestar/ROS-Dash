const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RouterOsInputError,
  sanitizeRosId,
  sanitizePeerName,
  sanitizeAddressListName,
} = require('../src/util/routerosSanitize');

test('sanitizeRosId accepts valid RouterOS id format', () => {
  assert.equal(sanitizeRosId('*1A2b', 'peer id'), '*1A2b');
});

test('sanitizeRosId rejects invalid id', () => {
  assert.throws(() => sanitizeRosId('1A2b', 'peer id'), RouterOsInputError);
});

test('sanitizePeerName enforces supported chars', () => {
  assert.equal(sanitizePeerName('Site-A_01'), 'Site-A_01');
  assert.throws(() => sanitizePeerName('bad=name'), RouterOsInputError);
});

test('sanitizeAddressListName enforces prefix and chars', () => {
  assert.equal(sanitizeAddressListName('WG-Office', 'WG-'), 'WG-Office');
  assert.throws(() => sanitizeAddressListName('LAN-Office', 'WG-'), RouterOsInputError);
  assert.throws(() => sanitizeAddressListName('WG-bad name', 'WG-'), RouterOsInputError);
});
