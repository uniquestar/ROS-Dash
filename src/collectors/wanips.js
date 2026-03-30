/**
 * WAN IPs collector — fetches all IP addresses on the WAN interface.
 */
const BaseCollector = require('./BaseCollector');

class WanIpsCollector extends BaseCollector {
  constructor({ ros, io, pollMs, state, wanIface }) {
    super({ name: 'wanips', ros, pollMs: pollMs || 30000, state });
    this.io = io;
    this.wanIface = wanIface;
    this.lastIps  = [];
  }

  async tick() {
    const items = await this.ros.write('/ip/address/print');
    const ips = (items || [])
      .filter(a => a.interface === this.wanIface && a.disabled !== 'true')
      .map(a => a.address || '')
      .filter(Boolean);
    this.lastIps = ips;
    // Also store the primary WAN IP on state for localcc endpoint
    this.state.lastWanIp = ips[0] || '';
    this.io.emit('wan:ips', { ts: Date.now(), ips });
    this.state.lastWanIpsTs = Date.now();
  }
}

module.exports = WanIpsCollector;
