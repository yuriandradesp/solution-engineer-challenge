import { sleep } from '../../common/util';

/**
 * Sliding-window client-side rate limiter. `acquire()` resolves only when a
 * request slot is free, so a poller never exceeds a customer's published
 * limit (e.g. GlobalGoods' 60/min) even while paginating.
 */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => t > now - this.windowMs);
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 5;
      await sleep(waitMs);
    }
  }
}
