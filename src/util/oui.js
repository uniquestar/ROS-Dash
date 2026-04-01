/**
 * OUI (Organizationally Unique Identifier) lookup with API caching
 * Maps MAC address prefixes to hardware vendor names
 * 
 * - Reads cached OUI mappings from persistent file on startup
 * - Checks cache first for fast lookups (synchronous)
 * - Fetches unknown OUIs from https://www.macvendorlookup.com/api 
 * - Caches results to persistent file for future deployments
 * - Non-blocking: unknown OUIs trigger background fetch, returns null initially
 */

const fs = require('fs');
const path = require('path');

// Persistent cache location (outside container, mounted as volume)
const CACHE_FILE = path.join(process.cwd(), 'oui-cache.json');

let _cache = {};
let _pendingFetches = new Set();

function extractOui(mac) {
  if (!mac || typeof mac !== 'string') return null;
  const hex = mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (hex.length < 6) return null;
  return `${hex.slice(0,2)}:${hex.slice(2,4)}:${hex.slice(4,6)}`;
}

/**
 * Initialize cache from disk
 */
function initOuiCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      _cache = JSON.parse(data);
      console.log(`[OUI] Loaded ${Object.keys(_cache).length} cached vendors from ${CACHE_FILE}`);
    }
  } catch (err) {
    console.warn(`[OUI] Failed to load cache from ${CACHE_FILE}:`, err.message);
    _cache = {};
  }
}

/**
 * Save cache to disk (async, non-blocking)
 */
function saveCacheToDisk() {
  try {
    fs.writeFile(CACHE_FILE, JSON.stringify(_cache, null, 2), (err) => {
      if (err) console.warn(`[OUI] Failed to save cache:`, err.message);
    });
  } catch (err) {
    console.warn(`[OUI] Failed to save cache:`, err.message);
  }
}

/**
 * Fetch vendor from API with timeout (requires node 18+)
 */
async function fetchFromApi(oui) {
  const url = `https://www.macvendorlookup.com/api/v2/${oui}?format=json`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      const row = Array.isArray(data) ? data[0] : data;
      const vendor = row && (row.company || row.vendorName || row.vendor);
      if (vendor) {
        _cache[oui] = vendor;
        saveCacheToDisk();
        return vendor;
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn(`[OUI] API lookup failed for ${oui}:`, err.message);
    }
  }
  return null;
}

/**
 * Look up vendor name from MAC address (SYNCHRONOUS - returns from cache only)
 * Unknown MACs trigger background API fetch + cache
 * @param {string} mac - MAC address (any format)
 * @returns {string|null} Vendor name from cache, or null if not yet cached
 */
function lookupVendor(mac) {
  const oui = extractOui(mac);
  if (!oui) return null;
  
  if (_cache[oui]) {
    return _cache[oui];
  }
  
  if (!_pendingFetches.has(oui)) {
    _pendingFetches.add(oui);
    fetchFromApi(oui).then(() => {
      _pendingFetches.delete(oui);
    });
  }
  
  return null;
}

/**
 * Look up vendor name asynchronously (waits for API if needed)
 * @param {string} mac - MAC address (any format)
 * @returns {Promise<string|null>} Vendor name from cache or API
 */
async function lookupVendorAsync(mac) {
  const oui = extractOui(mac);
  if (!oui) return null;
  
  if (_cache[oui]) {
    return _cache[oui];
  }
  
  return await fetchFromApi(oui);
}

module.exports = { initOuiCache, lookupVendor, lookupVendorAsync };
