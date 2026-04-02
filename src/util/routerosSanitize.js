class RouterOsInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RouterOsInputError';
    this.statusCode = 400;
  }
}

function ensureBaseSafe(value, fieldName) {
  const s = String(value || '').trim();
  if (!s) throw new RouterOsInputError(fieldName + ' is required');
  if (/[=\r\n\0]/.test(s)) {
    throw new RouterOsInputError(fieldName + ' contains invalid characters');
  }
  return s;
}

function sanitizeRosId(value, fieldName) {
  const s = ensureBaseSafe(value, fieldName || 'id');
  if (!/^\*[0-9A-Fa-f]+$/.test(s)) {
    throw new RouterOsInputError((fieldName || 'id') + ' has invalid format');
  }
  return s;
}

function sanitizePeerName(value) {
  const s = ensureBaseSafe(value, 'name');
  if (!/^[A-Za-z0-9 _.-]{1,64}$/.test(s)) {
    throw new RouterOsInputError('name contains unsupported characters');
  }
  return s;
}

function sanitizeAddressListName(value, requiredPrefix) {
  const s = ensureBaseSafe(value, 'addressList');
  if (requiredPrefix && !s.startsWith(requiredPrefix)) {
    throw new RouterOsInputError('addressList must start with ' + requiredPrefix);
  }
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(s)) {
    throw new RouterOsInputError('addressList contains unsupported characters');
  }
  return s;
}

function sanitizeInterfaceName(value) {
  const s = ensureBaseSafe(value, 'interfaceName');
  if (!/^[A-Za-z0-9 _./:-]{1,64}$/.test(s)) {
    throw new RouterOsInputError('interfaceName contains unsupported characters');
  }
  return s;
}

module.exports = {
  RouterOsInputError,
  sanitizeRosId,
  sanitizePeerName,
  sanitizeAddressListName,
  sanitizeInterfaceName,
};
