/**
 * OUI (Organizationally Unique Identifier) lookup
 * Maps MAC address prefixes to hardware vendor names
 * Curated list of common network devices
 */

const ouiMap = {
  // Apple
  '00:00:00': 'XEROX',
  '00:05:02': 'Apple',
  '00:1a:92': 'Apple',
  '08:00:07': 'Apple',
  '3c:07:71': 'Apple',
  '40:6c:8f': 'Apple',
  '54:26:96': 'Apple',
  '5c:f9:dd': 'Apple',
  '7c:69:f6': 'Apple',
  'a4:d6:aa': 'Apple',
  'b8:27:eb': 'Raspberry Pi',

  // Cisco
  '00:00:0c': 'Cisco',
  '00:12:43': 'Cisco',
  '00:1b:0c': 'Cisco',
  '00:1b:6c': 'Cisco',
  '00:1d:45': 'Cisco',
  '00:21:1b': 'Cisco',
  '00:22:55': 'Cisco',
  '00:24:c4': 'Cisco',
  '28:6e:d0': 'Cisco',

  // Juniper
  '00:05:85': 'Juniper',
  '00:10:db': 'Juniper',
  '94:40:c6': 'Juniper',

  // Arista
  '00:1c:73': 'Arista',
  'c0:01:ca': 'Arista',

  // MikroTik
  '00:0c:42': 'MikroTik',
  '4c:5e:0c': 'MikroTik',

  // Dell
  '00:02:b3': 'Dell',
  '00:1a:a0': 'Dell',
  '00:1f:a0': 'Dell',
  '00:25:b5': 'Dell',
  '44:a8:42': 'Dell',

  // HPE/HP
  '00:01:e6': 'HPE',
  '00:04:ea': 'HPE',
  '00:07:aa': 'HPE',
  '00:11:85': 'HPE',
  '00:1e:0b': 'HPE',
  '00:1f:29': 'HPE',
  '00:25:86': 'HPE',
  '14:cc:20': 'HPE',

  // Intel
  '00:13:20': 'Intel',
  '00:19:99': 'Intel',
  '54:e1:ad': 'Intel',
  'a0:36:9f': 'Intel',

  // Broadcom
  '00:10:18': 'Broadcom',
  '00:11:20': 'Broadcom',
  '00:1a:73': 'Broadcom',

  // Ubiquiti
  '00:15:6d': 'Ubiquiti',
  '00:27:22': 'Ubiquiti',
  '80:2a:a8': 'Ubiquiti',
  'a094f3': 'Ubiquiti',

  // TP-Link
  '00:0f:e2': 'TP-Link',
  '28:3f:46': 'TP-Link',
  '3c:37:86': 'TP-Link',

  // Netgear
  '00:1a:2b': 'Netgear',
  '00:22:b0': 'Netgear',
  '50:46:5d': 'Netgear',

  // D-Link
  '00:01:e0': 'D-Link',
  '00:13:10': 'D-Link',
  '60:a4:4c': 'D-Link',

  // Hewlett Packard
  '00:11:0a': 'HP',
  '00:13:21': 'HP',
  '74:86:7a': 'HP',

  // ASUS
  '00:13:d4': 'ASUS',
  '20:cf:30': 'ASUS',
  '88:51:fb': 'ASUS',

  // Fortinet
  '00:09:0f': 'Fortinet',
  '54:a3:78': 'Fortinet',

  // Palo Alto
  '00:1a:3d': 'Palo Alto',

  // F5
  '00:11:11': 'F5 Networks',
  '00:50:56': 'VMware',

  // Linux/Generic (common)
  '52:54:00': 'QEMU',
  '00:50:f2': 'Microsoft',
  '08:00:27': 'VirtualBox',
};

/**
 * Look up vendor name from MAC address
 * @param {string} mac - MAC address (any format: AA:BB:CC:DD:EE:FF, AABBCCDDEEFF, AA-BB-CC-DD-EE-FF)
 * @returns {string|null} Vendor name or null if not found
 */
function lookupVendor(mac) {
  if (!mac || typeof mac !== 'string') return null;
  
  // Normalize to colon-separated format
  const normalized = mac.toLowerCase().replace(/[-:]/g, ':').toUpperCase();
  const prefix = normalized.substring(0, 8); // First 3 octets (OUI)
  
  return ouiMap[prefix] || null;
}

module.exports = { lookupVendor };
