/**
 * IP Neighbours collector — polls /ip/neighbor/print
 * Discovers adjacent devices via CDP/LLDP
 */
class NeighborsCollector {
  constructor({ ros, io, pollMs, state }) {
    this.ros    = ros;
    this.io     = io;
    this.pollMs = pollMs || 60000;
    this.state  = state;
    this.timer  = null;
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
    if (!this.ros.connected) return;
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

  start() {
    const run = async () => {
      try { await this.tick(); } catch (e) {
        console.error('[neighbors]', e && e.message ? e.message : e);
      }
    };
    run();
    this.timer = setInterval(run, this.pollMs);
    this.ros.on('close',     () => { if (this.timer) { clearInterval(this.timer); this.timer = null; } });
    this.ros.on('connected', () => { this.timer = this.timer || setInterval(run, this.pollMs); run(); });
  }
}

module.exports = NeighborsCollector;