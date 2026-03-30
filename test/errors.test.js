const test = require('node:test');
const assert = require('node:assert/strict');

const { getErrorMessage } = require('../src/util/errors');

test('getErrorMessage returns fallback for null/undefined', () => {
  assert.equal(getErrorMessage(null), 'Unknown error');
  assert.equal(getErrorMessage(undefined, 'fallback'), 'fallback');
});

test('getErrorMessage returns string values as-is', () => {
  assert.equal(getErrorMessage('boom'), 'boom');
});

test('getErrorMessage returns Error.message', () => {
  assert.equal(getErrorMessage(new Error('kapow')), 'kapow');
});

test('getErrorMessage stringifies non-error objects', () => {
  assert.equal(getErrorMessage({ code: 123 }), '[object Object]');
});
