/**
 * Switches collector — polls Cisco Catalyst switches via SNMP
 * Builds a MAC → switch/port map, cross-referenced with DHCP leases
 * Also collects port status, PoE data for the visualiser
 */
const snmp = require('net-snmp');
const fs   = require('fs');
const path = require('path');
const BaseCollector = require('./BaseCollector');
const { withRetry, defaultShouldRetry } = require('../util/retry');
const { getErrorMessage } = require('../util/errors');

// OIDs — MAC table
const OID_IF_NAME        = '1.3.6.1.2.1.31.1.1.1.1';
const OID_BRIDGE_PORT_IF = '1.3.6.1.2.1.17.1.4.1.2';
const OID_FDB_MAC        = '1.3.6.1.2.1.17.4.3.1.1';
const OID_FDB_PORT       = '1.3.6.1.2.1.17.4.3.1.2';
// OIDs — port status & PoE
const OID_IF_OPER_STATUS = '1.3.6.1.2.1.2.2.1.8';
const OID_POE_STATUS     = '1.3.6.1.2.1.105.1.1.1.6';
const OID_POE_POWER      = '1.3.6.1.2.1.105.1.1.1.10';
const OID_POE_DESCR      = '1.3.6.1.2.1.105.1.1.1.9';

// Port name regex — only physical switch ports (x/0/x), no card slots
const PORT_RE = /^(Fi|Gi|Te)\d+\/0\/\d+$/;

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
  return oidSuffix.split('.').map(b => parseInt(b).toString(16).padStart(2,'0')).join(':');
}

function formatMac(buf) {
  if (!buf || !buf.length) return '';
  return Array.from(buf).map(b => b.toString(16).padStart(2,'0')).join(':');
}

// Parse module and port from ifName e.g. Fi2/0/8 -> { module:2, port:8 }
function parseIfName(ifName) {
  const m = ifName.match(/^(?:Fi|Gi|Te)(\d+)\/0\/(\d+)$/);
  if (!m) return null;
  return { module: parseInt(m[1]), port: parseInt(m[2]) };
}

function isTransientSnmpError(err) {
  const msg = getErrorMessage(err).toLowerCase();
  return defaultShouldRetry(err) || msg.includes('requestfailederror') || msg.includes('request timed out');
}

class SwitchesCollector extends BaseCollector {
  constructor({ ros, io, pollMs, dhcpLeases, arp, dhcpNetworks, state }) {
    super({ name: 'switches', ros, pollMs: pollMs || 120000, state });
    this.io           = io;
    this.dhcpLeases   = dhcpLeases;
    this.arp          = arp;
    this.dhcpNetworks = dhcpNetworks;
    this.switches     = [];
    // Cache latest port data per switch name for API endpoint
    this._portCache   = new Map();
    this._macCache    = new Map();
    this._cursor      = 0;
    this._switchHealth = new Map(); // name -> { failCount, skipUntil }
    this._switchTimeoutMs = parseInt(process.env.SWITCH_POLL_TIMEOUT_MS || '15000', 10);
    this._maxPerTick = Math.max(1, parseInt(process.env.SWITCH_MAX_PER_TICK || '2', 10));
    this._delayTimer  = null;
    this._loadConfig();
  }

  _pickBatch() {
    if (!this.switches.length) return [];
    const size = Math.min(this._maxPerTick, this.switches.length);
    const batch = [];
    for (let i = 0; i < size; i++) {
      const idx = (this._cursor + i) % this.switches.length;
      batch.push(this.switches[idx]);
    }
    this._cursor = (this._cursor + size) % this.switches.length;
    return batch;
  }

