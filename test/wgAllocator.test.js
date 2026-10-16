const test = require('node:test');
const assert = require('node:assert/strict');

const { hostsFromAddressField, usedPeerIps, nextFreeIp } = require('../src/util/wgAllocator');

test('hostsFromAddressField keeps /32 hosts and ignores routed ranges', () => {
  assert.deepEqual(hostsFromAddressField('192.168.168.5/32, 10.0.0.0/24,0.0.0.0/0'), ['192.168.168.5']);
  assert.deepEqual(hostsFromAddressField('192.168.168.9'), ['192.168.168.9']);
  assert.deepEqual(hostsFromAddressField(''), []);
  assert.deepEqual(hostsFromAddressField('garbage/32'), []);
});

test('hostsFromAddressField can read client-address host parts', () => {
  assert.deepEqual(hostsFromAddressField('192.168.168.7/24', { hostOnly: false }), ['192.168.168.7']);
});

test('usedPeerIps collects allowed-address and client-address hosts', () => {
  const used = usedPeerIps([
    { 'allowed-address': '192.168.168.2/32' },
    { 'allowed-address': '192.168.168.3/32,10.10.0.0/16', 'client-address': '192.168.168.3/24' },
    { 'allowed-address': '0.0.0.0/0', 'client-address': '192.168.168.4/24' },
  ]);
  assert.deepEqual([...used].sort(), ['192.168.168.2', '192.168.168.3', '192.168.168.4']);
});

test('nextFreeIp skips network, reserved and used addresses', () => {
  const used = new Set(['192.168.168.2', '192.168.168.3']);
  assert.equal(nextFreeIp('192.168.168.0/24', used, ['192.168.168.1']), '192.168.168.4');
});

test('nextFreeIp fills gaps left by deleted peers', () => {
  const used = new Set(['192.168.168.2', '192.168.168.4']);
  assert.equal(nextFreeIp('192.168.168.0/24', used, ['192.168.168.1']), '192.168.168.3');
});

test('nextFreeIp returns null when the subnet is full', () => {
  const used = new Set();
  for (let i = 1; i <= 254; i++) used.add('192.168.168.' + i);
  assert.equal(nextFreeIp('192.168.168.0/24', used), null);
  assert.equal(nextFreeIp('10.0.0.0/30', new Set(['10.0.0.1', '10.0.0.2'])), null);
});

test('nextFreeIp never hands out the broadcast address', () => {
  const used = new Set();
  for (let i = 1; i <= 253; i++) used.add('192.168.168.' + i);
  assert.equal(nextFreeIp('192.168.168.0/24', used), '192.168.168.254');
});

test('nextFreeIp tolerates a host-bits subnet and rejects junk', () => {
  assert.equal(nextFreeIp('192.168.168.77/24', new Set()), '192.168.168.1');
  assert.equal(nextFreeIp('not-a-subnet', new Set()), null);
  assert.equal(nextFreeIp('192.168.168.0/31', new Set()), null);
});
