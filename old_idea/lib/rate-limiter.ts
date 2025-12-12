/**
 * Rate limiter for OpenRouter API
 * Free tier: 20 requests per minute = minimum 3 seconds between requests
 */

class RateLimiter {
  private queue: Array<{
    resolve: () => void;
    timestamp: number;
  }> = [];
  private lastRequestTime: number = 0;
  private minDelayMs: number = 3000; // 3 seconds (60 seconds / 20 requests)
  private processing: boolean = false;

  /**
   * Wait for rate limit before making a request
   * Ensures at least 3 seconds between requests
   */
  async waitForRateLimit(): Promise<void> {
    return new Promise((resolve) => {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      
      if (timeSinceLastRequest >= this.minDelayMs && !this.processing) {
        // Can proceed immediately
        this.lastRequestTime = now;
        resolve();
      } else {
        // Need to wait
        const waitTime = Math.max(0, this.minDelayMs - timeSinceLastRequest);
        this.queue.push({
          resolve,
          timestamp: now + waitTime,
        });
        this.processQueue();
      }
    });
  }

  private processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const processNext = () => {
      if (this.queue.length === 0) {
        this.processing = false;
        return;
      }

      const now = Date.now();
      const next = this.queue[0];
      const waitTime = Math.max(0, next.timestamp - now);

      if (waitTime === 0) {
        // Ready to process
        this.queue.shift();
        this.lastRequestTime = Date.now();
        next.resolve();
        // Process next item after minimum delay
        setTimeout(processNext, this.minDelayMs);
      } else {
        // Wait until ready
        setTimeout(processNext, waitTime);
      }
    };

    processNext();
  }

  /**
   * Reset the rate limiter (useful for testing or after errors)
   */
  reset() {
    this.lastRequestTime = 0;
    this.queue = [];
    this.processing = false;
  }

  /**
   * Get estimated wait time in milliseconds
   */
  getEstimatedWaitTime(): number {
    if (this.queue.length === 0 && Date.now() - this.lastRequestTime >= this.minDelayMs) {
      return 0;
    }
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    const waitForCurrent = Math.max(0, this.minDelayMs - timeSinceLastRequest);
    const waitForQueue = this.queue.length * this.minDelayMs;
    return waitForCurrent + waitForQueue;
  }
}

export const rateLimiter = new RateLimiter();

