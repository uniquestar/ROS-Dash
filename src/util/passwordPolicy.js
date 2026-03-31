const PASSWORD_POLICY_TEXT = 'at least 10 characters with upper, lower, number, and symbol';

function validatePassword(password) {
  const issues = [];
  if (typeof password !== 'string' || !password) {
    issues.push('Password is required');
    return issues;
  }
  if (password.length < 10) issues.push('Password must be at least 10 characters long');
  if (!/[A-Z]/.test(password)) issues.push('Password must include at least one uppercase letter');
  if (!/[a-z]/.test(password)) issues.push('Password must include at least one lowercase letter');
  if (!/[0-9]/.test(password)) issues.push('Password must include at least one number');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('Password must include at least one symbol');
  return issues;
}

function firstPasswordIssue(password) {
  const issues = validatePassword(password);
  return issues.length ? issues[0] : null;
}

module.exports = {
  PASSWORD_POLICY_TEXT,
  validatePassword,
  firstPasswordIssue,
};
