class ArpCollector {
  constructor({ ros, pollMs, state }) {
    this.ros = ros;
    this.pollMs = pollMs;
    this.state = state;
    this.byIP = new Map();
    this.timer = null;
  }

  getByIP(ip)   { return this.byIP.get(ip); }
  getByMAC(mac) { for (const [ip, e] of this.byIP) { if (e.mac === mac) return { ip, ...e }; } return null; }

  async tick() {
    if (!this.ros.connected) return;
    const items = await this.ros.write('/ip/arp/print');
    const m = new Map();
    for (const a of (items || [])) {
      if (a.address && a['mac-address']) m.set(a.address, { mac: a['mac-address'], iface: a.interface || '' });
    }
    this.byIP = m;
    this.state.lastArpTs = Date.now();
  }

  start() {
    const run = async () => { try { await this.tick(); } catch (e) { console.error('[arp]', e && e.message ? e.message : e); } };
    run();
    this.timer = setInterval(run, this.pollMs);
    this.ros.on('close', () => { if (this.timer) { clearInterval(this.timer); this.timer = null; } });
    this.ros.on('connected', () => { this.timer = this.timer || setInterval(run, this.pollMs); run(); });
  }
}

module.exports = ArpCollector;
