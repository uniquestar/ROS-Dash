// In-memory brute-force protection for /login.
// Locks a username+IP pair after `maxPerUser` failures, and an IP after
// `maxPerIp` failures (spraying many usernames), for `lockMs`. Failures older
// than `windowMs` are forgotten. A successful login clears the username+IP pair.
function createLoginLimiter({ maxPerUser = 5, maxPerIp = 20, windowMs = 15 * 60 * 1000, lockMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const buckets = new Map(); // key -> { fails: [ts...], lockedUntil }

  function bucket(key) {
    let b = buckets.get(key);
    if (!b) { b = { fails: [], lockedUntil: 0 }; buckets.set(key, b); }
    b.fails = b.fails.filter(ts => now() - ts < windowMs);
    return b;
  }

  const userKey = (ip, username) => 'u:' + ip + '|' + String(username || '').toLowerCase();
  const ipKey = (ip) => 'i:' + ip;

  // Milliseconds until the caller may try again, or 0 if allowed now
  function retryAfter(ip, username) {
    const t = now();
    const wait = Math.max(bucket(userKey(ip, username)).lockedUntil, bucket(ipKey(ip)).lockedUntil) - t;
    return wait > 0 ? wait : 0;
  }

  function recordFailure(ip, username) {
    const t = now();
    for (const [key, max] of [[userKey(ip, username), maxPerUser], [ipKey(ip), maxPerIp]]) {
      const b = bucket(key);
      b.fails.push(t);
      if (b.fails.length >= max) { b.lockedUntil = t + lockMs; b.fails = []; }
    }
  }

  function recordSuccess(ip, username) {
    buckets.delete(userKey(ip, username));
  }

  // Drop idle entries so the map can't grow without bound
  function prune() {
    const t = now();
    for (const [key, b] of buckets) {
      b.fails = b.fails.filter(ts => t - ts < windowMs);
      if (!b.fails.length && b.lockedUntil <= t) buckets.delete(key);
    }
  }

  return { retryAfter, recordFailure, recordSuccess, prune, _size: () => buckets.size };
}

module.exports = { createLoginLimiter };
