import type { Frame, Page, Request } from 'playwright';
import { WaitTimeoutError } from './errors.js';
import { sleep } from './human/random.js';
import { pageActivity } from './in-page.js';

/**
 * What to wait for after a click, key press or select:
 * - 'navigation' (default): if the action started a page load, wait for the new page to load.
 * - 'settle': that, then `waitForSettled()` (network quiet, DOM quiet, no loaders).
 * - 'none': return as soon as the action is done.
 */
export type AfterAction = 'settle' | 'navigation' | 'none';

export interface SettleOptions {
  /** The page's own requests must have stopped for this long, in ms. Default 500. */
  networkIdleMs?: number;
  /** The page's content must have stopped changing for this long, in ms. Default 300. */
  domIdleMs?: number;
  /**
   * Selectors for loading indicators to wait on, added to the built-in ones (spinners, loaders,
   * skeletons, aria-busy, indeterminate progress bars). `false` skips loader checks.
   */
  loaders?: string[] | false;
  /** Give up after this long, in ms. Default 15000. Timing out is not an error; see the return value. */
  timeout?: number;
}

export interface ResolvedSettle {
  networkIdleMs: number;
  domIdleMs: number;
  loaders: string[];
  timeout: number;
}

/** Loading indicators recognised out of the box. */
export const DEFAULT_LOADERS: readonly string[] = [
  '[aria-busy="true"]',
  '[role="progressbar"]:not([aria-valuenow])',
  '[class*="spinner" i]',
  '[id*="spinner" i]',
  '[class*="loader" i]',
  '[id*="loader" i]',
  '[class*="loading" i]',
  '[id*="loading" i]',
  '[class*="skeleton" i]',
];

export function resolveSettle(options: SettleOptions = {}, base?: ResolvedSettle): ResolvedSettle {
  const loaders =
    options.loaders === false
      ? []
      : options.loaders === undefined
        ? (base?.loaders ?? [...DEFAULT_LOADERS])
        : [...(base?.loaders ?? DEFAULT_LOADERS), ...options.loaders];
  return {
    networkIdleMs: options.networkIdleMs ?? base?.networkIdleMs ?? 500,
    domIdleMs: options.domIdleMs ?? base?.domIdleMs ?? 300,
    loaders,
    timeout: options.timeout ?? base?.timeout ?? 15_000,
  };
}

/** Request types that mean the page is still fetching what it needs. Images, fonts and media don't count. */
export const TRACKED_TYPES = new Set(['document', 'xhr', 'fetch', 'script']);

/** Requests running longer than this (long polling, streams) stop counting as "busy". */
export const LONG_REQUEST_MS = 5000;

/** Counts the main frame's in-flight requests, to tell when the network has gone quiet. */
export class NetworkTracker {
  private readonly inflight = new Map<Request, number>();
  private lastActivity = Date.now();

  constructor(private readonly page: Page) {
    page.on('request', (request) => {
      if (!this.tracked(request)) return;
      this.inflight.set(request, Date.now());
      this.lastActivity = Date.now();
    });
    const finished = (request: Request) => {
      if (this.inflight.delete(request)) this.lastActivity = Date.now();
    };
    page.on('requestfinished', finished);
    page.on('requestfailed', finished);
  }

  /** How long the network has been quiet, in ms; 0 while a request is in flight. */
  quietFor(): number {
    const now = Date.now();
    for (const started of this.inflight.values()) {
      if (now - started < LONG_REQUEST_MS) return 0;
    }
    return now - this.lastActivity;
  }

  private tracked(request: Request): boolean {
    if (!TRACKED_TYPES.has(request.resourceType())) return false;
    try {
      // Only the page itself: ads and widgets in iframes poll forever.
      return request.frame() === this.page.mainFrame();
    } catch {
      return false; // Service worker requests have no frame.
    }
  }
}

const isNavigationError = (error: unknown) =>
  /Execution context was destroyed|Cannot find context|navigat|frame was detached/i.test(String((error as Error)?.message));

/**
 * Waits until the page has finished what it's doing: no requests in flight, content not
 * changing, no loading indicator showing. Returns false if that didn't happen within the timeout.
 */
export async function waitForSettled(page: Page, network: NetworkTracker, settle: ResolvedSettle): Promise<boolean> {
  const deadline = Date.now() + settle.timeout;
  for (;;) {
    if (page.isClosed()) return false;
    let activity: { domQuietFor: number; loading: boolean } | undefined;
    try {
      activity = await page.evaluate(pageActivity, settle.loaders);
    } catch (error) {
      if (page.isClosed()) return false;
      if (!isNavigationError(error)) throw error;
    }
    const quiet =
      activity !== undefined &&
      !activity.loading &&
      activity.domQuietFor >= settle.domIdleMs &&
      network.quietFor() >= settle.networkIdleMs;
    if (quiet) return true;
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
}

export interface ActionWatch {
  /** Call after the action: waits as the mode says, then stops watching. */
  done(): Promise<void>;
  /** Call if the action failed: stops watching without waiting. */
  cancel(): void;
}

/**
 * Starts watching before an action so that a page load it triggers can't slip past unnoticed,
 * however quickly it starts.
 */
export function watchAction(
  page: Page,
  network: NetworkTracker,
  mode: AfterAction,
  settle: ResolvedSettle,
  timeout: number,
): ActionWatch {
  if (mode === 'none') return { done: async () => {}, cancel: () => {} };
  const frame = page.mainFrame();
  let started = false;
  let committed = false;
  const onRequest = (request: Request) => {
    if (request.isNavigationRequest() && request.frame() === frame) started = true;
  };
  const onNavigated = (navigated: Frame) => {
    if (navigated === frame) committed = true;
  };
  page.on('request', onRequest);
  page.on('framenavigated', onNavigated);
  const stop = () => {
    page.off('request', onRequest);
    page.off('framenavigated', onNavigated);
  };

  return {
    cancel: stop,
    async done() {
      try {
        // Clicks and key presses can take a moment to kick off a navigation.
        await sleep(300);
        if (started && !committed) {
          await page.waitForEvent('framenavigated', { predicate: (f) => f === frame, timeout }).catch(() => {});
        }
        if (started) await page.waitForLoadState('load', { timeout }).catch(() => {});
      } finally {
        stop();
      }
      if (mode === 'settle') await waitForSettled(page, network, settle);
    },
  };
}

export interface WaitUntilOptions {
  /** Default 10000 ms. */
  timeout?: number;
  /** How often to check, in ms. Default 200. */
  interval?: number;
  /** Used in the timeout error. */
  message?: string;
}

/**
 * Calls `condition` until it returns something truthy, and returns that. Throws
 * WaitTimeoutError if it doesn't within the timeout.
 */
export async function waitUntil<T>(
  condition: () => T | Promise<T>,
  options: WaitUntilOptions = {},
): Promise<Exclude<Awaited<T>, false | null | undefined | 0 | ''>> {
  const { timeout = 10_000, interval = 200, message = 'Condition was not met' } = options;
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await condition();
    if (value) return value as Exclude<Awaited<T>, false | null | undefined | 0 | ''>;
    if (Date.now() >= deadline) throw new WaitTimeoutError(`${message} within ${timeout} ms`);
    await sleep(interval);
  }
}
