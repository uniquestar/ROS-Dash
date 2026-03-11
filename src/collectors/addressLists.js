/**
 * Address Lists collector — polls /ip/firewall/address-list/print
 */
class AddressListsCollector {
  constructor({ ros, io, pollMs, state }) {
    this.ros    = ros;
    this.io     = io;
    this.pollMs = pollMs || 60000;
    this.state  = state;
    this.timer  = null;
  }

  async tick() {
    if (!this.ros.connected) return;
    const rows = await this.ros.write('/ip/firewall/address-list/print');

    // Group by list name
    const lists = new Map();
    for (const r of (rows || [])) {
      const list    = r.list || 'unknown';
      const address = r.address || '';
      const comment = r.comment || '';
      const created = r['creation-time'] || '';
      if (!lists.has(list)) lists.set(list, []);
      lists.get(list).push({ address, comment, created });
    }

// Convert to array sorted by list name, entries sorted by comment then address
    const result = Array.from(lists.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, entries]) => ({
        name,
        entries: entries.sort((a, b) => {
          const cmp = (a.comment || '').localeCompare(b.comment || '');
          return cmp !== 0 ? cmp : a.address.localeCompare(b.address);
        })
      }));

    this.io.emit('addresslists:update', { ts: Date.now(), lists: result });
    this.state.lastAddressListsTs = Date.now();
  }

  start() {
    const run = async () => {
      try { await this.tick(); } catch(e) {
        console.error('[addresslists]', e && e.message ? e.message : e);
      }
    };
    run();
    this.timer = setInterval(run, this.pollMs);
    this.ros.on('close',     () => { if (this.timer) { clearInterval(this.timer); this.timer = null; } });
    this.ros.on('connected', () => { this.timer = this.timer || setInterval(run, this.pollMs); run(); });
  }
}

module.exports = AddressListsCollector;