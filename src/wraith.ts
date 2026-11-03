import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import { AIClient } from './ai/client.js';
import {
  resolveAfterAction,
  resolveHuman,
  resolveInstances,
  resolveNetwork,
  type HumanOption,
  type ResolvedNetwork,
  type WraithOptions,
} from './config.js';
import { ConsentManager } from './consent.js';
import { runCrawl, type CrawlOptions, type CrawlResult } from './crawl.js';
import { HttpError, WraithError } from './errors.js';
import type { FieldSpec } from './extract/schema.js';
import { resolveHandoff, type ResolvedHandoff } from './handoff.js';
import type { HumanBehavior } from './human/behavior.js';
import { Humanizer } from './human/humanizer.js';
import { createRng } from './human/random.js';
import { resolveLogger, type Logger } from './logger.js';
import { createFetcher, redactProxy, resolveProxies, type Fetcher, type ProxySettings } from './net/proxy.js';
import { isRetryableStatus, Scheduler } from './net/scheduler.js';
import { resolveUserAgents } from './net/user-agents.js';
import { WraithPage, type GotoOptions } from './page.js';
import { StaticPage } from './static-page.js';
import { NetworkTracker, resolveSettle, type AfterAction, type ResolvedSettle } from './wait.js';

const ENGINES = { chromium, firefox, webkit };

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

export interface StaticPaginateOptions {
  /**
   * Where the next page is: a selector for the "Next" link (its href is followed), any FieldSpec
   * that yields a URL ('a[rel=next]@href', { text: 'Next', attr: 'href' }), or a function.
   * Pagination stops when it gives nothing, or a URL already visited.
   */
  next: FieldSpec | ((page: StaticPage) => string | null | undefined);
  /** Most pages to fetch, counting the first. Default 10. */
  maxPages?: number;
}

export interface NewPageOptions {
  /** Human behaviour for this page only, overriding the Wraith-wide setting. */
  human?: HumanOption;
  /** Which instance to open the page in, from 0. Default: the one with the fewest open pages. */
  instance?: number;
}

/** One independent browser session: a context (with its own cookies and proxy), opened on first use. */
interface Slot {
  index: number;
  proxy: ProxySettings | undefined;
  userAgent: string | undefined;
  /** Its own browser, with `separateBrowsers`. */
  browser: Promise<Browser> | undefined;
  context: Promise<BrowserContext> | undefined;
  live: BrowserContext | undefined;
  openPages: number;
}

