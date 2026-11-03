import { load } from 'cheerio';
import type { Locator, Page, Response } from 'playwright';
import { PageAI } from './ai/act.js';
import type { AIClient } from './ai/client.js';
import { HttpError, WraithError } from './errors.js';
import { extractLinks, htmlToMarkdown, htmlToText } from './extract/content.js';
import { documentBaseUrl, extractWithSchema, type InferSchema, type SelectorSchema } from './extract/schema.js';
import { Humanizer, type ClickOptions, type TypeOptions } from './human/humanizer.js';
import { sleep, type Range } from './human/random.js';
import { isRetryableStatus, type Scheduler } from './net/scheduler.js';

/** A CSS/Playwright selector string, or a Playwright Locator. */
export type Target = string | Locator;

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
  timeout: number;
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
    return this.services.scheduler.run(url, async () => {
      const response = await this.raw.goto(url, {
        waitUntil: options.waitUntil ?? 'load',
        timeout: options.timeout ?? this.services.timeout,
      });
      if (response && isRetryableStatus(response.status())) throw new HttpError(response.status(), url);
      return response;
    });
  }

  click(target: Target, options?: ClickOptions): Promise<void> {
    return this.human.click(this.locate(target), options);
  }

  dblclick(target: Target, options?: Omit<ClickOptions, 'clickCount'>): Promise<void> {
    return this.human.click(this.locate(target), { ...options, clickCount: 2 });
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
    await this.human.press(key);
  }

  /** Chooses options in a <select> by value or visible label. */
  select(target: Target, values: string | string[], options?: { timeout?: number }): Promise<void> {
    return this.human.select(this.locate(target), values, options);
  }

  /** Ticks (or with `checked: false`, unticks) a checkbox or radio, clicking only if it needs to change. */
  async check(target: Target, checked = true, options?: { timeout?: number }): Promise<void> {
    const locator = this.locate(target);
    if ((await locator.isChecked(options)) !== checked) await this.human.click(locator, options);
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

  /** Waits a fixed time, or a random time from a [min, max] range. */
  async wait(time: number | Range): Promise<void> {
    await sleep(typeof time === 'number' ? time : this.human.rng.inRange(time));
  }

  /** Waits for an element to reach a state (default: visible). */
  async waitFor(
    target: Target,
    options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number },
  ): Promise<void> {
    await this.locate(target).waitFor(options);
  }

  /** Pulls values out of the current DOM with CSS selectors. See SelectorSchema for the format. */
  async extract<const S extends SelectorSchema>(schema: S): Promise<InferSchema<S>> {
    const $ = load(await this.raw.content());
    return extractWithSchema($, schema, documentBaseUrl($, this.raw.url()));
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

  /** AI extraction, questions, and plain-language actions on this page. Needs the `ai` option. */
  get ai(): PageAI {
    const client = this.services.ai;
    if (!client) throw new WraithError('AI is not configured. Pass { ai: { provider: ... } } to createWraith().');
    this.aiHelper ??= new PageAI(
      client,
      async (selector) => ({ url: this.raw.url(), markdown: await this.markdown(selector) }),
      this.raw,
      this.human,
    );
    return this.aiHelper;
  }

  close(): Promise<void> {
    return this.raw.close();
  }

  private locate(target: Target): Locator {
    return typeof target === 'string' ? this.raw.locator(target).first() : target;
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
