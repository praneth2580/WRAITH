import { load } from 'cheerio';
import type { Locator, Page, Response } from 'playwright';
import { PageAI } from './ai/act.js';
import type { AIClient } from './ai/client.js';
import { JsonCapture, type ResponseMatcher } from './capture.js';
import type { ConsentManager, ConsentStatus } from './consent.js';
import { HttpError, WraithError } from './errors.js';
import { extractLinks, htmlToMarkdown, htmlToText } from './extract/content.js';
import { documentBaseUrl, extractWithSchema, type InferSchema, type SelectorSchema } from './extract/schema.js';
import { APP_STATE_GLOBALS, structuredDataFromHtml, type StructuredData } from './extract/structured.js';
import { captureChallenge, findChallenge, runHandoff, type Challenge, type HandoffOptions, type ResolvedHandoff } from './handoff.js';
import { Humanizer, type ClickOptions, type TypeOptions } from './human/humanizer.js';
import { sleep, type Range } from './human/random.js';
import { readAppState } from './in-page.js';
import { isRetryableStatus, type Scheduler } from './net/scheduler.js';
import { paginate, type PaginateOptions } from './paginate.js';
import { resolveTarget, type Target } from './target.js';
import {
  resolveSettle,
  waitForSettled,
  waitUntil,
  watchAction,
  type ActionWatch,
  type AfterAction,
  type NetworkTracker,
  type ResolvedSettle,
  type SettleOptions,
  type WaitUntilOptions,
} from './wait.js';

export type { Target };

export interface GotoOptions {
  /** When navigation counts as finished. Default 'load'. */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  timeout?: number;
}

export interface ScrollOptions {
  /** Scroll by this many pixels (negative is up). */
  by?: number;
  /** Scroll to the top or bottom of the page, or to an element. */
  to?: 'top' | 'bottom' | Target;
}

export interface AutoScrollOptions {
  /** Stop after this many scrolls. Default 20. */
  maxScrolls?: number;
  /** How long to wait for new content after each scroll, in ms. Default 2000. */
  idleMs?: number;
}

export interface ReadOptions {
  /** Upper bound on time spent, in ms. Default 20000. */
  maxMs?: number;
}

/** @internal What a page needs from the Wraith that created it. */
export interface PageServices {
  human: Humanizer;
  scheduler: Scheduler;
  network: NetworkTracker;
  timeout: number;
  afterAction: AfterAction;
  settle: ResolvedSettle;
  handoff: ResolvedHandoff;
  headless: boolean;
  consent: ConsentManager | undefined;
  ai: AIClient | undefined;
}

/**
 * A browser tab with human-like input. Every action goes through the page's Humanizer, so
 * delays, mouse paths and typing follow the `human` settings. `raw` is the Playwright Page,
 * for anything not covered here.
 */
export class WraithPage {
  readonly human: Humanizer;
  private aiHelper: PageAI | undefined;
  private handingOff = false;

  constructor(
    readonly raw: Page,
    private readonly services: PageServices,
  ) {
    this.human = services.human;
  }

  url(): string {
    return this.raw.url();
  }

  title(): Promise<string> {
    return this.raw.title();
  }

  /**
   * Navigates to `url`, respecting robots.txt (if enabled) and the per-host rate limit, and
   * retrying timeouts, network errors and 408/425/429/5xx responses.
   */
  async goto(url: string, options: GotoOptions = {}): Promise<Response | null> {
    const response = await this.services.scheduler.run(url, async () => {
      const res = await this.raw.goto(url, {
        waitUntil: options.waitUntil ?? 'load',
        timeout: options.timeout ?? this.services.timeout,
      });
      if (res && isRetryableStatus(res.status())) throw new HttpError(res.status(), url);
      return res;
    });
    if (this.services.afterAction === 'settle') await this.waitForSettled();
    await this.autoHandoff();
    return response;
  }

  // ---- Actions ---------------------------------------------------------------------------

  /** Clicks once the target is visible, enabled, still and uncovered, then waits as `waits.afterAction` says. */
  click(target: Target, options?: ClickOptions): Promise<void> {
    return this.perform(() => this.human.click(this.locate(target), options));
  }

  dblclick(target: Target, options?: Omit<ClickOptions, 'clickCount'>): Promise<void> {
    return this.perform(() => this.human.click(this.locate(target), { ...options, clickCount: 2 }));
  }

  hover(target: Target, options?: { timeout?: number }): Promise<void> {
    return this.human.hover(this.locate(target), options);
  }