/**
 * The entry point. Holds the browser and its sessions (launched lazily, on the first browser
 * page), the per-host rate limiter, and the AI client. Everything runs in your process.
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
  private readonly afterAction: AfterAction;
  private readonly settle: ResolvedSettle;
  private readonly handoff: ResolvedHandoff;
  private readonly consent: ConsentManager | undefined;
  /** How many independent sessions this Wraith runs. */
  readonly instanceCount: number;
  private readonly separateBrowsers: boolean;
  private readonly slots: Slot[];
  private readonly fetcher: Fetcher;
  private sharedBrowser: Promise<Browser> | undefined;
  private pageCount = 0;
  private nextSlot = 0;

  constructor(readonly options: WraithOptions = {}) {
    this.human = resolveHuman(options.human);
    this.network = resolveNetwork(options.network);
    this.logger = resolveLogger(options.logger);
    if (!ENGINES[options.browser ?? 'chromium']) {
      throw new WraithError(`Unknown browser "${options.browser}". Use chromium, firefox or webkit.`);
    }
    const proxies = resolveProxies(options.proxy);
    if (proxies.length > 0 && options.context?.proxy) {
      throw new WraithError('Set the proxy with either `proxy` or `context.proxy`, not both.');
    }
    if (options.userAgent !== undefined && options.context?.userAgent) {
      throw new WraithError('Set the user agent with either `userAgent` or `context.userAgent`, not both.');
    }
    if (options.userAgent !== undefined && options.network?.userAgent) {
      throw new WraithError('Set the user agent with either `userAgent` or `network.userAgent`, not both.');
    }
    const agents = resolveUserAgents(options.userAgent, options.browser ?? 'chromium');
    // A single user agent also names the crawler in robots.txt matching.
    if (agents.requests.length === 1 && options.userAgent !== 'rotate') this.network = { ...this.network, userAgent: agents.requests[0] };
    const instances = resolveInstances(options.instances, proxies);
    this.instanceCount = instances.count;
    this.separateBrowsers = instances.separateBrowsers;
    this.slots = Array.from({ length: instances.count }, (_, index) => ({
      index,
      proxy: proxies.length > 0 ? proxies[index % proxies.length] : undefined,
      userAgent: agents.browser.length > 0 ? agents.browser[index % agents.browser.length] : undefined,
      browser: undefined,
      context: undefined,
      live: undefined,
      openPages: 0,
    }));
    this.fetcher = createFetcher(proxies, agents.requests);
    this.scheduler = new Scheduler(this.network, this.logger, this.fetcher);
    this.aiClient = options.ai ? new AIClient(options.ai, this.logger) : undefined;
    this.afterAction = resolveAfterAction(options.waits?.afterAction);
    this.settle = resolveSettle(options.waits?.settle);
    this.handoff = resolveHandoff(options.handoff);
    this.consent = options.consent ? new ConsentManager(options.consent, this.logger) : undefined;
  }

  /** The AI client, for content you already have (`wraith.ai.extract(text, schema)`). Needs the `ai` option. */
  get ai(): AIClient {
    if (!this.aiClient) throw new WraithError('AI is not configured. Pass { ai: { provider: ... } } to createWraith().');
    return this.aiClient;
  }

  /** The Playwright browser context of an instance (default the first), launching the browser if needed. */
  async context(instance = 0): Promise<BrowserContext> {
    const slot = this.slot(instance);
    slot.context ??= this.createContext(slot);
    try {
      return await slot.context;
    } catch (error) {
      slot.context = undefined;
      throw error;
    }
  }

  /** Opens a new tab, in the least busy instance unless `instance` says which. */
  async newPage(options: NewPageOptions = {}): Promise<WraithPage> {
    const slot = options.instance === undefined ? this.leastBusy() : this.slot(options.instance);
    // Count the page before awaiting anything, so pages opened together spread across instances.
    slot.openPages++;
    let raw: Page;
    try {
      raw = await (await this.context(slot.index)).newPage();
    } catch (error) {
      slot.openPages--;
      throw error;
    }
    raw.once('close', () => {
      slot.openPages = Math.max(0, slot.openPages - 1);
    });
    // Each page gets its own random stream, so seeded runs stay reproducible with several tabs.
    const seed = this.options.seed === undefined ? undefined : this.options.seed + this.pageCount;
    this.pageCount++;
    const behavior = options.human === undefined ? this.human : resolveHuman(options.human);
    return new WraithPage(raw, {
      human: new Humanizer(raw, behavior, createRng(seed), this.network.timeout),
      scheduler: this.scheduler,
      network: new NetworkTracker(raw),
      timeout: this.network.timeout,
      afterAction: this.afterAction,
      settle: this.settle,
      handoff: this.handoff,
      headless: this.options.headless ?? true,
      consent: this.consent,
      ai: this.aiClient,
      instance: slot.index,
      avoidHoneypots: this.options.avoidHoneypots ?? false,
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
      const response = await this.fetcher.fetch(url, {
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
      return new StaticPage(response.url || url, response.status, response.headers, body, this.aiClient, {
        avoidHoneypots: this.options.avoidHoneypots ?? false,
      });
    });
  }

  /**
   * Visits pages breadth-first from `start`, calling `handler` on each, following links within
   * the limits you set. Failed pages are collected in `errors` rather than stopping the crawl.
   */
  /**
   * Follows "Next" links without a browser, yielding each page. Uses the same rate limit,
   * retries and robots.txt check as `fetch()`.
   *
   * ```ts
   * for await (const page of wraith.paginate(url, { next: 'li.next a' })) {
   *   quotes.push(...page.extract(schema).quotes);
   * }
   * ```
   */
  async *paginate(url: string, options: StaticPaginateOptions): AsyncGenerator<StaticPage> {
    const { next, maxPages = 10 } = options;
    // A bare selector means "the link's href".
    const field: FieldSpec | undefined =
      typeof next === 'function' ? undefined : typeof next === 'string' && !/@[\w:-]+$/.test(next) ? { selector: next, attr: 'href' } : next;
    const seen = new Set<string>();
    let current: string | null | undefined = url;
    for (let i = 0; i < maxPages && current && !seen.has(current); i++) {
      seen.add(current);
      const page = await this.fetch(current);
      yield page;
      const found = field ? page.extract({ next: field }).next : (next as (page: StaticPage) => string | null | undefined)(page);
      current = typeof found === 'string' && found ? new URL(found, page.url).href : null;
    }
  }

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

  /** Saves an instance's cookies and local storage to a file. Load it later with `{ context: { storageState: path } }`. */
  async saveSession(path: string, instance = 0): Promise<void> {
    await (await this.context(instance)).storageState({ path });
  }

  /** Closes every browser and session. Static fetches keep working afterwards; a new browser page relaunches. */
  async close(): Promise<void> {
    const contexts = this.slots.map((slot) => slot.context);
    const browsers = [this.sharedBrowser, ...this.slots.map((slot) => slot.browser)];
    this.sharedBrowser = undefined;
    for (const slot of this.slots) {
      slot.context = undefined;
      slot.browser = undefined;
      slot.live = undefined;
    }
    for (const pending of contexts) {
      const context = await pending?.catch(() => undefined);
      await context?.close().catch(() => {});
    }
    for (const pending of browsers) {
      const browser = await pending?.catch(() => undefined);
      await browser?.close().catch(() => {});
    }
    await this.fetcher.close();
  }

  private slot(instance: number): Slot {
    const slot = Number.isInteger(instance) ? this.slots[instance] : undefined;
    if (!slot) throw new WraithError(`instance must be a whole number from 0 to ${this.slots.length - 1}, not ${instance}`);
    return slot;
  }

  /** The instance with the fewest open pages, taking turns between equally busy ones. */
  private leastBusy(): Slot {
    let best = this.slots[this.nextSlot % this.slots.length]!;
    for (let i = 1; i < this.slots.length; i++) {
      const slot = this.slots[(this.nextSlot + i) % this.slots.length]!;
      if (slot.openPages < best.openPages) best = slot;
    }
    this.nextSlot = best.index + 1;
    return best;
  }

  private async createContext(slot: Slot): Promise<BrowserContext> {
    if (slot.proxy?.server.startsWith('socks5:') && slot.proxy.username !== undefined) {
      throw new WraithError(
        `Browsers can't log in to SOCKS proxies (${redactProxy(slot.proxy.server)}). Use an HTTP proxy for browser pages; ` +
          'SOCKS proxies with a password still work for static fetches.',
      );
    }
    const browser = await this.browserFor(slot);
    const context = await browser.newContext({
      ...this.options.context,
      ...(slot.proxy ? { proxy: slot.proxy } : {}),
      ...(slot.userAgent ? { userAgent: slot.userAgent } : {}),
    });
    try {
      context.setDefaultTimeout(this.network.timeout);
      const blocked = new Set<string>(this.options.blockResources ?? []);
      if (blocked.size > 0) {
        await context.route('**/*', (route) =>
          blocked.has(route.request().resourceType()) ? route.abort() : route.fallback(),
        );
      }
      await this.consent?.install(context);
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }
    if (slot.proxy) this.logger.debug(`Instance ${slot.index} uses proxy ${slot.proxy.server}`);
    slot.live = context;
    // If the context closes (or its browser crashes), start a fresh one next time.
    context.once('close', () => {
      if (slot.live !== context) return;
      slot.live = undefined;
      slot.context = undefined;
    });
    return context;
  }

  private browserFor(slot: Slot): Promise<Browser> {
    // Each launch forgets only itself, so an old browser going away can't drop a newer one.
    if (this.separateBrowsers) {
      if (!slot.browser) {
        const launch: Promise<Browser> = this.launchBrowser(() => {
          if (slot.browser === launch) slot.browser = undefined;
        });
        slot.browser = launch;
      }
      return slot.browser;
    }
    if (!this.sharedBrowser) {
      const launch: Promise<Browser> = this.launchBrowser(() => {
        if (this.sharedBrowser === launch) this.sharedBrowser = undefined;
      });
      this.sharedBrowser = launch;
    }
    return this.sharedBrowser;
  }

  /** Launches a browser; `forget` drops it from its slot if the launch fails or the browser goes away. */
  private async launchBrowser(forget: () => void): Promise<Browser> {
    const name = this.options.browser ?? 'chromium';
    const engine = ENGINES[name];
    this.logger.debug(`Launching ${name}`);
    try {
      const browser = await engine.launch({ headless: this.options.headless ?? true, ...this.options.launch });
      browser.once('disconnected', forget);
      return browser;
    } catch (error) {
      forget();
      throw error;
    }
  }
}

/** Creates a Wraith. Nothing launches until the first browser page is opened. */
export function createWraith(options?: WraithOptions): Wraith {
  return new Wraith(options);
}