  async _withTimeout(promise, timeoutMs, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out after ' + timeoutMs + 'ms')), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  _loadConfig() {
    const p = path.join(process.cwd(), 'switches.json');
    if (!fs.existsSync(p)) { console.warn('[switches] switches.json not found, collector disabled'); return; }
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      this.switches = cfg.switches || [];
      console.log(`[switches] loaded ${this.switches.length} switch(es)`);
    } catch(e) {
      console.error('[switches] failed to parse switches.json:', getErrorMessage(e));
    }
  }

  _createSession(ip, community) {
    return snmp.createSession(ip, community, {
      version: snmp.Version2c,
      timeout: 5000,
      retries: 1,
    });
  }

  async _walk(ip, community, oid) {
    return withRetry(
      async () => {
        const session = this._createSession(ip, community);
        try {
          return await snmpWalk(session, oid);
        } finally {
          session.close();
        }
      },
      {
        retries: 2,
        baseDelayMs: 250,
        shouldRetry: isTransientSnmpError,
      }
    );
  }

  async _getIfNames(ip, community) {
    const varbinds = await this._walk(ip, community, OID_IF_NAME);
    const map = new Map(); // ifIndex -> name
    for (const vb of varbinds) {
      const ifIndex = parseInt(vb.oid.split('.').pop());
      map.set(ifIndex, vb.value.toString());
    }
    return map;
  }

  async _getIfOperStatus(ip, community) {
    const varbinds = await this._walk(ip, community, OID_IF_OPER_STATUS);
    const map = new Map(); // ifIndex -> 'up'|'down'
    for (const vb of varbinds) {
      const ifIndex = parseInt(vb.oid.split('.').pop());
      map.set(ifIndex, vb.value === 1 ? 'up' : 'down');
    }
    return map;
  }

  // PoE OIDs use module.port indexing — returns Map keyed as "module:port"
  async _getPoeData(ip, community) {
    const [statusVbs, powerVbs, descrVbs] = await Promise.all([
      this._walk(ip, community, OID_POE_STATUS),
      this._walk(ip, community, OID_POE_POWER),
      this._walk(ip, community, OID_POE_DESCR),
    ]);

    const poe = new Map(); // "module:port" -> { status, power, descr }

    for (const vb of statusVbs) {
      const parts  = vb.oid.split('.');
      const port   = parseInt(parts.pop());
      const module = parseInt(parts.pop());
      const key    = `${module}:${port}`;
      if (!poe.has(key)) poe.set(key, { status: 'unknown', power: 0, descr: '' });
      // 3 = delivering, 2 = disabled/searching, others = fault/error
      poe.get(key).status = vb.value === 3 ? 'delivering' : vb.value === 2 ? 'idle' : 'fault';
    }

    for (const vb of powerVbs) {
      const parts  = vb.oid.split('.');
      const port   = parseInt(parts.pop());
      const module = parseInt(parts.pop());
      const key    = `${module}:${port}`;
      if (!poe.has(key)) poe.set(key, { status: 'unknown', power: 0, descr: '' });
      poe.get(key).power = vb.value || 0;
    }

    for (const vb of descrVbs) {
      const parts  = vb.oid.split('.');
      const port   = parseInt(parts.pop());
      const module = parseInt(parts.pop());
      const key    = `${module}:${port}`;
      if (!poe.has(key)) poe.set(key, { status: 'unknown', power: 0, descr: '' });
      poe.get(key).descr = vb.value ? vb.value.toString() : '';
    }

    return poe;
  }

  async _getBridgePortMap(ip, community, vlan) {
    const varbinds = await this._walk(ip, `${community}@${vlan}`, OID_BRIDGE_PORT_IF);
    const map = new Map();
    for (const vb of varbinds) {
      const bridgePort = parseInt(vb.oid.split('.').pop());
      map.set(bridgePort, vb.value);
    }
    return map;
  }

  async _getMacTable(ip, community, vlan) {
    const macVbs = await this._walk(ip, `${community}@${vlan}`, OID_FDB_MAC);
    const portVbs = await this._walk(ip, `${community}@${vlan}`, OID_FDB_PORT);

    const portMap = new Map();
    for (const vb of portVbs) {
      const suffix = vb.oid.replace(OID_FDB_PORT + '.', '');
      portMap.set(suffix, vb.value);
    }
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
    const lease = this.dhcpLeases.getNameByMAC(upperMac) || this.dhcpLeases.getNameByMAC(lowerMac);
    if (lease) return { name: lease.name || '', ip: lease.ip || '' };
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

    // Collect base data in parallel where possible
    const [ifNames, ifOperStatus, poeData] = await Promise.all([
      this._getIfNames(sw.ip, sw.community),
      this._getIfOperStatus(sw.ip, sw.community),
      this._getPoeData(sw.ip, sw.community).catch(e => {
        console.warn(`[switches] ${sw.name} PoE data error:`, getErrorMessage(e));
        return new Map();
      }),
    ]);

    // Build ifName -> ifIndex reverse map for status lookups
    const ifNameToIndex = new Map();
    for (const [idx, name] of ifNames.entries()) {
      ifNameToIndex.set(name, idx);
    }

    // Build portStatus map: ifName -> 'up'|'down'
    const portStatus = new Map();
    for (const [idx, status] of ifOperStatus.entries()) {
      const name = ifNames.get(idx);
      if (name) portStatus.set(name, status);
    }

    // MAC table collection (VLAN-aware)
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
          if (!portMacs.get(ifName).has(mac)) {
            portMacs.get(ifName).set(mac, vlan);
          }
        }
      } catch(e) {
        console.warn(`[switches] ${sw.name} VLAN ${vlan} error:`, getErrorMessage(e));
      }
    }

    // ── Build MAC table output (existing switches:update format) ────────────
    const macPorts = [];
    for (const [ifName, macVlanMap] of portMacs.entries()) {
      for (const [mac, vlan] of macVlanMap.entries()) {
        const device = this.resolveDevice(mac);
        macPorts.push({ switch: sw.name, port: ifName, mac, name: device.name, ip: device.ip, vlan });
      }
    }

    // ── Build visualiser port list ───────────────────────────────────────────
    // Only include physical x/0/x ports
    const allPorts = [];
    for (const [ifIndex, ifName] of ifNames.entries()) {
      if (!PORT_RE.test(ifName)) continue;
      const isUplink = trunkSet.has(ifName);
      const parsed = parseIfName(ifName);
      if (!parsed) continue;
      const { module, port } = parsed;
      const poeKey  = `${module}:${port}`;
      const poe     = poeData.get(poeKey) || { status: 'unknown', power: 0, descr: '' };
      const status  = portStatus.get(ifName) || 'down';

      // Get MACs on this port
      const macs = portMacs.has(ifName) ? Array.from(portMacs.get(ifName).entries()).map(([mac, vlan]) => {
        const device = this.resolveDevice(mac);
        return { mac, vlan, name: device.name, ip: device.ip };
      }) : [];

      allPorts.push({
        ifName,
        module,
        port,
        status,
        isUplink,
        poeStatus:  isUplink ? 'none' : poe.status,
        poePower:   isUplink ? 0 : poe.power,
        poeDescr:   isUplink ? '' : poe.descr,
        macs,
      });
    }

    // Sort by module then port number
    allPorts.sort((a, b) => a.module !== b.module ? a.module - b.module : a.port - b.port);

    return { macPorts, allPorts };
  }

  async tick() {
    if (!this.switches.length) return;
    const now = Date.now();
    const batch = this._pickBatch();
    const polledNames = [];

    for (const sw of batch) {
      const health = this._switchHealth.get(sw.name) || { failCount: 0, skipUntil: 0 };
      if (health.skipUntil > now) continue;

      try {
        const { macPorts, allPorts } = await this._withTimeout(
          this.pollSwitch(sw),
          this._switchTimeoutMs,
          '[switches] ' + sw.name
        );
        polledNames.push(sw.name);
        this._macCache.set(sw.name, macPorts);
        // Cache port data for API endpoint
        this._portCache.set(sw.name, { ts: Date.now(), ports: allPorts });
        this._switchHealth.set(sw.name, { failCount: 0, skipUntil: 0 });
      } catch(e) {
        const failCount = (health.failCount || 0) + 1;
        const backoffMs = Math.min(5 * 60 * 1000, 5000 * Math.pow(2, failCount - 1));
        this._switchHealth.set(sw.name, { failCount, skipUntil: now + backoffMs });
        console.error(`[switches] ${sw.name} poll failed (fail=${failCount}, backoff=${backoffMs}ms):`, getErrorMessage(e));
      }
    }

    // Emit latest known state for all switches, even when a subset is polled this tick.
    const macResults = [];
    for (const sw of this.switches) {
      const cached = this._macCache.get(sw.name);
      if (cached && cached.length) macResults.push(...cached);
    }

    // Emit MAC table update (existing event)
    this.io.emit('switches:update', { ts: Date.now(), ports: macResults, polled: polledNames });
    this.state.lastSwitchesTs = Date.now();
  }

  // Returns cached port data for a named switch
  getPortData(switchName) {
    return this._portCache.get(switchName) || null;
  }

  // Returns list of switch names and their member counts
  getSwitchList() {
    return this.switches.map(sw => {
      const cached = this._portCache.get(sw.name);
      const modules = cached
        ? [...new Set(cached.ports.map(p => p.module))]
        : [1];
      return { name: sw.name, modules };
    });
  }

  async _runTick() {
    try {
      await this.tick();
    } catch (e) {
      console.error('[switches]', getErrorMessage(e));
    }
  }

  async start() {
    if (this.isRunning || !this.switches.length) return;
    this.isRunning = true;
    this._delayTimer = setTimeout(() => {
      if (!this.isRunning) return;
      this._runTick();
      this._startTick();
    }, 15000);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this._delayTimer) {
      clearTimeout(this._delayTimer);
      this._delayTimer = null;
    }
    this._stopTick();
  }
}

module.exports = SwitchesCollector;