  /** Types into a field key by key. Replaces the current value unless `clear: false`. */
  type(target: Target, text: string, options?: TypeOptions): Promise<void> {
    return this.human.type(this.locate(target), text, options);
  }

  /** Sets a field's value instantly, with no typing. For when speed matters more than looking human. */
  fill(target: Target, value: string, options?: { timeout?: number }): Promise<void> {
    return this.locate(target).fill(value, options);
  }

  /** Presses a key or chord ("Enter", "ControlOrMeta+A"), on `target` if given, else on whatever has focus. */
  async press(key: string, options: { target?: Target; timeout?: number } = {}): Promise<void> {
    if (options.target) await this.locate(options.target).focus({ timeout: options.timeout });
    await this.perform(() => this.human.press(key));
  }

  /** Chooses options in a <select> by value or visible label. */
  select(target: Target, values: string | string[], options?: { timeout?: number }): Promise<void> {
    return this.perform(() => this.human.select(this.locate(target), values, options));
  }

  /** Ticks (or with `checked: false`, unticks) a checkbox or radio, clicking only if it needs to change. */
  async check(target: Target, checked = true, options?: { timeout?: number }): Promise<void> {
    const locator = this.locate(target);
    if ((await locator.isChecked(options)) !== checked) await this.perform(() => this.human.click(locator, options));
  }

  async scroll(options: ScrollOptions): Promise<void> {
    if (options.by !== undefined) return this.human.scrollBy(options.by);
    if (options.to === 'top') return this.human.scrollBy(-(await this.scrollPosition()).y);
    if (options.to === 'bottom') {
      const { y, max } = await this.scrollPosition();
      return this.human.scrollBy(max - y);
    }
    if (options.to !== undefined) return this.human.scrollIntoView(this.locate(options.to));
  }

  /**
   * Keeps scrolling to the bottom while the page keeps growing, for infinite feeds. Returns the
   * number of scrolls made.
   */
  async autoScroll(options: AutoScrollOptions = {}): Promise<number> {
    const { maxScrolls = 20, idleMs = 2000 } = options;
    let height = await this.scrollHeight();
    let stalls = 0;
    for (let i = 1; i <= maxScrolls; i++) {
      await this.scroll({ to: 'bottom' });
      await this.raw
        .waitForFunction((previous) => document.documentElement.scrollHeight > previous, height, { timeout: idleMs })
        .catch(() => {});
      const next = await this.scrollHeight();
      // Two scrolls in a row without growth means the feed has ended.
      stalls = next > height ? 0 : stalls + 1;
      height = next;
      if (stalls >= 2) return i;
    }
    return maxScrolls;
  }

  /**
   * Goes through a paginated listing, yielding 1, 2, 3… once each page (or batch) is loaded and
   * settled. Stops when the control is gone or disabled, nothing changes, or `maxPages` is reached.
   *
   * ```ts
   * for await (const n of page.paginate({ next: { role: 'link', name: 'Next' } })) {
   *   rows.push(...(await page.extract(schema)).rows);
   * }
   * ```
   */
  paginate(options: PaginateOptions): AsyncGenerator<number> {
    return paginate(
      {
        raw: this.raw,
        locate: (target) => this.locate(target),
        click: (target) => this.click(target),
        scrollToBottom: () => this.scroll({ to: 'bottom' }),
        settle: async () => {
          await this.waitForSettled();
        },
      },
      options,
    );
  }

  /**
   * Scrolls through the page at reading speed, pausing and drifting the mouse as a reader would.
   * Takes as long as the text would take to read, up to `maxMs`. Does nothing when humanizing is off.
   */
  async read(options: ReadOptions = {}): Promise<void> {
    if (!this.human.enabled) return;
    const { maxMs = 20_000 } = options;
    const rng = this.human.rng;
    const { words, viewport } = await this.raw.evaluate(() => ({
      words: document.body?.innerText.split(/\s+/).filter(Boolean).length ?? 0,
      viewport: window.innerHeight,
    }));
    const wpm = rng.inRange(this.human.behavior.reading.wordsPerMinute);
    const deadline = Date.now() + Math.min(maxMs, (words / wpm) * 60_000);
    const { y, max } = await this.scrollPosition();
    const chunks = Math.max(1, Math.ceil((max - y) / (viewport * 0.6)));
    for (let i = 0; i < chunks && Date.now() < deadline; i++) {
      const left = deadline - Date.now();
      await sleep(Math.min(left, (left / (chunks - i + 1)) * rng.float(0.6, 1.4)));
      if (rng.chance(0.3)) await this.human.fidget();
      await this.human.scrollBy((max - y) / chunks);
    }
    await sleep(deadline - Date.now());
  }

