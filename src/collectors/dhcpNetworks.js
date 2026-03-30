const ipaddr = require('ipaddr.js');
const BaseCollector = require('./BaseCollector');

function ipInCidr(ip, cidr) {
  try { return ipaddr.parse(ip).match(ipaddr.parseCIDR(cidr)); } catch { return false; }
}

class DhcpNetworksCollector extends BaseCollector {
  constructor({ ros, io, pollMs, dhcpLeases, state }) {
    super({ name: 'dhcpNetworks', ros, pollMs, state });
    this.io = io;
    this.dhcpLeases = dhcpLeases;
    this.lanCidrs = [];
    this.networks = [];
    this.vlanMap  = new Map(); // ifaceName -> [vlanIds]
  }

  getLanCidrs() { return this.lanCidrs; }
  getVlansForInterface(ifaceName) { return this.vlanMap.get(ifaceName) || []; }
  
  async tick() {
    const [nets, addrs, vlans] = await Promise.allSettled([
      this.ros.write('/ip/dhcp-server/network/print'),
      this.ros.write('/ip/address/print'),
      this.ros.write('/interface/vlan/print'),
    ]);
    const netRows  = nets.status  === 'fulfilled' ? (nets.value  || []) : [];
    const addrRows = addrs.status === 'fulfilled' ? (addrs.value || []) : [];

    const wanIface = process.env.DEFAULT_IF || 'WAN1';
    let wanIp = '';
    for (const a of addrRows) {
      if (a.interface === wanIface && a.address) { wanIp = a.address; break; }
    }

    const leaseIps = this.dhcpLeases ? this.dhcpLeases.getActiveLeaseIPs() : [];
    const lanCidrs = [];
    const networks = [];
    for (const n of netRows) {
      if (!n.address) continue;
      lanCidrs.push(n.address);
      const leaseCount = leaseIps.reduce((acc, ip) => acc + (ipInCidr(ip, n.address) ? 1 : 0), 0);
      networks.push({ cidr: n.address, gateway: n.gateway || '', dns: n['dns-server'] || n['dns'] || '', leaseCount });
    }
    // Build VLAN map: interface -> [vlanIds]
    const vlanRows = vlans.status === 'fulfilled' ? (vlans.value || []) : [];
    const vlanMap  = new Map();

    for (const v of vlanRows) {
      const iface = v.interface || '';
      const vid   = parseInt(v['vlan-id']);
      if (!iface || !vid) continue;
      if (iface === wanIface) continue; // skip WAN interface
      if (!vlanMap.has(iface)) vlanMap.set(iface, []);
      vlanMap.get(iface).push(vid);
    }
    this.vlanMap = vlanMap;

    this.lanCidrs = Array.from(new Set(lanCidrs));
    this.networks = networks;
    if (this.state) this.state.lastWanIp = wanIp;
    this.io.emit('lan:overview', { ts: Date.now(), lanCidrs: this.lanCidrs, networks: this.networks, wanIp });
    this.state.lastNetworksTs = Date.now();
  }
}

module.exports = DhcpNetworksCollector;
