/**
 * BaseCollector — shared lifecycle, timer, and error handling for all collectors.
 * 
 * Subclasses should implement:
 * - tick() — called on each poll cycle
 * - onConnected() — (optional) called when reconnected; use for full restart
 * - onDisconnected() — (optional) called when disconnected; use for cleanup
 */

class BaseCollector {
  constructor({ name, ros, pollMs = 5000, state } = {}) {
    this.name = name || this.constructor.name;
    this.ros = ros;
    this.pollMs = pollMs;
    this.state = state || {};
    this.timer = null;
    this.isRunning = false;
    this._boundOnConnected = null;
    this._boundOnClose = null;
  }

  /**
   * Subclasses override this to implement poll/stream logic.
   */
  async tick() {
    throw new Error(`${this.name}: tick() not implemented`);
  }

  /**
   * Called when ros connection is established/re-established.
   * Subclasses override for custom reconnection logic (e.g., restart streams).
   */
  async onConnected() {
    // Default: nothing
  }

  /**
   * Called when ros connection is lost.
   * Subclasses override for cleanup (e.g., close streams, clear caches).
   */
  async onDisconnected() {
    // Default: nothing
  }

  /**
   * Start the collector: run tick once immediately, then set up interval and listeners.
   */
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initial tick
    await this._runTick();

    // Start polling interval
    this._startTick();

    // Listen for reconnection when a ROS client is available
    if (this.ros && typeof this.ros.on === 'function') {
      this._boundOnConnected = () => this._onConnected();
      this._boundOnClose = () => this._onDisconnected();
      this.ros.on('connected', this._boundOnConnected);
      this.ros.on('close', this._boundOnClose);
    }
  }

  /**
   * Stop the collector: clear interval and close any streams.
   */
  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this._stopTick();
    if (this.ros && typeof this.ros.off === 'function') {
      if (this._boundOnConnected) this.ros.off('connected', this._boundOnConnected);
      if (this._boundOnClose) this.ros.off('close', this._boundOnClose);
    } else if (this.ros && typeof this.ros.removeListener === 'function') {
      if (this._boundOnConnected) this.ros.removeListener('connected', this._boundOnConnected);
      if (this._boundOnClose) this.ros.removeListener('close', this._boundOnClose);
    }
    this._boundOnConnected = null;
    this._boundOnClose = null;
  }

  /**
   * Internal: start polling interval.
   */
  _startTick() {
    if (this.timer) return; // already running
    if (!this.pollMs || this.pollMs <= 0) return;
    if (this.ros && this.ros.connected === false) return;

    this.timer = setInterval(() => this._runTick(), this.pollMs);
  }

  /**
   * Internal: stop polling interval.
   */
  _stopTick() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Internal: wrapper around tick() with error handling.
   */
  async _runTick() {
    if (this.ros && this.ros.connected === false) return;
    try {
      await this.tick();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.error(`[${this.name}] tick error:`, msg);
      this.state[`last${this.name}Err`] = msg;
    }
  }

  /**
   * Internal: called when ros reconnects.
   */
  async _onConnected() {
    this._stopTick(); // clear old timer
    await this.onConnected(); // subclass hook
    this._startTick(); // restart polling
    await this._runTick(); // immediate update
  }

  /**
   * Internal: called when ros disconnects.
   */
  async _onDisconnected() {
    this._stopTick();
    await this.onDisconnected(); // subclass hook
  }
}

module.exports = BaseCollector;
