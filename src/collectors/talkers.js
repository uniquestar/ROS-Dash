/**
 * Top Talkers — derived from connection counts per LAN source.
 * Replaces the Kid Control approach which requires a Mikrotik feature
 * that may not be enabled.
 */
const BaseCollector = require('./BaseCollector');

class TopTalkersCollector extends BaseCollector {
  constructor({ ros, io, pollMs, state, topN }) {
    super({ name: 'talkers', ros, pollMs: 0, state });
    this.io = io;
    this.topN   = topN || 5;
    this._lastDevices = [];
  }

  async tick() {
    // No polling needed — fed by ConnectionsCollector
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

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.state.lastTalkersTs = Date.now();
  }
}

module.exports = TopTalkersCollector;