/**
 * DHCP Leases — streams /ip/dhcp-server/lease/listen for instant updates,
 * with a one-shot /print on startup to populate the initial state.
 */
const BaseCollector = require('./BaseCollector');
const { getErrorMessage } = require('../util/errors');

class DhcpLeasesCollector extends BaseCollector {
  constructor({ ros, io, pollMs, state }) {
    super({ name: 'leases', ros, pollMs: pollMs || (5 * 60 * 1000), state });
    this.io = io;
    this.byIP  = new Map();
    this.byMAC = new Map();
    this.seenMACs = new Set();
    this.stream = null;
  }

  getNameByIP(ip)  { return this.byIP.get(ip);  }
  getNameByMAC(mac){ return this.byMAC.get(mac); }
  getLeaseByIP(ip) { return this.byIP.get(ip); }

  getActiveLeaseIPs() {
    const out = [];
    for (const [ip, v] of this.byIP.entries()) {
      const st = String(v.status || '').toLowerCase();
      if (!st || st === 'bound' || st === 'offered') out.push(ip);
    }
    return out;
  }

  _applyLease(l) {
    const ip   = l.address || l['active-address'];
    const mac  = l['mac-address'] || l['active-mac-address'] || l.mac;
    const name = (l.comment && l.comment.trim()) ? l.comment.trim()
               : (l['host-name'] && l['host-name'].trim()) ? l['host-name'].trim() : '';
    const status  = l.status || '';
    const dynamic = l.dynamic === 'true' || l.dynamic === true;
    const type    = dynamic ? 'dynamic' : 'static';

    const id = l['.id'] || '';
    if (ip) this.byIP.set(ip, { name, mac, hostName: l['host-name'] || '', comment: l.comment || '', status, type, id });
    if (mac) this.byMAC.set(mac, { name, ip });

    if (mac && ip && !this.seenMACs.has(mac)) {
      this.seenMACs.add(mac);
      this.io.emit('device:new', { ts: Date.now(), ip, mac, name: name || ('Unknown (' + mac + ')'), source: 'dhcp-lease' });
    }
  }

  async tick() {
    // Periodic full reload to catch deleted leases (runs every 5 minutes)
    try {
      this.byIP.clear();
      this.byMAC.clear();
      const leases = await this.ros.write('/ip/dhcp-server/lease/print');
      for (const l of (leases || [])) this._applyLease(l);
      this.state.lastLeasesTs = Date.now();
    } catch (e) {
      throw e;
    }
  }

  _startStream() {
    if (this.stream) return;
    if (!this.ros.connected) return;
    try {
      this.stream = this.ros.stream(['/ip/dhcp-server/lease/listen'], (err, data) => {
        if (err) { console.error('[leases] stream error:', getErrorMessage(err)); this.stream = null; return; }
        if (data) { this._applyLease(data); this.state.lastLeasesTs = Date.now(); }
      });
      console.log('[leases] streaming /ip/dhcp-server/lease/listen');
    } catch (e) {
      console.error('[leases] stream start failed:', getErrorMessage(e));
    }
  }

  _stopStream() {
    if (this.stream) { try { this.stream.stop(); } catch (_) {} this.stream = null; }
  }

  async onConnected() {
    this._stopStream();
    await this.tick();
    this._startStream();
  }

  async onDisconnected() {
    this._stopStream();
  }

  async start() {
    // Load initial data
    await this.tick();
    this._startStream();
    
    // Periodic full reload (runs on timer independently of tick)
    this._reloadTimer = setInterval(async () => {
      try { await this.tick(); } catch (e) { console.error('[leases] reload failed:', getErrorMessage(e)); }
    }, this.pollMs);

    // Register listeners
    this.ros.on('connected', () => this.onConnected());
    this.ros.on('close', () => this.onDisconnected());
  }

  stop() {
    if (this._reloadTimer) clearInterval(this._reloadTimer);
    this._stopStream();
    this.ros.removeAllListeners('connected');
    this.ros.removeAllListeners('close');
  }
}
module.exports = DhcpLeasesCollector;
