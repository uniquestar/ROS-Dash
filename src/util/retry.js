function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultShouldRetry(err) {
  const msg = String(err && err.message ? err.message : err).toLowerCase();
  const transientMarkers = [
    'timeout',
    'timed out',
    'econnreset',
    'econnrefused',
    'ehostunreach',
    'enetunreach',
    'network',
    'socket hang up',
    'temporarily unavailable',
    'connection closed',
    'broken pipe',
  ];
  return transientMarkers.some((marker) => msg.includes(marker));
}

async function withRetry(fn, opts = {}) {
  const retries = Number.isInteger(opts.retries) ? opts.retries : 2;
  const baseDelayMs = Number.isInteger(opts.baseDelayMs) ? opts.baseDelayMs : 200;
  const maxDelayMs = Number.isInteger(opts.maxDelayMs) ? opts.maxDelayMs : 1500;
  const shouldRetry = opts.shouldRetry || defaultShouldRetry;
  const onRetry = typeof opts.onRetry === 'function' ? opts.onRetry : null;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const canRetry = attempt < retries && shouldRetry(err);
      if (!canRetry) throw err;

      const delayMs = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      if (onRetry) {
        onRetry(err, { attempt: attempt + 1, retries, delayMs });
      }
      await sleep(delayMs);
    }
  }

  throw lastError;
}

module.exports = { withRetry, defaultShouldRetry };