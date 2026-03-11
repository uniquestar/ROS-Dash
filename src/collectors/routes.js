/**
 * Routes collector — polls /ip/route/print where active=yes
 */
class RoutesCollector {
  constructor({ ros, io, pollMs, state }) {
    this.ros    = ros;
    this.io     = io;
    this.pollMs = pollMs || 30000;
    this.state  = state;
    this.timer  = null;
  }

  async tick() {
    if (!this.ros.connected) return;
    const rows = await this.ros.write('/ip/route/print', ['?active=yes']);
    const seen = new Set();
    const routes = (rows || []).map(r => {
      const dst      = r['dst-address'] || '';
      const gateway  = r.gateway || '';
      const distance = parseInt(r.distance) || 0;
      const isStatic = r.static === 'true' || r.static === true;
      const isDynamic= r.dynamic === 'true' || r.dynamic === true;
      const isEcmp   = r.ecmp === 'true' || r.ecmp === true;
      const type     = isStatic ? 'static' : 'connected';
      const comment  = r.comment || '';
      // Build flags string matching RouterOS notation
      let flags = 'A';
      if (isDynamic) flags += 'D';
      if (isStatic)  flags += 's';
      else           flags += 'c';
      if (isEcmp)    flags += '+';
      return { dst, gateway, distance, type, comment, flags };
    })
    .filter(r => {
      if (!r.dst) return false;
      if (seen.has(r.dst)) return false;
      seen.add(r.dst);
      return true;
    })
    
    .sort((a, b) => {
      // First sort by distance
      if (a.distance !== b.distance) return a.distance - b.distance;
      // Then RFC1918 first
      const rfc1918 = ip => /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(ip);
      const aPrivate = rfc1918(a.dst) ? 0 : 1;
      const bPrivate = rfc1918(b.dst) ? 0 : 1;
      if (aPrivate !== bPrivate) return aPrivate - bPrivate;
      // Then by IP address numerically
      const ipToNum = ip => ip.split('/')[0].split('.').reduce((acc, o) => (acc << 8) + parseInt(o), 0) >>> 0;
      return ipToNum(a.dst) - ipToNum(b.dst);
    });

    this.io.emit('routes:update', { ts: Date.now(), routes });
    this.state.lastRoutesTs = Date.now();

    
  }

  start() {
    const run = async () => {
      try { await this.tick(); } catch(e) {
        console.error('[routes]', e && e.message ? e.message : e);
      }
    };
    run();
    this.timer = setInterval(run, this.pollMs);
    this.ros.on('close',     () => { if (this.timer) { clearInterval(this.timer); this.timer = null; } });
    this.ros.on('connected', () => { this.timer = this.timer || setInterval(run, this.pollMs); run(); });
  }
}

module.exports = RoutesCollector;