const BaseCollector = require('./BaseCollector');

class InterfaceStatusCollector extends BaseCollector {
  constructor({ ros, io, pollMs, state }) {
    super({ name: 'ifstatus', ros, pollMs: pollMs || 5000, state });
    this.io = io;
  }
  async tick() {
    const [ifRes, addrRes] = await Promise.allSettled([
      this.ros.write("/interface/print", ["=stats="]),
      this.ros.write("/ip/address/print"),
    ]);
    const ifaces = ifRes.status === "fulfilled" ? (ifRes.value || []) : [];
    const addrs  = addrRes.status === "fulfilled" ? (addrRes.value || []) : [];
    const ipByIface = {};
    for (const a of addrs) {
      const n = a.interface || "";
      if (!ipByIface[n]) ipByIface[n] = [];
      ipByIface[n].push(a.address || "");
    }
    const interfaces = ifaces.map(i => ({
      name:     i.name || "",
      type:     i.type || "ether",
      running:  i.running === "true" || i.running === true,
      disabled: i.disabled === "true" || i.disabled === true,
      comment:  i.comment || "",
      macAddr:  i["mac-address"] || "",
      rxBytes:  parseInt(i["rx-byte"] || "0", 10),
      txBytes:  parseInt(i["tx-byte"] || "0", 10),
      rxMbps:   Math.round((parseFloat(i["rx-bits-per-second"] || "0") / 1e6) * 10) / 10,
      txMbps:   Math.round((parseFloat(i["tx-bits-per-second"] || "0") / 1e6) * 10) / 10,
      ips:      ipByIface[i.name] || [],
    }));
    this.io.emit("ifstatus:update", { ts: Date.now(), interfaces });
    this.state.lastIfStatusTs = Date.now();
  }
}
module.exports = InterfaceStatusCollector;
