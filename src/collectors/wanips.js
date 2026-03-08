/**
 * WAN IPs collector — fetches all IP addresses on the WAN interface.
 */
class WanIpsCollector {
  constructor({ ros, io, pollMs, state, wanIface }) {
    this.ros      = ros;
    this.io       = io;
    this.pollMs   = pollMs || 30000;
    this.state    = state;
    this.wanIface = wanIface;
    this.timer    = null;
    this.lastIps  = [];
  }

  async tick() {
    if (!this.ros.connected) return;
    const items = await this.ros.write('/ip/address/print');
    const ips = (items || [])
      .filter(a => a.interface === this.wanIface && a.disabled !== 'true')
      .map(a => a.address || '')
      .filter(Boolean);
    this.lastIps = ips;
    // Also store the primary WAN IP on state for localcc endpoint
    this.state.lastWanIp = ips[0] || '';
    this.io.emit('wan:ips', { ts: Date.now(), ips });
  }

  start() {
    const run = async () => {
      try { await this.tick(); } catch (e) {
        console.error('[wanips]', e && e.message ? e.message : e);
      }
    };
    run();
    this.timer = setInterval(run, this.pollMs);
    this.ros.on('close',     () => { if (this.timer) { clearInterval(this.timer); this.timer = null; } });
    this.ros.on('connected', () => { this.timer = this.timer || setInterval(run, this.pollMs); run(); });
  }
}

module.exports = WanIpsCollector;
