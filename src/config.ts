import type { BrowserContextOptions, LaunchOptions } from 'playwright';
import type { AIOptions } from './ai/types.js';
import { WraithError } from './errors.js';
import { humanPresets, type HumanBehavior, type HumanPreset } from './human/behavior.js';
import type { Range } from './human/random.js';
import type { ConsentChoice } from './consent.js';
import type { HandoffOptions } from './handoff.js';
import type { Logger } from './logger.js';
import type { AfterAction, SettleOptions } from './wait.js';

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * `true` means 'natural' and `false` means 'off'. Or name a preset, or give a preset plus
 * overrides: `{ preset: 'fast', typing: { typoChance: 0.05 } }`.
 */
export type HumanOption = boolean | HumanPreset | (DeepPartial<HumanBehavior> & { preset?: HumanPreset });

export interface RateLimitOptions {
  /** Requests in flight to one host at a time. Default 2. */
  concurrency?: number;
  /** At most this many requests per host in each `intervalMs`. Default 4. */
  maxRequests?: number;
  /** Default 1000. */
  intervalMs?: number;
}

export interface NetworkOptions {
  /** Navigation and request timeout in ms. Default 30000. */
  timeout?: number;
  /** Retries for network errors, timeouts, and 408/425/429/5xx responses. Default 2. */
  retries?: number;
  /** Per-host limits so a site is never hammered. `false` turns them off. */
  rateLimit?: false | RateLimitOptions;
  /**
   * Check robots.txt before each request and throw RobotsDisallowedError for disallowed URLs.
   * A Crawl-delay in the file replaces the rate limit for that host. Default false.
   */
  respectRobotsTxt?: boolean;
  /** User agent for static fetches and robots.txt matching. Browser pages use `context.userAgent`. */
  userAgent?: string;
  /** Extra headers for static fetches. */
  headers?: Record<string, string>;
}

export type ResourceType = 'image' | 'media' | 'font' | 'stylesheet';

export interface WraithOptions {
  /** Browser engine. Default 'chromium'. */
  browser?: 'chromium' | 'firefox' | 'webkit';
  /** Default true. */
  headless?: boolean;
  /** Passed to Playwright's `browserType.launch()`. */
  launch?: LaunchOptions;
  /** Passed to Playwright's `browser.newContext()`: viewport, userAgent, locale, timezoneId, proxy, storageState… */
  context?: BrowserContextOptions;
  /** Don't download these resource types in browser pages. Saves time and bandwidth when scraping. */
  blockResources?: ResourceType[];
  /** How human browser input looks. Default 'natural'. */
  human?: HumanOption;
  /** Turns on `page.ai` and `wraith.ai`. */
  ai?: AIOptions;
  network?: NetworkOptions;
  /** Seed for every random choice, so a run can be reproduced exactly. */
  seed?: number;
  /** `true` logs to the console. Default: silent unless the WRAITH_DEBUG environment variable is set. */
  logger?: Logger | boolean;
  /** What actions wait for, and the defaults for `page.waitForSettled()`. */
  waits?: WaitOptions;
  /**
   * Answer cookie and consent banners automatically on every page: 'reject' refuses
   * non-essential cookies, 'accept' accepts them. Default false (banners are left alone).
   */
  consent?: false | ConsentChoice;
  /** Handing CAPTCHAs and one-time-code prompts to a person. */
  handoff?: HandoffOptions;
}

export interface WaitOptions {
  /**
   * What to wait for after each click, key press and select. 'navigation' (default) waits for any
   * page load the action starts; 'settle' also waits for the page to go quiet; 'none' doesn't wait.
   */
  afterAction?: AfterAction;
  /** Defaults for `page.waitForSettled()` and 'settle'. */
  settle?: SettleOptions;
}

