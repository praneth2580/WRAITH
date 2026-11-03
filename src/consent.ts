import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { BrowserContext, Frame, Page } from 'playwright';
import { WraithError } from './errors.js';
import { clickConsentAccept } from './in-page.js';
import type { Logger } from './logger.js';

/**
 * How to answer cookie and consent banners:
 * - 'reject': refuse non-essential cookies. Banners with only an Accept button are left alone,
 *   though an "OK"/"Got it" acknowledgement is clicked.
 * - 'accept': accept them.
 */
export type ConsentChoice = 'reject' | 'accept';

export interface ConsentStatus {
  /** The consent platform found (such as "onetrust" or "HEURISTIC"), or null if none yet. */
  cmp: string | null;
  /** True once the banner has been dealt with. */
  done: boolean;
  /** Whether the reject or accept steps succeeded, once they've run. */
  succeeded: boolean | null;
  /** True if the banner was only hidden with CSS, without recording a choice. */
  hiddenOnly: boolean;
}

// The autoconsent message protocol, as used by its own Playwright runner (playwright/runner.ts).
type ContentMessage =
  | { type: 'init'; url: string }
  | { type: 'eval'; id: string; code: string }
  | { type: 'cmpDetected' | 'popupFound'; cmp: string; url: string }
  | { type: 'optOutResult' | 'optInResult'; cmp: string; result: boolean; url: string }
  | { type: 'autoconsentDone'; cmp: string; isCosmetic: boolean; url: string }
  | { type: 'autoconsentError'; details: unknown }
  | { type: string };

interface AutoconsentModule {
  filterCompactRules(rules: unknown, context: { url: string; mainFrame: boolean }): unknown;
}

// How long after a page loads to try accepting a custom banner ourselves, if autoconsent hasn't
// handled one by then.
const ACCEPT_FALLBACK_DELAY_MS = 2500;

/**
 * Answers consent banners on every page and frame of a browser context, using DuckDuckGo's
 * autoconsent rules (hundreds of consent platforms, plus a heuristic for custom banners).
 */
export class ConsentManager {
  private readonly status = new WeakMap<Page, ConsentStatus>();
  private readonly waiters = new WeakMap<Page, Set<() => void>>();

  constructor(
    private readonly choice: ConsentChoice,
    private readonly logger: Logger,
  ) {
    if (choice !== 'reject' && choice !== 'accept') {
      throw new WraithError(`consent must be 'reject', 'accept' or false, not ${JSON.stringify(choice)}`);
    }
  }

  async install(context: BrowserContext): Promise<void> {
    const require = createRequire(import.meta.url);
    // The Playwright build isn't in the package's exports map, so find it next to the main entry.
    const dist = dirname(require.resolve('@duckduckgo/autoconsent'));
    const script = readFileSync(join(dist, 'autoconsent.playwright.js'), 'utf8');
    const autoconsent = (await import('@duckduckgo/autoconsent')) as unknown as AutoconsentModule;
    // Reject uses the compact rules, filtered per frame. Accept needs the full rules, since the
    // compact ones leave out opt-in steps.
    const compact = this.choice === 'reject' ? require('@duckduckgo/autoconsent/rules/compact-rules.json') : undefined;
    const full = this.choice === 'accept' ? require('@duckduckgo/autoconsent/rules/rules.json') : undefined;

    const rulesFor = (url: string, mainFrame: boolean) =>
      compact ? { compact: autoconsent.filterCompactRules(compact, { url, mainFrame }) } : { autoconsent: full.autoconsent };

    await context.exposeBinding('autoconsentSendMessage', ({ frame, page }: { frame: Frame; page: Page }, message: ContentMessage) =>
      this.onMessage(frame, page, message, rulesFor),
    );
    await context.addInitScript({ content: script });
    if (this.choice === 'accept') {
      context.on('page', (page) => this.watchForCustomBanners(page));
      for (const page of context.pages()) this.watchForCustomBanners(page);
    }
  }

  statusOf(page: Page): ConsentStatus {
    return { ...this.state(page) };
  }

