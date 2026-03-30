const BaseCollector = require('./BaseCollector');
const { getErrorMessage } = require('../util/errors');

class SystemCollector extends BaseCollector {
  constructor({ ros, io, pollMs, state }) {
    super({ name: 'system', ros, pollMs: pollMs || 5000, state });
    this.io = io;
    this._loggedUpdateFields = false; // one-time field dump for diagnosis
  }

  async tick() {
    let resourceRow = {};
    let healthRows = [];
    let updateRow = {};
    try {
      const [resResult, healthResult, updateResult] = await Promise.allSettled([
        this.ros.write('/system/resource/print'),
        this.ros.write('/system/health/print'),
        this.ros.write('/system/package/update/print'),
      ]);
      resourceRow = resResult.status === 'fulfilled' && resResult.value && resResult.value[0] ? resResult.value[0] : {};
      healthRows = healthResult.status === 'fulfilled' && Array.isArray(healthResult.value) ? healthResult.value : [];
      updateRow = updateResult.status === 'fulfilled' && updateResult.value && updateResult.value[0] ? updateResult.value[0] : {};

      // One-time log so we can see exactly what fields RouterOS returns
      if (!this._loggedUpdateFields && Object.keys(updateRow).length) {
        console.log('[system] package/update fields:', JSON.stringify(updateRow));
        this._loggedUpdateFields = true;
      }
    } catch (e) {
      this.state.lastSystemErr = getErrorMessage(e);
      console.error('[system]', this.state.lastSystemErr);
      return;
    }

    const cpuLoad  = parseInt(resourceRow['cpu-load'] || '0', 10);
    const totalMem = parseInt(resourceRow['total-memory'] || '0', 10);
    const freeMem  = parseInt(resourceRow['free-memory'] || '0', 10);
    const usedMem  = totalMem - freeMem;
    const memPct   = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;
    const totalHdd = parseInt(resourceRow['total-hdd-space'] || '0', 10);
    const freeHdd  = parseInt(resourceRow['free-hdd-space'] || '0', 10);
    const hddPct   = totalHdd > 0 ? Math.round(((totalHdd - freeHdd) / totalHdd) * 100) : 0;

    let tempC = null;
    for (const item of healthRows) {
      if ((item.name || '').toLowerCase().includes('temperature')) {
        const v = parseFloat(item.value || '');
        if (!isNaN(v)) { tempC = v; break; }
      }
    }

    // /system/resource/print returns version as "7.21.3 (stable)" — strip the channel suffix
    // /system/package/update/print returns clean "7.21.3" — compare the base version only
    const installed       = resourceRow.version || '';
    const installedBase   = installed.replace(/\s*\(.*\)/, '').trim();
    const latestVersion   = updateRow['latest-version'] || '';
    const updateStatus    = updateRow['status'] || '';
    // Prefer the router's own status string: "System is already up to date" vs "New version is available"
    const updateAvailable = latestVersion
      ? (latestVersion !== installedBase)
      : updateStatus.toLowerCase().includes('new version');

    this.io.emit('system:update', {
      ts: Date.now(), uptimeRaw: resourceRow.uptime || '', cpuLoad, memPct, usedMem, totalMem,
      hddPct, totalHdd, freeHdd, version: installed,
      latestVersion, updateAvailable: !!updateAvailable, updateStatus,
      boardName: resourceRow['board-name'] || resourceRow['platform'] || '',
      cpuCount: parseInt(resourceRow['cpu-count'] || '1', 10),
      cpuFreq:  parseInt(resourceRow['cpu-frequency'] || '0', 10),
      tempC,
    });
    this.state.lastSystemTs = Date.now();
    delete this.state.lastSystemErr;
  }
}

module.exports = SystemCollector;
