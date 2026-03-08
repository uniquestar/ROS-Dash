/**
 * Top Talkers — derived from connection counts per LAN source.
 * Replaces the Kid Control approach which requires a Mikrotik feature
 * that may not be enabled.
 */
class TopTalkersCollector {
  constructor({ ros, io, pollMs, state, topN }) {
    this.ros    = ros;
    this.io     = io;
    this.pollMs = pollMs;
    this.state  = state;
    this.topN   = topN || 5;
    this.timer  = null;
    this._lastDevices = [];
  }

  // Called directly by ConnectionsCollector with topSources data
  updateFromConnections(topSources) {
    const devices = (topSources || []).slice(0, this.topN).map(s => ({
      name:     s.name || s.ip,
      mac:      s.mac  || '',
      tx_mbps:  0,
      rx_mbps:  0,
      conns:    s.count,
    }));
    this._lastDevices = devices;
    this.io.emit('talkers:update', { ts: Date.now(), devices });
    this.state.lastTalkersTs = Date.now();
    delete this.state.lastTalkersErr;
  }

  start() {
    // No polling needed — fed by ConnectionsCollector
    this.state.lastTalkersTs = Date.now();
  }
}

module.exports = TopTalkersCollector;