export function resolveAfterAction(value: AfterAction | undefined): AfterAction {
  const mode = value ?? 'navigation';
  if (!['settle', 'navigation', 'none'].includes(mode)) {
    throw new WraithError(`waits.afterAction must be 'settle', 'navigation' or 'none', not ${JSON.stringify(value)}`);
  }
  return mode;
}

export interface ResolvedNetwork {
  timeout: number;
  retries: number;
  rateLimit: false | Required<RateLimitOptions>;
  respectRobotsTxt: boolean;
  userAgent: string | undefined;
  headers: Record<string, string>;
}

export function resolveNetwork(options: NetworkOptions = {}): ResolvedNetwork {
  const rateLimit =
    options.rateLimit === false
      ? false
      : { concurrency: 2, maxRequests: 4, intervalMs: 1000, ...withoutUndefined(options.rateLimit ?? {}) };
  if (rateLimit) {
    for (const [key, value] of Object.entries(rateLimit)) {
      if (!Number.isFinite(value) || value < 1) throw new WraithError(`network.rateLimit.${key} must be a number >= 1`);
    }
  }
  const timeout = options.timeout ?? 30_000;
  const retries = options.retries ?? 2;
  if (!(timeout > 0)) throw new WraithError('network.timeout must be greater than 0');
  if (!Number.isInteger(retries) || retries < 0) throw new WraithError('network.retries must be a whole number >= 0');
  return {
    timeout,
    retries,
    rateLimit,
    respectRobotsTxt: options.respectRobotsTxt ?? false,
    userAgent: options.userAgent,
    headers: options.headers ?? {},
  };
}

export function resolveHuman(option: HumanOption | undefined): HumanBehavior {
  if (option === undefined || option === true) return structuredClone(humanPresets.natural);
  if (option === false) return structuredClone(humanPresets.off);
  if (typeof option === 'string') return structuredClone(preset(option));
  const { preset: name = 'natural', ...overrides } = option;
  const behavior = deepMerge(structuredClone(preset(name)), overrides);
  validateHuman(behavior);
  return behavior;
}

function preset(name: string): HumanBehavior {
  if (!Object.hasOwn(humanPresets, name)) {
    throw new WraithError(`Unknown human preset "${name}". Use one of: ${Object.keys(humanPresets).join(', ')}`);
  }
  return humanPresets[name as HumanPreset];
}

function validateHuman(b: HumanBehavior): void {
  const ranges: Record<string, Range> = {
    actionDelay: b.actionDelay,
    'mouse.hoverDelay': b.mouse.hoverDelay,
    'mouse.clickHold': b.mouse.clickHold,
    'typing.keyDelay': b.typing.keyDelay,
    'typing.wordPause': b.typing.wordPause,
    'scroll.stepDelay': b.scroll.stepDelay,
  };
  for (const [name, range] of Object.entries(ranges)) checkRange(name, range, 0);
  checkRange('scroll.step', b.scroll.step, 1);
  checkRange('reading.wordsPerMinute', b.reading.wordsPerMinute, 1);
  for (const [name, p] of Object.entries({
    'mouse.overshootChance': b.mouse.overshootChance,
    'typing.typoChance': b.typing.typoChance,
  })) {
    if (!(p >= 0 && p <= 1)) throw new WraithError(`human.${name} must be between 0 and 1`);
  }
  if (!(b.mouse.speed > 0)) throw new WraithError('human.mouse.speed must be greater than 0');
}

function checkRange(name: string, range: Range, min: number): void {
  const ok = Array.isArray(range) && range.length === 2 && range[0] >= min && range[1] >= range[0];
  if (!ok) throw new WraithError(`human.${name} must be [min, max] with ${min} <= min <= max`);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Merges `overrides` into `base`. Objects merge key by key; arrays (ranges) and other values replace. */
function deepMerge<T>(base: T, overrides: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(overrides)) return (overrides === undefined ? base : overrides) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) out[key] = deepMerge(base[key], value);
  }
  return out as T;
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