  // ---- Waiting ---------------------------------------------------------------------------

  /** Waits a fixed time, or a random time from a [min, max] range. */
  async wait(time: number | Range): Promise<void> {
    await sleep(typeof time === 'number' ? time : this.human.rng.inRange(time));
  }

  /** Waits for an element to reach a state (default: visible). `state: 'hidden'` waits for a loader to go. */
  async waitFor(
    target: Target,
    options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number },
  ): Promise<void> {
    await this.locate(target).waitFor(options);
  }

  /**
   * Waits until the page has finished what it's doing: its requests done, its content no longer
   * changing, and no spinner, loader or skeleton showing. Returns false if that didn't happen
   * within the timeout (some pages never go fully quiet), rather than throwing.
   */
  waitForSettled(options?: SettleOptions): Promise<boolean> {
    return waitForSettled(this.raw, this.services.network, resolveSettle(options, this.services.settle));
  }

  /** Waits for text to appear on the page (or inside `within`). Strings match as case-insensitive substrings. */
  async waitForText(text: string | RegExp, options: { within?: Target; timeout?: number } = {}): Promise<void> {
    const scope = options.within ? this.locate(options.within) : this.raw;
    await scope.getByText(text).first().waitFor({ state: 'visible', timeout: options.timeout });
  }

  /** Waits for the URL to match: a glob like '**\/dashboard', a RegExp, or a predicate. */
  async waitForUrl(url: string | RegExp | ((url: URL) => boolean), options: { timeout?: number } = {}): Promise<void> {
    await this.raw.waitForURL(url, { timeout: options.timeout ?? this.services.timeout });
  }

  /**
   * Polls `condition` until it returns something truthy, and returns that.
   * `await page.waitUntil(async () => (await page.text('.status')) === 'Ready')`
   */
  waitUntil<T>(condition: () => T | Promise<T>, options?: WaitUntilOptions) {
    return waitUntil(condition, options);
  }

  // ---- Reading ---------------------------------------------------------------------------

  /** Pulls values out of the current DOM with CSS selectors or text. See SelectorSchema for the format. */
  async extract<const S extends SelectorSchema>(schema: S): Promise<InferSchema<S>> {
    const $ = load(await this.raw.content());
    return extractWithSchema($, schema, documentBaseUrl($, this.raw.url()));
  }

  /**
   * The page's machine-readable data: JSON-LD, microdata, OpenGraph and meta tags, embedded JSON,
   * and app state frameworks leave on `window`. Survives redesigns and generated class names.
   */
  async structuredData(): Promise<StructuredData> {
    const $ = load(await this.raw.content());
    const data = structuredDataFromHtml($, documentBaseUrl($, this.raw.url()));
    const appState = await this.raw.evaluate(readAppState, APP_STATE_GLOBALS).catch(() => ({}));
    data.embedded = { ...data.embedded, ...appState };
    return data;
  }

  /**
   * Starts collecting the JSON this page loads from its own API. Call it before the navigation or
   * action that makes the requests.
   *
   * ```ts
   * const products = page.captureJson('/api/products');
   * await page.goto(url);
   * await products.waitFor(1);
   * console.log(products.data);
   * ```
   */
  captureJson<T = unknown>(match: ResponseMatcher): JsonCapture<T> {
    return new JsonCapture<T>(this.raw, match);
  }

  /** The current HTML of the whole page, or the outer HTML of the first match of `selector`. */
  async html(selector?: string): Promise<string> {
    if (!selector) return this.raw.content();
    return this.raw.locator(selector).first().evaluate((el) => el.outerHTML);
  }

  async text(selector?: string): Promise<string> {
    return htmlToText(await this.raw.content(), selector);
  }

  /** The page (or the part under `selector`) as clean Markdown. */
  async markdown(selector?: string): Promise<string> {
    const html = await this.raw.content();
    return htmlToMarkdown(html, { selector, baseUrl: documentBaseUrl(load(html), this.raw.url()) });
  }

  /** Every http(s) link on the page, absolute and de-duplicated. */
  async links(): Promise<string[]> {
    const $ = load(await this.raw.content());
    return extractLinks($, documentBaseUrl($, this.raw.url()) ?? this.raw.url());
  }

  screenshot(options?: Parameters<Page['screenshot']>[0]): Promise<Buffer> {
    return this.raw.screenshot(options);
  }

  // ---- Consent banners -------------------------------------------------------------------

  /** What happened with this page's consent banner. Needs the `consent` option. */
  consentStatus(): ConsentStatus {
    return this.consentManager().statusOf(this.raw);
  }

  /**
   * Waits until this page's consent banner has been dealt with, or `timeout` (default 5000 ms)
   * passes, which is normal on pages without a banner. Needs the `consent` option.
   */
  waitForConsent(options: { timeout?: number } = {}): Promise<ConsentStatus> {
    return this.consentManager().waitFor(this.raw, options.timeout ?? 5000);
  }

  // ---- CAPTCHAs and verification codes ---------------------------------------------------

  /**
   * Looks for a CAPTCHA, browser check or one-time-code prompt and returns it with a PNG of the
   * challenge, without doing anything about it. Null if there isn't one. Use this to show the
   * challenge to a person your own way, or call `handoff()` to have wraith manage it.
   */
  async detectChallenge(): Promise<Challenge | null> {
    const found = await findChallenge(this.raw);
    return found ? captureChallenge(this.raw, found) : null;
  }

  /**
   * If a challenge is showing, gets a person through it: their answer is typed in and submitted,
   * or wraith waits while they solve it in the browser window. Returns the challenge, or null if
   * there was none. See the `handoff` option for who is asked and how.
   */
  async handoff(options: HandoffOptions = {}): Promise<Challenge | null> {
    const settings = { ...this.services.handoff, ...withoutUndefined(options) };
    this.handingOff = true;
    try {
      return await runHandoff(
        {
          raw: this.raw,
          headless: this.services.headless,
          typeAnswer: async (answer, submit) => {
            const field = this.raw.locator('[data-wraith-answer]').first();
            await this.human.type(field, answer, { typos: false });
            if (!submit) return;
            const watch = this.watch('settle');
            await this.human.press('Enter');
            await watch.done();
          },
        },
        settings,
      );
    } finally {
      this.handingOff = false;
    }
  }

  // ---- AI --------------------------------------------------------------------------------

  /** AI extraction, questions, and plain-language actions on this page. Needs the `ai` option. */
  get ai(): PageAI {
    const client = this.services.ai;
    if (!client) throw new WraithError('AI is not configured. Pass { ai: { provider: ... } } to createWraith().');
    this.aiHelper ??= new PageAI(
      client,
      async (selector) => ({ url: this.raw.url(), markdown: await this.markdown(selector) }),
      this.raw,
      this.human,
      // act() always needs page loads finished before it looks again, even with afterAction 'none'.
      () => this.watchWithHandoff(this.services.afterAction === 'none' ? 'navigation' : this.services.afterAction),
    );
    return this.aiHelper;
  }

  close(): Promise<void> {
    return this.raw.close();
  }

  // ---- Internals -------------------------------------------------------------------------

  private locate(target: Target): Locator {
    return resolveTarget(this.raw, target);
  }

  /** Runs an action, then waits as `waits.afterAction` says and hands off any challenge if `handoff.auto`. */
  private async perform(action: () => Promise<void>): Promise<void> {
    const watch = this.watchWithHandoff(this.services.afterAction);
    try {
      await action();
    } catch (error) {
      watch.cancel();
      throw error;
    }
    await watch.done();
  }

  private watch(mode: AfterAction): ActionWatch {
    return watchAction(this.raw, this.services.network, mode, this.services.settle, this.services.timeout);
  }

  private watchWithHandoff(mode: AfterAction): ActionWatch {
    const watch = this.watch(mode);
    return {
      cancel: () => watch.cancel(),
      done: async () => {
        await watch.done();
        await this.autoHandoff();
      },
    };
  }

  private async autoHandoff(): Promise<void> {
    if (this.services.handoff.auto && !this.handingOff && !this.raw.isClosed()) await this.handoff();
  }

  private consentManager(): ConsentManager {
    const manager = this.services.consent;
    if (!manager) throw new WraithError("Consent handling is off. Pass { consent: 'reject' } (or 'accept') to createWraith().");
    return manager;
  }

  private async scrollHeight(): Promise<number> {
    return this.raw.evaluate(() => document.documentElement.scrollHeight);
  }

  private async scrollPosition(): Promise<{ y: number; max: number }> {
    return this.raw.evaluate(() => ({
      y: window.scrollY,
      max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    }));
  }
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
