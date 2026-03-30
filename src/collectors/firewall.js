const BaseCollector = require('./BaseCollector');
const { getErrorMessage } = require('../util/errors');

class FirewallCollector extends BaseCollector {
  constructor({ ros, io, pollMs, state, topN }) {
    super({ name: 'firewall', ros, pollMs: pollMs || 10000, state });
    this.io = io;
    this.topN = topN || 15;
    this.prevCounts = new Map();
    this._lastFingerprint = '';
    this._lastPayload = null;
  }

  async safeGet(cmd) {
    try { const r = await this.ros.write(cmd); return Array.isArray(r) ? r : []; } catch { return []; }
  }

  processChain(rules) {
    return rules.filter(r => r.disabled !== 'true' && r.disabled !== true).map(r => {
      const id = r['.id'] || '';
      const packets = parseInt(r.packets || '0', 10);
      const bytes   = parseInt(r.bytes   || '0', 10);
      const prev = this.prevCounts.get(id);
      const deltaPackets = prev ? Math.max(0, packets - prev.packets) : 0;
      if (id) this.prevCounts.set(id, { packets, bytes });
      return { id, chain:r.chain||'', action:r.action||'?', comment:r.comment||'', srcAddress:r['src-address']||'', dstAddress:r['dst-address']||'', protocol:r.protocol||'', dstPort:r['dst-port']||'', inInterface:r['in-interface']||'', packets, bytes, deltaPackets, disabled:false };
    });
  }

  buildFingerprint(chainName, rows) {
    let out = chainName + ':' + (rows ? rows.length : 0) + '|';
    for (const r of (rows || [])) {
      out += [
        r['.id'] || '',
        r.packets || '0',
        r.bytes || '0',
        r.disabled === true || r.disabled === 'true' ? '1' : '0',
      ].join(',') + ';';
    }
    return out;
  }

  async tick() {
    // All three fire concurrently
    const [filter, nat, mangle] = await Promise.all([
      this.safeGet('/ip/firewall/filter/print'),
      this.safeGet('/ip/firewall/nat/print'),
      this.safeGet('/ip/firewall/mangle/print'),
    ]);

    const fingerprint = [
      this.buildFingerprint('filter', filter),
      this.buildFingerprint('nat', nat),
      this.buildFingerprint('mangle', mangle),
    ].join('#');

    if (this._lastPayload && fingerprint === this._lastFingerprint) {
      this.io.emit('firewall:update', {
        ts: Date.now(),
        filter: this._lastPayload.filter,
        nat: this._lastPayload.nat,
        mangle: this._lastPayload.mangle,
        topByHits: this._lastPayload.topByHits,
      });
      this.state.lastFirewallTs = Date.now();
      delete this.state.lastFirewallErr;
      return;
    }

    const filterRules = this.processChain(filter);
    const natRules    = this.processChain(nat);
    const mangleRules = this.processChain(mangle);
    const topByHits   = [...filterRules,...natRules,...mangleRules].filter(r=>r.packets>0).sort((a,b)=>b.packets-a.packets).slice(0,this.topN);
    this._lastFingerprint = fingerprint;
    this._lastPayload = { filter: filterRules, nat: natRules, mangle: mangleRules, topByHits };
    this.io.emit('firewall:update', { ts:Date.now(), filter:filterRules, nat:natRules, mangle:mangleRules, topByHits });
    this.state.lastFirewallTs = Date.now();
    delete this.state.lastFirewallErr;
  }

  async _runTick() {
    if (this.ros && this.ros.connected === false) return;
    try {
      await this.tick();
    } catch (e) {
      this.state.lastFirewallErr = getErrorMessage(e);
      console.error('[firewall]', this.state.lastFirewallErr);
    }
  }
}

module.exports = FirewallCollector;
