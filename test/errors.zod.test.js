const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const { zodMessage } = require('../src/util/errors');

test('zodMessage returns the first issue message from a real zod 4 error', () => {
  const schema = z.object({ ip: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/, 'Invalid IP address') });
  let err;
  try { schema.parse({ ip: 'x' }); } catch (e) { err = e; }
  assert.ok(err instanceof z.ZodError);
  assert.equal(zodMessage(err), 'Invalid IP address');
});

test('zodMessage falls back safely when there are no issues', () => {
  assert.equal(zodMessage({}), 'Invalid request');
  assert.equal(zodMessage(null, 'nope'), 'nope');
});

test('zodMessage still reads a legacy .errors array', () => {
  assert.equal(zodMessage({ errors: [{ message: 'legacy' }] }), 'legacy');
});
