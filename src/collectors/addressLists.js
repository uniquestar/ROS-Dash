/**
 * Address Lists collector — polls /ip/firewall/address-list/print
 */
const BaseCollector = require('./BaseCollector');

class AddressListsCollector extends BaseCollector {
  constructor({ ros, io, pollMs, state }) {
    super({ name: 'addresslists', ros, pollMs: pollMs || 60000, state });
    this.io = io;
  }

  async tick() {
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
}

module.exports = AddressListsCollector;