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

// First validation message from a ZodError. Zod 4 exposes .issues (the old
// .errors alias is gone), so never index .errors directly.
function zodMessage(err, fallback = 'Invalid request') {
  const issues = (err && (err.issues || err.errors)) || [];
  return (issues[0] && issues[0].message) || fallback;
}

module.exports = { getErrorMessage, zodMessage };
