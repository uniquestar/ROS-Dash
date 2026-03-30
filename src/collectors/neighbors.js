/**
 * IP Neighbours collector — polls /ip/neighbor/print
 * Discovers adjacent devices via CDP/LLDP
 */
const BaseCollector = require('./BaseCollector');

class NeighborsCollector extends BaseCollector {
  constructor({ ros, io, pollMs, state }) {
    super({ name: 'neighbors', ros, pollMs: pollMs || 60000, state });
    this.io = io;
  }

  _cleanVersion(ver) {
    if (!ver) return '';
    // Shorten Cisco IOS version strings to just the version number
    const m = ver.match(/Version\s+([\d\.()A-Za-z]+)/);
    if (m) return m[1];
    // Truncate anything else to 30 chars
    return ver.length > 30 ? ver.slice(0, 30) + '…' : ver;
  }

  async tick() {
    const items = await this.ros.write('/ip/neighbor/print');
    const neighbors = (items || []).map(n => ({
      interface: n.interface  || '',
      address:   n.address    || '',
      mac:       n['mac-address'] || '',
      identity:  n.identity   || '',
      version:   this._cleanVersion(n.version || ''),
    }));
    this.io.emit('neighbors:update', { ts: Date.now(), neighbors });
    this.state.lastNeighborsTs = Date.now();
  }
}

module.exports = NeighborsCollector;