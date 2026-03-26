// Parse RouterOS relative time string e.g. "2m30s", "1h5m", "30s" into ms
function parseHandshake(str) {
  if (!str || str === 'never') return 0;
  let ms = 0;
  const h = str.match(/(\d+)h/); if (h) ms += parseInt(h[1]) * 3600000;
  const m = str.match(/(\d+)m/); if (m) ms += parseInt(m[1]) * 60000;
  const s = str.match(/(\d+)s/); if (s) ms += parseInt(s[1]) * 1000;
  return Date.now() - ms;
}

class VpnCollector {
  constructor({ ros, io, pollMs, state }) {
    this.ros    = ros;
    this.io     = io;
    this.pollMs = pollMs || 10000;
    this.state  = state;
    this.timer  = null;
    this._debuggedOnce = false;
    this._prev = new Map(); // key -> {rx, tx, ts}
  }

  async safeGet(cmd) {
    try { const r = await this.ros.write(cmd); return Array.isArray(r) ? r : []; } catch { return []; }
  }

  async tick() {
    if (!this.ros.connected) return;
    const wgPeers = await this.safeGet('/interface/wireguard/peers/print');
    if (!this._debuggedOnce && wgPeers.length > 0) {
      console.log(`[vpn] ${wgPeers.length} WireGuard peer(s) found on interfaces: ${[...new Set(wgPeers.map(p => p.interface).filter(Boolean))].join(', ') || '?'}`);
      this._debuggedOnce = true;
    }
    const now = Date.now();
    const tunnels = wgPeers.map(p => {
      const lh = p['last-handshake'] || '';
      const OFFLINE_MS = 5 * 60 * 1000; // 5 minutes
      const connected = lh && lh !== 'never' && (now - parseHandshake(lh)) < OFFLINE_MS;
      const peerName =
        (p.name && String(p.name).trim()) ? String(p.name).trim() :
        (p.comment && String(p.comment).trim()) ? String(p.comment).trim() :
        (p['allowed-address'] && String(p['allowed-address']).trim()) ? String(p['allowed-address']).trim() :
        (p['public-key'] ? p['public-key'].slice(0, 16) + '\u2026' : '?');
      const rxBytes = parseInt(p['rx-bytes'] || '0', 10);
      const txBytes = parseInt(p['tx-bytes'] || '0', 10);
      const key = p['public-key'] || peerName;
      const prev = this._prev.get(key);
      let rxRate = 0, txRate = 0;
      if (prev && now > prev.ts) {
        const dtSec = (now - prev.ts) / 1000;
        rxRate = Math.max(0, (rxBytes - prev.rx) / dtSec);
        txRate = Math.max(0, (txBytes - prev.tx) / dtSec);
      }
      this._prev.set(key, { rx: rxBytes, tx: txBytes, ts: now });
      return {
        type: 'WireGuard', name: peerName,
        state: connected ? 'connected' : 'idle',
        uptime: lh,
        endpoint: p['endpoint-address'] || p['current-endpoint-address'] || '',
        allowedIp: p['allowed-address'] || '',
        interface: p.interface || '',
        rx: rxBytes, tx: txBytes, rxRate, txRate,
        // Management fields
        id:                   p['.id'] || '',
        disabled:             p.disabled === 'true' || p.disabled === true,
        publicKey:            p['public-key'] || '',
        clientAddress:        p['client-address'] || '',
        clientDns:            p['client-dns'] || '',
        clientEndpoint:       p['client-endpoint'] || '',
        clientAllowedAddress: p['client-allowed-address'] || '',
        comment:              p.comment || '',
      };
    });
    this.io.emit('vpn:update', { ts: Date.now(), tunnels });
    this.state.lastVpnTs = Date.now();
    delete this.state.lastVpnErr;
  }

  start() {
    const run = async () => {
      try { await this.tick(); } catch (e) {
        this.state.lastVpnErr = String(e && e.message ? e.message : e);
        console.error('[vpn]', this.state.lastVpnErr);
      }
    };
    run();
    this.timer = setInterval(run, this.pollMs);
    this.ros.on('close',     () => { if (this.timer) { clearInterval(this.timer); this.timer = null; } });
    this.ros.on('connected', () => { this.timer = this.timer || setInterval(run, this.pollMs); run(); });
  }
}
module.exports = VpnCollector;