  /** Waits until a banner on `page` has been dealt with, or `timeout` passes. Returns the status either way. */
  async waitFor(page: Page, timeout: number): Promise<ConsentStatus> {
    if (this.state(page).done) return this.statusOf(page);
    await new Promise<void>((resolve) => {
      const listeners = this.waiters.get(page) ?? new Set<() => void>();
      this.waiters.set(page, listeners);
      const finish = () => {
        clearTimeout(timer);
        listeners.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, timeout);
      listeners.add(finish);
    });
    return this.statusOf(page);
  }

  /**
   * autoconsent's heuristic for custom banners only rejects; for 'accept', click the banner's
   * accept button ourselves when no consent platform was handled soon after load.
   */
  private watchForCustomBanners(page: Page): void {
    page.on('load', () => {
      setTimeout(async () => {
        if (page.isClosed() || this.state(page).done) return;
        const clicked = await page.evaluate(clickConsentAccept).catch(() => false);
        if (!clicked || this.state(page).done) return;
        this.finish(page, { cmp: 'heuristic', done: true, succeeded: true, hiddenOnly: false });
      }, ACCEPT_FALLBACK_DELAY_MS);
    });
  }

  private finish(page: Page, update: Partial<ConsentStatus>): void {
    const state = Object.assign(this.state(page), update);
    this.logger.info(`Consent banner handled (${state.cmp}${state.hiddenOnly ? ', hidden only' : ''})`);
    for (const listener of [...(this.waiters.get(page) ?? [])]) listener();
  }

  private state(page: Page): ConsentStatus {
    let state = this.status.get(page);
    if (!state) {
      state = { cmp: null, done: false, succeeded: null, hiddenOnly: false };
      this.status.set(page, state);
    }
    return state;
  }

  private async onMessage(
    frame: Frame,
    page: Page,
    message: ContentMessage,
    rulesFor: (url: string, mainFrame: boolean) => unknown,
  ): Promise<void> {
    const send = (reply: unknown) =>
      frame.evaluate(`autoconsentReceiveMessage(${JSON.stringify(reply)})`).catch(() => {
        // The frame navigated or went away.
      });
    const state = this.state(page);

    switch (message.type) {
      case 'init': {
        const { url } = message as { url: string };
        // A new document in the page itself: whatever happened on the previous one no longer applies.
        if (frame.parentFrame() === null) this.status.delete(page);
        await send({
          type: 'initResp',
          rules: rulesFor(url, frame.parentFrame() === null),
          config: {
            enabled: true,
            autoAction: this.choice === 'reject' ? 'optOut' : 'optIn',
            disabledCmps: [],
            enablePrehide: true,
            enableCosmeticRules: true,
            enableGeneratedRules: true,
            enableHeuristicDetection: true,
            // tier1 clicks Reject, or an acknowledge button when there's no reject or settings
            // option, but never a lone Accept. tier2 also clicks Accept.
            heuristicMode: this.choice === 'reject' ? 'tier1' : 'tier2',
            detectRetries: 20,
            isMainWorld: false,
            prehideTimeout: 2000,
            logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: false, messages: false, waits: false },
          },
        });
        return;
      }
      case 'eval': {
        const { id, code } = message as { id: string; code: string };
        let result: unknown = false;
        try {
          result = await frame.evaluate(code);
        } catch {
          // The frame navigated or went away.
        }
        await send({ id, type: 'evalResp', result });
        return;
      }
      case 'cmpDetected':
        state.cmp = (message as { cmp: string }).cmp;
        this.logger.debug(`Consent platform found: ${state.cmp}`);
        return;
      case 'optOutResult':
      case 'optInResult':
        state.succeeded = (message as { result: boolean }).result;
        return;
      case 'autoconsentDone': {
        const done = message as { cmp: string; isCosmetic: boolean };
        this.finish(page, { cmp: done.cmp, done: true, hiddenOnly: done.isCosmetic });
        return;
      }
      case 'autoconsentError':
        this.logger.debug('autoconsent error', (message as { details: unknown }).details);
        return;
    }
  }
}
