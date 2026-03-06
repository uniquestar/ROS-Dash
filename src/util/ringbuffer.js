class RingBuffer {
  constructor(maxPoints) { this.maxPoints = maxPoints; this.arr = []; }
  push(item) { this.arr.push(item); if (this.arr.length > this.maxPoints) this.arr.splice(0, this.arr.length - this.maxPoints); }
  toArray() { return this.arr.slice(); }
}
module.exports = RingBuffer;
