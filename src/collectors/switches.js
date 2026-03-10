/**
 * Switches collector — polls Cisco Catalyst switches via SNMP
 * Builds a MAC → switch/port map, cross-referenced with DHCP leases
 */
const snmp = require('net-snmp');
const fs   = require('fs');
const path = require('path');

// OIDs
const OID_IF_NAME        = '1.3.6.1.2.1.31.1.1.1.1';   // ifName (ifIndex -> name)
const OID_BRIDGE_PORT_IF = '1.3.6.1.2.1.17.1.4.1.2';   // dot1dBasePortIfIndex (bridgePort -> ifIndex)
const OID_FDB_MAC        = '1.3.6.1.2.1.17.4.3.1.1';   // dot1dTpFdbAddress (MAC table)
const OID_FDB_PORT       = '1.3.6.1.2.1.17.4.3.1.2';   // dot1dTpFdbPort (MAC -> bridgePort)

function snmpWalk(session, oid) {
  return new Promise((resolve, reject) => {
    const results = [];
    session.subtree(oid, 20, (varbinds) => {
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb)) continue;
        results.push(vb);
      }
    }, (err) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
}

function macFromOid(oidSuffix) {
  // OID suffix is the MAC as decimal octets e.g. "0.21.93.203.149.2"
  return oidSuffix.split('.').map(b => parseInt(b).toString(16).padStart(2,'0')).join(':');
}

function formatMac(buf) {
  if (!buf || !buf.length) return '';
  return Array.from(buf).map(b => b.toString(16).padStart(2,'0')).join(':');
}

class SwitchesCollector {
    constructor({ io, pollMs, dhcpLeases, arp, dhcpNetworks, state }) {
    this.io           = io;
    this.pollMs       = pollMs || 120000;
    this.dhcpLeases   = dhcpLeases;
    this.arp          = arp;
    this.dhcpNetworks = dhcpNetworks;
    this.state        = state;
    this.switches    = [];
    this.timer       = null;
    this._loadConfig();
  }

  _loadConfig() {
    const p = path.join(process.cwd(), 'switches.json');
    if (!fs.existsSync(p)) { console.warn('[switches] switches.json not found, collector disabled'); return; }
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      this.switches = cfg.switches || [];
      console.log(`[switches] loaded ${this.switches.length} switch(es)`);
    } catch(e) {
      console.error('[switches] failed to parse switches.json:', e.message);
    }
  }

  _createSession(ip, community) {
    return snmp.createSession(ip, community, {
      version: snmp.Version2c,
      timeout: 5000,
      retries: 1,
    });
  }

  async _getIfNames(ip, community) {
    const session = this._createSession(ip, community);
    try {
      const varbinds = await snmpWalk(session, OID_IF_NAME);
      const map = new Map(); // ifIndex -> name
      for (const vb of varbinds) {
        const ifIndex = parseInt(vb.oid.split('.').pop());
        map.set(ifIndex, vb.value.toString());
      }
      return map;
    } finally {
      session.close();
    }
  }

  async _getBridgePortMap(ip, community, vlan) {
    // Use VLAN-context community string for VLAN-aware bridge table
    const session = this._createSession(ip, `${community}@${vlan}`);
    try {
      const varbinds = await snmpWalk(session, OID_BRIDGE_PORT_IF);
      const map = new Map(); // bridgePort -> ifIndex
      for (const vb of varbinds) {
        const bridgePort = parseInt(vb.oid.split('.').pop());
        map.set(bridgePort, vb.value);
      }
      return map;
    } finally {
      session.close();
    }
  }

async _getMacTable(ip, community, vlan) {
    // Fetch MAC->bridgePort mapping using two separate sessions
    const session1 = this._createSession(ip, `${community}@${vlan}`);
    const macVbs = await snmpWalk(session1, OID_FDB_MAC);
    session1.close();

    const session2 = this._createSession(ip, `${community}@${vlan}`);
    const portVbs = await snmpWalk(session2, OID_FDB_PORT);
    session2.close();

    // Build port map from OID suffix -> bridgePort
    const portMap = new Map();
    for (const vb of portVbs) {
      const suffix = vb.oid.replace(OID_FDB_PORT + '.', '');
      portMap.set(suffix, vb.value);
    }
    // Build MAC entries
    const entries = [];
    for (const vb of macVbs) {
      const suffix = vb.oid.replace(OID_FDB_MAC + '.', '');
      const mac    = formatMac(vb.value);
      const port   = portMap.get(suffix) || 0;
      if (port > 0) entries.push({ mac, bridgePort: port });
    }
    return entries;
  }

