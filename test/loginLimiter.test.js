const test = require('node:test');
const assert = require('node:assert/strict');

const { createLoginLimiter } = require('../src/util/loginLimiter');

function clock(start = 1000000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('locks a username+IP after maxPerUser failures and unlocks after lockMs', () => {
  const c = clock();
  const l = createLoginLimiter({ maxPerUser: 3, lockMs: 60000, now: c.now });
  for (let i = 0; i < 2; i++) l.recordFailure('1.1.1.1', 'admin');
  assert.equal(l.retryAfter('1.1.1.1', 'admin'), 0);
  l.recordFailure('1.1.1.1', 'Admin'); // case-insensitive username
  assert.equal(l.retryAfter('1.1.1.1', 'admin'), 60000);
  assert.equal(l.retryAfter('2.2.2.2', 'admin'), 0, 'other IPs unaffected');
  c.advance(60001);
  assert.equal(l.retryAfter('1.1.1.1', 'admin'), 0);
});

test('locks an IP spraying many usernames', () => {
  const c = clock();
  const l = createLoginLimiter({ maxPerUser: 100, maxPerIp: 4, lockMs: 1000, now: c.now });
  for (let i = 0; i < 4; i++) l.recordFailure('9.9.9.9', 'user' + i);
  assert.ok(l.retryAfter('9.9.9.9', 'someone-else') > 0);
});

test('old failures fall out of the window', () => {
  const c = clock();
  const l = createLoginLimiter({ maxPerUser: 3, windowMs: 1000, now: c.now });
  l.recordFailure('1.1.1.1', 'a'); l.recordFailure('1.1.1.1', 'a');
  c.advance(1500);
  l.recordFailure('1.1.1.1', 'a');
  assert.equal(l.retryAfter('1.1.1.1', 'a'), 0);
});

test('success clears the pair and prune drops idle entries', () => {
  const c = clock();
  const l = createLoginLimiter({ maxPerUser: 3, windowMs: 1000, now: c.now });
  l.recordFailure('1.1.1.1', 'a'); l.recordFailure('1.1.1.1', 'a');
  l.recordSuccess('1.1.1.1', 'a');
  l.recordFailure('1.1.1.1', 'a'); l.recordFailure('1.1.1.1', 'a');
  assert.equal(l.retryAfter('1.1.1.1', 'a'), 0);
  c.advance(2000);
  l.prune();
  assert.equal(l._size(), 0);
});
