import PQueue from 'p-queue';
import pRetry from 'p-retry';
import type { ResolvedNetwork } from '../config.js';
import { HttpError, RobotsDisallowedError, WraithError } from '../errors.js';
import type { Logger } from '../logger.js';
import { RobotsCache } from './robots.js';

const RETRYABLE_STATUS = new Set([408, 425, 429]);

export const isRetryableStatus = (status: number) => RETRYABLE_STATUS.has(status) || status >= 500;

function isRetryable(error: Error): boolean {
  if (error instanceof HttpError) return isRetryableStatus(error.status);
  if (error instanceof WraithError) return false;
  // Playwright: the page or browser was closed under us. Retrying can't help.
  return !/has been closed|Target closed/i.test(error.message);
}

/**
 * Every request and navigation goes through here: the robots.txt check, then a per-host queue
 * that enforces the rate limit, with retries and exponential backoff around it.
 */
export class Scheduler {
  private readonly queues = new Map<string, Promise<PQueue>>();
  private readonly robots: RobotsCache | undefined;

  constructor(
    private readonly network: ResolvedNetwork,
    private readonly logger: Logger,
  ) {
    this.robots = network.respectRobotsTxt ? new RobotsCache(network.userAgent, network.timeout) : undefined;
  }

  async run<T>(url: string, task: () => Promise<T>): Promise<T> {
    if (this.robots && !(await this.robots.isAllowed(url))) throw new RobotsDisallowedError(url);
    const queue = await this.queueFor(url);
    // Retry outside the queue, so waiting out a backoff doesn't hold a slot other requests could use.
    return pRetry(() => (queue ? queue.add(task) : task()), {
      retries: this.network.retries,
      minTimeout: 1000,
      factor: 2,
      randomize: true,
      shouldRetry: ({ error }) => isRetryable(error),
      onFailedAttempt: ({ error, attemptNumber, retriesLeft }) => {
        if (retriesLeft > 0 && isRetryable(error)) {
          this.logger.warn(`${url} failed (attempt ${attemptNumber}): ${error.message}. Retrying.`);
        }
      },
    });
  }

  private queueFor(url: string): Promise<PQueue> | undefined {
    const limit = this.network.rateLimit;
    if (!limit) return undefined;
    const host = new URL(url).host;
    let queue = this.queues.get(host);
    if (!queue) {
      queue = this.createQueue(url, limit);
      this.queues.set(host, queue);
    }
    return queue;
  }

  private async createQueue(url: string, limit: Exclude<ResolvedNetwork['rateLimit'], false>): Promise<PQueue> {
    const delaySeconds = await this.robots?.crawlDelay(url);
    if (delaySeconds && delaySeconds > 0) {
      this.logger.info(`${new URL(url).host} asks for a ${delaySeconds}s crawl delay`);
      return new PQueue({ concurrency: 1, intervalCap: 1, interval: delaySeconds * 1000 });
    }
    return new PQueue({ concurrency: limit.concurrency, intervalCap: limit.maxRequests, interval: limit.intervalMs });
  }
}