resolveDevice(mac) {
    const lowerMac = mac.toLowerCase();
    const upperMac = mac.toUpperCase();
    
    // Try both cases for DHCP lease lookup
    const lease = this.dhcpLeases.getNameByMAC(upperMac) || this.dhcpLeases.getNameByMAC(lowerMac);
    if (lease) return { name: lease.name || '', ip: lease.ip || '' };
    
    // Try ARP
    if (this.arp && this.arp.getByMAC) {
      const a = this.arp.getByMAC(upperMac) || this.arp.getByMAC(lowerMac);
      if (a && a.ip) {
        const l = this.dhcpLeases.getNameByIP(a.ip);
        return { name: (l && l.name) || '', ip: a.ip };
      }
    }
    return { name: '', ip: '' };
  }

  async pollSwitch(sw) {
    console.log(`[switches] polling ${sw.name} (${sw.ip})`);
    const trunkSet = new Set(sw.uplinkPorts || []);

    // Step 1 — get ifIndex -> name map (no VLAN context needed)
    const ifNames = await this._getIfNames(sw.ip, sw.community);

    // Step 2 — get VLANs from DHCP networks if available, else use a default set
    // For now use a hardcoded set — we'll make this dynamic later
    const vlans = this.dhcpNetworks
      ? [sw.defaultVlan, ...this.dhcpNetworks.getVlansForInterface(sw.mikrotikInterface)].filter(Boolean)
      : [sw.defaultVlan || 100];

    const portMacs = new Map(); // ifName -> Map<mac, vlan>

    for (const vlan of vlans) {
      try {
        const bridgePortMap = await this._getBridgePortMap(sw.ip, sw.community, vlan);
        const macEntries    = await this._getMacTable(sw.ip, sw.community, vlan);

        for (const { mac, bridgePort } of macEntries) {
          const ifIndex = bridgePortMap.get(bridgePort);
          const ifName  = ifNames.get(ifIndex) || `port${bridgePort}`;
          if (trunkSet.has(ifName)) continue;
          if (!portMacs.has(ifName)) portMacs.set(ifName, new Map());
          // Store mac -> vlan (first seen wins)
          if (!portMacs.get(ifName).has(mac)) {
            portMacs.get(ifName).set(mac, vlan);
          }
        }
      } catch(e) {
        console.warn(`[switches] ${sw.name} VLAN ${vlan} error:`, e.message);
      }
    }

    // Build output
    const ports = [];
    for (const [ifName, macVlanMap] of portMacs.entries()) {
      for (const [mac, vlan] of macVlanMap.entries()) {
        const device = this.resolveDevice(mac);
        ports.push({ switch: sw.name, port: ifName, mac, name: device.name, ip: device.ip, vlan });
      }
    }
    return ports;
  }

  async tick() {
    if (!this.switches.length) return;
    const results = [];
    for (const sw of this.switches) {
      try {
        const ports = await this.pollSwitch(sw);
        results.push(...ports);
      } catch(e) {
        console.error(`[switches] ${sw.name} poll failed:`, e.message);
      }
    }
    this.io.emit('switches:update', { ts: Date.now(), ports: results });
    this.state.lastSwitchesTs = Date.now();
  }

  start() {
    if (!this.switches.length) return;
    const run = async () => {
      try { await this.tick(); } catch(e) {
        console.error('[switches]', e.message);
      }
    };
    // Delay first poll to allow DHCP and ARP collectors to populate
    setTimeout(() => {
      run();
      this.timer = setInterval(run, this.pollMs);
    }, 15000);
  }
}

module.exports = SwitchesCollector;