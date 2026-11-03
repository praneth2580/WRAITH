import type { Page, Response } from 'playwright';
import { WaitTimeoutError } from './errors.js';

/** Which responses to keep: a URL substring, a RegExp tested on the URL, or a function. */
export type ResponseMatcher = string | RegExp | ((response: Response) => boolean);

export interface CapturedJson<T> {
  url: string;
  method: string;
  status: number;
  data: T;
}

/**
 * Collects the JSON a page loads from its own API while you browse it. That JSON has proper field
 * names that don't change when the site's CSS does, so it's often the cleanest data to scrape.
 * Create it with `page.captureJson()` before the navigation or action that triggers the requests.
 */
export class JsonCapture<T = unknown> {
  /** Every matching response so far, in the order their bodies arrived. */
  readonly items: CapturedJson<T>[] = [];
  private readonly listeners = new Set<() => void>();
  private stopped = false;

  constructor(
    private readonly page: Page,
    private readonly match: ResponseMatcher,
  ) {
    page.on('response', this.onResponse);
  }

  /** The `data` of every captured response. */
  get data(): T[] {
    return this.items.map((item) => item.data);
  }

  /** Waits until at least `count` responses have been captured in total, then returns them all. */
  async waitFor(count = 1, options: { timeout?: number } = {}): Promise<CapturedJson<T>[]> {
    const { timeout = 30_000 } = options;
    if (this.items.length >= count) return this.items;
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.items.length < count) return;
        cleanup();
        resolve(this.items);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new WaitTimeoutError(`Captured ${this.items.length} of ${count} JSON responses within ${timeout} ms`));
      }, timeout);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
      };
      this.listeners.add(check);
    });
  }

  /** Waits for the next response captured after this call. */
  async next(options: { timeout?: number } = {}): Promise<CapturedJson<T>> {
    const items = await this.waitFor(this.items.length + 1, options);
    return items.at(-1)!;
  }

  /** Stops capturing. What's already in `items` stays. */
  stop(): void {
    this.stopped = true;
    this.page.off('response', this.onResponse);
  }

  private readonly onResponse = async (response: Response) => {
    if (!this.matches(response)) return;
    const status = response.status();
    if (status < 200 || status >= 300 || status === 204) return;
    const type = response.headers()['content-type'] ?? '';
    // Don't read images or other large binary bodies just to find out they aren't JSON.
    if (type && !/json|javascript|text\/plain/i.test(type)) return;
    let data: T;
    try {
      data = JSON.parse(await response.text()) as T;
    } catch {
      return; // Not JSON, or the body is gone because the page navigated away.
    }
    if (this.stopped) return;
    this.items.push({ url: response.url(), method: response.request().method(), status, data });
    for (const listener of [...this.listeners]) listener();
  };

  private matches(response: Response): boolean {
    const { match } = this;
    if (typeof match === 'function') return match(response);
    const url = response.url();
    return typeof match === 'string' ? url.includes(match) : match.test(url);
  }
}
