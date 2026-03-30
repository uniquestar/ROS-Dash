function getErrorMessage(err, fallback = 'Unknown error') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err.message === 'string' && err.message) return err.message;
  try {
    return String(err);
  } catch (_) {
    return fallback;
  }
}

module.exports = { getErrorMessage };