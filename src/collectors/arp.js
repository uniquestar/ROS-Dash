const BaseCollector = require('./BaseCollector');

class ArpCollector extends BaseCollector {
  constructor({ ros, pollMs, state }) {
    super({ name: 'arp', ros, pollMs, state });
    this.byIP = new Map();
  }

  getByIP(ip)   { return this.byIP.get(ip); }
  getByMAC(mac) { for (const [ip, e] of this.byIP) { if (e.mac === mac) return { ip, ...e }; } return null; }

  async tick() {
    const items = await this.ros.write('/ip/arp/print');
    const m = new Map();
    for (const a of (items || [])) {
      if (a.address && a['mac-address']) m.set(a.address, { mac: a['mac-address'], iface: a.interface || '' });
    }
    this.byIP = m;
    this.state.lastArpTs = Date.now();
  }
}

module.exports = ArpCollector;
