import { chromium, firefox, webkit, type Browser, type BrowserContext } from 'playwright';
import { AIClient } from './ai/client.js';
import {
  resolveHuman,
  resolveNetwork,
  type HumanOption,
  type ResolvedNetwork,
  type WraithOptions,
} from './config.js';
import { runCrawl, type CrawlOptions, type CrawlResult } from './crawl.js';
import { HttpError, WraithError } from './errors.js';
import type { HumanBehavior } from './human/behavior.js';
import { Humanizer } from './human/humanizer.js';
import { createRng } from './human/random.js';
import { resolveLogger, type Logger } from './logger.js';
import { isRetryableStatus, Scheduler } from './net/scheduler.js';
import { WraithPage, type GotoOptions } from './page.js';
import { StaticPage } from './static-page.js';

const ENGINES = { chromium, firefox, webkit };

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

export interface NewPageOptions {
  /** Human behaviour for this page only, overriding the Wraith-wide setting. */
  human?: HumanOption;
}

/**
 * The entry point. Holds one browser and context (launched lazily, on the first browser page),
 * the per-host rate limiter, and the AI client. Everything runs in your process.
 *
 * ```ts
 * const wraith = createWraith({ human: 'natural' });
 * const page = await wraith.open('https://example.com');
 * await page.click('text=More information');
 * await wraith.close();
 * ```
 */
export class Wraith {
  readonly human: HumanBehavior;
  readonly network: ResolvedNetwork;
  readonly logger: Logger;
  private readonly scheduler: Scheduler;
  private readonly aiClient: AIClient | undefined;
  private launching: Promise<{ browser: Browser; context: BrowserContext }> | undefined;
  private pageCount = 0;

  constructor(readonly options: WraithOptions = {}) {
    this.human = resolveHuman(options.human);
    this.network = resolveNetwork(options.network);
    this.logger = resolveLogger(options.logger);
    this.scheduler = new Scheduler(this.network, this.logger);
    this.aiClient = options.ai ? new AIClient(options.ai, this.logger) : undefined;
  }

  /** The AI client, for content you already have (`wraith.ai.extract(text, schema)`). Needs the `ai` option. */
  get ai(): AIClient {
    if (!this.aiClient) throw new WraithError('AI is not configured. Pass { ai: { provider: ... } } to createWraith().');
    return this.aiClient;
  }

  /** The Playwright browser context, launching the browser if needed. */
  async context(): Promise<BrowserContext> {
    this.launching ??= this.launch();
    try {
      return (await this.launching).context;
    } catch (error) {
      this.launching = undefined;
      throw error;
    }
  }

  /** Opens a new tab. */
  async newPage(options: NewPageOptions = {}): Promise<WraithPage> {
    const context = await this.context();
    const raw = await context.newPage();
    // Each page gets its own random stream, so seeded runs stay reproducible with several tabs.
    const seed = this.options.seed === undefined ? undefined : this.options.seed + this.pageCount;
    this.pageCount++;
    const behavior = options.human === undefined ? this.human : resolveHuman(options.human);
    return new WraithPage(raw, {
      human: new Humanizer(raw, behavior, createRng(seed)),
      scheduler: this.scheduler,
      timeout: this.network.timeout,
      ai: this.aiClient,
    });
  }

  /** Opens a new tab and navigates to `url`. */
  async open(url: string, options?: GotoOptions & NewPageOptions): Promise<WraithPage> {
    const page = await this.newPage(options);
    try {
      await page.goto(url, options);
      return page;
    } catch (error) {
      await page.close().catch(() => {});
      throw error;
    }
  }

  /**
   * Downloads a page without a browser and parses it. Much faster than `open()`, for pages that
   * don't need JavaScript. Goes through the same rate limit, retries and robots.txt check.
   */
  async fetch(url: string, options: FetchOptions = {}): Promise<StaticPage> {
    return this.scheduler.run(url, async () => {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          ...(this.network.userAgent ? { 'user-agent': this.network.userAgent } : {}),
          ...this.network.headers,
          ...options.headers,
        },
        ...(options.body !== undefined ? { body: options.body } : {}),
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeout ?? this.network.timeout),
      });
      if (isRetryableStatus(response.status)) throw new HttpError(response.status, url);
      const body = await response.text();
      return new StaticPage(response.url || url, response.status, response.headers, body, this.aiClient);
    });
  }

  /**
   * Visits pages breadth-first from `start`, calling `handler` on each, following links within
   * the limits you set. Failed pages are collected in `errors` rather than stopping the crawl.
   */
  crawl<T>(options: CrawlOptions<StaticPage, T> & { mode: 'static' }): Promise<CrawlResult<T>>;
  crawl<T>(options: CrawlOptions<WraithPage, T> & { mode?: 'browser' }): Promise<CrawlResult<T>>;
  crawl<T>(options: CrawlOptions<StaticPage, T> | CrawlOptions<WraithPage, T>): Promise<CrawlResult<T>> {
    if (options.mode === 'static') {
      return runCrawl(options as CrawlOptions<StaticPage, T>, {
        open: (url) => this.fetch(url),
        links: async (page) => page.links(),
        close: async () => {},
      });
    }
    return runCrawl(options as CrawlOptions<WraithPage, T>, {
      open: (url) => this.open(url),
      links: (page) => page.links(),
      close: (page) => page.close(),
    });
  }

  /** Saves cookies and local storage to a file. Load it later with `{ context: { storageState: path } }`. */
  async saveSession(path: string): Promise<void> {
    await (await this.context()).storageState({ path });
  }

  /** Closes the browser. Static fetches keep working afterwards; a new browser page relaunches it. */
  async close(): Promise<void> {
    const launching = this.launching;
    this.launching = undefined;
    if (!launching) return;
    const { browser, context } = await launching.catch(() => ({ browser: undefined, context: undefined }));
    await context?.close().catch(() => {});
    await browser?.close();
  }

  private async launch(): Promise<{ browser: Browser; context: BrowserContext }> {
    const engine = ENGINES[this.options.browser ?? 'chromium'];
    if (!engine) throw new WraithError(`Unknown browser "${this.options.browser}". Use chromium, firefox or webkit.`);
    this.logger.debug(`Launching ${this.options.browser ?? 'chromium'}`);
    const browser = await engine.launch({ headless: this.options.headless ?? true, ...this.options.launch });
    try {
      const context = await browser.newContext(this.options.context);
      context.setDefaultTimeout(this.network.timeout);
      const blocked = new Set<string>(this.options.blockResources ?? []);
      if (blocked.size > 0) {
        await context.route('**/*', (route) =>
          blocked.has(route.request().resourceType()) ? route.abort() : route.fallback(),
        );
      }
      return { browser, context };
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }
}

/** Creates a Wraith. Nothing launches until the first browser page is opened. */
export function createWraith(options?: WraithOptions): Wraith {
  return new Wraith(options);
}
