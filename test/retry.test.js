const test = require('node:test');
const assert = require('node:assert/strict');

const { withRetry, defaultShouldRetry } = require('../src/util/retry');

test('defaultShouldRetry detects transient timeout errors', () => {
  assert.equal(defaultShouldRetry(new Error('Request timed out')), true);
  assert.equal(defaultShouldRetry(new Error('validation failed')), false);
});

test('withRetry retries transient failures and succeeds', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('network timeout');
    return 'ok';
  }, { retries: 3, baseDelayMs: 1, maxDelayMs: 2 });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('withRetry stops when shouldRetry returns false', async () => {
  let attempts = 0;
  await assert.rejects(async () => {
    await withRetry(async () => {
      attempts += 1;
      throw new Error('permanent failure');
    }, {
      retries: 3,
      shouldRetry: () => false,
      baseDelayMs: 1,
      maxDelayMs: 2,
    });
  }, /permanent failure/);

  assert.equal(attempts, 1);
});
